import type { MechanicPlugin } from '../../arc/plugin';
import { buildWaterfall, nameAfterDiscovery, supportsWaterfall } from './build';
import type { WaterfallPayload } from './build';
import { WaterfallBoard } from './WaterfallBoard';

/**
 * Waterfall Builder (PORTAL_PLAN §3c visual mechanics): stacks, processes and loops from the notes,
 * built top to bottom from scattered tiles. The column lights up as a working flow; a loop closes
 * into a circle when its last tile lands. Data: curated content/games/mechanics/waterfall-builder.json
 * via corpus.extras['waterfall-builder'].
 */
export const plugin: MechanicPlugin<WaterfallPayload> = {
  id: 'waterfall-builder',
  title: 'Waterfall Builder',
  frames: ['heist-debrief', 'museum-tour', 'autopsy-room', 'field-guide'],
  drills: ['Sequence'],
  supports: (reading, corpus) => supportsWaterfall(reading, corpus),
  build: (reading, ctx) => buildWaterfall(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: WaterfallBoard,
};

export const waterfallBuilder = plugin;
