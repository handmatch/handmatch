// Validation and the shared steps of a placement (used by families, applicants and the team).
'use strict';
const { db, insert, update, clean, badRequest } = require('./_lib');
const A = require('./_app');

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const toList = (v, max) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => clean(String(x), 60)).filter(Boolean).slice(0, max);
const isId = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
function id(v, what = 'item') { if (!isId(v)) throw badRequest('Missing or invalid ' + what + '.'); return v; }
function oneOf(v, list, msg) { if (!list.includes(v)) throw badRequest(msg || 'Choose a valid option.'); return v; }
function isoOrNull(v, msg) {
  if (v === '' || v == null) return null;
  const d = new Date(v);
  if (isNaN(d)) throw badRequest(msg || 'Enter a valid date and time.');
  return d.toISOString();
}
function dateOrNull(v) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw badRequest('Enter dates as YYYY-MM-DD.');
  return String(v);
}
function num(v, lo, hi, msg, int) {
  if (v === '' || v == null) return null;
  const n = int ? parseInt(v, 10) : Number(v);
  if (!(n >= lo && n <= hi)) throw badRequest(msg);
  return n;
}

function profilePatch(b, terrList) {
  const p = {};
  if ('role_type' in b) p.role_type = oneOf(b.role_type, A.ROLE_TYPES, 'Choose cleaner, housekeeper or nanny.');
  if ('city' in b) p.city = clean(b.city, 80);
  if ('zip' in b) {
    const z = clean(String(b.zip || ''), 10);
    if (z && !/^\d{5}$/.test(z)) throw badRequest('Enter a 5-digit ZIP code.');
    p.zip = z;
    const t = A.territoryFor(z, terrList);
    p.territory_code = t ? t.code : '';
  }
  if ('rate' in b) p.rate = num(b.rate, 0, 200, 'Enter an hourly rate between $0 and $200.');
  if ('years' in b) p.years = num(b.years, 0, 60, 'Enter years of experience between 0 and 60.', true);
  if ('start_in_days' in b) p.start_in_days = num(b.start_in_days, 0, 90, 'Enter how many days until you can start (0 to 90).', true);
  if ('employment' in b) p.employment = clean(b.employment, 60);
  if ('languages' in b) p.languages = toList(b.languages, 10);
  if ('skills' in b) p.skills = toList(b.skills, 20);
  if ('bio' in b) p.bio = clean(b.bio, 1200);
  if ('days' in b) { p.days = toList(b.days, 7).filter((d) => DAYS.includes(d)); p.availability_updated_at = new Date().toISOString(); }
  if ('hours' in b) { p.hours = clean(b.hours, 80); p.availability_updated_at = new Date().toISOString(); }
  if ('background_consent' in b) p.background_consent = !!b.background_consent;
  return p;
}

function userPatch(b, { staff = false } = {}) {
  const p = {};
  if ('full_name' in b) p.full_name = clean(b.full_name, 120);
  if ('phone' in b) p.phone = clean(b.phone, 40);
  if (staff && 'title' in b) p.title = clean(b.title, 80);
  if (staff && 'photo_url' in b) {
    const u = clean(b.photo_url, 500);
    if (u && !/^(https:\/\/|\/assets\/)/.test(u)) throw badRequest('Photo must be an https:// link or a site image path.');
    p.photo_url = u;
  }
  return p;
}

// ------------------------------------------------------------ placement flow
const STAGE = ['new', 'contacted', 'matching', 'meeting', 'checks', 'hired'];
// Move a placement forward (never backwards, never out of closed/replacement by accident).
async function advance(p, to) {
  if (p.status === 'closed') return p;
  if (p.status === 'replacement' && to !== 'hired') return p;
  if (STAGE.indexOf(to) <= STAGE.indexOf(p.status)) return p;
  const patch = { status: to, updated_at: A.now() };
  if (to === 'contacted' && !p.first_contact_at) patch.first_contact_at = A.now();
  return (await update('placements', 'id=' + A.eq(p.id), patch)) || Object.assign(p, patch);
}

// A Concierge working on an unassigned placement takes it (and joins its conversations).
async function claim(p, user) {
  if (p.concierge_user_id || !A.hasRole(user, 'concierge')) return p;
  await update('placements', 'id=' + A.eq(p.id), { concierge_user_id: user.id, updated_at: A.now() });
  p.concierge_user_id = user.id;
  await A.conciergeThread(p);
  for (const t of ((await db('threads?select=id&placement_id=' + A.eq(p.id))) || [])) await A.addMembers(t.id, [user.id]);
  await A.addEvent(p.id, 'concierge', `${A.firstName(user.full_name) || 'Your Concierge'} is your handmatch Concierge.`, { actor: user.id });
  return p;
}

async function setLink(link, status, extra = {}) {
  return (await update('placement_applicants', 'id=' + A.eq(link.id), Object.assign({ status, updated_at: A.now() }, extra))) || Object.assign(link, { status }, extra);
}

async function systemNote(p, link, text) {
  try {
    const t = link ? await A.meetThread(p, link) : await A.conciergeThread(p);
    await A.postMessage(t.id, null, text, { system: true });
  } catch (e) { console.error('system note failed', e.message); }
}

// Family passed an applicant → Compliance ticket (the paid check is ordered from there).
async function openTicket(p, link, actor) {
  const open = (await db('compliance_tickets?select=*&placement_applicant_id=' + A.eq(link.id) + '&status=in.(ready_review,ordered,in_progress,needs_review)')) || [];
  if (open.length) return open[0];
  const prof = A.first(await db('applicant_profiles?select=*&user_id=' + A.eq(link.applicant_user_id))) || {};
  const t = await insert('compliance_tickets', {
    placement_id: p.id, placement_applicant_id: link.id, applicant_user_id: link.applicant_user_id, status: 'ready_review',
    checklist: { consent: !!prof.background_consent, identity: !!prof.check_id, references: !!prof.check_references, interview: !!prof.check_interview },
    due_at: A.addBusinessDays(new Date(), 1).toISOString()
  });
  const app = await A.userById(link.applicant_user_id);
  await A.notifyRole('compliance', `Background check ticket: ${app ? app.full_name : 'applicant'}`, [
    `A family passed ${app ? app.full_name : 'an applicant'} for a placement near ${p.zip || 'their ZIP'}.`,
    'Please review the checklist and order the background check within 1 business day.'], 'Open Compliance', 'compliance');
  await A.audit(actor, 'ticket_opened', 'compliance_ticket', t.id, { placement_id: p.id });
  return t;
}

async function recordOutcome(actor, m, outcome, note) {
  const link = await A.linkById(m.placement_applicant_id);
  const p = await A.placementById(m.placement_id);
  const app = await A.userById(link.applicant_user_id);
  const fam = await A.userById(p.family_user_id);
  await update('meetings', 'id=' + A.eq(m.id), { outcome, outcome_note: clean(note, 600), outcome_at: A.now(), status: 'completed', updated_at: A.now() });
  const name = A.shortName(app && app.full_name) || 'your applicant';
  const kind = { phone: 'call', video: 'video interview', trial: 'paid trial' }[m.kind] || 'meeting';
  if (outcome === 'pass') {
    await setLink(link, 'passed');
    await A.addEvent(p.id, 'passed', `You passed ${A.sentence(name)} Next: a background check before you hire. We’ll let you know as soon as it’s clear.`, { actor: actor.id });
    await advance(p, 'checks');
    await systemNote(p, link, `Great news: the family would like to move forward after the ${kind}. Next step is a background check. Your Concierge will keep you both posted.`);
    await openTicket(p, link, actor);
    await A.notify(app, 'Good news from your handmatch ' + kind, [`${A.firstName(fam && fam.full_name) || 'The family'} would like to move forward with you.`, 'The next step is a background check. Our team will contact you shortly.']);
  } else {
    await setLink(link, 'not_fit', { family_note: clean(note, 600) });
    await A.addEvent(p.id, 'not_fit', `You let us know ${name} isn’t the right fit. Your Concierge will share another applicant if you’d like.`, { actor: actor.id });
    await A.notify(app, 'An update on your handmatch request', [`Thank you for meeting ${A.firstName(fam && fam.full_name) || 'the family'}. They’ve decided to go another way this time.`, 'We’ll keep matching you with families near you.']);
  }
  if (p.concierge_user_id && p.concierge_user_id !== actor.id) {
    await A.notify(await A.userById(p.concierge_user_id), `${A.firstName(fam && fam.full_name) || 'A family'} ${outcome === 'pass' ? 'passed' : 'said not the right fit for'} ${name}`, [note ? `Note: “${clean(note, 600)}”` : '', outcome === 'pass' ? 'A Compliance ticket has been opened for the background check.' : 'Consider sharing another applicant.'], 'Open dashboard', 'concierge');
  }
}

async function hire(actor, link) {
  if (link.status !== 'cleared') throw badRequest('You can hire once the background check is clear.');
  const p = await A.placementById(link.placement_id);
  const all = (await db('placement_applicants?select=*&placement_id=' + A.eq(p.id))) || [];
  const hiredNow = all.filter((x) => x.status === 'hired').length;
  if (hiredNow >= p.hires_allowed) throw badRequest(`This placement covers ${p.hires_allowed} hire${p.hires_allowed > 1 ? 's' : ''}. Contact your Concierge to add another.`);
  await setLink(link, 'hired', { hired_at: A.now() });
  const patch = { status: 'hired', updated_at: A.now() };
  if (!p.hired_at) patch.hired_at = A.now();
  await update('placements', 'id=' + A.eq(p.id), patch);
  const app = await A.userById(link.applicant_user_id);
  const fam = await A.userById(p.family_user_id);
  const name = A.shortName(app && app.full_name) || 'your helper';
  await A.addEvent(p.id, 'hired', `You hired ${A.sentence(name)} Congratulations! Their contact details are now on your dashboard. Your Concierge will check in during the first week.`, { actor: actor.id });
  await systemNote(p, link, 'It’s official: you’re hired! Contact details are now visible to both of you. Agree on pay and schedule directly. Your Concierge will check in during the first week.');
  await A.notify(app, 'You’re hired!', [`${fam ? fam.full_name : 'The family'} hired you through handmatch. Congratulations!`, fam && fam.phone ? `Their phone: ${fam.phone}.` : '', 'Agree on your pay and schedule directly with them.']);
  if (fam && fam.id !== actor.id) await A.notify(fam, `You hired ${name}`, [`Congratulations! ${app ? app.full_name : 'Your helper'}’s contact details are on your dashboard.`]);
  // Once every hire is used, everyone else still in play is not selected.
  if (hiredNow + 1 >= p.hires_allowed) {
    for (const x of all.filter((y) => y.id !== link.id && ['waiting', 'accepted', 'meeting', 'passed', 'check', 'cleared'].includes(y.status))) {
      await setLink(x, 'not_selected');
      for (const m of ((await db('meetings?select=id&placement_applicant_id=' + A.eq(x.id) + '&status=in.(requested,confirmed)')) || [])) await update('meetings', 'id=' + A.eq(m.id), { status: 'cancelled', updated_at: A.now() });
      for (const t of ((await db('compliance_tickets?select=id&placement_applicant_id=' + A.eq(x.id) + '&status=eq.ready_review')) || [])) await update('compliance_tickets', 'id=' + A.eq(t.id), { status: 'cancelled', closed_at: A.now(), notes: 'Family hired someone else.' });
      await A.notify(await A.userById(x.applicant_user_id), 'An update on your handmatch request', ['The family has hired someone else this time. Thank you for your time!', 'We’ll keep matching you with families near you.']);
    }
  }
  // Referral bonus: the person who referred this applicant earns it on their first hire.
  const prof = A.first(await db('applicant_profiles?select=referred_by_user_id&user_id=' + A.eq(link.applicant_user_id)));
  if (prof && prof.referred_by_user_id) {
    const ref = A.first(await db('referrals?select=*&lead_user_id=' + A.eq(link.applicant_user_id) + '&status=in.(new,contacted,joined)'));
    if (ref) await update('referrals', 'id=' + A.eq(ref.id), { status: 'hired', bonus_cents: Number(process.env.REFERRAL_BONUS_CENTS) || 5000, updated_at: A.now() });
  }
}

module.exports = { claim, DAYS, toList, isId, id, oneOf, isoOrNull, dateOrNull, num, profilePatch, userPatch, advance, setLink, systemNote, openTicket, recordOutcome, hire };
