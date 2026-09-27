// POI tool: click on the map to add a POI (type = last used POI type).
import { store, change, select, emit } from '../state.js';
import { nextId, zoneOf } from '../../core/model.js';
import { t, label } from '../i18n/index.js';

export default {
  id: 'poi',
  get label() { return t('tools.poi'); },
  key: 'O',
  icon: 'poi',
  hint: () => t('tools.poiHint', { type: label('poiTypes', store.prefs.poiType || 'poi') }),
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
