// Small DOM helpers: element builder, toasts, dialogs, downloads, icons.

export function h(tag, attrs = {}, ...children) {
  const el = tag.startsWith('svg:')
    ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4))
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'indeterminate') el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function isTyping(target = document.activeElement) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Re-render a container while keeping keyboard focus on the element with the
 * same `name` (and its caret position), so live panels don't steal focus.
 */
export function renderKeepingFocus(container, render) {
  const active = document.activeElement;
  let key = null;
  let sel = null;
  if (active && container.contains(active) && active.name) {
    key = active.name;
    try { sel = [active.selectionStart, active.selectionEnd]; } catch { sel = null; }
  }
  const scroll = container.scrollTop;
  render();
  container.scrollTop = scroll;
  if (key) {
    const el = container.querySelector(`[name="${CSS.escape(key)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && sel[0] != null) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ } }
    }
  }
}

// --- toasts -------------------------------------------------------------------

export function toast(message, { type = 'info', timeout = 3500, actions = [] } = {}) {
  const host = document.getElementById('toasts');
  if (!host) { console.log(message); return () => {}; }
  const el = h('div', { class: `toast toast-${type}`, role: 'status' }, h('span', {}, message));
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  for (const a of actions) {
    el.append(h('button', { class: 'btn btn-small', onclick: () => { close(); a.onClick(); } }, a.label));
  }
  el.append(h('button', { class: 'toast-x', title: 'Dismiss', onclick: close }, '×'));
  host.append(el);
  if (timeout > 0) setTimeout(close, timeout);
  return close;
}

// --- dialogs ------------------------------------------------------------------

/**
 * Modal dialog. fields: [{ name, label, type: 'text'|'number'|'select'|'checkbox'|'textarea'|'color', value, options, step, min, max, hint }]
 * Resolves to an object of values, or null when cancelled.
 */
export function openDialog({ title, message, body, fields = [], okText = 'OK', cancelText = 'Cancel', danger = false, wide = false }) {
  return new Promise((resolve) => {
    const host = document.getElementById('dialogs');
    const form = h('form', { class: `dialog${wide ? ' dialog-wide' : ''}`, method: 'dialog' });
    form.append(h('h2', {}, title || ''));
    if (message) form.append(h('p', { class: 'dialog-msg' }, message));
    if (body) form.append(body);
    const inputs = {};
    for (const f of fields) {
      let input;
      if (f.type === 'select') {
        input = h('select', { name: f.name }, (f.options || []).map((o) => {
          const [v, label] = Array.isArray(o) ? o : [o, o];
          return h('option', { value: v, selected: String(v) === String(f.value) }, label);
        }));
      } else if (f.type === 'textarea') {
        input = h('textarea', { name: f.name, rows: f.rows || 4 });
        input.value = f.value ?? '';
      } else if (f.type === 'checkbox') {
        input = h('input', { type: 'checkbox', name: f.name, checked: !!f.value });
      } else {
        input = h('input', { type: f.type || 'text', name: f.name, value: f.value ?? '', step: f.step, min: f.min, max: f.max, placeholder: f.placeholder, autocomplete: 'off' });
      }
      inputs[f.name] = input;
      const row = f.type === 'checkbox'
        ? h('label', { class: 'field field-check' }, input, h('span', {}, f.label))
        : h('label', { class: 'field' }, h('span', {}, f.label), input);
      if (f.hint) row.append(h('small', { class: 'hint' }, f.hint));
      form.append(row);
    }
    const cancel = h('button', { type: 'button', class: 'btn' }, cancelText);
    const ok = h('button', { type: 'submit', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, okText);
    form.append(h('div', { class: 'dialog-actions' }, cancelText ? cancel : null, ok));
    const backdrop = h('div', { class: 'backdrop' }, form);
    const done = (val) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => done(null));
    backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) done(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = inputs[f.name];
        if (f.type === 'checkbox') out[f.name] = el.checked;
        else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
        else out[f.name] = el.value;
      }
      done(out);
    });
    host.append(backdrop);
    const first = form.querySelector('input, select, textarea') || ok;
    setTimeout(() => { first.focus(); if (first.select && first.type !== 'checkbox') first.select(); }, 0);
  });
}

export async function confirmDialog(message, { title = 'Are you sure?', okText = 'OK', danger = false } = {}) {
  return (await openDialog({ title, message, okText, danger })) !== null;
}

// --- downloads ----------------------------------------------------------------

export function download(name, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// --- icons (inline SVG, 20x20, currentColor) --------------------------------

const I = (body) => `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const ICON = {
  select: I('<path d="M4 3l11 6-5 1.5L8 16z" fill="currentColor" fill-opacity=".15"/>'),
  pan: I('<path d="M10 2v16M2 10h16M10 2l-2 2M10 2l2 2M10 18l-2-2M10 18l2-2M2 10l2-2M2 10l2 2M18 10l-2-2M18 10l-2 2"/>'),
  line: I('<path d="M3 15c3-8 6 2 9-5s3-4 5-6"/><circle cx="3" cy="15" r="1.4" fill="currentColor"/><circle cx="17" cy="4" r="1.4" fill="currentColor"/>'),
  polygon: I('<path d="M4 6l7-3 6 5-2 8-9 1z" fill="currentColor" fill-opacity=".18"/>'),
  wall: I('<path d="M3 16V8h2V6h2v2h2V6h2v2h2V6h2v2h2v8z"/><path d="M8.5 16v-3a1.5 1.5 0 0 1 3 0v3"/>'),
  poi: I('<path d="M10 18s-5-5.2-5-9a5 5 0 0 1 10 0c0 3.8-5 9-5 9z"/><circle cx="10" cy="9" r="1.8"/>'),
  measure: I('<path d="M2.5 13.5l11-11 4 4-11 11z"/><path d="M6 10l1.5 1.5M8.5 7.5l1.5 1.5M11 5l1.5 1.5"/>'),
  calibrate: I('<circle cx="10" cy="10" r="6"/><path d="M10 1.5v4M10 14.5v4M1.5 10h4M14.5 10h4"/><circle cx="10" cy="10" r="1" fill="currentColor"/>'),
  eye: I('<path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10z"/><circle cx="10" cy="10" r="2.5"/>'),
  eyeOff: I('<path d="M3 3l14 14M8 5a8 8 0 0 1 2-.5C15.5 4.5 18.5 10 18.5 10a15 15 0 0 1-2.4 3M12 15.2a7 7 0 0 1-2 .3C4.5 15.5 1.5 10 1.5 10a15 15 0 0 1 3.1-3.8"/>'),
  lock: I('<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>'),
  unlock: I('<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 5.8-1"/>'),
  undo: I('<path d="M7 5L3 9l4 4"/><path d="M3 9h9a5 5 0 0 1 0 10h-2"/>'),
  redo: I('<path d="M13 5l4 4-4 4"/><path d="M17 9H8a5 5 0 0 0 0 10h2"/>'),
  plus: I('<path d="M10 4v12M4 10h12"/>'),
  trash: I('<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/>'),
  target: I('<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="2"/>'),
  chevron: I('<path d="M7 5l5 5-5 5"/>'),
  panelLeft: I('<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M7.5 3.5v13"/>'),
  panelRight: I('<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M12.5 3.5v13"/>'),
  help: I('<circle cx="10" cy="10" r="8"/><path d="M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4"/><circle cx="10" cy="14.6" r=".6" fill="currentColor"/>'),
  fit: I('<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>'),
  grip: I('<circle cx="7" cy="5" r="1" fill="currentColor"/><circle cx="13" cy="5" r="1" fill="currentColor"/><circle cx="7" cy="10" r="1" fill="currentColor"/><circle cx="13" cy="10" r="1" fill="currentColor"/><circle cx="7" cy="15" r="1" fill="currentColor"/><circle cx="13" cy="15" r="1" fill="currentColor"/>'),
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = ICON[name] || '';
  return span;
}
