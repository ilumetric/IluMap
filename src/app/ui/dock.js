// Bottom-centre "layer dock": visibility toggle for the active layer, its name
// and what the next feature will be, one round chip per layer (coloured ring,
// click = make active), the type for new features and a colour swatch.

import { store, on, emit, change, setActiveLayer, layerPrefs, savePrefs } from '../state.js';
import { LAYER_KIND } from '../../core/schema.js';
import { resolveStyle } from '../../core/styles.js';
import { h, clear } from '../dom.js';
import { t, plural, onLangChange } from '../i18n/index.js';
import { icon } from './icons.js';
import {
  layerLabel, layerAbbr, typeLabel, DOCK_LAYERS, typeOptions, newTypeFor, setNewType, layerColor, colorTarget, chromeTint,
} from './layer-meta.js';

const DRAW_TOOLS = ['line', 'polygon', 'wall', 'bridge', 'poi'];

/** The layer the dock shows as active: POIs while the POI tool is on, else the active layer. */
export function dockLayer() {
  return store.tool === 'poi' ? 'pois' : store.activeLayer;
}

function toolForLayer(layer) {
  if (layer === 'pois') return 'poi';
  if (layer === 'walls') return 'wall';
  if (layer === 'bridges') return 'bridge';
  return LAYER_KIND[layer] === 'polygon' ? 'polygon' : 'line';
}

export function mountDock() {
  const root = document.getElementById('dock');
  const power = h('button', { type: 'button', class: 'dock-power', 'aria-pressed': 'true' }, icon('power'));
  const name = h('div', { class: 'dock-name' });
  const sub = h('div', { class: 'dock-sub' });
  const chips = h('div', { class: 'dock-chips', role: 'radiogroup' });
  const typeSel = h('select', { class: 'dock-type', name: 'dock-type' });
  const swatch = h('input', { type: 'color', class: 'dock-swatch', name: 'dock-color' });
  const typeWrap = h('div', { class: 'dock-typewrap' }, typeSel, swatch);
  root.append(power, h('div', { class: 'dock-label' }, name, sub), h('span', { class: 'dock-sep' }), chips, h('span', { class: 'dock-sep' }), typeWrap);

  const chipEls = new Map();
  for (const l of DOCK_LAYERS) {
    const c = h('button', {
      type: 'button', class: 'chip', role: 'radio', 'aria-checked': 'false',
      onclick: () => pick(l),
    });
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
    const ct = colorTarget(dockLayer());
    const v = swatch.value;
    change((d) => {
      d.style[ct.group] ||= {};
      d.style[ct.group][ct.name] = { ...(d.style[ct.group][ct.name] || {}), [ct.key]: v };
    });
  });

  function update() {
    const doc = store.doc;
    const rs = resolveStyle(doc.style);
    const active = dockLayer();
    const vis = layerPrefs(active).visible !== false;
    power.classList.toggle('on', vis);
    power.setAttribute('aria-pressed', String(vis));
    root.setAttribute('aria-label', t('dock.aria'));
    chips.setAttribute('aria-label', t('dock.activeLayer'));
    typeSel.title = t('dock.newType');
    typeSel.setAttribute('aria-label', t('dock.newType'));
    power.title = t(vis ? 'dock.hideLayer' : 'dock.showLayer', { layer: layerLabel(active) });
    power.setAttribute('aria-label', power.title);
    name.textContent = layerLabel(active);
    name.title = layerLabel(active);
    const count = active === 'pois' ? doc.pois.length : doc.layers[active]?.length || 0;
    const opts = typeOptions(active, rs);
    const type = newTypeFor(active);
    const counted = plural(active === 'pois' ? 'count.pois' : 'count.features', count);
    sub.textContent = opts.length
      ? t('dock.sub', { count: counted, type: typeLabel(active, type) })
      : t('dock.subKind', { count: counted, kind: t(`kinds.${LAYER_KIND[active] || 'point'}`) });
    sub.title = sub.textContent;
    for (const [l, c] of chipEls) {
      const tint = chromeTint(layerColor(l, rs));
      c.style.setProperty('--chip', tint.ring);
      c.style.setProperty('--chip-text', tint.text);
      const on = l === active;
      c.classList.toggle('active', on);
      c.setAttribute('aria-checked', String(on));
      c.classList.toggle('off', layerPrefs(l).visible === false);
      const n = l === 'pois' ? doc.pois.length : doc.layers[l].length;
      c.textContent = layerAbbr(l);
      c.setAttribute('aria-label', layerLabel(l));
      c.title = `${layerLabel(l)} — ${plural(l === 'pois' ? 'count.pois' : 'count.features', n)}${layerPrefs(l).visible === false ? ` ${t('dock.hiddenMark')}` : ''}${layerPrefs(l).locked ? ` ${t('dock.lockedMark')}` : ''}`;
    }
    clear(typeSel);
    if (opts.length) {
      if (!opts.includes(type)) opts.unshift(type);
      for (const o of opts) typeSel.append(h('option', { value: o, selected: o === type }, typeLabel(active, o)));
      typeSel.value = type;
      typeSel.hidden = false;
    } else {
      typeSel.hidden = true;
    }
    swatch.value = /^#[0-9a-f]{6}$/i.test(layerColor(active, rs)) ? layerColor(active, rs) : '#888888';
    const ct = colorTarget(active);
    swatch.title = ct.group === 'layers'
      ? t(ct.key === 'fill' ? 'dock.fillColour' : 'dock.strokeColour', { layer: layerLabel(active) })
      : t('dock.typeColour', { type: typeLabel(active, ct.name) });
    swatch.setAttribute('aria-label', swatch.title);
  }

  on('layers', update);
  on('tool', update);
  on('new-type', update);
  on('theme', update);
  onLangChange(update);
  on('doc', (d) => { if (!d?.live) update(); });
  update();
}
