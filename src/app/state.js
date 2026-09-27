// Single in-memory document + selection + tool state, snapshot undo/redo,
// dirty flag, localStorage draft autosave and UI prefs.

import { createEmptyMap, normalize, serialize, findById } from '../core/model.js';
import { LAYERS, LAYER_KIND } from '../core/schema.js';

const DRAFT_KEY = 'ilumap.draft.v1';
const PREFS_KEY = 'ilumap.prefs.v1';
const MAX_UNDO = 200;

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
    leftOpen: true,
    rightOpen: true,
    rightTab: 'inspector',
    lastPreset: 'blueprint',
    poiType: 'poi',
    lastLineLayer: 'roads',
    lastPolygonLayer: 'land',
    expanded: {},
    poiFilter: { status: '', type: '', zone: '' },
  };
}

function loadPrefs() {
  const p = defaultPrefs();
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      Object.assign(p, raw, { layers: { ...p.layers, ...(raw.layers || {}) } });
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
  background: null, // runtime: { url, width, height, name, missing }
  savedText: '',
  dirty: false,
  cursor: null, // world coords under the mouse
};

let undoStack = [];
let redoStack = [];
let pending = null;
let draftTimer = null;
let prefsTimer = null;

export function savePrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(store.prefs)); } catch { /* ignore */ }
  }, 200);
}

/** Replace the document (open / new / restore). */
export function setDoc(doc, { name, handle = null, baseUrl = null, saved = true } = {}) {
  store.doc = normalize(doc);
  store.selection = new Set();
  store.file = { handle, name: name || store.file.name || 'map.json', baseUrl };
  undoStack = [];
  redoStack = [];
  pending = null;
  const text = serialize(store.doc);
  store.savedText = saved ? text : '';
  store.dirty = !saved;
  store.background = null;
  if (!LAYERS.includes(store.activeLayer)) store.activeLayer = 'land';
  emit('load');
  emit('doc', { load: true });
  emit('selection');
  emit('dirty');
  scheduleDraft();
}

export function newDoc(opts = {}) {
  setDoc(createEmptyMap({ preset: store.prefs.lastPreset || 'blueprint', ...opts }), { name: 'map.json' });
}

/** Start a change: remembers the state before it for undo. Nested calls are merged. */
export function beginChange() {
  if (pending === null) pending = serialize(store.doc);
}

/** Finish a change started with beginChange(). */
export function endChange() {
  if (pending === null) return;
  const before = pending;
  pending = null;
  const now = serialize(store.doc);
  if (now !== before) {
    undoStack.push(before);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }
  afterChange(now);
}

/** Apply a mutation to the document as one undoable step. */
export function change(fn) {
  beginChange();
  try {
    fn(store.doc);
  } finally {
    endChange();
  }
}

/** During drags: re-render without creating an undo step. */
export function liveUpdate() {
  emit('doc', { live: true });
}

function afterChange(text = serialize(store.doc)) {
  pruneSelection();
  const wasDirty = store.dirty;
  store.dirty = text !== store.savedText;
  emit('doc', {});
  if (wasDirty !== store.dirty) emit('dirty');
  scheduleDraft(text);
}

function pruneSelection() {
  let changed = false;
  for (const id of [...store.selection]) {
    const hit = findById(store.doc, id);
    if (!hit || (hit.kind !== 'poi' && hit.kind !== 'feature')) { store.selection.delete(id); changed = true; }
  }
  if (changed) emit('selection');
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(serialize(store.doc));
  store.doc = normalize(undoStack.pop());
  afterChange();
  emit('selection');
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(serialize(store.doc));
  store.doc = normalize(redoStack.pop());
  afterChange();
  emit('selection');
  return true;
}

export function markSaved(text = serialize(store.doc)) {
  store.savedText = text;
  store.dirty = false;
  emit('dirty');
  clearDraft();
}

// --- draft autosave (safety net only) ---------------------------------------

function scheduleDraft(text) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      if (!store.dirty) { localStorage.removeItem(DRAFT_KEY); return; }
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: text || serialize(store.doc), name: store.file.name, time: Date.now() }));
    } catch { /* quota or disabled storage */ }
  }, 800);
}

export function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return d && typeof d.text === 'string' ? d : null;
  } catch { return null; }
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
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
  if (LAYER_KIND[layer] === 'line' && layer !== 'walls') store.prefs.lastLineLayer = layer;
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
