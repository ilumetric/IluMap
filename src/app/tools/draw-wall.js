// Wall tool: draws like the line tool into the walls layer and adds a `wall`
// object (towers at vertices, no gates yet). Towers and gates are edited in the inspector.
import { createDrawTool } from './draw-common.js';

export default createDrawTool({ id: 'wall', labelKey: 'tools.wall', key: 'W', icon: 'wall', kind: 'line', wall: true });
