import type { MechanicPlugin } from '../../arc/plugin';
import { buildAttribution, nameAfterDiscovery, supportsAttribution } from './build';
import type { AgPayload } from './build';
import { AttributionBoard } from './AttributionBoard';

/**
 * Attribution Grid: file each statement about a control, a report or a risk decision under the
 * first, second or third line, or the board / committee. Trains asking "whose job is this?"
 * before answering a governance question. Data: content/games/mechanics/attribution-grid.json.
 */
export const plugin: MechanicPlugin<AgPayload> = {
  id: 'attribution-grid',
  title: 'Attribution Grid',
  frames: ['night-court', 'swearing-in', 'heist-debrief', 'field-guide'],
  drills: ['Role'],
  supports: (reading, corpus) => supportsAttribution(reading, corpus),
  build: (reading, ctx) => buildAttribution(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: AttributionBoard,
};

export const attributionGrid = plugin;
