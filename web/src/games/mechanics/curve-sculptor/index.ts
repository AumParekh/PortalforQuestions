import type { MechanicPlugin } from '../../arc/plugin';
import { buildCurveSculptor, nameAfterDiscovery, supportsCurveSculptor } from './build';
import type { CurvePayload } from './build';
import { CurveBoard } from './CurveBoard';

/**
 * Curve Sculptor (PORTAL_PLAN §3c visual mechanics): three sliders, one of them out of place, so
 * the curve breaks the shape word the notes use; drag until it snaps. Data: curated
 * content/games/mechanics/curve-sculptor.json via corpus.extras['curve-sculptor'].
 */
export const plugin: MechanicPlugin<CurvePayload> = {
  id: 'curve-sculptor',
  title: 'Curve Sculptor',
  frames: ['museum-tour', 'field-guide', 'forecast-desk', 'autopsy-room'],
  supports: (reading, corpus) => supportsCurveSculptor(reading, corpus),
  build: (reading, ctx) => buildCurveSculptor(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: CurveBoard,
};

export const curveSculptor = plugin;
