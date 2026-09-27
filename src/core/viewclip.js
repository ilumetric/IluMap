// Viewport clipping for the editor canvas. Pure module: no DOM.
//
// At high zoom the canvas only needs the part of each line that is on screen.
// visiblePieces() returns that part as polylines, accurate at the current zoom
// (smooth Catmull-Rom segments are sampled adaptively, a few screen pixels per
// sample) and clipped to a rectangle. Every piece carries `start`, its distance
// from the beginning of the whole line, so dash patterns and symbols placed
// along the line (cliff teeth, ridge ticks) keep their phase no matter where
// the clip starts — nothing jumps when the view is panned and re-rendered.
// The distances use a fixed per-segment estimate, so they do not depend on the
// zoom or on which segments happen to be visible.

const EST_SAMPLES = 8; // samples per smooth segment for the length estimate

function catmullSegments(points, closed) {
  const n = points.length;
  const P = (i) => (closed ? points[((i % n) + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  const segs = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = P(i - 1); const p1 = P(i); const p2 = P(i + 1); const p3 = P(i + 2);
    segs.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2]);
  }
  return segs;
}

const bez = (s, t) => {
  const u = 1 - t;
  const a = u * u * u; const b = 3 * u * u * t; const c = 3 * u * t * t; const d = t * t * t;
  return [a * s[0][0] + b * s[1][0] + c * s[2][0] + d * s[3][0], a * s[0][1] + b * s[1][1] + c * s[2][1] + d * s[3][1]];
};

function boxOf(pts) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

export const boxesTouch = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/**
 * Bounding box of what a feature draws (smooth: includes the Bézier control
 * points, which contain the curve). Points in the caller's coordinate space.
 */
export function drawnBox(points, closed, smooth) {
  if (!smooth || points.length < 3) return boxOf(points);
  return boxOf(catmullSegments(points, closed).flat());
}

/** Liang–Barsky: the part of segment a→b inside rect as [t0, t1], or null. */
function clipSegment(a, b, r) {
  let t0 = 0; let t1 = 1;
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const edges = [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dy, a[1] - r.y0], [dy, r.y1 - a[1]]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0, t1];
}

/**
 * The part of a line inside `rect`, as pieces { pts: [[x, y], …], start }.
 * points: the feature's points (caller's space); closed: ring; smooth:
 * Catmull-Rom; step: sample spacing for visible smooth segments (e.g. 3 px in
 * world units); maxSamples: cap per segment.
 */
export function visiblePieces(points, closed, smooth, rect, { step = 1, maxSamples = 4096 } = {}) {
  const n = points.length;
  if (n < 2) return [];
  const pieces = [];
  let cur = null;
  let s = 0; // distance from the start of the line (fixed estimate)
  const push = (p, d, newPiece) => {
    if (newPiece || !cur) { cur = { pts: [p], start: d }; pieces.push(cur); return; }
    const last = cur.pts[cur.pts.length - 1];
    if (last[0] !== p[0] || last[1] !== p[1]) cur.pts.push(p);
  };
  const run = (poly, dists) => {
    // poly: sampled points of one segment with their distances; clip each sub-segment
    for (let i = 0; i + 1 < poly.length; i++) {
      const a = poly[i]; const b = poly[i + 1];
      const c = clipSegment(a, b, rect);
      if (!c) { cur = null; continue; }
      const [t0, t1] = c;
      const lerp = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const d0 = dists[i] + (dists[i + 1] - dists[i]) * t0;
      const d1 = dists[i] + (dists[i + 1] - dists[i]) * t1;
      push(lerp(t0), d0, t0 > 0);
      push(lerp(t1), d1, false);
      if (t1 < 1) cur = null;
    }
  };

  if (!smooth || n < 3) {
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = points[i]; const b = points[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (boxesTouch(boxOf([a, b]), rect)) run([a, b], [s, s + len]); else cur = null;
      s += len;
    }
    return pieces;
  }

  for (const seg of catmullSegments(points, closed)) {
    // fixed length estimate (independent of zoom and of the view)
    let est = 0;
    let prev = seg[0];
    for (let k = 1; k <= EST_SAMPLES; k++) { const p = bez(seg, k / EST_SAMPLES); est += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; }
    if (!boxesTouch(boxOf(seg), rect)) { cur = null; s += est; continue; }
    // visible: sample densely enough for the current zoom
    const hull = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) + Math.hypot(seg[2][0] - seg[1][0], seg[2][1] - seg[1][1]) + Math.hypot(seg[3][0] - seg[2][0], seg[3][1] - seg[2][1]);
    const m = Math.max(2, Math.min(maxSamples, Math.ceil(hull / Math.max(step, 1e-9))));
    const poly = [];
    for (let k = 0; k <= m; k++) poly.push(k === 0 ? seg[0] : k === m ? seg[3] : bez(seg, k / m));
    let len = 0;
    const raw = [0];
    for (let k = 1; k < poly.length; k++) { len += Math.hypot(poly[k][0] - poly[k - 1][0], poly[k][1] - poly[k - 1][1]); raw.push(len); }
    const scale = len > 0 ? est / len : 0;
    run(poly, raw.map((d) => s + d * scale));
    s += est;
  }
  return pieces;
}

/** SVG path data for pieces ("M…L…" per piece). */
export function piecesPath(pieces, r2 = (v) => Math.round(v * 100) / 100) {
  let d = '';
  for (const p of pieces) {
    if (p.pts.length < 2) continue;
    d += `M${r2(p.pts[0][0])} ${r2(p.pts[0][1])}`;
    for (let i = 1; i < p.pts.length; i++) d += `L${r2(p.pts[i][0])} ${r2(p.pts[i][1])}`;
  }
  return d;
}

/**
 * Points every `step` along the pieces, at global distances (k + phase) * step,
 * with the unit tangent there: [{ point, dir }]. Used for symbols along lines.
 */
export function pointsAlongPieces(pieces, step, phase = 0.5, max = 20000) {
  const out = [];
  for (const piece of pieces) {
    const pts = piece.pts;
    let d = piece.start;
    let k = Math.ceil((d - phase * step) / step - 1e-9);
    for (let i = 0; i + 1 < pts.length && out.length < max; i++) {
      const a = pts[i]; const b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len <= 0) continue;
      const ux = (b[0] - a[0]) / len; const uy = (b[1] - a[1]) / len;
      for (;;) {
        const target = (k + phase) * step;
        if (target > d + len) break;
        const t = (target - d) / len;
        out.push({ point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [ux, uy] });
        k++;
        if (out.length >= max) break;
      }
      d += len;
    }
  }
  return out;
}
