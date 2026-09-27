import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, extractSelection } from '../src/core/model.js';
import { renderMask, usedMaskSources } from '../src/core/render-mask.js';

const demo = () => normalize(readFileSync(new URL('../examples/demo/map.json', import.meta.url), 'utf8'));
const white = (m) => m.data.reduce((n, v) => n + (v === 255 ? 1 : 0), 0);

test('a selection mask ("all") draws the selected lines and zones, not a black image', () => {
  const doc = demo();
  const road = extractSelection(doc, ['road_kings']);
  const m = renderMask(road, { source: 'all', size: 512 });
  assert.ok(white(m) > 0, 'the selected road is white');
  // the old default ("land") would have been all black for a road-only selection
  assert.equal(white(renderMask(road, { source: 'land', size: 512 })), 0);
  const zone = extractSelection(doc, ['swamp_south', 'road_kings']);
  assert.ok(white(renderMask(zone, { source: 'all', size: 512 })) > white(m));
});

test('masks are strictly black and white (no grey) without feather', () => {
  const doc = demo();
  for (const source of ['land', 'zones', 'roads', 'relief', 'bridges']) {
    const m = renderMask(doc, { source, size: 300 });
    assert.ok(m.data.every((v) => v === 0 || v === 255), `${source} has grey pixels`);
  }
});

test('dialogs only offer sources that have something to draw', () => {
  const doc = demo();
  const road = extractSelection(doc, ['road_kings']);
  const s = usedMaskSources(road);
  assert.ok(s.includes('roads'));
  assert.ok(!s.includes('rivers') && !s.includes('zones') && !s.includes('land'), JSON.stringify(s));
  const all = usedMaskSources(doc);
  assert.ok(all.includes('land') && all.includes('zones:mountains') && all.includes('relief:cliff'));
  assert.ok(!all.includes('coast'), 'the demo has no coast lines');
});
