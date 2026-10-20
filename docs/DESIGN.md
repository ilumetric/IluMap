# IluMap — UI design

The editor has **one look**, dark only, shared with IluBoard (its *Fun*
style): a canvas like the empty part of an orienteering map (faint ISOM
terrain patches and point symbols), panels and pills floating on it with
square corners, a box of bright markers for colour, sticker badges that tilt a
little, and hand-written section labels. There is no theme or style setting.
This document is the contract for contributors — keep new UI inside it.

The **chrome is independent of the map style**. The map's `style.preset`
(`graphite`, `blueprint`, `parchment`) only colours map content — the ocean
inside the bounds, land, zones, lines, POIs. Nothing in `src/app/styles.css`
may depend on the map preset, and nothing in `src/core/styles.js` knows about
the chrome.

## Tokens

All colours are CSS custom properties on `:root` in `src/app/styles.css`.
Never hard-code a colour in a component; add a token if one is missing.

| token | value | use |
|---|---|---|
| `--canvas` | `#18181b` | stage and window background |
| `--dot` | `#2c2c33` | the one ink of the canvas: ISOM area patterns (`--terrain`) and point symbols (`--topo`) |
| `--panel` (= `--surface`) | `#232328` | side panels, pills, tool stacks, cards, floating panels |
| `--dialog` / `--menu` | `#25252b` / `#2d2d34` | dialogs / menus, popovers, toasts |
| `--input` | `#1b1b1f` | text inputs, dropdown buttons |
| `--surface-2` | `#1d1d21` | inset areas: segmented controls, read-out tiles, code |
| `--seg-on` | `#3b3b43` | the selected segment of a segmented control |
| `--border` / `--border-subtle` / `--border-hover` | white at 10 / 6 / 16 % | borders, dashed separators |
| `--row-hover` / `--row-active` | white at 6 / 10 % | hover, list rows, the current row |
| `--text` / `--text-muted` / `--text-faint` | `#f4f4f6` / `#b9b9c3` / `#85858f` | text, idle icons, hints |
| `--ink` | `#1c1917` | dark text on bright fills (stickers, the primary button) |
| `--brand` (= `--yellow`) | `#ffd23f` | primary buttons, the active tool, the logo, the add button |
| `--select` | `#0d99ff` | focus rings, selection on the map, the minimap viewport, selection count |
| `--blue` | `#4fb3ff` | toggles that are on (`--blue-soft` behind), links, `slice` badge |
| `--green` | `#3ddc97` | visible layer (dock power), checks in menus, `approved` badge, toast ok |
| `--amber` | `#ffb547` | unsaved dot, warnings, toast warn |
| `--red` | `#ff6b5e` | danger, errors, toast error |
| `--violet` `--orange` `--pink` `--grey` | | tags, calibration points (pink), `cut` badge (grey) |
| `--sticky-1…4` | yellow, blue, mint, pink | sticky notes (the Mesh Terrain answer) |

Soft variants (`--select-ring`, `--select-soft`, `--blue-soft`, `--green-soft`,
`--red-soft`, `--amber-soft`) are the colour mixed into transparency.

Corners are square everywhere (the colour wheel, its thumbs and the cursor dot
stay round). Panels float with `--shadow-float`; menus, dialogs and dragged
panels use `--shadow-lg`; plain blocks `--shadow`. Bright fills (the primary
button, the active tool, active dock chips, badges) get `--key`, a 2px darker
bottom edge, so they read as keys and stickers.

Character: `--wiggle` (1) scales every tilt — stickers and the active tool sit
at −3…−4°, the logo at −6°, hovered icons turn −8° and grow 8 %; motion uses
`--spring` (an overshooting cubic-bezier). `prefers-reduced-motion` turns
animation off.

Type: `--font` = Rubik (400 / 500 / 600 / 700, from Google Fonts), 13px base;
12px for secondary text, 11–11.5px for read-outs; `--mono` for coordinates,
ids and file paths. `--hand` = Caveat 600 for **section labels and hints
only** — sidebar "Maps", Inspector section headings, POI list sections, menu
headings, panel and field hints, empty states, the drop hint. Never use it for
values, buttons or anything the user has to read precisely.

## Icons

Every UI icon lives in `src/app/ui/icons.js`: lucide-style inline SVG on a
24×24 grid, `stroke="currentColor"`, 1.75px stroke, round caps and joins,
rendered at 16px. Use `icon(name)` (element) or `iconSvg(name)` (markup).
Icons take their colour from the button (`--text-muted` idle, `--text` on
hover, `--ink` on a yellow fill). Map symbols (POI icons) are different —
they live in `core/render-svg.js` because exports need them.

## Layout

```
┌ sidebar 232px ┐┌ stage (full-bleed canvas, ISOM pattern) ───────────────────┐┌ right sidebar 332px ┐
│ IluMap    [◧] ││ [title · save]   [Layers │ ▦ T ▣ │ Export▾]      [↶ ↷ │ ◨] ││ ◎ Points          7 │
│ New map       ││                                                            ││ [search…]       [+] │
│ Search maps   ││ (●)  ┌ Layers ─┐                                           ││ statuses types zones│
│ Open file     ││ (◎)  │         │                                           ││ Unplaced (1)        │
│ Maps          ││ (⌇)  │         │          map                              ││ On the map (6)      │
│  Demo Isles ⋯ ││ (⬠)  └─────────┘                                           │├──────── ═ ─────────┤
│  …            ││ (♜)                                                        ││ [Inspector | Style] │
│               ││ (o)                                                        ││                     │
│               ││ ─1 km─              [tool status]          x 12 y 34 cm   ││  properties of the  │
│ Settings  RU  ││ [minimap]  [pw Roads │ La Wa … Po │ type o]  [S F │ - % + fit │ ? ⚙] ││  selection / style  │
└───────────────┘└────────────────────────────────────────────────────────────┘└─────────────────────┘
```

* **Sidebar** (`#sidebar`, `ui/sidebar.js`): 232px (212px below a 1280px
  window) including the 10px of canvas around it — a `--panel` card floating
  on the canvas, 1px `--border-subtle`, `--shadow-float`. Head: the logo (a
  tilted yellow sticker, `.brand-logo`) with the app name + collapse button.
  Items (36px rows, 16px icon + label): New map, Search maps (reveals an
  inline input; `Ctrl+K`), Open file. Section label "Maps" (hand-written).
  Map rows: one line, ellipsis, hover `--row-hover`, active `--row-active`
  with a 2px yellow edge on the left, a link icon
  when the map is linked to a file, a "⋯" button (visible on hover / active)
  and a right-click menu: Rename, Duplicate, Export JSON, Delete (confirm).
  Settings is pinned to the bottom, with the language switcher next to it: a
  28px outlined pill (globe icon + `RU` / `EN`, 11.5px semibold) that opens a
  menu headed "Language" listing Русский, then English, with a green check on
  the active one. `Ctrl+B` collapses the sidebar; a square FAB in the stage's
  top-left corner reopens it, and while it is collapsed a Settings gear
  appears at the end of the zoom pill (Settings has the language select too).
* **Right sidebar** (`#rightbar`, `ui/rightbar.js`): docked (it takes its
  own column, the canvas never runs under it), drawn like the left sidebar —
  a floating `--panel` card; 332px (296px below a 1280px window) including
  the 10px of canvas around it. Top: **Points** (44px header with icon, title and count; the POI
  list with search, filters, the Unplaced section and drag-to-map). A 7px
  **splitter** (row-resize, a 36px grab bar on hover, blue while dragging;
  arrow keys when focused, double-click resets) divides it from the bottom
  part; the split is a UI pref, 36% by default. Bottom: a segmented **tab
  bar** (Inspector | Style) and the tab body. A new selection switches to
  Inspector; with nothing selected the Inspector shows the map settings. The
  top-right pill toggles the whole sidebar (`]`).
* **Stage** (`#stage`): the SVG canvas fills it. Its CSS background looks like
  the empty part of an orienteering map, in ISOM symbols (the international
  orienteering map standard), all in the one `--dot` ink:
  * `--terrain` — a seamless 960px tile drawn once on start by
    `ui/backdrop.js`: periodic value noise splits it into patches of four
    area patterns with bare canvas between them (about half is covered):
    310 marsh (staggered horizontal dashes), 213 sand (a dense scatter of
    dots), 407 undergrowth (vertical stripes), 210 stony ground (dots and
    small triangles). A slower noise picks the type, so a patch is mostly one
    type. Seeded, so the tile is the same on every load.
  * `--topo` — a 320px tile of ISOM point symbols on top: prominent large
    tree (ring), boulder and large boulder (dots), pit (V), small depression
    (half circle), special feature (×).

  Both follow the pan (`--pan-x/y`, set by `canvas.js` modulo the 960px
  tile) and keep their size when zooming, so nothing jumps. The map's ocean
  is drawn only inside `view.bounds`; the bounds edge is a faint dashed line. Everything else is `.chrome`, absolutely positioned
  with a 12px margin from the stage edges:
  * top-left **title pill**: logo, map name (click / `F2` to rename inline),
    save button with the yellow unsaved dot; the tooltip says whether the map
    is linked to a file.
  * top-centre **view pill**: the Layers panel toggle (text + icon), the
    **Mesh Terrain** dropdown button (a 360px popover under the button with the
    calculator; `T`; clicking outside closes it and commits the field being
    edited), the view
    toggles grid (`G`), labels and background image (popover: opacity,
    calibrate, fit, replace, remove), then the **Export** menu. The menu
    starts with a scope switch — *Whole map* / *Selection (n)* (disabled when
    nothing is selected, remembered in the UI prefs) — followed by JSON, SVG,
    PNG, Masks, Copy as text, Save, Save as. On = `--blue` on `--blue-soft`.
  * top-right **history pill**: undo / redo (tooltips name the step), a
    narrow chevron with the history list (current step checked, redo steps
    dimmed, click to jump), then the right-sidebar toggle.
  * left **tool stack** (vertically centred): square pills separated by 8px:
    [Layers] · [Edit points, Move / scale, Pan] · [Line, Polygon, Wall, POI] · [Measure,
    Calibrate, Delete]. Buttons are 32px squares; the active tool is a
    yellow sticker (`--brand`, `--ink` icon, tilted −4°). Draw tools have a 3px underline in the colour of the
    layer they will draw into (`layer-meta.js` → `layerColor`, adjusted for
    contrast by `chromeTint`).
  * bottom-centre **layer dock**: power toggle (visibility of the active
    layer; green when visible), the layer name + "n features · new: type",
    one 28px chip per layer (2-letter abbreviation, 2px ring in the layer
    colour, filled when active, dashed + faded when hidden), the type for new
    features and a colour swatch (edits the layer colour, or the zone / POI
    type colour). Choosing a chip while a draw tool is on switches to the
    tool that fits the layer; the POIs chip picks the POI tool. It is centred
    in the free space between the minimap and the zoom pill.
  * bottom-left: **scale bar** above the **minimap** card (180×120, the map
    rendered by `render-svg.js` into an `<img>`, the viewport as a blue
    rectangle; click / drag / wheel to navigate).
  * bottom-right **zoom pill**: snap and flipY toggles (blue when on), zoom
    − / % / +, fit, keyboard shortcuts (and Settings while the sidebar is
    collapsed). The **cursor read-out** (coordinates in mono, land / water ·
    zone, selection count in `--select` blue) sits just above it.
  * above the dock: the **tool HUD** — the tool's live status only (what
    Edit is editing, lengths, scale %).
  * top right under the history pill: the active tool's **shortcuts**, one
    per line, right-aligned (action muted, keys in bold); the line of a held
    modifier (Ctrl / Alt / Shift) lights up as a yellow sticker. Hidden on narrow stages.
    No text follows the cursor — hover feedback is drawn on the map only.
* **Layers panel** (`ui/floating-panel.js`): the one floating card — 42px
  header (icon, title, close) and a scrolling body, max height 70vh, docked
  next to the tool stack. Dragging the header floats it (position saved in
  the UI prefs); double-clicking the header docks it again.
* **Dropdowns** (`ui/select.js`): every `<select>` is shown as a button styled
  like the inputs (label + chevron, blue ring when focused or open) and
  opens the app's own menu (`.sel-menu`: at least as wide as the button,
  scrolls above 360px, the current value checked in green). The native
  `<select>` stays hidden in the DOM as the source of truth, so native OS
  pop-ups never appear. Add `data-native` to a `<select>` to opt out. Menus sit
  above dialogs; Escape closes the menu first, then the dialog.
* **Colour picker** (`ui/color-picker.js`): every `<input type="color">`
  stays as the swatch, but a click opens a 332px popover instead of the OS
  dialog — a 176px colour wheel (hue = angle, saturation = distance from the
  centre) with a vertical value slider, *Old* / *New* swatches (click *Old* to
  revert), R G B and H S V gradient sliders with number fields, a Hex field,
  an eyedropper where the browser has one, and recent colours (localStorage).
  Dragging updates live (`input`); releasing or editing a field commits
  (`change`, one undo step). `data-native` keeps the browser picker.
* **Scroll position**: panels re-render on every change; `preserveScroll()`
  (`dom.js`, used by `renderKeepingFocus`, the POI list and the maps list)
  restores every scrolled ancestor, so editing deep in a long panel never
  jumps back to the top.
* **Bridge tool** (`B`, in the draw group after Wall): click one bank, then
  the other; the tool finishes by itself after two points. Its toolbar icon
  is the bridge symbol (two deck lines with splayed wings). The dock has
  chips for Relief (`Rf` / `Рл`) and Bridges (`Br` / `Мс`); the type picker
  chooses ridge / fault / cliff or the bridge type. Style tab: *Relief types*
  (colour) and *Bridge types* (colour, label, piers, ramps).
* **Hand tool** (and Space / a pan in progress): map items get no hover
  highlight and keep the grab cursor.
* **POI icon picker** (`ui/poi-icons.js`): a 300px popover with the map
  symbols in groups (places, services, transport, industry, nature, markers;
  7-column grids of 36px cells, selected = blue ring, scrolls above 440px); from the
  Inspector it starts with a "From type (…)" row that clears the override.

The chrome on the canvas reacts to the width of the stage (a CSS size
container), not the window, because the side bars take space: below 1000px
the dock hides its label; below 860px the pills show icons only and the
minimap and dock type picker are hidden; below 640px the view pill moves to
a second row and the dock hides its chips.

## Components

* **Pill** (`.pill`): `--panel`, 1px `--border-subtle`, `--shadow-float`,
  4px padding, 2px gap. Separators are 18px dashed `--border` lines
  (`.pill-sep`).
* **Icon button** (`.icon-btn`, `.tb-btn`): 32×32, transparent, icon in
  `--text-muted`; hover `--row-hover` + `--text` and the icon turns a little;
  `.toggle.on` = `--blue` on `--blue-soft`; `.accent` = a yellow key (the
  "+" next to the POI search). Always give it a `title` and an `aria-label`;
  toggles also set `aria-pressed`.
* **Button** (`.btn`): 32px (`.btn-small` 28px), transparent, 1px `--border`.
  `.btn-primary` = `--brand` fill, `--ink` text, `--key` edge, pressed 1px
  down; `.btn-danger` = red text (red fill with ink inside dialogs' action
  row).
* **Inputs**: `--input` background, 1px `--border` (`--border-hover` on
  hover), 32px high; focus = `--select` border + 3px `--select-ring`.
  Checkboxes, radios and ranges use `--brand`.
* **Segmented control** (`.seg`, the Inspector | Style tab bar): `--surface-2`
  track, the selected segment `--seg-on` with `--shadow`.
* **Menu / popover** (`ui/menu.js`): `--menu`, 1px `--border`, `--shadow-lg`,
  6px padding, springs in; items 34px, icon + label + optional `kbd`, hover
  white at 8 %, danger items red, dashed separators, headings hand-written.
  Arrow keys move, Escape closes.
* **Dialog** (`openDialog` in `dom.js`): `--dialog`, 18px bold title with a
  close button, fields stacked, actions right-aligned under a dashed line
  (Cancel, then the primary / danger action); pops in, the backdrop blurs.
* **Toast**: `--menu` card, a small tilted status square (green ok, amber
  warn, red error), optional action buttons in `--brand`, bottom-right above
  the zoom pill.
* **Badges** (POI status) are stickers: solid fill, `--ink` text, tilted
  −3°: idea yellow, approved green, slice blue, cut grey (struck through).
  The Inspector's kind label (`.insp-kind`) is the same sticker in the
  layer's colour.
* **Sticky note**: the Mesh Terrain answer (`.tr-quad`) on `--sticky-1`, a
  hand-written caption, tilted −1°.

## Canvas overlays

Selection outlines, vertex handles, box selection and the Ctrl+click preview
use `--select`; in-progress drawing and measurement use `--yellow`; the
add-point preview is green, the delete preview red; calibration points are
`--pink` so they never read as map content. Overlays are drawn in `canvas.js`
/ the tools with stroke widths in screen pixels × `unitsPerPx`.

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

1. Colours, corners, tilt and fonts come from the tokens; there is one look, no themes.
2. Icons come from `ui/icons.js` (add new ones there, lucide geometry).
3. Floating things carry `.chrome` (so POI drops over them are ignored) and
   the pill / card styling above.
4. Buttons have `title` + `aria-label`; toggles `aria-pressed`.
5. UI state (open panels, toggles) goes to `store.prefs` (localStorage);
   anything that belongs to the map goes through `change()` into map.json.
6. Every visible string, `title`, `aria-label` and placeholder goes through
   `t()` with keys in both `ru.js` and `en.js`, and the component re-renders
   on `onLangChange` (`test/i18n.test.js` flags obvious English literals).
