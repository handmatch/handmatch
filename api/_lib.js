// Shared helpers for handmatch API routes (no external packages).
// Files starting with "_" are not exposed as routes on Vercel.
'use strict';

const env = (k, d) => (process.env[k] || d || '').trim();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readRaw(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { throw Object.assign(new Error('Invalid request'), { status: 400 }); }
}

function query(req) {
  return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
}

// ---- validation helpers -------------------------------------------------
const clean = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cleanList = (v, max = 20) => (Array.isArray(v) ? v.slice(0, max).map((x) => clean(String(x), 80)).filter(Boolean) : []);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function badRequest(message) { return Object.assign(new Error(message), { status: 400 }); }

// ---- Supabase (REST) -----------------------------------------------------
const hasDb = () => !!(env('SUPABASE_URL') && env('SUPABASE_SERVICE_ROLE_KEY'));

async function db(path, { method = 'GET', body, prefer } = {}) {
  const url = env('SUPABASE_URL').replace(/\/$/, '') + '/rest/v1/' + path;
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error('Database error ' + r.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

async function insert(table, row) {
  const rows = await db(table, { method: 'POST', body: row, prefer: 'return=representation' });
  return rows && rows[0];
}

async function update(table, filter, patch) {
  const rows = await db(table + '?' + filter, { method: 'PATCH', body: patch, prefer: 'return=representation' });
  return rows && rows[0];
}

// ---- Email (Resend) ------------------------------------------------------
const hasEmail = () => !!env('RESEND_API_KEY');

async function sendEmail({ to, subject, html, replyTo }) {
  if (!hasEmail() || !to) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('FROM_EMAIL', 'handmatch <onboarding@resend.dev>'),
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      reply_to: replyTo || undefined
    })
  });
  if (!r.ok) console.error('Email failed', r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

function table(rows) {
  return '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' +
    Object.entries(rows).map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#6F6152;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;color:#2A2722">${escapeHtml(Array.isArray(v) ? v.join(', ') : v)}</td></tr>`).join('') +
    '</table>';
}

async function notifyTeam(subject, rows, replyTo) {
  return sendEmail({
    to: env('TEAM_EMAIL', 'hello.handmatch@gmail.com'),
    subject: '[handmatch] ' + subject,
    html: `<h2 style="font-family:Arial,sans-serif;color:#2A2722">${escapeHtml(subject)}</h2>${table(rows)}`,
    replyTo
  });
}

// Save a sign-up: store in Supabase and email the team. Fails only if neither is set up.
async function saveSignup(tableName, row, subject, replyTo) {
  if (!hasDb() && !hasEmail()) {
    throw Object.assign(new Error('Sign-ups aren’t connected yet. Please email hello.handmatch@gmail.com.'), { status: 503 });
  }
  let saved = null;
  if (hasDb()) saved = await insert(tableName, row);
  await notifyTeam(subject, row, replyTo).catch((e) => console.error(e));
  return saved;
}

function handler(fn, methods = ['POST']) {
  return async (req, res) => {
    if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); return send(res, 405, { error: 'Method not allowed' }); }
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: status >= 500 && status !== 503 ? 'Something went wrong. Please try again or email hello.handmatch@gmail.com.' : e.message });
    }
  };
}

const siteUrl = (req) => env('SITE_URL') || ('https://' + (req.headers['x-forwarded-host'] || req.headers.host));

module.exports = { env, send, readRaw, readJson, query, clean, cleanList, isEmail, escapeHtml, badRequest, hasDb, db, insert, update, hasEmail, sendEmail, notifyTeam, saveSignup, handler, siteUrl };
