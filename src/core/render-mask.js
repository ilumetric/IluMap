// map.json -> 8-bit greyscale bitmap (pure JS scanline rasteriser).
// Pixel (0,0) is the top-left corner of the bounds *as seen on screen*:
// with flipY = false that is (min.x, min.y); with flipY = true it is (min.x, max.y).

import { LAYERS, LAYER_KIND } from './schema.js';
import { featureGeometry, distToSegment, wallLayout } from './geometry.js';

export const LINE_SOURCES = ['rivers', 'roads', 'rails', 'walls', 'coast', 'relief', 'bridges'];

/** All sources that make sense for this document (for UIs and --split). */
export function maskSources(doc) {
  const out = ['land', 'water', 'zones'];
  for (const t of zoneTypes(doc)) out.push(`zones:${t}`);
  out.push(...LINE_SOURCES);
  for (const t of reliefTypesUsed(doc)) out.push(`relief:${t}`);
  return out;
}

/** Relief types used in the map (ridge, fault, cliff, …) — mask sources relief:<type>. */
export function reliefTypesUsed(doc) {
  const set = new Set();
  for (const f of doc.layers.relief || []) if (f.type) set.add(f.type);
  return [...set];
}

export function zoneTypes(doc) {
  const set = new Set();
  for (const z of doc.layers.zones) if (z.type) set.add(z.type);
  return [...set];
}

/** Output file name for a source: mask_land.png, mask_zones_mountains.png, mask_feature_<id>.png */
export function maskFileName(source) {
  return `mask_${String(source).replace(/[^a-zA-Z0-9_-]+/g, '_')}.png`;
}

/** Resolve the pixel size for bounds + {size | width | height}. */
export function maskSize(bounds, { size, width, height } = {}) {
  const bw = bounds.max[0] - bounds.min[0];
  const bh = bounds.max[1] - bounds.min[1];
  if (width > 0 && height > 0) return { width: Math.round(width), height: Math.round(height) };
  if (width > 0) return { width: Math.round(width), height: Math.max(1, Math.round((width * bh) / bw)) };
  if (height > 0) return { width: Math.max(1, Math.round((height * bw) / bh)), height: Math.round(height) };
  const s = size > 0 ? size : 1024;
  if (bw >= bh) return { width: Math.round(s), height: Math.max(1, Math.round((s * bh) / bw)) };
  return { width: Math.max(1, Math.round((s * bw) / bh)), height: Math.round(s) };
}

/** A raster frame that converts world <-> pixel coordinates. */
function makeFrame(bounds, width, height, flipY) {
  const x0 = bounds.min[0];
  const y0 = bounds.min[1];
  const y1 = bounds.max[1];
  const ux = (bounds.max[0] - x0) / width;
  const uy = (y1 - y0) / height;
  return {
    width, height, ux, uy,
    // world y of the centre of pixel row j
    rowY: (j) => (flipY ? y1 - (j + 0.5) * uy : y0 + (j + 0.5) * uy),
    colX: (i) => x0 + (i + 0.5) * ux,
    // continuous pixel coordinates of a world point (pixel centres at integer + 0.5)
    toPx: (x, y) => [(x - x0) / ux, flipY ? (y1 - y) / uy : (y - y0) / uy],
  };
}

/** Even-odd scanline fill of one polygon ring. */
function fillRing(data, F, ring, value) {
  const n = ring.length;
  if (n < 3) return;
  // pixel-space ring
  const P = ring.map(([x, y]) => F.toPx(x, y));
  let ymin = Infinity; let ymax = -Infinity;
  for (const p of P) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
  const j0 = Math.max(0, Math.floor(ymin - 0.5));
  const j1 = Math.min(F.height - 1, Math.ceil(ymax - 0.5));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const yc = j + 0.5;
    xs.length = 0;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const ya = P[a][1]; const yb = P[b][1];
      if ((ya > yc) !== (yb > yc)) xs.push(P[a][0] + ((yc - ya) * (P[b][0] - P[a][0])) / (yb - ya));
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    const row = j * F.width;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const i1 = Math.min(F.width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let i = i0; i <= i1; i++) data[row + i] = value;
    }
  }
}

/** Rasterise a thick polyline: every pixel whose centre is within halfWidth of a segment. */
function strokeLine(data, F, pts, closed, halfWidth, value) {
  const n = pts.length;
  if (n === 0) return;
  const hwx = halfWidth / F.ux;
  const hwy = halfWidth / F.uy;
  const P = pts.map(([x, y]) => F.toPx(x, y));
  // work in pixel space with anisotropic scaling folded into the distance test
  const segs = [];
  for (let k = 0; k < n - 1; k++) segs.push([P[k], P[k + 1]]);
  if (closed && n > 2) segs.push([P[n - 1], P[0]]);
  if (n === 1) segs.push([P[0], P[0]]);
  const sx = F.ux / halfWidth;
  const sy = F.uy / halfWidth;
  for (const [a, b] of segs) {
    const i0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - hwx - 1));
    const i1 = Math.min(F.width - 1, Math.ceil(Math.max(a[0], b[0]) + hwx + 1));
    const j0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - hwy - 1));
    const j1 = Math.min(F.height - 1, Math.ceil(Math.max(a[1], b[1]) + hwy + 1));
    // normalised coordinates where the half width is 1
    const A = [a[0] * sx, a[1] * sy];
    const B = [b[0] * sx, b[1] * sy];
    for (let j = j0; j <= j1; j++) {
      const row = j * F.width;
      const yc = (j + 0.5) * sy;
      for (let i = i0; i <= i1; i++) {
        if (data[row + i] === value) continue;
        if (distToSegment([(i + 0.5) * sx, yc], A, B) <= 1) data[row + i] = value;
      }
    }
  }
}

/** Separable box blur, radius r pixels. */
function boxBlur(data, w, h, r) {
  if (!(r >= 1)) return data;
  r = Math.round(r);
  const tmp = new Float32Array(w * h);
  const out = new Uint8Array(w * h);
  const win = 2 * r + 1;
  for (let j = 0; j < h; j++) {
    const row = j * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += data[row + Math.min(w - 1, Math.max(0, k))];
    for (let i = 0; i < w; i++) {
      tmp[row + i] = acc / win;
      acc += data[row + Math.min(w - 1, i + r + 1)] - data[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < w; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + i];
    for (let j = 0; j < h; j++) {
      out[j * w + i] = Math.max(0, Math.min(255, Math.round(acc / win)));
      acc += tmp[Math.min(h - 1, j + r + 1) * w + i] - tmp[Math.max(0, j - r) * w + i];
    }
  }
  return out;
}

function lineHalfWidth(f, opts, F) {
  const px = Math.max(F.ux, F.uy);
  let w = opts.stroke > 0 ? opts.stroke : f.width > 0 ? f.width : 2 * px;
  w = Math.max(w, px); // at least one pixel wide
  return w / 2;
}

function drawFeature(data, F, layer, f, opts, value) {
  const geo = featureGeometry(f);
  if (LAYER_KIND[layer] === 'polygon') { fillRing(data, F, geo, value); return; }
  const closed = f.closed === true;
  strokeLine(data, F, layer === 'walls' ? (f.points || []) : geo, closed, lineHalfWidth(f, opts, F), value);
  if (layer === 'walls' && f.wall) {
    const size = f.wall.towerSize > 0 ? f.wall.towerSize : 600;
    for (const t of wallLayout(f).towers) {
      const c = Math.cos(t.angle); const s = Math.sin(t.angle); const h = size / 2;
      const sq = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => [t.point[0] + x * c - y * s, t.point[1] + x * s + y * c]);
      fillRing(data, F, sq, value);
    }
  }
}

/**
 * @param {object} doc normalised map
 * @param {{source: string, width?: number, height?: number, size?: number, bounds?: {min,max},
 *          invert?: boolean, feather?: number, stroke?: number}} opts
 * @returns {{width, height, data: Uint8Array, unitsPerPixel: number, unitsPerPixelY: number, bounds, source}}
 */
export function renderMask(doc, opts = {}) {
  const source = opts.source || 'land';
  const bounds = opts.bounds || doc.view.bounds;
  const { width, height } = maskSize(bounds, opts);
  const F = makeFrame(bounds, width, height, !!doc.meta?.flipY);
  let data = new Uint8Array(width * height);
  const W = 255;

  const layerFeatures = (l) => doc.layers[l] || [];

  if (source === 'land' || source === 'water') {
    if (doc.meta?.landMode === 'filled') data.fill(W);
    else for (const f of layerFeatures('land')) drawFeature(data, F, 'land', f, opts, W);
    for (const f of layerFeatures('water')) drawFeature(data, F, 'water', f, opts, 0);
    if (source === 'water') for (let k = 0; k < data.length; k++) data[k] = 255 - data[k];
  } else if (source === 'zones' || source.startsWith('zones:')) {
    const type = source.startsWith('zones:') ? source.slice(6) : null;
    for (const f of layerFeatures('zones')) if (!type || f.type === type) drawFeature(data, F, 'zones', f, opts, W);
  } else if (source.startsWith('relief:')) {
    const type = source.slice(7);
    for (const f of layerFeatures('relief')) if (f.type === type) drawFeature(data, F, 'relief', f, opts, W);
  } else if (LINE_SOURCES.includes(source)) {
    for (const f of layerFeatures(source)) drawFeature(data, F, source, f, opts, W);
  } else if (source.startsWith('feature:')) {
    const id = source.slice(8);
    let found = false;
    for (const l of LAYERS) {
      for (const f of layerFeatures(l)) {
        if (f.id === id) { drawFeature(data, F, l, f, opts, W); found = true; }
      }
    }
    if (!found) throw new Error(`unknown feature "${id}"`);
  } else if (LAYERS.includes(source)) {
    for (const f of layerFeatures(source)) drawFeature(data, F, source, f, opts, W);
  } else {
    throw new Error(`unknown mask source "${source}" (try land, water, zones, zones:<type>, rivers, roads, rails, walls, coast, relief, relief:<type>, bridges, feature:<id>)`);
  }

  if (opts.feather > 0) data = boxBlur(data, width, height, opts.feather);
  if (opts.invert) for (let k = 0; k < data.length; k++) data[k] = 255 - data[k];

  return { width, height, data, unitsPerPixel: F.ux, unitsPerPixelY: F.uy, bounds: { min: bounds.min.slice(), max: bounds.max.slice() }, source };
}

/** masks.json sidecar content. entries: [{file, source, invert, feather, stroke}] */
export function maskSidecar(doc, mask, entries) {
  return {
    format: 'ilumap-masks',
    version: 1,
    map: doc.meta?.name || '',
    units: doc.meta?.units || 'cm',
    flipY: !!doc.meta?.flipY,
    origin: 'top-left pixel = ' + (doc.meta?.flipY ? '(min.x, max.y)' : '(min.x, min.y)'),
    bounds: mask.bounds,
    width: mask.width,
    height: mask.height,
    unitsPerPixel: mask.unitsPerPixel,
    unitsPerPixelY: mask.unitsPerPixelY,
    masks: entries,
  };
}

/** JSON text for masks.json (2-space indent, primitive arrays inline). */
export function stringifySidecar(obj) {
  return `${JSON.stringify(obj, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner) => `[${inner.split(/,\s+/).join(', ')}]`)}\n`;
}
