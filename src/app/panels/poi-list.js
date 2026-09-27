// POI list: search, filters (status / type / zone), "Unplaced" section,
// click to select & center, drag a row onto the map to place it, + to add.

import { store, on, change, select, emit, savePrefs } from '../state.js';
import { POI_STATUSES } from '../../core/schema.js';
import { resolveStyle, poiStyle, STATUS_COLORS } from '../../core/styles.js';
import { nextId, zoneOf } from '../../core/model.js';
import { ICONS } from '../../core/render-svg.js';
import { h, clear } from '../dom.js';
import { icon } from '../ui/icons.js';
import { t, label, onLangChange } from '../i18n/index.js';

export function mountPoiList(root, { canvas, onCount = () => {} }) {
  const f = store.prefs.poiFilter || (store.prefs.poiFilter = { status: '', type: '', zone: '' });
  let query = '';

  const search = h('input', {
    type: 'search', class: 'search', name: 'poi-search', id: 'poi-search',
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); renderList(); },
  });
  const addBtn = h('button', { type: 'button', class: 'icon-btn accent', onclick: addPoi }, icon('plus'));
  const selStatus = h('select', { name: 'f-status', onchange: (e) => { f.status = e.target.value; savePrefs(); renderList(); } });
  const selType = h('select', { name: 'f-type', onchange: (e) => { f.type = e.target.value; savePrefs(); renderList(); } });
  const selZone = h('select', { name: 'f-zone', onchange: (e) => { f.zone = e.target.value; savePrefs(); renderList(); } });
  const list = h('div', { class: 'poi-list' });
  root.append(
    h('div', { class: 'poi-tools' }, h('div', { class: 'poi-search-row' }, search, addBtn), h('div', { class: 'filters' }, selStatus, selType, selZone)),
    list,
  );

  function addPoi() {
    const id = nextId(store.doc, 'poi');
    const c = canvas.clientToWorld(...(() => {
      const r = canvas.svg.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    })()).map(Math.round);
    change((doc) => {
      doc.pois.push({ id, name: 'New POI', x: c[0], y: c[1], type: store.prefs.poiType || 'poi', status: 'idea', placed: false });
    });
    select(id);
    emit('focus-field', 'name');
  }

  function fillSelect(sel, current, options, allLabel) {
    clear(sel);
    sel.append(h('option', { value: '' }, allLabel));
    for (const [v, label] of options) sel.append(h('option', { value: v, selected: v === current }, label));
    sel.value = current;
  }

  function zoneOfPoi(p) {
    if (p.zone) return p.zone;
    if (p.placed === false) return '';
    return zoneOf(store.doc, [p.x, p.y]) || '';
  }

  function poiIcon(p, rs) {
    const ps = poiStyle(rs, p);
    const svg = `<svg viewBox="-12 -12 24 24" width="18" height="18" style="color:${ps.color}"><circle r="11" fill="${rs.poiBg}" stroke="${STATUS_COLORS[p.status || 'idea']}" stroke-width="2"${(p.status || 'idea') === 'idea' ? ' stroke-dasharray="3 2"' : ''}/><g transform="scale(0.72)">${ICONS[ps.icon] || ICONS.dot}</g></svg>`;
    const span = h('span', { class: 'poi-ico' });
    span.innerHTML = svg;
    return span;
  }

  function renderRow(p, rs, zones) {
    const zid = zoneOfPoi(p);
    const row = h('div', {
      class: `poi-row${store.selection.has(p.id) ? ' sel' : ''}${p.placed === false ? ' unplaced' : ''}`,
      draggable: 'true',
      title: p.placed === false ? t('points.dragToPlace', { id: p.id }) : p.id,
      onclick: (e) => {
        select(p.id, { toggle: e.shiftKey });
        if (!e.shiftKey && p.placed !== false) canvas.centerOn([p.x, p.y]);
      },
      ondblclick: () => { if (p.placed !== false) canvas.centerOn([p.x, p.y], { minZoom: 6 }); },
      ondragstart: (e) => {
        e.dataTransfer.setData('application/x-ilumap-poi', p.id);
        e.dataTransfer.setData('text/plain', p.id);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      },
      ondragend: () => row.classList.remove('dragging'),
    },
    h('span', { class: 'grip' }, icon('grip')),
    poiIcon(p, rs),
    h('span', { class: 'poi-main' },
      h('span', { class: 'poi-name' }, p.name),
      h('span', { class: 'poi-sub' }, p.id, zid ? ` · ${zones.get(zid) || zid}` : '')),
    h('span', { class: `badge status-${p.status || 'idea'}` }, label('status', p.status || 'idea')));
    return row;
  }

  function renderList() {
    const doc = store.doc;
    const rs = resolveStyle(doc.style);
    const zones = new Map(doc.layers.zones.map((z) => [z.id, z.name || z.id]));
    search.placeholder = t('points.search');
    search.setAttribute('aria-label', t('points.searchAria'));
    addBtn.title = t('points.addTitle');
    addBtn.setAttribute('aria-label', t('points.add'));
    for (const [sel, key] of [[selStatus, 'points.filterStatus'], [selType, 'points.filterType'], [selZone, 'points.filterZone']]) {
      sel.title = t(key);
      sel.setAttribute('aria-label', t(key));
    }
    fillSelect(selStatus, f.status, POI_STATUSES.map((s) => [s, label('status', s)]), t('points.allStatuses'));
    const types = [...new Set([...Object.keys(rs.poiTypes), ...doc.pois.map((p) => p.type)])];
    fillSelect(selType, f.type, types.map((ty) => [ty, label('poiTypes', ty)]), t('points.allTypes'));
    fillSelect(selZone, f.zone, [...zones.entries()], t('points.allZones'));

    const match = (p) => {
      if (f.status && (p.status || 'idea') !== f.status) return false;
      if (f.type && p.type !== f.type) return false;
      if (f.zone && zoneOfPoi(p) !== f.zone) return false;
      if (query) {
        const hay = `${p.name} ${p.id} ${p.type} ${(p.tags || []).join(' ')} ${p.notes || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    };
    const shown = doc.pois.filter(match);
    const unplaced = shown.filter((p) => p.placed === false);
    const placed = shown.filter((p) => p.placed !== false);
    clear(list);
    onCount(shown.length === doc.pois.length ? String(doc.pois.length) : `${shown.length}/${doc.pois.length}`);
    if (unplaced.length) {
      list.append(h('div', { class: 'section-title warn' }, t('points.unplaced', { n: unplaced.length })));
      for (const p of unplaced) list.append(renderRow(p, rs, zones));
    }
    if (placed.length) {
      if (unplaced.length) list.append(h('div', { class: 'section-title' }, t('points.onMap', { n: placed.length })));
      for (const p of placed) list.append(renderRow(p, rs, zones));
    }
    if (!shown.length) list.append(h('p', { class: 'muted empty' }, doc.pois.length ? t('points.noMatch') : t('points.empty')));
    else list.append(h('p', { class: 'panel-hint' }, t('points.dragHint')));
  }

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; renderList(); });
  };
  on('doc', (d) => { if (!d?.live) schedule(); });
  on('selection', schedule);
  onLangChange(schedule);
  renderList();
  return { focusSearch: () => search.focus() };
}
