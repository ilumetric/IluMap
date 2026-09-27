// Bottom-left minimap: the map rendered small by core/render-svg.js (as an
// <img>, so its ids never clash with the editor canvas), the current viewport
// as a rectangle; click or drag inside to navigate.

import { store, on, visibleLayers } from '../state.js';
import { renderSvg, viewRectOfBounds, fromView } from '../../core/render-svg.js';
import { resolveStyle } from '../../core/styles.js';

const W = 180;
const H = 120;
const PAD = 6;

export function mountMinimap({ canvas }) {
  const root = document.getElementById('minimap');
  const ocean = document.createElement('div');
  ocean.className = 'mm-ocean';
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  const view = document.createElement('div');
  view.className = 'mm-view';
  root.append(ocean, img, view);

  let url = null;
  let timer = 0;
  let geo = null; // { upp, vx, vy } like renderSvg's viewBox

  function geometry() {
    const r = viewRectOfBounds(store.doc);
    const bw = r.x1 - r.x0;
    const bh = r.y1 - r.y0;
    const upp = Math.max(bw / (W - 2 * PAD), bh / (H - 2 * PAD));
    const vx = r.x0 - (W * upp - bw) / 2;
    const vy = r.y0 - (H * upp - bh) / 2;
    return { upp, vx, vy, r };
  }

  function render() {
    timer = 0;
    geo = geometry();
    const layers = visibleLayers().filter((l) => l !== 'labels');
    const svg = renderSvg(store.doc, { width: W, height: H, padding: PAD, background: false, grid: false, labels: false, layers });
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.src = url;
    const { r, upp, vx, vy } = geo;
    Object.assign(ocean.style, {
      left: `${(r.x0 - vx) / upp}px`, top: `${(r.y0 - vy) / upp}px`,
      width: `${(r.x1 - r.x0) / upp}px`, height: `${(r.y1 - r.y0) / upp}px`,
      background: resolveStyle(store.doc.style).ocean,
    });
    updateView();
  }

  function schedule(delay = 250) {
    clearTimeout(timer);
    timer = setTimeout(render, delay);
  }

  function updateView() {
    if (!geo) return;
    const v = canvas.visibleViewRect();
    const { upp, vx, vy } = geo;
    let x0 = (v.x0 - vx) / upp;
    let y0 = (v.y0 - vy) / upp;
    let x1 = (v.x1 - vx) / upp;
    let y1 = (v.y1 - vy) / upp;
    // clip to the card, keep at least a visible marker
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    const hidden = x1 - x0 < 1 || y1 - y0 < 1;
    view.hidden = hidden;
    if (hidden) return;
    Object.assign(view.style, { left: `${x0}px`, top: `${y0}px`, width: `${Math.max(3, x1 - x0)}px`, height: `${Math.max(3, y1 - y0)}px` });
  }

  function navigate(e) {
    if (!geo) return;
    const b = root.getBoundingClientRect();
    const px = e.clientX - b.left;
    const py = e.clientY - b.top;
    const vpt = [geo.vx + px * geo.upp, geo.vy + py * geo.upp];
    canvas.centerOn(fromView(store.doc, vpt));
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    root.setPointerCapture(e.pointerId);
    root.classList.add('dragging');
    navigate(e);
    const move = (ev) => navigate(ev);
    const up = () => {
      root.classList.remove('dragging');
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  });
  root.addEventListener('wheel', (e) => { e.preventDefault(); canvas.zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

  on('doc', (d) => {
    if (d?.load) schedule(0);
    else if (!d?.live) schedule();
  });
  on('layers', () => schedule());
  on('view', updateView);
  schedule(0);
}
