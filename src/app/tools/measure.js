// Measure tool: click points; shows each segment and the total in display units.
// Double-click / Enter ends a measurement (the next click starts a new one), Esc clears.
import { store, emit } from '../state.js';
import { toView, esc } from '../../core/render-svg.js';
import { distance, bearing, compass8, polylineLength } from '../../core/geometry.js';
import { formatLength } from '../../core/text-export.js';

let pts = [];
let hover = null;
let done = false;

function all() {
  return !done && hover && pts.length ? [...pts, hover] : pts;
}

export default {
  id: 'measure',
  label: 'Measure',
  key: 'M',
  icon: 'measure',
  hint: () => 'Click points to measure · double-click or Enter ends · Esc clears · Shift snaps',
  deactivate() { pts = []; hover = null; done = false; },
  down(ctx) {
    const p = ctx.shift ? ctx.canvas.snap(ctx.world) : ctx.world;
    if (done) { pts = []; done = false; }
    if (ctx.clicks >= 2 && pts.length >= 2) { done = true; }
    else pts.push(p);
    ctx.canvas.invalidate('tool');
    emit('hud');
  },
  move(ctx) {
    hover = ctx.shift ? ctx.canvas.snap(ctx.world) : ctx.world;
    if (pts.length && !done) { ctx.canvas.invalidate('tool'); emit('hud'); }
  },
  onKey(e, canvas) {
    if (e.key === 'Enter' && pts.length) { done = true; canvas.invalidate('tool'); emit('hud'); return true; }
    if (e.key === 'Escape' && pts.length) { pts = []; done = false; canvas.invalidate('tool'); emit('hud'); return true; }
    if (e.key === 'Backspace' && pts.length && !done) { pts.pop(); canvas.invalidate('tool'); emit('hud'); return true; }
    return false;
  },
  status() {
    const a = all();
    if (a.length < 2) return pts.length ? 'Click the next point' : '';
    const meta = store.doc.meta;
    const last = distance(a[a.length - 2], a[a.length - 1]);
    const dir = compass8(bearing(a[a.length - 2], a[a.length - 1], !!meta.flipY));
    return `Segment ${formatLength(last, meta)} ${dir} · Total ${formatLength(polylineLength(a), meta)}`;
  },
  overlay(canvas) {
    const a = all();
    if (!a.length) return '';
    const upp = canvas.unitsPerPx;
    const meta = store.doc.meta;
    const V = a.map((p) => toView(store.doc, p));
    let s = `<polyline points="${V.map((p) => p.join(',')).join(' ')}" class="ov-measure" stroke-width="${2 * upp}" stroke-dasharray="${6 * upp} ${4 * upp}"/>`;
    for (const [x, y] of V) s += `<circle cx="${x}" cy="${y}" r="${3.5 * upp}" class="ov-measure-pt"/>`;
    const label = (x, y, text, strong) => `<text transform="translate(${x} ${y}) scale(${upp})" font-size="${strong ? 12 : 11}" class="ov-measure-label${strong ? ' strong' : ''}" stroke-width="3" text-anchor="middle">${esc(text)}</text>`;
    for (let i = 0; i < V.length - 1; i++) {
      const mx = (V[i][0] + V[i + 1][0]) / 2;
      const my = (V[i][1] + V[i + 1][1]) / 2 - 8 * upp;
      s += label(mx, my, formatLength(distance(a[i], a[i + 1]), meta), false);
    }
    if (a.length > 2 || done) {
      const [x, y] = V[V.length - 1];
      s += label(x, y + 20 * upp, `Σ ${formatLength(polylineLength(a), meta)}`, true);
    }
    return s;
  },
};
