// Local projects: the browser-side working copies of maps, stored in
// IndexedDB (database `ilumap`, stores `projects` and `blobs`).
//
// A project record is
//   { id, name, createdAt, updatedAt, doc: <canonical map.json text>,
//     savedText?, fileName?, baseUrl?, fileHandle?, backgroundBlobKey? }
// `savedText` is the file content last read from / written to disk (so the
// "unsaved" dot survives reloads), `fileHandle` a FileSystemFileHandle
// (structured-cloneable in Chromium) so Save can write back after a reload.
//
// The repo's map.json stays the source of truth: projects are a working copy.
// Without IndexedDB (private mode, disabled storage) everything falls back to
// memory for the session and `persistent` is false.

const DB_NAME = 'ilumap';
const DB_VERSION = 1;
const LEGACY_DRAFT_KEY = 'ilumap.draft.v1';

let dbPromise = null;
let memory = null; // { projects: Map, blobs: Map } when IndexedDB is unavailable

export let persistent = true;

function req(r) {
  return new Promise((ok, fail) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((ok, fail) => {
    let r;
    try { r = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { fail(e); return; }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error || new Error('IndexedDB open failed'));
    r.onblocked = () => fail(new Error('IndexedDB is blocked by another tab'));
  });
  return dbPromise;
}

/** Open the database; returns false (and switches to memory) when unavailable. */
export async function init() {
  if (memory) return false;
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
    const db = await openDb();
    // a trivial read proves the store works (Firefox private mode used to fail here)
    await req(db.transaction('projects', 'readonly').objectStore('projects').count());
    persistent = true;
    return true;
  } catch (e) {
    console.warn('[ilumap] IndexedDB unavailable, projects are kept in memory only', e);
    memory = { projects: new Map(), blobs: new Map() };
    persistent = false;
    return false;
  }
}

async function tx(store, mode, fn) {
  const db = await openDb();
  const t = db.transaction(store, mode);
  const done = new Promise((ok, fail) => {
    t.oncomplete = ok;
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error || new Error('transaction aborted'));
  });
  done.catch(() => {}); // reported through Promise.all below; avoid a second unhandled rejection
  const [result] = await Promise.all([fn(t.objectStore(store)), done]);
  return result;
}

export function newId() {
  const rnd = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
  return `p_${rnd.replace(/-/g, '').slice(0, 16)}`;
}

/** All projects, most recently updated first. */
export async function list() {
  const all = memory ? [...memory.projects.values()] : await tx('projects', 'readonly', (s) => req(s.getAll()));
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function get(id) {
  if (memory) return memory.projects.get(id) || null;
  return (await tx('projects', 'readonly', (s) => req(s.get(id)))) || null;
}

/** Insert or replace a project record. Retries without the file handle if it cannot be cloned. */
export async function put(rec) {
  if (memory) { memory.projects.set(rec.id, { ...rec }); return rec; }
  try {
    await tx('projects', 'readwrite', (s) => req(s.put(rec)));
  } catch (e) {
    if (rec.fileHandle && (e?.name === 'DataCloneError' || /clone/i.test(String(e?.message)))) {
      const { fileHandle, ...rest } = rec;
      await tx('projects', 'readwrite', (s) => req(s.put(rest)));
    } else throw e;
  }
  return rec;
}

export async function remove(id) {
  const rec = await get(id);
  if (memory) memory.projects.delete(id);
  else await tx('projects', 'readwrite', (s) => req(s.delete(id)));
  if (rec?.backgroundBlobKey) await removeBlob(rec.backgroundBlobKey);
}

export async function clearAll() {
  if (memory) { memory.projects.clear(); memory.blobs.clear(); return; }
  await tx('projects', 'readwrite', (s) => req(s.clear()));
  await tx('blobs', 'readwrite', (s) => req(s.clear()));
}

// --- blobs (background images) ----------------------------------------------

export async function putBlob(key, blob) {
  if (memory) { memory.blobs.set(key, blob); return; }
  await tx('blobs', 'readwrite', (s) => req(s.put(blob, key)));
}

export async function getBlob(key) {
  if (memory) return memory.blobs.get(key) || null;
  return (await tx('blobs', 'readonly', (s) => req(s.get(key)))) || null;
}

export async function removeBlob(key) {
  if (memory) { memory.blobs.delete(key); return; }
  await tx('blobs', 'readwrite', (s) => req(s.delete(key)));
}

// --- file handles ---------------------------------------------------------------

/** The project whose stored file handle points at the same file, if any. */
export async function findByHandle(handle) {
  if (!handle?.isSameEntry) return null;
  for (const rec of await list()) {
    if (!rec.fileHandle?.isSameEntry) continue;
    try { if (await rec.fileHandle.isSameEntry(handle)) return rec; } catch { /* stale handle */ }
  }
  return null;
}

// --- legacy localStorage draft (before projects existed) ----------------------

export function readLegacyDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(LEGACY_DRAFT_KEY) || 'null');
    return d && typeof d.text === 'string' ? d : null;
  } catch { return null; }
}

export function clearLegacyDraft() {
  try { localStorage.removeItem(LEGACY_DRAFT_KEY); } catch { /* ignore */ }
}
