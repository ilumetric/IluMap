// UI theme (System / Dark / Light, independent of the map's style preset) and
// the Settings dialog. The theme is stored under its own localStorage key so
// the inline script in index.html can apply it before first paint.

import { store, savePrefs, emit } from './state.js';
import { PRESETS } from '../core/styles.js';
import { h, openDialog } from './dom.js';
import { icon } from './ui/icons.js';
import { persistent } from './projects.js';
import { clearAllProjects } from './session.js';
import { APP_VERSION, DOCS_URL } from './version.js';

const THEME_KEY = 'ilumap.uiTheme';
const THEMES = [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']];
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

export function getThemePref() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.some(([k]) => k === v) ? v : 'system';
  } catch { return 'system'; }
}

/** Resolve System to dark/light and set data-ui-theme on <html>. */
export function applyTheme(pref = getThemePref()) {
  const resolved = pref === 'system' ? (media?.matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.uiTheme = resolved;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', resolved);
  emit('theme', resolved);
}

function setThemePref(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* ignore */ }
  applyTheme(pref);
}

media?.addEventListener?.('change', () => { if (getThemePref() === 'system') applyTheme('system'); });

export async function openSettings() {
  const clearBtn = h('button', {
    type: 'button', class: 'btn btn-small btn-danger',
    onclick: async () => {
      document.querySelector('#dialogs .backdrop:last-child .dialog-head .icon-btn')?.click(); // close Settings first
      await clearAllProjects();
    },
  }, icon('trash'), 'Clear local maps…');
  const footer = h('div', { class: 'settings-extra' },
    h('section', { class: 'danger-zone' },
      h('div', {}, h('strong', {}, 'Local maps'),
        h('p', { class: 'muted small' }, persistent
          ? 'Maps in the sidebar are working copies stored in this browser (IndexedDB). The map.json in your repo stays the source of truth — save to it and commit.'
          : 'Browser storage is unavailable, so maps live in memory for this session only.')),
      clearBtn),
    h('p', { class: 'about muted small' },
      `IluMap ${APP_VERSION} · `, h('a', { href: DOCS_URL, target: '_blank', rel: 'noopener' }, 'Documentation', icon('externalLink')),
      ' · MIT licence'));

  const res = await openDialog({
    title: 'Settings',
    fields: [
      { name: 'theme', label: 'Interface theme', type: 'select', value: getThemePref(), options: THEMES },
      { name: 'preset', label: 'Map style for new maps', type: 'select', value: store.prefs.newMapPreset || 'graphite', options: Object.keys(PRESETS) },
      { name: 'coordUnits', label: 'Cursor coordinates', type: 'select', value: store.prefs.coordUnits || 'world', options: [['world', 'World units (e.g. cm)'], ['display', 'Display units (e.g. m)']] },
      { name: 'autosave', label: 'Autosave the working copy in this browser', type: 'checkbox', value: store.prefs.autosave !== false },
    ],
    footer,
    okText: 'Done',
  });
  if (!res) return;
  setThemePref(res.theme);
  store.prefs.newMapPreset = res.preset;
  store.prefs.coordUnits = res.coordUnits;
  store.prefs.autosave = !!res.autosave;
  savePrefs();
  emit('prefs');
}
