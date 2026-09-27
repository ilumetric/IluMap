// Pure 2D geometry helpers. Points are [x, y] arrays in world units.

const DEG = 180 / Math.PI;

export function distance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Compass bearing from a to b in degrees, clockwise from north (0 = N, 90 = E).
 * North is "up on screen": -y when flipY is false (image-like), +y when flipY is true (engine-like).
 */
export function bearing(a, b, flipY = false) {
  const dx = b[0] - a[0];
  const dn = flipY ? b[1] - a[1] : a[1] - b[1];
  if (dx === 0 && dn === 0) return 0;
  const d = Math.atan2(dx, dn) * DEG;
  return (d + 360) % 360;
}

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass8(deg) {
  const d = ((deg % 360) + 360) % 360;
  return COMPASS8[Math.round(d / 45) % 8];
}

function segments(points, closed) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n - 1; i++) out.push([points[i], points[i + 1], i]);
  if (closed && n > 2) out.push([points[n - 1], points[0], n - 1]);
  return out;
}

export function polylineLength(points, closed = false) {
  let len = 0;
  for (const [a, b] of segments(points, closed)) len += distance(a, b);
  return len;
}

/** Signed area (shoelace). Positive when counter-clockwise in a y-up frame. */
export function signedArea(points) {
  let s = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function polygonArea(points) {
  return Math.abs(signedArea(points));
}

export function centroid(points) {
  const n = points.length;
  if (n === 0) return [0, 0];
  const A = signedArea(points);
  if (Math.abs(A) < 1e-9) {
    let x = 0; let y = 0;
    for (const p of points) { x += p[0]; y += p[1]; }
    return [x / n, y / n];
  }
  let cx = 0; let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const f = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * f;
    cy += (a[1] + b[1]) * f;
  }
  return [cx / (6 * A), cy / (6 * A)];
}

export function bbox(points) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { min: [x0, y0], max: [x1, y1] };
}

/** Even-odd ray casting. */
export function pointInPolygon(p, poly) {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point on segment ab to p: {point, dist, t}. */
export function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const point = [a[0] + t * dx, a[1] + t * dy];
  return { point, dist: distance(p, point), t };
}

export function distToSegment(p, a, b) {
  return nearestOnSegment(p, a, b).dist;
}

/** Nearest point on a polyline: {point, dist, segIndex, t} (t is the fraction along that segment). */
export function nearestPointOnPolyline(p, points, closed = false) {
  let best = null;
  if (points.length === 1) return { point: points[0].slice(), dist: distance(p, points[0]), segIndex: 0, t: 0 };
  for (const [a, b, i] of segments(points, closed)) {
    const r = nearestOnSegment(p, a, b);
    if (!best || r.dist < best.dist) best = { point: r.point, dist: r.dist, segIndex: i, t: r.t };
  }
  return best;
}

/**
 * Point and tangent angle at arc-length distance s along the polyline.
 * @returns {{point: number[], angle: number, segIndex: number}} angle in radians (atan2(dy, dx) in the same frame as the points)
 */
export function atDistance(points, s, closed = false) {
  const segs = segments(points, closed);
  if (segs.length === 0) return { point: (points[0] || [0, 0]).slice(), angle: 0, segIndex: 0 };
  let acc = 0;
  for (const [a, b, i] of segs) {
    const L = distance(a, b);
    if (acc + L >= s || i === segs[segs.length - 1][2]) {
      const t = L === 0 ? 0 : Math.max(0, Math.min(1, (s - acc) / L));
      return {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
        segIndex: i,
      };
    }
    acc += L;
  }
  return { point: points[0].slice(), angle: 0, segIndex: 0 };
}

/** Point at fraction t (0..1) of the total length. */
export function pointAlong(points, t, closed = false) {
  return atDistance(points, t * polylineLength(points, closed), closed).point;
}

/** Arc length from the start to vertex i. */
export function lengthToVertex(points, i) {
  let s = 0;
  for (let k = 0; k < i && k < points.length - 1; k++) s += distance(points[k], points[k + 1]);
  return s;
}

/** Points every `spacing` world units along the polyline (includes the start; includes the end for open lines). */
export function resample(points, spacing, closed = false) {
  const L = polylineLength(points, closed);
  if (!(spacing > 0) || L === 0) return points.map((p) => p.slice());
  const n = Math.max(1, Math.floor(L / spacing + 1e-9));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const s = k * spacing;
    if (closed && k === n && Math.abs(s - L) < 1e-6) break;
    out.push(atDistance(points, Math.min(s, L), closed).point);
  }
  if (!closed) {
    const last = points[points.length - 1];
    const tail = out[out.length - 1];
    if (distance(last, tail) > spacing * 0.25) out.push(last.slice());
  }
  return out;
}

const r2 = (v) => {
  const x = Math.round(v * 100) / 100;
  return Object.is(x, -0) ? 0 : x;
};

/**
 * Uniform Catmull-Rom spline through the points as an SVG path "d".
 * Points should already be in the SVG user space (the caller applies any y flip).
 */
export function catmullRomToPath(points, closed = false) {
  const n = points.length;
  if (n === 0) return '';
  if (n < 3) return linearPath(points, closed);
  const P = (i) => {
    if (closed) return points[((i % n) + n) % n];
    return points[Math.max(0, Math.min(n - 1, i))];
  };
  let d = `M${r2(points[0][0])} ${r2(points[0][1])}`;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const p0 = P(i - 1); const p1 = P(i); const p2 = P(i + 1); const p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${r2(p2[0])} ${r2(p2[1])}`;
  }
  if (closed) d += 'Z';
  return d;
}

export function linearPath(points, closed = false) {
  if (points.length === 0) return '';
  let d = `M${r2(points[0][0])} ${r2(points[0][1])}`;
  for (let i = 1; i < points.length; i++) d += `L${r2(points[i][0])} ${r2(points[i][1])}`;
  if (closed) d += 'Z';
  return d;
}

/** Densify a Catmull-Rom curve into a polyline (same curve as catmullRomToPath). */
export function catmullRomSample(points, closed = false, perSegment = 8) {
  const n = points.length;
  if (n < 3) return points.map((p) => p.slice());
  const P = (i) => (closed ? points[((i % n) + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  const out = [];
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const p0 = P(i - 1); const p1 = P(i); const p2 = P(i + 1); const p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      const u = 1 - t;
      out.push([
        u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
        u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1],
      ]);
    }
  }
  if (!closed) out.push(points[n - 1].slice());
  return out;
}

/**
 * The geometry actually drawn for a feature: smooth features are densified.
 * Polygons are returned as an open ring (implicitly closed).
 */
export function featureGeometry(feature, perSegment = 8) {
  const pts = feature.points || [];
  const closed = feature.kind === 'polygon' || feature.closed === true;
  return feature.smooth ? catmullRomSample(pts, closed, perSegment) : pts.map((p) => p.slice());
}

/**
 * Wall layout: tower positions and gate positions along a wall feature.
 * @returns {{length: number, closed: boolean, towers: {point, angle}[], gates: {id, name, point, angle, s, width}[]}}
 */
export function wallLayout(feature) {
  const pts = feature.points || [];
  const closed = feature.closed === true;
  const w = feature.wall || {};
  const mode = w.towers || 'vertices';
  const size = w.towerSize > 0 ? w.towerSize : 600;
  const length = polylineLength(pts, closed);
  const towers = [];
  if (pts.length >= 2 && mode !== 'none') {
    if (mode === 'vertices') {
      pts.forEach((p, i) => {
        const prev = pts[i - 1] || (closed ? pts[pts.length - 1] : p);
        const next = pts[i + 1] || (closed ? pts[0] : p);
        towers.push({ point: p.slice(), angle: Math.atan2(next[1] - prev[1], next[0] - prev[0]) });
      });
    } else {
      const spacing = w.towerSpacing > 0 ? w.towerSpacing : 5000;
      const count = closed ? Math.max(3, Math.round(length / spacing)) : Math.max(1, Math.round(length / spacing));
      const step = length / count;
      const last = closed ? count - 1 : count;
      for (let k = 0; k <= last; k++) {
        const r = atDistance(pts, Math.min(k * step, length), closed);
        towers.push({ point: r.point, angle: r.angle });
      }
    }
  }
  const gates = [];
  for (const g of w.gates || []) {
    let s;
    if (Number.isInteger(g.at)) s = lengthToVertex(pts, Math.max(0, Math.min(pts.length - 1, g.at)));
    else s = (typeof g.t === 'number' ? g.t : 0) * length;
    const r = atDistance(pts, s, closed);
    gates.push({ id: g.id, name: g.name, point: r.point, angle: r.angle, s, width: size * 1.2 });
  }
  return { length, closed, towers, gates };
}

/**
 * Split a polyline into pieces with gaps removed. gaps: [{s, width}] in arc length.
 * Returns an array of open polylines.
 */
export function cutGaps(points, closed, gaps) {
  const pts = closed && points.length > 2 ? [...points, points[0]] : points;
  const L = polylineLength(pts, false);
  if (!gaps.length) return [pts.map((p) => p.slice())];
  let intervals = gaps
    .map((g) => [g.s - g.width / 2, g.s + g.width / 2])
    .flatMap(([a, b]) => {
      if (!closed) return [[Math.max(0, a), Math.min(L, b)]];
      const out = [];
      if (a < 0) { out.push([0, b]); out.push([L + a, L]); } else if (b > L) { out.push([a, L]); out.push([0, b - L]); } else out.push([a, b]);
      return out;
    })
    .sort((x, y) => x[0] - y[0]);
  // merge
  const merged = [];
  for (const iv of intervals) {
    if (merged.length && iv[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
    else merged.push(iv.slice());
  }
  intervals = merged;
  // keep ranges
  const keep = [];
  let cur = 0;
  for (const [a, b] of intervals) {
    if (a > cur) keep.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < L) keep.push([cur, L]);
  // for closed walls join the last and first piece
  if (closed && keep.length > 1 && keep[0][0] === 0 && keep[keep.length - 1][1] === L) {
    const last = keep.pop();
    keep[0] = [last[0] - L, keep[0][1]];
  }
  return keep.map(([a, b]) => subPolyline(pts, a, b, L));
}

function subPolyline(pts, a, b, L) {
  if (a < 0) {
    // wraps around the end of a closed ring
    const first = subPolyline(pts, L + a, L, L);
    const second = subPolyline(pts, 0, b, L);
    return [...first, ...second.slice(1)];
  }
  const out = [atDistance(pts, a, false).point];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    acc += distance(pts[i], pts[i + 1]);
    if (acc > a && acc < b) out.push(pts[i + 1].slice());
  }
  out.push(atDistance(pts, b, false).point);
  return out;
}
