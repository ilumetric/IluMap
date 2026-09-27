// Floating panels (Layers, Points, Inspector, Style): cards that live in a
// dock column on the left or right of the canvas, or float freely after being
// dragged by their header (double-click the header to dock it again).
// Open state and positions are UI prefs (localStorage), never part of map.json.

import { store, savePrefs, emit } from '../state.js';
import { h } from '../dom.js';
import { icon } from './icons.js';
import { t, onLangChange } from '../i18n/index.js';

const panels = new Map();
let floatSeq = 10;

function prefsOf(id) {
  store.prefs.panels ||= {};
  store.prefs.panels[id] ||= { open: false, pos: null };
  return store.prefs.panels[id];
}

/**
 * createPanel({ id, titleKey, icon, dock: 'left'|'right', width, actions?: Element[] })
 * -> { id, el, body, setTitle(key), open, close, toggle, isOpen }
 * The title is an i18n key; it is re-applied when the UI language changes.
 */
export function createPanel({ id, titleKey, icon: iconName, dock = 'right', width = 300, actions = [] }) {
  const stage = document.getElementById('stage');
  const column = document.getElementById(dock === 'left' ? 'dock-left' : 'dock-right');
  let key = titleKey;
  const titleEl = h('span', { class: 'fp-title' });
  const closeBtn = h('button', { type: 'button', class: 'icon-btn fp-close' }, icon('x'));
  const head = h('div', { class: 'fp-head' },
    iconName ? icon(iconName) : null, titleEl, h('span', { class: 'fp-actions' }, ...actions), closeBtn);
  const body = h('div', { class: 'fp-body' });
  const el = h('section', { class: 'fpanel chrome', id: `panel-${id}`, style: { width: `${width}px` } }, head, body);
  column.append(el);

  function relabel() {
    const title = t(key);
    titleEl.textContent = title;
    titleEl.title = title;
    el.setAttribute('aria-label', title);
    closeBtn.title = t('panels.close');
    closeBtn.setAttribute('aria-label', t('panels.closeNamed', { panel: title }));
    head.title = t('panels.dragHint');
  }
  onLangChange(relabel);
  relabel();

  const api = {
    id, el, body, head,
    setTitle(k) { key = k; relabel(); },
    isOpen: () => prefsOf(id).open,
    open() { set(true); },
    close() { set(false); },
    toggle() { set(!prefsOf(id).open); },
  };

  function applyPos() {
    const p = prefsOf(id);
    if (p.pos) {
      if (el.parentElement !== document.getElementById('float-layer')) document.getElementById('float-layer').append(el);
      el.classList.add('floating');
      clamp();
    } else {
      if (el.parentElement !== column) column.append(el);
      el.classList.remove('floating');
      el.style.left = '';
      el.style.top = '';
      // keep the declared order inside the column
      const order = [...panels.values()].filter((x) => x.column === column && !prefsOf(x.api.id).pos).map((x) => x.api.el);
      for (const node of order) column.append(node);
    }
  }

  function clamp() {
    const p = prefsOf(id);
    if (!p.pos) return;
    const sr = stage.getBoundingClientRect();
    const w = el.offsetWidth || width;
    const x = Math.max(8, Math.min(sr.width - w - 8, p.pos.x));
    const y = Math.max(8, Math.min(sr.height - 48, p.pos.y));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }

  function set(open) {
    const p = prefsOf(id);
    p.open = !!open;
    el.hidden = !p.open;
    savePrefs();
    applyPos();
    emit('panels', { id, open: p.open });
  }

  closeBtn.addEventListener('click', () => api.close());

  // dragging by the header
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select')) return;
    const start = { x: e.clientX, y: e.clientY };
    let drag = null;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!drag) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
        const r = el.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        drag = { dx: start.x - r.left, dy: start.y - r.top, sr };
        prefsOf(id).pos = { x: r.left - sr.left, y: r.top - sr.top };
        applyPos();
        el.classList.add('dragging');
      }
      prefsOf(id).pos = { x: ev.clientX - drag.sr.left - drag.dx, y: ev.clientY - drag.sr.top - drag.dy };
      el.style.zIndex = String(++floatSeq);
      clamp();
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      if (drag) { el.classList.remove('dragging'); savePrefs(); }
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  head.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, select')) return;
    prefsOf(id).pos = null;
    savePrefs();
    applyPos();
  });
  // a floating panel comes to the front when used
  el.addEventListener('pointerdown', () => { if (el.classList.contains('floating')) el.style.zIndex = String(++floatSeq); });

  panels.set(id, { api, column, clamp });
  const p = prefsOf(id);
  el.hidden = !p.open;
  applyPos();
  return api;
}

/** Keep floating panels inside the stage when it resizes. */
export function clampFloatingPanels() {
  for (const { clamp } of panels.values()) clamp();
}
