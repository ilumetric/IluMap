// Load / normalise / serialise map.json, id helpers, spatial queries.
// Pure module: no DOM.

import {
  FORMAT, VERSION, LAYERS, LAYER_KIND, KEY_ORDER, DEFAULT_META, DEFAULT_BOUNDS, DEFAULT_GRID,
  ID_RE,
} from './schema.js';
import { pointInPolygon, polygonArea, featureGeometry } from './geometry.js';

export { validate } from './schema.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** A new empty map. opts: { name, bounds, preset, units, displayUnit, displayUnitScale, flipY, landMode, gridStep } */
export function createEmptyMap(opts = {}) {
  const bounds = opts.bounds ? clone(opts.bounds) : clone(DEFAULT_BOUNDS);
  const meta = { ...DEFAULT_META };
  for (const k of Object.keys(DEFAULT_META)) if (opts[k] !== undefined) meta[k] = opts[k];
  const doc = {
    format: FORMAT,
    version: VERSION,
    meta,
    view: { bounds, grid: { step: opts.gridStep || DEFAULT_GRID.step, visible: true } },
    style: { preset: opts.preset || 'blueprint' },
    layers: {},
    pois: [],
    links: [],
  };
  for (const l of LAYERS) doc.layers[l] = [];
  return doc;
}

/**
 * Fill defaults, migrate older files and return a fresh document object.
 * Unknown keys are kept. Accepts a parsed object or a JSON string.
 */
export function normalize(json) {
  const src = typeof json === 'string' ? JSON.parse(json) : clone(json);
  if (!isObj(src)) throw new Error('map.json must contain a JSON object');
  const doc = src;
  if (doc.format === undefined) doc.format = FORMAT;
  if (doc.version === undefined) doc.version = VERSION; // pre-versioned drafts are v1
  doc.meta = { ...DEFAULT_META, ...(isObj(doc.meta) ? doc.meta : {}) };
  const view = isObj(doc.view) ? doc.view : {};
  if (!isObj(view.bounds)) view.bounds = clone(DEFAULT_BOUNDS);
  view.grid = { ...DEFAULT_GRID, ...(isObj(view.grid) ? view.grid : {}) };
  if (isObj(view.background) && view.background.opacity === undefined) view.background.opacity = 0.6;
  doc.view = view;
  doc.style = isObj(doc.style) ? doc.style : {};
  if (!doc.style.preset) doc.style.preset = 'blueprint';
  const layers = isObj(doc.layers) ? doc.layers : {};
  for (const l of LAYERS) {
    if (!Array.isArray(layers[l])) layers[l] = [];
    for (const f of layers[l]) {
      if (!isObj(f)) continue;
      if (f.kind === undefined) f.kind = LAYER_KIND[l];
      if (!Array.isArray(f.points)) f.points = [];
    }
  }
  doc.layers = layers;
  doc.pois = Array.isArray(doc.pois) ? doc.pois : [];
  for (const p of doc.pois) {
    if (!isObj(p)) continue;
    if (p.name === undefined) p.name = p.id;
    if (p.type === undefined) p.type = 'poi';
    if (p.status === undefined) p.status = 'idea';
    if (p.x === undefined) p.x = 0;
    if (p.y === undefined) p.y = 0;
  }
  doc.links = Array.isArray(doc.links) ? doc.links : [];
  // canonical key order in memory too (nice for debugging, no semantic effect)
  return JSON.parse(serialize(doc));
}

// ---------------------------------------------------------------------------
// Serialisation

/** Number formatting: integer when integral, else rounded to 2 decimals. */
export function formatNumber(n) {
  if (!Number.isFinite(n)) return 'null';
  const r = Math.round(n * 100) / 100;
  if (Object.is(r, -0) || r === 0) return '0';
  return String(r);
}

function childContext(ctx, key) {
  switch (ctx) {
    case 'root':
      return { meta: 'meta', view: 'view', terrain: 'terrain', style: 'style', layers: 'layers', pois: 'poiList', links: 'linkList' }[key] || null;
    case 'terrain':
      return key === 'sections' ? 'terrainSections' : null;
    case 'view':
      return { bounds: 'bounds', background: 'background', grid: 'grid' }[key] || null;
    case 'background':
      return key === 'calibration' ? 'calibrationList' : null;
    case 'calibrationList':
      return 'calibrationPair';
    case 'style':
      if (key === 'layers' || key === 'lineTypes' || key === 'wallTypes' || key === 'zoneTypes' || key === 'reliefTypes' || key === 'bridgeTypes' || key === 'poiTypes') return 'styleMap';
      return null;
    case 'styleMap':
      return 'styleEntry';
    case 'layers':
      return LAYERS.includes(key) ? 'featureList' : null;
    case 'featureList':
      return 'feature';
    case 'feature':
      return key === 'wall' ? 'wall' : null;
    case 'wall':
      return key === 'gates' ? 'gateList' : null;
    case 'gateList':
      return 'gate';
    case 'poiList':
      return 'poi';
    case 'linkList':
      return 'link';
    default:
      return null;
  }
}

function orderedKeys(obj, ctx) {
  const order = KEY_ORDER[ctx];
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (!order) return keys;
  const known = order.filter((k) => keys.includes(k));
  const unknown = keys.filter((k) => !order.includes(k));
  return [...known, ...unknown];
}

const isPrimitive = (v) => v === null || typeof v !== 'object';

function write(value, indent, ctx) {
  if (value === null) return 'null';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  const pad = '  '.repeat(indent + 1);
  const end = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    // arrays of primitives (coordinate pairs, tags) stay on one line
    if (value.every(isPrimitive)) return `[${value.map((v) => write(v, 0, null)).join(', ')}]`;
    const itemCtx = childContext(ctx, '*');
    return `[\n${value.map((v) => pad + write(v, indent + 1, itemCtx)).join(',\n')}\n${end}]`;
  }
  if (typeof value === 'object') {
    const keys = orderedKeys(value, ctx);
    if (keys.length === 0) return '{}';
    const lines = keys.map((k) => `${pad}${JSON.stringify(k)}: ${write(value[k], indent + 1, childContext(ctx, k))}`);
    return `{\n${lines.join(',\n')}\n${end}}`;
  }
  return 'null';
}

/** Canonical, diff-friendly JSON text (2-space indent, fixed key order, one [x, y] per line, trailing newline). */
export function serialize(doc) {
  return `${write(doc, 0, 'root')}\n`;
}

// ---------------------------------------------------------------------------
// Ids

/** Every id in the document: features, POIs, gates, link ids. */
export function allIds(doc) {
  const ids = new Set();
  for (const l of LAYERS) {
    for (const f of doc.layers?.[l] || []) {
      if (f?.id) ids.add(f.id);
      for (const g of f?.wall?.gates || []) if (g?.id) ids.add(g.id);
    }
  }
  for (const p of doc.pois || []) if (p?.id) ids.add(p.id);
  for (const k of doc.links || []) if (k?.id) ids.add(k.id);
  return ids;
}

/** Find anything by id. */
export function findById(doc, id) {
  if (!id) return null;
  for (const l of LAYERS) {
    for (const f of doc.layers?.[l] || []) {
      if (f.id === id) return { kind: 'feature', layer: l, item: f };
      for (const g of f.wall?.gates || []) if (g.id === id) return { kind: 'gate', layer: l, item: g, feature: f };
    }
  }
  for (const p of doc.pois || []) if (p.id === id) return { kind: 'poi', item: p };
  for (const k of doc.links || []) if (k.id === id) return { kind: 'link', item: k };
  return null;
}

/** "Old Mine" -> "old_mine"; appends _2, _3… when taken. existingIds: Set | array. */
export function slugify(name, existingIds = new Set()) {
  const taken = existingIds instanceof Set ? existingIds : new Set(existingIds);
  let base = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) base = 'item';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const id = `${base}_${i}`;
    if (!taken.has(id)) return id;
  }
}

/** prefix_1, prefix_2… first free. */
export function nextId(doc, prefix) {
  const taken = allIds(doc);
  for (let i = 1; ; i++) {
    const id = `${prefix}_${i}`;
    if (!taken.has(id)) return id;
  }
}

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/**
 * Rename an id everywhere it is referenced (POI zone, link from/to/feature).
 * Mutates doc. Throws on invalid or taken ids.
 */
export function renameId(doc, oldId, newId) {
  if (oldId === newId) return;
  if (!isValidId(newId)) throw new Error(`id "${newId}" must match [a-z0-9_]+`);
  if (allIds(doc).has(newId)) throw new Error(`id "${newId}" is already used`);
  const hit = findById(doc, oldId);
  if (!hit) throw new Error(`id "${oldId}" not found`);
  hit.item.id = newId;
  for (const p of doc.pois) if (p.zone === oldId) p.zone = newId;
  for (const k of doc.links) {
    if (k.from === oldId) k.from = newId;
    if (k.to === oldId) k.to = newId;
    if (k.feature === oldId) k.feature = newId;
  }
}

/** Remove an item by id and everything that points at it (links; POI zone refs are cleared). Returns true if removed. */
export function removeById(doc, id) {
  const hit = findById(doc, id);
  if (!hit) return false;
  if (hit.kind === 'feature') {
    const arr = doc.layers[hit.layer];
    arr.splice(arr.indexOf(hit.item), 1);
    const gateIds = new Set((hit.item.wall?.gates || []).map((g) => g.id));
    doc.links = doc.links.filter((k) => !gateIds.has(k.from) && !gateIds.has(k.to));
    for (const k of doc.links) if (k.feature === id) delete k.feature;
    for (const p of doc.pois) if (p.zone === id) delete p.zone;
  } else if (hit.kind === 'gate') {
    const gates = hit.feature.wall.gates;
    gates.splice(gates.indexOf(hit.item), 1);
    doc.links = doc.links.filter((k) => k.from !== id && k.to !== id);
  } else if (hit.kind === 'poi') {
    doc.pois.splice(doc.pois.indexOf(hit.item), 1);
    doc.links = doc.links.filter((k) => k.from !== id && k.to !== id);
  } else if (hit.kind === 'link') {
    doc.links.splice(doc.links.indexOf(hit.item), 1);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Spatial queries

/** Smallest zone polygon containing the point, or null. */
export function zoneOf(doc, p) {
  let best = null;
  let bestArea = Infinity;
  for (const z of doc.layers?.zones || []) {
    if (!z.points || z.points.length < 3) continue;
    const ring = featureGeometry(z);
    if (pointInPolygon(p, ring)) {
      const a = polygonArea(ring);
      if (a < bestArea) { best = z.id; bestArea = a; }
    }
  }
  return best;
}

/** landMode + land polygons - water polygons. */
export function isLand(doc, p) {
  const inPoly = (f) => f.points && f.points.length >= 3 && pointInPolygon(p, featureGeometry(f));
  let land;
  if (doc.meta?.landMode === 'filled') {
    const b = doc.view.bounds;
    land = p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1];
  } else {
    land = (doc.layers?.land || []).some(inPoly);
  }
  if (!land) return false;
  return !(doc.layers?.water || []).some(inPoly);
}

/** Water feature containing the point, if any. */
export function waterAt(doc, p) {
  for (const f of doc.layers?.water || []) {
    if (f.points && f.points.length >= 3 && pointInPolygon(p, featureGeometry(f))) return f;
  }
  return null;
}

/** Iterate all features as { layer, feature }. */
export function* features(doc) {
  for (const l of LAYERS) for (const f of doc.layers?.[l] || []) yield { layer: l, feature: f };
}

/** Insert a vertex before `index` (so it becomes points[index]); wall gate vertex indices are shifted. */
export function insertVertex(feature, index, point) {
  feature.points.splice(index, 0, [point[0], point[1]]);
  for (const g of feature.wall?.gates || []) if (Number.isInteger(g.at) && g.at >= index) g.at += 1;
}

/** Remove vertex `index` if the feature keeps its minimum point count; returns true when removed. */
export function removeVertex(feature, index) {
  const min = feature.kind === 'polygon' ? 3 : 2;
  if (feature.points.length <= min) return false;
  feature.points.splice(index, 1);
  for (const g of feature.wall?.gates || []) {
    if (!Number.isInteger(g.at)) continue;
    if (g.at > index) g.at -= 1;
    g.at = Math.min(g.at, feature.points.length - 1);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Partial documents (export of a selection)

/**
 * A copy of the document that keeps only the given items: features, POIs and
 * gates (a gate keeps its whole wall). meta, view and style are kept so the
 * result is a valid map in the same world coordinates. Links survive when
 * both ends are kept; references to dropped features (link.feature, POI zone)
 * are removed.
 */
export function extractSelection(doc, ids) {
  const want = new Set(ids);
  for (const id of ids) {
    const hit = findById(doc, id);
    if (hit?.kind === 'gate') want.add(hit.feature.id);
  }
  const out = clone(doc);
  for (const l of LAYERS) out.layers[l] = (out.layers[l] || []).filter((f) => want.has(f.id));
  out.pois = (out.pois || []).filter((p) => want.has(p.id));
  const keep = allIds(out);
  out.links = (out.links || []).filter((k) => keep.has(k.from) && keep.has(k.to));
  for (const k of out.links) if (k.feature && !keep.has(k.feature)) delete k.feature;
  for (const p of out.pois) if (p.zone && !keep.has(p.zone)) delete p.zone;
  return out;
}

/**
 * World bounding box of the given items ({min, max}), grown by `pad` (a
 * fraction of the larger side, at least `minPad` world units) and, with
 * `minAspect`, widened so neither side is shorter than minAspect × the other; null when
 * none of them has a position (e.g. only unplaced POIs).
 */
export function selectionBounds(doc, ids, { pad = 0.08, minPad = 0, minAspect = 0 } = {}) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const add = ([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const id of ids) {
    const hit = findById(doc, id);
    if (!hit) continue;
    if (hit.kind === 'poi') { if (hit.item.placed !== false) add([hit.item.x, hit.item.y]); } else if (hit.kind === 'feature') {
      for (const p of hit.item.points || []) add(p);
    } else if (hit.kind === 'gate') {
      for (const p of hit.feature.points || []) add(p);
    }
  }
  if (!Number.isFinite(x0)) return null;
  const side = Math.max(x1 - x0, y1 - y0);
  const m = Math.max(side * pad, minPad, side === 0 ? 1000 : 0);
  let w = x1 - x0 + 2 * m;
  let hgt = y1 - y0 + 2 * m;
  // minAspect (0..1): grow the short side so the box is not a thin strip (image exports)
  const ex = minAspect > 0 ? Math.max(0, hgt * minAspect - w) / 2 : 0;
  const ey = minAspect > 0 ? Math.max(0, w * minAspect - hgt) / 2 : 0;
  w += 2 * ex; hgt += 2 * ey;
  return { min: [x0 - m - ex, y0 - m - ey], max: [x1 + m + ex, y1 + m + ey] };
}
