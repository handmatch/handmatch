/* handmatch web app: applicants (cleaners, housekeepers, nannies) */
(function () {
  'use strict';
  const { S, html, raw, when, fmtET, fmtDay, ago, money, list, ROLE_TYPE, KIND, pill, empty, field, input, textarea, select, check, tick } = HM;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const SKILLS = ['Regular cleaning', 'Deep cleaning', 'Laundry', 'Cooking', 'Organizing', 'Pet care', 'Child care', 'Elder care', 'Errands', 'Ironing', 'Meal prep'];
  const REQ = { waiting: ['New request', 'amber'], accepted: ['You’re available', 'green'], declined: ['You declined', 'grey'], meeting: ['Meeting', 'dark'], passed: ['Family wants to move forward', 'green'], check: ['Background check', 'amber'], cleared: ['Cleared · waiting for the family', 'green'], hired: ['Hired', 'green'], ended: ['Ended', 'grey'], not_fit: ['Not selected', 'grey'], not_selected: ['Not selected', 'grey'] };
  const BANNER = {
    draft: ['Finish your profile', 'Fill in your details and submit for review. Our recruiting team will call you for a short screening interview.'],
    submitted: ['Your profile is in review', 'Our recruiting team will call you for a short screening interview. You can keep updating your profile.'],
    active: ['Your profile is active', 'We can match you with families near you. Keep your days and hours up to date, or your profile pauses after 30 days.'],
    paused: ['Your profile is paused', 'Families can’t be matched with you right now. Update your availability or message us to turn it back on.']
  };
  const REF = { new: ['Referred', ''], contacted: ['We contacted them', ''], joined: ['Joined', 'green'], hired: ['Hired · bonus on its way', 'green'], bonus_paid: ['Bonus paid', 'green'], not_eligible: ['Not eligible', 'grey'] };

  function profileForm(d) {
    const p = d.profile; const me = S.me;
    const days = new Set(p.days || []); const skills = new Set(p.skills || []);
    return html`<form class="stack" data-f="profile" data-k="profile">
      <div class="grid2">
        ${field('Full name', input('full_name', me.full_name, { autocomplete: 'name' }))}
        ${field('Mobile', input('phone', me.phone, { type: 'tel', autocomplete: 'tel' }))}
        ${field('Type of work', select('role_type', [['cleaner', 'House cleaner'], ['housekeeper', 'Housekeeper'], ['nanny', 'Nanny']], p.role_type))}
        ${field('ZIP code', input('zip', p.zip, { inputmode: 'numeric', maxlength: 5, pattern: '\\d{5}' }), p.territory_code ? 'Area: ' + p.territory_code : '')}
        ${field('City or neighborhood', input('city', p.city))}
        ${field('Hourly rate ($)', input('rate', p.rate, { type: 'number', min: 0, step: 0.5 }))}
        ${field('Years of experience', input('years', p.years, { type: 'number', min: 0, max: 60 }))}
        ${field('Can start in (days)', input('start_in_days', p.start_in_days, { type: 'number', min: 0, max: 90 }))}
        ${field('Languages', input('languages', list(p.languages), { placeholder: 'English, Spanish' }))}
        ${field('Usual hours', input('hours', p.hours, { placeholder: 'e.g. 8 AM to 4 PM' }))}
      </div>
      <fieldset class="toggles"><legend class="lbl">Days you can work</legend>${DAYS.map((x) => html`<label class="tg"><input type="checkbox" name="days" value="${x}" data-multi="1" ${raw(days.has(x) ? 'checked' : '')}><span>${x}</span></label>`)}</fieldset>
      <fieldset class="toggles"><legend class="lbl">What you’re great at</legend>${SKILLS.map((x) => html`<label class="tg"><input type="checkbox" name="skills" value="${x}" data-multi="1" ${raw(skills.has(x) ? 'checked' : '')}><span>${x}</span></label>`)}</fieldset>
      ${field('About you', textarea('bio', p.bio, { rows: 4, maxlength: 1200, placeholder: 'Your experience, what families love about you, anything that makes you you.' }), 'Families see your first name and last initial, your photo and this text. Never your phone or email.')}
      ${check('background_consent', p.background_consent, 'I agree to a background check if a family wants to hire me. handmatch pays for it.')}
      <div class="row">${p.status === 'draft' || p.status === 'paused' ? html`<button class="btn" type="submit" name="go" value="submit">Submit for review</button><button class="btn-o" type="submit" name="go" value="save">Save draft</button>` : html`<button class="btn" type="submit">Save profile</button>`}</div>
    </form>`;
  }

  function meetingRow(r, m) {
    const label = KIND[m.kind];
    return html`<li class="mtg"><span>
      ${m.status === 'requested' ? html`<b>${label} requested.</b> Your Concierge will confirm a time with you.` : ''}
      ${m.status === 'confirmed' ? html`<b>${label}: ${fmtET(m.start_at)}.</b> ${m.join_info ? 'How to join: ' + m.join_info + '.' : ''} ${m.applicant_confirmed ? 'You confirmed.' : ''}` : ''}
      ${m.status === 'completed' ? html`<b>${label} done.</b> ${m.checked_out_at ? 'Checked out ' + fmtET(m.checked_out_at) + '.' : ''}` : ''}
      ${m.kind === 'trial' ? html` <span class="muted">${m.trial_hours} h at $${m.trial_rate}/hr, paid by the family at the end.</span>` : ''}</span>
      <span class="row">
        ${when(m.status === 'confirmed' && !m.applicant_confirmed, () => html`<button class="btn sm" data-a="mtg-ok" data-id="${m.id}">I’ll be there</button><button class="btn-q sm" data-a="modal" data-m="cantmake" data-id="${m.id}">Can’t make it</button>`)}
        ${when(m.can_check_in, () => html`<button class="btn sm" data-a="trial" data-id="${m.id}" data-what="in">Check in</button>`)}
        ${when(m.can_check_out, () => html`<button class="btn sm" data-a="trial" data-id="${m.id}" data-what="out">Check out</button>`)}
      </span></li>`;
  }

  function requestCard(r) {
    const [label, tone] = REQ[r.status] || [r.status, ''];
    const dt = r.details;
    return html`<article class="req" data-k="${r.id}">
      <div class="row between"><h3 class="h3">${r.family_contact ? r.family_contact.name : r.family_first + ' family'}${r.zip ? ', near ' + r.zip : ''}</h3>${pill(label, tone)}</div>
      ${HM.kv([['Looking for', r.help_type], ['Services', list(dt.services)], ['Days', list(dt.days)], ['How often', dt.frequency], ['Budget', dt.budget_per_hour ? '$' + dt.budget_per_hour + '/hr' : ''], ['Home', dt.home_size], ['Pets', dt.pets ? 'Yes' : '']])}
      ${when(r.family_contact, () => html`<div class="contact"><b>Contact the family directly</b><span>${r.family_contact.phone ? html`<a href="tel:${r.family_contact.phone}">${r.family_contact.phone}</a>` : ''}${r.family_contact.email ? html` · <a href="mailto:${r.family_contact.email}">${r.family_contact.email}</a>` : ''}</span></div>`)}
      ${when(r.meetings.length, () => html`<ul class="mtgs">${r.meetings.map((m) => meetingRow(r, m))}</ul>`)}
      ${when(r.status === 'passed' || r.status === 'check', () => html`<p class="note">The family wants to move forward. We’re running your background check, paid by handmatch. Please complete any email from the screening company quickly.</p>`)}
      <div class="row">
        ${when(r.status === 'waiting', () => html`<button class="btn sm" data-a="respond" data-id="${r.id}" data-accept="1">I’m available</button><button class="btn-q sm" data-a="respond" data-id="${r.id}" data-accept="">Not this time</button>`)}
        ${when(r.thread_id, () => html`<button class="btn-o sm" data-a="go-thread" data-key="applicant" data-id="${r.thread_id}">Message</button>`)}
        ${when(r.status === 'hired', () => html`<button class="btn-q sm" data-a="modal" data-m="appcase" data-id="${r.id}">Report an issue</button>`)}
      </div>
    </article>`;
  }

  function home(d) {
    const p = d.profile;
    const [title, sub] = BANNER[p.status] || BANNER.draft;
    const open = d.requests.filter((r) => !['declined', 'not_fit', 'not_selected', 'ended'].includes(r.status));
    const past = d.requests.filter((r) => ['declined', 'not_fit', 'not_selected', 'ended'].includes(r.status));
    return html`<div class="ov">
      <section class="next"><span class="muted small">Your status</span><h2 class="h2">${title}</h2><p>${sub}</p>
        <div class="meter" role="progressbar" aria-valuenow="${d.completeness}" aria-valuemin="0" aria-valuemax="100"><span style="width:${d.completeness}%"></span></div><span class="muted small">Profile ${d.completeness}% complete</span>
        ${when(p.status === 'draft' || p.status === 'paused', () => html`<div><button class="btn-o sm" data-a="tab" data-key="applicant" data-v="profile">Edit profile</button></div>`)}</section>
      <aside class="panel"><h2 class="h3">Your checks</h2><ul class="ticks">${tick(p.check_interview, 'Screening interview')}${tick(p.check_id, 'Identity confirmed')}${tick(p.check_references, 'References checked')}${tick(p.check_background === 'clear', p.check_background === 'clear' ? 'Background check clear' : 'Background check, only when a family wants to hire you')}</ul></aside>
    </div>
    <h2 class="h2">Requests from families</h2>
    ${open.length ? html`<div class="app-list">${open.map(requestCard)}</div>` : empty(p.status === 'active' ? 'No requests right now. We’ll email you when a family near you is a good fit.' : 'Once your profile is active, requests from families will show up here.')}
    ${when(past.length, () => html`<details class="past"><summary>Past requests (${past.length})</summary><div class="app-list">${past.map(requestCard)}</div></details>`)}`;
  }

  function refer(d) {
    return html`<div class="grid2">
      <section class="panel"><h2 class="h3">Refer a friend, earn ${money(d.bonus_cents)}</h2>
        <p class="muted">Know a great cleaner, housekeeper or nanny? When they’re hired through handmatch, you get ${money(d.bonus_cents)}.</p>
        <form class="stack" data-f="refer" data-k="refer-${d.referrals.length}">
          ${field('Their name', input('name', '', { required: true }))}
          <div class="grid2">${field('Email', input('email', '', { type: 'email' }))}${field('Mobile', input('phone', '', { type: 'tel' }))}</div>
          ${field('They work as', select('role_type', [['', 'Not sure'], ['cleaner', 'House cleaner'], ['housekeeper', 'Housekeeper'], ['nanny', 'Nanny']], ''))}
          <div><button class="btn" type="submit">Send referral</button></div>
        </form></section>
      <section class="panel"><h2 class="h3">Your referrals</h2>
        ${d.referrals.length ? html`<ul class="rows">${d.referrals.map((r) => html`<li><div><b>${r.name}</b><span class="muted small">${fmtDay(r.created_at)}</span></div>${pill(...(REF[r.status] || [r.status]))}</li>`)}</ul>` : empty('People you refer will show up here.')}</section>
    </div>`;
  }

  HM.views.applicant = {
    render(d) {
      const tab = HM.curTab('applicant', 'home');
      const name = HM.firstName(S.me.full_name);
      return html`<main class="home-main">
        <div class="hello"><h1 class="h1">${name ? `Hi ${name}.` : 'Welcome to handmatch.'}</h1></div>
        ${HM.tabs('applicant', [{ id: 'home', label: 'Requests', badge: d.requests.filter((r) => r.status === 'waiting' || r.meetings.some((m) => m.status === 'confirmed' && !m.applicant_confirmed)).length }, { id: 'profile', label: 'My profile' }, { id: 'messages', label: 'Messages', badge: HM.unread() }, { id: 'refer', label: 'Refer a friend' }, { id: 'account', label: 'Account' }])}
        ${tab === 'profile' ? html`<section class="panel">${profileForm(d)}</section>`
          : tab === 'messages' ? HM.chat(d.threads || [], { empty: 'When you accept a request, you’ll chat with the family and your Concierge here.' })
            : tab === 'refer' ? refer(d) : tab === 'account' ? HM.account() : home(d)}
      </main>`;
    }
  };

  HM.forms.profile = (fd) => {
    const submit = fd.go === 'submit';
    delete fd.go;
    return HM.act('save_profile', Object.assign(fd, { submit }), submit ? 'Submitted. Our recruiting team will be in touch.' : 'Profile saved');
  };
  HM.forms.refer = (fd) => HM.act('refer', fd, 'Thanks! We’ll reach out to them.');
  HM.actions.respond = (d) => HM.act('respond', { id: d.id, accept: !!d.accept }, d.accept ? 'Great! The family can now book a meeting with you.' : 'Thanks for letting us know.');
  HM.actions['mtg-ok'] = (d) => HM.act('confirm_meeting', { meeting_id: d.id, ok: true }, 'Confirmed. See you there!');
  HM.actions.trial = (d) => HM.act('trial_check', { meeting_id: d.id, what: d.what }, d.what === 'in' ? 'Checked in. Have a great trial!' : 'Checked out. Thank you!');
  HM.modals.cantmake = (c) => ({
    title: 'Can’t make it?',
    body: html`<form class="stack" data-f="cantmake"><input type="hidden" name="meeting_id" value="${c.id}">
      ${field('What times work better?', input('note', '', { required: true, 'data-autofocus': true, placeholder: 'e.g. Any weekday after 3 PM' }))}
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Ask for a new time</button></div></form>`
  });
  HM.forms.cantmake = (fd) => HM.act('confirm_meeting', Object.assign(fd, { ok: false }), 'Thanks. Your Concierge will find a new time.');
  HM.modals.appcase = (c) => ({
    title: 'Report an issue',
    body: html`<form class="stack" data-f="appcase"><input type="hidden" name="link_id" value="${c.id}">
      ${field('What’s it about?', select('type', [['safety', 'I feel unsafe'], ['payment', 'Pay or hours'], ['schedule', 'Schedule'], ['other', 'Something else']], 'other'))}
      ${field('Short summary', input('subject', '', { required: true, 'data-autofocus': true }))}
      ${field('What happened?', textarea('description', '', { rows: 4 }))}
      <p class="muted small">If you’re in danger, call 911 first. This goes to the handmatch team only, not the family.</p>
      <div class="row end"><button type="button" class="btn-q" data-a="close-modal">Cancel</button><button class="btn" type="submit">Send to handmatch</button></div></form>`
  });
  HM.forms.appcase = (fd) => HM.act('open_case', fd, 'Sent. Our team will contact you.');
})();
