// Edit tool (V): works with points — the vertices of the selected objects and
// selected POIs. A plain click never changes which objects are selected (a
// missed vertex does not pick the island underneath); objects are chosen in
// the Layers panel, the Points list, with Ctrl+click on the map (any layer,
// the shapes that can be picked light up while Ctrl is held) or with the
// Move / scale tool (S). See `picks` / `hover` / `tip` in canvas.js.
//   click a vertex: select it (Shift toggles); drag a selected point: move all
//   selected points (vertices and POIs) — snapping follows the snap toggle,
//   Shift inverts it; drag anywhere else: box-select vertices of the selected
//   objects (Ctrl: box-select objects); Alt: preview + click adds a point on
//   the nearest segment, or deletes the point under the pointer (red cross);
//   double-click a vertex deletes it; Ctrl+A selects all their vertices.

import {
  store, select, clearSelection, beginChange, endChange, liveUpdate, change, isLayerLocked, isLayerVisible,
  selectVertices, vkey, parseVkey,
} from '../state.js';
import { findById, insertVertex, removeVertex, zoneOf, features } from '../../core/model.js';
import { nearestPointOnPolyline, catmullRomToPath, linearPath } from '../../core/geometry.js';
import { toView, fromView } from '../../core/render-svg.js';
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

const HIT_VERTEX_PX = 8; // Alt: a point closer than this is the one to delete
const HIT_SEGMENT_PX = 14; // Alt: a segment closer than this gets the new point

let hover = null; // preview under the pointer: { type: 'add' | 'delete' | 'pick' | 'pickNone' | 'altNone' | 'nothing', … }

/** The vertex of an edited feature nearest to view point v within tol (view units). */
function nearestVertex(v, tol) {
  let best = null;
  for (const f of editableFeatures()) {
    f.points.forEach((p, i) => {
      const [x, y] = toView(store.doc, p);
      const d = Math.hypot(x - v[0], y - v[1]);
      if (d <= tol && (!best || d < best.d)) best = { d, f, i, view: [x, y] };
    });
  }
  return best;
}

/** Where Alt+click would insert a point: nearest segment of an edited feature within tol. */
function nearestSegment(ctx, tol) {
  let best = null;
  for (const f of editableFeatures()) {
    if (f.points.length < 2) continue;
    const closed = f.kind === 'polygon' || f.closed === true;
    const r = nearestPointOnPolyline(ctx.view, f.points.map((p) => toView(store.doc, p)), closed);
    if (r && r.dist <= tol && (!best || r.dist < best.d)) best = { d: r.dist, f, at: r.segIndex + 1, view: r.point };
  }
  if (!best) return null;
  const w = fromView(store.doc, best.view);
  const world = ctx.snap ? ctx.canvas.snap(w) : w.map(Math.round);
  return { ...best, world, view: toView(store.doc, world) };
}

const minPoints = (f) => (f.kind === 'polygon' ? 3 : 2);

/** What the pointer would do now (drives the overlay preview and the click). */
function hoverFor(ctx) {
  const upp = ctx.canvas.unitsPerPx;
  if (ctx.ctrl) {
    // Ctrl: pick objects from any visible, unlocked layer (Canvas.picks → 'objects')
    const hit = ctx.hit;
    if (hit) return { type: 'pick', id: hit.id }; // a vertex hit names its feature
    return { type: 'pickNone' };
  }
  if (ctx.alt) {
    const v = nearestVertex(ctx.view, HIT_VERTEX_PX * upp);
    if (v) return { type: 'delete', f: v.f, i: v.i, view: v.view, ok: v.f.points.length > minPoints(v.f) };
    const s = nearestSegment(ctx, HIT_SEGMENT_PX * upp);
    if (s) return { type: 'add', f: s.f, at: s.at, world: s.world, view: s.view };
    return { type: 'altNone' };
  }
  if (!editableFeatures().length && !selectedPoints().length) return { type: 'nothing' };
  return null;
}

/** Objects that lie entirely inside a view-space box (Ctrl + drag). */
function objectsInBox(b) {
  const inside = (p) => {
    const [x, y] = toView(store.doc, p);
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  };
  const ids = [];
  if (isLayerVisible('pois') && !isLayerLocked('pois')) {
    for (const p of store.doc.pois) if (p.placed !== false && inside([p.x, p.y])) ids.push(p.id);
  }
  for (const { layer, feature } of features(store.doc)) {
    if (feature.hidden || !isLayerVisible(layer) || isLayerLocked(layer)) continue;
    if (feature.points.length && feature.points.every(inside)) ids.push(feature.id);
  }
  return ids;
}


export default {
  id: 'select',
  get label() { return t('tools.select'); },
  key: 'V',
  icon: 'select',
  hint: () => t('tools.selectHint'),
  // What a click on the map can select: points of the objects already selected;
  // with Ctrl held, objects from any visible, unlocked layer (see Canvas.picks).
  picks: (mods) => (mods.ctrl ? 'objects' : 'points'),

  hover(ctx) {
    hover = ctx && !drag ? hoverFor(ctx) : null;
  },

  down(ctx) {
    const { hit } = ctx;
    const doc = store.doc;
    drag = null;
    hover = null;
    // Ctrl: choose objects on the map (from any layer); Shift adds / removes
    if (ctx.ctrl) {
      if (hit) {
        select(hit.id, { toggle: ctx.shift });
        selectVertices([]);
        return;
      }
      if (!ctx.shift) clearSelection();
      drag = { type: 'box', objects: true, start: ctx.screen, startView: ctx.view, cur: ctx.view, moved: false, add: ctx.shift };
      return;
    }
    // Alt: add a point on the nearest segment, or delete the point under the pointer
    if (ctx.alt) {
      const a = hoverFor(ctx);
      if (a?.type === 'delete') {
        change(() => {
          if (!removeVertex(a.f, a.i)) toast(t(a.f.kind === 'polygon' ? 'toast.polygonMinPoints' : 'toast.lineMinPoints'), { type: 'warn' });
        });
        selectVertices([]);
      } else if (a?.type === 'add') {
        beginChange();
        insertVertex(a.f, a.at, a.world);
        liveUpdate();
        selectVertices([vkey(a.f.id, a.at)]);
        drag = { ...pointsDrag(ctx, a.f.points[a.at]), open: true }; // keep dragging the new point
      }
      return;
    }
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
    const b = {
      x0: Math.min(d.startView[0], d.cur[0]), x1: Math.max(d.startView[0], d.cur[0]),
      y0: Math.min(d.startView[1], d.cur[1]), y1: Math.max(d.startView[1], d.cur[1]),
    };
    if (d.objects) {
      // Ctrl + box: objects that lie entirely inside
      select(objectsInBox(b), { add: d.add });
      selectVertices([]);
      return;
    }
    // box: the vertices of the selected objects inside (the object selection stays as it is)
    const keys = [];
    for (const f of editableFeatures()) {
      f.points.forEach((p, i) => {
        const [x, y] = toView(store.doc, p);
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) keys.push(vkey(f.id, i));
      });
    }
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
    let s = boxOverlay(canvas, drag);
    if (!hover || drag) return s;
    const upp = canvas.unitsPerPx;
    const r = (v) => Math.round(v * 100) / 100;
    if (hover.type === 'add') {
      const [x, y] = hover.view;
      const a = 3 * upp;
      s += `<g class="ov-add"><circle cx="${r(x)}" cy="${r(y)}" r="${r(6 * upp)}" stroke-width="${r(1.5 * upp)}"/>`
        + `<path d="M${r(x - a)} ${r(y)}H${r(x + a)}M${r(x)} ${r(y - a)}V${r(y + a)}" stroke-width="${r(1.6 * upp)}"/></g>`;
    } else if (hover.type === 'delete') {
      const [x, y] = hover.view;
      const a = 3 * upp;
      s += `<g class="ov-del${hover.ok ? '' : ' blocked'}"><circle cx="${r(x)}" cy="${r(y)}" r="${r(8 * upp)}" stroke-width="${r(1.5 * upp)}"/>`
        + `<path d="M${r(x - a)} ${r(y - a)}L${r(x + a)} ${r(y + a)}M${r(x + a)} ${r(y - a)}L${r(x - a)} ${r(y + a)}" stroke-width="${r(1.8 * upp)}"/></g>`;
    } else if (hover.type === 'pick') {
      // outline of the object a Ctrl+click would select
      const hit = findById(store.doc, hover.id);
      if (hit?.kind === 'poi') {
        const [x, y] = toView(store.doc, [hit.item.x, hit.item.y]);
        s += `<circle cx="${r(x)}" cy="${r(y)}" r="${r(17 * upp)}" class="ov-pick" stroke-width="${r(2 * upp)}"/>`;
      } else if (hit?.kind === 'feature' && hit.item.points.length) {
        const pts = hit.item.points.map((p) => toView(store.doc, p));
        const closed = hit.item.kind === 'polygon' || hit.item.closed === true;
        const d = hit.item.smooth && hit.layer !== 'walls' ? catmullRomToPath(pts, closed) : linearPath(pts, closed);
        s += `<path d="${d}" class="ov-pick" stroke-width="${r(2.5 * upp)}"/>`;
      }
    }
    return s;
  },

  cancel() {
    if (drag?.open) endChange();
    drag = null;
    hover = null;
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
