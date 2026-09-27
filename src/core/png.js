// Minimal PNG encoder (greyscale or RGBA, 8 bit). No dependencies.
//
// encodePng(img, { deflate })      synchronous. `deflate` is a zlib-format compressor
//                                   (Node: zlib.deflateSync). Without it, stored
//                                   (uncompressed) deflate blocks are written, which
//                                   is valid PNG everywhere, just larger.
// encodePngAsync(img)               uses CompressionStream('deflate') when available
//                                   (browsers, Node >= 18), else stored blocks.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0xffffffff) {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
}

export function adler32(bytes) {
  let a = 1; let b = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + 5552);
    for (; i < end; i++) { a += bytes[i]; b += a; }
    a %= MOD; b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream made of stored (uncompressed) deflate blocks. */
export function zlibStored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let o = 0;
  out[o++] = 0x78; out[o++] = 0x01;
  for (let bIdx = 0; bIdx < blocks; bIdx++) {
    const start = bIdx * 65535;
    const len = Math.min(65535, raw.length - start);
    out[o++] = bIdx === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff; out[o++] = (len >>> 8) & 0xff;
    out[o++] = ~len & 0xff; out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(raw);
  out[o++] = (ad >>> 24) & 0xff; out[o++] = (ad >>> 16) & 0xff; out[o++] = (ad >>> 8) & 0xff; out[o++] = ad & 0xff;
  return out;
}

/** Scanlines with filter byte 0 (None). */
export function rawScanlines({ width, height, data, channels = 1 }) {
  const stride = width * channels;
  if (data.length < stride * height) throw new Error(`pixel data too short: ${data.length} < ${stride * height}`);
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return raw;
}

function chunk(type, payload) {
  const out = new Uint8Array(12 + payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  const crc = crc32(out.subarray(4, 8 + payload.length)) ^ 0xffffffff;
  dv.setUint32(8 + payload.length, crc >>> 0);
  return out;
}

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function assemble({ width, height, channels = 1 }, idat) {
  if (channels !== 1 && channels !== 4) throw new Error('channels must be 1 (grey) or 4 (RGBA)');
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 1 ? 0 : 6; // colour type
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * @param {{width: number, height: number, data: Uint8Array, channels?: 1|4}} img
 * @param {{deflate?: (raw: Uint8Array) => Uint8Array}} [opts]
 * @returns {Uint8Array}
 */
export function encodePng(img, opts = {}) {
  const raw = rawScanlines(img);
  const z = opts.deflate ? new Uint8Array(opts.deflate(raw)) : zlibStored(raw);
  return assemble(img, z);
}

/** Async variant using CompressionStream('deflate') (zlib format) when available. */
export async function encodePngAsync(img) {
  const raw = rawScanlines(img);
  let z;
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('deflate');
    const stream = new Blob([raw]).stream().pipeThrough(cs);
    z = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    z = zlibStored(raw);
  }
  return assemble(img, z);
}
