// The handmatch web app API. Every request needs a signed-in user; each action checks the role.
//   GET  /api/app?action=dashboard           → data for the signed-in person's dashboard
//   POST /api/app?action=<name>  { ... }      → change something, returns the refreshed dashboard
'use strict';
const { readJson, query, send, clean, isEmail, badRequest, hasDb, db, insert, update, handler } = require('./_lib');
const { currentUser, sameOrigin } = require('./_session');
const A = require('./_app');

const CASE_STATUS = ['new', 'contacted', 'interviewing', 'hired', 'replacement', 'closed'];
const CA_STATUS = ['proposed', 'accepted', 'declined', 'interview', 'hired', 'not_selected', 'removed'];
const PROFILE_STATUS = ['draft', 'submitted', 'active', 'paused'];
const BACKGROUND = ['not_started', 'pending', 'clear'];
const ROLE_TYPES = ['cleaner', 'housekeeper', 'nanny'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_EVENT = {
  contacted: 'Your coordinator has reached out to you.',
  interviewing: 'Interviews with your applicants are being set up.',
  hired: 'You’ve hired your helper. Congratulations!',
  replacement: 'We’re finding you a replacement, at no extra charge.',
  closed: 'Your case is complete. We’re always here if you need us.'
};

const fail = (status, message) => Object.assign(new Error(message), { status });
const forbidden = () => fail(403, 'You don’t have access to that.');
const notFound = () => fail(404, 'We couldn’t find that.');
const toList = (v, max) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => clean(String(x), 60)).filter(Boolean).slice(0, max);
const index = (rows, key = 'id') => Object.fromEntries((rows || []).map((r) => [r[key], r]));
const now = () => new Date().toISOString();
const sentence = (name) => (name.endsWith('.') ? name : name + '.'); // avoid "Cecile P.."

async function byIds(table, col, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return [];
  return (await db(`${table}?select=*&${col}=` + A.inList(list))) || [];
}

function publicProfile(u, p) {
  return {
    user_id: u.id, name: A.shortName(u.full_name) || 'Applicant', photo_url: u.photo_url || '',
    role_type: p.role_type, city: p.city, zip: p.zip, rate: p.rate, years: p.years, employment: p.employment,
    languages: p.languages || [], skills: p.skills || [], bio: p.bio, days: p.days || [], hours: p.hours,
    start_in_days: p.start_in_days,
    checks: { interview: !!p.check_interview, id: !!p.check_id, references: !!p.check_references, background: p.check_background }
  };
}

const coordCard = (u) => (u ? { name: u.full_name || 'Your coordinator', first: A.firstName(u.full_name) || 'Your coordinator', email: u.email, phone: u.phone, photo_url: u.photo_url || '' } : null);

// ---------------------------------------------------------------- dashboards
async function familyDashboard(user) {
  const cases = (await db('cases?select=*&family_user_id=' + A.eq(user.id) + '&order=created_at.desc')) || [];
  const ids = cases.map((c) => c.id);
  const links = (await byIds('case_applicants', 'case_id', ids)).filter((x) => ['proposed', 'accepted', 'interview', 'hired'].includes(x.status));
  const users = index(await byIds('users', 'id', links.map((x) => x.applicant_user_id).concat(cases.map((c) => c.coordinator_user_id))));
  const profiles = index(await byIds('applicant_profiles', 'user_id', links.map((x) => x.applicant_user_id)), 'user_id');
  const events = ids.length ? (await db('case_events?select=*&visible_to_family=eq.true&case_id=' + A.inList(ids) + '&order=created_at.desc&limit=300')) || [] : [];
  const orders = index(await byIds('orders', 'id', cases.map((c) => c.order_id)));
  return {
    cases: cases.map((c) => ({
      id: c.id, status: c.status, zip: c.zip, help_type: c.help_type, created_at: c.created_at,
      order_ref: (orders[c.order_id] || {}).order_ref || '',
      coordinator: coordCard(users[c.coordinator_user_id]),
      applicants: links.filter((x) => x.case_id === c.id).map((x) => {
        const u = users[x.applicant_user_id]; const p = profiles[x.applicant_user_id];
        return u && p ? Object.assign(publicProfile(u, p), { link_id: x.id, status: x.status, interview_at: x.interview_at }) : null;
      }).filter(Boolean),
      events: events.filter((e) => e.case_id === c.id).map((e) => ({ id: e.id, kind: e.kind, body: e.body, created_at: e.created_at }))
    }))
  };
}

async function applicantDashboard(user) {
  let profile = A.first(await db('applicant_profiles?select=*&user_id=' + A.eq(user.id)));
  if (!profile) profile = await insert('applicant_profiles', { user_id: user.id });
  const links = ((await db('case_applicants?select=*&applicant_user_id=' + A.eq(user.id) + '&order=created_at.desc')) || []).filter((x) => x.status !== 'removed');
  const cases = index(await byIds('cases', 'id', links.map((x) => x.case_id)));
  const families = index(await byIds('users', 'id', Object.values(cases).map((c) => c.family_user_id)));
  const { coordinator_notes, ...own } = profile; // private to coordinators
  return {
    profile: own,
    requests: links.map((x) => {
      const c = cases[x.case_id] || {}; const f = families[c.family_user_id] || {};
      return { id: x.id, status: x.status, interview_at: x.interview_at, created_at: x.created_at, family_first: A.firstName(f.full_name) || 'A family', zip: c.zip || '', help_type: c.help_type || '' };
    })
  };
}

async function coordinatorDashboard() {
  const cases = (await db('cases?select=*&order=created_at.desc&limit=300')) || [];
  const ids = cases.map((c) => c.id);
  const links = await byIds('case_applicants', 'case_id', ids);
  const events = ids.length ? (await db('case_events?select=*&case_id=' + A.inList(ids) + '&order=created_at.desc&limit=1500')) || [] : [];
  const users = (await db('users?select=*&order=created_at.desc&limit=2000')) || [];
  const profiles = (await db('applicant_profiles?select=*&limit=2000')) || [];
  const orders = index(await byIds('orders', 'id', cases.map((c) => c.order_id)));
  const requests = index(await byIds('requests', 'id', cases.map((c) => c.request_id)));
  const U = index(users); const P = index(profiles, 'user_id');
  return {
    cases: cases.map((c) => {
      const f = U[c.family_user_id] || {}; const o = orders[c.order_id] || {}; const r = requests[c.request_id];
      return {
        id: c.id, status: c.status, zip: c.zip, help_type: c.help_type, notes: c.notes, created_at: c.created_at, updated_at: c.updated_at,
        coordinator_user_id: c.coordinator_user_id || '',
        family: { id: f.id, name: f.full_name || '', email: f.email || '', phone: f.phone || '' },
        order: { ref: o.order_ref || '', hires: o.hires || null, paid_cents: o.amount_paid_cents || o.amount_cents || null },
        request: r ? { services: r.services || [], days: r.days || [], frequency: r.frequency, budget_per_hour: r.budget_per_hour, home_size: r.home_size, pets: r.pets, supplies: r.supplies, notes: r.notes } : null,
        applicants: links.filter((x) => x.case_id === c.id && x.status !== 'removed').map((x) => ({ id: x.id, user_id: x.applicant_user_id, name: (U[x.applicant_user_id] || {}).full_name || '', status: x.status, interview_at: x.interview_at })),
        events: events.filter((e) => e.case_id === c.id).map((e) => ({ id: e.id, kind: e.kind, body: e.body, created_at: e.created_at, visible: e.visible_to_family, actor: (U[e.actor_user_id] || {}).full_name || '' }))
      };
    }),
    applicants: users.filter((u) => u.role === 'applicant').map((u) => Object.assign(
      { status: 'draft', role_type: 'housekeeper', languages: [], skills: [], days: [], check_background: 'not_started' },
      P[u.id] || {},
      { user_id: u.id, full_name: u.full_name, email: u.email, phone: u.phone, photo_url: u.photo_url, last_login_at: u.last_login_at, disabled: u.disabled }
    )),
    coordinators: users.filter((u) => u.role === 'coordinator' && !u.disabled).map((u) => ({ id: u.id, full_name: u.full_name, email: u.email, phone: u.phone, photo_url: u.photo_url }))
  };
}

async function dashboard(user) {
  const me = { id: user.id, email: user.email, role: user.role, full_name: user.full_name, phone: user.phone, photo_url: user.photo_url };
  const data = user.role === 'family' ? await familyDashboard(user)
    : user.role === 'applicant' ? await applicantDashboard(user)
      : await coordinatorDashboard();
  return Object.assign({ me }, data);
}

// ---------------------------------------------------------------- validation
function profilePatch(b) {
  const p = {};
  if ('role_type' in b) { if (!ROLE_TYPES.includes(b.role_type)) throw badRequest('Choose cleaner, housekeeper or nanny.'); p.role_type = b.role_type; }
  if ('city' in b) p.city = clean(b.city, 80);
  if ('zip' in b) { const z = clean(String(b.zip || ''), 10); if (z && !/^\d{5}$/.test(z)) throw badRequest('Enter a 5-digit ZIP code.'); p.zip = z; }
  const num = (k, lo, hi, msg, int) => {
    if (!(k in b)) return;
    const v = b[k] === '' || b[k] == null ? null : (int ? parseInt(b[k], 10) : Number(b[k]));
    if (v !== null && !(v >= lo && v <= hi)) throw badRequest(msg);
    p[k] = v;
  };
  num('rate', 0, 200, 'Enter an hourly rate between $0 and $200.');
  num('years', 0, 60, 'Enter years of experience between 0 and 60.', true);
  num('start_in_days', 0, 90, 'Enter how many days until you can start (0 to 90).', true);
  if ('employment' in b) p.employment = clean(b.employment, 60);
  if ('languages' in b) p.languages = toList(b.languages, 10);
  if ('skills' in b) p.skills = toList(b.skills, 20);
  if ('bio' in b) p.bio = clean(b.bio, 1200);
  if ('days' in b) p.days = toList(b.days, 7).filter((d) => DAYS.includes(d));
  if ('hours' in b) p.hours = clean(b.hours, 80);
  return p;
}

function userPatch(b, { photo = false } = {}) {
  const p = {};
  if ('full_name' in b) p.full_name = clean(b.full_name, 120);
  if ('phone' in b) p.phone = clean(b.phone, 40);
  if (photo && 'photo_url' in b) {
    const u = clean(b.photo_url, 500);
    if (u && !/^(https:\/\/|\/assets\/)/.test(u)) throw badRequest('Photo must be an https:// link or a site image path.');
    p.photo_url = u;
  }
  return p;
}

async function ownLink(user, id) {
  const link = A.first(await db('case_applicants?select=*&id=' + A.eq(id)));
  if (!link || link.applicant_user_id !== user.id) throw notFound();
  return link;
}

async function caseById(id) {
  const c = A.first(await db('cases?select=*&id=' + A.eq(id)));
  if (!c) throw notFound();
  return c;
}

const fmtWhen = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';

// ---------------------------------------------------------------- actions
const ACTIONS = {
  // Anyone signed in: update their own name and phone (coordinators can set a photo).
  async update_me(user, b) {
    const patch = userPatch(b, { photo: user.role === 'coordinator' });
    if (Object.keys(patch).length) await update('users', 'id=' + A.eq(user.id), patch);
  },

  // ---- applicants
  async save_profile(user, b) {
    if (user.role !== 'applicant') throw forbidden();
    const up = userPatch(b);
    if (Object.keys(up).length) await update('users', 'id=' + A.eq(user.id), up);
    const patch = profilePatch(b);
    const current = A.first(await db('applicant_profiles?select=*&user_id=' + A.eq(user.id)));
    if (b.submit) {
      const merged = Object.assign({}, current || {}, patch);
      const name = up.full_name != null ? up.full_name : user.full_name;
      if (!name || !merged.zip || !merged.role_type) throw badRequest('Add your name, ZIP code and type of work before submitting.');
      if (!current || ['draft', 'paused'].includes(current.status)) patch.status = 'submitted';
    }
    patch.updated_at = now();
    if (current) await update('applicant_profiles', 'user_id=' + A.eq(user.id), patch);
    else await insert('applicant_profiles', Object.assign({ user_id: user.id }, patch));
  },

  async respond(user, b) {
    if (user.role !== 'applicant') throw forbidden();
    const link = await ownLink(user, b.id);
    if (link.status !== 'proposed') throw badRequest('This request was already answered.');
    const accept = !!b.accept;
    await update('case_applicants', 'id=' + A.eq(link.id), { status: accept ? 'accepted' : 'declined' });
    const name = A.shortName(user.full_name) || 'Your applicant';
    await A.addEvent(link.case_id, accept ? 'applicant_accepted' : 'applicant_declined',
      accept ? `${name} confirmed they’re available. Your coordinator will set up your interview.` : `${name} isn’t available for this one.`,
      { actor: user.id, visible: accept });
    const c = await caseById(link.case_id);
    const coord = await A.userById(c.coordinator_user_id);
    await A.notify(coord, `${name} ${accept ? 'accepted' : 'declined'} a request`, [`${name} ${accept ? 'is available and accepted' : 'declined'} the request for case ${c.zip || ''}.`, 'Open the coordinator dashboard to take the next step.'], 'Open dashboard');
  },

  // ---- families
  async request_change(user, b) {
    if (user.role !== 'family') throw forbidden();
    const c = await caseById(b.case_id);
    if (c.family_user_id !== user.id) throw notFound();
    const note = clean(b.note, 600);
    await A.addEvent(c.id, 'family_request', 'You asked for a different applicant' + (note ? ': “' + note + '”' : '.') + ' Your coordinator is on it.', { actor: user.id });
    const coord = await A.userById(c.coordinator_user_id);
    await A.notify(coord, `${A.firstName(user.full_name) || 'A family'} asked for a different applicant`, [note ? `Their note: “${note}”` : 'They didn’t add a note.', 'Open the coordinator dashboard to follow up.'], 'Open dashboard');
  },

  // ---- coordinators
  async update_case(user, b) {
    if (user.role !== 'coordinator') throw forbidden();
    const c = await caseById(b.id);
    const patch = { updated_at: now() };
    if ('status' in b) { if (!CASE_STATUS.includes(b.status)) throw badRequest('Unknown status.'); patch.status = b.status; }
    if ('notes' in b) patch.notes = clean(b.notes, 4000);
    if ('zip' in b) patch.zip = clean(String(b.zip || ''), 10);
    if ('help_type' in b) patch.help_type = clean(b.help_type, 60);
    if ('coordinator_user_id' in b) {
      const coord = b.coordinator_user_id ? await A.userById(b.coordinator_user_id) : null;
      if (b.coordinator_user_id && (!coord || coord.role !== 'coordinator')) throw badRequest('Choose a coordinator.');
      patch.coordinator_user_id = coord ? coord.id : null;
    }
    await update('cases', 'id=' + A.eq(c.id), patch);
    if (patch.status && patch.status !== c.status && STATUS_EVENT[patch.status]) await A.addEvent(c.id, 'status', STATUS_EVENT[patch.status], { actor: user.id });
    if ('coordinator_user_id' in patch && patch.coordinator_user_id !== c.coordinator_user_id && patch.coordinator_user_id) {
      const coord = await A.userById(patch.coordinator_user_id);
      await A.addEvent(c.id, 'coordinator', `${A.firstName(coord.full_name) || 'A new coordinator'} is now your dedicated coordinator.`, { actor: user.id });
    }
  },

  async add_applicant(user, b) {
    if (user.role !== 'coordinator') throw forbidden();
    const c = await caseById(b.case_id);
    const app = await A.userById(b.applicant_user_id);
    if (!app || app.role !== 'applicant') throw badRequest('Choose an applicant.');
    const existing = A.first(await db('case_applicants?select=*&case_id=' + A.eq(c.id) + '&applicant_user_id=' + A.eq(app.id)));
    if (existing && existing.status !== 'removed') throw badRequest('This applicant is already on this case.');
    if (existing) await update('case_applicants', 'id=' + A.eq(existing.id), { status: 'proposed', interview_at: null });
    else await insert('case_applicants', { case_id: c.id, applicant_user_id: app.id, status: 'proposed' });
    await A.addEvent(c.id, 'applicant_added', `We’ve shared a new applicant with you: ${sentence(A.shortName(app.full_name) || 'an applicant')} We’re confirming their availability.`, { actor: user.id });
    await A.notify(app, 'New interview request on handmatch', [`A family in ${c.zip || 'your area'} is looking for a ${c.help_type || 'helper'}, and we think you’re a great fit.`, 'Open your account to accept or decline.'], 'See the request');
  },

  async update_link(user, b) {
    if (user.role !== 'coordinator') throw forbidden();
    const link = A.first(await db('case_applicants?select=*&id=' + A.eq(b.id)));
    if (!link) throw notFound();
    const c = await caseById(link.case_id);
    const app = await A.userById(link.applicant_user_id);
    const family = await A.userById(c.family_user_id);
    const patch = {};
    if ('status' in b) { if (!CA_STATUS.includes(b.status)) throw badRequest('Unknown status.'); patch.status = b.status; }
    if ('interview_at' in b) {
      if (!b.interview_at) patch.interview_at = null;
      else { const d = new Date(b.interview_at); if (isNaN(d)) throw badRequest('Enter a valid interview date and time.'); patch.interview_at = d.toISOString(); }
    }
    if (patch.interview_at && !patch.status && ['proposed', 'accepted'].includes(link.status)) patch.status = 'interview';
    await update('case_applicants', 'id=' + A.eq(link.id), patch);
    const name = A.shortName(app && app.full_name) || 'your applicant';
    const sameTime = (x, y) => (x ? new Date(x).getTime() : null) === (y ? new Date(y).getTime() : null);
    if (patch.interview_at && !sameTime(patch.interview_at, link.interview_at)) {
      const when = fmtWhen(patch.interview_at);
      await A.addEvent(c.id, 'interview', `Interview with ${name} set for ${when}.`, { actor: user.id });
      await A.notify(family, `Your interview with ${name} is set`, [`Your interview with ${name} is set for ${when}. Your coordinator will share the details.`]);
      await A.notify(app, 'Your interview is set', [`Your interview with ${A.firstName(family && family.full_name) || 'the family'} in ${c.zip || 'your area'} is set for ${when}.`]);
    }
    if (patch.status === 'hired' && link.status !== 'hired') {
      await A.addEvent(c.id, 'hired', `You hired ${sentence(name)} Congratulations! Your coordinator will check in during the first week.`, { actor: user.id });
      if (c.status !== 'hired') await update('cases', 'id=' + A.eq(c.id), { status: 'hired', updated_at: now() });
    }
    if (patch.status === 'removed' && link.status !== 'removed') {
      await A.addEvent(c.id, 'applicant_removed', `${name} is no longer on this case.`, { actor: user.id, visible: false });
    }
  },

  async add_note(user, b) {
    if (user.role !== 'coordinator') throw forbidden();
    const c = await caseById(b.case_id);
    const body = clean(b.body, 1000);
    if (!body) throw badRequest('Write a note first.');
    await A.addEvent(c.id, 'note', body, { actor: user.id, visible: !!b.visible });
  },

  async update_applicant(user, b) {
    if (user.role !== 'coordinator') throw forbidden();
    const app = await A.userById(b.user_id);
    if (!app || app.role !== 'applicant') throw notFound();
    const up = userPatch(b, { photo: true });
    if ('disabled' in b) up.disabled = !!b.disabled;
    if (Object.keys(up).length) await update('users', 'id=' + A.eq(app.id), up);
    const patch = profilePatch(b);
    if ('status' in b) { if (!PROFILE_STATUS.includes(b.status)) throw badRequest('Unknown status.'); patch.status = b.status; }
    for (const k of ['check_interview', 'check_id', 'check_references']) if (k in b) patch[k] = !!b[k];
    if ('check_background' in b) { if (!BACKGROUND.includes(b.check_background)) throw badRequest('Unknown background check status.'); patch.check_background = b.check_background; }
    if ('coordinator_notes' in b) patch.coordinator_notes = clean(b.coordinator_notes, 4000);
    patch.updated_at = now();
    const current = A.first(await db('applicant_profiles?select=user_id&user_id=' + A.eq(app.id)));
    if (current) await update('applicant_profiles', 'user_id=' + A.eq(app.id), patch);
    else await insert('applicant_profiles', Object.assign({ user_id: app.id }, patch));
  },

  async invite(user, b) {
    if (user.role !== 'coordinator') throw forbidden();
    const email = A.normEmail(b.email);
    if (!isEmail(email)) throw badRequest('Enter a valid email address.');
    const role = b.role;
    if (!['applicant', 'coordinator', 'family'].includes(role)) throw badRequest('Choose a role.');
    let u = await A.userByEmail(email);
    if (u && u.role !== role) throw badRequest(`This email already has a ${u.role} account.`);
    if (!u) u = await insert('users', Object.assign({ email, role }, userPatch(b)));
    if (role === 'applicant' && !A.first(await db('applicant_profiles?select=user_id&user_id=' + A.eq(u.id)))) await insert('applicant_profiles', { user_id: u.id });
    const intro = role === 'applicant' ? 'You’re invited to create your handmatch profile, so families near you can meet you.'
      : role === 'coordinator' ? 'You’ve been added as a handmatch coordinator.' : 'Your handmatch account is ready.';
    await A.sendLoginLink(u, { subject: 'You’re invited to handmatch', intro });
  },

  async create_case(user, b) {
    if (user.role !== 'coordinator') throw forbidden();
    const email = A.normEmail(b.email);
    if (!isEmail(email)) throw badRequest('Enter the family’s email address.');
    let fam = await A.userByEmail(email);
    if (fam && fam.role !== 'family') throw badRequest(`This email already has a ${fam.role} account.`);
    if (!fam) fam = await insert('users', Object.assign({ email, role: 'family' }, userPatch(b)));
    const coord = await A.defaultCoordinator();
    const c = await insert('cases', { family_user_id: fam.id, coordinator_user_id: coord ? coord.id : user.id, status: 'new', zip: clean(String(b.zip || ''), 10), help_type: clean(b.help_type, 60) });
    await A.addEvent(c.id, 'created', 'Welcome to handmatch! Your case is open.', { actor: user.id });
    const coordUser = coord || user;
    await A.addEvent(c.id, 'coordinator', `${A.firstName(coordUser.full_name) || 'Your coordinator'} is your dedicated coordinator and will reach out personally.`, { actor: user.id });
  },

  async sync_orders(user) {
    if (user.role !== 'coordinator') throw forbidden();
    const orders = (await db('orders?select=*&status=eq.paid&order=created_at.desc&limit=200')) || [];
    for (const o of orders) await A.ensureFamilyCase(o);
  }
};

module.exports = handler(async (req, res) => {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Not allowed' });
  if (!hasDb()) throw fail(503, 'The app isn’t connected yet.');
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: 'Please sign in.' });
  const action = query(req).action;
  if (req.method === 'GET') {
    if (action !== 'dashboard') return send(res, 404, { error: 'Not found' });
    return send(res, 200, await dashboard(user));
  }
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  if (!fn) return send(res, 404, { error: 'Not found' });
  await fn(user, await readJson(req));
  const fresh = await A.userById(user.id);
  send(res, 200, await dashboard(fresh));
}, ['GET', 'POST']);
