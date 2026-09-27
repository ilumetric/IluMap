// Map settings: meta (name, units, flipY, land mode), bounds, grid, background image.
// Shown in the Inspector panel while nothing is selected.

import { store, on, change, emit } from '../state.js';
import { LAND_MODES } from '../../core/schema.js';
import { fitPairs } from '../../core/calibration.js';
import { t, label, onLangChange } from '../i18n/index.js';
import { fmtLength, unitLabel } from '../i18n/format.js';
import { h, clear, renderKeepingFocus, toast } from '../dom.js';
import { pickBackgroundImage } from '../io.js';

function input(name, value, onCommit, attrs = {}) {
  const el = h('input', { name, value: value ?? '', autocomplete: 'off', ...attrs });
  el.addEventListener('change', () => onCommit(attrs.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  return el;
}
const field = (label, el, hint) => h('label', { class: 'field' }, h('span', {}, label), el, hint ? h('small', { class: 'hint' }, hint) : null);

export function mountMapSettings(root, { canvas }) {
  const body = h('div', { class: 'map-panel' });
  root.append(body);

  function render() {
    renderKeepingFocus(body, () => {
      clear(body);
      const doc = store.doc;
      const m = doc.meta;
      const b = doc.view.bounds;
      const bg = doc.view.background;
      const setMeta = (k) => (v) => change((d) => { d.meta[k] = v; });

      const flip = h('input', { type: 'checkbox', name: 'flipY', checked: !!m.flipY });
      flip.addEventListener('change', () => { change((d) => { d.meta.flipY = flip.checked; }); emit('background'); });
      const landMode = h('select', { name: 'landMode' }, LAND_MODES.map((v) => h('option', { value: v, selected: m.landMode === v }, t(`map.landModes.${v}`))));
      landMode.addEventListener('change', () => setMeta('landMode')(landMode.value));

      const boundsIn = (i, j, name) => input(name, (j ? b.max : b.min)[i], (v) => {
        if (v == null) return;
        const nb = { min: b.min.slice(), max: b.max.slice() };
        (j ? nb.max : nb.min)[i] = v;
        if (!(nb.min[0] < nb.max[0] && nb.min[1] < nb.max[1])) { toast(t('toast.boundsOrder'), { type: 'error' }); render(); return; }
        change((d) => { d.view.bounds = nb; });
        canvas.fit();
      }, { type: 'number', step: 'any' });

      const gridVis = h('input', { type: 'checkbox', name: 'gridVisible', checked: doc.view.grid.visible !== false });
      gridVis.addEventListener('change', () => change((d) => { d.view.grid.visible = gridVis.checked; }));

      body.append(
        h('section', { class: 'insp-section' }, h('h4', {}, t('map.section')),
          field(t('map.name'), input('mapName2', m.name, setMeta('name'))),
          field(t('map.description'), (() => {
            const t = h('textarea', { name: 'description', rows: 3 });
            t.value = m.description || '';
            t.addEventListener('change', () => setMeta('description')(t.value));
            return t;
          })()),
          h('div', { class: 'row2' },
            field(t('map.units'), input('units', m.units, setMeta('units'), { placeholder: 'cm', title: t('map.unitsTitle') })),
            field(t('map.displayUnit'), input('displayUnit', m.displayUnit, setMeta('displayUnit'), { placeholder: 'm', title: t('map.displayUnitTitle') }))),
          field(t('map.unitsPer', { units: unitLabel(m.units), display: unitLabel(m.displayUnit) }), input('displayUnitScale', m.displayUnitScale, (v) => { if (v > 0) setMeta('displayUnitScale')(v); else toast(t('toast.mustBePositive'), { type: 'error' }); }, { type: 'number', min: 0, step: 'any' })),
          h('label', { class: 'check' }, flip, h('span', {}, t('map.flipY'))),
          field(t('map.landMode'), landMode)),
        h('section', { class: 'insp-section' }, h('h4', {}, t('map.boundsGrid')),
          h('div', { class: 'row2' }, field(t('map.minX'), boundsIn(0, 0, 'bminx')), field(t('map.minY'), boundsIn(1, 0, 'bminy'))),
          h('div', { class: 'row2' }, field(t('map.maxX'), boundsIn(0, 1, 'bmaxx')), field(t('map.maxY'), boundsIn(1, 1, 'bmaxy'))),
          h('p', { class: 'muted small' }, t('map.boundsSize', { w: fmtLength(b.max[0] - b.min[0], m), h: fmtLength(b.max[1] - b.min[1], m) })),
          h('div', { class: 'row2' },
            field(t('map.gridStep', { units: unitLabel(m.units) }), input('gridStep', doc.view.grid.step, (v) => { if (v > 0) change((d) => { d.view.grid.step = v; }); }, { type: 'number', min: 0, step: 'any' }), fmtLength(doc.view.grid.step, m)),
            h('label', { class: 'check' }, gridVis, h('span', {}, t('map.showGrid'))))),
      );

      const bgSec = h('section', { class: 'insp-section' }, h('h4', {}, t('background.title')));
      const kept = store.project?.backgroundBlobKey ? ` ${t('background.kept')}` : '';
      if (bg) {
        const op = h('input', { type: 'range', name: 'bgOpacity', min: 0, max: 1, step: 0.05, value: bg.opacity ?? 0.6 });
        op.addEventListener('input', () => { store.doc.view.background.opacity = Number(op.value); emit('background'); });
        op.addEventListener('change', () => {
          const v = Number(op.value);
          store.doc.view.background.opacity = bg.opacity ?? 0.6;
          change((d) => { d.view.background.opacity = v; });
          emit('background');
        });
        const st = store.background;
        bgSec.append(
          field(t('background.source'), input('bgSrc', bg.src, (v) => { change((d) => { d.view.background.src = v; }); }), st?.url ? `${t('background.loaded', { w: String(st.width), h: String(st.height) })}${kept}` : t('background.notLoaded')),
          field(t('background.opacity'), op),
          h('p', { class: 'muted small mono' }, (bg.calibration || []).map((c, i) => `#${i + 1} px(${c.px.join(', ')}) → world(${c.world.join(', ')})`).join('\n') || t('background.notCalibrated')),
          h('div', { class: 'insp-actions' },
            h('button', { class: 'btn btn-small', onclick: () => emit('set-tool', 'calibrate') }, `${t('background.calibrate')} (K)`),
            h('button', {
              class: 'btn btn-small', disabled: !st?.url, title: t('background.fitTitle'),
              onclick: () => change((d) => { d.view.background.calibration = fitPairs(d.view.bounds, st.width, st.height, !!d.meta.flipY); }),
            }, t('background.fitBounds')),
            h('button', { class: 'btn btn-small', onclick: pickBackgroundImage }, t('background.replace')),
            h('button', { class: 'btn btn-small btn-danger', onclick: () => { change((d) => { delete d.view.background; }); store.background = null; emit('background'); } }, t('background.remove'))));
      } else {
        bgSec.append(h('p', { class: 'muted small' }, t('background.mapHint')),
          h('button', { class: 'btn btn-small', onclick: pickBackgroundImage }, t('background.load')));
      }
      body.append(bgSec);
    });
  }

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  };
  on('doc', (d) => { if (!d?.live) schedule(); });
  on('background', schedule);
  onLangChange(schedule);
  render();
}
