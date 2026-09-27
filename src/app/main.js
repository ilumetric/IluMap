// IluMap app entry: wires state, canvas, tools, floating chrome, panels,
// the project sidebar and keyboard shortcuts.

import {
  store, on, emit, undo, redo, change, select, clearSelection, setTool, selectedItems, isLayerLocked, isLayerVisible,
} from './state.js';
import { Canvas } from './canvas.js';
import { TOOLS } from './tools/index.js';
import { save, saveAs, placePoi } from './io.js';
import { mountLayers } from './panels/layers.js';
import { mountPoiList } from './panels/poi-list.js';
import { mountInspector } from './panels/inspector.js';
import { mountMapSettings } from './panels/map.js';
import { mountStyle } from './panels/style.js';
import { removeById, zoneOf } from '../core/model.js';
import { $, h, isTyping, openDialog, toast } from './dom.js';
import { icon } from './ui/icons.js';
import { createPanel, clampFloatingPanels } from './ui/floating-panel.js';
import { mountSidebar } from './ui/sidebar.js';
import { mountToolbar, mountViewTools } from './ui/toolbar.js';
import { mountDock } from './ui/dock.js';
import { mountMinimap } from './ui/minimap.js';
import {
  mountTitlePill, mountPanelToggles, mountHistory, mountZoomPill, mountReadout, mountHud,
} from './ui/chrome.js';
import { closeMenu, isMenuOpen } from './ui/menu.js';
import { applyTheme, openSettings } from './settings.js';
import { initSession, openFileCommand, handleDroppedFiles, hasUnpersistedChanges } from './session.js';
import { persistent } from './projects.js';
import { t, plural, onLangChange, applyI18n } from './i18n/index.js';

applyTheme();
applyI18n(document);

const canvas = new Canvas($('#stage'), { getTool: () => TOOLS[store.tool] });

// --- floating panels -------------------------------------------------------------
const inspectorPin = h('button', { type: 'button', class: 'icon-btn fp-pin' });
const pointsCount = h('span', { class: 'fp-count' });
const panels = {
  layers: createPanel({ id: 'layers', titleKey: 'panels.layers.title', icon: 'layers', dock: 'left', width: 272 }),
  points: createPanel({ id: 'points', titleKey: 'panels.points.title', icon: 'points', dock: 'right', width: 300, actions: [pointsCount] }),
  inspector: createPanel({ id: 'inspector', titleKey: 'panels.inspector.title', icon: 'inspector', dock: 'right', width: 300, actions: [inspectorPin] }),
  style: createPanel({ id: 'style', titleKey: 'panels.style.title', icon: 'style', dock: 'right', width: 320 }),
};

mountLayers(panels.layers.body, { canvas });
const poiList = mountPoiList(panels.points.body, { canvas, onCount: (t) => { pointsCount.textContent = t; } });
const mapSettings = h('div', { class: 'map-settings' });
mountMapSettings(mapSettings, { canvas });
mountInspector(panels.inspector.body, { canvas, mapSettings });
mountStyle(panels.style.body);

on('inspector-mode', (mode) => panels.inspector.setTitle(mode === 'map' ? 'panels.inspector.mapTitle' : 'panels.inspector.title'));
on('open-panel', (id) => panels[id]?.open());

function updatePin() {
  const auto = store.prefs.inspectorAuto !== false;
  inspectorPin.replaceChildren(icon(auto ? 'pin' : 'pinOff'));
  inspectorPin.classList.toggle('on', auto);
  inspectorPin.title = auto ? t('panels.inspector.pinOn') : t('panels.inspector.pinOff');
  inspectorPin.setAttribute('aria-pressed', String(auto));
  inspectorPin.setAttribute('aria-label', t('panels.inspector.pinAria'));
}
onLangChange(updatePin);
inspectorPin.addEventListener('click', () => { store.prefs.inspectorAuto = store.prefs.inspectorAuto === false; updatePin(); emit('prefs'); });
updatePin();
on('selection', () => { if (store.selection.size && store.prefs.inspectorAuto !== false) panels.inspector.open(); });

// --- tools -------------------------------------------------------------------------
function activateTool(id) {
  if (!TOOLS[id]) return;
  if (store.tool !== id) {
    TOOLS[store.tool]?.deactivate?.();
    setTool(id);
    TOOLS[id].activate?.();
  }
  canvas.invalidate('tool');
  emit('hud');
}
on('set-tool', activateTool);

function deleteSelection() {
  const items = selectedItems().filter(({ hit }) => !isLayerLocked(hit.kind === 'poi' ? 'pois' : hit.layer));
  if (!items.length) return;
  change((doc) => { for (const { id } of items) removeById(doc, id); });
  toast(plural('toast.deleted', items.length), { timeout: 2500 });
}

const undoCmd = () => { if (!undo()) toast(t('toast.nothingToUndo'), { timeout: 1200 }); };
const redoCmd = () => { if (!redo()) toast(t('toast.nothingToRedo'), { timeout: 1200 }); };

// --- chrome ------------------------------------------------------------------------
const sidebar = mountSidebar({ openSettings });
const titlePill = mountTitlePill();
mountPanelToggles({ panels });
mountHistory({ undoCmd, redoCmd });
mountToolbar({ tools: TOOLS, activateTool, deleteSelection, panels });
mountViewTools({ canvas, showHelp, openSettings });
mountDock();
mountMinimap({ canvas });
mountZoomPill({ canvas });
mountReadout();
const updateHud = mountHud({ tools: TOOLS });

new ResizeObserver(() => clampFloatingPanels()).observe($('#stage'));

// --- drag & drop ---------------------------------------------------------------------
on('poi-drop', ({ id, world, snap }) => {
  if (isLayerLocked('pois')) { toast(t('toast.poiLayerLocked'), { type: 'warn' }); return; }
  placePoi(id, world, snap ? (p) => canvas.snap(p) : null);
  select(id);
  if (!isLayerVisible('pois')) toast(t('toast.poisHidden'), { type: 'warn' });
});
on('files-drop', async ({ files, handles = [] }) => handleDroppedFiles(files, await Promise.all(handles)));
// dropping files outside the stage should not navigate away
window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => { if (!e.target.closest('#stage')) e.preventDefault(); });

// --- keyboard -------------------------------------------------------------------------
const KEY_TOOLS = { v: 'select', h: 'pan', l: 'line', p: 'polygon', w: 'wall', o: 'poi', m: 'measure', k: 'calibrate' };

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

function toggleRightPanels() {
  const anyOpen = panels.points.isOpen() || panels.inspector.isOpen();
  panels.points[anyOpen ? 'close' : 'open']();
  panels.inspector[anyOpen ? 'close' : 'open']();
}

document.addEventListener('keydown', (e) => {
  if ($('#dialogs').children.length) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); return; }
  if (mod && k === 'o') { e.preventDefault(); openFileCommand(); return; }
  if (mod && k === 'b') { e.preventDefault(); sidebar.toggle(); return; }
  if (mod && k === 'k') { e.preventDefault(); sidebar.focusSearch(); return; }
  if (mod && e.key === ',') { e.preventDefault(); openSettings(); return; }
  if (isMenuOpen()) return; // the menu handles its own keys
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
  // keys typed on a focused chrome button (Enter/Space) keep their default meaning
  if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('button, [role="listitem"]')) return;
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
    case '/':
      if (e.shiftKey) showHelp();
      else { panels.points.open(); poiList.focusSearch(); }
      break;
    case '[': panels.layers.toggle(); break;
    case ']': toggleRightPanels(); break;
    case 'F2': titlePill.rename(); break;
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
window.addEventListener('blur', () => { canvas.spaceDown = false; canvas.updateCursor(); closeMenu(); });

window.addEventListener('beforeunload', (e) => {
  // the browser copy is autosaved; warn only when work would really be lost
  const unstored = hasUnpersistedChanges() && store.prefs.autosave === false;
  if (unstored || (!persistent && store.dirty)) { e.preventDefault(); e.returnValue = ''; }
});

function showHelp() {
  // [keys (shortcuts.keys.* when they contain words, else literal), description key]
  const rows = [
    ['V', 'select'],
    [t('shortcuts.keys.pan'), 'pan'],
    [t('shortcuts.keys.wheel'), 'zoom'],
    ['L', 'line'],
    ['P', 'polygon'],
    ['W', 'wall'],
    ['O', 'poi'],
    ['M', 'measure'],
    ['K', 'calibrate'],
    [t('shortcuts.keys.finish'), 'finish'],
    ['C', 'close'],
    ['Backspace', 'removePoint'],
    ['Esc', 'escape'],
    ['Shift', 'shift'],
    [t('shortcuts.keys.altClick'), 'insertVertex'],
    [t('shortcuts.keys.dblVertex'), 'deleteVertex'],
    ['Delete', 'delete'],
    [t('shortcuts.keys.arrows'), 'nudge'],
    ['Ctrl+Z / Ctrl+Y', 'undoRedo'],
    ['Ctrl+S / Ctrl+Shift+S', 'save'],
    ['Ctrl+O', 'open'],
    ['Ctrl+A', 'selectAll'],
    ['Ctrl+B', 'sidebar'],
    ['Ctrl+K', 'searchMaps'],
    ['Ctrl+,', 'settings'],
    ['G', 'grid'],
    ['/', 'searchPois'],
    ['[ / ]', 'panels'],
    ['F2', 'rename'],
  ];
  const table = h('table', { class: 'keys' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, t(`shortcuts.${v}`)))));
  openDialog({ title: t('shortcuts.title'), body: table, okText: t('dialogs.close'), cancelText: '', wide: true });
}

// --- startup ---------------------------------------------------------------------------
on('load', () => {
  // switch to Select after loading a document
  if (store.tool !== 'select') activateTool('select');
});

initSession().catch((e) => {
  console.error(e);
  toast(t('toast.startupFailed', { error: e.message }), { type: 'error', timeout: 0 });
});

// Expose a tiny debugging handle (not an API).
window.ilumap = { store, canvas, emit, panels };
