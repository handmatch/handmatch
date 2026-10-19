// Local preview: node scripts/dev.js  →  http://localhost:3000
// Serves the pages with clean URLs and runs the /api routes like Vercel does.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.vcf': 'text/vcard' };

// Load .env.local if present
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
    const file = path.join(ROOT, 'api', name + '.js');
    if (!name || name.startsWith('_') || !fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    delete require.cache[require.resolve(file)];
    return require(file)(req, res);
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { file = path.join(ROOT, '404.html'); res.statusCode = 404; }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('handmatch preview on http://localhost:' + PORT));
