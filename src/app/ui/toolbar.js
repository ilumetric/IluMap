// Floating toolbars on the canvas.
// Left (vertically centred): stacked round pills
//   [Layers panel] · [Select, Pan] · [Line, Polygon, Wall, POI] · [Measure, Calibrate, Delete]
// The active tool is a filled accent circle; draw tools carry a small
// underline in the colour of the layer they will draw into.
// Right (vertically centred): grid, labels, background image, fit, shortcuts.

import { store, on, emit, change, savePrefs, layerPrefs, isLayerVisible } from '../state.js';
import { resolveStyle } from '../../core/styles.js';
import { fitPairs } from '../../core/calibration.js';
import { h, clear } from '../dom.js';
import { icon } from './icons.js';
import { openPopover, closeMenu } from './menu.js';
import { layerColor, chromeTint, LABELS } from './layer-meta.js';
import { targetLayer } from '../tools/draw-common.js';
import { pickBackgroundImage } from '../io.js';

const GROUPS = [
  ['select', 'pan'],
  ['line', 'polygon', 'wall', 'poi'],
  ['measure', 'calibrate', '$delete'],
];

/** Layer a draw tool will put its next feature into. */
function toolLayer(id) {
  if (id === 'line') return targetLayer('line', false);
  if (id === 'polygon') return targetLayer('polygon', false);
  if (id === 'wall') return 'walls';
  if (id === 'poi') return 'pois';
  return null;
}

export function mountToolbar({ tools, activateTool, deleteSelection, panels }) {
  const root = document.getElementById('toolbar');
  const buttons = new Map();

  const layersBtn = h('button', {
    type: 'button', class: 'tb-btn', title: 'Layers panel ([)', 'aria-label': 'Layers panel', 'aria-pressed': 'false',
    onclick: () => panels.layers.toggle(),
  }, icon('layers'));
  root.append(h('div', { class: 'tb-group' }, layersBtn));

  for (const group of GROUPS) {
    const g = h('div', { class: 'tb-group', role: 'group' });
    for (const id of group) {
      if (id === '$delete') {
        const del = h('button', { type: 'button', class: 'tb-btn', title: 'Delete selection (Del)', 'aria-label': 'Delete selection', onclick: () => deleteSelection() }, icon('trash'));
        buttons.set('$delete', del);
        g.append(del);
        continue;
      }
      const t = tools[id];
      const b = h('button', {
        type: 'button', class: 'tb-btn', 'data-tool': id, 'aria-label': t.label, 'aria-pressed': 'false',
        title: `${t.label} (${t.key}${id === 'pan' ? ' / hold Space' : ''})`,
        onclick: () => activateTool(id),
      }, icon(t.icon), toolLayer(id) ? h('span', { class: 'tb-underline' }) : null);
      buttons.set(id, b);
      g.append(b);
    }
    root.append(g);
  }

  function update() {
    const rs = resolveStyle(store.doc.style);
    for (const [id, b] of buttons) {
      if (id === '$delete') { b.disabled = !store.selection.size; continue; }
      const active = store.tool === id;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
      const l = toolLayer(id);
      const u = b.querySelector('.tb-underline');
      if (u && l) {
        u.style.background = chromeTint(layerColor(l, rs)).ring;
        b.title = `${tools[id].label} (${tools[id].key}) — draws into ${LABELS[l]}`;
      }
    }
    const lp = panels.layers.isOpen();
    layersBtn.classList.toggle('on', lp);
    layersBtn.setAttribute('aria-pressed', String(lp));
  }

  on('tool', update);
  on('layers', update);
  on('selection', update);
  on('new-type', update);
  on('panels', update);
  on('theme', update);
  on('doc', (d) => { if (!d?.live) update(); });
  update();
}

export function mountViewTools({ canvas, showHelp }) {
  const root = document.getElementById('view-tools');
  const btn = (ico, label, onclick) => h('button', { type: 'button', class: 'tb-btn', title: label, 'aria-label': label, onclick }, icon(ico));

  const grid = btn('grid', 'Toggle grid (G)', () => change((d) => { d.view.grid.visible = !(d.view.grid.visible !== false); }));
  const labels = btn('labels', 'Toggle labels', () => {
    const p = layerPrefs('labels');
    p.visible = !p.visible;
    savePrefs();
    emit('layers');
  });
  const bg = btn('image', 'Background image', () => backgroundPopover(bg));
  const fit = btn('fit', 'Fit to bounds (F)', () => canvas.fit());
  const keys = btn('keyboard', 'Keyboard shortcuts (?)', () => showHelp());
  root.append(h('div', { class: 'tb-group' }, grid, labels, bg), h('div', { class: 'tb-group' }, fit, keys));

  function update() {
    const g = store.doc.view.grid?.visible !== false;
    grid.classList.toggle('on', g);
    grid.setAttribute('aria-pressed', String(g));
    const l = isLayerVisible('labels');
    labels.classList.toggle('on', l);
    labels.setAttribute('aria-pressed', String(l));
    bg.classList.toggle('on', !!store.background?.url);
  }
  on('doc', (d) => { if (!d?.live) update(); });
  on('layers', update);
  on('background', update);
  update();

  function backgroundPopover(anchor) {
    const body = h('div', { class: 'bg-pop' });
    const render = () => {
      clear(body);
      const doc = store.doc;
      const b = doc.view.background;
      const st = store.background;
      body.append(h('div', { class: 'pop-title' }, 'Background image'));
      if (!b) {
        body.append(
          h('p', { class: 'muted small' }, 'A sketch or heightmap under the map, calibrated to world units. Drop a PNG/JPG onto the canvas, or pick one. It is kept with this map in the browser.'),
          h('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: () => { closeMenu(); pickBackgroundImage(); } }, icon('image'), 'Load image…'));
        return;
      }
      const op = h('input', { type: 'range', name: 'bg-opacity', min: 0, max: 1, step: 0.05, value: b.opacity ?? 0.6, 'aria-label': 'Opacity' });
      const pct = h('span', { class: 'muted small mono' }, `${Math.round((b.opacity ?? 0.6) * 100)}%`);
      op.addEventListener('input', () => { store.doc.view.background.opacity = Number(op.value); pct.textContent = `${Math.round(op.value * 100)}%`; emit('background'); });
      op.addEventListener('change', () => {
        const v = Number(op.value);
        store.doc.view.background.opacity = b.opacity ?? 0.6;
        change((d) => { d.view.background.opacity = v; });
        emit('background');
      });
      body.append(
        h('div', { class: 'bg-name', title: b.src }, h('span', { class: 'mono small' }, b.src), h('span', { class: 'muted small' }, st?.url ? `${st.width}×${st.height}px` : 'not loaded — drop the image')),
        h('label', { class: 'bg-opacity' }, h('span', { class: 'muted small' }, 'Opacity'), op, pct),
        h('div', { class: 'pop-actions' },
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { closeMenu(); emit('set-tool', 'calibrate'); } }, icon('calibrate'), 'Calibrate'),
          h('button', {
            type: 'button', class: 'btn btn-small', disabled: !st?.url, title: 'Stretch the image across the bounds again',
            onclick: () => { change((d) => { d.view.background.calibration = fitPairs(d.view.bounds, st.width, st.height, !!d.meta.flipY); }); render(); },
          }, icon('fit'), 'Fit'),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => { closeMenu(); pickBackgroundImage(); } }, 'Replace…'),
          h('button', {
            type: 'button', class: 'btn btn-small btn-danger',
            onclick: () => { change((d) => { delete d.view.background; }); store.background = null; emit('background'); render(); },
          }, icon('trash'), 'Remove')));
    };
    render();
    openPopover(body, { anchor, side: 'left' });
  }
}
