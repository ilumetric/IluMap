// IluMap app entry: wires state, canvas, tools, floating chrome, panels,
// the project sidebar and keyboard shortcuts.

import {
  store, on, emit, undo, redo, change, select, clearSelection, setTool, selectedItems, isLayerLocked, isLayerVisible,
  isChanging, clearVertices, parseVkey, selectVertices, vkey,
} from './state.js';
import { Canvas } from './canvas.js';
import { TOOLS } from './tools/index.js';
import { selectedPoints, movePoints, updateZones, editableFeatures } from './tools/select.js';
import { save, saveAs, placePoi } from './io.js';
import { mountLayers } from './panels/layers.js';
import { mountPoiList } from './panels/poi-list.js';
import { mountInspector } from './panels/inspector.js';
import { mountMapSettings } from './panels/map.js';
import { mountStyle } from './panels/style.js';
import { mountTerrain } from './panels/terrain.js';
import { removeById, removeVertex, findById, zoneOf } from '../core/model.js';
import { $, h, isTyping, isTextField, shortcutKey, openDialog, toast } from './dom.js';
import { createPanel, clampFloatingPanels } from './ui/floating-panel.js';
import { mountSidebar } from './ui/sidebar.js';
import { mountToolbar } from './ui/toolbar.js';
import { mountRightbar } from './ui/rightbar.js';
import { autoEnhanceSelects } from './ui/select.js';
import { installColorPicker } from './ui/color-picker.js';
import { mountDock } from './ui/dock.js';
import { mountMinimap } from './ui/minimap.js';
import {
  mountTitlePill, mountPanelToggles, mountHistory, mountZoomPill, mountReadout, mountHud, historyLabel,
} from './ui/chrome.js';
import { closeMenu, isMenuOpen } from './ui/menu.js';
import { applyTheme, openSettings } from './settings.js';
import { initSession, openFileCommand, handleDroppedFiles, hasUnpersistedChanges } from './session.js';
import { persistent } from './projects.js';
import { t, plural, applyI18n } from './i18n/index.js';

applyTheme();
applyI18n(document);
autoEnhanceSelects(); // every <select> gets the app's own dropdown (ui/select.js)
installColorPicker(); // every <input type="color"> opens the colour-wheel picker (ui/color-picker.js)

const canvas = new Canvas($('#stage'), { getTool: () => TOOLS[store.tool] });

// --- panels ----------------------------------------------------------------------
// Layers is a floating panel; POIs, Inspector and Style live in the docked right sidebar.
const rightbar = mountRightbar();
const panels = {
  layers: createPanel({ id: 'layers', titleKey: 'panels.layers.title', icon: 'layers', dock: 'left', width: 272 }),
};

mountLayers(panels.layers.body, { canvas });
const poiList = mountPoiList(rightbar.pointsBody, { canvas, onCount: (text) => rightbar.setCount(text) });
const mapSettings = h('div', { class: 'map-settings' });
mountMapSettings(mapSettings, { canvas });
mountInspector(rightbar.inspectorBody, { canvas, mapSettings });
mountStyle(rightbar.styleBody);
// Mesh Terrain calculator: a dropdown under its button in the top pill (chrome.js)
const terrainBody = h('div', { class: 'terrain-drop' });
mountTerrain(terrainBody, { canvas });

on('open-panel', (id) => (panels[id] ? panels[id].open() : rightbar.show(id)));

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
  if (store.vsel.size) { deleteVertices(); return; }
  const items = selectedItems().filter(({ hit }) => !isLayerLocked(hit.kind === 'poi' ? 'pois' : hit.layer));
  if (!items.length) return;
  change((doc) => { for (const { id } of items) removeById(doc, id); });
  toast(plural('toast.deleted', items.length), { timeout: 2500 });
}

/**
 * Edit tool: Delete removes the selected points. A feature whose points are
 * all selected is removed as a whole; selected POIs are removed too.
 */
function deleteVertices() {
  const byFeature = new Map();
  for (const k of store.vsel) {
    const [id, i] = parseVkey(k);
    if (!byFeature.has(id)) byFeature.set(id, []);
    byFeature.get(id).push(i);
  }
  let blocked = null;
  change((doc) => {
    for (const [id, idx] of byFeature) {
      const hit = findById(doc, id);
      if (!hit || hit.kind !== 'feature' || isLayerLocked(hit.layer)) continue;
      if (idx.length >= hit.item.points.length) { removeById(doc, id); continue; }
      for (const i of idx.sort((a, b) => b - a)) {
        if (!removeVertex(hit.item, i)) { blocked = hit.item; break; }
      }
    }
    if (!isLayerLocked('pois')) {
      for (const id of [...store.selection]) if (findById(doc, id)?.kind === 'poi') removeById(doc, id);
    }
  });
  clearVertices();
  if (blocked) toast(t(blocked.kind === 'polygon' ? 'toast.polygonMinPoints' : 'toast.lineMinPoints'), { type: 'warn' });
}

// Undo / redo: a short notice names the step (one notice at a time, so holding Ctrl+Z does not pile them up)
let historyNotice = null;
const notice = (message) => {
  historyNotice?.();
  historyNotice = toast(message, { timeout: 1400 });
};
const undoCmd = () => {
  // a line being drawn: take back its last point first
  if (TOOLS[store.tool]?.onUndo?.(canvas)) { updateHud(); return; }
  if (isChanging()) return; // mid-drag: finish the gesture first
  const label = undo();
  notice(label ? t('history.undone', { action: historyLabel(label) }) : t('toast.nothingToUndo'));
};
const redoCmd = () => {
  if (isChanging()) return;
  const label = redo();
  notice(label ? t('history.redone', { action: historyLabel(label) }) : t('toast.nothingToRedo'));
};

// --- chrome ------------------------------------------------------------------------
const sidebar = mountSidebar({ openSettings });
const titlePill = mountTitlePill();
mountPanelToggles({ panels, terrainBody });
mountHistory({ undoCmd, redoCmd, rightbar });
mountToolbar({ tools: TOOLS, activateTool, deleteSelection, panels });
mountDock();
mountMinimap({ canvas });
mountZoomPill({ canvas, showHelp, openSettings });
mountReadout();
const updateHud = mountHud({ tools: TOOLS });

new ResizeObserver(() => clampFloatingPanels()).observe($('#stage'));
// the canvas keeps its view when the side bars open or close
on('rightbar', () => canvas.invalidate('grid', 'transform'));

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
const KEY_TOOLS = { v: 'select', s: 'scale', h: 'pan', l: 'line', p: 'polygon', w: 'wall', b: 'bridge', o: 'poi', m: 'measure', k: 'calibrate' };

function nudge(dx, dy) {
  // Edit tool: only the selected points (vertices and POIs) move
  if (store.tool === 'select') {
    const pts = selectedPoints();
    if (!pts.length) return false;
    change(() => { movePoints(pts, dx, dy); updateZones(pts); }, { merge: 'nudge' });
    return true;
  }
  const items = selectedItems();
  if (!items.length) return false;
  // repeated arrow presses within a second are one undo step
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
  }, { merge: 'nudge' });
  return true;
}

// A text field with typing that is not committed yet keeps the browser's own Ctrl+Z;
// otherwise (nothing typed, or a checkbox / select / slider) Ctrl+Z / Ctrl+Y undo the map.
let typedField = null;
document.addEventListener('focusin', () => { typedField = null; });
document.addEventListener('input', (e) => { if (isTextField(e.target)) typedField = e.target; });
document.addEventListener('change', () => { typedField = null; });

document.addEventListener('keydown', (e) => {
  if ($('#dialogs').children.length) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = shortcutKey(e); // same on every keyboard layout (Ctrl+Я = Ctrl+Z)
  if (mod && k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); return; }
  if (mod && k === 'o') { e.preventDefault(); openFileCommand(); return; }
  if (mod && k === 'b') { e.preventDefault(); sidebar.toggle(); return; }
  if (mod && k === 'k') { e.preventDefault(); sidebar.focusSearch(); return; }
  if (mod && e.key === ',') { e.preventDefault(); openSettings(); return; }
  if (isMenuOpen()) return; // the menu handles its own keys
  const history = mod && !e.altKey && (k === 'z' || k === 'y');
  if (isTyping(e.target) && !(history && typedField !== e.target)) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redoCmd(); else undoCmd(); return; }
  if (mod && k === 'y') { e.preventDefault(); redoCmd(); return; }
  if (mod && k === 'a') {
    e.preventDefault();
    // Edit tool: all points of the objects being edited; other tools: all objects of the active layer
    if (store.tool === 'select' && editableFeatures().length) {
      selectVertices(editableFeatures().flatMap((f) => f.points.map((_, i) => vkey(f.id, i))));
      return;
    }
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
  switch (e.key.length === 1 ? k : e.key) {
    case 'Escape':
      if (store.tool !== 'select') activateTool('select');
      else if (store.vsel.size) clearVertices(); // points first, then the objects
      else clearSelection();
      break;
    case 'Delete':
    case 'Backspace':
      deleteSelection();
      break;
    case 'g':
      change((d) => { d.view.grid.visible = !(d.view.grid.visible !== false); });
      break;
    case 'f': canvas.fit(); break;
    case 't': emit('toggle-terrain'); break;
    case '+': case '=': canvas.zoomBy(1.4); break;
    case '-': case '_': canvas.zoomBy(1 / 1.4); break;
    case '?': showHelp(); break;
    case '/':
      if (e.shiftKey) showHelp();
      else { rightbar.show('points'); poiList.focusSearch(); }
      break;
    case '[': panels.layers.toggle(); break;
    case ']': rightbar.toggle(); break;
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
    ['S', 'scale'],
    [t('shortcuts.keys.pan'), 'pan'],
    [t('shortcuts.keys.wheel'), 'zoom'],
    ['L', 'line'],
    ['P', 'polygon'],
    ['W', 'wall'],
    ['B', 'bridge'],
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
    ['T', 'terrain'],
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
window.ilumap = { store, canvas, emit, panels, rightbar };
