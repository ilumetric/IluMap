import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESETS, resolveStyle, featureStyle } from '../src/core/styles.js';
import { STYLE_PRESETS } from '../src/core/schema.js';
import { createEmptyMap, validate } from '../src/core/model.js';
import { renderSvg } from '../src/core/render-svg.js';

const keysDeep = (o) => Object.keys(o).sort();

test('every preset is known to the validator and the JSON schema', () => {
  assert.deepEqual([...STYLE_PRESETS].sort(), Object.keys(PRESETS).sort());
  const schema = JSON.parse(readFileSync(new URL('../schema/map.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual([...schema.$defs.style.properties.preset.enum].sort(), Object.keys(PRESETS).sort());
});

test('presets share the same shape (layers and type tables)', () => {
  const ref = PRESETS.blueprint;
  for (const [name, p] of Object.entries(PRESETS)) {
    for (const k of ['ocean', 'label', 'grid', 'halo', 'boundsColor', 'poiBg']) {
      assert.match(p[k], /^#[0-9a-f]{6}$/i, `${name}.${k}`);
    }
    assert.deepEqual(keysDeep(p.layers), keysDeep(ref.layers), `${name}.layers`);
    for (const g of ['lineTypes', 'wallTypes', 'zoneTypes', 'poiTypes']) {
      assert.deepEqual(keysDeep(p[g]), keysDeep(ref[g]), `${name}.${g}`);
    }
  }
});

test('graphite preset resolves, validates without warnings and renders', () => {
  const rs = resolveStyle({ preset: 'graphite' });
  assert.equal(rs.preset, 'graphite');
  assert.equal(rs.ocean, '#16181b');
  assert.equal(featureStyle(rs, 'roads', { type: 'road_dirt' }).stroke, '#f5c542');
  const doc = createEmptyMap({ preset: 'graphite' });
  const v = validate(doc);
  assert.ok(v.ok);
  assert.equal(v.warnings.filter((w) => w.path === 'style.preset').length, 0);
  assert.match(renderSvg(doc, { width: 64 }), /fill="#16181b"/);
});

test('unknown presets still fall back to blueprint', () => {
  assert.equal(resolveStyle({ preset: 'nope' }).preset, 'blueprint');
});

test('app version matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const src = readFileSync(new URL('../src/app/version.js', import.meta.url), 'utf8');
  assert.equal(src.match(/APP_VERSION = '([^']+)'/)?.[1], pkg.version);
});
