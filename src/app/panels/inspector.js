// Inspector for the current selection (POI, feature incl. walls, or multi-selection).

import { store, on, change, select, emit, selectedItems } from '../state.js';
import { POI_STATUSES, LAYER_KIND, LAYERS, TOWER_MODES, DEFAULT_WALL } from '../../core/schema.js';
import { resolveStyle, typeGroupForLayer, poiStyle } from '../../core/styles.js';
import { findById, renameId, removeById, zoneOf, isLand, allIds, slugify, isValidId } from '../../core/model.js';
import { polylineLength, polygonArea, centroid, featureGeometry, wallLayout } from '../../core/geometry.js';
import { t, plural, label, onLangChange } from '../i18n/index.js';
import { fmtLength, fmtArea, unitLabel } from '../i18n/format.js';
import { layerLabel, typeLabel } from '../ui/layer-meta.js';
import { h, clear, toast, renderKeepingFocus } from '../dom.js';
import { icon } from '../ui/icons.js';
import { renderLinks } from './links.js';
import { iconButton } from '../ui/poi-icons.js';

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
  const clearBtn = h('button', { class: 'icon-btn', title: t('inspector.clearColour'), 'aria-label': t('inspector.clearColour'), disabled: !value, onclick: () => onCommit(null) }, '×');
  return h('span', { class: 'color-override' }, input, h('span', { class: 'muted small' }, value || t('inspector.typeColour')), clearBtn);
}

/** Suggestions for a free-text field; `labelOf` shows a localised name next to the raw value. */
function datalist(id, values, labelOf = null) {
  return h('datalist', { id }, values.map((v) => {
    const l = labelOf ? labelOf(v) : null;
    return h('option', { value: v }, l && l !== v ? l : null);
  }));
}

function tagsInput(name, tags, onCommit) {
  return text(name, (tags || []).join(', '), (v) => onCommit(v.split(',').map((s) => s.trim()).filter(Boolean)), { placeholder: t('inspector.tagsPlaceholder') });
}

function idInput(id) {
  return text('id', id, (v) => {
    const nv = v.trim();
    if (nv === id) return;
    const problem = idProblem(nv);
    if (problem) { toast(problem, { type: 'error' }); emit('selection'); return; }
    try {
      change((doc) => renameId(doc, id, nv));
      select(nv);
      toast(t('toast.renamedId', { from: id, to: nv }), { type: 'ok' });
    } catch (e) {
      toast(e.message, { type: 'error' });
      emit('selection');
    }
  }, { class: 'mono', pattern: '[a-z0-9_]+', title: t('inspector.idTitle') });
}

/** Localised reason why an id cannot be used (the core throws English messages). */
function idProblem(nv) {
  if (!isValidId(nv)) return t('toast.idInvalid', { id: nv });
  if (allIds(store.doc).has(nv)) return t('toast.idUsed', { id: nv });
  return null;
}

function section(title, ...children) {
  return h('section', { class: 'insp-section' }, h('h4', {}, title), ...children);
}

export function mountInspector(root, { canvas, mapSettings }) {
  const body = h('div', { class: 'inspector' });
  root.append(body);
  if (mapSettings) root.append(mapSettings);

  function centerOn(hit) {
    if (hit.kind === 'poi') { if (hit.item.placed !== false) canvas.centerOn([hit.item.x, hit.item.y]); return; }
    const f = hit.item;
    if (!f.points.length) return;
    canvas.centerOn(LAYER_KIND[hit.layer] === 'polygon' ? centroid(f.points) : f.points[Math.floor(f.points.length / 2)]);
  }

  function actions(hit) {
    return h('div', { class: 'insp-actions' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => centerOn(hit) }, icon('target'), t('inspector.center')),
      h('button', { class: 'btn btn-small btn-danger', onclick: () => change((doc) => removeById(doc, hit.item.id)) }, icon('trash'), t('inspector.delete')));
  }

  function renderNone() {
    const doc = store.doc;
    const nf = LAYERS.reduce((n, l) => n + doc.layers[l].length, 0);
    body.append(
      h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind' }, t('inspector.kindMap')), h('span', { class: 'insp-title' }, doc.meta.name || t('common.untitled'))),
      h('div', { class: 'insp-empty' },
        h('p', { class: 'muted small' }, t('inspector.nothingSelected', {
          counts: [plural('count.pois', doc.pois.length), plural('count.features', nf), plural('count.links', doc.links.length)].join(' · '),
        }))));
  }

  function renderMulti(items) {
    body.append(h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind' }, t('inspector.kindSelection')), h('span', { class: 'insp-title' }, plural('count.items', items.length))));
    const ul = h('ul', { class: 'multi-list' });
    for (const { id, hit } of items) {
      ul.append(h('li', {},
        h('span', { class: 'tag' }, hit.kind === 'poi' ? t('inspector.kindPoi') : layerLabel(hit.layer)),
        h('button', { class: 'link-target', onclick: () => select(id) }, hit.item.name || id, h('small', {}, ` ${id}`)),
        h('button', { class: 'icon-btn', title: t('inspector.unselect'), 'aria-label': t('inspector.unselect'), onclick: () => select(id, { toggle: true }) }, '×')));
    }
    body.append(ul, h('div', { class: 'insp-actions' },
      h('button', { class: 'btn btn-small btn-danger', onclick: () => change((doc) => { for (const { id } of items) removeById(doc, id); }) }, icon('trash'), t('inspector.deleteN', { n: items.length }))));
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

    body.append(h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind', style: { background: ps.color } }, t('inspector.kindPoi')), h('span', { class: 'insp-title' }, p.name)));
    body.append(datalist('dl-poi-types', types, (v) => label('poiTypes', v)));
    const zoneHint = p.placed === false
      ? t('inspector.notPlaced')
      : `${auto ? t('inspector.insideZone', { zone: zones.find((z) => z.id === auto)?.name || auto }) : t('inspector.outsideZones')} · ${onLand ? t('inspector.onLand') : t('inspector.inWater')}`;
    const typeHint = label('poiTypes', p.type) !== p.type ? label('poiTypes', p.type) : null;
    body.append(
      section(t('inspector.identity'),
        field(t('inspector.id'), idInput(id)),
        field(t('inspector.name'), text('name', p.name, (v) => edit(id, (it) => { it.name = v || it.id; }))),
        h('div', { class: 'row2' },
          field(t('inspector.type'), text('type', p.type, (v) => { store.prefs.poiType = v || 'poi'; edit(id, (it) => { it.type = v || 'poi'; }); }, { list: 'dl-poi-types' }), typeHint),
          field(t('inspector.status'), sel('status', p.status || 'idea', POI_STATUSES.map((s) => [s, label('status', s)]), (v) => edit(id, (it) => { it.status = v; })))),
        h('div', { class: 'row2' },
          field(t('inspector.icon'), iconButton({
            name: 'icon', value: p.icon || null, color: ps.color, withLabel: true,
            inherit: rs.poiTypes[p.type]?.icon || 'dot',
            inheritLabel: t('inspector.iconFromType', { icon: label('poiIcons', rs.poiTypes[p.type]?.icon || 'dot') }),
            title: t('inspector.iconHint'), pickerTitle: t('inspector.icon'),
            onPick: (v) => edit(id, (it) => { if (v) it.icon = v; else delete it.icon; }),
          })),
          field(t('inspector.colour'), colorOverride('color', p.color, ps.color, (v) => edit(id, (it) => { if (v) it.color = v; else delete it.color; })))),
        h('div', { class: 'row-zone' },
          field(t('inspector.zone'), sel('zone', p.zone || '', [['', t('inspector.noZone')], ...zones.map((z) => [z.id, z.name ? `${z.name} (${z.id})` : z.id])],
            (v) => edit(id, (it) => { if (v) it.zone = v; else delete it.zone; })), zoneHint),
          h('button', {
            class: 'btn btn-small', title: t('inspector.autoZoneTitle'), disabled: p.placed === false,
            onclick: () => edit(id, (it) => { if (auto) it.zone = auto; else delete it.zone; }),
          }, t('inspector.autoZone')))),
      section(t('inspector.position'),
        h('div', { class: 'row2' },
          field(`X (${unitLabel(doc.meta.units)})`, num('x', p.x, (v) => v != null && edit(id, (it) => { it.x = v; const z = zoneOf(store.doc, [it.x, it.y]); if (z) it.zone = z; }))),
          field(`Y (${unitLabel(doc.meta.units)})`, num('y', p.y, (v) => v != null && edit(id, (it) => { it.y = v; const z = zoneOf(store.doc, [it.x, it.y]); if (z) it.zone = z; })))),
        check('placed', p.placed !== false, t('inspector.placed'), (v) => edit(id, (it) => { if (v) delete it.placed; else it.placed = false; }))),
      section(t('inspector.details'),
        field(t('inspector.tags'), tagsInput('tags', p.tags, (v) => edit(id, (it) => { if (v.length) it.tags = v; else delete it.tags; }))),
        field(t('inspector.notes'), area('notes', p.notes, (v) => edit(id, (it) => { if (v) it.notes = v; else delete it.notes; }))),
        field(t('inspector.anchor'), text('anchor', p.anchor, (v) => edit(id, (it) => { if (v.trim()) it.anchor = v.trim(); else delete it.anchor; }), { placeholder: t('inspector.anchorPlaceholder') }))),
      section(t('inspector.links'), renderLinks(id)),
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
      ? t('inspector.statsPolygon', { points: plural('count.points', f.points.length), area: fmtArea(polygonArea(geo), meta), perimeter: fmtLength(polylineLength(geo, true), meta) })
      : t('inspector.statsLine', { points: plural('count.points', f.points.length), length: fmtLength(polylineLength(geo, closed), meta) });
    const sameKind = LAYERS.filter((l) => LAYER_KIND[l] === kind);

    body.append(h('div', { class: 'insp-head' }, h('span', { class: 'insp-kind' }, layerLabel(layer)), h('span', { class: 'insp-title' }, f.name || f.id)));
    body.append(datalist('dl-feature-types', types, (v) => label(group, v)));
    const typeHint = f.type && label(group, f.type) !== f.type ? label(group, f.type) : null;
    body.append(
      section(t('inspector.identity'),
        field(t('inspector.id'), idInput(id)),
        field(t('inspector.name'), text('name', f.name, (v) => edit(id, (it) => { if (v.trim()) it.name = v; else delete it.name; }), { placeholder: t('inspector.namePlaceholder') })),
        h('div', { class: 'row2' },
          field(t('inspector.type'), text('type', f.type, (v) => edit(id, (it) => {
            if (v.trim()) it.type = v.trim(); else delete it.type;
            if (layer === 'zones' && v.trim()) store.prefs.lastZoneType = v.trim();
          }), { list: 'dl-feature-types', placeholder: t('inspector.typePlaceholder') }), typeHint),
          field(t('inspector.layer'), sel('layer', layer, sameKind.map((l) => [l, layerLabel(l)]), (v) => {
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
      section(t('inspector.shape'),
        h('div', { class: 'checks' },
          check('smooth', f.smooth, t('inspector.smooth'), (v) => edit(id, (it) => { if (v) it.smooth = true; else delete it.smooth; })),
          kind === 'line' ? check('closed', f.closed, t('inspector.closed'), (v) => edit(id, (it) => { if (v) it.closed = true; else delete it.closed; })) : null,
          check('hidden', f.hidden, t('inspector.hidden'), (v) => edit(id, (it) => { if (v) it.hidden = true; else delete it.hidden; }))),
        kind === 'line' || layer === 'walls'
          ? field(t('inspector.width', { units: unitLabel(meta.units) }), num('width', f.width, (v) => edit(id, (it) => { if (v > 0) it.width = v; else delete it.width; }), { min: 0, placeholder: t('inspector.widthPlaceholder') }),
            f.width ? t('inspector.widthHint', { length: fmtLength(f.width, meta) }) : t('inspector.widthEmptyHint'))
          : null,
        field(t('inspector.colour'), colorOverride('color', f.color, layer === 'zones' ? rs.zoneTypes[f.type]?.fill : (rs.layers[layer]?.stroke || rs.layers[layer]?.fill), (v) => edit(id, (it) => { if (v) it.color = v; else delete it.color; }))),
        h('p', { class: 'muted small stats' }, stats)),
    );

    if (layer === 'walls') body.append(renderWall(f));

    body.append(
      section(t('inspector.details'),
        field(t('inspector.tags'), tagsInput('tags', f.tags, (v) => edit(id, (it) => { if (v.length) it.tags = v; else delete it.tags; }))),
        field(t('inspector.notes'), area('notes', f.notes, (v) => edit(id, (it) => { if (v) it.notes = v; else delete it.notes; })))),
      section(t('inspector.points'),
        field(t('inspector.pointsField', { units: unitLabel(meta.units) }), area('points', f.points.map((p) => `${fmtN(p[0])}, ${fmtN(p[1])}`).join('\n'), (v) => {
          const pts = v.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[\s,;]+/).map(Number));
          if (pts.some((p) => p.length !== 2 || !p.every(Number.isFinite))) { toast(t('toast.pointsFormat'), { type: 'error' }); emit('selection'); return; }
          const min = kind === 'polygon' ? 3 : 2;
          if (pts.length < min) { toast(plural('toast.needPoints', min), { type: 'error' }); emit('selection'); return; }
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
          const problem = idProblem(nv);
          if (problem) { toast(problem, { type: 'error' }); emit('selection'); return; }
          try { change((doc) => renameId(doc, g.id, nv)); } catch (e) { toast(e.message, { type: 'error' }); emit('selection'); }
        }, { class: 'mono', title: t('inspector.gateIdTitle'), placeholder: t('inspector.gateIdPlaceholder') }),
        text(`gate-name-${i}`, g.name, (v) => setWall((wl) => { if (v.trim()) wl.gates[i].name = v.trim(); else delete wl.gates[i].name; }), { placeholder: t('inspector.gateNamePlaceholder') }),
        sel(`gate-mode-${i}`, mode, [['at', t('inspector.gateAtVertex')], ['t', t('inspector.gateAtFraction')]], (v) => setWall((wl) => {
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
        h('button', { class: 'icon-btn danger', title: t('inspector.removeGate'), 'aria-label': t('inspector.removeGate'), onclick: () => change((doc) => removeById(doc, g.id)) }, icon('trash'))));
    });
    const addGate = () => {
      const base = `gate_${id.replace(/^wall_/, '')}`;
      const gid = slugify(base, allIds(store.doc));
      setWall((wl) => { wl.gates = [...(wl.gates || []), { id: gid, name: 'Gate', at: 0 }]; });
    };
    return section(t('inspector.wall'),
      h('div', { class: 'row2' },
        field(t('inspector.towers'), sel('towers', w.towers || 'vertices', TOWER_MODES.map((m) => [m, label('towerModes', m)]), (v) => setWall((wl) => { wl.towers = v; }))),
        field(t('inspector.towerSize', { units: unitLabel(meta.units) }), num('towerSize', w.towerSize, (v) => setWall((wl) => { if (v > 0) wl.towerSize = v; }), { min: 0 }))),
      (w.towers || 'vertices') === 'auto'
        ? field(t('inspector.towerSpacing', { units: unitLabel(meta.units) }), num('towerSpacing', w.towerSpacing, (v) => setWall((wl) => { if (v > 0) wl.towerSpacing = v; }), { min: 0 }), w.towerSpacing ? `= ${fmtLength(w.towerSpacing, meta)}` : '')
        : null,
      h('p', { class: 'muted small' }, t('inspector.wallStats', { towers: plural('count.towers', lay.towers.length), length: fmtLength(lay.length, meta) })),
      h('div', { class: 'gates-head muted small' }, h('span', {}, t('inspector.gateId')), h('span', {}, t('inspector.gateName')), h('span', {}, t('inspector.gatePosition')), h('span', {})),
      gates,
      h('button', { class: 'btn btn-small', onclick: addGate }, icon('plus'), t('inspector.addGate')));
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
      if (mapSettings) mapSettings.hidden = items.length > 0;
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
  onLangChange(schedule);
  on('focus-field', (name) => {
    emit('open-panel', 'inspector');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = body.querySelector(`[name="${name}"]`);
      if (el) { el.focus(); el.select?.(); }
    }));
  });
  render();
}
