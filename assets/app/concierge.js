/* handmatch web app: handmatch Concierge (demand side, built-in customer service) */
(function () {
  'use strict';
  const { S, html, raw, when, fmtET, fmtDay, ago, dueIn, money, list, isoToEt, etToIso, ROLE_TYPE, KIND, avatar, pill, empty, field, input, textarea, select, check, kv } = HM;

  const P_STATUS = [['new', 'New · call family'], ['contacted', 'Contacted'], ['matching', 'Matching'], ['meeting', 'Meeting'], ['checks', 'Background check'], ['hired', 'Hired'], ['replacement', 'Replacement'], ['closed', 'Closed']];
  const P_TONE = { new: 'amber', contacted: '', matching: '', meeting: 'dark', checks: 'amber', hired: 'green', replacement: 'amber', closed: 'grey' };
  const L = { waiting: ['Waiting for applicant', 'amber'], accepted: ['Accepted · ready to meet', 'green'], declined: ['Declined', 'grey'], meeting: ['Meeting', 'dark'], passed: ['Passed · ticket open', 'green'], check: ['Background check', 'amber'], cleared: ['Cleared to hire', 'green'], hired: ['Hired', 'green'], ended: ['Replaced', 'grey'], not_fit: ['Not the right fit', 'grey'], not_selected: ['Not selected', 'grey'] };
  const CASE_TYPE = { safety: 'Safety', no_show: 'No-show', quality: 'Quality', schedule: 'Schedule', payment: 'Payment', replacement: 'Replacement', refund: 'Refund', other: 'Other' };
  const C_STATUS = [['open', 'Open'], ['in_progress', 'In progress'], ['waiting', 'Waiting on customer'], ['resolved', 'Resolved'], ['closed', 'Closed']];
  const PRI = { urgent: ['Urgent', 'red'], high: ['High', 'amber'], normal: ['Normal', ''] };
  const pStatus = (s) => pill((P_STATUS.find((x) => x[0] === s) || [s, s])[1], P_TONE[s]);

  function today(d) {
    const k = d.kpis; const ag = d.agenda;
    const tile = (n, label, tab, alert) => html`<button type="button" class="tile${alert && n ? ' alert' : ''}" data-a="tab" data-key="concierge" data-v="${tab}"><b>${n}</b><span>${label}</span></button>`;
    const mrow = (m, act) => html`<li><div><b>${KIND[m.kind]}: ${m.family} + ${m.applicant}</b><span class="muted small">${m.start_at ? fmtET(m.start_at) : 'Prefers: ' + m.preferred_times}</span></div>
      <span class="row">${act}<button class="btn-q sm" data-a="open-placement" data-id="${m.placement_id}">Open</button></span></li>`;
    const calls = d.placements.filter((p) => p.status === 'new');
    return html`<h1 class="h2">Today</h1>
      <div class="tiles">${tile(k.first_call, 'families to call', 'placements', k.overdue)}${tile(k.to_schedule, 'meetings to schedule', 'today', true)}${tile(k.upcoming, 'meetings this week', 'today')}${tile(k.need_outcome, 'waiting for a decision', 'today')}${tile(k.open_cases, 'open cases', 'cases', true)}${tile(k.unread, 'unread messages', 'messages', true)}</div>
      <div class="grid2">
        <section class="panel"><h2 class="h3">Call these families</h2>${calls.length ? html`<ul class="rows">${calls.map((p) => html`<li><div><b>${p.family.name || p.family.email}</b><span class="muted small">${p.help_type || 'Help'} near ${p.zip || '?'} · paid ${ago(p.created_at)}${p.overdue ? ' · overdue (1 business day)' : ''}</span></div><span class="row">${p.family.phone ? html`<a class="btn-o sm" href="tel:${p.family.phone}" data-nav="1">Call</a>` : ''}<button class="btn-q sm" data-a="open-placement" data-id="${p.id}">Open</button></span></li>`)}</ul>` : empty('No new families waiting for a call.')}</section>
        <section class="panel"><h2 class="h3">Meetings to schedule</h2>${ag.to_schedule.length ? html`<ul class="rows">${ag.to_schedule.map((m) => mrow(m, html`<button class="btn sm" data-a="modal" data-m="schedule" data-id="${m.id}" data-link="${m.link_id}">Schedule</button>`))}</ul>` : empty('Nothing to schedule.')}</section>
        <section class="panel"><h2 class="h3">Coming up</h2>${ag.upcoming.length ? html`<ul class="rows">${ag.upcoming.map((m) => mrow(m, m.applicant_confirmed ? pill('Applicant confirmed', 'green') : pill('Not confirmed', 'amber')))}</ul>` : empty('No meetings in the next 7 days.')}</section>
        <section class="panel"><h2 class="h3">Waiting for the family’s decision</h2>${ag.need_outcome.length ? html`<ul class="rows">${ag.need_outcome.map((m) => mrow(m, html`<button class="btn-o sm" data-a="modal" data-m="outcome" data-id="${m.id}" data-name="${m.applicant}">Record</button>`))}</ul>` : empty('No decisions pending.')}</section>
      </div>`;
  }

  function placementList(d) {
    const q = (S.f.pq || '').toLowerCase(); const st = S.f.pst || 'open'; const mine = S.f.pmine;
    const rows = d.placements.filter((p) => (st === 'all' || (st === 'open' ? p.status !== 'closed' : p.status === st))
      && (!mine || p.concierge_user_id === S.me.id)
      && (!q || [p.family.name, p.family.email, p.zip, p.help_type, p.order.ref].join(' ').toLowerCase().includes(q)));
    return html`<div class="list-h">
        <input class="inp" placeholder="Search name, ZIP, order" value="${S.f.pq || ''}" data-i="pq" aria-label="Search placements">
        <div class="row">${select('pst', [['open', 'All open'], ['all', 'Everything']].concat(P_STATUS), st, { 'data-i': 'pst', 'aria-label': 'Status' })}
        <label class="ck"><input type="checkbox" data-i="pmine" ${raw(mine ? 'checked' : '')}><span>Mine</span></label></div></div>
      <div class="list">${rows.length ? rows.map((p) => html`<button type="button" class="item${S.sel.placement === p.id ? ' on' : ''}${p.overdue ? ' warn' : ''}" data-a="sel" data-key="placement" data-id="${p.id}">
        <span class="row between"><b>${p.family.name || p.family.email}</b>${pStatus(p.status)}</span>
        <small>${p.help_type || 'Help'} · ${p.zip || 'no ZIP'}${p.territory_code ? ' (' + p.territory_code + ')' : ''} · ${p.applicants.filter((a) => !['declined', 'not_selected', 'not_fit'].includes(a.status)).length} applicants · ${ago(p.created_at)}</small></button>`) : empty('No placements match.')}</div>`;
  }

  function linkRow(p, a) {
    const [lab, tone] = L[a.status] || [a.status, ''];
    const open = a.meetings.find((m) => ['requested', 'confirmed'].includes(m.status));
    const due = a.meetings.find((m) => m.can_outcome);
    return html`<li class="link" data-k="${a.id}">
      <div class="row">${avatar(a.name, a.photo_url, 'sm')}<div class="stack-s"><b>${a.name}</b><span class="muted small">${ROLE_TYPE[a.role_type] || ''}${a.rate ? ' · $' + a.rate + '/hr' : ''} · ${a.phone || a.email}</span></div></div>
      <div class="stack-s">${pill(lab, tone)}${a.ticket_status ? html`<span class="muted small">Ticket: ${a.ticket_status.replace('_', ' ')}</span>` : ''}</div>
      <div class="stack-s small">${a.meetings.filter((m) => m.status !== 'cancelled').slice(0, 3).map((m) => html`<span>${KIND[m.kind]} · ${m.status === 'requested' ? 'requested: ' + m.preferred_times : fmtET(m.start_at)}${m.outcome ? ' · ' + (m.outcome === 'pass' ? 'Pass' : 'Not fit') : ''}${m.status === 'confirmed' ? (m.applicant_confirmed ? ' · confirmed' : ' · not confirmed') : ''}</span>`)}</div>
      <div class="row end">
        ${when(open, () => html`<button class="btn sm" data-a="modal" data-m="schedule" data-id="${open.id}" data-link="${a.id}">${open.status === 'requested' ? 'Schedule' : 'Reschedule'}</button><button class="btn-q sm" data-a="cancel-meeting" data-id="${open.id}">Cancel</button>`)}
        ${when(!open && ['accepted', 'meeting'].includes(a.status), () => html`<button class="btn-o sm" data-a="modal" data-m="schedule" data-link="${a.id}">Book meeting</button>`)}
        ${when(due, () => html`<button class="btn-o sm" data-a="modal" data-m="outcome" data-id="${due.id}" data-name="${a.name}">Record outcome</button>`)}
        ${when(a.status === 'waiting', () => html`<button class="btn-q sm" data-a="link-status" data-id="${a.id}" data-status="accepted">Mark available</button>`)}
        ${when(a.status === 'cleared' && !a.balance_due, () => html`<button class="btn sm" data-a="modal" data-m="hire" data-id="${a.id}" data-name="${a.name}">Hire</button>`)}
        ${when(a.status === 'cleared' && a.balance_due, () => html`<span class="muted small">Waiting for the family to pay the balance</span><button class="btn-o sm" data-a="modal" data-m="markbalance" data-id="${a.id}" data-name="${a.name}">Mark balance paid</button>`)}
        ${when(a.status === 'hired', () => html`<button class="btn-o sm" data-a="modal" data-m="replacement" data-id="${a.id}" data-name="${a.name}">Start replacement</button>`)}
        ${when(a.thread_id, () => html`<button class="btn-q sm" data-a="go-thread" data-key="concierge" data-id="${a.thread_id}">Chat</button>`)}
        ${when(!['hired', 'ended', 'removed'].includes(a.status), () => html`<button class="btn-q sm" data-a="link-status" data-id="${a.id}" data-status="removed">Remove</button>`)}
      </div></li>`;
  }

  function placementDetail(d, p) {
    if (!p) return html`<div class="detail">${empty('Choose a placement to see the family, their applicants and the timeline.')}</div>`;
    const r = p.request; const rp = p.refund_preview || {};
    const pool = d.pool.filter((x) => !p.applicants.some((a) => a.user_id === x.user_id && !['declined', 'not_selected', 'not_fit'].includes(a.status)));
    return html`<div class="detail" data-k="${p.id}">
      <section class="panel">
        <div class="row between"><div><h2 class="h2">${p.family.name || p.family.email} ${p.fee_model === 'deposit' ? pill('Deposit model (test B)', 'amber') : ''}</h2><span class="muted">${p.family.email}${p.family.phone ? ' · ' + p.family.phone : ''}</span></div>
          <div class="row">${p.family.phone ? html`<a class="btn-o sm" href="tel:${p.family.phone}" data-nav="1">Call</a>` : ''}${when(p.concierge_thread_id, () => html`<button class="btn-o sm" data-a="go-thread" data-key="concierge" data-id="${p.concierge_thread_id}">Message family</button>`)}<button class="btn-q sm" data-a="modal" data-m="logcall" data-id="${p.id}">Log call</button><button class="btn-q sm" data-a="invite-family" data-id="${p.id}">Send sign-in link</button></div></div>
        ${when(p.overdue, () => html`<p class="alert-line">First call is overdue. Families should hear from us within 1 business day of paying.</p>`)}
        <form class="grid4" data-f="placement" data-k="pl-${p.id}-${p.updated_at}">
          <input type="hidden" name="id" value="${p.id}">
          ${field('Status', select('status', P_STATUS, p.status))}
          ${field('Concierge', select('concierge_user_id', [['', 'Unassigned']].concat(d.concierges.map((c) => [c.id, c.full_name])), p.concierge_user_id))}
          ${field('ZIP', input('zip', p.zip, { maxlength: 5, inputmode: 'numeric' }), p.territory_code ? 'Territory ' + p.territory_code : 'Not in a territory')}
          ${field('Help type', input('help_type', p.help_type))}
          ${field('Hires covered', input('hires_allowed', p.hires_allowed, { type: 'number', min: 1, max: 5 }))}
          <div class="field span3">${field('Private notes', textarea('notes', p.notes, { rows: 2 }))}</div>
          <div class="row end span4"><button class="btn sm" type="submit">Save placement</button></div>
        </form>
      </section>
      <div class="grid2">
        <section class="panel"><h3 class="h3">What they asked for</h3>${r ? kv([['Services', list(r.services)], ['Days', list(r.days)], ['How often', r.frequency], ['Budget', r.budget_per_hour ? '$' + r.budget_per_hour + '/hr' : ''], ['Home', r.home_size], ['Pets', r.pets ? 'Yes' : 'No'], ['Supplies', r.supplies ? 'Family provides' : ''], ['Notes', r.notes]]) : html`<p class="muted">No preferences form on file. Ask on your first call.</p>`}</section>
        <section class="panel"><h3 class="h3">Payment & promises</h3>${kv([['Order', p.order.ref], ['Paid', money(p.order.paid_cents)], ['Refunded', p.order.refunded_cents ? money(p.order.refunded_cents) : ''], ['Refund policy now', rp.percent ? rp.percent + '% (' + money(rp.amount_cents) + ')' : 'No refund due'], ['Replacements', p.replacements_used + ' of 3 used' + (p.hired_at ? '' : ' · window starts at first hire')], ['First call', p.first_contact_at ? fmtDay(p.first_contact_at) : 'Not yet']])}</section>
      </div>
      <section class="panel"><div class="row between"><h3 class="h3">Applicants</h3><button class="btn-q sm" data-a="modal" data-m="supply" data-id="${p.id}" data-zip="${p.zip}" data-help="${p.help_type}">Ask Recruiters for more</button></div>
        ${p.applicants.length ? html`<ul class="links">${p.applicants.map((a) => linkRow(p, a))}</ul>` : html`<p class="muted">No applicants shared yet. Pick from the suggestions below.</p>`}
        <h4 class="h4">Suggested matches</h4>
        ${p.suggestions.length ? html`<ul class="sugg">${p.suggestions.map((s) => html`<li><div><b>${s.name}</b><span class="muted small">${ROLE_TYPE[s.role_type]} · ${s.zip}${s.rate ? ' · $' + s.rate + '/hr' : ''}${s.busy ? ' · on ' + s.busy + ' other placement' + (s.busy > 1 ? 's' : '') : ''}</span><span class="small">${s.why.join(' · ')}</span></div><span class="score" title="Match score">${s.score}</span><button class="btn-o sm" data-a="add-applicant" data-p="${p.id}" data-u="${s.user_id}">Share</button></li>`)}</ul>` : html`<p class="muted small">No active applicants yet. Ask the Recruiters for supply.</p>`}
        <form class="row" data-f="add-applicant" data-k="add-${p.id}-${p.applicants.length}"><input type="hidden" name="placement_id" value="${p.id}">
          ${select('applicant_user_id', [['', 'Share any active applicant…']].concat(pool.map((x) => [x.user_id, `${x.name} · ${ROLE_TYPE[x.role_type]} · ${x.zip || '?'}`])), '', { 'aria-label': 'Choose an applicant to share' })}<button class="btn-o sm" type="submit">Share</button></form>
      </section>
      <section class="panel"><h3 class="h3">Timeline</h3>
        <form class="stack" data-f="note" data-k="note-${p.id}-${p.events.length}"><input type="hidden" name="placement_id" value="${p.id}">${textarea('body', '', { rows: 2, placeholder: 'Add a note', 'aria-label': 'Note' })}<div class="row between">${check('visible', false, 'Show to the family')}<button class="btn-o sm" type="submit">Add note</button></div></form>
        <ol class="timeline">${p.events.map((e) => html`<li><span class="t-dot${e.visible ? '' : ' private'}" aria-hidden="true"></span><div><p>${e.body}</p><time>${ago(e.created_at)}${e.actor ? ' · ' + e.actor : ''}${e.visible ? '' : ' · team only'}</time></div></li>`)}</ol>
      </section>
    </div>`;
  }

  function placements(d) {
    const p = d.placements.find((x) => x.id === S.sel.placement);
    return html`<div class="row between"><h1 class="h2">Placements</h1><div class="row"><button class="btn-q sm" data-a="sync-orders">Import paid orders</button><button class="btn sm" data-a="modal" data-m="newplacement">New placement</button></div></div>
      <div class="split"><div>${placementList(d)}</div>${placementDetail(d, p)}</div>`;
  }

  function cases(d) {
    const st = S.f.cst || 'open';
    const rows = d.cases.filter((c) => st === 'all' || (st === 'open' ? ['open', 'in_progress', 'waiting'].includes(c.status) : c.status === st));
    const c = d.cases.find((x) => x.id === S.sel.case);
    return html`<div class="row between"><h1 class="h2">Support cases</h1><button class="btn sm" data-a="modal" data-m="teamcase">Open a case</button></div>
      <div class="split"><div><div class="list-h">${select('cst', [['open', 'Open'], ['all', 'All']].concat(C_STATUS), st, { 'data-i': 'cst', 'aria-label': 'Status' })}</div>
        <div class="list">${rows.length ? rows.map((x) => html`<button type="button" class="item${S.sel.case === x.id ? ' on' : ''}${x.overdue ? ' warn' : ''}" data-a="sel" data-key="case" data-id="${x.id}"><span class="row between"><b>${x.subject}</b>${pill(...PRI[x.priority])}</span><small>${CASE_TYPE[x.type]} · ${x.family ? x.family.name : x.applicant ? x.applicant.name : ''} · ${['resolved', 'closed'].includes(x.status) ? x.status : dueIn(x.due_at)}</small></button>`) : empty('No cases here.')}</div></div>
        <div class="detail">${c ? html`<section class="panel" data-k="${c.id}">
          <div class="row between"><h2 class="h2">${c.subject}</h2>${pill(...PRI[c.priority])}</div>
          ${kv([['Type', CASE_TYPE[c.type]], ['Opened', fmtET(c.created_at) + (c.opened_by ? ' by ' + c.opened_by : '')], ['Response due', ['resolved', 'closed'].includes(c.status) ? 'Resolved ' + fmtDay(c.resolved_at) : fmtET(c.due_at) + ' (' + dueIn(c.due_at) + ')'], ['Family', c.family ? `${c.family.name} · ${c.family.phone || c.family.email}` : ''], ['Applicant', c.applicant ? `${c.applicant.name} · ${c.applicant.phone || ''}` : '']])}
          ${when(c.description, () => html`<blockquote>${c.description}</blockquote>`)}
          ${when(c.type === 'safety' && !['resolved', 'closed'].includes(c.status), () => html`<p class="alert-line">Safety case: call the person now. If anyone is in danger, they should call 911. Pause the applicant if needed and tell Admin.</p>`)}
          <form class="stack" data-f="case-update" data-k="cu-${c.id}-${c.status}"><input type="hidden" name="id" value="${c.id}">
            <div class="grid2">${field('Status', select('status', C_STATUS, c.status))}${field('Priority', select('priority', [['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal']], c.priority))}</div>
            ${field('Resolution', textarea('resolution', c.resolution, { rows: 2, placeholder: 'What did we do? Shown to the customer when resolved.' }))}
            <div class="row">${when(c.thread_id, () => html`<button type="button" class="btn-o sm" data-a="go-thread" data-key="concierge" data-id="${c.thread_id}">Open conversation</button>`)}${when(c.placement_id, () => html`<button type="button" class="btn-q sm" data-a="open-placement" data-id="${c.placement_id}">Open placement</button>`)}<button class="btn sm" type="submit">Save case</button></div>
          </form></section>` : empty('Choose a case.')}</div></div>`;
  }

  function supply(d) {
    return html`<div class="row between"><h1 class="h2">Supply requests</h1><button class="btn sm" data-a="modal" data-m="supply">New request</button></div>
      <p class="muted">Ask the Recruiters for more applicants in an area. They see these on their board.</p>
      ${d.supply.length ? html`<ul class="rows panel">${d.supply.map((s) => html`<li><div><b>${s.needed} × ${ROLE_TYPE[s.role_type]} in ${s.territory_code}${s.zip ? ' near ' + s.zip : ''}</b><span class="muted small">${s.details} · ${dueIn(s.due_at)}</span></div>${pill(s.status === 'open' ? 'Open' : 'In progress', s.status === 'open' ? 'amber' : '')}</li>`)}</ul>` : empty('No open supply requests.')}`;
  }

  HM.views.concierge = {
    render(d) {
      const k = d.kpis;
      return HM.teamShell([
        { id: 'today', label: 'Today', badge: k.to_schedule + k.need_outcome || 0 },
        { id: 'placements', label: 'Placements', badge: k.first_call, alert: k.overdue },
        { id: 'cases', label: 'Cases', badge: k.open_cases, alert: d.cases.some((c) => c.overdue) },
        { id: 'messages', label: 'Messages', badge: k.unread },
        { id: 'supply', label: 'Supply', badge: d.supply.length },
        { id: 'account', label: 'My details' }
      ], (cur) => cur === 'placements' ? placements(d) : cur === 'cases' ? cases(d) : cur === 'supply' ? supply(d) : cur === 'account' ? HM.account()
        : cur === 'messages' ? html`<h1 class="h2">Messages</h1>${HM.chat(d.threads, { empty: 'Conversations with families and applicants appear here.' })}` : today(d));
    }
  };

  // ------------------------------------------------------------- handlers
  const findMeeting = (id) => { for (const p of S.data.placements) for (const a of p.applicants) for (const m of a.meetings) if (m.id === id) return { p, a, m }; return {}; };
  const findLink = (id) => { for (const p of S.data.placements) for (const a of p.applicants) if (a.id === id) return { p, a }; return {}; };

  HM.modals.markbalance = (c) => ({
    title: `Balance paid for ${c.name}?`,
    body: html`<form class="stack" data-f="markbalance"><input type="hidden" name="link_id" value="${c.id}">
      <p class="muted">Use this when the family paid the balance outside the app (for example, a payment link you sent). This confirms the hire and shares contact details.</p>
      ${field('Payment reference', input('reference', '', { placeholder: 'Stripe link, Zelle…', 'data-autofocus': true }))}
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Mark paid and hire</button></div></form>`
  });
  HM.forms.markbalance = (fd) => HM.act('mark_balance_paid', fd, 'Balance recorded. The hire is confirmed.');
  HM.actions['open-placement'] = (d) => { S.tab.concierge = 'placements'; S.sel.placement = d.id; HM.render(); window.scrollTo({ top: 0 }); };
  HM.actions['add-applicant'] = (d) => HM.act('add_applicant', { placement_id: d.p, applicant_user_id: d.u }, 'Shared. We’ve asked the applicant to confirm.');
  HM.forms['add-applicant'] = (fd) => (fd.applicant_user_id ? HM.act('add_applicant', fd, 'Shared. We’ve asked the applicant to confirm.') : HM.toast('Choose an applicant first.', true));
  HM.actions['link-status'] = (d) => { if (d.status !== 'removed' || HM.confirm('Remove this applicant from the placement?')) HM.act('update_link', { id: d.id, status: d.status }, 'Updated'); };
  HM.actions['invite-family'] = (d) => HM.act('invite_family', { placement_id: d.id }, 'Sign-in link sent');
  HM.actions['sync-orders'] = () => HM.act('sync_orders', {}, (r) => HM.toast(r.created ? `Imported ${r.created} paid order${r.created > 1 ? 's' : ''}` : 'All paid orders are already here'));
  HM.forms.placement = (fd) => HM.act('update_placement', fd, 'Placement saved');
  HM.forms.note = (fd) => (fd.body.trim() ? HM.act('add_note', fd, 'Note added') : HM.toast('Write a note first.', true));
  HM.forms['case-update'] = (fd) => HM.act('update_case', fd, 'Case saved');

  HM.modals.schedule = (c) => {
    const { m } = c.id ? findMeeting(c.id) : {}; const { p, a } = findLink(c.link);
    const kind = S.f.schedKind || (m && m.kind) || 'video';
    const terr = p && S.data.territories.find((t) => t.code === p.territory_code);
    return {
      title: `${m && m.status === 'confirmed' ? 'Reschedule' : 'Schedule'}: ${p ? p.family.name : ''} + ${a ? a.name : ''}`,
      body: html`<form class="stack" data-f="schedule" data-k="sch-${c.id || c.link}">
        <input type="hidden" name="meeting_id" value="${c.id || ''}"><input type="hidden" name="link_id" value="${c.link || ''}">
        ${when(m && m.preferred_times, () => html`<p class="note">Family prefers: <b>${m.preferred_times}</b>${m.family_note ? '. Note: ' + m.family_note : ''}</p>`)}
        <div class="grid2">${field('Type', select('kind', [['phone', 'Phone call'], ['video', 'Video interview'], ['trial', 'Paid trial']], kind, { 'data-c': 'sched-kind' }))}
          ${field('Date and time (New York)', input('start_at', m && m.start_at ? isoToEt(m.start_at) : '', { type: 'datetime-local', required: true }))}</div>
        ${field(kind === 'trial' ? 'Address notes for the applicant' : kind === 'video' ? 'Video link' : 'Call details', input('join_info', m ? m.join_info : '', { placeholder: kind === 'video' ? 'https://meet.google.com/…' : kind === 'phone' ? 'We’ll connect you on a 3-way call' : 'Cross street, buzzer, parking (full address shared by phone)' }))}
        ${when(kind === 'trial', () => html`<div class="grid2">${field('Hours', input('trial_hours', (m && m.trial_hours) || 3, { type: 'number', min: 2, max: 8, step: 0.5 }))}${field('Rate ($/hr)', input('trial_rate', (m && m.trial_rate) || Math.max(20, terr ? terr.min_wage : 0), { type: 'number', step: 0.5, min: terr ? terr.min_wage : 0 }), terr ? `Minimum wage in ${terr.code}: $${Number(terr.min_wage).toFixed(2)}` : '')}</div>`)}
        <p class="muted small">Both get an email and a message in their shared chat. The applicant is asked to confirm.</p>
        <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Confirm time</button></div></form>`
    };
  };
  HM.actions['sched-kind'] = (d, el) => { S.f.schedKind = el.value; HM.render(); };
  HM.forms.schedule = (fd) => { fd.start_at = etToIso(fd.start_at); if (!fd.meeting_id) delete fd.meeting_id; return HM.act('schedule_meeting', fd, () => { S.f.schedKind = ''; S.modal = null; HM.toast('Meeting confirmed. Both have been told.'); }); };

  HM.modals.logcall = (c) => ({
    title: 'Log a call with the family',
    body: html`<form class="stack" data-f="logcall"><input type="hidden" name="placement_id" value="${c.id}">${field('What did you learn?', textarea('note', '', { rows: 4, 'data-autofocus': true, placeholder: 'Home, kids, pets, schedule, must-haves' }))}<p class="muted small">Saved as a team-only note. Moves a new placement to Contacted.</p><div class="row end"><button class="btn" type="submit">Save call</button></div></form>`
  });
  HM.forms.logcall = (fd) => HM.act('log_call', fd, 'Call logged');

  HM.modals.replacement = (c) => {
    const { p } = findLink(c.id);
    const openCase = p ? S.data.cases.find((x) => x.placement_id === p.id && x.type === 'replacement' && ['open', 'in_progress', 'waiting'].includes(x.status)) : null;
    return {
      title: `Start a replacement for ${c.name}`,
      body: html`<form class="stack" data-f="replacement"><input type="hidden" name="link_id" value="${c.id}"><input type="hidden" name="case_id" value="${openCase ? openCase.id : ''}">
        <p>${p ? p.replacement.reason : ''} The placement goes back to matching and the family can hire again.</p>
        ${when(openCase, () => html`<p class="muted small">This will also resolve the case “${openCase.subject}”.</p>`)}
        ${when(p && !p.replacement.eligible && S.me.views.includes('admin'), check('override', false, 'Admin override: allow outside the promise'))}
        <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Start replacement</button></div></form>`
    };
  };
  HM.forms.replacement = (fd) => { if (!fd.case_id) delete fd.case_id; return HM.act('start_replacement', fd, 'Replacement started'); };

  HM.modals.newplacement = () => ({
    title: 'New placement',
    body: html`<form class="stack" data-f="newplacement"><p class="muted small">For families who paid outside the website. Paid website orders appear automatically.</p>
      <div class="grid2">${field('Family email', input('email', '', { type: 'email', required: true, 'data-autofocus': true }))}${field('Full name', input('full_name', ''))}${field('Mobile', input('phone', '', { type: 'tel' }))}${field('ZIP', input('zip', '', { maxlength: 5 }))}${field('Help type', select('help_type', ['House cleaner', 'Housekeeper', 'Nanny'], 'Housekeeper'))}${field('Hires', input('hires', '1', { type: 'number', min: 1, max: 5 }))}</div>
      ${check('invite', true, 'Email them a sign-in link')}
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Create placement</button></div></form>`
  });
  HM.forms.newplacement = (fd) => HM.act('create_placement', fd, (r) => { S.modal = null; S.tab.concierge = 'placements'; S.sel.placement = r.placement_id; HM.toast('Placement created'); });

  HM.modals.supply = (c) => ({
    title: 'Ask Recruiters for applicants',
    body: html`<form class="stack" data-f="supply"><input type="hidden" name="placement_id" value="${c.id || ''}">
      <div class="grid2">${field('Type', select('role_type', [['cleaner', 'House cleaner'], ['housekeeper', 'Housekeeper'], ['nanny', 'Nanny']], /nann/i.test(c.help || '') ? 'nanny' : /clean/i.test(c.help || '') ? 'cleaner' : 'housekeeper'))}${field('ZIP', input('zip', c.zip || '', { maxlength: 5 }))}${field('How many', input('needed', '3', { type: 'number', min: 1, max: 50 }))}${field('Max rate ($/hr)', input('rate_max', '', { type: 'number' }))}</div>
      ${field('What the family needs', textarea('details', '', { rows: 3, placeholder: 'Languages, days, experience, pets' }))}
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Send to Recruiters</button></div></form>`
  });
  HM.forms.supply = (fd) => { if (!fd.placement_id) delete fd.placement_id; return HM.act('create_supply_request', fd, 'Sent to the Recruiters'); };

  HM.modals.teamcase = () => ({
    title: 'Open a case',
    body: html`<form class="stack" data-f="teamcase">
      ${field('Placement', select('placement_id', [['', 'Not linked']].concat(S.data.placements.map((p) => [p.id, (p.family.name || p.family.email) + ' · ' + (p.zip || '')])), S.sel.placement || ''))}
      ${field('Type', select('type', Object.entries(CASE_TYPE), 'quality'))}${field('Subject', input('subject', '', { required: true }))}${field('Details', textarea('description', '', { rows: 3 }))}
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Open case</button></div></form>`
  });
  HM.forms.teamcase = (fd) => HM.act('team_open_case', fd, (r) => { S.modal = null; S.tab.concierge = 'cases'; S.sel.case = r.case_id; HM.toast('Case opened'); });
})();
