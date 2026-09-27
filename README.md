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

- **Human-friendly:** a dark "blueprint" (or light "parchment") editor with
  layers, smooth curves, a wall builder with towers and gates, snapping, a
  measure tool, background-image calibration and undo/redo.
- **Agent-friendly:** stable human-readable ids (`mine_old`, `village`), one
  `[x, y]` per line so moving one vertex changes one line of the diff, a CLI
  that prints the map as prose ("Old Mine is 8.5 km N of Millbrook…"), and a
  hand-written validator.
- **World units, not pixels:** coordinates are engine units (Unreal centimetres
  by default); a background sketch is calibrated to the world, never the other
  way round.

## Quick start

Open the hosted editor on GitHub Pages (`https://<you>.github.io/<repo>/`), or
run it locally from the repo root with any static server:

```bash
python -m http.server 8765        # then open http://localhost:8765/
# or
npx serve .
```

ES modules do not load from `file://`, so a server is needed. The editor opens
the demo map (`examples/demo/map.json`); `?map=path/to/map.json` loads another
map from the same site.

Work on your own map with **File → Open…** (`Ctrl+O`). In Chromium browsers the
File System Access API keeps a handle to the file, so `Ctrl+S` writes straight
back to `map.json` in your working copy. Other browsers download the file
instead. A draft is autosaved to `localStorage` as a safety net only — the
JSON file is always the source of truth. You can also drag a `map.json` onto
the canvas, or an image to use as a calibrated background.

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
node tools/ilumap.mjs validate examples/demo/map.json          # exit 1 on errors
node tools/ilumap.mjs text examples/demo/map.json              # markdown description (--plain for text)
node tools/ilumap.mjs svg examples/demo/map.json --width 2048 > map.svg
node tools/ilumap.mjs mask examples/demo/map.json --source land --size 4096 --out masks/
node tools/ilumap.mjs fmt examples/demo/map.json               # canonical formatting (--check in CI)
node tools/ilumap.mjs list examples/demo/map.json --pois --status approved
node tools/ilumap.mjs list examples/demo/map.json --ids
```

Excerpt of `text` on the demo:

```
- **Old Mine** (`mine_old`, mine, approved) — zone: Northern Mountains, on land.
  8.5 km N of Millbrook (`village`), 13.9 km NW of Old Watchtower (`ruin_watchtower`), 16 km NE of Lumber Camp (`lumber_camp`).
  Links: road → village ("Miners road"); rail → city_riverport ("Ore Line").
```

## Using it from an AI agent

An agent never needs the browser: read and edit `map.json` directly, then
`fmt` and `validate`. The loop that works well:

1. The agent adds POIs with rough coordinates and `"placed": false`, and
   references them from lore by id.
2. A human opens the editor, drags them from *Unplaced* onto the map, saves.
3. The agent runs `text` to "see" the result (zone, land/water, nearest POIs
   with distance and compass direction, links) and `svg` to show a human.

See [docs/AGENT.md](docs/AGENT.md) for the rules (ids, key order, `x_` fields)
and a programmatic example.

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
The editor has the same export under **Export → Masks…**.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `V` | Select / move (Shift+click adds, drag on empty space box-selects) |
| `H`, hold `Space`, middle mouse | Pan |
| Wheel · `F` · `+` / `-` | Zoom to cursor · fit · zoom |
| `L` / `P` / `W` | Line / polygon / wall tool (drawing goes into the active layer) |
| `O` | Place a POI (or drag one from the POI list) |
| `M` | Measure |
| `K` | Calibrate the background image (2 points) |
| `Enter`, double-click, right-click | Finish drawing |
| `C` · `Backspace` · `Esc` | Close path · remove last point · cancel |
| `Shift` | Snap to grid while drawing / dragging a POI |
| `Alt`+click segment · double-click vertex | Insert · delete a vertex |
| `Delete` · arrows | Delete · nudge the selection |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O` | Save / save as / open |
| `G` · `/` · `?` · `[` `]` | Grid · search POIs · help · toggle panels |

## Development

```bash
npm test          # = node --test "test/*.test.js" (no dependencies to install)
```

- `src/core/` — pure ES modules (no DOM): format, validation, geometry,
  calibration, SVG renderer, mask rasteriser, PNG encoder, text export. Shared
  by the editor and the CLI.
- `src/app/` — the editor UI (DOM only).
- `tools/ilumap.mjs` — the CLI.

No build step, no npm packages — keep it that way.

## License

MIT — see [LICENSE](LICENSE).
