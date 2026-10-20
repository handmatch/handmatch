// Login sessions: signed, HttpOnly cookie. No external packages.
'use strict';
const crypto = require('crypto');
const { env, db } = require('./_lib');

const COOKIE = 'hm_s';
const MAX_AGE = 30 * 24 * 3600; // 30 days

function secret() {
  const s = env('SESSION_SECRET');
  if (s.length < 16) throw Object.assign(new Error('Login isn’t set up yet. Please email hello.handmatch@gmail.com.'), { status: 503 });
  return s;
}

const mac = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url');

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + mac(body);
}

function unsign(token) {
  if (!token || token.indexOf('.') < 1) return null;
  const [body, sig] = token.split('.');
  const expected = mac(body);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.e && p.e > Date.now() / 1000 ? p : null;
  } catch (e) { return null; }
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSession(res, user) {
  const token = sign({ u: user.id, e: Math.floor(Date.now() / 1000) + MAX_AGE });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

// The logged-in user, freshly loaded so a disabled account or changed role takes effect at once.
async function currentUser(req) {
  const p = unsign(cookies(req)[COOKIE]);
  if (!p) return null;
  const rows = await db('users?select=*&id=eq.' + encodeURIComponent(p.u));
  const u = rows && rows[0];
  return u && !u.disabled ? u : null;
}

// Block cross-site POSTs (on top of SameSite cookies and JSON-only bodies).
function sameOrigin(req) {
  if (req.method === 'GET') return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch (e) { return false; }
}

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');

module.exports = { setSession, clearSession, currentUser, sameOrigin, hashToken, newToken };
