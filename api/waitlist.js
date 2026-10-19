// "Outside the US?" waitlist.
'use strict';
const { readJson, send, clean, isEmail, badRequest, saveSignup, handler } = require('./_lib');

module.exports = handler(async (req, res) => {
  const b = await readJson(req);
  const row = { country: clean(b.country, 80), email: clean(b.email, 200) };
  if (!isEmail(row.email)) throw badRequest('Please enter a valid email.');
  await saveSignup('waitlist', row, 'Waitlist: ' + (row.country || 'unknown country'), row.email);
  send(res, 200, { ok: true });
});
