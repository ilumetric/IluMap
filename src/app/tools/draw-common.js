// Shared implementation of the line / polygon / wall drawing tools.
// Click adds a vertex, Enter / double-click / right-click finishes, C closes
// (lines and walls), Backspace removes the last vertex, Esc cancels.
// Snapping to the grid follows the snap toggle (Shift inverts it). Clicking
// the first vertex closes the shape.

import { store, change, select, setActiveLayer, emit } from '../state.js';
import { LAYER_KIND, LAYER_ID_PREFIX, DEFAULT_WALL } from '../../core/schema.js';
import { nextId } from '../../core/model.js';
import { toView } from '../../core/render-svg.js';
import { linearPath, catmullRomToPath, polylineLength, polygonArea } from '../../core/geometry.js';
import { t, plural } from '../i18n/index.js';
import { fmtLength, fmtArea } from '../i18n/format.js';
import { toast } from '../dom.js';
import { newTypeFor, layerLabel } from '../ui/layer-meta.js';

/** Pick the layer a tool draws into, switching the active layer when needed. */
export function targetLayer(kind, wall) {
  if (wall) return 'walls';
  const active = store.activeLayer;
  if (kind === 'line' && LAYER_KIND[active] === 'line') return active;
  if (kind === 'polygon' && LAYER_KIND[active] === 'polygon') return active;
  return kind === 'line' ? (store.prefs.lastLineLayer || 'roads') : (store.prefs.lastPolygonLayer || 'land');
}

export function createDrawTool({ id, labelKey, hintKey = null, key, icon, kind, wall = false, layer: fixedLayer = null, maxPoints = 0 }) {
  let pts = [];
  let hover = null;

  const layer = () => fixedLayer || targetLayer(kind, wall);
  const minPts = kind === 'polygon' ? 3 : 2;

  function finish(canvas, { close = false } = {}) {
    if (pts.length < minPts) {
      if (pts.length) toast(plural('toast.needPoints', minPts), { type: 'warn' });
      return;
    }
    const l = layer();
    const f = { id: nextId(store.doc, LAYER_ID_PREFIX[l]), kind: LAYER_KIND[l] };
    const type = newTypeFor(l);
    if (type) f.type = type;
    f.points = pts.map((p) => p.slice());
    if (kind === 'line' && close && pts.length >= 3) f.closed = true;
    if (l !== 'walls' && l !== 'bridges') f.smooth = true;
    // bridges get a real deck width (world units), narrower for foot and suspension bridges
    if (l === 'bridges') f.width = ['pedestrian', 'suspension'].includes(type) ? 300 : 600;
    if (l === 'walls') {
      f.width = 300;
      f.wall = { ...DEFAULT_WALL, gates: [] };
    }
    change((doc) => { doc.layers[l].push(f); });
    pts = [];
    hover = null;
    select(f.id);
    emit('drawn', { id: f.id, layer: l });
    canvas?.invalidate('tool');
  }

  return {
    id, key, icon,
    get label() { return t(labelKey); },
    get drawing() { return pts.length > 0; },
    hint() {
      return t(hintKey || (kind === 'line' ? 'tools.drawLineHint' : 'tools.drawPolygonHint'), { layer: layerLabel(layer()) });
    },
    activate() {
      const l = layer();
      if (store.activeLayer !== l) setActiveLayer(l);
    },
    deactivate() { pts = []; hover = null; },

    down(ctx) {
      const p = ctx.snap ? ctx.canvas.snap(ctx.world) : ctx.world.map(Math.round);
      if (ctx.clicks >= 2 && pts.length) { finish(ctx.canvas); return; }
      // clicking the first point closes the shape
      if (pts.length >= minPts) {
        const s0 = ctx.canvas.worldToScreen(pts[0]);
        if (Math.hypot(s0[0] - ctx.screen[0], s0[1] - ctx.screen[1]) < 9) {
          finish(ctx.canvas, { close: true });
          return;
        }
      }
      pts.push(p);
      hover = p;
      // fixed-length tools (bridge: one bank, then the other) finish by themselves
      if (maxPoints && pts.length >= maxPoints) { finish(ctx.canvas); emit('hud'); return; }
      ctx.canvas.invalidate('tool');
      emit('hud');
    },
    move(ctx) {
      hover = ctx.snap ? ctx.canvas.snap(ctx.world) : ctx.world;
      if (pts.length) { ctx.canvas.invalidate('tool'); emit('hud'); }
    },
    contextmenu(ctx) { if (pts.length) finish(ctx.canvas); },
    /** Ctrl+Z while drawing: remove the last placed point (like Backspace). */
    onUndo(canvas) {
      if (!pts.length) return false;
      pts.pop();
      canvas.invalidate('tool');
      emit('hud');
      return true;
    },
    onKey(e, canvas) {
      if (e.key === 'Enter') { finish(canvas); return true; }
      if ((e.key === 'c' || e.key === 'C') && pts.length) { finish(canvas, { close: true }); return true; }
      if (e.key === 'Backspace' && pts.length) { pts.pop(); canvas.invalidate('tool'); emit('hud'); return true; }
      if (e.key === 'Escape' && pts.length) { pts = []; hover = null; canvas.invalidate('tool'); emit('hud'); return true; }
      return false;
    },
    status() {
      if (!pts.length) return '';
      const all = hover ? [...pts, hover] : pts;
      if (kind === 'polygon' && all.length >= 3) return t('tools.drawStatusArea', { points: plural('count.points', pts.length), area: fmtArea(polygonArea(all), store.doc.meta) });
      return t('tools.drawStatusLength', { points: plural('count.points', pts.length), length: fmtLength(polylineLength(all), store.doc.meta) });
    },
    overlay(canvas) {
      if (!pts.length) return '';
      const upp = canvas.unitsPerPx;
      const V = (p) => toView(store.doc, p);
      const all = (hover ? [...pts, hover] : pts).map(V);
      const closed = kind === 'polygon';
      const d = all.length >= 3 && layer() !== 'walls' && layer() !== 'bridges' ? catmullRomToPath(all, closed) : linearPath(all, closed);
      let s = `<path d="${d}" class="ov-draft${kind === 'polygon' ? ' fill' : ''}" stroke-width="${2 * upp}"/>`;
      s += `<path d="${linearPath(all, closed)}" class="ov-cage" stroke-width="${upp}"/>`;
      pts.map(V).forEach(([x, y], i) => {
        s += `<circle cx="${x}" cy="${y}" r="${(i === 0 ? 5.5 : 4) * upp}" class="ov-vertex${i === 0 ? ' first' : ''}" stroke-width="${1.5 * upp}"/>`;
      });
      return s;
    },
  };
}
