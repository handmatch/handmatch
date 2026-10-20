// A/B test (variant B: deposit now, balance at hire) end to end. Run on a fresh DB with AB_TEST=1.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const BASE = 'http://localhost:3010';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0; const failures = [];
const ok = (c, m) => { if (c) passed++; else { failures.push(m); console.log('  FAIL', m); } };

class C {
  constructor(n) { this.n = n; this.cookie = ''; }
  async req(method, path, body) {
    const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', Origin: BASE }, this.cookie ? { Cookie: this.cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let j = {}; try { j = await r.json(); } catch (e) { /* */ }
    return { status: r.status, body: j };
  }
  async login(email) {
    const before = fs.readFileSync(__dirname + '/dev.log', 'utf8').split('\n').filter((l) => l.includes('link for ' + email + ':')).length;
    await this.req('POST', '/api/auth?action=start', { email });
    let link;
    for (let i = 0; i < 40 && !link; i++) { const ls = fs.readFileSync(__dirname + '/dev.log', 'utf8').split('\n').filter((l) => l.includes('link for ' + email + ':')); if (ls.length > before) link = ls.pop().split(': ').pop(); else await sleep(100); }
    return (await this.req('POST', '/api/auth?action=verify', { token: new URL(link).searchParams.get('token') })).body;
  }
  dash(v) { return this.req('GET', '/api/app?action=dashboard&view=' + v).then((r) => r.body); }
  act(a, b, v) { return this.req('POST', '/api/app?action=' + a + '&view=' + (v || ''), b || {}).then((r) => { if (r.status !== 200 && !this.quiet) console.log(`  [${this.n}] ${a} → ${r.status} ${r.body.error}`); return r; }); }
}
async function hook(meta, amount) {
  const ev = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_' + crypto.randomBytes(5).toString('hex'), amount_total: amount, customer_email: 'x@test.com', metadata: meta } } });
  const t = Math.floor(Date.now() / 1000);
  const r = await fetch(BASE + '/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(t + '.' + ev).digest('hex')}` }, body: ev });
  return r.status;
}
async function buyB(name, email, zip, variant) {
  const anon = new C('anon');
  const rq = await anon.req('POST', '/api/requests', { help_type: 'Housekeeper', location: zip, budget_per_hour: 22, days: ['Wed'], variant });
  const co = await anon.req('POST', '/api/checkout', { full_name: name, phone: '+1 646 555 0101', email, hires: 1, request_id: rq.body.id, variant });
  const id = new URL(BASE + co.body.url).searchParams.get('order_id');
  const ord = await anon.req('GET', '/api/order?order_id=' + id);
  await hook({ order_id: id, order_ref: ord.body.order_ref, full_name: name, hires: '1', fee_type: variant === 'B' ? 'deposit' : 'full', variant }, ord.body.amount_cents);
  return ord.body;
}
async function activeApplicant(admin, email, name) {
  const anon = new C('anon');
  await anon.req('POST', '/api/helpers', { full_name: name, email, phone: '+1 917 555 01' + Math.floor(Math.random() * 90 + 10), city: 'Brooklyn 11215', roles: ['Housekeeper'], rate: '21', background_check_consent: true });
  const a = new C(name); await a.login(email);
  await a.act('save_profile', { full_name: name, zip: '11215', role_type: 'housekeeper', background_consent: true, submit: true }, 'applicant');
  const r = await admin.dash('recruiter');
  const uid = r.data.applicants.find((x) => x.email === email).user_id;
  await admin.act('update_applicant', { user_id: uid, pipeline_stage: 'active', check_interview: true, check_id: true, check_references: true }, 'recruiter');
  return { a, uid };
}
async function toCleared(admin, fam, app, placementId) {
  await admin.act('add_applicant', { placement_id: placementId, applicant_user_id: app.uid }, 'concierge');
  const ad = await app.a.dash('applicant');
  const req = ad.data.requests.find((r) => r.placement_id === placementId);
  await app.a.act('respond', { id: req.id, accept: true }, 'applicant');
  const fd = await fam.dash('family');
  const fa = fd.data.placements.find((p) => p.id === placementId).applicants.find((x) => x.user_id === app.uid);
  await fam.act('request_meeting', { link_id: fa.link_id, kind: 'phone', preferred_times: 'Any morning' }, 'family');
  const c = await admin.dash('concierge');
  const m = c.data.agenda.to_schedule.find((x) => x.link_id === fa.link_id);
  await admin.act('schedule_meeting', { meeting_id: m.id, kind: 'phone', start_at: new Date(Date.now() - 3600e3).toISOString() }, 'concierge');
  await fam.act('record_outcome', { meeting_id: m.id, outcome: 'pass' }, 'family');
  const comp = await admin.dash('compliance');
  const t = comp.data.tickets.find((x) => x.applicant.id === app.uid && x.status === 'ready_review');
  if (t.reusable) await admin.act('reuse_check', { id: t.id }, 'compliance');
  else { await admin.act('order_check', { id: t.id, provider: 'Checkr' }, 'compliance'); await admin.act('update_check', { id: t.id, status: 'clear' }, 'compliance'); }
  return fa.link_id;
}

(async () => {
  console.log('1. Assignment');
  const a1 = await (await fetch(BASE + '/api/ab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant: 'B', path: '/' }) })).json();
  ok(a1.on && a1.variant === 'B', 'forced variant B');
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add((await (await fetch(BASE + '/api/ab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"path":"/"}' })).json()).variant);
  ok(seen.has('A') && seen.has('B'), 'random split gives both variants');

  console.log('2. Variant B checkout = deposit');
  const admin = new C('admin'); await admin.login('marvin@test.com');
  const o = await buyB('Jordan Lee', 'jordan@test.com', '11215', 'B');
  ok(o.amount_cents === 4900 && o.fee_type === 'deposit', 'B order is a $49 deposit');
  const oa = await buyB('Avery Stone', 'avery@test.com', '11201', 'A');
  ok(oa.amount_cents === 34900 && oa.fee_type === 'full', 'A order is $349');
  const fam = new C('family'); await fam.login('jordan@test.com');
  let fd = await fam.dash('family');
  let pl = fd.data.placements[0];
  ok(pl.fee_model === 'deposit' && pl.balance_cents === 30000, 'B placement on deposit model');
  ok(pl.refund_preview.percent === 100 && pl.refund_preview.amount_cents === 4900, 'deposit fully refundable before applicants are shared');

  console.log('3. Cleared applicant → balance required');
  const cec = await activeApplicant(admin, 'cecile@test.com', 'Cecile Pascual');
  const linkId = await toCleared(admin, fam, cec, pl.id);
  fd = await fam.dash('family');
  pl = fd.data.placements[0];
  const fa = pl.applicants.find((x) => x.link_id === linkId);
  ok(fa.status === 'cleared' && fa.balance_due === true, 'family sees balance due');
  ok(pl.refund_preview.percent === 0 && pl.refund_preview.rule === 'deposit_shared', 'deposit not refundable after applicants shared');
  fam.quiet = true;
  let x = await fam.act('hire', { link_id: linkId }, 'family');
  ok(x.status === 400 && /balance/.test(x.body.error), 'plain hire blocked until balance is paid');
  fam.quiet = false;
  x = await fam.act('pay_balance', { link_id: linkId }, 'family');
  ok(x.status === 200 && x.body.result.pending === true, 'no Stripe here → team will send a link');
  let fin = await admin.dash('finance');
  const bal = fin.data.orders.find((q) => q.fee_type === 'balance');
  ok(bal && bal.status === 'pending' && bal.amount_cents === 30000, 'pending $300 balance order created');
  const c = await admin.dash('concierge');
  ok(c.data.placements.find((p) => p.id === pl.id).applicants.find((q) => q.id === linkId).balance_due, 'Concierge sees balance due');

  if (process.env.STOP_AFTER === '3') { console.log(passed + ' passed (stopped after 3)'); process.exit(0); }
  console.log('4. Balance paid via Stripe webhook → hired');
  ok(await hook({ order_id: bal.id, order_ref: bal.ref, full_name: 'Jordan Lee', fee_type: 'balance', variant: 'B', hires: '1' }, 30000) === 200, 'balance webhook 200');
  fd = await fam.dash('family');
  const hired = fd.data.placements[0].applicants.find((q) => q.link_id === linkId);
  ok(hired.status === 'hired' && hired.contact && hired.contact.phone, 'hired after balance; contact shared');

  console.log('5. Replacement is free');
  await fam.act('request_replacement', { link_id: linkId, reason: 'Schedule changed' }, 'family');
  await admin.act('start_replacement', { link_id: linkId }, 'concierge');
  const rosa = await activeApplicant(admin, 'rosa@test.com', 'Rosa Diaz');
  const link2 = await toCleared(admin, fam, rosa, pl.id);
  fd = await fam.dash('family');
  ok(fd.data.placements[0].applicants.find((q) => q.link_id === link2).balance_due === false, 'no balance for a replacement');
  x = await fam.act('hire', { link_id: link2 }, 'family');
  ok(x.status === 200, 'replacement hired without paying again');

  console.log('6. Manual "mark balance paid"');
  const o3 = await buyB('Sam Park', 'sam@test.com', '11215', 'B');
  const fam3 = new C('family3'); await fam3.login('sam@test.com');
  const pl3 = (await fam3.dash('family')).data.placements[0];
  const joy = await activeApplicant(admin, 'joy@test.com', 'Joy Reyes');
  const link3 = await toCleared(admin, fam3, joy, pl3.id);
  x = await admin.act('mark_balance_paid', { link_id: link3, reference: 'Zelle 123' }, 'finance');
  ok(x.status === 200, 'Finance marks balance paid');
  ok((await fam3.dash('family')).data.placements[0].applicants.find((q) => q.link_id === link3).status === 'hired', 'hire confirmed');
  fam3.quiet = true;
  x = await fam3.act('mark_balance_paid', { link_id: link3 }, 'family');
  ok(x.status === 403, 'families cannot mark balances paid');

  console.log('7. A variant unchanged');
  const famA = new C('familyA'); await famA.login('avery@test.com');
  const plA = (await famA.dash('family')).data.placements[0];
  ok(plA.fee_model === 'full' && plA.refund_preview.percent === 100, 'A placement on full model');

  console.log('8. Finance A/B panel');
  fin = await admin.dash('finance');
  const ab = fin.data.ab;
  ok(ab && ab.B.paid_starts === 2 && ab.A.paid_starts === 1, 'starts counted per variant');
  ok(ab.B.balances === 2 && ab.B.hires === 2, 'balances and hires counted for B');
  ok(ab.B.revenue_cents === 4900 * 2 + 30000 * 2 && ab.A.revenue_cents === 34900, 'revenue per variant');
  ok(ab.A.visitors + ab.B.visitors >= 20 && ab.B.preferences >= 2, 'visitors and preferences counted (forced visits excluded)');

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
