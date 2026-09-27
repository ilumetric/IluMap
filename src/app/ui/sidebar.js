// Left sidebar: app name + collapse, New map / Search maps / Open file,
// the list of local projects (IndexedDB working copies) with a "⋯" menu,
// and Settings pinned at the bottom. Collapses with Ctrl+B.

import { store, on, savePrefs } from '../state.js';
import { h, clear } from '../dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import {
  projectList, openProject, newMapCommand, openFileCommand, renameProject, duplicateProject, exportProjectJson, deleteProject,
} from '../session.js';

function relTime(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export function mountSidebar({ openSettings }) {
  const app = document.getElementById('app');
  const root = document.getElementById('sidebar');
  const reopen = document.getElementById('sidebar-open');
  let query = '';
  let renaming = null;

  const collapseBtn = h('button', { type: 'button', class: 'icon-btn sb-collapse', title: 'Close sidebar (Ctrl+B)', 'aria-label': 'Close sidebar', onclick: () => setOpen(false) }, icon('panelLeft'));
  const search = h('input', {
    type: 'search', class: 'sb-search-input', placeholder: 'Search maps…', name: 'map-search', 'aria-label': 'Search maps', autocomplete: 'off', spellcheck: 'false',
    oninput: () => { query = search.value.trim().toLowerCase(); renderList(); },
    onkeydown: (e) => {
      if (e.key === 'Escape') { search.value = ''; query = ''; renderList(); searchWrap.hidden = true; search.blur(); e.stopPropagation(); }
      if (e.key === 'Enter') { const first = filtered()[0]; if (first) openProject(first.id); }
    },
  });
  const searchWrap = h('div', { class: 'sb-search', hidden: true }, icon('search'), search);
  const list = h('div', { class: 'sb-list', role: 'list', 'aria-label': 'Maps' });
  const item = (ico, label, onclick, extra = {}) => h('button', { type: 'button', class: 'sb-item', onclick, ...extra }, icon(ico), h('span', {}, label));

  root.append(
    h('div', { class: 'sb-head' }, h('div', { class: 'sb-brand' }, icon('logo'), h('span', {}, 'IluMap')), collapseBtn),
    h('nav', { class: 'sb-actions' },
      item('newMap', 'New map', () => newMapCommand()),
      item('search', 'Search maps', () => focusSearch(), { title: 'Ctrl+K' }),
      searchWrap,
      item('folderOpen', 'Open file', () => openFileCommand(), { title: 'Open a map.json (Ctrl+O)' })),
    h('div', { class: 'sb-label' }, 'Maps'),
    list,
    h('div', { class: 'sb-foot' }, item('settings', 'Settings', () => openSettings())),
  );

  function filtered() {
    const all = projectList();
    return query ? all.filter((p) => (p.name || '').toLowerCase().includes(query)) : all;
  }

  function rowMenu(p, anchor, at) {
    openMenu([
      { label: 'Rename', icon: 'pencil', onClick: () => { renaming = p.id; renderList(); } },
      { label: 'Duplicate', icon: 'copy', onClick: () => duplicateProject(p.id) },
      { label: 'Export JSON', icon: 'download', onClick: () => exportProjectJson(p.id) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteProject(p.id) },
    ], at ? { x: at.x, y: at.y } : { anchor, align: 'start' });
  }

  function renameRow(p) {
    const input = h('input', { class: 'sb-rename', value: p.name, name: 'project-rename', 'aria-label': 'Map name', autocomplete: 'off', spellcheck: 'false' });
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
    clear(list);
    const items = filtered();
    const current = store.project?.id;
    for (const p of items) {
      if (renaming === p.id) { list.append(renameRow(p)); continue; }
      const more = h('button', { type: 'button', class: 'icon-btn sb-more', title: 'More', 'aria-label': `More actions for ${p.name}`, 'aria-haspopup': 'menu' }, icon('more'));
      const tip = `${p.name}\n${p.fileHandle ? `Linked to ${p.fileName || 'a file'} on disk` : 'Browser copy (not linked to a file)'} · edited ${relTime(p.updatedAt)}`;
      const row = h('div', {
        class: `sb-row${p.id === current ? ' active' : ''}`, role: 'listitem', tabindex: '0', title: tip,
        onclick: (e) => { if (!e.target.closest('.sb-more')) openProject(p.id); },
        onkeydown: (e) => { if (e.key === 'Enter' && e.target === row) openProject(p.id); if (e.key === 'F2') { renaming = p.id; renderList(); } },
        oncontextmenu: (e) => { e.preventDefault(); rowMenu(p, null, { x: e.clientX, y: e.clientY }); },
        ondblclick: (e) => { if (!e.target.closest('.sb-more')) { renaming = p.id; renderList(); } },
      }, h('span', { class: 'sb-name' }, p.name || 'Untitled'), p.fileHandle ? h('span', { class: 'sb-linked', title: `Linked to ${p.fileName || 'a file'}` }, icon('link')) : null, more);
      more.addEventListener('click', (e) => { e.stopPropagation(); rowMenu(p, more); });
      list.append(row);
    }
    if (!items.length) list.append(h('p', { class: 'sb-empty' }, query ? 'No map matches.' : 'No maps yet.'));
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
  renderList();

  return {
    toggle: () => setOpen(!store.prefs.sidebarOpen),
    focusSearch,
  };
}
