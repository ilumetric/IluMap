# Using IluMap as an AI agent

You do not need the browser. `map.json` is the whole map; a single-file CLI
reads, checks, describes and compares it. If all you have is the site URL
(https://ilumetric.github.io/IluMap/), start here.

## Get the CLI

One file, no dependencies, Node 20+:

```bash
curl -O https://ilumetric.github.io/IluMap/ilumap.mjs
node ilumap.mjs --version        # ilumap <app version> (map format v1)
node ilumap.mjs --help           # the source of truth for commands and options
```

`ilumap.mjs` is generated from `tools/ilumap.mjs` and `src/core/*` (inside a
clone of the repo, `node tools/ilumap.mjs …` is the same thing). New commands
(for example `route`) may appear before this page mentions them: check
`--help`.

## Commands

```bash
node ilumap.mjs text map.json                 # the map as markdown: POIs (zone, land/water, nearest POIs
                                              # with distance and compass direction), zones, lines, walls, links
node ilumap.mjs text map.json --plain         # plain text
node ilumap.mjs list map.json --ids           # every id and what it is (--pois --features --links, --json)
node ilumap.mjs list map.json --pois --unplaced
node ilumap.mjs validate map.json             # exit 1 on errors
node ilumap.mjs fmt map.json                  # canonical formatting (key order, one [x, y] per line)
node ilumap.mjs svg map.json --out map.svg    # render for a human to look at
node ilumap.mjs mask map.json --source land --size 4096 --out masks/   # PNG masks for Gaea / World Machine / UE
node ilumap.mjs terrain map.json              # Unreal Mesh Terrain grid (--quad 200 --write stores it)
node ilumap.mjs route map.json village mine_old # distance along roads, roads used, rivers/faults and bridges on the way (--rail, --json)
node ilumap.mjs diff old.json new.json        # what changed between two versions
node ilumap.mjs diff map.json --git [rev]     # the working file against git (default HEAD)
```

`text` describes each POI like a person would:

```
- **Old Mine** (`mine_old`, mine, approved) — zone: Northern Mountains, on land.
  8.5 km N of Millbrook (`village`), 13.9 km NW of Old Watchtower (`ruin_watchtower`).
  Links: road → village ("Miners road"); rail → city_riverport ("Ore Line").
```

`diff` says what moved and where it is now (`--plain`, `--json`, `--out` work
as usual; exit code 0 unless something failed):

```
## POIs (2)

- Moved **Lumber Camp** (`lumber_camp`) 300 m NE — now in Central Plains (was Westwood).
- Placed **Drowned Shrine** (`shrine_swamp`) on the map — in Saltmarsh, 4.9 km NW of **Riverport** (`city_riverport`).
```

## Working together with a human

Best setup when the human edits in a browser next to you (e.g. the Claude
app's built-in browser): run `node tools/serve.mjs <project folder>` from the
IluMap repo (or start the `ilumap` entry of `.claude/launch.json`) and open
`http://localhost:8765/?file=<path/to/map.json>`. The human's Save writes the
file directly, and your edits to the file appear in their editor within a few
seconds — as one undoable step, or as a question when they have unsaved
edits. No file dialogs, no downloads.

1. **Agent** adds POIs (lore places, quest spots) with rough `x`, `y` and
   `"placed": false`, references them from lore by id, runs `fmt` and
   `validate`, commits or hands the file over.
2. **Human** opens the editor (https://ilumetric.github.io/IluMap/) →
   *Open file* (or *Open folder* for a project with a background image), drags
   the POIs from the *Unplaced* list onto the map, draws roads or zones, and
   presses *Save*.
3. **Agent** runs `node ilumap.mjs diff map.json --git` (or
   `diff old.json map.json` against the copy it last saw) to learn what moved
   and where things ended up, then `text` if it needs the full picture.

## File safety

* The editor keeps a **browser working copy** of the map (autosaved in the
  browser); only the human's *Save* writes `map.json`. Until then the file on
  disk is the old version.
* **Re-read `map.json` right before you edit it.** Never keep a copy in memory
  across turns and write it back later: that silently reverts what the human
  did in the meantime. Change only what you mean to change.
* If the human may have unsaved edits, ask them to save first. The editor
  notices when the file changed on disk (maps opened via *Open folder*, or a
  file opened again) and offers to reload it.
* Commit (or copy) the file before large edits so `diff --git` / `diff old new`
  can show the result.

## Editing rules

* Ids are `[a-z0-9_]+` and unique across features, POIs, wall gates and
  (optional) link ids. Never rename an id that lore references.
* A link's `from` / `to` are POI or gate ids; `feature` is an existing feature id.
* Coordinates are world units (`meta.units`, cm by default); north is `−y`
  unless `meta.flipY` is true. `text` and `diff` print real distances.
* Keep the key order and one `[x, y]` per line; `fmt` fixes both.
* Custom fields go under an `x_` prefix and survive round-trips.
* Full field reference: [FORMAT.md](FORMAT.md); JSON Schema:
  [schema/map.schema.json](../schema/map.schema.json).

## Programmatic use

The bundle is a CLI, not a library: it cannot be imported. From your own
code, either call the CLI (`--json` on `list` and `diff`, `terrain --json`),
or clone the repository and import the pure ES modules in `src/core/`
(no DOM, no dependencies):

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { normalize, serialize, validate, nextId } from './src/core/model.js';
import { diffText } from './src/core/diff.js';

const before = readFileSync('map.json', 'utf8');       // re-read right before editing
const doc = normalize(before);
doc.pois.push({ id: nextId(doc, 'poi'), name: 'Smugglers Cove', x: 1200000, y: 2900000, type: 'poi', status: 'idea', placed: false });
if (!validate(doc).ok) throw new Error('invalid');
writeFileSync('map.json', serialize(doc));
console.log(diffText(JSON.parse(before), doc));
```
