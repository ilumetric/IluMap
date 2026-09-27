import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { normalize, createEmptyMap } from '../src/core/model.js';
import { toText, formatLength } from '../src/core/text-export.js';
import { renderSvg } from '../src/core/render-svg.js';
import { renderMask, maskSize, maskFileName } from '../src/core/render-mask.js';
import { encodePng, encodePngAsync, crc32 } from '../src/core/png.js';

const demo = normalize(readFileSync(new URL('../examples/demo/map.json', import.meta.url), 'utf8'));

test('formatLength uses display units', () => {
  const meta = { displayUnit: 'm', displayUnitScale: 100 };
  assert.equal(formatLength(120000, meta), '1.2 km');
  assert.equal(formatLength(35000, meta), '350 m');
  assert.equal(formatLength(1250, meta), '12.5 m');
  assert.equal(formatLength(500, { displayUnit: 'ft', displayUnitScale: 30.48 }), '16.4 ft');
});

test('text export describes the demo', () => {
  const md = toText(demo);
  assert.match(md, /^# Demo Isles\n/);
  assert.ok(md.includes('- **Old Mine** (`mine_old`, mine, approved) — zone: Northern Mountains, on land.'));
  assert.ok(md.includes('8.5 km N of Millbrook (`village`)'));
  assert.ok(md.includes('Links: road → village ("Miners road"); rail → city_riverport ("Ore Line").'));
  assert.ok(md.includes('## Unplaced POIs (1)'));
  assert.ok(md.includes('**Drowned Shrine** (`shrine_swamp`'));
  assert.ok(md.includes('gates: North Gate (`gate_riverport_n`), South Gate (`gate_riverport_s`)'));
  assert.ok(md.includes('- Water: **Mirror Lake** (`lake_mirror`)'));
  const plain = toText(demo, { format: 'plain' });
  assert.ok(!plain.includes('**'));
  assert.ok(!plain.includes('`'));
  assert.ok(plain.includes('- Old Mine (mine_old, mine, approved) — zone: Northern Mountains, on land.'));
});

test('text export compass follows flipY', () => {
  const doc = createEmptyMap({ bounds: { min: [0, 0], max: [100000, 100000] } });
  doc.pois.push({ id: 'a', name: 'A', x: 50000, y: 50000, type: 'poi', status: 'idea' });
  doc.pois.push({ id: 'b', name: 'B', x: 50000, y: 10000, type: 'poi', status: 'idea' });
  assert.ok(toText(doc).includes('400 m N of A'));
  doc.meta.flipY = true;
  assert.ok(toText(doc).includes('400 m S of A'));
});

test('svg export has layer groups and a world-unit viewBox', () => {
  const svg = renderSvg(demo, { width: 800 });
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.ok(svg.includes('viewBox="0 0 4000000 4000000"'));
  for (const l of ['land', 'water', 'coast', 'rivers', 'roads', 'rails', 'walls', 'zones', 'pois', 'labels']) {
    assert.ok(svg.includes(`<g id="layer-${l}"`), l);
  }
  assert.ok(svg.includes('Millbrook'));
  assert.ok(!svg.includes('Drowned Shrine</text>'), 'unplaced POIs are not drawn');
  const flipped = normalize({ ...demo, meta: { ...demo.meta, flipY: true } });
  assert.ok(renderSvg(flipped, { width: 800 }).includes('viewBox="0 -4000000 4000000 4000000"'));
});

function square16(flipY = false) {
  const doc = createEmptyMap({ bounds: { min: [0, 0], max: [16, 16] }, flipY });
  doc.layers.land.push({ id: 'l', kind: 'polygon', points: [[4, 2], [12, 2], [12, 6], [4, 6]] });
  return doc;
}
const px = (m, x, y) => m.data[y * m.width + x];
const count = (m) => m.data.reduce((n, v) => n + (v === 255 ? 1 : 0), 0);

test('mask: 16x16 polygon fill, pixel-centre rule', () => {
  const m = renderMask(square16(), { source: 'land', size: 16 });
  assert.equal(m.width, 16);
  assert.equal(m.height, 16);
  assert.equal(m.unitsPerPixel, 1);
  assert.equal(count(m), 8 * 4);
  assert.equal(px(m, 4, 2), 255);
  assert.equal(px(m, 11, 5), 255);
  assert.equal(px(m, 3, 2), 0);
  assert.equal(px(m, 12, 5), 0);
  assert.equal(px(m, 4, 6), 0);
});

test('mask: flipY puts max y on the top row', () => {
  const m = renderMask(square16(true), { source: 'land', size: 16 });
  // world y 2..6 -> rows 16-6 .. 16-2 = 10..13
  assert.equal(px(m, 5, 10), 255);
  assert.equal(px(m, 5, 13), 255);
  assert.equal(px(m, 5, 2), 0);
});

test('mask: land minus lake, water, invert, filled mode', () => {
  const doc = createEmptyMap({ bounds: { min: [0, 0], max: [16, 16] } });
  doc.layers.land.push({ id: 'l', kind: 'polygon', points: [[2, 2], [14, 2], [14, 14], [2, 14]] });
  doc.layers.water.push({ id: 'w', kind: 'polygon', points: [[6, 6], [10, 6], [10, 10], [6, 10]] });
  const land = renderMask(doc, { source: 'land', size: 16 });
  assert.equal(count(land), 144 - 16);
  assert.equal(px(land, 7, 7), 0);
  assert.equal(px(land, 3, 3), 255);
  const water = renderMask(doc, { source: 'water', size: 16 });
  assert.equal(count(water), 256 - 128);
  const inv = renderMask(doc, { source: 'land', size: 16, invert: true });
  for (let i = 0; i < 256; i++) assert.equal(inv.data[i], 255 - land.data[i]);
  doc.meta.landMode = 'filled';
  assert.equal(count(renderMask(doc, { source: 'land', size: 16 })), 256 - 16);
});

test('mask: zones by type, lines with width, feather, sizes and names', () => {
  const doc = createEmptyMap({ bounds: { min: [0, 0], max: [32, 16] } });
  doc.layers.zones.push({ id: 'z1', kind: 'polygon', type: 'swamp', points: [[0, 0], [8, 0], [8, 8], [0, 8]] });
  doc.layers.zones.push({ id: 'z2', kind: 'polygon', type: 'forest', points: [[16, 0], [32, 0], [32, 16], [16, 16]] });
  doc.layers.roads.push({ id: 'r', kind: 'line', points: [[0, 8], [32, 8]], width: 2 });
  assert.equal(count(renderMask(doc, { source: 'zones:swamp', width: 32 })), 64);
  assert.equal(count(renderMask(doc, { source: 'zones', width: 32 })), 64 + 256);
  const road = renderMask(doc, { source: 'roads', width: 32 });
  assert.equal(road.height, 16);
  assert.equal(count(road), 64); // rows 7 and 8, centres within 1 unit of y=8
  const f = renderMask(doc, { source: 'roads', width: 32, feather: 2 });
  assert.ok(f.data.some((v) => v > 0 && v < 255));
  assert.deepEqual(maskSize({ min: [0, 0], max: [200, 100] }, { size: 4096 }), { width: 4096, height: 2048 });
  assert.equal(maskFileName('zones:mountains'), 'mask_zones_mountains.png');
  assert.throws(() => renderMask(doc, { source: 'lava' }));
});

test('demo land mask is mostly ocean with a big island', () => {
  const m = renderMask(demo, { source: 'land', size: 128 });
  const frac = count(m) / (128 * 128);
  assert.ok(frac > 0.3 && frac < 0.7, `land fraction ${frac}`);
  assert.equal(px(m, 0, 0), 0);
  assert.equal(px(m, 64, 64), 255);
});

function checkPng(buf, w, h, colorType) {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  assert.equal(dv.getUint32(8), 13);
  assert.equal(String.fromCharCode(...buf.subarray(12, 16)), 'IHDR');
  assert.equal(dv.getUint32(16), w);
  assert.equal(dv.getUint32(20), h);
  assert.equal(buf[24], 8);
  assert.equal(buf[25], colorType);
  const crc = (crc32(buf.subarray(12, 29)) ^ 0xffffffff) >>> 0;
  assert.equal(dv.getUint32(29), crc);
  // IDAT
  const idatLen = dv.getUint32(33);
  assert.equal(String.fromCharCode(...buf.subarray(37, 41)), 'IDAT');
  return inflateSync(buf.subarray(41, 41 + idatLen));
}

test('PNG encoder: signature, IHDR, IDAT inflates to scanlines (stored, zlib, CompressionStream)', async () => {
  const data = new Uint8Array(16 * 16).map((_, i) => i % 256);
  const img = { width: 16, height: 16, data, channels: 1 };
  for (const buf of [encodePng(img), encodePng(img, { deflate: deflateSync }), await encodePngAsync(img)]) {
    const raw = checkPng(buf, 16, 16, 0);
    assert.equal(raw.length, 17 * 16);
    assert.equal(raw[0], 0);
    assert.equal(raw[1 + 5], 5);
    assert.equal(raw[17 + 1], 16);
    assert.equal(String.fromCharCode(...buf.subarray(buf.length - 8, buf.length - 4)), 'IEND');
  }
  const rgba = encodePng({ width: 2, height: 1, data: new Uint8Array(8).fill(200), channels: 4 });
  checkPng(rgba, 2, 1, 6);
});
