// UI localisation. Dictionaries are plain ES modules (ru.js, en.js) exporting
// flat objects with dotted keys grouped by area (sidebar.*, tools.*, …).
// A value is a string with {name} placeholders, or — for counted phrases — an
// object of Intl.PluralRules categories ({ one, few, many, other }).
//
// Data is never translated: ids, type / status values, layer keys and
// everything written into map.json stay English; only their display labels
// go through label() / t().
//
// Importable from Node (tests): every browser global is guarded.

import ru from './ru.js';
import en from './en.js';

/** Languages in display order — Russian first. */
export const LANGUAGES = [
  { code: 'ru', name: 'Русский', short: 'RU' },
  { code: 'en', name: 'English', short: 'EN' },
];
export const DICTIONARIES = { ru, en };
export const FALLBACK_LANG = 'en';
/** localStorage key (next to ilumap.uiTheme / ilumap.prefs.v1); index.html reads it before first paint. */
export const LANG_KEY = 'ilumap.lang';

const listeners = new Set();
const warned = new Set();
const pluralRules = new Map();
const numberFormats = new Map();

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** Saved choice, else English (the default; Russian only when chosen). */
export function detectLang() {
  try {
    const saved = storage()?.getItem(LANG_KEY);
    if (saved && DICTIONARIES[saved]) return saved;
  } catch { /* storage disabled */ }
  return 'en';
}

let lang = detectLang();

export const getLang = () => lang;

/** Switch the UI language: saves it, updates <html lang>, static markup and every onLangChange listener. */
export function setLang(code) {
  if (!DICTIONARIES[code]) return false;
  const changed = code !== lang;
  lang = code;
  try { storage()?.setItem(LANG_KEY, code); } catch { /* ignore */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = code;
    applyI18n(document);
  }
  if (changed) {
    for (const cb of [...listeners]) {
      try { cb(code); } catch (e) { console.error('[ilumap] language listener failed', e); }
    }
  }
  return true;
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLangChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function warnOnce(id, message) {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(message);
}

function lookup(key) {
  const own = DICTIONARIES[lang]?.[key];
  if (own !== undefined) return own;
  const fb = DICTIONARIES[FALLBACK_LANG][key];
  warnOnce(`${lang}:${key}`, fb !== undefined
    ? `[ilumap i18n] missing "${key}" in "${lang}", using English`
    : `[ilumap i18n] missing key "${key}"`);
  return fb !== undefined ? fb : key;
}

/** True when the key exists (current language or the English fallback). No warning. */
export function has(key) {
  return DICTIONARIES[lang]?.[key] !== undefined || DICTIONARIES[FALLBACK_LANG][key] !== undefined;
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => {
    const v = params[k];
    if (v === undefined || v === null) return m;
    return typeof v === 'number' ? formatNumber(v) : String(v);
  });
}

function pluralCategory(n) {
  if (!pluralRules.has(lang)) pluralRules.set(lang, new Intl.PluralRules(lang));
  return pluralRules.get(lang).select(n);
}

function pick(forms, n) {
  if (typeof forms === 'string') return forms;
  const cat = n === undefined ? 'other' : pluralCategory(n);
  return forms[cat] ?? forms.other ?? forms.many ?? Object.values(forms)[0] ?? '';
}

/** Translate a key; {name} placeholders are filled from params (numbers are localised). */
export function t(key, params) {
  return interpolate(pick(lookup(key), params?.n), params);
}

/** Counted phrase: plural('count.features', 5) -> "5 объектов". {n} is the localised number. */
export function plural(key, n, params = {}) {
  return interpolate(pick(lookup(key), n), { ...params, n });
}

/** Display label of a data value (type, status, layer…): the translation when one exists, else the raw value. */
export function label(group, value) {
  if (value === undefined || value === null || value === '') return value ?? '';
  const key = `${group}.${value}`;
  return has(key) ? t(key) : String(value);
}

/** Localised number (Russian: decimal comma, non-breaking space groups). */
export function formatNumber(n, opts = {}) {
  const id = `${lang}|${JSON.stringify(opts)}`;
  if (!numberFormats.has(id)) numberFormats.set(id, new Intl.NumberFormat(lang, { maximumFractionDigits: 3, ...opts }));
  return numberFormats.get(id).format(n);
}

/**
 * Fill static markup: data-i18n (text), data-i18n-html (trusted dictionary
 * markup), data-i18n-title, data-i18n-placeholder, data-i18n-aria-label.
 */
export function applyI18n(root) {
  if (!root?.querySelectorAll) return;
  const all = [...(root.matches?.('[data-i18n],[data-i18n-html],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]') ? [root] : []),
    ...root.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]')];
  for (const el of all) {
    const d = el.dataset;
    if (d.i18n) el.textContent = t(d.i18n);
    if (d.i18nHtml) el.innerHTML = t(d.i18nHtml);
    if (d.i18nTitle) el.title = t(d.i18nTitle);
    if (d.i18nPlaceholder) el.placeholder = t(d.i18nPlaceholder);
    if (d.i18nAriaLabel) el.setAttribute('aria-label', t(d.i18nAriaLabel));
  }
}

if (typeof document !== 'undefined') document.documentElement.lang = lang;
