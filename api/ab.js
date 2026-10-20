// A/B test assignment for the "Meet first, pay when you hire" test.
//   POST /api/ab { variant?, path, from_ad } → { variant: 'A' | 'B', on }
// Off (always A) unless AB_TEST=1. Each new visitor is counted once in ab_visits.
'use strict';
const { readJson, send, hasDb, insert, clean, handler } = require('./_lib');
const A = require('./_app');

module.exports = handler(async (req, res) => {
  const b = await readJson(req);
  if (!A.abOn()) return send(res, 200, { variant: 'A', on: false });
  const forced = b.variant === 'A' || b.variant === 'B';
  const everyone = A.abForce(); // one version for everyone (staging shows B)
  const variant = forced ? b.variant : everyone || (Math.random() < 0.5 ? 'A' : 'B');
  if (hasDb()) {
    await insert('ab_visits', { variant, path: clean(b.path, 120), from_ad: !!b.from_ad, forced }).catch((e) => console.error('ab visit', e.message));
  }
  send(res, 200, { variant, on: true });
});
