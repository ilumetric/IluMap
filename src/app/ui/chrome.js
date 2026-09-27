// Floating pills around the canvas:
//   top-left     map name (inline rename) + save, unsaved dot, file-link tooltip
//   top-centre   panel toggles (Layers, Points, Inspector, Style) + Export menu
//   top-right    undo / redo
//   bottom-right snap + flipY toggles, zoom − / % / +, fit; cursor read-out above
//   bottom-centre (above the dock) tool hint / status HUD

import { store, on, change, savePrefs, canUndo, canRedo } from '../state.js';
import { zoneOf, isLand, findById } from '../../core/model.js';
import { h } from '../dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { persistent } from '../projects.js';
import {
  save, saveAs, exportJson, exportSvg, exportPng, exportMasks, copyText,
} from '../io.js';

export function mountTitlePill() {
  const root = document.getElementById('title-pill');
  const name = h('button', { type: 'button', class: 'tp-name', title: 'Rename map' });
  const input = h('input', { class: 'tp-input', name: 'map-name', 'aria-label': 'Map name', autocomplete: 'off', spellcheck: 'false', hidden: true });
  const dot = h('span', { class: 'tp-dot', 'aria-hidden': 'true' });
  const saveBtn = h('button', { type: 'button', class: 'icon-btn tp-save', 'aria-label': 'Save (Ctrl+S)', onclick: () => save() }, icon('save'), dot);
  root.append(icon('logo'), name, input, saveBtn);

  const startEdit = () => {
    input.value = store.doc.meta.name || 'Untitled';
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
    const n = store.doc.meta.name || 'Untitled';
    name.textContent = n;
    const linked = !!store.file.handle;
    dot.classList.toggle('on', store.dirty);
    const where = linked
      ? `Linked to ${store.file.name} on disk — Ctrl+S writes back to it`
      : `Not linked to a file — Ctrl+S ${'showSaveFilePicker' in window ? 'asks where to save' : 'downloads'} ${store.file.name || 'map.json'}`;
    const copy = persistent ? 'The browser keeps a working copy; commit map.json to keep it.' : 'Browser storage is unavailable: this map lives in memory only.';
    root.title = `${n}\n${where}\n${store.dirty ? 'Unsaved changes since the last save to the file.\n' : ''}${copy}`;
    saveBtn.title = `${store.dirty ? 'Save — unsaved changes' : 'Save'} (Ctrl+S)${linked ? ` → ${store.file.name}` : ''}`;
    root.classList.toggle('linked', linked);
    document.title = `${store.dirty ? '● ' : ''}${n} — IluMap`;
  }
  on('doc', (d) => { if (!d?.live) update(); });
  on('dirty', update);
  on('file', update);
  on('load', update);
  update();
  return { rename: startEdit };
}

export function mountPanelToggles({ panels }) {
  const root = document.getElementById('panel-toggles');
  const defs = [
    ['layers', 'layers', 'Layers', '['],
    ['points', 'points', 'Points', '/'],
    ['inspector', 'inspector', 'Inspector', ']'],
    ['style', 'style', 'Style', ''],
  ];
  const btns = new Map();
  for (const [id, ico, label, key] of defs) {
    const b = h('button', {
      type: 'button', class: 'pill-btn', 'aria-pressed': 'false', title: `${label} panel${key ? ` (${key})` : ''}`,
      onclick: () => panels[id].toggle(),
    }, icon(ico), h('span', {}, label));
    btns.set(id, b);
    root.append(b);
  }
  root.append(h('span', { class: 'pill-sep' }));
  const exp = h('button', { type: 'button', class: 'pill-btn', 'aria-haspopup': 'menu', title: 'Save and export' }, icon('download'), h('span', {}, 'Export'), icon('chevronDown'));
  exp.addEventListener('click', () => openMenu([
    { label: 'Save', icon: 'save', kbd: 'Ctrl+S', onClick: () => save() },
    { label: 'Save as…', icon: 'save', kbd: 'Ctrl+Shift+S', onClick: () => saveAs() },
    '-',
    { label: 'JSON (map.json)', icon: 'fileJson', onClick: () => exportJson() },
    { label: 'SVG', icon: 'vector', onClick: () => exportSvg() },
    { label: 'PNG…', icon: 'image', onClick: () => exportPng() },
    { label: 'Masks (Gaea / WM / UE)…', icon: 'mask', onClick: () => exportMasks() },
    '-',
    { label: 'Copy as text (markdown)', icon: 'clipboard', onClick: () => copyText('markdown') },
    { label: 'Copy as plain text', icon: 'clipboard', onClick: () => copyText('plain') },
  ], { anchor: exp, align: 'end' }));
  root.append(exp);

  const update = () => {
    for (const [id, b] of btns) {
      const open = panels[id].isOpen();
      b.classList.toggle('on', open);
      b.setAttribute('aria-pressed', String(open));
    }
  };
  on('panels', update);
  update();
}

export function mountHistory({ undoCmd, redoCmd }) {
  const root = document.getElementById('history-pill');
  const u = h('button', { type: 'button', class: 'icon-btn', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: undoCmd }, icon('undo'));
  const r = h('button', { type: 'button', class: 'icon-btn', title: 'Redo (Ctrl+Y / Ctrl+Shift+Z)', 'aria-label': 'Redo', onclick: redoCmd }, icon('redo'));
  root.append(u, r);
  const update = () => { u.disabled = !canUndo(); r.disabled = !canRedo(); };
  on('doc', (d) => { if (!d?.live) update(); });
  on('load', update);
  update();
}

export function mountZoomPill({ canvas }) {
  const root = document.getElementById('zoom-pill');
  const snap = h('button', { type: 'button', class: 'icon-btn toggle', 'aria-label': 'Snap to grid' }, icon('magnet'));
  const flip = h('button', { type: 'button', class: 'icon-btn toggle', 'aria-label': 'flipY' }, icon('flipY'));
  const pct = h('button', { type: 'button', class: 'zoom-pct mono', title: 'Zoom (100% = fit bounds) — click to fit (F)', onclick: () => canvas.fit() }, '100%');
  root.append(
    snap, flip, h('span', { class: 'pill-sep' }),
    h('button', { type: 'button', class: 'icon-btn', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => canvas.zoomBy(1 / 1.4) }, icon('minus')),
    pct,
    h('button', { type: 'button', class: 'icon-btn', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => canvas.zoomBy(1.4) }, icon('plus')),
    h('button', { type: 'button', class: 'icon-btn', title: 'Fit to bounds (F)', 'aria-label': 'Fit to bounds', onclick: () => canvas.fit() }, icon('fit')));

  snap.addEventListener('click', () => {
    store.prefs.snap = !store.prefs.snap;
    savePrefs();
    update();
  });
  flip.addEventListener('click', () => change((d) => { d.meta.flipY = !d.meta.flipY; }));

  function update() {
    const s = !!store.prefs.snap;
    snap.classList.toggle('on', s);
    snap.setAttribute('aria-pressed', String(s));
    snap.title = `Snap to grid: ${s ? 'on' : 'off'} (hold Shift to ${s ? 'disable' : 'enable'} while drawing or dragging)`;
    const f = !!store.doc.meta.flipY;
    flip.classList.toggle('on', f);
    flip.setAttribute('aria-pressed', String(f));
    flip.title = `flipY: ${f ? '+y is up (engine-like)' : '+y is down (image-like)'} — click to switch (stored in map.json meta)`;
  }
  on('view', () => { pct.textContent = `${canvas.zoomPercent()}%`; });
  on('doc', (d) => { if (!d?.live) update(); });
  update();
}

export function mountReadout() {
  const coords = document.getElementById('coords');
  const pos = h('span', { class: 'rd-pos' }, '—');
  const where = h('span', { class: 'rd-where' });
  const sel = h('span', { class: 'rd-sel' });
  coords.append(sel, where, pos);
  let raf = 0;
  const fmt = (v, digits = 0) => v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).replace(/,/g, ' ');
  const draw = () => {
    raf = 0;
    const p = store.cursor;
    const doc = store.doc;
    if (!p) { pos.textContent = '—'; where.textContent = ''; return; }
    const m = doc.meta;
    if (store.prefs.coordUnits === 'display' && m.displayUnitScale > 0) {
      const s = m.displayUnitScale;
      pos.textContent = `x ${fmt(p[0] / s, 1)}  y ${fmt(p[1] / s, 1)} ${m.displayUnit}`;
    } else {
      pos.textContent = `x ${fmt(p[0])}  y ${fmt(p[1])} ${m.units}`;
    }
    const z = zoneOf(doc, p);
    const zn = z ? (findById(doc, z)?.item.name || z) : null;
    where.textContent = `${isLand(doc, p) ? 'land' : 'water'}${zn ? ` · ${zn}` : ''}`;
  };
  on('cursor', () => { if (!raf) raf = requestAnimationFrame(draw); });
  on('prefs', draw);
  on('selection', () => {
    const n = store.selection.size;
    sel.textContent = n ? `${n} selected` : '';
    sel.hidden = !n;
  });
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
  let raf = 0;
  on('cursor', () => {
    if (store.tool === 'select' || store.tool === 'pan' || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; update(); });
  });
  update();
  return update;
}
