import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visiblePieces, pointsAlongPieces, drawnBox, piecesPath } from '../src/core/viewclip.js';
import { normalize } from '../src/core/model.js';
import { renderParts } from '../src/core/render-svg.js';

const rect = { x0: 0, y0: 0, x1: 100, y1: 100 };

test('straight lines are clipped exactly and keep their distance from the start', () => {
  const pieces = visiblePieces([[-50, 50], [150, 50]], false, false, rect);
  assert.equal(pieces.length, 1);
  assert.deepEqual(pieces[0].pts, [[0, 50], [100, 50]]);
  assert.equal(pieces[0].start, 50);
  // leaving and entering again gives two pieces with increasing starts
  const zig = visiblePieces([[50, 50], [50, 200], [60, 200], [60, 50]], false, false, rect);
  assert.equal(zig.length, 2);
  assert.ok(zig[1].start > zig[0].start);
  assert.equal(zig[1].start, 150 + 10 + 100); // down 150, across 10, back up 100 to the edge
  // entirely outside → nothing
  assert.deepEqual(visiblePieces([[200, 200], [300, 300]], false, false, rect), []);
});

test('closed rings include the closing segment', () => {
  const ring = [[10, 10], [90, 10], [90, 90], [10, 90]];
  const pieces = visiblePieces(ring, true, false, rect);
  const total = pieces.reduce((n, p) => n + p.pts.length, 0);
  assert.ok(total >= 5);
  assert.match(piecesPath(pieces), /^M10 10/);
});

test('smooth curves: dense inside the view, same phase whatever the view', () => {
  const pts = [[-1000, 0], [0, 40], [1000, 0], [2000, 40]];
  const small = visiblePieces(pts, false, true, rect, { step: 1 });
  assert.ok(small.length >= 1);
  assert.ok(small[0].pts.length > 50, 'sampled densely at this zoom');
  // the distance at a given point does not depend on the clip rectangle
  const wide = visiblePieces(pts, false, true, { x0: -2000, y0: -500, x1: 3000, y1: 500 }, { step: 20 });
  const at = (pieces, x) => {
    for (const p of pieces) {
      let d = p.start;
      for (let i = 0; i + 1 < p.pts.length; i++) {
        const [a, b] = [p.pts[i], p.pts[i + 1]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if ((a[0] - x) * (b[0] - x) <= 0 && len) return d + len * Math.abs((x - a[0]) / (b[0] - a[0]));
        d += len;
      }
    }
    return null;
  };
  assert.ok(Math.abs(at(small, 50) - at(wide, 50)) < 0.5, 'dash phase is stable across views');
});

test('drawnBox contains the smooth curve', () => {
  const box = drawnBox([[0, 0], [10, 10], [20, 0]], false, true);
  assert.ok(box.x0 <= 0 && box.x1 >= 20 && box.y0 <= 0 && box.y1 >= 10);
});

test('points along pieces keep a global rhythm', () => {
  const a = pointsAlongPieces(visiblePieces([[0, 5], [100, 5]], false, false, rect), 10);
  const b = pointsAlongPieces(visiblePieces([[-37, 5], [100, 5]], false, false, rect), 10);
  assert.deepEqual(a.map((m) => Math.round(m.point[0])), [5, 15, 25, 35, 45, 55, 65, 75, 85, 95]);
  // same line started earlier: marks shift by the phase of the extra 37 units, not by the clip
  assert.deepEqual(b.map((m) => Math.round(m.point[0] * 10) / 10).slice(0, 3), [8, 18, 28]);
});

test('renderer: the drawn size stays small however deep the zoom (viewRect)', () => {
  const doc = normalize(readFileSync(new URL('../examples/demo/map.json', import.meta.url), 'utf8'));
  const fit = 4000000 / 900;
  const sizes = [1, 100, 7000].map((zoom) => {
    const upp = fit / zoom;
    const c = [1150000, 3330000]; // on the Salt Cliffs
    const r = { x0: c[0] - 1100 * upp, y0: c[1] - 800 * upp, x1: c[0] + 1100 * upp, y1: c[1] + 800 * upp };
    return renderParts(doc, { unitsPerPx: upp, interactive: true, viewRect: r }).body.length;
  });
  assert.ok(sizes[2] < 200 * 1024, `deep zoom renders ${Math.round(sizes[2] / 1024)} KB`);
  // without a viewRect (exports) the whole map is drawn exactly as before
  const full = renderParts(doc, { unitsPerPx: fit }).body;
  assert.match(full, /id="layer-relief"/);
  assert.doesNotMatch(full, /stroke-dashoffset/);
});
