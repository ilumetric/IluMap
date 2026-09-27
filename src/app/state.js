// Single in-memory document + selection + tool state, undo / redo (patches of
// the changed items, see core/history.js; kept in memory only, per project for
// the session), dirty flag (= differs from the file on disk) and UI prefs
// (localStorage).
// Persistence of the working copy lives in session.js / projects.js.

import { createEmptyMap, normalize, serialize, findById } from '../core/model.js';
import { LAYERS, LAYER_KIND } from '../core/schema.js';
import * as H from '../core/history.js';

const PREFS_KEY = 'ilumap.prefs.v1';
const MAX_STASHED = 6; // projects whose history is kept while switching between them

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, detail) {
  for (const fn of listeners.get(evt) || []) {
    try { fn(detail); } catch (e) { console.error(`[ilumap] ${evt} handler failed`, e); }
  }
}

export const PSEUDO_LAYERS = ['pois', 'labels'];

function defaultPrefs() {
  const layers = {};
  for (const l of [...LAYERS, ...PSEUDO_LAYERS]) layers[l] = { visible: true, locked: false };
  return {
    layers,
    // floating panels (only Layers): { open, pos: null | {x, y} } (pos = dragged out of its dock column)
    panels: {
      layers: { open: true, pos: null },
    },
    terrainOverlay: false, // draw Mesh Terrain sections (and quads when zoomed in) on the map
    terrainSquare: true, // keep terrain quads square when editing the resolution
    sidebarOpen: true,
    rightbarOpen: true, // docked right sidebar: POIs on top, Inspector / Style tabs below
    rightTab: 'inspector',
    rightSplit: 0.36, // share of the right sidebar height given to the POI list
    exportScope: 'all', // 'all' | 'selection' (Export menu)
    snap: false, // snap to the grid by default (Shift inverts)
    newMapPreset: 'graphite',
    autosave: true,
    coordUnits: 'world', // 'world' | 'display' (cursor read-out)
    poiType: 'poi',
    newTypes: {}, // layer -> type used for newly drawn features
    lastLineLayer: 'roads',
    lastPolygonLayer: 'land',
    lastProjectId: null,
    expanded: {},
    poiFilter: { status: '', type: '', zone: '' },
  };
}

function loadPrefs() {
  const p = defaultPrefs();
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const panels = { ...p.panels };
      for (const [k, v] of Object.entries(raw.panels || {})) panels[k] = { ...(panels[k] || {}), ...v };
      Object.assign(p, raw, { layers: { ...p.layers, ...(raw.layers || {}) }, panels });
      // prefs of the old docked layout
      for (const k of ['leftOpen', 'rightOpen', 'rightTab', 'lastPreset']) delete p[k];
      delete p.panels.undefined;
    }
  } catch { /* storage unavailable */ }
  return p;
}

export const store = {
  doc: createEmptyMap(),
  selection: new Set(),
  tool: 'select',
  activeLayer: 'land',
  prefs: loadPrefs(),
  file: { handle: null, name: 'map.json', baseUrl: null },
  project: null, // the local project (session.js) holding this document
  background: null, // runtime: { url, width, height, name, missing }
  savedText: '',
  dirty: false,
  cursor: null, // world coords under the mouse
};

let history = H.createHistory(store.doc);
let pending = null; // { selBefore, opts } while a change / gesture is open
let savedRev = 0; // history revision that matches the file on disk (-1: none)
let historyKey = null; // project id owning the current history
const stash = new Map(); // project id → { doc, history, text, savedText, savedRev } (session only)
let prefsTimer = null;

export function savePrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(store.prefs)); } catch { /* ignore */ }
  }, 200);
}

/**
 * Replace the document (open / new / switch project).
 * `savedText` (the file content last written or read) restores the dirty state;
 * otherwise `saved` says whether the document matches its file.
 * `historyKey` (a project id) keeps undo / redo per project for the session:
 * coming back to a project whose content is unchanged restores its history.
 */
export function setDoc(doc, { name, handle = null, baseUrl = null, dir = null, saved = true, savedText = null, historyKey: key = null } = {}) {
  stashHistory();
  const fresh = normalize(doc);
  const text = serialize(fresh);
  store.savedText = savedText != null ? savedText : saved ? text : '';
  const kept = key != null ? stash.get(key) : null;
  if (key != null) stash.delete(key);
  if (kept && kept.text === text) {
    store.doc = kept.doc;
    history = kept.history;
    savedRev = text === store.savedText ? history.rev : kept.savedText === store.savedText ? kept.savedRev : -1;
  } else {
    store.doc = fresh;
    history = H.createHistory(store.doc);
    savedRev = text === store.savedText ? history.rev : -1;
  }
  historyKey = key;
  store.selection = new Set();
  // dir: { handle, mapDir } when the map was opened through "Open folder" (disk.js)
  store.file = { handle, name: name || 'map.json', baseUrl, dir };
  pending = null;
  store.dirty = history.rev !== savedRev;
  store.background = null;
  if (!LAYERS.includes(store.activeLayer)) store.activeLayer = 'land';
  emit('load');
  emit('doc', { load: true });
  emit('selection');
  emit('dirty');
  emit('file');
  emit('history');
}

/** Keep the current project's history for the session (switching projects). */
function stashHistory() {
  if (historyKey == null || (!history.undo.length && !history.redo.length)) return;
  stash.delete(historyKey);
  stash.set(historyKey, { doc: store.doc, history, text: serialize(store.doc), savedText: store.savedText, savedRev });
  while (stash.size > MAX_STASHED) stash.delete(stash.keys().next().value);
}

/** Forget the kept history of a project (deleted). */
export function dropHistory(key) {
  stash.delete(key);
  if (key === historyKey) historyKey = null;
}

/**
 * Replace the content of the open document as one undoable step (e.g. the
 * linked file changed on disk and was reloaded). savedText: the file content.
 */
export function replaceDoc(doc, { savedText = null, label = { key: 'reload' } } = {}) {
  if (pending) endChange();
  const selBefore = [...store.selection];
  store.doc = normalize(doc);
  const step = H.commit(history, store.doc, { label, selBefore, selAfter: selBefore, keepRev: savedRev });
  if (savedText != null) {
    store.savedText = savedText;
    savedRev = serialize(store.doc) === savedText ? history.rev : -1;
  }
  afterChange();
  emit('history');
  return !!step;
}

/** A new empty document using the preset chosen for new maps. */
export function emptyDoc(opts = {}) {
  return createEmptyMap({ preset: store.prefs.newMapPreset || 'graphite', ...opts });
}

/**
 * Start a change: everything until endChange() becomes one undo step.
 * Nested calls are merged. opts: { merge?: string (repeated changes with the
 * same key within a second become one step, e.g. nudges), label?: { key, name?, count? } }
 */
export function beginChange(opts = {}) {
  if (pending === null) pending = { selBefore: [...store.selection], opts: { ...opts } };
  else pending.opts = { ...opts, ...pending.opts };
}

/** Finish a change started with beginChange(). */
export function endChange() {
  if (pending === null) return;
  const { selBefore, opts } = pending;
  pending = null;
  pruneSelection();
  const step = H.commit(history, store.doc, {
    label: opts.label, merge: opts.merge, selBefore, selAfter: [...store.selection], keepRev: savedRev,
  });
  afterChange();
  if (step) emit('history');
}

/** Drop the uncommitted edits of an open change (the document goes back to its last committed state). */
export function abortChange() {
  if (pending === null) return;
  pending = null;
  const { patch } = H.diff(history.index, store.doc);
  if (patch) H.apply(store.doc, history.index, patch, 'b');
  afterChange();
}

/** Apply a mutation to the document as one undoable step (rolled back if it throws). */
export function change(fn, opts) {
  const outer = pending === null;
  beginChange(opts);
  try {
    fn(store.doc);
  } catch (e) {
    if (outer) abortChange();
    throw e;
  }
  if (outer) endChange();
}

/** During drags: re-render without creating an undo step. */
export function liveUpdate() {
  emit('doc', { live: true });
}

/** A change or gesture (drag) is open: undo / redo wait for it. */
export const isChanging = () => pending !== null;

function afterChange() {
  pruneSelection();
  const wasDirty = store.dirty;
  store.dirty = history.rev !== savedRev;
  emit('doc', {});
  if (wasDirty !== store.dirty) emit('dirty');
}

function pruneSelection() {
  let changed = false;
  for (const id of [...store.selection]) {
    const hit = findById(store.doc, id);
    if (!hit || (hit.kind !== 'poi' && hit.kind !== 'feature')) { store.selection.delete(id); changed = true; }
  }
  if (changed) emit('selection');
}

export function canUndo() { return history.undo.length > 0 && pending === null; }
export function canRedo() { return history.redo.length > 0 && pending === null; }

function restoreSelection(ids) {
  store.selection = new Set(ids.filter((id) => {
    const hit = findById(store.doc, id);
    return hit && (hit.kind === 'poi' || hit.kind === 'feature');
  }));
  emit('selection');
}

/** Undo one step. Returns its label ({ key, name?, count? }) or null. */
export function undo() {
  if (pending !== null) return null;
  const step = H.undo(history, store.doc);
  if (!step) return null;
  restoreSelection(step.selBefore);
  afterChange();
  emit('history');
  return H.labelOf(step);
}

/** Redo one step. Returns its label or null. */
export function redo() {
  if (pending !== null) return null;
  const step = H.redo(history, store.doc);
  if (!step) return null;
  restoreSelection(step.selAfter);
  afterChange();
  emit('history');
  return H.labelOf(step);
}

/**
 * The history for menus: { undo: [label…] (oldest first), redo: [label…] (next first) }.
 * Labels: { key, name?, count? } (i18n: history.action.<key>).
 */
export function historyList() {
  return { undo: history.undo.map(H.labelOf), redo: history.redo.slice().reverse().map(H.labelOf) };
}

/** Jump in the history: n > 0 redoes n steps, n < 0 undoes -n steps (one re-render). */
export function historyJump(n) {
  if (pending !== null || !n) return false;
  let last = null;
  for (let i = 0; i < Math.abs(n); i++) {
    const step = n < 0 ? H.undo(history, store.doc) : H.redo(history, store.doc);
    if (!step) break;
    last = { step, back: n < 0 };
  }
  if (!last) return false;
  restoreSelection(last.back ? last.step.selBefore : last.step.selAfter);
  afterChange();
  emit('history');
  return true;
}

/** Label of the step Undo / Redo would apply, or null. */
export const undoLabel = () => (history.undo.length ? H.labelOf(history.undo[history.undo.length - 1]) : null);
export const redoLabel = () => (history.redo.length ? H.labelOf(history.redo[history.redo.length - 1]) : null);

/** Current document revision (pass to markSaved when the text was taken earlier). */
export const revision = () => history.rev;

export function markSaved(text = serialize(store.doc), rev = history.rev) {
  store.savedText = text;
  savedRev = rev;
  store.dirty = history.rev !== savedRev;
  emit('dirty');
}

// --- selection / tools / layers ----------------------------------------------

export function select(ids, { add = false, toggle = false } = {}) {
  const list = Array.isArray(ids) ? ids : ids == null ? [] : [ids];
  if (!add && !toggle) store.selection = new Set();
  for (const id of list) {
    if (toggle && store.selection.has(id)) store.selection.delete(id);
    else store.selection.add(id);
  }
  emit('selection');
}

export function clearSelection() {
  if (!store.selection.size) return;
  store.selection = new Set();
  emit('selection');
}

export function selectedItems() {
  return [...store.selection].map((id) => ({ id, hit: findById(store.doc, id) })).filter((x) => x.hit);
}

export function setTool(id) {
  if (store.tool === id) return;
  store.tool = id;
  emit('tool');
}

export function setActiveLayer(layer) {
  if (!LAYERS.includes(layer)) return;
  store.activeLayer = layer;
  if (LAYER_KIND[layer] === 'line' && layer !== 'walls' && layer !== 'bridges') store.prefs.lastLineLayer = layer;
  if (LAYER_KIND[layer] === 'polygon') store.prefs.lastPolygonLayer = layer;
  savePrefs();
  emit('layers');
}

export function layerPrefs(layer) {
  if (!store.prefs.layers[layer]) store.prefs.layers[layer] = { visible: true, locked: false };
  return store.prefs.layers[layer];
}

export function isLayerVisible(layer) { return layerPrefs(layer).visible !== false; }
export function isLayerLocked(layer) { return layerPrefs(layer).locked === true; }

export function visibleLayers() {
  return [...LAYERS, ...PSEUDO_LAYERS].filter(isLayerVisible);
}
