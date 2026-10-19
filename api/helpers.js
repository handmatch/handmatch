// "Join handmatch" applications from cleaners, housekeepers and nannies.
'use strict';
const { readJson, send, clean, cleanList, isEmail, badRequest, saveSignup, handler } = require('./_lib');

module.exports = handler(async (req, res) => {
  const b = await readJson(req);
  const row = {
    full_name: clean(b.full_name, 120),
    email: clean(b.email, 200),
    phone: clean(b.phone, 40),
    city: clean(b.city, 120),
    roles: cleanList(b.roles, 5),
    services: cleanList(b.services),
    days: cleanList(b.days, 7),
    rate: clean(String(b.rate == null ? '' : b.rate), 20),
    experience: clean(b.experience, 40),
    bio: clean(b.bio, 3000),
    background_check_consent: !!b.background_check_consent
  };
  if (!row.full_name) throw badRequest('Please enter your full name.');
  if (!isEmail(row.email)) throw badRequest('Please enter a valid email.');
  if (row.phone.replace(/\D/g, '').length < 10) throw badRequest('Please enter your mobile number.');
  if (!row.background_check_consent) throw badRequest('Please agree to a background check to continue.');
  await saveSignup('helpers', row, 'New helper application: ' + row.full_name, row.email);
  send(res, 200, { ok: true });
});
