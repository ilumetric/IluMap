// UI localisation: dictionaries stay in sync, plural forms are complete,
// every key the app uses exists, and no obvious English literal slips into
// common UI sinks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ru from '../src/app/i18n/ru.js';
import en from '../src/app/i18n/en.js';
import { LANGUAGES, setLang, t, plural, label, formatNumber } from '../src/app/i18n/index.js';
import { formatLength, formatArea } from '../src/core/text-export.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'src', 'app');
const DICTS = { ru, en };

const placeholders = (v) => {
  const texts = typeof v === 'string' ? [v] : Object.values(v);
  return new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
};

function appFiles(dir = APP, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'i18n') appFiles(p, out); } else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('languages: Russian first, then English; both have a dictionary', () => {
  assert.deepEqual(LANGUAGES.map((l) => l.code), ['ru', 'en']);
  assert.deepEqual(LANGUAGES.map((l) => l.name), ['Русский', 'English']);
  for (const l of LANGUAGES) assert.ok(DICTS[l.code], l.code);
});

test('ru and en have exactly the same keys', () => {
  const r = Object.keys(ru);
  const e = Object.keys(en);
  assert.deepEqual(r.filter((k) => !(k in en)), [], 'keys only in ru.js');
  assert.deepEqual(e.filter((k) => !(k in ru)), [], 'keys only in en.js');
});

test('placeholders match between languages', () => {
  const bad = [];
  for (const k of Object.keys(en)) {
    const a = placeholders(en[k]);
    const b = placeholders(ru[k]);
    for (const p of a) if (!b.has(p)) bad.push(`${k}: {${p}} missing in ru`);
    for (const p of b) if (!a.has(p)) bad.push(`${k}: {${p}} missing in en`);
  }
  assert.deepEqual(bad, []);
});

test('no empty strings; values are strings or plural objects', () => {
  for (const [lang, dict] of Object.entries(DICTS)) {
    for (const [k, v] of Object.entries(dict)) {
      if (typeof v === 'string') assert.ok(v.trim(), `${lang} ${k} is empty`);
      else {
        assert.equal(typeof v, 'object', `${lang} ${k}`);
        for (const [cat, s] of Object.entries(v)) assert.ok(typeof s === 'string' && s.trim(), `${lang} ${k}.${cat} is empty`);
      }
    }
  }
});

test('plural entries cover every plural category of their language', () => {
  for (const [lang, dict] of Object.entries(DICTS)) {
    const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
    for (const [k, v] of Object.entries(dict)) {
      if (typeof v === 'string') continue;
      for (const c of cats) assert.ok(v[c], `${lang} ${k} lacks "${c}"`);
      assert.equal(typeof (lang === 'ru' ? ru : en)[k], typeof (lang === 'ru' ? en : ru)[k], `${k}: plural in one language only`);
    }
  }
  // Russian needs one / few / many
  const ruCats = new Intl.PluralRules('ru').resolvedOptions().pluralCategories;
  for (const c of ['one', 'few', 'many']) assert.ok(ruCats.includes(c));
});

test('t / plural / label / number formatting', () => {
  setLang('ru');
  assert.equal(plural('count.features', 1), '1 объект');
  assert.equal(plural('count.features', 2), '2 объекта');
  assert.equal(plural('count.features', 5), '5 объектов');
  assert.equal(plural('count.features', 21), '21 объект');
  assert.equal(t('sidebar.minAgo', { n: 3 }), '3 мин назад');
  assert.equal(label('status', 'approved'), 'утверждено');
  assert.equal(label('layers', 'roads'), 'Дороги');
  assert.equal(label('zoneTypes', 'mountains'), 'Горы');
  assert.equal(label('poiTypes', 'mine'), 'Шахта');
  assert.equal(label('poiTypes', 'my_custom_type'), 'my_custom_type', 'unknown data values show raw');
  assert.equal(formatNumber(8.5), '8,5');
  setLang('en');
  assert.equal(plural('count.features', 1), '1 feature');
  assert.equal(plural('count.features', 5), '5 features');
  assert.equal(label('status', 'approved'), 'approved');
  assert.equal(formatNumber(8.5), '8.5');
});

test('missing keys fall back to English, then to the key, warning once', () => {
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(m);
  try {
    setLang('ru');
    en['test.onlyEnglish'] = 'English only'; // present in en.js only
    assert.equal(t('test.onlyEnglish'), 'English only');
    assert.equal(t('test.nowhere'), 'test.nowhere');
    assert.equal(t('test.nowhere'), 'test.nowhere');
    assert.equal(warns.filter((w) => w.includes('test.nowhere')).length, 1);
  } finally {
    delete en['test.onlyEnglish'];
    console.warn = orig;
    setLang('en');
  }
});

test('core length / area formatting: English default unchanged, localised on request', () => {
  const meta = { displayUnit: 'm', displayUnitScale: 100 };
  const ruOpts = { locale: 'ru', units: { km: 'км', m: 'м' } };
  assert.equal(formatLength(850000, meta), '8.5 km');
  assert.equal(formatLength(850000, meta, ruOpts), '8,5 км');
  assert.equal(formatLength(85000, meta, ruOpts), '850 м');
  assert.equal(formatArea(12.4e10, meta), '12.4 km²');
  assert.equal(formatArea(12.4e10, meta, ruOpts), '12,4 км²');
});

test('every literal i18n key used in src/app exists in en.js', () => {
  const groups = new Set(Object.keys(en).map((k) => k.split('.')[0]));
  const missing = [];
  const sources = appFiles().map((f) => [f, readFileSync(f, 'utf8')]);
  sources.push([join(ROOT, 'index.html'), readFileSync(join(ROOT, 'index.html'), 'utf8')]);
  for (const [f, src] of sources) {
    for (const m of src.matchAll(/\b(?:t|plural)\(\s*'([^'.\s]+\.[^'\s]+)'/g)) if (!(m[1] in en)) missing.push(`${relative(ROOT, f)}: ${m[1]}`);
    for (const m of src.matchAll(/data-i18n[a-z-]*="([^"]+)"/g)) if (!(m[1] in en)) missing.push(`${relative(ROOT, f)}: ${m[1]}`);
    for (const m of src.matchAll(/'([a-zA-Z]+(?:\.[a-zA-Z0-9]+)+)'/g)) {
      if (groups.has(m[1].split('.')[0]) && !m[1].endsWith('.json') && !m[1].endsWith('.md') && !(m[1] in en)) missing.push(`${relative(ROOT, f)}: ${m[1]}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

// Obvious English literals (a word of 2+ letters) in common UI sinks.
// Unavoidable ones (unit codes used as data examples) are allowlisted explicitly.
const ALLOW = [
  "src/app/panels/map.js: placeholder: 'cm'",
];

test('no hardcoded English UI literals in common sinks', () => {
  const sinks = [
    /textContent\s*=\s*(['"`])[A-Za-z]{2}[^'"`]*\1/g,
    /\btitle\s*[:=]\s*(['"`])[A-Za-z]{2}[^'"`]*\1/g,
    /\btoast\(\s*(['"`])[A-Za-z]{2}[^'"`]*\1/g,
    /\bplaceholder\s*[:=]\s*(['"`])[A-Za-z]{2}[^'"`]*\1/g,
    /'aria-label'\s*:\s*(['"`])[A-Za-z]{2}[^'"`]*\1/g,
    /\b(?:okText|cancelText|message|heading)\s*:\s*(['"`])[A-Za-z]{2}[^'"`]*\1/g,
    /\blabel\s*:\s*(['"`])[A-Z][A-Za-z][^'"`]*\1/g,
  ];
  const found = [];
  for (const f of appFiles()) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    for (const re of sinks) for (const m of src.matchAll(re)) found.push(`${rel}: ${m[0]}`);
  }
  assert.deepEqual(found.filter((x) => !ALLOW.includes(x)), []);
});
