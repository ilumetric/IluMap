// Edit tool (V): works with points only — the vertices of the objects that
// are selected and selected POIs. Clicks on the map never change which
// objects are selected (a missed vertex does not pick the island underneath):
// objects are chosen in the Layers panel, the Points list or with the
// Move / scale tool (S). See `picks` on the tools and Canvas.hitFromTarget.
//   click a vertex: select it (Shift toggles); drag a selected point: move all
//   selected points (vertices and POIs) — snapping follows the snap toggle,
//   Shift inverts it; drag anywhere else: box-select vertices of the selected
//   objects; Alt+click a selected feature's segment inserts a vertex;
//   double-click a vertex deletes it; Ctrl+A selects all their vertices.

import {
  store, beginChange, endChange, liveUpdate, change, isLayerLocked, isLayerVisible, selectVertices, vkey, parseVkey,
} from '../state.js';
import { findById, insertVertex, removeVertex, zoneOf } from '../../core/model.js';
import { nearestPointOnPolyline } from '../../core/geometry.js';
import { toView } from '../../core/render-svg.js';
import { toast } from '../dom.js';
import { t } from '../i18n/index.js';

let drag = null;

/** Selected features whose points can be edited (visible, unlocked layers). */
export function editableFeatures() {
  const out = [];
  for (const id of store.selection) {
    const hit = findById(store.doc, id);
    if (hit?.kind === 'feature' && !hit.item.hidden && isLayerVisible(hit.layer) && !isLayerLocked(hit.layer)) out.push(hit.item);
  }
  return out;
}

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
  // what a click on the map can select: 'objects' (any visible, unlocked object), 'points' (only
  // vertices / POIs of the objects already selected in Layers or Points), 'none' (default)
  picks: 'points',

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
      // only selected POIs reach here (Canvas.hitFromTarget): drag it with the other selected points
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
    }
    // anything else (a selected object's body, empty space, other objects): box-select points
    if (!ctx.shift) selectVertices([]);
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
    // box: the vertices of the selected objects inside (the object selection stays as it is)
    const x0 = Math.min(d.startView[0], d.cur[0]); const x1 = Math.max(d.startView[0], d.cur[0]);
    const y0 = Math.min(d.startView[1], d.cur[1]); const y1 = Math.max(d.startView[1], d.cur[1]);
    const inside = (p) => {
      const [vx, vy] = toView(store.doc, p);
      return vx >= x0 && vx <= x1 && vy >= y0 && vy <= y1;
    };
    const keys = [];
    for (const f of editableFeatures()) f.points.forEach((p, i) => { if (inside(p)) keys.push(vkey(f.id, i)); });
    selectVertices(keys, { add: d.add });
  },

  status() {
    const feats = editableFeatures();
    const pois = [...store.selection].filter((id) => findById(store.doc, id)?.kind === 'poi');
    const n = feats.length + pois.length;
    if (!n) return t('tools.editNothing');
    const name = n === 1 ? (feats[0] || findById(store.doc, pois[0]).item) : null;
    const what = name ? t('tools.editNamed', { name: name.name || name.id }) : t('tools.editCount', { n: String(n) });
    return store.vsel.size ? t('tools.editScopePoints', { what, points: String(store.vsel.size) }) : t('tools.editScope', { what });
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
