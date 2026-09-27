// Layers panel: visibility, lock, colour swatch, opacity, active layer, feature list.

import { store, on, emit, change, select, setActiveLayer, layerPrefs, savePrefs, PSEUDO_LAYERS } from '../state.js';
import { LAYER_KIND, DRAW_ORDER } from '../../core/schema.js';
import { resolveStyle } from '../../core/styles.js';
import { centroid } from '../../core/geometry.js';
import { h, clear, icon, renderKeepingFocus } from '../dom.js';

const LABELS = {
  land: 'Land', water: 'Water', coast: 'Coast', rivers: 'Rivers', roads: 'Roads', rails: 'Rails', walls: 'Walls', zones: 'Zones', pois: 'POIs', labels: 'Labels',
};

export function mountLayers(root, { canvas }) {
  const body = h('div', { class: 'layer-list' });
  root.append(h('div', { class: 'panel-head' }, h('h3', {}, 'Layers'), h('span', { class: 'muted small' }, 'active = drawing target')), body);

  const swatchKey = (l) => (l === 'land' || l === 'water' ? 'fill' : 'stroke');

  function row(layer, rs) {
    const pseudo = PSEUDO_LAYERS.includes(layer);
    const prefs = layerPrefs(layer);
    const active = store.activeLayer === layer;
    const count = pseudo ? (layer === 'pois' ? store.doc.pois.length : '') : store.doc.layers[layer].length;
    const expanded = !!store.prefs.expanded[layer];
    const st = rs.layers[layer] || {};

    const eye = h('button', {
      class: `icon-btn${prefs.visible ? '' : ' off'}`, title: prefs.visible ? 'Hide layer' : 'Show layer',
      onclick: (e) => { e.stopPropagation(); prefs.visible = !prefs.visible; savePrefs(); emit('layers'); render(); },
    }, icon(prefs.visible ? 'eye' : 'eyeOff'));
    const lock = h('button', {
      class: `icon-btn${prefs.locked ? ' on' : ' dim'}`, title: prefs.locked ? 'Unlock layer' : 'Lock layer (no selection or editing)',
      onclick: (e) => { e.stopPropagation(); prefs.locked = !prefs.locked; savePrefs(); emit('layers'); render(); },
    }, icon(prefs.locked ? 'lock' : 'unlock'));

    let swatch = h('span', { class: 'swatch-spacer' });
    if (!pseudo && layer !== 'zones') {
      const k = swatchKey(layer);
      swatch = h('input', {
        type: 'color', class: 'swatch', name: `layer-color-${layer}`, value: st[k] || '#888888', title: `${LABELS[layer]} ${k} colour`,
        onclick: (e) => e.stopPropagation(),
        onchange: (e) => change((doc) => {
          doc.style.layers ||= {};
          doc.style.layers[layer] = { ...(doc.style.layers[layer] || {}), [k]: e.target.value };
        }),
      });
    } else if (layer === 'zones') {
      swatch = h('span', { class: 'swatch swatch-multi', title: 'Zone colours are per type (Style tab)' });
    }

    const head = h('div', {
      class: `layer-row${active ? ' active' : ''}${pseudo ? ' pseudo' : ''}${prefs.visible ? '' : ' hidden-layer'}`,
      title: pseudo ? '' : `${LAYER_KIND[layer]} layer — click to make it the drawing target`,
      onclick: () => { if (!pseudo) setActiveLayer(layer); },
    },
    h('button', {
      class: `icon-btn chev${expanded ? ' open' : ''}`, title: 'Show features / opacity',
      onclick: (e) => { e.stopPropagation(); store.prefs.expanded[layer] = !expanded; savePrefs(); render(); },
    }, icon('chevron')),
    eye, lock, swatch,
    h('span', { class: 'layer-name' }, LABELS[layer], !pseudo ? h('small', { class: 'kind' }, LAYER_KIND[layer] === 'line' ? '╱' : '▰') : null),
    h('span', { class: 'count' }, String(count)));

    const wrap = h('div', { class: 'layer' }, head);
    if (expanded) {
      const extra = h('div', { class: 'layer-extra' });
      if (!pseudo) {
        const op = layer === 'zones' ? (st.opacity ?? 0.35) : (st.opacity ?? 1);
        extra.append(h('label', { class: 'opacity' }, h('span', {}, layer === 'zones' ? 'Fill' : 'Opacity'),
          h('input', {
            type: 'range', min: 0, max: 1, step: 0.05, value: op, name: `layer-op-${layer}`,
            oninput: (e) => {
              const v = Number(e.target.value);
              store.doc.style.layers ||= {};
              store.doc.style.layers[layer] = { ...(store.doc.style.layers[layer] || {}), opacity: v };
              emit('doc', { live: true });
            },
            onchange: (e) => {
              // restore the pre-drag value, then apply once through change() so it is one undo step
              const v = Number(e.target.value);
              store.doc.style.layers ||= {};
              store.doc.style.layers[layer] = { ...(store.doc.style.layers[layer] || {}), opacity: op };
              change((doc) => { doc.style.layers[layer].opacity = v; });
            },
          }),
          h('span', { class: 'muted small' }, `${Math.round(op * 100)}%`)));
        const list = h('ul', { class: 'feature-list' });
        for (const f of store.doc.layers[layer]) {
          list.append(h('li', {
            class: `${store.selection.has(f.id) ? 'sel' : ''}${f.hidden ? ' is-hidden' : ''}`,
            title: f.id,
            onclick: (e) => {
              select(f.id, { toggle: e.shiftKey });
              if (!e.shiftKey && f.points.length) {
                const pt = LAYER_KIND[layer] === 'polygon' ? centroid(f.points) : f.points[Math.floor(f.points.length / 2)];
                canvas.centerOn(pt);
              }
            },
          }, h('span', { class: 'fname' }, f.name || f.id), h('span', { class: 'fid' }, f.name ? f.id : (f.type || ''))));
        }
        if (!store.doc.layers[layer].length) list.append(h('li', { class: 'muted empty' }, 'empty'));
        extra.append(list);
      } else {
        extra.append(h('p', { class: 'muted small' }, layer === 'pois' ? 'Lock to stop POIs from being moved on the map.' : 'POI and feature names.'));
      }
      wrap.append(extra);
    }
    return wrap;
  }

  function render() {
    renderKeepingFocus(body, () => {
      clear(body);
      const rs = resolveStyle(store.doc.style);
      const order = ['labels', 'pois', ...[...DRAW_ORDER].reverse()];
      for (const l of order) body.append(row(l, rs));
    });
  }

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  };
  on('doc', (d) => { if (!d?.live) schedule(); });
  on('layers', schedule);
  on('selection', schedule);
  render();
}
