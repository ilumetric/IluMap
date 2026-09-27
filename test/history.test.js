import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, serialize, removeById } from '../src/core/model.js';
import { createHistory, commit, undo, redo, describe, labelOf, diff, indexOf } from '../src/core/history.js';

const demo = () => normalize(readFileSync(new URL('../examples/demo/map.json', import.meta.url), 'utf8'));

// a deterministic PRNG so failures reproduce
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function randomEdit(doc, r) {
  const layers = Object.keys(doc.layers).filter((l) => doc.layers[l].length);
  const pick = (a) => a[Math.floor(r() * a.length)];
  switch (Math.floor(r() * 9)) {
    case 0: { const f = pick(doc.layers[pick(layers)]); f.points = f.points.map(([x, y]) => [x + 100, y - 50]); break; }
    case 1: { const f = pick(doc.layers[pick(layers)]); if (f.points.length) f.points[0] = [1, 2]; break; }
    case 2: { const p = pick(doc.pois); p.x += 10; p.name = `${p.name}*`; break; }
    case 3: { const l = pick(layers); doc.layers[l].push({ id: `new_${Math.floor(r() * 1e9)}`, kind: doc.layers[l][0].kind, points: [[0, 0], [5, 5], [9, 1]] }); break; }
    case 4: { const l = pick(layers); if (doc.layers[l].length > 1) removeById(doc, pick(doc.layers[l]).id); break; }
    case 5: { const l = pick(layers); doc.layers[l].reverse(); break; }
    case 6: doc.meta.name = `Map ${Math.floor(r() * 100)}`; break;
    case 7: doc.style.preset = pick(['graphite', 'blueprint', 'parchment']); break;
    default: if (doc.pois.length > 1) removeById(doc, pick(doc.pois).id);
  }
}

test('random edits undo back to the original and redo to the end, exactly', () => {
  for (const seed of [1, 2, 3, 42]) {
    const r = rng(seed);
    const doc = demo();
    const states = [serialize(doc)];
    const h = createHistory(doc);
    for (let i = 0; i < 60; i++) {
      randomEdit(doc, r);
      if (commit(h, doc)) states.push(serialize(doc));
    }
    assert.ok(h.undo.length > 30);
    for (let i = states.length - 2; i >= 0; i--) {
      assert.ok(undo(h, doc));
      assert.equal(serialize(doc), states[i], `seed ${seed}: undo to state ${i}`);
    }
    assert.equal(undo(h, doc), null);
    for (let i = 1; i < states.length; i++) {
      assert.ok(redo(h, doc));
      assert.equal(serialize(doc), states[i], `seed ${seed}: redo to state ${i}`);
    }
    // the index follows undo / redo: nothing left to commit
    assert.equal(diff(h.index, doc).patch, null);
  }
});

test('a new change after undo drops the redo branch; no-op changes add no step', () => {
  const doc = demo();
  const h = createHistory(doc);
  doc.meta.name = 'A'; commit(h, doc);
  doc.meta.name = 'B'; commit(h, doc);
  undo(h, doc);
  assert.equal(doc.meta.name, 'A');
  doc.pois[0].x += 1; commit(h, doc);
  assert.equal(h.redo.length, 0);
  assert.equal(commit(h, doc), null, 'nothing changed');
  assert.equal(h.undo.length, 2);
});

test('only changed items are stored', () => {
  const doc = demo();
  const h = createHistory(doc);
  const total = JSON.stringify(doc).length;
  doc.pois[0].x += 5;
  const step = commit(h, doc);
  assert.equal(step.patch.length, 1);
  assert.equal(step.patch[0].items.length, 1);
  assert.ok(step.bytes < total / 5, `${step.bytes} bytes for one POI`);
});

test('merging: repeated nudges within the window become one step', () => {
  const doc = demo();
  const h = createHistory(doc);
  const x0 = doc.pois[0].x;
  const sel = [doc.pois[0].id];
  for (let i = 0; i < 5; i++) {
    doc.pois[0].x += 10;
    commit(h, doc, { merge: 'nudge', selBefore: sel, selAfter: sel, now: 1000 + i * 100 });
  }
  assert.equal(h.undo.length, 1);
  // after the window a new step starts
  doc.pois[0].x += 10;
  commit(h, doc, { merge: 'nudge', selBefore: sel, selAfter: sel, now: 5000 });
  assert.equal(h.undo.length, 2);
  undo(h, doc); undo(h, doc);
  assert.equal(doc.pois[0].x, x0);
  // nudges that cancel out leave no step
  doc.pois[0].x += 10; commit(h, doc, { merge: 'n', selBefore: sel, selAfter: sel, now: 9000 });
  doc.pois[0].x -= 10; commit(h, doc, { merge: 'n', selBefore: sel, selAfter: sel, now: 9100 });
  assert.equal(h.undo.length, 0);
});

test('merging never swallows a saved revision', () => {
  const doc = demo();
  const h = createHistory(doc);
  doc.pois[0].x += 1; commit(h, doc, { merge: 'n', now: 0 });
  const saved = h.rev;
  doc.pois[0].x += 1; commit(h, doc, { merge: 'n', now: 10, keepRev: saved });
  assert.equal(h.undo.length, 2);
  undo(h, doc);
  assert.equal(h.rev, saved);
});

test('limits drop the oldest steps', () => {
  const doc = demo();
  const h = createHistory(doc, { maxSteps: 5 });
  for (let i = 0; i < 12; i++) { doc.meta.name = `n${i}`; commit(h, doc); }
  assert.equal(h.undo.length, 5);
  const hb = createHistory(doc, { maxBytes: 1 });
  for (let i = 0; i < 3; i++) { doc.meta.name = `m${i}`; commit(hb, doc); }
  assert.equal(hb.undo.length, 1, 'always keeps the latest step');
});

test('labels describe the change', () => {
  const doc = demo();
  const h = createHistory(doc);
  const poi = doc.pois[0];
  poi.x += 100; poi.y += 100;
  assert.deepEqual(labelOf(commit(h, doc)), { key: 'move', name: poi.name });
  const road = doc.layers.roads[0];
  road.points = road.points.map(([x, y]) => [x + 3, y]);
  assert.equal(labelOf(commit(h, doc)).key, 'move');
  road.points[0] = [0, 0];
  assert.equal(labelOf(commit(h, doc)).key, 'reshape');
  road.name = 'Renamed';
  assert.deepEqual(labelOf(commit(h, doc)), { key: 'edit', name: 'Renamed' });
  removeById(doc, doc.pois[1].id);
  assert.equal(labelOf(commit(h, doc)).key, 'delete');
  doc.layers.land.push({ id: 'isle_x', kind: 'polygon', name: 'Isle X', points: [[0, 0], [1, 0], [1, 1]] });
  assert.deepEqual(labelOf(commit(h, doc)), { key: 'add', name: 'Isle X' });
  doc.style.preset = 'parchment';
  assert.equal(labelOf(commit(h, doc)).key, 'style');
  doc.meta.name = 'Other';
  assert.equal(labelOf(commit(h, doc)).key, 'rename');
  assert.deepEqual(describe(null), { key: 'edit' });
  // explicit labels win
  doc.meta.name = 'Again';
  assert.deepEqual(labelOf(commit(h, doc, { label: { key: 'reload' } })), { key: 'reload' });
});

test('collections without unique ids fall back to whole-array slots', () => {
  const doc = demo();
  doc.links = [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }];
  const h = createHistory(doc);
  doc.links.push({ from: 'c', to: 'd' });
  const before = JSON.stringify(indexOf(doc).get('links'));
  commit(h, doc);
  undo(h, doc);
  assert.equal(doc.links.length, 2);
  redo(h, doc);
  assert.equal(doc.links.length, 3);
  assert.equal(JSON.stringify(h.index.get('links')), before);
});

test('large maps: committing a small edit stays fast', () => {
  const doc = demo();
  for (const l of Object.keys(doc.layers)) {
    const base = doc.layers[l];
    const out = [];
    for (let k = 0; k < 40; k++) for (const f of base) out.push({ ...JSON.parse(JSON.stringify(f)), id: `${f.id}_${k}` });
    doc.layers[l] = out;
  }
  const h = createHistory(doc);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) { doc.pois[0].x += 1; commit(h, doc); }
  for (let i = 0; i < 20; i++) undo(h, doc);
  const ms = (performance.now() - t0) / 40;
  assert.ok(ms < 25, `${ms.toFixed(1)} ms per step`);
  assert.ok(h.bytes === 0 || h.redo.length === 20);
});
