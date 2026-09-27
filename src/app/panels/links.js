// Links editor for the selected POI: list, remove, add (to POI or gate id, typed).

import { store, change, select } from '../state.js';
import { LINK_TYPES, LAYERS } from '../../core/schema.js';
import { findById } from '../../core/model.js';
import { distance } from '../../core/geometry.js';
import { t, label } from '../i18n/index.js';
import { fmtLength } from '../i18n/format.js';
import { layerLabel } from '../ui/layer-meta.js';
import { h, toast } from '../dom.js';
import { icon } from '../ui/icons.js';

function endpointName(id) {
  const hit = findById(store.doc, id);
  if (!hit) return t('links.missing', { id });
  return hit.item.name ? `${hit.item.name}` : id;
}

export function renderLinks(poiId) {
  const doc = store.doc;
  const wrap = h('div', { class: 'links' });
  const links = doc.links.filter((k) => k.from === poiId || k.to === poiId);
  const self = findById(doc, poiId)?.item;

  const list = h('div', { class: 'link-list' });
  if (!links.length) list.append(h('p', { class: 'muted small' }, t('links.empty')));
  for (const k of links) {
    const out = k.from === poiId;
    const other = out ? k.to : k.from;
    const oh = findById(doc, other);
    let dist = '';
    if (self && oh?.kind === 'poi' && self.placed !== false && oh.item.placed !== false) {
      dist = fmtLength(distance([self.x, self.y], [oh.item.x, oh.item.y]), doc.meta);
    }
    list.append(h('div', { class: 'link-row' },
      h('span', { class: `link-type t-${k.type}`, title: k.type }, label('linkTypes', k.type)),
      h('span', { class: 'link-arrow' }, out ? '→' : '←'),
      h('button', { class: 'link-target', title: t('links.select', { id: other }), onclick: () => { if (oh?.kind === 'poi') select(other); else if (oh?.kind === 'gate') select(oh.feature.id); } },
        endpointName(other), h('small', {}, ` ${other}`)),
      h('span', { class: 'link-meta muted small' }, [k.name ? `“${k.name}”` : '', k.feature ? t('links.via', { feature: k.feature }) : '', dist].filter(Boolean).join(' · ')),
      h('button', {
        class: 'icon-btn danger', title: t('links.remove'), 'aria-label': t('links.remove'),
        onclick: () => change((d) => {
          const i = d.links.findIndex((x) => x.from === k.from && x.to === k.to && x.type === k.type && (x.name || '') === (k.name || ''));
          if (i >= 0) d.links.splice(i, 1);
        }),
      }, icon('trash'))));
  }
  wrap.append(list);

  // datalists
  const targets = h('datalist', { id: 'dl-link-targets' });
  for (const p of doc.pois) if (p.id !== poiId) targets.append(h('option', { value: p.id }, p.name));
  for (const f of doc.layers.walls) for (const g of f.wall?.gates || []) targets.append(h('option', { value: g.id }, t('links.gateOption', { name: g.name || g.id })));
  const types = h('datalist', { id: 'dl-link-types' }, LINK_TYPES.map((lt) => h('option', { value: lt }, label('linkTypes', lt))));
  const feats = h('datalist', { id: 'dl-link-features' });
  for (const l of LAYERS) for (const f of doc.layers[l]) if (l !== 'zones' && l !== 'land' && l !== 'water') feats.append(h('option', { value: f.id }, `${f.name || f.id} (${layerLabel(l)})`));

  const to = h('input', { name: 'link-to', list: 'dl-link-targets', placeholder: t('links.toPlaceholder'), 'aria-label': t('links.toPlaceholder'), autocomplete: 'off' });
  const type = h('input', { name: 'link-type', list: 'dl-link-types', placeholder: t('links.typePlaceholder'), 'aria-label': t('links.typePlaceholder'), value: 'road', autocomplete: 'off' });
  const name = h('input', { name: 'link-name', placeholder: t('links.namePlaceholder'), 'aria-label': t('links.namePlaceholder'), autocomplete: 'off' });
  const feature = h('input', { name: 'link-feature', list: 'dl-link-features', placeholder: t('links.featurePlaceholder'), 'aria-label': t('links.featurePlaceholder'), autocomplete: 'off' });
  const add = () => {
    const target = to.value.trim();
    const lt = type.value.trim() || 'road';
    const hit = findById(store.doc, target);
    if (!hit || (hit.kind !== 'poi' && hit.kind !== 'gate')) { toast(t('toast.linkBadTarget', { id: target }), { type: 'warn' }); return; }
    if (target === poiId) { toast(t('toast.linkSameEnds'), { type: 'warn' }); return; }
    const fid = feature.value.trim();
    if (fid && findById(store.doc, fid)?.kind !== 'feature') { toast(t('toast.linkBadFeature', { id: fid }), { type: 'warn' }); return; }
    change((d) => {
      const link = { from: poiId, to: target, type: lt };
      if (name.value.trim()) link.name = name.value.trim();
      if (fid) link.feature = fid;
      d.links.push(link);
    });
  };
  const form = h('div', { class: 'link-add' }, targets, types, feats,
    h('div', { class: 'row2' }, to, type),
    h('div', { class: 'row2' }, name, feature),
    h('button', { class: 'btn btn-small', onclick: add }, icon('plus'), t('links.add')));
  for (const el of [to, type, name, feature]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  wrap.append(form);
  return wrap;
}
