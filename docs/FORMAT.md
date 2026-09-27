# map.json format (version 1)

The file is plain JSON with a fixed key order (see `serialize()` in
`src/core/model.js`). Unknown keys are preserved on round-trip so agents can
add their own fields under an `x_` prefix (e.g. `x_questGiver`).

## Top level

| key | type | description |
|---|---|---|
| `format` | `"ilumap"` | file marker |
| `version` | `1` | format version, bumped on breaking changes |
| `meta` | object | world metadata |
| `view` | object | background image, calibration, bounds, grid |
| `terrain` | object, optional | Unreal Mesh Terrain grid (resolution, sections, height range) |
| `style` | object | colours and per-type styling |
| `layers` | object | `land`, `water`, `coast`, `rivers`, `roads`, `rails`, `walls`, `zones`, `relief`, `bridges` — each an array of Feature |
| `pois` | array | points of interest |
| `links` | array | relations between POIs |

## `meta`

| key | default | description |
|---|---|---|
| `name` | `"Untitled"` | world / map name |
| `description` | `""` | free text |
| `units` | `"cm"` | unit of all coordinates (UE uses cm) |
| `displayUnit` | `"m"` | unit shown in UI, scale bar, text export |
| `displayUnitScale` | `100` | how many `units` in one `displayUnit` |
| `flipY` | `false` | `false`: +y is down on screen (image-like). `true`: +y is up (engine-like). Compass directions in the text export follow this. |
| `landMode` | `"islands"` | `"islands"`: only `land` polygons are land, the rest is ocean. `"filled"`: the whole `view.bounds` is land; `land` polygons are ignored, `water` polygons are lakes. |

## `view`

```jsonc
"view": {
  "bounds": { "min": [0, 0], "max": [400000, 400000] },   // world units; default canvas + mask extent
  "background": {
    "src": "assets/heightmap.png",          // relative to map.json, optional
    "opacity": 0.6,
    "calibration": [                        // exactly 2 pairs: image pixel -> world
      { "px": [0, 0],       "world": [0, 0] },
      { "px": [2048, 2048], "world": [400000, 400000] }
    ]
  },
  "grid": { "step": 10000, "visible": true }
}
```

## `terrain` (optional)

The Unreal Engine **Mesh Terrain** grid chosen with the Terrain calculator
(editor: top bar → *Mesh Terrain* dropdown, `T`; CLI: `terrain`). The mesh size is not
stored here: it is the size of `view.bounds`, in world units.

```jsonc
"terrain": {
  "target": "ue-mesh-terrain",
  "resolution": [1000, 1000],          // quads per axis — Unreal "Mesh / Resolution"
  "sections": {                        // Unreal "Sections"
    "mode": "automatic",               // "automatic" | "explicit"
    "maxTriangles": 524288             // automatic: triangles per section
  },
  "heightRange": 25600                 // Z size for "Import Heightmap", world units
}
// explicit sections:
"sections": { "mode": "explicit", "layout": [4, 4], "resolution": [256, 256] }
```

* One quad = `(bounds.max − bounds.min) / resolution` on each axis.
* Explicit sections: the total resolution is `layout × sections.resolution`;
  the editor writes it into `resolution` too (a mismatch is a warning).
* Automatic sections: Unreal decides the split. The editor and CLI show an
  estimate with square sections of at most `maxTriangles` triangles.
* A heightmap or mask for this grid has `resolution + 1` pixels per axis (one
  pixel per vertex).

## `style`

```jsonc
"style": {
  "preset": "blueprint",            // "graphite" | "blueprint" | "parchment" — base palette
  "ocean": "#0f1f33",               // canvas background colour (ocean)
  "label": "#e6eef7",               // optional: label colour
  "grid": "#27456b",                // optional: grid colour
  "layers": {                        // per-layer overrides
    "land":   { "fill": "#2b3a2f", "stroke": "#cfd8e3", "width": 2 },
    "water":  { "fill": "#1e3a5f", "stroke": "#4a7fb5" },
    "coast":  { "stroke": "#cfd8e3", "width": 2 },
    "rivers": { "stroke": "#4a7fb5", "width": 3 },
    "roads":  { "stroke": "#d9b46a", "width": 2 },
    "rails":  { "stroke": "#b0b0b0", "width": 2, "dash": "8 4" },
    "walls":  { "stroke": "#e0e0e0", "width": 4 },
    "zones":  { "opacity": 0.35 },
    "relief": { "stroke": "#c9b08a", "width": 1.6 },
    "bridges": { "stroke": "#e6eef7", "width": 1.4 }
  },
  "reliefTypes": {                   // used by relief `type`; pattern = ridge | fault | cliff
    "ridge": { "stroke": "#c9b08a", "pattern": "ridge" },
    "fault": { "stroke": "#e07a5f", "pattern": "fault" },
    "cliff": { "stroke": "#b8966d", "pattern": "cliff" }
  },
  "bridgeTypes": {                   // used by bridges `type`
    "pedestrian": { "width": 2.5, "abbr": "ped." },
    "suspension": { "width": 2.5, "abbr": "susp." },
    "wood":       { "width": 3.5, "abbr": "wood" },
    "stone":      { "width": 4, "abbr": "stone", "ends": "hatch" },
    "metal":      { "width": 4, "abbr": "met.", "piers": true }
  },
  "lineTypes": {                     // used by rivers/roads/rails `type`
    "river_main":  { "width": 4 }, "river_minor": { "width": 2 },
    "road_paved":  { "dash": null }, "road_dirt": { "dash": "6 3" },
    "rail":        { "dash": "8 4" }
  },
  "wallTypes": {
    "wall_stone":    { "stroke": "#e0e0e0", "pattern": "crenel" },
    "wall_palisade": { "stroke": "#b08968", "pattern": "ticks" }
  },
  "zoneTypes": {                     // used by zones `type`
    "mountains": { "fill": "#8a6d4b", "pattern": "hatch" },
    "hills":     { "fill": "#a08a5a" },
    "plains":    { "fill": "#7fa650" },
    "forest":    { "fill": "#3f6b3a" },
    "swamp":     { "fill": "#4f6b3a", "pattern": "dots" },
    "desert":    { "fill": "#d2b06a" }
  },
  "poiTypes": {                      // used by pois `type`
    "village": { "color": "#ffd166", "icon": "house" },
    "city":    { "color": "#ef476f", "icon": "castle" },
    "mine":    { "color": "#b08968", "icon": "pick" },
    "ruin":    { "color": "#9d8189", "icon": "ruin" },
    "camp":    { "color": "#06d6a0", "icon": "tent" },
    "gate":    { "color": "#e0e0e0", "icon": "gate" },
    "poi":     { "color": "#8ecae6", "icon": "dot" }
  }
}
```

Style widths are in **screen pixels at zoom 1**, while a Feature's own
`width` is in **world units** (used by masks and rendered to scale when set).

A file only needs `"style": { "preset": "blueprint" }`: every other entry is an
override merged over the preset (see `resolveStyle()` in `src/core/styles.js`),
so the example above is what the effective style looks like, not what must be
written. A missing or unknown preset falls back to `blueprint`; the editor
creates new maps with `graphite` (changeable in Settings). Keys inside a style entry are ordered `fill, stroke, color, width,
dash, opacity, pattern, icon`. Zone `pattern` is `hatch` or `dots`; wall
`pattern` is `crenel` or `ticks`; POI `icon` is one of `house, castle, pick,
ruin, tent, gate, dot`. Switching the preset in the editor drops colour
overrides of the ocean/labels/grid/layers (type colours are kept).

## Feature

```jsonc
{
  "id": "river_black",              // required, unique across the whole file, [a-z0-9_]+
  "name": "Black River",            // optional, shown as label
  "kind": "line",                   // "line" | "polygon"
  "type": "river_main",             // optional, key into style.lineTypes / zoneTypes / wallTypes
  "points": [                       // world coords; polygons are implicitly closed
    [12000, 8000],
    [15000, 9500]
  ],
  "closed": false,                  // lines only: join last point to first (walls, coast rings)
  "smooth": true,                   // render as Catmull-Rom curve (data stays as points)
  "width": 800,                     // world units, optional (rivers/roads/walls: for masks and to-scale rendering)
  "color": "#4a7fb5",               // optional override
  "tags": ["lore"],
  "notes": "",
  "hidden": false,                  // not drawn (still exported to masks and text)
  "wall": { ... }                   // walls layer only, see below
}
```

Walls ignore `smooth` (they are always straight segments).

Layer semantics:

* `land` — polygons: islands / continents (ignored in `landMode: "filled"`).
* `water` — polygons: lakes, inland seas; subtracted from land.
* `coast` — decorative lines; the land polygon edge is already a coast.
* `rivers`, `roads`, `rails` — lines.
* `walls` — lines, usually `closed`, with a `wall` object.
* `zones` — polygons: biomes / regions used for POI `zone` and masks.
* `relief` — lines: `type` `ridge` (drawn with short ticks on both sides),
  `fault` (dash-dot with cross ticks) or `cliff` (teeth on the **left** of the
  drawing direction = the downhill side; reverse the line to flip them).
  Faults and cliffs are obstacles for road routes; ridges are reported only.
  Mask sources `relief` and `relief:<type>`.
* `bridges` — lines from one bank to the other (the editor's Bridge tool makes
  two points). `type` `pedestrian`, `suspension`, `wood`, `stone`, `metal`;
  `width` is the deck width in world units. Drawn as a topographic bridge
  symbol (deck lines with splayed wings, the type label, piers / hatched
  approaches by type, never shorter than 16 px on screen). A river, fault,
  cliff or lake crossing is "bridged" when a bridge spans it.

### Distances along roads

The CLI (`route`, `text`) and the editor measure `road`, `path` and `rail`
links along the network: roads + bridges (road and path links) or rails +
bridges (rail links), joined where endpoints meet or roads cross. The text
says e.g. `13.7 km by road (straight 13 km, 1.1×) via King's Road; crosses
Black River by Stone Bridge` or `crosses Great Fault (no bridge)`.

### `wall`

```jsonc
"wall": {
  "towers": "vertices",             // "none" | "vertices" | "auto"
  "towerSpacing": 5000,             // world units, used when towers = "auto"
  "towerSize": 600,                 // world units
  "gates": [
    { "id": "gate_riverport_n", "name": "North Gate", "at": 2 },      // at = vertex index
    { "id": "gate_riverport_s", "name": "South Gate", "t": 0.62 }     // or t = fraction along the wall
  ]
}
```

Gate ids share the global id namespace and can be link endpoints.

## Poi

```jsonc
{
  "id": "mine_old",                 // stable id, referenced from lore
  "name": "Old Mine",
  "x": 231000, "y": 118500,
  "type": "mine",
  "zone": "mountains_north",        // optional, id of a zone feature (auto-filled by the tool on move)
  "tags": ["quest", "act1"],
  "status": "approved",             // "idea" | "approved" | "slice" | "cut"
  "notes": "Collapsed entrance, second entrance from the quarry.",
  "anchor": "places.md#old-mine",   // link to the description document
  "color": null,                    // optional override of the type colour
  "icon": "skull",                  // optional override of the type icon (see below)
  "placed": true                    // false = listed but not yet on the map
}
```

POI icons (`style.poiTypes.<type>.icon` and the per-POI `icon` override), grouped as in the editor's picker:

* settlements: `dot`, `house`, `castle`, `tower`, `gate`, `ruin`, `church`, `shrine`, `farm`, `windmill`, `lighthouse`, `well`, `tent`, `campfire`, `bed`
* services: `tavern`, `shop`, `coin`, `hospital`, `book`, `shield`, `info`, `fuel`, `parking`
* transport: `car`, `truck`, `bus`, `train`, `cart`, `ship`, `boat`, `anchor`, `plane`, `helipad`, `bridge`, `signpost`
* industry: `pick`, `factory`, `warehouse`, `gear`, `power`, `antenna`
* nature: `peak`, `cave`, `tree`, `water`, `fish`, `paw`, `fire`
* markers: `star`, `flag`, `quest`, `question`, `skull`, `swords`, `chest`, `key`, `eye`

An unknown name is a validation warning and falls back to the type icon.

## Link

```jsonc
{ "id": "link_miners_road",         // optional, shares the global id namespace
  "from": "mine_old", "to": "village", "type": "road", "name": "Miners road",
  "feature": "road_mine_village",   // optional Feature id carrying the link
  "notes": "" }
```

`from` and `to` must be POI or gate ids.

`type`: `road`, `rail`, `river`, `path`, `quest`, `sight` (visible from), or
any custom string.

## Serialisation rules

* 2-space indent, keys in the order documented above, unknown keys last.
* Every coordinate pair `[x, y]` on its own line; numbers are integers when
  integral, else rounded to 2 decimals.
* Arrays of features/pois/links keep their order (the tool never re-sorts).
* Trailing newline, `\n` line endings.
* Every array of plain values stays on one line (`[x, y]`, `"tags": ["a", "b"]`);
  optional keys are omitted rather than written as `null`/`false` by the editor.

## Validation

`validate()` (`src/core/schema.js`, CLI `validate`) checks the shapes above plus
the cross-references JSON Schema cannot express: ids are `[a-z0-9_]+` and
unique across features, POIs, gates and link ids; a layer only holds its kind
(`land`/`water`/`zones` polygons with at least 3 points, the others lines with
at least 2); `wall` only in `walls`; each gate has exactly one of `at` (valid
vertex index) or `t` (0..1); POI `zone` is a zone id; link ends exist; link
`feature` is a feature id; unknown layer names are errors unless prefixed `x_`.
Warnings (not errors): POIs outside `view.bounds`, unknown preset, `closed` on
polygons.
