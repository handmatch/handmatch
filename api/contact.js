// Contact page messages.
'use strict';
const { readJson, send, clean, isEmail, badRequest, saveSignup, handler } = require('./_lib');

module.exports = handler(async (req, res) => {
  const b = await readJson(req);
  const row = { name: clean(b.name, 120), email: clean(b.email, 200), topic: clean(b.topic, 120), message: clean(b.message, 5000) };
  if (!row.name) throw badRequest('Please enter your name.');
  if (!isEmail(row.email)) throw badRequest('Please enter a valid email.');
  if (row.message.length < 5) throw badRequest('Please write a short message.');
  await saveSignup('messages', row, 'New message: ' + row.topic, row.email);
  send(res, 200, { ok: true });
});
