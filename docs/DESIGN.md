# IluMap — UI design

The editor chrome borrows ChatGPT's neutral palette: a near-black (or near-white)
canvas that fills the window, a quiet sidebar, and small floating pills and
cards on top of the map. Colour is scarce and meaningful: one teal accent for
"active / primary / focus", plus a few semantic accents. This document is the
contract for contributors — keep new UI inside it.

The **chrome is independent of the map style**. `data-ui-theme` on `<html>`
(dark / light, from Settings: System / Dark / Light) themes the chrome; the
map's `style.preset` (`graphite`, `blueprint`, `parchment`) only colours map
content — the ocean inside the bounds, land, zones, lines, POIs. Nothing in
`src/app/styles.css` may depend on the map preset, and nothing in
`src/core/styles.js` knows about the chrome.

## Tokens

All colours are CSS custom properties on `:root` in `src/app/styles.css`
(dark values first, light below). Never hard-code a colour in a component;
add a token if one is missing.

| token | dark | light | use |
|---|---|---|---|
| `--bg-canvas` | `#111111` | `#f7f7f7` | stage background (outside the map bounds) |
| `--bg-sidebar` | `#0d0d0d` | `#f9f9f9` | sidebar |
| `--surface` | `#1a1a1a` | `#ffffff` | pills, cards, panels, dialogs |
| `--surface-2` | `#212121` | `#f4f4f4` | secondary buttons, toasts, inset areas |
| `--surface-hover` | `#2a2a2a` | `#ececec` | hover, toggled-on buttons |
| `--menu` | `#1f1f1f` | `#ffffff` | menus and popovers |
| `--input` / `--input-border` | `#212121` / `#2f2f2f` | `#ffffff` / `#e0e0e0` | text inputs, selects |
| `--border` | `#2a2a2a` | `#e5e5e5` | 1px borders of pills, cards, separators |
| `--border-subtle` | `rgba(255,255,255,.06)` | `rgba(0,0,0,.06)` | sidebar edge, row separators |
| `--text` | `#ececec` | `#0d0d0d` | primary text |
| `--text-muted` | `#8e8e8e` | `#6b6b6b` | secondary text, idle icons |
| `--text-faint` | `#5d5d5d` | `#a8a8a8` | hints, disabled-looking details |
| `--dot` | `#262626` | `#d9d9d9` | canvas dot grid |
| `--row-hover` / `--row-active` | `#1f1f1f` / `#2a2a2a` | `#efefef` / `#e5e5e5` | list rows (sidebar maps, layers, POIs) |
| `--accent` | `#10a37f` | same | active tool, focus ring, primary buttons, on-state of toggles |
| `--accent-soft` | teal at 16 % | teal at 12 % | focus halo, soft toggle background |
| `--accent-yellow` | `#f5c542` | same | unsaved dot, drawing overlay, `idea` badge, warnings |
| `--accent-red` | `#ef4444` | same | danger actions, `cut` badge, errors |
| `--accent-blue` | `#3b82f6` | same | `slice` badge |

Semantic accents are **sparse**: tool underlines, status badges, toasts'
status dot, danger buttons. Everything else is grey.

Radii: pills `--radius-pill` 14px (tool stacks are fully round), cards and
panels `--radius-card` 14px, menus `--radius-menu` 10px, controls
`--radius-ctl` 8px, icon buttons 10px (round in tool stacks and the FAB).
Shadow: `--shadow` `0 4px 16px rgba(0,0,0,.4)` on everything that floats,
`--shadow-lg` for menus, dialogs and dragged panels.

Type: `--font` = `ui-sans-serif, -apple-system, "Segoe UI", Inter, Roboto,
sans-serif`, 13px base; 12px for secondary text, 11–11.5px for hints and
read-outs; `--mono` for coordinates, ids and file paths. Weights: 400 and 600
only.

## Icons

Every UI icon lives in `src/app/ui/icons.js`: lucide-style inline SVG on a
24×24 grid, `stroke="currentColor"`, 1.5px stroke, round caps and joins,
rendered at 16px. Use `icon(name)` (element) or `iconSvg(name)` (markup).
Icons take their colour from the button (`--text-muted` idle, `--text` on
hover, `--on-accent` when active). Map symbols (POI icons) are different —
they live in `core/render-svg.js` because exports need them.

## Layout

```
┌ sidebar 220px ┐┌ stage (full-bleed canvas, dot grid) ─────────────────────────┐┌ right sidebar 320px ┐
│ IluMap    [◧] ││ [title · save]   [Layers │ ▦ T ▣ │ Export▾]      [↶ ↷ │ ◨] ││ ◎ Points          7 │
│ New map       ││                                                            ││ [search…]       [+] │
│ Search maps   ││ (●)  ┌ Layers ─┐                                           ││ statuses types zones│
│ Open file     ││ (◎)  │         │                                           ││ Unplaced (1)        │
│ Maps          ││ (⌇)  │         │          map                              ││ On the map (6)      │
│  Demo Isles ⋯ ││ (⬠)  └─────────┘                                           │├──────── ═ ─────────┤
│  …            ││ (♜)                                                        ││ [Inspector | Style] │
│               ││ (o)                                                        ││                     │
│               ││ ─1 km─              [tool hint]            x 12 y 34 cm   ││  properties of the  │
│ Settings  RU  ││ [minimap]  [pw Roads │ La Wa … Po │ type o]  [S F │ - % + fit │ ? ⚙] ││  selection / style  │
└───────────────┘└────────────────────────────────────────────────────────────┘└─────────────────────┘
```

* **Sidebar** (`#sidebar`, `ui/sidebar.js`): 220px, `--bg-sidebar`, 1px
  `--border-subtle` right edge. Head: app name + collapse button. Items
  (36px rows, 16px icon + label): New map, Search maps (reveals an inline
  input; `Ctrl+K`), Open file. Section label "Maps" (12px, muted). Map rows:
  one line, ellipsis, hover `--row-hover`, active `--row-active`, a link icon
  when the map is linked to a file, a "⋯" button (visible on hover / active)
  and a right-click menu: Rename, Duplicate, Export JSON, Delete (confirm).
  Settings is pinned to the bottom, with the language switcher next to it: a
  28px outlined pill (globe icon + `RU` / `EN`, 11.5px semibold) that opens a
  menu headed "Language" listing Русский, then English, with a teal check on
  the active one. `Ctrl+B` collapses the sidebar; a round FAB in the stage's
  top-left corner reopens it, and while it is collapsed a Settings gear
  appears at the end of the zoom pill (Settings has the language select too).
* **Right sidebar** (`#rightbar`, `ui/rightbar.js`): docked, not floating;
  320px (284px below a 1280px window), `--bg-sidebar`, 1px `--border-subtle`
  left edge. Top: **Points** (44px header with icon, title and count; the POI
  list with search, filters, the Unplaced section and drag-to-map). A 7px
  **splitter** (row-resize, a 36px grab bar on hover, teal while dragging;
  arrow keys when focused, double-click resets) divides it from the bottom
  part; the split is a UI pref, 36% by default. Bottom: a segmented **tab
  bar** (Inspector | Style) and the tab body. A new selection switches to
  Inspector; with nothing selected the Inspector shows the map settings. The
  top-right pill toggles the whole sidebar (`]`).
* **Stage** (`#stage`): the SVG canvas fills it. The CSS dot grid (1px dots,
  20–40px spacing, `--dot-size/x/y` updated by `canvas.js`) follows pan and
  zoom. The map's ocean is drawn only inside `view.bounds`; the bounds edge is
  a faint dashed line. Everything else is `.chrome`, absolutely positioned
  with a 12px margin from the stage edges:
  * top-left **title pill**: logo, map name (click / `F2` to rename inline),
    save button with the yellow unsaved dot; the tooltip says whether the map
    is linked to a file.
  * top-centre **view pill**: the Layers panel toggle (text + icon), the view
    toggles grid (`G`), labels and background image (popover: opacity,
    calibrate, fit, replace, remove), then the **Export** menu. The menu
    starts with a scope switch — *Whole map* / *Selection (n)* (disabled when
    nothing is selected, remembered in the UI prefs) — followed by JSON, SVG,
    PNG, Masks, Copy as text, Save, Save as. On = `--surface-hover`.
  * top-right **history pill**: undo / redo, then the right-sidebar toggle.
  * left **tool stack** (vertically centred): round pills separated by 8px:
    [Layers] · [Select, Pan] · [Line, Polygon, Wall, POI] · [Measure,
    Calibrate, Delete]. Buttons are 32px circles; the active tool is filled
    with `--accent`. Draw tools have a 2px underline in the colour of the
    layer they will draw into (`layer-meta.js` → `layerColor`, adjusted for
    contrast by `chromeTint`).
  * bottom-centre **layer dock**: power toggle (visibility of the active
    layer; teal when visible), the layer name + "n features · new: type",
    one 28px chip per layer (2-letter abbreviation, 2px ring in the layer
    colour, filled when active, dashed + faded when hidden), the type for new
    features and a colour swatch (edits the layer colour, or the zone / POI
    type colour). Choosing a chip while a draw tool is on switches to the
    tool that fits the layer; the POIs chip picks the POI tool. It is centred
    in the free space between the minimap and the zoom pill.
  * bottom-left: **scale bar** above the **minimap** card (180×120, the map
    rendered by `render-svg.js` into an `<img>`, the viewport as a teal
    rectangle; click / drag / wheel to navigate).
  * bottom-right **zoom pill**: snap and flipY toggles (teal when on), zoom
    − / % / +, fit, keyboard shortcuts (and Settings while the sidebar is
    collapsed). The **cursor read-out** (coordinates in mono, land / water ·
    zone, selection count in teal) sits just above it.
  * above the dock: the **tool HUD** (hint and live measurement), only while
    a tool other than Select is active.
* **Layers panel** (`ui/floating-panel.js`): the one floating card — 42px
  header (icon, title, close) and a scrolling body, max height 70vh, docked
  next to the tool stack. Dragging the header floats it (position saved in
  the UI prefs); double-clicking the header docks it again.
* **POI icon picker** (`ui/poi-icons.js`): a 252px popover with a 6-column
  grid of the map symbols (36px cells, selected = teal ring); from the
  Inspector it starts with a "From type (…)" row that clears the override.

The chrome on the canvas reacts to the width of the stage (a CSS size
container), not the window, because the side bars take space: below 1000px
the dock hides its label; below 860px the pills show icons only and the
minimap and dock type picker are hidden; below 640px the view pill moves to
a second row and the dock hides its chips.

## Components

* **Pill** (`.pill`): `--surface`, 1px `--border`, radius 14px, `--shadow`,
  4px padding, 2px gap. Separators are 1×18px `--border` lines (`.pill-sep`).
* **Icon button** (`.icon-btn`, `.tb-btn`): 32×32, transparent, icon in
  `--text-muted`; hover `--surface-hover` + `--text`; `.on` for toggles;
  `.toggle.on` = teal icon on `--accent-soft`. Always give it a `title` and an
  `aria-label`; toggles also set `aria-pressed`.
* **Button** (`.btn`): 32px (`.btn-small` 28px), `--surface-2`, 1px
  `--border`, radius 8px. `.btn-primary` = `--accent` fill, white text;
  `.btn-danger` = red text (red fill inside dialogs' action row).
* **Inputs**: `--input` background, 1px `--input-border`, radius 8px, 32px
  high; focus = `--accent` border + 3px `--accent-soft` ring.
* **Menu / popover** (`ui/menu.js`): `--menu`, 1px border, radius 10px,
  `--shadow-lg`, 4px padding; items 34px, icon + label + optional `kbd`,
  hover `--surface-hover`, danger items red. Arrow keys move, Escape closes.
* **Dialog** (`openDialog` in `dom.js`): `--surface`, radius 16px, header with
  title and close button, fields stacked, actions right-aligned (Cancel,
  then the primary / danger action).
* **Toast**: `--surface-2` card, radius 12px, a status dot (teal ok, yellow
  warn, red error), optional action buttons, bottom-right above the zoom
  pill.
* **Badges** (POI status): pill, 10.5px, the status colour on a 14 % tint:
  idea yellow, approved teal, slice blue, cut red (struck through).

## Canvas overlays

Selection outlines, vertex handles and box selection use `--accent`;
in-progress drawing and measurement use `--accent-yellow`; calibration points
are pink (`#ff5d8f`) so they never read as map content. Overlays are drawn in
`canvas.js` / the tools with stroke widths in screen pixels × `unitsPerPx`.

## Map style presets

`graphite` is the default for new maps and matches the chrome: ocean
`#16181b`, desaturated land and zones, blue water, yellow roads, teal and
yellow POIs. `blueprint` (navy) and `parchment` (light paper) stay available;
the demo map uses `graphite` too. Presets must all define the same keys (a unit
test checks it).

## Localisation

The UI speaks Russian and English. Wherever languages are listed, Russian is
first (Русский, English). The language is a UI pref (`ilumap.lang`, default English), switched
from the sidebar pill or Settings, and applies immediately.

* **Where strings live:** `src/app/i18n/ru.js` and `en.js`, flat objects with
  dotted keys grouped by area — `sidebar.*`, `titlePill.*`, `panels.*`,
  `points.*`, `inspector.*`, `links.*`, `map.*`, `background.*`, `style.*`,
  `dock.*`, `toolbar.*`, `tools.*`, `history.*`, `zoom.*`, `readout.*`,
  `export.*`, `dialogs.*`, `settings.*`, `shortcuts.*`, `toast.*`, `app.*`
  (static markup), `count.*` (plural forms), `units.*`, `compass.*`, and the
  data labels below. Both files have the same keys (a test checks it).
* **Code:** `t('key', { name })` for text, `plural('count.features', n)` for
  counts (Intl.PluralRules; Russian one / few / many), `label(group, value)`
  for data values, `fmtLength` / `fmtArea` / `unitLabel` (`i18n/format.js`)
  for distances and units («8,5 км», «12,4 км²»). Titles, `aria-label`s and
  placeholders are translated too; keyboard names (`Ctrl+S`, `Esc`) are not.
  Static markup in `index.html` uses `data-i18n`, `data-i18n-html`,
  `data-i18n-title`, `data-i18n-placeholder`, `data-i18n-aria-label`.
* **Re-render, don't reload:** every component that renders text subscribes
  with `onLangChange` and re-renders from state; nothing else changes.
* **Data is never translated:** ids, `type` / `status` values, layer keys and
  everything written into map.json stay English (default names such as
  "New POI" or "Untitled" included). Only their display labels are localised
  — `layers.*` (Суша, Дороги…), `layers.abbr.*` (dock chips: Сш Вд Бр Рк Дг Жд
  Ст Зн Тч), `status.*` (идея / утверждено / в слайсе / вырезано),
  `poiTypes.*`, `zoneTypes.*`, `lineTypes.*`, `wallTypes.*`, `linkTypes.*`,
  `towerModes.*`, `patterns.*`, `poiIcons.*`, `presets.*`. Custom types
  without a label show their raw value. The CLI and the text export for
  agents stay English.
* **Length:** Russian runs ~20–30 % longer. Keep labels short, let text in
  pills, dock and list rows ellipsize (with the full text in `title`), and
  check both languages at 1600 and 1280 px.

## Checklist for new UI

1. Colours come from tokens; test both themes (Settings → Interface theme).
2. Icons come from `ui/icons.js` (add new ones there, lucide geometry).
3. Floating things carry `.chrome` (so POI drops over them are ignored) and
   the pill / card styling above.
4. Buttons have `title` + `aria-label`; toggles `aria-pressed`.
5. UI state (open panels, toggles) goes to `store.prefs` (localStorage);
   anything that belongs to the map goes through `change()` into map.json.
6. Every visible string, `title`, `aria-label` and placeholder goes through
   `t()` with keys in both `ru.js` and `en.js`, and the component re-renders
   on `onLangChange` (`test/i18n.test.js` flags obvious English literals).
