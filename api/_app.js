// Shared helpers for the handmatch web app: roles, territories, placements, chat, audit, email.
'use strict';
const { env, db, insert, update, sendEmail, hasEmail, escapeHtml, siteUrl } = require('./_lib');
const { hashToken, newToken } = require('./_session');

// ------------------------------------------------------------------ basics
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
const now = () => new Date().toISOString();
const index = (rows, key = 'id') => Object.fromEntries((rows || []).map((r) => [r[key], r]));
const sentence = (s) => (String(s).endsWith('.') ? String(s) : s + '.'); // avoid "Cecile P.."
const fail = (status, message) => Object.assign(new Error(message), { status });
const forbidden = () => fail(403, 'You don’t have access to that.');
const notFound = () => fail(404, 'We couldn’t find that.');

async function byIds(table, col, ids, extra = '') {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return [];
  const out = [];
  for (let i = 0; i < list.length; i += 150) {
    out.push(...((await db(`${table}?select=*&${col}=` + inList(list.slice(i, i + 150)) + extra)) || []));
  }
  return out;
}

// ----------------------------------------------------------------- A/B test
// Variant B ("Meet first, pay when you hire"): a deposit up front, the balance at hire.
// Only active where AB_TEST=1 (staging first). Run supabase/ab-test.sql before switching it on.
const abOn = () => env('AB_TEST') === '1';
const depositCents = () => Math.max(50, parseInt(env('DEPOSIT_CENTS'), 10) || 4900);
const balanceCents = () => Math.max(50, parseInt(env('BALANCE_CENTS'), 10) || 30000);

function stripeForm(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') stripeForm(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}
// Create a Stripe Checkout session. Returns null when Stripe isn't connected.
async function stripeCheckout(session) {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) return null;
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: stripeForm(session)
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Stripe error: ' + JSON.stringify(data.error || data).slice(0, 300));
  return data;
}

// ------------------------------------------------------------------- roles
const STAFF = ['concierge', 'recruiter', 'finance', 'compliance', 'admin'];
const ROLES = ['family', 'applicant'].concat(STAFF);
const ROLE_NAMES = {
  family: 'Family', applicant: 'Applicant', concierge: 'handmatch Concierge', recruiter: 'handmatch Recruiter',
  finance: 'Finance', compliance: 'Compliance', admin: 'Admin'
};
const rolesOf = (u) => (u && Array.isArray(u.roles) ? u.roles : []);
// Admins can open every team view. Family and applicant views are never implied.
const hasRole = (u, r) => rolesOf(u).includes(r) || (STAFF.includes(r) && rolesOf(u).includes('admin'));
const isStaff = (u) => rolesOf(u).some((r) => STAFF.includes(r));
const views = (u) => ROLES.filter((r) => hasRole(u, r));
function need(u, ...rs) { if (!rs.some((r) => hasRole(u, r))) throw forbidden(); }

const adminEmails = () => (env('ADMIN_EMAILS') || env('COORDINATOR_EMAILS')).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

async function userByEmail(email) { return first(await db('users?select=*&email=' + eq(normEmail(email)))); }
async function userById(id) { return id ? first(await db('users?select=*&id=' + eq(id))) : null; }

async function staffUsers() {
  return ((await db('users?select=*&disabled=eq.false&roles=ov.{' + STAFF.join(',') + '}&order=created_at.asc')) || []);
}
async function usersWithRole(role) { return (await staffUsers()).filter((u) => hasRole(u, role)); }

async function defaultConcierge() {
  const pref = normEmail(env('DEFAULT_CONCIERGE_EMAIL') || env('DEFAULT_COORDINATOR_EMAIL'));
  const team = await usersWithRole('concierge');
  return team.find((u) => u.email === pref) || team.find((u) => rolesOf(u).includes('concierge')) || team[0] || null;
}

async function addRoles(user, add) {
  const next = [...new Set(rolesOf(user).concat(add))];
  if (next.length === rolesOf(user).length) return user;
  return update('users', 'id=' + eq(user.id), { roles: next });
}

// ------------------------------------------------------------- territories
const DEFAULT_TERRITORIES = [
  { code: 'NY', name: 'New York', zip_ranges: '100-149', sellable: true, min_wage: 17 },
  { code: 'CA', name: 'California', zip_ranges: '900-961', sellable: true, min_wage: 16.9 },
  { code: 'FL', name: 'Florida', zip_ranges: '320-349', sellable: true, min_wage: 15 }
];
async function territories() {
  try { const rows = await db('territories?select=*&order=code.asc'); return rows && rows.length ? rows : DEFAULT_TERRITORIES; } catch (e) { return DEFAULT_TERRITORIES; }
}
function inRanges(zip, ranges) {
  const z = parseInt(String(zip || '').slice(0, 3), 10);
  if (!(z >= 0) || String(zip || '').length < 3) return false;
  return String(ranges || '').split(',').some((r) => {
    const [a, b] = r.split('-').map((x) => parseInt(x, 10));
    return z >= a && z <= (b >= 0 ? b : a);
  });
}
const territoryFor = (zip, list) => (list || []).find((t) => inRanges(zip, t.zip_ranges)) || null;

// Licences: is a territory OK to sell in, and what needs attention?
function licenceState(t, licences, at = new Date()) {
  const mine = (licences || []).filter((l) => l.territory_code === t.code);
  const soon = new Date(at.getTime() + 60 * 864e5);
  const active = mine.filter((l) => (l.status === 'active' || l.status === 'not_required') && (!l.expires_on || new Date(l.expires_on + 'T23:59:59Z') >= at));
  const expiring = active.filter((l) => l.expires_on && new Date(l.expires_on + 'T23:59:59Z') <= soon);
  const expired = mine.filter((l) => l.status === 'expired' || (l.status === 'active' && l.expires_on && new Date(l.expires_on + 'T23:59:59Z') < at));
  const warnings = [];
  if (!mine.length) warnings.push('No licence on file');
  if (mine.length && !active.length) warnings.push('No active licence');
  expired.forEach((l) => warnings.push((l.kind || 'Licence') + ' expired'));
  expiring.forEach((l) => warnings.push((l.kind || 'Licence') + ' expires ' + l.expires_on));
  return { licensed: active.length > 0, expiring: expiring.length, warnings };
}

// ------------------------------------------------------------- role types
const ROLE_TYPES = ['cleaner', 'housekeeper', 'nanny'];
const roleTypeFrom = (s) => (/nann|child|sitter/i.test(String(s)) ? 'nanny' : /clean/i.test(String(s)) ? 'cleaner' : 'housekeeper');
const ROLE_TYPE_LABEL = { cleaner: 'House cleaner', housekeeper: 'Housekeeper', nanny: 'Nanny' };

// ------------------------------------------------------------ business days
function addBusinessDays(from, n) {
  const d = new Date(from);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}
function businessDaysBetween(a, b) {
  let n = 0; const d = new Date(a); const end = new Date(b);
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); if (d <= end && d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++; }
  return n;
}
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';

// ------------------------------------------------------------ audit + events
async function audit(actor, action, entity, entityId, detail) {
  try {
    await insert('audit_log', { actor_user_id: actor ? actor.id || actor : null, action, entity: entity || '', entity_id: entityId ? String(entityId) : '', detail: detail || {} });
  } catch (e) { console.error('audit failed', e.message); }
}

async function addEvent(placementId, kind, body, { actor = null, visible = true } = {}) {
  return insert('placement_events', { placement_id: placementId, kind, body, actor_user_id: actor, visible_to_family: visible });
}
async function pipelineEvent(applicantId, kind, body, actor) {
  return insert('pipeline_events', { applicant_user_id: applicantId, kind, body, actor_user_id: actor || null });
}

// -------------------------------------------------------------------- chat
async function addMembers(threadId, ids) {
  const want = [...new Set((ids || []).filter(Boolean))];
  if (!want.length) return;
  const have = new Set(((await db('thread_members?select=user_id&thread_id=' + eq(threadId))) || []).map((m) => m.user_id));
  for (const id of want) if (!have.has(id)) await insert('thread_members', { thread_id: threadId, user_id: id });
}

async function ensureThread(key, members) {
  const filters = ['kind=' + eq(key.kind)];
  if (key.case_id) filters.push('case_id=' + eq(key.case_id));
  else if (key.placement_applicant_id) filters.push('placement_applicant_id=' + eq(key.placement_applicant_id));
  else if (key.placement_id) filters.push('placement_id=' + eq(key.placement_id));
  let t = first(await db('threads?select=*&' + filters.join('&')));
  if (!t) t = await insert('threads', Object.assign({ title: '' }, key));
  await addMembers(t.id, members);
  return t;
}

async function postMessage(threadId, userId, body, { internal = false, system = false } = {}) {
  const m = await insert('thread_messages', { thread_id: threadId, user_id: userId || null, body, internal, system });
  await update('threads', 'id=' + eq(threadId), { last_message_at: m.created_at || now() });
  if (userId && !system) {
    await update('thread_members', 'thread_id=' + eq(threadId) + '&user_id=' + eq(userId), { last_read_at: m.created_at || now() });
  }
  return m;
}

// Before a hire, phone numbers and emails typed in the family–applicant chat are hidden.
// Calls and meetings are arranged through the Concierge, so everyone stays safe.
function maskContacts(text) {
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email hidden until hire]')
    .replace(/(\+?\d[\d\s().-]{8,}\d)/g, (m) => (m.replace(/\D/g, '').length >= 10 ? '[number hidden until hire]' : m));
}

// --------------------------------------------------------------- placements
async function placementById(id) {
  const p = id ? first(await db('placements?select=*&id=' + eq(id))) : null;
  if (!p) throw notFound();
  return p;
}
async function linkById(id) {
  const l = id ? first(await db('placement_applicants?select=*&id=' + eq(id))) : null;
  if (!l) throw notFound();
  return l;
}

async function conciergeThread(p) {
  return ensureThread({ kind: 'concierge', placement_id: p.id, title: 'Your Concierge' }, [p.family_user_id, p.concierge_user_id]);
}
async function meetThread(p, link) {
  return ensureThread({ kind: 'meet', placement_id: p.id, placement_applicant_id: link.id, title: '' }, [p.family_user_id, link.applicant_user_id, p.concierge_user_id]);
}

// Supply check: fewer than 3 active applicants for this territory and type → ask the recruiters.
async function supplyCheck(p, actor) {
  if (!p.territory_code) return null;
  const roleType = roleTypeFrom(p.help_type);
  const active = (await db('applicant_profiles?select=user_id&status=eq.active&role_type=' + eq(roleType) + '&territory_code=' + eq(p.territory_code))) || [];
  if (active.length >= 3) return null;
  const open = (await db('supply_requests?select=id&status=in.(open,in_progress)&role_type=' + eq(roleType) + '&territory_code=' + eq(p.territory_code))) || [];
  if (open.length) return null;
  const sr = await insert('supply_requests', {
    placement_id: p.id, territory_code: p.territory_code, zip: p.zip, role_type: roleType, needed: 3 - active.length,
    details: `Automatic: only ${active.length} active ${ROLE_TYPE_LABEL[roleType].toLowerCase()}${active.length === 1 ? '' : 's'} in ${p.territory_code} for a new placement near ${p.zip || 'this ZIP'}.`,
    due_at: addBusinessDays(new Date(), 3).toISOString(), status: 'open', created_by: actor || null
  });
  for (const r of await usersWithRole('recruiter')) {
    await notify(r, `Supply needed: ${ROLE_TYPE_LABEL[roleType]} in ${p.territory_code}`, [sr.details, 'Open the Recruiter dashboard to pick it up.'], 'Open dashboard', 'recruiter');
  }
  return sr;
}

// Paid order → family account → placement with a Concierge, a chat thread and a supply check.
async function ensureFamilyPlacement(order) {
  if (!order || order.status !== 'paid') return null;
  const email = normEmail(order.email);
  let family = await userByEmail(email);
  if (!family) family = await insert('users', { email, roles: ['family'], full_name: order.full_name || '', phone: order.phone || '' });
  else family = await addRoles(family, ['family']);
  const existing = first(await db('placements?select=*&order_id=' + eq(order.id)));
  if (existing) return existing;
  const request = order.request_id ? first(await db('requests?select=*&id=' + eq(order.request_id))) : null;
  const zip = request ? String(request.location || '').replace(/\D/g, '').slice(0, 5) : '';
  const terr = territoryFor(zip, await territories());
  const concierge = await defaultConcierge();
  const p = await insert('placements', {
    family_user_id: family.id, concierge_user_id: concierge ? concierge.id : null, order_id: order.id, request_id: order.request_id || null,
    status: 'new', zip, territory_code: terr ? terr.code : '', help_type: request ? String(request.help_type || '') : '',
    hires_allowed: Math.max(1, Number(order.hires) || 1),
    ...(order.fee_type === 'deposit' ? { fee_model: 'deposit' } : {})
  });
  await addEvent(p.id, 'created', order.fee_type === 'deposit'
    ? 'Deposit received. Welcome to handmatch! You only pay the balance when you choose to hire.'
    : 'Payment confirmed. Welcome to handmatch!');
  const cName = concierge ? firstName(concierge.full_name) || 'Your Concierge' : '';
  if (concierge) await addEvent(p.id, 'concierge', `${cName} is your handmatch Concierge and will reach out personally.`);
  const t = await conciergeThread(p);
  await postMessage(t.id, concierge ? concierge.id : null, `Hi ${firstName(family.full_name) || 'there'}, welcome to handmatch! I’m ${cName || 'your Concierge'}, your handmatch Concierge. I’ll call you shortly to get to know your home. You can message me here any time.`, { system: !concierge });
  await supplyCheck(p, null).catch((e) => console.error('supply check failed', e.message));
  if (concierge) await notify(concierge, `New placement: ${family.full_name || family.email}`, [`${family.full_name || 'A family'} just paid for ${p.hires_allowed} hire${p.hires_allowed > 1 ? 's' : ''}${zip ? ' near ' + zip : ''}.`, 'Please call them within 1 business day.'], 'Open dashboard', 'concierge');
  return p;
}

// Applied through /join → applicant account with a submitted profile in the recruiting pipeline.
async function applicantFromHelper(helper, terrList) {
  const email = normEmail(helper.email);
  let u = await userByEmail(email);
  if (u) u = await addRoles(u, ['applicant']);
  else u = await insert('users', { email, roles: ['applicant'], full_name: helper.full_name || '', phone: helper.phone || '' });
  if (first(await db('applicant_profiles?select=user_id&user_id=' + eq(u.id)))) return u;
  const zip = (String(helper.city || '').match(/\b\d{5}\b/) || [''])[0];
  const t = territoryFor(zip, terrList || await territories());
  await insert('applicant_profiles', {
    user_id: u.id, role_type: roleTypeFrom((helper.roles || [])[0] || 'housekeeper'), city: helper.city || '', zip, territory_code: t ? t.code : '',
    rate: parseFloat(String(helper.rate || '').replace(/[^\d.]/g, '')) || null, skills: helper.services || [], days: helper.days || [],
    bio: helper.bio || '', status: 'submitted', pipeline_stage: 'lead', source: 'website', background_consent: !!helper.background_check_consent
  });
  await pipelineEvent(u.id, 'created', 'Applied on handmatch.us/join.');
  return u;
}

// ------------------------------------------------------------------- email
const siteUrlStatic = () => env('SITE_URL', 'https://handmatch.us').replace(/\/+$/, '');

async function notify(user, subject, lines, cta = 'Open your handmatch account', view = '') {
  if (!user || !user.email || user.disabled) return;
  const link = siteUrlStatic() + '/app' + (view ? '#' + view : '');
  const html = `<div style="font-family:Arial,sans-serif;color:#2A2722;max-width:560px">
    <p style="font-size:16px;line-height:1.6">Hi ${escapeHtml(firstName(user.full_name) || 'there')},</p>
    ${lines.filter(Boolean).map((l) => `<p style="font-size:16px;line-height:1.6">${escapeHtml(l)}</p>`).join('')}
    <p><a href="${link}" style="display:inline-block;background:#2A2722;color:#FBFAF7;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">${escapeHtml(cta)}</a></p>
    <p style="font-size:14px;color:#6F6152">handmatch · The right hands for your home.</p></div>`;
  await sendEmail({ to: user.email, subject, html, replyTo: env('TEAM_EMAIL', 'hello.handmatch@gmail.com') }).catch((e) => console.error(e));
}
async function notifyRole(role, subject, lines, cta, view) {
  for (const u of await usersWithRole(role)) await notify(u, subject, lines, cta || 'Open dashboard', view || role);
}

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

// ----------------------------------------------------------------- refunds
// The published policy (matches page and /terms#refunds), applied automatically.
// Finance always makes the final decision and can change the amount.
function refundEligibility({ order, placement, links, refunds }, at = new Date()) {
  const paid = Number(order && (order.amount_paid_cents || order.amount_cents)) || 0;
  const already = Math.max(
    (refunds || []).filter((r) => r.status === 'refunded' || r.status === 'approved').reduce((s, r) => s + (r.amount_cents || 0), 0),
    Number(order && order.refunded_cents) || 0);
  const left = Math.max(0, paid - already);
  const paidAt = new Date((order && (order.paid_at || order.created_at)) || (placement && placement.created_at) || at);
  const days = Math.floor((at - paidAt) / 864e5);
  const all = links || [];
  const shared = all.length > 0;
  const hired = all.some((l) => ['hired', 'ended'].includes(l.status)) || !!(placement && placement.hired_at);
  const firstAccept = all.filter((l) => !['waiting', 'declined', 'removed'].includes(l.status)).map((l) => new Date(l.created_at)).sort((a, b) => a - b)[0];
  const out = (percent, rule, reason) => ({ percent, rule, reason, amount_cents: Math.round(left * percent / 100), paid_cents: paid, refunded_cents: already, days_since_payment: days });
  if (!paid) return out(0, 'no_payment', 'No payment found for this placement.');
  if (left <= 0) return out(0, 'already_refunded', 'This order has already been refunded.');
  if (hired) return out(0, 'hired', 'A hire has been made, so the fee isn’t refundable. Up to 3 free replacements within 90 days are available instead.');
  if (!shared) return out(100, 'before_shared', 'Cancelled before we shared any applicants: full refund.');
  if (days >= 14 && !firstAccept) return out(100, 'no_match_14', 'We couldn’t find a suitable available match within 14 days: full refund.');
  if (placement && placement.fee_model === 'deposit') {
    return out(0, 'deposit_shared', 'Applicants have been shared, so the deposit isn’t refundable. The balance is only charged if you choose to hire.');
  }
  if (days >= 30) return out(50, 'no_hire_30', 'Applicants were shared but no hire within 30 days: 50% refund.');
  const from = new Date(paidAt.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  return out(0, 'too_early', `Applicants have been shared. If there’s no hire, a 50% refund is available from ${from}.`);
}

// Replacement promise: up to 3 within 90 days of the first hire.
function replacementState(p, at = new Date()) {
  if (!p.hired_at) return { eligible: false, left: 3, until: null, reason: 'Available after your first hire.' };
  const until = new Date(new Date(p.hired_at).getTime() + 90 * 864e5);
  const left = Math.max(0, 3 - (p.replacements_used || 0));
  const eligible = at <= until && left > 0;
  return { eligible, left, until: until.toISOString(), reason: eligible ? `${left} free replacement${left === 1 ? '' : 's'} left until ${until.toISOString().slice(0, 10)}.` : left <= 0 ? 'All 3 replacements have been used.' : 'The 90-day replacement window has ended.' };
}

module.exports = {
  eq, inList, normEmail, first, firstName, shortName, now, index, sentence, fail, forbidden, notFound, byIds,
  STAFF, ROLES, ROLE_NAMES, rolesOf, hasRole, isStaff, views, need, adminEmails, userByEmail, userById, staffUsers, usersWithRole, defaultConcierge, addRoles,
  DEFAULT_TERRITORIES, territories, territoryFor, inRanges, licenceState,
  ROLE_TYPES, roleTypeFrom, ROLE_TYPE_LABEL, addBusinessDays, businessDaysBetween, fmtWhen,
  audit, addEvent, pipelineEvent, addMembers, ensureThread, postMessage, maskContacts,
  placementById, linkById, conciergeThread, meetThread, supplyCheck, ensureFamilyPlacement, applicantFromHelper,
  siteUrlStatic, siteUrl, notify, notifyRole, sendLoginLink, refundEligibility, replacementState,
  abOn, depositCents, balanceCents, stripeForm, stripeCheckout,
  // 1.0 name kept so the Stripe webhook keeps working
  ensureFamilyCase: ensureFamilyPlacement
};
