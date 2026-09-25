import type { MechanicPlugin } from '../../arc/plugin';
import { buildTailShaper, nameAfterDiscovery, supportsTailShaper } from './build';
import type { TailPayload } from './build';
import { TailBoard } from './TailBoard';

/**
 * Tail Shaper (PORTAL_PLAN §3c visual mechanics): one split Student-t density, four sliders (left
 * tail, right tail, mean shift, variance). The player bends the density until it matches the
 * distribution the notes describe; on a match the implied-volatility smile or skew that
 * distribution produces is drawn over it. Data: curated content/games/mechanics/tail-shaper.json
 * via corpus.extras['tail-shaper'].
 */
export const plugin: MechanicPlugin<TailPayload> = {
  id: 'tail-shaper',
  title: 'Tail Shaper',
  frames: ['field-guide', 'forecast-desk', 'museum-tour', 'autopsy-room'],
  supports: (reading, corpus) => supportsTailShaper(reading, corpus),
  build: (reading, ctx) => buildTailShaper(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: TailBoard,
};

export const tailShaper = plugin;
