// Compare two maps: what the human (or the agent) changed between two versions
// of map.json, as structured records and as readable text.
// Pure module: no DOM, no Node APIs; used by the CLI `diff` command.
//
//   diffMaps(a, b)                       -> { equal, name, units, pois, features, links, map }
//   diffText(a, b, { format })           -> markdown (default) or plain text summary
//   formatDiff(diffMaps(a, b), { format }) -> the same text from a precomputed diff
//
// Items are matched by id. Output is grouped (POIs, Features, Links, Map) and
// ordered like the new map; removed items follow, in the old map's order.
// Distances use the new map's display units; compass directions honour its
// meta.flipY; zones and "nearest POI" come from the new map.

import { KEY_ORDER } from './schema.js';
import {
  distance, bearing, compass8, polylineLength, polygonArea, centroid, featureGeometry, pointInPolygon,
} from './geometry.js';
import { normalize, zoneOf, isLand, waterAt } from './model.js';
import { formatLength, formatArea } from './text-export.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hasId = (v) => isObj(v) && typeof v.id === 'string' && v.id !== '';

/** Keys of both objects: canonical order first, then unknown keys (new object first). */
function unionKeys(a = {}, b = {}, order = []) {
  const keys = order.filter((k) => k in a || k in b);
  for (const k of [...Object.keys(b), ...Object.keys(a)]) if (!keys.includes(k)) keys.push(k);
  return keys;
}

function fieldChanges(a, b, order, skip) {
  const out = [];
  for (const key of unionKeys(a, b, order)) {
    if (skip.includes(key) || same(a[key], b[key])) continue;
    if (key === 'tags') {
      const t0 = Array.isArray(a.tags) ? a.tags : [];
      const t1 = Array.isArray(b.tags) ? b.tags : [];
      out.push({ field: 'tags', before: a.tags, after: b.tags, added: t1.filter((t) => !t0.includes(t)), removed: t0.filter((t) => !t1.includes(t)) });
    } else out.push({ field: key, before: a[key], after: b[key] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spatial context (always the new map)

function zoneLabelIn(docs, id) {
  for (const d of docs) {
    const z = (Array.isArray(d.layers?.zones) ? d.layers.zones : []).find((f) => f?.id === id);
    if (z) return z.name || z.id;
  }
  return id;
}

/** Smallest zone containing the point, optionally ignoring one zone (a zone is not "in" itself). */
function zoneAt(doc, pt, excludeId) {
  if (!excludeId) return zoneOf(doc, pt);
  let best = null;
  let bestArea = Infinity;
  for (const z of doc.layers?.zones || []) {
    if (!isObj(z) || z.id === excludeId || !Array.isArray(z.points) || z.points.length < 3) continue;
    const ring = featureGeometry(z);
    if (pointInPolygon(pt, ring)) {
      const area = polygonArea(ring);
      if (area < bestArea) { best = z.id; bestArea = area; }
    }
  }
  return best;
}

/** { zone, label, phrase }: "Central Plains" / "in Central Plains", "open land" / "on open land", … */
function placeOf(ctx, pt, excludeId) {
  const zone = zoneAt(ctx.b, pt, excludeId);
  if (zone) { const label = zoneLabelIn([ctx.b, ctx.a], zone); return { zone, label, phrase: `in ${label}` }; }
  if (isLand(ctx.b, pt)) return { zone: null, label: 'open land', phrase: 'on open land' };
  const w = waterAt(ctx.b, pt);
  if (w) { const label = w.name || w.id; return { zone: null, label, phrase: `in ${label}` }; }
  return { zone: null, label: 'the sea', phrase: 'at sea' };
}

/** Nearest placed POI of the new map to a point: { id, name, distance, compass } (compass = direction from that POI). */
function nearestPoi(ctx, pt, excludeId) {
  let best = null;
  for (const p of ctx.b.pois) {
    if (!hasId(p) || p.id === excludeId || p.placed === false) continue;
    const d = distance([p.x, p.y], pt);
    if (!best || d < best.distance) best = { id: p.id, name: p.name || p.id, distance: d, compass: d > 0 ? compass8(bearing([p.x, p.y], pt, ctx.flipY)) : null };
  }
  return best;
}

function whereOf(ctx, pt, excludeId) {
  return { ...placeOf(ctx, pt, excludeId), nearest: nearestPoi(ctx, pt, excludeId) };
}

function move(ctx, from, to) {
  const d = distance(from, to);
  const deg = bearing(from, to, ctx.flipY);
  return { from, to, distance: d, bearing: Math.round(deg * 10) / 10, compass: compass8(deg) };
}

// ---------------------------------------------------------------------------
// Matching helpers

function withoutId(item) {
  const { id, ...rest } = item;
  return JSON.stringify(rest);
}

/** Pair removed and added items whose content is identical apart from the id. Returns Map newId -> oldId. */
function idChanges(removed, added) {
  const pairs = new Map();
  const used = new Set();
  for (const [nid, n] of added) {
    const sig = withoutId(n);
    for (const [oid, o] of removed) {
      if (!used.has(oid) && withoutId(o) === sig) { pairs.set(nid, oid); used.add(oid); break; }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// POIs

function diffPois(ctx) {
  const index = (doc) => new Map(doc.pois.filter(hasId).map((p) => [p.id, p]));
  const before = index(ctx.a);
  const after = index(ctx.b);
  const removed = new Map([...before].filter(([id]) => !after.has(id)));
  const added = new Map([...after].filter(([id]) => !before.has(id)));
  const renamedIds = idChanges(removed, added);
  for (const [nid, oid] of renamedIds) ctx.idMap.set(oid, nid);
  const out = [];
  for (const p1 of after.values()) {
    const p0 = before.get(p1.id);
    if (!p0) {
      if (renamedIds.has(p1.id)) { out.push({ op: 'id-changed', id: p1.id, oldId: renamedIds.get(p1.id), after: p1 }); continue; }
      out.push({ op: 'added', id: p1.id, after: p1, where: whereOf(ctx, [p1.x, p1.y], p1.id) });
      continue;
    }
    const changes = [];
    const wasPlaced = p0.placed !== false;
    const isPlaced = p1.placed !== false;
    const from = [p0.x, p0.y];
    const to = [p1.x, p1.y];
    const moved = !same(from, to);
    if (wasPlaced && isPlaced && moved) {
      const m = move(ctx, from, to);
      const now = placeOf(ctx, to);
      const was = placeOf(ctx, from);
      changes.push({ field: 'position', ...m, zone: zoneOf(ctx.b, to), zoneBefore: zoneOf(ctx.b, from), place: now, placeBefore: was });
    } else if (!wasPlaced && isPlaced) {
      changes.push({ field: 'placed', before: false, after: true, at: to, where: whereOf(ctx, to, p1.id) });
    } else if (wasPlaced && !isPlaced) {
      changes.push({ field: 'placed', before: true, after: false });
    } else if (moved) {
      changes.push({ field: 'position', rough: true, ...move(ctx, from, to) });
    }
    changes.push(...fieldChanges(p0, p1, KEY_ORDER.poi, ['id', 'x', 'y', 'placed']));
    if (changes.length) out.push({ op: 'changed', id: p1.id, before: p0, after: p1, changes });
  }
  const consumed = new Set(renamedIds.values());
  for (const [id, p0] of removed) if (!consumed.has(id)) out.push({ op: 'removed', id, before: p0 });
  return out;
}

// ---------------------------------------------------------------------------
// Features (every layer key present in either map, known or not)

function layerKeys(ctx) {
  const keys = [];
  for (const d of [ctx.b, ctx.a]) for (const k of Object.keys(d.layers || {})) if (!keys.includes(k)) keys.push(k);
  return keys;
}

function featureIndex(doc) {
  const m = new Map();
  for (const [layer, arr] of Object.entries(doc.layers || {})) {
    if (!Array.isArray(arr)) continue;
    arr.forEach((f, i) => {
      if (!isObj(f)) return;
      const id = hasId(f) ? f.id : `${layer}#${i}`;
      if (!m.has(id)) m.set(id, { layer, f });
    });
  }
  return m;
}

const isPolygon = (f) => f.kind === 'polygon';

function measureOf(f) {
  const pts = Array.isArray(f.points) ? f.points : [];
  const g = pts.length ? featureGeometry(f) : [];
  if (isPolygon(f)) return { measure: 'area', value: g.length >= 3 ? polygonArea(g) : 0 };
  return { measure: 'length', value: g.length >= 2 ? polylineLength(g, f.closed === true) : 0 };
}

function centreOf(f) {
  const pts = Array.isArray(f.points) ? f.points : [];
  if (!pts.length) return null;
  const g = featureGeometry(f);
  if (isPolygon(f) || (f.closed === true && g.length >= 3)) return centroid(g);
  let x = 0;
  let y = 0;
  for (const p of g) { x += p[0]; y += p[1]; }
  return [x / g.length, y / g.length];
}

/** Line end: a POI within 2 % of the map diagonal ("Riverport"), else the place ("Central Plains"). */
function endpointOf(ctx, pt, excludeId) {
  const n = nearestPoi(ctx, pt, excludeId);
  if (n && n.distance <= ctx.near) return { poi: n.id, label: n.name, phrase: `at ${n.name}` };
  return placeOf(ctx, pt, excludeId);
}

function featureWhere(ctx, f) {
  const pts = Array.isArray(f.points) ? f.points : [];
  if (!pts.length) return null;
  if (!isPolygon(f) && f.closed !== true && pts.length >= 2) {
    const g = featureGeometry(f);
    return { from: endpointOf(ctx, g[0], f.id), to: endpointOf(ctx, g[g.length - 1], f.id) };
  }
  return whereOf(ctx, centreOf(f), f.id);
}

function gateMap(f) {
  return new Map((Array.isArray(f.wall?.gates) ? f.wall.gates : []).filter(hasId).map((g) => [g.id, g]));
}

function wallChange(f0, f1) {
  const w0 = isObj(f0.wall) ? f0.wall : {};
  const w1 = isObj(f1.wall) ? f1.wall : {};
  if (same(w0, w1)) return null;
  const g0 = gateMap(f0);
  const g1 = gateMap(f1);
  const gatesAdded = [...g1.values()].filter((g) => !g0.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
  const gatesRemoved = [...g0.values()].filter((g) => !g1.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
  const gatesChanged = [...g1.values()].filter((g) => g0.has(g.id) && !same(g0.get(g.id), g))
    .map((g) => ({ id: g.id, name: g.name, changes: fieldChanges(g0.get(g.id), g, KEY_ORDER.gate, ['id']) }));
  const settings = fieldChanges(w0, w1, KEY_ORDER.wall, ['gates']);
  if (!f0.wall && f1.wall) settings.unshift({ field: 'wall', before: undefined, after: 'added' });
  if (f0.wall && !f1.wall) settings.unshift({ field: 'wall', before: 'set', after: undefined });
  return { field: 'wall', gatesAdded, gatesRemoved, gatesChanged, settings };
}

function diffFeatures(ctx) {
  const before = featureIndex(ctx.a);
  const after = featureIndex(ctx.b);
  const removed = new Map([...before].filter(([id]) => !after.has(id)).map(([id, e]) => [id, e.f]));
  const added = new Map([...after].filter(([id]) => !before.has(id)).map(([id, e]) => [id, e.f]));
  const renamedIds = idChanges(removed, added);
  for (const [nid, oid] of renamedIds) ctx.idMap.set(oid, nid);
  const consumed = new Set(renamedIds.values());
  const diag = Math.hypot(ctx.b.view.bounds.max[0] - ctx.b.view.bounds.min[0], ctx.b.view.bounds.max[1] - ctx.b.view.bounds.min[1]) || 1;
  const out = [];
  for (const layer of layerKeys(ctx)) {
    const arr = Array.isArray(ctx.b.layers?.[layer]) ? ctx.b.layers[layer] : [];
    arr.forEach((f1, i) => {
      if (!isObj(f1)) return;
      const id = hasId(f1) ? f1.id : `${layer}#${i}`;
      if (after.get(id)?.f !== f1) return; // duplicate id: only the first one is compared
      const e0 = before.get(id);
      if (!e0) {
        if (renamedIds.has(id)) { out.push({ op: 'id-changed', id, oldId: renamedIds.get(id), layer, after: f1 }); return; }
        out.push({ op: 'added', id, layer, after: f1, ...measureOf(f1), where: featureWhere(ctx, f1), gates: [...gateMap(f1).values()].map((g) => ({ id: g.id, name: g.name })) });
        return;
      }
      const f0 = e0.f;
      const changes = [];
      if (e0.layer !== layer) changes.push({ field: 'layer', before: e0.layer, after: layer });
      const geomKeys = ['points', 'kind', 'closed', 'smooth'];
      if (geomKeys.some((k) => !same(f0[k], f1[k]))) {
        const m0 = measureOf(f0);
        const m1 = measureOf(f1);
        const c0 = centreOf(f0);
        const c1 = centreOf(f1);
        const shape = {
          field: 'shape',
          points: [(f0.points || []).length, (f1.points || []).length],
          measure: m1.measure,
          value: [m0.value, m1.value],
        };
        if (c0 && c1) {
          const mv = move(ctx, c0, c1);
          shape.centre = [c0, c1];
          shape.shift = mv.distance;
          shape.compass = mv.compass;
          shape.significant = mv.distance >= diag * 0.001;
        }
        if (!same(f0.points, f1.points)) changes.push(shape);
      }
      changes.push(...fieldChanges(f0, f1, KEY_ORDER.feature, ['id', 'points', 'wall']));
      const w = wallChange(f0, f1);
      if (w) changes.push(w);
      if (changes.length) out.push({ op: 'changed', id, layer, layerBefore: e0.layer, before: f0, after: f1, changes });
    });
    const arr0 = Array.isArray(ctx.a.layers?.[layer]) ? ctx.a.layers[layer] : [];
    arr0.forEach((f0, i) => {
      if (!isObj(f0)) return;
      const id = hasId(f0) ? f0.id : `${layer}#${i}`;
      if (removed.get(id) === f0 && !consumed.has(id)) out.push({ op: 'removed', id, layer, before: f0, ...measureOf(f0) });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Links

function diffLinks(ctx) {
  const A = ctx.a.links.filter(isObj);
  const B = ctx.b.links.filter(isObj);
  const pairOf = new Map(); // b link -> a link
  const usedA = new Set();
  const match = (pred) => {
    for (const k1 of B) {
      if (pairOf.has(k1)) continue;
      const k0 = A.find((k) => !usedA.has(k) && pred(k, k1));
      if (k0) { pairOf.set(k1, k0); usedA.add(k0); }
    }
  };
  match((k0, k1) => k0.id && k0.id === k1.id);
  match((k0, k1) => !k0.id && !k1.id && same(k0, k1));
  match((k0, k1) => withoutId(k0) === withoutId(k1));
  const follow = (k) => ({ ...k, from: ctx.idMap.get(k.from) ?? k.from, to: ctx.idMap.get(k.to) ?? k.to, feature: ctx.idMap.get(k.feature) ?? k.feature });
  match((k0, k1) => withoutId(follow(k0)) === withoutId(k1)); // endpoints whose ids changed
  match((k0, k1) => (!k0.id || !k1.id) && k0.from === k1.from && k0.to === k1.to && k0.type === k1.type);
  match((k0, k1) => (!k0.id || !k1.id) && k0.from === k1.from && k0.to === k1.to);
  match((k0, k1) => (!k0.id || !k1.id) && k0.type === k1.type && k0.name === k1.name && k0.feature === k1.feature && (k0.from === k1.from || k0.to === k1.to)); // one end re-pointed
  const out = [];
  for (const k1 of B) {
    const k0 = pairOf.get(k1);
    if (!k0) { out.push({ op: 'added', id: k1.id ?? null, after: k1 }); continue; }
    const changes = fieldChanges(k0, k1, KEY_ORDER.link, []);
    if (changes.length) out.push({ op: 'changed', id: k1.id ?? null, before: k0, after: k1, changes });
  }
  for (const k0 of A) if (!usedA.has(k0)) out.push({ op: 'removed', id: k0.id ?? null, before: k0 });
  return out;
}

// ---------------------------------------------------------------------------
// Map settings: format, meta, view (bounds, grid, background, …), terrain, style, custom root keys

function diffSettings(ctx) {
  const { a, b } = ctx;
  const out = [];
  const section = (name, changes) => { if (changes.length) out.push({ section: name, changes }); };
  section('format', fieldChanges({ format: a.format, version: a.version }, { format: b.format, version: b.version }, ['format', 'version'], []));
  section('meta', fieldChanges(a.meta || {}, b.meta || {}, KEY_ORDER.meta, []));
  const v0 = a.view || {};
  const v1 = b.view || {};
  if (!same(v0.bounds, v1.bounds)) out.push({ section: 'bounds', changes: [{ field: 'bounds', before: v0.bounds, after: v1.bounds }] });
  section('grid', fieldChanges(v0.grid || {}, v1.grid || {}, KEY_ORDER.grid, []));
  if (!same(v0.background, v1.background)) {
    if (!v0.background || !v1.background) out.push({ section: 'background', changes: [{ field: 'background', before: v0.background, after: v1.background }] });
    else section('background', fieldChanges(v0.background, v1.background, KEY_ORDER.background, []));
  }
  section('view', fieldChanges(v0, v1, [], ['bounds', 'grid', 'background']));
  if (!same(a.terrain, b.terrain)) {
    if (!a.terrain || !b.terrain) out.push({ section: 'terrain', changes: [{ field: 'terrain', before: a.terrain, after: b.terrain }] });
    else section('terrain', fieldChanges(a.terrain, b.terrain, KEY_ORDER.terrain, []));
  }
  section('style', fieldChanges(a.style || {}, b.style || {}, KEY_ORDER.style, []));
  const known = ['format', 'version', 'meta', 'view', 'terrain', 'style', 'layers', 'pois', 'links'];
  for (const c of fieldChanges(a, b, [], known)) out.push({ section: 'custom', changes: [c] });
  return out;
}

// ---------------------------------------------------------------------------

/**
 * Structured differences between two maps (raw JSON objects, JSON text or normalised docs).
 * @returns {{ equal: boolean, name: string, units: object, pois: object[], features: object[], links: object[], map: object[] }}
 */
export function diffMaps(oldMap, newMap) {
  const a = normalize(oldMap);
  const b = normalize(newMap);
  const bd = b.view.bounds;
  const near = 0.02 * Math.hypot(bd.max[0] - bd.min[0], bd.max[1] - bd.min[1]);
  const ctx = { a, b, flipY: !!b.meta.flipY, near, idMap: new Map() };
  const pois = diffPois(ctx);
  const features = diffFeatures(ctx);
  const links = diffLinks(ctx);
  const map = diffSettings(ctx);
  const identical = JSON.stringify(a) === JSON.stringify(b);
  if (!identical && !pois.length && !features.length && !links.length && !map.length) {
    map.push({ section: 'other', changes: [] });
  }
  const names = {};
  for (const d of [a, b]) {
    for (const p of d.pois) if (hasId(p)) names[p.id] = p.name || p.id;
    for (const arr of Object.values(d.layers || {})) {
      if (!Array.isArray(arr)) continue;
      for (const f of arr) {
        if (!hasId(f)) continue;
        if (f.name) names[f.id] = f.name;
        for (const g of Array.isArray(f.wall?.gates) ? f.wall.gates : []) if (hasId(g) && g.name) names[g.id] = g.name;
      }
    }
  }
  return {
    equal: identical,
    name: b.meta.name || 'Untitled',
    units: { units: b.meta.units, displayUnit: b.meta.displayUnit, displayUnitScale: b.meta.displayUnitScale, flipY: !!b.meta.flipY },
    names,
    pois,
    features,
    links,
    map,
  };
}

// ---------------------------------------------------------------------------
// Text

function trunc(s, n = 60) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function val(v) {
  if (v === undefined || v === null) return '(none)';
  if (typeof v === 'string') return /^[\w#.-]+$/.test(v) ? v : `"${trunc(v)}"`; // ids, types, colours bare; text quoted
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object' || x === null)) return v.length === 2 && v.every((x) => typeof x === 'number') ? `${v[0]} × ${v[1]}` : `[${v.join(', ')}]`;
  if (typeof v === 'object') return trunc(JSON.stringify(v), 60);
  return String(v);
}

/** Free-text fields: always quoted, so "Test" → "Test 2" reads the same either way. */
const TEXT_FIELDS = new Set(['name', 'description', 'notes', 'anchor', 'src']);
const quoted = (v) => (typeof v === 'string' ? `"${trunc(v)}"` : val(v));

function fmtCoord(v) {
  return Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');
}

/**
 * Text for a diff produced by diffMaps.
 * @param {ReturnType<typeof diffMaps>} diff
 * @param {{format?: 'markdown'|'plain'}} opts
 */
export function formatDiff(diff, opts = {}) {
  const md = (opts.format || 'markdown') !== 'plain';
  const B = (s) => (md ? `**${s}**` : s);
  const C = (s) => (md ? `\`${s}\`` : s);
  const h1 = (s) => (md ? `# ${s}` : `${s}\n${'='.repeat(s.length)}`);
  const h2 = (s) => (md ? `## ${s}` : `${s}\n${'-'.repeat(s.length)}`);
  const meta = diff.units || {};
  const L = (w) => formatLength(w, meta);
  const A = (w) => formatArea(w, meta);
  const ref = (id) => (diff.names?.[id] && diff.names[id] !== id ? `${B(diff.names[id])} (${C(id)})` : C(id));
  const near = (n) => (n ? (n.compass ? `${L(n.distance)} ${n.compass} of ${B(n.name)} (${C(n.id)})` : `at ${B(n.name)} (${C(n.id)})`) : '');
  const change = (label, before, after, show = val) => {
    if (before === undefined) return `${label} set to ${show(after)}`;
    if (after === undefined) return `${label} removed (was ${show(before)})`;
    return `${label} ${show(before)} → ${show(after)}`;
  };
  const LABEL = { color: 'colour' };
  const fieldText = (c, kind) => {
    const label = LABEL[c.field] || c.field;
    if (c.field === 'tags') return `tags ${[...c.added.map((t) => `+${t}`), ...c.removed.map((t) => `−${t}`)].join(' ') || 'reordered'}`;
    if (c.field === 'notes') {
      if (c.before === undefined) return `notes added: "${trunc(c.after, 80)}"`;
      if (c.after === undefined) return 'notes removed';
      return `notes changed: "${trunc(c.after, 80)}"`;
    }
    if (c.field === 'width' && kind === 'feature') return change('width', c.before, c.after, (v) => (typeof v === 'number' ? L(v) : val(v)));
    if (c.field === 'zone' && kind === 'poi') return change('zone field', c.before, c.after, (v) => ref(v));
    if ((c.field === 'from' || c.field === 'to' || c.field === 'feature') && kind === 'link') return change(c.field, c.before, c.after, (v) => ref(v));
    return change(label, c.before, c.after, TEXT_FIELDS.has(c.field) ? quoted : val);
  };
  const where = (w) => [w.phrase, near(w.nearest)].filter(Boolean).join(', ');

  const poiLines = [];
  for (const r of diff.pois) {
    const p = r.after || r.before;
    const lab = `${B(p.name || p.id)} (${C(p.id)})`;
    if (r.op === 'added') {
      const info = `${C(p.id)}, ${p.type}, ${p.status || 'idea'}`;
      if (p.placed === false) poiLines.push(`Added ${B(p.name || p.id)} (${info}), not placed yet — rough position ${where(r.where)}.`);
      else poiLines.push(`Added ${B(p.name || p.id)} (${info}) — ${where(r.where)}.`);
    } else if (r.op === 'removed') {
      poiLines.push(`Removed ${B(p.name || p.id)} (${C(p.id)}, ${p.type}).`);
    } else if (r.op === 'id-changed') {
      poiLines.push(`Changed the id of ${B(p.name || p.id)}: ${C(r.oldId)} → ${C(p.id)}.`);
    } else {
      const rest = [];
      for (const c of r.changes) {
        if (c.field === 'name' && c.before !== undefined && c.after !== undefined) poiLines.push(`Renamed ${B(c.before)} → ${B(c.after)} (${C(p.id)}).`);
        else if (c.field === 'position' && c.rough) poiLines.push(`Moved the rough position of ${lab} ${L(c.distance)} ${c.compass} (still unplaced).`);
        else if (c.field === 'position') {
          let s = `Moved ${lab} ${L(c.distance)} ${c.compass}`;
          s += c.place.label === c.placeBefore.label ? ` — still ${c.place.phrase}.` : ` — now ${c.place.phrase} (was ${c.placeBefore.label}).`;
          if (p.zone && p.zone !== c.zone) s += ` Its ${C('zone')} field still says ${ref(p.zone)}.`;
          poiLines.push(s);
        } else if (c.field === 'placed' && c.after) poiLines.push(`Placed ${lab} on the map — ${where(c.where)}.`);
        else if (c.field === 'placed') poiLines.push(`Unplaced ${lab} — back in the Unplaced list.`);
        else rest.push(fieldText(c, 'poi'));
      }
      if (rest.length) poiLines.push(`Changed ${lab}: ${rest.join('; ')}.`);
    }
  }

  const featLines = [];
  for (const r of diff.features) {
    const f = r.after || r.before;
    const extra = `${r.layer}${f.type ? `, ${f.type}` : ''}`;
    const lab = f.name ? `${B(f.name)} (${C(r.id)}, ${extra})` : `${C(r.id)} (${extra})`;
    const size = (m, v, closed) => (m === 'area' ? `area ${A(v)}` : `${L(v)} long${closed ? ', closed' : ''}`);
    if (r.op === 'added') {
      let s = `Added ${lab} — ${size(r.measure, r.value, f.closed === true)}`;
      if (r.where?.from) s += r.where.from.label === r.where.to.label ? `, ${r.where.from.phrase}` : `, from ${r.where.from.label} to ${r.where.to.label}`;
      else if (r.where) s += `, ${where(r.where)}`;
      if (r.gates.length) s += `; gates: ${r.gates.map((g) => (g.name ? `${g.name} (${C(g.id)})` : C(g.id))).join(', ')}`;
      featLines.push(`${s}.`);
    } else if (r.op === 'removed') {
      featLines.push(`Removed ${lab} — was ${size(r.measure, r.value, f.closed === true)}.`);
    } else if (r.op === 'id-changed') {
      featLines.push(`Changed the id of ${f.name ? B(f.name) : 'a feature'} (${r.layer}): ${C(r.oldId)} → ${C(r.id)}.`);
    } else {
      const rest = [];
      for (const c of r.changes) {
        if (c.field === 'layer') featLines.push(`Moved ${lab} from layer ${C(c.before)} to ${C(c.after)}.`);
        else if (c.field === 'name' && c.before !== undefined && c.after !== undefined) featLines.push(`Renamed ${B(c.before)} → ${B(c.after)} (${C(r.id)}, ${r.layer}).`);
        else if (c.field === 'shape') {
          const parts = [c.points[0] === c.points[1] ? `${c.points[1]} points edited` : `${c.points[0]} → ${c.points[1]} points`];
          const v0 = c.measure === 'area' ? A(c.value[0]) : L(c.value[0]);
          const v1 = c.measure === 'area' ? A(c.value[1]) : L(c.value[1]);
          if (v0 !== v1) parts.push(`${c.measure} ${v0} → ${v1}`);
          if (c.significant) parts.push(`centre moved ${L(c.shift)} ${c.compass}`);
          featLines.push(`Reshaped ${lab} — ${parts.join(', ')}.`);
        } else if (c.field === 'wall') {
          const g = [];
          for (const x of c.gatesAdded) g.push(`added gate ${x.name ? `${B(x.name)} (${C(x.id)})` : C(x.id)}`);
          for (const x of c.gatesRemoved) g.push(`removed gate ${x.name ? `${B(x.name)} (${C(x.id)})` : C(x.id)}`);
          for (const x of c.gatesChanged) g.push(`gate ${C(x.id)}: ${x.changes.map((y) => fieldText(y, 'gate')).join(', ')}`);
          for (const y of c.settings) g.push(fieldText(y, 'wall'));
          if (g.length) rest.push(g.join('; '));
        } else rest.push(fieldText(c, 'feature'));
      }
      if (rest.length) featLines.push(`Changed ${lab}: ${rest.join('; ')}.`);
    }
  }

  const linkLines = [];
  for (const r of diff.links) {
    const k = r.after || r.before;
    const desc = `${k.type} link ${ref(k.from)} → ${ref(k.to)}${k.name ? ` "${k.name}"` : ''}${r.id ? ` (${C(r.id)})` : ''}`;
    if (r.op === 'added') linkLines.push(`Added ${desc}${k.feature ? ` via ${C(k.feature)}` : ''}.`);
    else if (r.op === 'removed') linkLines.push(`Removed ${desc}.`);
    else linkLines.push(`Changed ${desc}: ${r.changes.map((c) => fieldText(c, 'link')).join('; ')}.`);
  }

  const mapLines = [];
  const bounds = (v) => (v?.min && v?.max
    ? `x ${fmtCoord(v.min[0])}…${fmtCoord(v.max[0])}, y ${fmtCoord(v.min[1])}…${fmtCoord(v.max[1])} (${L(v.max[0] - v.min[0])} × ${L(v.max[1] - v.min[1])})`
    : val(v));
  for (const s of diff.map) {
    const list = (fn = fieldText) => s.changes.map((c) => fn(c, s.section)).join('; ');
    if (s.section === 'format') mapLines.push(`Format: ${list()}.`);
    else if (s.section === 'meta') mapLines.push(`Meta: ${list()}.`);
    else if (s.section === 'bounds') mapLines.push(`Bounds: ${bounds(s.changes[0].before)} → ${bounds(s.changes[0].after)}.`);
    else if (s.section === 'grid') mapLines.push(`Grid: ${list((c) => (c.field === 'step' ? change('step', c.before, c.after, (v) => (typeof v === 'number' ? L(v) : val(v))) : fieldText(c)))}.`);
    else if (s.section === 'background') {
      const c = s.changes[0];
      if (c.field === 'background' && c.before === undefined) mapLines.push(`Background: image added (${val(c.after.src)}).`);
      else if (c.field === 'background' && c.after === undefined) mapLines.push(`Background: image removed (was ${val(c.before.src)}).`);
      else mapLines.push(`Background: ${list((x) => (x.field === 'calibration' ? 'calibration changed' : fieldText(x)))}.`);
    } else if (s.section === 'view') mapLines.push(`View: ${list()}.`);
    else if (s.section === 'terrain') {
      const c = s.changes[0];
      const res = (t) => (Array.isArray(t?.resolution) ? `${t.resolution[0]} × ${t.resolution[1]} quads` : 'defaults');
      if (c.field === 'terrain' && c.before === undefined) mapLines.push(`Terrain grid: added (${res(c.after)}).`);
      else if (c.field === 'terrain' && c.after === undefined) mapLines.push('Terrain grid: removed.');
      else mapLines.push(`Terrain grid: ${list((x) => (isObj(x.before) || isObj(x.after) ? `${x.field} changed` : fieldText(x)))}.`);
    } else if (s.section === 'style') mapLines.push(`Style: ${list((x) => (isObj(x.before) || isObj(x.after) ? `${x.field} changed` : fieldText(x)))}.`);
    else if (s.section === 'custom') {
      const c = s.changes[0];
      mapLines.push(`Custom field ${C(c.field)}: ${c.before === undefined ? 'added' : c.after === undefined ? 'removed' : 'changed'}.`);
    } else mapLines.push('Other changes (not itemised; compare the files directly).');
  }

  if (!poiLines.length && !featLines.length && !linkLines.length && !mapLines.length) return 'No changes.\n';

  const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const out = [h1(`Changes: ${diff.name}`), ''];
  out.push(`${[count(diff.pois.length, 'POI change'), count(diff.features.length, 'feature change'), count(diff.links.length, 'link change'), count(diff.map.length, 'map setting change')].join(', ')}.`);
  out.push('');
  const group = (title, lines) => {
    if (!lines.length) return;
    out.push(h2(title), '', ...lines.map((l) => `- ${l}`), '');
  };
  group(`POIs (${diff.pois.length})`, poiLines);
  group(`Features (${diff.features.length})`, featLines);
  group(`Links (${diff.links.length})`, linkLines);
  group(`Map (${diff.map.length})`, mapLines);
  return `${out.join('\n').trimEnd()}\n`;
}

/**
 * Readable summary of what changed from `oldMap` to `newMap`.
 * @param {{format?: 'markdown'|'plain'}} opts
 */
export function diffText(oldMap, newMap, opts = {}) {
  return formatDiff(diffMaps(oldMap, newMap), opts);
}
