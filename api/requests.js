// Step 1: a family's preferences.
'use strict';
const { readJson, send, clean, cleanList, saveSignup, handler } = require('./_lib');

module.exports = handler(async (req, res) => {
  const b = await readJson(req);
  const row = {
    help_type: clean(b.help_type, 40),
    services: cleanList(b.services),
    days: cleanList(b.days, 7),
    frequency: clean(b.frequency, 40),
    budget_per_hour: Math.max(0, Math.min(500, Number(b.budget_per_hour) || 0)),
    location: clean(b.location, 120),
    home_size: clean(b.home_size, 40),
    pets: !!b.pets,
    supplies: !!b.supplies,
    notes: clean(b.notes, 2000)
  };
  if (require('./_app').abOn()) row.variant = b.variant === 'B' ? 'B' : 'A';
  const saved = await saveSignup('requests', row, 'New preferences: ' + (row.help_type || 'help') + (row.location ? ' · ' + row.location : ''));
  send(res, 200, { id: saved ? saved.id : null });
});
