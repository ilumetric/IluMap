// Calibrate tool: click 2 points on the background image and enter their
// world coordinates. Stored as view.background.calibration (2 pairs px -> world).
import { store, change, emit } from '../state.js';
import { fromPairs, worldToPx, pxToWorld } from '../../core/calibration.js';
import { toView } from '../../core/render-svg.js';
import { openDialog, toast } from '../dom.js';
import { t } from '../i18n/index.js';
import { unitLabel } from '../i18n/format.js';

let picked = []; // [{px, world}]
let busy = false;

function currentT() {
  const bg = store.doc.view.background;
  if (!bg?.calibration) return null;
  try { return fromPairs(bg.calibration, { reflect: !!store.doc.meta.flipY }); } catch { return null; }
}

export default {
  id: 'calibrate',
  get label() { return t('tools.calibrate'); },
  key: 'K',
  icon: 'calibrate',
  hint: () => (store.background?.url
    ? t('tools.calibrateHint', { i: picked.length + 1 })
    : t('tools.calibrateNoImage')),
  activate() {
    picked = [];
    if (!store.background?.url) toast(t('toast.noBackground'), { type: 'warn' });
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
      title: t('dialogs.calibrate.title', { i: picked.length + 1 }),
      message: t('dialogs.calibrate.message', { u: String(px[0]), v: String(px[1]), units: unitLabel(store.doc.meta.units) }),
      fields: [
        { name: 'x', label: t('dialogs.calibrate.worldX'), type: 'number', value: guess[0], step: 'any' },
        { name: 'y', label: t('dialogs.calibrate.worldY'), type: 'number', value: guess[1], step: 'any' },
      ],
      okText: picked.length ? t('dialogs.calibrate.apply') : t('dialogs.calibrate.next'),
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
        toast(t('toast.calibrationFailed', { error: e.message }), { type: 'error' });
        picked = [];
        return;
      }
      const pairs = picked;
      picked = [];
      change((doc) => { doc.view.background.calibration = pairs; });
      emit('background');
      toast(t('toast.calibrated'), { type: 'ok' });
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
