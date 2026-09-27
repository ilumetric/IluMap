// map.json -> markdown / plain text summary for agents (and humans).

import { LAYERS } from './schema.js';
import {
  distance, bearing, compass8, polylineLength, polygonArea, featureGeometry, nearestPointOnPolyline, wallLayout,
} from './geometry.js';
import { zoneOf, isLand, waterAt, findById } from './model.js';
import { computeTerrain } from './terrain.js';

/**
 * Length in world units -> "1.2 km" / "350 m" / "12 cm" using meta.displayUnit(Scale).
 * opts (optional, used by the localised UI; the CLI and text export keep the
 * English default): { locale: 'ru', units: { km: 'км', m: 'м', … } }.
 */
export function formatLength(worldLen, meta = {}, opts = {}) {
  const scale = meta.displayUnitScale > 0 ? meta.displayUnitScale : 100;
  const unit = meta.displayUnit || 'm';
  const d = worldLen / scale;
  const n = numberFormatter(opts);
  const u = unitName(opts);
  if (unit === 'm') {
    if (Math.abs(d) >= 1000) return `${n(d / 1000, 1)} ${u('km')}`;
    if (Math.abs(d) >= 100) return `${n(Math.round(d), 0)} ${u('m')}`;
    return `${n(d, 1)} ${u('m')}`;
  }
  if (Math.abs(d) >= 100) return `${n(Math.round(d), 0)} ${u(unit)}`;
  return `${n(d, 2)} ${u(unit)}`;
}

/** Area in world units² -> "12.5 km²" / "800 m²". Same optional opts as formatLength. */
export function formatArea(worldArea, meta = {}, opts = {}) {
  const scale = meta.displayUnitScale > 0 ? meta.displayUnitScale : 100;
  const unit = meta.displayUnit || 'm';
  const a = worldArea / (scale * scale);
  const n = numberFormatter(opts);
  const u = unitName(opts);
  if (unit === 'm') {
    if (a >= 1e5) return `${n(a / 1e6, a >= 1e7 ? 1 : 2)} ${u('km')}²`;
    return `${n(Math.round(a), 0)} ${u('m')}²`;
  }
  return `${n(a, 1)} ${u(unit)}²`;
}

function trim(v, digits) {
  return String(Number(v.toFixed(digits)));
}

/** Default: "1234.5" (no grouping, dot); with opts.locale: Intl formatting ("1234,5"). */
function numberFormatter(opts) {
  if (!opts?.locale) return trim;
  return (v, digits) => new Intl.NumberFormat(opts.locale, { maximumFractionDigits: digits }).format(Number(v.toFixed(digits)));
}

function unitName(opts) {
  const units = opts?.units || {};
  return (name) => units[name] ?? name;
}

function fmtCoord(v) {
  return Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');
}

/**
 * @param {object} doc normalised map
 * @param {{format?: 'markdown'|'plain', nearest?: number}} opts
 */
export function toText(doc, opts = {}) {
  const md = (opts.format || 'markdown') !== 'plain';
  const nearestN = opts.nearest ?? 3;
  const meta = doc.meta || {};
  const flipY = !!meta.flipY;
  const b = (s) => (md ? `**${s}**` : s);
  const c = (s) => (md ? `\`${s}\`` : s);
  const h1 = (s) => (md ? `# ${s}` : `${s}\n${'='.repeat(s.length)}`);
  const h2 = (s) => (md ? `## ${s}` : `${s}\n${'-'.repeat(s.length)}`);
  const L = (w) => formatLength(w, meta);

  const zonesById = new Map((doc.layers.zones || []).map((z) => [z.id, z]));
  const nameOf = (id) => {
    const hit = findById(doc, id);
    if (!hit) return id;
    return hit.item.name || id;
  };
  const ref = (id) => `${nameOf(id)} (${c(id)})`;
  const zoneLabel = (zid) => {
    const z = zonesById.get(zid);
    return z ? (z.name || z.id) : zid;
  };

  const placed = doc.pois.filter((p) => p.placed !== false);
  const unplaced = doc.pois.filter((p) => p.placed === false);
  const featureCount = LAYERS.reduce((n, l) => n + doc.layers[l].length, 0);

  const out = [];
  out.push(h1(meta.name || 'Untitled'));
  out.push('');
  if (meta.description) { out.push(meta.description); out.push(''); }

  const bd = doc.view.bounds;
  const w = bd.max[0] - bd.min[0];
  const hgt = bd.max[1] - bd.min[1];
  out.push(`- Extent: ${L(w)} × ${L(hgt)} (x ${fmtCoord(bd.min[0])}…${fmtCoord(bd.max[0])}, y ${fmtCoord(bd.min[1])}…${fmtCoord(bd.max[1])} ${meta.units || 'cm'}); 1 ${meta.displayUnit || 'm'} = ${meta.displayUnitScale ?? 100} ${meta.units || 'cm'}.`);
  out.push(`- Orientation: north is ${flipY ? '+y' : '−y'} (flipY: ${flipY}). Land mode: ${meta.landMode || 'islands'}.`);
  if (doc.terrain) {
    const tc = computeTerrain(doc);
    const sec = tc.sections;
    out.push(`- Terrain grid (Unreal Mesh Terrain): ${tc.resolution[0]} × ${tc.resolution[1]} quads, one quad ${L(tc.quad[0])}${tc.square ? '' : ` × ${L(tc.quad[1])}`}; sections ${sec.mode}${sec.estimated ? ' (estimated)' : ''} ${sec.layout[0]} × ${sec.layout[1]} of ${sec.resolution[0]} × ${sec.resolution[1]} quads (${L(sec.size[0])} each); heightmap ${tc.heightmap.width} × ${tc.heightmap.height} px, Z range ${L(tc.heightRange)}.`);
  }
  out.push(`- Contents: ${doc.pois.length} POIs (${unplaced.length} unplaced), ${featureCount} features, ${doc.links.length} links.`);
  out.push('');

  // --- POIs
  const where = (p) => {
    const pt = [p.x, p.y];
    const zid = p.zone || zoneOf(doc, pt);
    const parts = [];
    parts.push(zid ? `zone: ${zoneLabel(zid)}` : 'no zone');
    if (isLand(doc, pt)) parts.push('on land');
    else {
      const wf = waterAt(doc, pt);
      parts.push(wf ? `in water (${wf.name || wf.id})` : 'at sea');
    }
    return parts.join(', ');
  };

  const linksOf = (id) => doc.links.filter((k) => k.from === id || k.to === id);
  const linkPhrase = (k, id) => {
    const out2 = k.from === id ? `${k.type} → ${k.to}` : `${k.type} ← ${k.from}`;
    return k.name ? `${out2} ("${k.name}")` : out2;
  };

  const poiBlock = (p, isPlaced) => {
    const lines = [];
    lines.push(`- ${b(p.name)} (${c(p.id)}, ${p.type}, ${p.status || 'idea'}) — ${where(p)}${isPlaced ? '.' : `, rough position (${fmtCoord(p.x)}, ${fmtCoord(p.y)}); not yet placed on the map.`}`);
    if (isPlaced && nearestN > 0) {
      const others = placed
        .filter((o) => o !== p)
        .map((o) => ({ o, d: distance([o.x, o.y], [p.x, p.y]) }))
        .sort((a, z) => a.d - z.d)
        .slice(0, nearestN);
      if (others.length) {
        const phr = others.map(({ o, d }) => `${L(d)} ${compass8(bearing([o.x, o.y], [p.x, p.y], flipY))} of ${o.name} (${c(o.id)})`);
        lines.push(`  ${phr.join(', ')}.`);
      }
    }
    const ls = linksOf(p.id);
    if (ls.length) lines.push(`  Links: ${ls.map((k) => linkPhrase(k, p.id)).join('; ')}.`);
    const extra = [];
    if (p.tags?.length) extra.push(`Tags: ${p.tags.join(', ')}.`);
    if (p.anchor) extra.push(`Anchor: ${p.anchor}.`);
    if (p.notes) extra.push(`Notes: ${p.notes}`);
    if (extra.length) lines.push(`  ${extra.join(' ')}`);
    return lines;
  };

  out.push(h2(`Points of interest (${placed.length})`));
  out.push('');
  if (!placed.length) out.push('(none)');
  for (const p of placed) out.push(...poiBlock(p, true));
  out.push('');

  if (unplaced.length) {
    out.push(h2(`Unplaced POIs (${unplaced.length})`));
    out.push('');
    for (const p of unplaced) out.push(...poiBlock(p, false));
    out.push('');
  }

  // --- zones
  if (doc.layers.zones.length) {
    out.push(h2('Zones'));
    out.push('');
    for (const z of doc.layers.zones) {
      const ring = featureGeometry(z);
      const inside = placed.filter((p) => (p.zone || zoneOf(doc, [p.x, p.y])) === z.id);
      let line = `- ${b(z.name || z.id)} (${c(z.id)}${z.type ? `, ${z.type}` : ''}) — ${formatArea(polygonArea(ring), meta)}`;
      line += inside.length ? `; POIs: ${inside.map((p) => `${p.name} (${c(p.id)})`).join(', ')}.` : '.';
      out.push(line);
    }
    out.push('');
  }

  // --- land & water
  if (doc.layers.land.length || doc.layers.water.length || meta.landMode === 'filled') {
    out.push(h2('Land and water'));
    out.push('');
    if (meta.landMode === 'filled') out.push('- Land: the whole map extent (landMode: filled).');
    else if (doc.layers.land.length) {
      out.push(`- Land: ${doc.layers.land.map((f) => `${b(f.name || f.id)} (${c(f.id)}) ${formatArea(polygonArea(featureGeometry(f)), meta)}`).join(', ')}.`);
    }
    if (doc.layers.water.length) {
      out.push(`- Water: ${doc.layers.water.map((f) => `${b(f.name || f.id)} (${c(f.id)}) ${formatArea(polygonArea(featureGeometry(f)), meta)}`).join(', ')}.`);
    }
    out.push('');
  }

  // --- lines
  const diag = Math.hypot(w, hgt);
  const near = diag * 0.02;
  const placeDesc = (pt) => {
    const zid = zoneOf(doc, pt);
    if (zid) return zoneLabel(zid);
    if (isLand(doc, pt)) return 'open land';
    const wf = waterAt(doc, pt);
    return wf ? (wf.name || wf.id) : 'the sea';
  };
  const lineLayers = [['rivers', 'Rivers'], ['roads', 'Roads'], ['rails', 'Railways'], ['coast', 'Coast lines']];
  const anyLines = lineLayers.some(([l]) => doc.layers[l].length);
  if (anyLines) {
    out.push(h2('Rivers, roads and rails'));
    out.push('');
    for (const [l, title] of lineLayers) {
      for (const f of doc.layers[l]) {
        const g = featureGeometry(f);
        if (g.length < 2) continue;
        const closed = f.closed === true;
        const passes = placed.filter((p) => nearestPointOnPolyline([p.x, p.y], g, closed).dist <= near);
        let line = `- ${title.replace(/s$/, '')}: ${b(f.name || f.id)} (${c(f.id)}${f.type ? `, ${f.type}` : ''}) — ${L(polylineLength(g, closed))}`;
        if (!closed) line += `, from ${placeDesc(g[0])} to ${placeDesc(g[g.length - 1])}`;
        if (passes.length) line += `; passes ${passes.map((p) => `${p.name} (${c(p.id)})`).join(', ')}`;
        if (f.width) line += `; width ${L(f.width)}`;
        out.push(`${line}.`);
      }
    }
    out.push('');
  }

  // --- walls
  if (doc.layers.walls.length) {
    out.push(h2('Walls'));
    out.push('');
    for (const f of doc.layers.walls) {
      const lay = wallLayout(f);
      let line = `- ${b(f.name || f.id)} (${c(f.id)}${f.type ? `, ${f.type}` : ''}) — ${f.closed ? 'closed' : 'open'}, ${L(lay.length)}, ${lay.towers.length} towers`;
      if (lay.gates.length) line += `; gates: ${lay.gates.map((g) => `${g.name || g.id} (${c(g.id)})`).join(', ')}`;
      out.push(`${line}.`);
    }
    out.push('');
  }

  // --- links
  if (doc.links.length) {
    out.push(h2('Links'));
    out.push('');
    for (const k of doc.links) {
      const a = findById(doc, k.from);
      const z = findById(doc, k.to);
      let line = `- ${ref(k.from)} → ${ref(k.to)}: ${k.type}`;
      if (k.name) line += ` "${k.name}"`;
      const pa = a && (a.kind === 'poi' ? [a.item.x, a.item.y] : null);
      const pz = z && (z.kind === 'poi' ? [z.item.x, z.item.y] : null);
      if (pa && pz && a.item.placed !== false && z.item.placed !== false) line += `, ${L(distance(pa, pz))} straight-line`;
      if (k.feature) line += ` (via ${c(k.feature)})`;
      if (k.notes) line += ` — ${k.notes}`;
      out.push(line);
    }
    out.push('');
  }

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
