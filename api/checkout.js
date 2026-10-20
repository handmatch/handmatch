// Step 3: start payment. Saves the order, then sends the family to Stripe's secure checkout.
'use strict';
const crypto = require('crypto');
const { env, readJson, send, clean, isEmail, badRequest, hasDb, db, insert, update, notifyTeam, handler, siteUrl } = require('./_lib');

// $349 one-time fee per hire. Set FEE_CENTS in Vercel to override (e.g. 300 for a $3 live test); delete it to go back to $349.
const FEE_CENTS = Math.max(50, parseInt(process.env.FEE_CENTS, 10) || 34900);
const MAX_HIRES = 5;

function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}

module.exports = handler(async (req, res) => {
  const b = await readJson(req);
  const order = {
    full_name: clean(b.full_name, 120),
    phone: clean(b.phone, 40),
    email: clean(b.email, 200),
    hires: Math.max(1, Math.min(MAX_HIRES, parseInt(b.hires, 10) || 1)),
    request_id: /^[0-9a-f-]{36}$/i.test(b.request_id || '') ? b.request_id : null,
    status: 'pending',
    order_ref: 'HM-' + crypto.randomBytes(3).toString('hex').toUpperCase()
  };
  if (order.full_name.split(/\s+/).length < 2) throw badRequest('Enter your full name (first and last).');
  const digits = order.phone.replace(/\D/g, '');
  if (!(digits.length === 10 || (digits.length === 11 && digits[0] === '1'))) throw badRequest('Enter a US mobile number so our team can call you.');
  if (!isEmail(order.email)) throw badRequest('Enter a valid email so we can send your receipt.');
  // A/B test (only where AB_TEST=1): variant B pays a deposit now and the balance at hire.
  const A = require('./_app');
  const variantB = A.abOn() && b.variant === 'B';
  const unit = variantB ? A.depositCents() : FEE_CENTS;
  order.amount_cents = unit * order.hires;
  if (A.abOn()) { order.variant = variantB ? 'B' : 'A'; order.fee_type = variantB ? 'deposit' : 'full'; }

  // Web app on: only sell where Compliance has marked the territory sellable.
  if (env('APP_ENABLED') === '1' && hasDb() && order.request_id) {
    const A = require('./_app');
    const reqRow = A.first(await db('requests?select=location&id=eq.' + order.request_id));
    const zip = reqRow ? String(reqRow.location || '').replace(/\D/g, '').slice(0, 5) : '';
    if (zip) {
      const t = A.territoryFor(zip, await A.territories());
      if (!t || !t.sellable) throw badRequest('We’re not available in your area yet. Join the waitlist and we’ll let you know when we launch near you.');
    }
  }

  const saved = hasDb() ? await insert('orders', order) : null;
  const base = siteUrl(req);

  // Staging only (never production): no Stripe keys → record a test payment so the whole
  // journey (pay → account → next steps) can be tried. No card is charged.
  if (!env('STRIPE_SECRET_KEY') && saved && env('APP_ENABLED') === '1' && process.env.VERCEL_ENV !== 'production') {
    const paid = await update('orders', 'id=eq.' + saved.id, { status: 'paid', paid_at: new Date().toISOString(), amount_paid_cents: order.amount_cents, notes: 'TEST payment (staging, no card charged)' });
    try { await require('./_app').ensureFamilyPlacement(paid || Object.assign(saved, { status: 'paid' })); } catch (e) { console.error('Test placement failed', e.message); }
    await notifyTeam('TEST payment (staging) · ' + order.full_name, order, order.email).catch(() => {});
    return send(res, 200, { url: '/thank-you?order_id=' + saved.id + '&test=1' });
  }

  if (!env('STRIPE_SECRET_KEY')) {
    // Payments not switched on yet: keep the details and tell the team.
    await notifyTeam('New order (payments not connected yet): ' + order.full_name, order, order.email).catch(() => {});
    if (!saved && !env('RESEND_API_KEY')) {
      throw Object.assign(new Error('Payments aren’t switched on yet. Please email hello.handmatch@gmail.com and we’ll help you right away.'), { status: 503 });
    }
    return send(res, 200, { url: '/thank-you' + (saved ? '?order_id=' + saved.id : '') });
  }

  const session = {
    mode: 'payment',
    customer_email: order.email,
    client_reference_id: saved ? saved.id : order.order_ref,
    success_url: base + '/thank-you?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: base + '/pay?hires=' + order.hires,
    line_items: { 0: {
      quantity: order.hires,
      price_data: { currency: 'usd', unit_amount: unit, product_data: variantB
        ? { name: 'handmatch deposit per hire', description: 'Meet your applicants. Credited to your fee: the $' + (A.balanceCents() / 100) + ' balance is only charged when you hire.' }
        : { name: 'handmatch one-time fee per hire', description: 'Handmatched applicants, unlimited options, up to 3 replacements within 90 days.' } }
    } },
    metadata: { order_id: saved ? saved.id : '', order_ref: order.order_ref, full_name: order.full_name, phone: order.phone, hires: order.hires, fee_type: order.fee_type || 'full', variant: order.variant || '' },
    payment_intent_data: { description: 'handmatch ' + order.order_ref, metadata: { order_ref: order.order_ref } }
  };
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(session)
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Stripe error: ' + JSON.stringify(data.error || data).slice(0, 300));
  if (saved) await update('orders', 'id=eq.' + saved.id, { stripe_session_id: data.id });
  send(res, 200, { url: data.url });
});
