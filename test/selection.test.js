import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, validate, extractSelection, selectionBounds } from '../src/core/model.js';
import { resolveStyle, poiStyle, POI_ICONS } from '../src/core/styles.js';
import { ICONS, renderSvg } from '../src/core/render-svg.js';

const demo = () => normalize(readFileSync(new URL('../examples/demo/map.json', import.meta.url), 'utf8'));

test('extractSelection keeps only the selected items and links between them', () => {
  const doc = demo();
  const out = extractSelection(doc, ['village', 'mine_old']);
  assert.deepEqual(out.pois.map((p) => p.id), ['village', 'mine_old']);
  for (const [l, arr] of Object.entries(out.layers)) assert.equal(arr.length, 0, `layer ${l} should be empty`);
  assert.ok(out.links.length >= 1);
  for (const k of out.links) {
    assert.ok(['village', 'mine_old'].includes(k.from) && ['village', 'mine_old'].includes(k.to));
    assert.equal(k.feature, undefined, 'feature refs to dropped features are removed');
  }
  // zone refs to zones that were not exported are dropped, so the result validates
  for (const p of out.pois) assert.equal(p.zone, undefined);
  assert.equal(validate(out).ok, true, JSON.stringify(validate(out).errors));
  // same world: meta, bounds and style are kept; the source document is untouched
  assert.deepEqual(out.view.bounds, doc.view.bounds);
  assert.equal(out.style.preset, doc.style.preset);
  assert.equal(doc.pois.length, demo().pois.length);
});

test('extractSelection: a gate id keeps its wall; a selected zone keeps POI zone refs', () => {
  const doc = demo();
  const out = extractSelection(doc, ['gate_riverport_n']);
  assert.deepEqual(out.layers.walls.map((f) => f.id), ['wall_riverport']);
  const zoneId = doc.pois.find((p) => p.id === 'village').zone;
  const withZone = extractSelection(doc, ['village', zoneId]);
  assert.equal(withZone.pois[0].zone, zoneId);
  assert.equal(validate(withZone).ok, true);
});

test('selectionBounds pads the box, honours minAspect and ignores unplaced POIs', () => {
  const doc = demo();
  const v = doc.pois.find((p) => p.id === 'village');
  const m = doc.pois.find((p) => p.id === 'mine_old');
  const b = selectionBounds(doc, ['village', 'mine_old'], { pad: 0.1 });
  assert.ok(b.min[0] < Math.min(v.x, m.x) && b.max[0] > Math.max(v.x, m.x));
  assert.ok(b.min[1] < Math.min(v.y, m.y) && b.max[1] > Math.max(v.y, m.y));
  const sq = selectionBounds(doc, ['village', 'mine_old'], { pad: 0.1, minAspect: 0.6 });
  const w = sq.max[0] - sq.min[0];
  const h = sq.max[1] - sq.min[1];
  assert.ok(Math.min(w, h) / Math.max(w, h) >= 0.6 - 1e-9);
  const unplaced = doc.pois.find((p) => p.placed === false);
  assert.equal(selectionBounds(doc, [unplaced.id]), null);
  // a single point still gets a non-empty box
  const one = selectionBounds(doc, ['village']);
  assert.ok(one.max[0] > one.min[0] && one.max[1] > one.min[1]);
});

test('selection SVG is cropped to the selection box', () => {
  const doc = demo();
  const ids = ['village', 'mine_old'];
  const crop = selectionBounds(doc, ids, { pad: 0.12, minAspect: 0.6 });
  const svg = renderSvg(extractSelection(doc, ids), { width: 800, bounds: crop });
  const vb = /viewBox="([^"]+)"/.exec(svg)[1].split(' ').map(Number);
  assert.ok(vb[2] < doc.view.bounds.max[0] - doc.view.bounds.min[0]);
  assert.match(svg, /poi-village/);
  assert.doesNotMatch(svg, /poi-city_riverport/);
});

test('every POI icon has a symbol; a POI icon overrides its type icon', () => {
  for (const name of POI_ICONS) assert.ok(ICONS[name], `missing symbol ${name}`);
  const rs = resolveStyle({ preset: 'graphite' });
  assert.equal(poiStyle(rs, { type: 'mine' }).icon, rs.poiTypes.mine.icon);
  assert.equal(poiStyle(rs, { type: 'mine', icon: 'skull' }).icon, 'skull');
  assert.equal(poiStyle(rs, { type: 'mine', icon: 'no_such_icon' }).icon, rs.poiTypes.mine.icon);
});

test('validate: POI icon must be a string; unknown icons only warn', () => {
  const doc = demo();
  doc.pois[0].icon = 'skull';
  assert.equal(validate(doc).ok, true);
  doc.pois[0].icon = 'no_such_icon';
  const v = validate(doc);
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => w.path === 'pois[0].icon'));
  doc.pois[0].icon = 7;
  assert.equal(validate(doc).ok, false);
});
