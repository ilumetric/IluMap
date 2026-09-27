// Transform tool (S): moves and scales whole objects. A bounding box with
// eight handles surrounds the selection. Corner handles scale proportionally
// (Ctrl: free), edge handles scale one axis, Alt scales about the centre; the
// dragged handle follows grid snapping (the snap toggle, Shift inverts it).
// Drag inside the box (or on a selected object) to move the selection; click
// an object to select it (Shift toggles), drag on empty space to box-select
// the objects that lie entirely inside. One drag = one undo step; Esc during
// a drag cancels it. Only geometry changes: feature points and POI positions
// (line widths, wall / bridge widths and POI symbols keep their size).
// Individual vertices are edited with the Edit tool (V).

import {
  store, select, clearSelection, beginChange, endChange, abortChange, liveUpdate, isLayerLocked, isLayerVisible, isChanging,
} from '../state.js';
import { findById, zoneOf, features } from '../../core/model.js';
import { toView, fromView } from '../../core/render-svg.js';
import { t } from '../i18n/index.js';
import { fmtLength } from '../i18n/format.js';
import { boxOverlay } from './select.js';

const HANDLE_PX = 9; // handle size on screen
const MIN_FACTOR = 0.001; // no flipping through the anchor, no collapse to a point

// handle id → [ix, iy] position in the view-space box (0 = min side, 0.5 = middle, 1 = max side)
const HANDLES = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

let drag = null; // scaling by a handle
let hover = null; // what the pointer is over: { type: 'handle', handle } | { type: 'inside' } | { type: 'object', id }
let pick = null; // moving the selection, or a selection box

function snapshot(items) {
  return items.map((it) => (it.kind === 'poi'
    ? { ...it, x: it.item.x, y: it.item.y }
    : { ...it, points: it.item.points.map((p) => p.slice()) }));
}

function updateZones(items) {
  for (const it of items) {
    if (it.kind !== 'poi') continue;
    const z = zoneOf(store.doc, [it.item.x, it.item.y]);
    if (z) it.item.zone = z; else delete it.item.zone;
  }
}

const insideBox = (b, [x, y]) => b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

/** Start moving the selection; `primary` (a POI) snaps to the grid, everything follows. */
function startMove(ctx, primary = null) {
  const items = editableItems();
  if (!items.length) { pick = null; return; }
  pick = { type: 'move', start: ctx.screen, startWorld: ctx.world, items: snapshot(items), primary, moved: false };
}

/** Editable selected items (locked layers are left alone). */
function editableItems() {
  const out = [];
  for (const id of store.selection) {
    const hit = findById(store.doc, id);
    if (!hit) continue;
    if (hit.kind === 'poi') {
      if (!isLayerLocked('pois') && hit.item.placed !== false) out.push({ kind: 'poi', item: hit.item });
    } else if (hit.kind === 'feature' && !isLayerLocked(hit.layer) && hit.item.points.length) {
      out.push({ kind: 'feature', item: hit.item });
    }
  }
  return out;
}

/** Bounding box of the items in view space, or null. */
function viewBox(items) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const add = (p) => {
    const [x, y] = toView(store.doc, p);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  };
  for (const it of items) {
    if (it.kind === 'poi') add([it.item.x, it.item.y]);
    else for (const p of it.item.points) add(p);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

const handlePoint = (box, [ix, iy]) => [box.x0 + (box.x1 - box.x0) * ix, box.y0 + (box.y1 - box.y0) * iy];

/** Which handles make sense: a flat box (a horizontal line) has no vertical scaling. */
function usableHandles(box) {
  const w = box.x1 - box.x0;
  const hgt = box.y1 - box.y0;
  return Object.keys(HANDLES).filter((k) => {
    const [ix, iy] = HANDLES[k];
    const sx = ix !== 0.5; const sy = iy !== 0.5;
    if (sx && sy) return w > 0 && hgt > 0;
    return sx ? w > 0 : hgt > 0;
  });
}

function setCursor(canvas, c) {
  canvas.svg.style.cursor = c;
}

/** The scale factors and anchor for the pointer at view point `v`. */
function factorsFor(d, v, { free, centred }) {
  const { box, handle } = d;
  const [ix, iy] = HANDLES[handle];
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const ax = centred ? cx : box.x0 + (box.x1 - box.x0) * (1 - ix);
  const ay = centred ? cy : box.y0 + (box.y1 - box.y0) * (1 - iy);
  const [hx, hy] = handlePoint(box, [ix, iy]);
  let sx = 1;
  let sy = 1;
  if (ix !== 0.5 && hx !== ax) sx = (v[0] - ax) / (hx - ax);
  if (iy !== 0.5 && hy !== ay) sy = (v[1] - ay) / (hy - ay);
  const corner = ix !== 0.5 && iy !== 0.5;
  if (corner && !free) {
    // proportional: follow the axis the pointer moved further along
    const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    sx = s; sy = s;
  }
  return { sx: Math.max(MIN_FACTOR, sx), sy: Math.max(MIN_FACTOR, sy), anchor: [ax, ay] };
}

function applyScale(d, { sx, sy, anchor }) {
  const doc = store.doc;
  const [ax, ay] = anchor;
  const map = (p) => {
    const [vx, vy] = toView(doc, p);
    const w = fromView(doc, [ax + (vx - ax) * sx, ay + (vy - ay) * sy]);
    return [Math.round(w[0]), Math.round(w[1])];
  };
  for (const it of d.items) {
    if (it.kind === 'poi') {
      const [x, y] = map([it.x, it.y]);
      it.item.x = x;
      it.item.y = y;
    } else {
      it.item.points = it.points.map(map);
    }
  }
}

export default {
  id: 'scale',
  get label() { return t('tools.scale'); },
  key: 'S',
  icon: 'scale',
  hint: () => t('tools.scaleHint'),
  picks: 'objects', // clicks on the map select objects (see Edit tool)

  hover(ctx) {
    hover = null;
    if (!ctx || drag || pick) return;
    const el = ctx.e?.target?.closest?.('[data-scale-handle]');
    if (el) { hover = { type: 'handle', handle: el.dataset.scaleHandle }; return; }
    if (ctx.hit && ctx.hit.type !== 'vertex' && !store.selection.has(ctx.hit.id)) { hover = { type: 'object', id: ctx.hit.id }; return; }
    if (ctx.hit?.type === 'poi' || insideBox(viewBox(editableItems()), ctx.view)) hover = { type: 'inside' };
  },


  down(ctx) {
    const el = ctx.e?.target?.closest?.('[data-scale-handle]');
    if (el) {
      const items = editableItems();
      const box = viewBox(items);
      if (!box) return;
      drag = {
        handle: el.dataset.scaleHandle,
        box,
        items: snapshot(items),
        moved: false,
        start: ctx.screen,
        f: { sx: 1, sy: 1 },
      };
      setCursor(ctx.canvas, CURSORS[drag.handle]);
      return;
    }
    pick = null;
    const { hit } = ctx;
    if (hit?.type === 'poi' || hit?.type === 'feature') {
      const was = store.selection.has(hit.id);
      if (ctx.shift) { select(hit.id, { toggle: true }); return; }
      if (!was) select(hit.id);
      // POIs move right away; a feature moves once it is selected (no dragging an island by accident)
      if (hit.type === 'poi' || was) {
        const p = hit.type === 'poi' ? findById(store.doc, hit.id)?.item : null;
        startMove(ctx, p ? [p.x, p.y] : null);
        return;
      }
    } else if (insideBox(viewBox(editableItems()), ctx.view)) {
      startMove(ctx);
      return;
    } else if (!ctx.shift) clearSelection();
    pick = { type: 'box', start: ctx.screen, startView: ctx.view, cur: ctx.view, moved: false, add: ctx.shift };
  },

  move(ctx) {
    if (!drag) {
      if (!pick) return;
      if (!pick.moved && Math.hypot(ctx.screen[0] - pick.start[0], ctx.screen[1] - pick.start[1]) < 3) return;
      if (pick.type === 'box') {
        pick.moved = true;
        pick.cur = ctx.view;
        ctx.canvas.invalidate('tool');
        return;
      }
      if (!pick.moved) beginChange();
      pick.moved = true;
      let dx = ctx.world[0] - pick.startWorld[0];
      let dy = ctx.world[1] - pick.startWorld[1];
      if (ctx.snap && pick.primary) {
        const s = ctx.canvas.snap([pick.primary[0] + dx, pick.primary[1] + dy]);
        dx = s[0] - pick.primary[0];
        dy = s[1] - pick.primary[1];
      }
      for (const it of pick.items) {
        if (it.kind === 'poi') { it.item.x = Math.round(it.x + dx); it.item.y = Math.round(it.y + dy); } else it.item.points = it.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]);
      }
      liveUpdate();
      return;
    }
    if (!drag.moved && Math.hypot(ctx.screen[0] - drag.start[0], ctx.screen[1] - drag.start[1]) < 2) return;
    if (!drag.moved) { beginChange({ label: labelFor(drag.items) }); drag.moved = true; }
    const v = ctx.snap ? toView(store.doc, ctx.canvas.snap(ctx.world)) : ctx.view;
    drag.f = factorsFor(drag, v, { free: ctx.ctrl, centred: ctx.alt });
    applyScale(drag, drag.f);
    liveUpdate();
  },

  up(ctx) {
    if (!drag) {
      const p = pick;
      pick = null;
      if (!p) return;
      if (p.type === 'move') {
        if (p.moved) { updateZones(p.items); endChange(); }
        return;
      }
      ctx.canvas.invalidate('tool');
      if (!p.moved) return;
      // box: objects that lie entirely inside
      const x0 = Math.min(p.startView[0], p.cur[0]); const x1 = Math.max(p.startView[0], p.cur[0]);
      const y0 = Math.min(p.startView[1], p.cur[1]); const y1 = Math.max(p.startView[1], p.cur[1]);
      const inside = (q) => insideBox({ x0, y0, x1, y1 }, toView(store.doc, q));
      const ids = [];
      if (isLayerVisible('pois') && !isLayerLocked('pois')) {
        for (const q of store.doc.pois) if (q.placed !== false && inside([q.x, q.y])) ids.push(q.id);
      }
      for (const { layer, feature } of features(store.doc)) {
        if (feature.hidden || !isLayerVisible(layer) || isLayerLocked(layer)) continue;
        if (feature.points.length && feature.points.every(inside)) ids.push(feature.id);
      }
      select(ids, { add: p.add });
      return;
    }
    const d = drag;
    drag = null;
    ctx.canvas.updateCursor();
    if (!d.moved) return;
    updateZones(d.items);
    endChange();
  },

  onKey(e, canvas) {
    if (e.key === 'Escape' && (drag || pick)) {
      const d = drag || pick;
      drag = null;
      pick = null;
      canvas.updateCursor();
      canvas.invalidate('tool');
      if (d.moved && d.type !== 'box') abortChange();
      return true;
    }
    return false;
  },

  cancel() {
    if (drag?.moved || (pick?.type === 'move' && pick.moved)) endChange();
    drag = null;
    pick = null;
  },

  deactivate() { this.cancel(); },

  status() {
    if (drag?.moved) {
      const { sx, sy } = drag.f;
      const pct = (s) => `${Math.round(s * 1000) / 10}%`;
      return t('tools.scaleStatus', { sx: pct(sx), sy: pct(sy) });
    }
    const box = !isChanging() && viewBox(editableItems());
    if (!box) return '';
    return t('tools.scaleSize', { w: fmtLength(box.x1 - box.x0, store.doc.meta), h: fmtLength(box.y1 - box.y0, store.doc.meta) });
  },

  overlay(canvas) {
    let s = boxOverlay(canvas, pick);
    const items = editableItems();
    if (!items.length) return s;
    const box = viewBox(items);
    const upp = canvas.unitsPerPx;
    const r2 = (v) => Math.round(v * 100) / 100;
    s += `<rect x="${r2(box.x0)}" y="${r2(box.y0)}" width="${r2(box.x1 - box.x0)}" height="${r2(box.y1 - box.y0)}" class="ov-scale-box" stroke-width="${r2(1.25 * upp)}"/>`;
    const hs = HANDLE_PX * upp;
    for (const k of usableHandles(box)) {
      const [x, y] = handlePoint(box, HANDLES[k]);
      s += `<rect x="${r2(x - hs / 2)}" y="${r2(y - hs / 2)}" width="${r2(hs)}" height="${r2(hs)}" rx="${r2(1.5 * upp)}" class="ov-scale-handle" stroke-width="${r2(1.5 * upp)}" data-scale-handle="${k}" style="cursor:${CURSORS[k]}"/>`;
    }
    return s;
  },
};

/** Undo label of the step: the item name, or the item count. */
function labelFor(items) {
  return items.length === 1
    ? { key: 'scale', name: items[0].item.name || items[0].item.id }
    : { key: 'scale', count: items.length };
}
