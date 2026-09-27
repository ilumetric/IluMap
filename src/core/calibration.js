// Image pixel <-> world transform from two point pairs.
// The transform is a similarity (uniform scale + rotation + translation),
// optionally with a reflection of the image v axis (needed when the world is
// y-up, i.e. meta.flipY = true, because image rows grow downwards).
//
// T = { a, b, c, d, e, f } maps pixel [u, v] to world [x, y]:
//   x = a*u + b*v + c
//   y = d*u + e*v + f

/**
 * @param {{px: number[], world: number[]}[]} pairs exactly two pairs
 * @param {{reflect?: boolean}} [opts] reflect = true when the world is y-up (meta.flipY)
 */
export function fromPairs(pairs, opts = {}) {
  if (!Array.isArray(pairs) || pairs.length !== 2) throw new Error('calibration needs exactly 2 point pairs');
  const [p1, p2] = pairs;
  const s = opts.reflect ? -1 : 1;
  // complex: z = u + i*s*v, w = x + i*y, w = m*z + k
  const z1 = [p1.px[0], s * p1.px[1]];
  const z2 = [p2.px[0], s * p2.px[1]];
  const w1 = p1.world;
  const w2 = p2.world;
  const dz = [z2[0] - z1[0], z2[1] - z1[1]];
  const dw = [w2[0] - w1[0], w2[1] - w1[1]];
  const den = dz[0] * dz[0] + dz[1] * dz[1];
  if (den === 0) throw new Error('calibration pixel points must differ');
  // m = dw / dz
  const p = (dw[0] * dz[0] + dw[1] * dz[1]) / den;
  const q = (dw[1] * dz[0] - dw[0] * dz[1]) / den;
  // k = w1 - m*z1
  const kx = w1[0] - (p * z1[0] - q * z1[1]);
  const ky = w1[1] - (p * z1[1] + q * z1[0]);
  // m*z = (p u - q s v) + i (q u + p s v)
  return { a: p, b: -q * s, c: kx, d: q, e: p * s, f: ky };
}

export function pxToWorld(T, [u, v]) {
  return [T.a * u + T.b * v + T.c, T.d * u + T.e * v + T.f];
}

export function worldToPx(T, [x, y]) {
  return pxToWorld(invert(T), [x, y]);
}

export function invert(T) {
  const det = T.a * T.e - T.b * T.d;
  if (det === 0) throw new Error('transform is not invertible');
  const a = T.e / det;
  const b = -T.b / det;
  const d = -T.d / det;
  const e = T.a / det;
  return { a, b, c: -(a * T.c + b * T.f), d, e, f: -(d * T.c + e * T.f) };
}

/** Uniform scale (world units per image pixel) of a transform. */
export function scaleOf(T) {
  return Math.sqrt(Math.abs(T.a * T.e - T.b * T.d));
}

/**
 * Default calibration that stretches an image of size w x h across the top edge of the bounds
 * (uniform scale, top-left pixel at the top-left of the bounds on screen).
 */
export function fitPairs(bounds, w, h, flipY = false) {
  const top = flipY ? bounds.max[1] : bounds.min[1];
  const bw = bounds.max[0] - bounds.min[0];
  const bh = bounds.max[1] - bounds.min[1];
  // fit inside bounds keeping aspect
  const scale = Math.min(bw / w, bh / h);
  return [
    { px: [0, 0], world: [bounds.min[0], top] },
    { px: [w, 0], world: [bounds.min[0] + w * scale, top] },
  ];
}
