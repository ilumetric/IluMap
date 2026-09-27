// Bottom-centre "layer dock": visibility toggle for the active layer, its name
// and what the next feature will be, one round chip per layer (coloured ring,
// click = make active), the type for new features and a colour swatch.

import { store, on, emit, change, setActiveLayer, layerPrefs, savePrefs } from '../state.js';
import { LAYER_KIND } from '../../core/schema.js';
import { resolveStyle } from '../../core/styles.js';
import { h, clear } from '../dom.js';
import { icon } from './icons.js';
import {
  LABELS, ABBR, DOCK_LAYERS, typeOptions, newTypeFor, setNewType, layerColor, colorTarget, chromeTint,
} from './layer-meta.js';

const DRAW_TOOLS = ['line', 'polygon', 'wall', 'poi'];

/** The layer the dock shows as active: POIs while the POI tool is on, else the active layer. */
export function dockLayer() {
  return store.tool === 'poi' ? 'pois' : store.activeLayer;
}

function toolForLayer(layer) {
  if (layer === 'pois') return 'poi';
  if (layer === 'walls') return 'wall';
  return LAYER_KIND[layer] === 'polygon' ? 'polygon' : 'line';
}

export function mountDock() {
  const root = document.getElementById('dock');
  const power = h('button', { type: 'button', class: 'dock-power', 'aria-pressed': 'true' }, icon('power'));
  const name = h('div', { class: 'dock-name' });
  const sub = h('div', { class: 'dock-sub' });
  const chips = h('div', { class: 'dock-chips', role: 'radiogroup', 'aria-label': 'Active layer' });
  const typeSel = h('select', { class: 'dock-type', name: 'dock-type', title: 'Type for new features', 'aria-label': 'Type for new features' });
  const swatch = h('input', { type: 'color', class: 'dock-swatch', name: 'dock-color', 'aria-label': 'Layer colour' });
  const typeWrap = h('div', { class: 'dock-typewrap' }, typeSel, swatch);
  root.append(power, h('div', { class: 'dock-label' }, name, sub), h('span', { class: 'dock-sep' }), chips, h('span', { class: 'dock-sep' }), typeWrap);

  const chipEls = new Map();
  for (const l of DOCK_LAYERS) {
    const c = h('button', {
      type: 'button', class: 'chip', role: 'radio', 'aria-checked': 'false', 'aria-label': LABELS[l], title: LABELS[l],
      onclick: () => pick(l),
    }, ABBR[l]);
    chipEls.set(l, c);
    chips.append(c);
  }

  function pick(layer) {
    const drawing = DRAW_TOOLS.includes(store.tool);
    if (layer === 'pois') { emit('set-tool', 'poi'); return; }
    setActiveLayer(layer);
    // keep drawing, but with the tool that fits the new layer
    if (drawing && store.tool !== toolForLayer(layer)) emit('set-tool', toolForLayer(layer));
  }

  power.addEventListener('click', () => {
    const l = dockLayer();
    const p = layerPrefs(l);
    p.visible = !p.visible;
    savePrefs();
    emit('layers');
  });

  typeSel.addEventListener('change', () => { setNewType(dockLayer(), typeSel.value); update(); });
  swatch.addEventListener('change', () => {
    const t = colorTarget(dockLayer());
    const v = swatch.value;
    change((d) => {
      d.style[t.group] ||= {};
      d.style[t.group][t.name] = { ...(d.style[t.group][t.name] || {}), [t.key]: v };
    });
  });

  function update() {
    const doc = store.doc;
    const rs = resolveStyle(doc.style);
    const active = dockLayer();
    const vis = layerPrefs(active).visible !== false;
    power.classList.toggle('on', vis);
    power.setAttribute('aria-pressed', String(vis));
    power.title = `${vis ? 'Hide' : 'Show'} ${LABELS[active]}`;
    name.textContent = LABELS[active];
    const count = active === 'pois' ? doc.pois.length : doc.layers[active]?.length || 0;
    const opts = typeOptions(active, rs);
    const type = newTypeFor(active);
    const noun = active === 'pois' ? 'POIs' : count === 1 ? 'feature' : 'features';
    sub.textContent = `${count} ${noun}${opts.length ? ` · new: ${type}` : ` · ${LAYER_KIND[active] || 'point'}`}`;
    for (const [l, c] of chipEls) {
      const tint = chromeTint(layerColor(l, rs));
      c.style.setProperty('--chip', tint.ring);
      c.style.setProperty('--chip-text', tint.text);
      const on = l === active;
      c.classList.toggle('active', on);
      c.setAttribute('aria-checked', String(on));
      c.classList.toggle('off', layerPrefs(l).visible === false);
      const n = l === 'pois' ? doc.pois.length : doc.layers[l].length;
      c.title = `${LABELS[l]} — ${n} ${l === 'pois' ? 'POIs' : n === 1 ? 'feature' : 'features'}${layerPrefs(l).visible === false ? ' (hidden)' : ''}${layerPrefs(l).locked ? ' (locked)' : ''}`;
    }
    clear(typeSel);
    if (opts.length) {
      if (!opts.includes(type)) opts.unshift(type);
      for (const o of opts) typeSel.append(h('option', { value: o, selected: o === type }, o));
      typeSel.value = type;
      typeSel.hidden = false;
    } else {
      typeSel.hidden = true;
    }
    swatch.value = /^#[0-9a-f]{6}$/i.test(layerColor(active, rs)) ? layerColor(active, rs) : '#888888';
    const t = colorTarget(active);
    swatch.title = t.group === 'layers' ? `${LABELS[active]} ${t.key} colour` : `Colour of the “${t.name}” type`;
  }

  on('layers', update);
  on('tool', update);
  on('new-type', update);
  on('theme', update);
  on('doc', (d) => { if (!d?.live) update(); });
  update();
}
