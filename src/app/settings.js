// UI theme, UI language and the Settings dialog. Theme and language are
// stored under their own localStorage keys so the inline script in
// index.html can apply them before first paint.

import { store, savePrefs, emit } from './state.js';
import { PRESETS } from '../core/styles.js';
import { h, openDialog } from './dom.js';
import { icon } from './ui/icons.js';
import { persistent } from './projects.js';
import { clearAllProjects } from './session.js';
import { APP_VERSION, DOCS_URL } from './version.js';
import { t, label, getLang, setLang, LANGUAGES } from './i18n/index.js';

const THEME_KEY = 'ilumap.uiTheme';
const THEMES = ['system', 'dark', 'light'];
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

export function getThemePref() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : 'system';
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

/**
 * Settings dialog. The language select applies at once: the dialog is
 * reopened in the new language, keeping the values not yet confirmed.
 */
export async function openSettings(draft = null) {
  const v = {
    theme: getThemePref(),
    preset: store.prefs.newMapPreset || 'graphite',
    coordUnits: store.prefs.coordUnits || 'world',
    autosave: store.prefs.autosave !== false,
    ...(draft || {}),
  };
  const clearBtn = h('button', {
    type: 'button', class: 'btn btn-small btn-danger',
    onclick: async () => {
      document.querySelector('#dialogs .backdrop:last-child .dialog-head .icon-btn')?.click(); // close Settings first
      await clearAllProjects();
    },
  }, icon('trash'), t('settings.clearMaps'));
  const footer = h('div', { class: 'settings-extra' },
    h('section', { class: 'danger-zone' },
      h('div', {}, h('strong', {}, t('settings.localMaps')),
        h('p', { class: 'muted small' }, persistent ? t('settings.localMapsHint') : t('settings.memoryOnlyHint'))),
      clearBtn),
    h('p', { class: 'about muted small' },
      `IluMap ${APP_VERSION} · `, h('a', { href: DOCS_URL, target: '_blank', rel: 'noopener' }, t('settings.docs'), icon('externalLink')),
      ` · ${t('settings.licence')}`));

  let relaunch = null;
  const res = await openDialog({
    title: t('settings.title'),
    fields: [
      { name: 'lang', label: t('settings.languageBoth'), type: 'select', value: getLang(), options: LANGUAGES.map((l) => [l.code, l.name]) },
      { name: 'theme', label: t('settings.theme'), type: 'select', value: v.theme, options: THEMES.map((k) => [k, t(`settings.themes.${k}`)]) },
      { name: 'preset', label: t('settings.preset'), type: 'select', value: v.preset, options: Object.keys(PRESETS).map((p) => [p, label('presets', p)]) },
      { name: 'coordUnits', label: t('settings.coordUnits'), type: 'select', value: v.coordUnits, options: [['world', t('settings.coordWorld')], ['display', t('settings.coordDisplay')]] },
      { name: 'autosave', label: t('settings.autosave'), type: 'checkbox', value: v.autosave },
    ],
    footer,
    okText: t('settings.done'),
    onOpen: ({ inputs, close }) => {
      const sel = inputs.lang;
      for (const o of sel.options) o.lang = o.value;
      sel.addEventListener('change', () => {
        relaunch = {
          theme: inputs.theme.value, preset: inputs.preset.value, coordUnits: inputs.coordUnits.value, autosave: inputs.autosave.checked,
        };
        const lang = sel.value;
        close(null);
        setLang(lang);
      });
    },
  });
  if (relaunch) {
    await openSettings(relaunch); // the language select is the first field, so it keeps the focus
    return;
  }
  if (!res) return;
  setThemePref(res.theme);
  store.prefs.newMapPreset = res.preset;
  store.prefs.coordUnits = res.coordUnits;
  store.prefs.autosave = !!res.autosave;
  savePrefs();
  emit('prefs');
}
