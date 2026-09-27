# IluMap — architecture

A browser-based vector map editor for game worlds, hosted as a static site
(GitHub Pages). It is built for two users at once:

* **a human** (level designer / artist / writer) who draws coastlines, rivers,
  roads, zones, walls and drags points of interest (POIs) around;
* **an AI agent** that never sees pixels well, but reads and edits JSON
  precisely, needs stable ids to reference from lore/quest text, and needs a
  "map as text" view.

The single source of truth is a text file: `map.json`. Everything else
(SVG/PNG renders, masks, text summaries) is derived from it.

## Principles

1. **JSON in the repo is the database.** No cloud, no accounts, no binary
   formats, no data embedded in HTML. Save goes back to the same file
   (File System Access API) or downloads a replacement.
2. **World units, not pixels.** Coordinates are in engine units
   (UE centimetres by default). A background image is *calibrated* to world
   space, never the other way around.
3. **Stable, human-readable ids** (`mine_old`, `village`), never indices.
   Lore, quests and `places.md` reference these ids.
4. **Diff-friendly serialisation.** Stable key order, one coordinate pair per
   line, deterministic output. Moving one vertex changes one line.
5. **Everything the UI can do, a script can do.** The core (`src/core`) is
   plain ES modules with no DOM dependency and is reused by the Node CLI in
   `tools/`.
6. **No build step, no runtime dependencies.** `index.html` + ES modules work
   from GitHub Pages "deploy from branch" as-is. Node is only needed for the
   CLI tools and tests (`node --test`).

## World model

The canvas background **is the ocean**. On top of it:

| layer | kind | meaning |
|---|---|---|
| `land` | polygons | islands / continents. If `meta.landMode` is `"filled"`, the whole `view.bounds` is land and this layer is optional (inland maps). If `"islands"` (default), only these polygons are land. |
| `water` | polygons | lakes and inland seas, subtracted from land. |
| `coast` | lines | decorative coastline strokes, optional (the land polygon edge already renders a coast). |
| `rivers` | lines | rivers, `type` selects width preset. |
| `roads` | lines | roads and paths. |
| `rails` | lines | railways. |
| `walls` | lines / closed lines | fortifications: city walls, palisades. Built with the wall builder (see below). |
| `zones` | polygons | biomes / regions: mountains, swamp, forest, plains. Used for POI `zone`, masks and colouring. |

`pois` are points; `links` are relations between POIs (road, rail, quest…).

Draw order (bottom to top): ocean background → land → zones → water → coast →
rivers → roads → rails → walls → POIs → labels.

## Repository layout

```
index.html              app entry (GitHub Pages root)
src/
  app/                  UI: editor, panels, tools, interaction (DOM only here)
  core/                 pure logic, shared with CLI (no DOM)
    schema.js           format constants, layer list, defaults, validation
    model.js            load/normalise/serialise map.json, id helpers
    geometry.js         distances, bearings, polygon area/centroid, hit tests
    calibration.js      image px <-> world transform from 2 point pairs
    render-svg.js       map.json -> SVG string (browser and Node)
    render-mask.js      map.json -> greyscale bitmap (pure JS rasteriser)
    png.js              minimal PNG encoder (zlib in Node, deflate via pako-free
                        stored/zlib in browser or <canvas> fallback)
    text-export.js      map.json -> markdown/plain text summary for agents
    styles.js           style presets (graphite, blueprint, parchment) and defaults
    terrain.js          Unreal Mesh Terrain grid calculator (resolution, quads, sections)
    routes.js           road / rail network, shortest routes, crossings (rivers, faults, water) and bridges
    color.js            hex / RGB / HSV conversions (colour picker)
    viewclip.js         viewport clipping for the canvas (visible pieces of lines with their dash phase)
tools/
  ilumap.mjs            CLI: validate | text | svg | mask | terrain | fmt | list
schema/map.schema.json  JSON Schema (draft 2020-12) of the map format
examples/demo/map.json  reference map (40 km archipelago, 7 POIs incl. village,
                        mine_old, city_riverport and one unplaced POI)
docs/                   this file, FORMAT.md, AGENT.md (how an agent uses it),
                        DESIGN.md (UI tokens, components, layout)
test/                   node --test unit tests for src/core
```

## Data format (`map.json`, format version 1)

See `docs/FORMAT.md` for the full field reference and `schema/map.schema.json`
for the machine-checkable version. Summary:

```jsonc
{
  "format": "ilumap", "version": 1,
  "meta":  { "name", "description", "units": "cm", "displayUnit": "m",
             "displayUnitScale": 100, "flipY": false, "landMode": "islands" },
  "view":  { "background": { "src", "opacity", "calibration": [ {px,world}, {px,world} ] },
             "bounds": { "min": [x,y], "max": [x,y] }, "grid": { "step", "visible" } },
  "style": { "preset": "blueprint", "layers": { <layer>: {...} },
             "lineTypes": {...}, "zoneTypes": {...}, "wallTypes": {...}, "poiTypes": {...} },
  "layers": {
    "land":   [ Feature(polygon) ],
    "water":  [ Feature(polygon) ],
    "coast":  [ Feature(line) ],
    "rivers": [ Feature(line) ],
    "roads":  [ Feature(line) ],
    "rails":  [ Feature(line) ],
    "walls":  [ Feature(line, wall props) ],
    "zones":  [ Feature(polygon) ]
  },
  "pois":  [ Poi ],
  "links": [ Link ]
}
```

* `Feature`: `{ id, name?, kind: "line"|"polygon", type?, points: [[x,y],…],
  closed?, smooth?, width?, color?, tags?, notes?, hidden?, wall? }` (this is
  the canonical key order, see FORMAT.md).
* `Poi`: `{ id, name, x, y, type, zone?, tags?, status: "idea"|"approved"|"slice"|"cut",
  notes?, anchor?, color?, icon?, placed? }`. `placed: false` = in the list but not on
  the map yet (agent added it, human will drag it out).
* `Link`: `{ id?, from, to, type: "road"|"rail"|"river"|"quest"|"sight"|…, name?, feature?, notes? }`
  `from`/`to` are POI or gate ids. `feature` optionally points at the Feature id
  that physically carries the link. The optional `id` shares the global id namespace.

Coordinates are world units; `flipY` tells the renderer whether +y is up
(engine-like) or down (image-like) on screen. Display units are derived
(`cm / displayUnitScale` → metres) and used in the scale bar, measurement tool
and text export.

## Wall builder

Walls are line features in the `walls` layer with an extra `wall` object:

```jsonc
{ "id": "wall_riverport", "kind": "line", "type": "wall_stone", "closed": true,
  "points": [[…],[…],…],
  "width": 300,                       // thickness, world units
  "wall": {
    "towers": "vertices",             // "none" | "vertices" | "auto"  (auto = every `towerSpacing`)
    "towerSpacing": 5000,             // world units, for "auto"
    "towerSize": 600,                 // world units
    "gates": [ { "at": 2, "name": "North Gate", "id": "gate_riverport_n" } ]   // vertex index (or {"t": 0.35} fraction along the wall)
  }
}
```

The wall tool draws like the line tool (click vertices, Enter to finish,
`C` to close), then the inspector exposes towers/gates. Walls are always drawn
as straight segments (`smooth` is ignored for walls, so gate vertex indices
and tower positions stay exact). Renderer draws a
thick stroke with a crenellation pattern, square towers at tower positions and
a gap + marker at gates. Gates are also exposed to the text export and can be
referenced by id from links (`"to": "gate_riverport_n"`). Mask source `walls`
rasterises thickness for landscape flattening.

## Core module contracts

All core modules are pure, side-effect free, and importable from Node.

```js
// model.js
createEmptyMap(opts) -> MapDoc
normalize(json) -> MapDoc            // fills defaults, migrates old versions, keeps unknown keys
serialize(mapDoc) -> string          // canonical, diff-friendly JSON text
validate(mapDoc) -> { ok, errors: [{path, message}], warnings: [{path, message}] }
                                     // implemented in schema.js, re-exported here
findById(mapDoc, id) -> { kind: 'poi'|'feature'|'link'|'gate', layer?, item } | null
allIds(mapDoc) -> Set<string>
slugify(name, existingIds) -> id     // "Old Mine" -> "old_mine", "old_mine_2"
zoneOf(mapDoc, [x,y]) -> zoneId|null // smallest zone polygon containing the point
isLand(mapDoc, [x,y]) -> boolean     // landMode + land polygons - water polygons
nextId(mapDoc, prefix) -> "road_3"   // first free prefix_N
renameId(mapDoc, old, new)           // updates POI zone + link from/to/feature references
removeById(mapDoc, id)               // also drops links that point at the removed item
insertVertex(feature, i, p), removeVertex(feature, i)   // keep wall gate `at` indices valid

// geometry.js
distance(a, b), bearing(a, b, flipY) -> degrees, compass8(deg) -> "NE"
polylineLength(points, closed), polygonArea(points), centroid(points), bbox(points)
pointInPolygon(p, poly), nearestPointOnPolyline(p, points, closed) -> {point, dist, segIndex, t}
pointAlong(points, t, closed), resample(points, spacing)
catmullRomToPath(points, closed) -> SVG path d
featureGeometry(feature) -> points   // the drawn outline (smooth features densified)
wallLayout(feature) -> { length, towers: [{point, angle}], gates: [{id, name, point, s}] }

// calibration.js
fromPairs([{px:[u,v], world:[x,y]}, {…}], { reflect }) -> { a,b,c,d,e,f }
   // similarity: uniform scale + rotation + translate; reflect = meta.flipY
   // (image rows grow downwards, so a y-up world needs a mirrored v axis)
pxToWorld(T, [u,v]), worldToPx(T, [x,y]), invert(T)
fitPairs(bounds, imgW, imgH, flipY)  // initial calibration: image fitted into the bounds

// render-svg.js
renderSvg(mapDoc, { width, height, padding, background: bool, grid: bool, labels: bool,
                    layers?: string[], selection?: Set<string> }) -> string
renderParts(mapDoc, { unitsPerPx, layers?, labels?, interactive?, selection? })
   -> { defs, layers: {land: '<g…>', …}, pois, labels, body }   // used by the editor canvas

// render-mask.js
renderMask(mapDoc, { source, size? | width?, height?, bounds?, invert?, feather?, stroke? })
   -> { width, height, data: Uint8Array, unitsPerPixel, unitsPerPixelY, bounds, source }
maskSidecar(mapDoc, mask, entries) -> masks.json object
// png.js
encodePng({ width, height, data, channels: 1|4 }, { deflate? }) -> Uint8Array
   // synchronous; Node passes zlib.deflateSync, without it stored (uncompressed) deflate blocks are written
encodePngAsync(img) -> Promise<Uint8Array>   // CompressionStream('deflate'); the app falls back to <canvas>.toBlob

// text-export.js
toText(mapDoc, { format: 'markdown'|'plain', nearest: 3 }) -> string
formatLength(worldUnits, meta, opts?) -> "1.2 km", formatArea(worldUnits², meta, opts?) -> "3.4 km²"
   // opts = { locale: 'ru', units: { km: 'км', m: 'м' } } -> "1,2 км" (UI only; default stays English)
```

## UI architecture (`src/app`)

The editor is a full-bleed SVG canvas with floating chrome on top of it and a
collapsible project sidebar on the left (see `docs/DESIGN.md` for the look,
tokens and component anatomy). The chrome's theme (System / Dark / Light,
`data-ui-theme` on `<html>`) is independent of the map's style preset, which
only colours map content.

* `state.js` — single in-memory document + selection + tool state, undo/redo
  (`core/history.js`: every step is a patch of the changed items only — see
  below), dirty flag (= the
  document differs from the file it was last read from / saved to), UI prefs
  in localStorage (panels, layer visibility/lock, snapping, …). Tiny event
  bus (`on` / `emit`): `doc`, `selection`, `layers`, `tool`, `view`, `dirty`,
  `file`, `load`, `project`, `projects`, `panels`, `prefs`, `theme`, …
  Undo / redo: the history keeps an index of the committed document — one
  JSON string per top-level value (`meta`, `view`, `style`, `terrain`, …)
  and per item of the id-keyed collections (features of each layer, POIs),
  plus each collection's order. `endChange()` stringifies the document again
  and stores only the slots that differ (before / after), so memory grows
  with what was edited, not with the map, and undo writes those slots back
  without re-parsing the whole file. Steps carry the selection before / after
  (restored on undo / redo), a label derived from the patch (Move, Edit
  shape, Add, Delete, Style, … shown in tooltips, the notice and the history
  menu) and a revision id; the dirty flag compares revisions, so undoing back
  to the saved state is clean again. `change(fn, { merge: 'nudge' })` folds
  repeated edits within a second into one step (arrow-key nudges). A change
  that throws is rolled back. Undo waits while a drag is open; a line being
  drawn gives back its last point first. Limits: 500 steps / 64 MB, oldest
  dropped first. Histories live in memory only — per project for the session
  (switching projects keeps them while the content is unchanged), never
  written anywhere. Reloading the linked file from disk is itself an
  undoable step.
* `projects.js` — IndexedDB storage of local projects (below).
* `session.js` — the workspace: which project is open, autosave, new / open /
  import / switch / rename / duplicate / delete, background blobs, first
  launch, migration of the pre-projects localStorage draft.
* `canvas.js` — SVG viewport: pan/zoom (world→screen transform), the ocean
  rectangle inside the bounds (outside it the stage's CSS dot grid shows and
  follows pan/zoom), calibrated background image, grid clipped to the
  bounds, scale bar, layer groups, selection and vertex handles. Uses
  `render-svg.js` for the layer content so exports match the screen.
* `tools/` — one module per tool: select/move, pan, draw-line, draw-polygon,
  draw-wall, place-poi, measure, calibrate. Tools receive pointer events in
  world coords (`ctx.snap` = snap toggle XOR Shift).
* `panels/` — panel contents: layers (floating panel; visibility, lock,
  colour, opacity; visibility and lock are per-user UI prefs, not part of
  map.json), and in the docked right sidebar the POI list (search, filters,
  "Unplaced" section, drag-to-map), inspector (id, name, type, tags, status,
  notes, colour, icon, points, wall
  towers/gates, links; shows the map settings — meta, bounds, grid,
  background — when nothing is selected), style (preset + per-type colours).
* `ui/` — the chrome: `icons.js` (every UI icon, inline SVG), `sidebar.js`,
  `toolbar.js` (left tool stack, background popover), `rightbar.js` (docked
  right sidebar: POIs, splitter, Inspector / Style tabs), `poi-icons.js`
  (POI symbol previews and the icon picker),
  `dock.js` (bottom layer dock), `minimap.js`, `chrome.js` (title, panel
  toggles, view toggles + Export menu with the whole-map / selection scope,
  undo/redo + right-sidebar toggle, zoom pill, cursor read-out, tool HUD),
  `floating-panel.js` (the dockable, draggable Layers card), `menu.js` (menus and
  popovers), `layer-meta.js` (layer labels, colours, types for new features).
* `i18n/` — UI localisation (Russian and English): `index.js` (`t`, `plural`,
  `label` for data values, `setLang` / `onLangChange`, `applyI18n` for
  `data-i18n*` attributes in `index.html`, `formatNumber`), `format.js`
  (localised lengths / areas / units on top of core `formatLength` /
  `formatArea`, which take an optional `{ locale, units }` and default to
  English for the CLI), dictionaries `ru.js` / `en.js`. The language is a UI
  pref (`localStorage` `ilumap.lang`, default English, applied before first paint by the inline
  script in `index.html`); switching re-renders every mounted component
  through `onLangChange` without touching the document, selection, undo
  history, panels or tool. See docs/DESIGN.md → Localisation.
* `settings.js` — UI theme, language and the Settings dialog; `io.js` — save via the
  File System Access API (download fallback), exports (JSON / SVG / PNG /
  masks / text), background image loading, POI placement.

### Local projects (IndexedDB)

The sidebar lists **local projects**: browser working copies of maps, stored
in IndexedDB database `ilumap` with two object stores:

| store | key | value |
|---|---|---|
| `projects` | `id` | `{ id, name, createdAt, updatedAt, doc, savedText?, fileName?, baseUrl?, fileHandle?, backgroundBlobKey? }` |
| `blobs` | `bg:<projectId>` | the background image `Blob` |

* `doc` is the canonical map.json text of the working copy; `savedText` the
  text last read from / written to disk (so the unsaved-changes dot survives
  reloads); `fileHandle` a `FileSystemFileHandle` (structured-cloneable in
  Chromium) so Save writes back to the same file after a reload
  (`requestPermission` is asked again on Save); `baseUrl` resolves a relative
  `view.background.src` for maps loaded over HTTP.
* The open map autosaves into its project on every committed change
  (debounced 500 ms, flushed on tab hide / before switching); autosave can be
  turned off in Settings. It replaced the old `localStorage` draft, which is
  migrated into a project once and then removed.
* New map / Open file / dropping a `map.json` create a project; opening a
  file whose handle is already a project focuses that project (and offers to
  reload it when the file changed on disk). Dropped or loaded background
  images are stored as blobs, so they survive reloads (they are still saved
  as a relative `src` in map.json).
* First launch with no projects: a copy of `examples/demo/map.json`.
* Without IndexedDB (private mode, disabled storage) `projects.js` falls back
  to an in-memory store and the app says so in a toast.

**Browser projects are a working copy; commit `map.json`.** The file in the
repo stays the single source of truth — Save (`Ctrl+S`) writes it (or
downloads it), and git tracks it.

Interaction conventions: `V` select, `H` pan / hold `Space` / middle mouse,
`L` line, `P` polygon, `W` wall, `O` POI, `M` measure, `K` calibrate,
`Enter` (or double-click / right-click) finish, `C` close path while drawing,
`Backspace` remove the last point while drawing, `Esc` cancel, `Delete`
remove, `Ctrl+Z/Y` undo/redo, `Ctrl+S` save, `Ctrl+Shift+S` save as, `Ctrl+O`
open a file as a local map, `Ctrl+B` sidebar, `Ctrl+K` search maps, `Ctrl+,` settings,
double-click vertex to delete, `Alt`+click on segment to insert a vertex,
wheel to zoom, `F` fit, `G` grid, `/` search POIs, `?` help, `[` / `]`
panels, `F2` rename, arrows nudge the selection. Grid snapping follows the
magnet toggle (bottom right); holding `Shift` inverts it while drawing or
dragging. A feature must be selected before a drag moves it (so a
click on a big island never moves it by accident); POIs move immediately.

## Canvas performance (`canvas.js`, `core/viewclip.js`)

Map symbols are sized in screen pixels (dashes, rail ties, ridge ticks, cliff
teeth), so drawing a whole line at high zoom would cost more the closer you
get. The canvas therefore draws only the visible area plus half a screen on
every side (`renderParts(…, { viewRect })`): features outside it are skipped,
lines and outlines that cross it are cut to it by `visiblePieces()` (smooth
curves sampled a few pixels apart only where visible), and every piece keeps
its distance from the start of the line, so dash patterns and symbols do not
jump when the view moves. Features fully inside the area are drawn as they
are. While the wheel turns, the old drawing is just scaled; the content is
re-built 120 ms after the last step, and a pan re-builds only when the view
leaves the drawn area. Exports (SVG, PNG, minimap, CLI) pass no `viewRect`
and draw everything. The drawn size stays around 10–50 KB at any zoom
(`test/viewclip.test.js` guards it).

## Road routes (`src/core/routes.js`)

`buildNetwork(doc, { layers })` turns the line layers (roads + bridges, or
rails + bridges) into a graph: vertices of the drawn geometry, endpoints
snapped within a tolerance (T-junctions), crossings of different features of
the same mode (road × road, not road × rail). `route(doc, from, to)` joins the
two endpoints (POIs or wall gates) to the network with a short straight access
leg and runs Dijkstra; `crossings(doc, polyline)` lists rivers, faults,
cliffs, ridges and lake entries on the way and whether a bridge spans each;
`describeRoute()` is the one-line English summary used by the text export,
the CLI and (localised pieces of it) the Inspector's link list.

## Folders and changes on disk (`src/app/disk.js`, `session.js`)

"Open folder" (Chromium's File System Access API) keeps a directory handle
with the project in IndexedDB, plus the path of the map's folder inside it.
`view.background.src` then resolves relative to the map (the freshest file
wins over the stored copy), and the background popover can pick an image from
the folder, storing a relative path. When the map is linked to a file,
returning to the tab re-reads it: an unchanged working copy reloads the new
version (with a "Show changes" diff), unsaved edits get a warning; Save
checks again and offers *Load disk version* / *Overwrite* with the diff
(`core/diff.js`) of what changed on disk.

## Terrain grid (`src/core/terrain.js`)

Calculator for Unreal Engine Mesh Terrain. `terrainOf(doc)` returns the stored
`terrain` block or defaults (1 m quads, doubled until a side has at most 4096
quads; automatic sections, 524288 triangles). `computeTerrain(doc)` derives
the size (from `view.bounds`), quad size, vertex / triangle counts, the
section layout (explicit, or an estimate with square sections in automatic
mode), the heightmap size (resolution + 1 per axis) and warnings.
`quadOptions`, `resolutionForQuad`, `explicitFor`, `autoSections`,
`terrainBlock` (canonical block to store) and `unrealSettingsText` (values to
type into Unreal) are shared by the Mesh Terrain dropdown (`panels/terrain.js`, opened under its button in the top pill), the
canvas overlay (`canvas.renderTerrainOverlay`, a UI pref) and the CLI
`terrain` command. The text export adds a "Terrain grid" line when the map
has a `terrain` block.

## Exports

| Export | Browser | CLI (`tools/ilumap.mjs`) | Notes |
|---|---|---|---|
| `map.json` | Save / Save as (top-left pill, Export menu) | `fmt` (canonical reformat) | source of truth |
| SVG | Export → SVG | `svg` | same renderer, world-unit viewBox, layers as `<g id="layer-…">` |
| PNG | Export → PNG (canvas raster of the SVG) | — | width configurable |
| Text | Copy as text | `text` | markdown or plain, for agents |

Every browser export takes a **scope**: the whole map, or the current
selection. A selection goes through `extractSelection(doc, ids)` in
`src/core/model.js` (selected features / POIs, a gate keeps its wall, links
whose both ends are kept, dangling `feature` / `zone` references removed —
the result is a valid map in the same world coordinates). SVG / PNG of a
selection are cropped to `selectionBounds(doc, ids, { pad, minAspect })`;
masks keep `view.bounds` so they align with the whole-map masks.
| **Masks** | Export → Masks | `mask` | black/white PNG for heightmap tools (Gaea, World Machine, UE landscape) |

### Masks (`src/core/render-mask.js`)

A mask is an 8-bit greyscale PNG covering `view.bounds` (or an explicit
`--bounds`) at a given pixel size (`--size 4096` or `--width/--height`,
non-square bounds keep aspect). Pixel (0,0) is the top-left of the bounds,
respecting `meta.flipY`, so the mask lines up with a heightmap that was
calibrated to the same bounds. Pure JS scanline polygon fill (even-odd), PNG
encoded with Node's built-in `zlib` in the CLI and `CompressionStream` (or
`<canvas>`) in the browser — no dependencies either way.

Selectable sources:

* `land` — land polygons (or full bounds in `filled` mode) minus `water`
  polygons: white = land, black = water. This is the island shape for Gaea.
* `water` — ocean plus lakes (inverse of `land`).
* `zones` / `zones:<type>` — all zones, or only zones of one type (`mountains`,
  `swamp`, …); one file per type with `--split`.
* `rivers` / `roads` / `rails` / `walls` / `coast` — lines rasterised with their
  `width` (world units) plus optional `--stroke` override, for carving or
  flattening. Lines without a `width` are 2 px wide; walls also stamp their
  towers.
* Masks use the geometry, not the view: `hidden` features are included and
  smooth features are rasterised along their curve.
* `feature:<id>` — a single feature.

Options: `--invert`, `--feather <px>` (box blur), `--bounds x0,y0,x1,y1`,
`--out dir/`. Output names: `mask_land.png`, `mask_zones_mountains.png`, …
Mask exports also write a `masks.json` sidecar with bounds, size and the
world-units-per-pixel value so the importer knows the scale.

## Agent workflow (see docs/AGENT.md)

1. Agent appends a POI to `pois` with `placed: false` and rough `x,y`.
2. Human opens the tool, drags it from the "Unplaced" list to the map, saves.
3. Agent runs `node tools/ilumap.mjs text map.json` to "see" the map as text
   (zone, land/water, nearest POIs with distance and compass direction, links),
   and `node tools/ilumap.mjs svg map.json > map.svg` to render it for a human.
4. Both edit the same file; git diffs stay readable.
