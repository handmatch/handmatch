/* handmatch web app: handmatch Recruiter (supply side) */
(function () {
  'use strict';
  const { S, html, raw, when, fmtET, fmtDay, ago, dueIn, money, list, isoToEt, etToIso, ROLE_TYPE, avatar, pill, empty, field, input, textarea, select, check, kv } = HM;
  const STAGES = [['lead', 'Lead'], ['contacted', 'Contacted'], ['screening', 'Screening booked'], ['interviewed', 'Interviewed'], ['checks', 'ID & references'], ['active', 'Active'], ['paused', 'Paused'], ['rejected', 'Not a fit']];
  const STAGE_TONE = { lead: 'amber', contacted: '', screening: 'dark', interviewed: '', checks: 'amber', active: 'green', paused: 'grey', rejected: 'grey' };
  const SOURCES = [['', '—'], ['website', 'Website'], ['referral', 'Referral'], ['facebook', 'Facebook'], ['indeed', 'Indeed'], ['craigslist', 'Craigslist'], ['walk_in', 'Walk-in'], ['agency', 'Agency'], ['invite', 'Invite'], ['other', 'Other']];
  const REF = [['new', 'New'], ['contacted', 'Contacted'], ['joined', 'Joined'], ['hired', 'Hired (bonus due)'], ['not_eligible', 'Not eligible']];
  const stageLabel = (s) => (STAGES.find((x) => x[0] === s) || [s, s])[1];
  const TEMPLATES = [
    ['First message', 'Hi {name}, this is {me} from handmatch. We connect great cleaners, housekeepers and nannies with families near you, and you’re hired directly at your own rate. Families pay us, never you. Do you have 10 minutes this week for a quick call?'],
    ['Screening reminder', 'Hi {name}, a reminder about your handmatch screening call on {when}. It takes about 15 minutes. Reply here if you need a new time.'],
    ['Finish your profile', 'Hi {name}, you’re almost there! Sign in at handmatch.us/login with this email to add your days, hours and a short bio. Families near you are looking now.'],
    ['References request', 'Hi {name}, thanks for a great call! Please send 2 references (name and phone) from families or employers you’ve worked for. We only use them to confirm your experience.']
  ];

  function missing(a) {
    const m = [];
    if (!a.full_name) m.push('name'); if (!a.zip) m.push('ZIP'); if (!a.check_interview) m.push('screening'); if (!a.check_id) m.push('ID'); if (!a.check_references) m.push('references'); if (!a.background_consent) m.push('consent');
    return m;
  }

  function pipeline(d) {
    const st = S.f.rst || 'open'; const q = (S.f.rq || '').toLowerCase(); const terr = S.f.rterr || '';
    const rows = d.applicants.filter((a) => (st === 'all' || (st === 'open' ? !['active', 'paused', 'rejected'].includes(a.pipeline_stage) : st === 'stale' ? a.stale : a.pipeline_stage === st))
      && (!terr || a.territory_code === terr) && (!q || [a.full_name, a.email, a.phone, a.zip, a.city].join(' ').toLowerCase().includes(q)));
    const a = d.applicants.find((x) => x.user_id === S.sel.app);
    const chips = [['open', 'In progress', d.applicants.filter((x) => !['active', 'paused', 'rejected'].includes(x.pipeline_stage)).length]].concat(STAGES.map(([k, l]) => [k, l, d.stage_counts[k] || 0]), [['stale', 'Stale', d.kpis.stale], ['all', 'All', d.applicants.length]]);
    return html`<div class="row between"><h1 class="h2">Pipeline</h1><button class="btn sm" data-a="tab" data-key="recruiter" data-v="add">Add applicants</button></div>
      <div class="chipbar">${chips.map(([k, l, n]) => html`<button type="button" class="fchip${st === k ? ' on' : ''}" data-a="rfilter" data-v="${k}">${l} <b>${n}</b></button>`)}</div>
      <div class="split"><div><div class="list-h"><input class="inp" placeholder="Search name, phone, ZIP" value="${S.f.rq || ''}" data-i="rq" aria-label="Search applicants">${select('rterr', [['', 'All areas']].concat(d.territories.map((t) => [t.code, t.code])), terr, { 'data-i': 'rterr', 'aria-label': 'Territory' })}</div>
        <div class="list">${rows.length ? rows.map((x) => html`<button type="button" class="item${S.sel.app === x.user_id ? ' on' : ''}" data-a="sel" data-key="app" data-id="${x.user_id}"><span class="row between"><b>${x.full_name || x.email}</b>${pill(stageLabel(x.pipeline_stage), STAGE_TONE[x.pipeline_stage])}</span><small>${ROLE_TYPE[x.role_type]} · ${x.zip || 'no ZIP'}${x.territory_code ? ' (' + x.territory_code + ')' : ''} · ${x.source || 'no source'}${x.screening_at && x.pipeline_stage === 'screening' ? ' · screening ' + fmtET(x.screening_at) : ''}${x.stale ? ' · stale' : ''}</small></button>`) : empty('No applicants here.')}</div></div>
        ${detail(d, a)}</div>`;
  }

  function detail(d, a) {
    if (!a) return html`<div class="detail">${empty('Choose an applicant to vet, schedule and activate them.')}</div>`;
    const miss = missing(a);
    return html`<div class="detail" data-k="${a.user_id}">
      <section class="panel">
        <div class="row between"><div class="row">${avatar(a.full_name, a.photo_url, 'lg')}<div><h2 class="h2">${a.full_name || a.email}</h2><span class="muted">${a.email}${a.phone ? ' · ' + a.phone : ''}</span></div></div>
          <div class="row">${a.phone ? html`<a class="btn-o sm" href="tel:${a.phone}" data-nav="1">Call</a><a class="btn-q sm" href="sms:${a.phone}" data-nav="1">Text</a>` : ''}<button class="btn-q sm" data-a="invite-app" data-id="${a.user_id}">Send sign-in link</button></div></div>
        ${kv([['Profile', a.status], ['Source', a.source + (a.referred_by ? ' (by ' + a.referred_by + ')' : '')], ['Recruiter', a.recruiter], ['Last contact', a.last_contacted_at ? ago(a.last_contacted_at) : ''], ['Last sign-in', a.last_login_at ? ago(a.last_login_at) : 'Never'], ['Availability updated', a.availability_updated_at ? ago(a.availability_updated_at) : '']])}
        ${when(a.pipeline_stage !== 'active' && miss.length, () => html`<p class="note">To activate, complete: ${miss.join(', ')}.</p>`)}
        ${when(a.stale, () => html`<p class="alert-line">Availability not updated in 30 days. Ask them to update it, or pause the profile.</p>`)}
      </section>
      <form class="panel stack" data-f="vet" data-k="vet-${a.user_id}-${a.pipeline_stage}-${a.status}">
        <input type="hidden" name="user_id" value="${a.user_id}">
        <h3 class="h3">Vetting</h3>
        <div class="grid2">${field('Stage', select('pipeline_stage', STAGES, a.pipeline_stage))}${field('Screening call (New York time)', input('screening_at', isoToEt(a.screening_at), { type: 'datetime-local' }))}${field('Next step', input('next_step', a.next_step, { placeholder: 'e.g. Waiting on 2nd reference' }))}${field('Recruiter', select('recruiter_user_id', [['', 'Unassigned']].concat(d.recruiters.map((r) => [r.id, r.full_name])), a.recruiter_user_id))}</div>
        <div class="toggles">${check('check_interview', a.check_interview, 'Screening interview done')}${check('check_id', a.check_id, 'ID confirmed')}${check('check_references', a.check_references, 'References checked')}${check('background_consent', a.background_consent, 'Background check consent')}</div>
        <p class="muted small">The paid background check isn’t run here. Compliance orders it only after a family passes this applicant.</p>
        <h3 class="h3">Profile</h3>
        <div class="grid2">${field('Full name', input('full_name', a.full_name))}${field('Email', input('email', a.email, { type: 'email' }))}${field('Mobile', input('phone', a.phone, { type: 'tel' }))}${field('Type', select('role_type', [['cleaner', 'House cleaner'], ['housekeeper', 'Housekeeper'], ['nanny', 'Nanny']], a.role_type))}${field('ZIP', input('zip', a.zip, { maxlength: 5 }))}${field('City', input('city', a.city))}${field('Rate ($/hr)', input('rate', a.rate, { type: 'number', step: 0.5 }))}${field('Years', input('years', a.years, { type: 'number' }))}${field('Starts in (days)', input('start_in_days', a.start_in_days, { type: 'number' }))}${field('Languages', input('languages', list(a.languages)))}${field('Days', input('days', list(a.days), { placeholder: 'Mon, Wed, Fri' }))}${field('Hours', input('hours', a.hours))}${field('Source', select('source', SOURCES, a.source))}${field('Photo', input('photo_url', a.photo_url, { placeholder: 'https://… or /assets/img/…' }))}</div>
        ${field('Bio (families see this)', textarea('bio', a.bio, { rows: 3 }))}
        ${field('Team notes (never shown to applicants or families)', textarea('team_notes', a.team_notes, { rows: 3 }))}
        <div class="row between">${check('disabled', a.disabled, 'Block sign-in')}<button class="btn" type="submit">Save applicant</button></div>
      </form>
      <section class="panel"><h3 class="h3">Activity</h3>
        <form class="stack" data-f="pnote" data-k="pn-${a.user_id}-${a.events.length}"><input type="hidden" name="user_id" value="${a.user_id}">${textarea('body', '', { rows: 2, placeholder: 'What happened?', 'aria-label': 'Note' })}<div class="row end"><button class="btn-q sm" type="submit" name="kind" value="note">Add note</button><button class="btn-o sm" type="submit" name="kind" value="contact">Log contact</button></div></form>
        <ol class="timeline">${a.events.map((e) => html`<li><span class="t-dot" aria-hidden="true"></span><div><p>${e.body}</p><time>${ago(e.created_at)}${e.actor ? ' · ' + e.actor : ''}</time></div></li>`)}</ol></section>
    </div>`;
  }

  function board(d) {
    const terrs = [...new Set(d.board.map((b) => b.territory))];
    return html`<div class="row between"><h1 class="h2">Supply board</h1>${when(d.kpis.stale, () => html`<button class="btn-o sm" data-a="pause-stale">Pause ${d.kpis.stale} stale profile${d.kpis.stale > 1 ? 's' : ''}</button>`)}</div>
      <p class="muted">Target: at least 3 active applicants per type in every area, and 3 per family still waiting.</p>
      <div class="tiles">${[['Leads', d.kpis.leads], ['In vetting', d.kpis.screening], ['Active', d.kpis.active], ['Open requests', d.kpis.open_requests], ['New website applications', d.kpis.new_applications]].map(([l, n]) => html`<div class="tile static"><b>${n}</b><span>${l}</span></div>`)}</div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Area</th><th>Type</th><th>Active</th><th>In vetting</th><th>Families waiting</th><th>Target</th><th>Gap</th><th>Requests</th></tr></thead>
      <tbody>${terrs.map((t) => d.board.filter((b) => b.territory === t).map((b) => html`<tr class="${b.gap ? 'gap' : ''}"><td>${t}</td><td>${ROLE_TYPE[b.role_type]}</td><td>${b.active}</td><td>${b.pipeline}</td><td>${b.demand}</td><td>${b.target}</td><td>${b.gap ? html`<b>${b.gap}</b>` : '✓'}</td><td>${b.open_requests || ''}</td></tr>`))}</tbody></table></div>`;
  }

  function requests(d) {
    return html`<h1 class="h2">Supply requests</h1><p class="muted">From the Concierge team and automatic checks when supply is low.</p>
      ${d.supply.length ? html`<ul class="rows panel">${d.supply.map((s) => html`<li data-k="${s.id}-${s.status}"><div><b>${s.needed} × ${ROLE_TYPE[s.role_type]} in ${s.territory_code}${s.zip ? ' near ' + s.zip : ''}${s.rate_max ? ' · up to $' + s.rate_max + '/hr' : ''}</b><span class="muted small">${s.details || ''} · from ${s.created_by} · ${['open', 'in_progress'].includes(s.status) ? dueIn(s.due_at) : fmtDay(s.created_at)}${s.assignee ? ' · ' + s.assignee : ''}</span></div>
        ${select('status', [['open', 'Open'], ['in_progress', 'In progress'], ['filled', 'Filled'], ['cancelled', 'Cancelled']], s.status, { 'data-c': 'sr-status', 'data-id': s.id, 'aria-label': 'Status' })}</li>`)}</ul>` : empty('No supply requests yet.')}`;
  }

  function referrals(d) {
    return html`<h1 class="h2">Referrals</h1><p class="muted">Applicants refer friends from their account. When a referral is hired, Finance pays the bonus.</p>
      ${d.referrals.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Referred</th><th>Contact</th><th>Type</th><th>By</th><th>Date</th><th>Status</th></tr></thead><tbody>${d.referrals.map((r) => html`<tr data-k="${r.id}-${r.status}"><td>${r.lead_user_id ? html`<button class="lnk" data-a="sel-app" data-id="${r.lead_user_id}">${r.name}</button>` : r.name}</td><td>${r.email || r.phone}</td><td>${ROLE_TYPE[r.role_type] || ''}</td><td>${r.referrer}</td><td>${fmtDay(r.created_at)}</td><td>${r.status === 'bonus_paid' ? pill('Bonus paid', 'green') : select('status', REF, r.status, { 'data-c': 'ref-status', 'data-id': r.id, 'aria-label': 'Status' })}</td></tr>`)}</tbody></table></div>` : empty('No referrals yet.')}`;
  }

  function add(d) {
    const me = HM.firstName(S.me.full_name) || 'the handmatch team';
    return html`<h1 class="h2">Add applicants</h1><div class="grid2">
      <form class="panel stack" data-f="lead" data-k="lead-${d.applicants.length}"><h2 class="h3">Add one person</h2>
        <div class="grid2">${field('Full name', input('full_name', '', { required: true }))}${field('Email', input('email', '', { type: 'email', required: true }))}${field('Mobile', input('phone', '', { type: 'tel' }))}${field('Type', select('role_type', [['cleaner', 'House cleaner'], ['housekeeper', 'Housekeeper'], ['nanny', 'Nanny']], 'housekeeper'))}${field('ZIP', input('zip', '', { maxlength: 5 }))}${field('Source', select('source', SOURCES, 'facebook'))}</div>
        ${field('Notes', textarea('notes', '', { rows: 2 }))}${check('invite', false, 'Email them a link to finish their profile')}<div><button class="btn" type="submit">Add to pipeline</button></div></form>
      <div class="stack">
        <form class="panel stack" data-f="import" data-k="imp-${d.applicants.length}"><h2 class="h3">Import a list</h2><p class="muted small">Paste CSV with columns: name, email, phone, role, zip, source. A header row is optional. Up to 500 rows; existing emails are skipped.</p>
          ${textarea('csv', '', { rows: 6, placeholder: 'name,email,phone,role,zip,source\nMaria Santos,maria@example.com,3055550111,nanny,33101,facebook', 'aria-label': 'CSV' })}<div><button class="btn-o" type="submit">Import</button></div></form>
        <section class="panel stack"><h2 class="h3">Website applications</h2><p class="muted small">${d.kpis.new_applications} application${d.kpis.new_applications === 1 ? '' : 's'} from handmatch.us/join not in the pipeline yet.</p><div><button class="btn-o" data-a="import-apps" ${raw(d.kpis.new_applications ? '' : 'disabled')}>Bring them in</button></div></section>
      </div></div>
      <section class="panel"><h2 class="h3">Message templates</h2><ul class="rows">${TEMPLATES.map(([t, body]) => { const b = body.replace('{me}', me); return html`<li><div><b>${t}</b><span class="small">${b}</span></div><button class="btn-q sm" data-a="copy" data-text="${b}">Copy</button></li>`; })}</ul></section>`;
  }

  HM.views.recruiter = {
    render(d) {
      const k = d.kpis;
      return HM.teamShell([
        { id: 'pipeline', label: 'Pipeline', badge: k.leads },
        { id: 'board', label: 'Supply board', badge: d.board.filter((b) => b.gap && b.demand).length, alert: true },
        { id: 'requests', label: 'Supply requests', badge: k.open_requests, alert: true },
        { id: 'referrals', label: 'Referrals', badge: d.referrals.filter((r) => r.status === 'new').length },
        { id: 'add', label: 'Add & import', badge: k.new_applications },
        { id: 'account', label: 'My details' }
      ], (cur) => cur === 'board' ? board(d) : cur === 'requests' ? requests(d) : cur === 'referrals' ? referrals(d) : cur === 'add' ? add(d) : cur === 'account' ? HM.account() : pipeline(d));
    }
  };

  HM.actions.rfilter = (d) => HM.set({ f: Object.assign(S.f, { rst: d.v }) });
  HM.actions['sel-app'] = (d) => { S.tab.recruiter = 'pipeline'; S.f.rst = 'all'; S.sel.app = d.id; HM.render(); };
  HM.actions['invite-app'] = (d) => HM.act('invite_applicant', { user_id: d.id }, 'Sign-in link sent');
  HM.actions['pause-stale'] = () => { if (HM.confirm('Pause every active profile that hasn’t updated availability in 30 days? They’ll get an email.')) HM.act('pause_stale', {}, (r) => HM.toast(`Paused ${r.paused}`)); };
  HM.actions['import-apps'] = () => HM.act('import_applications', {}, (r) => HM.toast(`Imported ${r.created}`));
  HM.actions['sr-status'] = (d, el) => HM.act('update_supply_request', { id: d.id, status: el.value }, 'Updated');
  HM.actions['ref-status'] = (d, el) => HM.act('update_referral', { id: d.id, status: el.value }, 'Updated');
  HM.forms.vet = (fd) => { fd.screening_at = fd.screening_at ? etToIso(fd.screening_at) : ''; return HM.act('update_applicant', fd, 'Applicant saved'); };
  HM.forms.pnote = (fd) => (fd.body.trim() ? HM.act('pipeline_note', fd, fd.kind === 'contact' ? 'Contact logged' : 'Note added') : HM.toast('Write a note first.', true));
  HM.forms.lead = (fd) => HM.act('add_lead', fd, (r) => { S.tab.recruiter = 'pipeline'; S.f.rst = 'all'; S.sel.app = r.user_id; HM.toast('Added to the pipeline'); });
  HM.forms.import = (fd) => HM.act('import_leads', fd, (r) => HM.toast(`Imported ${r.created}. ${r.skipped.length ? 'Skipped ' + r.skipped.length + ': ' + r.skipped.slice(0, 3).join('; ') : ''}`, r.skipped.length > 0 && !r.created));
})();
