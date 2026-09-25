import type { MechanicPlugin } from '../../arc/plugin';
import { buildFrontierRider, nameAfterDiscovery, supportsFrontierRider } from './build';
import type { FrontierPayload } from './build';
import { FrontierBoard } from './FrontierBoard';

/**
 * Frontier Rider (PORTAL_PLAN §3c visual mechanics): a live mean–standard deviation plane with the
 * frontier, the line from the risk-free asset and one marked portfolio. One input sits on a slider.
 * The player calls where the portfolio goes, then moves the slider and watches the plane break and
 * re-form. Data: curated content/games/mechanics/frontier-rider.json via
 * corpus.extras['frontier-rider'], re-solved live with the same unconstrained Markowitz maths the
 * validator uses (maths.ts).
 */
export const plugin: MechanicPlugin<FrontierPayload> = {
  id: 'frontier-rider',
  title: 'Frontier Rider',
  frames: ['forecast-desk', 'field-guide', 'museum-tour', 'heist-debrief'],
  supports: (reading, corpus) => supportsFrontierRider(reading, corpus),
  build: (reading, ctx) => buildFrontierRider(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: FrontierBoard,
};

export const frontierRider = plugin;
