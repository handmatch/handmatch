// Dashboard data for each view of the web app. Each builder returns only what that role may see.
'use strict';
const { env, db, insert, update, hasEmail } = require('./_lib');
const A = require('./_app');

const ACTIVE_LINK = ['waiting', 'accepted', 'meeting', 'passed', 'check', 'cleared', 'hired'];
const FAMILY_LINK = ['waiting', 'accepted', 'meeting', 'passed', 'check', 'cleared', 'hired', 'ended', 'not_fit'];
const OPEN_CASE = ['open', 'in_progress', 'waiting'];
const OPEN_TICKET = ['ready_review', 'ordered', 'in_progress', 'needs_review'];
const DAY = 864e5;

const q = (path) => db(path).then((r) => r || []);

// ------------------------------------------------------------------ shapes
function publicProfile(u, p) {
  return {
    user_id: u.id, name: A.shortName(u.full_name) || 'Applicant', photo_url: u.photo_url || '',
    role_type: p.role_type, city: p.city, zip: p.zip, rate: p.rate, years: p.years, employment: p.employment,
    languages: p.languages || [], skills: p.skills || [], bio: p.bio, days: p.days || [], hours: p.hours,
    start_in_days: p.start_in_days,
    checks: { interview: !!p.check_interview, id: !!p.check_id, references: !!p.check_references, background: p.check_background }
  };
}
const personCard = (u, title) => (u ? { id: u.id, name: u.full_name || '', first: A.firstName(u.full_name) || '', email: u.email, phone: u.phone, photo_url: u.photo_url || '', title: u.title || title || '' } : null);

function meetingView(m, { staff = false, forApplicant = false } = {}) {
  const started = m.start_at && new Date(m.start_at) <= new Date();
  return {
    id: m.id, link_id: m.placement_applicant_id, placement_id: m.placement_id, kind: m.kind, status: m.status, start_at: m.start_at,
    preferred_times: m.preferred_times, duration_min: m.duration_min,
    join_info: m.status === 'confirmed' || m.status === 'completed' || staff ? m.join_info : '',
    trial_rate: m.trial_rate, trial_hours: m.trial_hours, family_note: forApplicant ? '' : m.family_note,
    applicant_confirmed: !!m.applicant_confirmed, checked_in_at: m.checked_in_at, checked_out_at: m.checked_out_at,
    outcome: m.outcome, outcome_note: staff ? m.outcome_note : forApplicant ? '' : m.outcome_note, outcome_at: m.outcome_at,
    can_outcome: !m.outcome && ['confirmed', 'completed'].includes(m.status) && (started || staff),
    can_check_in: m.kind === 'trial' && m.status === 'confirmed' && !m.checked_in_at && m.start_at && new Date(m.start_at).getTime() - Date.now() < 2 * 3600e3,
    can_check_out: m.kind === 'trial' && !!m.checked_in_at && !m.checked_out_at
  };
}

// ------------------------------------------------------------------ threads
function threadTitle(t, viewer, ctx) {
  const p = ctx.placements[t.placement_id] || {};
  const fam = ctx.users[p.family_user_id] || {};
  const link = ctx.links[t.placement_applicant_id] || {};
  const app = ctx.users[link.applicant_user_id] || {};
  const conc = ctx.users[p.concierge_user_id] || {};
  const c = ctx.cases[t.case_id] || {};
  const staff = A.isStaff(viewer);
  if (t.kind === 'concierge') return staff ? `${fam.full_name || fam.email || 'Family'} · Concierge` : `${A.firstName(conc.full_name) || 'Your Concierge'} · your Concierge`;
  if (t.kind === 'meet') {
    if (staff) return `${A.firstName(fam.full_name) || 'Family'} + ${A.shortName(app.full_name) || 'applicant'}`;
    if (viewer.id === app.id) return `${A.firstName(fam.full_name) || 'The'} family + Concierge`;
    return `${A.shortName(app.full_name) || 'Applicant'} + Concierge`;
  }
  if (t.kind === 'case') return 'Case: ' + (c.subject || 'Support');
  return t.title || 'Messages';
}

async function threadContext(threads) {
  const placements = A.index(await A.byIds('placements', 'id', threads.map((t) => t.placement_id)));
  const links = A.index(await A.byIds('placement_applicants', 'id', threads.map((t) => t.placement_applicant_id)));
  const cases = A.index(await A.byIds('cases', 'id', threads.map((t) => t.case_id)));
  const userIds = [];
  Object.values(placements).forEach((p) => userIds.push(p.family_user_id, p.concierge_user_id));
  Object.values(links).forEach((l) => userIds.push(l.applicant_user_id));
  const users = A.index(await A.byIds('users', 'id', userIds));
  return { placements, links, cases, users };
}

// Threads with titles, last message and unread counts for this viewer.
async function threadList(viewer, threads) {
  if (!threads.length) return [];
  const ids = threads.map((t) => t.id);
  const members = await A.byIds('thread_members', 'thread_id', ids, '&user_id=' + A.eq(viewer.id));
  const mine = A.index(members, 'thread_id');
  const staff = A.isStaff(viewer);
  const msgs = await A.byIds('thread_messages', 'thread_id', ids, '&order=created_at.desc&limit=3000');
  const ctx = await threadContext(threads);
  return threads.map((t) => {
    const list = msgs.filter((m) => m.thread_id === t.id && (staff || !m.internal));
    const last = list[0];
    const read = mine[t.id] ? mine[t.id].last_read_at : null;
    const unread = mine[t.id] ? list.filter((m) => m.user_id !== viewer.id && (!read || m.created_at > read)).length : 0;
    return {
      id: t.id, kind: t.kind, placement_id: t.placement_id, link_id: t.placement_applicant_id, case_id: t.case_id,
      title: threadTitle(t, viewer, ctx), last_at: t.last_message_at || t.created_at, unread,
      preview: last ? (last.internal ? '[Team note] ' : '') + String(last.body).slice(0, 90) : 'No messages yet'
    };
  }).sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
}

async function myThreads(viewer) {
  const mem = await q('thread_members?select=thread_id&user_id=' + A.eq(viewer.id));
  return A.byIds('threads', 'id', mem.map((m) => m.thread_id));
}

// One conversation. Marks it read for the viewer.
async function threadDetail(viewer, id) {
  const t = A.first(await db('threads?select=*&id=' + A.eq(id)));
  if (!t) throw A.notFound();
  const member = A.first(await db('thread_members?select=*&thread_id=' + A.eq(t.id) + '&user_id=' + A.eq(viewer.id)));
  const staffAccess = A.hasRole(viewer, 'concierge');
  if (!member && !staffAccess) throw A.notFound();
  if (!member && staffAccess) await A.addMembers(t.id, [viewer.id]);
  const staff = A.isStaff(viewer);
  const messages = (await q('thread_messages?select=*&thread_id=' + A.eq(t.id) + '&order=created_at.asc&limit=500')).filter((m) => staff || !m.internal);
  const memberRows = await q('thread_members?select=*&thread_id=' + A.eq(t.id));
  const ctx = await threadContext([t]);
  const extra = await A.byIds('users', 'id', memberRows.map((m) => m.user_id).concat(messages.map((m) => m.user_id)));
  extra.forEach((u) => { ctx.users[u.id] = u; });
  const p = ctx.placements[t.placement_id] || {};
  const link = ctx.links[t.placement_applicant_id] || {};
  const hired = ['hired', 'ended'].includes(link.status);
  const label = (u) => {
    if (!u) return 'handmatch';
    if (u.id === viewer.id) return 'You';
    if (u.id === p.concierge_user_id || (A.isStaff(u) && !A.hasRole(u, 'family'))) return (A.firstName(u.full_name) || 'handmatch') + ' · Concierge';
    if (u.id === p.family_user_id) return staff ? u.full_name || 'Family' : (A.firstName(u.full_name) || 'Family') + ' (family)';
    return staff || hired ? u.full_name || 'Applicant' : A.shortName(u.full_name) || 'Applicant';
  };
  await update('thread_members', 'thread_id=' + A.eq(t.id) + '&user_id=' + A.eq(viewer.id), { last_read_at: new Date().toISOString() }).catch(() => {});
  return {
    id: t.id, kind: t.kind, title: threadTitle(t, viewer, ctx), placement_id: t.placement_id, link_id: t.placement_applicant_id, case_id: t.case_id,
    masked: t.kind === 'meet' && !hired,
    can_internal: staff,
    members: memberRows.map((m) => label(ctx.users[m.user_id])),
    messages: messages.map((m) => ({
      id: m.id, at: m.created_at, body: m.body, internal: !!m.internal, system: !!m.system || !m.user_id,
      mine: m.user_id === viewer.id, who: m.system || !m.user_id ? 'handmatch' : label(ctx.users[m.user_id]),
      photo: m.user_id && ctx.users[m.user_id] ? ctx.users[m.user_id].photo_url || '' : ''
    }))
  };
}

// ------------------------------------------------------------------ family
async function familyView(user) {
  const placements = await q('placements?select=*&family_user_id=' + A.eq(user.id) + '&order=created_at.desc');
  const pids = placements.map((p) => p.id);
  const allLinks = await A.byIds('placement_applicants', 'placement_id', pids);
  const links = allLinks.filter((x) => FAMILY_LINK.includes(x.status));
  const users = A.index(await A.byIds('users', 'id', links.map((x) => x.applicant_user_id).concat(placements.map((p) => p.concierge_user_id))));
  const profiles = A.index(await A.byIds('applicant_profiles', 'user_id', links.map((x) => x.applicant_user_id)), 'user_id');
  const events = pids.length ? await q('placement_events?select=*&visible_to_family=eq.true&placement_id=' + A.inList(pids) + '&order=created_at.desc&limit=400') : [];
  const meetings = await A.byIds('meetings', 'placement_id', pids, '&order=created_at.desc');
  const tickets = await A.byIds('compliance_tickets', 'placement_id', pids);
  const orders = A.index(await A.byIds('orders', 'id', placements.map((p) => p.order_id)));
  const refunds = await A.byIds('refunds', 'placement_id', pids, '&order=created_at.desc');
  const cases = await q('cases?select=*&family_user_id=' + A.eq(user.id) + '&order=created_at.desc&limit=100');
  const threadsRaw = await myThreads(user);
  const threads = await threadList(user, threadsRaw);
  const terr = A.index(await A.territories(), 'code');
  return {
    placements: placements.map((p) => {
      const mine = links.filter((x) => x.placement_id === p.id);
      const order = orders[p.order_id] || null;
      const pRefunds = refunds.filter((r) => r.placement_id === p.id);
      return {
        id: p.id, status: p.status, zip: p.zip, help_type: p.help_type, created_at: p.created_at, hired_at: p.hired_at,
        hires_allowed: p.hires_allowed, hired: mine.filter((x) => x.status === 'hired').length,
        fee_model: p.fee_model || 'full', balance_cents: A.balanceCents(),
        order_ref: order ? order.order_ref : '', paid_cents: order ? order.amount_paid_cents || order.amount_cents : null,
        min_wage: (terr[p.territory_code] || {}).min_wage || 0,
        concierge: personCard(users[p.concierge_user_id], 'handmatch Concierge'),
        concierge_thread_id: (threads.find((t) => t.kind === 'concierge' && t.placement_id === p.id) || {}).id || '',
        replacement: A.replacementState(p),
        refund_preview: A.refundEligibility({ order, placement: p, links: allLinks.filter((x) => x.placement_id === p.id), refunds: pRefunds }),
        refunds: pRefunds.map((r) => ({ id: r.id, status: r.status, amount_cents: r.amount_cents, percent: r.percent, created_at: r.created_at, decision_note: r.status === 'denied' ? r.decision_note : '' })),
        applicants: mine.map((x) => {
          const u = users[x.applicant_user_id]; const pr = profiles[x.applicant_user_id];
          if (!u || !pr) return null;
          const hired = ['hired', 'ended'].includes(x.status);
          const ticket = tickets.filter((t) => t.placement_applicant_id === x.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
          return Object.assign(publicProfile(u, pr), {
            link_id: x.id, status: x.status, updated_at: x.updated_at,
            balance_due: x.status === 'cleared' && p.fee_model === 'deposit' && (p.balances_paid || 0) <= mine.filter((y) => y.status === 'hired').length,
            contact: hired ? { name: u.full_name, phone: u.phone, email: u.email } : null,
            check_status: ticket ? ({ ready_review: 'getting_ready', ordered: 'in_progress', in_progress: 'in_progress', needs_review: 'in_progress', clear: 'clear', not_cleared: 'stopped', cancelled: 'cancelled' }[ticket.status]) : '',
            thread_id: (threads.find((t) => t.link_id === x.id) || {}).id || '',
            meetings: meetings.filter((m) => m.placement_applicant_id === x.id).map((m) => meetingView(m))
          });
        }).filter(Boolean),
        cases: cases.filter((c) => c.placement_id === p.id).map((c) => ({ id: c.id, type: c.type, status: c.status, subject: c.subject, created_at: c.created_at, resolution: c.resolution, thread_id: (threads.find((t) => t.case_id === c.id) || {}).id || '' })),
        events: events.filter((e) => e.placement_id === p.id).map((e) => ({ id: e.id, kind: e.kind, body: e.body, created_at: e.created_at }))
      };
    }),
    threads
  };
}

// --------------------------------------------------------------- applicant
async function applicantView(user) {
  let profile = A.first(await db('applicant_profiles?select=*&user_id=' + A.eq(user.id)));
  if (!profile) profile = await insert('applicant_profiles', { user_id: user.id, pipeline_stage: 'lead', source: 'invite' });
  const links = (await q('placement_applicants?select=*&applicant_user_id=' + A.eq(user.id) + '&order=created_at.desc')).filter((x) => x.status !== 'removed');
  const placements = A.index(await A.byIds('placements', 'id', links.map((x) => x.placement_id)));
  const families = A.index(await A.byIds('users', 'id', Object.values(placements).map((p) => p.family_user_id)));
  const requests = A.index(await A.byIds('requests', 'id', Object.values(placements).map((p) => p.request_id)));
  const meetings = await A.byIds('meetings', 'placement_applicant_id', links.map((x) => x.id), '&order=created_at.desc');
  const referrals = await q('referrals?select=*&referrer_user_id=' + A.eq(user.id) + '&order=created_at.desc');
  const cases = await q('cases?select=*&applicant_user_id=' + A.eq(user.id) + '&opened_by=' + A.eq(user.id) + '&order=created_at.desc');
  const threads = await threadList(user, await myThreads(user));
  const { team_notes, recruiter_user_id, referred_by_user_id, source, next_step, last_contacted_at, ...own } = profile;
  const fields = ['zip', 'role_type', 'rate', 'years', 'bio', 'days', 'hours', 'languages', 'skills', 'start_in_days'];
  const filled = fields.filter((k) => (Array.isArray(own[k]) ? own[k].length : own[k] != null && own[k] !== '')).length + (user.full_name ? 1 : 0) + (user.phone ? 1 : 0);
  return {
    profile: own,
    completeness: Math.round(filled / (fields.length + 2) * 100),
    bonus_cents: Number(env('REFERRAL_BONUS_CENTS')) || 5000,
    requests: links.map((x) => {
      const p = placements[x.placement_id] || {}; const f = families[p.family_user_id] || {}; const r = requests[p.request_id] || {};
      const hired = ['hired', 'ended'].includes(x.status);
      return {
        id: x.id, status: x.status, created_at: x.created_at, placement_id: p.id,
        family_first: A.firstName(f.full_name) || 'A family', zip: p.zip || '', help_type: p.help_type || '',
        details: { services: r.services || [], days: r.days || [], frequency: r.frequency || '', budget_per_hour: r.budget_per_hour || null, home_size: r.home_size || '', pets: !!r.pets },
        family_contact: hired ? { name: f.full_name, phone: f.phone, email: f.email } : null,
        thread_id: (threads.find((t) => t.link_id === x.id) || {}).id || '',
        meetings: meetings.filter((m) => m.placement_applicant_id === x.id && m.status !== 'cancelled').map((m) => meetingView(m, { forApplicant: true }))
      };
    }),
    referrals: referrals.map((r) => ({ id: r.id, name: r.name, status: r.status, bonus_cents: r.bonus_cents, created_at: r.created_at })),
    cases: cases.map((c) => ({ id: c.id, type: c.type, status: c.status, subject: c.subject, created_at: c.created_at, thread_id: (threads.find((t) => t.case_id === c.id) || {}).id || '' })),
    threads
  };
}

// --------------------------------------------------------------- concierge
function matchScore(pl, req, prof) {
  let s = 0; const why = [];
  const want = A.roleTypeFrom(pl.help_type);
  if (prof.role_type === want) { s += 40; why.push(A.ROLE_TYPE_LABEL[want]); }
  if (pl.territory_code && prof.territory_code === pl.territory_code) { s += 15; }
  if (pl.zip && prof.zip && pl.zip.slice(0, 3) === prof.zip.slice(0, 3)) { s += 15; why.push('Near ' + pl.zip.slice(0, 3) + 'xx'); }
  const budget = req && Number(req.budget_per_hour);
  if (budget && prof.rate) { if (Number(prof.rate) <= budget) { s += 15; why.push('Within budget'); } else if (Number(prof.rate) <= budget + 3) s += 5; }
  const days = (req && req.days) || [];
  if (days.length && (prof.days || []).length) {
    const hit = days.filter((d) => prof.days.includes(String(d).slice(0, 3))).length;
    s += Math.round(10 * hit / days.length); if (hit) why.push(hit + '/' + days.length + ' days');
  }
  if (prof.start_in_days != null && prof.start_in_days <= 3) { s += 5; why.push('Starts in 3 days'); }
  return { score: s, why };
}

async function conciergeView(user) {
  const placements = await q('placements?select=*&order=created_at.desc&limit=500');
  const pids = placements.map((p) => p.id);
  const links = await A.byIds('placement_applicants', 'placement_id', pids);
  const events = await A.byIds('placement_events', 'placement_id', pids, '&order=created_at.desc');
  const meetings = await A.byIds('meetings', 'placement_id', pids, '&order=created_at.desc');
  const tickets = await A.byIds('compliance_tickets', 'placement_id', pids);
  const users = await q('users?select=*&order=created_at.desc&limit=3000');
  const U = A.index(users);
  const profiles = await q('applicant_profiles?select=*&limit=3000');
  const P = A.index(profiles, 'user_id');
  const orders = A.index(await A.byIds('orders', 'id', placements.map((p) => p.order_id)));
  const requests = A.index(await A.byIds('requests', 'id', placements.map((p) => p.request_id)));
  const refunds = await A.byIds('refunds', 'placement_id', pids, '&order=created_at.desc');
  const cases = await q('cases?select=*&order=created_at.desc&limit=300');
  const supply = await q('supply_requests?select=*&order=created_at.desc&limit=200');
  const threadsRaw = pids.length ? await A.byIds('threads', 'placement_id', pids) : [];
  const caseThreads = await A.byIds('threads', 'case_id', cases.map((c) => c.id));
  const allThreads = [...new Map(threadsRaw.concat(caseThreads).map((t) => [t.id, t])).values()];
  const threads = await threadList(user, allThreads);
  const terr = await A.territories();
  const busy = {};
  links.filter((l) => ['waiting', 'accepted', 'meeting', 'passed', 'check', 'cleared'].includes(l.status)).forEach((l) => { busy[l.applicant_user_id] = (busy[l.applicant_user_id] || 0) + 1; });
  const pool = profiles.filter((p) => p.status === 'active' && U[p.user_id] && !U[p.user_id].disabled);
  const nowMs = Date.now();

  const placementsOut = placements.map((p) => {
    const f = U[p.family_user_id] || {}; const o = orders[p.order_id] || {}; const r = requests[p.request_id];
    const mine = links.filter((x) => x.placement_id === p.id);
    const onIt = new Set(mine.filter((x) => x.status !== 'removed').map((x) => x.applicant_user_id));
    const overdue = p.status === 'new' && !p.first_contact_at && A.addBusinessDays(p.created_at, 1).getTime() < nowMs;
    const suggestions = pool.filter((pr) => !onIt.has(pr.user_id)).map((pr) => Object.assign({ user_id: pr.user_id, name: (U[pr.user_id] || {}).full_name || '', role_type: pr.role_type, zip: pr.zip, rate: pr.rate, busy: busy[pr.user_id] || 0 }, matchScore(p, r, pr)))
      .sort((a, b) => b.score - a.score).slice(0, 8);
    return {
      id: p.id, status: p.status, zip: p.zip, territory_code: p.territory_code, help_type: p.help_type, notes: p.notes, created_at: p.created_at, updated_at: p.updated_at,
      concierge_user_id: p.concierge_user_id || '', hires_allowed: p.hires_allowed, hired_at: p.hired_at, first_contact_at: p.first_contact_at, overdue,
      fee_model: p.fee_model || 'full', balances_paid: p.balances_paid || 0,
      replacements_used: p.replacements_used, replacement: A.replacementState(p),
      family: { id: f.id, name: f.full_name || '', email: f.email || '', phone: f.phone || '' },
      order: { ref: o.order_ref || '', hires: o.hires || null, paid_cents: o.amount_paid_cents || o.amount_cents || null, refunded_cents: o.refunded_cents || 0, status: o.status || '' },
      request: r ? { services: r.services || [], days: r.days || [], frequency: r.frequency, budget_per_hour: r.budget_per_hour, home_size: r.home_size, pets: r.pets, supplies: r.supplies, notes: r.notes } : null,
      refund_preview: A.refundEligibility({ order: orders[p.order_id], placement: p, links: mine, refunds: refunds.filter((x) => x.placement_id === p.id) }),
      applicants: mine.filter((x) => x.status !== 'removed').map((x) => {
        const u = U[x.applicant_user_id] || {}; const pr = P[x.applicant_user_id] || {};
        const t = tickets.filter((k) => k.placement_applicant_id === x.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
        return {
          id: x.id, user_id: x.applicant_user_id, name: u.full_name || '', email: u.email || '', phone: u.phone || '', photo_url: u.photo_url || '',
          role_type: pr.role_type, rate: pr.rate, zip: pr.zip, status: x.status, family_note: x.family_note, ticket_status: t ? t.status : '',
          balance_due: x.status === 'cleared' && p.fee_model === 'deposit' && (p.balances_paid || 0) <= mine.filter((y) => y.status === 'hired').length,
          thread_id: (threads.find((th) => th.link_id === x.id) || {}).id || '',
          meetings: meetings.filter((m) => m.placement_applicant_id === x.id).map((m) => meetingView(m, { staff: true }))
        };
      }),
      suggestions,
      concierge_thread_id: (threads.find((t) => t.kind === 'concierge' && t.placement_id === p.id) || {}).id || '',
      events: events.filter((e) => e.placement_id === p.id).slice(0, 60).map((e) => ({ id: e.id, kind: e.kind, body: e.body, created_at: e.created_at, visible: e.visible_to_family, actor: (U[e.actor_user_id] || {}).full_name || '' }))
    };
  });

  const casesOut = cases.map((c) => {
    const f = U[c.family_user_id] || {}; const a = U[c.applicant_user_id] || {};
    return {
      id: c.id, placement_id: c.placement_id, type: c.type, priority: c.priority, status: c.status, subject: c.subject, description: c.description,
      resolution: c.resolution, created_at: c.created_at, due_at: c.due_at, resolved_at: c.resolved_at, assignee_user_id: c.assignee_user_id || '',
      overdue: OPEN_CASE.includes(c.status) && c.due_at && new Date(c.due_at).getTime() < nowMs,
      family: f.id ? { name: f.full_name, email: f.email, phone: f.phone } : null,
      applicant: a.id ? { name: a.full_name, phone: a.phone } : null,
      opened_by: (U[c.opened_by] || {}).full_name || '',
      thread_id: (threads.find((t) => t.case_id === c.id) || {}).id || ''
    };
  });

  const upcoming = meetings.filter((m) => m.status === 'confirmed' && m.start_at && new Date(m.start_at).getTime() > nowMs - 6 * 3600e3 && new Date(m.start_at).getTime() < nowMs + 7 * DAY);
  const toSchedule = meetings.filter((m) => m.status === 'requested');
  const needOutcome = meetings.filter((m) => !m.outcome && ['confirmed', 'completed'].includes(m.status) && m.start_at && new Date(m.start_at).getTime() < nowMs);
  const mtgOut = (m) => {
    const p = placements.find((x) => x.id === m.placement_id) || {}; const l = links.find((x) => x.id === m.placement_applicant_id) || {};
    return Object.assign(meetingView(m, { staff: true }), { family: (U[p.family_user_id] || {}).full_name || '', applicant: (U[l.applicant_user_id] || {}).full_name || '' });
  };
  const open = placementsOut.filter((p) => p.status !== 'closed');
  return {
    kpis: {
      open: open.length,
      first_call: placementsOut.filter((p) => p.status === 'new').length,
      overdue: placementsOut.filter((p) => p.overdue).length,
      to_schedule: toSchedule.length,
      upcoming: upcoming.length,
      need_outcome: needOutcome.length,
      open_cases: casesOut.filter((c) => OPEN_CASE.includes(c.status)).length,
      unread: threads.reduce((s, t) => s + t.unread, 0)
    },
    placements: placementsOut,
    cases: casesOut,
    agenda: { to_schedule: toSchedule.map(mtgOut), upcoming: upcoming.sort((a, b) => String(a.start_at).localeCompare(String(b.start_at))).map(mtgOut), need_outcome: needOutcome.map(mtgOut) },
    supply: supply.filter((s) => ['open', 'in_progress'].includes(s.status)).map((s) => ({ id: s.id, placement_id: s.placement_id, territory_code: s.territory_code, zip: s.zip, role_type: s.role_type, needed: s.needed, status: s.status, details: s.details, due_at: s.due_at })),
    pool: pool.map((p) => ({ user_id: p.user_id, name: (U[p.user_id] || {}).full_name || '', role_type: p.role_type, territory_code: p.territory_code, zip: p.zip, rate: p.rate, busy: busy[p.user_id] || 0 })),
    concierges: users.filter((u) => A.hasRole(u, 'concierge') && !u.disabled).map((u) => ({ id: u.id, full_name: u.full_name || u.email })),
    territories: terr.map((t) => ({ code: t.code, name: t.name, sellable: t.sellable, min_wage: t.min_wage })),
    threads
  };
}

// --------------------------------------------------------------- recruiter
async function recruiterView() {
  const users = await q('users?select=*&roles=cs.{applicant}&order=created_at.desc&limit=3000');
  const profiles = A.index(await q('applicant_profiles?select=*&limit=3000'), 'user_id');
  const staff = await A.staffUsers();
  const S = A.index(staff);
  const events = await q('pipeline_events?select=*&order=created_at.desc&limit=3000');
  const supply = await q('supply_requests?select=*&order=created_at.desc&limit=300');
  const referrals = await q('referrals?select=*&order=created_at.desc&limit=500');
  const placements = await q('placements?select=id,status,territory_code,help_type,zip&status=in.(new,contacted,matching,replacement)&limit=1000');
  const helpers = await q('helpers?select=id,email,full_name,created_at&order=created_at.desc&limit=1000');
  const known = new Set(users.map((u) => u.email));
  const terr = await A.territories();
  const nowMs = Date.now();
  const applicants = users.map((u) => {
    const p = profiles[u.id] || {};
    const stale = p.status === 'active' && nowMs - new Date(p.availability_updated_at || p.updated_at || u.created_at).getTime() > 30 * DAY;
    return {
      user_id: u.id, full_name: u.full_name, email: u.email, phone: u.phone, photo_url: u.photo_url, disabled: u.disabled, last_login_at: u.last_login_at, created_at: u.created_at,
      role_type: p.role_type || 'housekeeper', city: p.city || '', zip: p.zip || '', territory_code: p.territory_code || '', rate: p.rate, years: p.years,
      languages: p.languages || [], skills: p.skills || [], days: p.days || [], hours: p.hours || '', bio: p.bio || '', start_in_days: p.start_in_days,
      status: p.status || 'draft', pipeline_stage: p.pipeline_stage || 'lead', source: p.source || '', recruiter_user_id: p.recruiter_user_id || '',
      recruiter: (S[p.recruiter_user_id] || {}).full_name || '', referred_by: p.referred_by_user_id ? ((users.find((x) => x.id === p.referred_by_user_id) || {}).full_name || '') : '',
      screening_at: p.screening_at, next_step: p.next_step || '', last_contacted_at: p.last_contacted_at,
      background_consent: !!p.background_consent, check_interview: !!p.check_interview, check_id: !!p.check_id, check_references: !!p.check_references, check_background: p.check_background || 'not_started',
      team_notes: p.team_notes || '', stale, availability_updated_at: p.availability_updated_at,
      events: events.filter((e) => e.applicant_user_id === u.id).slice(0, 30).map((e) => ({ id: e.id, kind: e.kind, body: e.body, created_at: e.created_at, actor: (S[e.actor_user_id] || {}).full_name || '' }))
    };
  });
  const board = [];
  for (const t of terr) {
    for (const rt of A.ROLE_TYPES) {
      const mine = applicants.filter((a) => a.territory_code === t.code && a.role_type === rt);
      const demand = placements.filter((p) => p.territory_code === t.code && A.roleTypeFrom(p.help_type) === rt).length;
      const active = mine.filter((a) => a.status === 'active').length;
      board.push({
        territory: t.code, role_type: rt, active, pipeline: mine.filter((a) => !['active', 'paused', 'rejected'].includes(a.pipeline_stage)).length,
        demand, target: Math.max(3, demand * 3), gap: Math.max(0, Math.max(3, demand * 3) - active),
        open_requests: supply.filter((s) => s.territory_code === t.code && s.role_type === rt && ['open', 'in_progress'].includes(s.status)).length
      });
    }
  }
  const stages = ['lead', 'contacted', 'screening', 'interviewed', 'checks', 'active', 'paused', 'rejected'];
  return {
    kpis: {
      leads: applicants.filter((a) => ['lead', 'contacted'].includes(a.pipeline_stage)).length,
      screening: applicants.filter((a) => ['screening', 'interviewed', 'checks'].includes(a.pipeline_stage)).length,
      active: applicants.filter((a) => a.status === 'active').length,
      open_requests: supply.filter((s) => ['open', 'in_progress'].includes(s.status)).length,
      stale: applicants.filter((a) => a.stale).length,
      new_applications: helpers.filter((h) => !known.has(String(h.email || '').toLowerCase())).length
    },
    stage_counts: Object.fromEntries(stages.map((s) => [s, applicants.filter((a) => a.pipeline_stage === s).length])),
    applicants,
    board,
    supply: supply.map((s) => ({ id: s.id, placement_id: s.placement_id, territory_code: s.territory_code, zip: s.zip, role_type: s.role_type, needed: s.needed, rate_max: s.rate_max, details: s.details, due_at: s.due_at, status: s.status, created_at: s.created_at, assignee_user_id: s.assignee_user_id || '', assignee: (S[s.assignee_user_id] || {}).full_name || '', created_by: (S[s.created_by] || {}).full_name || 'Automatic' })),
    referrals: referrals.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, role_type: r.role_type, status: r.status, bonus_cents: r.bonus_cents, created_at: r.created_at, notes: r.notes, referrer: (users.find((u) => u.id === r.referrer_user_id) || {}).full_name || '', lead_user_id: r.lead_user_id || '' })),
    recruiters: staff.filter((u) => A.hasRole(u, 'recruiter')).map((u) => ({ id: u.id, full_name: u.full_name || u.email })),
    territories: terr.map((t) => ({ code: t.code, name: t.name, sellable: t.sellable }))
  };
}

// ----------------------------------------------------------------- finance
async function financeView() {
  const orders = await q('orders?select=*&order=created_at.desc&limit=1000');
  const placements = await A.byIds('placements', 'order_id', orders.map((o) => o.id));
  const PL = A.index(placements, 'order_id');
  const links = await A.byIds('placement_applicants', 'placement_id', placements.map((p) => p.id));
  const refunds = await q('refunds?select=*&order=created_at.desc&limit=1000');
  const users = A.index(await A.byIds('users', 'id', refunds.map((r) => r.family_user_id).concat(refunds.map((r) => r.decided_by))));
  const referrals = await q('referrals?select=*&status=in.(hired,bonus_paid)&order=updated_at.desc&limit=300');
  const refUsers = A.index(await A.byIds('users', 'id', referrals.map((r) => r.referrer_user_id)));
  const O = A.index(orders);
  const paid = orders.filter((o) => o.status === 'paid' || o.status === 'refunded');
  const month = new Date().toISOString().slice(0, 7);
  const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const refunded = refunds.filter((r) => r.status === 'refunded');
  // A/B test results (only where the test runs)
  let ab = null;
  if (A.abOn()) {
    try {
      const visits = await q('ab_visits?select=variant,forced&limit=100000');
      const reqs = await q('requests?select=variant&variant=not.is.null&limit=100000');
      const paidOrders = orders.filter((o) => o.status === 'paid' || o.status === 'refunded');
      const side = (v) => {
        const vis = visits.filter((x) => x.variant === v && !x.forced).length;
        const starts = paidOrders.filter((o) => o.variant === v && o.fee_type !== 'balance');
        const balances = paidOrders.filter((o) => o.variant === v && o.fee_type === 'balance');
        const revenue = starts.concat(balances).reduce((t, o) => t + (Number(o.amount_paid_cents || o.amount_cents) || 0), 0)
          - refunds.filter((r) => r.status === 'refunded' && starts.concat(balances).some((o) => o.id === r.order_id)).reduce((t, r) => t + r.amount_cents, 0);
        const ids = new Set(starts.map((o) => o.id));
        const hiredPl = placements.filter((p) => ids.has(p.order_id) && p.hired_at).length;
        return { visitors: vis, preferences: reqs.filter((r) => r.variant === v).length, paid_starts: starts.length, balances: balances.length, hires: hiredPl, revenue_cents: revenue,
          revenue_per_100_cents: vis ? Math.round(revenue / vis * 100) : 0, start_rate: vis ? starts.length / vis : 0, hire_rate: starts.length ? hiredPl / starts.length : 0 };
      };
      ab = { A: side('A'), B: side('B'), deposit_cents: A.depositCents(), balance_cents: A.balanceCents() };
    } catch (e) { ab = { error: 'Run supabase/ab-test.sql in this database to see results.' }; }
  }
  return {
    ab,
    stripe: !!env('STRIPE_SECRET_KEY'),
    kpis: {
      gross_cents: sum(paid, (o) => o.amount_paid_cents || o.amount_cents),
      month_cents: sum(paid.filter((o) => String(o.paid_at || o.created_at).slice(0, 7) === month), (o) => o.amount_paid_cents || o.amount_cents),
      refunded_cents: sum(refunded, (r) => r.amount_cents),
      net_cents: sum(paid, (o) => o.amount_paid_cents || o.amount_cents) - sum(refunded, (r) => r.amount_cents),
      paid_orders: paid.length,
      hires: sum(paid, (o) => o.hires),
      pending_refunds: refunds.filter((r) => ['requested', 'approved'].includes(r.status)).length,
      bonuses_due_cents: sum(referrals.filter((r) => r.status === 'hired'), (r) => r.bonus_cents)
    },
    orders: orders.map((o) => {
      const p = PL[o.id];
      return { fee_type: o.fee_type || 'full', variant: o.variant || '', id: o.id, ref: o.order_ref, name: o.full_name, email: o.email, phone: o.phone, hires: o.hires, amount_cents: o.amount_cents, paid_cents: o.amount_paid_cents, refunded_cents: o.refunded_cents || 0, status: o.status, created_at: o.created_at, paid_at: o.paid_at, placement_status: p ? p.status : '', placement_id: p ? p.id : '' };
    }),
    refunds: refunds.map((r) => {
      const o = O[r.order_id] || {}; const p = placements.find((x) => x.id === r.placement_id);
      const live = ['requested', 'approved'].includes(r.status) && p ? A.refundEligibility({ order: o, placement: p, links: links.filter((l) => l.placement_id === p.id), refunds: refunds.filter((x) => x.order_id === r.order_id && x.id !== r.id) }) : r.eligibility;
      return { id: r.id, status: r.status, reason: r.reason, percent: r.percent, amount_cents: r.amount_cents, created_at: r.created_at, decided_at: r.decided_at, refunded_at: r.refunded_at, decision_note: r.decision_note, stripe_refund_id: r.stripe_refund_id,
        order_ref: o.order_ref || '', paid_cents: o.amount_paid_cents || o.amount_cents || 0, family: (users[r.family_user_id] || {}).full_name || o.full_name || '', email: (users[r.family_user_id] || {}).email || o.email || '',
        decided_by: (users[r.decided_by] || {}).full_name || '', eligibility: live || {}, placement_status: p ? p.status : '' };
    }),
    bonuses: referrals.map((r) => ({ id: r.id, name: r.name, status: r.status, bonus_cents: r.bonus_cents, paid_at: r.paid_at, referrer: (refUsers[r.referrer_user_id] || {}).full_name || '', referrer_phone: (refUsers[r.referrer_user_id] || {}).phone || '' }))
  };
}

// -------------------------------------------------------------- compliance
async function complianceView() {
  const terr = await A.territories();
  const licences = await q('licenses?select=*&order=created_at.desc');
  const tickets = await q('compliance_tickets?select=*&order=created_at.desc&limit=500');
  const checks = await q('background_checks?select=*&order=created_at.desc&limit=1000');
  const users = A.index(await A.byIds('users', 'id', tickets.map((t) => t.applicant_user_id).concat(checks.map((c) => c.applicant_user_id))));
  const profiles = A.index(await A.byIds('applicant_profiles', 'user_id', tickets.map((t) => t.applicant_user_id)), 'user_id');
  const placements = A.index(await A.byIds('placements', 'id', tickets.map((t) => t.placement_id)));
  const nowMs = Date.now();
  const reusable = (uid) => checks.find((c) => c.applicant_user_id === uid && c.status === 'clear' && c.expires_at && new Date(c.expires_at).getTime() > nowMs);
  return {
    kpis: {
      to_review: tickets.filter((t) => t.status === 'ready_review').length,
      in_progress: tickets.filter((t) => ['ordered', 'in_progress'].includes(t.status)).length,
      needs_review: tickets.filter((t) => t.status === 'needs_review').length,
      overdue: tickets.filter((t) => t.status === 'ready_review' && t.due_at && new Date(t.due_at).getTime() < nowMs).length,
      licence_alerts: terr.reduce((s, t) => s + A.licenceState(t, licences).warnings.length, 0),
      checks_spend_cents: checks.filter((c) => c.status !== 'cancelled').reduce((s, c) => s + (c.cost_cents || 0), 0)
    },
    territories: terr.map((t) => Object.assign({}, t, A.licenceState(t, licences), { licences: licences.filter((l) => l.territory_code === t.code) })),
    tickets: tickets.map((t) => {
      const u = users[t.applicant_user_id] || {}; const p = profiles[t.applicant_user_id] || {}; const pl = placements[t.placement_id] || {};
      const reuse = reusable(t.applicant_user_id);
      const check = checks.find((c) => c.id === t.background_check_id);
      const ter = terr.find((x) => x.code === pl.territory_code);
      return {
        id: t.id, status: t.status, created_at: t.created_at, due_at: t.due_at, closed_at: t.closed_at, notes: t.notes, adverse_notice_at: t.adverse_notice_at,
        overdue: t.status === 'ready_review' && t.due_at && new Date(t.due_at).getTime() < nowMs,
        checklist: Object.assign({ consent: !!p.background_consent, identity: !!p.check_id, references: !!p.check_references, interview: !!p.check_interview }, t.checklist || {}),
        applicant: { id: u.id, name: u.full_name, email: u.email, phone: u.phone, role_type: p.role_type, zip: p.zip, territory_code: p.territory_code },
        placement: { id: pl.id, zip: pl.zip, territory_code: pl.territory_code, territory_sellable: !!(ter && ter.sellable) },
        reusable: reuse ? { id: reuse.id, provider: reuse.provider, completed_at: reuse.completed_at, expires_at: reuse.expires_at } : null,
        check: check ? { id: check.id, provider: check.provider, package: check.package, external_ref: check.external_ref, cost_cents: check.cost_cents, status: check.status, ordered_at: check.ordered_at, completed_at: check.completed_at } : null,
        adverse_ready_at: t.adverse_notice_at ? A.addBusinessDays(t.adverse_notice_at, 5).toISOString() : null
      };
    }),
    checks: checks.map((c) => {
      const u = users[c.applicant_user_id] || {};
      const exp = c.expires_at ? new Date(c.expires_at).getTime() : 0;
      return { id: c.id, applicant: u.full_name || '', status: c.status, provider: c.provider, package: c.package, external_ref: c.external_ref, cost_cents: c.cost_cents, ordered_at: c.ordered_at, completed_at: c.completed_at, expires_at: c.expires_at, expiring: c.status === 'clear' && exp && exp - nowMs < 30 * DAY };
    })
  };
}

// ------------------------------------------------------------------- admin
async function adminView() {
  const users = await q('users?select=id,email,roles,full_name,phone,title,disabled,last_login_at,created_at&order=created_at.asc&limit=5000');
  const log = await q('audit_log?select=*&order=created_at.desc&limit=300');
  const U = A.index(users);
  const count = (r) => users.filter((u) => (u.roles || []).includes(r)).length;
  return {
    team: users.filter((u) => A.isStaff(u)).map((u) => ({ id: u.id, email: u.email, full_name: u.full_name, title: u.title, roles: u.roles, disabled: u.disabled, last_login_at: u.last_login_at })),
    counts: Object.fromEntries(A.ROLES.map((r) => [r, count(r)])),
    settings: [
      ['Sign-in emails (Resend)', hasEmail()],
      ['Payments (Stripe)', !!env('STRIPE_SECRET_KEY')],
      ['Stripe webhook secret', !!env('STRIPE_WEBHOOK_SECRET')],
      ['Session secret', env('SESSION_SECRET').length >= 16],
      ['Paid orders open placements (APP_ENABLED=1)', env('APP_ENABLED') === '1'],
      ['Admin emails', A.adminEmails().length > 0],
      ['Google Sheets copy', !!env('SHEETS_WEBHOOK_URL')]
    ].map(([label, ok]) => ({ label, ok })),
    environment: process.env.VERCEL_ENV || 'local',
    audit: log.map((l) => ({ id: l.id, at: l.created_at, actor: (U[l.actor_user_id] || {}).full_name || (U[l.actor_user_id] || {}).email || 'System', action: l.action, entity: l.entity, entity_id: l.entity_id, detail: l.detail }))
  };
}

async function auditView() {
  const log = await q('audit_log?select=*&order=created_at.desc&limit=300');
  const U = A.index(await A.byIds('users', 'id', log.map((l) => l.actor_user_id)));
  return log.map((l) => ({ id: l.id, at: l.created_at, actor: (U[l.actor_user_id] || {}).full_name || (U[l.actor_user_id] || {}).email || 'System', action: l.action, entity: l.entity, entity_id: l.entity_id, detail: l.detail }));
}

// ----------------------------------------------------------------- dispatch
const BUILDERS = { family: familyView, applicant: applicantView, concierge: conciergeView, recruiter: recruiterView, finance: financeView, compliance: complianceView, admin: adminView };

async function dashboard(user, view) {
  const allowed = A.views(user);
  const v = allowed.includes(view) ? view : allowed[0];
  const me = { id: user.id, email: user.email, roles: A.rolesOf(user), views: allowed, full_name: user.full_name, phone: user.phone, photo_url: user.photo_url, title: user.title || '' };
  if (!v) return { me, view: '', data: {} };
  const data = await BUILDERS[v](user);
  if (v === 'compliance') data.audit = await auditView();
  return { me, view: v, data };
}

module.exports = { dashboard, threadDetail, OPEN_TICKET, OPEN_CASE, ACTIVE_LINK };
