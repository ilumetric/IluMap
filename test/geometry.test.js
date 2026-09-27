import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distance, bearing, compass8, polylineLength, polygonArea, centroid, bbox, pointInPolygon,
  nearestPointOnPolyline, pointAlong, resample, catmullRomToPath, wallLayout, cutGaps,
} from '../src/core/geometry.js';
import { fromPairs, pxToWorld, worldToPx, invert } from '../src/core/calibration.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('distance and polyline length', () => {
  assert.equal(distance([0, 0], [3, 4]), 5);
  assert.equal(polylineLength([[0, 0], [3, 4], [3, 10]]), 11);
  assert.equal(polylineLength([[0, 0], [10, 0], [10, 10], [0, 10]], true), 40);
});

test('bearing: image-like (flipY false) north is -y', () => {
  near(bearing([0, 0], [0, -10], false), 0);
  near(bearing([0, 0], [10, 0], false), 90);
  near(bearing([0, 0], [0, 10], false), 180);
  near(bearing([0, 0], [-10, 0], false), 270);
  assert.equal(compass8(bearing([0, 0], [10, -10], false)), 'NE');
  assert.equal(compass8(bearing([0, 0], [-10, 10], false)), 'SW');
});

test('bearing: engine-like (flipY true) north is +y', () => {
  near(bearing([0, 0], [0, 10], true), 0);
  near(bearing([0, 0], [0, -10], true), 180);
  assert.equal(compass8(bearing([0, 0], [10, 10], true)), 'NE');
  assert.equal(compass8(bearing([0, 0], [10, -10], true)), 'SE');
});

test('compass8 wraps', () => {
  assert.equal(compass8(359), 'N');
  assert.equal(compass8(22), 'N');
  assert.equal(compass8(23), 'NE');
  assert.equal(compass8(-90), 'W');
});

test('polygon area, centroid, bbox', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(polygonArea(sq), 100);
  assert.deepEqual(centroid(sq), [5, 5]);
  assert.deepEqual(bbox(sq), { min: [0, 0], max: [10, 10] });
});

test('pointInPolygon (concave)', () => {
  const U = [[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]];
  assert.equal(pointInPolygon([5, 20], U), true);
  assert.equal(pointInPolygon([15, 20], U), false);
  assert.equal(pointInPolygon([25, 25], U), true);
  assert.equal(pointInPolygon([40, 5], U), false);
});

test('nearestPointOnPolyline, pointAlong, resample', () => {
  const pl = [[0, 0], [10, 0], [10, 10]];
  const r = nearestPointOnPolyline([12, 5], pl);
  assert.deepEqual(r.point, [10, 5]);
  assert.equal(r.dist, 2);
  assert.equal(r.segIndex, 1);
  near(r.t, 0.5);
  assert.deepEqual(pointAlong(pl, 0.5), [10, 0]);
  assert.deepEqual(pointAlong(pl, 0.25), [5, 0]);
  const rs = resample([[0, 0], [10, 0]], 2.5);
  assert.equal(rs.length, 5);
  assert.deepEqual(rs[4], [10, 0]);
});

test('catmullRomToPath passes through points', () => {
  const d = catmullRomToPath([[0, 0], [10, 0], [10, 10]]);
  assert.match(d, /^M0 0C/);
  assert.match(d, /10 10$/);
  const closed = catmullRomToPath([[0, 0], [10, 0], [10, 10]], true);
  assert.match(closed, /Z$/);
});

test('wall layout: towers at vertices, gates by index and fraction, gaps cut', () => {
  const f = {
    points: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true,
    wall: { towers: 'vertices', towerSize: 10, gates: [{ id: 'g1', at: 1 }, { id: 'g2', t: 0.625 }] },
  };
  const lay = wallLayout(f);
  assert.equal(lay.length, 400);
  assert.equal(lay.towers.length, 4);
  assert.deepEqual(lay.gates[0].point, [100, 0]);
  assert.deepEqual(lay.gates[1].point.map(Math.round), [50, 100]);
  const pieces = cutGaps(f.points, true, lay.gates);
  assert.equal(pieces.length, 2);
  const auto = wallLayout({ ...f, wall: { towers: 'auto', towerSpacing: 50 } });
  assert.equal(auto.towers.length, 8);
});

test('calibration from 2 pairs: scale + rotation + translation', () => {
  const T = fromPairs([{ px: [0, 0], world: [1000, 2000] }, { px: [100, 0], world: [1000, 2200] }]);
  // 100 px -> 200 world units along +y: scale 2, rotated 90°
  const w = pxToWorld(T, [100, 0]);
  near(w[0], 1000); near(w[1], 2200);
  const w2 = pxToWorld(T, [0, 50]);
  near(w2[0], 900); near(w2[1], 2000);
  const back = worldToPx(T, w2);
  near(back[0], 0); near(back[1], 50);
  const I = invert(invert(T));
  near(I.a, T.a); near(I.f, T.f);
});

test('calibration with reflection for y-up worlds', () => {
  const pairs = [{ px: [0, 0], world: [0, 1000] }, { px: [1000, 0], world: [1000, 1000] }];
  const T = fromPairs(pairs, { reflect: true });
  const p = pxToWorld(T, [0, 1000]);
  near(p[0], 0); near(p[1], 0); // image bottom-left -> world origin when +y is up
  const T2 = fromPairs(pairs);
  const q = pxToWorld(T2, [0, 1000]);
  near(q[1], 2000); // image-like: rows grow with +y
  assert.throws(() => fromPairs([pairs[0], pairs[0]]));
});
