# IluMap

**An open-source vector map editor for game worlds — for level designers and AI agents alike.**

IluMap is a static web app (no build step, no dependencies) for drawing the
large-scale layout of a game world: coastlines, land, lakes, rivers, roads,
railways, walled towns, biome zones and points of interest. The whole map lives
in one diff-friendly text file, `map.json`, which sits in your repo next to your
lore and quest documents. Everything else — SVG/PNG renders, a text description
for agents, greyscale masks for Gaea / World Machine / Unreal landscapes — is
derived from that file.

<!-- Screenshot placeholder: save a capture of the editor as docs/screenshot.png and uncomment:
![IluMap editing the demo map](docs/screenshot.png)
-->
> _Screenshot coming soon — open the demo on GitHub Pages to see the editor._

- **Human-friendly:** a calm, ChatGPT-style editor — a full-bleed canvas with
  floating toolbars, a layer dock, a minimap and draggable panels (dark or
  light theme) — with layers, smooth curves, a wall builder with towers and
  gates, grid snapping, a measure tool, background-image calibration and
  undo/redo. Maps are drawn in the `graphite`, `blueprint` or `parchment`
  style.
- **Local maps:** the sidebar lists your maps as browser working copies
  (IndexedDB), autosaved on every change, including their background images.
  The `map.json` in your repo stays the source of truth.
- **Agent-friendly:** stable human-readable ids (`mine_old`, `village`), one
  `[x, y]` per line so moving one vertex changes one line of the diff, a CLI
  that prints the map as prose ("Old Mine is 8.5 km N of Millbrook…"), and a
  hand-written validator.
- **World units, not pixels:** coordinates are engine units (Unreal centimetres
  by default); a background sketch is calibrated to the world, never the other
  way round.
- **Russian and English UI:** switch with the `RU` / `EN` pill next to Settings
  (or Settings → Language / Язык); it applies at once and never touches the
  map data — ids, types and statuses in `map.json` stay English, only their
  labels are translated.

## Quick start

Open the hosted editor on GitHub Pages (`https://<you>.github.io/<repo>/`), or
run it locally from the repo root with any static server:

```bash
python -m http.server 8765        # then open http://localhost:8765/
# or
npx serve .
```

ES modules do not load from `file://`, so a server is needed. On first launch the
editor creates a local copy of the demo map (`examples/demo/map.json`);
`?map=path/to/map.json` opens another map from the same site.

### Local maps and map.json

The left sidebar (`Ctrl+B` to hide it) lists your **local maps**: working
copies kept in the browser (IndexedDB), autosaved on every change, with
their background images, so a reload never loses work. **New map**, **Open
file** (`Ctrl+O`), **Search maps** (`Ctrl+K`) and a "⋯" menu per map
(rename, duplicate, export JSON, delete) manage them.

**Browser projects are a working copy; commit `map.json`.** In Chromium
browsers **Open file** keeps a handle to the file (also across reloads), so
`Ctrl+S` writes straight back to `map.json` in your repo; the top-left pill's
tooltip says whether the map is linked to a file, and a dot marks changes not
yet saved to it. Other browsers download the file instead. You can also drag
a `map.json` onto the canvas (it becomes a local map), or an image to use as a
calibrated background. Without IndexedDB (some private windows) maps live in
memory for the session only.

### The editor at a glance

- **Left toolbar:** Layers panel · Select, Pan · Line, Polygon, Wall, Bridge, POI ·
  Measure, Calibrate, Delete. Draw tools carry a coloured underline: the
  colour of the layer they will draw into.
- **Top:** map name (click to rename) and Save · Layers panel, grid /
  labels / background toggles and the Export menu · undo / redo and the right
  sidebar toggle.
- **Bottom:** minimap and scale bar · the **layer dock** (visibility of the
  active layer, one chip per layer, the type and colour for new features) ·
  snap and flipY toggles, zoom, fit, keyboard shortcuts, cursor coordinates.
- **Right sidebar:** the list of points of interest on top (search, filters,
  *Unplaced*, drag onto the map; drag the divider to resize) and two tabs
  below — **Inspector** (the selection, or the map's own settings when
  nothing is selected) and **Style**.
- **Layers panel** floats next to the toolbar; drag it by the header,
  double-click the header to dock it again.
- **Export:** the menu starts with a scope — *Whole map* or *Selection* —
  and applies it to JSON, SVG, PNG, masks and copy-as-text. A selection
  export keeps the selected features and POIs plus the links between them, in
  the same world coordinates; SVG/PNG are cropped to the selection, masks
  keep the map bounds so they line up with the whole-map masks.
- **Relief and bridges:** a *Relief* layer for ridges, faults and cliffs
  (topographic line symbols; cliff teeth show the downhill side — *Reverse*
  in the Inspector flips them) and a *Bridges* layer with the **Bridge** tool
  (`B`): click one bank, then the other. Bridges are drawn like on a
  topographic map (deck, splayed wings, type label; metal with piers, stone
  with hatched approaches).
- **Distances along roads:** road, path and rail links are measured along the
  network, with the rivers, faults and lakes on the way and the bridges over
  them — in the Inspector's link list (a warning when a crossing has no
  bridge) and in the text for agents.
- **Open folder** (Chrome / Edge): open your project folder and a map in it;
  the background image loads from its relative path, and the editor notices
  when the file changes on disk (an AI agent, git pull) — it reloads an
  unchanged copy, and on Save asks before overwriting newer changes.
- **POI icons:** every POI type has a colour and an icon (Style tab → *POI
  types*, click the icon to pick from 58 symbols in six groups: places,
  services, transport — car, truck, bus, train, ship, plane… — industry,
  nature, markers). A single point can
  override its icon and colour in the Inspector.
- **Settings** (bottom of the sidebar, `Ctrl+,`, or the gear in the zoom pill
  while the sidebar is collapsed): language (Русский / English),
  interface theme (System / Dark / Light), map style for new maps, coordinate
  units, autosave, clearing local maps.
- **Language:** the `RU` / `EN` pill next to Settings. The first launch follows
  the browser (Russian when any preferred language is Russian, otherwise
  English); the choice is remembered.

### Enable GitHub Pages

1. Push the repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch.**
3. Branch **`main`**, folder **`/ (root)`**, Save.

The site is plain files (`index.html`, `src/`, `examples/`); `.nojekyll` makes
Pages serve them untouched.

## The data format

`map.json` (format version 1) in one glance:

```jsonc
{
  "format": "ilumap", "version": 1,
  "meta":   { "name": "Demo Isles", "units": "cm", "displayUnit": "m", "displayUnitScale": 100,
              "flipY": false, "landMode": "islands" },
  "view":   { "bounds": { "min": [0, 0], "max": [4000000, 4000000] }, "grid": { "step": 200000, "visible": true } },
  "style":  { "preset": "blueprint" },
  "layers": { "land": [], "water": [], "coast": [], "rivers": [], "roads": [], "rails": [], "walls": [], "zones": [] },
  "pois":   [ { "id": "mine_old", "name": "Old Mine", "x": 2382500, "y": 1172400, "type": "mine",
                "zone": "mountains_north", "status": "approved", "placed": true } ],
  "links":  [ { "from": "mine_old", "to": "village", "type": "road", "feature": "road_mine_village" } ]
}
```

- The canvas background is the **ocean**; `land` polygons are islands
  (or `landMode: "filled"` makes the whole bounds land), `water` polygons are
  lakes cut out of the land, `zones` are biomes used for POI zones and masks.
- Features are `{ id, name?, kind, type?, points, closed?, smooth?, width?, … }`;
  walls add a `wall` object with towers and gates (gates are link endpoints).
- POIs with `"placed": false` are listed in the editor's *Unplaced* section so
  a human can drag them onto the map.
- Keys have a fixed order, unknown keys (use an `x_` prefix) survive
  round-trips.

Full reference: [docs/FORMAT.md](docs/FORMAT.md) · JSON Schema:
[schema/map.schema.json](schema/map.schema.json) · design notes:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## CLI

`tools/ilumap.mjs` needs only Node (20+; CI uses 24) and uses the same core
modules as the editor.

```bash
node tools/ilumap.mjs --help
node tools/ilumap.mjs --version                                # ilumap 0.1.0 (map format v1)
node tools/ilumap.mjs validate examples/demo/map.json          # exit 1 on errors
node tools/ilumap.mjs text examples/demo/map.json              # markdown description (--plain for text)
node tools/ilumap.mjs svg examples/demo/map.json --width 2048 > map.svg
node tools/ilumap.mjs mask examples/demo/map.json --source land --size 4096 --out masks/
node tools/ilumap.mjs fmt examples/demo/map.json               # canonical formatting (--check in CI)
node tools/ilumap.mjs list examples/demo/map.json --pois --status approved
node tools/ilumap.mjs list examples/demo/map.json --ids
node tools/ilumap.mjs diff old.json map.json                   # what changed (--plain, --json, --out)
node tools/ilumap.mjs diff examples/demo/map.json --git        # the working file against HEAD (or --git <rev>)
```

**Single-file CLI.** The same CLI is published as one self-contained file,
[`ilumap.mjs`](https://ilumetric.github.io/IluMap/ilumap.mjs), so it can be
used without cloning (Node 20+):

```bash
curl -O https://ilumetric.github.io/IluMap/ilumap.mjs
node ilumap.mjs text map.json
```

It is generated by `npm run bundle` (`tools/bundle.mjs`: walks the imports of
`tools/ilumap.mjs`, wraps each module in its own scope) and committed; a test
fails when it is out of date with the sources, so rerun `npm run bundle` after
changing the CLI or `src/core`.

Excerpt of `text` on the demo:

```
- **Old Mine** (`mine_old`, mine, approved) — zone: Northern Mountains, on land.
  8.5 km N of Millbrook (`village`), 13.9 km NW of Old Watchtower (`ruin_watchtower`), 16 km NE of Lumber Camp (`lumber_camp`).
  Links: road → village ("Miners road"); rail → city_riverport ("Ore Line").
```

## Using it from an AI agent

An agent never needs the browser: read and edit `map.json` directly, then
`fmt` and `validate`. An agent that only knows the site URL finds its way via
[`llms.txt`](https://ilumetric.github.io/IluMap/llms.txt) (also linked from
the page `<head>`), downloads the single-file CLI with
`curl -O https://ilumetric.github.io/IluMap/ilumap.mjs` and runs
`node ilumap.mjs --help`. The loop that works well:

1. The agent adds POIs with rough coordinates and `"placed": false`, and
   references them from lore by id.
2. A human opens the editor (*Open file* / *Open folder*), drags them from
   *Unplaced* onto the map, saves.
3. The agent runs `diff map.json --git` (or `diff old.json map.json`) to see
   what the human moved, placed, renamed or drew ("Moved **Farm** (`farm`)
   300 m NE — now in Central Plains (was Saltmarsh)."), `text` to "see" the
   whole map (zone, land/water, nearest POIs with distance and compass
   direction, links) and `svg` to show a human.

The editor keeps a browser working copy; only *Save* writes the file, so the
agent re-reads `map.json` before every edit and never writes back a stale copy.
See [docs/AGENT.md](docs/AGENT.md) for the commands, rules (ids, key order,
`x_` fields) and a programmatic example.

## Terrain calculator (Unreal Mesh Terrain)

Unreal's Mesh Terrain (MeshPartition *Create Rectangle* / *Import Heightmap*)
asks for a mesh size, a resolution (quads per axis) and a section split. The
**Mesh Terrain** dropdown (top bar, `T`) works these out for your map:

- the mesh size is the map's bounds, in world units (cm);
- pick a quad size (25 cm … 8 m presets, or any value) or type the resolution;
  the panel shows the resulting quad size, grid, triangles and vertices;
- sections: *Automatic* (max triangles per section — the layout is an estimate)
  or *Explicit* (layout × section resolution, which sets the total resolution);
- height range (Z) for *Import Heightmap* and the heightmap / mask size that
  lines up with the grid (resolution + 1 px, one pixel per vertex);
- a block with the exact values to type into Unreal (copy button), a table of
  quad-size options for this map, a button that exports masks at the grid
  size, and an optional overlay of the sections (and quads when zoomed in) on
  the map.

The chosen grid is saved in `map.json → terrain`, so an agent reads the same
numbers (`node tools/ilumap.mjs terrain map.json`).

## Masks for Gaea, World Machine and Unreal

Masks are 8-bit greyscale PNGs covering `view.bounds` (or `--bounds`), white =
selected, with pixel (0,0) at the top-left of the bounds as seen on screen
(`flipY` aware). Sources: `land`, `water`, `zones`, `zones:<type>`, `rivers`,
`roads`, `rails`, `walls`, `coast`, `feature:<id>`. Options: `--size`,
`--width/--height`, `--invert`, `--feather <px>`, `--stroke <world units>`,
`--split` (one file per zone type). Every run writes a `masks.json` sidecar with
the bounds and world units per pixel.

```bash
node tools/ilumap.mjs mask map.json --source land --size 4096 --out masks/          # island shape
node tools/ilumap.mjs mask map.json --source zones --split --size 4096 --out masks/ # mask_zones_mountains.png, …
node tools/ilumap.mjs mask map.json --source rivers,roads --feather 8 --out masks/   # carving / flattening
```

In Gaea, load `mask_land.png` with a *File* node sized to the same world extent
and use it as the island mask; zone masks drive erosion/texturing per biome.
The editor has the same export under **Export → Masks…** (top bar).

## Keyboard shortcuts

| Key | Action |
|---|---|
| `V` | Select / move (Shift+click adds, drag on empty space box-selects) |
| `H`, hold `Space`, middle mouse | Pan |
| Wheel · `F` · `+` / `-` | Zoom to cursor · fit · zoom |
| `L` / `P` / `W` / `B` | Line / polygon / wall / bridge tool (drawing goes into the active layer — pick it in the dock; a bridge is one click per bank) |
| `O` | Place a POI (or drag one from the POI list) |
| `M` | Measure |
| `K` | Calibrate the background image (2 points) |
| `Enter`, double-click, right-click | Finish drawing |
| `C` · `Backspace` · `Esc` | Close path · remove last point · cancel |
| `Shift` | Invert grid snapping (magnet toggle, bottom right) while drawing / dragging a POI |
| `Alt`+click segment · double-click vertex | Insert · delete a vertex |
| `Delete` · arrows | Delete · nudge the selection |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O` | Save to map.json / save as / open a map.json as a local map |
| `Ctrl+B` · `Ctrl+K` · `Ctrl+,` | Show / hide the sidebar · search local maps · settings (language, theme) |
| `G` · `/` · `?` · `F2` | Grid · search POIs · help · rename the map |
| `[` · `]` · `T` | Layers panel · right sidebar · Mesh Terrain calculator |

## Development

```bash
npm test          # = node --test "test/*.test.js" (no dependencies to install)
```

- `src/core/` — pure ES modules (no DOM): format, validation, geometry,
  calibration, SVG renderer, mask rasteriser, PNG encoder, text export. Shared
  by the editor and the CLI.
- `src/app/` — the editor UI (DOM only). UI look and components:
  [docs/DESIGN.md](docs/DESIGN.md).
- `tools/ilumap.mjs` — the CLI.
- `src/app/i18n/` — UI languages (see below).

No build step, no npm packages — keep it that way.

### Languages

UI strings live in `src/app/i18n/ru.js` and `src/app/i18n/en.js`: plain ES
modules exporting flat objects with dotted keys grouped by area (`sidebar.*`,
`tools.*`, `inspector.*`, `toast.*`, …). Counted phrases are objects of
plural forms (`{ one, few, many, other }` for Russian, `{ one, other }` for
English). Code uses `t('key', { name })`, `plural('key', n)` and
`label('poiTypes', value)` from `src/app/i18n/index.js`; map data is never
translated. The CLI and the text export for agents stay English.

To add a language:

1. Copy `src/app/i18n/en.js` to `src/app/i18n/<code>.js` and translate the
   values (keep the keys and `{placeholders}`; give plural entries every
   category `Intl.PluralRules('<code>')` uses).
2. Import it in `src/app/i18n/index.js` and add it to `DICTIONARIES` and to
   `LANGUAGES` (Russian stays first), and to the language check in the early
   script in `index.html`.
3. Run `npm test` — `test/i18n.test.js` checks that every dictionary has the
   same keys and placeholders, complete plural forms and no empty strings.

## License

MIT — see [LICENSE](LICENSE).
