// Line tool: coast, rivers, roads, rails (and walls when the walls layer is active).
import { createDrawTool } from './draw-common.js';

export default createDrawTool({ id: 'line', label: 'Line', key: 'L', icon: 'line', kind: 'line' });
