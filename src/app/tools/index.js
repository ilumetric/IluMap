// Tool registry, in toolbar order.
import select from './select.js';
import pan from './pan.js';
import line from './draw-line.js';
import polygon from './draw-polygon.js';
import wall from './draw-wall.js';
import poi from './place-poi.js';
import measure from './measure.js';
import calibrate from './calibrate.js';

export const TOOL_LIST = [select, pan, line, polygon, wall, poi, measure, calibrate];
export const TOOLS = Object.fromEntries(TOOL_LIST.map((t) => [t.id, t]));
