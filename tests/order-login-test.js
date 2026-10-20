const BASE = 'http://localhost:3010';
const post = async (path, body, cookie) => { const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); return { status: r.status, cookie: r.headers.get('set-cookie') || '', body: await r.json().catch(() => ({})) }; };
(async () => {
  let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
  // admin account exists first
  await post('/api/auth?action=start', { email: 'marvin@test.com' });
  const buy = async (email) => { const co = await post('/api/checkout', { full_name: 'Test Person', phone: '6465550101', email, hires: 1 }); return new URL(BASE + co.body.url).searchParams.get('order_id'); };
  const o1 = await buy('newfam@test.com');
  const a = await post('/api/auth?action=order', { order_id: o1 });
  t(a.body.signed_in === true && /hm_s=/.test(a.cookie), 'family signed in after paying');
  const b = await post('/api/auth?action=order', { order_id: o1 });
  t(b.body.signed_in === false && b.body.used === true && !/hm_s=[^;]/.test(b.cookie), 'same order cannot sign in twice');
  const o2 = await buy('marvin@test.com');
  const c = await post('/api/auth?action=order', { order_id: o2 });
  t(c.body.signed_in === false && c.body.sent === true && !c.cookie, 'team account never signed in from an order (link emailed)');
  const d = await post('/api/auth?action=order', { order_id: '00000000-0000-0000-0000-000000000000' });
  t(d.body.signed_in === false, 'unknown order does nothing');
  console.log(ok + ' passed, ' + bad + ' failed');
})();
