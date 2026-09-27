// Edit tool (V): works with points only — the vertices of lines and polygons
// and POIs. Whole objects are moved and scaled with the Transform tool (S).
//   click an object: select it (Shift toggles), its vertices appear;
//   click a vertex: select it (Shift toggles); drag a selected point: move all
//   selected points (vertices and POIs) — snapping follows the snap toggle,
//   Shift inverts it; drag anywhere else: box-select the vertices and POIs
//   inside; Alt+click a selected feature's segment inserts a vertex;
//   double-click a vertex deletes it.

import {
  store, select, clearSelection, beginChange, endChange, liveUpdate, change, isLayerLocked, isLayerVisible,
  selectVertices, vkey, parseVkey,
} from '../state.js';
import { findById, insertVertex, removeVertex, zoneOf, features } from '../../core/model.js';
import { nearestPointOnPolyline } from '../../core/geometry.js';
import { toView } from '../../core/render-svg.js';
import { toast } from '../dom.js';
import { t } from '../i18n/index.js';

let drag = null;

/** The selected points that can move: selected vertices and selected POIs, with their start positions. */
export function selectedPoints() {
  const out = [];
  for (const k of store.vsel) {
    const [id, i] = parseVkey(k);
    const hit = findById(store.doc, id);
    if (!hit || hit.kind !== 'feature' || isLayerLocked(hit.layer) || !hit.item.points[i]) continue;
    out.push({ kind: 'vertex', feature: hit.item, index: i, x: hit.item.points[i][0], y: hit.item.points[i][1] });
  }
  if (!isLayerLocked('pois')) {
    for (const id of store.selection) {
      const hit = findById(store.doc, id);
      if (hit?.kind === 'poi' && hit.item.placed !== false) out.push({ kind: 'poi', item: hit.item, x: hit.item.x, y: hit.item.y });
    }
  }
  return out;
}

/** Move points (from selectedPoints()) by dx, dy from their start positions. */
export function movePoints(points, dx, dy) {
  for (const p of points) {
    const x = Math.round(p.x + dx);
    const y = Math.round(p.y + dy);
    if (p.kind === 'poi') { p.item.x = x; p.item.y = y; } else p.feature.points[p.index] = [x, y];
  }
}

/** POIs keep their zone reference in sync with where they are. */
export function updateZones(points) {
  for (const p of points) {
    if (p.kind !== 'poi') continue;
    const z = zoneOf(store.doc, [p.item.x, p.item.y]);
    if (z) p.item.zone = z;
    else delete p.item.zone;
  }
}

function pointsDrag(ctx, grabbed) {
  return { type: 'points', start: ctx.screen, startWorld: ctx.world, grabbed, points: selectedPoints(), moved: false, open: false };
}

export default {
  id: 'select',
  get label() { return t('tools.select'); },
  key: 'V',
  icon: 'edit',
  hint: () => t('tools.selectHint'),

  down(ctx) {
    const { hit } = ctx;
    const doc = store.doc;
    drag = null;
    if (hit?.type === 'vertex') {
      const fhit = findById(doc, hit.id);
      if (!fhit || fhit.kind !== 'feature') return;
      if (ctx.clicks >= 2) {
        change(() => {
          if (!removeVertex(fhit.item, hit.index)) toast(t(fhit.item.kind === 'polygon' ? 'toast.polygonMinPoints' : 'toast.lineMinPoints'), { type: 'warn' });
        });
        selectVertices([]);
        return;
      }
      const k = vkey(hit.id, hit.index);
      if (ctx.shift) selectVertices([k], { toggle: true });
      else if (!store.vsel.has(k)) selectVertices([k]);
      if (!store.vsel.has(k)) return; // Shift+click deselected it
      drag = pointsDrag(ctx, fhit.item.points[hit.index]);
      return;
    }
    if (hit?.type === 'poi') {
      if (ctx.shift) select(hit.id, { toggle: true });
      else if (!store.selection.has(hit.id)) select(hit.id);
      if (!store.selection.has(hit.id)) return;
      const p = findById(doc, hit.id).item;
      drag = pointsDrag(ctx, [p.x, p.y]);
      return;
    }
    if (hit?.type === 'feature') {
      // Alt+click on a selected feature: insert a vertex on the nearest segment and drag it
      if (ctx.alt && store.selection.has(hit.id)) {
        const f = findById(doc, hit.id).item;
        const closed = f.kind === 'polygon' || f.closed === true;
        const r = nearestPointOnPolyline(ctx.world, f.points, closed);
        const at = r.segIndex + 1;
        beginChange();
        insertVertex(f, at, ctx.snap ? ctx.canvas.snap(ctx.world) : ctx.world.map(Math.round));
        liveUpdate();
        selectVertices([vkey(f.id, at)]);
        drag = { ...pointsDrag(ctx, f.points[at]), open: true };
        return;
      }
      // clicking an object selects it; its body does not move (a drag box-selects points instead)
      if (ctx.shift) select(hit.id, { toggle: true });
      else { select(hit.id); selectVertices([]); }
    } else if (!ctx.shift) clearSelection();
    drag = { type: 'box', start: ctx.screen, startView: ctx.view, cur: ctx.view, moved: false, add: ctx.shift };
  },

  move(ctx) {
    if (!drag) return;
    const dist = Math.hypot(ctx.screen[0] - drag.start[0], ctx.screen[1] - drag.start[1]);
    if (!drag.moved && dist < 3) return;
    if (drag.type === 'points') {
      if (!drag.open) { beginChange(); drag.open = true; }
      drag.moved = true;
      let dx = ctx.world[0] - drag.startWorld[0];
      let dy = ctx.world[1] - drag.startWorld[1];
      if (ctx.snap && drag.grabbed) {
        // the grabbed point lands on the grid, the others keep their offsets
        const s = ctx.canvas.snap([drag.grabbed[0] + dx, drag.grabbed[1] + dy]);
        dx = s[0] - drag.grabbed[0];
        dy = s[1] - drag.grabbed[1];
      }
      movePoints(drag.points, dx, dy);
      liveUpdate();
    } else if (drag.type === 'box') {
      drag.moved = true;
      drag.cur = ctx.view;
      ctx.canvas.invalidate('tool');
    }
  },

  up(ctx) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.type === 'points') {
      if (d.moved) updateZones(d.points);
      if (d.open) endChange();
      return;
    }
    ctx.canvas.invalidate('tool');
    if (!d.moved) return;
    // box: the vertices and POIs inside (their features become selected)
    const x0 = Math.min(d.startView[0], d.cur[0]); const x1 = Math.max(d.startView[0], d.cur[0]);
    const y0 = Math.min(d.startView[1], d.cur[1]); const y1 = Math.max(d.startView[1], d.cur[1]);
    const inside = (p) => {
      const [vx, vy] = toView(store.doc, p);
      return vx >= x0 && vx <= x1 && vy >= y0 && vy <= y1;
    };
    const ids = [];
    const keys = [];
    if (isLayerVisible('pois') && !isLayerLocked('pois')) {
      for (const p of store.doc.pois) if (p.placed !== false && inside([p.x, p.y])) ids.push(p.id);
    }
    for (const { layer, feature } of features(store.doc)) {
      if (feature.hidden || !isLayerVisible(layer) || isLayerLocked(layer)) continue;
      let any = false;
      feature.points.forEach((p, i) => { if (inside(p)) { keys.push(vkey(feature.id, i)); any = true; } });
      if (any) ids.push(feature.id);
    }
    select(ids, { add: d.add });
    selectVertices(keys, { add: d.add });
  },

  overlay(canvas) {
    return boxOverlay(canvas, drag);
  },

  cancel() {
    if (drag?.open) endChange();
    drag = null;
  },

  deactivate() { this.cancel(); },
};

/** The dashed selection box while dragging on empty space (shared with the Transform tool). */
export function boxOverlay(canvas, d) {
  if (!d || d.type !== 'box' || !d.moved) return '';
  const upp = canvas.unitsPerPx;
  const x = Math.min(d.startView[0], d.cur[0]);
  const y = Math.min(d.startView[1], d.cur[1]);
  const w = Math.abs(d.cur[0] - d.startView[0]);
  const h = Math.abs(d.cur[1] - d.startView[1]);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="ov-box" stroke-width="${upp}" stroke-dasharray="${4 * upp} ${3 * upp}"/>`;
}
