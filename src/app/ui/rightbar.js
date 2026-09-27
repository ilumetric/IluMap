// Right sidebar (docked, not floating):
//   top    Points of interest (search, filters, unplaced list, drag to map)
//   ↕      splitter (drag to resize; double-click resets), height kept in prefs
//   bottom tabs: Inspector | Style
// Collapsible with the top-right pill button or "]". Open state, active tab
// and split are UI prefs (localStorage), never part of map.json.

import { store, on, emit, savePrefs } from '../state.js';
import { h } from '../dom.js';
import { icon } from './icons.js';
import { t, onLangChange } from '../i18n/index.js';

const TABS = ['inspector', 'style'];
const DEFAULT_SPLIT = 0.36; // share of the sidebar height given to the POI list
const clampSplit = (v) => Math.max(0.14, Math.min(0.8, Number(v) || DEFAULT_SPLIT));

export function mountRightbar() {
  const app = document.getElementById('app');
  const root = document.getElementById('rightbar');

  const pointsTitle = h('span', { class: 'rb-title' });
  const pointsCount = h('span', { class: 'rb-count' });
  const pointsBody = h('div', { class: 'rb-body', id: 'rb-points-body' });
  const points = h('section', { class: 'rb-points' },
    h('div', { class: 'rb-head' }, icon('points'), pointsTitle, pointsCount),
    pointsBody);

  const split = h('div', { class: 'rb-split', role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0' });

  const tabBtns = new Map();
  const bodies = new Map();
  const tabbar = h('div', { class: 'rb-tabbar', role: 'tablist' });
  for (const id of TABS) {
    const b = h('button', {
      type: 'button', class: 'rb-tab', role: 'tab', id: `rb-tab-${id}`, 'aria-controls': `rb-${id}`,
      onclick: () => setTab(id),
    }, icon(id), h('span', {}));
    tabBtns.set(id, b);
    tabbar.append(b);
    bodies.set(id, h('div', { class: 'rb-body', id: `rb-${id}`, role: 'tabpanel', 'aria-labelledby': `rb-tab-${id}` }));
  }
  const tabs = h('section', { class: 'rb-tabs' }, tabbar, ...bodies.values());
  root.append(points, split, tabs);

  // --- open / close ---------------------------------------------------------------
  const isOpen = () => store.prefs.rightbarOpen !== false;
  function setOpen(open) {
    store.prefs.rightbarOpen = !!open;
    savePrefs();
    app.classList.toggle('rightbar-closed', !open);
    emit('rightbar', { open: !!open });
  }

  // --- tabs ------------------------------------------------------------------------
  function setTab(id) {
    if (!TABS.includes(id)) return;
    store.prefs.rightTab = id;
    savePrefs();
    for (const [k, b] of tabBtns) {
      const on = k === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      bodies.get(k).hidden = !on;
    }
  }
  tabbar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = TABS.indexOf(store.prefs.rightTab || 'inspector');
    const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(n);
    tabBtns.get(n).focus();
    e.preventDefault();
  });

  // --- splitter --------------------------------------------------------------------
  const applySplit = () => root.style.setProperty('--rb-split', String(clampSplit(store.prefs.rightSplit ?? DEFAULT_SPLIT)));
  split.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { split.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
    split.classList.add('dragging');
    const r = root.getBoundingClientRect();
    const move = (ev) => {
      store.prefs.rightSplit = clampSplit((ev.clientY - r.top) / r.height);
      applySplit();
    };
    const up = () => {
      split.classList.remove('dragging');
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
      split.removeEventListener('pointercancel', up);
      savePrefs();
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
    split.addEventListener('pointercancel', up);
  });
  split.addEventListener('dblclick', () => { store.prefs.rightSplit = DEFAULT_SPLIT; applySplit(); savePrefs(); });
  split.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    store.prefs.rightSplit = clampSplit((store.prefs.rightSplit ?? DEFAULT_SPLIT) + (e.key === 'ArrowDown' ? 0.04 : -0.04));
    applySplit();
    savePrefs();
  });

  function relabel() {
    root.setAttribute('aria-label', t('rightbar.aria'));
    pointsTitle.textContent = t('panels.points.title');
    for (const [id, b] of tabBtns) b.querySelector('span:not(.ico)').textContent = t(`panels.${id}.title`);
    split.title = t('rightbar.split');
    split.setAttribute('aria-label', t('rightbar.split'));
  }
  onLangChange(relabel);
  relabel();

  // a new selection shows its properties
  on('selection', () => { if (store.selection.size) setTab('inspector'); });

  applySplit();
  setTab(store.prefs.rightTab || 'inspector');
  setOpen(isOpen());

  return {
    pointsBody,
    inspectorBody: bodies.get('inspector'),
    styleBody: bodies.get('style'),
    setCount: (text) => { pointsCount.textContent = text; },
    setTab,
    isOpen,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen()),
    /** Open the sidebar and show a section: 'points' | 'inspector' | 'style'. */
    show(id) {
      if (!isOpen()) setOpen(true);
      if (TABS.includes(id)) setTab(id);
    },
  };
}
