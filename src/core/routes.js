// Road network, shortest routes and "what lies on the way" (rivers, faults,
// cliffs, ridges, water) for agents and the editor.
// Pure module: no DOM, no dependencies.
//
//   buildNetwork(doc, opts)          graph of roads / rails / bridges
//   nearestOnNetwork(network, p)     closest point on any edge
//   route(doc, fromId, toId, opts)   shortest path between POIs / gates
//   crossings(doc, polyline, opts)   obstacles crossed by a polyline
//   describeRoute(doc, from, to)     one English line for agents

import { distance, featureGeometry, nearestOnSegment, pointInPolygon, wallLayout } from './geometry.js';
import { findById } from './model.js';
import { formatLength as defaultFormatLength } from './text-export.js';

/** Layers that make up the network by default. */
export const NETWORK_LAYERS = ['roads', 'rails', 'bridges'];

/** relief `type` -> crossing kind. Ridges are reported but are not obstacles. */
const RELIEF_KINDS = { fault: 'fault', cliff: 'cliff', ridge: 'ridge' };

/** Crossing kinds that a bridge can span (everything but ridges). */
export const OBSTACLE_KINDS = ['river', 'fault', 'cliff', 'water'];

/** Layer -> travel mode. Features of different modes only connect where an endpoint snaps. */
export function layerMode(layer) {
  return layer === 'rails' ? 'rail' : 'road';
}

/** Default snapping tolerance: max(300, 0.0005 × longest side of view.bounds), world units. */
export function defaultTolerance(doc) {
  const b = doc?.view?.bounds;
  let side = 0;
  if (b && Array.isArray(b.min) && Array.isArray(b.max)) {
    side = Math.max(Math.abs(b.max[0] - b.min[0]), Math.abs(b.max[1] - b.min[1]));
  }
  return Math.max(300, 0.0005 * (Number.isFinite(side) ? side : 0));
}

/**
 * Intersection of segments ab and cd (endpoints included).
 * @returns {{point: number[], t: number, u: number} | null} t along ab, u along cd; null when parallel or apart
 */
export function segmentIntersection(a, b, c, d) {
  const rx = b[0] - a[0]; const ry = b[1] - a[1];
  const sx = d[0] - c[0]; const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (den === 0 || Math.abs(den) <= 1e-12 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null;
  const qx = c[0] - a[0]; const qy = c[1] - a[1];
  let t = (qx * sy - qy * sx) / den;
  let u = (qx * ry - qy * rx) / den;
  const e = 1e-9;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
  t = Math.max(0, Math.min(1, t));
  u = Math.max(0, Math.min(1, u));
  return { point: [a[0] + t * rx, a[1] + t * ry], t, u };
}

// ---------------------------------------------------------------------------
// Spatial index: uniform grid of segment ids

class SegmentGrid {
  constructor(cell) {
    this.cell = cell > 0 ? cell : 1;
    this.inv = 1 / this.cell;
    this.cells = new Map();
    this.stamp = [];
    this.q = 0;
    this.count = 0;
  }

  static key(cx, cy) {
    return (cx + 1048576) * 2097152 + (cy + 1048576);
  }

  /** Calls fn(key) for the cells covered by segment ab grown by pad (walked in cell-sized steps). */
  cellsOf(a, b, pad, fn) {
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) * this.inv));
    const inv = this.inv;
    for (let k = 0; k < n; k++) {
      const x0 = a[0] + (dx * k) / n; const y0 = a[1] + (dy * k) / n;
      const x1 = a[0] + (dx * (k + 1)) / n; const y1 = a[1] + (dy * (k + 1)) / n;
      const cx0 = Math.floor((Math.min(x0, x1) - pad) * inv); const cx1 = Math.floor((Math.max(x0, x1) + pad) * inv);
      const cy0 = Math.floor((Math.min(y0, y1) - pad) * inv); const cy1 = Math.floor((Math.max(y0, y1) + pad) * inv);
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) fn(SegmentGrid.key(cx, cy));
    }
  }

  insert(id, a, b) {
    if (id >= this.count) this.count = id + 1;
    this.cellsOf(a, b, 0, (key) => {
      let arr = this.cells.get(key);
      if (!arr) this.cells.set(key, (arr = []));
      if (arr[arr.length - 1] !== id) arr.push(id);
    });
  }

  /** Calls fn(id) once for every segment that may lie within `pad` of segment ab. */
  query(a, b, pad, fn) {
    const q = ++this.q;
    const stamp = this.stamp;
    const dx = Math.abs(b[0] - a[0]); const dy = Math.abs(b[1] - a[1]);
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) * this.inv));
    const estimate = n * ((dx / n + 2 * pad) * this.inv + 2) * ((dy / n + 2 * pad) * this.inv + 2);
    if (estimate > 4 * this.cells.size + 64) {
      for (let id = 0; id < this.count; id++) fn(id);
      return;
    }
    this.cellsOf(a, b, pad, (key) => {
      const arr = this.cells.get(key);
      if (!arr) return;
      for (let i = 0; i < arr.length; i++) {
        const id = arr[i];
        if (stamp[id] === q) continue;
        stamp[id] = q;
        fn(id);
      }
    });
  }
}

function cleanPoints(points) {
  const out = [];
  for (const p of points || []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push([p[0], p[1]]);
  }
  return out;
}

/** Drawn geometry of a line/polygon feature as an explicit polyline (rings end with their first point). */
function featurePolyline(f) {
  const pts = cleanPoints(featureGeometry(f));
  const closed = f.kind === 'polygon' || f.closed === true;
  if (closed && pts.length > 2) {
    const a = pts[0]; const z = pts[pts.length - 1];
    if (a[0] !== z[0] || a[1] !== z[1]) pts.push(a.slice());
  }
  return { pts, closed: closed && pts.length > 3 };
}

// ---------------------------------------------------------------------------
// Network

/**
 * Graph of the travel network.
 * @returns {{tolerance: number, nodes: number[][], edges: {id, u, v, a, b, length, featureId, layer, mode}[],
 *            adj: number[][], grid: SegmentGrid, bounds: {min, max} | null, layers: string[]}}
 */
export function buildNetwork(doc, { layers = NETWORK_LAYERS, tolerance } = {}) {
  const tol = tolerance > 0 ? tolerance : defaultTolerance(doc);
  const eps = 1e-6 * tol;

  // nodes + union-find
  const px = []; const py = []; const parent = [];
  const addNode = (x, y) => { const id = px.length; px.push(x); py.push(y); parent.push(id); return id; };
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (a, b) => {
    a = find(a); b = find(b);
    if (a === b) return;
    if (a < b) parent[b] = a; else parent[a] = b;
  };

  const feats = []; // { id, layer, mode }
  const segs = []; // { fi, a, b, na, nb, len, splits }
  const ends = []; // open line endpoints: { node, p, fi, other }
  let totalLen = 0;
  for (const layer of layers) {
    const mode = layerMode(layer);
    for (const f of doc?.layers?.[layer] || []) {
      if (!f || !Array.isArray(f.points) || f.points.length < 2) continue;
      const { pts, closed } = featurePolyline(f);
      if (pts.length < 2) continue;
      const fi = feats.length;
      feats.push({ id: f.id, layer, mode });
      const nodes = pts.map((p, i) => (closed && i === pts.length - 1 ? -1 : addNode(p[0], p[1])));
      if (closed) nodes[nodes.length - 1] = nodes[0];
      for (let i = 0; i < pts.length - 1; i++) {
        const len = distance(pts[i], pts[i + 1]);
        totalLen += len;
        segs.push({ fi, a: pts[i], b: pts[i + 1], na: nodes[i], nb: nodes[i + 1], len, splits: null });
      }
      if (!closed) {
        const first = { node: nodes[0], p: pts[0], fi };
        const last = { node: nodes[nodes.length - 1], p: pts[pts.length - 1], fi };
        first.other = last; last.other = first;
        ends.push(first, last);
      }
    }
  }

  const cell = Math.max(2 * tol, segs.length ? totalLen / segs.length : 1);
  const segGrid = new SegmentGrid(cell);
  segs.forEach((s, i) => segGrid.insert(i, s.a, s.b));

  // A point of segment si at parameter t belongs to node n.
  const attach = (si, t, n) => {
    const s = segs[si];
    if (t * s.len <= eps) union(n, s.na);
    else if ((1 - t) * s.len <= eps) union(n, s.nb);
    else (s.splits || (s.splits = [])).push([t, n]);
  };

  // proper crossings of different features within the same mode
  const pad = 1e-6 * cell;
  for (let i = 0; i < segs.length; i++) {
    const si = segs[i];
    const mode = feats[si.fi].mode;
    segGrid.query(si.a, si.b, pad, (j) => {
      if (j <= i) return;
      const sj = segs[j];
      if (sj.fi === si.fi || feats[sj.fi].mode !== mode) return;
      const hit = segmentIntersection(si.a, si.b, sj.a, sj.b);
      if (!hit) return;
      const n = addNode(hit.point[0], hit.point[1]);
      attach(i, hit.t, n);
      attach(j, hit.u, n);
    });
  }

  // endpoint snapping (any mode): to the nearest segment of every other feature within tolerance
  for (const e of ends) {
    const best = new Map(); // fi -> { d, j, t }
    segGrid.query(e.p, e.p, tol, (j) => {
      const s = segs[j];
      if (s.fi === e.fi) return;
      const r = nearestOnSegment(e.p, s.a, s.b);
      if (r.dist > tol) return;
      const cur = best.get(s.fi);
      if (!cur || r.dist < cur.d) best.set(s.fi, { d: r.dist, j, t: r.t });
    });
    for (const { j, t } of best.values()) attach(j, t, e.node);
    // a line drawn as a loop without `closed`
    if (e.other && e.other !== e && distance(e.p, e.other.p) <= tol) union(e.node, e.other.node);
  }

  // compact nodes and build edges
  const index = new Map();
  const nodes = [];
  const nodeOf = (n) => {
    const r = find(n);
    let k = index.get(r);
    if (k === undefined) { k = nodes.length; index.set(r, k); nodes.push([px[r], py[r]]); }
    return k;
  };
  const edges = [];
  const adj = [];
  for (const s of segs) {
    const list = [[0, s.na]];
    if (s.splits) {
      s.splits.sort((x, y) => x[0] - y[0]);
      for (const sp of s.splits) list.push(sp);
    }
    list.push([1, s.nb]);
    const f = feats[s.fi];
    for (let k = 0; k < list.length - 1; k++) {
      const u = nodeOf(list[k][1]);
      const v = nodeOf(list[k + 1][1]);
      if (u === v) continue;
      const t0 = list[k][0]; const t1 = list[k + 1][0];
      const a = [s.a[0] + (s.b[0] - s.a[0]) * t0, s.a[1] + (s.b[1] - s.a[1]) * t0];
      const b = [s.a[0] + (s.b[0] - s.a[0]) * t1, s.a[1] + (s.b[1] - s.a[1]) * t1];
      edges.push({ id: edges.length, u, v, a, b, length: distance(a, b), featureId: f.id, layer: f.layer, mode: f.mode });
    }
  }
  for (let i = 0; i < nodes.length; i++) adj.push([]);
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const grid = new SegmentGrid(cell);
  for (const e of edges) {
    adj[e.u].push(e.id);
    adj[e.v].push(e.id);
    grid.insert(e.id, e.a, e.b);
    for (const p of [e.a, e.b]) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
  }
  return {
    tolerance: tol,
    layers: [...layers],
    nodes,
    edges,
    adj,
    grid,
    bounds: edges.length ? { min: [x0, y0], max: [x1, y1] } : null,
  };
}

/** Closest point of the network to `point`: { point, dist, edge, t } or null for an empty network. */
export function nearestOnNetwork(network, point) {
  if (!network || !network.edges.length) return null;
  const { edges, grid, bounds } = network;
  let best = null;
  const test = (id) => {
    const e = edges[id];
    const h = nearestOnSegment(point, e.a, e.b);
    if (!best || h.dist < best.dist) best = { point: h.point, dist: h.dist, edge: e, t: h.t };
  };
  const far = Math.max(
    Math.abs(point[0] - bounds.min[0]), Math.abs(point[0] - bounds.max[0]),
    Math.abs(point[1] - bounds.min[1]), Math.abs(point[1] - bounds.max[1]),
  );
  for (let r = grid.cell; ; r *= 2) {
    grid.query(point, point, r, test);
    if (best && best.dist <= r) return best;
    if (r > far + grid.cell) return best;
  }
}

// ---------------------------------------------------------------------------
// Routing

/** Position of a POI (placed) or wall gate: { point, name, kind } or null. */
export function endpointOf(doc, id) {
  const hit = findById(doc, id);
  if (!hit) return null;
  if (hit.kind === 'poi') {
    const p = hit.item;
    if (p.placed === false || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return { point: [p.x, p.y], name: p.name || p.id, kind: 'poi' };
  }
  if (hit.kind === 'gate') {
    const g = wallLayout(hit.feature).gates.find((x) => x.id === id);
    if (!g) return null;
    return { point: g.point, name: hit.item.name || id, kind: 'gate' };
  }
  return null;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }

  get size() { return this.k.length; }

  push(key, val) {
    const k = this.k; const v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }

  pop() {
    const k = this.k; const v = this.v;
    const topK = k[0]; const topV = v[0];
    const lastK = k.pop(); const lastV = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    this.topKey = topK;
    return topV;
  }
}

/**
 * Shortest route along the network between two POIs / gates.
 * opts: { layers, tolerance, maxAccess, network (prebuilt, optional) }
 * @returns {null | {ok: false, reason: 'noRoadNear'|'disconnected', …} | {ok: true, length, straight, access, path,
 *           features, layersUsed, edges, crossings}}
 */
export function route(doc, fromId, toId, opts = {}) {
  const A = endpointOf(doc, fromId);
  const B = endpointOf(doc, toId);
  if (!A || !B) return null;
  const tol = opts.tolerance > 0 ? opts.tolerance : (opts.network?.tolerance || defaultTolerance(doc));
  const net = opts.network || buildNetwork(doc, { layers: opts.layers, tolerance: tol });
  const straight = distance(A.point, B.point);
  const maxAccess = opts.maxAccess >= 0 ? opts.maxAccess : Math.max(0.1 * straight, 2 * tol);

  const na = nearestOnNetwork(net, A.point);
  if (!na || na.dist > maxAccess) {
    return { ok: false, reason: 'noRoadNear', which: 'from', id: fromId, dist: na ? na.dist : null, straight, maxAccess };
  }
  const nb = nearestOnNetwork(net, B.point);
  if (!nb || nb.dist > maxAccess) {
    return { ok: false, reason: 'noRoadNear', which: 'to', id: toId, dist: nb ? nb.dist : null, straight, maxAccess };
  }

  const e0 = na.edge; const e1 = nb.edge;
  const n = net.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const seed = (node, d) => { if (d < dist[node]) { dist[node] = d; heap.push(d, node); } };
  seed(e0.u, na.dist + distance(na.point, e0.a));
  seed(e0.v, na.dist + distance(na.point, e0.b));

  let best = Infinity;
  let end = null; // { node, at: point of e1 at that node } or 'direct'
  if (e0 === e1) { best = na.dist + distance(na.point, nb.point) + nb.dist; end = 'direct'; }
  const tailA = distance(e1.a, nb.point) + nb.dist;
  const tailB = distance(e1.b, nb.point) + nb.dist;
  const { edges, adj } = net;
  while (heap.size) {
    const x = heap.pop();
    const d = heap.topKey;
    if (d > dist[x]) continue;
    if (d >= best) break;
    if (x === e1.u && d + tailA < best) { best = d + tailA; end = { node: x, at: e1.a }; }
    if (x === e1.v && d + tailB < best) { best = d + tailB; end = { node: x, at: e1.b }; }
    for (const ei of adj[x]) {
      const e = edges[ei];
      const y = e.u === x ? e.v : e.u;
      const nd = d + e.length;
      if (nd < dist[y]) { dist[y] = nd; prev[y] = ei; heap.push(nd, y); }
    }
  }
  if (!end) return { ok: false, reason: 'disconnected', straight };

  // path reconstruction
  const used = []; // edges in travel order (partial first / last included when travelled)
  const path = [A.point.slice(), na.point.slice()];
  const push = (p) => {
    const last = path[path.length - 1];
    if (distance(last, p) > 1e-9) path.push(p.slice());
  };
  if (end === 'direct') {
    used.push(e0);
    push(nb.point);
  } else {
    const chain = [];
    let x = end.node;
    while (prev[x] !== -1) {
      const e = edges[prev[x]];
      chain.push(e);
      x = e.u === x ? e.v : e.u;
    }
    chain.reverse();
    const startAt = x === e0.u ? e0.a : e0.b;
    if (distance(na.point, startAt) > 1e-6) used.push(e0);
    push(startAt);
    let cur = x;
    for (const e of chain) {
      if (e.u === cur) { push(e.a); push(e.b); cur = e.v; } else { push(e.b); push(e.a); cur = e.u; }
      used.push(e);
    }
    push(end.at);
    if (distance(end.at, nb.point) > 1e-6) used.push(e1);
    push(nb.point);
  }
  push(B.point);

  const features = [];
  const layersUsed = [];
  for (const e of used) {
    if (features[features.length - 1] !== e.featureId) features.push(e.featureId);
    if (!layersUsed.includes(e.layer)) layersUsed.push(e.layer);
  }
  const bridgeEdges = used.filter((e) => e.layer === 'bridges');
  return {
    ok: true,
    length: best,
    straight,
    access: [na.dist, nb.dist],
    path,
    features,
    layersUsed,
    edges: used.map((e) => e.id),
    crossings: crossings(doc, path, { tolerance: tol, bridgedBy: bridgeEdges }),
  };
}

// ---------------------------------------------------------------------------
// Crossings

function obstacleFeatures(doc) {
  const out = [];
  for (const f of doc?.layers?.rivers || []) out.push({ kind: 'river', f, polygon: false });
  for (const f of doc?.layers?.relief || []) {
    const kind = RELIEF_KINDS[f?.type];
    if (kind) out.push({ kind, f, polygon: false });
  }
  for (const f of doc?.layers?.water || []) out.push({ kind: 'water', f, polygon: true });
  return out.filter((o) => o.f && Array.isArray(o.f.points) && o.f.points.length >= (o.polygon ? 3 : 2));
}

function bboxOf(pts) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

const boxesOverlap = (a, b, pad) => a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];

function distToSeg(p, a, b) {
  return nearestOnSegment(p, a, b).dist;
}

/**
 * Rivers, faults, cliffs, ridges and water bodies crossed by a polyline, sorted by distance along it.
 * opts.bridgedBy: bridge edges the polyline travels on ({a, b, featureId}), bridge feature ids or bridge features.
 * @returns {{kind, featureId, name, type, point, at, bridge, bridgeName}[]}
 */
export function crossings(doc, polyline, { tolerance, bridgedBy = [] } = {}) {
  const tol = tolerance > 0 ? tolerance : defaultTolerance(doc);
  const pts = cleanPoints(polyline);
  if (pts.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distance(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const pointAt = (s) => {
    let lo = 0; let hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const L = cum[hi] - cum[lo];
    const t = L > 0 ? (s - cum[lo]) / L : 0;
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
  };

  const grid = new SegmentGrid(Math.max(2 * tol, total / (pts.length - 1)));
  for (let i = 0; i < pts.length - 1; i++) grid.insert(i, pts[i], pts[i + 1]);
  const routeBox = bboxOf(pts);

  // bridges
  const bridgeFeatures = new Map();
  for (const f of doc?.layers?.bridges || []) if (f?.id) bridgeFeatures.set(f.id, f);
  const reachOf = (f) => Math.max(tol, f && f.width > 0 ? f.width / 2 : 0);
  const bridgeSegs = [];
  for (const f of bridgeFeatures.values()) {
    const { pts: g } = featurePolyline(f);
    for (let i = 0; i < g.length - 1; i++) bridgeSegs.push({ featureId: f.id, a: g[i], b: g[i + 1], reach: reachOf(f) });
    if (g.length === 1) bridgeSegs.push({ featureId: f.id, a: g[0], b: g[0], reach: reachOf(f) });
  }
  const travelled = [];
  for (const b of bridgedBy || []) {
    if (!b) continue;
    if (typeof b === 'string' || (b.points && !b.a)) {
      const id = typeof b === 'string' ? b : b.id;
      for (const s of bridgeSegs) if (s.featureId === id) travelled.push(s);
    } else if (b.a && b.b) {
      travelled.push({ featureId: b.featureId ?? null, a: b.a, b: b.b, reach: reachOf(bridgeFeatures.get(b.featureId)) });
    }
  }
  const bridgeAt = (p) => {
    let bestId = null; let bestD = Infinity;
    for (const list of [travelled, bridgeSegs]) {
      for (const s of list) {
        const d = distToSeg(p, s.a, s.b);
        if (d <= s.reach && d < bestD) { bestD = d; bestId = s.featureId; }
      }
      if (bestD < Infinity) break; // a bridge the route travels on wins
    }
    return bestD < Infinity ? bestId : null;
  };

  const out = [];
  for (const { kind, f, polygon } of obstacleFeatures(doc)) {
    const { pts: g } = featurePolyline(polygon ? { ...f, kind: 'polygon' } : f);
    if (g.length < 2 || !boxesOverlap(bboxOf(g), routeBox, tol)) continue;
    let hits = [];
    for (let k = 0; k < g.length - 1; k++) {
      const c = g[k]; const d = g[k + 1];
      grid.query(c, d, 1e-6 * grid.cell, (j) => {
        const h = segmentIntersection(pts[j], pts[j + 1], c, d);
        if (h) hits.push({ at: cum[j] + h.t * (cum[j + 1] - cum[j]), point: h.point });
      });
    }
    if (!hits.length) continue;
    hits.sort((x, y) => x.at - y.at);
    if (polygon) {
      // keep entries: the stretch after the hit (up to the next hit) is inside the polygon
      const ring = g.slice(0, -1);
      const uniq = hits.filter((h, i) => i === 0 || h.at - hits[i - 1].at > 1e-6 * tol);
      hits = uniq.filter((h, i) => {
        const next = i + 1 < uniq.length ? uniq[i + 1].at : total;
        if (next - h.at <= 0) return false;
        return pointInPolygon(pointAt((h.at + next) / 2), ring);
      });
    }
    let lastAt = -Infinity;
    for (const h of hits) {
      if (h.at - lastAt < tol) continue; // same crossing hit twice (vertex, wiggle)
      lastAt = h.at;
      const bridge = kind === 'ridge' ? null : bridgeAt(h.point);
      out.push({
        kind,
        featureId: f.id,
        name: f.name || null,
        type: f.type || null,
        point: h.point,
        at: h.at,
        bridge,
        bridgeName: bridge ? (bridgeFeatures.get(bridge)?.name || null) : null,
      });
    }
  }
  out.sort((x, y) => x.at - y.at);
  return out;
}

// ---------------------------------------------------------------------------
// Text

const KIND_WORD = { river: 'river', fault: 'fault', cliff: 'cliff', ridge: 'ridge', water: 'water' };

function crossingPhrase(c) {
  const name = c.name || c.featureId;
  const word = KIND_WORD[c.kind] || c.kind;
  const named = c.name && c.name.toLowerCase().includes(word);
  const notes = [];
  if (!named) notes.push(word);
  if (c.kind !== 'ridge' && !c.bridge) notes.push('no bridge');
  let s = name;
  if (notes.length) s += ` (${notes.join(', ')})`;
  if (c.bridge) s += ` by ${c.bridgeName || `bridge ${c.bridge}`}`;
  return s;
}

/**
 * One English line for agents, e.g.
 * "3.4 km by road (straight 2.1 km, 1.6×) via Miners Road, King's Road; crosses Black River by Stone Bridge, Great Fault (no bridge)".
 * opts: { formatLength(worldLen, meta), layers, tolerance, maxAccess, network }
 */
export function describeRoute(doc, fromId, toId, opts = {}) {
  const fmt = opts.formatLength || defaultFormatLength;
  const L = (w) => fmt(w, doc?.meta || {});
  const label = (id) => {
    const hit = findById(doc, id);
    return hit ? (hit.item.name || id) : id;
  };
  const res = route(doc, fromId, toId, opts);
  if (!res) {
    for (const id of [fromId, toId]) {
      if (!findById(doc, id)) return `unknown place "${id}"`;
      if (!endpointOf(doc, id)) return `${label(id)} is not placed on the map`;
    }
    return 'no route';
  }
  if (!res.ok) {
    if (res.reason === 'noRoadNear') {
      const who = label(res.which === 'from' ? fromId : toId);
      return res.dist === null ? `no roads on the map (straight ${L(res.straight)})` : `no road near ${who} (${L(res.dist)} away)`;
    }
    return `no road connection (straight ${L(res.straight)})`;
  }
  const lookup = new Map();
  for (const l of opts.layers || NETWORK_LAYERS) for (const f of doc?.layers?.[l] || []) if (f?.id) lookup.set(f.id, { f, l });
  const rail = res.layersUsed.includes('rails');
  const road = res.layersUsed.some((l) => l !== 'rails');
  const by = rail && road ? 'by road and rail' : rail ? 'by rail' : 'by road';
  let s = `${L(res.length)} ${by}`;
  if (res.straight > 0) s += ` (straight ${L(res.straight)}, ${(res.length / res.straight).toFixed(1)}×)`;
  const via = [];
  for (const id of res.features) {
    const hit = lookup.get(id);
    if (hit?.l === 'bridges') continue;
    const name = hit?.f.name || id;
    if (!via.includes(name)) via.push(name);
  }
  if (via.length) s += ` via ${via.join(', ')}`;
  const off = res.access[0] + res.access[1];
  const tol = opts.tolerance > 0 ? opts.tolerance : defaultTolerance(doc);
  if (off > Math.max(2 * tol, 0.05 * res.length)) s += `, incl. ${L(off)} off-road`;
  if (res.crossings.length) s += `; crosses ${res.crossings.map(crossingPhrase).join(', ')}`;
  return s;
}
