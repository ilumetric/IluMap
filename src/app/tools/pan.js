// Pan tool: the canvas pans on drag while this tool is active (also: hold Space, or middle mouse).
import { t } from '../i18n/index.js';

export default {
  id: 'pan',
  get label() { return t('tools.pan'); },
  key: 'H',
  icon: 'pan',
  hint: () => t('tools.panHint'),
};
