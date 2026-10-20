// Email magic-link login for the handmatch web app.
//   POST /api/auth?action=start   { email }   → emails a one-time link if we know the person
//   POST /api/auth?action=verify  { token }   → signs the person in (session cookie)
//   POST /api/auth?action=logout
//   GET  /api/auth?action=me                  → the signed-in person, or 401
'use strict';
const { env, readJson, query, send, isEmail, badRequest, hasDb, db, insert, update, handler } = require('./_lib');
const { setSession, clearSession, currentUser, sameOrigin, hashToken } = require('./_session');
const { eq, normEmail, first, adminEmails, rolesOf, views, addRoles, userByEmail, ensureFamilyPlacement, applicantFromHelper, sendLoginLink, audit } = require('./_app');

const ALL_STAFF = ['admin', 'concierge', 'recruiter', 'finance', 'compliance'];

// Find the person behind an email, creating their account the first time if they're on
// the admin list, a paying family or someone who applied to work with us.
async function findOrCreate(email) {
  let user = await userByEmail(email);
  const isAdmin = adminEmails().includes(email);
  if (user) {
    if (isAdmin && !rolesOf(user).includes('admin')) user = await addRoles(user, ALL_STAFF);
  } else if (isAdmin) {
    user = await insert('users', { email, roles: ALL_STAFF });
  }
  // Any paid order for this email that doesn't have a placement yet gets one now.
  const orders = ((await db('orders?select=*&status=eq.paid&email=ilike.' + encodeURIComponent(email) + '&order=created_at.desc&limit=10')) || [])
    .filter((o) => normEmail(o.email) === email);
  for (const o of orders) await ensureFamilyPlacement(o);
  if (orders.length) return userByEmail(email);
  if (user) return user;
  const helpers = ((await db('helpers?select=*&email=ilike.' + encodeURIComponent(email) + '&order=created_at.desc&limit=5')) || [])
    .filter((h) => normEmail(h.email) === email);
  if (helpers.length) return applicantFromHelper(helpers[0]);
  return null;
}

const publicUser = (u) => ({ id: u.id, email: u.email, roles: rolesOf(u), views: views(u), full_name: u.full_name, phone: u.phone, photo_url: u.photo_url });

module.exports = handler(async (req, res) => {
  const action = query(req).action;
  if (!sameOrigin(req)) return send(res, 403, { error: 'Not allowed' });
  if (!hasDb()) throw Object.assign(new Error('Login isn’t set up yet.'), { status: 503 });

  if (action === 'me' && req.method === 'GET') {
    const u = await currentUser(req);
    return u ? send(res, 200, { user: publicUser(u) }) : send(res, 401, { error: 'Not signed in' });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  if (action === 'start') {
    const b = await readJson(req);
    const email = normEmail(b.email);
    if (!isEmail(email)) throw badRequest('Enter a valid email address.');
    const user = await findOrCreate(email);
    if (user && !user.disabled) {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const recent = (await db('login_tokens?select=id,created_at&user_id=' + eq(user.id) + '&order=created_at.desc&limit=5')) || [];
      if (recent.filter((t) => t.created_at > since).length < 5) {
        await sendLoginLink(user);
      }
    }
    // Same answer either way, so nobody can test which emails have accounts.
    return send(res, 200, { ok: true });
  }

  if (action === 'verify') {
    const b = await readJson(req);
    const token = String(b.token || '');
    if (!/^[0-9a-f]{64}$/.test(token)) throw badRequest('This sign-in link isn’t valid. Request a new one.');
    const row = first(await db('login_tokens?select=*&token_hash=' + eq(hashToken(token))));
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
      throw badRequest('This sign-in link has expired or was already used. Request a new one.');
    }
    await update('login_tokens', 'id=' + eq(row.id), { used_at: new Date().toISOString() });
    const user = first(await db('users?select=*&id=' + eq(row.user_id)));
    if (!user || user.disabled) throw badRequest('This account isn’t active. Please email hello.handmatch@gmail.com.');
    await update('users', 'id=' + eq(user.id), { last_login_at: new Date().toISOString() });
    setSession(res, user);
    await audit(user, 'sign_in', 'user', user.id, {});
    return send(res, 200, { ok: true, views: views(user) });
  }

  // Right after paying: sign the family straight into their account (once, within 24 hours).
  // Team and applicant accounts never sign in this way; they get an emailed link instead.
  if (action === 'order') {
    if (env('APP_ENABLED') !== '1') return send(res, 200, { app: false });
    const b = await readJson(req);
    let filter = '';
    if (/^cs_[A-Za-z0-9_]{10,}$/.test(b.session_id || '')) filter = 'stripe_session_id=' + eq(b.session_id);
    else if (/^[0-9a-f-]{36}$/i.test(b.order_id || '')) filter = 'id=' + eq(b.order_id);
    else throw badRequest('Missing order.');
    const order = first(await db('orders?select=*&' + filter));
    if (!order || order.status !== 'paid') return send(res, 200, { app: true, signed_in: false, pending: true });
    if (Date.now() - new Date(order.paid_at || order.created_at).getTime() > 24 * 3600e3) return send(res, 200, { app: true, signed_in: false });
    await ensureFamilyPlacement(order);
    const user = await userByEmail(order.email);
    if (!user || user.disabled) return send(res, 200, { app: true, signed_in: false });
    if (rolesOf(user).some((r) => r !== 'family')) {
      await sendLoginLink(user, { subject: 'Your handmatch account', intro: 'Thanks for your payment. Tap the button to see your next steps.' });
      return send(res, 200, { app: true, signed_in: false, sent: true });
    }
    try {
      await insert('login_tokens', { user_id: user.id, token_hash: hashToken('order:' + order.id), expires_at: new Date().toISOString(), used_at: new Date().toISOString() });
    } catch (e) { return send(res, 200, { app: true, signed_in: false, used: true }); } // already used once
    await update('users', 'id=' + eq(user.id), { last_login_at: new Date().toISOString() });
    setSession(res, user);
    await audit(user, 'sign_in_after_payment', 'order', order.id, {});
    return send(res, 200, { app: true, signed_in: true });
  }

  if (action === 'logout') {
    clearSession(res);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found' });
}, ['GET', 'POST']);
