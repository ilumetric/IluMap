// Shared layer metadata for the chrome (dock, toolbar underlines, layers panel):
// labels and 2-letter abbreviations (localised, see i18n/), the colour that represents a layer, and the
// type used for newly drawn features / POIs.

import { store, savePrefs, emit } from '../state.js';
import { resolveStyle } from '../../core/styles.js';
import { t, label } from '../i18n/index.js';

/** Display name of a layer key ("roads" -> "Дороги" / "Roads"). Layer keys themselves are data. */
export const layerLabel = (layer) => label('layers', layer);

/** 2-letter chip abbreviation of a layer, per language. */
export const layerAbbr = (layer) => t(`layers.abbr.${layer}`);

/** Style type group holding the types of a layer's features. */
export function typeGroupOf(layer) {
  if (layer === 'pois') return 'poiTypes';
  if (layer === 'zones') return 'zoneTypes';
  if (layer === 'walls') return 'wallTypes';
  return 'lineTypes';
}

/** Display name of a feature / POI type ("mine" -> "Шахта"); custom types show their raw value. */
export const typeLabel = (layer, type) => label(typeGroupOf(layer), type);

/** Layers shown as chips in the dock, bottom to top of the usual workflow. */
export const DOCK_LAYERS = ['land', 'water', 'coast', 'rivers', 'roads', 'rails', 'walls', 'zones', 'pois'];

const DEFAULT_TYPES = { rivers: 'river_minor', roads: 'road_dirt', rails: 'rail', walls: 'wall_stone', zones: 'plains', pois: 'poi' };

/** Type names offered for new features in a layer (preset types + types used in the map). */
export function typeOptions(layer, rs = resolveStyle(store.doc.style)) {
  let names = [];
  if (layer === 'pois') names = [...Object.keys(rs.poiTypes), ...store.doc.pois.map((p) => p.type)];
  else if (layer === 'zones') names = Object.keys(rs.zoneTypes);
  else if (layer === 'walls') names = Object.keys(rs.wallTypes);
  else if (layer === 'rivers') names = Object.keys(rs.lineTypes).filter((t) => t.startsWith('river'));
  else if (layer === 'rails') names = Object.keys(rs.lineTypes).filter((t) => t.startsWith('rail'));
  else if (layer === 'roads') names = Object.keys(rs.lineTypes).filter((t) => !t.startsWith('river') && !t.startsWith('rail'));
  else return [];
  if (layer !== 'pois') for (const f of store.doc.layers[layer] || []) if (f.type) names.push(f.type);
  return [...new Set(names.filter(Boolean))];
}

/** Type given to the next feature drawn into `layer` (or the next POI for 'pois'). */
export function newTypeFor(layer) {
  if (layer === 'pois') return store.prefs.poiType || 'poi';
  if (layer === 'zones') return store.prefs.lastZoneType || store.prefs.newTypes?.zones || DEFAULT_TYPES.zones;
  return store.prefs.newTypes?.[layer] || DEFAULT_TYPES[layer];
}

export function setNewType(layer, type) {
  const t = String(type || '').trim();
  if (layer === 'pois') store.prefs.poiType = t || 'poi';
  else if (layer === 'zones') store.prefs.lastZoneType = t || DEFAULT_TYPES.zones;
  else {
    store.prefs.newTypes ||= {};
    if (t) store.prefs.newTypes[layer] = t; else delete store.prefs.newTypes[layer];
  }
  savePrefs();
  emit('new-type', layer);
}

/** The colour that represents a layer in the chrome (dock ring, tool underline). */
export function layerColor(layer, rs = resolveStyle(store.doc.style)) {
  const L = rs.layers[layer] || {};
  switch (layer) {
    case 'land': return L.fill || '#888888';
    case 'zones': return rs.zoneTypes[newTypeFor('zones')]?.fill || '#888888';
    case 'pois': return rs.poiTypes[newTypeFor('pois')]?.color || rs.poiTypes.poi?.color || '#888888';
    case 'walls': return rs.wallTypes[newTypeFor('walls')]?.stroke || L.stroke || '#dddddd';
    default: {
      const T = rs.lineTypes[newTypeFor(layer)];
      return (T && T.stroke) || L.stroke || L.fill || '#888888';
    }
  }
}

/** Which style entry the dock colour swatch edits for a layer. */
export function colorTarget(layer) {
  if (layer === 'zones') return { group: 'zoneTypes', name: newTypeFor('zones'), key: 'fill' };
  if (layer === 'pois') return { group: 'poiTypes', name: newTypeFor('pois'), key: 'color' };
  if (layer === 'land') return { group: 'layers', name: 'land', key: 'fill' };
  return { group: 'layers', name: layer, key: 'stroke' };
}

// --- chrome contrast ---------------------------------------------------------------

function rgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [136, 136, 136];
  const s = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
const lum = ([r, g, b]) => {
  const f = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const mix = (a, b, t) => `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;

/**
 * A map colour adjusted to stay visible on the UI chrome (very dark colours are
 * lifted on the dark theme, very light ones darkened on the light theme), plus
 * a readable text colour for a chip filled with it.
 */
export function chromeTint(hex) {
  const c = rgb(hex);
  const light = document.documentElement.dataset.uiTheme === 'light';
  let ring = mix(c, c, 0); // normalised #rrggbb
  if (!light && lum(c) < 0.05) ring = mix(c, [255, 255, 255], 0.4);
  if (light && lum(c) > 0.6) ring = mix(c, [0, 0, 0], 0.3);
  return { ring, text: lum(rgb(ring)) > 0.3 ? '#111111' : '#ffffff' };
}
