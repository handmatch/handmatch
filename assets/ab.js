/* handmatch A/B test: picks this visitor's variant once and remembers it.
   Variant B = "Meet first, pay when you hire". Add ?variant=A or ?variant=B to a URL to preview one. */
(function () {
  'use strict';
  var KEY = 'hm_ab';
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* private mode */ }
  var params = new URLSearchParams(location.search);
  var force = params.get('variant');
  if (force !== 'A' && force !== 'B') force = null;
  window.HM_VARIANT = saved && saved.on ? saved.v : 'A';
  window.HM_AB_READY = !!saved && !force && (saved.on || Date.now() - saved.t < 3600000);
  if (window.HM_AB_READY) return;
  fetch('/api/ab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant: force || undefined, path: location.pathname, from_ad: params.has('gclid') || params.has('utm_source') }) })
    .then(function (r) { return r.ok ? r.json() : { variant: 'A', on: false }; })
    .catch(function () { return { variant: 'A', on: false }; })
    .then(function (j) {
      window.HM_VARIANT = j.on ? j.variant : 'A';
      window.HM_AB_READY = true;
      try { localStorage.setItem(KEY, JSON.stringify({ v: j.variant, on: !!j.on, t: Date.now() })); } catch (e) { /* ignore */ }
      window.dispatchEvent(new Event('hm-variant'));
    });
})();
