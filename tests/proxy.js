// Supabase-style /rest/v1 prefix in front of local PostgREST.
const http = require('http');
http.createServer((req, res) => {
  const path = req.url.replace(/^\/rest\/v1/, '');
  const headers = Object.assign({}, req.headers); delete headers.host; delete headers.apikey;
  const up = http.request({ host: '127.0.0.1', port: 3001, path, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { res.statusCode = 502; res.end(e.message); });
  req.pipe(up);
}).listen(54321, () => console.log('proxy ready'));
