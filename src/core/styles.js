// Style presets (graphite, blueprint, parchment) and style resolution.
// A document's `style` only stores the preset name plus overrides; the
// effective style is resolveStyle(doc.style).

export const POI_ICONS = ['house', 'castle', 'pick', 'ruin', 'tent', 'gate', 'dot'];

export const STATUS_COLORS = {
  idea: '#9aa5b1',
  approved: '#06d6a0',
  slice: '#4cc9f0',
  cut: '#ef476f',
};

const LINE_TYPES = {
  river_main: { width: 4 },
  river_minor: { width: 2 },
  road_paved: { width: 2.5, dash: null },
  road_dirt: { dash: '6 3' },
  path: { width: 1.5, dash: '2 3' },
  rail: { dash: '8 4' },
};

const ZONE_TYPES = {
  mountains: { fill: '#8a6d4b', pattern: 'hatch' },
  hills: { fill: '#a08a5a' },
  plains: { fill: '#7fa650' },
  forest: { fill: '#3f6b3a' },
  swamp: { fill: '#4f6b3a', pattern: 'dots' },
  desert: { fill: '#d2b06a' },
};

const POI_TYPES = {
  village: { color: '#ffd166', icon: 'house' },
  city: { color: '#ef476f', icon: 'castle' },
  mine: { color: '#b08968', icon: 'pick' },
  ruin: { color: '#9d8189', icon: 'ruin' },
  camp: { color: '#06d6a0', icon: 'tent' },
  gate: { color: '#e0e0e0', icon: 'gate' },
  poi: { color: '#8ecae6', icon: 'dot' },
};

export const PRESETS = {
  graphite: {
    // neutral dark palette that matches the editor chrome: near-black ocean,
    // desaturated land and zones, teal / yellow accents for roads and POIs
    ocean: '#16181b',
    label: '#e8e8e8',
    grid: '#2c3035',
    halo: '#0e0f11',
    boundsColor: '#4b5057',
    poiBg: '#111315',
    layers: {
      land: { fill: '#2a2d2b', stroke: '#8d948f', width: 1.5 },
      water: { fill: '#1a232d', stroke: '#4f8fd6', width: 1.5 },
      coast: { stroke: '#9aa09c', width: 1.5 },
      rivers: { stroke: '#4f8fd6', width: 3 },
      roads: { stroke: '#f5c542', width: 2 },
      rails: { stroke: '#a3a7ab', width: 2, dash: '8 4' },
      walls: { stroke: '#d9dcdf', width: 4 },
      zones: { opacity: 0.3 },
    },
    lineTypes: LINE_TYPES,
    wallTypes: {
      wall_stone: { stroke: '#d9dcdf', pattern: 'crenel' },
      wall_palisade: { stroke: '#a88b6a', pattern: 'ticks' },
    },
    zoneTypes: {
      mountains: { fill: '#7a736b', pattern: 'hatch' },
      hills: { fill: '#847d67' },
      plains: { fill: '#607356' },
      forest: { fill: '#3e5b47' },
      swamp: { fill: '#4b5b49', pattern: 'dots' },
      desert: { fill: '#9d8b63' },
    },
    poiTypes: {
      village: { color: '#f5c542', icon: 'house' },
      city: { color: '#10a37f', icon: 'castle' },
      mine: { color: '#c49a6c', icon: 'pick' },
      ruin: { color: '#9b9ba7', icon: 'ruin' },
      camp: { color: '#34d399', icon: 'tent' },
      gate: { color: '#e5e5e5', icon: 'gate' },
      poi: { color: '#5eead4', icon: 'dot' },
    },
  },
  blueprint: {
    ocean: '#0f1f33',
    label: '#e6eef7',
    grid: '#27456b',
    halo: '#0b1626',
    boundsColor: '#5c8ac2',
    poiBg: '#0b1626',
    layers: {
      land: { fill: '#2b3a2f', stroke: '#cfd8e3', width: 2 },
      water: { fill: '#1e3a5f', stroke: '#4a7fb5', width: 1.5 },
      coast: { stroke: '#cfd8e3', width: 2 },
      rivers: { stroke: '#4a7fb5', width: 3 },
      roads: { stroke: '#d9b46a', width: 2 },
      rails: { stroke: '#b0b0b0', width: 2, dash: '8 4' },
      walls: { stroke: '#e0e0e0', width: 4 },
      zones: { opacity: 0.35 },
    },
    lineTypes: LINE_TYPES,
    wallTypes: {
      wall_stone: { stroke: '#e0e0e0', pattern: 'crenel' },
      wall_palisade: { stroke: '#b08968', pattern: 'ticks' },
    },
    zoneTypes: ZONE_TYPES,
    poiTypes: POI_TYPES,
  },
  parchment: {
    ocean: '#b9cfc9',
    label: '#2e2416',
    grid: '#c9b995',
    halo: '#f4ead0',
    boundsColor: '#8c7a5a',
    poiBg: '#f4ead0',
    layers: {
      land: { fill: '#f1e4c3', stroke: '#6b5537', width: 2 },
      water: { fill: '#a9c7cf', stroke: '#5f8791', width: 1.5 },
      coast: { stroke: '#6b5537', width: 2 },
      rivers: { stroke: '#5f8791', width: 3 },
      roads: { stroke: '#8c5a2e', width: 2 },
      rails: { stroke: '#40362b', width: 2, dash: '8 4' },
      walls: { stroke: '#4a3b2a', width: 4 },
      zones: { opacity: 0.3 },
    },
    lineTypes: LINE_TYPES,
    wallTypes: {
      wall_stone: { stroke: '#4a3b2a', pattern: 'crenel' },
      wall_palisade: { stroke: '#7a5230', pattern: 'ticks' },
    },
    zoneTypes: {
      mountains: { fill: '#9c7b55', pattern: 'hatch' },
      hills: { fill: '#b59e6a' },
      plains: { fill: '#a9c07a' },
      forest: { fill: '#5d8a4f' },
      swamp: { fill: '#6f8a58', pattern: 'dots' },
      desert: { fill: '#e0c48a' },
    },
    poiTypes: {
      village: { color: '#b5651d', icon: 'house' },
      city: { color: '#9e2a2b', icon: 'castle' },
      mine: { color: '#6b4f33', icon: 'pick' },
      ruin: { color: '#7d6b72', icon: 'ruin' },
      camp: { color: '#2d6a4f', icon: 'tent' },
      gate: { color: '#4a3b2a', icon: 'gate' },
      poi: { color: '#33658a', icon: 'dot' },
    },
  },
};

const TYPE_GROUPS = ['lineTypes', 'wallTypes', 'zoneTypes', 'poiTypes'];

function mergeEntry(base = {}, over = {}) {
  return { ...base, ...over };
}

function mergeGroup(base = {}, over = {}) {
  const out = {};
  for (const k of Object.keys(base)) out[k] = { ...base[k] };
  for (const [k, v] of Object.entries(over || {})) out[k] = mergeEntry(out[k], v);
  return out;
}

/** Effective style: preset defaults deep-merged with the document overrides. */
export function resolveStyle(style = {}) {
  const preset = PRESETS[style.preset] ? style.preset : 'blueprint';
  const base = PRESETS[preset];
  const out = {
    preset,
    ocean: style.ocean || base.ocean,
    label: style.label || base.label,
    grid: style.grid || base.grid,
    halo: style.halo || base.halo,
    boundsColor: style.boundsColor || base.boundsColor,
    poiBg: style.poiBg || base.poiBg,
    layers: mergeGroup(base.layers, style.layers),
  };
  for (const g of TYPE_GROUPS) out[g] = mergeGroup(base[g], style[g]);
  return out;
}

/** Which type table a layer uses. */
export function typeGroupForLayer(layer) {
  if (layer === 'zones') return 'zoneTypes';
  if (layer === 'walls') return 'wallTypes';
  return 'lineTypes';
}

/**
 * Effective drawing style for a feature.
 * width/dash are screen pixels at zoom 1; worldWidth is the feature's own width in world units (or null).
 */
export function featureStyle(rs, layer, f) {
  const L = rs.layers[layer] || {};
  const T = (f.type && rs[typeGroupForLayer(layer)][f.type]) || {};
  const pick = (k) => (T[k] !== undefined ? T[k] : L[k]);
  let fill = pick('fill');
  let stroke = pick('stroke');
  if (layer === 'zones') {
    fill = T.fill || T.color || L.fill || '#888888';
    stroke = T.stroke || fill;
  }
  if (f.color) {
    if (layer === 'land' || layer === 'water' || layer === 'zones') fill = f.color;
    else stroke = f.color;
  }
  return {
    fill: fill || 'none',
    stroke: stroke || T.color || '#cccccc',
    width: pick('width') ?? 2,
    dash: pick('dash') ?? null,
    opacity: L.opacity ?? 1,
    pattern: T.pattern || null,
    worldWidth: f.width > 0 ? f.width : null,
  };
}

export function poiStyle(rs, poi) {
  const T = rs.poiTypes[poi.type] || rs.poiTypes.poi || {};
  return { color: poi.color || T.color || '#8ecae6', icon: POI_ICONS.includes(T.icon) ? T.icon : 'dot' };
}

/** Lists of type names available for a layer / POIs (for UI dropdowns). */
export function typeNames(rs, group) {
  return Object.keys(rs[group] || {});
}
