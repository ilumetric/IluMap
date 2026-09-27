// Styled dropdowns for every <select> in the app.
//
// Native <select> pop-ups are drawn by the OS / browser and ignore the app's
// theme. enhanceSelect() keeps the <select> as the source of truth (value,
// options, change events — the rest of the code keeps using it) but hides it
// and shows a button styled like the inputs; clicking it opens the app's own
// menu (ui/menu.js) with the options. Selects added later are enhanced by a
// MutationObserver; renderKeepingFocus() enhances synchronously so focus can
// be restored on the new button. Add `data-native` to a <select> to opt out.

import { h } from '../dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';

const done = new WeakSet();
const VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const INDEX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

export function enhanceSelect(sel) {
  if (done.has(sel) || sel.multiple || 'native' in sel.dataset) return;
  done.add(sel);
  const text = h('span', { class: 'sel-label' });
  const btn = h('button', {
    type: 'button', class: `sel-btn ${sel.className}`.trim(), 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
    name: sel.name ? `${sel.name}__pick` : null,
  }, text, icon('chevronDown'));
  sel.classList.add('sel-native');
  sel.tabIndex = -1;
  sel.after(btn);

  function sync() {
    const opt = sel.options[INDEX.get.call(sel)];
    text.textContent = opt ? opt.textContent : '';
    btn.disabled = sel.disabled;
    btn.hidden = sel.hidden;
    const aria = sel.getAttribute('aria-label') || sel.closest('label')?.querySelector(':scope > span')?.textContent || '';
    if (aria) btn.setAttribute('aria-label', `${aria}: ${text.textContent}`);
    btn.title = sel.title || text.textContent;
  }

  // programmatic value / selectedIndex changes do not fire events: mirror them
  Object.defineProperty(sel, 'value', { configurable: true, get() { return VALUE.get.call(this); }, set(v) { VALUE.set.call(this, v); sync(); } });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return INDEX.get.call(this); }, set(v) { INDEX.set.call(this, v); sync(); } });
  new MutationObserver(sync).observe(sel, {
    attributes: true, attributeFilter: ['disabled', 'hidden', 'title', 'aria-label'], childList: true, subtree: true, characterData: true,
  });
  sel.addEventListener('change', sync);
  // a label around the select focuses the button
  sel.addEventListener('focus', () => btn.focus());

  function open() {
    if (btn.disabled) return;
    const items = [];
    let group = null;
    for (const o of sel.options) {
      const g = o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement : null;
      if (g && g !== group) items.push({ heading: g.label });
      group = g;
      items.push({
        label: o.textContent, checked: o.selected, disabled: o.disabled,
        onClick: () => {
          if (!o.selected) {
            VALUE.set.call(sel, o.value);
            sync();
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (btn.isConnected) btn.focus({ preventScroll: true });
        },
      });
    }
    btn.setAttribute('aria-expanded', 'true');
    openMenu(items, {
      anchor: btn, align: 'start', className: 'sel-menu', minWidth: btn.offsetWidth,
      onClose: () => btn.setAttribute('aria-expanded', 'false'),
    });
  }
  btn.addEventListener('click', open);
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (e.key === ' ' && !e.repeat)) { e.preventDefault(); open(); }
  });
  sync();
}

/** Enhance every <select> inside root (synchronously). */
export function enhanceSelects(root = document) {
  if (root instanceof HTMLSelectElement) { enhanceSelect(root); return; }
  for (const sel of root.querySelectorAll?.('select') || []) enhanceSelect(sel);
}

/** Enhance existing selects now and every select added to the page later. */
export function autoEnhanceSelects() {
  enhanceSelects(document);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) enhanceSelects(n);
  }).observe(document.body, { childList: true, subtree: true });
}
