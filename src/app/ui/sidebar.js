// Left sidebar: app name + collapse, New map / Search maps / Open file,
// the list of local projects (IndexedDB working copies) with a "⋯" menu,
// and Settings + the language switcher pinned at the bottom. Collapses with Ctrl+B.

import { store, on, savePrefs } from '../state.js';
import { h, clear, preserveScroll } from '../dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { t, getLang, setLang, onLangChange, LANGUAGES } from '../i18n/index.js';
import {
  projectList, openProject, newMapCommand, openFileCommand, renameProject, duplicateProject, exportProjectJson, deleteProject,
} from '../session.js';

function relTime(ts) {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('sidebar.justNow');
  if (s < 3600) return t('sidebar.minAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return t('sidebar.hoursAgo', { n: Math.floor(s / 3600) });
  return new Date(ts).toLocaleDateString(getLang());
}

/** Popover listing the UI languages (Russian first) with a check on the active one. */
export function openLanguageMenu(anchor, opts = {}) {
  const cur = getLang();
  return openMenu([
    { heading: t('settings.language') },
    ...LANGUAGES.map((l) => ({
      label: l.name, checked: l.code === cur, lang: l.code,
      onClick: () => setLang(l.code),
    })),
  ], { anchor, align: 'start', side: 'top', ...opts });
}

export function mountSidebar({ openSettings }) {
  const app = document.getElementById('app');
  const root = document.getElementById('sidebar');
  const reopen = document.getElementById('sidebar-open');
  let query = '';
  let renaming = null;

  const collapseBtn = h('button', { type: 'button', class: 'icon-btn sb-collapse', onclick: () => setOpen(false) }, icon('panelLeft'));
  const search = h('input', {
    type: 'search', class: 'sb-search-input', name: 'map-search', autocomplete: 'off', spellcheck: 'false',
    oninput: () => { query = search.value.trim().toLowerCase(); renderList(); },
    onkeydown: (e) => {
      if (e.key === 'Escape') { search.value = ''; query = ''; renderList(); searchWrap.hidden = true; search.blur(); e.stopPropagation(); }
      if (e.key === 'Enter') { const first = filtered()[0]; if (first) openProject(first.id); }
    },
  });
  const searchWrap = h('div', { class: 'sb-search', hidden: true }, icon('search'), search);
  const list = h('div', { class: 'sb-list', role: 'list' });
  const item = (ico, onclick, extra = {}) => h('button', { type: 'button', class: 'sb-item', onclick, ...extra }, icon(ico), h('span', { class: 'sb-item-label' }));
  const newItem = item('newMap', () => newMapCommand());
  const searchItem = item('search', () => focusSearch());
  const openItem = item('folderOpen', () => openFileCommand());
  const settingsItem = item('settings', () => openSettings());
  const mapsLabel = h('div', { class: 'sb-label' });
  const langCode = h('span', { class: 'sb-lang-code' });
  const langBtn = h('button', {
    type: 'button', class: 'sb-lang', 'aria-haspopup': 'menu',
    onclick: () => openLanguageMenu(langBtn),
  }, icon('globe'), langCode);

  root.append(
    h('div', { class: 'sb-head' }, h('div', { class: 'sb-brand' }, icon('logo'), h('span', {}, 'IluMap')), collapseBtn),
    h('nav', { class: 'sb-actions' }, newItem, searchItem, searchWrap, openItem),
    mapsLabel,
    list,
    h('div', { class: 'sb-foot' }, settingsItem, langBtn),
  );

  function relabel() {
    const set = (el, text, title) => {
      el.querySelector('.sb-item-label').textContent = text;
      if (title) el.title = title;
    };
    root.setAttribute('aria-label', t('sidebar.aria'));
    collapseBtn.title = t('sidebar.close');
    collapseBtn.setAttribute('aria-label', t('sidebar.closeAria'));
    search.placeholder = t('sidebar.searchPlaceholder');
    search.setAttribute('aria-label', t('sidebar.search'));
    list.setAttribute('aria-label', t('sidebar.maps'));
    set(newItem, t('sidebar.newMap'));
    set(searchItem, t('sidebar.search'), 'Ctrl+K');
    set(openItem, t('sidebar.openFile'), t('sidebar.openFileTitle'));
    set(settingsItem, t('sidebar.settings'));
    mapsLabel.textContent = t('sidebar.maps');
    const cur = LANGUAGES.find((l) => l.code === getLang());
    langCode.textContent = cur?.short || getLang().toUpperCase();
    langBtn.title = `${t('settings.language')}: ${cur?.name || ''}`;
    langBtn.setAttribute('aria-label', langBtn.title);
    reopen.title = t('sidebar.open');
    reopen.setAttribute('aria-label', t('sidebar.openAria'));
  }

  function filtered() {
    const all = projectList();
    return query ? all.filter((p) => (p.name || '').toLowerCase().includes(query)) : all;
  }

  function rowMenu(p, anchor, at) {
    openMenu([
      { label: t('sidebar.rename'), icon: 'pencil', onClick: () => { renaming = p.id; renderList(); } },
      { label: t('sidebar.duplicate'), icon: 'copy', onClick: () => duplicateProject(p.id) },
      { label: t('sidebar.exportJson'), icon: 'download', onClick: () => exportProjectJson(p.id) },
      '-',
      { label: t('sidebar.delete'), icon: 'trash', danger: true, onClick: () => deleteProject(p.id) },
    ], at ? { x: at.x, y: at.y } : { anchor, align: 'start' });
  }

  function renameRow(p) {
    const input = h('input', { class: 'sb-rename', value: p.name, name: 'project-rename', 'aria-label': t('sidebar.mapName'), autocomplete: 'off', spellcheck: 'false' });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      renaming = null;
      if (commit && input.value.trim() && input.value.trim() !== p.name) renameProject(p.id, input.value.trim());
      renderList();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    requestAnimationFrame(() => { input.focus(); input.select(); });
    return h('div', { class: 'sb-row renaming', role: 'listitem' }, input);
  }

  function renderList() {
    preserveScroll(list, () => {
      clear(list);
      const items = filtered();
      const current = store.project?.id;
      for (const p of items) {
        if (renaming === p.id) { list.append(renameRow(p)); continue; }
        const more = h('button', { type: 'button', class: 'icon-btn sb-more', title: t('sidebar.more'), 'aria-label': t('sidebar.moreFor', { name: p.name }), 'aria-haspopup': 'menu' }, icon('more'));
        const linkedTo = p.fileName ? t('sidebar.linkedTo', { file: p.fileName }) : t('sidebar.linkedToAFile');
        const tip = `${p.name}\n${p.fileHandle ? linkedTo : t('sidebar.browserCopy')} · ${t('sidebar.edited', { when: relTime(p.updatedAt) })}`;
        const row = h('div', {
          class: `sb-row${p.id === current ? ' active' : ''}`, role: 'listitem', tabindex: '0', title: tip,
          onclick: (e) => { if (!e.target.closest('.sb-more')) openProject(p.id); },
          onkeydown: (e) => { if (e.key === 'Enter' && e.target === row) openProject(p.id); if (e.key === 'F2') { renaming = p.id; renderList(); } },
          oncontextmenu: (e) => { e.preventDefault(); rowMenu(p, null, { x: e.clientX, y: e.clientY }); },
          ondblclick: (e) => { if (!e.target.closest('.sb-more')) { renaming = p.id; renderList(); } },
        }, h('span', { class: 'sb-name' }, p.name || t('common.untitled')), p.fileHandle ? h('span', { class: 'sb-linked', title: linkedTo }, icon('link')) : null, more);
        more.addEventListener('click', (e) => { e.stopPropagation(); rowMenu(p, more); });
        list.append(row);
      }
      if (!items.length) list.append(h('p', { class: 'sb-empty' }, query ? t('sidebar.noMatch') : t('sidebar.empty')));
    });
  }


  function setOpen(open) {
    store.prefs.sidebarOpen = !!open;
    savePrefs();
    app.classList.toggle('sidebar-closed', !open);
    reopen.hidden = !!open;
  }

  function focusSearch() {
    if (!store.prefs.sidebarOpen) setOpen(true);
    searchWrap.hidden = false;
    search.focus();
    search.select();
  }

  reopen.append(icon('panelLeft'));
  reopen.addEventListener('click', () => setOpen(true));
  setOpen(store.prefs.sidebarOpen !== false);

  on('projects', renderList);
  on('project', renderList);
  onLangChange(() => { relabel(); renderList(); });
  relabel();
  renderList();

  return {
    toggle: () => setOpen(!store.prefs.sidebarOpen),
    focusSearch,
  };
}
