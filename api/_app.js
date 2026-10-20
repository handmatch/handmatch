// Shared helpers for the handmatch web app (families, applicants, coordinators).
'use strict';
const { env, db, insert, sendEmail, hasEmail, escapeHtml, siteUrl } = require('./_lib');
const { hashToken, newToken } = require('./_session');

const eq = (v) => 'eq.' + encodeURIComponent(v);
const inList = (ids) => 'in.(' + ids.map((x) => encodeURIComponent(x)).join(',') + ')';
const normEmail = (e) => String(e || '').trim().toLowerCase();
const first = (rows) => (rows && rows[0]) || null;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const shortName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.' : parts[0];
};

const coordinatorEmails = () => env('COORDINATOR_EMAILS').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

async function userByEmail(email) {
  return first(await db('users?select=*&email=' + eq(normEmail(email))));
}

async function userById(id) {
  return id ? first(await db('users?select=*&id=' + eq(id))) : null;
}

async function defaultCoordinator() {
  const pref = normEmail(env('DEFAULT_COORDINATOR_EMAIL'));
  if (pref) { const u = await userByEmail(pref); if (u && u.role === 'coordinator') return u; }
  return first(await db('users?select=*&role=eq.coordinator&disabled=eq.false&order=created_at.asc&limit=1'));
}

async function addEvent(caseId, kind, body, { actor = null, visible = true } = {}) {
  return insert('case_events', { case_id: caseId, kind, body, actor_user_id: actor, visible_to_family: visible });
}

// Paid order → family account (if new) → case with a coordinator (if new).
async function ensureFamilyCase(order) {
  if (!order || order.status !== 'paid') return null;
  const email = normEmail(order.email);
  let family = await userByEmail(email);
  if (!family) family = await insert('users', { email, role: 'family', full_name: order.full_name || '', phone: order.phone || '' });
  if (family.role !== 'family') return null;
  const existing = first(await db('cases?select=*&order_id=' + eq(order.id)));
  if (existing) return existing;
  const request = order.request_id ? first(await db('requests?select=*&id=' + eq(order.request_id))) : null;
  const coord = await defaultCoordinator();
  const c = await insert('cases', {
    family_user_id: family.id,
    coordinator_user_id: coord ? coord.id : null,
    order_id: order.id,
    request_id: order.request_id || null,
    status: 'new',
    zip: request ? String(request.location || '') : '',
    help_type: request ? String(request.help_type || '') : ''
  });
  await addEvent(c.id, 'created', 'Payment confirmed. Welcome to handmatch!');
  if (coord) await addEvent(c.id, 'coordinator', `${firstName(coord.full_name) || 'Your coordinator'} is your dedicated coordinator and will reach out personally.`);
  return c;
}

// Applied through /join → applicant account with a draft profile.
async function applicantFromHelper(helper) {
  const email = normEmail(helper.email);
  const u = await insert('users', { email, role: 'applicant', full_name: helper.full_name || '', phone: helper.phone || '' });
  const role = String((helper.roles || [])[0] || 'housekeeper').toLowerCase();
  await insert('applicant_profiles', {
    user_id: u.id,
    role_type: /nanny/.test(role) ? 'nanny' : /clean/.test(role) ? 'cleaner' : 'housekeeper',
    city: helper.city || '',
    rate: parseFloat(String(helper.rate || '').replace(/[^\d.]/g, '')) || null,
    skills: helper.services || [],
    days: helper.days || [],
    bio: helper.bio || '',
    status: 'submitted'
  });
  return u;
}

async function notify(user, subject, lines, cta = 'Open your handmatch account') {
  if (!user || !user.email) return;
  const link = siteUrlStatic() + '/app';
  const html = `<div style="font-family:Arial,sans-serif;color:#2A2722;max-width:560px">
    <p style="font-size:16px;line-height:1.6">Hi ${escapeHtml(firstName(user.full_name) || 'there')},</p>
    ${lines.map((l) => `<p style="font-size:16px;line-height:1.6">${escapeHtml(l)}</p>`).join('')}
    <p><a href="${link}" style="display:inline-block;background:#2A2722;color:#FBFAF7;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">${escapeHtml(cta)}</a></p>
    <p style="font-size:14px;color:#6F6152">handmatch · The right hands for your home.</p></div>`;
  await sendEmail({ to: user.email, subject, html, replyTo: env('TEAM_EMAIL', 'hello.handmatch@gmail.com') }).catch((e) => console.error(e));
}

// Email someone a one-time sign-in link (20 minutes). Used for logins and invites.
async function sendLoginLink(user, { subject = 'Your handmatch sign-in link', intro = 'Tap the button to sign in to handmatch.' } = {}) {
  const token = newToken();
  await insert('login_tokens', { user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString() });
  const link = siteUrlStatic() + '/login?token=' + token;
  if (!hasEmail() && process.env.VERCEL_ENV !== 'production') console.log('[dev] sign-in link for ' + user.email + ': ' + link);
  await sendEmail({
    to: user.email,
    subject,
    html: `<div style="font-family:Arial,sans-serif;color:#2A2722;max-width:520px">
      <p style="font-size:16px;line-height:1.6">Hi ${escapeHtml(firstName(user.full_name) || 'there')},</p>
      <p style="font-size:16px;line-height:1.6">${escapeHtml(intro)} The link works once and expires in 20 minutes.</p>
      <p><a href="${link}" style="display:inline-block;background:#2A2722;color:#FBFAF7;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Sign in to handmatch</a></p>
      <p style="font-size:13px;color:#6F6152">If you didn’t expect this, you can ignore this email.</p></div>`
  });
}

const siteUrlStatic = () => env('SITE_URL', 'https://handmatch.us').replace(/\/+$/, '');

module.exports = {
  eq, inList, normEmail, first, firstName, shortName, coordinatorEmails,
  userByEmail, userById, defaultCoordinator, addEvent, ensureFamilyCase, applicantFromHelper, notify, sendLoginLink, siteUrlStatic, siteUrl
};
