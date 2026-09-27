// Save (File System Access API with fallbacks), exports, background image,
// POI placement. Opening / importing maps lives in session.js.

import { store, markSaved, change, emit, visibleLayers, revision } from './state.js';
import { localServer, statServerFile, writeServerFile, serverHandle, serverBaseUrl, isServerHandle } from './localserver.js';
import { normalize, serialize, validate, findById, zoneOf, extractSelection, selectionBounds } from '../core/model.js';
import { renderSvg } from '../core/render-svg.js';
import { toText } from '../core/text-export.js';
import { renderMask, maskFileName, maskSidecar, stringifySidecar, usedMaskSources, zoneTypes } from '../core/render-mask.js';
import { encodePngAsync } from '../core/png.js';
import { fitPairs } from '../core/calibration.js';
import { download, toast, openDialog, confirmDialog, h } from './dom.js';
import { t, label, plural } from './i18n/index.js';
import { layerLabel } from './ui/layer-meta.js';
import { permissionOf, resolvePath, fileAt } from './disk.js';

const jsonTypes = () => [{ description: t('export.pickerDescription'), accept: { 'application/json': ['.json'] } }];
export const jsonPickerTypes = jsonTypes;

function baseName(name) {
  return (name || 'map.json').replace(/\.json$/i, '');
}

/** Parse + normalise + report validation problems. Returns the doc or null. */
export function parseMapText(text, source = 'file') {
  let json;
  try { json = JSON.parse(text); } catch (e) {
    toast(t('toast.invalidJson', { source, error: e.message }), { type: 'error', timeout: 8000 });
    return null;
  }
  let doc;
  try { doc = normalize(json); } catch (e) {
    toast(t('toast.cannotRead', { source, error: e.message }), { type: 'error', timeout: 8000 });
    return null;
  }
  const v = validate(doc);
  if (!v.ok) {
    // the validator's own messages are technical (JSON paths) and stay English, like the CLI
    const first = v.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; ');
    toast(t('toast.validationErrors', { source, errors: plural('count.errors', v.errors.length), first }), { type: 'warn', timeout: 10000 });
  }
  return doc;
}

/** Fetch a map.json over HTTP; returns its text. */
export async function fetchMapText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

let beforeSave = null;
/** session.js registers a check that runs before writing the linked file (changed on disk?). Resolve false to cancel. */
export function setBeforeSave(fn) { beforeSave = fn; }

// Set when writing through the File System Access API failed in this browser (embedded
// browsers may offer the pickers but refuse the write): Save As then goes straight to a download.
let fsWriteBroken = false;

export async function save() {
  if (store.file.handle) {
    try {
      // ask only when the permission is not already there (each request can show a prompt)
      const h = store.file.handle;
      if (h.requestPermission && (await h.queryPermission?.({ mode: 'readwrite' })) !== 'granted') {
        const p = await h.requestPermission({ mode: 'readwrite' });
        if (p !== 'granted') throw new Error(t('toast.permissionDenied'));
      }
      if (beforeSave && !(await beforeSave())) return false;
      const rev = revision();
      const text = serialize(store.doc);
      const w = await store.file.handle.createWritable();
      await w.write(text);
      await w.close();
      markSaved(text, rev); // edits made while writing stay dirty
      emit('file');
      toast(t('toast.saved', { file: store.file.name }), { type: 'ok', timeout: 1800 });
      return true;
    } catch (e) {
      toast(t('toast.saveFailed', { error: e.message }), { type: 'error' });
      return false;
    }
  }
  return saveAs();
}

/** Save As through the local server: a path inside its project folder. */
async function saveToServer(srv, text, rev) {
  const cur = isServerHandle(store.file.handle) ? store.file.handle.serverPath : '';
  const res = await openDialog({
    title: t('dialogs.saveServer.title'),
    message: t('dialogs.saveServer.message', { folder: srv.folder }),
    fields: [{ name: 'path', label: t('dialogs.saveServer.path'), type: 'text', value: cur || store.file.name || 'map.json' }],
    okText: t('dialogs.saveServer.ok'),
  });
  if (!res) return false;
  let p = String(res.path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p) return false;
  if (!/\.json$/i.test(p)) p += '.json';
  try {
    if (p !== cur && (await statServerFile(p))) {
      const ok = await confirmDialog(t('dialogs.saveServer.exists', { path: p }), { title: t('dialogs.saveServer.title'), okText: t('dialogs.saveServer.overwrite'), danger: true });
      if (!ok) return false;
    }
    await writeServerFile(p, text);
  } catch (e) {
    toast(t('toast.saveFailed', { error: e.message }), { type: 'error' });
    return false;
  }
  const handle = serverHandle(p);
  store.file = { ...store.file, handle, name: handle.name, baseUrl: serverBaseUrl(p) };
  markSaved(text, rev);
  emit('file');
  toast(t('toast.saved', { file: p }), { type: 'ok', timeout: 1800 });
  return true;
}

export async function saveAs() {
  const rev = revision();
  const text = serialize(store.doc);
  const v = validate(store.doc);
  if (!v.ok) toast(t('toast.savingWithErrors', { errors: plural('count.errors', v.errors.length), first: `${v.errors[0].path}: ${v.errors[0].message}` }), { type: 'warn', timeout: 7000 });
  // the local server (tools/serve.mjs): a path in the project folder, no system dialogs
  const srv = await localServer();
  if (srv) return saveToServer(srv, text, rev);
  if ('showSaveFilePicker' in window && !fsWriteBroken) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: store.file.name || 'map.json', types: jsonTypes() });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      store.file = { ...store.file, handle, name: handle.name, baseUrl: null };
      markSaved(text, rev);
      emit('file');
      toast(t('toast.saved', { file: handle.name }), { type: 'ok', timeout: 1800 });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      fsWriteBroken = true; // next time: one download dialog, not a picker and then a download
      toast(t('toast.saveFailedDownload', { error: e.message }), { type: 'warn', timeout: 9000 });
    }
  }
  download(store.file.name || 'map.json', text, 'application/json');
  markSaved(text, rev);
  emit('file');
  toast(t('toast.downloaded', { file: store.file.name || 'map.json' }), { timeout: 5000 });
  return true;
}

// --- exports ------------------------------------------------------------------

/**
 * What an export covers. scope 'all' = the whole map; 'selection' = only the
 * selected features / POIs (+ links between them), in the same world
 * coordinates. Returns null (after a toast) when the selection is empty.
 */
function exportScope(scope = 'all') {
  const base = baseName(store.file.name);
  if (scope !== 'selection') return { doc: store.doc, crop: null, base, selection: false };
  const ids = [...store.selection];
  if (!ids.length) { toast(t('toast.exportNothingSelected'), { type: 'warn' }); return null; }
  return { doc: extractSelection(store.doc, ids), crop: selectionBounds(store.doc, ids, { pad: 0.12, minAspect: 0.6 }), base: `${base}-selection`, selection: true };
}

export function exportJson(scope = 'all') {
  const s = exportScope(scope);
  if (!s) return;
  download(s.selection ? `${s.base}.json` : (store.file.name || 'map.json'), serialize(s.doc), 'application/json');
}

function scopedSvg(s, width, grid) {
  // a selection is cropped to its own extent; the whole map uses view.bounds
  return renderSvg(s.doc, { width, layers: visibleLayers(), grid, bounds: s.crop || undefined });
}

export function exportSvg(scope = 'all') {
  const s = exportScope(scope);
  if (!s) return;
  download(`${s.base}.svg`, scopedSvg(s, 2048, store.doc.view.grid?.visible), 'image/svg+xml');
}

export async function exportPng(scope = 'all') {
  const s = exportScope(scope);
  if (!s) return;
  const res = await openDialog({
    title: t(s.selection ? 'dialogs.png.titleSelection' : 'dialogs.png.title'),
    fields: [
      { name: 'width', label: t('dialogs.png.width'), type: 'number', value: 4096, min: 64, max: 16384, step: 1 },
      { name: 'grid', label: t('dialogs.png.grid'), type: 'checkbox', value: false },
    ],
    okText: t('dialogs.png.ok'),
  });
  if (!res) return;
  const width = Math.max(64, Math.min(16384, Math.round(res.width || 4096)));
  const svg = scopedSvg(s, width, res.grid);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error(t('toast.svgRaster'))); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || width;
    canvas.height = img.naturalHeight || Math.round(width);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
    if (!png) throw new Error(t('toast.canvasTooLarge'));
    download(`${s.base}.png`, png);
  } catch (e) {
    toast(t('toast.pngFailed', { error: e.message }), { type: 'error' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pngBlobFromGrey(m) {
  try {
    const bytes = await encodePngAsync({ width: m.width, height: m.height, data: m.data, channels: 1 });
    return new Blob([bytes], { type: 'image/png' });
  } catch {
    // fallback: canvas (RGBA, still greyscale values)
    const c = document.createElement('canvas');
    c.width = m.width; c.height = m.height;
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(m.width, m.height);
    for (let i = 0; i < m.data.length; i++) {
      const v = m.data[i];
      id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return new Promise((ok) => c.toBlob(ok, 'image/png'));
  }
}

export async function exportMasks(scope = 'all', { size = null } = {}) {
  const s = exportScope(scope);
  if (!s) return;
  // a selection keeps the full map bounds so its masks line up with the whole-map heightmap
  const doc = s.doc;
  const featureIds = [];
  for (const l of Object.keys(doc.layers)) for (const f of doc.layers[l] || []) featureIds.push(f.id);
  if (s.selection && !featureIds.length) { toast(t('toast.maskSelectShapes'), { type: 'warn', timeout: 6000 }); return; }
  // only sources that have something to draw (an empty source is an all-black mask)
  const sources = usedMaskSources(doc);
  const options = s.selection
    ? [['all', t('dialogs.masks.sourceSelection')], ...sources.map((x) => [x, maskSourceLabel(x)])]
    : sources.map((x) => [x, maskSourceLabel(x)]);
  const prefKey = s.selection ? 'maskSourceSelection' : 'maskSource';
  const remembered = store.prefs[prefKey];
  const value = options.some(([v]) => v === remembered) ? remembered : options[0][0];
  const res = await openDialog({
    title: t(s.selection ? 'dialogs.masks.titleSelection' : 'dialogs.masks.title'),
    message: t(s.selection ? 'dialogs.masks.messageSelection' : 'dialogs.masks.message'),
    fields: [
      { name: 'source', label: t('dialogs.masks.source'), type: 'select', value, options },
      { name: 'size', label: t('dialogs.masks.size'), type: 'number', value: size || store.prefs.maskSize || 2048, min: 16, max: 16384, step: 1 },
      { name: 'stroke', label: t('dialogs.masks.stroke'), type: 'number', value: '', min: 0, step: 'any' },
      { name: 'invert', label: t('dialogs.masks.invert'), type: 'checkbox', value: false },
      { name: 'split', label: t(s.selection ? 'dialogs.masks.splitItems' : 'dialogs.masks.split'), type: 'checkbox', value: false },
    ],
    okText: t('dialogs.masks.ok'),
  });
  if (!res) return;
  store.prefs[prefKey] = res.source;
  store.prefs.maskSize = res.size;
  let list = [res.source];
  if (res.split && s.selection) list = featureIds.map((id) => `feature:${id}`);
  else if (res.split && res.source === 'zones') list = zoneTypes(doc).map((z) => `zones:${z}`);
  const base = s.selection ? `${s.base}-` : '';
  const files = [];
  const entries = [];
  let last = null;
  const close = toast(t('toast.renderingMasks'), { timeout: 0 });
  try {
    for (const source of list) {
      // strictly black and white: no feathering from the editor (the CLI still has --feather)
      const m = renderMask(doc, { source, size: res.size, invert: res.invert, stroke: res.stroke || undefined });
      last = m;
      const name = `${base}${maskFileName(source === 'all' ? 'selection' : source)}`;
      files.push({ name, blob: await pngBlobFromGrey(m) });
      const entry = { file: name, source, invert: !!res.invert, feather: 0 };
      if (res.stroke) entry.stroke = res.stroke;
      entries.push(entry);
    }
  } catch (e) {
    close();
    toast(t('toast.maskFailed', { error: e.message }), { type: 'error' });
    return;
  }
  close();
  const scale = t('toast.maskScale', { w: String(last.width), h: String(last.height), upp: String(Math.round(last.unitsPerPixel * 100) / 100), units: doc.meta?.units || 'cm' });
  // one mask: a single PNG download (browsers often block a second automatic download)
  if (files.length === 1) {
    download(files[0].name, files[0].blob);
    toast(`${t('toast.exportedMask', { file: files[0].name })} ${scale}`, { type: 'ok', timeout: 6000 });
    return;
  }
  // several masks: write them and masks.json into a folder (Chrome / Edge), else download one by one
  files.push({ name: `${base}masks.json`, blob: new Blob([stringifySidecar(maskSidecar(doc, last, entries))], { type: 'application/json' }) });
  if ('showDirectoryPicker' in window) {
    try {
      const dir = await window.showDirectoryPicker({ id: 'ilumap-masks', mode: 'readwrite' });
      for (const f of files) {
        const fh = await dir.getFileHandle(f.name, { create: true });
        const w = await fh.createWritable();
        await w.write(f.blob);
        await w.close();
      }
      toast(t('toast.wroteFiles', { files: plural('count.files', files.length), dir: dir.name }), { type: 'ok' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  for (const f of files) {
    download(f.name, f.blob);
    await new Promise((r) => setTimeout(r, 350)); // spaced out so the browser does not drop them
  }
  toast(t('toast.exportedMasks', { masks: plural('count.masks', files.length - 1) }), { type: 'ok' });
}

export async function copyText(format = 'markdown', scope = 'all') {
  const s = exportScope(scope);
  if (!s) return;
  const text = toText(s.doc, { format });
  try {
    await navigator.clipboard.writeText(text);
    toast(t(format === 'plain' ? 'toast.copiedPlain' : 'toast.copiedMarkdown', { lines: plural('count.lines', text.split('\n').length) }), { type: 'ok' });
  } catch {
    download(`${s.base}.md`, text, 'text/markdown');
  }
}

/** Display label of a mask source (land, zones:mountains, …); the source string itself is data. */
function maskSourceLabel(source) {
  if (source.startsWith('zones:')) return t('dialogs.masks.zonesOf', { type: label('zoneTypes', source.slice(6)) });
  return `${layerLabel(source)} (${source})`;
}

// --- background image -----------------------------------------------------------

function imageSize(url) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => fail(new Error(t('toast.imageFailed')));
    img.src = url;
  });
}

/**
 * Load the background image: from the project's stored blob when there is
 * one, otherwise view.background.src relative to the map URL.
 */
export async function resolveBackground({ blob = null, quiet = false } = {}) {
  const bg = store.doc.view.background;
  if (store.background?.url?.startsWith('blob:')) URL.revokeObjectURL(store.background.url);
  if (!bg?.src) { store.background = null; emit('background'); return; }
  let url = null;
  // a map opened through "Open folder": the relative path resolves in that folder (freshest copy of the image)
  const fromFolder = await backgroundFromFolder(bg.src);
  if (fromFolder) url = URL.createObjectURL(fromFolder);
  else if (blob) url = URL.createObjectURL(blob);
  else if (/^(data:|blob:|https?:)/.test(bg.src)) url = bg.src;
  else if (store.file.baseUrl) url = new URL(bg.src, store.file.baseUrl).href;
  if (!url) {
    store.background = { url: null, missing: true, name: bg.src };
    emit('background');
    if (!quiet) toast(t('toast.backgroundNotLoaded', { src: bg.src }), { timeout: 7000 });
    return;
  }
  try {
    const size = await imageSize(url);
    store.background = { url, ...size, name: bg.src };
    if (!Array.isArray(bg.calibration) || bg.calibration.length !== 2) {
      change((doc) => { doc.view.background.calibration = fitPairs(doc.view.bounds, size.width, size.height, !!doc.meta.flipY); });
    }
  } catch {
    store.background = { url: null, missing: true, name: bg.src };
    if (!quiet) toast(t('toast.backgroundLoadFailed', { src: bg.src }), { type: 'warn' });
  }
  emit('background');
}

export async function attachBackgroundFile(file, { src: forcedSrc = null } = {}) {
  const url = URL.createObjectURL(file);
  let size;
  try { size = await imageSize(url); } catch (e) { toast(t('toast.cannotReadImage', { error: e.message }), { type: 'error' }); return; }
  const bg = store.doc.view.background;
  const sameName = bg?.src && bg.src.split('/').pop() === file.name && bg.calibration?.length === 2 && (!forcedSrc || forcedSrc === bg.src);
  if (store.background?.url?.startsWith('blob:')) URL.revokeObjectURL(store.background.url);
  store.background = { url, ...size, name: file.name };
  emit('background-file', file); // session.js keeps it in the project so it survives reloads
  if (sameName) {
    emit('background');
    toast(t('toast.backgroundAttached', { file: file.name }), { type: 'ok' });
    return;
  }
  change((doc) => {
    doc.view.background = {
      src: forcedSrc || (bg?.src && bg.src.split('/').pop() === file.name ? bg.src : `assets/${file.name}`),
      opacity: bg?.opacity ?? 0.6,
      calibration: fitPairs(doc.view.bounds, size.width, size.height, !!doc.meta.flipY),
    };
  });
  emit('background');
  toast(t('toast.backgroundStretched', { file: file.name, w: String(size.width), h: String(size.height) }), {
    timeout: 9000,
    actions: [{ label: t('toast.calibrateNow'), onClick: () => emit('set-tool', 'calibrate') }],
  });
}

export async function pickBackgroundImage() {
  const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.remove();
    if (f) attachBackgroundFile(f);
  });
  document.body.append(input);
  input.click();
}

/** The background file from the opened folder (null without folder access or when missing). */
export async function backgroundFromFolder(src) {
  const dir = store.file.dir;
  if (!dir?.handle || !src) return null;
  if ((await permissionOf(dir.handle)) !== 'granted') return null;
  const path = resolvePath(dir.mapDir || [], src);
  if (!path) return null;
  const fh = await fileAt(dir.handle, path);
  try { return fh ? await fh.getFile() : null; } catch { return null; }
}

/** Place a POI at a world position (drag from the list). */
export function placePoi(id, world, snap) {
  const hit = findById(store.doc, id);
  if (!hit || hit.kind !== 'poi') return;
  change(() => {
    const p = hit.item;
    const [x, y] = snap ? snap(world) : world.map(Math.round);
    p.x = x; p.y = y;
    delete p.placed; // placed defaults to true
    const z = zoneOf(store.doc, [x, y]);
    if (z) p.zone = z; else delete p.zone;
  });
}
