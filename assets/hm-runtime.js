/*
 * handmatch page runtime
 * Renders a page template (<template id="hm-tpl">) with a small component class.
 * Supports {{holes}} in text and attributes, <sc-if value>, <sc-for value|list as>,
 * and onClick / onChange / onInput / onSubmit handlers. Re-renders on setState
 * by patching the existing DOM, so focus, scroll and open <details> are kept.
 */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
    }
    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state) : patch;
      this.state = Object.assign({}, this.state, next);
      if (this.__render) this.__render();
    }
  }
  window.DCLogic = DCLogic;

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const ONLY_HOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    const parts = expr.split('.');
    let v = scope;
    for (const p of parts) {
      if (v == null) return undefined;
      v = v[p];
    }
    return v;
  }

  function str(v) {
    return v == null || v === false ? '' : String(v);
  }

  function fill(text, scope) {
    return text.replace(HOLE, (_, e) => str(lookup(e, scope)));
  }

  const EVENT_MAP = { onclick: 'click', onsubmit: 'submit', oninput: 'input' };

  function eventFor(attrName, el) {
    const n = attrName.toLowerCase();
    if (EVENT_MAP[n]) return EVENT_MAP[n];
    if (n === 'onchange') {
      const tag = el.tagName;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'SELECT' || type === 'checkbox' || type === 'radio') return 'change';
      return 'input'; // text, email, tel, range, textarea: update on every keystroke
    }
    return n.replace(/^on/, '');
  }

  // Build a fresh DOM fragment from template nodes for the given scope.
  function build(nodes, scope, out) {
    for (const node of nodes) {
      if (node.nodeType === 3) {
        out.appendChild(document.createTextNode(fill(node.nodeValue, scope)));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const tag = node.tagName.toLowerCase();
      if (tag === 'sc-if') {
        const m = (node.getAttribute('value') || '').match(ONLY_HOLE);
        if (m && lookup(m[1], scope)) build(node.childNodes, scope, out);
        continue;
      }
      if (tag === 'sc-for') {
        const src = node.getAttribute('value') || node.getAttribute('list') || '';
        const m = src.match(ONLY_HOLE);
        const list = m ? lookup(m[1], scope) : [];
        const as = node.getAttribute('as') || 'item';
        (list || []).forEach((item, i) => {
          const child = Object.create(scope);
          child[as] = item;
          child.$index = i;
          build(node.childNodes, child, out);
        });
        continue;
      }
      const el = node.namespaceURI === 'http://www.w3.org/2000/svg'
        ? document.createElementNS(node.namespaceURI, node.tagName)
        : document.createElement(node.tagName);
      const handlers = {};
      const props = {};
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name;
        if (name.startsWith('hint-')) continue;
        const only = attr.value.match(ONLY_HOLE);
        if (/^on[a-z]+$/i.test(name)) {
          if (only) {
            const fn = lookup(only[1], scope);
            if (typeof fn === 'function') handlers[eventFor(name, node)] = fn;
          }
          continue;
        }
        if ((name === 'value' || name === 'checked') && only) {
          const v = lookup(only[1], scope);
          props[name] = name === 'checked' ? !!v : str(v);
          if (name === 'value') el.setAttribute('value', str(v));
          continue;
        }
        if (only) {
          const v = lookup(only[1], scope);
          if (v === false || v == null) continue;
          el.setAttribute(name, v === true ? '' : String(v));
        } else {
          el.setAttribute(name, attr.value.indexOf('{{') >= 0 ? fill(attr.value, scope) : attr.value);
        }
      }
      if (Object.keys(handlers).length) el.__hm = handlers;
      if (Object.keys(props).length) el.__hmProps = props;
      const kids = node.content ? node.content.childNodes : node.childNodes;
      build(kids, scope, el);
      if (el.tagName === 'TEXTAREA' && props.value != null) el.textContent = props.value;
      out.appendChild(el);
    }
    return out;
  }

  function applyProps(el) {
    const p = el.__hmProps;
    if (!p) return;
    if ('value' in p && el.value !== p.value) el.value = p.value;
    if ('checked' in p && el.checked !== p.checked) el.checked = p.checked;
  }

  // Patch `from` (live DOM) to look like `to` (fresh DOM).
  function morph(from, to) {
    const a = Array.from(from.childNodes);
    const b = Array.from(to.childNodes);
    for (let i = 0; i < b.length; i++) {
      const nb = b[i];
      const na = a[i];
      if (!na) { from.appendChild(nb); fixup(nb); continue; }
      if (na.nodeType !== nb.nodeType || na.nodeName !== nb.nodeName) {
        from.replaceChild(nb, na); fixup(nb); continue;
      }
      if (na.nodeType === 3) {
        if (na.nodeValue !== nb.nodeValue) na.nodeValue = nb.nodeValue;
        continue;
      }
      if (na.nodeType !== 1) continue;
      // attributes
      for (const attr of Array.from(na.attributes)) {
        if (!nb.hasAttribute(attr.name)) {
          if (na.tagName === 'DETAILS' && attr.name === 'open') continue; // user toggled
          na.removeAttribute(attr.name);
        }
      }
      for (const attr of Array.from(nb.attributes)) {
        if (na.getAttribute(attr.name) !== attr.value) na.setAttribute(attr.name, attr.value);
      }
      na.__hm = nb.__hm;
      na.__hmProps = nb.__hmProps;
      if (na.tagName === 'TEXTAREA') { applyProps(na); continue; }
      morph(na, nb);
      applyProps(na);
    }
    for (let i = a.length - 1; i >= b.length; i--) from.removeChild(a[i]);
  }

  function fixup(node) {
    if (node.nodeType !== 1) return;
    applyProps(node);
    node.querySelectorAll('*').forEach(applyProps);
  }

  function delegate(root, type) {
    root.addEventListener(type, (e) => {
      let el = e.target;
      while (el && el !== root.parentNode) {
        if (el.__hm && el.__hm[type]) { el.__hm[type](e); return; }
        el = el.parentNode;
      }
    });
  }

  function start() {
    const tpl = document.getElementById('hm-tpl');
    const root = document.getElementById('hm-root');
    if (!tpl || !root) return;
    const props = Object.assign({}, window.HM_PROPS || {});
    const Comp = window.Component || class extends DCLogic { renderVals() { return {}; } };
    const comp = new Comp(props);
    let queued = false;
    const render = () => {
      const vals = comp.renderVals() || {};
      const scope = Object.assign({}, vals);
      const frag = build(tpl.content.childNodes, scope, document.createElement('div'));
      if (!root.firstChild) {
        while (frag.firstChild) root.appendChild(frag.firstChild);
        fixup(root);
      } else {
        morph(root, frag);
      }
    };
    comp.__render = () => {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; render(); });
    };
    ['click', 'input', 'change', 'submit'].forEach((t) => delegate(root, t));
    render();
    if (typeof comp.componentDidMount === 'function') comp.componentDidMount();
  }

  window.hmPost = async function (url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {})
    });
    let body = {};
    try { body = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
    return body;
  };

  window.hmStore = {
    get(k) { try { return JSON.parse(sessionStorage.getItem('hm:' + k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem('hm:' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
