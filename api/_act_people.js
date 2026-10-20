// Actions for everyone signed in, families and applicants.
'use strict';
const { db, insert, update, clean, isEmail, badRequest } = require('./_lib');
const A = require('./_app');
const R = require('./_rules');

const CASE_TYPES = ['safety', 'no_show', 'quality', 'schedule', 'payment', 'replacement', 'refund', 'other'];
const PRIORITY = { safety: 'urgent', no_show: 'high', replacement: 'high' };
const SLA_HOURS = { urgent: 1, high: 4 };
const CASE_LABEL = { safety: 'Safety concern', no_show: 'No-show or lateness', quality: 'Quality of work', schedule: 'Schedule change', payment: 'Payment question', replacement: 'Replacement request', refund: 'Refund question', other: 'Something else' };

async function ownPlacement(user, placementId) {
  const p = await A.placementById(R.id(placementId, 'placement'));
  if (p.family_user_id !== user.id && !A.hasRole(user, 'concierge')) throw A.notFound();
  return p;
}
async function familyLink(user, linkId) {
  const link = await A.linkById(R.id(linkId, 'applicant'));
  const p = await ownPlacement(user, link.placement_id);
  return { link, p };
}
async function meetingFor(user, meetingId) {
  const m = A.first(await db('meetings?select=*&id=' + A.eq(R.id(meetingId, 'meeting'))));
  if (!m) throw A.notFound();
  return m;
}

// Open a support case with its own chat thread and the right response time.
async function openCase(user, { placement, applicantId, type, subject, description, familyId }) {
  const assignee = placement && placement.concierge_user_id ? await A.userById(placement.concierge_user_id) : await A.defaultConcierge();
  const priority = PRIORITY[type] || 'normal';
  const due = SLA_HOURS[priority] ? new Date(Date.now() + SLA_HOURS[priority] * 3600e3) : A.addBusinessDays(new Date(), 1);
  const c = await insert('cases', {
    placement_id: placement ? placement.id : null, family_user_id: familyId || null, applicant_user_id: applicantId || null, opened_by: user.id,
    type, priority, status: 'open', subject: clean(subject, 140) || CASE_LABEL[type], description: clean(description, 3000),
    assignee_user_id: assignee ? assignee.id : null, due_at: due.toISOString()
  });
  const t = await A.ensureThread({ kind: 'case', case_id: c.id, placement_id: placement ? placement.id : null, title: c.subject }, [user.id, assignee && assignee.id]);
  if (c.description) await A.postMessage(t.id, user.id, c.description);
  await A.postMessage(t.id, null, priority === 'urgent'
    ? 'Thank you for telling us. A member of our team will contact you within 1 hour. If anyone is in immediate danger, call 911 first.'
    : `Thanks, we’ve opened your case. We’ll reply within ${priority === 'high' ? '4 hours' : '1 business day'}.`, { system: true });
  if (placement) await A.addEvent(placement.id, 'case', `Support case opened: ${c.subject}.`, { actor: user.id, visible: user.id === placement.family_user_id });
  const lines = [`${user.full_name || user.email} opened a ${CASE_LABEL[type].toLowerCase()} case: “${c.subject}”.`, c.description ? `“${c.description.slice(0, 400)}”` : '', `Respond by ${A.fmtWhen(c.due_at)}.`];
  if (assignee) await A.notify(assignee, `${priority === 'urgent' ? 'URGENT ' : ''}Case: ${c.subject}`, lines, 'Open case', 'concierge');
  if (priority === 'urgent') await A.notifyRole('admin', 'URGENT safety case: ' + c.subject, lines, 'Open case', 'concierge');
  return c;
}

const ACTIONS = {
  // ------------------------------------------------------------- everyone
  async update_me(user, b) {
    const patch = R.userPatch(b, { staff: A.isStaff(user) });
    if (Object.keys(patch).length) await update('users', 'id=' + A.eq(user.id), patch);
  },

  async send_message(user, b) {
    const t = A.first(await db('threads?select=*&id=' + A.eq(R.id(b.thread_id, 'conversation'))));
    if (!t) throw A.notFound();
    const member = A.first(await db('thread_members?select=*&thread_id=' + A.eq(t.id) + '&user_id=' + A.eq(user.id)));
    const staff = A.hasRole(user, 'concierge');
    if (!member && !staff) throw A.notFound();
    if (!member) await A.addMembers(t.id, [user.id]);
    let body = clean(b.body, 2000);
    if (!body) throw badRequest('Write a message first.');
    const internal = !!b.internal && A.isStaff(user);
    if (t.kind === 'meet' && !A.isStaff(user)) {
      const link = await A.linkById(t.placement_applicant_id);
      if (!['hired', 'ended'].includes(link.status)) body = A.maskContacts(body);
      if (['declined', 'removed', 'not_selected', 'not_fit'].includes(link.status)) throw badRequest('This conversation is closed.');
    }
    await A.postMessage(t.id, user.id, body, { internal });
    // Email the other people in the conversation (not for team notes).
    if (!internal) {
      const members = (await db('thread_members?select=*&thread_id=' + A.eq(t.id))) || [];
      const fresh = Date.now() - 10 * 60e3;
      for (const m of members.filter((x) => x.user_id !== user.id)) {
        if (m.last_read_at && new Date(m.last_read_at).getTime() > fresh) continue; // they're active in the app
        const other = await A.userById(m.user_id);
        await A.notify(other, `New message from ${A.firstName(user.full_name) || 'handmatch'}`, [`“${body.slice(0, 300)}”`], 'Reply in handmatch', A.isStaff(other) ? 'concierge' : '');
      }
    }
    return { thread: await require('./_dash').threadDetail(user, t.id) };
  },

  // -------------------------------------------------------------- families
  async request_meeting(user, b) {
    const { link, p } = await familyLink(user, b.link_id);
    if (!['accepted', 'meeting'].includes(link.status)) throw badRequest('You can book once the applicant has confirmed they’re available.');
    const open = (await db('meetings?select=id&placement_applicant_id=' + A.eq(link.id) + '&status=in.(requested,confirmed)')) || [];
    if (open.length) throw badRequest('There’s already a meeting booked with this applicant. Your Concierge can change it.');
    const kind = R.oneOf(b.kind, ['phone', 'video', 'trial'], 'Choose a phone call, video interview or paid trial.');
    const row = {
      placement_id: p.id, placement_applicant_id: link.id, kind, status: 'requested', requested_by: user.id,
      preferred_times: clean(b.preferred_times, 300), family_note: clean(b.note, 600), duration_min: kind === 'phone' ? 20 : 30
    };
    if (!row.preferred_times) throw badRequest('Tell us a few times that work for you.');
    if (kind === 'trial') {
      const terr = (await A.territories()).find((t) => t.code === p.territory_code);
      const min = terr ? Number(terr.min_wage) || 0 : 0;
      row.trial_hours = R.num(b.trial_hours, 2, 8, 'A paid trial is between 2 and 8 hours.');
      row.trial_rate = R.num(b.trial_rate, 0, 200, 'Enter the hourly rate you’ll pay for the trial.');
      if (!row.trial_hours) throw badRequest('A paid trial is at least 2 hours.');
      if (!row.trial_rate || row.trial_rate < min) throw badRequest(`The trial rate must be at least the minimum wage${min ? ' ($' + min.toFixed(2) + '/hr)' : ''}.`);
      if (!b.supervised) throw badRequest('Please confirm an adult in your home will be there during the trial.');
      row.duration_min = Math.round(row.trial_hours * 60);
    }
    const m = await insert('meetings', row);
    await R.setLink(link, 'meeting');
    await R.advance(p, 'meeting');
    const app = await A.userById(link.applicant_user_id);
    const name = A.shortName(app && app.full_name) || 'your applicant';
    const label = { phone: 'phone call', video: 'video interview', trial: 'paid trial' }[kind];
    await A.addEvent(p.id, 'meeting_requested', `You asked for a ${label} with ${A.sentence(name)} Your Concierge will confirm the time.`, { actor: user.id });
    await R.systemNote(p, link, `The family asked for a ${label}${kind === 'trial' ? ` (${row.trial_hours} hours at $${row.trial_rate}/hr, paid by the family)` : ''}. Times that work for them: ${row.preferred_times}. Your Concierge will confirm.`);
    const conc = await A.userById(p.concierge_user_id);
    await A.notify(conc, `Meeting request: ${A.firstName(user.full_name) || 'family'} + ${name}`, [`${label[0].toUpperCase() + label.slice(1)} requested. Preferred times: ${row.preferred_times}.`, row.family_note ? `Note: “${row.family_note}”` : '', 'Please confirm a time.'], 'Schedule it', 'concierge');
    return { meeting_id: m.id };
  },

  async cancel_meeting(user, b) {
    const m = await meetingFor(user, b.meeting_id);
    const p = await A.placementById(m.placement_id);
    if (p.family_user_id !== user.id && !A.hasRole(user, 'concierge')) throw A.notFound();
    if (!['requested', 'confirmed'].includes(m.status)) throw badRequest('This meeting can’t be cancelled.');
    await update('meetings', 'id=' + A.eq(m.id), { status: 'cancelled', updated_at: A.now() });
    const link = await A.linkById(m.placement_applicant_id);
    if (link.status === 'meeting') await R.setLink(link, 'accepted');
    await A.addEvent(p.id, 'meeting_cancelled', 'A meeting was cancelled.', { actor: user.id });
    await R.systemNote(p, link, 'This meeting was cancelled. Your Concierge can help set a new one.');
    const app = await A.userById(link.applicant_user_id);
    await A.notify(app, 'A handmatch meeting was cancelled', ['Your meeting has been cancelled. We’ll let you know if a new time is set.']);
  },

  async record_outcome(user, b) {
    const m = await meetingFor(user, b.meeting_id);
    const p = await A.placementById(m.placement_id);
    const staff = A.hasRole(user, 'concierge');
    if (p.family_user_id !== user.id && !staff) throw A.notFound();
    if (m.outcome) throw badRequest('You’ve already shared how this went.');
    if (!['confirmed', 'completed'].includes(m.status)) throw badRequest('This meeting hasn’t been confirmed yet.');
    if (!staff && m.start_at && new Date(m.start_at) > new Date()) throw badRequest('You can share how it went after the meeting.');
    const outcome = R.oneOf(b.outcome, ['pass', 'not_fit'], 'Choose Pass or Not the right fit.');
    await R.recordOutcome(user, m, outcome, b.note);
  },

  async not_fit(user, b) {
    const { link, p } = await familyLink(user, b.link_id);
    if (!['waiting', 'accepted', 'meeting'].includes(link.status)) throw badRequest('This applicant can’t be changed now.');
    await R.setLink(link, 'not_fit', { family_note: clean(b.note, 600) });
    for (const m of ((await db('meetings?select=id&placement_applicant_id=' + A.eq(link.id) + '&status=in.(requested,confirmed)')) || [])) await update('meetings', 'id=' + A.eq(m.id), { status: 'cancelled', updated_at: A.now() });
    const app = await A.userById(link.applicant_user_id);
    await A.addEvent(p.id, 'not_fit', `You passed on ${A.shortName(app && app.full_name) || 'an applicant'}. Your Concierge will share someone else if you’d like.`, { actor: user.id });
    await A.notify(await A.userById(p.concierge_user_id), 'Family passed on an applicant', [`${user.full_name || 'The family'} said ${app ? app.full_name : 'an applicant'} isn’t the right fit.`, b.note ? `Note: “${clean(b.note, 600)}”` : ''], 'Open dashboard', 'concierge');
  },

  async hire(user, b) {
    const { link } = await familyLink(user, b.link_id);
    await R.hire(user, link);
  },

  async request_change(user, b) {
    const p = await ownPlacement(user, b.placement_id);
    const note = clean(b.note, 600);
    await A.addEvent(p.id, 'family_request', 'You asked to meet more applicants' + (note ? ': “' + note + '”' : '.') + ' Your Concierge is on it.', { actor: user.id });
    const t = await A.conciergeThread(p);
    await A.postMessage(t.id, user.id, 'I’d like to meet more applicants.' + (note ? ' ' + note : ''));
    await A.notify(await A.userById(p.concierge_user_id), `${A.firstName(user.full_name) || 'A family'} wants more applicants`, [note ? `Their note: “${note}”` : 'They didn’t add a note.'], 'Open dashboard', 'concierge');
    await A.supplyCheck(p, user.id).catch(() => {});
  },

  async open_case(user, b) {
    const type = R.oneOf(b.type, CASE_TYPES, 'Choose what this is about.');
    if (A.hasRole(user, 'family') && b.placement_id) {
      const p = await ownPlacement(user, b.placement_id);
      let applicantId = null;
      if (b.link_id) { const l = await A.linkById(b.link_id); if (l.placement_id === p.id) applicantId = l.applicant_user_id; }
      const c = await openCase(user, { placement: p, applicantId, type, subject: b.subject, description: b.description, familyId: p.family_user_id });
      return { case_id: c.id };
    }
    if (A.hasRole(user, 'applicant') && b.link_id) {
      const l = await A.linkById(R.id(b.link_id, 'job'));
      if (l.applicant_user_id !== user.id) throw A.notFound();
      if (!['hired', 'ended'].includes(l.status)) throw badRequest('Support cases are for jobs you’ve been hired for. For anything else, message your Concierge.');
      const p = await A.placementById(l.placement_id);
      const c = await openCase(user, { placement: p, applicantId: user.id, type, subject: b.subject, description: b.description, familyId: p.family_user_id });
      return { case_id: c.id };
    }
    throw badRequest('Choose the placement this is about.');
  },

  async request_replacement(user, b) {
    const { link, p } = await familyLink(user, b.link_id);
    if (link.status !== 'hired') throw badRequest('Replacements are for someone you’ve hired.');
    const rs = A.replacementState(p);
    if (!rs.eligible) throw badRequest(rs.reason);
    const app = await A.userById(link.applicant_user_id);
    const c = await openCase(user, { placement: p, applicantId: link.applicant_user_id, type: 'replacement', subject: 'Replacement for ' + (A.shortName(app && app.full_name) || 'my helper'), description: b.reason, familyId: p.family_user_id });
    return { case_id: c.id };
  },

  async request_refund(user, b) {
    const p = await ownPlacement(user, b.placement_id);
    if (p.family_user_id !== user.id) throw A.forbidden();
    const pending = (await db('refunds?select=id&placement_id=' + A.eq(p.id) + '&status=in.(requested,approved)')) || [];
    if (pending.length) throw badRequest('You already have a refund request in review.');
    const order = p.order_id ? A.first(await db('orders?select=*&id=' + A.eq(p.order_id))) : null;
    if (!order) throw badRequest('We couldn’t find a payment for this placement. Please message your Concierge.');
    const links = (await db('placement_applicants?select=*&placement_id=' + A.eq(p.id))) || [];
    const refunds = (await db('refunds?select=*&order_id=' + A.eq(order.id))) || [];
    const el = A.refundEligibility({ order, placement: p, links, refunds });
    const reason = clean(b.reason, 1000);
    if (!reason) throw badRequest('Tell us briefly why you’d like a refund.');
    const r = await insert('refunds', { order_id: order.id, placement_id: p.id, family_user_id: user.id, requested_by: user.id, reason, percent: el.percent, amount_cents: el.amount_cents, status: 'requested', eligibility: el });
    await A.addEvent(p.id, 'refund_requested', 'You requested a refund. Our finance team will review it within 2 business days.', { actor: user.id });
    await A.notifyRole('finance', `Refund request: ${order.order_ref}`, [`${user.full_name || user.email} asked for a refund.`, `Reason: “${reason}”`, `Policy check: ${el.reason} Suggested: $${(el.amount_cents / 100).toFixed(2)}.`], 'Review refund', 'finance');
    return { refund_id: r.id };
  },

  // ------------------------------------------------------------ applicants
  async save_profile(user, b) {
    if (!A.hasRole(user, 'applicant')) throw A.forbidden();
    const up = R.userPatch(b);
    if (Object.keys(up).length) await update('users', 'id=' + A.eq(user.id), up);
    const patch = R.profilePatch(b, await A.territories());
    const current = A.first(await db('applicant_profiles?select=*&user_id=' + A.eq(user.id)));
    if (b.submit) {
      const merged = Object.assign({}, current || {}, patch);
      const name = up.full_name != null ? up.full_name : user.full_name;
      if (!name || !merged.zip || !merged.role_type) throw badRequest('Add your name, ZIP code and type of work before submitting.');
      if (!merged.background_consent) throw badRequest('Please agree to a background check before submitting. It’s only run if a family wants to hire you.');
      if (!current || ['draft', 'paused'].includes(current.status)) patch.status = 'submitted';
      if (!current || current.pipeline_stage === 'lead') patch.pipeline_stage = 'contacted';
    }
    patch.updated_at = A.now();
    if (current) await update('applicant_profiles', 'user_id=' + A.eq(user.id), patch);
    else await insert('applicant_profiles', Object.assign({ user_id: user.id }, patch));
    if (b.submit) {
      await A.pipelineEvent(user.id, 'submitted', 'Submitted their profile for review.', user.id);
      await A.notifyRole('recruiter', `Profile submitted: ${up.full_name || user.full_name || user.email}`, ['An applicant submitted their profile. Please schedule a screening interview.'], 'Open Recruiter', 'recruiter');
    }
  },

  async respond(user, b) {
    if (!A.hasRole(user, 'applicant')) throw A.forbidden();
    const link = await A.linkById(R.id(b.id, 'request'));
    if (link.applicant_user_id !== user.id) throw A.notFound();
    if (link.status !== 'waiting') throw badRequest('This request was already answered.');
    const accept = !!b.accept;
    await R.setLink(link, accept ? 'accepted' : 'declined');
    const p = await A.placementById(link.placement_id);
    const name = A.shortName(user.full_name) || 'Your applicant';
    await A.addEvent(p.id, accept ? 'applicant_accepted' : 'applicant_declined',
      accept ? `${name} is available. Book a phone call, video interview or paid trial.` : `${name} isn’t available for this one.`, { actor: user.id, visible: accept });
    if (accept) {
      const t = await A.meetThread(p, link);
      await A.postMessage(t.id, null, `${name} is available and would love to meet you. This is your shared chat with your Concierge. Phone numbers and emails stay hidden until you hire, so please arrange calls and visits through your Concierge.`, { system: true });
      await A.notify(await A.userById(p.family_user_id), `${name} is available to meet you`, [`${name} confirmed they’re available.`, 'Open your account to book a phone call, video interview or paid trial.'], 'Book a meeting');
    }
    await A.notify(await A.userById(p.concierge_user_id), `${name} ${accept ? 'accepted' : 'declined'} a request`, [`${name} ${accept ? 'is available and accepted' : 'declined'} the request near ${p.zip || ''}.`], 'Open dashboard', 'concierge');
  },

  async confirm_meeting(user, b) {
    const m = await meetingFor(user, b.meeting_id);
    const link = await A.linkById(m.placement_applicant_id);
    if (link.applicant_user_id !== user.id) throw A.notFound();
    if (m.status !== 'confirmed') throw badRequest('This meeting isn’t scheduled yet.');
    const p = await A.placementById(m.placement_id);
    const conc = await A.userById(p.concierge_user_id);
    if (b.ok) {
      await update('meetings', 'id=' + A.eq(m.id), { applicant_confirmed: true, updated_at: A.now() });
      await R.systemNote(p, link, `${A.shortName(user.full_name)} confirmed they’ll be there.`);
    } else {
      const note = clean(b.note, 300);
      await update('meetings', 'id=' + A.eq(m.id), { status: 'requested', applicant_confirmed: false, preferred_times: (m.preferred_times + (note ? ' · Applicant: ' + note : '')).slice(0, 300), updated_at: A.now() });
      await R.systemNote(p, link, `${A.shortName(user.full_name)} can’t make that time${note ? ' (' + note + ')' : ''}. Your Concierge will find a new one.`);
      await A.notify(conc, 'Applicant can’t make a meeting', [`${user.full_name} can’t make ${A.fmtWhen(m.start_at)}.`, note ? `Note: “${note}”` : '', 'Please reschedule.'], 'Reschedule', 'concierge');
    }
  },

  async trial_check(user, b) {
    const m = await meetingFor(user, b.meeting_id);
    const link = await A.linkById(m.placement_applicant_id);
    if (link.applicant_user_id !== user.id) throw A.notFound();
    if (m.kind !== 'trial') throw badRequest('Check-in is only for paid trials.');
    const p = await A.placementById(m.placement_id);
    if (b.what === 'in') {
      if (m.status !== 'confirmed' || m.checked_in_at) throw badRequest('You’ve already checked in.');
      if (m.start_at && new Date(m.start_at).getTime() - Date.now() > 2 * 3600e3) throw badRequest('You can check in up to 2 hours before the trial starts.');
      await update('meetings', 'id=' + A.eq(m.id), { checked_in_at: A.now(), updated_at: A.now() });
      await R.systemNote(p, link, `${A.shortName(user.full_name)} checked in for the paid trial.`);
    } else if (b.what === 'out') {
      if (!m.checked_in_at || m.checked_out_at) throw badRequest('Check in first.');
      await update('meetings', 'id=' + A.eq(m.id), { checked_out_at: A.now(), status: 'completed', updated_at: A.now() });
      await R.systemNote(p, link, `${A.shortName(user.full_name)} checked out. Family: please pay the trial directly and let us know how it went.`);
      await A.notify(await A.userById(p.family_user_id), 'How did the paid trial go?', ['The trial is complete. Please pay the agreed amount directly, then tell us how it went: Pass or Not the right fit.'], 'Share how it went');
    } else throw badRequest('Choose check in or check out.');
  },

  async refer(user, b) {
    if (!A.hasRole(user, 'applicant')) throw A.forbidden();
    const name = clean(b.name, 120);
    const email = A.normEmail(b.email);
    const phone = clean(b.phone, 40);
    if (!name) throw badRequest('Add your friend’s name.');
    if (!isEmail(email) && phone.replace(/\D/g, '').length < 10) throw badRequest('Add your friend’s email or mobile number.');
    const role = A.ROLE_TYPES.includes(b.role_type) ? b.role_type : '';
    let lead = isEmail(email) ? await A.userByEmail(email) : null;
    if (!lead && isEmail(email)) {
      lead = await insert('users', { email, roles: ['applicant'], full_name: name, phone });
      await insert('applicant_profiles', { user_id: lead.id, role_type: role || 'housekeeper', pipeline_stage: 'lead', source: 'referral', referred_by_user_id: user.id });
      await A.pipelineEvent(lead.id, 'created', `Referred by ${user.full_name || user.email}.`, user.id);
    }
    await insert('referrals', { referrer_user_id: user.id, name, email: isEmail(email) ? email : '', phone, role_type: role, status: 'new', lead_user_id: lead ? lead.id : null });
    await A.notifyRole('recruiter', `New referral from ${user.full_name || 'an applicant'}`, [`${name} (${email || phone}) was referred as a ${role || 'helper'}.`], 'Open Recruiter', 'recruiter');
  }
};

module.exports = { ACTIONS, openCase, CASE_TYPES, CASE_LABEL };
