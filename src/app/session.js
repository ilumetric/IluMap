// Workspace: which local project is open, autosave of the working copy into
// IndexedDB (projects.js), creating / importing / switching / deleting maps,
// and background images kept as blobs so they survive reloads.
//
// The repo's map.json remains the source of truth — a project is a browser
// working copy; Save (Ctrl+S) writes the file.

import * as P from './projects.js';
import { store, on, emit, setDoc, emptyDoc, change, savePrefs } from './state.js';
import { normalize, serialize } from '../core/model.js';
import { LAND_MODES } from '../core/schema.js';
import { PRESETS } from '../core/styles.js';
import { parseMapText, fetchMapText, resolveBackground, attachBackgroundFile, exportJson, JSON_PICKER_TYPES } from './io.js';
import { toast, confirmDialog, openDialog, download, h } from './dom.js';

export const DEMO_URL = 'examples/demo/map.json';
const AUTOSAVE_DELAY = 500;

let cache = []; // project records, most recent first (for the sidebar)
let persistTimer = 0;
let loading = false;
let bgLoading = false;
let unpersisted = false; // working copy changed since the last write to the project store

export const projectList = () => cache;
export const hasUnpersistedChanges = () => unpersisted;

function upsertCache(rec) {
  cache = [rec, ...cache.filter((p) => p.id !== rec.id)].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  emit('projects');
}

async function refreshList() {
  try { cache = await P.list(); } catch (e) { console.error(e); cache = []; }
  emit('projects');
}

// --- autosave ---------------------------------------------------------------------

function recordFromStore(prev) {
  const text = serialize(store.doc);
  const rec = {
    ...prev,
    name: store.doc.meta.name || 'Untitled',
    doc: text,
    savedText: store.savedText,
    fileName: store.file.name || 'map.json',
    baseUrl: store.file.baseUrl || undefined,
    fileHandle: store.file.handle || undefined,
    updatedAt: text !== prev.doc || !prev.updatedAt ? Date.now() : prev.updatedAt,
  };
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return rec;
}

/** Write the open document into its project now. */
export async function persistNow() {
  clearTimeout(persistTimer);
  persistTimer = 0;
  if (!store.project) return;
  const rec = recordFromStore(store.project);
  store.project = rec;
  unpersisted = false;
  try {
    await P.put(rec);
  } catch (e) {
    unpersisted = true;
    toast(`Could not store the browser copy: ${e.message}`, { type: 'error' });
    return;
  }
  upsertCache(rec);
}

function schedulePersist() {
  if (loading || !store.project) return;
  unpersisted = true;
  if (!store.prefs.autosave) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, AUTOSAVE_DELAY);
}

on('doc', (d) => {
  if (d?.live || d?.load) return;
  schedulePersist();
  restoreBackgroundIfNeeded();
});
on('dirty', schedulePersist);
on('file', schedulePersist);

// keep the background image with the project (IndexedDB blob)
on('background-file', async (file) => {
  const p = store.project;
  if (!p) return;
  const key = `bg:${p.id}`;
  try {
    await P.putBlob(key, file);
    if (store.project?.id !== p.id) return;
    store.project = { ...store.project, backgroundBlobKey: key };
    await persistNow();
  } catch (e) {
    toast(`The background image could not be stored in the browser: ${e.message}`, { type: 'warn' });
  }
});

/** After an undo re-adds a removed background, bring the stored image back. */
function restoreBackgroundIfNeeded() {
  if (loading || bgLoading || store.background || !store.doc.view.background?.src || !store.project?.backgroundBlobKey) return;
  loadBackground(store.project);
}

async function loadBackground(rec) {
  bgLoading = true;
  try {
    let blob = null;
    if (rec.backgroundBlobKey && store.doc.view.background?.src) {
      try { blob = await P.getBlob(rec.backgroundBlobKey); } catch { blob = null; }
    }
    if (store.project?.id !== rec.id) return;
    await resolveBackground({ blob, quiet: true });
  } finally {
    bgLoading = false;
  }
}

// --- open / switch ---------------------------------------------------------------------

/** Flush or confirm pending changes before leaving the open project. Returns false to abort. */
async function leaveCurrent() {
  if (!store.project) return true;
  if (unpersisted && !store.prefs.autosave) {
    const ok = await confirmDialog(`“${store.doc.meta.name}” has changes that are not stored (autosave is off). Discard them?`, { title: 'Unsaved changes', okText: 'Discard', danger: true });
    if (!ok) return false;
    unpersisted = false;
    return true;
  }
  if (unpersisted || persistTimer) await persistNow();
  return true;
}

async function openRecord(rec) {
  let doc;
  try { doc = normalize(rec.doc); } catch (e) {
    toast(`Local map “${rec.name}” is damaged (${e.message}); opened an empty map instead.`, { type: 'error', timeout: 8000 });
    doc = emptyDoc({ name: rec.name || 'Untitled' });
  }
  if (store.background?.url?.startsWith('blob:')) URL.revokeObjectURL(store.background.url);
  loading = true;
  store.project = rec;
  try {
    setDoc(doc, { name: rec.fileName || 'map.json', handle: rec.fileHandle || null, baseUrl: rec.baseUrl || null, savedText: rec.savedText ?? rec.doc });
  } finally {
    loading = false;
  }
  unpersisted = false;
  store.prefs.lastProjectId = rec.id;
  savePrefs();
  emit('project');
  await loadBackground(rec);
}

export async function openProject(id) {
  if (store.project?.id === id) return true;
  if (!(await leaveCurrent())) return false;
  const rec = await P.get(id);
  if (!rec) { toast('That map no longer exists.', { type: 'warn' }); await refreshList(); return false; }
  await openRecord(rec);
  return true;
}

/** Store a new project for `doc` and (by default) open it. */
async function createProject(doc, { fileName = 'map.json', handle = null, baseUrl = null, savedText = null, open = true } = {}) {
  if (open && !(await leaveCurrent())) return null;
  const text = serialize(normalize(doc));
  const now = Date.now();
  const rec = { id: P.newId(), name: doc.meta?.name || 'Untitled', createdAt: now, updatedAt: now, doc: text, savedText: savedText ?? text, fileName };
  if (baseUrl) rec.baseUrl = baseUrl;
  if (handle) rec.fileHandle = handle;
  try { await P.put(rec); } catch (e) { toast(`Could not store the map in the browser: ${e.message}`, { type: 'error' }); }
  upsertCache(rec);
  if (open) await openRecord(rec);
  return rec;
}

/** Import map.json text into a new project. */
async function importText(text, { name = 'map.json', handle = null, baseUrl = null, quiet = false } = {}) {
  const doc = parseMapText(text, name);
  if (!doc) return null;
  const canonical = serialize(doc);
  const rec = await createProject(doc, { fileName: name, handle, baseUrl, savedText: canonical });
  if (rec && !quiet && canonical !== text.replace(/\r\n/g, '\n')) {
    toast('File loaded. It will be saved in canonical format (key order, one [x, y] per line).', { timeout: 4500 });
  }
  return rec;
}

/** Replace the open project's document with the file on disk. */
async function reloadFromDisk(handle, text) {
  const doc = parseMapText(text, handle.name);
  if (!doc) return;
  const canonical = serialize(doc);
  loading = true;
  try {
    setDoc(doc, { name: handle.name, handle, baseUrl: null, savedText: canonical });
  } finally {
    loading = false;
  }
  await persistNow();
  toast(`Reloaded ${handle.name} from disk.`, { type: 'ok' });
}

/** A file that is already a project: focus it and reconcile with the disk content. */
async function focusExisting(rec, handle, text) {
  if (!(await openProject(rec.id))) return;
  const canonical = parseMapText(text, handle.name) && serialize(normalize(text));
  if (!canonical || canonical === store.savedText) {
    toast(`“${rec.name}” is already a local map — switched to it.`, { timeout: 2500 });
    return;
  }
  if (!store.dirty) { await reloadFromDisk(handle, text); return; }
  toast(`${handle.name} changed on disk, and the browser copy has unsaved edits.`, {
    type: 'warn', timeout: 12000,
    actions: [{ label: 'Load disk version', onClick: () => reloadFromDisk(handle, text) }],
  });
}

// --- commands (sidebar, shortcuts, drag & drop) ----------------------------------------

/** Sidebar "Open file" / Ctrl+O. */
export async function openFileCommand() {
  if ('showOpenFilePicker' in window) {
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({ types: JSON_PICKER_TYPES, multiple: false });
    } catch (e) {
      if (e.name !== 'AbortError') toast(`Open failed: ${e.message}`, { type: 'error' });
      return;
    }
    const file = await handle.getFile();
    const text = await file.text();
    const existing = await P.findByHandle(handle);
    if (existing) { await focusExisting(existing, handle, text); return; }
    if (await importText(text, { name: file.name, handle })) toast(`Opened ${file.name} — Ctrl+S saves back to it.`);
    return;
  }
  const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (file) await importText(await file.text(), { name: file.name });
  });
  document.body.append(input);
  input.click();
}

/** Files dropped on the canvas: a map.json becomes a project, an image the background. */
export async function handleDroppedFiles(files, handles = []) {
  const idx = files.findIndex((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
  const img = files.find((f) => f.type.startsWith('image/'));
  if (idx >= 0) {
    const file = files[idx];
    const text = await file.text();
    const handle = handles.find((x) => x?.kind === 'file' && x.name === file.name) || null;
    const existing = handle ? await P.findByHandle(handle) : null;
    if (existing) await focusExisting(existing, handle, text);
    else if (await importText(text, { name: file.name, handle })) {
      toast(handle ? `Opened ${file.name} — Ctrl+S saves back to it.` : `Opened ${file.name} as a new local map (Save as… to write it to disk).`, { timeout: 4500 });
    }
  }
  if (img) await attachBackgroundFile(img);
  if (idx < 0 && !img) toast('Drop a map.json or an image (PNG/JPG).', { type: 'warn' });
}

/** Sidebar "New map". */
export async function newMapCommand() {
  const res = await openDialog({
    title: 'New map',
    message: 'Coordinates are world units (UE centimetres by default). Everything can be changed later in the Inspector (nothing selected).',
    fields: [
      { name: 'template', label: 'Start from', type: 'select', value: 'empty', options: [['empty', 'Empty map'], ['demo', 'Demo map (archipelago)']] },
      { name: 'name', label: 'Name', value: 'Untitled' },
      { name: 'width', label: 'Width (world units)', type: 'number', value: 400000, min: 1, step: 'any' },
      { name: 'height', label: 'Height (world units)', type: 'number', value: 400000, min: 1, step: 'any' },
      { name: 'units', label: 'Units', value: 'cm' },
      { name: 'displayUnit', label: 'Display unit', value: 'm' },
      { name: 'displayUnitScale', label: 'Units per display unit', type: 'number', value: 100, min: 0, step: 'any' },
      { name: 'landMode', label: 'Land mode', type: 'select', value: 'islands', options: LAND_MODES },
      { name: 'preset', label: 'Map style', type: 'select', value: store.prefs.newMapPreset || 'graphite', options: Object.keys(PRESETS) },
      { name: 'flipY', label: 'flipY (+y up, engine-like)', type: 'checkbox', value: false },
    ],
    okText: 'Create',
  });
  if (!res) return;
  if (res.template === 'demo') {
    await createFromDemo({ quiet: false });
    return;
  }
  const w = res.width > 0 ? res.width : 400000;
  const hh = res.height > 0 ? res.height : 400000;
  const step = 10 ** Math.floor(Math.log10(Math.max(w, hh) / 20));
  await createProject(emptyDoc({
    name: res.name.trim() || 'Untitled', bounds: { min: [0, 0], max: [w, hh] }, units: res.units || 'cm', displayUnit: res.displayUnit || 'm',
    displayUnitScale: res.displayUnitScale > 0 ? res.displayUnitScale : 100, landMode: res.landMode, preset: res.preset, flipY: !!res.flipY, gridStep: step,
  }));
}

async function createFromDemo({ quiet = true } = {}) {
  try {
    const abs = new URL(DEMO_URL, location.href).href;
    const rec = await importText(await fetchMapText(DEMO_URL), { name: 'map.json', baseUrl: abs, quiet: true });
    if (rec && !quiet) toast('Created a local copy of the demo map.', { type: 'ok' });
    return rec;
  } catch (e) {
    if (!quiet) toast(`Could not load the demo: ${e.message}`, { type: 'error' });
    return createProject(emptyDoc());
  }
}

export async function renameProject(id, name) {
  const nm = String(name || '').trim();
  if (!nm) return;
  if (store.project?.id === id) {
    if (nm !== store.doc.meta.name) change((d) => { d.meta.name = nm; });
    return;
  }
  const rec = await P.get(id);
  if (!rec) return;
  const doc = normalize(rec.doc);
  doc.meta.name = nm;
  const next = { ...rec, name: nm, doc: serialize(doc) }; // a rename keeps the list order
  await P.put(next);
  upsertCache(next);
}

export async function duplicateProject(id) {
  if (store.project?.id === id) await persistNow();
  const rec = await P.get(id);
  if (!rec) return;
  const doc = normalize(rec.doc);
  doc.meta.name = `${doc.meta.name || 'Untitled'} copy`;
  const text = serialize(doc);
  const now = Date.now();
  const copy = { id: P.newId(), name: doc.meta.name, createdAt: now, updatedAt: now, doc: text, savedText: text, fileName: rec.fileName || 'map.json' };
  if (rec.baseUrl) copy.baseUrl = rec.baseUrl;
  if (rec.backgroundBlobKey) {
    try {
      const blob = await P.getBlob(rec.backgroundBlobKey);
      if (blob) { copy.backgroundBlobKey = `bg:${copy.id}`; await P.putBlob(copy.backgroundBlobKey, blob); }
    } catch { /* copy without the image */ }
  }
  await P.put(copy);
  upsertCache(copy);
  toast(`Duplicated as “${copy.name}” (not linked to a file).`, { type: 'ok', actions: [{ label: 'Open', onClick: () => openProject(copy.id) }] });
}

export async function exportProjectJson(id) {
  if (store.project?.id === id) { exportJson(); return; }
  const rec = await P.get(id);
  if (rec) download(rec.fileName || 'map.json', rec.doc, 'application/json');
}

export async function deleteProject(id) {
  const rec = cache.find((p) => p.id === id) || await P.get(id);
  if (!rec) return;
  const ok = await confirmDialog(`Delete “${rec.name}” from this browser? Files on disk are not touched${rec.fileHandle ? '' : ' — and this map is not linked to a file, so export it first if you need it'}.`, { title: 'Delete map', okText: 'Delete', danger: true });
  if (!ok) return;
  const wasCurrent = store.project?.id === id;
  if (wasCurrent) { clearTimeout(persistTimer); persistTimer = 0; unpersisted = false; store.project = null; }
  try { await P.remove(id); } catch (e) { toast(`Delete failed: ${e.message}`, { type: 'error' }); }
  cache = cache.filter((p) => p.id !== id);
  emit('projects');
  if (wasCurrent) {
    if (cache.length) await openRecord(await P.get(cache[0].id) || cache[0]);
    else await createProject(emptyDoc());
  }
  toast(`Deleted “${rec.name}”.`, { timeout: 2500 });
}

export async function clearAllProjects() {
  const ok = await confirmDialog('Delete every map stored in this browser? Files on disk are not touched; maps that are not linked to a file are lost.', { title: 'Clear local maps', okText: 'Delete all', danger: true });
  if (!ok) return false;
  clearTimeout(persistTimer);
  persistTimer = 0;
  unpersisted = false;
  store.project = null;
  try { await P.clearAll(); } catch (e) { toast(`Could not clear: ${e.message}`, { type: 'error' }); }
  cache = [];
  emit('projects');
  await createFromDemo();
  toast('Local maps cleared.', { type: 'ok' });
  return true;
}

// --- startup ------------------------------------------------------------------------------

async function migrateLegacyDraft() {
  const draft = P.readLegacyDraft();
  if (!draft) return;
  try {
    const doc = normalize(draft.text);
    await createProject(doc, { fileName: draft.name || 'map.json', savedText: '', open: false });
    toast('Your unsaved draft from the previous version is now a local map.', { type: 'ok', timeout: 6000 });
  } catch (e) {
    console.warn('[ilumap] could not migrate the old draft', e);
  }
  P.clearLegacyDraft();
}

export async function initSession() {
  if (!(await P.init())) {
    toast('Browser storage is unavailable (private window?) — maps live in memory for this session only. Save to a file to keep your work.', { type: 'warn', timeout: 10000 });
  }
  await migrateLegacyDraft();
  await refreshList();
  const mapUrl = new URLSearchParams(location.search).get('map');
  if (mapUrl) {
    const abs = new URL(mapUrl, location.href).href;
    const existing = cache.find((p) => p.baseUrl === abs && !p.fileHandle);
    if (existing) { await openRecord(existing); return; }
    try {
      if (await importText(await fetchMapText(mapUrl), { name: abs.split('/').pop() || 'map.json', baseUrl: abs })) return;
    } catch (e) {
      toast(`Could not load ${mapUrl}: ${e.message}`, { type: 'error' });
    }
  }
  const last = cache.find((p) => p.id === store.prefs.lastProjectId) || cache[0];
  if (last) await openRecord(last);
  else await createFromDemo();
}

// flush pending autosaves when the tab goes away
window.addEventListener('pagehide', () => { if (persistTimer) persistNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && persistTimer) persistNow(); });
// autosave switched back on: store what accumulated meanwhile
on('prefs', () => { if (store.prefs.autosave && unpersisted) schedulePersist(); });
