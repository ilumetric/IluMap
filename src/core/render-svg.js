// map.json -> SVG. Used for exports (browser + CLI) and by the editor canvas
// for the layer content, so the screen and the exports match.
//
// SVG user space = world units, with y negated when meta.flipY is true
// (so +y is up on screen). Stroke widths, icon and font sizes are given in
// screen pixels and converted with `unitsPerPx`.

import { DRAW_ORDER } from './schema.js';
import { resolveStyle, featureStyle, poiStyle, STATUS_COLORS } from './styles.js';
import {
  catmullRomToPath, linearPath, centroid, featureGeometry, wallLayout, cutGaps, atDistance, polylineLength,
} from './geometry.js';

/** Icon paths in a 24x24 box centred on 0,0. */
export const ICONS = {
  dot: '<circle r="5" fill="currentColor"/>',
  house: '<path fill="currentColor" d="M-7.5 0.5 L0 -7 L7.5 0.5 L5.5 0.5 L5.5 7 L1.8 7 L1.8 2.5 L-1.8 2.5 L-1.8 7 L-5.5 7 L-5.5 0.5 Z"/>',
  castle: '<path fill="currentColor" fill-rule="evenodd" d="M-8 8 V-5 H-5.2 V-2.5 H-2.6 V-5 H0 H2.6 V-2.5 H5.2 V-5 H8 V8 Z M-2.2 8 V3 A2.2 2.2 0 0 1 2.2 3 V8 Z"/><path fill="currentColor" d="M-1.2 -5 V-9 L3.2 -7.8 L-0.2 -6.8 V-5 Z"/>',
  pick: '<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M-8 -2.5 C-4 -8.5 4 -8.5 8 -2.5"/><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M0 -6.5 L0 8"/>',
  ruin: '<path fill="currentColor" d="M-8.5 8 H8.5 V5.8 H-8.5 Z M-6.8 5.8 V-4.5 H-3.4 V5.8 Z M-1.7 5.8 V-7.5 H1.7 V-2 L0.4 -0.6 L1.7 0.8 V5.8 Z M3.4 5.8 V0.5 L5.1 -1.2 L6.8 0.5 V5.8 Z"/>',
  tent: '<path fill="currentColor" fill-rule="evenodd" d="M-9 7.5 L0 -8 L9 7.5 Z M-2.4 7.5 L0 2.2 L2.4 7.5 Z"/>',
  gate: '<path fill="currentColor" d="M-8 8 V-3 A8 8 0 0 1 8 -3 V8 H4.2 V-2.2 A4.2 4.2 0 0 0 -4.2 -2.2 V8 Z"/>',
};

const r2 = (v) => {
  const x = Math.round(v * 100) / 100;
  return Object.is(x, -0) ? 0 : x;
};

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const safeId = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

/** world [x, y] -> SVG user space */
export function toView(doc, p) {
  return [p[0], doc.meta?.flipY ? -p[1] : p[1]];
}

/** SVG user space -> world */
export function fromView(doc, p) {
  return [p[0], doc.meta?.flipY ? -p[1] : p[1]];
}

/** Bounds in SVG user space: {x0, y0, x1, y1}. */
export function viewRectOfBounds(doc, bounds = doc.view.bounds) {
  const a = toView(doc, bounds.min);
  const b = toView(doc, bounds.max);
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}

function pathFor(pts, closed, smooth) {
  return smooth ? catmullRomToPath(pts, closed) : linearPath(pts, closed);
}

function dashAttr(dash, scale) {
  if (!dash) return '';
  const parts = String(dash).trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (!parts.length) return '';
  return ` stroke-dasharray="${parts.map((n) => r2(n * scale)).join(' ')}"`;
}

/** SVG <defs> content: icon symbols and zone patterns. */
export function renderDefs(doc, opts = {}) {
  const upp = opts.unitsPerPx || 1;
  const rs = opts.resolvedStyle || resolveStyle(doc.style);
  let s = '';
  for (const [name, body] of Object.entries(ICONS)) {
    s += `<symbol id="ilm-ico-${name}" viewBox="-12 -12 24 24" overflow="visible">${body}</symbol>`;
  }
  const used = new Set(doc.layers.zones.map((z) => z.type).filter(Boolean));
  for (const [type, t] of Object.entries(rs.zoneTypes)) {
    if (!t.pattern || !used.has(type)) continue;
    const col = t.stroke || t.fill || '#888888';
    const id = `ilm-pat-${safeId(type)}`;
    if (t.pattern === 'hatch') {
      const sz = r2(9 * upp);
      s += `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${sz}" height="${sz}" patternTransform="rotate(45)">`
        + `<line x1="0" y1="0" x2="0" y2="${sz}" stroke="${col}" stroke-width="${r2(1.6 * upp)}" stroke-opacity="0.9"/></pattern>`;
    } else if (t.pattern === 'dots') {
      const sz = r2(8 * upp);
      s += `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${sz}" height="${sz}">`
        + `<circle cx="${r2(sz / 2)}" cy="${r2(sz / 2)}" r="${r2(1.3 * upp)}" fill="${col}" fill-opacity="0.95"/></pattern>`;
    }
  }
  return s;
}

/** Grid lines covering the given view rectangle. */
export function renderGrid(doc, rect, opts = {}) {
  const upp = opts.unitsPerPx || 1;
  const rs = opts.resolvedStyle || resolveStyle(doc.style);
  let step = doc.view.grid?.step > 0 ? doc.view.grid.step : 10000;
  let guard = 0;
  while (step / upp < 14 && guard++ < 20) step *= 5;
  const major = step * 5;
  const x0 = Math.floor(rect.x0 / step) * step;
  const y0 = Math.floor(rect.y0 / step) * step;
  let minor = '';
  let maj = '';
  const isMajor = (v) => Math.abs(Math.round(v / major) * major - v) < step * 1e-6;
  for (let x = x0; x <= rect.x1; x += step) {
    const l = `M${r2(x)} ${r2(rect.y0)}V${r2(rect.y1)}`;
    if (isMajor(x)) maj += l; else minor += l;
  }
  for (let y = y0; y <= rect.y1; y += step) {
    const l = `M${r2(rect.x0)} ${r2(y)}H${r2(rect.x1)}`;
    if (isMajor(y)) maj += l; else minor += l;
  }
  const w = r2(1 * upp);
  return `<g class="ilm-grid" fill="none" stroke="${rs.grid}">`
    + (minor ? `<path d="${minor}" stroke-width="${w}" stroke-opacity="0.45"/>` : '')
    + (maj ? `<path d="${maj}" stroke-width="${w}" stroke-opacity="0.9"/>` : '')
    + '</g>';
}

/**
 * Render all map content (layers, POIs, labels) as SVG fragments.
 * opts: { unitsPerPx, layers?: string[] (visible layer names; 'pois' and 'labels' included),
 *         labels?: bool, interactive?: bool, selection?: Set<string> }
 * @returns {{defs: string, layers: Record<string,string>, pois: string, labels: string, body: string}}
 */
export function renderParts(doc, opts = {}) {
  const upp = opts.unitsPerPx || 1;
  const rs = resolveStyle(doc.style);
  const visible = opts.layers ? new Set(opts.layers) : null;
  const show = (name) => !visible || visible.has(name);
  const showLabels = opts.labels !== false && show('labels');
  const interactive = !!opts.interactive;
  const sel = opts.selection || new Set();
  const flipY = !!doc.meta?.flipY;
  const V = (p) => [p[0], flipY ? -p[1] : p[1]];
  const px = (n) => r2(n * upp);
  const labels = [];
  const layerOut = {};

  // Text is drawn at its pixel size inside a scale(unitsPerPx) group: browsers render
  // very large font sizes (world units) poorly, so labels never use world-sized fonts.
  const labelText = (x, y, text, { size = 12, anchor = 'middle', italic = false, weight = 500, color = rs.label, rotate = 0, spacing = 0, upper = false, opacity = 1 } = {}) => {
    const t = upper ? String(text).toUpperCase() : text;
    const tr = `translate(${r2(x)} ${r2(y)})${rotate ? ` rotate(${r2(rotate)})` : ''} scale(${upp})`;
    return `<text transform="${tr}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="middle"`
      + `${italic ? ' font-style="italic"' : ''} font-weight="${weight}"${spacing ? ` letter-spacing="${spacing}"` : ''}`
      + ` fill="${color}"${opacity !== 1 ? ` fill-opacity="${opacity}"` : ''} stroke="${rs.halo}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(t)}</text>`;
  };

  const lineLabel = (vpts, closed, name, o) => {
    const L = polylineLength(vpts, closed);
    const r = atDistance(vpts, L / 2, closed);
    let deg = (r.angle * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    // offset slightly off the line
    const off = 9 * upp;
    const rad = (deg * Math.PI) / 180;
    const x = r.point[0] + Math.sin(rad) * off * -1;
    const y = r.point[1] + Math.cos(rad) * off * -1;
    labels.push(labelText(x, y, name, { ...o, rotate: deg }));
  };

  const groupOpen = (layer, f, extraClass = '') => {
    const cls = `ilm-feat${sel.has(f.id) ? ' is-selected' : ''}${extraClass}`;
    return interactive ? `<g class="${cls}" data-id="${esc(f.id)}" data-layer="${layer}">` : `<g class="${cls}" id="f-${esc(f.id)}">`;
  };

  const hitPath = (d, W) => (interactive
    ? `<path class="ilm-hit" d="${d}" fill="none" stroke="transparent" stroke-width="${r2(Math.max(W, 12 * upp))}" stroke-linecap="round" stroke-linejoin="round"/>`
    : '');

  const filled = doc.meta?.landMode === 'filled';

  for (const layer of DRAW_ORDER) {
    if (!show(layer)) { layerOut[layer] = ''; continue; }
    const lst = rs.layers[layer] || {};
    let s = '';
    if (layer === 'land' && filled) {
      const r = viewRectOfBounds(doc);
      s += `<rect x="${r2(r.x0)}" y="${r2(r.y0)}" width="${r2(r.x1 - r.x0)}" height="${r2(r.y1 - r.y0)}" fill="${lst.fill}"/>`;
    }
    for (const f of doc.layers[layer]) {
      if (f.hidden) continue;
      const pts = (f.points || []).map(V);
      if (pts.length < 2) continue;
      const st = featureStyle(rs, layer, f);
      const polygon = layer === 'land' || layer === 'water' || layer === 'zones';
      const closed = polygon || f.closed === true;
      if (polygon && pts.length < 3) continue;
      const smooth = !!f.smooth && layer !== 'walls';
      const d = pathFor(pts, closed, smooth);
      const sw = px(st.width);
      let g = groupOpen(layer, f);
      if (layer === 'land') {
        if (filled) g += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${sw}" stroke-dasharray="${px(6)} ${px(4)}" stroke-opacity="0.6"/>`;
        else g += `<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      } else if (layer === 'water') {
        g += `<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      } else if (layer === 'zones') {
        const op = st.opacity ?? 0.35;
        g += `<path d="${d}" fill="${st.fill}" fill-opacity="${op}" stroke="${st.stroke}" stroke-width="${px(1.2)}" stroke-opacity="0.8" stroke-dasharray="${px(5)} ${px(3)}"/>`;
        if (st.pattern) g += `<path d="${d}" fill="url(#ilm-pat-${safeId(f.type)})" fill-opacity="${Math.min(1, op + 0.35)}" stroke="none" pointer-events="none"/>`;
      } else if (layer === 'walls') {
        g += renderWall(f, pts, st, upp, interactive);
      } else {
        const W = st.worldWidth ? Math.max(st.worldWidth, upp) : st.width * upp;
        const cap = layer === 'rails' ? 'butt' : 'round';
        g += hitPath(d, W);
        if (layer === 'rails') {
          const tieW = st.worldWidth ? W * 2.6 : Math.max(W * 3, 7 * upp);
          const tieDash = st.worldWidth ? `${r2(W * 0.35)} ${r2(W * 1.6)}` : `${px(1.5)} ${px(5)}`;
          g += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(tieW)}" stroke-dasharray="${tieDash}" stroke-linejoin="round"/>`;
        }
        if (layer === 'roads' && st.worldWidth == null && !st.dash) {
          // casing for readability
          g += `<path d="${d}" fill="none" stroke="${rs.halo}" stroke-opacity="0.55" stroke-width="${r2(W + 2 * upp)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
        g += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(W)}" stroke-linecap="${cap}" stroke-linejoin="round"${dashAttr(st.dash, st.worldWidth ? W / st.width : upp)}/>`;
      }
      g += '</g>';
      s += g;

      // labels
      if (showLabels && f.name) {
        if (polygon) {
          const geo = featureGeometry({ ...f, points: pts });
          const c = centroid(geo);
          if (layer === 'zones') labels.push(labelText(c[0], c[1], f.name, { size: 11, upper: true, spacing: 2, weight: 600, opacity: 0.85 }));
          else if (layer === 'water') labels.push(labelText(c[0], c[1], f.name, { size: 11, italic: true, color: st.stroke }));
          else {
            // islands are named on the sea, just below their shape, so zone names inside stay readable
            let maxY = -Infinity;
            for (const p of geo) if (p[1] > maxY) maxY = p[1];
            labels.push(labelText(c[0], maxY + 16 * upp, f.name, { size: 13, upper: true, spacing: 3, weight: 700, opacity: 0.9 }));
          }
        } else if (layer === 'rivers') {
          lineLabel(featureGeometry({ ...f, points: pts }), closed, f.name, { size: 10, italic: true, color: st.stroke });
        } else if (layer !== 'walls') {
          lineLabel(featureGeometry({ ...f, points: pts }), closed, f.name, { size: 10 });
        }
      }
      if (showLabels && layer === 'walls') {
        const lay = wallLayout({ ...f, points: pts });
        for (const gt of lay.gates) {
          if (gt.name) labels.push(labelText(gt.point[0], gt.point[1] - 14 * upp, gt.name, { size: 10, weight: 600 }));
        }
      }
    }
    const op = layer !== 'zones' && lst.opacity !== undefined && lst.opacity !== 1 ? ` opacity="${lst.opacity}"` : '';
    layerOut[layer] = `<g id="layer-${layer}"${op}>${s}</g>`;
  }

  // POIs
  let pois = '';
  if (show('pois')) {
    const R = 10 * upp;
    const S = 15 * upp;
    for (const p of doc.pois) {
      if (p.placed === false) continue;
      const [x, y] = V([p.x, p.y]);
      const ps = poiStyle(rs, p);
      const status = p.status || 'idea';
      const ring = STATUS_COLORS[status] || STATUS_COLORS.idea;
      const cls = `ilm-poi${sel.has(p.id) ? ' is-selected' : ''} status-${status}`;
      const attrs = interactive ? ` data-id="${esc(p.id)}" data-kind="poi"` : ` id="poi-${esc(p.id)}"`;
      pois += `<g class="${cls}"${attrs} transform="translate(${r2(x)} ${r2(y)})">`
        + `<circle r="${r2(R)}" fill="${rs.poiBg}" fill-opacity="0.9" stroke="${ring}" stroke-width="${px(2)}"${status === 'idea' ? ` stroke-dasharray="${px(3)} ${px(2)}"` : ''}/>`
        + `<use href="#ilm-ico-${ps.icon}" x="${r2(-S / 2)}" y="${r2(-S / 2)}" width="${r2(S)}" height="${r2(S)}" color="${ps.color}" style="color:${ps.color}"/>`
        + (status === 'cut' ? `<path d="M${r2(-R * 0.75)} ${r2(R * 0.75)}L${r2(R * 0.75)} ${r2(-R * 0.75)}" stroke="${ring}" stroke-width="${px(2)}"/>` : '')
        + '</g>';
      if (showLabels) labels.push(labelText(x + R + 4 * upp, y, p.name, { size: 12, anchor: 'start', weight: 600 }));
    }
  }

  const defs = renderDefs(doc, { unitsPerPx: upp, resolvedStyle: rs });
  const poisG = `<g id="layer-pois">${pois}</g>`;
  const labelsG = `<g id="layer-labels" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" pointer-events="none">${labels.join('')}</g>`;
  const body = DRAW_ORDER.map((l) => layerOut[l]).join('') + poisG + labelsG;
  return { defs, layers: layerOut, pois: poisG, labels: labelsG, body, style: rs };
}

function renderWall(f, pts, st, upp, interactive) {
  const closed = f.closed === true;
  const W = st.worldWidth ? Math.max(st.worldWidth, 2.5 * upp) : st.width * upp;
  const lay = wallLayout({ ...f, points: pts });
  const pieces = cutGaps(pts, closed, lay.gates);
  const pattern = st.pattern || 'crenel';
  let s = '';
  const dAll = linearPath(pts, closed);
  if (interactive) s += `<path class="ilm-hit" d="${dAll}" fill="none" stroke="transparent" stroke-width="${r2(Math.max(W * 2, 12 * upp))}"/>`;
  for (const piece of pieces) {
    if (piece.length < 2) continue;
    const d = linearPath(piece, false);
    if (pattern === 'ticks') {
      s += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(W * 2)}" stroke-dasharray="${r2(W * 0.3)} ${r2(W * 0.55)}"/>`;
      s += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(W * 0.6)}" stroke-linejoin="round"/>`;
    } else {
      s += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(W * 1.7)}" stroke-dasharray="${r2(W * 0.7)} ${r2(W * 0.7)}"/>`;
      s += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(W)}" stroke-linejoin="miter"/>`;
    }
  }
  const tsz = Math.max(f.wall?.towerSize > 0 ? f.wall.towerSize : 600, W * 2.2);
  for (const t of lay.towers) {
    const deg = r2((t.angle * 180) / Math.PI);
    s += `<rect x="${r2(-tsz / 2)}" y="${r2(-tsz / 2)}" width="${r2(tsz)}" height="${r2(tsz)}" fill="${st.stroke}" transform="translate(${r2(t.point[0])} ${r2(t.point[1])}) rotate(${deg})"/>`;
  }
  const gs = Math.max(14 * upp, tsz);
  for (const g of lay.gates) {
    s += `<use href="#ilm-ico-gate" class="ilm-gate" x="${r2(g.point[0] - gs / 2)}" y="${r2(g.point[1] - gs / 2)}" width="${r2(gs)}" height="${r2(gs)}" color="${st.stroke}" style="color:${st.stroke}"/>`;
  }
  return s;
}

/**
 * Full standalone SVG document.
 * opts: { width, height, padding (px), background (ocean rect, default true), grid (default view.grid.visible),
 *         labels (default true), layers?: string[], selection?: Set, bounds? }
 */
export function renderSvg(doc, opts = {}) {
  const bounds = opts.bounds || doc.view.bounds;
  const rect = viewRectOfBounds(doc, bounds);
  const bw = rect.x1 - rect.x0;
  const bh = rect.y1 - rect.y0;
  const pad = opts.padding ?? 0;
  const width = Math.max(1, Math.round(opts.width ?? 1024));
  const height = Math.max(1, Math.round(opts.height ?? ((width - 2 * pad) * bh) / bw + 2 * pad));
  const upp = Math.max(bw / Math.max(1, width - 2 * pad), bh / Math.max(1, height - 2 * pad));
  const vbW = width * upp;
  const vbH = height * upp;
  const vx = rect.x0 - (vbW - bw) / 2;
  const vy = rect.y0 - (vbH - bh) / 2;
  const parts = renderParts(doc, { unitsPerPx: upp, layers: opts.layers, labels: opts.labels, selection: opts.selection });
  const rs = parts.style;
  const showGrid = opts.grid ?? doc.view.grid?.visible ?? false;
  const vr = { x0: vx, y0: vy, x1: vx + vbW, y1: vy + vbH };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${r2(vx)} ${r2(vy)} ${r2(vbW)} ${r2(vbH)}">\n`;
  s += `<title>${esc(doc.meta?.name || 'IluMap')}</title>\n`;
  s += `<defs>${parts.defs}</defs>\n`;
  if (opts.background !== false) s += `<rect id="ocean" x="${r2(vx)}" y="${r2(vy)}" width="${r2(vbW)}" height="${r2(vbH)}" fill="${rs.ocean}"/>\n`;
  if (showGrid) s += `${renderGrid(doc, vr, { unitsPerPx: upp, resolvedStyle: rs })}\n`;
  for (const l of DRAW_ORDER) s += `${parts.layers[l]}\n`;
  s += `${parts.pois}\n${parts.labels}\n</svg>\n`;
  return s;
}
