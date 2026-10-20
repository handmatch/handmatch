// Actions for the handmatch Concierge (demand side) and Compliance.
'use strict';
const { db, insert, update, clean, isEmail, badRequest } = require('./_lib');
const A = require('./_app');
const R = require('./_rules');
const { openCase } = require('./_act_people');

const PLACEMENT_STATUS = ['new', 'contacted', 'matching', 'meeting', 'checks', 'hired', 'replacement', 'closed'];
const STATUS_EVENT = {
  contacted: 'Your Concierge has spoken with you and is finding your applicants.',
  matching: 'Your Concierge is matching you with applicants.',
  replacement: 'We’re finding you a replacement, at no extra charge.',
  closed: 'Your placement is complete. We’re always here if you need us.'
};
const CASE_STATUS = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
const PRIORITIES = ['urgent', 'high', 'normal'];
const KIND_LABEL = { phone: 'phone call', video: 'video interview', trial: 'paid trial' };

async function ticketById(id) {
  const t = A.first(await db('compliance_tickets?select=*&id=' + A.eq(R.id(id, 'ticket'))));
  if (!t) throw A.notFound();
  return t;
}

// Background check is clear: the family can hire.
async function ticketClear(user, t, checkId, how) {
  await update('compliance_tickets', 'id=' + A.eq(t.id), { status: 'clear', closed_at: A.now(), updated_at: A.now(), background_check_id: checkId || t.background_check_id });
  await update('applicant_profiles', 'user_id=' + A.eq(t.applicant_user_id), { check_background: 'clear', updated_at: A.now() });
  const link = await A.linkById(t.placement_applicant_id);
  const p = await A.placementById(t.placement_id);
  const app = await A.userById(t.applicant_user_id);
  if (['passed', 'check'].includes(link.status)) {
    await R.setLink(link, 'cleared');
    const name = A.shortName(app && app.full_name) || 'Your applicant';
    await A.addEvent(p.id, 'cleared', `${name}’s background check is clear. You can hire whenever you’re ready.`, { actor: user.id });
    await R.systemNote(p, link, 'The background check is clear. The family can now confirm the hire.');
    await A.notify(await A.userById(p.family_user_id), `${name} is cleared to hire`, [`${name}’s background check came back clear.`, 'Open your account to confirm the hire.'], 'Confirm the hire');
    await A.notify(await A.userById(p.concierge_user_id), `Cleared: ${app ? app.full_name : 'applicant'}`, ['The background check is clear (' + how + '). The family can hire now.'], 'Open dashboard', 'concierge');
  }
  await A.notify(app, 'Your background check is clear', ['Your background check came back clear. The family can now confirm your hire.']);
}

const ACTIONS = {
  // ------------------------------------------------------------- Concierge
  async update_placement(user, b) {
    A.need(user, 'concierge');
    const p = await A.placementById(R.id(b.id, 'placement'));
    const patch = { updated_at: A.now() };
    if ('status' in b) patch.status = R.oneOf(b.status, PLACEMENT_STATUS, 'Unknown status.');
    if ('notes' in b) patch.notes = clean(b.notes, 4000);
    if ('zip' in b) {
      const z = clean(String(b.zip || ''), 10);
      if (z && !/^\d{5}$/.test(z)) throw badRequest('Enter a 5-digit ZIP code.');
      patch.zip = z;
      const t = A.territoryFor(z, await A.territories());
      patch.territory_code = t ? t.code : '';
    }
    if ('help_type' in b) patch.help_type = clean(b.help_type, 60);
    if ('hires_allowed' in b) patch.hires_allowed = R.num(b.hires_allowed, 1, 5, 'Hires must be between 1 and 5.', true) || 1;
    if ('concierge_user_id' in b && b.concierge_user_id !== (p.concierge_user_id || '')) {
      const c = b.concierge_user_id ? await A.userById(b.concierge_user_id) : null;
      if (!c || !A.hasRole(c, 'concierge')) throw badRequest('Choose a Concierge.');
      patch.concierge_user_id = c.id;
    }
    if (patch.status === 'contacted' && !p.first_contact_at) patch.first_contact_at = A.now();
    if (patch.status === 'closed' && p.status !== 'closed') patch.closed_at = A.now();
    await update('placements', 'id=' + A.eq(p.id), patch);
    if (patch.status && patch.status !== p.status && STATUS_EVENT[patch.status]) await A.addEvent(p.id, 'status', STATUS_EVENT[patch.status], { actor: user.id });
    if (patch.concierge_user_id) {
      const c = await A.userById(patch.concierge_user_id);
      await A.addEvent(p.id, 'concierge', `${A.firstName(c.full_name) || 'A new Concierge'} is now your handmatch Concierge.`, { actor: user.id });
      const threads = (await db('threads?select=id&placement_id=' + A.eq(p.id))) || [];
      for (const t of threads) await A.addMembers(t.id, [c.id]);
      await A.notify(c, 'You’ve been assigned a placement', ['You’re now the Concierge for a placement near ' + (patch.zip || p.zip || 'their ZIP') + '.'], 'Open dashboard', 'concierge');
    }
  },

  async log_call(user, b) {
    A.need(user, 'concierge');
    const p = await A.placementById(R.id(b.placement_id, 'placement'));
    await R.claim(p, user);
    const note = clean(b.note, 1000);
    await A.addEvent(p.id, 'call', 'Call with family' + (note ? ': ' + note : '.'), { actor: user.id, visible: false });
    await R.advance(p, 'contacted');
  },

  async add_applicant(user, b) {
    A.need(user, 'concierge');
    const p = await A.placementById(R.id(b.placement_id, 'placement'));
    await R.claim(p, user);
    if (p.status === 'closed') throw badRequest('This placement is closed.');
    const app = await A.userById(R.id(b.applicant_user_id, 'applicant'));
    if (!app || !A.hasRole(app, 'applicant') || app.disabled) throw badRequest('Choose an applicant.');
    const prof = A.first(await db('applicant_profiles?select=*&user_id=' + A.eq(app.id)));
    if (!prof || prof.status !== 'active') throw badRequest('Only active applicants (vetted by a Recruiter) can be shared with families.');
    const existing = A.first(await db('placement_applicants?select=*&placement_id=' + A.eq(p.id) + '&applicant_user_id=' + A.eq(app.id)));
    if (existing && !['removed', 'declined', 'not_selected', 'not_fit'].includes(existing.status)) throw badRequest('This applicant is already on this placement.');
    if (existing) await R.setLink(existing, 'waiting', { family_note: '' });
    else await insert('placement_applicants', { placement_id: p.id, applicant_user_id: app.id, status: 'waiting' });
    await R.advance(p, 'matching');
    await A.addEvent(p.id, 'applicant_added', `We’ve shared a new applicant with you: ${A.sentence(A.shortName(app.full_name) || 'an applicant')} We’re confirming their availability.`, { actor: user.id });
    await A.notify(app, 'New request from a family on handmatch', [`A family near ${p.zip || 'you'} is looking for a ${p.help_type || 'helper'}, and we think you’re a great fit.`, 'Open your account to accept or decline.'], 'See the request');
  },

  async update_link(user, b) {
    A.need(user, 'concierge');
    const link = await A.linkById(R.id(b.id, 'applicant'));
    const status = R.oneOf(b.status, ['waiting', 'accepted', 'declined', 'not_selected', 'removed'], 'Unknown status.');
    if (['hired', 'ended'].includes(link.status)) throw badRequest('Use Start replacement to end a hire.');
    await R.setLink(link, status);
    const p = await A.placementById(link.placement_id);
    const app = await A.userById(link.applicant_user_id);
    if (status === 'removed' || status === 'not_selected') {
      for (const m of ((await db('meetings?select=id&placement_applicant_id=' + A.eq(link.id) + '&status=in.(requested,confirmed)')) || [])) await update('meetings', 'id=' + A.eq(m.id), { status: 'cancelled', updated_at: A.now() });
      await A.addEvent(p.id, 'applicant_removed', `${A.shortName(app && app.full_name) || 'An applicant'} is no longer on this placement.`, { actor: user.id, visible: false });
    }
    if (status === 'accepted' && link.status === 'waiting') {
      const t = await A.meetThread(p, link);
      await A.postMessage(t.id, null, `${A.shortName(app && app.full_name)} is available (confirmed by your Concierge). Book a call, video interview or paid trial.`, { system: true });
      await A.addEvent(p.id, 'applicant_accepted', `${A.shortName(app && app.full_name)} is available. Book a phone call, video interview or paid trial.`, { actor: user.id });
    }
  },

  // Create or confirm a meeting with an exact time.
  async schedule_meeting(user, b) {
    A.need(user, 'concierge');
    let m = b.meeting_id ? A.first(await db('meetings?select=*&id=' + A.eq(R.id(b.meeting_id, 'meeting')))) : null;
    const link = await A.linkById(m ? m.placement_applicant_id : R.id(b.link_id, 'applicant'));
    const p = await A.placementById(link.placement_id);
    await R.claim(p, user);
    if (!['accepted', 'meeting', 'passed', 'check', 'cleared'].includes(link.status) && !m) throw badRequest('The applicant must accept the request first.');
    const kind = R.oneOf(b.kind || (m && m.kind), ['phone', 'video', 'trial'], 'Choose a phone call, video interview or paid trial.');
    const start = R.isoOrNull(b.start_at, 'Enter the date and time.');
    if (!start) throw badRequest('Enter the date and time.');
    const patch = {
      kind, start_at: start, status: 'confirmed', join_info: clean(b.join_info, 500), applicant_confirmed: false, updated_at: A.now(),
      duration_min: R.num(b.duration_min, 10, 600, 'Duration must be 10 to 600 minutes.', true) || (kind === 'phone' ? 20 : 30)
    };
    if (kind === 'trial') {
      const terr = (await A.territories()).find((t) => t.code === p.territory_code);
      const min = terr ? Number(terr.min_wage) || 0 : 0;
      patch.trial_hours = R.num(b.trial_hours != null ? b.trial_hours : m && m.trial_hours, 2, 8, 'A paid trial is between 2 and 8 hours.');
      patch.trial_rate = R.num(b.trial_rate != null ? b.trial_rate : m && m.trial_rate, 0, 200, 'Enter the trial rate.');
      if (!patch.trial_hours || !patch.trial_rate || patch.trial_rate < min) throw badRequest(`Paid trials need at least 2 hours at or above the minimum wage${min ? ' ($' + min.toFixed(2) + '/hr)' : ''}.`);
      patch.duration_min = Math.round(patch.trial_hours * 60);
    }
    const resched = m && m.status === 'confirmed' && m.start_at && new Date(m.start_at).getTime() !== new Date(start).getTime();
    if (m) m = await update('meetings', 'id=' + A.eq(m.id), patch);
    else m = await insert('meetings', Object.assign({ placement_id: p.id, placement_applicant_id: link.id, requested_by: user.id }, patch));
    if (link.status === 'accepted') await R.setLink(link, 'meeting');
    await R.advance(p, 'meeting');
    const app = await A.userById(link.applicant_user_id);
    const fam = await A.userById(p.family_user_id);
    const when = A.fmtWhen(start);
    const label = KIND_LABEL[kind];
    const name = A.shortName(app && app.full_name) || 'your applicant';
    await A.addEvent(p.id, 'meeting_confirmed', `${label[0].toUpperCase() + label.slice(1)} with ${name} ${resched ? 'moved to' : 'set for'} ${when}.`, { actor: user.id });
    await R.systemNote(p, link, `${label[0].toUpperCase() + label.slice(1)} ${resched ? 'moved to' : 'confirmed for'} ${when}.${patch.join_info ? ' How to join: ' + patch.join_info : ''}${kind === 'trial' ? ` Paid trial: ${patch.trial_hours} hours at $${patch.trial_rate}/hr, paid directly by the family. An adult must be home throughout.` : ''}`);
    await A.notify(fam, `Your ${label} with ${name} is ${resched ? 'moved' : 'set'}`, [`${when}.`, patch.join_info ? 'How to join: ' + patch.join_info : '']);
    await A.notify(app, `Your ${label} is ${resched ? 'moved' : 'set'}`, [`With ${A.firstName(fam && fam.full_name) || 'the family'} near ${p.zip || 'you'}, ${when}.`, patch.join_info ? 'How to join: ' + patch.join_info : '', 'Please open your account and confirm you’ll be there.'], 'Confirm');
  },

  async add_note(user, b) {
    A.need(user, 'concierge');
    const p = await A.placementById(R.id(b.placement_id, 'placement'));
    await R.claim(p, user);
    const body = clean(b.body, 1000);
    if (!body) throw badRequest('Write a note first.');
    await A.addEvent(p.id, 'note', body, { actor: user.id, visible: !!b.visible });
  },

  async create_placement(user, b) {
    A.need(user, 'concierge');
    const email = A.normEmail(b.email);
    if (!isEmail(email)) throw badRequest('Enter the family’s email address.');
    let fam = await A.userByEmail(email);
    if (fam && A.hasRole(fam, 'applicant') && !A.hasRole(fam, 'family')) throw badRequest('This email belongs to an applicant account.');
    if (!fam) fam = await insert('users', Object.assign({ email, roles: ['family'] }, R.userPatch(b)));
    else fam = await A.addRoles(fam, ['family']);
    const zip = clean(String(b.zip || ''), 10);
    if (zip && !/^\d{5}$/.test(zip)) throw badRequest('Enter a 5-digit ZIP code.');
    const terr = A.territoryFor(zip, await A.territories());
    if (zip && (!terr || !terr.sellable)) throw badRequest('This ZIP code isn’t in a territory we can sell in yet. Ask Compliance.');
    const p = await insert('placements', {
      family_user_id: fam.id, concierge_user_id: user.id, status: 'new', zip, territory_code: terr ? terr.code : '',
      help_type: clean(b.help_type, 60), hires_allowed: R.num(b.hires, 1, 5, 'Hires must be between 1 and 5.', true) || 1
    });
    await A.addEvent(p.id, 'created', 'Welcome to handmatch! Your placement is open.', { actor: user.id });
    await A.addEvent(p.id, 'concierge', `${A.firstName(user.full_name) || 'Your Concierge'} is your handmatch Concierge and will reach out personally.`, { actor: user.id });
    const t = await A.conciergeThread(p);
    await A.postMessage(t.id, user.id, `Hi ${A.firstName(fam.full_name) || 'there'}, I’m ${A.firstName(user.full_name) || 'your Concierge'}, your handmatch Concierge. You can message me here any time.`);
    await A.supplyCheck(p, user.id).catch(() => {});
    if (b.invite) await A.sendLoginLink(fam, { subject: 'Your handmatch account is ready', intro: 'Your handmatch account is ready. Sign in to meet your applicants and chat with your Concierge.' });
    return { placement_id: p.id };
  },

  async sync_orders(user) {
    A.need(user, 'concierge', 'finance');
    const orders = (await db('orders?select=*&status=eq.paid&order=created_at.desc&limit=300')) || [];
    let n = 0;
    for (const o of orders) { const had = A.first(await db('placements?select=id&order_id=' + A.eq(o.id))); await A.ensureFamilyPlacement(o); if (!had) n++; }
    return { created: n };
  },

  async invite_family(user, b) {
    A.need(user, 'concierge');
    const p = await A.placementById(R.id(b.placement_id, 'placement'));
    const fam = await A.userById(p.family_user_id);
    await A.sendLoginLink(fam, { subject: 'Your handmatch account', intro: 'Sign in to see your applicants, book meetings and chat with your Concierge.' });
  },

  async start_replacement(user, b) {
    A.need(user, 'concierge');
    const link = await A.linkById(R.id(b.link_id, 'hire'));
    if (link.status !== 'hired') throw badRequest('Choose the person being replaced.');
    const p = await A.placementById(link.placement_id);
    const rs = A.replacementState(p);
    if (!rs.eligible && !b.override) throw badRequest(rs.reason + ' (Admins can override.)');
    if (b.override) A.need(user, 'admin');
    await R.setLink(link, 'ended');
    await update('placements', 'id=' + A.eq(p.id), { status: 'replacement', replacements_used: (p.replacements_used || 0) + 1, updated_at: A.now() });
    const app = await A.userById(link.applicant_user_id);
    await A.addEvent(p.id, 'replacement', `We’re finding you a replacement for ${A.shortName(app && app.full_name) || 'your helper'}, at no extra charge (${(p.replacements_used || 0) + 1} of 3).`, { actor: user.id });
    if (b.case_id) await update('cases', 'id=' + A.eq(R.id(b.case_id, 'case')), { status: 'resolved', resolution: 'Replacement started.', resolved_at: A.now(), updated_at: A.now() });
    await A.supplyCheck(Object.assign({}, p, { status: 'replacement' }), user.id).catch(() => {});
  },

  async create_supply_request(user, b) {
    A.need(user, 'concierge', 'recruiter');
    const zip = clean(String(b.zip || ''), 10);
    const terrList = await A.territories();
    const t = A.territoryFor(zip, terrList);
    const code = clean(b.territory_code, 4) || (t ? t.code : '');
    if (!code) throw badRequest('Choose a territory or enter a ZIP code.');
    const sr = await insert('supply_requests', {
      placement_id: R.isId(b.placement_id) ? b.placement_id : null, territory_code: code, zip,
      role_type: R.oneOf(b.role_type, A.ROLE_TYPES, 'Choose cleaner, housekeeper or nanny.'),
      needed: R.num(b.needed, 1, 50, 'Needed must be 1 to 50.', true) || 3, rate_max: R.num(b.rate_max, 0, 200, 'Enter a rate up to $200.'),
      details: clean(b.details, 1000), due_at: R.isoOrNull(b.due_at) || A.addBusinessDays(new Date(), 3).toISOString(), status: 'open', created_by: user.id
    });
    await A.notifyRole('recruiter', `Supply request: ${A.ROLE_TYPE_LABEL[sr.role_type]} in ${code}`, [`${sr.needed} needed${zip ? ' near ' + zip : ''}.`, sr.details], 'Open Recruiter', 'recruiter');
    return { supply_request_id: sr.id };
  },

  async update_case(user, b) {
    A.need(user, 'concierge');
    const c = A.first(await db('cases?select=*&id=' + A.eq(R.id(b.id, 'case'))));
    if (!c) throw A.notFound();
    const patch = { updated_at: A.now() };
    if ('status' in b) patch.status = R.oneOf(b.status, CASE_STATUS, 'Unknown status.');
    if ('priority' in b) patch.priority = R.oneOf(b.priority, PRIORITIES, 'Unknown priority.');
    if ('resolution' in b) patch.resolution = clean(b.resolution, 2000);
    if ('assignee_user_id' in b && b.assignee_user_id) {
      const a = await A.userById(b.assignee_user_id);
      if (!a || !A.isStaff(a)) throw badRequest('Choose a team member.');
      patch.assignee_user_id = a.id;
    }
    if (['resolved', 'closed'].includes(patch.status) && !['resolved', 'closed'].includes(c.status)) {
      if (!(patch.resolution || c.resolution)) throw badRequest('Add a short resolution before resolving.');
      patch.resolved_at = A.now();
    }
    await update('cases', 'id=' + A.eq(c.id), patch);
    const t = A.first(await db('threads?select=id&case_id=' + A.eq(c.id)));
    if (t && patch.assignee_user_id) await A.addMembers(t.id, [patch.assignee_user_id]);
    if (t && patch.status === 'resolved' && c.status !== 'resolved') {
      await A.postMessage(t.id, null, 'This case is resolved: ' + (patch.resolution || c.resolution) + ' Reply here if you need anything else.', { system: true });
      for (const uid of [c.opened_by].filter(Boolean)) await A.notify(await A.userById(uid), 'Your handmatch case is resolved', [patch.resolution || c.resolution]);
    }
  },

  async team_open_case(user, b) {
    A.need(user, 'concierge');
    const p = R.isId(b.placement_id) ? await A.placementById(b.placement_id) : null;
    const type = R.oneOf(b.type, require('./_act_people').CASE_TYPES, 'Choose a type.');
    const c = await openCase(user, { placement: p, applicantId: null, type, subject: b.subject, description: b.description, familyId: p ? p.family_user_id : null });
    if (p) { const t = A.first(await db('threads?select=id&case_id=' + A.eq(c.id))); if (t) await A.addMembers(t.id, [p.family_user_id]); }
    return { case_id: c.id };
  },

  // ------------------------------------------------------------ Compliance
  async save_ticket(user, b) {
    A.need(user, 'compliance');
    const t = await ticketById(b.id);
    const checklist = Object.assign({}, t.checklist || {});
    for (const k of ['consent', 'identity', 'references', 'interview']) if (k in (b.checklist || {})) checklist[k] = !!b.checklist[k];
    await update('compliance_tickets', 'id=' + A.eq(t.id), { checklist, notes: 'notes' in b ? clean(b.notes, 3000) : t.notes, assignee_user_id: t.assignee_user_id || user.id, updated_at: A.now() });
    const prof = {};
    if ('consent' in (b.checklist || {})) prof.background_consent = !!b.checklist.consent;
    if ('identity' in (b.checklist || {})) prof.check_id = !!b.checklist.identity;
    if ('references' in (b.checklist || {})) prof.check_references = !!b.checklist.references;
    if ('interview' in (b.checklist || {})) prof.check_interview = !!b.checklist.interview;
    if (Object.keys(prof).length) await update('applicant_profiles', 'user_id=' + A.eq(t.applicant_user_id), prof);
  },

  async reuse_check(user, b) {
    A.need(user, 'compliance');
    const t = await ticketById(b.id);
    if (t.status !== 'ready_review') throw badRequest('This ticket isn’t waiting for review.');
    const c = A.first(await db('background_checks?select=*&applicant_user_id=' + A.eq(t.applicant_user_id) + '&status=eq.clear&order=completed_at.desc&limit=1'));
    if (!c || !c.expires_at || new Date(c.expires_at) < new Date()) throw badRequest('There’s no clear check from the last 12 months to reuse.');
    await update('compliance_tickets', 'id=' + A.eq(t.id), { notes: (t.notes ? t.notes + '\n' : '') + `Reused clear check ${c.provider} ${c.external_ref} (expires ${String(c.expires_at).slice(0, 10)}).` });
    await ticketClear(user, t, c.id, 'reused a check from the last 12 months');
  },

  async order_check(user, b) {
    A.need(user, 'compliance');
    const t = await ticketById(b.id);
    if (t.status !== 'ready_review') throw badRequest('This ticket isn’t waiting for review.');
    const cl = t.checklist || {};
    const prof = A.first(await db('applicant_profiles?select=*&user_id=' + A.eq(t.applicant_user_id))) || {};
    if (!(cl.consent || prof.background_consent)) throw badRequest('Signed consent is required before ordering (FCRA).');
    if (!(cl.identity || prof.check_id)) throw badRequest('Confirm the applicant’s identity before ordering.');
    const p = await A.placementById(t.placement_id);
    const terr = (await A.territories()).find((x) => x.code === p.territory_code);
    if (!terr || !terr.sellable) throw badRequest('This placement’s territory isn’t sellable right now. Check the licence register.');
    const provider = clean(b.provider, 60);
    if (!provider) throw badRequest('Choose the background check provider.');
    const check = await insert('background_checks', {
      applicant_user_id: t.applicant_user_id, ticket_id: t.id, provider, package: clean(b.package, 80), external_ref: clean(b.external_ref, 120),
      cost_cents: b.cost === '' || b.cost == null ? null : Math.round((R.num(b.cost, 0, 1000, 'Enter the cost in dollars (0 to 1000).') || 0) * 100),
      status: 'ordered', ordered_by: user.id, ordered_at: A.now()
    });
    await update('compliance_tickets', 'id=' + A.eq(t.id), { status: 'ordered', background_check_id: check.id, assignee_user_id: t.assignee_user_id || user.id, updated_at: A.now() });
    await update('applicant_profiles', 'user_id=' + A.eq(t.applicant_user_id), { check_background: 'pending' });
    const link = await A.linkById(t.placement_applicant_id);
    if (link.status === 'passed') await R.setLink(link, 'check');
    const app = await A.userById(t.applicant_user_id);
    await A.addEvent(p.id, 'check_ordered', `${A.shortName(app && app.full_name)}’s background check is in progress. This usually takes 2 to 5 business days.`, { actor: user.id });
    await A.notify(app, 'Your background check has started', [`We’ve ordered your background check with ${provider}. You may get an email from them to confirm your details. Please complete it quickly.`]);
  },

  async update_check(user, b) {
    A.need(user, 'compliance');
    const t = await ticketById(b.id);
    if (!t.background_check_id) throw badRequest('Order the check first.');
    const status = R.oneOf(b.status, ['in_progress', 'clear', 'needs_review', 'cancelled'], 'Unknown result.');
    if (!['ordered', 'in_progress'].includes(t.status)) throw badRequest('This check already has a result.');
    const patch = { status, updated_at: A.now() };
    if ('external_ref' in b) patch.external_ref = clean(b.external_ref, 120);
    if (status === 'clear' || status === 'needs_review') patch.completed_at = A.now();
    if (status === 'clear') patch.expires_at = new Date(Date.now() + 365 * 864e5).toISOString();
    await update('background_checks', 'id=' + A.eq(t.background_check_id), patch);
    if (status === 'clear') {
      return ticketClear(user, t, t.background_check_id, 'new check');
    }
    if (status === 'in_progress') await update('compliance_tickets', 'id=' + A.eq(t.id), { status: 'in_progress', updated_at: A.now() });
    if (status === 'needs_review') {
      await update('compliance_tickets', 'id=' + A.eq(t.id), { status: 'needs_review', notes: (t.notes ? t.notes + '\n' : '') + clean(b.note, 1000), updated_at: A.now() });
      await update('applicant_profiles', 'user_id=' + A.eq(t.applicant_user_id), { check_background: 'review' });
      await A.notifyRole('admin', 'Background check needs review', ['A background check came back for individual review. Follow the adverse action steps (Fair Chance / FCRA) before any decision.'], 'Open Compliance', 'compliance');
    }
    if (status === 'cancelled') {
      await update('compliance_tickets', 'id=' + A.eq(t.id), { status: 'ready_review', background_check_id: null, updated_at: A.now() });
    }
  },

  // Pre-adverse action notice sent (with a copy of the report and summary of rights).
  async adverse_notice(user, b) {
    A.need(user, 'compliance');
    const t = await ticketById(b.id);
    if (t.status !== 'needs_review') throw badRequest('Only for checks that need review.');
    await update('compliance_tickets', 'id=' + A.eq(t.id), { adverse_notice_at: A.now(), notes: (t.notes ? t.notes + '\n' : '') + 'Pre-adverse action notice sent ' + new Date().toISOString().slice(0, 10) + '. ' + clean(b.note, 600), updated_at: A.now() });
  },

  async final_decision(user, b) {
    A.need(user, 'compliance');
    const t = await ticketById(b.id);
    if (t.status !== 'needs_review') throw badRequest('Only for checks that need review.');
    const decision = R.oneOf(b.decision, ['clear', 'not_cleared'], 'Choose clear or not cleared.');
    const note = clean(b.note, 1000);
    if (decision === 'clear') {
      await update('background_checks', 'id=' + A.eq(t.background_check_id), { status: 'clear', expires_at: new Date(Date.now() + 365 * 864e5).toISOString(), updated_at: A.now() });
      await update('compliance_tickets', 'id=' + A.eq(t.id), { notes: (t.notes ? t.notes + '\n' : '') + 'Individual review: cleared. ' + note });
      return ticketClear(user, t, t.background_check_id, 'cleared after individual review');
    }
    if (!t.adverse_notice_at) throw badRequest('Send the pre-adverse action notice first.');
    if (A.businessDaysBetween(t.adverse_notice_at, new Date()) < 5) throw badRequest('Wait at least 5 business days after the pre-adverse notice so the applicant can respond.');
    if (!note) throw badRequest('Record the reason for the decision (kept private).');
    await update('background_checks', 'id=' + A.eq(t.background_check_id), { status: 'not_cleared', updated_at: A.now() });
    await update('compliance_tickets', 'id=' + A.eq(t.id), { status: 'not_cleared', closed_at: A.now(), notes: (t.notes ? t.notes + '\n' : '') + 'Final adverse action: ' + note, updated_at: A.now() });
    await update('applicant_profiles', 'user_id=' + A.eq(t.applicant_user_id), { check_background: 'not_cleared', status: 'paused', pipeline_stage: 'paused' });
    const link = await A.linkById(t.placement_applicant_id);
    await R.setLink(link, 'removed');
    const p = await A.placementById(t.placement_id);
    const app = await A.userById(t.applicant_user_id);
    await A.addEvent(p.id, 'check_stopped', `${A.shortName(app && app.full_name)} can’t continue with this placement. Your Concierge will share another applicant.`, { actor: user.id });
    await A.notify(await A.userById(p.concierge_user_id), 'Applicant not cleared', [`${app ? app.full_name : 'An applicant'} won’t continue. Please share another applicant with the family.`], 'Open dashboard', 'concierge');
  },

  async cancel_ticket(user, b) {
    A.need(user, 'compliance');
    const t = await ticketById(b.id);
    if (!['ready_review', 'ordered', 'in_progress'].includes(t.status)) throw badRequest('This ticket can’t be cancelled.');
    await update('compliance_tickets', 'id=' + A.eq(t.id), { status: 'cancelled', closed_at: A.now(), notes: (t.notes ? t.notes + '\n' : '') + 'Cancelled: ' + clean(b.note, 600), updated_at: A.now() });
    if (t.background_check_id) await update('background_checks', 'id=' + A.eq(t.background_check_id), { status: 'cancelled' });
  },

  async save_territory(user, b) {
    A.need(user, 'compliance');
    const code = clean(String(b.code || ''), 4).toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(code)) throw badRequest('Use a 2-letter state code, like NY.');
    const ranges = clean(b.zip_ranges, 200).replace(/\s+/g, '');
    if (ranges && !/^\d{3}(-\d{3})?(,\d{3}(-\d{3})?)*$/.test(ranges)) throw badRequest('ZIP ranges look like 100-149 or 100-149,005.');
    const existing = A.first(await db('territories?select=*&code=' + A.eq(code)));
    const row = { name: clean(b.name, 60) || (existing && existing.name) || code, zip_ranges: ranges, min_wage: R.num(b.min_wage, 0, 100, 'Enter the minimum wage in dollars.') || 0, notes: clean(b.notes, 1000), updated_at: A.now() };
    const sellable = !!b.sellable;
    if (sellable && !(existing && existing.sellable)) {
      const lic = (await db('licenses?select=*&territory_code=' + A.eq(code))) || [];
      if (!A.licenceState({ code }, lic).licensed) throw badRequest('Add an active licence (or mark one “not required”) before making this territory sellable.');
    }
    row.sellable = sellable;
    if (existing) await update('territories', 'code=' + A.eq(code), row);
    else await insert('territories', Object.assign({ code }, row));
    if (existing && existing.sellable !== sellable) await A.notifyRole('admin', `${code} is now ${sellable ? 'sellable' : 'NOT sellable'}`, [`${user.full_name || user.email} changed ${row.name} to ${sellable ? 'sellable' : 'not sellable'}. ${sellable ? '' : 'New families in this territory can’t pay until it’s sellable again.'}`], 'Open Compliance', 'compliance');
  },

  async save_license(user, b) {
    A.need(user, 'compliance');
    const code = clean(String(b.territory_code || ''), 4).toUpperCase();
    if (!A.first(await db('territories?select=code&code=' + A.eq(code)))) throw badRequest('Choose a territory.');
    const row = {
      territory_code: code, kind: clean(b.kind, 120), number: clean(b.number, 80), issuer: clean(b.issuer, 120),
      issued_on: R.dateOrNull(b.issued_on), expires_on: R.dateOrNull(b.expires_on),
      status: R.oneOf(b.status || 'pending', ['pending', 'active', 'expired', 'not_required'], 'Unknown status.'),
      document_url: clean(b.document_url, 500), notes: clean(b.notes, 1000), updated_at: A.now()
    };
    if (!row.kind) throw badRequest('Name the licence or registration.');
    if (row.document_url && !/^https:\/\//.test(row.document_url)) throw badRequest('Document link must start with https://');
    if (R.isId(b.id)) await update('licenses', 'id=' + A.eq(b.id), row);
    else await insert('licenses', row);
  }
};

module.exports = { ACTIONS };
