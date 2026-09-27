// Popover menus (Export dropdown, project "⋯" menu, context menus) and
// free-form popovers (background image). One open at a time; closes on
// outside click, Escape, scroll of the anchor's container or item activation.

import { h } from '../dom.js';
import { icon } from './icons.js';

let current = null;

export function closeMenu() {
  if (!current) return;
  const c = current;
  current = null;
  // commit a field that is being edited inside the popover (its change event fires on blur)
  if (c.el.contains(document.activeElement)) document.activeElement.blur();
  c.el.remove();
  c.anchor?.classList.remove('menu-open');
  c.anchor?.setAttribute?.('aria-expanded', 'false');
  document.removeEventListener('pointerdown', c.onDown, true);
  document.removeEventListener('keydown', c.onKey, true);
  window.removeEventListener('resize', closeMenu);
  c.onClose?.();
}

export const isMenuOpen = () => !!current;

function place(el, { anchor, x, y, align = 'start', side = 'bottom' }) {
  const host = document.getElementById('menus');
  host.append(el);
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left;
  let top;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    if (side === 'right') {
      left = a.right + 8;
      top = a.top + a.height / 2 - r.height / 2;
    } else if (side === 'left') {
      left = a.left - r.width - 8;
      top = a.top + a.height / 2 - r.height / 2;
    } else if (side === 'top') {
      left = align === 'end' ? a.right - r.width : align === 'center' ? a.left + a.width / 2 - r.width / 2 : a.left;
      top = a.top - r.height - 6;
    } else {
      left = align === 'end' ? a.right - r.width : align === 'center' ? a.left + a.width / 2 - r.width / 2 : a.left;
      top = a.bottom + 6;
      if (top + r.height > vh - 8) top = a.top - r.height - 6;
    }
  } else {
    left = x;
    top = y;
  }
  left = Math.max(8, Math.min(vw - r.width - 8, left));
  top = Math.max(8, Math.min(vh - r.height - 8, top));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function show(el, opts) {
  const wasSame = current && opts.anchor && current.anchor === opts.anchor;
  closeMenu();
  if (wasSame && opts.toggle !== false) return null; // clicking the anchor again closes it
  const onDown = (e) => {
    if (el.contains(e.target) || (opts.anchor && opts.anchor.contains(e.target))) return;
    closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); opts.anchor?.focus?.(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...el.querySelectorAll('.menu-item:not(:disabled)')];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[n].focus();
    }
  };
  current = { el, anchor: opts.anchor, onDown, onKey, onClose: opts.onClose };
  opts.anchor?.classList.add('menu-open');
  opts.anchor?.setAttribute?.('aria-expanded', 'true');
  place(el, opts);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenu);
  return el;
}

/**
 * Show a menu. items: [{ label, icon?, kbd?, onClick, danger?, disabled?, hint?, checked? (radio item), lang? } | '-' (separator) | { heading }]
 * opts: { anchor?, x?, y?, align?: 'start'|'end'|'center', side?: 'bottom'|'top'|'right'|'left' }
 */
export function openMenu(items, opts = {}) {
  const el = h('div', { class: 'menu-pop chrome', role: 'menu' });
  for (const it of items) {
    if (it === '-') { el.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
    if (it.heading) { el.append(h('div', { class: 'menu-heading' }, it.heading)); continue; }
    const radio = typeof it.checked === 'boolean';
    const ico = radio ? (it.checked ? 'check' : null) : it.icon;
    el.append(h('button', {
      type: 'button', role: radio ? 'menuitemradio' : 'menuitem', 'aria-checked': radio ? String(it.checked) : null,
      class: `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`, disabled: !!it.disabled, title: it.hint || null, lang: it.lang || null,
      onclick: () => { closeMenu(); it.onClick?.(); },
    }, ico ? icon(ico) : h('span', { class: 'ico ico-blank' }), h('span', { class: 'menu-label' }, it.label), it.kbd ? h('kbd', {}, it.kbd) : null));
  }
  const shown = show(el, opts);
  if (shown && opts.focus !== false) shown.querySelector('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
  return shown;
}

/** Show arbitrary content in a popover card. */
export function openPopover(content, opts = {}) {
  const el = h('div', { class: `menu-pop popover chrome${opts.className ? ` ${opts.className}` : ''}`, role: 'dialog' }, content);
  return show(el, opts);
}
