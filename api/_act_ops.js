// Actions for the handmatch Recruiter (supply side), Finance and Admin.
'use strict';
const { env, db, insert, update, clean, isEmail, badRequest } = require('./_lib');
const A = require('./_app');
const R = require('./_rules');

const STAGES = ['lead', 'contacted', 'screening', 'interviewed', 'checks', 'active', 'paused', 'rejected'];
const SOURCES = ['website', 'referral', 'facebook', 'indeed', 'craigslist', 'walk_in', 'agency', 'invite', 'other'];
const PROFILE_STATUS = ['draft', 'submitted', 'active', 'paused'];
const STAGE_LABEL = { lead: 'Lead', contacted: 'Contacted', screening: 'Screening booked', interviewed: 'Interviewed', checks: 'ID & references', active: 'Active', paused: 'Paused', rejected: 'Not a fit' };

function readyToActivate(prof, user) {
  const missing = [];
  if (!user.full_name) missing.push('name');
  if (!prof.zip) missing.push('ZIP code');
  if (!prof.check_interview) missing.push('screening interview');
  if (!prof.check_id) missing.push('ID check');
  if (!prof.check_references) missing.push('references');
  if (!prof.background_consent) missing.push('background check consent');
  return missing;
}

// Tiny CSV reader (handles quoted values).
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cur.trim()); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows.filter((r) => r.some(Boolean));
}

async function createLead(actor, d, terrList) {
  const email = A.normEmail(d.email);
  if (!isEmail(email)) return { skipped: 'no valid email' };
  let u = await A.userByEmail(email);
  if (u && A.first(await db('applicant_profiles?select=user_id&user_id=' + A.eq(u.id)))) return { skipped: 'already exists', user: u };
  if (u) u = await A.addRoles(u, ['applicant']);
  else u = await insert('users', { email, roles: ['applicant'], full_name: clean(d.full_name, 120), phone: clean(d.phone, 40) });
  const zip = /^\d{5}$/.test(String(d.zip || '')) ? String(d.zip) : '';
  const t = A.territoryFor(zip, terrList);
  await insert('applicant_profiles', {
    user_id: u.id, role_type: A.ROLE_TYPES.includes(d.role_type) ? d.role_type : A.roleTypeFrom(d.role_type || 'housekeeper'),
    zip, city: clean(d.city, 80), territory_code: t ? t.code : '', pipeline_stage: 'lead',
    source: SOURCES.includes(d.source) ? d.source : (d.source ? 'other' : 'other'), recruiter_user_id: actor.id, team_notes: clean(d.notes, 2000)
  });
  await A.pipelineEvent(u.id, 'created', `Added by ${actor.full_name || actor.email}${d.source ? ' (source: ' + d.source + ')' : ''}.`, actor.id);
  return { created: true, user: u };
}

async function stripeRefund(order, amount) {
  const key = env('STRIPE_SECRET_KEY');
  if (!key || !order.stripe_session_id) return null;
  const auth = { Authorization: 'Bearer ' + key };
  const s = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(order.stripe_session_id), { headers: auth }).then((r) => r.json());
  if (!s || !s.payment_intent) throw badRequest('Stripe couldn’t find the payment for this order. Refund it in Stripe and use “Mark refunded manually”.');
  const r = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, auth),
    body: 'payment_intent=' + encodeURIComponent(s.payment_intent) + '&amount=' + amount + '&metadata[order_ref]=' + encodeURIComponent(order.order_ref || '')
  });
  const j = await r.json();
  if (!r.ok) throw badRequest('Stripe refused the refund: ' + ((j.error && j.error.message) || r.status));
  return j.id;
}

const ACTIONS = {
  // -------------------------------------------------------------- Recruiter
  async add_lead(user, b) {
    A.need(user, 'recruiter');
    const res = await createLead(user, b, await A.territories());
    if (res.skipped) throw badRequest(res.skipped === 'already exists' ? 'This email is already in the pipeline.' : 'Enter a valid email address.');
    if (b.invite) await A.sendLoginLink(res.user, { subject: 'You’re invited to join handmatch', intro: 'You’re invited to create your handmatch profile, so families near you can meet you.' });
    return { user_id: res.user.id };
  },

  async import_leads(user, b) {
    A.need(user, 'recruiter');
    const rows = parseCsv(String(b.csv || '').slice(0, 200000));
    if (!rows.length) throw badRequest('Paste at least one row: name, email, phone, role, ZIP, source.');
    const header = rows[0].map((h) => h.toLowerCase());
    const hasHeader = header.includes('email');
    const col = (name, i) => (hasHeader ? header.indexOf(name) : i);
    const idx = { full_name: hasHeader ? Math.max(header.indexOf('name'), header.indexOf('full_name')) : 0, email: col('email', 1), phone: col('phone', 2), role_type: hasHeader ? Math.max(header.indexOf('role'), header.indexOf('role_type')) : 3, zip: col('zip', 4), source: col('source', 5) };
    const terrList = await A.territories();
    let created = 0; const skipped = [];
    for (const r of (hasHeader ? rows.slice(1) : rows).slice(0, 500)) {
      const d = Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, i >= 0 ? r[i] || '' : '']));
      d.source = String(d.source || b.source || '').toLowerCase().replace(/[\s-]+/g, '_');
      const res = await createLead(user, d, terrList);
      if (res.created) created++; else skipped.push((d.email || '(no email)') + ': ' + res.skipped);
    }
    return { created, skipped };
  },

  async import_applications(user) {
    A.need(user, 'recruiter');
    const helpers = (await db('helpers?select=*&order=created_at.desc&limit=1000')) || [];
    const terrList = await A.territories();
    let created = 0;
    for (const h of helpers) {
      const u = await A.userByEmail(h.email);
      if (u && A.first(await db('applicant_profiles?select=user_id&user_id=' + A.eq(u.id)))) continue;
      await A.applicantFromHelper(h, terrList); created++;
    }
    return { created };
  },

  async update_applicant(user, b) {
    A.need(user, 'recruiter');
    const app = await A.userById(R.id(b.user_id, 'applicant'));
    if (!app || !A.hasRole(app, 'applicant')) throw A.notFound();
    const up = R.userPatch(b, { staff: true });
    if ('disabled' in b) up.disabled = !!b.disabled;
    if ('email' in b && A.normEmail(b.email) !== app.email) {
      const e = A.normEmail(b.email);
      if (!isEmail(e)) throw badRequest('Enter a valid email.');
      if (await A.userByEmail(e)) throw badRequest('Another account already uses this email.');
      up.email = e;
    }
    const current = A.first(await db('applicant_profiles?select=*&user_id=' + A.eq(app.id))) || await insert('applicant_profiles', { user_id: app.id });
    const patch = R.profilePatch(b, await A.territories());
    for (const k of ['check_interview', 'check_id', 'check_references']) if (k in b) patch[k] = !!b[k];
    if ('team_notes' in b) patch.team_notes = clean(b.team_notes, 4000);
    if ('source' in b) patch.source = b.source ? R.oneOf(b.source, SOURCES, 'Unknown source.') : '';
    if ('next_step' in b) patch.next_step = clean(b.next_step, 200);
    if ('screening_at' in b) patch.screening_at = R.isoOrNull(b.screening_at, 'Enter a valid screening time.');
    if ('recruiter_user_id' in b) patch.recruiter_user_id = R.isId(b.recruiter_user_id) ? b.recruiter_user_id : null;
    if ('status' in b) patch.status = R.oneOf(b.status, PROFILE_STATUS, 'Unknown status.');
    let stage = 'pipeline_stage' in b ? R.oneOf(b.pipeline_stage, STAGES, 'Unknown stage.') : null;
    if (patch.status === 'active' && !stage) stage = 'active';
    if (stage === 'active' || patch.status === 'active') {
      const merged = Object.assign({}, current, patch);
      const missing = readyToActivate(merged, Object.assign({}, app, up));
      if (missing.length) throw badRequest('Before activating, complete: ' + missing.join(', ') + '.');
      patch.status = 'active';
      patch.availability_updated_at = A.now();
    }
    if (stage === 'paused' || stage === 'rejected') patch.status = 'paused';
    if (stage === 'screening' && !patch.screening_at && !current.screening_at) throw badRequest('Set the screening interview time.');
    if (stage === 'interviewed') patch.check_interview = true;
    if (stage) patch.pipeline_stage = stage;
    if (stage === 'contacted' && current.pipeline_stage !== 'contacted') patch.last_contacted_at = A.now();
    if (!current.recruiter_user_id && !('recruiter_user_id' in patch)) patch.recruiter_user_id = user.id;
    patch.updated_at = A.now();
    if (Object.keys(up).length) await update('users', 'id=' + A.eq(app.id), up);
    await update('applicant_profiles', 'user_id=' + A.eq(app.id), patch);
    if (stage && stage !== current.pipeline_stage) {
      await A.pipelineEvent(app.id, 'stage', `Moved to ${STAGE_LABEL[stage]}.`, user.id);
      if (stage === 'active') {
        await A.notify(app, 'Your handmatch profile is active', ['Welcome to handmatch! Your profile is approved, so we can now match you with families near you.', 'Keep your availability up to date.']);
        // Fill open supply requests for this territory and type.
        const prof = Object.assign({}, current, patch);
        const open = (await db('supply_requests?select=*&status=in.(open,in_progress)&territory_code=' + A.eq(prof.territory_code || '-') + '&role_type=' + A.eq(prof.role_type))) || [];
        const active = (await db('applicant_profiles?select=user_id&status=eq.active&territory_code=' + A.eq(prof.territory_code || '-') + '&role_type=' + A.eq(prof.role_type))) || [];
        for (const sr of open) if (active.length >= sr.needed) await update('supply_requests', 'id=' + A.eq(sr.id), { status: 'filled', updated_at: A.now() });
        // Referral: the referred person joined.
        const ref = A.first(await db('referrals?select=*&lead_user_id=' + A.eq(app.id) + '&status=in.(new,contacted)'));
        if (ref) await update('referrals', 'id=' + A.eq(ref.id), { status: 'joined', updated_at: A.now() });
      }
      if (stage === 'screening') {
        const when = patch.screening_at || current.screening_at;
        await A.notify(app, 'Your handmatch screening interview', [`Your screening interview is set for ${A.fmtWhen(when)}. We’ll call you on ${app.phone || 'your phone'}.`]);
      }
    }
  },

  async pipeline_note(user, b) {
    A.need(user, 'recruiter');
    const app = await A.userById(R.id(b.user_id, 'applicant'));
    if (!app) throw A.notFound();
    const body = clean(b.body, 1000);
    if (!body) throw badRequest('Write a note first.');
    await A.pipelineEvent(app.id, b.kind === 'contact' ? 'contact' : 'note', body, user.id);
    if (b.kind === 'contact') await update('applicant_profiles', 'user_id=' + A.eq(app.id), { last_contacted_at: A.now() });
  },

  async invite_applicant(user, b) {
    A.need(user, 'recruiter');
    const app = await A.userById(R.id(b.user_id, 'applicant'));
    if (!app || !A.hasRole(app, 'applicant')) throw A.notFound();
    await A.sendLoginLink(app, { subject: 'Finish your handmatch profile', intro: 'Sign in to finish your handmatch profile, so families near you can meet you.' });
    await A.pipelineEvent(app.id, 'invite', 'Sent a sign-in link.', user.id);
  },

  async update_supply_request(user, b) {
    A.need(user, 'recruiter', 'concierge');
    const sr = A.first(await db('supply_requests?select=*&id=' + A.eq(R.id(b.id, 'request'))));
    if (!sr) throw A.notFound();
    const patch = { updated_at: A.now() };
    if ('status' in b) patch.status = R.oneOf(b.status, ['open', 'in_progress', 'filled', 'cancelled'], 'Unknown status.');
    if ('assignee_user_id' in b) patch.assignee_user_id = R.isId(b.assignee_user_id) ? b.assignee_user_id : null;
    if (patch.status === 'in_progress' && !sr.assignee_user_id && !patch.assignee_user_id) patch.assignee_user_id = user.id;
    await update('supply_requests', 'id=' + A.eq(sr.id), patch);
  },

  async update_referral(user, b) {
    A.need(user, 'recruiter');
    const r = A.first(await db('referrals?select=*&id=' + A.eq(R.id(b.id, 'referral'))));
    if (!r) throw A.notFound();
    const patch = { updated_at: A.now() };
    if ('status' in b) patch.status = R.oneOf(b.status, ['new', 'contacted', 'joined', 'hired', 'not_eligible'], 'Unknown status.');
    if ('notes' in b) patch.notes = clean(b.notes, 1000);
    if (patch.status === 'hired' && !r.bonus_cents) patch.bonus_cents = Number(env('REFERRAL_BONUS_CENTS')) || 5000;
    await update('referrals', 'id=' + A.eq(r.id), patch);
  },

  async pause_stale(user) {
    A.need(user, 'recruiter');
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    const stale = (await db('applicant_profiles?select=*&status=eq.active&availability_updated_at=lt.' + encodeURIComponent(cutoff))) || [];
    for (const p of stale) {
      await update('applicant_profiles', 'user_id=' + A.eq(p.user_id), { status: 'paused', pipeline_stage: 'paused', updated_at: A.now() });
      await A.pipelineEvent(p.user_id, 'stage', 'Paused automatically: availability not updated in 30 days.', user.id);
      await A.notify(await A.userById(p.user_id), 'Your handmatch profile is paused', ['You haven’t updated your availability in 30 days, so we’ve paused your profile.', 'Sign in and update your days and hours to get matched again.'], 'Update availability');
    }
    return { paused: stale.length };
  },

  // ---------------------------------------------------------------- Finance
  async decide_refund(user, b) {
    A.need(user, 'finance');
    const r = A.first(await db('refunds?select=*&id=' + A.eq(R.id(b.id, 'refund'))));
    if (!r) throw A.notFound();
    if (r.status !== 'requested') throw badRequest('This refund was already decided.');
    const decision = R.oneOf(b.decision, ['approve', 'deny'], 'Approve or deny.');
    const note = clean(b.note, 1000);
    const order = A.first(await db('orders?select=*&id=' + A.eq(r.order_id)));
    const p = r.placement_id ? A.first(await db('placements?select=*&id=' + A.eq(r.placement_id))) : null;
    if (decision === 'deny') {
      if (!note) throw badRequest('Add a short reason for the family.');
      await update('refunds', 'id=' + A.eq(r.id), { status: 'denied', decided_by: user.id, decided_at: A.now(), decision_note: note, updated_at: A.now() });
      if (p) await A.addEvent(p.id, 'refund_denied', 'Your refund request was reviewed: ' + note, { actor: user.id });
      await A.notify(await A.userById(r.family_user_id), 'Your handmatch refund request', ['We’ve reviewed your refund request.', note, 'Reply to this email if you have questions.']);
      return;
    }
    const paid = Number(order && (order.amount_paid_cents || order.amount_cents)) || 0;
    const left = paid - (Number(order && order.refunded_cents) || 0);
    const amount = b.amount === '' || b.amount == null ? r.amount_cents : Math.round(Number(b.amount) * 100);
    if (!(amount > 0) || amount > left) throw badRequest(`Enter an amount between $0.01 and $${(left / 100).toFixed(2)}.`);
    const el = r.eligibility || {};
    if (amount > (el.amount_cents || 0) && !note) throw badRequest('This is more than the policy amount. Add a note explaining the exception.');
    await update('refunds', 'id=' + A.eq(r.id), { status: 'approved', amount_cents: amount, percent: paid ? Math.round(amount / paid * 100) : 0, decided_by: user.id, decided_at: A.now(), decision_note: note, updated_at: A.now() });
  },

  async pay_refund(user, b) {
    A.need(user, 'finance');
    const r = A.first(await db('refunds?select=*&id=' + A.eq(R.id(b.id, 'refund'))));
    if (!r) throw A.notFound();
    if (r.status !== 'approved') throw badRequest('Approve the refund first.');
    const order = A.first(await db('orders?select=*&id=' + A.eq(r.order_id)));
    if (!order) throw badRequest('Order not found.');
    let stripeId = '';
    if (b.manual) stripeId = clean(b.reference, 120) || 'manual';
    else {
      stripeId = await stripeRefund(order, r.amount_cents);
      if (!stripeId) throw badRequest('Stripe isn’t connected for this order. Refund it in Stripe, then use “Mark refunded manually”.');
    }
    const refunded = (Number(order.refunded_cents) || 0) + r.amount_cents;
    const paid = Number(order.amount_paid_cents || order.amount_cents) || 0;
    await update('refunds', 'id=' + A.eq(r.id), { status: 'refunded', stripe_refund_id: stripeId, refunded_at: A.now(), updated_at: A.now() });
    await update('orders', 'id=' + A.eq(order.id), { refunded_cents: refunded, status: refunded >= paid ? 'refunded' : order.status });
    const p = r.placement_id ? A.first(await db('placements?select=*&id=' + A.eq(r.placement_id))) : null;
    const money = '$' + (r.amount_cents / 100).toFixed(2);
    if (p) {
      await A.addEvent(p.id, 'refunded', `We’ve refunded ${money}. It can take 5 to 10 business days to appear on your statement.`, { actor: user.id });
      if (refunded >= paid && p.status !== 'closed') await update('placements', 'id=' + A.eq(p.id), { status: 'closed', closed_at: A.now(), updated_at: A.now() });
    }
    await A.notify(await A.userById(r.family_user_id), 'Your handmatch refund is on its way', [`We’ve refunded ${money} for order ${order.order_ref}.`, 'It can take 5 to 10 business days to appear on your statement.']);
  },

  async create_refund(user, b) {
    A.need(user, 'finance');
    const order = A.first(await db('orders?select=*&id=' + A.eq(R.id(b.order_id, 'order'))));
    if (!order || !['paid', 'refunded'].includes(order.status)) throw badRequest('Choose a paid order.');
    const p = A.first(await db('placements?select=*&order_id=' + A.eq(order.id)));
    const links = p ? (await db('placement_applicants?select=*&placement_id=' + A.eq(p.id))) || [] : [];
    const el = A.refundEligibility({ order, placement: p, links, refunds: (await db('refunds?select=*&order_id=' + A.eq(order.id))) || [] });
    const fam = await A.userByEmail(order.email);
    const r = await insert('refunds', { order_id: order.id, placement_id: p ? p.id : null, family_user_id: fam ? fam.id : null, requested_by: user.id, reason: clean(b.reason, 1000) || 'Opened by Finance', percent: el.percent, amount_cents: el.amount_cents, status: 'requested', eligibility: el });
    return { refund_id: r.id };
  },

  // Variant B: the family paid the balance outside the app (or Stripe isn't connected). Confirms the hire.
  async mark_balance_paid(user, b) {
    A.need(user, 'finance', 'concierge');
    const link = await A.linkById(R.id(b.link_id, 'applicant'));
    const p = await A.placementById(link.placement_id);
    if (p.fee_model !== 'deposit') throw badRequest('This placement isn’t on the deposit model.');
    const fam = await A.userById(p.family_user_id);
    let order = A.first(await db('orders?select=*&placement_applicant_id=' + A.eq(link.id) + '&fee_type=eq.balance&order=created_at.desc&limit=1'));
    if (!order) {
      order = await insert('orders', {
        order_ref: 'HM-' + require('crypto').randomBytes(3).toString('hex').toUpperCase(), full_name: fam.full_name || fam.email, phone: fam.phone || '', email: fam.email,
        hires: 1, amount_cents: A.balanceCents(), status: 'pending', fee_type: 'balance', variant: 'B', placement_id: p.id, placement_applicant_id: link.id
      });
    }
    await R.completeBalance(order, user, { reference: clean(b.reference, 120) || 'marked by ' + (user.full_name || user.email) });
  },

  async pay_bonus(user, b) {
    A.need(user, 'finance');
    const r = A.first(await db('referrals?select=*&id=' + A.eq(R.id(b.id, 'referral'))));
    if (!r || r.status !== 'hired') throw badRequest('Only hired referrals can be paid.');
    await update('referrals', 'id=' + A.eq(r.id), { status: 'bonus_paid', paid_at: A.now(), notes: (r.notes ? r.notes + '\n' : '') + 'Paid: ' + clean(b.reference, 120), updated_at: A.now() });
    await A.notify(await A.userById(r.referrer_user_id), 'Your handmatch referral bonus', [`Thank you for referring ${r.name}! Your $${(r.bonus_cents / 100).toFixed(0)} bonus has been paid.`]);
  },

  // ------------------------------------------------------------------ Admin
  async invite_team(user, b) {
    A.need(user, 'admin');
    const email = A.normEmail(b.email);
    if (!isEmail(email)) throw badRequest('Enter a valid email.');
    const roles = R.toList(b.roles, 5).filter((r) => A.STAFF.includes(r));
    if (!roles.length) throw badRequest('Choose at least one team role.');
    let u = await A.userByEmail(email);
    if (u) u = await A.addRoles(u, roles);
    else u = await insert('users', Object.assign({ email, roles }, R.userPatch(b, { staff: true })));
    await A.sendLoginLink(u, { subject: 'You’ve been added to the handmatch team', intro: `You’ve been added to the handmatch team (${roles.map((r) => A.ROLE_NAMES[r]).join(', ')}).` });
    return { user_id: u.id };
  },

  async update_team(user, b) {
    A.need(user, 'admin');
    const u = await A.userById(R.id(b.user_id, 'team member'));
    if (!u) throw A.notFound();
    const patch = R.userPatch(b, { staff: true });
    if ('roles' in b) {
      const keep = A.rolesOf(u).filter((r) => !A.STAFF.includes(r));
      const staff = R.toList(b.roles, 5).filter((r) => A.STAFF.includes(r));
      if (u.id === user.id && !staff.includes('admin')) throw badRequest('You can’t remove your own Admin role.');
      patch.roles = keep.concat(staff);
    }
    if ('disabled' in b) {
      if (u.id === user.id && b.disabled) throw badRequest('You can’t disable your own account.');
      patch.disabled = !!b.disabled;
    }
    if (patch.roles && !patch.roles.includes('admin') && A.rolesOf(u).includes('admin')) {
      const admins = (await A.staffUsers()).filter((x) => A.rolesOf(x).includes('admin'));
      if (admins.length <= 1) throw badRequest('Keep at least one Admin.');
    }
    await update('users', 'id=' + A.eq(u.id), patch);
  },

  async send_login_link(user, b) {
    A.need(user, 'admin');
    const u = await A.userById(R.id(b.user_id, 'person'));
    if (!u) throw A.notFound();
    await A.sendLoginLink(u, { subject: 'Your handmatch sign-in link' });
  }
};

module.exports = { ACTIONS, parseCsv, readyToActivate };
