// The stage background: a seamless 960px tile drawn once, like the empty part
// of an orienteering map. A simple periodic value noise splits it into
// patches of ISOM area patterns — marsh (310), sand (213), undergrowth (407)
// and stony ground (210) — with bare canvas between them. The ISOM point
// symbols (--topo in styles.css) lie on top. canvas.js moves both with the pan
// (--pan-x / --pan-y); they keep their size when zooming, so nothing jumps.

export const TILE = 960; // canvas.js wraps the pan offset by this; the 320px point-symbol tile divides it

/** Small seeded PRNG (mulberry32), so the tile is the same on every load. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise that repeats every TILE px: `cells` random values per side, smoothly interpolated. */
function periodicNoise(cells, rand) {
  const v = Array.from({ length: cells * cells }, rand);
  const at = (i, j) => v[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const u = (x / TILE) * cells, w = (y / TILE) * cells;
    const i = Math.floor(u), j = Math.floor(w);
    const fx = s(u - i), fy = s(w - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** Three octaves from `cells` up: patches with ragged edges. */
function field(seed, cells) {
  const r = rng(seed);
  const n1 = periodicNoise(cells, r), n2 = periodicNoise(cells * 2, r), n3 = periodicNoise(cells * 4, r);
  return (x, y) => 0.6 * n1(x, y) + 0.28 * n2(x, y) + 0.12 * n3(x, y);
}

/** Values of f at the q-quantiles, measured on a grid over the tile. */
function quantiles(f, qs) {
  const vals = [];
  for (let y = 0; y < TILE; y += 15) for (let x = 0; x < TILE; x += 15) vals.push(f(x, y));
  vals.sort((a, b) => a - b);
  return qs.map((q) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))]);
}

const TYPES = ['marsh', 'sand', 'undergrowth', 'stony'];

/** Draw the tile; returns a canvas. `ink` is the one colour of the canvas patterns. */
export function drawBackdrop(ink, dpr = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.round(TILE * dpr);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.strokeStyle = g.fillStyle = ink;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const presence = field(11, 5), kind = field(29, 2); // the type changes slower than the patches, so a patch is mostly one type
  const [cover] = quantiles(presence, [0.5]); // about half of the canvas has a pattern
  const cuts = quantiles(kind, [0.25, 0.5, 0.75]);
  const typeAt = (x, y) => {
    if (presence(x, y) < cover) return null;
    const k = kind(x, y);
    return TYPES[k < cuts[0] ? 0 : k < cuts[1] ? 1 : k < cuts[2] ? 2 : 3];
  };
  const jitter = rng(53);

  // every symbol is drawn again across the tile edges it touches, so the tile is seamless
  const wrapped = (x, y, reach, draw) => {
    for (const dx of [0, -TILE, TILE]) {
      if (dx && (dx < 0 ? x < TILE - reach : x > reach)) continue;
      for (const dy of [0, -TILE, TILE]) {
        if (dy && (dy < 0 ? y < TILE - reach : y > reach)) continue;
        draw(x + dx, y + dy);
      }
    }
  };
  const each = (step, fn) => {
    for (let y = 0; y < TILE; y += step) for (let x = 0; x < TILE; x += step) fn(x, y);
  };

  // 310 marsh: horizontal dashes in staggered rows
  g.lineWidth = 1.3;
  for (let row = 0, y = 4; y < TILE; y += 8, row++) {
    for (let x = (row % 2) * 8; x < TILE; x += 16) {
      if (typeAt(x + 4, y) !== 'marsh') continue;
      wrapped(x, y, 12, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + 8, py); g.stroke(); });
    }
  }
  // 213 sand: a dense scatter of small dots
  each(6, (x, y) => {
    const px = x + jitter() * 5, py = y + jitter() * 5;
    if (typeAt(px, py) !== 'sand') return;
    wrapped(px, py, 2, (qx, qy) => { g.beginPath(); g.arc(qx, qy, 0.8, 0, Math.PI * 2); g.fill(); });
  });
  // 407 undergrowth: vertical stripes, broken where the patch ends
  g.lineWidth = 1.2;
  for (let x = 3; x < TILE; x += 8) {
    for (let y = 0; y < TILE; y += 4) {
      if (typeAt(x, y + 2) !== 'undergrowth') continue;
      wrapped(x, y, 6, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px, py + 4); g.stroke(); });
    }
  }
  // 210 stony ground: scattered dots and small triangles
  g.lineWidth = 1.1;
  each(13, (x, y) => {
    const px = x + jitter() * 9, py = y + jitter() * 9, tri = jitter() < 0.35;
    if (typeAt(px, py) !== 'stony') return;
    wrapped(px, py, 5, (qx, qy) => {
      g.beginPath();
      if (tri) { g.moveTo(qx, qy - 2.6); g.lineTo(qx + 2.6, qy + 1.8); g.lineTo(qx - 2.6, qy + 1.8); g.closePath(); g.stroke(); }
      else { g.arc(qx, qy, 1.3, 0, Math.PI * 2); g.fill(); }
    });
  });
  return cv;
}

/** Draw the tile and hand it to the stage as --terrain. */
export function mountBackdrop(stage) {
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--dot').trim() || '#2c2c33';
  const cv = drawBackdrop(ink, Math.min(2, window.devicePixelRatio || 1));
  cv.toBlob((blob) => {
    if (blob) stage.style.setProperty('--terrain', `url("${URL.createObjectURL(blob)}")`);
  });
}
