// Style panel: preset + per-layer and per-type colours (stored as overrides in doc.style).

import { store, on, change } from '../state.js';
import { resolveStyle, PRESETS, POI_ICONS } from '../../core/styles.js';
import { DRAW_ORDER } from '../../core/schema.js';
import { h, clear, renderKeepingFocus, openDialog, toast } from '../dom.js';
import { slugify } from '../../core/model.js';

function setOverride(group, name, key, value) {
  change((doc) => {
    doc.style[group] ||= {};
    doc.style[group][name] = { ...(doc.style[group][name] || {}), [key]: value };
  });
}

function colorCell(name, value, onCommit) {
  const el = h('input', { type: 'color', name, value: value || '#888888' });
  el.addEventListener('change', () => onCommit(el.value));
  return el;
}

export function mountStyle(root) {
  const body = h('div', { class: 'style-panel' });
  root.append(body);

  function render() {
    renderKeepingFocus(body, () => {
      clear(body);
      const doc = store.doc;
      const rs = resolveStyle(doc.style);

      const preset = h('select', { name: 'preset' }, Object.keys(PRESETS).map((p) => h('option', { value: p, selected: p === rs.preset }, p)));
      preset.addEventListener('change', () => {
        const v = preset.value;
        change((d) => {
          d.style.preset = v;
          // colours of the old preset would clash: drop ocean/label/grid and layer colour overrides, keep widths/opacity
          delete d.style.ocean; delete d.style.label; delete d.style.grid;
          for (const [l, e] of Object.entries(d.style.layers || {})) {
            delete e.fill; delete e.stroke;
            if (!Object.keys(e).length) delete d.style.layers[l];
          }
          if (d.style.layers && !Object.keys(d.style.layers).length) delete d.style.layers;
        });
      });

      body.append(h('section', { class: 'insp-section' },
        h('h4', {}, 'Map style'),
        h('p', { class: 'muted small' }, 'Colours of the map itself (saved in map.json). The editor theme is in Settings.'),
        h('div', { class: 'row2' },
          h('label', { class: 'field' }, h('span', {}, 'Base palette'), preset),
          h('label', { class: 'field' }, h('span', {}, 'Ocean (inside the bounds)'), colorCell('ocean', rs.ocean, (v) => change((d) => { d.style.ocean = v; })))),
        h('div', { class: 'row2' },
          h('label', { class: 'field' }, h('span', {}, 'Labels'), colorCell('label', rs.label, (v) => change((d) => { d.style.label = v; }))),
          h('label', { class: 'field' }, h('span', {}, 'Grid'), colorCell('grid', rs.grid, (v) => change((d) => { d.style.grid = v; })))),
        h('button', {
          class: 'btn btn-small', title: 'Remove all style overrides (keeps the preset)',
          onclick: () => change((d) => { d.style = { preset: d.style.preset }; }),
        }, 'Reset overrides')));

      // layers
      const lt = h('table', { class: 'style-table' }, h('tr', {}, h('th', {}, 'Layer'), h('th', {}, 'Fill'), h('th', {}, 'Stroke'), h('th', {}, 'Width px')));
      for (const l of DRAW_ORDER) {
        const e = rs.layers[l] || {};
        const hasFill = l === 'land' || l === 'water';
        const w = h('input', { type: 'number', name: `lw-${l}`, value: e.width ?? '', min: 0, step: 0.5, class: 'narrow' });
        w.addEventListener('change', () => { if (w.value !== '') setOverride('layers', l, 'width', Number(w.value)); });
        lt.append(h('tr', {},
          h('td', {}, l),
          h('td', {}, hasFill ? colorCell(`lf-${l}`, e.fill, (v) => setOverride('layers', l, 'fill', v)) : h('span', { class: 'muted' }, '—')),
          h('td', {}, l === 'zones' ? h('span', { class: 'muted' }, 'per type') : colorCell(`ls-${l}`, e.stroke, (v) => setOverride('layers', l, 'stroke', v))),
          h('td', {}, l === 'zones' ? '' : w)));
      }
      body.append(h('section', { class: 'insp-section' }, h('h4', {}, 'Layers'), lt));

      // zone types
      const zt = h('table', { class: 'style-table' }, h('tr', {}, h('th', {}, 'Zone type'), h('th', {}, 'Fill'), h('th', {}, 'Pattern')));
      for (const [name, e] of Object.entries(rs.zoneTypes)) {
        const pat = h('select', { name: `zp-${name}` }, ['', 'hatch', 'dots'].map((p) => h('option', { value: p, selected: (e.pattern || '') === p }, p || 'none')));
        pat.addEventListener('change', () => setOverride('zoneTypes', name, 'pattern', pat.value || null));
        zt.append(h('tr', {}, h('td', {}, name), h('td', {}, colorCell(`zf-${name}`, e.fill, (v) => setOverride('zoneTypes', name, 'fill', v))), h('td', {}, pat)));
      }
      body.append(h('section', { class: 'insp-section' }, h('h4', {}, 'Zone types'), zt, addTypeButton('zoneTypes', { fill: '#7f9f7f' })));

      // poi types
      const pt = h('table', { class: 'style-table' }, h('tr', {}, h('th', {}, 'POI type'), h('th', {}, 'Colour'), h('th', {}, 'Icon')));
      for (const [name, e] of Object.entries(rs.poiTypes)) {
        const ic = h('select', { name: `pi-${name}` }, POI_ICONS.map((p) => h('option', { value: p, selected: e.icon === p }, p)));
        ic.addEventListener('change', () => setOverride('poiTypes', name, 'icon', ic.value));
        pt.append(h('tr', {}, h('td', {}, name), h('td', {}, colorCell(`pc-${name}`, e.color, (v) => setOverride('poiTypes', name, 'color', v))), h('td', {}, ic)));
      }
      body.append(h('section', { class: 'insp-section' }, h('h4', {}, 'POI types'), pt, addTypeButton('poiTypes', { color: '#8ecae6', icon: 'dot' })));

      // wall + line types
      const wt = h('table', { class: 'style-table' }, h('tr', {}, h('th', {}, 'Wall / line type'), h('th', {}, 'Stroke'), h('th', {}, 'Dash')));
      for (const [name, e] of Object.entries(rs.wallTypes)) {
        wt.append(h('tr', {}, h('td', {}, name), h('td', {}, colorCell(`ws-${name}`, e.stroke, (v) => setOverride('wallTypes', name, 'stroke', v))), h('td', { class: 'muted' }, e.pattern || '')));
      }
      for (const [name, e] of Object.entries(rs.lineTypes)) {
        const layerStroke = name.startsWith('river') ? rs.layers.rivers.stroke : name.startsWith('rail') ? rs.layers.rails.stroke : rs.layers.roads.stroke;
        const dash = h('input', { type: 'text', name: `ld-${name}`, value: e.dash ?? '', placeholder: 'solid', class: 'narrow' });
        dash.addEventListener('change', () => setOverride('lineTypes', name, 'dash', dash.value.trim() || null));
        wt.append(h('tr', {}, h('td', {}, name), h('td', {}, colorCell(`lc-${name}`, e.stroke || layerStroke, (v) => setOverride('lineTypes', name, 'stroke', v))), h('td', {}, dash)));
      }
      body.append(h('section', { class: 'insp-section' }, h('h4', {}, 'Wall and line types'), wt, addTypeButton('lineTypes', { width: 2 })));
    });
  }

  function addTypeButton(group, defaults) {
    return h('button', {
      class: 'btn btn-small',
      onclick: async () => {
        const res = await openDialog({ title: `New ${group.replace('Types', '')} type`, fields: [{ name: 'name', label: 'Type name', value: '' }], okText: 'Add' });
        if (!res || !res.name.trim()) return;
        const name = slugify(res.name, Object.keys(resolveStyle(store.doc.style)[group]));
        change((d) => { d.style[group] ||= {}; d.style[group][name] = { ...defaults }; });
        toast(`Added ${group} “${name}”`, { type: 'ok' });
      },
    }, '+ Type');
  }

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  };
  on('doc', (d) => { if (!d?.live) schedule(); });
  render();
}
