// Public: where handmatch is currently available (first 3 ZIP digits per territory).
//   GET /api/territories → { territories: [{ code, name, zip_ranges }] }
'use strict';
const { send, hasDb, handler } = require('./_lib');
const A = require('./_app');

module.exports = handler(async (req, res) => {
  const list = hasDb() ? await A.territories() : A.DEFAULT_TERRITORIES;
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ territories: list.filter((t) => t.sellable).map((t) => ({ code: t.code, name: t.name, zip_ranges: t.zip_ranges })) }));
}, ['GET']);
