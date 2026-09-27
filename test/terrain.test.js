import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmptyMap, normalize, serialize, validate } from '../src/core/model.js';
import {
  terrainOf, computeTerrain, terrainBlock, resolutionForQuad, autoSections, explicitFor, quadOptions,
  unrealSettingsText, defaultQuad, DEFAULT_MAX_TRIANGLES,
} from '../src/core/terrain.js';
import { toText } from '../src/core/text-export.js';

const demo = () => normalize(readFileSync(new URL('../examples/demo/map.json', import.meta.url), 'utf8'));
// 1 km × 1 km map in cm
const km = () => createEmptyMap({ bounds: { min: [0, 0], max: [100000, 100000] } });

test('quad size = size / resolution; resolutionForQuad inverts it', () => {
  const doc = km();
  doc.terrain = terrainBlock({ ...terrainOf(doc), resolution: [1000, 1000] });
  const c = computeTerrain(doc);
  assert.deepEqual(c.size, [100000, 100000]);
  assert.deepEqual(c.quad, [100, 100]);
  assert.equal(c.square, true);
  assert.equal(c.triangles, 2 * 1000 * 1000);
  assert.equal(c.vertices, 1001 * 1001);
  assert.deepEqual(c.heightmap, { width: 1001, height: 1001 });
  assert.deepEqual(resolutionForQuad([100000, 50000], 50), [2000, 1000]);
});

test('automatic sections: square sections within the triangle budget', () => {
  const s = autoSections([1000, 1000], DEFAULT_MAX_TRIANGLES);
  assert.deepEqual(s.layout, [2, 2]);
  assert.deepEqual(s.resolution, [500, 500]);
  assert.ok(2 * s.resolution[0] * s.resolution[1] <= DEFAULT_MAX_TRIANGLES);
  const big = autoSections([10000, 5000], DEFAULT_MAX_TRIANGLES);
  assert.ok(2 * big.resolution[0] * big.resolution[1] <= DEFAULT_MAX_TRIANGLES);
  assert.ok(big.layout[0] * big.resolution[0] >= 10000 && big.layout[1] * big.resolution[1] >= 5000);
});

test('explicit sections: resolution = layout × section resolution', () => {
  const doc = km();
  const tr = { ...terrainOf(doc), sections: { mode: 'explicit', ...explicitFor([1000, 1000], [256, 256]) } };
  assert.deepEqual(tr.sections.layout, [4, 4]);
  doc.terrain = terrainBlock(tr);
  assert.deepEqual(doc.terrain.resolution, [1024, 1024]);
  const c = computeTerrain(doc);
  assert.equal(c.sections.count, 16);
  assert.equal(c.sections.estimated, false);
  assert.equal(c.sections.trianglesPerSection, 2 * 256 * 256);
  assert.ok(Math.abs(c.quad[0] - 100000 / 1024) < 1e-9);
  assert.match(unrealSettingsText(c), /Sections \/ Layout\s+4\s+4/);
  assert.match(unrealSettingsText(c), /Mesh \/ Resolution\s+1024\s+1024/);
});

test('terrain block round-trips canonically and validates', () => {
  const doc = demo();
  doc.terrain = terrainBlock({ ...terrainOf(doc), sections: { mode: 'explicit', layout: [8, 8], resolution: [256, 256] } });
  const text = serialize(normalize(doc));
  assert.equal(serialize(normalize(text)), text);
  // terrain sits right after view
  assert.ok(text.indexOf('"terrain"') > text.indexOf('"view"') && text.indexOf('"terrain"') < text.indexOf('"style"'));
  assert.equal(validate(normalize(text)).ok, true);
});

test('validate: terrain errors and the explicit mismatch warning', () => {
  const doc = km();
  doc.terrain = { resolution: [0, 10] };
  assert.ok(validate(doc).errors.some((e) => e.path === 'terrain.resolution'));
  doc.terrain = { sections: { mode: 'sideways' } };
  assert.ok(validate(doc).errors.some((e) => e.path === 'terrain.sections.mode'));
  doc.terrain = { resolution: [100, 100], sections: { mode: 'explicit', layout: [2, 2], resolution: [64, 64] } };
  const v = validate(doc);
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => w.path === 'terrain.resolution'));
});

test('defaults keep big maps reasonable; options list covers the presets', () => {
  const doc = demo(); // 40 km
  assert.equal(doc.terrain, undefined);
  const q = defaultQuad([4000000, 4000000]);
  assert.ok(4000000 / q <= 4096);
  const c = computeTerrain(doc);
  assert.ok(c.resolution[0] <= 4096);
  const opts = quadOptions(doc);
  assert.deepEqual(opts.map((o) => o.quadTarget), [25, 50, 100, 200, 400, 800]);
  assert.deepEqual(opts[2].resolution, [40000, 40000]);
  assert.ok(computeTerrain(doc, { ...terrainOf(doc), resolution: [40000, 40000] }).warnings.includes('heavyMesh'));
});

test('text export mentions the terrain grid only when the map has one', () => {
  const doc = km();
  assert.doesNotMatch(toText(doc), /Terrain grid/);
  doc.terrain = terrainBlock({ ...terrainOf(doc), resolution: [1000, 1000] });
  assert.match(toText(doc), /Terrain grid \(Unreal Mesh Terrain\): 1000 × 1000 quads/);
});
