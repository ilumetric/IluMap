// Format constants, layer list, defaults and the hand-written validator.
// Pure module: no DOM, importable from Node and the browser.

export const FORMAT = 'ilumap';
export const VERSION = 1;

/** Layer names in file order. */
export const LAYERS = ['land', 'water', 'coast', 'rivers', 'roads', 'rails', 'walls', 'zones', 'relief', 'bridges'];

/** Geometry kind of each layer. */
export const LAYER_KIND = {
  land: 'polygon',
  water: 'polygon',
  coast: 'line',
  rivers: 'line',
  roads: 'line',
  rails: 'line',
  walls: 'line',
  zones: 'polygon',
  relief: 'line',
  bridges: 'line',
};

/** Draw order, bottom to top (POIs and labels are drawn after these). */
export const DRAW_ORDER = ['land', 'zones', 'water', 'relief', 'coast', 'rivers', 'roads', 'rails', 'bridges', 'walls'];

export const LINE_LAYERS = LAYERS.filter((l) => LAYER_KIND[l] === 'line');
export const POLYGON_LAYERS = LAYERS.filter((l) => LAYER_KIND[l] === 'polygon');

export const POI_STATUSES = ['idea', 'approved', 'slice', 'cut'];
export const LINK_TYPES = ['road', 'rail', 'river', 'path', 'quest', 'sight'];
export const LAND_MODES = ['islands', 'filled'];
export const TOWER_MODES = ['none', 'vertices', 'auto'];
export const STYLE_PRESETS = ['graphite', 'blueprint', 'parchment'];

/** Built-in POI symbols (paths in core/render-svg.js ICONS), grouped for the icon picker. */
export const POI_ICON_GROUPS = {
  settlements: ['dot', 'house', 'castle', 'tower', 'gate', 'ruin', 'church', 'shrine', 'farm', 'windmill', 'lighthouse', 'well', 'tent', 'campfire', 'bed'],
  services: ['tavern', 'shop', 'coin', 'hospital', 'book', 'shield', 'info', 'fuel', 'parking'],
  transport: ['car', 'truck', 'bus', 'train', 'cart', 'ship', 'boat', 'anchor', 'plane', 'helipad', 'bridge', 'signpost'],
  industry: ['pick', 'factory', 'warehouse', 'gear', 'power', 'antenna'],
  nature: ['peak', 'cave', 'tree', 'water', 'fish', 'paw', 'fire'],
  markers: ['star', 'flag', 'quest', 'question', 'skull', 'swords', 'chest', 'key', 'eye'],
};

/** Every built-in POI symbol name. */
export const POI_ICONS = Object.values(POI_ICON_GROUPS).flat();

export const ID_RE = /^[a-z0-9_]+$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Prefix used for ids of newly drawn features, per layer. */
export const LAYER_ID_PREFIX = {
  land: 'island',
  water: 'lake',
  coast: 'coast',
  rivers: 'river',
  roads: 'road',
  rails: 'rail',
  walls: 'wall',
  zones: 'zone',
  relief: 'relief',
  bridges: 'bridge',
};

/**
 * Canonical key order per object kind. Keys not listed are "unknown" and are
 * emitted after the known ones, in their original order.
 */
export const KEY_ORDER = {
  root: ['format', 'version', 'meta', 'view', 'terrain', 'style', 'layers', 'pois', 'links'],
  terrain: ['target', 'resolution', 'sections', 'heightRange'],
  terrainSections: ['mode', 'maxTriangles', 'layout', 'resolution'],
  meta: ['name', 'description', 'units', 'displayUnit', 'displayUnitScale', 'flipY', 'landMode'],
  view: ['bounds', 'background', 'grid'],
  bounds: ['min', 'max'],
  background: ['src', 'opacity', 'calibration'],
  calibrationPair: ['px', 'world'],
  grid: ['step', 'visible'],
  style: ['preset', 'ocean', 'label', 'grid', 'layers', 'lineTypes', 'wallTypes', 'zoneTypes', 'reliefTypes', 'bridgeTypes', 'poiTypes'],
  styleEntry: ['fill', 'stroke', 'color', 'width', 'dash', 'opacity', 'pattern', 'icon', 'abbr', 'piers', 'ends'],
  layers: LAYERS,
  feature: ['id', 'name', 'kind', 'type', 'points', 'closed', 'smooth', 'width', 'color', 'tags', 'notes', 'hidden', 'wall'],
  wall: ['towers', 'towerSpacing', 'towerSize', 'gates'],
  gate: ['id', 'name', 'at', 't'],
  poi: ['id', 'name', 'x', 'y', 'type', 'zone', 'tags', 'status', 'notes', 'anchor', 'color', 'icon', 'placed'],
  link: ['id', 'from', 'to', 'type', 'name', 'feature', 'notes'],
};

export const DEFAULT_META = {
  name: 'Untitled',
  description: '',
  units: 'cm',
  displayUnit: 'm',
  displayUnitScale: 100,
  flipY: false,
  landMode: 'islands',
};

export const DEFAULT_BOUNDS = { min: [0, 0], max: [400000, 400000] };
export const DEFAULT_GRID = { step: 10000, visible: true };

export const DEFAULT_WALL = {
  towers: 'vertices',
  towerSpacing: 5000,
  towerSize: 600,
  gates: [],
};

// ---------------------------------------------------------------------------
// Validation

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPair = (v) => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

/**
 * Validate a map document (normalised or raw parsed JSON).
 * @returns {{ok: boolean, errors: {path: string, message: string}[], warnings: {path: string, message: string}[]}}
 */
export function validate(doc) {
  const errors = [];
  const warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });

  if (!isObj(doc)) {
    err('', 'document must be an object');
    return { ok: false, errors, warnings };
  }
  if (doc.format !== FORMAT) err('format', `must be "${FORMAT}"`);
  if (doc.version !== VERSION) err('version', `must be ${VERSION}`);

  // meta
  const meta = doc.meta;
  if (meta !== undefined) {
    if (!isObj(meta)) err('meta', 'must be an object');
    else {
      for (const k of ['name', 'description', 'units', 'displayUnit']) {
        if (meta[k] !== undefined && typeof meta[k] !== 'string') err(`meta.${k}`, 'must be a string');
      }
      if (meta.displayUnitScale !== undefined && !(isNum(meta.displayUnitScale) && meta.displayUnitScale > 0)) {
        err('meta.displayUnitScale', 'must be a positive number');
      }
      if (meta.flipY !== undefined && typeof meta.flipY !== 'boolean') err('meta.flipY', 'must be a boolean');
      if (meta.landMode !== undefined && !LAND_MODES.includes(meta.landMode)) {
        err('meta.landMode', `must be one of ${LAND_MODES.join(', ')}`);
      }
    }
  }

  // view
  const view = doc.view;
  let bounds = null;
  if (view !== undefined) {
    if (!isObj(view)) err('view', 'must be an object');
    else {
      if (view.bounds !== undefined) {
        const b = view.bounds;
        if (!isObj(b) || !isPair(b.min) || !isPair(b.max)) err('view.bounds', 'must be { min: [x, y], max: [x, y] }');
        else if (!(b.min[0] < b.max[0] && b.min[1] < b.max[1])) err('view.bounds', 'min must be smaller than max on both axes');
        else bounds = b;
      }
      if (view.grid !== undefined) {
        const g = view.grid;
        if (!isObj(g)) err('view.grid', 'must be an object');
        else {
          if (g.step !== undefined && !(isNum(g.step) && g.step > 0)) err('view.grid.step', 'must be a positive number');
          if (g.visible !== undefined && typeof g.visible !== 'boolean') err('view.grid.visible', 'must be a boolean');
        }
      }
      if (view.background !== undefined) {
        const bg = view.background;
        if (!isObj(bg)) err('view.background', 'must be an object');
        else {
          if (bg.src !== undefined && typeof bg.src !== 'string') err('view.background.src', 'must be a string');
          if (bg.opacity !== undefined && !(isNum(bg.opacity) && bg.opacity >= 0 && bg.opacity <= 1)) {
            err('view.background.opacity', 'must be a number in 0..1');
          }
          if (bg.calibration !== undefined) {
            const c = bg.calibration;
            if (!Array.isArray(c) || c.length !== 2) err('view.background.calibration', 'must contain exactly 2 pairs');
            else {
              c.forEach((p, i) => {
                if (!isObj(p) || !isPair(p.px) || !isPair(p.world)) {
                  err(`view.background.calibration[${i}]`, 'must be { px: [u, v], world: [x, y] }');
                }
              });
              if (isObj(c[0]) && isObj(c[1]) && isPair(c[0].px) && isPair(c[1].px) &&
                  c[0].px[0] === c[1].px[0] && c[0].px[1] === c[1].px[1]) {
                err('view.background.calibration', 'the two pixel points must differ');
              }
              if (isObj(c[0]) && isObj(c[1]) && isPair(c[0].world) && isPair(c[1].world) &&
                  c[0].world[0] === c[1].world[0] && c[0].world[1] === c[1].world[1]) {
                err('view.background.calibration', 'the two world points must differ');
              }
            }
          }
        }
      }
    }
  }

  // style (lenient: only shapes)
  const style = doc.style;
  if (style !== undefined) {
    if (!isObj(style)) err('style', 'must be an object');
    else {
      if (style.preset !== undefined && typeof style.preset !== 'string') err('style.preset', 'must be a string');
      else if (style.preset !== undefined && !STYLE_PRESETS.includes(style.preset)) {
        warn('style.preset', `unknown preset "${style.preset}", falling back to blueprint`);
      }
      for (const k of ['ocean', 'label', 'grid']) {
        if (style[k] !== undefined && !(typeof style[k] === 'string' && COLOR_RE.test(style[k]))) {
          err(`style.${k}`, 'must be a #rrggbb colour');
        }
      }
      for (const group of ['layers', 'lineTypes', 'wallTypes', 'zoneTypes', 'poiTypes']) {
        const g = style[group];
        if (g === undefined) continue;
        if (!isObj(g)) { err(`style.${group}`, 'must be an object'); continue; }
        for (const [name, entry] of Object.entries(g)) {
          const p = `style.${group}.${name}`;
          if (!isObj(entry)) { err(p, 'must be an object'); continue; }
          for (const ck of ['fill', 'stroke', 'color']) {
            if (entry[ck] !== undefined && entry[ck] !== null && !(typeof entry[ck] === 'string' && COLOR_RE.test(entry[ck]))) {
              err(`${p}.${ck}`, 'must be a #rrggbb colour');
            }
          }
          if (entry.width !== undefined && !(isNum(entry.width) && entry.width >= 0)) err(`${p}.width`, 'must be a number >= 0');
          if (entry.opacity !== undefined && !(isNum(entry.opacity) && entry.opacity >= 0 && entry.opacity <= 1)) {
            err(`${p}.opacity`, 'must be a number in 0..1');
          }
          if (entry.dash !== undefined && entry.dash !== null && typeof entry.dash !== 'string') err(`${p}.dash`, 'must be a string or null');
        }
      }
    }
  }

  // ids
  const seen = new Map(); // id -> path
  const claim = (id, path) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      err(path, `id ${JSON.stringify(id)} must match [a-z0-9_]+`);
      return;
    }
    if (seen.has(id)) err(path, `duplicate id "${id}" (also at ${seen.get(id)})`);
    else seen.set(id, path);
  };

  const zoneIds = new Set();
  const featureIds = new Set();
  const pointIds = new Set(); // POIs and gates: valid link endpoints

  // terrain grid (UE Mesh Terrain calculator)
  if (doc.terrain !== undefined) {
    const tr = doc.terrain;
    const intPair = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n > 0);
    if (!isObj(tr)) err('terrain', 'must be an object');
    else {
      if (tr.target !== undefined && tr.target !== 'ue-mesh-terrain') err('terrain.target', 'must be "ue-mesh-terrain"');
      if (tr.resolution !== undefined && !intPair(tr.resolution)) err('terrain.resolution', 'must be [x, y] positive integers (quads per axis)');
      if (tr.heightRange !== undefined && !(isNum(tr.heightRange) && tr.heightRange > 0)) err('terrain.heightRange', 'must be a positive number (world units)');
      const s = tr.sections;
      if (s !== undefined) {
        if (!isObj(s)) err('terrain.sections', 'must be an object');
        else if (s.mode !== 'automatic' && s.mode !== 'explicit') err('terrain.sections.mode', 'must be "automatic" or "explicit"');
        else if (s.mode === 'automatic') {
          if (s.maxTriangles !== undefined && !(Number.isInteger(s.maxTriangles) && s.maxTriangles > 0)) err('terrain.sections.maxTriangles', 'must be a positive integer');
        } else {
          if (!intPair(s.layout)) err('terrain.sections.layout', 'must be [x, y] positive integers (sections per axis)');
          if (!intPair(s.resolution)) err('terrain.sections.resolution', 'must be [x, y] positive integers (quads per section)');
          if (intPair(s.layout) && intPair(s.resolution) && intPair(tr.resolution)
            && (tr.resolution[0] !== s.layout[0] * s.resolution[0] || tr.resolution[1] !== s.layout[1] * s.resolution[1])) {
            warn('terrain.resolution', 'explicit sections give layout × section resolution; terrain.resolution differs and is ignored');
          }
        }
      }
    }
  }

  // layers
  const layers = doc.layers;
  if (layers !== undefined) {
    if (!isObj(layers)) err('layers', 'must be an object');
    else {
      for (const key of Object.keys(layers)) {
        if (!LAYERS.includes(key) && !key.startsWith('x_')) err(`layers.${key}`, `unknown layer (known: ${LAYERS.join(', ')})`);
      }
      for (const layer of LAYERS) {
        const arr = layers[layer];
        if (arr === undefined) continue;
        if (!Array.isArray(arr)) { err(`layers.${layer}`, 'must be an array'); continue; }
        arr.forEach((f, i) => {
          const p = `layers.${layer}[${i}]`;
          if (!isObj(f)) { err(p, 'feature must be an object'); return; }
          claim(f.id, `${p}.id`);
          if (typeof f.id === 'string') {
            featureIds.add(f.id);
            if (layer === 'zones') zoneIds.add(f.id);
          }
          const kind = f.kind ?? LAYER_KIND[layer];
          if (kind !== LAYER_KIND[layer]) err(`${p}.kind`, `layer "${layer}" holds ${LAYER_KIND[layer]} features, got "${f.kind}"`);
          if (f.name !== undefined && typeof f.name !== 'string') err(`${p}.name`, 'must be a string');
          if (f.type !== undefined && typeof f.type !== 'string') err(`${p}.type`, 'must be a string');
          if (!Array.isArray(f.points)) err(`${p}.points`, 'must be an array of [x, y]');
          else {
            const min = LAYER_KIND[layer] === 'polygon' ? 3 : 2;
            if (f.points.length < min) err(`${p}.points`, `needs at least ${min} points`);
            f.points.forEach((pt, j) => { if (!isPair(pt)) err(`${p}.points[${j}]`, 'must be [x, y] numbers'); });
          }
          if (f.closed !== undefined && typeof f.closed !== 'boolean') err(`${p}.closed`, 'must be a boolean');
          if (f.closed === true && LAYER_KIND[layer] === 'polygon') warn(`${p}.closed`, 'polygons are always closed; "closed" is ignored');
          if (f.smooth !== undefined && typeof f.smooth !== 'boolean') err(`${p}.smooth`, 'must be a boolean');
          if (f.hidden !== undefined && typeof f.hidden !== 'boolean') err(`${p}.hidden`, 'must be a boolean');
          if (f.width !== undefined && !(isNum(f.width) && f.width > 0)) err(`${p}.width`, 'must be a positive number (world units)');
          if (f.color !== undefined && f.color !== null && !(typeof f.color === 'string' && COLOR_RE.test(f.color))) err(`${p}.color`, 'must be a #rrggbb colour');
          if (f.tags !== undefined && !(Array.isArray(f.tags) && f.tags.every((t) => typeof t === 'string'))) err(`${p}.tags`, 'must be an array of strings');
          if (f.notes !== undefined && typeof f.notes !== 'string') err(`${p}.notes`, 'must be a string');
          if (f.wall !== undefined) {
            if (layer !== 'walls') err(`${p}.wall`, 'only features in the walls layer may have a wall object');
            else if (!isObj(f.wall)) err(`${p}.wall`, 'must be an object');
            else {
              const w = f.wall;
              if (w.towers !== undefined && !TOWER_MODES.includes(w.towers)) err(`${p}.wall.towers`, `must be one of ${TOWER_MODES.join(', ')}`);
              if (w.towerSpacing !== undefined && !(isNum(w.towerSpacing) && w.towerSpacing > 0)) err(`${p}.wall.towerSpacing`, 'must be a positive number');
              if (w.towerSize !== undefined && !(isNum(w.towerSize) && w.towerSize > 0)) err(`${p}.wall.towerSize`, 'must be a positive number');
              if (w.gates !== undefined) {
                if (!Array.isArray(w.gates)) err(`${p}.wall.gates`, 'must be an array');
                else w.gates.forEach((g, k) => {
                  const gp = `${p}.wall.gates[${k}]`;
                  if (!isObj(g)) { err(gp, 'must be an object'); return; }
                  claim(g.id, `${gp}.id`);
                  if (typeof g.id === 'string') pointIds.add(g.id);
                  if (g.name !== undefined && typeof g.name !== 'string') err(`${gp}.name`, 'must be a string');
                  const hasAt = g.at !== undefined;
                  const hasT = g.t !== undefined;
                  if (hasAt === hasT) err(gp, 'needs exactly one of "at" (vertex index) or "t" (fraction)');
                  if (hasAt) {
                    const n = Array.isArray(f.points) ? f.points.length : 0;
                    if (!(Number.isInteger(g.at) && g.at >= 0 && g.at < n)) err(`${gp}.at`, `must be a vertex index 0..${n - 1}`);
                  }
                  if (hasT && !(isNum(g.t) && g.t >= 0 && g.t <= 1)) err(`${gp}.t`, 'must be a number in 0..1');
                });
              }
            }
          }
        });
      }
    }
  }

  // pois
  const pois = doc.pois;
  if (pois !== undefined) {
    if (!Array.isArray(pois)) err('pois', 'must be an array');
    else pois.forEach((poi, i) => {
      const p = `pois[${i}]`;
      if (!isObj(poi)) { err(p, 'POI must be an object'); return; }
      claim(poi.id, `${p}.id`);
      if (typeof poi.id === 'string') pointIds.add(poi.id);
      if (typeof poi.name !== 'string' || poi.name === '') err(`${p}.name`, 'must be a non-empty string');
      if (!isNum(poi.x)) err(`${p}.x`, 'must be a number');
      if (!isNum(poi.y)) err(`${p}.y`, 'must be a number');
      if (typeof poi.type !== 'string' || poi.type === '') err(`${p}.type`, 'must be a non-empty string');
      if (poi.status !== undefined && !POI_STATUSES.includes(poi.status)) err(`${p}.status`, `must be one of ${POI_STATUSES.join(', ')}`);
      if (poi.zone !== undefined && poi.zone !== null) {
        if (typeof poi.zone !== 'string') err(`${p}.zone`, 'must be a zone feature id');
        else if (layers && isObj(layers) && !zoneIds.has(poi.zone)) err(`${p}.zone`, `unknown zone "${poi.zone}" (must be an id in layers.zones)`);
      }
      if (poi.tags !== undefined && !(Array.isArray(poi.tags) && poi.tags.every((t) => typeof t === 'string'))) err(`${p}.tags`, 'must be an array of strings');
      for (const k of ['notes', 'anchor']) if (poi[k] !== undefined && typeof poi[k] !== 'string') err(`${p}.${k}`, 'must be a string');
      if (poi.color !== undefined && poi.color !== null && !(typeof poi.color === 'string' && COLOR_RE.test(poi.color))) err(`${p}.color`, 'must be a #rrggbb colour or null');
      if (poi.icon !== undefined && poi.icon !== null && typeof poi.icon !== 'string') err(`${p}.icon`, 'must be an icon name');
      else if (typeof poi.icon === 'string' && !POI_ICONS.includes(poi.icon)) warn(`${p}.icon`, `unknown icon "${poi.icon}" (drawn as the type icon)`);
      if (poi.placed !== undefined && typeof poi.placed !== 'boolean') err(`${p}.placed`, 'must be a boolean');
      if (bounds && isNum(poi.x) && isNum(poi.y) && poi.placed !== false &&
          (poi.x < bounds.min[0] || poi.x > bounds.max[0] || poi.y < bounds.min[1] || poi.y > bounds.max[1])) {
        warn(p, `POI "${poi.id}" lies outside view.bounds`);
      }
    });
  }

  // links
  const links = doc.links;
  if (links !== undefined) {
    if (!Array.isArray(links)) err('links', 'must be an array');
    else links.forEach((l, i) => {
      const p = `links[${i}]`;
      if (!isObj(l)) { err(p, 'link must be an object'); return; }
      if (l.id !== undefined) claim(l.id, `${p}.id`);
      for (const end of ['from', 'to']) {
        if (typeof l[end] !== 'string') err(`${p}.${end}`, 'must be a POI or gate id');
        else if (!pointIds.has(l[end])) err(`${p}.${end}`, `unknown POI or gate "${l[end]}"`);
      }
      if (typeof l.from === 'string' && l.from === l.to) err(p, 'a link cannot connect an item to itself');
      if (typeof l.type !== 'string' || l.type === '') err(`${p}.type`, 'must be a non-empty string');
      if (l.name !== undefined && typeof l.name !== 'string') err(`${p}.name`, 'must be a string');
      if (l.notes !== undefined && typeof l.notes !== 'string') err(`${p}.notes`, 'must be a string');
      if (l.feature !== undefined && l.feature !== null) {
        if (typeof l.feature !== 'string' || !featureIds.has(l.feature)) err(`${p}.feature`, `unknown feature "${l.feature}"`);
      }
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}
