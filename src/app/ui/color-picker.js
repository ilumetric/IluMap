// Colour picker with a colour wheel (in the spirit of Unreal's picker) for every
// <input type="color"> in the app.
//
// The native input stays where it is (it is the swatch the user clicks, and it
// holds the value the rest of the code reads); a capture-phase click listener
// stops the OS picker and opens this popover instead:
//   wheel (hue = angle, saturation = distance from the centre) · value slider
//   · old / new swatches (click "old" to revert) · R G B and H S V sliders with
//   number fields · hex field · eyedropper (when the browser has one) · recent colours.
// Dragging updates the input and fires `input`; releasing (or editing a field)
// fires `change`, which the panels turn into one undo step.
// Add `data-native` to an <input type="color"> to keep the browser picker.

import { h } from '../dom.js';
import { icon } from './icons.js';
import { openPopover } from './menu.js';
import { t } from '../i18n/index.js';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, clamp } from '../../core/color.js';

const WHEEL = 176; // CSS px
const RECENT_KEY = 'ilumap.recentColors';
const RECENT_MAX = 14;

function loadRecent() {
  try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a.filter((c) => hexToRgb(c)) : []; } catch { return []; }
}
function pushRecent(hex) {
  const list = [hex, ...loadRecent().filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage disabled */ }
}

// --- picker ---------------------------------------------------------------------

export function openColorPicker(input) {
  const original = /^#[0-9a-f]{6}$/i.test(input.value) ? input.value.toLowerCase() : '#888888';
  let hsv = rgbToHsv(hexToRgb(original));
  let committed = original;

  // wheel + value slider
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const wheel = h('canvas', { class: 'cp-wheel', width: WHEEL * dpr, height: WHEEL * dpr, style: { width: `${WHEEL}px`, height: `${WHEEL}px` }, 'aria-label': t('color.wheel'), role: 'slider' });
  const wheelDot = h('span', { class: 'cp-dot' });
  const wheelBox = h('div', { class: 'cp-wheel-box' }, wheel, wheelDot);
  const valTrack = h('div', { class: 'cp-vtrack', role: 'slider', 'aria-label': t('color.value'), tabindex: '0' }, h('span', { class: 'cp-vthumb' }));

  // swatches
  const oldSw = h('button', { type: 'button', class: 'cp-sw cp-old', title: t('color.oldTitle'), style: { background: original } });
  const newSw = h('span', { class: 'cp-sw cp-new' });
  const swatches = h('div', { class: 'cp-swatches' },
    h('div', { class: 'cp-sw-col' }, h('span', { class: 'cp-sw-label' }, t('color.old')), oldSw),
    h('div', { class: 'cp-sw-col' }, h('span', { class: 'cp-sw-label' }, t('color.new')), newSw));

  // sliders
  const rows = [];
  const slider = (key, max, labelKey) => {
    const range = h('input', { type: 'range', min: 0, max, step: 1, class: 'cp-range', 'aria-label': t(labelKey) });
    const num = h('input', { type: 'number', min: 0, max, step: 1, class: 'cp-num', 'aria-label': t(labelKey) });
    const row = h('div', { class: 'cp-row' }, h('span', { class: 'cp-key' }, key), range, num);
    rows.push({ key, range, num, max });
    return row;
  };
  const rgbBox = h('div', { class: 'cp-rows' }, slider('R', 255, 'color.red'), slider('G', 255, 'color.green'), slider('B', 255, 'color.blue'));
  const hsvBox = h('div', { class: 'cp-rows' }, slider('H', 360, 'color.hue'), slider('S', 100, 'color.saturation'), slider('V', 100, 'color.value'));

  // hex, eyedropper
  const hex = h('input', { type: 'text', class: 'cp-hex mono', maxlength: 7, spellcheck: 'false', autocomplete: 'off', 'aria-label': t('color.hex') });
  const dropper = 'EyeDropper' in window
    ? h('button', { type: 'button', class: 'icon-btn cp-dropper', title: t('color.eyedropper'), 'aria-label': t('color.eyedropper') }, icon('pipette'))
    : null;
  const recentBox = h('div', { class: 'cp-recent' });

  const body = h('div', { class: 'cp' },
    h('div', { class: 'cp-top' }, wheelBox, valTrack, swatches),
    h('div', { class: 'cp-sliders' }, rgbBox, hsvBox),
    h('div', { class: 'cp-hexrow' }, h('span', { class: 'cp-key' }, t('color.hex')), hex, dropper),
    h('div', { class: 'cp-recent-wrap' }, h('span', { class: 'cp-sw-label' }, t('color.recent')), recentBox));

  // --- drawing -------------------------------------------------------------------
  let drawnV = -1;
  function drawWheel() {
    if (drawnV === hsv[2]) return;
    drawnV = hsv[2];
    const ctx = wheel.getContext('2d');
    const n = wheel.width;
    const img = ctx.createImageData(n, n);
    const c = n / 2;
    const R = c - 1;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x - c + 0.5; const dy = y - c + 0.5;
        const d = Math.hypot(dx, dy);
        const i = (y * n + x) * 4;
        if (d > R + 1) continue;
        const hue = (Math.atan2(-dy, dx) * 180) / Math.PI;
        const [r, g, b] = hsvToRgb([(hue + 360) % 360, Math.min(1, d / R), hsv[2]]);
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
        img.data[i + 3] = d > R ? Math.round(255 * (R + 1 - d)) : 255; // soft edge
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  const hexNow = () => rgbToHex(hsvToRgb(hsv));

  function refresh(skip = null) {
    drawWheel();
    const rgb = hsvToRgb(hsv).map(Math.round);
    const cur = rgbToHex(rgb);
    const ang = (hsv[0] * Math.PI) / 180;
    const rad = hsv[1] * (WHEEL / 2 - 1);
    wheelDot.style.left = `${WHEEL / 2 + Math.cos(ang) * rad}px`;
    wheelDot.style.top = `${WHEEL / 2 - Math.sin(ang) * rad}px`;
    wheelDot.style.background = cur;
    const full = rgbToHex(hsvToRgb([hsv[0], hsv[1], 1]));
    valTrack.style.setProperty('--cp-top', full);
    valTrack.querySelector('.cp-vthumb').style.top = `${(1 - hsv[2]) * 100}%`;
    valTrack.setAttribute('aria-valuenow', String(Math.round(hsv[2] * 100)));
    newSw.style.background = cur;
    const vals = { R: rgb[0], G: rgb[1], B: rgb[2], H: Math.round(hsv[0]), S: Math.round(hsv[1] * 100), V: Math.round(hsv[2] * 100) };
    const grads = {
      R: `linear-gradient(90deg, ${rgbToHex([0, rgb[1], rgb[2]])}, ${rgbToHex([255, rgb[1], rgb[2]])})`,
      G: `linear-gradient(90deg, ${rgbToHex([rgb[0], 0, rgb[2]])}, ${rgbToHex([rgb[0], 255, rgb[2]])})`,
      B: `linear-gradient(90deg, ${rgbToHex([rgb[0], rgb[1], 0])}, ${rgbToHex([rgb[0], rgb[1], 255])})`,
      H: `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((d) => rgbToHex(hsvToRgb([d % 360, Math.max(0.35, hsv[1]), Math.max(0.5, hsv[2])]))).join(', ')})`,
      S: `linear-gradient(90deg, ${rgbToHex(hsvToRgb([hsv[0], 0, hsv[2]]))}, ${rgbToHex(hsvToRgb([hsv[0], 1, hsv[2]]))})`,
      V: `linear-gradient(90deg, #000000, ${full})`,
    };
    for (const r of rows) {
      if (r.range !== skip) r.range.value = vals[r.key];
      if (r.num !== skip) r.num.value = vals[r.key];
      r.range.style.setProperty('--cp-track', grads[r.key]);
    }
    if (hex !== skip) hex.value = cur;
  }

  function renderRecent() {
    recentBox.replaceChildren(...loadRecent().map((c) => h('button', {
      type: 'button', class: 'cp-rsw', title: c, 'aria-label': c, style: { background: c },
      onclick: () => { hsv = rgbToHsv(hexToRgb(c)); refresh(); live(); commit(); },
    })));
    recentBox.parentElement.hidden = !recentBox.children.length;
  }

  // --- output --------------------------------------------------------------------
  function live() {
    const v = hexNow();
    if (input.value.toLowerCase() === v) return;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function commit() {
    const v = hexNow();
    input.value = v;
    if (v === committed) return;
    committed = v;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    pushRecent(v);
    renderRecent();
  }

  // --- interaction ---------------------------------------------------------------
  function drag(el, onMove) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      const move = (ev) => { onMove(ev); refresh(); live(); };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        commit();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      move(e);
    });
  }
  drag(wheel, (e) => {
    const r = wheel.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2;
    const dy = e.clientY - r.top - r.height / 2;
    hsv = [((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360, Math.min(1, Math.hypot(dx, dy) / (r.width / 2 - 1)), hsv[2]];
  });
  drag(valTrack, (e) => {
    const r = valTrack.getBoundingClientRect();
    hsv = [hsv[0], hsv[1], clamp(1 - (e.clientY - r.top) / r.height, 0, 1)];
  });
  valTrack.addEventListener('keydown', (e) => {
    const step = { ArrowUp: 0.02, ArrowDown: -0.02, PageUp: 0.1, PageDown: -0.1 }[e.key];
    if (!step) return;
    e.preventDefault();
    hsv = [hsv[0], hsv[1], clamp(hsv[2] + step, 0, 1)];
    refresh(); live(); commit();
  });

  const fromRow = (key, val) => {
    const rgb = hsvToRgb(hsv).map(Math.round);
    if (key === 'R' || key === 'G' || key === 'B') {
      rgb['RGB'.indexOf(key)] = clamp(val, 0, 255);
      const next = rgbToHsv(rgb);
      // keep the hue / saturation when the colour becomes grey or black
      hsv = [next[1] ? next[0] : hsv[0], next[2] ? next[1] : hsv[1], next[2]];
    } else if (key === 'H') hsv = [clamp(val, 0, 360) % 360, hsv[1], hsv[2]];
    else if (key === 'S') hsv = [hsv[0], clamp(val, 0, 100) / 100, hsv[2]];
    else hsv = [hsv[0], hsv[1], clamp(val, 0, 100) / 100];
  };
  for (const r of rows) {
    r.range.addEventListener('input', () => { fromRow(r.key, Number(r.range.value)); refresh(r.range); live(); });
    r.range.addEventListener('change', commit);
    r.num.addEventListener('change', () => { if (r.num.value === '') return; fromRow(r.key, Number(r.num.value)); refresh(); live(); commit(); });
    r.num.addEventListener('keydown', (e) => { if (e.key === 'Enter') r.num.blur(); });
  }
  hex.addEventListener('input', () => {
    const rgb = hexToRgb(hex.value);
    if (rgb && hex.value.replace('#', '').length === 6) { hsv = rgbToHsv(rgb); refresh(hex); live(); }
  });
  hex.addEventListener('change', () => { const rgb = hexToRgb(hex.value); if (rgb) { hsv = rgbToHsv(rgb); refresh(); live(); commit(); } else refresh(); });
  hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') hex.blur(); });
  oldSw.addEventListener('click', () => { hsv = rgbToHsv(hexToRgb(original)); refresh(); live(); commit(); });
  dropper?.addEventListener('click', async () => {
    try {
      const res = await new window.EyeDropper().open();
      const rgb = hexToRgb(res.sRGBHex);
      if (rgb) { hsv = rgbToHsv(rgb); refresh(); live(); commit(); }
    } catch { /* cancelled */ }
  });

  refresh();
  renderRecent();
  openPopover(body, {
    anchor: input, side: 'bottom', align: 'start', toggle: false, className: 'cp-pop',
    onClose: () => commit(),
  });
  hex.focus({ preventScroll: true });
  hex.select();
}

/** Replace the browser's colour dialog with openColorPicker for every <input type="color">. */
export function installColorPicker() {
  document.addEventListener('click', (e) => {
    const input = e.target?.closest?.('input[type="color"]');
    if (!input || 'native' in input.dataset || input.disabled) return;
    e.preventDefault();
    openColorPicker(input);
  }, true);
}
