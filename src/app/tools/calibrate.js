// Calibrate tool: click 2 points on the background image and enter their
// world coordinates. Stored as view.background.calibration (2 pairs px -> world).
import { store, change, emit } from '../state.js';
import { fromPairs, worldToPx, pxToWorld } from '../../core/calibration.js';
import { toView } from '../../core/render-svg.js';
import { openDialog, toast } from '../dom.js';

let picked = []; // [{px, world}]
let busy = false;

function currentT() {
  const bg = store.doc.view.background;
  if (!bg?.calibration) return null;
  try { return fromPairs(bg.calibration, { reflect: !!store.doc.meta.flipY }); } catch { return null; }
}

export default {
  id: 'calibrate',
  label: 'Calibrate background',
  key: 'K',
  icon: 'calibrate',
  hint: () => (store.background?.url
    ? `Calibrate: click a known point on the image (${picked.length + 1} of 2), then type its world coordinates · Esc cancels`
    : 'Calibrate: load a background image first (drop an image onto the canvas or Map → Background)'),
  activate() {
    picked = [];
    if (!store.background?.url) toast('No background image loaded — drop an image onto the canvas first.', { type: 'warn' });
  },
  deactivate() { picked = []; },
  async down(ctx) {
    if (busy || !store.background?.url) return;
    const T = currentT();
    if (!T) return;
    const px = worldToPx(T, ctx.world).map((v) => Math.round(v * 10) / 10);
    busy = true;
    const guess = ctx.world.map(Math.round);
    const res = await openDialog({
      title: `Calibration point ${picked.length + 1} of 2`,
      message: `Image pixel (${px[0]}, ${px[1]}). Enter the world coordinates (${store.doc.meta.units}) this pixel should map to.`,
      fields: [
        { name: 'x', label: 'World X', type: 'number', value: guess[0], step: 'any' },
        { name: 'y', label: 'World Y', type: 'number', value: guess[1], step: 'any' },
      ],
      okText: picked.length ? 'Apply calibration' : 'Next point',
    });
    busy = false;
    if (!res || res.x == null || res.y == null) return;
    picked.push({ px, world: [res.x, res.y] });
    ctx.canvas.invalidate('tool');
    emit('hud');
    if (picked.length === 2) {
      try {
        fromPairs(picked, { reflect: !!store.doc.meta.flipY });
      } catch (e) {
        toast(`Calibration failed: ${e.message}`, { type: 'error' });
        picked = [];
        return;
      }
      const pairs = picked;
      picked = [];
      change((doc) => { doc.view.background.calibration = pairs; });
      emit('background');
      toast('Background calibrated.', { type: 'ok' });
      emit('set-tool', 'select');
    }
  },
  onKey(e, canvas) {
    if (e.key === 'Escape' && picked.length) { picked = []; canvas.invalidate('tool'); return true; }
    return false;
  },
  overlay(canvas) {
    const T = currentT();
    if (!T || !picked.length) return '';
    const upp = canvas.unitsPerPx;
    return picked.map((p, i) => {
      const [x, y] = toView(store.doc, pxToWorld(T, p.px));
      return `<g class="ov-calib"><circle cx="${x}" cy="${y}" r="${7 * upp}" stroke-width="${2 * upp}"/><text transform="translate(${x + 10 * upp} ${y - 8 * upp}) scale(${upp})" font-size="12" stroke-width="3">${i + 1}</text></g>`;
    }).join('');
  },
};
