#!/usr/bin/env node
// IluMap command line: validate | text | svg | mask | terrain | fmt | list | diff | version
// No dependencies; imports the same core modules as the browser app.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { normalize, serialize, validate, zoneOf, findById } from '../src/core/model.js';
import { route, describeRoute } from '../src/core/routes.js';
import { LAYERS } from '../src/core/schema.js';
import { toText } from '../src/core/text-export.js';
import { renderSvg } from '../src/core/render-svg.js';
import { renderMask, maskFileName, maskSidecar, stringifySidecar, zoneTypes } from '../src/core/render-mask.js';
import { encodePng } from '../src/core/png.js';
import { diffMaps, formatDiff } from '../src/core/diff.js';
import { VERSION } from '../src/core/schema.js';
import { APP_VERSION } from '../src/app/version.js';
import {
  terrainOf, computeTerrain, terrainBlock, resolutionForQuad, explicitFor, quadOptions, unrealSettingsText, terrainSize,
} from '../src/core/terrain.js';

// How the user invoked us: tools/ilumap.mjs in the repo, ilumap.mjs for the single-file bundle.
const CLI = /(^|[\\/])tools[\\/]ilumap\.mjs$/.test(process.argv[1] || '') ? 'tools/ilumap.mjs' : 'ilumap.mjs';
const VERSION_TEXT = `ilumap ${APP_VERSION} (map format v${VERSION})\n`;

const HELP = `IluMap CLI ${APP_VERSION} — map.json tools (no dependencies, map format v${VERSION})

Usage: node ${CLI} <command> <map.json> [options]
       node ${CLI} --version | --help

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
      --source <s>             land | water | zones | zones:<type> | rivers | roads | rails | walls | coast | relief |
                               relief:<type> | bridges | feature:<id>
                               (repeatable or comma separated; default land)
      --size <px>              longest side in pixels (default 1024); aspect follows the bounds
      --width <px> --height <px>
      --bounds x0,y0,x1,y1     world rectangle (default view.bounds)
      --invert                 white <-> black
      --feather <px>           box blur radius
      --stroke <units>         line width override in world units (lines only)
      --split                  with --source zones: one file per zone type
      --out <dir>              output directory (default .); writes masks.json next to the PNGs
  route <map> <from> <to>    Distance along roads (or rails with --rail) between two POIs / gates, the roads used and
                             what lies on the way: rivers, faults, cliffs, lakes, with the bridges over them.
      --rail                   travel on rails instead of roads
      --json                   JSON output (length, straight, path, features, crossings)
  terrain <map>              Unreal Mesh Terrain grid calculator: size (from view.bounds), resolution,
                             quad size, sections, heightmap size, values to type into Unreal.
      --quad <units>           pick the resolution that gives quads of this size (e.g. 100 = 1 m)
      --resolution x,y         quads per axis (Mesh → Resolution)
      --sections <mode>        automatic | explicit
      --max-triangles <n>      automatic sections: triangles per section (default 524288)
      --layout x,y             explicit sections per axis
      --section-res x,y        explicit quads per section (layout is derived with --quad/--resolution)
      --height-range <units>   Z size for Import Heightmap (default 25600)
      --write                  store the result in map.json (terrain block)
      --json                   JSON output
  fmt <map>                  Rewrite the file in canonical format (key order, one [x, y] per line).
      --check                  do not write; exit 1 if the file is not canonical
      --stdout                 print instead of writing
  list <map>                 List items.
      --pois | --features | --links | --ids   (default --pois)
      --status <s> --type <t> --zone <id> --layer <name> --unplaced --placed
      --json                   JSON output
  diff <old> <new>           What changed between two versions of a map: POIs moved (distance, compass
                             direction, zone), placed, added, removed, renamed, re-typed; features added,
                             removed, reshaped (points, length / area, centre shift); links; map settings.
  diff <map> --git [rev]     Compare the file with its committed version (git show <rev>:<path>, default HEAD).
      --plain                  plain text instead of markdown
      --json                   structured JSON
      --out <file>             write to a file instead of stdout
  version                    Print the CLI and map format versions (same as --version / -v).

Examples:
  node ${CLI} validate examples/demo/map.json
  node ${CLI} diff examples/demo/map.json --git            # what changed since the last commit
  node ${CLI} diff old/map.json map.json --plain
  node ${CLI} text examples/demo/map.json --plain
  node ${CLI} svg examples/demo/map.json --width 1600 > map.svg
  node ${CLI} mask examples/demo/map.json --source land --size 4096 --out masks/
  node ${CLI} mask examples/demo/map.json --source zones --split --out masks/
  node ${CLI} list examples/demo/map.json --pois --status approved
  node ${CLI} terrain examples/demo/map.json --quad 400 --sections explicit --section-res 256,256
`;

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { opts.help = true; continue; }
    if (a === '-v') { opts.version = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      let val = eq > 0 ? a.slice(eq + 1) : undefined;
      if (key.startsWith('no-')) { opts[key.slice(3)] = false; continue; }
      const takesValue = ['nearest', 'out', 'width', 'height', 'padding', 'layers', 'source', 'size', 'bounds', 'feather', 'stroke', 'status', 'type', 'zone', 'layer', 'quad', 'resolution', 'sections', 'max-triangles', 'layout', 'section-res', 'height-range'].includes(key);
      if (takesValue && val === undefined) {
        val = argv[++i];
        if (val === undefined) throw new Error(`--${key} needs a value`);
      }
      if (!takesValue) val = key === 'git' && val !== undefined ? val : true; // --git=<rev>
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

function intPair(v, name) {
  if (v === undefined) return undefined;
  const p = String(v).split(/[,x×]/).map((s) => Number(s.trim()));
  if (p.length === 1) p.push(p[0]);
  if (p.length !== 2 || !p.every((n) => Number.isInteger(n) && n > 0)) throw new Error(`--${name} must be two positive integers, e.g. 4,4`);
  return p;
}

/** The committed text of `file` at `rev` (git show <rev>:<path relative to the repo root>). */
function gitShow(file, rev) {
  const abs = resolve(file);
  if (!existsSync(abs)) throw new Error(`cannot read ${file}`);
  const git = (args, cwd) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('git is not installed or not on PATH (compare two files instead: diff <old.json> <new.json>)');
      const err = new Error(String(e.stderr || e.message).trim().split('\n')[0].replace(/^fatal: /, ''));
      err.git = true;
      throw err;
    }
  };
  let top;
  try { top = git(['rev-parse', '--show-toplevel'], dirname(abs)).trim(); } catch (e) {
    if (!e.git) throw e;
    throw new Error(`${file} is not inside a git repository (${e.message}); compare two files instead: diff <old.json> <new.json>`);
  }
  const path = relative(realpathSync(top), realpathSync(abs)).split(sep).join('/');
  try { return git(['show', `${rev}:${path}`], top); } catch (e) {
    if (!e.git) throw e;
    throw new Error(`git show ${rev}:${path}: ${e.message}`);
  }
}

function parseJson(text, label) {
  try { return JSON.parse(text); } catch (e) { throw new Error(`${label} is not valid JSON: ${e.message}`); }
}

const commands = {
  route(file, o, pos = []) {
    const [, , from, to] = pos;
    if (!from || !to) throw new Error('usage: route <map.json> <from-id> <to-id> [--rail] [--json]');
    const { json } = readMap(file);
    const doc = normalize(json);
    const layers = o.rail ? ['rails', 'bridges'] : ['roads', 'bridges'];
    if (o.json) {
      const r = route(doc, from, to, { layers });
      if (!r) throw new Error(`unknown or unplaced id: ${findById(doc, from) ? to : from}`);
      process.stdout.write(`${JSON.stringify(r, null, 2)}
`);
      return r.ok ? 0 : 1;
    }
    process.stdout.write(`${describeRoute(doc, from, to, { layers })}
`);
    return 0;
  },

  diff(file, o, pos = []) {
    if (!file) throw new Error('usage: diff <old.json> <new.json>  or  diff <map.json> --git [rev]');
    let before;
    let after;
    if (o.git !== undefined && o.git !== false) {
      const rev = typeof o.git === 'string' ? o.git : pos[2] || 'HEAD';
      if (pos.length > 3 || (typeof o.git === 'string' && pos[2])) throw new Error('usage: diff <map.json> --git [rev]');
      after = readMap(file).json;
      before = parseJson(gitShow(file, rev), `${file} at ${rev}`);
    } else {
      if (!pos[2] || pos.length > 3) throw new Error('usage: diff <old.json> <new.json>  or  diff <map.json> --git [rev]');
      before = readMap(file).json;
      after = readMap(pos[2]).json;
    }
    const d = diffMaps(before, after);
    if (o.json) output(`${JSON.stringify(d, null, 2)}\n`, o.out);
    else output(formatDiff(d, { format: o.plain ? 'plain' : 'markdown' }), o.out);
    return 0;
  },

  terrain(file, o) {
    const { json } = readMap(file);
    const doc = normalize(json);
    const t = terrainOf(doc);
    const size = terrainSize(doc);
    if (o.sections !== undefined) {
      if (o.sections !== 'automatic' && o.sections !== 'explicit') throw new Error('--sections must be automatic or explicit');
      if (o.sections !== t.sections.mode) t.sections = o.sections === 'explicit' ? { mode: 'explicit', layout: [4, 4], resolution: [256, 256] } : { mode: 'automatic', maxTriangles: 524288 };
    }
    let res = t.resolution;
    if (o.quad !== undefined) res = resolutionForQuad(size, num(o.quad, 'quad'));
    if (o.resolution !== undefined) res = intPair(o.resolution, 'resolution');
    if (t.sections.mode === 'explicit') {
      const secRes = intPair(o['section-res'], 'section-res') || t.sections.resolution;
      const layout = intPair(o.layout, 'layout');
      t.sections = layout ? { mode: 'explicit', layout, resolution: secRes } : { mode: 'explicit', ...explicitFor(res, secRes) };
      t.resolution = [t.sections.layout[0] * t.sections.resolution[0], t.sections.layout[1] * t.sections.resolution[1]];
    } else {
      t.resolution = res;
      if (o['max-triangles'] !== undefined) t.sections.maxTriangles = Math.round(num(o['max-triangles'], 'max-triangles'));
    }
    if (o['height-range'] !== undefined) t.heightRange = num(o['height-range'], 'height-range');
    const block = terrainBlock(t);
    const c = computeTerrain(doc, block);
    if (o.write) {
      doc.terrain = block;
      const r = validate(doc);
      if (!r.ok) throw new Error(r.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
      writeFileSync(file, serialize(doc));
      process.stderr.write(`wrote terrain block to ${file}\n`);
    }
    if (o.json) { process.stdout.write(`${JSON.stringify({ terrain: block, computed: c, options: quadOptions(doc) }, null, 2)}\n`); return 0; }
    const u = doc.meta.units || 'cm';
    const f = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US');
    const lines = [
      `${doc.meta.name || 'Untitled'} — Unreal Mesh Terrain grid${json.terrain ? '' : ' (not set in map.json yet; defaults shown)'}`,
      '',
      `Size          ${f(c.size[0])} × ${f(c.size[1])} ${u}`,
      `Resolution    ${c.resolution[0]} × ${c.resolution[1]} quads`,
      `Quad          ${f(c.quad[0])} × ${f(c.quad[1])} ${u}${c.square ? '' : '  (not square!)'}`,
      `Mesh          ${c.vertices.toLocaleString('en-US')} vertices, ${c.triangles.toLocaleString('en-US')} triangles`,
      `Sections      ${c.sections.mode}${c.sections.estimated ? ' (estimate)' : ''}: ${c.sections.layout[0]} × ${c.sections.layout[1]} = ${c.sections.count}, `
        + `${c.sections.resolution[0]} × ${c.sections.resolution[1]} quads each (${f(c.sections.size[0])} × ${f(c.sections.size[1])} ${u}), ${c.sections.trianglesPerSection.toLocaleString('en-US')} triangles each`,
      `Heightmap     ${c.heightmap.width} × ${c.heightmap.height} px (one pixel per vertex), Z range ${f(c.heightRange)} ${u}, 16-bit step ${f(c.zStep)} ${u}`,
      ...(c.warnings.length ? [`Warnings      ${c.warnings.join(', ')}`] : []),
      '',
      unrealSettingsText(c).trimEnd(),
      '',
      'Quad size options (automatic sections):',
      ...quadOptions(doc).map((r) => `  ${String(r.quadTarget).padStart(4)} ${u} → ${r.resolution[0]} × ${r.resolution[1]} quads, ${r.triangles.toLocaleString('en-US')} triangles, ~${r.sections.count} sections`),
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  },

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
      console.log(same ? `${file}: canonical` : `${file}: not canonical (run: node ${CLI} fmt ${file})`);
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
  if (opts.version || cmd === 'version') { process.stdout.write(VERSION_TEXT); return 0; }
  if (!cmd || opts.help || cmd === 'help') { process.stdout.write(HELP); return cmd || opts.help ? 0 : 2; }
  const fn = commands[cmd];
  if (!fn) { console.error(`unknown command "${cmd}"\n`); process.stdout.write(HELP); return 2; }
  try {
    return fn(pos[1], opts, pos) ?? 0;
  } catch (e) {
    console.error(`ilumap ${cmd}: ${e.message}`);
    return 1;
  }
}

process.exitCode = await main();
