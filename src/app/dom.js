// Small DOM helpers: element builder, toasts, dialogs, downloads.
// UI icons live in ui/icons.js.

import { icon } from './ui/icons.js';
import { t } from './i18n/index.js';
import { enhanceSelects } from './ui/select.js';

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
  enhanceSelects(container); // styled dropdowns now, so focus can go back to their buttons
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
  el.append(h('button', { class: 'toast-x', title: t('toast.dismiss'), 'aria-label': t('toast.dismiss'), onclick: close }, icon('x')));
  host.append(el);
  if (timeout > 0) setTimeout(close, timeout);
  return close;
}

// --- dialogs ------------------------------------------------------------------

/**
 * Modal dialog. `body` is placed before the fields, `footer` after them.
 * fields: [{ name, label, type: 'text'|'number'|'select'|'checkbox'|'textarea'|'color', value, options, step, min, max, hint }]
 * Resolves to an object of values, or null when cancelled.
 * onOpen({ form, inputs, close }) runs once the dialog is in the DOM (close(null) cancels it).
 */
export function openDialog({ title, message, body, footer, fields = [], okText = t('dialogs.ok'), cancelText = t('dialogs.cancel'), danger = false, wide = false, onOpen = null }) {
  return new Promise((resolve) => {
    const host = document.getElementById('dialogs');
    const form = h('form', { class: `dialog${wide ? ' dialog-wide' : ''}`, method: 'dialog' });
    form.append(h('div', { class: 'dialog-head' }, h('h2', {}, title || ''),
      h('button', { type: 'button', class: 'icon-btn', title: t('dialogs.close'), 'aria-label': t('dialogs.close'), onclick: () => done(null) }, icon('x'))));
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
    if (footer) form.append(footer);
    const cancel = h('button', { type: 'button', class: 'btn' }, cancelText);
    const ok = h('button', { type: 'submit', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, okText);
    form.append(h('div', { class: 'dialog-actions' }, cancelText ? cancel : null, ok));
    const backdrop = h('div', { class: 'backdrop' }, form);
    const done = (val) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // a dropdown / menu opened from the dialog closes first (ui/menu.js handles that Escape)
      if (document.querySelector('#menus .menu-pop')) return;
      e.preventDefault();
      e.stopPropagation();
      done(null);
    };
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
    onOpen?.({ form, inputs, close: done });
    const first = form.querySelector('input, select, textarea') || ok;
    setTimeout(() => { first.focus(); if (first.select && first.type !== 'checkbox') first.select(); }, 0);
  });
}

export async function confirmDialog(message, { title = t('dialogs.confirmTitle'), okText = t('dialogs.ok'), danger = false } = {}) {
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
