// Floating pills around the canvas:
//   top-left     map name (inline rename) + save, unsaved dot, file-link tooltip
//   top-centre   Layers panel toggle, Mesh Terrain dropdown, grid / labels / background toggles, Export menu
//   top-right    undo / redo, right sidebar toggle
//   bottom-right snap + flipY toggles, zoom − / % / +, fit, shortcuts, settings; cursor read-out above
//   bottom-centre (above the dock) tool hint / status HUD

import {
  store, on, emit, change, savePrefs, canUndo, canRedo, layerPrefs, isLayerVisible, undoLabel, redoLabel, historyList, historyJump,
} from '../state.js';
import { openBackgroundPopover } from './toolbar.js';
import { zoneOf, isLand, findById } from '../../core/model.js';
import { h } from '../dom.js';
import { icon } from './icons.js';
import { openMenu, openPopover } from './menu.js';
import { persistent } from '../projects.js';
import { t, plural, onLangChange } from '../i18n/index.js';
import { fmtNum, unitLabel } from '../i18n/format.js';
import {
  save, saveAs, exportJson, exportSvg, exportPng, exportMasks, copyText,
} from '../io.js';

export function mountTitlePill() {
  const root = document.getElementById('title-pill');
  const name = h('button', { type: 'button', class: 'tp-name' });
  const input = h('input', { class: 'tp-input', name: 'map-name', autocomplete: 'off', spellcheck: 'false', hidden: true });
  const dot = h('span', { class: 'tp-dot', 'aria-hidden': 'true' });
  const saveBtn = h('button', { type: 'button', class: 'icon-btn tp-save', onclick: () => save() }, icon('save'), dot);
  root.append(icon('logo'), name, input, saveBtn);

  const startEdit = () => {
    input.value = store.doc.meta.name || t('common.untitled');
    name.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  };
  const endEdit = (commit) => {
    if (input.hidden) return;
    const v = input.value.trim();
    input.hidden = true;
    name.hidden = false;
    if (commit && v && v !== store.doc.meta.name) change((d) => { d.meta.name = v; });
  };
  name.addEventListener('click', startEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') endEdit(true);
    if (e.key === 'Escape') { e.stopPropagation(); endEdit(false); }
  });
  input.addEventListener('blur', () => endEdit(true));

  function update() {
    const n = store.doc.meta.name || t('common.untitled');
    name.textContent = n;
    name.title = t('titlePill.rename');
    input.setAttribute('aria-label', t('titlePill.mapName'));
    const linked = !!store.file.handle;
    dot.classList.toggle('on', store.dirty);
    const file = store.file.name || 'map.json';
    const where = linked
      ? t('titlePill.linked', { file })
      : t('showSaveFilePicker' in window ? 'titlePill.notLinkedPicker' : 'titlePill.notLinkedDownload', { file });
    const copy = persistent ? t('titlePill.browserCopy') : t('titlePill.memoryOnly');
    root.title = `${n}\n${where}\n${store.dirty ? `${t('titlePill.unsaved')}\n` : ''}${copy}`;
    saveBtn.title = `${store.dirty ? t('titlePill.saveUnsaved') : t('titlePill.save')} (Ctrl+S)${linked ? ` → ${store.file.name}` : ''}`;
    saveBtn.setAttribute('aria-label', `${t('titlePill.save')} (Ctrl+S)`);
    root.classList.toggle('linked', linked);
    document.title = `${store.dirty ? '● ' : ''}${n} — IluMap`;
  }
  on('doc', (d) => { if (!d?.live) update(); });
  on('dirty', update);
  on('file', update);
  on('load', update);
  onLangChange(update);
  update();
  return { rename: startEdit };
}

/**
 * Top-centre pill: Layers panel toggle · view toggles (grid, labels,
 * background image) · Export menu with a scope switch (whole map / selection).
 */
export function mountPanelToggles({ panels, terrainBody }) {
  const root = document.getElementById('panel-toggles');
  const layersLabel = h('span', {});
  const layers = h('button', { type: 'button', class: 'pill-btn', 'aria-pressed': 'false', onclick: () => panels.layers.toggle() }, icon('layers'), layersLabel);
  const terrainLabel = h('span', {});
  const terrain = h('button', { type: 'button', class: 'pill-btn', 'aria-haspopup': 'dialog' }, icon('terrain'), terrainLabel, icon('chevronDown'));
  // Mesh Terrain calculator drops down under its button (same body every time, so it keeps its state)
  const openTerrain = () => openPopover(terrainBody, { anchor: terrain, side: 'bottom', align: 'center', className: 'terrain-pop' });
  terrain.addEventListener('click', openTerrain);
  on('toggle-terrain', openTerrain);

  const grid = h('button', { type: 'button', class: 'icon-btn toggle', onclick: () => change((d) => { d.view.grid.visible = !(d.view.grid.visible !== false); }) }, icon('grid'));
  const labels = h('button', {
    type: 'button', class: 'icon-btn toggle',
    onclick: () => { const p = layerPrefs('labels'); p.visible = !p.visible; savePrefs(); emit('layers'); },
  }, icon('labels'));
  const bg = h('button', { type: 'button', class: 'icon-btn toggle', 'aria-haspopup': 'dialog', onclick: () => openBackgroundPopover(bg) }, icon('image'));

  const expLabel = h('span', {});
  const exp = h('button', { type: 'button', class: 'pill-btn', 'aria-haspopup': 'menu' }, icon('download'), expLabel, icon('chevronDown'));
  const openExport = () => {
    const n = store.selection.size;
    const scope = n && store.prefs.exportScope === 'selection' ? 'selection' : 'all';
    const setScope = (v) => { store.prefs.exportScope = v; savePrefs(); openExport(); };
    openMenu([
      { heading: t('export.scope') },
      { label: t('export.scopeAll'), checked: scope === 'all', onClick: () => setScope('all') },
      {
        label: n ? plural('export.scopeSelection', n) : t('export.scopeSelectionNone'),
        checked: scope === 'selection', disabled: !n, hint: n ? t('export.scopeSelectionHint') : t('export.scopeSelectionNoneHint'),
        onClick: () => setScope('selection'),
      },
      '-',
      { label: t('export.json'), icon: 'fileJson', onClick: () => exportJson(scope) },
      { label: t('export.svg'), icon: 'vector', onClick: () => exportSvg(scope) },
      { label: t('export.png'), icon: 'image', onClick: () => exportPng(scope) },
      { label: t('export.masks'), icon: 'mask', onClick: () => exportMasks(scope) },
      '-',
      { label: t('export.copyMarkdown'), icon: 'clipboard', onClick: () => copyText('markdown', scope) },
      { label: t('export.copyPlain'), icon: 'clipboard', onClick: () => copyText('plain', scope) },
      '-',
      { label: t('export.save'), icon: 'save', kbd: 'Ctrl+S', onClick: () => save() },
      { label: t('export.saveAs'), icon: 'save', kbd: 'Ctrl+Shift+S', onClick: () => saveAs() },
    ], { anchor: exp, align: 'end' });
  };
  exp.addEventListener('click', openExport);
  root.append(layers, terrain, h('span', { class: 'pill-sep' }), grid, labels, bg, h('span', { class: 'pill-sep' }), exp);

  const titled = [[grid, 'toolbar.grid', ''], [labels, 'toolbar.labels', ''], [bg, 'toolbar.background', '']];
  const relabel = () => {
    root.setAttribute('aria-label', t('panels.toggles'));
    const label = t('panels.layers.title');
    layersLabel.textContent = label;
    layers.title = t('panels.toggleKey', { panel: label, key: '[' });
    layers.setAttribute('aria-label', label);
    terrainLabel.textContent = t('terrain.button');
    terrain.title = t('terrain.buttonTitle');
    terrain.setAttribute('aria-label', t('terrain.title'));
    for (const [b, key, kbd] of titled) { b.title = `${t(key)}${kbd}`; b.setAttribute('aria-label', t(key)); }
    expLabel.textContent = t('export.button');
    exp.title = t('export.title');
    exp.setAttribute('aria-label', t('export.button'));
  };
  onLangChange(relabel);
  relabel();

  const update = () => {
    const lo = panels.layers.isOpen();
    layers.classList.toggle('on', lo);
    layers.setAttribute('aria-pressed', String(lo));
    const g = store.doc.view.grid?.visible !== false;
    grid.classList.toggle('on', g);
    grid.setAttribute('aria-pressed', String(g));
    const l = isLayerVisible('labels');
    labels.classList.toggle('on', l);
    labels.setAttribute('aria-pressed', String(l));
    bg.classList.toggle('on', !!store.background?.url);
  };
  on('panels', update);
  on('layers', update);
  on('background', update);
  on('doc', (d) => { if (!d?.live) update(); });
  update();
}

/** Text of a history step label ({ key, name?, count? } from core/history.js). */
export function historyLabel(label) {
  const action = t(`history.action.${label?.key || 'edit'}`);
  if (label?.name) return t('history.named', { action, name: label.name });
  if (label?.count > 1) return t('history.counted', { action, items: plural('count.items', label.count) });
  return action;
}

const HISTORY_MENU_MAX = 60; // steps shown around the current one

function openHistoryMenu(anchor) {
  const { undo: done, redo: next } = historyList();
  const cur = done.length;
  const items = [{ heading: t('history.title') }];
  if (!done.length && !next.length) {
    items.push({ label: t('history.empty'), disabled: true });
    openMenu(items, { anchor, align: 'end', className: 'history-menu' });
    return;
  }
  // states: 0 = as opened, i = after step i; the current one is checked, future ones dimmed
  const all = [...done, ...next];
  const from = Math.max(0, Math.min(cur - Math.floor(HISTORY_MENU_MAX / 2), all.length - HISTORY_MENU_MAX));
  const to = Math.min(all.length, from + HISTORY_MENU_MAX);
  if (from === 0) items.push({ label: t('history.original'), checked: cur === 0, onClick: () => historyJump(-cur) });
  else items.push({ label: t('history.earlier', { n: String(from) }), disabled: true });
  for (let i = from; i < to; i++) {
    const state = i + 1;
    items.push({
      label: historyLabel(all[i]),
      checked: state === cur,
      className: state > cur ? 'future' : '',
      onClick: () => historyJump(state - cur),
    });
  }
  if (to < all.length) items.push({ label: t('history.later', { n: String(all.length - to) }), disabled: true });
  items.push('-', { heading: t('history.memoryOnly') });
  openMenu(items, { anchor, align: 'end', className: 'history-menu', minWidth: 240 });
}

export function mountHistory({ undoCmd, redoCmd, rightbar }) {
  const root = document.getElementById('history-pill');
  const u = h('button', { type: 'button', class: 'icon-btn', onclick: undoCmd }, icon('undo'));
  const r = h('button', { type: 'button', class: 'icon-btn', onclick: redoCmd }, icon('redo'));
  const list = h('button', { type: 'button', class: 'icon-btn icon-btn-narrow', 'aria-haspopup': 'menu', onclick: () => openHistoryMenu(list) }, icon('chevronDown'));
  const side = h('button', { type: 'button', class: 'icon-btn toggle', onclick: () => rightbar.toggle() }, icon('panelRight'));
  root.append(u, r, list, h('span', { class: 'pill-sep' }), side);
  const updateSide = () => {
    const open = rightbar.isOpen();
    side.classList.toggle('on', open);
    side.setAttribute('aria-pressed', String(open));
    side.title = `${t(open ? 'rightbar.hide' : 'rightbar.show')} (])`;
    side.setAttribute('aria-label', t('rightbar.toggle'));
  };
  on('rightbar', updateSide);
  onLangChange(updateSide);
  updateSide();
  const update = () => {
    root.setAttribute('aria-label', t('history.aria'));
    const ul = undoLabel();
    const rl = redoLabel();
    u.disabled = !canUndo();
    r.disabled = !canRedo();
    // the step each button would apply, as in desktop editors ("Undo Move “Village”")
    u.title = `${ul ? t('history.undoAction', { action: historyLabel(ul) }) : t('history.undo')} (Ctrl+Z)`;
    r.title = `${rl ? t('history.redoAction', { action: historyLabel(rl) }) : t('history.redo')} (Ctrl+Y / Ctrl+Shift+Z)`;
    u.setAttribute('aria-label', u.title);
    r.setAttribute('aria-label', r.title);
    list.title = t('history.list');
    list.setAttribute('aria-label', t('history.list'));
  };
  onLangChange(update);
  on('history', update);
  on('doc', (d) => { if (!d?.live) update(); });
  on('load', update);
  update();
}

export function mountZoomPill({ canvas, showHelp, openSettings }) {
  const root = document.getElementById('zoom-pill');
  const snap = h('button', { type: 'button', class: 'icon-btn toggle' }, icon('magnet'));
  const flip = h('button', { type: 'button', class: 'icon-btn toggle' }, icon('flipY'));
  const pct = h('button', { type: 'button', class: 'zoom-pct mono', onclick: () => canvas.fit() }, '100%');
  const zoomOut = h('button', { type: 'button', class: 'icon-btn', onclick: () => canvas.zoomBy(1 / 1.4) }, icon('minus'));
  const zoomIn = h('button', { type: 'button', class: 'icon-btn', onclick: () => canvas.zoomBy(1.4) }, icon('plus'));
  const fitBtn = h('button', { type: 'button', class: 'icon-btn', onclick: () => canvas.fit() }, icon('fit'));
  const keys = h('button', { type: 'button', class: 'icon-btn', onclick: () => showHelp() }, icon('keyboard'));
  // Settings (and the language in it) stay reachable while the sidebar is collapsed
  const settings = h('button', { type: 'button', class: 'icon-btn zp-settings', onclick: () => openSettings() }, icon('settings'));
  root.append(snap, flip, h('span', { class: 'pill-sep' }), zoomOut, pct, zoomIn, fitBtn, h('span', { class: 'pill-sep' }), keys, settings);
  const titled = [[zoomOut, 'zoom.out', ' (−)'], [zoomIn, 'zoom.in', ' (+)'], [fitBtn, 'zoom.fit', ' (F)'], [keys, 'toolbar.shortcuts', ''], [settings, 'toolbar.settings', '']];

  snap.addEventListener('click', () => {
    store.prefs.snap = !store.prefs.snap;
    savePrefs();
    update();
  });
  flip.addEventListener('click', () => change((d) => { d.meta.flipY = !d.meta.flipY; }));

  function update() {
    root.setAttribute('aria-label', t('zoom.aria'));
    for (const [b, key, kbd] of titled) {
      b.title = `${t(key)}${kbd}`;
      b.setAttribute('aria-label', t(key));
    }
    pct.title = t('zoom.percent');
    const s = !!store.prefs.snap;
    snap.classList.toggle('on', s);
    snap.setAttribute('aria-pressed', String(s));
    snap.setAttribute('aria-label', t('zoom.snap'));
    snap.title = t(s ? 'zoom.snapOn' : 'zoom.snapOff');
    const f = !!store.doc.meta.flipY;
    flip.classList.toggle('on', f);
    flip.setAttribute('aria-pressed', String(f));
    flip.title = t(f ? 'zoom.flipUp' : 'zoom.flipDown');
    flip.setAttribute('aria-label', t('zoom.flip'));
  }
  on('view', () => { pct.textContent = `${canvas.zoomPercent()}%`; });
  on('doc', (d) => { if (!d?.live) update(); });
  onLangChange(update);
  update();
}

export function mountReadout() {
  const coords = document.getElementById('coords');
  const pos = h('span', { class: 'rd-pos' }, '—');
  const where = h('span', { class: 'rd-where' });
  const sel = h('span', { class: 'rd-sel' });
  coords.append(sel, where, pos);
  let raf = 0;
  const draw = () => {
    raf = 0;
    const p = store.cursor;
    const doc = store.doc;
    if (!p) { pos.textContent = '—'; where.textContent = ''; return; }
    const m = doc.meta;
    if (store.prefs.coordUnits === 'display' && m.displayUnitScale > 0) {
      const s = m.displayUnitScale;
      pos.textContent = `x ${fmtNum(p[0] / s, 1)}  y ${fmtNum(p[1] / s, 1)} ${unitLabel(m.displayUnit)}`;
    } else {
      pos.textContent = `x ${fmtNum(p[0])}  y ${fmtNum(p[1])} ${unitLabel(m.units)}`;
    }
    const z = zoneOf(doc, p);
    const zn = z ? (findById(doc, z)?.item.name || z) : null;
    where.textContent = `${isLand(doc, p) ? t('readout.land') : t('readout.water')}${zn ? ` · ${zn}` : ''}`;
  };
  const drawSel = () => {
    const n = store.selection.size;
    sel.textContent = n ? plural('readout.selected', n) : '';
    sel.hidden = !n;
  };
  on('cursor', () => { if (!raf) raf = requestAnimationFrame(draw); });
  on('prefs', draw);
  on('selection', drawSel);
  onLangChange(() => { draw(); drawSel(); });
  sel.hidden = true;
}

// A line of a tool hint that starts with a modifier ("Ctrl+click: …", "Alt: …") lights up while it is held.
const MOD_OF_LINE = /^(Ctrl|Alt|Shift)\b/;

/**
 * The active tool's shortcuts, top right under the history pill (right-aligned),
 * one per line from the tool's hint ("keys: action" / "keys — action" · …).
 */
function mountToolKeys({ tools }) {
  const root = document.getElementById('tool-keys');
  let lines = [];
  const render = () => {
    const tool = tools[store.tool];
    const hint = tool?.hint?.() || '';
    root.replaceChildren();
    lines = [];
    for (const part of hint.split(' · ').map((x) => x.trim()).filter(Boolean)) {
      const m = part.match(/^(.+?)(?::| —) (.+)$/);
      const keys = m ? m[1] : '';
      const row = h('div', { class: 'tk-row' }, h('span', { class: 'tk-text' }, m ? m[2] : part), keys ? h('span', { class: 'tk-keys' }, keys) : null);
      const mod = (keys || part).match(MOD_OF_LINE)?.[1]?.toLowerCase();
      if (mod) row.dataset.mod = mod;
      lines.push(row);
      root.append(row);
    }
    root.hidden = !lines.length;
  };
  const light = (mods = {}) => {
    for (const row of lines) row.classList.toggle('on', !!row.dataset.mod && !!mods[row.dataset.mod]);
  };
  on('tool', render);
  on('layers', render);
  on('new-type', render);
  on('hud', render);
  on('modifiers', light);
  onLangChange(render);
  render();
}

export function mountHud({ tools }) {
  mountToolKeys({ tools });
  const hud = document.getElementById('hud');
  // bottom: the tool's live status only (its shortcuts are listed top right)
  const update = () => {
    const t = tools[store.tool];
    const status = t?.status?.() || '';
    hud.replaceChildren();
    if (!status) { hud.hidden = true; return; }
    hud.hidden = false;
    hud.append(h('div', { class: 'hud-status' }, status));
  };
  on('hud', update);
  on('tool', update);
  on('layers', update);
  on('new-type', update);
  on('selection', update); // the Edit tool names what it edits
  onLangChange(update);
  let raf = 0;
  on('cursor', () => {
    if (store.tool === 'select' || store.tool === 'pan' || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; update(); });
  });
  update();
  return update;
}
