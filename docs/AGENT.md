# Using IluMap as an AI agent

You do not need the browser. `map.json` is the whole map.

## Read the map

```bash
node tools/ilumap.mjs text map.json            # markdown summary: POIs, zones, distances, links
node tools/ilumap.mjs text map.json --plain    # plain text
node tools/ilumap.mjs list map.json --pois --status approved
node tools/ilumap.mjs svg map.json > map.svg   # render for a human to look at
node tools/ilumap.mjs validate map.json
node tools/ilumap.mjs list map.json --ids      # every id and what it is
```

The text summary describes each POI like a person would:

```
- **Old Mine** (`mine_old`, mine, approved) — zone: Northern Mountains, on land.
  1.2 km NE of Village (`village`), 4.8 km N of Riverport (`city_riverport`).
  Links: road → village ("Miners road").
```

## Add or move things

Edit `map.json` directly. Rules:

* Ids are `[a-z0-9_]+` and unique across features, POIs, gates and (optional) link ids.
  A link's `feature` must be an existing feature id; `from`/`to` must be POI or gate ids.
* Add a POI with `"placed": false` if you only know the rough position; the
  human will drag it into place in the tool.
* Keep the key order and one `[x, y]` per line so the diff stays small. Run
  `node tools/ilumap.mjs fmt map.json` to canonicalise after editing.
* Run `node tools/ilumap.mjs validate map.json` before committing.
* Reference POIs from lore by id (`mine_old`), never by name or index.
* Custom fields go under an `x_` prefix and survive round-trips.

## Masks for heightmap generation (Gaea, World Machine, UE)

```bash
node tools/ilumap.mjs mask map.json --source land --size 4096 --out masks/
node tools/ilumap.mjs mask map.json --source zones --split --size 4096 --out masks/
node tools/ilumap.mjs mask map.json --source rivers --feather 8 --out masks/
```

Each run writes `masks.json` next to the PNGs (bounds, pixel size, world units
per pixel, flipY) so an importer knows the scale. Pixel (0,0) is the top-left of
the bounds as seen on screen (min y when `flipY` is false, max y when true).

## Programmatic use

The same modules the editor uses are plain ES modules:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { normalize, serialize, validate, nextId } from './src/core/model.js';

const doc = normalize(readFileSync('map.json', 'utf8'));
const id = nextId(doc, 'poi');
doc.pois.push({ id, name: 'Smugglers Cove', x: 1200000, y: 2900000, type: 'poi', status: 'idea', placed: false });
if (!validate(doc).ok) throw new Error('invalid');
writeFileSync('map.json', serialize(doc));
```
