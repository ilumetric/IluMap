// IluMap app entry: wires state, canvas, tools, panels, menus and shortcuts.

import {
  store, on, emit, setDoc, newDoc, undo, redo, canUndo, canRedo, change, select, clearSelection,
  setTool, readDraft, clearDraft, savePrefs, selectedItems, isLayerLocked, isLayerVisible,
} from './state.js';
import { Canvas } from './canvas.js';
import { TOOLS, TOOL_LIST } from './tools/index.js';
import {
  openFile, save, saveAs, loadUrl, newMap, exportJson, exportSvg, exportPng, exportMasks, copyText,
  handleFiles, placePoi, pickBackgroundImage,
} from './io.js';
import { mountLayers } from './panels/layers.js';
import { mountPoiList } from './panels/poi-list.js';
import { mountInspector } from './panels/inspector.js';
import { mountMapSettings } from './panels/map.js';
import { mountStyle } from './panels/style.js';
import { normalize, removeById, zoneOf, isLand, findById } from '../core/model.js';
import { LAND_MODES } from '../core/schema.js';
import { PRESETS } from '../core/styles.js';
import { $, $$, h, icon, isTyping, openDialog, toast, confirmDialog } from './dom.js';

const DEMO_URL = 'examples/demo/map.json';

const canvas = new Canvas($('#stage'), { getTool: () => TOOLS[store.tool] });

// --- panels -----------------------------------------------------------------
mountLayers($('#layers-panel'), { canvas });
const poiList = mountPoiList($('#poi-panel'), { canvas });
mountInspector($('#tab-inspector'), { canvas });
mountMapSettings($('#tab-map'), { canvas });
mountStyle($('#tab-style'));

function showTab(name) {
  store.prefs.rightTab = name;
  savePrefs();
  for (const b of $$('.tabs [data-tab]')) b.classList.toggle('active', b.dataset.tab === name);
  for (const t of $$('.tab-body')) t.hidden = t.id !== `tab-${name}`;
}
for (const b of $$('.tabs [data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));
on('show-tab', showTab);
showTab(store.prefs.rightTab || 'inspector');
on('selection', () => { if (store.selection.size && store.prefs.rightTab !== 'inspector') showTab('inspector'); });

// --- toolbar ------------------------------------------------------------------
const toolbar = $('#toolbar');
for (const t of TOOL_LIST) {
  if (t.id === 'calibrate') toolbar.append(h('div', { class: 'tb-sep' }));
  const b = h('button', { class: 'tool-btn', 'data-tool': t.id, title: `${t.label} (${t.key}${t.id === 'pan' ? ' / hold Space' : ''})`, onclick: () => activateTool(t.id) },
    icon(t.icon), h('span', { class: 'tool-key' }, t.key));
  toolbar.append(b);
}

function activateTool(id) {
  if (!TOOLS[id]) return;
  if (store.tool !== id) {
    TOOLS[store.tool]?.deactivate?.();
    setTool(id);
    TOOLS[id].activate?.();
  }
  canvas.invalidate('tool');
  updateToolbar();
  updateHud();
}
on('set-tool', activateTool);

function updateToolbar() {
  for (const b of $$('.tool-btn')) b.classList.toggle('active', b.dataset.tool === store.tool);
}

// --- top bar --------------------------------------------------------------------
$('#btn-undo').append(icon('undo'));
$('#btn-redo').append(icon('redo'));
$('#btn-left').append(icon('panelLeft'));
$('#btn-right').append(icon('panelRight'));
$('#btn-help').append(icon('help'));

for (const m of $$('.menu')) {
  const btn = m.querySelector('.menu-btn');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !m.classList.contains('open');
    for (const o of $$('.menu')) o.classList.remove('open');
    m.classList.toggle('open', open);
  });
  btn.addEventListener('mouseenter', () => {
    if ($$('.menu.open').length && !m.classList.contains('open')) {
      for (const o of $$('.menu')) o.classList.remove('open');
      m.classList.add('open');
    }
  });
}
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.menu')) for (const o of $$('.menu')) o.classList.remove('open');
});

async function newMapDialog() {
  const res = await openDialog({
    title: 'New map',
    message: 'Coordinates are world units (UE centimetres by default). You can change everything later in the Map tab.',
    fields: [
      { name: 'name', label: 'Name', value: 'Untitled' },
      { name: 'width', label: 'Width (world units)', type: 'number', value: 400000, min: 1, step: 'any' },
      { name: 'height', label: 'Height (world units)', type: 'number', value: 400000, min: 1, step: 'any' },
      { name: 'units', label: 'Units', value: 'cm' },
      { name: 'displayUnit', label: 'Display unit', value: 'm' },
      { name: 'displayUnitScale', label: 'Units per display unit', type: 'number', value: 100, min: 0, step: 'any' },
      { name: 'landMode', label: 'Land mode', type: 'select', value: 'islands', options: LAND_MODES },
      { name: 'preset', label: 'Style preset', type: 'select', value: store.prefs.lastPreset || 'blueprint', options: Object.keys(PRESETS) },
      { name: 'flipY', label: 'flipY (+y up, engine-like)', type: 'checkbox', value: false },
    ],
    okText: 'Create',
  });
  if (!res) return;
  await newMap(() => {
    const w = res.width > 0 ? res.width : 400000;
    const hh = res.height > 0 ? res.height : 400000;
    const step = 10 ** Math.floor(Math.log10(Math.max(w, hh) / 20));
    newDoc({
      name: res.name || 'Untitled', bounds: { min: [0, 0], max: [w, hh] }, units: res.units || 'cm', displayUnit: res.displayUnit || 'm',
      displayUnitScale: res.displayUnitScale > 0 ? res.displayUnitScale : 100, landMode: res.landMode, preset: res.preset, flipY: !!res.flipY, gridStep: step,
    });
    store.prefs.lastPreset = res.preset;
    savePrefs();
  });
}

async function openDemo() {
  if (store.dirty && !(await confirmDialog('You have unsaved changes. Discard them and open the demo map?', { okText: 'Discard', danger: true }))) return;
  try { await loadUrl(DEMO_URL); } catch (e) { toast(`Could not load the demo: ${e.message}`, { type: 'error' }); }
}

const commands = {
  new: newMapDialog,
  open: openFile,
  'open-demo': openDemo,
  save,
  'save-as': saveAs,
  bg: pickBackgroundImage,
  'export-json': exportJson,
  'export-svg': exportSvg,
  'export-png': exportPng,
  'export-masks': exportMasks,
  'copy-md': () => copyText('markdown'),
  'copy-plain': () => copyText('plain'),
  undo: () => { if (!undo()) toast('Nothing to undo', { timeout: 1200 }); },
  redo: () => { if (!redo()) toast('Nothing to redo', { timeout: 1200 }); },
  'zoom-in': () => canvas.zoomBy(1.4),
  'zoom-out': () => canvas.zoomBy(1 / 1.4),
  fit: () => canvas.fit(),
  'toggle-left': () => togglePanel('left'),
  'toggle-right': () => togglePanel('right'),
  help: showHelp,
};
for (const el of $$('[data-cmd]')) {
  el.addEventListener('click', () => {
    for (const o of $$('.menu')) o.classList.remove('open');
    commands[el.dataset.cmd]?.();
  });
}

function togglePanel(side) {
  const key = side === 'left' ? 'leftOpen' : 'rightOpen';
  store.prefs[key] = !store.prefs[key];
  savePrefs();
  applyPanels();
}
function applyPanels() {
  const app = $('#app');
  app.classList.toggle('no-left', !store.prefs.leftOpen);
  app.classList.toggle('no-right', !store.prefs.rightOpen);
}
applyPanels();

const nameInput = $('#map-name');
nameInput.addEventListener('change', () => change((d) => { d.meta.name = nameInput.value.trim() || 'Untitled'; }));
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') nameInput.blur(); });

function updateTitle() {
  const name = store.doc.meta.name || 'Untitled';
  if (document.activeElement !== nameInput) nameInput.value = name;
  $('#dirty').classList.toggle('on', store.dirty);
  $('#file-name').textContent = `${store.file.name || 'map.json'}${store.file.handle ? '' : store.file.baseUrl ? ' (read-only URL)' : ''}`;
  $('#file-name').title = store.file.handle ? 'Ctrl+S writes back to this file' : 'Not linked to a file on disk: Save downloads or asks where to save';
  document.title = `${store.dirty ? '● ' : ''}${name} — IluMap`;
  $('#btn-undo').disabled = !canUndo();
  $('#btn-redo').disabled = !canRedo();
}
on('doc', (d) => { if (!d?.live) updateTitle(); });
on('dirty', updateTitle);
on('file', updateTitle);
on('load', updateTitle);

on('view', () => { $('#zoom-pct').textContent = `${canvas.zoomPercent()}%`; });

// --- status bar & HUD ---------------------------------------------------------------
let cursorRaf = 0;
on('cursor', () => {
  if (cursorRaf) return;
  cursorRaf = requestAnimationFrame(() => {
    cursorRaf = 0;
    const p = store.cursor;
    const doc = store.doc;
    if (!p) { $('#st-coords').textContent = '—'; $('#st-where').textContent = ''; return; }
    const fmt = (v) => Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');
    $('#st-coords').textContent = `x ${fmt(p[0])}  y ${fmt(p[1])} ${doc.meta.units}`;
    const z = zoneOf(doc, p);
    const zn = z ? (findById(doc, z)?.item.name || z) : null;
    $('#st-where').textContent = `${isLand(doc, p) ? 'land' : 'water'}${zn ? ` · ${zn}` : ''}`;
    if (store.tool !== 'select' && store.tool !== 'pan') updateHud();
  });
});

function updateHud() {
  const t = TOOLS[store.tool];
  const hud = $('#hud');
  const status = t?.status?.() || '';
  const hint = store.tool === 'select' ? '' : t?.hint?.() || '';
  hud.innerHTML = '';
  if (!hint && !status) { hud.hidden = true; return; }
  hud.hidden = false;
  if (status) hud.append(h('div', { class: 'hud-status' }, status));
  if (hint) hud.append(h('div', { class: 'hud-hint' }, hint));
}
on('hud', updateHud);
on('tool', updateHud);
on('layers', () => { updateStatusLayer(); updateHud(); });

function updateStatusLayer() {
  $('#st-layer').textContent = `active layer: ${store.activeLayer}`;
}
on('selection', () => {
  const n = store.selection.size;
  $('#st-sel').textContent = n ? `${n} selected` : '';
});

// --- drag & drop ---------------------------------------------------------------------
on('poi-drop', ({ id, world, shift }) => {
  if (isLayerLocked('pois')) { toast('The POI layer is locked', { type: 'warn' }); return; }
  placePoi(id, world, shift ? (p) => canvas.snap(p) : null);
  select(id);
  if (!isLayerVisible('pois')) toast('POIs are hidden — show the POIs layer to see it.', { type: 'warn' });
});
on('files-drop', ({ files }) => handleFiles(files));
// dropping files outside the canvas should not navigate away
window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => { if (!e.target.closest('#stage')) e.preventDefault(); });

// --- keyboard -------------------------------------------------------------------------
const KEY_TOOLS = { v: 'select', h: 'pan', l: 'line', p: 'polygon', w: 'wall', o: 'poi', m: 'measure', k: 'calibrate' };

function deleteSelection() {
  const items = selectedItems().filter(({ hit }) => !isLayerLocked(hit.kind === 'poi' ? 'pois' : hit.layer));
  if (!items.length) return;
  change((doc) => { for (const { id } of items) removeById(doc, id); });
  toast(`Deleted ${items.length} item(s) — Ctrl+Z to undo`, { timeout: 2500 });
}

function nudge(dx, dy) {
  const items = selectedItems();
  if (!items.length) return false;
  change(() => {
    for (const { hit } of items) {
      if (hit.kind === 'poi' && !isLayerLocked('pois')) {
        hit.item.x += dx; hit.item.y += dy;
        const z = zoneOf(store.doc, [hit.item.x, hit.item.y]);
        if (z) hit.item.zone = z; else delete hit.item.zone;
      } else if (hit.kind === 'feature' && !isLayerLocked(hit.layer)) {
        hit.item.points = hit.item.points.map(([x, y]) => [x + dx, y + dy]);
      }
    }
  });
  return true;
}

document.addEventListener('keydown', (e) => {
  if ($('#dialogs').children.length) return;
  if (e.key === 'Escape' && $$('.menu.open').length) { for (const o of $$('.menu')) o.classList.remove('open'); return; }
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); return; }
  if (mod && k === 'o') { e.preventDefault(); openFile(); return; }
  if (isTyping(e.target)) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a') {
    e.preventDefault();
    const l = store.activeLayer;
    if (!isLayerLocked(l)) select(store.doc.layers[l].filter((f) => !f.hidden).map((f) => f.id));
    return;
  }
  if (mod || e.altKey) return;
  const tool = TOOLS[store.tool];
  if (tool?.onKey?.(e, canvas)) { e.preventDefault(); updateHud(); return; }
  if (e.key === ' ') {
    if (!canvas.spaceDown) { canvas.spaceDown = true; canvas.updateCursor(); }
    e.preventDefault();
    return;
  }
  if (KEY_TOOLS[k] && !e.shiftKey) { activateTool(KEY_TOOLS[k]); e.preventDefault(); return; }
  const step = (store.doc.view.grid?.step || 1000) / (e.shiftKey ? 1 : 10);
  const flip = store.doc.meta.flipY ? -1 : 1;
  switch (e.key) {
    case 'Escape':
      if (store.tool !== 'select') activateTool('select');
      else clearSelection();
      break;
    case 'Delete':
    case 'Backspace':
      deleteSelection();
      break;
    case 'g': case 'G':
      change((d) => { d.view.grid.visible = !(d.view.grid.visible !== false); });
      break;
    case 'f': case 'F': canvas.fit(); break;
    case '+': case '=': canvas.zoomBy(1.4); break;
    case '-': case '_': canvas.zoomBy(1 / 1.4); break;
    case '?': showHelp(); break;
    case '/': if (e.shiftKey) showHelp(); else poiList.focusSearch(); break;
    case '[': togglePanel('left'); break;
    case ']': togglePanel('right'); break;
    case 'ArrowLeft': if (!nudge(-step, 0)) return; break;
    case 'ArrowRight': if (!nudge(step, 0)) return; break;
    case 'ArrowUp': if (!nudge(0, -step * flip)) return; break;
    case 'ArrowDown': if (!nudge(0, step * flip)) return; break;
    default: return;
  }
  e.preventDefault();
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && canvas.spaceDown) { canvas.spaceDown = false; canvas.updateCursor(); }
});
window.addEventListener('blur', () => { canvas.spaceDown = false; canvas.updateCursor(); });

window.addEventListener('beforeunload', (e) => {
  if (store.dirty) { e.preventDefault(); e.returnValue = ''; }
});

function showHelp() {
  const rows = [
    ['V', 'Select / move (Shift+click: add to selection, drag empty space: box select)'],
    ['H / hold Space / middle mouse', 'Pan'],
    ['Wheel', 'Zoom to cursor · F fit · + / − zoom'],
    ['L', 'Line (coast, rivers, roads, rails)'],
    ['P', 'Polygon (land, water, zones)'],
    ['W', 'Wall (towers and gates in the inspector)'],
    ['O', 'POI — click to place; drag POIs from the list onto the map'],
    ['M', 'Measure'],
    ['K', 'Calibrate background image (2 points)'],
    ['Enter / double-click / right-click', 'Finish drawing'],
    ['C', 'Close the path while drawing'],
    ['Backspace', 'Remove the last point while drawing'],
    ['Esc', 'Cancel drawing / back to Select / clear selection'],
    ['Shift', 'Snap to grid while drawing or dragging a POI'],
    ['Alt+click segment', 'Insert a vertex (selected feature)'],
    ['Double-click vertex', 'Delete the vertex'],
    ['Delete', 'Delete the selection'],
    ['Arrows', 'Nudge selection by grid/10 (Shift: one grid step)'],
    ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    ['Ctrl+S / Ctrl+Shift+S', 'Save / save as'],
    ['Ctrl+O', 'Open map.json'],
    ['Ctrl+A', 'Select all features of the active layer'],
    ['G', 'Toggle grid'],
    ['/', 'Search POIs'],
    ['[ / ]', 'Toggle left / right panel'],
  ];
  const table = h('table', { class: 'keys' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v))));
  openDialog({ title: 'Keyboard shortcuts', body: table, okText: 'Close', cancelText: '', wide: true });
}

// --- startup ---------------------------------------------------------------------------
on('load', () => {
  // switch to Select after loading a new document
  if (store.tool !== 'select') activateTool('select');
});

async function start() {
  updateToolbar();
  updateStatusLayer();
  const params = new URLSearchParams(location.search);
  const mapUrl = params.get('map');
  const draft = readDraft();
  if (mapUrl) {
    try { await loadUrl(mapUrl); return; } catch (e) { toast(`Could not load ${mapUrl}: ${e.message}`, { type: 'error' }); }
  }
  if (draft && !mapUrl) {
    try {
      setDoc(normalize(draft.text), { name: draft.name || 'map.json', saved: false });
      const when = new Date(draft.time).toLocaleString();
      toast(`Restored an unsaved draft (${when}). Save it, or discard it.`, {
        timeout: 12000,
        actions: [{
          label: 'Discard draft',
          onClick: async () => { clearDraft(); try { await loadUrl(DEMO_URL, { quiet: true }); } catch { newDoc(); } },
        }],
      });
      return;
    } catch { clearDraft(); }
  }
  try { await loadUrl(DEMO_URL, { quiet: true }); } catch { newDoc(); }
}

start();

// Expose a tiny debugging handle (not an API).
window.ilumap = { store, canvas, emit };
