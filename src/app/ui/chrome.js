// Floating pills around the canvas:
//   top-left     map name (inline rename) + save, unsaved dot, file-link tooltip
//   top-centre   Layers panel toggle, grid / labels / background toggles, Export menu
//   top-right    undo / redo, right sidebar toggle
//   bottom-right snap + flipY toggles, zoom − / % / +, fit, shortcuts, settings; cursor read-out above
//   bottom-centre (above the dock) tool hint / status HUD

import { store, on, emit, change, savePrefs, canUndo, canRedo, layerPrefs, isLayerVisible } from '../state.js';
import { openBackgroundPopover } from './toolbar.js';
import { zoneOf, isLand, findById } from '../../core/model.js';
import { h } from '../dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
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
export function mountPanelToggles({ panels }) {
  const root = document.getElementById('panel-toggles');
  const layersLabel = h('span', {});
  const layers = h('button', { type: 'button', class: 'pill-btn', 'aria-pressed': 'false', onclick: () => panels.layers.toggle() }, icon('layers'), layersLabel);

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
  root.append(layers, h('span', { class: 'pill-sep' }), grid, labels, bg, h('span', { class: 'pill-sep' }), exp);

  const titled = [[grid, 'toolbar.grid', ''], [labels, 'toolbar.labels', ''], [bg, 'toolbar.background', '']];
  const relabel = () => {
    root.setAttribute('aria-label', t('panels.toggles'));
    const label = t('panels.layers.title');
    layersLabel.textContent = label;
    layers.title = t('panels.toggleKey', { panel: label, key: '[' });
    layers.setAttribute('aria-label', label);
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

export function mountHistory({ undoCmd, redoCmd, rightbar }) {
  const root = document.getElementById('history-pill');
  const u = h('button', { type: 'button', class: 'icon-btn', onclick: undoCmd }, icon('undo'));
  const r = h('button', { type: 'button', class: 'icon-btn', onclick: redoCmd }, icon('redo'));
  const side = h('button', { type: 'button', class: 'icon-btn toggle', onclick: () => rightbar.toggle() }, icon('panelRight'));
  root.append(u, r, h('span', { class: 'pill-sep' }), side);
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
  const relabel = () => {
    root.setAttribute('aria-label', t('history.aria'));
    u.title = `${t('history.undo')} (Ctrl+Z)`;
    u.setAttribute('aria-label', t('history.undo'));
    r.title = `${t('history.redo')} (Ctrl+Y / Ctrl+Shift+Z)`;
    r.setAttribute('aria-label', t('history.redo'));
  };
  onLangChange(relabel);
  relabel();
  const update = () => { u.disabled = !canUndo(); r.disabled = !canRedo(); };
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

export function mountHud({ tools }) {
  const hud = document.getElementById('hud');
  const update = () => {
    const t = tools[store.tool];
    const status = t?.status?.() || '';
    const hint = store.tool === 'select' ? '' : t?.hint?.() || '';
    hud.replaceChildren();
    if (!hint && !status) { hud.hidden = true; return; }
    hud.hidden = false;
    if (status) hud.append(h('div', { class: 'hud-status' }, status));
    if (hint) hud.append(h('div', { class: 'hud-hint' }, hint));
  };
  on('hud', update);
  on('tool', update);
  on('layers', update);
  on('new-type', update);
  onLangChange(update);
  let raf = 0;
  on('cursor', () => {
    if (store.tool === 'select' || store.tool === 'pan' || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; update(); });
  });
  update();
  return update;
}
