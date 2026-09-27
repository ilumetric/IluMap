// Select / move tool: click to select (Shift toggles), drag to move features
// and POIs (snapping to the grid follows the snap toggle, Shift inverts it), drag vertices,
// Alt+click on a selected feature's segment inserts a vertex, double-click a
// vertex deletes it, drag on empty space for a box selection.

import { store, select, clearSelection, beginChange, endChange, liveUpdate, change, isLayerLocked, isLayerVisible } from '../state.js';
import { findById, insertVertex, removeVertex, zoneOf, features } from '../../core/model.js';
import { nearestPointOnPolyline } from '../../core/geometry.js';
import { toView } from '../../core/render-svg.js';
import { toast } from '../dom.js';
import { t } from '../i18n/index.js';

let drag = null;

function snapshotItems(ids) {
  const out = [];
  for (const id of ids) {
    const hit = findById(store.doc, id);
    if (!hit) continue;
    if (hit.kind === 'poi') {
      if (isLayerLocked('pois')) continue;
      out.push({ kind: 'poi', item: hit.item, x: hit.item.x, y: hit.item.y });
    } else if (hit.kind === 'feature') {
      if (isLayerLocked(hit.layer)) continue;
      out.push({ kind: 'feature', item: hit.item, points: hit.item.points.map((p) => p.slice()) });
    }
  }
  return out;
}

function updateZones(items) {
  for (const it of items) {
    if (it.kind !== 'poi') continue;
    const z = zoneOf(store.doc, [it.item.x, it.item.y]);
    if (z) it.item.zone = z;
    else delete it.item.zone;
  }
}

export default {
  id: 'select',
  get label() { return t('tools.select'); },
  key: 'V',
  icon: 'select',
  hint: () => t('tools.selectHint'),

  down(ctx) {
    const { hit } = ctx;
    const doc = store.doc;
    if (hit?.type === 'vertex') {
      const fhit = findById(doc, hit.id);
      if (!fhit || fhit.kind !== 'feature') return;
      if (ctx.clicks >= 2) {
        change(() => {
          if (!removeVertex(fhit.item, hit.index)) toast(t(fhit.item.kind === 'polygon' ? 'toast.polygonMinPoints' : 'toast.lineMinPoints'), { type: 'warn' });
        });
        drag = null;
        return;
      }
      drag = { type: 'vertex', feature: fhit.item, index: hit.index, start: ctx.screen, moved: false };
      return;
    }
    if (hit && (hit.type === 'feature' || hit.type === 'poi')) {
      // Alt+click on a selected feature: insert a vertex on the nearest segment
      if (ctx.alt && hit.type === 'feature' && store.selection.has(hit.id)) {
        const f = findById(doc, hit.id).item;
        const closed = f.kind === 'polygon' || f.closed === true;
        const r = nearestPointOnPolyline(ctx.world, f.points, closed);
        const at = r.segIndex + 1;
        beginChange();
        insertVertex(f, at, ctx.snap ? ctx.canvas.snap(ctx.world) : ctx.world.map(Math.round));
        liveUpdate();
        drag = { type: 'vertex', feature: f, index: at, start: ctx.screen, moved: true, inserted: true };
        return;
      }
      const wasSelected = store.selection.has(hit.id);
      if (ctx.shift) {
        if (!wasSelected) select(hit.id, { add: true });
      } else if (!wasSelected) select(hit.id);
      // features only move when they were already selected (avoids nudging a whole island by accident)
      if (hit.type === 'feature' && !wasSelected) { drag = null; return; }
      drag = {
        type: 'move',
        start: ctx.screen,
        startWorld: ctx.world,
        items: snapshotItems(store.selection),
        moved: false,
        toggleOnClick: ctx.shift && wasSelected ? hit.id : null,
        primary: hit.id,
      };
      return;
    }
    // empty space: box selection
    if (!ctx.shift) clearSelection();
    drag = { type: 'box', start: ctx.screen, startView: ctx.view, cur: ctx.view, moved: false, add: ctx.shift };
  },

  move(ctx) {
    if (!drag) return;
    const dist = Math.hypot(ctx.screen[0] - drag.start[0], ctx.screen[1] - drag.start[1]);
    if (!drag.moved && dist < 3) return;
    if (drag.type === 'vertex') {
      if (!drag.moved || drag.inserted) { beginChange(); drag.inserted = false; }
      drag.moved = true;
      const p = ctx.snap ? ctx.canvas.snap(ctx.world) : ctx.world.map(Math.round);
      drag.feature.points[drag.index] = p;
      liveUpdate();
    } else if (drag.type === 'move') {
      if (!drag.moved) beginChange();
      drag.moved = true;
      let dx = ctx.world[0] - drag.startWorld[0];
      let dy = ctx.world[1] - drag.startWorld[1];
      // snapping: snap the primary POI to the grid, move everything by the same delta
      const prim = drag.items.find((it) => it.item.id === drag.primary);
      if (ctx.snap && prim?.kind === 'poi') {
        const s = ctx.canvas.snap([prim.x + dx, prim.y + dy]);
        dx = s[0] - prim.x;
        dy = s[1] - prim.y;
      }
      for (const it of drag.items) {
        if (it.kind === 'poi') {
          it.item.x = Math.round(it.x + dx);
          it.item.y = Math.round(it.y + dy);
        } else {
          it.item.points = it.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]);
        }
      }
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
    if (d.type === 'vertex') {
      if (d.moved) endChange();
    } else if (d.type === 'move') {
      if (d.moved) {
        updateZones(d.items);
        endChange();
      } else if (d.toggleOnClick) {
        select(d.toggleOnClick, { toggle: true });
      }
    } else if (d.type === 'box') {
      ctx.canvas.invalidate('tool');
      if (!d.moved) return;
      const x0 = Math.min(d.startView[0], d.cur[0]); const x1 = Math.max(d.startView[0], d.cur[0]);
      const y0 = Math.min(d.startView[1], d.cur[1]); const y1 = Math.max(d.startView[1], d.cur[1]);
      const inside = (p) => {
        const [vx, vy] = toView(store.doc, p);
        return vx >= x0 && vx <= x1 && vy >= y0 && vy <= y1;
      };
      const ids = [];
      if (isLayerVisible('pois') && !isLayerLocked('pois')) {
        for (const p of store.doc.pois) if (p.placed !== false && inside([p.x, p.y])) ids.push(p.id);
      }
      for (const { layer, feature } of features(store.doc)) {
        if (feature.hidden || !isLayerVisible(layer) || isLayerLocked(layer)) continue;
        if (feature.points.length && feature.points.every(inside)) ids.push(feature.id);
      }
      select(ids, { add: d.add });
    }
  },

  overlay(canvas) {
    if (!drag || drag.type !== 'box' || !drag.moved) return '';
    const upp = canvas.unitsPerPx;
    const x = Math.min(drag.startView[0], drag.cur[0]);
    const y = Math.min(drag.startView[1], drag.cur[1]);
    const w = Math.abs(drag.cur[0] - drag.startView[0]);
    const h = Math.abs(drag.cur[1] - drag.startView[1]);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="ov-box" stroke-width="${upp}" stroke-dasharray="${4 * upp} ${3 * upp}"/>`;
  },

  cancel() {
    if (drag && drag.moved && drag.type !== 'box') endChange();
    drag = null;
  },
};
