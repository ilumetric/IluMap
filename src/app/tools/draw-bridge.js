// Bridge tool: click one bank, then the other. Creates a two-point feature in
// the bridges layer (type from the dock, deck width by type); it is drawn as a
// topographic bridge symbol and counts as a crossing for road routes.
import { createDrawTool } from './draw-common.js';

export default createDrawTool({
  id: 'bridge', labelKey: 'tools.bridge', hintKey: 'tools.drawBridgeHint', key: 'B', icon: 'bridge', kind: 'line', layer: 'bridges', maxPoints: 2,
});
