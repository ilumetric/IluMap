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
import { parseMapText, fetchMapText, resolveBackground, attachBackgroundFile, exportJson, jsonPickerTypes, setBeforeSave } from './io.js';
import { folderSupported, findMaps, findImages, permissionOf, requestPermission, relativePath } from './disk.js';
import { toast, confirmDialog, openDialog, download, h } from './dom.js';
import { t, label } from './i18n/index.js';

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
    dirHandle: store.file.dir?.handle || undefined,
    mapDir: store.file.dir?.mapDir || undefined,
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
    toast(t('toast.storeFailed', { error: e.message }), { type: 'error' });
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
    toast(t('toast.backgroundStoreFailed', { error: e.message }), { type: 'warn' });
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
    const ok = await confirmDialog(t('dialogs.discard.message', { name: store.doc.meta.name }), { title: t('dialogs.discard.title'), okText: t('dialogs.discard.ok'), danger: true });
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
    toast(t('toast.projectDamaged', { name: rec.name, error: e.message }), { type: 'error', timeout: 8000 });
    doc = emptyDoc({ name: rec.name || 'Untitled' });
  }
  if (store.background?.url?.startsWith('blob:')) URL.revokeObjectURL(store.background.url);
  loading = true;
  store.project = rec;
  try {
    setDoc(doc, {
      name: rec.fileName || 'map.json', handle: rec.fileHandle || null, baseUrl: rec.baseUrl || null, savedText: rec.savedText ?? rec.doc,
      dir: rec.dirHandle ? { handle: rec.dirHandle, mapDir: rec.mapDir || [] } : null,
    });
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
  if (!rec) { toast(t('toast.projectGone'), { type: 'warn' }); await refreshList(); return false; }
  await openRecord(rec);
  return true;
}

/** Store a new project for `doc` and (by default) open it. */
async function createProject(doc, { fileName = 'map.json', handle = null, baseUrl = null, dir = null, savedText = null, open = true } = {}) {
  if (open && !(await leaveCurrent())) return null;
  const text = serialize(normalize(doc));
  const now = Date.now();
  const rec = { id: P.newId(), name: doc.meta?.name || 'Untitled', createdAt: now, updatedAt: now, doc: text, savedText: savedText ?? text, fileName };
  if (baseUrl) rec.baseUrl = baseUrl;
  if (handle) rec.fileHandle = handle;
  if (dir) { rec.dirHandle = dir.handle; rec.mapDir = dir.mapDir; }
  try { await P.put(rec); } catch (e) { toast(t('toast.projectStoreFailed', { error: e.message }), { type: 'error' }); }
  upsertCache(rec);
  if (open) await openRecord(rec);
  return rec;
}

/** Import map.json text into a new project. */
async function importText(text, { name = 'map.json', handle = null, baseUrl = null, dir = null, quiet = false } = {}) {
  const doc = parseMapText(text, name);
  if (!doc) return null;
  const canonical = serialize(doc);
  const rec = await createProject(doc, { fileName: name, handle, baseUrl, dir, savedText: canonical });
  if (rec && !quiet && canonical !== text.replace(/\r\n/g, '\n')) {
    toast(t('toast.canonical'), { timeout: 4500 });
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
    setDoc(doc, { name: handle.name, handle, baseUrl: null, dir: store.file.dir || null, savedText: canonical });
  } finally {
    loading = false;
  }
  await persistNow();
  toast(t('toast.reloaded', { file: handle.name }), { type: 'ok' });
}

/** A file that is already a project: focus it and reconcile with the disk content. */
async function focusExisting(rec, handle, text) {
  if (!(await openProject(rec.id))) return;
  const canonical = parseMapText(text, handle.name) && serialize(normalize(text));
  if (!canonical || canonical === store.savedText) {
    toast(t('toast.alreadyLocal', { name: rec.name }), { timeout: 2500 });
    return;
  }
  if (!store.dirty) { await reloadFromDisk(handle, text); return; }
  toast(t('toast.changedOnDisk', { file: handle.name }), {
    type: 'warn', timeout: 12000,
    actions: [{ label: t('toast.loadDiskVersion'), onClick: () => reloadFromDisk(handle, text) }],
  });
}

// --- the linked file changed on disk (an agent edited it, git pull …) ------------------

/** The linked file's text when it differs from what this copy last loaded / saved, else null. Never prompts. */
async function readExternal() {
  const handle = store.file.handle;
  if (!handle) return null;
  if ((await permissionOf(handle)) !== 'granted') return null;
  try {
    const text = await (await handle.getFile()).text();
    let canonical;
    try { canonical = serialize(normalize(text)); } catch { canonical = text; }
    return canonical === store.savedText ? null : { text, canonical, handle };
  } catch { return null; }
}

/** What changed on disk compared with this copy's last known file (text for the dialog), '' when unavailable. */
async function diskChangesText(ext) {
  try {
    const { diffText } = await import('../core/diff.js');
    return diffText(normalize(store.savedText), normalize(ext.text), { format: 'plain' });
  } catch { return ''; }
}

/**
 * Ask what to do with a file that changed on disk. saving: the user pressed Save.
 * Returns true when the caller may write over it.
 */
async function resolveDiskConflict(ext, { saving }) {
  const changes = await diskChangesText(ext);
  const body = changes ? h('div', { class: 'disk-diff' }, h('div', { class: 'muted small' }, t('dialogs.diskChanged.changes')), h('pre', { class: 'disk-diff-pre mono' }, changes)) : null;
  const res = await openDialog({
    title: t('dialogs.diskChanged.title', { file: ext.handle.name }),
    message: t(store.dirty ? 'dialogs.diskChanged.messageDirty' : 'dialogs.diskChanged.message', { file: ext.handle.name }),
    body,
    wide: true,
    okText: t(saving ? 'dialogs.diskChanged.overwrite' : 'dialogs.diskChanged.keepMine'),
    danger: true,
    onOpen: ({ form, close }) => {
      const actions = form.querySelector('.dialog-actions');
      actions.prepend(h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close({ action: 'reload' }) }, t('dialogs.diskChanged.load')));
    },
  });
  if (!res) return false;
  if (res.action === 'reload') { await reloadFromDisk(ext.handle, ext.text); return false; }
  return true; // overwrite (on save) / keep this copy
}

let lastSeenExternal = '';
let checking = false;

/** On returning to the tab: pick up changes made to the linked file by someone else. */
async function checkDiskOnFocus() {
  if (checking || loading || document.visibilityState !== 'visible') return;
  checking = true;
  try {
    const ext = await readExternal();
    if (!ext || ext.canonical === lastSeenExternal) return;
    lastSeenExternal = ext.canonical;
    if (!store.dirty) {
      const before = store.savedText;
      await reloadFromDisk(ext.handle, ext.text);
      toast(t('toast.diskReloaded', { file: ext.handle.name }), {
        timeout: 8000,
        actions: [{
          label: t('toast.showChanges'),
          onClick: async () => {
            try {
              const { diffText } = await import('../core/diff.js');
              const text = diffText(normalize(before), store.doc, { format: 'plain' });
              openDialog({ title: t('dialogs.diskChanged.changesTitle'), body: h('pre', { class: 'disk-diff-pre mono' }, text), okText: t('dialogs.close'), cancelText: '', wide: true });
            } catch { /* diff unavailable */ }
          },
        }],
      });
    } else {
      toast(t('toast.diskChangedDirty', { file: ext.handle.name }), {
        type: 'warn', timeout: 0,
        actions: [{ label: t('toast.resolve'), onClick: () => resolveDiskConflict(ext, { saving: false }) }],
      });
    }
  } finally {
    checking = false;
  }
}

setBeforeSave(async () => {
  const ext = await readExternal();
  return ext ? resolveDiskConflict(ext, { saving: true }) : true;
});
window.addEventListener('focus', () => checkDiskOnFocus());
document.addEventListener('visibilitychange', () => checkDiskOnFocus());

// --- open folder ----------------------------------------------------------------------

/** Sidebar "Open folder": pick a folder, choose a map inside it; relative paths resolve there. */
export async function openFolderCommand() {
  if (!folderSupported()) { toast(t('toast.folderUnsupported'), { type: 'warn', timeout: 7000 }); return; }
  let dir;
  try { dir = await window.showDirectoryPicker({ id: 'ilumap-folder', mode: 'readwrite' }); } catch (e) {
    if (e.name !== 'AbortError') toast(t('toast.folderFailed', { error: e.message }), { type: 'error' });
    return;
  }
  const close = toast(t('toast.scanningFolder', { dir: dir.name }), { timeout: 0 });
  let maps = [];
  try { maps = await findMaps(dir); } finally { close(); }
  if (!maps.length) { toast(t('toast.noMapsInFolder', { dir: dir.name }), { type: 'warn', timeout: 8000 }); return; }
  let pick = maps[0];
  if (maps.length > 1) {
    const res = await openDialog({
      title: t('dialogs.openFolder.title', { dir: dir.name }),
      message: t('dialogs.openFolder.message'),
      fields: [{ name: 'map', label: t('dialogs.openFolder.map'), type: 'select', value: '0', options: maps.map((m, i) => [String(i), [...m.path, m.name].join('/')]) }],
      okText: t('dialogs.openFolder.ok'),
    });
    if (!res) return;
    pick = maps[Number(res.map)];
  }
  const text = await (await pick.handle.getFile()).text();
  const folder = { handle: dir, mapDir: pick.path };
  const existing = await P.findByHandle(pick.handle);
  if (existing) {
    existing.dirHandle = dir;
    existing.mapDir = pick.path;
    try { await P.put(existing); } catch { /* keeps working without */ }
    if (store.project?.id === existing.id) { store.file.dir = folder; await resolveBackground({ quiet: true }); }
    await focusExisting(existing, pick.handle, text);
    return;
  }
  if (await importText(text, { name: pick.name, handle: pick.handle, dir: folder })) {
    toast(t('toast.openedFromFolder', { file: [...pick.path, pick.name].join('/'), dir: dir.name }), { timeout: 5000 });
  }
}

/** Background popover: choose an image from the opened folder (stored as a path relative to the map). */
export async function chooseBackgroundFromFolder() {
  const dir = store.file.dir;
  if (!dir?.handle) return;
  if ((await requestPermission(dir.handle)) !== 'granted') { toast(t('toast.permissionDenied'), { type: 'warn' }); return; }
  const images = await findImages(dir.handle);
  if (!images.length) { toast(t('toast.noImagesInFolder', { dir: dir.handle.name }), { type: 'warn' }); return; }
  const res = await openDialog({
    title: t('dialogs.folderImage.title'),
    fields: [{ name: 'img', label: t('dialogs.folderImage.image'), type: 'select', value: '0', options: images.map((m, i) => [String(i), [...m.path, m.name].join('/')]) }],
    okText: t('dialogs.folderImage.ok'),
  });
  if (!res) return;
  const img = images[Number(res.img)];
  const src = relativePath(dir.mapDir || [], [...img.path, img.name]);
  const file = await img.handle.getFile();
  await attachBackgroundFile(new File([file], img.name, { type: file.type }), { src });
}

/** Grant folder access again after a browser restart (needs a click). */
export async function allowFolderAccess() {
  const dir = store.file.dir;
  if (!dir?.handle) return;
  if ((await requestPermission(dir.handle)) === 'granted') await resolveBackground({ quiet: false });
}

// --- commands (sidebar, shortcuts, drag & drop) ----------------------------------------

/** Sidebar "Open file" / Ctrl+O. */
export async function openFileCommand() {
  if ('showOpenFilePicker' in window) {
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({ types: jsonPickerTypes(), multiple: false });
    } catch (e) {
      if (e.name !== 'AbortError') toast(t('toast.openFailed', { error: e.message }), { type: 'error' });
      return;
    }
    const file = await handle.getFile();
    const text = await file.text();
    const existing = await P.findByHandle(handle);
    if (existing) { await focusExisting(existing, handle, text); return; }
    if (await importText(text, { name: file.name, handle })) toast(t('toast.openedLinked', { file: file.name }));
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
      toast(handle ? t('toast.openedLinked', { file: file.name }) : t('toast.openedCopy', { file: file.name }), { timeout: 4500 });
    }
  }
  if (img) await attachBackgroundFile(img);
  if (idx < 0 && !img) toast(t('toast.dropWhat'), { type: 'warn' });
}

/** Sidebar "New map". */
export async function newMapCommand() {
  const res = await openDialog({
    title: t('dialogs.newMap.title'),
    message: t('dialogs.newMap.message'),
    fields: [
      { name: 'template', label: t('dialogs.newMap.template'), type: 'select', value: 'empty', options: [['empty', t('dialogs.newMap.empty')], ['demo', t('dialogs.newMap.demo')]] },
      { name: 'name', label: t('dialogs.newMap.name'), value: 'Untitled' },
      { name: 'width', label: t('dialogs.newMap.width'), type: 'number', value: 400000, min: 1, step: 'any' },
      { name: 'height', label: t('dialogs.newMap.height'), type: 'number', value: 400000, min: 1, step: 'any' },
      { name: 'units', label: t('dialogs.newMap.units'), value: 'cm' },
      { name: 'displayUnit', label: t('dialogs.newMap.displayUnit'), value: 'm' },
      { name: 'displayUnitScale', label: t('dialogs.newMap.unitsPer'), type: 'number', value: 100, min: 0, step: 'any' },
      { name: 'landMode', label: t('dialogs.newMap.landMode'), type: 'select', value: 'islands', options: LAND_MODES.map((m) => [m, t(`map.landModes.${m}`)]) },
      { name: 'preset', label: t('dialogs.newMap.preset'), type: 'select', value: store.prefs.newMapPreset || 'graphite', options: Object.keys(PRESETS).map((p) => [p, label('presets', p)]) },
      { name: 'flipY', label: t('dialogs.newMap.flipY'), type: 'checkbox', value: false },
    ],
    okText: t('dialogs.newMap.ok'),
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
    if (rec && !quiet) toast(t('toast.demoCopied'), { type: 'ok' });
    return rec;
  } catch (e) {
    if (!quiet) toast(t('toast.demoFailed', { error: e.message }), { type: 'error' });
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
  toast(t('toast.duplicated', { name: copy.name }), { type: 'ok', actions: [{ label: t('toast.open'), onClick: () => openProject(copy.id) }] });
}

export async function exportProjectJson(id) {
  if (store.project?.id === id) { exportJson(); return; }
  const rec = await P.get(id);
  if (rec) download(rec.fileName || 'map.json', rec.doc, 'application/json');
}

export async function deleteProject(id) {
  const rec = cache.find((p) => p.id === id) || await P.get(id);
  if (!rec) return;
  const ok = await confirmDialog(t(rec.fileHandle ? 'dialogs.deleteMap.messageLinked' : 'dialogs.deleteMap.messageUnlinked', { name: rec.name }), { title: t('dialogs.deleteMap.title'), okText: t('dialogs.deleteMap.ok'), danger: true });
  if (!ok) return;
  const wasCurrent = store.project?.id === id;
  if (wasCurrent) { clearTimeout(persistTimer); persistTimer = 0; unpersisted = false; store.project = null; }
  try { await P.remove(id); } catch (e) { toast(t('toast.deleteFailed', { error: e.message }), { type: 'error' }); }
  cache = cache.filter((p) => p.id !== id);
  emit('projects');
  if (wasCurrent) {
    if (cache.length) await openRecord(await P.get(cache[0].id) || cache[0]);
    else await createProject(emptyDoc());
  }
  toast(t('toast.projectDeleted', { name: rec.name }), { timeout: 2500 });
}

export async function clearAllProjects() {
  const ok = await confirmDialog(t('dialogs.clearMaps.message'), { title: t('dialogs.clearMaps.title'), okText: t('dialogs.clearMaps.ok'), danger: true });
  if (!ok) return false;
  clearTimeout(persistTimer);
  persistTimer = 0;
  unpersisted = false;
  store.project = null;
  try { await P.clearAll(); } catch (e) { toast(t('toast.clearFailed', { error: e.message }), { type: 'error' }); }
  cache = [];
  emit('projects');
  await createFromDemo();
  toast(t('toast.cleared'), { type: 'ok' });
  return true;
}

// --- startup ------------------------------------------------------------------------------

async function migrateLegacyDraft() {
  const draft = P.readLegacyDraft();
  if (!draft) return;
  try {
    const doc = normalize(draft.text);
    await createProject(doc, { fileName: draft.name || 'map.json', savedText: '', open: false });
    toast(t('toast.draftMigrated'), { type: 'ok', timeout: 6000 });
  } catch (e) {
    console.warn('[ilumap] could not migrate the old draft', e);
  }
  P.clearLegacyDraft();
}

export async function initSession() {
  if (!(await P.init())) {
    toast(t('toast.noStorage'), { type: 'warn', timeout: 10000 });
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
      toast(t('toast.urlLoadFailed', { url: mapUrl, error: e.message }), { type: 'error' });
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
