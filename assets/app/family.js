/* handmatch web app: families */
(function () {
  'use strict';
  const { S, html, when, fmtET, fmtDay, ago, money, list, ROLE_TYPE, KIND, avatar, pill, empty, field, input, textarea, select, check, tick } = HM;

  const STATUS = {
    waiting: ['Confirming availability', ''], accepted: ['Available to meet', 'green'], meeting: ['Meeting booked', 'dark'],
    passed: ['You passed · check next', 'green'], check: ['Background check in progress', 'amber'], cleared: ['Cleared to hire', 'green'],
    hired: ['Hired', 'green'], ended: ['Replaced', 'grey'], not_fit: ['Not the right fit', 'grey']
  };
  const BG = { not_started: 'Background check before you hire', pending: 'Background check in progress', review: 'Background check in progress', clear: 'Background check clear', not_cleared: 'Background check' };
  const CASE_TYPES = [['quality', 'Quality of work'], ['no_show', 'No-show or lateness'], ['schedule', 'Schedule change'], ['safety', 'Safety concern'], ['payment', 'Payment question'], ['other', 'Something else']];
  const CASE_STATUS = { open: ['Open', 'amber'], in_progress: ['In progress', ''], waiting: ['Waiting on you', 'amber'], resolved: ['Resolved', 'green'], closed: ['Closed', 'grey'] };
  const REFUND_STATUS = { requested: ['In review', 'amber'], approved: ['Approved', 'green'], denied: ['Not approved', 'grey'], refunded: ['Refunded', 'green'] };
  const rank = { hired: 0, cleared: 1, check: 2, passed: 3, meeting: 4, accepted: 5, waiting: 6, ended: 7, not_fit: 8 };

  function current(d) {
    const ps = d.placements || [];
    return ps.find((p) => p.id === S.sel.placement) || ps.find((p) => p.status !== 'closed') || ps[0] || null;
  }

  function journey(p) {
    const st = new Set(p.applicants.map((a) => a.status));
    const any = (...xs) => xs.some((x) => st.has(x));
    const done = [true, p.status !== 'new', any('passed', 'check', 'cleared', 'hired', 'ended'), any('passed', 'check', 'cleared', 'hired', 'ended'), any('cleared', 'hired', 'ended'), any('hired', 'ended')];
    const steps = [
      ['Payment confirmed', fmtDay(p.created_at)],
      ['Concierge call', 'We get to know your home'],
      ['Meet applicants', 'Phone, video or paid trial'],
      ['You pass someone', 'Tell us who you liked'],
      ['Background check', 'Only for the person you pass'],
      ['Hire directly', 'Agree pay and schedule together']
    ];
    const at = done.indexOf(false);
    return html`<ol class="journey" aria-label="Your progress">${steps.map((s, i) => html`<li class="${done[i] ? 'done' : i === at ? 'now' : ''}"><span class="j-dot" aria-hidden="true"></span><b>${s[0]}</b><span>${s[1]}</span></li>`)}</ol>`;
  }

  function nextStep(p) {
    const by = (s) => p.applicants.find((a) => a.status === s);
    const name = (a) => a.name;
    let a;
    if ((a = by('cleared'))) return [`${name(a)} is cleared to hire.`, 'Their background check came back clear. Confirm the hire to see their contact details.', html`<button class="btn" data-a="modal" data-m="hire" data-id="${a.link_id}" data-name="${a.name}">Hire ${HM.firstName(a.name)}</button>`];
    const due = p.applicants.flatMap((x) => x.meetings.filter((m) => m.can_outcome).map((m) => [x, m]))[0];
    if (due) return [`How did your ${KIND[due[1].kind].toLowerCase()} with ${name(due[0])} go?`, 'Tell us if you’d like to move forward. We only run a background check for people you pass.', html`<button class="btn" data-a="modal" data-m="outcome" data-id="${due[1].id}" data-name="${due[0].name}">Share how it went</button>`];
    if ((a = by('accepted'))) return [`${name(a)} is available to meet you.`, 'Book a phone call, a video interview or a paid trial in your home.', html`<button class="btn" data-a="modal" data-m="book" data-id="${a.link_id}" data-name="${a.name}">Book a meeting</button>`];
    if ((a = by('check') || by('passed'))) return [`${name(a)}’s background check is in progress.`, 'It usually takes 2 to 5 business days. We’ll email you as soon as it’s clear.', ''];
    if ((a = by('meeting'))) { const m = a.meetings.find((x) => ['requested', 'confirmed'].includes(x.status)); return [m && m.status === 'confirmed' ? `${KIND[m.kind]} with ${name(a)}: ${fmtET(m.start_at)}.` : `Your Concierge is confirming a time with ${name(a)}.`, m && m.join_info ? 'How to join: ' + m.join_info : 'You’ll get an email when it’s set.', '']; }
    if (by('hired')) return ['You’re all set.', 'Your Concierge will check in during the first week. Need anything? Message us or open a support request.', html`<button class="btn-o" data-a="tab" data-key="family" data-v="help">Get help</button>`];
    if (by('waiting')) return ['We’re confirming your applicants’ availability.', 'You’ll get an email as soon as someone confirms.', ''];
    if (p.status === 'new') return ['Your Concierge will call you soon.', 'We’ll get to know your home, then share applicants who can start in as little as 3 days.', p.concierge_thread_id ? html`<button class="btn-o" data-a="go-thread" data-key="family" data-id="${p.concierge_thread_id}">Message your Concierge</button>` : ''];
    return ['Your Concierge is finding your applicants.', 'You’ll see them here as soon as they confirm they’re available.', ''];
  }

  function conciergeCard(p) {
    const c = p.concierge;
    if (!c) return html`<aside class="concierge"><span class="av av-lg" aria-hidden="true">h</span><div class="stack-s"><span class="muted small">Your handmatch Concierge</span><b class="h3">Being assigned now</b><span class="small">A real person will call you within 1 business day. You can message the team any time.</span></div>${when(p.concierge_thread_id, () => html`<button class="btn-o sm" data-a="go-thread" data-key="family" data-id="${p.concierge_thread_id}">Message</button>`)}</aside>`;
    return html`<aside class="concierge">
      ${avatar(c.name, c.photo_url, 'lg')}
      <div class="stack-s"><span class="muted small">Your handmatch Concierge</span><b class="h3">${c.name}</b>
      <span class="small">A real person, every step. Message any time${c.phone ? html`, or call <a href="tel:${c.phone}">${c.phone}</a>` : ''}.</span></div>
      ${when(p.concierge_thread_id, () => html`<button class="btn-o sm" data-a="go-thread" data-key="family" data-id="${p.concierge_thread_id}">Message</button>`)}
    </aside>`;
  }

  function meetingLine(a, m) {
    const label = KIND[m.kind];
    if (m.status === 'cancelled') return '';
    let line;
    if (m.status === 'requested') line = html`<b>${label} requested.</b> Your Concierge is confirming a time. You suggested: ${m.preferred_times}.`;
    else if (m.status === 'confirmed') line = html`<b>${label}: ${fmtET(m.start_at)}.</b> ${m.join_info ? 'How to join: ' + m.join_info + '.' : ''} ${m.applicant_confirmed ? HM.firstName(a.name) + ' confirmed.' : ''}`;
    else line = html`<b>${label} on ${fmtDay(m.start_at)}.</b> ${m.outcome === 'pass' ? 'You passed.' : m.outcome === 'not_fit' ? 'Not the right fit.' : ''}`;
    return html`<li class="mtg"><span>${line}${m.kind === 'trial' ? html` <span class="muted">${m.trial_hours} h at $${m.trial_rate}/hr, paid by you directly.</span>` : ''}</span>
      <span class="row">${when(m.can_outcome, () => html`<button class="btn sm" data-a="modal" data-m="outcome" data-id="${m.id}" data-name="${a.name}">How did it go?</button>`)}
      ${when(['requested', 'confirmed'].includes(m.status), () => html`<button class="btn-q sm" data-a="cancel-meeting" data-id="${m.id}">Cancel</button>`)}</span></li>`;
  }

  function applicantCard(a) {
    const [label, tone] = STATUS[a.status] || [a.status, ''];
    const c = a.checks;
    const out = a.status === 'not_fit' || a.status === 'ended';
    return html`<article class="app-card${out ? ' faded' : ''}" data-k="${a.link_id}">
      <div class="app-top">${avatar(a.name, a.photo_url, 'lg')}
        <div class="stack-s"><div class="row"><h3 class="h3">${a.contact ? a.contact.name : a.name}</h3>${pill(label, tone)}</div>
        <span class="muted">${ROLE_TYPE[a.role_type] || 'Helper'}${a.city ? ', ' + a.city : ''}${a.rate ? ' · $' + a.rate + '/hr' : ''}${a.years != null ? ' · ' + a.years + ' yrs experience' : ''}</span>
        ${when(a.start_in_days != null && a.start_in_days <= 3 && !out, () => html`<span class="ready">Can start in ${a.start_in_days <= 0 ? 'days' : a.start_in_days + ' days'}</span>`)}</div></div>
      ${when(a.bio, () => html`<p class="bio">${a.bio}</p>`)}
      <div class="app-meta">
        <ul class="ticks">${tick(c.interview, 'Interviewed by our team')}${tick(c.id, 'Identity confirmed')}${tick(c.references, 'References checked')}${tick(c.background === 'clear', BG[c.background] || BG.not_started)}</ul>
        <div class="chips">${(a.skills || []).slice(0, 6).map((s) => html`<span class="chip">${s}</span>`)}${(a.languages || []).length ? html`<span class="chip">${list(a.languages)}</span>` : ''}${(a.days || []).length ? html`<span class="chip">${list(a.days)}${a.hours ? ', ' + a.hours : ''}</span>` : ''}</div>
      </div>
      ${when(a.contact, () => html`<div class="contact"><b>Contact ${HM.firstName(a.contact.name)} directly</b><span>${a.contact.phone ? html`<a href="tel:${a.contact.phone}">${a.contact.phone}</a>` : ''}${a.contact.email ? html` · <a href="mailto:${a.contact.email}">${a.contact.email}</a>` : ''}</span></div>`)}
      ${when(a.meetings.filter((m) => m.status !== 'cancelled').length, () => html`<ul class="mtgs">${a.meetings.map((m) => meetingLine(a, m))}</ul>`)}
      ${when(a.status === 'check' || a.status === 'passed', () => html`<p class="note">We’re running ${HM.firstName(a.name)}’s background check now. It usually takes 2 to 5 business days, and costs you nothing extra.</p>`)}
      <div class="row">
        ${when(a.status === 'accepted', () => html`<button class="btn sm" data-a="modal" data-m="book" data-id="${a.link_id}" data-name="${a.name}">Book a meeting</button>`)}
        ${when(a.status === 'cleared', () => html`<button class="btn sm" data-a="modal" data-m="hire" data-id="${a.link_id}" data-name="${a.name}">Hire ${HM.firstName(a.name)}</button>`)}
        ${when(a.thread_id, () => html`<button class="btn-o sm" data-a="go-thread" data-key="family" data-id="${a.thread_id}">Message</button>`)}
        ${when(['waiting', 'accepted', 'meeting'].includes(a.status) && !a.meetings.some((m) => m.status === 'confirmed'), () => html`<button class="btn-q sm" data-a="modal" data-m="notfit" data-id="${a.link_id}" data-name="${a.name}">Not the right fit</button>`)}
        ${when(a.status === 'hired', () => html`<button class="btn-o sm" data-a="modal" data-m="case" data-link="${a.link_id}">Report an issue</button><button class="btn-q sm" data-a="modal" data-m="replace" data-id="${a.link_id}" data-name="${a.name}">Request a replacement</button>`)}
      </div>
    </article>`;
  }

  function overview(p) {
    const [title, sub, cta] = nextStep(p);
    return html`<div class="ov">
      <section class="next"><span class="muted small">Next step</span><h2 class="h2">${title}</h2><p>${sub}</p>${cta ? html`<div class="row">${cta}</div>` : ''}</section>
      ${conciergeCard(p)}
    </div>
    ${journey(p)}
    <section class="panel"><div class="row between"><h2 class="h3">Updates</h2><span class="muted small">${p.order_ref ? 'Order ' + p.order_ref : ''}</span></div>
      ${p.events.length ? html`<ol class="timeline">${p.events.map((e) => html`<li><span class="t-dot" aria-hidden="true"></span><div><p>${e.body}</p><time>${ago(e.created_at)}</time></div></li>`)}</ol>` : empty('Updates from your Concierge will appear here.')}
    </section>`;
  }

  function applicants(p) {
    const list = p.applicants.slice().sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
    return html`<div class="row between wrap-gap"><div><h2 class="h2">Your applicants</h2><p class="muted">${p.hired}/${p.hires_allowed} hire${p.hires_allowed > 1 ? 's' : ''} made. Meet as many as you like.</p></div>
      ${when(p.status !== 'closed', () => html`<button class="btn-o" data-a="modal" data-m="more" data-id="${p.id}">Meet more applicants</button>`)}</div>
      ${list.length ? html`<div class="app-list">${list.map(applicantCard)}</div>` : empty('Your Concierge will share your first applicants here, usually within a few days of your call.')}`;
  }

  function help(p) {
    const rp = p.refund_preview || {}; const rs = p.replacement || {};
    return html`<div class="grid2">
      <section class="panel"><h2 class="h3">Get help</h2><p class="muted">Something not right after your hire? Open a request and your Concierge will handle it. For a safety concern we respond within 1 hour.</p>
        <div><button class="btn" data-a="modal" data-m="case">Open a support request</button></div>
        ${p.cases.length ? html`<ul class="rows">${p.cases.map((c) => html`<li><div><b>${c.subject}</b><span class="muted small">${fmtDay(c.created_at)}${c.resolution ? ' · ' + c.resolution : ''}</span></div><span class="row">${pill(...(CASE_STATUS[c.status] || [c.status]))}${when(c.thread_id, () => html`<button class="btn-q sm" data-a="go-thread" data-key="family" data-id="${c.thread_id}">Open</button>`)}</span></li>`)}</ul>` : ''}
      </section>
      <section class="panel"><h2 class="h3">Replacements</h2>
        <p>${rs.reason}</p>
        <p class="muted small">Up to 3 free replacements within 90 days of your first hire. Start one from the person’s card under Applicants.</p>
      </section>
      <section class="panel"><h2 class="h3">Refunds</h2>
        <ul class="policy"><li><b>Full refund</b> if you cancel before we share applicants, or if we can’t find a suitable match within 14 days.</li><li><b>50% refund</b> if we’ve shared applicants but you haven’t hired within 30 days.</li><li><b>After you hire</b>, the fee isn’t refundable, but you get up to 3 free replacements within 90 days.</li></ul>
        <p class="eligible ${rp.percent ? 'yes' : ''}"><b>${rp.percent ? `You’re eligible for a ${rp.percent}% refund (${money(rp.amount_cents)}).` : 'No refund is due right now.'}</b> ${rp.reason}</p>
        ${p.refunds.length ? html`<ul class="rows">${p.refunds.map((r) => html`<li><div><b>${money(r.amount_cents)} refund</b><span class="muted small">Requested ${fmtDay(r.created_at)}${r.decision_note ? ' · ' + r.decision_note : ''}</span></div>${pill(...(REFUND_STATUS[r.status] || [r.status]))}</li>`)}</ul>` : ''}
        ${when(!p.refunds.some((r) => ['requested', 'approved'].includes(r.status)) && p.paid_cents, () => html`<div><button class="btn-o" data-a="modal" data-m="refund" data-id="${p.id}">Request a refund</button></div>`)}
      </section>
    </div>`;
  }

  HM.views.family = {
    render(d) {
      const p = current(d);
      const tab = HM.curTab('family', 'overview');
      const name = HM.firstName(S.me.full_name);
      const unread = HM.unread();
      return html`<main class="home-main">
        <div class="hello"><h1 class="h1">${name ? html`Hi ${name}.` : 'Welcome to handmatch.'}</h1>
          ${when((d.placements || []).length > 1, () => html`<label class="field inline"><span class="lbl">Placement</span>${select('placement', d.placements.map((x) => [x.id, (x.help_type || 'Help') + (x.zip ? ' near ' + x.zip : '') + ' · ' + fmtDay(x.created_at)]), p && p.id, { 'data-c': 'pick-placement' })}</label>`)}</div>
        ${HM.tabs('family', [{ id: 'overview', label: 'Overview' }, { id: 'applicants', label: 'Applicants', badge: p ? p.applicants.filter((a) => ['accepted', 'cleared'].includes(a.status) || a.meetings.some((m) => m.can_outcome)).length : 0 }, { id: 'messages', label: 'Messages', badge: unread }, { id: 'help', label: 'Help & refunds' }, { id: 'account', label: 'Account' }])}
        ${tab === 'account' ? HM.account()
          : tab === 'messages' ? HM.chat(d.threads || [], { empty: 'Your conversations with your Concierge and applicants will appear here.', pick: 'Choose a conversation.' })
            : !p ? HM.empty('Your placement will appear here as soon as your payment is confirmed. Questions? Email hello.handmatch@gmail.com.')
              : tab === 'applicants' ? applicants(p) : tab === 'help' ? help(p) : overview(p)}
      </main>`;
    }
  };

  // ------------------------------------------------------------- modals
  HM.modals.book = (c) => {
    const p = current(S.data); const kind = S.f.bookKind || 'video';
    const min = p ? Number(p.min_wage) || 0 : 0;
    return {
      title: `Meet ${c.name}`,
      body: html`<form class="stack" data-f="book" data-k="book-${c.id}">
        <input type="hidden" name="link_id" value="${c.id}">
        <fieldset class="choice"><legend class="lbl">How would you like to meet?</legend>
          ${[['phone', 'Phone call', 'About 20 minutes'], ['video', 'Video interview', 'About 30 minutes, face to face on screen'], ['trial', 'Paid trial', 'They work in your home for 2+ hours, paid by you']].map(([v, l, s]) => html`<label class="opt${kind === v ? ' on' : ''}"><input type="radio" name="kind" value="${v}" ${HM.raw(kind === v ? 'checked' : '')} data-c="book-kind"><b>${l}</b><span>${s}</span></label>`)}
        </fieldset>
        ${field('Times that work for you', input('preferred_times', '', { placeholder: 'e.g. Weekday evenings after 6, or Saturday morning', required: true, 'data-autofocus': true }), 'Your Concierge confirms the exact time with both of you. Times are New York time.')}
        ${when(kind === 'trial', () => html`<div class="grid2">${field('Hours', input('trial_hours', '3', { type: 'number', min: 2, max: 8, step: 0.5 }), 'At least 2 hours.')}${field('Hourly rate ($)', input('trial_rate', String(Math.max(min, 20)), { type: 'number', min: min || 0, step: 0.5 }), min ? `At least the minimum wage: $${min.toFixed(2)}/hr.` : '')}</div>
          ${check('supervised', false, 'An adult in my home will be there for the whole trial.')}
          <p class="muted small">You pay the trial directly to the applicant at the end. They check in and out in the app.</p>`)}
        ${field('Anything they should know? (optional)', textarea('note', '', { rows: 2, placeholder: 'Kids, pets, parking, what you’d like to see' }))}
        <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Request ${kind === 'trial' ? 'paid trial' : kind === 'phone' ? 'call' : 'video interview'}</button></div>
      </form>`
    };
  };
  HM.actions['book-kind'] = (d, el) => { S.f.bookKind = el.value; HM.render(); };
  HM.forms.book = (fd) => HM.act('request_meeting', fd, 'Request sent. Your Concierge will confirm the time.');

  HM.modals.outcome = (c) => ({
    title: `How did it go with ${c.name}?`,
    body: html`<form class="stack" data-f="outcome" data-k="outcome-${c.id}">
      <input type="hidden" name="meeting_id" value="${c.id}">
      <fieldset class="choice two"><legend class="sr">Your decision</legend>
        <label class="opt"><input type="radio" name="outcome" value="pass" required><b>Pass</b><span>I’d like to move forward. Run the background check.</span></label>
        <label class="opt"><input type="radio" name="outcome" value="not_fit"><b>Not the right fit</b><span>Show me someone else.</span></label>
      </fieldset>
      ${field('Notes for your Concierge (optional)', textarea('note', '', { rows: 2 }))}
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Save</button></div></form>`
  });
  HM.forms.outcome = (fd) => (fd.outcome ? HM.act('record_outcome', fd, fd.outcome === 'pass' ? 'Thanks! We’re starting the background check.' : 'Thanks for letting us know.') : HM.toast('Choose Pass or Not the right fit.', true));

  HM.modals.hire = (c) => ({
    title: `Hire ${c.name}`,
    body: html`<form class="stack" data-f="hire"><input type="hidden" name="link_id" value="${c.id}">
      <p>You’ll hire ${HM.firstName(c.name)} directly and agree on pay and schedule together. We’ll share their contact details and your Concierge will check in during the first week.</p>
      <p class="muted small">Rates must be at least your state’s minimum wage. Up to 3 free replacements within 90 days.</p>
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Not yet</button><button class="btn" type="submit">Confirm hire</button></div></form>`
  });
  HM.forms.hire = (fd) => HM.act('hire', fd, 'Congratulations on your hire!');

  HM.modals.notfit = (c) => ({
    title: `Pass on ${c.name}?`,
    body: html`<form class="stack" data-f="notfit"><input type="hidden" name="link_id" value="${c.id}">
      ${field('What would make a better match? (optional)', textarea('note', '', { rows: 2, 'data-autofocus': true }))}
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Not the right fit</button></div></form>`
  });
  HM.forms.notfit = (fd) => HM.act('not_fit', fd, 'Thanks. Your Concierge will follow up.');

  HM.modals.more = (c) => ({
    title: 'Meet more applicants',
    body: html`<form class="stack" data-f="more"><input type="hidden" name="placement_id" value="${c.id}">
      ${field('Anything we should look for?', textarea('note', '', { rows: 3, placeholder: 'e.g. Spanish speaking, available Mondays, more cooking experience', 'data-autofocus': true }))}
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Ask my Concierge</button></div></form>`
  });
  HM.forms.more = (fd) => HM.act('request_change', fd, 'Sent to your Concierge.');

  HM.modals.case = (c) => {
    const p = current(S.data);
    const hired = p ? p.applicants.filter((a) => ['hired', 'ended'].includes(a.status)) : [];
    return {
      title: 'Open a support request',
      body: html`<form class="stack" data-f="case"><input type="hidden" name="placement_id" value="${p && p.id}">
        ${field('What’s it about?', select('type', CASE_TYPES, 'quality'))}
        ${when(hired.length, field('Who is it about?', select('link_id', [['', 'Not about a specific person']].concat(hired.map((a) => [a.link_id, a.contact ? a.contact.name : a.name])), c.link || '')))}
        ${field('Short summary', input('subject', '', { required: true, maxlength: 140, 'data-autofocus': true }))}
        ${field('Tell us what happened', textarea('description', '', { rows: 4 }))}
        <p class="muted small">If anyone is in immediate danger, call 911 first.</p>
        <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Open request</button></div></form>`
    };
  };
  HM.forms.case = (fd) => HM.act('open_case', fd, 'Request opened. We’ll be in touch shortly.');

  HM.modals.replace = (c) => ({
    title: `Replace ${c.name}`,
    body: html`<form class="stack" data-f="replace"><input type="hidden" name="link_id" value="${c.id}">
      <p>We’ll find you someone new at no extra charge. ${current(S.data) ? current(S.data).replacement.reason : ''}</p>
      ${field('What’s not working?', textarea('reason', '', { rows: 3, required: true, 'data-autofocus': true }))}
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Request replacement</button></div></form>`
  });
  HM.forms.replace = (fd) => HM.act('request_replacement', fd, 'Replacement requested. Your Concierge will be in touch.');

  HM.modals.refund = (c) => {
    const p = current(S.data); const rp = p.refund_preview;
    return {
      title: 'Request a refund',
      body: html`<form class="stack" data-f="refund"><input type="hidden" name="placement_id" value="${c.id}">
        <p class="eligible ${rp.percent ? 'yes' : ''}"><b>${rp.percent ? `Based on our policy: ${rp.percent}% (${money(rp.amount_cents)}).` : 'Based on our policy, no refund is due right now.'}</b> ${rp.reason}</p>
        ${field('Why would you like a refund?', textarea('reason', '', { rows: 3, required: true, 'data-autofocus': true }))}
        <p class="muted small">Our finance team reviews every request within 2 business days.</p>
        <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Send request</button></div></form>`
    };
  };
  HM.forms.refund = (fd) => HM.act('request_refund', fd, 'Refund request sent.');

  HM.actions['cancel-meeting'] = (d) => { if (confirmLite('Cancel this meeting?')) HM.act('cancel_meeting', { meeting_id: d.id }, 'Meeting cancelled'); };
  HM.actions['pick-placement'] = (d, el) => { S.sel.placement = el.value; HM.render(); };
  function confirmLite(q) { return window.confirm(q); }
  HM.confirm = confirmLite;
})();
