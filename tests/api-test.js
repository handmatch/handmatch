// End-to-end API test against real Postgres + PostgREST. Run: node api-test.js
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const BASE = 'http://localhost:3010';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0; const failures = [];
function ok(cond, msg) { if (cond) { passed++; } else { failures.push(msg); console.log('  FAIL', msg); } }

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(method, path, body) {
    const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json', Origin: BASE }, this.cookie ? { Cookie: this.cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let j = {}; try { j = await r.json(); } catch (e) { /* */ }
    return { status: r.status, body: j };
  }
  async login(email) {
    const s = await this.req('POST', '/api/auth?action=start', { email });
    if (s.status !== 200) throw new Error('start failed ' + JSON.stringify(s));
    let link;
    for (let i = 0; i < 40 && !link; i++) {
      const lines = fs.readFileSync(__dirname + '/dev.log', 'utf8').split('\n').filter((l) => l.includes('sign-in link for ' + email + ':'));
      if (lines.length) link = lines.pop().split(': ').pop().trim(); else await sleep(100);
    }
    if (!link) return false;
    const token = new URL(link).searchParams.get('token');
    const v = await this.req('POST', '/api/auth?action=verify', { token });
    return v.status === 200 ? v.body : false;
  }
  dash(view) { return this.req('GET', '/api/app?action=dashboard&view=' + view).then((r) => r.body); }
  async act(action, body, view) {
    const r = await this.req('POST', '/api/app?action=' + action + '&view=' + (view || ''), body || {});
    if (r.status !== 200 && !this.expectFail) console.log(`  [${this.name}] ${action} → ${r.status} ${r.body.error}`);
    return r;
  }
}

async function webhookPaid(orderId, ref) {
  const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_test_' + crypto.randomBytes(4).toString('hex'), amount_total: 34900, customer_email: 'x@test.com', metadata: { order_id: orderId, order_ref: ref, full_name: 'Jordan Lee', hires: '1' } } } };
  const raw = JSON.stringify(event); const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_test').update(t + '.' + raw).digest('hex');
  const r = await fetch(BASE + '/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw });
  return r.status;
}

async function family(name, email, zip, help) {
  const anon = new Client('anon');
  const rq = await anon.req('POST', '/api/requests', { help_type: help, services: ['Regular home cleaning'], days: ['Wed', 'Fri'], frequency: 'Every 2 weeks', budget_per_hour: 22, location: zip, home_size: '2 bedrooms' });
  const co = await anon.req('POST', '/api/checkout', { full_name: name, phone: '+1 646 555 0101', email, hires: 1, request_id: rq.body.id });
  const orderId = new URL(BASE + co.body.url).searchParams.get('order_id');
  return { orderId, requestId: rq.body.id };
}

(async () => {
  console.log('1. Admin signs in');
  const admin = new Client('admin');
  const li = await admin.login('marvin@test.com');
  ok(li && li.views.includes('admin') && li.views.includes('concierge') && li.views.includes('compliance'), 'admin gets all team views');
  await admin.act('update_me', { full_name: 'Marvin Perol', phone: '+1 646 661 2206', photo_url: '/assets/img/marvin-founder.jpg', title: 'Founder · handmatch Concierge' });

  console.log('2. Family pays (checkout → Stripe webhook)');
  const f1 = await family('Jordan Lee', 'jordan@test.com', '11215', 'Housekeeper');
  ok(!!f1.orderId, 'order created');
  ok(await webhookPaid(f1.orderId, 'HM-T1') === 200, 'webhook 200');
  let c = await admin.dash('concierge');
  ok(c.data.placements.length === 1, 'placement opened from paid order');
  const pl = c.data.placements[0];
  ok(pl.territory_code === 'NY' && pl.concierge_user_id === li && true || pl.territory_code === 'NY', 'placement territory NY');
  ok(!!pl.concierge_thread_id, 'concierge thread created');
  let r = await admin.dash('recruiter');
  ok(r.data.supply.some((s) => s.territory_code === 'NY' && s.role_type === 'housekeeper'), 'automatic supply request when supply is low');

  console.log('3. Applicant applies on /join and signs in');
  const anon = new Client('anon');
  await anon.req('POST', '/api/helpers', { full_name: 'Cecile Pascual', email: 'cecile@test.com', phone: '+1 917 555 0199', city: 'Brooklyn 11215', roles: ['Housekeeper'], services: ['Laundry'], days: ['Wed', 'Fri'], rate: '21', background_check_consent: true });
  const app = new Client('applicant');
  const al = await app.login('cecile@test.com');
  ok(al && al.views.length === 1 && al.views[0] === 'applicant', 'applicant only sees applicant view');
  let ad = await app.dash('concierge');
  ok(ad.view === 'applicant' && !ad.data.placements, 'applicant cannot open concierge view');
  let x = await app.act('save_profile', { full_name: 'Cecile Pascual', phone: '+1 917 555 0199', zip: '11215', role_type: 'housekeeper', rate: 21, years: 4, start_in_days: 3, languages: 'English, Tagalog', skills: ['Laundry', 'Cooking'], days: ['Wed', 'Fri'], hours: '8 AM to 4 PM', bio: 'Warm, reliable housekeeper.', background_consent: true, submit: true }, 'applicant');
  ok(x.status === 200 && x.body.data.profile.status === 'submitted' && x.body.data.profile.territory_code === 'NY', 'applicant submits profile (territory NY)');

  console.log('4. Recruiter vets and activates');
  r = await admin.dash('recruiter');
  const cec = r.data.applicants.find((a) => a.email === 'cecile@test.com');
  ok(cec && cec.source === 'website', 'website application in pipeline');
  admin.expectFail = true;
  x = await admin.act('update_applicant', { user_id: cec.user_id, pipeline_stage: 'active' }, 'recruiter');
  ok(x.status === 400 && /screening interview/.test(x.body.error), 'cannot activate before checks');
  admin.expectFail = false;
  x = await admin.act('update_applicant', { user_id: cec.user_id, pipeline_stage: 'screening', screening_at: new Date(Date.now() + 864e5).toISOString() }, 'recruiter');
  ok(x.status === 200, 'screening booked');
  x = await admin.act('update_applicant', { user_id: cec.user_id, pipeline_stage: 'interviewed', check_id: true, check_references: true, photo_url: '/assets/img/cecile-v2.jpg' }, 'recruiter');
  x = await admin.act('update_applicant', { user_id: cec.user_id, pipeline_stage: 'active' }, 'recruiter');
  ok(x.status === 200 && x.body.data.applicants.find((a) => a.user_id === cec.user_id).status === 'active', 'applicant active');
  await admin.act('pipeline_note', { user_id: cec.user_id, body: 'Great energy on the call.', kind: 'contact' }, 'recruiter');

  console.log('5. Concierge shares the applicant');
  c = await admin.dash('concierge');
  ok(c.data.placements[0].suggestions.some((s) => s.user_id === cec.user_id && s.score >= 60), 'applicant suggested with a good match score');
  x = await admin.act('add_applicant', { placement_id: pl.id, applicant_user_id: cec.user_id }, 'concierge');
  ok(x.status === 200, 'applicant added');
  await admin.act('log_call', { placement_id: pl.id, note: 'Loves cooking help.' }, 'concierge');

  console.log('6. Family signs in, applicant accepts');
  const fam = new Client('family');
  const fl = await fam.login('jordan@test.com');
  ok(fl && fl.views[0] === 'family', 'family signed in');
  let fd = await fam.dash('family');
  let fa = fd.data.placements[0].applicants[0];
  ok(fa && fa.status === 'waiting' && fa.name === 'Cecile P.' && !fa.contact, 'family sees short name, no contact details');
  ok(!JSON.stringify(fd).includes('cecile@test.com') && !JSON.stringify(fd).includes('917 555'), 'no applicant contact leaks before hire');
  ad = await app.dash('applicant');
  const reqId = ad.data.requests[0].id;
  ok(!JSON.stringify(ad).includes('jordan@test.com') && !JSON.stringify(ad).includes('646 555'), 'no family contact leaks to applicant before hire');
  x = await app.act('respond', { id: reqId, accept: true }, 'applicant');
  ok(x.status === 200 && x.body.data.requests[0].thread_id, 'applicant accepts; shared chat opened');

  console.log('7. Chat with masking');
  fd = await fam.dash('family');
  fa = fd.data.placements[0].applicants[0];
  x = await fam.req('POST', '/api/app?action=send_message', { thread_id: fa.thread_id, body: 'Hi Cecile! Call me at 646-555-0101 or jordan@test.com' });
  const lastMsg = x.body.thread.messages.pop();
  ok(/number hidden/.test(lastMsg.body) && /email hidden/.test(lastMsg.body), 'contact details masked before hire');
  x = await app.req('GET', '/api/app?action=thread&id=' + fd.data.placements[0].concierge_thread_id);
  ok(x.status === 404, 'applicant cannot read family–Concierge thread');
  x = await admin.req('POST', '/api/app?action=send_message', { thread_id: fa.thread_id, body: 'Team-only: family prefers mornings.', internal: true });
  x = await fam.req('GET', '/api/app?action=thread&id=' + fa.thread_id);
  ok(!x.body.thread.messages.some((m) => m.internal), 'family never sees team notes');
  fd = await fam.dash('family');
  ok(fd.data.threads.some((t) => t.unread >= 0), 'thread list with unread counts');

  console.log('8. Meetings: paid trial rules, video interview');
  fam.expectFail = true;
  x = await fam.act('request_meeting', { link_id: fa.link_id, kind: 'trial', preferred_times: 'Sat morning', trial_hours: 1, trial_rate: 20, supervised: true }, 'family');
  ok(x.status === 400, 'trial under 2 hours rejected');
  x = await fam.act('request_meeting', { link_id: fa.link_id, kind: 'trial', preferred_times: 'Sat morning', trial_hours: 3, trial_rate: 12, supervised: true }, 'family');
  ok(x.status === 400 && /minimum wage/.test(x.body.error), 'trial under minimum wage rejected');
  fam.expectFail = false;
  x = await fam.act('request_meeting', { link_id: fa.link_id, kind: 'video', preferred_times: 'Weekday evenings after 6', note: 'Two kids, one cat' }, 'family');
  ok(x.status === 200, 'video interview requested');
  c = await admin.dash('concierge');
  ok(c.data.agenda.to_schedule.length === 1, 'shows in Concierge agenda to schedule');
  const mtg = c.data.agenda.to_schedule[0];
  x = await admin.act('schedule_meeting', { meeting_id: mtg.id, kind: 'video', start_at: new Date(Date.now() - 3600e3).toISOString(), join_info: 'https://meet.google.com/abc-defg-hij' }, 'concierge');
  ok(x.status === 200, 'meeting confirmed');
  x = await app.act('confirm_meeting', { meeting_id: mtg.id, ok: true }, 'applicant');
  ok(x.status === 200 && x.body.data.requests[0].meetings[0].applicant_confirmed, 'applicant confirms');
  fd = await fam.dash('family');
  ok(fd.data.placements[0].applicants[0].meetings[0].join_info.includes('meet.google'), 'family sees join link once confirmed');

  console.log('9. Pass → Compliance ticket → background check → hire');
  x = await fam.act('record_outcome', { meeting_id: mtg.id, outcome: 'pass', note: 'Lovely with the kids' }, 'family');
  ok(x.status === 200 && x.body.data.placements[0].applicants[0].status === 'passed', 'family passes applicant');
  let comp = await admin.dash('compliance');
  ok(comp.data.tickets.length === 1 && comp.data.tickets[0].status === 'ready_review', 'compliance ticket opened');
  const tk = comp.data.tickets[0];
  ok(tk.checklist.consent && tk.checklist.identity && tk.checklist.references, 'checklist prefilled from vetting');
  fam.expectFail = true;
  x = await fam.act('hire', { link_id: fa.link_id }, 'family');
  ok(x.status === 400, 'cannot hire before check is clear');
  x = await fam.act('order_check', { id: tk.id, provider: 'Checkr' }, 'family');
  ok(x.status === 403, 'family cannot order checks');
  fam.expectFail = false;
  x = await admin.act('order_check', { id: tk.id, provider: 'Checkr', package: 'Essential', cost: 54.5, external_ref: 'chk_123' }, 'compliance');
  ok(x.status === 200 && x.body.data.tickets[0].status === 'ordered', 'check ordered');
  fd = await fam.dash('family');
  ok(fd.data.placements[0].applicants[0].status === 'check', 'family sees background check in progress');
  x = await admin.act('update_check', { id: tk.id, status: 'clear' }, 'compliance');
  ok(x.status === 200 && x.body.data.tickets[0].status === 'clear', 'check clear');
  fd = await fam.dash('family');
  ok(fd.data.placements[0].applicants[0].status === 'cleared', 'applicant cleared');
  x = await fam.act('hire', { link_id: fa.link_id }, 'family');
  ok(x.status === 200 && x.body.data.placements[0].applicants[0].contact.phone.includes('917'), 'hired; family now sees phone');
  ad = await app.dash('applicant');
  ok(ad.data.requests[0].family_contact && ad.data.requests[0].family_contact.phone.includes('646'), 'applicant now sees family phone');
  ok(ad.data.profile.check_background === 'clear', 'profile background clear');

  console.log('10. Support case + replacement');
  x = await fam.act('open_case', { placement_id: pl.id, type: 'safety', subject: 'Door left unlocked', description: 'Front door was unlocked after the visit.' }, 'family');
  ok(x.status === 200, 'safety case opened');
  c = await admin.dash('concierge');
  const cs = c.data.cases[0];
  ok(cs.priority === 'urgent' && new Date(cs.due_at) - Date.now() < 3700e3, 'safety case is urgent with 1-hour SLA');
  admin.expectFail = true;
  x = await admin.act('update_case', { id: cs.id, status: 'resolved' }, 'concierge');
  ok(x.status === 400, 'resolve requires a resolution');
  admin.expectFail = false;
  x = await admin.act('update_case', { id: cs.id, status: 'resolved', resolution: 'Spoke with Cecile; checklist updated.' }, 'concierge');
  ok(x.status === 200, 'case resolved');
  x = await fam.act('request_replacement', { link_id: fa.link_id, reason: 'Schedule no longer works' }, 'family');
  ok(x.status === 200, 'replacement requested (opens case)');
  x = await admin.act('start_replacement', { link_id: fa.link_id, case_id: x.body.result.case_id }, 'concierge');
  ok(x.status === 200 && x.body.data.placements[0].status === 'replacement' && x.body.data.placements[0].replacements_used === 1, 'replacement started (1 of 3)');

  console.log('11. Refunds (second family)');
  const f2 = await family('Ana Ruiz', 'ana@test.com', '90210', 'Nanny');
  await webhookPaid(f2.orderId, 'HM-T2');
  const fam2 = new Client('family2');
  await fam2.login('ana@test.com');
  let f2d = await fam2.dash('family');
  ok(f2d.data.placements[0].refund_preview.percent === 100, 'full refund preview before applicants shared');
  x = await fam2.act('request_refund', { placement_id: f2d.data.placements[0].id, reason: 'Found help through a friend' }, 'family');
  ok(x.status === 200, 'refund requested');
  let fin = await admin.dash('finance');
  const rf = fin.data.refunds[0];
  ok(rf.status === 'requested' && rf.eligibility.percent === 100 && rf.amount_cents === 34900, 'finance sees 100% eligible');
  x = await admin.act('decide_refund', { id: rf.id, decision: 'approve' }, 'finance');
  ok(x.status === 200, 'refund approved');
  admin.expectFail = true;
  x = await admin.act('pay_refund', { id: rf.id }, 'finance');
  ok(x.status === 400, 'Stripe not connected → asks for manual');
  admin.expectFail = false;
  x = await admin.act('pay_refund', { id: rf.id, manual: true, reference: 're_manual_1' }, 'finance');
  ok(x.status === 200 && x.body.data.refunds[0].status === 'refunded' && x.body.data.kpis.refunded_cents === 34900, 'refund paid; KPIs updated');
  f2d = await fam2.dash('family');
  ok(f2d.data.placements[0].status === 'closed', 'fully refunded placement closed');
  fin = await admin.dash('finance');
  ok(fin.data.orders.find((o) => o.ref === 'HM-T2' || o.refunded_cents === 34900), 'order shows refunded');
  // Hired placement: not refundable
  fd = await fam.dash('family');
  ok(fd.data.placements[0].refund_preview.percent === 0 && fd.data.placements[0].refund_preview.rule === 'hired', 'no refund after hire');

  console.log('12. Territories & licences');
  comp = await admin.dash('compliance');
  ok(comp.data.territories.find((t) => t.code === 'NY').warnings.includes('No licence on file'), 'warns when no licence on file');
  x = await admin.act('save_territory', { code: 'TX', name: 'Texas', zip_ranges: '750-799', min_wage: 7.25, sellable: false }, 'compliance');
  ok(x.status === 200, 'territory added');
  admin.expectFail = true;
  x = await admin.act('save_territory', { code: 'TX', name: 'Texas', zip_ranges: '750-799', min_wage: 7.25, sellable: true }, 'compliance');
  ok(x.status === 400, 'cannot make sellable without a licence');
  admin.expectFail = false;
  x = await admin.act('save_license', { territory_code: 'TX', kind: 'Business registration', status: 'active', expires_on: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }, 'compliance');
  x = await admin.act('save_territory', { code: 'TX', name: 'Texas', zip_ranges: '750-799', min_wage: 7.25, sellable: true }, 'compliance');
  ok(x.status === 200 && x.body.data.territories.find((t) => t.code === 'TX').expiring === 1, 'sellable after licence; renewal warning');
  const pub = await (await fetch(BASE + '/api/territories')).json();
  ok(pub.territories.some((t) => t.code === 'TX'), 'public territories list includes TX');
  await admin.act('save_territory', { code: 'TX', name: 'Texas', zip_ranges: '750-799', min_wage: 7.25, sellable: false }, 'compliance');
  const anon2 = new Client('anon2');
  const rq3 = await anon2.req('POST', '/api/requests', { help_type: 'Nanny', location: '75201', budget_per_hour: 20 });
  anon2.expectFail = true;
  x = await anon2.req('POST', '/api/checkout', { full_name: 'Tex Ann', phone: '+1 214 555 0100', email: 'tex@test.com', hires: 1, request_id: rq3.body.id });
  ok(x.status === 400 && /not available/.test(x.body.error), 'checkout blocked outside sellable territories');

  console.log('13. Recruiter tools');
  x = await admin.act('add_lead', { full_name: 'Maria Santos', email: 'maria@test.com', phone: '+1 305 555 0111', role_type: 'nanny', zip: '33101', source: 'facebook' }, 'recruiter');
  ok(x.status === 200, 'lead added');
  x = await admin.act('import_leads', { csv: 'name,email,phone,role,zip,source\nLiza Cruz,liza@test.com,3055550122,cleaner,33130,indeed\n"Ray, Jr",ray@test.com,,housekeeper,90001,walk in\nBad Row,,,,,\nMaria Santos,maria@test.com,,nanny,33101,facebook' }, 'recruiter');
  ok(x.status === 200 && x.body.result.created === 2 && x.body.result.skipped.length === 2, 'CSV import: 2 created, 2 skipped');
  x = await app.act('refer', { name: 'Joy Reyes', email: 'joy@test.com', phone: '+1 718 555 0133', role_type: 'cleaner' }, 'applicant');
  ok(x.status === 200 && x.body.data.referrals.length === 1, 'applicant refers a friend');
  r = await admin.dash('recruiter');
  ok(r.data.applicants.find((a) => a.email === 'joy@test.com').source === 'referral', 'referral lands in pipeline');
  ok(r.data.board.find((b) => b.territory === 'NY' && b.role_type === 'housekeeper').active === 1, 'supply board counts');
  x = await admin.act('pause_stale', {}, 'recruiter');
  ok(x.status === 200 && x.body.result.paused === 0, 'pause stale (none stale)');

  console.log('14. Admin & permissions');
  x = await admin.act('invite_team', { email: 'georgie@test.com', full_name: 'Georgie Lane', roles: ['concierge'] }, 'admin');
  ok(x.status === 200 && x.body.data.team.some((t) => t.email === 'georgie@test.com'), 'team member invited');
  const g = new Client('georgie');
  const gl = await g.login('georgie@test.com');
  ok(gl && gl.views.join() === 'concierge', 'Concierge only gets Concierge view');
  g.expectFail = true;
  x = await g.act('decide_refund', { id: rf.id, decision: 'approve' }, 'concierge');
  ok(x.status === 403, 'Concierge cannot decide refunds');
  x = await g.act('invite_team', { email: 'evil@test.com', roles: ['admin'] }, 'concierge');
  ok(x.status === 403, 'Concierge cannot add team members');
  const gd = await g.dash('finance');
  ok(gd.view === 'concierge', 'Concierge cannot open Finance view');
  admin.expectFail = true;
  x = await admin.act('update_team', { user_id: li ? (await admin.dash('admin')).me.id : '', roles: ['concierge'] }, 'admin');
  ok(x.status === 400, 'admin cannot remove own admin role');
  admin.expectFail = false;
  const adm = await admin.dash('admin');
  ok(adm.data.audit.length > 20 && adm.data.audit.some((a) => a.action === 'hire'), 'audit log records actions');
  fam.expectFail = true;
  x = await fam.act('add_applicant', { placement_id: pl.id, applicant_user_id: cec.user_id }, 'family');
  ok(x.status === 403, 'family cannot use Concierge actions');
  x = await fam.req('POST', '/api/app?action=hire', { link_id: '00000000-0000-0000-0000-000000000000' });
  ok(x.status === 404, 'unknown link → 404');
  const evil = await fetch(BASE + '/api/app?action=update_me', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: fam.cookie }, body: '{}' });
  ok(evil.status === 403, 'cross-site POST blocked');
  await fam.req('POST', '/api/auth?action=logout');
  x = await fam.req('GET', '/api/app?action=dashboard&view=family');
  ok(x.status === 401, 'logout');

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
