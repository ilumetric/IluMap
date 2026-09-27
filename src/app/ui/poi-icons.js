// POI symbol previews and the icon picker popover (Style tab: icon of a POI
// type; Inspector: per-POI override). The symbols themselves are the map
// symbols from core/render-svg.js, so the picker shows exactly what the map draws.

import { ICONS } from '../../core/render-svg.js';
import { POI_ICONS } from '../../core/styles.js';
import { h } from '../dom.js';
import { openPopover, closeMenu } from './menu.js';
import { label } from '../i18n/index.js';

/** An inline SVG element showing a POI symbol in a colour. */
export function poiIconSvg(name, color = 'currentColor', size = 18) {
  const span = h('span', { class: 'poi-sym', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="-12 -12 24 24" width="${size}" height="${size}" style="color:${color}">${ICONS[name] || ICONS.dot}</svg>`;
  return span;
}

/**
 * Button that shows the current icon and opens the picker.
 * opts: { name, value (icon or null), color, inherit?: icon name used when value is null,
 *         inheritLabel?: text of the "use the type icon" choice, title (button tooltip),
 *         pickerTitle? (popover heading, defaults to title), onPick(iconOrNull), withLabel? }
 */
export function iconButton({ name, value, color, inherit = null, inheritLabel = '', title = '', pickerTitle = '', onPick, withLabel = false }) {
  const shown = value || inherit || 'dot';
  const btn = h('button', {
    type: 'button', class: `icon-pick-btn${value ? '' : ' inherited'}${withLabel ? ' with-label' : ''}`, name, title, 'aria-label': title, 'aria-haspopup': 'dialog',
  }, poiIconSvg(shown, color, 18), withLabel ? h('span', { class: 'icon-pick-label' }, value ? label('poiIcons', value) : inheritLabel) : null);
  btn.addEventListener('click', () => openIconPicker(btn, { value, color, inherit, inheritLabel, title: pickerTitle || title, onPick }));
  return btn;
}

export function openIconPicker(anchor, { value, color, inherit = null, inheritLabel = '', title = '', onPick }) {
  const pick = (v) => { closeMenu(); onPick(v); };
  const grid = h('div', { class: 'icon-grid', role: 'listbox', 'aria-label': title });
  for (const name of POI_ICONS) {
    const on = value === name;
    grid.append(h('button', {
      type: 'button', class: `icon-cell${on ? ' on' : ''}`, role: 'option', 'aria-selected': String(on),
      title: label('poiIcons', name), 'aria-label': label('poiIcons', name),
      onclick: () => pick(name),
    }, poiIconSvg(name, color, 20)));
  }
  const body = h('div', { class: 'icon-pop' }, title ? h('div', { class: 'pop-title' }, title) : null);
  if (inherit) {
    body.append(h('button', {
      type: 'button', class: `icon-inherit${value ? '' : ' on'}`, onclick: () => pick(null),
    }, poiIconSvg(inherit, color, 18), h('span', {}, inheritLabel)));
  }
  body.append(grid);
  const pop = openPopover(body, { anchor, side: 'left', toggle: false });
  pop?.querySelector('.icon-cell.on, .icon-inherit.on, .icon-cell')?.focus({ preventScroll: true });
  // arrow keys move between cells (6 per row)
  grid.addEventListener('keydown', (e) => {
    const cells = [...grid.querySelectorAll('.icon-cell')];
    const i = cells.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 }[e.key];
    if (!step) return;
    e.preventDefault();
    cells[Math.max(0, Math.min(cells.length - 1, i + step))].focus();
  });
}
