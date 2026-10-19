// Lets the Thank you and Next steps pages show the family's name and order.
'use strict';
const { query, send, hasDb, db, handler } = require('./_lib');

module.exports = handler(async (req, res) => {
  const q = query(req);
  if (!hasDb()) return send(res, 404, { error: 'Not found' });
  let filter = '';
  if (/^cs_[A-Za-z0-9_]{10,}$/.test(q.session_id || '')) filter = 'stripe_session_id=eq.' + q.session_id;
  else if (/^[0-9a-f-]{36}$/i.test(q.order_id || '')) filter = 'id=eq.' + q.order_id;
  else return send(res, 400, { error: 'Missing order' });
  const rows = await db('orders?select=full_name,email,phone,hires,order_ref,status,amount_cents&' + filter);
  if (!rows || !rows[0]) return send(res, 404, { error: 'Not found' });
  send(res, 200, rows[0]);
}, ['GET']);
