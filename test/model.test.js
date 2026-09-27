import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createEmptyMap, normalize, serialize, validate, findById, allIds, slugify, zoneOf, isLand, renameId, removeById, nextId,
} from '../src/core/model.js';

const demoText = readFileSync(new URL('../examples/demo/map.json', import.meta.url), 'utf8');

test('demo map is canonical: serialize(normalize(text)) === text', () => {
  assert.equal(serialize(normalize(demoText)), demoText);
});

test('round-trip is stable and keeps unknown keys last', () => {
  const doc = createEmptyMap({ name: 'T' });
  doc.x_custom = { a: 1 };
  doc.layers.roads.push({ x_owner: 'bob', points: [[0, 0], [10, 10]], id: 'road_a', kind: 'line', name: 'A' });
  doc.pois.push({ status: 'idea', x_questGiver: 'npc_1', y: 2.345, x: 1, id: 'p', name: 'P', type: 'poi' });
  const text = serialize(normalize(doc));
  assert.equal(serialize(normalize(text)), text);
  const lines = text.split('\n');
  // top-level unknown key after links
  const iLinks = lines.indexOf('  "links": [],');
  const iCustom = lines.indexOf('  "x_custom": {');
  assert.ok(iLinks > 0 && iCustom > iLinks, 'x_custom must come after links');
  // feature key order: id, name, kind, points, then unknown
  const feat = text.slice(text.indexOf('"id": "road_a"'));
  const order = ['"id"', '"name"', '"kind"', '"points"', '"x_owner"'].map((k) => feat.indexOf(k));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // poi order: id, name, x, y, type, status, unknown
  const poi = text.slice(text.indexOf('"id": "p"'));
  const po = ['"id"', '"name"', '"x"', '"y"', '"type"', '"status"', '"x_questGiver"'].map((k) => poi.indexOf(k));
  assert.deepEqual([...po].sort((a, b) => a - b), po);
  assert.ok(text.includes('"y": 2.35'), 'numbers rounded to 2 decimals');
});

test('one coordinate pair per line, 2-space indent, trailing newline, LF', () => {
  const text = serialize(normalize(demoText));
  assert.ok(text.endsWith('}\n'));
  assert.ok(!text.includes('\r'));
  assert.match(text, /\n {10}\[\d+, \d+\],\n/);
  assert.match(text, /\n {2}"meta": \{\n {4}"name"/);
});

test('validate: demo is valid', () => {
  const r = validate(normalize(demoText));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('validate: reports errors with paths', () => {
  const doc = normalize(demoText);
  doc.pois[0].id = 'Bad Id';
  doc.pois[1].id = doc.layers.land[0].id; // duplicate
  doc.pois[2].status = 'maybe';
  doc.pois[3].zone = 'nowhere';
  doc.layers.land[0].kind = 'line';
  doc.layers.roads[0].points = [[0, 0]];
  doc.links[0].to = 'ghost';
  doc.layers.walls[0].wall.gates[0].at = 99;
  doc.meta.landMode = 'sea';
  const r = validate(doc);
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  for (const p of ['pois[0].id', 'pois[1].id', 'pois[2].status', 'pois[3].zone', 'layers.land[0].kind', 'layers.roads[0].points', 'links[0].to', 'meta.landMode']) {
    assert.ok(paths.includes(p), `expected error at ${p}; got ${paths.join(', ')}`);
  }
  assert.ok(r.errors.some((e) => e.path.startsWith('layers.walls[0].wall.gates[0]')));
  assert.ok(r.errors.some((e) => /duplicate id/.test(e.message)));
});

test('validate: format/version and unknown layer', () => {
  const r = validate({ format: 'x', version: 2, layers: { lava: [] } });
  const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes('format'));
  assert.ok(paths.includes('version'));
  assert.ok(paths.includes('layers.lava'));
  assert.equal(validate({ format: 'ilumap', version: 1, layers: { x_notes: [] } }).ok, true);
});

test('findById / allIds cover features, POIs, gates and link ids', () => {
  const doc = normalize(demoText);
  assert.equal(findById(doc, 'mine_old').kind, 'poi');
  assert.equal(findById(doc, 'river_black').kind, 'feature');
  assert.equal(findById(doc, 'river_black').layer, 'rivers');
  assert.equal(findById(doc, 'gate_riverport_n').kind, 'gate');
  assert.equal(findById(doc, 'quest_drowned_bell').kind, 'link');
  assert.equal(findById(doc, 'nope'), null);
  const ids = allIds(doc);
  assert.ok(ids.has('gate_riverport_s') && ids.has('village') && ids.has('lake_mirror'));
});

test('slugify and nextId', () => {
  assert.equal(slugify('Old Mine'), 'old_mine');
  assert.equal(slugify('Old Mine', new Set(['old_mine'])), 'old_mine_2');
  assert.equal(slugify('Old Mine', ['old_mine', 'old_mine_2']), 'old_mine_3');
  assert.equal(slugify('  Ça va? Été!  '), 'ca_va_ete');
  assert.equal(slugify('!!!'), 'item');
  const doc = createEmptyMap();
  assert.equal(nextId(doc, 'road'), 'road_1');
  doc.layers.roads.push({ id: 'road_1', kind: 'line', points: [[0, 0], [1, 1]] });
  assert.equal(nextId(doc, 'road'), 'road_2');
});

test('zoneOf picks the smallest containing zone; isLand respects water and landMode', () => {
  const doc = createEmptyMap({ bounds: { min: [0, 0], max: [100, 100] } });
  doc.layers.land.push({ id: 'isl', kind: 'polygon', points: [[10, 10], [90, 10], [90, 90], [10, 90]] });
  doc.layers.water.push({ id: 'lake', kind: 'polygon', points: [[40, 40], [60, 40], [60, 60], [40, 60]] });
  doc.layers.zones.push({ id: 'big', kind: 'polygon', points: [[0, 0], [100, 0], [100, 100], [0, 100]] });
  doc.layers.zones.push({ id: 'small', kind: 'polygon', points: [[15, 15], [35, 15], [35, 35], [15, 35]] });
  assert.equal(zoneOf(doc, [20, 20]), 'small');
  assert.equal(zoneOf(doc, [70, 70]), 'big');
  assert.equal(zoneOf(doc, [200, 200]), null);
  assert.equal(isLand(doc, [20, 20]), true);
  assert.equal(isLand(doc, [50, 50]), false, 'lake');
  assert.equal(isLand(doc, [5, 5]), false, 'sea');
  doc.meta.landMode = 'filled';
  assert.equal(isLand(doc, [5, 5]), true);
  assert.equal(isLand(doc, [50, 50]), false);
});

test('renameId updates references; removeById drops dangling links', () => {
  const doc = normalize(demoText);
  renameId(doc, 'mine_old', 'mine_deep');
  assert.ok(doc.links.some((l) => l.from === 'mine_deep'));
  assert.ok(!doc.links.some((l) => l.from === 'mine_old' || l.to === 'mine_old'));
  renameId(doc, 'mountains_north', 'peaks');
  assert.equal(doc.pois.find((p) => p.id === 'mine_deep').zone, 'peaks');
  renameId(doc, 'road_kings', 'road_royal');
  assert.ok(doc.links.some((l) => l.feature === 'road_royal'));
  assert.throws(() => renameId(doc, 'village', 'river_black'), /already used/);
  assert.throws(() => renameId(doc, 'village', 'Bad'), /must match/);
  const before = doc.links.length;
  removeById(doc, 'mine_deep');
  assert.ok(doc.links.length < before);
  assert.equal(validate(doc).ok, true, JSON.stringify(validate(doc).errors));
});
