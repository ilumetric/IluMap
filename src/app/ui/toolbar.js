// Floating toolbars on the canvas.
// Left (vertically centred): stacked round pills
//   [Layers panel] · [Select, Pan] · [Line, Polygon, Wall, Bridge, POI] · [Measure, Calibrate, Delete]
// The active tool is a filled accent circle; draw tools carry a small
// underline in the colour of the layer they will draw into.
// The view toggles (grid, labels, background) live in the top pill (chrome.js).

import { store, on, emit, change } from '../state.js';
import { resolveStyle } from '../../core/styles.js';
import { fitPairs } from '../../core/calibration.js';
import { h, clear } from '../dom.js';
import { icon } from './icons.js';
import { openPopover, closeMenu } from './menu.js';
import { layerColor, chromeTint, layerLabel } from './layer-meta.js';
import { t, onLangChange } from '../i18n/index.js';
import { targetLayer } from '../tools/draw-common.js';
import { pickBackgroundImage } from '../io.js';
import { chooseBackgroundFromFolder, allowFolderAccess } from '../session.js';

const GROUPS = [
  ['select', 'pan'],
  ['line', 'polygon', 'wall', 'bridge', 'poi'],
  ['measure', 'calibrate', '$delete'],
];

/** Layer a draw tool will put its next feature into. */
function toolLayer(id) {
  if (id === 'line') return targetLayer('line', false);
  if (id === 'polygon') return targetLayer('polygon', false);
  if (id === 'wall') return 'walls';
  if (id === 'bridge') return 'bridges';
  if (id === 'poi') return 'pois';
  return null;
}

export function mountToolbar({ tools, activateTool, deleteSelection, panels }) {
  const root = document.getElementById('toolbar');
  const buttons = new Map();

  const layersBtn = h('button', {
    type: 'button', class: 'tb-btn', 'aria-pressed': 'false',
    onclick: () => panels.layers.toggle(),
  }, icon('layers'));
  root.append(h('div', { class: 'tb-group' }, layersBtn));

  for (const group of GROUPS) {
    const g = h('div', { class: 'tb-group', role: 'group' });
    for (const id of group) {
      if (id === '$delete') {
        const del = h('button', { type: 'button', class: 'tb-btn', onclick: () => deleteSelection() }, icon('trash'));
        buttons.set('$delete', del);
        g.append(del);
        continue;
      }
      const tool = tools[id];
      const b = h('button', {
        type: 'button', class: 'tb-btn', 'data-tool': id, 'aria-pressed': 'false',
        onclick: () => activateTool(id),
      }, icon(tool.icon), toolLayer(id) ? h('span', { class: 'tb-underline' }) : null);
      buttons.set(id, b);
      g.append(b);
    }
    root.append(g);
  }

  function update() {
    const rs = resolveStyle(store.doc.style);
    root.setAttribute('aria-label', t('toolbar.tools'));
    layersBtn.title = t('toolbar.layersPanel');
    layersBtn.setAttribute('aria-label', t('panels.layers.title'));
    for (const [id, b] of buttons) {
      if (id === '$delete') {
        b.disabled = !store.selection.size;
        b.title = t('toolbar.deleteSelection');
        b.setAttribute('aria-label', t('toolbar.deleteSelectionAria'));
        continue;
      }
      const tool = tools[id];
      b.setAttribute('aria-label', tool.label);
      b.title = id === 'pan' ? t('toolbar.panTitle', { label: tool.label, key: tool.key }) : `${tool.label} (${tool.key})`;
      const active = store.tool === id;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
      const l = toolLayer(id);
      const u = b.querySelector('.tb-underline');
      if (u && l) {
        u.style.background = chromeTint(layerColor(l, rs)).ring;
        b.title = t('toolbar.drawsInto', { label: tool.label, key: tool.key, layer: layerLabel(l) });
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
  onLangChange(update);
  update();
}

/** Background image popover (load, opacity, calibrate, fit, replace, remove). */
export function openBackgroundPopover(anchor, { side = 'bottom', align = 'center' } = {}) {
  const body = h('div', { class: 'bg-pop' });
  // maps opened through "Open folder" can take an image from that folder (stored as a relative path)
  const folderButton = () => (store.file.dir
    ? h('button', { type: 'button', class: 'btn btn-small', title: t('background.fromFolderTitle'), onclick: () => { closeMenu(); chooseBackgroundFromFolder(); } }, icon('folderOpen'), t('background.fromFolder'))
    : null);
  const render = () => {
    clear(body);
    const doc = store.doc;
    const b = doc.view.background;
    const st = store.background;
    body.append(h('div', { class: 'pop-title' }, t('background.title')));
    if (!b) {
      body.append(
        h('p', { class: 'muted small' }, t('background.emptyHint')),
        h('div', { class: 'pop-actions' },
          h('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: () => { closeMenu(); pickBackgroundImage(); } }, icon('image'), t('background.load')),
          folderButton()));
      return;
    }
    const op = h('input', { type: 'range', name: 'bg-opacity', min: 0, max: 1, step: 0.05, value: b.opacity ?? 0.6, 'aria-label': t('background.opacity') });
    const pct = h('span', { class: 'muted small mono' }, `${Math.round((b.opacity ?? 0.6) * 100)}%`);
    op.addEventListener('input', () => { store.doc.view.background.opacity = Number(op.value); pct.textContent = `${Math.round(op.value * 100)}%`; emit('background'); });
    op.addEventListener('change', () => {
      const v = Number(op.value);
      store.doc.view.background.opacity = b.opacity ?? 0.6;
      change((d) => { d.view.background.opacity = v; });
      emit('background');
    });
    body.append(
      h('div', { class: 'bg-name', title: b.src }, h('span', { class: 'mono small' }, b.src), h('span', { class: 'muted small' }, st?.url ? t('background.size', { w: String(st.width), h: String(st.height) }) : t('background.notLoadedShort'))),
      h('label', { class: 'bg-opacity' }, h('span', { class: 'muted small' }, t('background.opacity')), op, pct),
      h('div', { class: 'pop-actions' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { closeMenu(); emit('set-tool', 'calibrate'); } }, icon('calibrate'), t('background.calibrate')),
        h('button', {
          type: 'button', class: 'btn btn-small', disabled: !st?.url, title: t('background.fitTitle'),
          onclick: () => { change((d) => { d.view.background.calibration = fitPairs(d.view.bounds, st.width, st.height, !!d.meta.flipY); }); render(); },
        }, icon('fit'), t('background.fit')),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { closeMenu(); pickBackgroundImage(); } }, t('background.replace')),
        folderButton(),
        st?.url || !store.file.dir ? null : h('button', { type: 'button', class: 'btn btn-small', title: t('background.allowFolderTitle'), onclick: () => { closeMenu(); allowFolderAccess(); } }, icon('folderOpen'), t('background.allowFolder')),
        h('button', {
          type: 'button', class: 'btn btn-small btn-danger',
          onclick: () => { change((d) => { delete d.view.background; }); store.background = null; emit('background'); render(); },
        }, icon('trash'), t('background.remove'))));
  };
  render();
  openPopover(body, { anchor, side, align });
}
