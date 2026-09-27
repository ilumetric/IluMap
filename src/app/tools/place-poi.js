// POI tool: click on the map to add a POI (type = last used POI type).
import { store, change, select, emit } from '../state.js';
import { nextId, zoneOf } from '../../core/model.js';

export default {
  id: 'poi',
  label: 'POI',
  key: 'O',
  icon: 'poi',
  hint: () => `Click to place a new “${store.prefs.poiType || 'poi'}” POI · Shift toggles grid snapping · drag POIs from the list onto the map`,
  down(ctx) {
    const [x, y] = ctx.snap ? ctx.canvas.snap(ctx.world) : ctx.world.map(Math.round);
    const id = nextId(store.doc, 'poi');
    const poi = { id, name: 'New POI', x, y, type: store.prefs.poiType || 'poi', status: 'idea' };
    const z = zoneOf(store.doc, [x, y]);
    if (z) poi.zone = z;
    change((doc) => { doc.pois.push(poi); });
    select(id);
    emit('focus-field', 'name');
  },
};
