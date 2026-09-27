// map.json -> SVG. Used for exports (browser + CLI) and by the editor canvas
// for the layer content, so the screen and the exports match.
//
// SVG user space = world units, with y negated when meta.flipY is true
// (so +y is up on screen). Stroke widths, icon and font sizes are given in
// screen pixels and converted with `unitsPerPx`.

import { DRAW_ORDER } from './schema.js';
import { resolveStyle, featureStyle, poiStyle, STATUS_COLORS } from './styles.js';
import {
  catmullRomToPath, linearPath, centroid, featureGeometry, wallLayout, cutGaps, atDistance, polylineLength,
} from './geometry.js';

/** Icon paths in a 24x24 box centred on 0,0. */
export const ICONS = {
  dot: '<circle r="5" fill="currentColor"/>',
  house: '<path fill="currentColor" d="M-7.5 0.5 L0 -7 L7.5 0.5 L5.5 0.5 L5.5 7 L1.8 7 L1.8 2.5 L-1.8 2.5 L-1.8 7 L-5.5 7 L-5.5 0.5 Z"/>',
  castle: '<path fill="currentColor" fill-rule="evenodd" d="M-8 8 V-5 H-5.2 V-2.5 H-2.6 V-5 H0 H2.6 V-2.5 H5.2 V-5 H8 V8 Z M-2.2 8 V3 A2.2 2.2 0 0 1 2.2 3 V8 Z"/><path fill="currentColor" d="M-1.2 -5 V-9 L3.2 -7.8 L-0.2 -6.8 V-5 Z"/>',
  pick: '<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M-8 -2.5 C-4 -8.5 4 -8.5 8 -2.5"/><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M0 -6.5 L0 8"/>',
  ruin: '<path fill="currentColor" d="M-8.5 8 H8.5 V5.8 H-8.5 Z M-6.8 5.8 V-4.5 H-3.4 V5.8 Z M-1.7 5.8 V-7.5 H1.7 V-2 L0.4 -0.6 L1.7 0.8 V5.8 Z M3.4 5.8 V0.5 L5.1 -1.2 L6.8 0.5 V5.8 Z"/>',
  tent: '<path fill="currentColor" fill-rule="evenodd" d="M-9 7.5 L0 -8 L9 7.5 Z M-2.4 7.5 L0 2.2 L2.4 7.5 Z"/>',
  gate: '<path fill="currentColor" d="M-8 8 V-3 A8 8 0 0 1 8 -3 V8 H4.2 V-2.2 A4.2 4.2 0 0 0 -4.2 -2.2 V8 Z"/>',
  tower: '<path fill="currentColor" fill-rule="evenodd" d="M-4.5 8 V-4 H-6 V-8.5 H-3.6 V-6.8 H-1.2 V-8.5 H1.2 V-6.8 H3.6 V-8.5 H6 V-4 H4.5 V8 Z M-1.1 -1.5 H1.1 V2 H-1.1 Z"/>',
  campfire: '<path fill="currentColor" d="M0 -8.5 C3.8 -5 4.8 -1.6 2.9 1.4 C2.5 -0.8 1.5 -1.8 0.5 -2.4 C0.9 -0.2 -0.5 1.1 -1.8 1.8 C-3.8 -0.8 -3.1 -4.6 0 -8.5 Z"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M-7 7.5 L7 3.8 M-7 3.8 L7 7.5"/>',
  cave: '<path fill="currentColor" fill-rule="evenodd" d="M-9.5 8 C-9 -1 -5 -7 0 -7 C5 -7 9 -1 9.5 8 Z M-3.5 8 V3 A3.5 3.5 0 0 1 3.5 3 V8 Z"/>',
  peak: '<path fill="currentColor" d="M-9.5 7.5 L-3 -3 L0 1 L3.5 -7.5 L9.5 7.5 Z"/>',
  tree: '<path fill="currentColor" d="M0 -9 L6.5 1 H3 L7.5 6 H1.3 V9 H-1.3 V6 H-7.5 L-3 1 H-6.5 Z"/>',
  farm: '<path fill="currentColor" fill-rule="evenodd" d="M-8 8 V-2 L-4.5 -7 H4.5 L8 -2 V8 Z M-3 8 V2 H3 V8 Z"/>',
  anchor: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cy="-6" r="2"/><path d="M0 -4 V8 M-4 -1 H4 M-7.5 2.5 C-7 6.5 -3.5 8 0 8 C3.5 8 7 6.5 7.5 2.5"/></g>',
  bridge: '<path fill="currentColor" d="M-10 -3 H10 V6 H6.5 A6.5 5 0 0 0 -6.5 6 H-10 Z"/>',
  shrine: '<path fill="currentColor" d="M-9.5 -7.5 H9.5 L8.5 -5 H-8.5 Z M-7 -3 H7 V-1 H-7 Z M-5.8 -5 H-3.4 V8 H-5.8 Z M3.4 -5 H5.8 V8 H3.4 Z"/>',
  skull: '<path fill="currentColor" fill-rule="evenodd" d="M0 -8.5 C5 -8.5 8 -5 8 -1 C8 2 6.5 3.5 5 4 V7.5 H-5 V4 C-6.5 3.5 -8 2 -8 -1 C-8 -5 -5 -8.5 0 -8.5 Z M-5.4 -1.5 a2.3 2.3 0 1 0 4.6 0 a2.3 2.3 0 1 0 -4.6 0 Z M0.8 -1.5 a2.3 2.3 0 1 0 4.6 0 a2.3 2.3 0 1 0 -4.6 0 Z"/>',
  chest: '<path fill="currentColor" fill-rule="evenodd" d="M-9 -1 V-3 C-9 -6 -7 -7.5 -4 -7.5 H4 C7 -7.5 9 -6 9 -3 V-1 Z M-9 0.5 H9 V7.5 H-9 Z"/><rect x="-1.6" y="-2.2" width="3.2" height="4.6" rx="0.6" fill="currentColor" stroke="#000" stroke-opacity="0.35" stroke-width="0.8"/>',
  star: '<path fill="currentColor" d="M0 -9 L2.23 -3.07 L8.56 -2.78 L3.61 1.17 L5.29 7.28 L0 3.8 L-5.29 7.28 L-3.61 1.17 L-8.56 -2.78 L-2.23 -3.07 Z"/>',
  flag: '<path fill="currentColor" d="M-6 -8.5 H-3.8 V8.5 H-6 Z M-3.8 -8 H7.5 L5 -4.5 L7.5 -1 H-3.8 Z"/>',
  quest: '<path fill="currentColor" d="M-2 -8.5 H2 L1.2 3 H-1.2 Z"/><circle cy="6.4" r="2" fill="currentColor"/>',
  question: '<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M-4 -4 C-4 -7.5 -1.5 -8.5 0.3 -8.5 C3 -8.5 4.5 -6.8 4.5 -4.6 C4.5 -1.5 0.5 -1.2 0.5 2.2"/><circle cx="0.5" cy="6.5" r="1.8" fill="currentColor"/>',
  car: '<path fill="currentColor" fill-rule="evenodd" d="M-9 3.5 V0 L-6.8 -1.4 L-4.4 -5.5 H4.4 L6.8 -1.4 L9 0 V3.5 Z M-3.4 -4.2 H-0.6 V-1.6 H-5 Z M0.6 -4.2 H3.4 L5 -1.6 H0.6 Z"/><circle cx="-5" cy="4.6" r="2.3" fill="currentColor"/><circle cx="5" cy="4.6" r="2.3" fill="currentColor"/>',
  truck: '<path fill="currentColor" d="M-9.5 -6.5 H2.5 V3.2 H-9.5 Z"/><path fill="currentColor" fill-rule="evenodd" d="M3.5 -3.2 H7 L9.5 0 V3.2 H3.5 Z M4.6 -2.2 H6.5 L8 -0.3 H4.6 Z"/><circle cx="-5.8" cy="5" r="2.2" fill="currentColor"/><circle cx="6" cy="5" r="2.2" fill="currentColor"/>',
  bus: '<path fill="currentColor" fill-rule="evenodd" d="M-8 -8.5 H8 A1.5 1.5 0 0 1 9.5 -7 V5 H-9.5 V-7 A1.5 1.5 0 0 1 -8 -8.5 Z M-7.8 -6.6 H7.8 V-1.2 H-7.8 Z M-7 1.3 H-4.5 V3 H-7 Z M4.5 1.3 H7 V3 H4.5 Z"/><circle cx="-5.3" cy="6.4" r="2" fill="currentColor"/><circle cx="5.3" cy="6.4" r="2" fill="currentColor"/>',
  train: '<path fill="currentColor" fill-rule="evenodd" d="M-6 -9 H6 A2 2 0 0 1 8 -7 V4 A2 2 0 0 1 6 6 H-6 A2 2 0 0 1 -8 4 V-7 A2 2 0 0 1 -6 -9 Z M-5.8 -6.8 H5.8 V-1.2 H-5.8 Z M-5.2 2.4 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0 Z M2.6 2.4 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0 Z"/><path fill="currentColor" d="M-5 6 L-7.5 9.5 H-5.2 L-3.2 6 Z M5 6 L7.5 9.5 H5.2 L3.2 6 Z"/>',
  cart: '<path fill="currentColor" d="M-9 -4 H5.5 V2.2 H-9 Z M5.5 -2 H9.5 V-0.5 H5.5 Z"/><path fill="currentColor" fill-rule="evenodd" d="M-7.4 5.3 a3.2 3.2 0 1 0 6.4 0 a3.2 3.2 0 1 0 -6.4 0 Z M-5.4 5.3 a1.2 1.2 0 1 0 2.4 0 a1.2 1.2 0 1 0 -2.4 0 Z"/>',
  ship: '<path fill="currentColor" d="M-9.5 1 H9.5 L7 7.5 H-7 Z M-4.5 1 V-3.5 H3.5 V1 Z M-1.2 -3.5 V-8 H1.6 V-3.5 Z"/>',
  boat: '<path fill="currentColor" d="M-0.5 -9.5 V1.5 H-8 Z M1 -7 L7.5 1.5 H1 Z M-9.5 3 H9.5 L6.8 7.5 H-6.8 Z"/>',
  plane: '<path fill="currentColor" d="M0 -9.5 C1 -9.5 1.4 -8 1.4 -6.5 V-2.2 L9.5 2.6 V4.8 L1.4 2.4 V6 L4.2 8 V9.6 L0 8.4 L-4.2 9.6 V8 L-1.4 6 V2.4 L-9.5 4.8 V2.6 L-1.4 -2.2 V-6.5 C-1.4 -8 -1 -9.5 0 -9.5 Z"/>',
  helipad: '<circle r="8.6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><path fill="currentColor" d="M-4.4 -5 H-2 V-1.1 H2 V-5 H4.4 V5 H2 V1.1 H-2 V5 H-4.4 Z"/>',
  fuel: '<path fill="currentColor" fill-rule="evenodd" d="M-7.5 9 V-7 A2 2 0 0 1 -5.5 -9 H1.5 A2 2 0 0 1 3.5 -7 V9 Z M-5.5 -7 H1.5 V-2.5 H-5.5 Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3.5 -3.5 H5.5 A1.5 1.5 0 0 1 7 -2 V5 A1.5 1.5 0 0 0 10 5 V-3 L8 -6"/>',
  parking: '<path fill="currentColor" fill-rule="evenodd" d="M-7.5 -9 H7.5 A1.5 1.5 0 0 1 9 -7.5 V7.5 A1.5 1.5 0 0 1 7.5 9 H-7.5 A1.5 1.5 0 0 1 -9 7.5 V-7.5 A1.5 1.5 0 0 1 -7.5 -9 Z M-3.2 5.5 V-5.5 H1.3 A3.4 3.4 0 0 1 1.3 1.3 H-0.7 V5.5 Z M-0.7 -3.2 V-1 H1.2 A1.1 1.1 0 0 0 1.2 -3.2 Z"/>',
  signpost: '<path fill="currentColor" d="M-1 -9.5 H1 V9.5 H-1 Z M1 -7.5 H6.8 L9 -5.3 L6.8 -3.1 H1 Z M-1 -1.5 H-6.8 L-9 0.7 L-6.8 2.9 H-1 Z"/>',
  church: '<path fill="currentColor" fill-rule="evenodd" d="M-1 -9.5 H1 V-7.6 H3 V-5.8 H1 V-3.8 L6.5 0.2 V8.5 H-6.5 V0.2 L-1 -3.8 V-5.8 H-3 V-7.6 H-1 Z M-1.7 8.5 V4.3 A1.7 1.7 0 0 1 1.7 4.3 V8.5 Z"/>',
  windmill: '<path fill="currentColor" d="M-3.2 9.5 L-2 -1 H2 L3.2 9.5 Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M-6.5 -9 L6.5 4 M6.5 -9 L-6.5 4"/><circle cy="-2.5" r="1.8" fill="currentColor"/>',
  lighthouse: '<path fill="currentColor" d="M-3.2 9.5 L-2.2 -3.8 H2.2 L3.2 9.5 Z M-3.4 -4.4 H3.4 V-6.4 H-3.4 Z M-2 -6.4 V-8 A2 2 0 0 1 2 -8 V-6.4 Z M4 -7.8 L9.5 -9.8 V-4.6 Z M-4 -7.8 L-9.5 -9.8 V-4.6 Z"/>',
  well: '<path fill="currentColor" d="M-8.5 -4.6 L0 -9.5 L8.5 -4.6 Z M-6 -4.6 H-4.4 V1.5 H-6 Z M4.4 -4.6 H6 V1.5 H4.4 Z M-7 1.5 H7 V8.5 H-7 Z"/>',
  bed: '<path fill="currentColor" d="M-9.5 7.5 V-5.5 H-7.5 V1.2 H9.5 V7.5 H7.5 V4.2 H-7.5 V7.5 Z M-6.4 -2.8 H-2.2 V0.2 H-6.4 Z M-1.2 -3.2 H6.2 A3.3 3.3 0 0 1 9.5 0.1 V0.2 H-1.2 Z"/>',
  factory: '<path fill="currentColor" fill-rule="evenodd" d="M-9.5 9 V-2 L-4.5 -5 V-2 L0.5 -5 V-2 L5.5 -5 V-9.5 H9 V9 Z M-6.5 2 H-4 V4.5 H-6.5 Z M-1.5 2 H1 V4.5 H-1.5 Z M3.5 2 H6 V4.5 H3.5 Z"/>',
  warehouse: '<path fill="currentColor" fill-rule="evenodd" d="M-9.5 9 V-3.5 L0 -9 L9.5 -3.5 V9 Z M-5.5 9 V0.5 H5.5 V9 Z"/><path fill="currentColor" d="M-4.5 2 H4.5 V3.2 H-4.5 Z M-4.5 4.8 H4.5 V6 H-4.5 Z M-4.5 7.6 H4.5 V8.8 H-4.5 Z"/>',
  tavern: '<path fill="currentColor" fill-rule="evenodd" d="M-7.5 -5.5 H4 V8.5 H-7.5 Z M-5.4 -2.8 H-4 V6 H-5.4 Z M-2.4 -2.8 H-1 V6 H-2.4 Z M0.6 -2.8 H2 V6 H0.6 Z"/><path fill="currentColor" d="M-8.3 -5.5 C-8.3 -8.8 -5.4 -9.8 -3.8 -8.2 C-2.3 -10 1.3 -10 2.4 -8.2 C4 -9.2 5.6 -7.6 5 -5.5 Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 -2.5 H6.2 A2 2 0 0 1 8.2 -0.5 V2.5 A2 2 0 0 1 6.2 4.5 H4"/>',
  shop: '<path fill="currentColor" d="M-7.5 -3.5 H7.5 L8.5 9 H-8.5 Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M-3.6 -3.5 V-5.2 A3.6 3.6 0 0 1 3.6 -5.2 V-3.5"/>',
  coin: '<path fill="currentColor" fill-rule="evenodd" d="M0 -9.5 A9.5 9.5 0 1 1 0 9.5 A9.5 9.5 0 1 1 0 -9.5 Z M0 -7 A7 7 0 1 0 0 7 A7 7 0 1 0 0 -7 Z"/><path fill="currentColor" d="M-1.1 -5.5 H1.1 V-4.2 C2.6 -3.9 3.6 -3 3.7 -1.7 H1.6 C1.5 -2.3 1 -2.6 0 -2.6 C-1 -2.6 -1.5 -2.2 -1.5 -1.6 C-1.5 -1 -0.9 -0.8 0.4 -0.5 C2.5 0 3.8 0.7 3.8 2.3 C3.8 3.7 2.7 4.6 1.1 4.8 V6 H-1.1 V4.8 C-2.8 4.5 -3.9 3.5 -4 2 H-1.9 C-1.8 2.8 -1.1 3.2 0 3.2 C1.1 3.2 1.7 2.8 1.7 2.2 C1.7 1.6 1.1 1.3 -0.3 1 C-2.3 0.5 -3.5 -0.2 -3.5 -1.7 C-3.5 -3 -2.6 -3.9 -1.1 -4.2 Z"/>',
  hospital: '<path fill="currentColor" fill-rule="evenodd" d="M-7.5 -9 H7.5 A1.5 1.5 0 0 1 9 -7.5 V7.5 A1.5 1.5 0 0 1 7.5 9 H-7.5 A1.5 1.5 0 0 1 -9 7.5 V-7.5 A1.5 1.5 0 0 1 -7.5 -9 Z M-2 -6 H2 V-2 H6 V2 H2 V6 H-2 V2 H-6 V-2 H-2 Z"/>',
  book: '<path fill="currentColor" fill-rule="evenodd" d="M-9.5 -6.5 C-6.3 -8 -2.7 -8 -0.6 -6 V7.5 C-2.7 5.8 -6.3 5.8 -9.5 7 Z M0.6 -6 C2.7 -8 6.3 -8 9.5 -6.5 V7 C6.3 5.8 2.7 5.8 0.6 7.5 Z"/>',
  shield: '<path fill="currentColor" d="M0 -9.5 L8.2 -6.5 V-0.5 C8.2 4.5 4.8 7.8 0 9.5 C-4.8 7.8 -8.2 4.5 -8.2 -0.5 V-6.5 Z"/>',
  info: '<path fill="currentColor" fill-rule="evenodd" d="M0 -9.5 A9.5 9.5 0 1 1 0 9.5 A9.5 9.5 0 1 1 0 -9.5 Z M-1.4 -1.6 H1.4 V6 H-1.4 Z M0 -6.8 A1.7 1.7 0 1 0 0 -3.4 A1.7 1.7 0 1 0 0 -6.8 Z"/>',
  gear: '<circle r="7.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" stroke-dasharray="2.9 2.9"/><path fill="currentColor" fill-rule="evenodd" d="M0 -6.2 A6.2 6.2 0 1 1 0 6.2 A6.2 6.2 0 1 1 0 -6.2 Z M0 -2.6 A2.6 2.6 0 1 0 0 2.6 A2.6 2.6 0 1 0 0 -2.6 Z"/>',
  power: '<path fill="currentColor" d="M2.2 -9.5 L-6.8 1.6 H-0.6 L-2.2 9.5 L6.8 -1.6 H0.6 Z"/>',
  antenna: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9" d="M-5.5 9.5 L0 -4.5 L5.5 9.5 M-3.6 4.5 H3.6 M-2 0.4 H2 M-5.5 -9 A7.5 7.5 0 0 0 -5.5 -1.5 M5.5 -9 A7.5 7.5 0 0 1 5.5 -1.5"/><circle cy="-5.3" r="1.9" fill="currentColor"/>',
  water: '<path fill="currentColor" d="M0 -9.5 C3 -5 7 -1.2 7 3 A7 7 0 0 1 -7 3 C-7 -1.2 -3 -5 0 -9.5 Z"/>',
  fish: '<path fill="currentColor" fill-rule="evenodd" d="M-9.5 0 C-5.5 -6.2 2.5 -6.2 5.8 0 C2.5 6.2 -5.5 6.2 -9.5 0 Z M-6.2 -1.4 a1.2 1.2 0 1 0 2.4 0 a1.2 1.2 0 1 0 -2.4 0 Z"/><path fill="currentColor" d="M5 0 L9.8 -4.6 V4.6 Z"/>',
  paw: '<path fill="currentColor" d="M0 0.5 C3.5 0.5 6 3.5 6 6.2 C6 8.4 4.3 9.5 2.5 9 C1.3 8.7 0.8 8.2 0 8.2 C-0.8 8.2 -1.3 8.7 -2.5 9 C-4.3 9.5 -6 8.4 -6 6.2 C-6 3.5 -3.5 0.5 0 0.5 Z"/><ellipse cx="-7" cy="-1.5" rx="2" ry="2.6" fill="currentColor"/><ellipse cx="7" cy="-1.5" rx="2" ry="2.6" fill="currentColor"/><ellipse cx="-2.7" cy="-6.5" rx="2" ry="2.8" fill="currentColor"/><ellipse cx="2.7" cy="-6.5" rx="2" ry="2.8" fill="currentColor"/>',
  fire: '<path fill="currentColor" d="M0 -9.5 C4.2 -5 8 -1 6.2 4.2 C5.2 7.4 2.7 9.5 0 9.5 C-3.6 9.5 -6.6 7 -6.6 3 C-6.6 0 -4.6 -2 -3.6 -4.2 C-3.1 -1.6 -2 0 -0.4 0.6 C-1.6 -3 -1 -6.6 0 -9.5 Z"/>',
  key: '<path fill="currentColor" fill-rule="evenodd" d="M-4.5 -9.5 A5.2 5.2 0 1 1 -4.5 0.9 A5.2 5.2 0 1 1 -4.5 -9.5 Z M-4.5 -6.3 A2 2 0 1 0 -4.5 -2.3 A2 2 0 1 0 -4.5 -6.3 Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M-0.8 -0.6 L8.5 8.7 M4.8 5 L7.4 2.4 M7 7.2 L9 5.2"/>',
  eye: '<path fill="currentColor" fill-rule="evenodd" d="M-10 0 C-6 -7 6 -7 10 0 C6 7 -6 7 -10 0 Z M0 -4 A4 4 0 1 0 0 4 A4 4 0 1 0 0 -4 Z"/><circle r="1.8" fill="currentColor"/>',
  swords: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M-7.5 -8.5 L6 5 M7.5 -8.5 L-6 5 M3 7.8 L8.8 2 M-3 7.8 L-8.8 2"/>',
};

const r2 = (v) => {
  const x = Math.round(v * 100) / 100;
  return Object.is(x, -0) ? 0 : x;
};

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const safeId = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

/** world [x, y] -> SVG user space */
export function toView(doc, p) {
  return [p[0], doc.meta?.flipY ? -p[1] : p[1]];
}

/** SVG user space -> world */
export function fromView(doc, p) {
  return [p[0], doc.meta?.flipY ? -p[1] : p[1]];
}

/** Bounds in SVG user space: {x0, y0, x1, y1}. */
export function viewRectOfBounds(doc, bounds = doc.view.bounds) {
  const a = toView(doc, bounds.min);
  const b = toView(doc, bounds.max);
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}

function pathFor(pts, closed, smooth) {
  return smooth ? catmullRomToPath(pts, closed) : linearPath(pts, closed);
}

function dashAttr(dash, scale) {
  if (!dash) return '';
  const parts = String(dash).trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (!parts.length) return '';
  return ` stroke-dasharray="${parts.map((n) => r2(n * scale)).join(' ')}"`;
}

/** SVG <defs> content: icon symbols and zone patterns. */
export function renderDefs(doc, opts = {}) {
  const upp = opts.unitsPerPx || 1;
  const rs = opts.resolvedStyle || resolveStyle(doc.style);
  let s = '';
  for (const [name, body] of Object.entries(ICONS)) {
    s += `<symbol id="ilm-ico-${name}" viewBox="-12 -12 24 24" overflow="visible">${body}</symbol>`;
  }
  const used = new Set(doc.layers.zones.map((z) => z.type).filter(Boolean));
  for (const [type, t] of Object.entries(rs.zoneTypes)) {
    if (!t.pattern || !used.has(type)) continue;
    const col = t.stroke || t.fill || '#888888';
    const id = `ilm-pat-${safeId(type)}`;
    if (t.pattern === 'hatch') {
      const sz = r2(9 * upp);
      s += `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${sz}" height="${sz}" patternTransform="rotate(45)">`
        + `<line x1="0" y1="0" x2="0" y2="${sz}" stroke="${col}" stroke-width="${r2(1.6 * upp)}" stroke-opacity="0.9"/></pattern>`;
    } else if (t.pattern === 'dots') {
      const sz = r2(8 * upp);
      s += `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${sz}" height="${sz}">`
        + `<circle cx="${r2(sz / 2)}" cy="${r2(sz / 2)}" r="${r2(1.3 * upp)}" fill="${col}" fill-opacity="0.95"/></pattern>`;
    }
  }
  return s;
}

/** Grid lines covering the given view rectangle. */
export function renderGrid(doc, rect, opts = {}) {
  const upp = opts.unitsPerPx || 1;
  const rs = opts.resolvedStyle || resolveStyle(doc.style);
  let step = doc.view.grid?.step > 0 ? doc.view.grid.step : 10000;
  let guard = 0;
  while (step / upp < 14 && guard++ < 20) step *= 5;
  const major = step * 5;
  const x0 = Math.floor(rect.x0 / step) * step;
  const y0 = Math.floor(rect.y0 / step) * step;
  let minor = '';
  let maj = '';
  const isMajor = (v) => Math.abs(Math.round(v / major) * major - v) < step * 1e-6;
  for (let x = x0; x <= rect.x1; x += step) {
    const l = `M${r2(x)} ${r2(rect.y0)}V${r2(rect.y1)}`;
    if (isMajor(x)) maj += l; else minor += l;
  }
  for (let y = y0; y <= rect.y1; y += step) {
    const l = `M${r2(rect.x0)} ${r2(y)}H${r2(rect.x1)}`;
    if (isMajor(y)) maj += l; else minor += l;
  }
  const w = r2(1 * upp);
  return `<g class="ilm-grid" fill="none" stroke="${rs.grid}">`
    + (minor ? `<path d="${minor}" stroke-width="${w}" stroke-opacity="0.45"/>` : '')
    + (maj ? `<path d="${maj}" stroke-width="${w}" stroke-opacity="0.9"/>` : '')
    + '</g>';
}

/**
 * Render all map content (layers, POIs, labels) as SVG fragments.
 * opts: { unitsPerPx, layers?: string[] (visible layer names; 'pois' and 'labels' included),
 *         labels?: bool, interactive?: bool, selection?: Set<string> }
 * @returns {{defs: string, layers: Record<string,string>, pois: string, labels: string, body: string}}
 */
export function renderParts(doc, opts = {}) {
  const upp = opts.unitsPerPx || 1;
  const rs = resolveStyle(doc.style);
  const visible = opts.layers ? new Set(opts.layers) : null;
  const show = (name) => !visible || visible.has(name);
  const showLabels = opts.labels !== false && show('labels');
  const interactive = !!opts.interactive;
  const sel = opts.selection || new Set();
  const flipY = !!doc.meta?.flipY;
  const V = (p) => [p[0], flipY ? -p[1] : p[1]];
  const px = (n) => r2(n * upp);
  const labels = [];
  const layerOut = {};

  // Text is drawn at its pixel size inside a scale(unitsPerPx) group: browsers render
  // very large font sizes (world units) poorly, so labels never use world-sized fonts.
  const labelText = (x, y, text, { size = 12, anchor = 'middle', italic = false, weight = 500, color = rs.label, rotate = 0, spacing = 0, upper = false, opacity = 1 } = {}) => {
    const t = upper ? String(text).toUpperCase() : text;
    const tr = `translate(${r2(x)} ${r2(y)})${rotate ? ` rotate(${r2(rotate)})` : ''} scale(${upp})`;
    return `<text transform="${tr}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="middle"`
      + `${italic ? ' font-style="italic"' : ''} font-weight="${weight}"${spacing ? ` letter-spacing="${spacing}"` : ''}`
      + ` fill="${color}"${opacity !== 1 ? ` fill-opacity="${opacity}"` : ''} stroke="${rs.halo}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(t)}</text>`;
  };

  const lineLabel = (vpts, closed, name, o) => {
    const L = polylineLength(vpts, closed);
    const r = atDistance(vpts, L / 2, closed);
    let deg = (r.angle * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    // offset slightly off the line
    const off = 9 * upp;
    const rad = (deg * Math.PI) / 180;
    const x = r.point[0] + Math.sin(rad) * off * -1;
    const y = r.point[1] + Math.cos(rad) * off * -1;
    labels.push(labelText(x, y, name, { ...o, rotate: deg }));
  };

  const groupOpen = (layer, f, extraClass = '') => {
    const cls = `ilm-feat${sel.has(f.id) ? ' is-selected' : ''}${extraClass}`;
    return interactive ? `<g class="${cls}" data-id="${esc(f.id)}" data-layer="${layer}">` : `<g class="${cls}" id="f-${esc(f.id)}">`;
  };

  const hitPath = (d, W) => (interactive
    ? `<path class="ilm-hit" d="${d}" fill="none" stroke="transparent" stroke-width="${r2(Math.max(W, 12 * upp))}" stroke-linecap="round" stroke-linejoin="round"/>`
    : '');

  const filled = doc.meta?.landMode === 'filled';

  for (const layer of DRAW_ORDER) {
    if (!show(layer)) { layerOut[layer] = ''; continue; }
    const lst = rs.layers[layer] || {};
    let s = '';
    if (layer === 'land' && filled) {
      const r = viewRectOfBounds(doc);
      s += `<rect x="${r2(r.x0)}" y="${r2(r.y0)}" width="${r2(r.x1 - r.x0)}" height="${r2(r.y1 - r.y0)}" fill="${lst.fill}"/>`;
    }
    for (const f of doc.layers[layer]) {
      if (f.hidden) continue;
      const pts = (f.points || []).map(V);
      if (pts.length < 2) continue;
      const st = featureStyle(rs, layer, f);
      const polygon = layer === 'land' || layer === 'water' || layer === 'zones';
      const closed = polygon || f.closed === true;
      if (polygon && pts.length < 3) continue;
      const smooth = !!f.smooth && layer !== 'walls';
      const d = pathFor(pts, closed, smooth);
      const sw = px(st.width);
      let g = groupOpen(layer, f);
      if (layer === 'land') {
        if (filled) g += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${sw}" stroke-dasharray="${px(6)} ${px(4)}" stroke-opacity="0.6"/>`;
        else g += `<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      } else if (layer === 'water') {
        g += `<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      } else if (layer === 'zones') {
        const op = st.opacity ?? 0.35;
        g += `<path d="${d}" fill="${st.fill}" fill-opacity="${op}" stroke="${st.stroke}" stroke-width="${px(1.2)}" stroke-opacity="0.8" stroke-dasharray="${px(5)} ${px(3)}"/>`;
        if (st.pattern) g += `<path d="${d}" fill="url(#ilm-pat-${safeId(f.type)})" fill-opacity="${Math.min(1, op + 0.35)}" stroke="none" pointer-events="none"/>`;
      } else if (layer === 'walls') {
        g += renderWall(f, pts, st, upp, interactive);
      } else {
        const W = st.worldWidth ? Math.max(st.worldWidth, upp) : st.width * upp;
        const cap = layer === 'rails' ? 'butt' : 'round';
        g += hitPath(d, W);
        if (layer === 'rails') {
          const tieW = st.worldWidth ? W * 2.6 : Math.max(W * 3, 7 * upp);
          const tieDash = st.worldWidth ? `${r2(W * 0.35)} ${r2(W * 1.6)}` : `${px(1.5)} ${px(5)}`;
          g += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(tieW)}" stroke-dasharray="${tieDash}" stroke-linejoin="round"/>`;
        }
        if (layer === 'roads' && st.worldWidth == null && !st.dash) {
          // casing for readability
          g += `<path d="${d}" fill="none" stroke="${rs.halo}" stroke-opacity="0.55" stroke-width="${r2(W + 2 * upp)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
        g += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(W)}" stroke-linecap="${cap}" stroke-linejoin="round"${dashAttr(st.dash, st.worldWidth ? W / st.width : upp)}/>`;
      }
      g += '</g>';
      s += g;

      // labels
      if (showLabels && f.name) {
        if (polygon) {
          const geo = featureGeometry({ ...f, points: pts });
          const c = centroid(geo);
          if (layer === 'zones') labels.push(labelText(c[0], c[1], f.name, { size: 11, upper: true, spacing: 2, weight: 600, opacity: 0.85 }));
          else if (layer === 'water') labels.push(labelText(c[0], c[1], f.name, { size: 11, italic: true, color: st.stroke }));
          else {
            // islands are named on the sea, just below their shape, so zone names inside stay readable
            let maxY = -Infinity;
            for (const p of geo) if (p[1] > maxY) maxY = p[1];
            labels.push(labelText(c[0], maxY + 16 * upp, f.name, { size: 13, upper: true, spacing: 3, weight: 700, opacity: 0.9 }));
          }
        } else if (layer === 'rivers') {
          lineLabel(featureGeometry({ ...f, points: pts }), closed, f.name, { size: 10, italic: true, color: st.stroke });
        } else if (layer !== 'walls') {
          lineLabel(featureGeometry({ ...f, points: pts }), closed, f.name, { size: 10 });
        }
      }
      if (showLabels && layer === 'walls') {
        const lay = wallLayout({ ...f, points: pts });
        for (const gt of lay.gates) {
          if (gt.name) labels.push(labelText(gt.point[0], gt.point[1] - 14 * upp, gt.name, { size: 10, weight: 600 }));
        }
      }
    }
    const op = layer !== 'zones' && lst.opacity !== undefined && lst.opacity !== 1 ? ` opacity="${lst.opacity}"` : '';
    layerOut[layer] = `<g id="layer-${layer}"${op}>${s}</g>`;
  }

  // POIs
  let pois = '';
  if (show('pois')) {
    const R = 10 * upp;
    const S = 15 * upp;
    for (const p of doc.pois) {
      if (p.placed === false) continue;
      const [x, y] = V([p.x, p.y]);
      const ps = poiStyle(rs, p);
      const status = p.status || 'idea';
      const ring = STATUS_COLORS[status] || STATUS_COLORS.idea;
      const cls = `ilm-poi${sel.has(p.id) ? ' is-selected' : ''} status-${status}`;
      const attrs = interactive ? ` data-id="${esc(p.id)}" data-kind="poi"` : ` id="poi-${esc(p.id)}"`;
      pois += `<g class="${cls}"${attrs} transform="translate(${r2(x)} ${r2(y)})">`
        + `<circle r="${r2(R)}" fill="${rs.poiBg}" fill-opacity="0.9" stroke="${ring}" stroke-width="${px(2)}"${status === 'idea' ? ` stroke-dasharray="${px(3)} ${px(2)}"` : ''}/>`
        + `<use href="#ilm-ico-${ps.icon}" x="${r2(-S / 2)}" y="${r2(-S / 2)}" width="${r2(S)}" height="${r2(S)}" color="${ps.color}" style="color:${ps.color}"/>`
        + (status === 'cut' ? `<path d="M${r2(-R * 0.75)} ${r2(R * 0.75)}L${r2(R * 0.75)} ${r2(-R * 0.75)}" stroke="${ring}" stroke-width="${px(2)}"/>` : '')
        + '</g>';
      if (showLabels) labels.push(labelText(x + R + 4 * upp, y, p.name, { size: 12, anchor: 'start', weight: 600 }));
    }
  }

  const defs = renderDefs(doc, { unitsPerPx: upp, resolvedStyle: rs });
  const poisG = `<g id="layer-pois">${pois}</g>`;
  const labelsG = `<g id="layer-labels" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" pointer-events="none">${labels.join('')}</g>`;
  const body = DRAW_ORDER.map((l) => layerOut[l]).join('') + poisG + labelsG;
  return { defs, layers: layerOut, pois: poisG, labels: labelsG, body, style: rs };
}

function renderWall(f, pts, st, upp, interactive) {
  const closed = f.closed === true;
  const W = st.worldWidth ? Math.max(st.worldWidth, 2.5 * upp) : st.width * upp;
  const lay = wallLayout({ ...f, points: pts });
  const pieces = cutGaps(pts, closed, lay.gates);
  const pattern = st.pattern || 'crenel';
  let s = '';
  const dAll = linearPath(pts, closed);
  if (interactive) s += `<path class="ilm-hit" d="${dAll}" fill="none" stroke="transparent" stroke-width="${r2(Math.max(W * 2, 12 * upp))}"/>`;
  for (const piece of pieces) {
    if (piece.length < 2) continue;
    const d = linearPath(piece, false);
    if (pattern === 'ticks') {
      s += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(W * 2)}" stroke-dasharray="${r2(W * 0.3)} ${r2(W * 0.55)}"/>`;
      s += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(W * 0.6)}" stroke-linejoin="round"/>`;
    } else {
      s += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(W * 1.7)}" stroke-dasharray="${r2(W * 0.7)} ${r2(W * 0.7)}"/>`;
      s += `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${r2(W)}" stroke-linejoin="miter"/>`;
    }
  }
  const tsz = Math.max(f.wall?.towerSize > 0 ? f.wall.towerSize : 600, W * 2.2);
  for (const t of lay.towers) {
    const deg = r2((t.angle * 180) / Math.PI);
    s += `<rect x="${r2(-tsz / 2)}" y="${r2(-tsz / 2)}" width="${r2(tsz)}" height="${r2(tsz)}" fill="${st.stroke}" transform="translate(${r2(t.point[0])} ${r2(t.point[1])}) rotate(${deg})"/>`;
  }
  const gs = Math.max(14 * upp, tsz);
  for (const g of lay.gates) {
    s += `<use href="#ilm-ico-gate" class="ilm-gate" x="${r2(g.point[0] - gs / 2)}" y="${r2(g.point[1] - gs / 2)}" width="${r2(gs)}" height="${r2(gs)}" color="${st.stroke}" style="color:${st.stroke}"/>`;
  }
  return s;
}

/**
 * Full standalone SVG document.
 * opts: { width, height, padding (px), background (ocean rect, default true), grid (default view.grid.visible),
 *         labels (default true), layers?: string[], selection?: Set, bounds? }
 */
export function renderSvg(doc, opts = {}) {
  const bounds = opts.bounds || doc.view.bounds;
  const rect = viewRectOfBounds(doc, bounds);
  const bw = rect.x1 - rect.x0;
  const bh = rect.y1 - rect.y0;
  const pad = opts.padding ?? 0;
  const width = Math.max(1, Math.round(opts.width ?? 1024));
  const height = Math.max(1, Math.round(opts.height ?? ((width - 2 * pad) * bh) / bw + 2 * pad));
  const upp = Math.max(bw / Math.max(1, width - 2 * pad), bh / Math.max(1, height - 2 * pad));
  const vbW = width * upp;
  const vbH = height * upp;
  const vx = rect.x0 - (vbW - bw) / 2;
  const vy = rect.y0 - (vbH - bh) / 2;
  const parts = renderParts(doc, { unitsPerPx: upp, layers: opts.layers, labels: opts.labels, selection: opts.selection });
  const rs = parts.style;
  const showGrid = opts.grid ?? doc.view.grid?.visible ?? false;
  const vr = { x0: vx, y0: vy, x1: vx + vbW, y1: vy + vbH };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${r2(vx)} ${r2(vy)} ${r2(vbW)} ${r2(vbH)}">\n`;
  s += `<title>${esc(doc.meta?.name || 'IluMap')}</title>\n`;
  s += `<defs>${parts.defs}</defs>\n`;
  if (opts.background !== false) s += `<rect id="ocean" x="${r2(vx)}" y="${r2(vy)}" width="${r2(vbW)}" height="${r2(vbH)}" fill="${rs.ocean}"/>\n`;
  if (showGrid) s += `${renderGrid(doc, vr, { unitsPerPx: upp, resolvedStyle: rs })}\n`;
  for (const l of DRAW_ORDER) s += `${parts.layers[l]}\n`;
  s += `${parts.pois}\n${parts.labels}\n</svg>\n`;
  return s;
}
