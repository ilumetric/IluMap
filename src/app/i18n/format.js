// Localised distances / areas / units for the UI (scale bar, measure tool,
// inspector, read-outs). The core formatters keep their English default for
// the CLI and the text export; the UI passes { locale, units }.

import { formatLength, formatArea } from '../../core/text-export.js';
import { t, getLang, has, formatNumber } from './index.js';

function unitOpts() {
  return { locale: getLang(), units: { km: t('units.km'), m: t('units.m'), cm: t('units.cm') } };
}

/** World length -> "8,5 км" / "8.5 km". */
export const fmtLength = (worldLen, meta) => formatLength(worldLen, meta, unitOpts());

/** World area -> "12,4 км²" / "12.4 km²". */
export const fmtArea = (worldArea, meta) => formatArea(worldArea, meta, unitOpts());

/** Display name of a unit string from map.json meta (cm -> см); unknown units stay as they are. */
export const unitLabel = (u) => (u && has(`units.${u}`) ? t(`units.${u}`) : u || '');

/** Compass point from geometry.compass8 ("NE") -> localised abbreviation. */
export const compassLabel = (c) => (has(`compass.${c}`) ? t(`compass.${c}`) : c);

/** Plain localised number with a fixed number of decimals. */
export const fmtNum = (v, digits = 0) => formatNumber(v, { maximumFractionDigits: digits, minimumFractionDigits: digits });
