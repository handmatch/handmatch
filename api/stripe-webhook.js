// Stripe tells us when a payment succeeds. Marks the order paid and sends the emails.
// In Stripe: Developers → Webhooks → add endpoint https://YOUR-DOMAIN/api/stripe-webhook
// with the event "checkout.session.completed", then copy the signing secret to STRIPE_WEBHOOK_SECRET.
'use strict';
const crypto = require('crypto');
const { pushToSheet, env, readRaw, send, hasDb, db, update, sendEmail, notifyTeam, escapeHtml, handler } = require('./_lib');

function verify(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

module.exports = handler(async (req, res) => {
  const raw = await readRaw(req, 1024 * 1024);
  if (!verify(raw, req.headers['stripe-signature'], env('STRIPE_WEBHOOK_SECRET'))) return send(res, 400, { error: 'Invalid signature' });
  const event = JSON.parse(raw);
  if (event.type !== 'checkout.session.completed') return send(res, 200, { received: true });

  const s = event.data.object;
  const m = s.metadata || {};
  const total = '$' + ((s.amount_total || 0) / 100).toLocaleString('en-US');
  const hires = Number(m.hires) || 1;

  if (hasDb()) {
    const filter = m.order_id ? 'id=eq.' + m.order_id : 'stripe_session_id=eq.' + s.id;
    const existing = await db('orders?select=status&' + filter);
    if (existing && existing[0] && existing[0].status === 'paid') return send(res, 200, { received: true }); // already handled
    await update('orders', filter, { status: 'paid', paid_at: new Date().toISOString(), amount_paid_cents: s.amount_total, stripe_session_id: s.id });
  }

  const first = escapeHtml((m.full_name || '').split(/\s+/)[0] || 'there');
  await sendEmail({
    to: s.customer_details && s.customer_details.email ? s.customer_details.email : s.customer_email,
    subject: 'Thank you, ' + first + '. Your home is in good hands.',
    replyTo: env('TEAM_EMAIL', 'hello.handmatch@gmail.com'),
    html: `<div style="font-family:Arial,sans-serif;color:#2A2722;max-width:560px">
      <h1 style="font-size:26px">Thank you, ${first}.</h1>
      <p style="font-size:16px;line-height:1.6">We’ve received your <strong>${total} one-time fee</strong> for ${hires} hire${hires > 1 ? 's' : ''} (order ${escapeHtml(m.order_ref || '')}).</p>
      <p style="font-size:16px;line-height:1.6">Marvin and the team are already handpicking the right people for your home. We’ll call you shortly to walk you through your options. On average, your help actually starts within 5–7 days.</p>
      <p style="font-size:16px;line-height:1.6">Questions? Reply to this email or call +1 (646) 661-2206.</p>
      <p style="font-size:14px;color:#6F6152">handmatch · The right hands for your home.</p></div>`
  }).catch((e) => console.error(e));

  await notifyTeam('PAID ' + total + ' · ' + (m.full_name || '') + ' · call ' + (m.phone || ''), {
    Name: m.full_name, Phone: m.phone, Email: s.customer_details ? s.customer_details.email : s.customer_email,
    Hires: hires, Paid: total, Order: m.order_ref, 'Stripe session': s.id
  }).catch((e) => console.error(e));

  await pushToSheet('paid_orders', {
    order: m.order_ref, name: m.full_name, phone: m.phone,
    email: s.customer_details ? s.customer_details.email : s.customer_email,
    hires, paid: total, stripe_session: s.id
  });

  send(res, 200, { received: true });
});
