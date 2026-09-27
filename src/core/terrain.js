// Terrain grid calculator for Unreal Engine Mesh Terrain (MeshPartition
// "Create Rectangle" / "Import Heightmap"). Pure module: no DOM.
//
// The map's world size comes from view.bounds (world units, cm by default).
// doc.terrain stores the grid the level designer picked, so agents and
// people read the same numbers:
//   "terrain": {
//     "target": "ue-mesh-terrain",
//     "resolution": [1000, 1000],          // quads on X and Y (Mesh → Resolution)
//     "sections": { "mode": "automatic", "maxTriangles": 524288 }
//              |  { "mode": "explicit", "layout": [4, 4], "resolution": [256, 256] },
//     "heightRange": 25600                 // Z size of an imported heightmap, world units
//   }
// Quad size = size / resolution. In explicit mode the total resolution is
// layout × section resolution. In automatic mode Unreal splits the mesh into
// sections of at most maxTriangles triangles; the layout shown here is an
// estimate (square sections), Unreal decides the exact split.

export const TERRAIN_TARGETS = ['ue-mesh-terrain'];
export const SECTION_MODES = ['automatic', 'explicit'];
export const DEFAULT_MAX_TRIANGLES = 524288; // 2^19, Unreal's default
export const DEFAULT_HEIGHT_RANGE = 25600; // 256 m in cm
/** Quad sizes offered as presets, in cm. */
export const QUAD_PRESETS = [25, 50, 100, 200, 400, 800];
/** Section resolutions (quads per side) offered for the explicit mode. */
export const SECTION_PRESETS = [63, 127, 128, 255, 256, 511, 512];

const posInt = (v) => Number.isInteger(v) && v > 0;
const clampInt = (v, lo = 1, hi = 1e6) => Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));

/** World size of the map [x, y] from view.bounds. */
export function terrainSize(doc) {
  const b = doc.view.bounds;
  return [b.max[0] - b.min[0], b.max[1] - b.min[1]];
}

/** Resolution (quads per axis) that gives quads of about `quad` world units. */
export function resolutionForQuad(size, quad) {
  return [clampInt(size[0] / quad), clampInt(size[1] / quad)];
}

/** Default quad: 1 m (100 units), doubled until a side has at most 4096 quads. */
export function defaultQuad(size) {
  let q = 100;
  while (Math.max(size[0], size[1]) / q > 4096 && q < 1e7) q *= 2;
  return q;
}

/** A terrain block for a map: its own values or defaults (defaultQuad, automatic sections). */
export function terrainOf(doc) {
  const t = doc.terrain && typeof doc.terrain === 'object' ? doc.terrain : {};
  const size = terrainSize(doc);
  const s = t.sections && typeof t.sections === 'object' ? t.sections : {};
  const mode = SECTION_MODES.includes(s.mode) ? s.mode : 'automatic';
  const pair = (v, fb) => (Array.isArray(v) && v.length === 2 && v.every(posInt) ? v.slice() : fb);
  const resolution = pair(t.resolution, resolutionForQuad(size, defaultQuad(size)));
  const sections = mode === 'explicit'
    ? { mode, layout: pair(s.layout, [4, 4]), resolution: pair(s.resolution, [256, 256]) }
    : { mode, maxTriangles: posInt(s.maxTriangles) ? s.maxTriangles : DEFAULT_MAX_TRIANGLES };
  return {
    target: TERRAIN_TARGETS.includes(t.target) ? t.target : 'ue-mesh-terrain',
    resolution: mode === 'explicit' ? [sections.layout[0] * sections.resolution[0], sections.layout[1] * sections.resolution[1]] : resolution,
    sections,
    heightRange: t.heightRange > 0 ? t.heightRange : DEFAULT_HEIGHT_RANGE,
  };
}

/** Estimated automatic split: square sections with at most maxTriangles triangles each. */
export function autoSections(resolution, maxTriangles = DEFAULT_MAX_TRIANGLES) {
  const side = Math.max(1, Math.floor(Math.sqrt(Math.max(2, maxTriangles) / 2)));
  const layout = [Math.ceil(resolution[0] / side), Math.ceil(resolution[1] / side)];
  return { layout, resolution: [Math.ceil(resolution[0] / layout[0]), Math.ceil(resolution[1] / layout[1])] };
}

/** Explicit split for a total resolution with sections of `sectionRes` quads: layout rounded up. */
export function explicitFor(resolution, sectionRes) {
  return { layout: [Math.max(1, Math.ceil(resolution[0] / sectionRes[0])), Math.max(1, Math.ceil(resolution[1] / sectionRes[1]))], resolution: sectionRes.slice() };
}

/**
 * All the numbers of a terrain grid.
 * @returns {{ target, size, resolution, quad, square, quads, vertices, triangles,
 *   sections: { mode, layout, resolution, count, trianglesPerSection, size, maxTriangles?, estimated },
 *   heightmap: { width, height }, heightRange, zStep, warnings: string[] }}
 */
export function computeTerrain(doc, terrain = terrainOf(doc)) {
  const size = terrainSize(doc);
  const t = terrain;
  const res = t.resolution;
  const quad = [size[0] / res[0], size[1] / res[1]];
  const square = Math.abs(quad[0] - quad[1]) <= Math.max(quad[0], quad[1]) * 0.005;
  const quads = res[0] * res[1];
  const triangles = 2 * quads;
  const auto = t.sections.mode === 'automatic';
  const split = auto ? autoSections(res, t.sections.maxTriangles) : { layout: t.sections.layout, resolution: t.sections.resolution };
  const count = split.layout[0] * split.layout[1];
  const sections = {
    mode: t.sections.mode,
    layout: split.layout,
    resolution: split.resolution,
    count,
    trianglesPerSection: 2 * split.resolution[0] * split.resolution[1],
    size: [split.resolution[0] * quad[0], split.resolution[1] * quad[1]],
    estimated: auto,
  };
  if (auto) sections.maxTriangles = t.sections.maxTriangles;
  const warnings = [];
  if (!square) warnings.push('nonSquareQuads');
  if (triangles > 64e6) warnings.push('heavyMesh');
  if (!auto && sections.trianglesPerSection > DEFAULT_MAX_TRIANGLES * 2) warnings.push('bigSections');
  if (count > 1024) warnings.push('manySections');
  return {
    target: t.target,
    size,
    resolution: res.slice(),
    quad,
    square,
    quads,
    vertices: (res[0] + 1) * (res[1] + 1),
    triangles,
    sections,
    // one pixel per vertex: a heightmap or mask of this size lines up with the grid
    heightmap: { width: res[0] + 1, height: res[1] + 1 },
    heightRange: t.heightRange,
    zStep: t.heightRange / 65535,
    warnings,
  };
}

/** Preset rows: what each quad size would give for this map (automatic sections). */
export function quadOptions(doc, { quads = QUAD_PRESETS, maxTriangles = DEFAULT_MAX_TRIANGLES } = {}) {
  const size = terrainSize(doc);
  return quads.map((q) => {
    const resolution = resolutionForQuad(size, q);
    const c = computeTerrain(doc, { target: 'ue-mesh-terrain', resolution, sections: { mode: 'automatic', maxTriangles }, heightRange: DEFAULT_HEIGHT_RANGE });
    return { quadTarget: q, resolution, quad: c.quad, triangles: c.triangles, sections: c.sections };
  });
}

/** Terrain block to store in map.json (canonical shape, derived resolution in explicit mode). */
export function terrainBlock(t) {
  const out = { target: t.target || 'ue-mesh-terrain', resolution: t.resolution.slice() };
  if (t.sections.mode === 'explicit') {
    out.sections = { mode: 'explicit', layout: t.sections.layout.slice(), resolution: t.sections.resolution.slice() };
    out.resolution = [out.sections.layout[0] * out.sections.resolution[0], out.sections.layout[1] * out.sections.resolution[1]];
  } else {
    out.sections = { mode: 'automatic', maxTriangles: t.sections.maxTriangles || DEFAULT_MAX_TRIANGLES };
  }
  out.heightRange = t.heightRange;
  return out;
}

/** The values to type into Unreal's MeshPartition tools, as plain text. */
export function unrealSettingsText(c) {
  const f = (n) => (Math.round(n * 100) / 100).toFixed(1);
  const lines = [
    'Create MeshPartition Rectangle',
    `  Mesh / Size          ${f(c.size[0])}  ${f(c.size[1])}`,
    `  Mesh / Resolution    ${c.resolution[0]}  ${c.resolution[1]}`,
    `  Sections / Generation  ${c.sections.mode === 'explicit' ? 'Explicit' : 'Automatic'}`,
  ];
  if (c.sections.mode === 'explicit') {
    lines.push(`  Sections / Layout      ${c.sections.layout[0]}  ${c.sections.layout[1]}`);
    lines.push(`  Sections / Resolution  ${c.sections.resolution[0]}  ${c.sections.resolution[1]}`);
  } else {
    lines.push(`  Sections / Max Triangles  ${c.sections.maxTriangles}`);
  }
  lines.push(
    '',
    'Import Heightmap',
    `  Mesh / Resolution    ${c.resolution[0]}  ${c.resolution[1]}`,
    `  Mesh / Size          ${f(c.size[0])}  ${f(c.size[1])}  ${f(c.heightRange)}`,
    `  Heightmap image      ${c.heightmap.width} x ${c.heightmap.height} px (16-bit, one pixel per vertex)`,
    '',
    `Quad: ${f(c.quad[0])} x ${f(c.quad[1])} (world units)`,
  );
  return `${lines.join('\n')}\n`;
}
