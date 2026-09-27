#!/usr/bin/env node
// IluMap command line: validate | text | svg | mask | fmt | list
// No dependencies; imports the same core modules as the browser app.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { normalize, serialize, validate, zoneOf } from '../src/core/model.js';
import { LAYERS } from '../src/core/schema.js';
import { toText } from '../src/core/text-export.js';
import { renderSvg } from '../src/core/render-svg.js';
import { renderMask, maskFileName, maskSidecar, stringifySidecar, zoneTypes } from '../src/core/render-mask.js';
import { encodePng } from '../src/core/png.js';

const HELP = `IluMap CLI — map.json tools (no dependencies)

Usage: node tools/ilumap.mjs <command> <map.json> [options]

Commands:
  validate <map>             Check the file against the format rules. Exit code 1 on errors.
      --quiet                  only print errors
  text <map>                 Map as text for agents (markdown by default).
      --plain                  plain text instead of markdown
      --nearest <n>            nearest POIs listed per POI (default 3)
      --out <file>             write to a file instead of stdout
  svg <map>                  Render to SVG (stdout, or --out).
      --width <px>             image width (default 2048); height follows the bounds aspect
      --height <px>            explicit height
      --padding <px>           padding around the bounds (default 0)
      --no-grid --no-labels --no-background
      --layers a,b,c           only these layers (land,water,coast,rivers,roads,rails,walls,zones,pois,labels)
      --out <file>
  mask <map>                 Greyscale PNG masks for heightmap tools (Gaea, World Machine, UE).
      --source <s>             land | water | zones | zones:<type> | rivers | roads | rails | walls | coast | feature:<id>
                               (repeatable or comma separated; default land)
      --size <px>              longest side in pixels (default 1024); aspect follows the bounds
      --width <px> --height <px>
      --bounds x0,y0,x1,y1     world rectangle (default view.bounds)
      --invert                 white <-> black
      --feather <px>           box blur radius
      --stroke <units>         line width override in world units (lines only)
      --split                  with --source zones: one file per zone type
      --out <dir>              output directory (default .); writes masks.json next to the PNGs
  fmt <map>                  Rewrite the file in canonical format (key order, one [x, y] per line).
      --check                  do not write; exit 1 if the file is not canonical
      --stdout                 print instead of writing
  list <map>                 List items.
      --pois | --features | --links | --ids   (default --pois)
      --status <s> --type <t> --zone <id> --layer <name> --unplaced --placed
      --json                   JSON output

Examples:
  node tools/ilumap.mjs validate examples/demo/map.json
  node tools/ilumap.mjs text examples/demo/map.json --plain
  node tools/ilumap.mjs svg examples/demo/map.json --width 1600 > map.svg
  node tools/ilumap.mjs mask examples/demo/map.json --source land --size 4096 --out masks/
  node tools/ilumap.mjs mask examples/demo/map.json --source zones --split --out masks/
  node tools/ilumap.mjs list examples/demo/map.json --pois --status approved
`;

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { opts.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      let val = eq > 0 ? a.slice(eq + 1) : undefined;
      if (key.startsWith('no-')) { opts[key.slice(3)] = false; continue; }
      const takesValue = ['nearest', 'out', 'width', 'height', 'padding', 'layers', 'source', 'size', 'bounds', 'feather', 'stroke', 'status', 'type', 'zone', 'layer'].includes(key);
      if (takesValue && val === undefined) {
        val = argv[++i];
        if (val === undefined) throw new Error(`--${key} needs a value`);
      }
      if (!takesValue) val = true;
      if (key === 'source') (opts.source ||= []).push(...String(val).split(',').filter(Boolean));
      else opts[key] = val;
      continue;
    }
    pos.push(a);
  }
  return { pos, opts };
}

function readMap(file) {
  if (!file) throw new Error('missing <map.json> argument');
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { throw new Error(`cannot read ${file}: ${e.message}`); }
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
  return { text, json };
}

function num(v, name) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
}

function output(text, out) {
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, text);
    process.stderr.write(`wrote ${out}\n`);
  } else process.stdout.write(text);
}

const commands = {
  validate(file, o) {
    const { json } = readMap(file);
    const raw = validate(json);
    if (!raw.ok) {
      for (const e of raw.errors) console.log(`error  ${e.path || '(root)'}: ${e.message}`);
      if (!o.quiet) for (const w of raw.warnings) console.log(`warn   ${w.path}: ${w.message}`);
      console.log(`${file}: ${raw.errors.length} error(s)`);
      return 1;
    }
    const doc = normalize(json);
    const r = validate(doc);
    if (!o.quiet) for (const w of r.warnings) console.log(`warn   ${w.path}: ${w.message}`);
    for (const e of r.errors) console.log(`error  ${e.path}: ${e.message}`);
    if (!o.quiet) {
      const nf = LAYERS.reduce((n, l) => n + doc.layers[l].length, 0);
      console.log(`${file}: OK (${doc.pois.length} POIs, ${nf} features, ${doc.links.length} links)`);
    }
    return r.ok ? 0 : 1;
  },

  text(file, o) {
    const doc = normalize(readMap(file).json);
    output(toText(doc, { format: o.plain ? 'plain' : 'markdown', nearest: num(o.nearest, 'nearest') ?? 3 }), o.out);
    return 0;
  },

  svg(file, o) {
    const doc = normalize(readMap(file).json);
    const svg = renderSvg(doc, {
      width: num(o.width, 'width') ?? 2048,
      height: num(o.height, 'height'),
      padding: num(o.padding, 'padding') ?? 0,
      grid: o.grid === false ? false : undefined,
      labels: o.labels !== false,
      background: o.background !== false,
      layers: o.layers ? String(o.layers).split(',') : undefined,
    });
    output(svg, o.out);
    return 0;
  },

  mask(file, o) {
    const doc = normalize(readMap(file).json);
    let sources = o.source?.length ? o.source : ['land'];
    if (o.split) {
      sources = sources.flatMap((s) => (s === 'zones' ? zoneTypes(doc).map((t) => `zones:${t}`) : [s]));
      if (!sources.length) throw new Error('--split: the map has no typed zones');
    }
    let bounds;
    if (o.bounds) {
      const b = String(o.bounds).split(',').map(Number);
      if (b.length !== 4 || b.some((v) => !Number.isFinite(v)) || b[0] >= b[2] || b[1] >= b[3]) throw new Error('--bounds must be x0,y0,x1,y1 with x0<x1, y0<y1');
      bounds = { min: [b[0], b[1]], max: [b[2], b[3]] };
    }
    const outDir = o.out || '.';
    mkdirSync(outDir, { recursive: true });
    const sidecarPath = join(outDir, 'masks.json');
    let entries = [];
    let last = null;
    let previous = null;
    if (existsSync(sidecarPath)) {
      try { previous = JSON.parse(readFileSync(sidecarPath, 'utf8')); } catch { previous = null; }
    }
    for (const source of sources) {
      const m = renderMask(doc, {
        source,
        size: num(o.size, 'size'),
        width: num(o.width, 'width'),
        height: num(o.height, 'height'),
        bounds,
        invert: !!o.invert,
        feather: num(o.feather, 'feather') || 0,
        stroke: num(o.stroke, 'stroke'),
      });
      const name = maskFileName(source);
      writeFileSync(join(outDir, name), encodePng({ width: m.width, height: m.height, data: m.data, channels: 1 }, { deflate: (raw) => deflateSync(raw, { level: 9 }) }));
      const entry = { file: name, source, invert: !!o.invert, feather: num(o.feather, 'feather') || 0 };
      if (o.stroke !== undefined) entry.stroke = num(o.stroke, 'stroke');
      entries = entries.filter((e) => e.file !== name).concat(entry);
      if (!last && previous && previous.width === m.width && previous.height === m.height &&
          JSON.stringify(previous.bounds) === JSON.stringify(m.bounds) && Array.isArray(previous.masks)) {
        // same raster frame as the existing sidecar: keep its other entries
        entries = previous.masks.filter((e) => e.file !== name).concat(entries);
      }
      const white = m.data.reduce((n, v) => n + (v >= 128 ? 1 : 0), 0);
      process.stderr.write(`wrote ${join(outDir, name)} (${m.width}x${m.height}, ${((100 * white) / m.data.length).toFixed(1)}% white, ${m.unitsPerPixel.toFixed(2)} ${doc.meta.units}/px)\n`);
      last = m;
    }
    writeFileSync(sidecarPath, stringifySidecar(maskSidecar(doc, last, entries)));
    process.stderr.write(`wrote ${sidecarPath}\n`);
    return 0;
  },

  fmt(file, o) {
    const { text, json } = readMap(file);
    const r = validate(json);
    if (!r.ok) {
      for (const e of r.errors) console.error(`error  ${e.path}: ${e.message}`);
      console.error('refusing to format an invalid file (fix the errors first)');
      return 1;
    }
    const out = serialize(normalize(json));
    if (o.check) {
      const same = out === text.replace(/\r\n/g, '\n');
      console.log(same ? `${file}: canonical` : `${file}: not canonical (run: node tools/ilumap.mjs fmt ${file})`);
      return same ? 0 : 1;
    }
    if (o.stdout) { process.stdout.write(out); return 0; }
    if (out === text) console.log(`${file}: already canonical`);
    else { writeFileSync(file, out); console.log(`${file}: formatted`); }
    return 0;
  },

  list(file, o) {
    const doc = normalize(readMap(file).json);
    const what = o.features ? 'features' : o.links ? 'links' : o.ids ? 'ids' : 'pois';
    let rows = [];
    if (what === 'pois') {
      rows = doc.pois
        .filter((p) => !o.status || p.status === o.status)
        .filter((p) => !o.type || p.type === o.type)
        .filter((p) => !o.unplaced || p.placed === false)
        .filter((p) => !o.placed || p.placed !== false)
        .map((p) => ({ ...p, zone: p.zone || (p.placed === false ? null : zoneOf(doc, [p.x, p.y])) }))
        .filter((p) => !o.zone || p.zone === o.zone);
      if (o.json) return output(`${JSON.stringify(rows, null, 2)}\n`), 0;
      for (const p of rows) {
        console.log([p.id, p.type, p.status, p.placed === false ? 'unplaced' : `${Math.round(p.x)},${Math.round(p.y)}`, p.zone || '-', JSON.stringify(p.name)].join('\t'));
      }
    } else if (what === 'features') {
      for (const l of LAYERS) {
        if (o.layer && o.layer !== l) continue;
        for (const f of doc.layers[l]) {
          if (o.type && f.type !== o.type) continue;
          rows.push({ layer: l, id: f.id, type: f.type || null, name: f.name || null, points: f.points.length, gates: (f.wall?.gates || []).map((g) => g.id) });
        }
      }
      if (o.json) return output(`${JSON.stringify(rows, null, 2)}\n`), 0;
      for (const r of rows) console.log([r.layer, r.id, r.type || '-', `${r.points} pts`, JSON.stringify(r.name || ''), r.gates.length ? `gates: ${r.gates.join(',')}` : ''].join('\t').trimEnd());
    } else if (what === 'links') {
      rows = doc.links.filter((k) => !o.type || k.type === o.type);
      if (o.json) return output(`${JSON.stringify(rows, null, 2)}\n`), 0;
      for (const k of rows) console.log([k.from, '->', k.to, k.type, k.name ? JSON.stringify(k.name) : '', k.feature ? `via ${k.feature}` : ''].join('\t').trimEnd());
    } else {
      const ids = [];
      for (const l of LAYERS) for (const f of doc.layers[l]) {
        ids.push({ id: f.id, kind: 'feature', layer: l });
        for (const g of f.wall?.gates || []) ids.push({ id: g.id, kind: 'gate', layer: l, feature: f.id });
      }
      for (const p of doc.pois) ids.push({ id: p.id, kind: 'poi' });
      for (const k of doc.links) if (k.id) ids.push({ id: k.id, kind: 'link' });
      if (o.json) return output(`${JSON.stringify(ids, null, 2)}\n`), 0;
      for (const r of ids) console.log([r.id, r.kind, r.layer || ''].join('\t').trimEnd());
    }
    return 0;
  },
};

async function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  const { pos, opts } = parsed;
  const cmd = pos[0];
  if (!cmd || opts.help || cmd === 'help') { process.stdout.write(HELP); return cmd || opts.help ? 0 : 2; }
  const fn = commands[cmd];
  if (!fn) { console.error(`unknown command "${cmd}"\n`); process.stdout.write(HELP); return 2; }
  try {
    return fn(pos[1], opts) ?? 0;
  } catch (e) {
    console.error(`ilumap ${cmd}: ${e.message}`);
    return 1;
  }
}

process.exitCode = await main();
