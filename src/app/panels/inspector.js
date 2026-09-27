// Inspector for the current selection (POI, feature incl. walls, or multi-selection).

import { store, on, change, select, emit, selectedItems } from '../state.js';
import { POI_STATUSES, LAYER_KIND, LAYERS, TOWER_MODES, DEFAULT_WALL } from '../../core/schema.js';
import { resolveStyle, typeGroupForLayer, poiStyle } from '../../core/styles.js';
import { findById, renameId, removeById, zoneOf, isLand, allIds, slugify } from '../../core/model.js';
import { polylineLength, polygonArea, centroid, featureGeometry, wallLayout } from '../../core/geometry.js';
import { formatLength, formatArea } from '../../core/text-export.js';
import { h, clear, icon, toast, renderKeepingFocus } from '../dom.js';
import { renderLinks } from './links.js';

const fmtN = (v) => (v == null ? '' : String(Math.round(v * 100) / 100));

/** Apply a mutation to the item with this id inside an undoable change. */
function edit(id, fn) {
  change((doc) => {
    const hit = findById(doc, id);
    if (hit) fn(hit.item, hit, doc);
  });
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
}

function text(name, value, onCommit, attrs = {}) {
  const el = h('input', { type: 'text', name, value: value ?? '', autocomplete: 'off', spellcheck: 'false', ...attrs });
  el.addEventListener('change', () => onCommit(el.value));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); if (e.key === 'Escape') { el.value = value ?? ''; el.blur(); } });
  return el;
}

function num(name, value, onCommit, attrs = {}) {
  const el = h('input', { type: 'number', name, value: value ?? '', step: 'any', ...attrs });
  el.addEventListener('change', () => onCommit(el.value === '' ? null : Number(el.value)));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  return el;
}

function sel(name, value, options, onCommit) {
  const el = h('select', { name }, options.map((o) => {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: String(v) === String(value ?? '') }, label);
  }));
  el.value = value ?? '';
  el.addEventListener('change', () => onCommit(el.value));
  return el;
}

function check(name, checked, label, onCommit) {
  const el = h('input', { type: 'checkbox', name, checked: !!checked });
  el.addEventListener('change', () => onCommit(el.checked));
  return h('label', { class: 'check' }, el, h('span', {}, label));
}

function area(name, value, onCommit, rows = 3) {
  const el = h('textarea', { name, rows, spellcheck: 'true' });
  el.value = value ?? '';
  el.addEventListener('change', () => onCommit(el.value));
  return el;
}

function colorOverride(name, value, fallback, onCommit) {
  const input = h('input', { type: 'color', name, value: value || fallback || '#888888', class: value ? '' : 'unset' });
  input.addEventListener('change', () => onCommit(input.value));
  const clearBtn = h('button', { class: 'icon-btn', title: 'Clear override (use the type colour)', disabled: !value, onclick: () => onCommit(null) }, '×');
  return h('span', { class: 'color-override' }, input, h('span', { class: 'muted small' }, value || 'type colour'), clearBtn);
}

function datalist(id, values) {
  return h('datalist', { id }, values.map((v) => h('option', { value: v })));
}

function tagsInput(name, tags, onCommit) {
  return text(name, (tags || []).join(', '), (v) => onCommit(v.split(',').map((t) => t.trim()).filter(Boolean)), { placeholder: 'comma, separated' });
}

function idInput(id) {
  return text('id', id, (v) => {
    const nv = v.trim();
    if (nv === id) return;
    try {
      change((doc) => renameId(doc, id, nv));
      select(nv);
      toast(`Renamed ${id} → ${nv} (references updated)`, { type: 'ok' });
    } catch (e) {
      toast(e.message, { type: 'error' });
      emit('selection');
    }
  }, { class: 'mono', pattern: '[a-z0-9_]+', title: 'Lowercase letters, digits and _ — unique in the file. Renaming updates links and zone references.' });
}

function section(title, ...children) {
  return h('section', { class: 'insp-section' }, h('h4', {}, title), ...children);
}

export function mountInspector(root, { canvas }) {
  const body = h('div', { class: 'inspector' });
  root.append(body);

  function centerOn(hit) {
    if (hit.kind === 'poi') { if (hit.item.placed !== false) canvas.centerOn([hit.item.x, hit.item.y]); return; }
    const f = hit.item;
    if (!f.points.length) return;
    canvas.centerOn(LAYER_KIND[hit.layer] === 'polygon' ? centroid(f.points) : f.points[Math.floor(f.points.length / 2)]);
  }

  function actions(hit) {
    return h('div', { class: 'insp-actions' },
      h('button', { class: 'btn btn-small', onclick: () => centerOn(hit) }, icon('target'), 'Center'),
      h('button', { class: 'btn btn-small btn-danger', onclick: () => change((doc) => removeById(doc, hit.item.id)) }, icon('trash'), 'Delete'));
  }

  function renderNone() {
    const doc = store.doc;
    const nf = LAYERS.reduce((n, l) => n + doc.layers[l].length, 0);
    body.append(
      h('div', { class: 'insp-empty' },
        h('p', {}, h('strong', {}, doc.meta.name || 'Untitled')),
        h('p', { class: 'muted' }, `${doc.pois.length} POIs · ${nf} features · ${doc.links.length} links`),
        h('p', { class: 'muted small' }, 'Nothing selected. Click a feature or POI on the map, or a row in the POI list. Shift+click adds to the selection; drag on empty space for a box selection.'),
        h('ul', { class: 'tips' },
          h('li', {}, h('kbd', {}, 'L'), ' line · ', h('kbd', {}, 'P'), ' polygon · ', h('kbd', {}, 'W'), ' wall · ', h('kbd', {}, 'O'), ' POI'),
          h('li', {}, h('kbd', {}, 'Enter'), ' finish · ', h('kbd', {}, 'C'), ' close · ', h('kbd', {}, 'Esc'), ' cancel'),
          h('li', {}, h('kbd', {}, 'Alt'), '+click segment inserts a vertex; double-click a vertex deletes it'),
          h('li', {}, h('kbd', {}, '?'), ' all shortcuts'))));
  }

  function renderMulti(items) {
    body.append(h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind' }, 'Selection'), h('span', { class: 'insp-title' }, `${items.length} items`)));
    const ul = h('ul', { class: 'multi-list' });
    for (const { id, hit } of items) {
      ul.append(h('li', {},
        h('span', { class: 'tag' }, hit.kind === 'poi' ? 'POI' : hit.layer),
        h('button', { class: 'link-target', onclick: () => select(id) }, hit.item.name || id, h('small', {}, ` ${id}`)),
        h('button', { class: 'icon-btn', title: 'Remove from selection', onclick: () => select(id, { toggle: true }) }, '×')));
    }
    body.append(ul, h('div', { class: 'insp-actions' },
      h('button', { class: 'btn btn-small btn-danger', onclick: () => change((doc) => { for (const { id } of items) removeById(doc, id); }) }, icon('trash'), `Delete ${items.length}`)));
  }

  function renderPoi(hit) {
    const p = hit.item;
    const doc = store.doc;
    const rs = resolveStyle(doc.style);
    const id = p.id;
    const ps = poiStyle(rs, p);
    const zones = doc.layers.zones;
    const auto = p.placed === false ? null : zoneOf(doc, [p.x, p.y]);
    const onLand = p.placed === false ? null : isLand(doc, [p.x, p.y]);
    const types = [...new Set([...Object.keys(rs.poiTypes), ...doc.pois.map((x) => x.type)])];

    body.append(h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind', style: { background: ps.color } }, 'POI'), h('span', { class: 'insp-title' }, p.name)));
    body.append(datalist('dl-poi-types', types));
    const zoneHint = p.placed === false ? 'not placed yet' : `${auto ? `inside ${zones.find((z) => z.id === auto)?.name || auto}` : 'outside all zones'} · ${onLand ? 'on land' : 'in water'}`;
    body.append(
      section('Identity',
        field('Id', idInput(id)),
        field('Name', text('name', p.name, (v) => edit(id, (it) => { it.name = v || it.id; }))),
        h('div', { class: 'row2' },
          field('Type', text('type', p.type, (v) => { store.prefs.poiType = v || 'poi'; edit(id, (it) => { it.type = v || 'poi'; }); }, { list: 'dl-poi-types' })),
          field('Status', sel('status', p.status || 'idea', POI_STATUSES, (v) => edit(id, (it) => { it.status = v; })))),
        h('div', { class: 'row-zone' },
          field('Zone', sel('zone', p.zone || '', [['', '(none)'], ...zones.map((z) => [z.id, z.name ? `${z.name} (${z.id})` : z.id])],
            (v) => edit(id, (it) => { if (v) it.zone = v; else delete it.zone; })), zoneHint),
          h('button', {
            class: 'btn btn-small', title: 'Set the zone from the position (point in polygon)', disabled: p.placed === false,
            onclick: () => edit(id, (it) => { if (auto) it.zone = auto; else delete it.zone; }),
          }, 'Auto'))),
      section('Position',
        h('div', { class: 'row2' },
          field(`X (${doc.meta.units})`, num('x', p.x, (v) => v != null && edit(id, (it) => { it.x = v; const z = zoneOf(store.doc, [it.x, it.y]); if (z) it.zone = z; }))),
          field(`Y (${doc.meta.units})`, num('y', p.y, (v) => v != null && edit(id, (it) => { it.y = v; const z = zoneOf(store.doc, [it.x, it.y]); if (z) it.zone = z; })))),
        check('placed', p.placed !== false, 'Placed on the map (unchecked = “Unplaced” list)', (v) => edit(id, (it) => { if (v) delete it.placed; else it.placed = false; }))),
      section('Details',
        field('Tags', tagsInput('tags', p.tags, (v) => edit(id, (it) => { if (v.length) it.tags = v; else delete it.tags; }))),
        field('Notes', area('notes', p.notes, (v) => edit(id, (it) => { if (v) it.notes = v; else delete it.notes; }))),
        field('Anchor', text('anchor', p.anchor, (v) => edit(id, (it) => { if (v.trim()) it.anchor = v.trim(); else delete it.anchor; }), { placeholder: 'places.md#old-mine' })),
        field('Colour', colorOverride('color', p.color, ps.color, (v) => edit(id, (it) => { if (v) it.color = v; else delete it.color; })))),
      section('Links', renderLinks(id)),
      actions(hit),
    );
  }

  function renderFeature(hit) {
    const f = hit.item;
    const layer = hit.layer;
    const doc = store.doc;
    const rs = resolveStyle(doc.style);
    const id = f.id;
    const kind = LAYER_KIND[layer];
    const group = typeGroupForLayer(layer);
    const types = Object.keys(rs[group] || {});
    const closed = kind === 'polygon' || f.closed === true;
    const geo = featureGeometry(f);
    const meta = doc.meta;
    const stats = kind === 'polygon'
      ? `${f.points.length} points · area ${formatArea(polygonArea(geo), meta)} · perimeter ${formatLength(polylineLength(geo, true), meta)}`
      : `${f.points.length} points · length ${formatLength(polylineLength(geo, closed), meta)}`;
    const sameKind = LAYERS.filter((l) => LAYER_KIND[l] === kind);

    body.append(h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind' }, layer), h('span', { class: 'insp-title' }, f.name || f.id)));
    body.append(datalist('dl-feature-types', types));
    body.append(
      section('Identity',
        field('Id', idInput(id)),
        field('Name', text('name', f.name, (v) => edit(id, (it) => { if (v.trim()) it.name = v; else delete it.name; }), { placeholder: 'label on the map' })),
        h('div', { class: 'row2' },
          field('Type', text('type', f.type, (v) => edit(id, (it) => {
            if (v.trim()) it.type = v.trim(); else delete it.type;
            if (layer === 'zones' && v.trim()) store.prefs.lastZoneType = v.trim();
          }), { list: 'dl-feature-types', placeholder: group })),
          field('Layer', sel('layer', layer, sameKind, (v) => {
            if (v === layer) return;
            change((d) => {
              const arr = d.layers[layer];
              const i = arr.findIndex((x) => x.id === id);
              if (i < 0) return;
              const [it] = arr.splice(i, 1);
              if (v !== 'walls') delete it.wall;
              if (v === 'walls' && !it.wall) it.wall = { ...DEFAULT_WALL, gates: [] };
              d.layers[v].push(it);
            });
          })))),
      section('Shape',
        h('div', { class: 'checks' },
          check('smooth', f.smooth, 'Smooth (Catmull-Rom)', (v) => edit(id, (it) => { if (v) it.smooth = true; else delete it.smooth; })),
          kind === 'line' ? check('closed', f.closed, 'Closed', (v) => edit(id, (it) => { if (v) it.closed = true; else delete it.closed; })) : null,
          check('hidden', f.hidden, 'Hidden', (v) => edit(id, (it) => { if (v) it.hidden = true; else delete it.hidden; }))),
        kind === 'line' || layer === 'walls'
          ? field(`Width (${meta.units}, world)`, num('width', f.width, (v) => edit(id, (it) => { if (v > 0) it.width = v; else delete it.width; }), { min: 0, placeholder: 'style width' }),
            f.width ? `= ${formatLength(f.width, meta)} · used for masks and to-scale rendering` : 'empty = style width in screen pixels')
          : null,
        field('Colour', colorOverride('color', f.color, layer === 'zones' ? rs.zoneTypes[f.type]?.fill : (rs.layers[layer]?.stroke || rs.layers[layer]?.fill), (v) => edit(id, (it) => { if (v) it.color = v; else delete it.color; }))),
        h('p', { class: 'muted small stats' }, stats)),
    );

    if (layer === 'walls') body.append(renderWall(f));

    body.append(
      section('Details',
        field('Tags', tagsInput('tags', f.tags, (v) => edit(id, (it) => { if (v.length) it.tags = v; else delete it.tags; }))),
        field('Notes', area('notes', f.notes, (v) => edit(id, (it) => { if (v) it.notes = v; else delete it.notes; })))),
      section('Points',
        field(`One “x, y” per line (${meta.units})`, area('points', f.points.map((p) => `${fmtN(p[0])}, ${fmtN(p[1])}`).join('\n'), (v) => {
          const pts = v.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[\s,;]+/).map(Number));
          if (pts.some((p) => p.length !== 2 || !p.every(Number.isFinite))) { toast('Each line must be “x, y”', { type: 'error' }); emit('selection'); return; }
          const min = kind === 'polygon' ? 3 : 2;
          if (pts.length < min) { toast(`Needs at least ${min} points`, { type: 'error' }); emit('selection'); return; }
          edit(id, (it) => { it.points = pts; });
        }, Math.min(10, Math.max(3, f.points.length))))),
      actions(hit),
    );
  }

  function renderWall(f) {
    const id = f.id;
    const w = f.wall || {};
    const lay = wallLayout(f);
    const meta = store.doc.meta;
    const setWall = (fn) => edit(id, (it) => { it.wall ||= { ...DEFAULT_WALL, gates: [] }; fn(it.wall, it); });
    const gates = h('div', { class: 'gates' });
    (w.gates || []).forEach((g, i) => {
      const mode = Number.isInteger(g.at) ? 'at' : 't';
      gates.append(h('div', { class: 'gate-row' },
        text(`gate-id-${i}`, g.id, (v) => {
          const nv = v.trim();
          if (nv === g.id) return;
          try { change((doc) => renameId(doc, g.id, nv)); } catch (e) { toast(e.message, { type: 'error' }); emit('selection'); }
        }, { class: 'mono', title: 'Gate id (link endpoint)', placeholder: 'gate id' }),
        text(`gate-name-${i}`, g.name, (v) => setWall((wl) => { if (v.trim()) wl.gates[i].name = v.trim(); else delete wl.gates[i].name; }), { placeholder: 'name' }),
        sel(`gate-mode-${i}`, mode, [['at', 'at vertex #'], ['t', 'at fraction 0..1']], (v) => setWall((wl) => {
          const gg = wl.gates[i];
          if (v === 'at') { delete gg.t; gg.at = 0; } else {
            const s = lay.gates[i]?.s ?? 0;
            delete gg.at;
            gg.t = lay.length ? Math.round((s / lay.length) * 1000) / 1000 : 0;
          }
        })),
        num(`gate-pos-${i}`, mode === 'at' ? g.at : g.t, (v) => setWall((wl, it) => {
          const gg = wl.gates[i];
          if (v == null) return;
          if (mode === 'at') gg.at = Math.max(0, Math.min(it.points.length - 1, Math.round(v)));
          else gg.t = Math.max(0, Math.min(1, v));
        }), mode === 'at' ? { min: 0, max: f.points.length - 1, step: 1 } : { min: 0, max: 1, step: 0.01 }),
        h('button', { class: 'icon-btn danger', title: 'Remove gate (and its links)', onclick: () => change((doc) => removeById(doc, g.id)) }, icon('trash'))));
    });
    const addGate = () => {
      const base = `gate_${id.replace(/^wall_/, '')}`;
      const gid = slugify(base, allIds(store.doc));
      setWall((wl) => { wl.gates = [...(wl.gates || []), { id: gid, name: 'Gate', at: 0 }]; });
    };
    return section('Wall',
      h('div', { class: 'row2' },
        field('Towers', sel('towers', w.towers || 'vertices', TOWER_MODES, (v) => setWall((wl) => { wl.towers = v; }))),
        field(`Tower size (${meta.units})`, num('towerSize', w.towerSize, (v) => setWall((wl) => { if (v > 0) wl.towerSize = v; }), { min: 0 }))),
      (w.towers || 'vertices') === 'auto'
        ? field(`Tower spacing (${meta.units})`, num('towerSpacing', w.towerSpacing, (v) => setWall((wl) => { if (v > 0) wl.towerSpacing = v; }), { min: 0 }), w.towerSpacing ? `= ${formatLength(w.towerSpacing, meta)}` : '')
        : null,
      h('p', { class: 'muted small' }, `${lay.towers.length} towers · ${formatLength(lay.length, meta)} of wall`),
      h('div', { class: 'gates-head muted small' }, h('span', {}, 'Gate id'), h('span', {}, 'Name'), h('span', {}, 'Position'), h('span', {})),
      gates,
      h('button', { class: 'btn btn-small', onclick: addGate }, icon('plus'), 'Add gate'));
  }

  function render() {
    renderKeepingFocus(body, () => {
      clear(body);
      const items = selectedItems();
      if (!items.length) renderNone();
      else if (items.length > 1) renderMulti(items);
      else if (items[0].hit.kind === 'poi') renderPoi(items[0].hit);
      else if (items[0].hit.kind === 'feature') renderFeature(items[0].hit);
      else renderNone();
    });
  }

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  };
  on('selection', schedule);
  on('doc', (d) => { if (!d?.live) schedule(); });
  on('focus-field', (name) => {
    emit('show-tab', 'inspector');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = body.querySelector(`[name="${name}"]`);
      if (el) { el.focus(); el.select?.(); }
    }));
  });
  render();
}
