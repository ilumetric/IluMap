import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmptyMap, normalize } from '../src/core/model.js';
import { featureGeometry, polylineLength } from '../src/core/geometry.js';
import {
  buildNetwork, nearestOnNetwork, route, crossings, describeRoute, segmentIntersection, defaultTolerance,
} from '../src/core/routes.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (±${eps})`);

/** 1 km × 1 km world (cm): default tolerance 300. */
function world(layers = {}, pois = []) {
  const doc = createEmptyMap({ bounds: { min: [0, 0], max: [100000, 100000] } });
  for (const [l, arr] of Object.entries(layers)) doc.layers[l] = arr;
  for (const [id, x, y, extra] of pois) doc.pois.push({ id, name: id.toUpperCase(), x, y, type: 'poi', status: 'idea', ...extra });
  return doc;
}
const line = (id, points, extra = {}) => ({ id, name: extra.name ?? id, kind: 'line', points, ...extra });
const poly = (id, points, extra = {}) => ({ id, name: extra.name ?? id, kind: 'polygon', points, ...extra });

test('segmentIntersection and default tolerance', () => {
  const h = segmentIntersection([0, 0], [10, 0], [5, -5], [5, 5]);
  assert.deepEqual(h.point, [5, 0]);
  near(h.t, 0.5); near(h.u, 0.5);
  assert.equal(segmentIntersection([0, 0], [10, 0], [0, 1], [10, 1]), null); // parallel
  assert.equal(segmentIntersection([0, 0], [10, 0], [11, -5], [11, 5]), null); // apart
  assert.ok(segmentIntersection([0, 0], [10, 0], [10, 0], [10, 5])); // touching endpoints count
  assert.equal(defaultTolerance(world()), 300);
  assert.equal(defaultTolerance(createEmptyMap({ bounds: { min: [0, 0], max: [4000000, 2000000] } })), 2000);
});

test('straight road: length = road + access', () => {
  const doc = world({ roads: [line('road_a', [[10000, 50000], [90000, 50000]])] }, [['a', 10000, 50500], ['b', 90000, 50400]]);
  const r = route(doc, 'a', 'b');
  assert.equal(r.ok, true);
  near(r.straight, Math.hypot(80000, 100));
  near(r.access[0], 500); near(r.access[1], 400);
  near(r.length, 80000 + 900);
  assert.deepEqual(r.features, ['road_a']);
  assert.deepEqual(r.layersUsed, ['roads']);
  assert.deepEqual(r.path[0], [10000, 50500]);
  assert.deepEqual(r.path[r.path.length - 1], [90000, 50400]);
  assert.deepEqual(r.crossings, []);
  const n = nearestOnNetwork(buildNetwork(doc), [30000, 52000]);
  assert.deepEqual(n.point, [30000, 50000]);
  near(n.dist, 2000);
  assert.equal(n.edge.featureId, 'road_a');
  assert.equal(nearestOnNetwork(buildNetwork(world()), [0, 0]), null);
});

test('L-shaped road: sum of legs, longer than straight', () => {
  const doc = world({ roads: [line('road_l', [[10000, 10000], [10000, 90000], [90000, 90000]])] }, [['a', 10000, 10000], ['b', 90000, 90000]]);
  const r = route(doc, 'a', 'b');
  assert.equal(r.ok, true);
  near(r.length, 160000);
  assert.ok(r.length > r.straight);
  assert.ok(r.path.some((p) => p[0] === 10000 && p[1] === 90000));
  // reversed direction gives the same length and a reversed path
  const back = route(doc, 'b', 'a');
  near(back.length, 160000);
  assert.deepEqual(back.path[0], [90000, 90000]);
});

test('T-junction: an endpoint within tolerance of another road connects to it', () => {
  const roads = [
    line('road_h', [[0, 50000], [100000, 50000]]),
    line('road_v', [[50000, 50200], [50000, 90000]]), // ends 2 m short of road_h (tolerance 3 m)
  ];
  const doc = world({ roads }, [['a', 10000, 50000], ['b', 50000, 90000]]);
  const r = route(doc, 'a', 'b');
  assert.equal(r.ok, true);
  near(r.length, 40000 + 39800);
  assert.deepEqual(r.features, ['road_h', 'road_v']);
  // with a tighter tolerance the gap stays open
  const r2 = route(doc, 'a', 'b', { tolerance: 100 });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'disconnected');
  near(r2.straight, Math.hypot(40000, 40000));
});

test('X-crossing: route takes the shorter way through the crossing', () => {
  const roads = [
    line('road_h', [[0, 50000], [100000, 50000]]),
    line('road_v', [[50000, 0], [50000, 100000]]),
    line('road_detour', [[0, 50000], [0, 100000], [50000, 100000]]),
  ];
  const doc = world({ roads }, [['a', 10000, 50000], ['b', 50000, 100000]]);
  const r = route(doc, 'a', 'b');
  assert.equal(r.ok, true);
  near(r.length, 90000);
  assert.deepEqual(r.features, ['road_h', 'road_v']);
  // without the crossing only the detour remains (10 + 50 + 50 km… in cm)
  const doc2 = world({ roads: [roads[0], line('road_v', [[50000, 60000], [50000, 100000]]), roads[2]] }, [['a', 10000, 50000], ['b', 50000, 100000]]);
  near(route(doc2, 'a', 'b').length, 110000);
});

test('a road and a rail crossing do not connect; an endpoint that snaps does', () => {
  const doc = world({
    roads: [line('road_h', [[0, 50000], [100000, 50000]])],
    rails: [line('rail_v', [[50000, 0], [50000, 100000]])],
  }, [['a', 0, 50000], ['b', 50000, 100000]]);
  const r = route(doc, 'a', 'b');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'disconnected');
  // the same crossing between two roads connects
  doc.layers.roads.push(line('road_v', [[50000, 0], [50000, 100000]]));
  doc.layers.rails = [];
  assert.equal(route(doc, 'a', 'b').ok, true);
  // a rail that ends on the road connects
  doc.layers.roads.pop();
  doc.layers.rails = [line('rail_v', [[50000, 50100], [50000, 100000]])];
  const r3 = route(doc, 'a', 'b');
  assert.equal(r3.ok, true);
  assert.deepEqual(r3.layersUsed, ['roads', 'rails']);
  assert.match(describeRoute(doc, 'a', 'b'), / by road and rail /);
});

test('disconnected roads and POIs far from any road', () => {
  const roads = [line('road_1', [[0, 10000], [40000, 10000]]), line('road_2', [[60000, 90000], [100000, 90000]])];
  const doc = world({ roads }, [['a', 0, 10000], ['b', 100000, 90000], ['far', 20000, 60000]]);
  const r = route(doc, 'a', 'b');
  assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'disconnected' });
  assert.match(describeRoute(doc, 'a', 'b'), /^no road connection \(straight 1\.3 km\)$/);
  const f = route(doc, 'far', 'b');
  assert.equal(f.ok, false);
  assert.equal(f.reason, 'noRoadNear');
  assert.equal(f.which, 'from');
  near(f.dist, 50000);
  assert.equal(describeRoute(doc, 'far', 'b'), 'no road near FAR (500 m away)');
  // a generous maxAccess lets it walk
  assert.equal(route(doc, 'far', 'a', { maxAccess: 60000 }).ok, true);
  // unknown / unplaced
  doc.pois.push({ id: 'ghost', name: 'Ghost', x: 0, y: 0, placed: false });
  assert.equal(route(doc, 'a', 'nope'), null);
  assert.equal(route(doc, 'ghost', 'a'), null);
  assert.equal(describeRoute(doc, 'a', 'nope'), 'unknown place "nope"');
  assert.equal(describeRoute(doc, 'ghost', 'a'), 'Ghost is not placed on the map');
});

test('river crossing: unbridged, bridged by a nearby bridge, bridged by travelling over a bridge edge', () => {
  const river = line('river_black', [[50000, 10000], [50000, 90000]], { name: 'Black River', type: 'river_main' });
  const pois = [['a', 0, 50000], ['b', 100000, 50000]];
  // 1. no bridge
  const doc = world({ roads: [line('road_h', [[0, 50000], [100000, 50000]], { name: 'East Road' })], rivers: [river] }, pois);
  const r = route(doc, 'a', 'b');
  assert.equal(r.crossings.length, 1);
  const c = r.crossings[0];
  assert.equal(c.kind, 'river');
  assert.equal(c.featureId, 'river_black');
  assert.equal(c.name, 'Black River');
  assert.equal(c.type, 'river_main');
  assert.deepEqual(c.point, [50000, 50000]);
  near(c.at, 50000);
  assert.equal(c.bridge, null);
  assert.equal(describeRoute(doc, 'a', 'b'), '1 km by road (straight 1 km, 1.0×) via East Road; crosses Black River (no bridge)');
  // 2. a bridge feature drawn over the crossing (the road itself runs under it)
  doc.layers.bridges = [line('bridge_stone', [[49000, 50100], [51000, 50100]], { name: 'Stone Bridge', width: 600 })];
  const r2 = route(doc, 'a', 'b');
  assert.equal(r2.crossings[0].bridge, 'bridge_stone');
  assert.equal(r2.crossings[0].bridgeName, 'Stone Bridge');
  assert.match(describeRoute(doc, 'a', 'b'), /; crosses Black River by Stone Bridge$/);
  // a bridge elsewhere does not count
  doc.layers.bridges = [line('bridge_far', [[49000, 70000], [51000, 70000]])];
  assert.equal(route(doc, 'a', 'b').crossings[0].bridge, null);
  // 3. the road has a gap that only a bridge spans: the route must use the bridge edge
  const doc3 = world({
    roads: [line('road_w', [[0, 50000], [49000, 50000]]), line('road_e', [[51000, 50000], [100000, 50000]])],
    bridges: [line('bridge_gap', [[49000, 50000], [51000, 50000]], { name: 'Gap Bridge' })],
    rivers: [river],
  }, pois);
  const r3 = route(doc3, 'a', 'b');
  assert.equal(r3.ok, true);
  near(r3.length, 100000);
  assert.deepEqual(r3.features, ['road_w', 'bridge_gap', 'road_e']);
  assert.ok(r3.layersUsed.includes('bridges'));
  assert.equal(r3.crossings[0].bridge, 'bridge_gap');
  assert.equal(describeRoute(doc3, 'a', 'b'), '1 km by road (straight 1 km, 1.0×) via road_w, road_e; crosses Black River by Gap Bridge');
  assert.equal(route(doc3, 'a', 'b', { layers: ['roads'] }).reason, 'disconnected');
  // bridgedBy edges count even when the bridges layer does not list them
  const noBridges = world({ rivers: [river] });
  delete noBridges.layers.bridges;
  const cs = crossings(noBridges, [[0, 50000], [100000, 50000]], { bridgedBy: [{ a: [49000, 50000], b: [51000, 50000], featureId: 'b1' }] });
  assert.equal(cs[0].bridge, 'b1');
  assert.equal(cs[0].bridgeName, null);
});

test('a bridge width widens its reach', () => {
  const doc = world({ rivers: [line('river_r', [[50000, 0], [50000, 100000]])] });
  doc.layers.bridges = [line('bridge_wide', [[49000, 51000], [51000, 51000]], { width: 2400 })]; // 10 m off the path, half width 12 m
  assert.equal(crossings(doc, [[0, 50000], [100000, 50000]])[0].bridge, 'bridge_wide');
  doc.layers.bridges[0].width = 1000;
  assert.equal(crossings(doc, [[0, 50000], [100000, 50000]])[0].bridge, null);
});

test('fault, cliff and ridge crossings have the right kind; other relief types are ignored', () => {
  const doc = world({
    roads: [line('road_h', [[0, 50000], [100000, 50000]], { name: 'Long Road' })],
    relief: [
      line('ridge_spine', [[20000, 0], [20000, 100000]], { name: 'Iron Spine', type: 'ridge' }),
      line('fault_great', [[40000, 0], [40000, 100000]], { name: 'Great Fault', type: 'fault' }),
      line('cliff_salt', [[60000, 0], [60000, 100000]], { name: 'Salt Cliffs', type: 'cliff' }),
      line('hill_1', [[80000, 0], [80000, 100000]], { name: 'Knoll', type: 'hill' }),
    ],
  }, [['a', 0, 50000], ['b', 100000, 50000]]);
  const r = route(doc, 'a', 'b');
  assert.deepEqual(r.crossings.map((c) => [c.kind, c.featureId, c.at]), [
    ['ridge', 'ridge_spine', 20000], ['fault', 'fault_great', 40000], ['cliff', 'cliff_salt', 60000],
  ]);
  assert.equal(r.crossings[0].bridge, null);
  assert.equal(describeRoute(doc, 'a', 'b'),
    '1 km by road (straight 1 km, 1.0×) via Long Road; crosses Iron Spine (ridge), Great Fault (no bridge), Salt Cliffs (no bridge)');
});

test('water: each entry into a polygon is reported once, exits and starting inside are not', () => {
  const lake = poly('lake_mirror', [[30000, 40000], [50000, 40000], [50000, 60000], [30000, 60000]], { name: 'Mirror Lake' });
  const doc = world({ water: [lake] });
  const pl = [[0, 50000], [100000, 50000]];
  const cs = crossings(doc, pl);
  assert.deepEqual(cs.map((c) => [c.kind, c.featureId, c.at, c.bridge]), [['water', 'lake_mirror', 30000, null]]);
  // in, out, in again
  const zig = [[0, 50000], [40000, 50000], [40000, 70000], [45000, 70000], [45000, 50000]];
  assert.deepEqual(crossings(doc, zig).map((c) => c.point), [[30000, 50000], [45000, 60000]]);
  // starting inside: only the re-entry counts
  assert.deepEqual(crossings(doc, [[40000, 50000], [40000, 70000], [45000, 70000], [45000, 50000]]).map((c) => c.point), [[45000, 60000]]);
  // crossing through a polygon vertex is one entry
  assert.equal(crossings(doc, [[20000, 30000], [40000, 50000]]).length, 1);
  // a causeway (bridge) over the lake
  doc.layers.bridges = [line('bridge_causeway', [[30000, 50000], [50000, 50000]], { name: 'Causeway' })];
  assert.equal(crossings(doc, pl)[0].bridgeName, 'Causeway');
});

test('smooth roads route along the Catmull-Rom curve', () => {
  const pts = [[0, 50000], [30000, 20000], [60000, 80000], [100000, 50000]];
  const straightDoc = world({ roads: [line('road_s', pts)] }, [['a', 0, 50000], ['b', 100000, 50000]]);
  const smoothDoc = world({ roads: [line('road_s', pts, { smooth: true })] }, [['a', 0, 50000], ['b', 100000, 50000]]);
  const a = route(straightDoc, 'a', 'b');
  const b = route(smoothDoc, 'a', 'b');
  near(a.length, polylineLength(pts));
  near(b.length, polylineLength(featureGeometry(smoothDoc.layers.roads[0])), 1e-3);
  assert.ok(Math.abs(a.length - b.length) > 100);
  assert.ok(b.path.length > a.path.length);
});

test('hidden features are part of the network; missing bridges/relief layers are fine', () => {
  const doc = world({
    roads: [line('road_h', [[0, 50000], [100000, 50000]], { hidden: true })],
    rivers: [line('river_r', [[50000, 0], [50000, 100000]])],
  }, [['a', 0, 50000], ['b', 100000, 50000]]);
  delete doc.layers.bridges;
  delete doc.layers.relief;
  const r = route(doc, 'a', 'b');
  assert.equal(r.ok, true);
  assert.equal(r.crossings.length, 1);
  assert.equal(r.crossings[0].bridge, null);
  assert.equal(crossings(doc, [[0, 0], [1, 1]]).length, 0);
  assert.equal(crossings(doc, [[0, 0]]).length, 0);
  // no roads at all
  delete doc.layers.roads;
  const none = route(doc, 'a', 'b');
  assert.equal(none.reason, 'noRoadNear');
  assert.equal(none.dist, null);
  assert.match(describeRoute(doc, 'a', 'b'), /^no roads on the map/);
});

test('wall gates are route endpoints', () => {
  const doc = world({
    roads: [line('road_h', [[0, 50000], [100000, 50000]])],
    walls: [line('wall_town', [[80000, 40000], [80000, 60000]], { wall: { towers: 'none', gates: [{ id: 'gate_w', name: 'West Gate', t: 0.5 }] } })],
  }, [['a', 0, 50000]]);
  const r = route(doc, 'a', 'gate_w');
  assert.equal(r.ok, true);
  near(r.length, 80000);
});

const demo = normalize(readFileSync(new URL('../examples/demo/map.json', import.meta.url), 'utf8'));

test('demo map: village -> mine_old and village -> city_riverport', () => {
  const r = route(demo, 'village', 'mine_old');
  assert.ok(r, 'both ids exist and are placed');
  if (!r.ok) {
    console.log(`demo village -> mine_old: ${r.reason}`, describeRoute(demo, 'village', 'mine_old'));
    assert.ok(['disconnected', 'noRoadNear'].includes(r.reason));
    return;
  }
  assert.ok(r.length >= r.straight);
  assert.ok(r.features.includes('road_mine_village'));
  const text = describeRoute(demo, 'village', 'mine_old');
  assert.match(text, /by road \(straight .+\) via Miners Road/);
  const city = route(demo, 'village', 'city_riverport');
  assert.equal(city.ok, true);
  assert.ok(city.length >= city.straight);
  assert.ok(typeof describeRoute(demo, 'village', 'city_riverport') === 'string');
});

test('performance: 60 × 60 road grid routes corner to corner in < 200 ms', () => {
  const N = 60; const step = 1000;
  const roads = [];
  for (let i = 0; i <= N; i++) {
    const h = []; const v = [];
    for (let k = 0; k <= N; k++) { h.push([k * step, i * step]); v.push([i * step, k * step]); }
    roads.push(line(`road_h${i}`, h), line(`road_v${i}`, v));
  }
  const doc = world({ roads }, [['a', 0, 0], ['b', N * step, N * step]]);
  doc.view.bounds = { min: [0, 0], max: [N * step, N * step] };
  const t0 = performance.now();
  const r = route(doc, 'a', 'b');
  const ms = performance.now() - t0;
  assert.equal(r.ok, true);
  near(r.length, 2 * N * step, 1e-6);
  assert.ok(ms < 200, `route took ${ms.toFixed(1)} ms`);
});
