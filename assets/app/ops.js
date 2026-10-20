/* handmatch web app: Finance, Compliance and Admin */
(function () {
  'use strict';
  const { S, html, raw, when, fmtET, fmtDay, ago, dueIn, money, ROLE_TYPE, pill, empty, field, input, textarea, select, check, kv, tick } = HM;
  const tile = (n, l, alert) => html`<div class="tile static${alert ? ' alert' : ''}"><b>${n}</b><span>${l}</span></div>`;

  // ================================================================ Finance
  const RF = { requested: ['Needs decision', 'amber'], approved: ['Approved · pay out', 'dark'], denied: ['Denied', 'grey'], refunded: ['Refunded', 'green'] };
  const RULE = { before_shared: 'Cancelled before applicants were shared', no_match_14: 'No suitable match in 14 days', no_hire_30: 'No hire within 30 days', too_early: 'Too early for the 50% refund', hired: 'Already hired', already_refunded: 'Already refunded', no_payment: 'No payment' };

  function refundCard(r) {
    const el = r.eligibility || {};
    return html`<article class="panel" data-k="${r.id}-${r.status}">
      <div class="row between"><div><h3 class="h3">${r.family} · ${money(r.amount_cents)}</h3><span class="muted small">${r.order_ref} · paid ${money(r.paid_cents)} · requested ${ago(r.created_at)} · placement ${r.placement_status || '—'}</span></div>${pill(...RF[r.status])}</div>
      <blockquote>${r.reason}</blockquote>
      <p class="eligible ${el.percent ? 'yes' : ''}"><b>Policy: ${el.percent || 0}%${el.amount_cents != null ? ' (' + money(el.amount_cents) + ')' : ''}.</b> ${RULE[el.rule] || ''}. ${el.reason || ''}${el.days_since_payment != null ? ' Day ' + el.days_since_payment + ' since payment.' : ''}</p>
      ${when(r.status === 'requested', () => html`<form class="row wrap-gap" data-f="refund-decide"><input type="hidden" name="id" value="${r.id}">
        <label class="field inline"><span class="lbl">Amount ($)</span>${input('amount', (r.amount_cents / 100).toFixed(2), { type: 'number', step: '0.01', min: 0, style: 'max-width:120px' })}</label>
        ${input('note', '', { placeholder: 'Note (required to deny or go above policy)', 'aria-label': 'Note', style: 'flex:1;min-width:200px' })}
        <button class="btn sm" type="submit" name="decision" value="approve">Approve</button><button class="btn-q sm" type="submit" name="decision" value="deny">Deny</button></form>`)}
      ${when(r.status === 'approved', () => html`<div class="row"><button class="btn sm" data-a="pay-refund" data-id="${r.id}">Refund ${money(r.amount_cents)} with Stripe</button><button class="btn-q sm" data-a="modal" data-m="manualrefund" data-id="${r.id}">Mark refunded manually</button></div>`)}
      ${when(r.decided_by || r.decision_note, () => html`<p class="muted small">${r.decided_by ? 'Decided by ' + r.decided_by + ' ' + ago(r.decided_at) + '. ' : ''}${r.decision_note}${r.stripe_refund_id ? ' · ' + r.stripe_refund_id : ''}</p>`)}
    </article>`;
  }

  function financeOverview(d) {
    const k = d.kpis;
    return html`<h1 class="h2">Finance</h1>
      ${when(!d.stripe, () => html`<p class="note">Stripe isn’t connected in this environment, so refunds are marked manually after you refund in Stripe.</p>`)}
      <div class="tiles">${tile(money(k.month_cents), 'Paid this month')}${tile(money(k.gross_cents), 'Paid all time')}${tile(money(k.refunded_cents), 'Refunded')}${tile(money(k.net_cents), 'Net revenue')}${tile(k.paid_orders, 'Paid orders')}${tile(k.hires, 'Hires sold')}${tile(k.pending_refunds, 'Refunds to handle', k.pending_refunds)}${tile(money(k.bonuses_due_cents), 'Referral bonuses due', k.bonuses_due_cents)}</div>
      <section class="panel"><h2 class="h3">Refund policy (applied automatically)</h2><ul class="policy"><li><b>100%</b> if cancelled before applicants are shared, or no suitable match within 14 days.</li><li><b>50%</b> if applicants were shared but no hire within 30 days.</li><li><b>0%</b> after a hire. Up to 3 replacements within 90 days instead.</li></ul><p class="muted small">You make the final call. Going above the policy needs a note, and every decision is in the audit log.</p></section>`;
  }

  function refunds(d) {
    const open = d.refunds.filter((r) => ['requested', 'approved'].includes(r.status));
    const done = d.refunds.filter((r) => !['requested', 'approved'].includes(r.status));
    return html`<div class="row between"><h1 class="h2">Refunds</h1><button class="btn-o sm" data-a="modal" data-m="newrefund">Start a refund</button></div>
      ${open.length ? html`<div class="stack">${open.map(refundCard)}</div>` : empty('No refunds waiting.')}
      ${when(done.length, () => html`<details class="past"><summary>Decided (${done.length})</summary><div class="stack">${done.map(refundCard)}</div></details>`)}`;
  }

  function orders(d) {
    const q = (S.f.oq || '').toLowerCase();
    const rows = d.orders.filter((o) => !q || [o.ref, o.name, o.email, o.status].join(' ').toLowerCase().includes(q));
    return html`<div class="row between"><h1 class="h2">Orders</h1><button class="btn-o sm" data-a="export-orders">Download CSV</button></div>
      <input class="inp" placeholder="Search order, name, email" value="${S.f.oq || ''}" data-i="oq" aria-label="Search orders">
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Family</th><th>Hires</th><th>Paid</th><th>Refunded</th><th>Status</th><th>Placement</th><th>Date</th></tr></thead>
      <tbody>${rows.map((o) => html`<tr><td>${o.ref}</td><td>${o.name}<br><span class="muted small">${o.email}</span></td><td>${o.hires}</td><td>${money(o.paid_cents || (o.status === 'pending' ? null : o.amount_cents))}</td><td>${o.refunded_cents ? money(o.refunded_cents) : ''}</td><td>${pill(o.status, o.status === 'paid' ? 'green' : o.status === 'refunded' ? 'grey' : 'amber')}</td><td>${o.placement_status}</td><td>${fmtDay(o.paid_at || o.created_at)}</td></tr>`)}</tbody></table></div>`;
  }

  function bonuses(d) {
    return html`<h1 class="h2">Referral bonuses</h1><p class="muted">Earned when a referred applicant is hired.</p>
      ${d.bonuses.length ? html`<ul class="rows panel">${d.bonuses.map((b) => html`<li data-k="${b.id}-${b.status}"><div><b>${money(b.bonus_cents)} to ${b.referrer}</b><span class="muted small">For referring ${b.name}${b.referrer_phone ? ' · ' + b.referrer_phone : ''}${b.paid_at ? ' · paid ' + fmtDay(b.paid_at) : ''}</span></div>${b.status === 'hired' ? html`<button class="btn sm" data-a="modal" data-m="paybonus" data-id="${b.id}" data-name="${b.referrer}">Mark paid</button>` : pill('Paid', 'green')}</li>`)}</ul>` : empty('No bonuses earned yet.')}`;
  }

  HM.views.finance = {
    render(d) {
      return HM.teamShell([
        { id: 'overview', label: 'Overview' }, { id: 'refunds', label: 'Refunds', badge: d.kpis.pending_refunds, alert: true },
        { id: 'orders', label: 'Orders' }, { id: 'bonuses', label: 'Referral bonuses', badge: d.bonuses.filter((b) => b.status === 'hired').length }, { id: 'account', label: 'My details' }
      ], (cur) => cur === 'refunds' ? refunds(d) : cur === 'orders' ? orders(d) : cur === 'bonuses' ? bonuses(d) : cur === 'account' ? HM.account() : financeOverview(d));
    }
  };
  HM.forms['refund-decide'] = (fd) => HM.act('decide_refund', fd, fd.decision === 'approve' ? 'Approved. Now pay it out.' : 'Refund denied. The family has been told.');
  HM.actions['pay-refund'] = (d) => { if (HM.confirm('Send this refund through Stripe now?')) HM.act('pay_refund', { id: d.id }, 'Refunded. The family has been emailed.'); };
  HM.modals.manualrefund = (c) => ({ title: 'Mark refunded manually', body: html`<form class="stack" data-f="manualrefund"><input type="hidden" name="id" value="${c.id}"><p class="muted">Use this after refunding in the Stripe dashboard (or another way).</p>${field('Stripe refund ID or reference', input('reference', '', { placeholder: 're_…', 'data-autofocus': true }))}<div class="row end"><button class="btn" type="submit">Mark refunded</button></div></form>` });
  HM.forms.manualrefund = (fd) => HM.act('pay_refund', Object.assign(fd, { manual: true }), 'Marked as refunded. The family has been emailed.');
  HM.modals.newrefund = () => ({ title: 'Start a refund', body: html`<form class="stack" data-f="newrefund">${field('Order', select('order_id', S.data.orders.filter((o) => o.status === 'paid').map((o) => [o.id, `${o.ref} · ${o.name} · ${money(o.paid_cents)}`]), ''))}${field('Reason', textarea('reason', '', { rows: 2 }))}<p class="muted small">The policy amount is worked out for you. You approve it next.</p><div class="row end"><button class="btn" type="submit">Create</button></div></form>` });
  HM.forms.newrefund = (fd) => HM.act('create_refund', fd, 'Refund created. Review it in the queue.');
  HM.modals.paybonus = (c) => ({ title: `Pay ${c.name}`, body: html`<form class="stack" data-f="paybonus"><input type="hidden" name="id" value="${c.id}">${field('Payment reference', input('reference', '', { placeholder: 'Zelle, Venmo, check number…', 'data-autofocus': true }))}<div class="row end"><button class="btn" type="submit">Mark paid</button></div></form>` });
  HM.forms.paybonus = (fd) => HM.act('pay_bonus', fd, 'Bonus marked paid');
  HM.actions['export-orders'] = () => {
    const rows = [['order', 'name', 'email', 'phone', 'hires', 'amount', 'paid', 'refunded', 'status', 'placement', 'paid_at']].concat(S.data.orders.map((o) => [o.ref, o.name, o.email, o.phone, o.hires, (o.amount_cents || 0) / 100, (o.paid_cents || 0) / 100, (o.refunded_cents || 0) / 100, o.status, o.placement_status, o.paid_at || '']));
    const csv = rows.map((r) => r.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'handmatch-orders-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
  };

  // ============================================================= Compliance
  const TK = { ready_review: ['Ready to review', 'amber'], ordered: ['Ordered', 'dark'], in_progress: ['In progress', 'dark'], needs_review: ['Needs review', 'red'], clear: ['Clear', 'green'], not_cleared: ['Not cleared', 'grey'], cancelled: ['Cancelled', 'grey'] };
  const PROVIDERS = ['Checkr', 'Certn', 'Sterling', 'GoodHire', 'Other'];

  function ticketDetail(t) {
    if (!t) return html`<div class="detail">${empty('Choose a ticket. Tickets open automatically when a family passes an applicant.')}</div>`;
    const cl = t.checklist; const canOrder = cl.consent && cl.identity && t.placement.territory_sellable;
    const ready = t.adverse_ready_at && new Date(t.adverse_ready_at) <= new Date();
    return html`<div class="detail" data-k="${t.id}-${t.status}"><section class="panel">
      <div class="row between"><div><h2 class="h2">${t.applicant.name}</h2><span class="muted">${ROLE_TYPE[t.applicant.role_type] || ''} · ${t.applicant.email} · ${t.applicant.phone}</span></div>${pill(...TK[t.status])}</div>
      ${kv([['Opened', fmtET(t.created_at)], ['Order by', t.status === 'ready_review' ? fmtET(t.due_at) + ' (' + dueIn(t.due_at) + ')' : ''], ['Placement', `ZIP ${t.placement.zip || '?'} · ${t.placement.territory_code || 'no territory'}${t.placement.territory_sellable ? '' : ' · NOT sellable'}`], ['Check', t.check ? `${t.check.provider} ${t.check.package} · ${t.check.external_ref || 'no ref'} · ${money(t.check.cost_cents)} · ordered ${fmtDay(t.check.ordered_at)}` : ''], ['Pre-adverse notice', t.adverse_notice_at ? fmtDay(t.adverse_notice_at) + ' · final decision allowed from ' + fmtDay(t.adverse_ready_at) : '']])}
      ${when(t.status === 'ready_review', () => html`
        <form class="stack" data-f="ticket" data-k="tk-${t.id}"><input type="hidden" name="id" value="${t.id}">
          <h3 class="h3">Before ordering</h3>
          <div class="toggles col">${check('consent', cl.consent, 'Signed background check consent (FCRA disclosure)')}${check('identity', cl.identity, 'Identity confirmed (photo ID matches)')}${check('references', cl.references, 'References checked')}${check('interview', cl.interview, 'Screening interview done')}</div>
          ${field('Notes', textarea('notes', t.notes, { rows: 2 }))}<div><button class="btn-o sm" type="submit">Save checklist</button></div></form>
        ${when(t.reusable, () => html`<div class="note row between"><span>A clear ${t.reusable.provider} check from ${fmtDay(t.reusable.completed_at)} is valid until ${fmtDay(t.reusable.expires_at)}. No need to pay for a new one.</span><button class="btn sm" data-a="reuse-check" data-id="${t.id}">Reuse it</button></div>`)}
        <form class="stack" data-f="order-check" data-k="oc-${t.id}"><input type="hidden" name="id" value="${t.id}"><h3 class="h3">Order the background check</h3>
          ${when(!canOrder, () => html`<p class="alert-line">Needs signed consent, confirmed identity and a sellable territory before ordering.</p>`)}
          <div class="grid2">${field('Provider', select('provider', PROVIDERS, 'Checkr'))}${field('Package', input('package', '', { placeholder: 'e.g. Essential + MVR' }))}${field('Cost ($)', input('cost', '', { type: 'number', step: '0.01' }))}${field('Provider reference', input('external_ref', ''))}</div>
          <div class="row"><button class="btn" type="submit" ${raw(canOrder ? '' : 'disabled')}>Mark as ordered</button><button type="button" class="btn-q sm" data-a="modal" data-m="cancelticket" data-id="${t.id}">Cancel ticket</button></div></form>`)}
      ${when(['ordered', 'in_progress'].includes(t.status), () => html`<h3 class="h3">Result</h3><div class="row">
        ${when(t.status === 'ordered', () => html`<button class="btn-o sm" data-a="check-status" data-id="${t.id}" data-s="in_progress">Applicant started</button>`)}
        <button class="btn sm" data-a="check-status" data-id="${t.id}" data-s="clear">Clear</button>
        <button class="btn-o sm" data-a="modal" data-m="needsreview" data-id="${t.id}">Needs review</button>
        <button class="btn-q sm" data-a="check-status" data-id="${t.id}" data-s="cancelled">Order failed · reorder</button></div>`)}
      ${when(t.status === 'needs_review', () => html`<h3 class="h3">Individual review</h3>
        <ol class="steps-l"><li class="${t.adverse_notice_at ? 'done' : ''}">Review the report against the job (Fair Chance: nature of offense, time passed, relevance to home care).</li><li class="${t.adverse_notice_at ? 'done' : ''}">If you may decline, send the pre-adverse action notice with a copy of the report and the summary of rights.</li><li class="${ready ? 'done' : ''}">Wait at least 5 business days for the applicant to respond.</li><li>Make the final decision and record why.</li></ol>
        <div class="row"><button class="btn sm" data-a="modal" data-m="decision" data-id="${t.id}" data-d="clear">Clear after review</button>
        ${when(!t.adverse_notice_at, () => html`<button class="btn-o sm" data-a="modal" data-m="adverse" data-id="${t.id}">Pre-adverse notice sent</button>`)}
        ${when(t.adverse_notice_at, () => html`<button class="btn-q sm" data-a="modal" data-m="decision" data-id="${t.id}" data-d="not_cleared" ${raw(ready ? '' : 'disabled')}>Not cleared</button>`)}</div>`)}
      ${when(t.notes && t.status !== 'ready_review', () => html`<blockquote class="pre">${t.notes}</blockquote>`)}
    </section></div>`;
  }

  function tickets(d) {
    const st = S.f.tst || 'open';
    const rows = d.tickets.filter((t) => st === 'all' || (st === 'open' ? ['ready_review', 'ordered', 'in_progress', 'needs_review'].includes(t.status) : t.status === st));
    return html`<h1 class="h2">Background check tickets</h1>
      <div class="tiles">${tile(d.kpis.to_review, 'Ready to review', d.kpis.to_review)}${tile(d.kpis.in_progress, 'In progress')}${tile(d.kpis.needs_review, 'Need individual review', d.kpis.needs_review)}${tile(d.kpis.overdue, 'Overdue (1 business day)', d.kpis.overdue)}${tile(money(d.kpis.checks_spend_cents), 'Spent on checks')}</div>
      <div class="split"><div><div class="list-h">${select('tst', [['open', 'Open'], ['all', 'All'], ['clear', 'Clear'], ['not_cleared', 'Not cleared'], ['cancelled', 'Cancelled']], st, { 'data-i': 'tst', 'aria-label': 'Status' })}</div>
        <div class="list">${rows.length ? rows.map((t) => html`<button type="button" class="item${S.sel.ticket === t.id ? ' on' : ''}${t.overdue ? ' warn' : ''}" data-a="sel" data-key="ticket" data-id="${t.id}"><span class="row between"><b>${t.applicant.name}</b>${pill(...TK[t.status])}</span><small>${t.placement.territory_code} · ${t.status === 'ready_review' ? dueIn(t.due_at) : ago(t.created_at)}${t.reusable ? ' · reusable check' : ''}</small></button>`) : empty('No tickets here.')}</div></div>
        ${ticketDetail(d.tickets.find((t) => t.id === S.sel.ticket))}</div>`;
  }

  function territories(d) {
    const LS = { pending: ['Pending', 'amber'], active: ['Active', 'green'], expired: ['Expired', 'red'], not_required: ['Not required', ''] };
    return html`<div class="row between"><h1 class="h2">Territories & licences</h1><button class="btn-o sm" data-a="modal" data-m="territory">Add territory</button></div>
      <p class="muted">Families can only pay in sellable territories. A territory needs an active licence (or one marked not required) before it can be sellable.</p>
      ${d.territories.map((t) => html`<section class="panel" data-k="${t.code}-${t.sellable}-${t.licences.length}">
        <div class="row between"><div><h2 class="h3">${t.name} (${t.code})</h2><span class="muted small">ZIPs ${t.zip_ranges || '—'} · minimum wage $${Number(t.min_wage).toFixed(2)}/hr</span></div>
          <div class="row">${pill(t.sellable ? 'Sellable' : 'Not sellable', t.sellable ? 'green' : 'grey')}<button class="btn-q sm" data-a="modal" data-m="territory" data-code="${t.code}">Edit</button></div></div>
        ${when(t.warnings.length, () => html`<ul class="warns">${t.warnings.map((w) => html`<li>${w}</li>`)}</ul>`)}
        ${t.licences.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Licence</th><th>Number</th><th>Issuer</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>${t.licences.map((l) => html`<tr><td>${l.kind}${l.document_url ? html` · <a href="${l.document_url}" target="_blank" rel="noopener">document</a>` : ''}</td><td>${l.number}</td><td>${l.issuer}</td><td>${l.expires_on || ''}</td><td>${pill(...LS[l.status])}</td><td><button class="btn-q sm" data-a="modal" data-m="licence" data-id="${l.id}" data-code="${t.code}">Edit</button></td></tr>`)}</tbody></table></div>` : ''}
        <div><button class="btn-o sm" data-a="modal" data-m="licence" data-code="${t.code}">Add licence</button></div>
      </section>`)}`;
  }

  function checks(d) {
    return html`<h1 class="h2">Background check register</h1><p class="muted">A clear check is reused for 12 months.</p>
      ${d.checks.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Applicant</th><th>Provider</th><th>Reference</th><th>Cost</th><th>Ordered</th><th>Result</th><th>Valid until</th></tr></thead><tbody>${d.checks.map((c) => html`<tr class="${c.expiring ? 'gap' : ''}"><td>${c.applicant}</td><td>${c.provider} ${c.package}</td><td>${c.external_ref}</td><td>${money(c.cost_cents)}</td><td>${fmtDay(c.ordered_at)}</td><td>${pill(...(TK[c.status] || [c.status]))}</td><td>${c.expires_at ? fmtDay(c.expires_at) + (c.expiring ? ' · expiring' : '') : ''}</td></tr>`)}</tbody></table></div>` : empty('No checks ordered yet.')}`;
  }

  function audit(rows) {
    return html`<h1 class="h2">Audit log</h1><p class="muted">Every change made in the app, newest first. Personal free text isn’t stored here.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>${rows.map((a) => html`<tr><td>${fmtET(a.at)}</td><td>${a.actor}</td><td>${a.action.replace(/_/g, ' ')}</td><td>${a.entity} ${String(a.entity_id).slice(0, 8)}</td><td class="small">${Object.entries(a.detail || {}).filter(([k, v]) => v !== '' && k !== 'view').map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join('/') : String(v).slice(0, 12))).join(' · ')}</td></tr>`)}</tbody></table></div>`;
  }

  HM.views.compliance = {
    render(d) {
      return HM.teamShell([
        { id: 'tickets', label: 'Check tickets', badge: d.kpis.to_review + d.kpis.needs_review, alert: d.kpis.overdue },
        { id: 'territories', label: 'Territories', badge: d.kpis.licence_alerts, alert: true },
        { id: 'checks', label: 'Check register' }, { id: 'audit', label: 'Audit log' }, { id: 'account', label: 'My details' }
      ], (cur) => cur === 'territories' ? territories(d) : cur === 'checks' ? checks(d) : cur === 'audit' ? audit(d.audit || []) : cur === 'account' ? HM.account() : tickets(d));
    }
  };
  HM.forms.ticket = (fd) => HM.act('save_ticket', { id: fd.id, notes: fd.notes, checklist: { consent: fd.consent, identity: fd.identity, references: fd.references, interview: fd.interview } }, 'Checklist saved');
  HM.forms['order-check'] = (fd) => HM.act('order_check', fd, 'Check ordered. The family has been told it’s in progress.');
  HM.actions['reuse-check'] = (d) => HM.act('reuse_check', { id: d.id }, 'Cleared with the existing check. The family can hire.');
  HM.actions['check-status'] = (d) => { if (d.s !== 'clear' || HM.confirm('Mark this check clear? The family will be told they can hire.')) HM.act('update_check', { id: d.id, status: d.s }, d.s === 'clear' ? 'Clear. The family can hire.' : 'Updated'); };
  HM.modals.needsreview = (c) => ({ title: 'Needs individual review', body: html`<form class="stack" data-f="needsreview"><input type="hidden" name="id" value="${c.id}"><p class="muted">Don’t decline yet. Fair Chance laws require an individual review and a pre-adverse notice first. The family only sees “in progress”.</p>${field('What came back? (private)', textarea('note', '', { rows: 3, 'data-autofocus': true }))}<div class="row end"><button class="btn" type="submit">Save</button></div></form>` });
  HM.forms.needsreview = (fd) => HM.act('update_check', Object.assign(fd, { status: 'needs_review' }), 'Moved to individual review');
  HM.modals.adverse = (c) => ({ title: 'Pre-adverse notice sent', body: html`<form class="stack" data-f="adverse"><input type="hidden" name="id" value="${c.id}"><p>Confirm you sent the applicant the pre-adverse action notice, a copy of the report, the FCRA summary of rights and (in NYC) the Fair Chance notice. The 5-business-day wait starts now.</p>${field('Notes (how and when it was sent)', input('note', '', { 'data-autofocus': true }))}<div class="row end"><button class="btn" type="submit">Confirm sent</button></div></form>` });
  HM.forms.adverse = (fd) => HM.act('adverse_notice', fd, 'Recorded. Final decision allowed after 5 business days.');
  HM.modals.decision = (c) => ({ title: c.d === 'clear' ? 'Clear after review' : 'Not cleared', body: html`<form class="stack" data-f="decision"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="decision" value="${c.d}">${c.d === 'clear' ? html`<p>The applicant will be cleared and the family can hire.</p>` : html`<p>The applicant is removed from this placement and their profile is paused. Send the final adverse action notice. The family is only told they can’t continue.</p>`}${field('Reason (private, required for not cleared)', textarea('note', '', { rows: 3, 'data-autofocus': true }))}<div class="row end"><button class="btn" type="submit">Confirm</button></div></form>` });
  HM.forms.decision = (fd) => HM.act('final_decision', fd, 'Decision recorded');
  HM.modals.cancelticket = (c) => ({ title: 'Cancel ticket', body: html`<form class="stack" data-f="cancelticket"><input type="hidden" name="id" value="${c.id}">${field('Why?', input('note', '', { 'data-autofocus': true }))}<div class="row end"><button class="btn" type="submit">Cancel ticket</button></div></form>` });
  HM.forms.cancelticket = (fd) => HM.act('cancel_ticket', fd, 'Ticket cancelled');
  HM.modals.territory = (c) => {
    const t = (S.data.territories || []).find((x) => x.code === c.code) || {};
    return { title: t.code ? 'Edit ' + t.name : 'Add territory', body: html`<form class="stack" data-f="territory">
      <div class="grid2">${field('State code', input('code', t.code || '', { maxlength: 2, required: true, readonly: !!t.code }))}${field('Name', input('name', t.name || ''))}${field('ZIP ranges (first 3 digits)', input('zip_ranges', t.zip_ranges || '', { placeholder: '100-149' }))}${field('Minimum wage ($/hr)', input('min_wage', t.min_wage || '', { type: 'number', step: '0.01' }))}</div>
      ${field('Notes', textarea('notes', t.notes || '', { rows: 2 }))}${check('sellable', !!t.sellable, 'Sellable: families here can pay')}
      <div class="row end"><button class="btn" type="submit">Save territory</button></div></form>` };
  };
  HM.forms.territory = (fd) => HM.act('save_territory', fd, 'Territory saved');
  HM.modals.licence = (c) => {
    const t = (S.data.territories || []).find((x) => x.code === c.code) || { licences: [] };
    const l = t.licences.find((x) => x.id === c.id) || {};
    return { title: (l.id ? 'Edit licence' : 'Add licence') + ' · ' + c.code, body: html`<form class="stack" data-f="licence"><input type="hidden" name="id" value="${l.id || ''}"><input type="hidden" name="territory_code" value="${c.code}">
      <div class="grid2">${field('Licence or registration', input('kind', l.kind || '', { required: true, placeholder: 'e.g. NYC DCWP Employment Agency' }))}${field('Number', input('number', l.number || ''))}${field('Issuer', input('issuer', l.issuer || ''))}${field('Status', select('status', [['pending', 'Pending'], ['active', 'Active'], ['expired', 'Expired'], ['not_required', 'Not required']], l.status || 'pending'))}${field('Issued', input('issued_on', l.issued_on || '', { type: 'date' }))}${field('Expires', input('expires_on', l.expires_on || '', { type: 'date' }), 'You’ll see a warning 60 days before.')}</div>
      ${field('Document link', input('document_url', l.document_url || '', { placeholder: 'https://drive.google.com/…' }))}${field('Notes', textarea('notes', l.notes || '', { rows: 2 }))}
      <div class="row end"><button class="btn" type="submit">Save licence</button></div></form>` };
  };
  HM.forms.licence = (fd) => { if (!fd.id) delete fd.id; return HM.act('save_license', fd, 'Licence saved'); };

  // ================================================================== Admin
  const STAFF = [['admin', 'Admin'], ['concierge', 'Concierge'], ['recruiter', 'Recruiter'], ['finance', 'Finance'], ['compliance', 'Compliance']];
  function team(d) {
    return html`<h1 class="h2">Team</h1>
      <div class="table-wrap"><table class="tbl team-tbl"><thead><tr><th>Person</th>${STAFF.map(([, l]) => html`<th>${l}</th>`)}<th>Last sign-in</th><th></th></tr></thead><tbody>
      ${d.team.map((u) => html`<tr data-k="${u.id}-${u.roles.join('')}-${u.disabled}"><td><b>${u.full_name || '—'}</b><br><span class="muted small">${u.email}</span>${u.disabled ? html` ${pill('Blocked', 'grey')}` : ''}</td>
        ${STAFF.map(([r]) => html`<td><input type="checkbox" aria-label="${r}" data-c="team-role" data-id="${u.id}" data-r="${r}" ${raw(u.roles.includes(r) ? 'checked' : '')}></td>`)}
        <td>${u.last_login_at ? ago(u.last_login_at) : 'Never'}</td><td class="row end"><button class="btn-q sm" data-a="team-link" data-id="${u.id}">Send link</button>${u.id !== S.me.id ? html`<button class="btn-q sm" data-a="team-block" data-id="${u.id}" data-v="${u.disabled ? '' : '1'}">${u.disabled ? 'Unblock' : 'Block'}</button>` : ''}</td></tr>`)}
      </tbody></table></div>
      <form class="panel stack" data-f="invite-team" data-k="it-${d.team.length}"><h2 class="h3">Add a team member</h2>
        <div class="grid2">${field('Email', input('email', '', { type: 'email', required: true }))}${field('Full name', input('full_name', ''))}</div>
        <fieldset class="toggles"><legend class="lbl">Roles</legend>${STAFF.map(([r, l]) => html`<label class="tg"><input type="checkbox" name="roles" value="${r}" data-multi="1" ${raw(r === 'concierge' ? 'checked' : '')}><span>${l}</span></label>`)}</fieldset>
        <p class="muted small">Concierge: families and placements. Recruiter: applicants and supply. Finance: orders and refunds. Compliance: licences and background checks. Admin: everything, plus the team.</p>
        <div><button class="btn" type="submit">Add and email a sign-in link</button></div></form>`;
  }
  function setup(d) {
    return html`<h1 class="h2">Setup</h1><p class="muted">Environment: <b>${d.environment}</b></p>
      <section class="panel"><h2 class="h3">Connections</h2><ul class="ticks">${d.settings.map((s) => tick(s.ok, s.label))}</ul><p class="muted small">These are set in Vercel → Settings → Environment Variables. Keys are never shown here.</p></section>
      <section class="panel"><h2 class="h3">Accounts</h2><div class="tiles">${Object.entries(d.counts).map(([r, n]) => tile(n, HM.VIEW_NAME[r] === 'My home' ? 'Families' : HM.VIEW_NAME[r] === 'My work' ? 'Applicants' : HM.VIEW_NAME[r]))}</div></section>`;
  }
  HM.views.admin = {
    render(d) {
      return HM.teamShell([{ id: 'team', label: 'Team', badge: d.team.length }, { id: 'setup', label: 'Setup', badge: d.settings.filter((s) => !s.ok).length, alert: true }, { id: 'audit', label: 'Audit log' }, { id: 'account', label: 'My details' }],
        (cur) => cur === 'setup' ? setup(d) : cur === 'audit' ? audit(d.audit) : cur === 'account' ? HM.account() : team(d));
    }
  };
  HM.actions['team-role'] = (d, el) => {
    const u = S.data.team.find((x) => x.id === d.id);
    const roles = new Set(u.roles.filter((r) => STAFF.some((s) => s[0] === r)));
    if (el.checked) roles.add(d.r); else roles.delete(d.r);
    HM.act('update_team', { user_id: d.id, roles: [...roles] }, 'Roles updated').then((r) => { if (!r) el.checked = !el.checked; });
  };
  HM.actions['team-link'] = (d) => HM.act('send_login_link', { user_id: d.id }, 'Sign-in link sent');
  HM.actions['team-block'] = (d) => { if (HM.confirm(d.v ? 'Block this person from signing in?' : 'Allow this person to sign in again?')) HM.act('update_team', { user_id: d.id, disabled: !!d.v }, 'Updated'); };
  HM.forms['invite-team'] = (fd) => HM.act('invite_team', fd, 'Added. They’ve been emailed a sign-in link.');
})();
