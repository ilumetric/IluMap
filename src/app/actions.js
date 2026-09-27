// Object actions shared by the map, the Layers panel, the Points list and the
// Inspector: delete (with an Undo button on the notice) and the right-click
// menu. One place, so every surface offers the same commands.

import { store, change, select, undo, emit, isLayerLocked, parseVkey, clearVertices } from './state.js';
import { findById, removeById, removeVertex } from '../core/model.js';
import { centroid } from '../core/geometry.js';
import { LAYER_KIND } from '../core/schema.js';
import { toast } from './dom.js';
import { openMenu } from './ui/menu.js';
import { t, plural } from './i18n/index.js';
import { layerLabel } from './ui/layer-meta.js';

let canvasRef = null;
/** main.js hands over the canvas (for "Center on map"). */
export function setActionCanvas(canvas) { canvasRef = canvas; }

const lockedOf = (hit) => isLayerLocked(hit.kind === 'poi' ? 'pois' : hit.layer);

function deletedNotice(message) {
  toast(message, {
    timeout: 5000,
    actions: [{ label: t('history.undo'), onClick: () => undo() }],
  });
}

/** Delete objects (features, POIs) by id — one undo step, a notice with Undo. Locked layers are skipped. */
export function deleteItems(ids) {
  const hits = ids.map((id) => ({ id, hit: findById(store.doc, id) })).filter(({ hit }) => hit && (hit.kind === 'poi' || hit.kind === 'feature'));
  const items = hits.filter(({ hit }) => !lockedOf(hit));
  if (!items.length) {
    if (hits.length) toast(t('toast.deleteLocked'), { type: 'warn' });
    return false;
  }
  const name = items.length === 1 ? (items[0].hit.item.name || items[0].id) : null;
  change((doc) => { for (const { id } of items) removeById(doc, id); });
  deletedNotice(name ? t('toast.deletedNamed', { name }) : plural('toast.deleted', items.length));
  return true;
}

/**
 * Delete the selected vertices (Edit tool). A feature whose points are all
 * selected is removed as a whole; selected POIs are removed too.
 */
export function deleteSelectedPoints() {
  const byFeature = new Map();
  for (const k of store.vsel) {
    const [id, i] = parseVkey(k);
    if (!byFeature.has(id)) byFeature.set(id, []);
    byFeature.get(id).push(i);
  }
  let blocked = null;
  let n = 0;
  change((doc) => {
    for (const [id, idx] of byFeature) {
      const hit = findById(doc, id);
      if (!hit || hit.kind !== 'feature' || isLayerLocked(hit.layer)) continue;
      if (idx.length >= hit.item.points.length) { removeById(doc, id); n += idx.length; continue; }
      for (const i of idx.sort((a, b) => b - a)) {
        if (!removeVertex(hit.item, i)) { blocked = hit.item; break; }
        n += 1;
      }
    }
    if (!isLayerLocked('pois')) {
      for (const id of [...store.selection]) if (findById(doc, id)?.kind === 'poi') { removeById(doc, id); n += 1; }
    }
  });
  clearVertices();
  if (blocked) toast(t(blocked.kind === 'polygon' ? 'toast.polygonMinPoints' : 'toast.lineMinPoints'), { type: 'warn' });
  else if (n) deletedNotice(plural('toast.deletedPoints', n));
}

/** Delete what is selected: selected points in the Edit tool, otherwise the selected objects. */
export function deleteSelection() {
  if (store.vsel.size) { deleteSelectedPoints(); return; }
  deleteItems([...store.selection]);
}

function centerOn(id) {
  const hit = findById(store.doc, id);
  if (!hit || !canvasRef) return;
  if (hit.kind === 'poi') { if (hit.item.placed !== false) canvasRef.centerOn([hit.item.x, hit.item.y]); return; }
  const f = hit.item;
  if (!f.points.length) return;
  canvasRef.centerOn(LAYER_KIND[hit.layer] === 'polygon' ? centroid(f.points) : f.points[Math.floor(f.points.length / 2)]);
}

/**
 * The right-click menu for an object (map, Layers panel, Points list). A
 * right-click on something outside the selection selects it first, as in
 * file managers; on a selected object the menu acts on the whole selection.
 */
export function openObjectMenu(id, pos) {
  const hit = findById(store.doc, id);
  if (!hit || (hit.kind !== 'poi' && hit.kind !== 'feature')) return;
  if (!store.selection.has(id)) select(id);
  const ids = [...store.selection];
  const one = ids.length === 1;
  const kind = hit.kind === 'poi' ? t('inspector.kindPoi') : layerLabel(hit.layer);
  const items = [{ heading: one ? `${kind} · ${hit.item.name || id}` : plural('count.items', ids.length) }];
  if (store.vsel.size) {
    items.push({ label: plural('menu.deletePoints', store.vsel.size), icon: 'trash', kbd: 'Del', danger: true, onClick: deleteSelectedPoints });
  }
  if (one) items.push({ label: t('menu.center'), icon: 'target', onClick: () => centerOn(id) });
  if (hit.kind === 'feature' && store.tool !== 'select') items.push({ label: t('menu.editPoints'), icon: 'select', kbd: 'V', onClick: () => emit('set-tool', 'select') });
  if (one) items.push({ label: t('menu.properties'), icon: 'inspector', onClick: () => emit('open-panel', 'inspector') });
  items.push('-', {
    label: one ? t('menu.delete') : t('menu.deleteN', { n: String(ids.length) }),
    icon: 'trash', kbd: store.vsel.size ? null : 'Del', danger: true,
    disabled: ids.every((x) => { const hh = findById(store.doc, x); return !hh || lockedOf(hh); }),
    onClick: () => { clearVertices(); deleteItems(ids); },
  });
  openMenu(items, { ...pos, minWidth: 220 });
}
