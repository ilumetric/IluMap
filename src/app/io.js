// Save (File System Access API with fallbacks), exports, background image,
// POI placement. Opening / importing maps lives in session.js.

import { store, markSaved, change, emit, visibleLayers } from './state.js';
import { normalize, serialize, validate, findById, zoneOf } from '../core/model.js';
import { renderSvg } from '../core/render-svg.js';
import { toText } from '../core/text-export.js';
import { renderMask, maskFileName, maskSidecar, stringifySidecar, maskSources, zoneTypes } from '../core/render-mask.js';
import { encodePngAsync } from '../core/png.js';
import { fitPairs } from '../core/calibration.js';
import { download, toast, openDialog, h } from './dom.js';

const JSON_TYPES = [{ description: 'IluMap map', accept: { 'application/json': ['.json'] } }];
export const JSON_PICKER_TYPES = JSON_TYPES;

function baseName(name) {
  return (name || 'map.json').replace(/\.json$/i, '');
}

/** Parse + normalise + report validation problems. Returns the doc or null. */
export function parseMapText(text, source = 'file') {
  let json;
  try { json = JSON.parse(text); } catch (e) {
    toast(`${source} is not valid JSON: ${e.message}`, { type: 'error', timeout: 8000 });
    return null;
  }
  let doc;
  try { doc = normalize(json); } catch (e) {
    toast(`Cannot read ${source}: ${e.message}`, { type: 'error', timeout: 8000 });
    return null;
  }
  const v = validate(doc);
  if (!v.ok) {
    const first = v.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; ');
    toast(`${source} has ${v.errors.length} validation error(s) — ${first}`, { type: 'warn', timeout: 10000 });
  }
  return doc;
}

/** Fetch a map.json over HTTP; returns its text. */
export async function fetchMapText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

export async function save() {
  if (store.file.handle) {
    try {
      const text = serialize(store.doc);
      if (store.file.handle.requestPermission) {
        const p = await store.file.handle.requestPermission({ mode: 'readwrite' });
        if (p !== 'granted') throw new Error('write permission denied');
      }
      const w = await store.file.handle.createWritable();
      await w.write(text);
      await w.close();
      markSaved(text);
      emit('file');
      toast(`Saved ${store.file.name}`, { type: 'ok', timeout: 1800 });
      return true;
    } catch (e) {
      toast(`Save failed: ${e.message}. Use “Save as…”.`, { type: 'error' });
      return false;
    }
  }
  return saveAs();
}

export async function saveAs() {
  const text = serialize(store.doc);
  const v = validate(store.doc);
  if (!v.ok) toast(`Saving with ${v.errors.length} validation error(s): ${v.errors[0].path}: ${v.errors[0].message}`, { type: 'warn', timeout: 7000 });
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: store.file.name || 'map.json', types: JSON_TYPES });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      store.file = { ...store.file, handle, name: handle.name, baseUrl: null };
      markSaved(text);
      emit('file');
      toast(`Saved ${handle.name}`, { type: 'ok', timeout: 1800 });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      toast(`Save failed (${e.message}); downloading instead.`, { type: 'warn' });
    }
  }
  download(store.file.name || 'map.json', text, 'application/json');
  markSaved(text);
  emit('file');
  toast('Downloaded map.json — replace the file in your repo with it.', { timeout: 5000 });
  return true;
}

// --- exports ------------------------------------------------------------------

export function exportJson() {
  download(store.file.name || 'map.json', serialize(store.doc), 'application/json');
}

function exportSvgText(width = 2048) {
  return renderSvg(store.doc, { width, layers: visibleLayers(), grid: store.doc.view.grid?.visible });
}

export function exportSvg() {
  download(`${baseName(store.file.name)}.svg`, exportSvgText(2048), 'image/svg+xml');
}

export async function exportPng() {
  const res = await openDialog({
    title: 'Export PNG',
    fields: [
      { name: 'width', label: 'Width (px)', type: 'number', value: 4096, min: 64, max: 16384, step: 1 },
      { name: 'grid', label: 'Include grid', type: 'checkbox', value: false },
    ],
    okText: 'Export',
  });
  if (!res) return;
  const width = Math.max(64, Math.min(16384, Math.round(res.width || 4096)));
  const svg = renderSvg(store.doc, { width, layers: visibleLayers(), grid: res.grid });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('SVG could not be rasterised')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || width;
    canvas.height = img.naturalHeight || Math.round(width);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
    if (!png) throw new Error('canvas too large for this browser');
    download(`${baseName(store.file.name)}.png`, png);
  } catch (e) {
    toast(`PNG export failed: ${e.message}`, { type: 'error' });
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

export async function exportMasks() {
  const doc = store.doc;
  const sources = maskSources(doc);
  const res = await openDialog({
    title: 'Export masks',
    message: 'Greyscale PNG masks covering view.bounds (white = selected). A masks.json sidecar records bounds and units per pixel.',
    fields: [
      { name: 'source', label: 'Source', type: 'select', value: store.prefs.maskSource || 'land', options: [...sources, ['feature', 'feature:<id> (selected feature)']] },
      { name: 'size', label: 'Size (longest side, px)', type: 'number', value: store.prefs.maskSize || 2048, min: 16, max: 16384, step: 1 },
      { name: 'feather', label: 'Feather (px, box blur)', type: 'number', value: 0, min: 0, max: 256, step: 1 },
      { name: 'stroke', label: 'Line width override (world units, optional)', type: 'number', value: '', min: 0, step: 'any' },
      { name: 'invert', label: 'Invert', type: 'checkbox', value: false },
      { name: 'split', label: 'Split zones: one file per zone type (source “zones”)', type: 'checkbox', value: false },
    ],
    okText: 'Export',
  });
  if (!res) return;
  store.prefs.maskSource = res.source;
  store.prefs.maskSize = res.size;
  let list = [res.source];
  if (res.source === 'feature') {
    const sel = [...store.selection].filter((id) => findById(doc, id)?.kind === 'feature');
    if (!sel.length) { toast('Select a feature first.', { type: 'warn' }); return; }
    list = sel.map((id) => `feature:${id}`);
  }
  if (res.split && res.source === 'zones') list = zoneTypes(doc).map((t) => `zones:${t}`);
  const files = [];
  const entries = [];
  let last = null;
  const close = toast('Rendering masks…', { timeout: 0 });
  try {
    for (const source of list) {
      const m = renderMask(doc, { source, size: res.size, invert: res.invert, feather: res.feather || 0, stroke: res.stroke || undefined });
      last = m;
      const name = maskFileName(source);
      files.push({ name, blob: await pngBlobFromGrey(m) });
      const entry = { file: name, source, invert: !!res.invert, feather: res.feather || 0 };
      if (res.stroke) entry.stroke = res.stroke;
      entries.push(entry);
    }
  } catch (e) {
    close();
    toast(`Mask export failed: ${e.message}`, { type: 'error' });
    return;
  }
  close();
  files.push({ name: 'masks.json', blob: new Blob([stringifySidecar(maskSidecar(doc, last, entries))], { type: 'application/json' }) });
  if ('showDirectoryPicker' in window && files.length > 2) {
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      for (const f of files) {
        const fh = await dir.getFileHandle(f.name, { create: true });
        const w = await fh.createWritable();
        await w.write(f.blob);
        await w.close();
      }
      toast(`Wrote ${files.length} files to ${dir.name}/`, { type: 'ok' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  for (const f of files) download(f.name, f.blob);
  toast(`Exported ${files.length - 1} mask(s) + masks.json`, { type: 'ok' });
}

export async function copyText(format = 'markdown') {
  const text = toText(store.doc, { format });
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied map as ${format === 'plain' ? 'plain text' : 'markdown'} (${text.split('\n').length} lines)`, { type: 'ok' });
  } catch {
    download(`${baseName(store.file.name)}.md`, text, 'text/markdown');
  }
}

// --- background image -----------------------------------------------------------

function imageSize(url) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => fail(new Error('image failed to load'));
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
  if (blob) url = URL.createObjectURL(blob);
  else if (/^(data:|blob:|https?:)/.test(bg.src)) url = bg.src;
  else if (store.file.baseUrl) url = new URL(bg.src, store.file.baseUrl).href;
  if (!url) {
    store.background = { url: null, missing: true, name: bg.src };
    emit('background');
    if (!quiet) toast(`Background “${bg.src}” is not loaded — drop the image onto the canvas to attach it.`, { timeout: 7000 });
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
    if (!quiet) toast(`Background “${bg.src}” could not be loaded.`, { type: 'warn' });
  }
  emit('background');
}

export async function attachBackgroundFile(file) {
  const url = URL.createObjectURL(file);
  let size;
  try { size = await imageSize(url); } catch (e) { toast(`Cannot read image: ${e.message}`, { type: 'error' }); return; }
  const bg = store.doc.view.background;
  const sameName = bg?.src && bg.src.split('/').pop() === file.name && bg.calibration?.length === 2;
  if (store.background?.url?.startsWith('blob:')) URL.revokeObjectURL(store.background.url);
  store.background = { url, ...size, name: file.name };
  emit('background-file', file); // session.js keeps it in the project so it survives reloads
  if (sameName) {
    emit('background');
    toast(`Attached ${file.name} using its saved calibration.`, { type: 'ok' });
    return;
  }
  change((doc) => {
    doc.view.background = {
      src: bg?.src && bg.src.split('/').pop() === file.name ? bg.src : `assets/${file.name}`,
      opacity: bg?.opacity ?? 0.6,
      calibration: fitPairs(doc.view.bounds, size.width, size.height, !!doc.meta.flipY),
    };
  });
  emit('background');
  toast(`Background ${file.name} (${size.width}×${size.height}) stretched to the bounds. Calibrate it: pick the Calibrate tool (K) and click 2 known points.`, {
    timeout: 9000,
    actions: [{ label: 'Calibrate now', onClick: () => emit('set-tool', 'calibrate') }],
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
