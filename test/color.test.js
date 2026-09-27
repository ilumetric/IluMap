import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../src/core/color.js';

test('hex <-> rgb, short and long forms', () => {
  assert.deepEqual(hexToRgb('#10a37f'), [16, 163, 127]);
  assert.deepEqual(hexToRgb('fff'), [255, 255, 255]);
  assert.equal(hexToRgb('#12345'), null);
  assert.equal(rgbToHex([16, 163, 127]), '#10a37f');
  assert.equal(rgbToHex([300, -4, 127.6]), '#ff0080');
});

test('rgb -> hsv -> rgb round-trips', () => {
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#10a37f', '#f5c542', '#8a6d4b', '#7f7f7f']) {
    const back = rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex))));
    assert.equal(back, hex);
  }
  assert.deepEqual(rgbToHsv([255, 0, 0]), [0, 1, 1]);
  const [h, s, v] = rgbToHsv([0, 0, 255]);
  assert.equal(Math.round(h), 240);
  assert.equal(s, 1);
  assert.equal(v, 1);
});
