// The handmatch web app API. Every request needs a signed-in user; each action checks the role.
//   GET  /api/app?action=dashboard&view=<role>   → data for that view (family, applicant, concierge, …)
//   GET  /api/app?action=thread&id=<thread>      → one conversation (marks it read)
//   POST /api/app?action=<name>&view=<role>      → change something; returns the refreshed view
'use strict';
const { readJson, query, send, hasDb, handler } = require('./_lib');
const { currentUser, sameOrigin } = require('./_session');
const A = require('./_app');
const D = require('./_dash');

const ACTIONS = Object.assign({},
  require('./_act_people').ACTIONS,
  require('./_act_team').ACTIONS,
  require('./_act_ops').ACTIONS);

// Every change is written to the audit log, without personal free text.
const QUIET = new Set(['send_message', 'update_me', 'save_profile']);
const SAFE_KEYS = ['id', 'link_id', 'placement_id', 'meeting_id', 'user_id', 'order_id', 'case_id', 'thread_id', 'applicant_user_id', 'status', 'decision', 'outcome', 'kind', 'type', 'pipeline_stage', 'roles', 'sellable', 'code', 'territory_code', 'accept', 'ok', 'what', 'manual', 'amount'];
const auditDetail = (b) => Object.fromEntries(Object.entries(b || {}).filter(([k]) => SAFE_KEYS.includes(k)));
const entityOf = (b) => ['meeting_id', 'link_id', 'placement_id', 'case_id', 'user_id', 'order_id', 'id'].find((k) => b && b[k]);

module.exports = handler(async (req, res) => {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Not allowed' });
  if (!hasDb()) throw A.fail(503, 'The app isn’t connected yet.');
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: 'Please sign in.' });
  const qs = query(req);
  const action = qs.action;
  if (req.method === 'GET') {
    if (action === 'dashboard') return send(res, 200, await D.dashboard(user, qs.view));
    if (action === 'thread') return send(res, 200, { thread: await D.threadDetail(user, qs.id) });
    return send(res, 404, { error: 'Not found' });
  }
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  if (!fn) return send(res, 404, { error: 'Not found' });
  const body = await readJson(req);
  const result = (await fn(user, body)) || {};
  if (!QUIET.has(action)) {
    const key = entityOf(body);
    await A.audit(user, action, key ? key.replace(/_id$/, '') : '', key ? body[key] : '', Object.assign(auditDetail(body), { view: qs.view || '' }));
  }
  if (result.thread) return send(res, 200, result);
  const fresh = await A.userById(user.id);
  send(res, 200, Object.assign({ result }, await D.dashboard(fresh, qs.view)));
}, ['GET', 'POST']);
