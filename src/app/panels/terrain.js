// Terrain panel: calculator for Unreal Engine Mesh Terrain (MeshPartition
// "Create Rectangle" / "Import Heightmap"). Size comes from the map bounds;
// the chosen grid is stored in map.json → terrain (see core/terrain.js), so
// people and agents read the same numbers. Also toggles the section / quad
// overlay on the canvas and exports masks sized to the grid.

import { store, on, change, savePrefs, emit } from '../state.js';
import {
  terrainOf, computeTerrain, terrainBlock, terrainSize, resolutionForQuad, explicitFor, autoSections,
  quadOptions, unrealSettingsText, QUAD_PRESETS, SECTION_PRESETS, DEFAULT_MAX_TRIANGLES,
} from '../../core/terrain.js';
import { h, clear, renderKeepingFocus, toast } from '../dom.js';
import { icon } from '../ui/icons.js';
import { t, onLangChange } from '../i18n/index.js';
import { fmtLength, fmtNum, unitLabel } from '../i18n/format.js';
import { exportMasks } from '../io.js';

function numInput(name, value, onCommit, attrs = {}) {
  const el = h('input', { type: 'number', name, value: value ?? '', step: 'any', autocomplete: 'off', ...attrs });
  el.addEventListener('change', () => { if (el.value !== '' && Number.isFinite(Number(el.value))) onCommit(Number(el.value)); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  return el;
}
const field = (label, ...els) => h('label', { class: 'field' }, h('span', {}, label), ...els);
const pairRow = (label, a, b, suffix) => h('div', { class: 'field' }, h('span', {}, label), h('div', { class: 'tr-pair' }, a, h('span', { class: 'muted' }, '×'), b, suffix ? h('span', { class: 'muted small tr-suffix' }, suffix) : null));

export function mountTerrain(root, { canvas }) {
  const body = h('div', { class: 'terrain-panel' });
  root.append(body);

  /** Store a new terrain block (one undo step). */
  const commit = (tr) => change((d) => { d.terrain = terrainBlock(tr); });
  /** Apply a requested quad size: a resolution in automatic mode, a layout in explicit mode. */
  const applyQuad = (tr, size, q) => {
    store.prefs.terrainTargetQuad = q;
    savePrefs();
    const res = resolutionForQuad(size, q);
    if (tr.sections.mode === 'explicit') commit({ ...tr, sections: { mode: 'explicit', ...explicitFor(res, tr.sections.resolution) } });
    else commit({ ...tr, resolution: res });
  };

  function render() {
    renderKeepingFocus(body, () => {
      clear(body);
      const doc = store.doc;
      const meta = doc.meta;
      const u = unitLabel(meta.units);
      const size = terrainSize(doc);
      const tr = terrainOf(doc);
      const c = computeTerrain(doc, tr);
      const L = (v) => fmtLength(v, meta);
      // below one display unit (1 m) quad sizes read better in world units (25 cm, not 0,3 m)
      const quadLabel = (q) => (q < (meta.displayUnitScale || 100) ? `${fmtNum(q)} ${u}` : L(q));
      const N = (v) => fmtNum(v);
      const explicit = tr.sections.mode === 'explicit';

      // --- not stored yet
      if (!doc.terrain) {
        body.append(h('div', { class: 'tr-note' },
          h('span', {}, t('terrain.notStored')),
          h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => commit(tr) }, t('terrain.store'))));
      }

      // --- map size (bounds)
      const setSize = (i) => (v) => {
        if (!(v > 0)) return;
        change((d) => {
          const b = d.view.bounds;
          b.max[i] = b.min[i] + v;
          if (d.terrain) d.terrain = terrainBlock(terrainOf(d)); // keep the stored block canonical
        });
        canvas.fit();
      };
      body.append(h('section', { class: 'insp-section' },
        h('h4', {}, t('terrain.size')),
        pairRow(t('terrain.sizeField', { units: u }),
          numInput('tr-size-x', size[0], setSize(0), { min: 1 }),
          numInput('tr-size-y', size[1], setSize(1), { min: 1 }),
          `${L(size[0])} × ${L(size[1])}`),
        h('p', { class: 'muted small' }, t('terrain.sizeHint'))));

      // --- mesh resolution / quad size
      const quadIn = numInput('tr-quad', Math.round(c.quad[0] * 100) / 100, (q) => { if (q > 0) applyQuad(tr, size, q); }, { min: 0.01 });
      const resIn = (i) => numInput(`tr-res-${i ? 'y' : 'x'}`, c.resolution[i], (v) => {
        const r = Math.max(1, Math.round(v));
        const res = c.resolution.slice();
        res[i] = r;
        // keep quads square: the other axis follows
        if (store.prefs.terrainSquare !== false) res[1 - i] = Math.max(1, Math.round(size[1 - i] / (size[i] / r)));
        if (explicit) commit({ ...tr, sections: { mode: 'explicit', ...explicitFor(res, tr.sections.resolution) } });
        else commit({ ...tr, resolution: res });
      }, { min: 1, step: 1, disabled: explicit });
      const square = h('input', { type: 'checkbox', name: 'tr-square', checked: store.prefs.terrainSquare !== false });
      square.addEventListener('change', () => { store.prefs.terrainSquare = square.checked; savePrefs(); });
      const chips = h('div', { class: 'tr-chips' }, QUAD_PRESETS.map((q) => h('button', {
        type: 'button', class: `chip-btn${Math.abs(c.quad[0] - q) < 0.005 * q ? ' on' : ''}`,
        title: t('terrain.quadPresetTitle', { size: quadLabel(q) }),
        onclick: () => applyQuad(tr, size, q),
      }, quadLabel(q))));
      body.append(h('section', { class: 'insp-section' },
        h('h4', {}, t('terrain.mesh')),
        field(t('terrain.quadField', { units: u }), quadIn, h('small', { class: 'hint' }, t('terrain.quadHint'))),
        chips,
        pairRow(t('terrain.resolution'), resIn(0), resIn(1), t('terrain.quads')),
        explicit ? h('p', { class: 'muted small' }, t('terrain.resolutionExplicit')) : null,
        h('label', { class: 'check' }, square, h('span', {}, t('terrain.square')))));

      // --- sections
      const mode = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('terrain.generation') },
        ['automatic', 'explicit'].map((m) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(tr.sections.mode === m), class: `seg-btn${tr.sections.mode === m ? ' on' : ''}`,
          onclick: () => {
            if (m === tr.sections.mode) return;
            if (m === 'explicit') {
              // start from the automatic estimate, snapped to a common section size
              const est = autoSections(c.resolution, tr.sections.maxTriangles);
              const sr = SECTION_PRESETS.reduce((best, p) => (Math.abs(p - est.resolution[0]) < Math.abs(best - est.resolution[0]) ? p : best), 256);
              commit({ ...tr, sections: { mode: 'explicit', ...explicitFor(c.resolution, [sr, sr]) } });
            } else {
              commit({ ...tr, resolution: c.resolution, sections: { mode: 'automatic', maxTriangles: DEFAULT_MAX_TRIANGLES } });
            }
          },
        }, t(`terrain.modes.${m}`))));
      const secBox = h('section', { class: 'insp-section' }, h('h4', {}, t('terrain.sections')), field(t('terrain.generation'), mode));
      if (explicit) {
        const s = tr.sections;
        const layIn = (i) => numInput(`tr-layout-${i ? 'y' : 'x'}`, s.layout[i], (v) => {
          const layout = s.layout.slice();
          layout[i] = Math.max(1, Math.round(v));
          commit({ ...tr, sections: { ...s, layout } });
        }, { min: 1, step: 1 });
        const srIn = (i) => numInput(`tr-secres-${i ? 'y' : 'x'}`, s.resolution[i], (v) => {
          const sr = s.resolution.slice();
          sr[i] = Math.max(1, Math.round(v));
          if (store.prefs.terrainSquare !== false) sr[1 - i] = sr[i];
          commit({ ...tr, sections: { ...s, resolution: sr } });
        }, { min: 1, step: 1, list: 'tr-secres-presets' });
        secBox.append(
          h('datalist', { id: 'tr-secres-presets' }, SECTION_PRESETS.map((p) => h('option', { value: p }))),
          pairRow(t('terrain.layout'), layIn(0), layIn(1), t('terrain.sectionsUnit')),
          pairRow(t('terrain.sectionResolution'), srIn(0), srIn(1), t('terrain.quads')),
          h('button', {
            type: 'button', class: 'btn btn-small', title: t('terrain.fitLayoutTitle'),
            onclick: () => applyQuad(tr, size, Number(store.prefs.terrainTargetQuad) || c.quad[0]),
          }, t('terrain.fitLayout')));
      } else {
        secBox.append(field(t('terrain.maxTriangles'), numInput('tr-maxtri', tr.sections.maxTriangles, (v) => {
          commit({ ...tr, sections: { mode: 'automatic', maxTriangles: Math.max(2, Math.round(v)) } });
        }, { min: 2, step: 1 }), h('small', { class: 'hint' }, t('terrain.maxTrianglesHint'))));
      }
      body.append(secBox);

      // --- heightmap
      body.append(h('section', { class: 'insp-section' },
        h('h4', {}, t('terrain.heightmap')),
        field(t('terrain.heightRange', { units: u }), numInput('tr-z', tr.heightRange, (v) => { if (v > 0) commit({ ...tr, heightRange: v }); }, { min: 1 }),
          h('small', { class: 'hint' }, t('terrain.heightRangeHint', { range: L(tr.heightRange), step: L(c.zStep) })))));

      // --- results
      const sec = c.sections;
      const stat = (k, v, sub) => h('div', { class: 'tr-stat' }, h('span', { class: 'tr-k' }, k), h('span', { class: 'tr-v' }, v), sub ? h('span', { class: 'tr-sub' }, sub) : null);
      const warn = c.warnings.map((w) => h('p', { class: 'tr-warn' }, icon('alert'), h('span', {}, t(`terrain.warn.${w}`))));
      body.append(h('section', { class: 'insp-section tr-result' },
        h('h4', {}, t('terrain.result')),
        h('div', { class: 'tr-quad' },
          h('span', { class: 'tr-quad-k' }, t('terrain.oneQuad')),
          h('span', { class: 'tr-quad-v' }, c.square ? L(c.quad[0]) : `${L(c.quad[0])} × ${L(c.quad[1])}`),
          h('span', { class: 'tr-sub mono' }, `${fmtNum(c.quad[0], 2)} × ${fmtNum(c.quad[1], 2)} ${u}`)),
        h('div', { class: 'tr-stats' },
          stat(t('terrain.grid'), `${N(c.resolution[0])} × ${N(c.resolution[1])}`, t('terrain.quads')),
          stat(t('terrain.triangles'), N(c.triangles), t('terrain.verticesN', { n: N(c.vertices) })),
          stat(sec.estimated ? t('terrain.sectionsEstimated') : t('terrain.sections'), `${N(sec.layout[0])} × ${N(sec.layout[1])} = ${N(sec.count)}`,
            t('terrain.sectionEach', { res: `${N(sec.resolution[0])} × ${N(sec.resolution[1])}`, size: L(sec.size[0]) })),
          stat(t('terrain.trianglesPerSection'), N(sec.trianglesPerSection), sec.estimated ? t('terrain.maxN', { n: N(sec.maxTriangles) }) : ''),
          stat(t('terrain.heightmapPx'), `${N(c.heightmap.width)} × ${N(c.heightmap.height)}`, t('terrain.heightmapHint'))),
        ...warn));

      // --- for Unreal
      const txt = unrealSettingsText(c);
      body.append(h('section', { class: 'insp-section' },
        h('h4', {}, t('terrain.forUnreal')),
        h('pre', { class: 'tr-pre mono' }, txt),
        h('div', { class: 'insp-actions' },
          h('button', {
            type: 'button', class: 'btn btn-small',
            onclick: async () => {
              try { await navigator.clipboard.writeText(txt); toast(t('terrain.copied'), { type: 'ok' }); } catch { toast(t('terrain.copyFailed'), { type: 'warn' }); }
            },
          }, icon('clipboard'), t('terrain.copy')),
          h('button', {
            type: 'button', class: 'btn btn-small', title: t('terrain.masksTitle'),
            onclick: () => exportMasks('all', { size: Math.max(c.heightmap.width, c.heightmap.height) }),
          }, icon('mask'), t('terrain.masks', { px: N(Math.max(c.heightmap.width, c.heightmap.height)) })))));

      // --- options
      const table = h('table', { class: 'style-table tr-options' },
        h('tr', {}, h('th', {}, t('terrain.optQuad')), h('th', {}, t('terrain.optGrid')), h('th', {}, t('terrain.optTriangles')), h('th', {}, t('terrain.optSections'))));
      for (const o of quadOptions(doc)) {
        const on = Math.abs(o.quad[0] - c.quad[0]) <= 0.02 * o.quad[0];
        table.append(h('tr', {
          class: `tr-opt${on ? ' on' : ''}${o.triangles > 64e6 ? ' heavy' : ''}`, tabindex: '0', title: t('terrain.optApply'),
          onclick: () => applyQuad(tr, size, o.quadTarget),
          onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); },
        }, h('td', {}, quadLabel(o.quadTarget)), h('td', { class: 'mono' }, `${N(o.resolution[0])}²`), h('td', { class: 'mono' }, N(o.triangles)), h('td', { class: 'mono' }, `~${N(o.sections.count)}`)));
      }
      body.append(h('section', { class: 'insp-section' }, h('h4', {}, t('terrain.options')), h('p', { class: 'muted small' }, t('terrain.optionsHint')), table));

      // --- overlay
      const ov = h('input', { type: 'checkbox', name: 'tr-overlay', checked: !!store.prefs.terrainOverlay });
      ov.addEventListener('change', () => { store.prefs.terrainOverlay = ov.checked; savePrefs(); emit('terrain-overlay'); });
      body.append(h('section', { class: 'insp-section' },
        h('label', { class: 'check' }, ov, h('span', {}, t('terrain.overlay'))),
        h('p', { class: 'muted small' }, t('terrain.overlayHint'))));
    });
  }

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  };
  on('doc', (d) => { if (!d?.live) schedule(); });
  onLangChange(schedule);
  render();
}
