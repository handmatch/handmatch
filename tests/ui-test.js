// UI walkthrough with Playwright on a fresh database. Run: NODE_PATH=$(npm root -g) node ui-test.js
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const crypto = require('crypto');
const BASE = 'http://localhost:3010';
const OUT = __dirname + '/shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let step = 0;

async function linkFor(email, after) {
  for (let i = 0; i < 50; i++) {
    const lines = fs.readFileSync(__dirname + '/dev.log', 'utf8').split('\n').filter((l) => l.includes('sign-in link for ' + email + ':'));
    if (lines.length > after) return lines.pop().split(': ').pop().trim();
    await sleep(100);
  }
  throw new Error('no link for ' + email);
}
const countLinks = (email) => fs.readFileSync(__dirname + '/dev.log', 'utf8').split('\n').filter((l) => l.includes('sign-in link for ' + email + ':')).length;

async function login(b, email, viewport) {
  const ctx = await b.newContext({ viewport: viewport || { width: 1360, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(email + ': ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(email + ' console: ' + m.text()); });
  p.on('dialog', (d) => d.accept());
  await p.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const before = countLinks(email);
  await p.goto(BASE + '/login');
  await p.fill('#lg-email', email); await p.click('button[type=submit]');
  const link = (await linkFor(email, before)).replace(/^https?:\/\/[^/]+/, BASE);
  await p.goto(link); await p.click('text=Continue to my account'); await p.waitForURL('**/app**');
  await p.waitForSelector('.bar-r'); await p.waitForTimeout(500);
  return p;
}
async function shot(p, name, full) { step++; await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${String(step).padStart(2, '0')}-${name}.png`, fullPage: !!full }); }
async function toast(p) { const t = await p.locator('.toast').first().textContent({ timeout: 4000 }).catch(() => ''); return t; }
async function view(p, v) { await p.selectOption('.switch select', v); await p.waitForTimeout(800); }
async function side(p, label) { await p.click(`.side-i:has-text("${label}")`); await p.waitForTimeout(300); }

async function api(path, body, headers) {
  const r = await fetch(BASE + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: typeof body === 'string' ? body : JSON.stringify(body) });
  return r.json().catch(() => ({}));
}
async function paidFamily(name, email, zip, help) {
  const rq = await api('/api/requests', { help_type: help, services: ['Regular home cleaning', 'Laundry'], days: ['Wed', 'Fri'], frequency: 'Every 2 weeks', budget_per_hour: 23, location: zip, home_size: '2 bedrooms', pets: true, notes: 'Two kids and a friendly cat.' });
  const co = await api('/api/checkout', { full_name: name, phone: '+1 646 555 0101', email, hires: 1, request_id: rq.id });
  const orderId = new URL(BASE + co.url).searchParams.get('order_id');
  const ev = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_' + crypto.randomBytes(4).toString('hex'), amount_total: 34900, metadata: { order_id: orderId, order_ref: 'x', full_name: name, hires: '1' } } } });
  const t = Math.floor(Date.now() / 1000);
  await api('/api/stripe-webhook', ev, { 'stripe-signature': `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(t + '.' + ev).digest('hex')}` });
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // Seed: a paid family, and two website applications
  await paidFamily('Jordan Lee', 'jordan@test.com', '11215', 'Housekeeper');
  await api('/api/helpers', { full_name: 'Cecile Pascual', email: 'cecile@test.com', phone: '+1 917 555 0199', city: 'Brooklyn 11215', roles: ['Housekeeper'], services: ['Laundry'], days: ['Wed'], rate: '21', background_check_consent: true });
  await api('/api/helpers', { full_name: 'Rosa Diaz', email: 'rosa@test.com', phone: '+1 718 555 0144', city: 'Queens 11375', roles: ['Housekeeper'], days: ['Mon'], rate: '22', background_check_consent: true });

  // --- Admin / Concierge
  const a = await login(b, 'marvin@test.com');
  await shot(a, 'concierge-today-empty');
  await side(a, 'My details');
  await a.fill('input[name=full_name]', 'Marvin Perol'); await a.fill('input[name=phone]', '+1 646 661 2206');
  await a.fill('input[name=title]', 'handmatch Concierge'); await a.fill('input[name=photo_url]', '/assets/img/marvin-founder.jpg');
  await a.click('text=Save details'); console.log('save me:', await toast(a));

  // --- Applicant fills profile on mobile
  const ap = await login(b, 'cecile@test.com', { width: 390, height: 844 });
  await shot(ap, 'applicant-home-mobile', true);
  await ap.click('.tab:has-text("My profile")');
  await ap.fill('input[name=zip]', '11215'); await ap.fill('input[name=years]', '4'); await ap.fill('input[name=start_in_days]', '3');
  await ap.fill('input[name=languages]', 'English, Tagalog'); await ap.fill('input[name=hours]', '8 AM to 4 PM');
  await ap.click('.tg:has-text("Fri")'); await ap.click('.tg:has-text("Cooking")'); await ap.click('.tg:has-text("Pet care")');
  await ap.fill('textarea[name=bio]', 'Family-oriented mom of two. Warm, reliable, great at following instructions. Loves cooking Filipino food and adores cats.');
  await shot(ap, 'applicant-profile-mobile', true);
  await ap.click('form[data-f=profile] button[type=submit] >> nth=0'); console.log('submit profile:', await toast(ap));

  // --- Recruiter activates
  await view(a, 'recruiter');
  await shot(a, 'recruiter-pipeline');
  await a.click('.item:has-text("Cecile")');
  const vet = a.locator('form[data-f=vet]');
  await vet.locator('select[name=pipeline_stage]').selectOption('active');
  for (const n of ['check_interview', 'check_id', 'check_references']) await vet.locator(`input[name=${n}]`).check();
  await vet.locator('input[name=photo_url]').fill('/assets/img/cecile-v2.jpg');
  await vet.locator('button:has-text("Save applicant")').click(); console.log('activate:', await toast(a));
  await shot(a, 'recruiter-applicant-active', true);
  await side(a, 'Supply board'); await shot(a, 'recruiter-board');
  await side(a, 'Add & import'); await shot(a, 'recruiter-add');

  // --- Concierge shares the applicant
  await view(a, 'concierge');
  await shot(a, 'concierge-today');
  await side(a, 'Placements');
  await a.click('.item:has-text("Jordan")');
  await a.click('.sugg button:has-text("Share")'); console.log('share:', await toast(a));
  await shot(a, 'concierge-placement', true);

  // --- Applicant accepts
  await ap.reload(); await ap.waitForSelector('.req');
  await ap.click('button:has-text("I’m available")'); console.log('accept:', await toast(ap));
  await shot(ap, 'applicant-accepted-mobile', true);

  // --- Family books a video interview
  const f = await login(b, 'jordan@test.com');
  await shot(f, 'family-overview', true);
  await f.click('.tab:has-text("Applicants")');
  await shot(f, 'family-applicants', true);
  await f.click('.app-card button:has-text("Book a meeting")');
  await f.click('.opt:has-text("Paid trial")'); await shot(f, 'family-book-trial');
  await f.click('.opt:has-text("Video interview")');
  await f.fill('input[name=preferred_times]', 'Weekday evenings after 6');
  await f.click('button:has-text("Request video interview")'); console.log('book:', await toast(f));

  // --- Chat (family → shared thread)
  await f.click('.tab:has-text("Messages")'); await f.click('.chat-i:has-text("Cecile")');
  await f.fill('.chat-f textarea', 'Hi Cecile! Looking forward to meeting you. My number is 646-555-0101.');
  await f.click('.chat-f button:has-text("Send")'); await f.waitForTimeout(600);
  await shot(f, 'family-chat');

  // --- Concierge schedules (time in the past so the family can record the outcome now)
  await a.reload(); await a.waitForSelector('.side');
  await side(a, 'Today');
  await a.click('.panel:has-text("Meetings to schedule") button:has-text("Schedule")');
  const past = new Date(Date.now() - 2 * 3600e3);
  const etPast = new Date(past.getTime() - 4 * 3600e3).toISOString().slice(0, 16); // EDT is UTC-4 in October
  await a.fill('input[name=start_at]', etPast); await a.fill('input[name=join_info]', 'https://meet.google.com/abc-defg-hij');
  await shot(a, 'concierge-schedule');
  await a.click('button:has-text("Confirm time")'); console.log('schedule:', await toast(a));
  await side(a, 'Messages'); await a.click('.chat-i:has-text("Cecile")');
  await a.fill('.chat-f textarea', 'Family prefers mornings for the trial.'); await a.check('.chat-f input[name=internal]');
  await a.click('.chat-f button:has-text("Send")'); await a.waitForTimeout(500);
  await shot(a, 'concierge-chat');

  // --- Applicant confirms
  await ap.reload(); await ap.waitForSelector('.req');
  await ap.click('button:has-text("I’ll be there")'); console.log('confirm:', await toast(ap));

  // --- Family passes
  await f.click('.tab:has-text("Overview")'); await f.reload(); await f.waitForSelector('.next');
  await shot(f, 'family-outcome-due');
  await f.click('.next button:has-text("Share how it went")');
  await f.click('.opt:has-text("Pass")'); await f.fill('textarea[name=note]', 'Lovely with the kids');
  await f.click('.dialog button:has-text("Save")'); console.log('pass:', await toast(f));
  await shot(f, 'family-check-in-progress', true);

  // --- Compliance orders and clears
  await view(a, 'compliance');
  await a.click('.item:has-text("Cecile")');
  await shot(a, 'compliance-ticket', true);
  const oc = a.locator('form[data-f=order-check]');
  await oc.locator('input[name=package]').fill('Essential'); await oc.locator('input[name=cost]').fill('54.50'); await oc.locator('input[name=external_ref]').fill('chk_123');
  await oc.locator('button:has-text("Mark as ordered")').click(); console.log('order:', await toast(a));
  await a.click('button:has-text("Clear")'); console.log('clear:', await toast(a));
  await side(a, 'Territories'); await shot(a, 'compliance-territories', true);
  await a.click('.panel:has-text("New York (NY)") button:has-text("Add licence")');
  await a.fill('input[name=kind]', 'NYC DCWP Employment Agency License'); await a.selectOption('.dialog select[name=status]', 'pending');
  await a.click('button:has-text("Save licence")'); console.log('licence:', await toast(a));

  // --- Family hires
  await f.reload(); await f.waitForSelector('.next');
  await f.click('.next button:has-text("Hire")'); await f.click('button:has-text("Confirm hire")'); console.log('hire:', await toast(f));
  await f.click('.tab:has-text("Applicants")'); await shot(f, 'family-hired', true);
  await f.click('.tab:has-text("Help & refunds")'); await shot(f, 'family-help', true);
  await f.click('button:has-text("Open a support request")');
  await f.fill('input[name=subject]', 'Laundry mix-up'); await f.fill('textarea[name=description]', 'Whites and colors were washed together.');
  await f.click('button:has-text("Open request")'); console.log('case:', await toast(f));

  // --- Concierge resolves the case
  await view(a, 'concierge'); await side(a, 'Cases'); await a.click('.item:has-text("Laundry")');
  await a.fill('form[data-f=case-update] textarea[name=resolution]', 'Talked with Cecile; she’ll sort laundry by color.');
  await a.selectOption('form[data-f=case-update] select[name=status]', 'resolved');
  await a.click('button:has-text("Save case")'); console.log('resolve:', await toast(a));
  await shot(a, 'concierge-cases');

  // --- Finance & Admin
  await paidFamily('Ana Ruiz', 'ana@test.com', '90210', 'Nanny');
  const f2 = await login(b, 'ana@test.com', { width: 390, height: 844 });
  await f2.click('.tab:has-text("Help & refunds")');
  await f2.click('button:has-text("Request a refund")'); await f2.fill('textarea[name=reason]', 'Found help through a friend');
  await f2.click('button:has-text("Send request")'); console.log('refund req:', await toast(f2));
  await shot(f2, 'family2-refund-mobile', true);
  await view(a, 'finance'); await shot(a, 'finance-overview');
  await side(a, 'Refunds'); await a.click('button:has-text("Approve")'); console.log('approve:', await toast(a));
  await a.click('button:has-text("Mark refunded manually")'); await a.fill('input[name=reference]', 're_manual_1'); await a.click('.dialog button:has-text("Mark refunded")'); console.log('paid:', await toast(a));
  await shot(a, 'finance-refunds', true);
  await side(a, 'Orders'); await shot(a, 'finance-orders');
  await view(a, 'admin'); await shot(a, 'admin-team');
  await a.fill('form[data-f=invite-team] input[name=email]', 'georgie@test.com'); await a.fill('form[data-f=invite-team] input[name=full_name]', 'Georgie Lane');
  await a.click('button:has-text("Add and email a sign-in link")'); console.log('invite:', await toast(a));
  await side(a, 'Setup'); await shot(a, 'admin-setup');
  await side(a, 'Audit log'); await shot(a, 'admin-audit');

  // Mobile team view
  const am = await login(b, 'marvin@test.com', { width: 390, height: 844 });
  await shot(am, 'concierge-mobile', true);
  await ap.reload(); await ap.waitForSelector('.req'); await shot(ap, 'applicant-hired-mobile', true);
  await ap.click('.tab:has-text("Messages")'); await ap.click('.chat-i'); await shot(ap, 'applicant-chat-mobile');

  console.log('\nErrors:', errors.length ? '\n' + errors.join('\n') : 'none');
  await b.close();
})().catch((e) => { console.error(e); console.log('Errors:', errors.join('\n')); process.exit(1); });
