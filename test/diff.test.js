import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmptyMap } from '../src/core/model.js';
import { diffMaps, diffText } from '../src/core/diff.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const demo = JSON.parse(readFileSync(new URL('../examples/demo/map.json', import.meta.url), 'utf8'));

// 10 km × 10 km, cm, two zones side by side (west: 0…5 km, east: 5…10 km), one POI.
function base(opts = {}) {
  const doc = createEmptyMap({ name: 'Test', bounds: { min: [0, 0], max: [1000000, 1000000] }, ...opts });
  doc.meta.landMode = 'filled';
  doc.layers.zones.push(
    { id: 'marsh', name: 'Saltmarsh', kind: 'polygon', type: 'swamp', points: [[0, 0], [500000, 0], [500000, 1000000], [0, 1000000]] },
    { id: 'plains', name: 'Central Plains', kind: 'polygon', type: 'plains', points: [[500000, 0], [1000000, 0], [1000000, 1000000], [500000, 1000000]] },
  );
  doc.pois.push(
    { id: 'farm', name: 'Farm', x: 490000, y: 500000, type: 'farm', status: 'idea' },
    { id: 'village', name: 'Millbrook', x: 800000, y: 500000, type: 'village', status: 'approved' },
  );
  doc.layers.roads.push({ id: 'road_1', name: 'Old Road', kind: 'line', type: 'dirt', points: [[100000, 100000], [400000, 100000]] });
  doc.links.push({ from: 'farm', to: 'village', type: 'road', name: 'Farm lane' });
  return doc;
}

test('identical maps: No changes.', () => {
  assert.equal(diffText(base(), base()), 'No changes.\n');
  assert.equal(diffText(demo, clone(demo)), 'No changes.\n');
  assert.equal(diffMaps(base(), base()).equal, true);
});

test('moved POI: distance, compass and zone change', () => {
  const a = base();
  const b = clone(a);
  const farm = b.pois.find((p) => p.id === 'farm');
  farm.x += 21213.2; // ~300 m NE with flipY false (north = -y)
  farm.y -= 21213.2;
  const text = diffText(a, b);
  assert.ok(text.includes('- Moved **Farm** (`farm`) 300 m NE — now in Central Plains (was Saltmarsh).'), text);
  const d = diffMaps(a, b);
  const pos = d.pois[0].changes.find((c) => c.field === 'position');
  assert.equal(pos.compass, 'NE');
  assert.equal(pos.zone, 'plains');
  assert.equal(pos.zoneBefore, 'marsh');
  assert.ok(Math.abs(pos.distance - 30000) < 1);
  assert.equal(d.equal, false);
});

test('flipY changes the compass direction', () => {
  const move = (flipY) => {
    const a = base({ flipY });
    const b = clone(a);
    b.pois.find((p) => p.id === 'village').y += 100000; // +y by 1 km
    return diffText(a, b, { format: 'plain' });
  };
  assert.ok(move(false).includes('Moved Millbrook (village) 1 km S — still in Central Plains.'), move(false));
  assert.ok(move(true).includes('Moved Millbrook (village) 1 km N — still in Central Plains.'), move(true));
});

test('added, removed, renamed POIs and property changes', () => {
  const a = base();
  const b = clone(a);
  b.pois = b.pois.filter((p) => p.id !== 'farm');
  b.links = [];
  b.pois[0].name = 'Millbrook Town';
  b.pois[0].status = 'slice';
  b.pois[0].tags = ['market'];
  b.pois.push({ id: 'cove', name: 'Smugglers Cove', x: 820000, y: 400000, type: 'poi', status: 'idea' });
  b.pois.push({ id: 'shrine', name: 'Shrine', x: 200000, y: 200000, type: 'shrine', status: 'idea', placed: false });
  const text = diffText(a, b);
  assert.ok(text.includes('- Renamed **Millbrook** → **Millbrook Town** (`village`).'), text);
  assert.ok(text.includes('- Changed **Millbrook Town** (`village`): tags +market; status approved → slice.'), text);
  assert.ok(text.includes('- Added **Smugglers Cove** (`cove`, poi, idea) — in Central Plains, 1 km N of **Millbrook Town** (`village`).'), text);
  assert.ok(text.includes('- Added **Shrine** (`shrine`, shrine, idea), not placed yet — rough position in Saltmarsh'), text);
  assert.ok(text.includes('- Removed **Farm** (`farm`, farm).'), text);
  assert.ok(text.includes('- Removed road link **Farm** (`farm`) → **Millbrook Town** (`village`) "Farm lane".'), text);
  // grouped and ordered: POIs before Links, new-map order, removed last
  assert.ok(text.indexOf('## POIs') < text.indexOf('## Links'));
  assert.ok(text.indexOf('Smugglers Cove') < text.indexOf('Removed **Farm**'));
});

test('placing an unplaced POI and changing only its id', () => {
  const a = base();
  a.pois.push({ id: 'shrine', name: 'Shrine', x: 200000, y: 200000, type: 'shrine', status: 'idea', placed: false });
  const b = clone(a);
  const s = b.pois.find((p) => p.id === 'shrine');
  delete s.placed;
  s.x = 700000;
  b.pois.find((p) => p.id === 'farm').id = 'farm_old';
  b.links[0].from = 'farm_old';
  const text = diffText(a, b, { format: 'plain' });
  assert.ok(text.includes('Placed Shrine (shrine) on the map — in Central Plains, '), text);
  assert.ok(text.includes('Changed the id of Farm: farm → farm_old.'), text);
  assert.ok(text.includes('Changed road link Farm (farm_old) → Millbrook (village) "Farm lane": from Farm (farm) → Farm (farm_old).'), text);
});

test('features: added, reshaped, renamed, removed, gates', () => {
  const a = base();
  a.layers.walls.push({
    id: 'wall_town', name: 'Town Wall', kind: 'line', type: 'wall_stone', closed: true, width: 300,
    points: [[700000, 400000], [900000, 400000], [900000, 600000], [700000, 600000]],
    wall: { towers: 'vertices', gates: [{ id: 'gate_n', name: 'North Gate', at: 0 }] },
  });
  const b = clone(a);
  b.layers.roads[0].points.push([400000, 300000]); // 3 km + 2 km
  b.layers.roads[0].name = 'Coast Road';
  b.layers.rivers.push({ id: 'river_1', name: 'Clearwater', kind: 'line', points: [[100000, 900000], [900000, 900000]] });
  b.layers.walls[0].wall.gates.push({ id: 'gate_s', name: 'South Gate', at: 2 });
  b.layers.zones[0].points = [[0, 0], [600000, 0], [500000, 1000000], [0, 1000000]];
  const text = diffText(a, b);
  assert.ok(text.includes('- Reshaped **Coast Road** (`road_1`, roads, dirt) — 2 → 3 points, length 3 km → 5 km, centre moved'), text);
  assert.ok(text.includes('- Renamed **Old Road** → **Coast Road** (`road_1`, roads).'), text);
  assert.ok(text.includes('- Added **Clearwater** (`river_1`, rivers) — 8 km long, from Saltmarsh to Central Plains.'), text);
  assert.ok(text.includes('- Changed **Town Wall** (`wall_town`, walls, wall_stone): added gate **South Gate** (`gate_s`).'), text);
  assert.ok(text.includes('- Reshaped **Saltmarsh** (`marsh`, zones, swamp) — 4 points edited, area 50 km² → 55 km², centre moved'), text);
  const removed = diffText(b, a);
  assert.ok(removed.includes('- Removed **Clearwater** (`river_1`, rivers) — was 8 km long.'), removed);
  assert.ok(removed.includes('removed gate **South Gate** (`gate_s`)'), removed);
});

test('unknown layer keys are compared too', () => {
  const a = base();
  const b = clone(a);
  b.layers.terraces = [{ id: 'terrace_1', name: 'Rice Terraces', kind: 'polygon', points: [[600000, 600000], [700000, 600000], [700000, 700000]] }];
  const text = diffText(a, b);
  assert.ok(text.includes('- Added **Rice Terraces** (`terrace_1`, terraces) — area 0.5 km², in Central Plains, '), text);
  const d = diffMaps(a, b);
  assert.equal(d.features.length, 1);
  assert.equal(d.features[0].layer, 'terraces');
  assert.equal(d.features[0].op, 'added');
  const back = diffMaps(b, a);
  assert.equal(back.features[0].op, 'removed');
  assert.equal(back.features[0].layer, 'terraces');
});

test('links added, removed and changed', () => {
  const a = base();
  a.links.push({ id: 'quest_bell', from: 'village', to: 'farm', type: 'quest', name: 'The Bell' });
  const b = clone(a);
  b.links[0].type = 'path';
  b.links[1].name = 'The Drowned Bell';
  b.links.push({ from: 'village', to: 'farm', type: 'sight' });
  const text = diffText(a, b);
  assert.ok(text.includes('- Changed path link **Farm** (`farm`) → **Millbrook** (`village`) "Farm lane": type road → path.'), text);
  assert.ok(text.includes('- Changed quest link **Millbrook** (`village`) → **Farm** (`farm`) "The Drowned Bell" (`quest_bell`): name "The Bell" → "The Drowned Bell".'), text);
  assert.ok(text.includes('- Added sight link **Millbrook** (`village`) → **Farm** (`farm`).'), text);
  const d = diffMaps(a, b);
  assert.deepEqual(d.links.map((l) => l.op), ['changed', 'changed', 'added']);
});

test('map settings: one line each', () => {
  const a = base();
  const b = clone(a);
  b.meta.name = 'Test 2';
  b.meta.flipY = true;
  b.view.grid.step = 20000;
  b.view.bounds.max = [2000000, 1000000];
  b.style.preset = 'parchment';
  b.terrain = { target: 'ue-mesh-terrain', resolution: [2048, 2048] };
  b.x_notes = 'custom';
  const text = diffText(a, b, { format: 'plain' });
  assert.ok(text.includes('- Meta: name "Test" → "Test 2"; flipY false → true.'), text);
  assert.ok(text.includes('- Bounds: x 0…1 000 000, y 0…1 000 000 (10 km × 10 km) → x 0…2 000 000, y 0…1 000 000 (20 km × 10 km).'), text);
  assert.ok(text.includes('- Grid: step 100 m → 200 m.'), text);
  assert.ok(text.includes('- Terrain grid: added (2048 × 2048 quads).'), text);
  assert.ok(text.includes('- Style: preset blueprint → parchment.'), text);
  assert.ok(text.includes('- Custom field x_notes: added.'), text);
  assert.ok(text.includes('Map (6)'), text);
});

test('demo: a moved POI in the real demo map', () => {
  const b = clone(demo);
  const camp = b.pois.find((p) => p.id === 'lumber_camp');
  camp.y -= 50000; // 500 m north (flipY false)
  const text = diffText(demo, b);
  assert.match(text, /- Moved \*\*Lumber Camp\*\* \(`lumber_camp`\) 500 m N — /);
});
