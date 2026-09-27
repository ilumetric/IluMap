// Undo / redo history as patches. Pure module: no DOM.
//
// The editor mutates the document in place, so a step cannot be taken from the
// objects themselves. Instead the history keeps an index of the committed state:
// one JSON string per "slot" — every top-level value (meta, view, style,
// terrain, …) and every item of the keyed collections (features of each layer,
// POIs, links), plus the order of each collection. Committing a change
// stringifies the document again (native JSON.stringify, fast) and records only
// the slots that differ, before and after. Undo / redo write those slots back
// into the live document: no full copy, no re-parse of the whole map, memory
// proportional to what was edited.
//
// A step: { patch, label?, merge?, time, bytes, selBefore, selAfter, revBefore, revAfter }.
// A patch: [{ t: 'v', path, b, a } | { t: 'c', path, order: { b, a } | null, items: [{ k, b, a }] }]
// where b / a are JSON strings (undefined = absent).

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const COLLECTIONS = new Set(['pois', 'links']);

/** Collections whose items are identified by `id` (unique strings), else null. */
function keysOf(arr) {
  const keys = new Array(arr.length);
  const seen = new Set();
  for (let i = 0; i < arr.length; i++) {
    const id = isObj(arr[i]) ? arr[i].id : undefined;
    if (typeof id !== 'string' || seen.has(id)) return null;
    seen.add(id);
    keys[i] = id;
  }
  return keys;
}

/** The slots of a document: Map slotKey → { path, json } | { path, order, items: Map }. */
function slotsOf(doc) {
  const slots = new Map();
  const add = (path, value) => {
    const key = path.join('\u0000');
    if (Array.isArray(value)) {
      const order = keysOf(value);
      if (order) {
        const items = new Map();
        for (let i = 0; i < value.length; i++) items.set(order[i], JSON.stringify(value[i]));
        slots.set(key, { path, order, items });
        return;
      }
    }
    slots.set(key, { path, json: JSON.stringify(value) });
  };
  for (const k of Object.keys(doc)) {
    const v = doc[k];
    if (v === undefined) continue;
    if (k === 'layers' && isObj(v)) {
      for (const l of Object.keys(v)) if (v[l] !== undefined) add(['layers', l], v[l]);
    } else if (COLLECTIONS.has(k) && Array.isArray(v)) add([k], v);
    else slots.set(k, { path: [k], json: JSON.stringify(v) });
  }
  return slots;
}

const arrayJson = (s) => `[${s.order.map((k) => s.items.get(k)).join(',')}]`;
const slotJson = (s) => (s === undefined ? undefined : s.items ? arrayJson(s) : s.json);
const sameOrder = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * Compare the indexed state with the document. Returns { patch, index } —
 * patch is null when nothing changed; index is the index of the document.
 */
export function diff(index, doc) {
  const next = slotsOf(doc);
  const patch = [];
  for (const [key, s] of next) {
    const p = index.get(key);
    if (s.items && p?.items) {
      const items = [];
      for (const [k, a] of s.items) {
        const b = p.items.get(k);
        if (a !== b) items.push({ k, b, a });
      }
      for (const [k, b] of p.items) if (!s.items.has(k)) items.push({ k, b, a: undefined });
      const order = sameOrder(p.order, s.order) ? null : { b: p.order, a: s.order };
      if (items.length || order) patch.push({ t: 'c', path: s.path, order, items });
    } else {
      const b = slotJson(p);
      const a = slotJson(s);
      if (a !== b) patch.push({ t: 'v', path: s.path, b, a });
    }
  }
  for (const [key, p] of index) {
    if (!next.has(key)) patch.push({ t: 'v', path: p.path, b: slotJson(p), a: undefined });
  }
  return { patch: patch.length ? patch : null, index: next };
}

/** Index of a document (the state history compares against). */
export const indexOf = (doc) => slotsOf(doc);

function parentOf(doc, path, create) {
  let o = doc;
  for (let i = 0; i < path.length - 1; i++) {
    if (!isObj(o[path[i]])) { if (!create) return null; o[path[i]] = {}; }
    o = o[path[i]];
  }
  return o;
}

/**
 * Write one side of a patch into the document and the index.
 * side: 'b' (undo: back to the state before) or 'a' (redo: the state after).
 */
export function apply(doc, index, patch, side) {
  let reindex = false;
  for (const op of patch) {
    const key = op.path.join('\u0000');
    const last = op.path[op.path.length - 1];
    if (op.t === 'v') {
      const json = op[side];
      const parent = parentOf(doc, op.path, json !== undefined);
      if (json === undefined) {
        if (parent) delete parent[last];
        index.delete(key);
        if (op.path.length === 1 && last === 'layers') reindex = true;
      } else {
        const value = JSON.parse(json);
        parent[last] = value;
        // re-index the slot as it would be read (a keyed array becomes a collection slot)
        if (op.path.length === 1 && last === 'layers') reindex = true;
        else index.set(key, slotsOf(op.path.length === 1 ? { [last]: value } : { layers: { [last]: value } }).get(key));
      }
      continue;
    }
    // keyed collection
    const parent = parentOf(doc, op.path, true);
    if (!Array.isArray(parent[last])) parent[last] = [];
    const arr = parent[last];
    const slot = index.get(key) || { path: op.path, order: [], items: new Map() };
    const byKey = new Map();
    for (const it of arr) byKey.set(it.id, it);
    for (const it of op.items) {
      const json = it[side];
      if (json === undefined) { byKey.delete(it.k); slot.items.delete(it.k); } else { byKey.set(it.k, JSON.parse(json)); slot.items.set(it.k, json); }
    }
    const order = op.order ? op.order[side] : arr.map((it) => it.id);
    arr.length = 0;
    for (const k of order) arr.push(byKey.get(k));
    slot.order = order.slice();
    index.set(key, slot);
  }
  if (reindex) {
    index.clear();
    for (const [k, v] of slotsOf(doc)) index.set(k, v);
  }
}

/** One patch doing p1 then p2 (for merging repeated small edits such as nudges). */
export function merge(p1, p2) {
  const out = new Map();
  const keyOf = (op) => `${op.t}\u0001${op.path.join('\u0000')}`;
  for (const op of p1) out.set(keyOf(op), op.t === 'v' ? { ...op } : { ...op, items: op.items.map((i) => ({ ...i })) });
  for (const op of p2) {
    const k = keyOf(op);
    const prev = out.get(k);
    if (!prev) { out.set(k, op.t === 'v' ? { ...op } : { ...op, items: op.items.map((i) => ({ ...i })) }); continue; }
    if (op.t === 'v') { prev.a = op.a; continue; }
    const items = new Map(prev.items.map((i) => [i.k, i]));
    for (const i of op.items) {
      const was = items.get(i.k);
      if (was) was.a = i.a; else items.set(i.k, { ...i });
    }
    prev.items = [...items.values()];
    const b = prev.order?.b || op.order?.b;
    const a = op.order?.a || prev.order?.a;
    prev.order = b && a ? { b, a } : null;
  }
  const res = [];
  for (const op of out.values()) {
    if (op.t === 'v') { if (op.a !== op.b) res.push(op); continue; }
    op.items = op.items.filter((i) => i.a !== i.b);
    if (op.order && sameOrder(op.order.b, op.order.a)) op.order = null;
    if (op.items.length || op.order) res.push(op);
  }
  return res.length ? res : null;
}

/** Approximate memory of a patch in bytes (UTF-16 strings). */
export function sizeOf(patch) {
  let n = 64;
  for (const op of patch) {
    if (op.t === 'v') n += 2 * ((op.b?.length || 0) + (op.a?.length || 0)) + 64;
    else {
      for (const i of op.items) n += 2 * ((i.b?.length || 0) + (i.a?.length || 0) + i.k.length) + 48;
      if (op.order) n += 16 * (op.order.b.length + op.order.a.length);
    }
  }
  return n;
}

// --- labels -------------------------------------------------------------------

const nameIn = (json) => {
  try { const o = JSON.parse(json); return o?.name || o?.id || ''; } catch { return ''; }
};

/** Whether two point lists differ by one translation. */
function translated(pb, pa) {
  if (!Array.isArray(pb) || !Array.isArray(pa) || pb.length !== pa.length || !pb.length) return false;
  const dx = pa[0][0] - pb[0][0];
  const dy = pa[0][1] - pb[0][1];
  return pb.every((p, i) => Math.abs(pa[i][0] - p[0] - dx) < 1e-6 && Math.abs(pa[i][1] - p[1] - dy) < 1e-6);
}

const GEOMETRY_KEYS = new Set(['points', 'x', 'y', 'zone']);

/** How an item changed: 'move' | 'reshape' | 'edit'. */
function itemChange(b, a) {
  let ob;
  let oa;
  try { ob = JSON.parse(b); oa = JSON.parse(a); } catch { return 'edit'; }
  const keys = new Set([...Object.keys(ob), ...Object.keys(oa)]);
  const changed = [...keys].filter((k) => JSON.stringify(ob[k]) !== JSON.stringify(oa[k]));
  if (!changed.length || !changed.every((k) => GEOMETRY_KEYS.has(k))) return 'edit';
  if (!changed.includes('points')) return 'move'; // a POI
  return translated(ob.points, oa.points) ? 'move' : 'reshape';
}

/**
 * A short description of a patch for the history menu and tooltips:
 * { key, name?, count? } — key is an i18n key under `history.action.`.
 */
export function describe(patch) {
  if (!patch) return { key: 'edit' };
  const added = []; const removed = []; const changed = [];
  let reordered = false; let links = 0;
  const values = new Set();
  for (const op of patch) {
    if (op.path[0] === 'links') { links += op.t === 'v' ? 1 : op.items.length + (op.order ? 1 : 0); continue; }
    if (op.t === 'v') {
      const top = op.path[0];
      if (top === 'meta') {
        let only = false;
        try { const b = JSON.parse(op.b || '{}'); const a = JSON.parse(op.a || '{}'); only = Object.keys({ ...a, ...b }).every((k) => k === 'name' || JSON.stringify(a[k]) === JSON.stringify(b[k])); } catch { /* */ }
        values.add(only ? 'rename' : 'map');
      } else if (top === 'view') {
        let bg = false;
        try { const b = JSON.parse(op.b || '{}'); const a = JSON.parse(op.a || '{}'); bg = Object.keys({ ...a, ...b }).every((k) => k === 'background' || JSON.stringify(a[k]) === JSON.stringify(b[k])); } catch { /* */ }
        values.add(bg ? 'background' : 'map');
      } else if (top === 'style') values.add('style');
      else if (top === 'terrain') values.add('terrain');
      else if (top === 'layers') values.add('edit');
      else values.add('map');
      continue;
    }
    for (const i of op.items) {
      if (i.b === undefined) added.push(i);
      else if (i.a === undefined) removed.push(i);
      else changed.push(i);
    }
    if (op.order && !op.items.length) reordered = true;
  }
  const items = added.length + removed.length + changed.length;
  if (values.size && (items || links)) return { key: 'edit' };
  if (values.size) return { key: values.size === 1 ? [...values][0] : 'map' };
  if (!items) return { key: reordered ? 'reorder' : links ? 'links' : 'edit' };
  const one = (list, side) => (list.length === 1 ? { name: nameIn(list[0][side]) } : { count: list.length });
  if (added.length && !removed.length && !changed.length) return { key: 'add', ...one(added, 'a') };
  if (removed.length && !added.length && !changed.length) return { key: 'delete', ...one(removed, 'b') };
  if (changed.length && !added.length && !removed.length) {
    const kinds = new Set(changed.map((i) => itemChange(i.b, i.a)));
    const key = kinds.size === 1 ? [...kinds][0] : kinds.has('edit') ? 'edit' : 'reshape';
    return { key, ...one(changed, 'a') };
  }
  // e.g. an id rename (removed + added) or a split
  return added.length === 1 && removed.length === 1
    ? { key: 'edit', name: nameIn(added[0].a) }
    : { key: 'edit', count: items };
}

// --- the stack ------------------------------------------------------------------

/**
 * Undo / redo stacks over a document with an index of its committed state.
 * opts: { maxSteps, maxBytes, mergeWindow (ms) }
 */
export function createHistory(doc, { maxSteps = 500, maxBytes = 64 * 1024 * 1024, mergeWindow = 1000 } = {}) {
  const h = {
    index: indexOf(doc),
    undo: [],
    redo: [],
    bytes: 0,
    rev: 0, // id of the current state
    nextRev: 1,
    maxSteps,
    maxBytes,
    mergeWindow,
  };
  return h;
}

/**
 * Record the document's changes since the last commit as one step.
 * info: { label?, merge?, selBefore, selAfter, now, keepRev? (a saved revision that must stay reachable) }
 * Returns the step, or null when nothing changed.
 */
export function commit(h, doc, info = {}) {
  const { patch, index } = diff(h.index, doc);
  if (!patch) return null;
  h.index = index;
  const now = info.now ?? Date.now();
  const top = h.undo[h.undo.length - 1];
  const hadRedo = h.redo.length > 0;
  for (const s of h.redo) h.bytes -= s.bytes;
  h.redo = [];
  // repeated small edits of the same kind (nudges) become one step
  if (info.merge && !hadRedo && top && top.merge === info.merge && now - top.time <= h.mergeWindow
      && top.revAfter === h.rev && top.revAfter !== info.keepRev && sameSel(top.selAfter, info.selBefore)) {
    const merged = merge(top.patch, patch);
    h.bytes -= top.bytes;
    if (!merged) { h.undo.pop(); h.rev = top.revBefore; return null; }
    top.patch = merged;
    top.bytes = sizeOf(merged);
    top.time = now;
    top.selAfter = info.selAfter || [];
    top.revAfter = h.rev = h.nextRev++;
    h.bytes += top.bytes;
    return top;
  }
  const step = {
    patch,
    label: info.label || null,
    merge: info.merge || null,
    time: now,
    bytes: sizeOf(patch),
    selBefore: info.selBefore || [],
    selAfter: info.selAfter || [],
    revBefore: h.rev,
    revAfter: h.nextRev++,
  };
  h.rev = step.revAfter;
  h.undo.push(step);
  h.bytes += step.bytes;
  trim(h);
  return step;
}

function sameSel(a = [], b = []) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** Drop the oldest steps beyond the limits (always keeps the latest one). */
function trim(h) {
  while (h.undo.length > 1 && (h.undo.length > h.maxSteps || h.bytes > h.maxBytes)) {
    h.bytes -= h.undo.shift().bytes;
  }
}

/** Undo one step on the document. Returns the step or null. */
export function undo(h, doc) {
  const step = h.undo.pop();
  if (!step) return null;
  apply(doc, h.index, step.patch, 'b');
  h.redo.push(step);
  h.rev = step.revBefore;
  return step;
}

/** Redo one step on the document. Returns the step or null. */
export function redo(h, doc) {
  const step = h.redo.pop();
  if (!step) return null;
  apply(doc, h.index, step.patch, 'a');
  h.undo.push(step);
  h.rev = step.revAfter;
  return step;
}

/** Step label (explicit or derived from the patch), cached. */
export function labelOf(step) {
  if (!step.label) step.label = describe(step.patch);
  return step.label;
}
