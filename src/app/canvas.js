// SVG viewport: pan/zoom, ocean (inside the bounds only), calibrated background
// image, grid, bounds, layer content (via core/render-svg.js), selection +
// vertex handles, tool overlay. Outside the bounds the stage shows the UI's
// dot grid, which follows pan/zoom through CSS custom properties.

import { store, on, emit, isLayerLocked, visibleLayers } from './state.js';
import { renderParts, renderGrid, viewRectOfBounds, toView, fromView, esc } from '../core/render-svg.js';
import { resolveStyle } from '../core/styles.js';
import { fromPairs } from '../core/calibration.js';
import { findById } from '../core/model.js';
import { formatLength } from '../core/text-export.js';
import { catmullRomToPath, linearPath } from '../core/geometry.js';

const r2 = (v) => Math.round(v * 100) / 100;

export class Canvas {
  constructor(stage, { getTool }) {
    this.stage = stage;
    this.svg = stage.querySelector('#canvas');
    this.getTool = getTool;
    this.svg.innerHTML = '<defs id="cv-static"><clipPath id="cv-bounds-clip"><rect id="cv-clip-rect"/></clipPath></defs>'
      + '<defs id="cv-defs"></defs><g id="cv-world"><g id="cv-ocean"></g><g id="cv-bg"></g><g id="cv-grid" clip-path="url(#cv-bounds-clip)"></g>'
      + '<g id="cv-bounds"></g><g id="cv-content"></g><g id="cv-overlay"></g><g id="cv-tool"></g></g>';
    this.g = {
      defs: this.svg.querySelector('#cv-defs'),
      clip: this.svg.querySelector('#cv-clip-rect'),
      ocean: this.svg.querySelector('#cv-ocean'),
      world: this.svg.querySelector('#cv-world'),
      bg: this.svg.querySelector('#cv-bg'),
      grid: this.svg.querySelector('#cv-grid'),
      bounds: this.svg.querySelector('#cv-bounds'),
      content: this.svg.querySelector('#cv-content'),
      overlay: this.svg.querySelector('#cv-overlay'),
      tool: this.svg.querySelector('#cv-tool'),
    };
    this.view = { k: 1, tx: 0, ty: 0 };
    this.kFit = 1;
    this.flags = new Set();
    this.raf = 0;
    this.pan = null;
    this.lastDown = { t: 0, x: 0, y: 0, count: 0 };
    this.spaceDown = false;
    this.lastRenderedK = null;
    this.bindEvents();
    // keep the map fitted until the user pans or zooms (the first fit can happen before layout)
    this.autoFit = true;
    new ResizeObserver(() => { if (this.autoFit) this.fit(); else this.invalidate('grid', 'transform'); }).observe(this.stage);

    on('doc', (d) => {
      // a new document, or flipping the y axis (also via undo), re-frames the view
      const flip = !!store.doc.meta.flipY;
      if (d?.load || flip !== this.lastFlip) { this.lastFlip = flip; this.fit(); }
      this.invalidate('content', 'overlay', 'tool', 'bg', 'grid');
    });
    on('selection', () => this.invalidate('content', 'overlay'));
    on('layers', () => this.invalidate('content', 'overlay'));
    on('tool', () => { this.updateCursor(); this.invalidate('tool'); });
    on('background', () => this.invalidate('bg'));
  }

  // --- coordinates -----------------------------------------------------------

  get unitsPerPx() { return 1 / this.view.k; }

  size() {
    const r = this.stage.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height), left: r.left, top: r.top };
  }

  clientToScreen(cx, cy) {
    const r = this.svg.getBoundingClientRect();
    return [cx - r.left, cy - r.top];
  }

  screenToView([sx, sy]) {
    return [(sx - this.view.tx) / this.view.k, (sy - this.view.ty) / this.view.k];
  }

  viewToScreen([vx, vy]) {
    return [vx * this.view.k + this.view.tx, vy * this.view.k + this.view.ty];
  }

  clientToWorld(cx, cy) {
    return fromView(store.doc, this.screenToView(this.clientToScreen(cx, cy)));
  }

  worldToScreen(p) {
    return this.viewToScreen(toView(store.doc, p));
  }

  snap(p) {
    const step = store.doc.view.grid?.step > 0 ? store.doc.view.grid.step : 1;
    return [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step];
  }

  // --- view ------------------------------------------------------------------

  /** Screen margins kept free of the map when fitting (floating chrome). */
  fitInsets() {
    const { w, h } = this.size();
    const big = w > 900 && h > 560;
    return big ? { l: 72, r: 64, t: 64, b: 84 } : { l: 12, r: 12, t: 12, b: 12 };
  }

  fit() {
    const { w, h } = this.size();
    const r = viewRectOfBounds(store.doc);
    const bw = r.x1 - r.x0;
    const bh = r.y1 - r.y0;
    const ins = this.fitInsets();
    const aw = Math.max(40, w - ins.l - ins.r);
    const ah = Math.max(40, h - ins.t - ins.b);
    const k = Math.min(aw / bw, ah / bh) * 0.96;
    this.kFit = k;
    this.autoFit = true;
    const cx = ins.l + aw / 2;
    const cy = ins.t + ah / 2;
    this.view = { k, tx: cx - ((r.x0 + r.x1) / 2) * k, ty: cy - ((r.y0 + r.y1) / 2) * k };
    this.invalidate('transform', 'content', 'overlay', 'grid', 'tool', 'bg');
  }

  zoomAt(factor, sx, sy) {
    this.autoFit = false;
    const k0 = this.view.k;
    const k = Math.max(this.kFit / 50, Math.min(this.kFit * 5000, k0 * factor));
    const f = k / k0;
    this.view = { k, tx: sx - (sx - this.view.tx) * f, ty: sy - (sy - this.view.ty) * f };
    this.invalidate('transform', 'content', 'overlay', 'grid', 'tool');
  }

  zoomBy(factor) {
    const { w, h } = this.size();
    this.zoomAt(factor, w / 2, h / 2);
  }

  panBy(dx, dy) {
    this.autoFit = false;
    this.view.tx += dx;
    this.view.ty += dy;
    this.invalidate('transform', 'grid');
  }

  centerOn(world, { minZoom } = {}) {
    this.autoFit = false;
    const { w, h } = this.size();
    if (minZoom && this.view.k < this.kFit * minZoom) this.view.k = this.kFit * minZoom;
    const [vx, vy] = toView(store.doc, world);
    this.view.tx = w / 2 - vx * this.view.k;
    this.view.ty = h / 2 - vy * this.view.k;
    this.invalidate('transform', 'content', 'overlay', 'grid', 'tool');
  }

  zoomPercent() { return Math.round((this.view.k / this.kFit) * 100); }

  // --- rendering ---------------------------------------------------------------

  invalidate(...what) {
    for (const w of what) this.flags.add(w);
    if (!this.raf) this.raf = requestAnimationFrame(() => this.flush());
  }

  flush() {
    this.raf = 0;
    const f = this.flags;
    this.flags = new Set();
    if (f.has('transform')) {
      const { k, tx, ty } = this.view;
      this.g.world.setAttribute('transform', `matrix(${k} 0 0 ${k} ${r2(tx)} ${r2(ty)})`);
      this.updateDots();
      emit('view');
    }
    if (f.has('content')) this.renderContent();
    if (f.has('grid')) this.renderGrid();
    if (f.has('bg')) this.renderBackground();
    if (f.has('overlay')) this.renderOverlay();
    if (f.has('tool')) this.renderTool();
  }

  renderContent() {
    const doc = store.doc;
    const parts = renderParts(doc, {
      unitsPerPx: this.unitsPerPx,
      layers: visibleLayers(),
      interactive: true,
      selection: store.selection,
    });
    this.style = parts.style;
    this.g.defs.innerHTML = parts.defs;
    this.g.content.innerHTML = parts.body;
    const locked = [...Object.keys(store.prefs.layers)].filter(isLayerLocked);
    this.g.content.dataset.locked = locked.join(' ');
  }

  visibleViewRect() {
    const { w, h } = this.size();
    const a = this.screenToView([0, 0]);
    const b = this.screenToView([w, h]);
    return { x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
  }

  /** The UI dot grid (CSS background of the stage) follows pan and zoom. */
  updateDots() {
    const { k, tx, ty } = this.view;
    // spacing stays between 20 and 40 px: doubles/halves as the zoom crosses powers of two
    const rel = Math.log2(Math.max(1e-9, k / this.kFit));
    const size = 20 * 2 ** (rel - Math.floor(rel));
    const st = this.stage.style;
    st.setProperty('--dot-size', `${r2(size)}px`);
    st.setProperty('--dot-x', `${r2(tx % size)}px`);
    st.setProperty('--dot-y', `${r2(ty % size)}px`);
  }

  renderGrid() {
    const doc = store.doc;
    const rs = this.style || resolveStyle(doc.style);
    const upp = this.unitsPerPx;
    const r = viewRectOfBounds(doc);
    const rect = `x="${r.x0}" y="${r.y0}" width="${r.x1 - r.x0}" height="${r.y1 - r.y0}"`;
    // ocean only inside the world bounds; outside, the stage's dot grid shows through
    this.g.ocean.innerHTML = `<rect ${rect} fill="${rs.ocean}"/>`;
    for (const [k, v] of Object.entries({ x: r.x0, y: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 })) this.g.clip.setAttribute(k, v);
    this.g.grid.innerHTML = doc.view.grid?.visible !== false ? renderGrid(doc, this.visibleViewRect(), { unitsPerPx: upp, resolvedStyle: rs }) : '';
    this.g.bounds.innerHTML = `<rect ${rect} fill="none" stroke="${rs.boundsColor}" stroke-width="${r2(1 * upp)}" stroke-dasharray="${r2(6 * upp)} ${r2(5 * upp)}" opacity="0.55"/>`;
    this.updateScaleBar();
  }

  /** Current background transform in view space, or null. */
  backgroundMatrix() {
    const bg = store.doc.view.background;
    const img = store.background;
    if (!bg || !img?.url || !Array.isArray(bg.calibration) || bg.calibration.length !== 2) return null;
    let T;
    try { T = fromPairs(bg.calibration, { reflect: !!store.doc.meta.flipY }); } catch { return null; }
    const s = store.doc.meta.flipY ? -1 : 1;
    return { T, m: [T.a, s * T.d, T.b, s * T.e, T.c, s * T.f] };
  }

  renderBackground() {
    const bg = store.doc.view.background;
    const img = store.background;
    const M = this.backgroundMatrix();
    if (!M) { this.g.bg.innerHTML = ''; return; }
    const op = bg.opacity ?? 0.6;
    this.g.bg.innerHTML = `<image href="${esc(img.url)}" x="0" y="0" width="${img.width}" height="${img.height}" preserveAspectRatio="none" opacity="${op}" transform="matrix(${M.m.join(' ')})" style="image-rendering:auto"/>`;
  }

  renderOverlay() {
    const doc = store.doc;
    const upp = this.unitsPerPx;
    const V = (p) => toView(doc, p);
    let s = '';
    const sel = [...store.selection];
    const showHandles = sel.length <= 6;
    for (const id of sel) {
      const hit = findById(doc, id);
      if (!hit) continue;
      if (hit.kind === 'poi') {
        const p = hit.item;
        if (p.placed === false) continue;
        const [x, y] = V([p.x, p.y]);
        s += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(15 * upp)}" class="ov-sel" stroke-width="${r2(2 * upp)}"/>`;
      } else if (hit.kind === 'feature') {
        const f = hit.item;
        const pts = f.points.map(V);
        const closed = f.kind === 'polygon' || f.closed === true;
        const d = f.smooth && hit.layer !== 'walls' ? catmullRomToPath(pts, closed) : linearPath(pts, closed);
        s += `<path d="${d}" class="ov-sel" stroke-width="${r2(1.5 * upp)}" stroke-dasharray="${r2(6 * upp)} ${r2(4 * upp)}"/>`;
        if (f.smooth && showHandles) s += `<path d="${linearPath(pts, closed)}" class="ov-cage" stroke-width="${r2(1 * upp)}"/>`;
        if (showHandles && !isLayerLocked(hit.layer)) {
          pts.forEach(([x, y], i) => {
            s += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2((i === 0 ? 5.5 : 4.5) * upp)}" class="ov-vertex${i === 0 ? ' first' : ''}" stroke-width="${r2(1.5 * upp)}" data-vertex="${i}" data-fid="${esc(f.id)}"/>`;
          });
        }
      }
    }
    this.g.overlay.innerHTML = s;
  }

  renderTool() {
    const tool = this.getTool();
    this.g.tool.innerHTML = tool?.overlay ? tool.overlay(this) || '' : '';
  }

  updateScaleBar() {
    const el = document.getElementById('scalebar');
    if (!el) return;
    const meta = store.doc.meta;
    const scale = meta.displayUnitScale > 0 ? meta.displayUnitScale : 100;
    const targetPx = 120;
    const worldPerPx = this.unitsPerPx;
    const disp = (targetPx * worldPerPx) / scale; // display units in target
    const pow = 10 ** Math.floor(Math.log10(disp));
    let nice = pow;
    for (const m of [1, 2, 5, 10]) if (m * pow <= disp) nice = m * pow;
    const px = (nice * scale) / worldPerPx;
    el.querySelector('.bar').style.width = `${Math.round(px)}px`;
    el.querySelector('.lbl').textContent = formatLength(nice * scale, meta);
  }

  updateCursor() {
    const t = store.tool;
    let c = 'default';
    if (this.pan) c = 'grabbing';
    else if (this.spaceDown || t === 'pan') c = 'grab';
    else if (['line', 'polygon', 'wall', 'poi', 'measure', 'calibrate'].includes(t)) c = 'crosshair';
    this.svg.style.cursor = c;
  }

  // --- events -------------------------------------------------------------------

  /** Grid snapping for this event: the snap toggle, inverted while Shift is held. */
  snapFor(e) { return !!e.shiftKey !== !!store.prefs.snap; }

  hitFromTarget(target) {
    if (!target || !target.closest) return null;
    const v = target.closest('[data-vertex]');
    if (v) return { type: 'vertex', id: v.dataset.fid, index: Number(v.dataset.vertex) };
    const el = target.closest('#cv-content [data-id]');
    if (!el) return null;
    const kind = el.dataset.kind === 'poi' ? 'poi' : 'feature';
    const layer = kind === 'poi' ? 'pois' : el.dataset.layer;
    if (isLayerLocked(layer)) return null;
    return { type: kind, id: el.dataset.id, layer };
  }

  makeCtx(e, extra = {}) {
    const screen = this.clientToScreen(e.clientX, e.clientY);
    const view = this.screenToView(screen);
    return {
      e, screen, view,
      world: fromView(store.doc, view),
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      snap: this.snapFor(e),
      button: e.button,
      canvas: this,
      ...extra,
    };
  }

  bindEvents() {
    const svg = this.svg;
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = this.clientToScreen(e.clientX, e.clientY);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
    }, { passive: false });

    svg.addEventListener('contextmenu', (e) => e.preventDefault());

    svg.addEventListener('pointerdown', (e) => {
      svg.focus({ preventScroll: true });
      if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur && document.activeElement !== svg) document.activeElement.blur();
      const tool = this.getTool();
      if (e.button === 1 || (e.button === 0 && (this.spaceDown || store.tool === 'pan'))) {
        e.preventDefault();
        this.pan = { x: e.clientX, y: e.clientY };
        svg.setPointerCapture(e.pointerId);
        this.updateCursor();
        return;
      }
      // click counting (DOM under the pointer is re-rendered, so dblclick events are unreliable)
      const now = performance.now();
      const L = this.lastDown;
      const same = now - L.t < 380 && Math.hypot(e.clientX - L.x, e.clientY - L.y) < 6 && e.button === L.button;
      const clicks = same ? L.count + 1 : 1;
      this.lastDown = { t: now, x: e.clientX, y: e.clientY, count: clicks, button: e.button };
      const ctx = this.makeCtx(e, { hit: this.hitFromTarget(e.target), clicks });
      if (e.button === 2) { tool?.contextmenu?.(ctx); return; }
      if (e.button !== 0) return;
      svg.setPointerCapture(e.pointerId);
      this.dragging = true;
      tool?.down?.(ctx);
    });

    svg.addEventListener('pointermove', (e) => {
      const ctx = this.makeCtx(e);
      store.cursor = ctx.world;
      emit('cursor', ctx.world);
      if (this.pan) {
        this.panBy(e.clientX - this.pan.x, e.clientY - this.pan.y);
        this.pan = { x: e.clientX, y: e.clientY };
        return;
      }
      const tool = this.getTool();
      ctx.hit = this.dragging ? null : this.hitFromTarget(e.target);
      ctx.dragging = !!this.dragging;
      tool?.move?.(ctx);
    });

    const end = (e) => {
      if (this.pan) {
        this.pan = null;
        this.updateCursor();
        return;
      }
      if (!this.dragging) return;
      this.dragging = false;
      const tool = this.getTool();
      tool?.up?.(this.makeCtx(e));
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', () => { store.cursor = null; emit('cursor', null); });

    // drag & drop: POIs from the list (onto the map, not onto floating chrome),
    // map.json / images from the OS (anywhere on the stage)
    const overChrome = (e) => !!e.target.closest?.('.chrome');
    this.stage.addEventListener('dragover', (e) => {
      const types = [...(e.dataTransfer?.types || [])];
      const files = types.includes('Files');
      if (files || (types.includes('application/x-ilumap-poi') && !overChrome(e))) {
        e.preventDefault();
        e.dataTransfer.dropEffect = files ? 'copy' : 'move';
        this.stage.classList.toggle('drop-files', files);
        this.stage.classList.add('drop-target');
      } else {
        this.stage.classList.remove('drop-target', 'drop-files');
      }
    });
    this.stage.addEventListener('dragleave', (e) => {
      if (!this.stage.contains(e.relatedTarget)) this.stage.classList.remove('drop-target', 'drop-files');
    });
    this.stage.addEventListener('drop', (e) => {
      this.stage.classList.remove('drop-target', 'drop-files');
      const id = e.dataTransfer.getData('application/x-ilumap-poi');
      if (id) {
        if (overChrome(e)) return;
        e.preventDefault();
        emit('poi-drop', { id, world: this.clientToWorld(e.clientX, e.clientY), snap: this.snapFor(e) });
      } else if (e.dataTransfer.files?.length) {
        e.preventDefault();
        // file handles must be requested synchronously, while the drop event is being dispatched
        const handles = [...(e.dataTransfer.items || [])]
          .filter((it) => it.kind === 'file' && it.getAsFileSystemHandle)
          .map((it) => it.getAsFileSystemHandle().catch(() => null));
        emit('files-drop', { files: [...e.dataTransfer.files], handles });
      }
    });
  }
}
