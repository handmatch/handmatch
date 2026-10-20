/* handmatch web app: core (state, rendering, API, shared UI). Each role's screens live in their own file. */
(function () {
  'use strict';

  // ------------------------------------------------------------- html
  function Raw(s) { this.s = s; }
  const raw = (s) => new Raw(String(s == null ? '' : s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v === false || v == null ? '' : esc(v));
  // Tagged template: values are escaped unless they come from html``/raw().
  function html(strings, ...vals) { let out = strings[0]; vals.forEach((v, i) => { out += part(v) + strings[i + 1]; }); return new Raw(out); }
  const when = (c, a, b) => { const v = c ? a : b; return typeof v === 'function' ? v() : v || ''; };
  const attrs = (o) => raw(Object.entries(o).filter(([, v]) => v !== false && v != null).map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`)).join(' '));

  // ------------------------------------------------------------- formatting
  const TZ = 'America/New_York';
  function tzOffsetMs(utcMs) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
  }
  // Times are entered and shown in New York time, wherever the team member is.
  const etToIso = (v) => { if (!v) return ''; const [d, t] = v.split('T'); const [y, m, da] = d.split('-').map(Number); const [h, mi] = (t || '00:00').split(':').map(Number); const g = Date.UTC(y, m - 1, da, h, mi); return new Date(g - tzOffsetMs(g)).toISOString(); };
  const isoToEt = (iso) => { if (!iso) return ''; const ms = new Date(iso).getTime(); return new Date(ms + tzOffsetMs(ms)).toISOString().slice(0, 16); };
  const fmtET = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '');
  const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) : '');
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  function ago(iso) {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
    return fmtDay(iso);
  }
  function dueIn(iso) {
    if (!iso) return '';
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    const abs = Math.abs(s);
    const t = abs < 3600 ? Math.round(abs / 60) + ' min' : abs < 86400 ? Math.round(abs / 3600) + ' h' : Math.round(abs / 86400) + ' days';
    return s < 0 ? t + ' overdue' : 'due in ' + t;
  }
  const money = (c) => (c == null ? '' : '$' + (Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 }));
  const initial = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const list = (a) => (Array.isArray(a) ? a.filter(Boolean).join(', ') : String(a || ''));
  const ROLE_TYPE = { cleaner: 'House cleaner', housekeeper: 'Housekeeper', nanny: 'Nanny' };
  const VIEW_NAME = { family: 'My home', applicant: 'My work', concierge: 'Concierge', recruiter: 'Recruiter', finance: 'Finance', compliance: 'Compliance', admin: 'Admin' };
  const KIND = { phone: 'Phone call', video: 'Video interview', trial: 'Paid trial' };

  function avatar(name, photo, size) {
    const cls = 'av' + (size ? ' av-' + size : '');
    return photo ? html`<img class="${cls}" src="${photo}" alt="">` : html`<span class="${cls}" aria-hidden="true">${initial(name)}</span>`;
  }
  const pill = (label, tone) => html`<span class="pill${tone ? ' ' + tone : ''}">${label}</span>`;
  const empty = (text, action) => html`<div class="empty"><p>${text}</p>${action || ''}</div>`;
  const field = (label, control, hint) => html`<label class="field"><span class="lbl">${label}</span>${control}${hint ? html`<span class="hint">${hint}</span>` : ''}</label>`;
  const input = (name, value, opts = {}) => html`<input class="inp" ${attrs(Object.assign({ name, value: value == null ? '' : value, type: 'text' }, opts))}>`;
  const textarea = (name, value, opts = {}) => html`<textarea class="txt" ${attrs(Object.assign({ name, rows: 3 }, opts))}>${value || ''}</textarea>`;
  function select(name, options, value, opts = {}) {
    return html`<select class="sel" ${attrs(Object.assign({ name }, opts))}>${options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return html`<option value="${v}" ${raw(String(v) === String(value == null ? '' : value) ? 'selected' : '')}>${l}</option>`; })}</select>`;
  }
  const check = (name, on, label) => html`<label class="ck"><input type="checkbox" name="${name}" value="1" ${raw(on ? 'checked' : '')}><span>${label}</span></label>`;
  const kv = (rows) => html`<dl class="kv">${rows.filter((r) => r && r[1] !== '' && r[1] != null && r[1] !== false).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
  const tick = (ok, label) => html`<li class="${ok ? 'yes' : 'no'}"><span class="tk" aria-hidden="true">${ok ? raw('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>') : ''}</span>${label}</li>`;

  // ------------------------------------------------------------- state
  const S = {
    me: null, view: '', data: null, loading: true, error: '', busy: false,
    tab: {}, sel: {}, f: {}, modal: null, toast: null,
    threadId: '', thread: null, threadErr: ''
  };
  const HM = window.HM = {
    S, html, raw, esc, when, attrs, etToIso, isoToEt, fmtET, fmtDay, fmtTime, ago, dueIn, money, initial, firstName, list,
    ROLE_TYPE, VIEW_NAME, KIND, avatar, pill, empty, field, input, textarea, select, check, kv, tick,
    views: {}, forms: {}, actions: {}, modals: {}
  };

  // ------------------------------------------------------------- DOM morph
  function sameNode(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
    if (a.nodeType === 1 && (a.getAttribute('data-k') || '') !== (b.getAttribute('data-k') || '')) return false;
    return true;
  }
  function morph(from, to) {
    const a = Array.from(from.childNodes); const b = Array.from(to.childNodes);
    for (let i = 0; i < b.length; i++) {
      const nb = b[i]; const na = a[i];
      if (!na) { from.appendChild(nb); continue; }
      if (!sameNode(na, nb)) { from.replaceChild(nb, na); continue; }
      if (na.nodeType === 3 || na.nodeType === 8) { if (na.nodeValue !== nb.nodeValue) na.nodeValue = nb.nodeValue; continue; }
      if (na.nodeType !== 1) continue;
      for (const at of Array.from(na.attributes)) if (!nb.hasAttribute(at.name) && !(na.tagName === 'DETAILS' && at.name === 'open')) na.removeAttribute(at.name);
      for (const at of Array.from(nb.attributes)) if (na.getAttribute(at.name) !== at.value) na.setAttribute(at.name, at.value);
      // Keep what people are typing: form controls only change if they aren't focused/dirty.
      if (na.tagName === 'INPUT') {
        if (na.type === 'checkbox' || na.type === 'radio') { if (document.activeElement !== na && na.checked !== nb.hasAttribute('checked') && !na.dataset.dirty) na.checked = nb.hasAttribute('checked'); }
        else if (document.activeElement !== na && !na.dataset.dirty && na.value !== (nb.getAttribute('value') || '')) na.value = nb.getAttribute('value') || '';
        continue;
      }
      if (na.tagName === 'TEXTAREA') { if (document.activeElement !== na && !na.dataset.dirty && na.value !== nb.value) na.value = nb.value; continue; }
      if (na.tagName === 'SELECT') {
        morph(na, nb);
        if (document.activeElement !== na && !na.dataset.dirty) { const sel = Array.from(nb.options).find((o) => o.hasAttribute('selected')); if (sel && na.value !== sel.value) na.value = sel.value; }
        continue;
      }
      morph(na, nb);
    }
    for (let i = a.length - 1; i >= b.length; i--) from.removeChild(a[i]);
  }

  // ------------------------------------------------------------- render
  const root = () => document.getElementById('app');
  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    Promise.resolve().then(() => {
      queued = false;
      const tpl = document.createElement('template');
      tpl.innerHTML = page().s;
      morph(root(), tpl.content);
      document.querySelectorAll('[data-autofocus]').forEach((el) => { if (!el.dataset.focused) { el.dataset.focused = '1'; el.focus(); } });
      const log = document.querySelector('.chat-log');
      if (log && log.dataset.n !== log.dataset.seen) { log.scrollTop = log.scrollHeight; log.dataset.seen = log.dataset.n; }
    });
  }
  HM.render = render;
  HM.set = (patch) => { Object.assign(S, patch); render(); };

  function header() {
    const me = S.me;
    return html`<header class="bar">
      <a href="/" class="brand"><img src="/favicon.svg" alt="" width="28" height="28"><span>handmatch</span></a>
      ${when(me, () => html`<div class="bar-r">
        ${when(me.views.length > 1, () => html`<label class="switch"><span class="sr">Switch view</span>${select('view', me.views.map((v) => [v, VIEW_NAME[v]]), S.view, { 'data-c': 'switch-view' })}</label>`)}
        <button type="button" class="me" data-a="tab" data-key="${S.view}" data-v="account">${avatar(me.full_name || me.email, me.photo_url, 'sm')}<span class="me-n">${me.full_name || me.email}</span></button>
        <button type="button" class="btn-q" data-a="logout">Sign out</button>
      </div>`)}
    </header>`;
  }

  function page() {
    if (S.loading && !S.data) return html`<div class="shell">${header()}<main class="loading" aria-busy="true"><span class="spin"></span>Loading your account…</main></div>`;
    if (S.error && !S.data) return html`<div class="shell">${header()}<main class="center-box"><h1 class="h2">We couldn’t load your account.</h1><p class="muted">${S.error}</p><button class="btn" data-a="reload">Try again</button></main></div>`;
    if (!S.view) return html`<div class="shell">${header()}<main class="center-box"><h1 class="h2">Your account isn’t set up yet.</h1><p class="muted">Email hello.handmatch@gmail.com and we’ll sort it out.</p></main></div>`;
    const v = HM.views[S.view];
    return html`<div class="shell ${HM.isTeam(S.view) ? 'team' : 'home'}">${header()}${v ? v.render(S.data || {}) : ''}${modal()}${toast()}</div>`;
  }
  HM.isTeam = (v) => ['concierge', 'recruiter', 'finance', 'compliance', 'admin'].includes(v);

  // Tabs: [{id, label, badge}]
  HM.tabs = (key, tabs) => {
    const cur = S.tab[key] || tabs[0].id;
    return html`<nav class="tabs" role="tablist">${tabs.map((t) => html`<button type="button" role="tab" aria-selected="${t.id === cur ? 'true' : 'false'}" class="tab${t.id === cur ? ' on' : ''}" data-a="tab" data-key="${key}" data-v="${t.id}">${t.label}${t.badge ? html`<span class="badge">${t.badge}</span>` : ''}</button>`)}</nav>`;
  };
  HM.curTab = (key, def) => S.tab[key] || def;

  // Team layout: side navigation with sections.
  HM.teamShell = (sections, body) => {
    const cur = S.tab[S.view] || sections[0].id;
    return html`<div class="team-grid">
      <nav class="side" aria-label="${VIEW_NAME[S.view]}">
        <p class="side-h">${VIEW_NAME[S.view]}</p>
        ${sections.map((s) => html`<button type="button" class="side-i${s.id === cur ? ' on' : ''}" data-a="tab" data-key="${S.view}" data-v="${s.id}"><span>${s.label}</span>${s.badge ? html`<span class="badge${s.alert ? ' alert' : ''}">${s.badge}</span>` : ''}</button>`)}
      </nav>
      <main class="team-main">${body(cur)}</main>
    </div>`;
  };

  // ------------------------------------------------------------- modal + toast
  function modal() {
    if (!S.modal) return '';
    const m = HM.modals[S.modal.name];
    if (!m) return '';
    const out = m(S.modal.ctx || {});
    return html`<div class="scrim" data-a="close-modal-scrim"><div class="dialog" role="dialog" aria-modal="true" aria-label="${out.title}">
      <div class="dialog-h"><h2 class="h3">${out.title}</h2><button type="button" class="x" data-a="close-modal" aria-label="Close">×</button></div>
      <div class="dialog-b">${out.body}</div></div></div>`;
  }
  HM.open = (name, ctx) => HM.set({ modal: { name, ctx: ctx || {} } });
  HM.close = () => HM.set({ modal: null });
  let toastTimer;
  function toast() { return S.toast ? html`<div class="toast${S.toast.bad ? ' bad' : ''}" role="status">${S.toast.text}</div>` : ''; }
  HM.toast = (text, bad) => { clearTimeout(toastTimer); HM.set({ toast: { text, bad } }); toastTimer = setTimeout(() => HM.set({ toast: null }), bad ? 6000 : 3200); };

  // ------------------------------------------------------------- API
  async function call(url, body) {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
    if (r.status === 401) { location.href = '/login'; throw new Error('Please sign in.'); }
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }
  HM.call = call;
  function apply(j) {
    if (j.me) S.me = j.me;
    if (j.view) { S.view = j.view; }
    if (j.data) S.data = j.data;
  }
  HM.load = async function (view) {
    S.loading = true; render();
    try {
      const j = await call('/api/app?action=dashboard&view=' + encodeURIComponent(view || S.view || ''));
      apply(j); S.error = '';
      if (S.view && location.hash.slice(1).split('/')[0] !== S.view) history.replaceState(null, '', '#' + S.view);
    } catch (e) { S.error = e.message; }
    S.loading = false; render();
  };
  // Run an action. Returns the action's result, or null if it failed (an error toast is shown).
  HM.act = async function (action, body, done) {
    if (S.busy) return null;
    S.busy = true; render();
    try {
      const j = await call('/api/app?action=' + action + '&view=' + encodeURIComponent(S.view), body || {});
      apply(j);
      S.busy = false;
      if (typeof done === 'string') { S.modal = null; HM.toast(done); }
      else if (typeof done === 'function') done(j.result || {});
      render();
      return j.result || {};
    } catch (e) {
      S.busy = false; HM.toast(e.message, true); render();
      return null;
    }
  };

  // ------------------------------------------------------------- chat
  let pollTimer = null;
  HM.openThread = async function (id, quiet) {
    if (!id) return;
    if (!quiet) { S.threadId = id; S.thread = S.thread && S.thread.id === id ? S.thread : null; S.threadErr = ''; render(); }
    try {
      const j = await call('/api/app?action=thread&id=' + encodeURIComponent(id));
      if (S.threadId === id) { S.thread = j.thread; markRead(id); render(); }
    } catch (e) { if (!quiet) { S.threadErr = e.message; render(); } }
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (S.threadId && document.querySelector('.chat-log') && !document.hidden) HM.openThread(S.threadId, true); }, 7000);
  };
  function markRead(id) {
    const ts = (S.data && S.data.threads) || [];
    ts.forEach((t) => { if (t.id === id) t.unread = 0; });
  }
  HM.unread = () => ((S.data && S.data.threads) || []).reduce((s, t) => s + (t.unread || 0), 0);

  // threads: list from data; opts.compact hides the list when a thread is open on mobile
  HM.chat = function (threads, opts = {}) {
    const cur = S.threadId && threads.some((t) => t.id === S.threadId) ? S.threadId : '';
    const th = cur && S.thread && S.thread.id === cur ? S.thread : null;
    return html`<div class="chat${cur ? ' has-open' : ''}">
      <div class="chat-list">${threads.length ? threads.map((t) => html`<button type="button" class="chat-i${t.id === cur ? ' on' : ''}" data-a="open-thread" data-id="${t.id}">
          <span class="chat-t"><b>${t.title}</b>${t.unread ? html`<span class="badge">${t.unread}</span>` : ''}</span>
          <span class="chat-p">${t.preview}</span><span class="chat-a">${ago(t.last_at)}</span></button>`) : empty(opts.empty || 'No conversations yet.')}</div>
      <div class="chat-pane">${cur ? thread(th) : html`<div class="chat-none"><p>${opts.pick || 'Choose a conversation.'}</p></div>`}</div>
    </div>`;
  };
  function thread(t) {
    if (S.threadErr) return html`<div class="chat-none"><p>${S.threadErr}</p></div>`;
    if (!t) return html`<div class="chat-none"><span class="spin"></span></div>`;
    return html`<div class="chat-h"><button type="button" class="btn-q back" data-a="close-thread" aria-label="Back to conversations">‹</button><div><b>${t.title}</b><span class="muted small">${t.members.join(', ')}</span></div></div>
      ${when(t.masked, () => html`<p class="chat-note">Phone numbers and emails stay hidden until you hire. Your Concierge arranges calls and visits.</p>`)}
      <div class="chat-log" data-n="${t.messages.length}" data-seen="">${t.messages.length ? t.messages.map((m) => html`<div class="msg${m.mine ? ' mine' : ''}${m.system ? ' sys' : ''}${m.internal ? ' internal' : ''}">
        ${when(!m.system && !m.mine, () => html`<span class="msg-w">${m.who}</span>`)}
        <div class="msg-b">${when(m.internal, () => html`<span class="msg-tag">Team note · not visible to the family or applicant</span>`)}${m.body}</div>
        <time class="msg-t">${fmtTime(m.at)}</time></div>`) : html`<p class="muted center small">Say hello. Messages are kept here for everyone in this conversation.</p>`}</div>
      <form class="chat-f" data-f="send-message" data-k="${t.id}-${t.messages.length}">
        <input type="hidden" name="thread_id" value="${t.id}">
        <textarea name="body" class="txt" rows="2" placeholder="Write a message" aria-label="Message" required></textarea>
        <div class="row between">${when(t.can_internal, check('internal', false, 'Team note (hidden from family and applicant)'), () => html`<span></span>`)}<button class="btn sm" type="submit">Send</button></div>
      </form>`;
  }
  HM.forms['send-message'] = async (fd, form) => {
    if (!fd.body.trim()) return;
    try {
      S.busy = true;
      const j = await call('/api/app?action=send_message&view=' + S.view, { thread_id: fd.thread_id, body: fd.body, internal: !!fd.internal });
      S.thread = j.thread; S.busy = false;
      const t = ((S.data && S.data.threads) || []).find((x) => x.id === j.thread.id);
      if (t) { t.preview = fd.body.slice(0, 90); t.last_at = new Date().toISOString(); }
      form.reset(); form.querySelectorAll('[data-dirty]').forEach((el) => delete el.dataset.dirty);
      render();
    } catch (e) { S.busy = false; HM.toast(e.message, true); }
  };

  // ------------------------------------------------------------- events
  function formData(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') {
        if (el.dataset.multi) { out[el.name] = out[el.name] || []; if (el.checked) out[el.name].push(el.value); }
        else out[el.name] = el.checked;
      } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; else if (!(el.name in out)) out[el.name] = ''; }
      else if (el.tagName === 'SELECT' && el.multiple) out[el.name] = Array.from(el.selectedOptions).map((o) => o.value);
      else out[el.name] = el.value;
    }
    return out;
  }
  HM.formData = formData;
  const clearDirty = (form) => form.querySelectorAll('[data-dirty]').forEach((el) => delete el.dataset.dirty);
  HM.clearDirty = clearDirty;

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const a = el.dataset.a;
    if (a === 'close-modal-scrim' && e.target !== el) return;
    if (el.tagName === 'A' && !el.dataset.nav) e.preventDefault();
    const fn = CORE[a] || HM.actions[a];
    if (fn) fn(el.dataset, el, e);
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-f]');
    if (!form) return;
    e.preventDefault();
    const fn = HM.forms[form.dataset.f];
    const fd = formData(form);
    if (e.submitter && e.submitter.name) fd[e.submitter.name] = e.submitter.value;
    if (fn) Promise.resolve(fn(fd, form)).then((r) => { if (r) clearDirty(form); });
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.form && el.form.dataset.f && el.name) el.dataset.dirty = '1';
    if (el.dataset.i) { S.f[el.dataset.i] = el.value; render(); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.form && el.form.dataset.f && el.name) el.dataset.dirty = '1';
    if (el.dataset.c === 'switch-view') { S.threadId = ''; S.thread = null; S.data = null; history.replaceState(null, '', '#' + el.value); HM.load(el.value); return; }
    if (el.dataset.c && HM.actions[el.dataset.c]) HM.actions[el.dataset.c](el.dataset, el);
    else if (el.dataset.i) { S.f[el.dataset.i] = el.type === 'checkbox' ? el.checked : el.value; render(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.modal) HM.close();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.closest('.chat-f')) e.target.closest('form').requestSubmit();
  });

  const CORE = {
    tab: (d) => { S.tab[d.key] = d.v; if (d.v !== 'messages') { /* keep thread */ } render(); window.scrollTo({ top: 0 }); },
    sel: (d) => { S.sel[d.key] = d.id; render(); if (window.innerWidth < 900) { const el = document.querySelector('.detail'); if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30); } },
    'close-modal': () => HM.close(),
    'close-modal-scrim': () => HM.close(),
    modal: (d) => HM.open(d.m, Object.assign({}, d)),
    reload: () => HM.load(),
    logout: async () => { try { await call('/api/auth?action=logout', {}); } catch (e) { /* ignore */ } location.href = '/login'; },
    'open-thread': (d) => HM.openThread(d.id),
    'close-thread': () => { S.threadId = ''; S.thread = null; render(); },
    'go-thread': (d) => { S.tab[d.key] = d.tab || 'messages'; HM.openThread(d.id); window.scrollTo({ top: 0 }); },
    copy: (d) => { navigator.clipboard && navigator.clipboard.writeText(d.text || '').then(() => HM.toast('Copied')); }
  };

  // Account panel (any view)
  HM.account = () => {
    const me = S.me; const team = HM.isTeam(S.view);
    return html`<section class="panel narrow">
      <h2 class="h2">Your details</h2>
      <form class="stack" data-f="update-me" data-k="me">
        ${field('Full name', input('full_name', me.full_name, { autocomplete: 'name' }))}
        ${field('Mobile', input('phone', me.phone, { type: 'tel', autocomplete: 'tel' }))}
        ${when(team, field('Title shown to families', input('title', me.title, { placeholder: 'handmatch Concierge' })))}
        ${when(team, field('Photo', input('photo_url', me.photo_url, { placeholder: 'https://… or /assets/img/…' }), 'Families see this next to your name.'))}
        <p class="muted small">Signed in as ${me.email}. ${me.views.length > 1 ? 'Your access: ' + me.views.map((v) => VIEW_NAME[v]).join(', ') + '.' : ''}</p>
        <div><button class="btn" type="submit">Save details</button></div>
      </form>
    </section>`;
  };
  HM.forms['update-me'] = (fd) => HM.act('update_me', fd, 'Details saved');

  // ------------------------------------------------------------- start
  function start() {
    const v = location.hash.slice(1).split('/')[0];
    HM.load(v);
    setInterval(() => { if (!document.hidden && !S.modal && !S.busy && !document.querySelector('form [data-dirty]')) refreshQuiet(); }, 60000);
  }
  async function refreshQuiet() {
    try { const j = await call('/api/app?action=dashboard&view=' + S.view); apply(j); render(); } catch (e) { /* offline */ }
  }
  HM.refresh = refreshQuiet;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
