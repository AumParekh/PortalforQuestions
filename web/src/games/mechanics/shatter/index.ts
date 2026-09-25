import type { MechanicPlugin } from '../../arc/plugin';
import { buildShatter, nameAfterDiscovery, supportsShatter } from './build';
import type { ShatterPayload } from './build';
import { ShatterBoard } from './ShatterBoard';

/** Shatter (brief §7.1), the reference mechanic for the plug-in interface. */
export const shatter: MechanicPlugin<ShatterPayload> = {
  id: 'shatter',
  title: 'Shatter',
  frames: ['night-court', 'autopsy-room', 'signal-room', 'swearing-in', 'field-guide'],
  drills: ['Polarity', 'Sibling', 'Sign', 'Role', 'Scope', 'Definition', 'Sequence', 'Formula', 'Intermediate result'],
  supports: (reading) => supportsShatter(reading),
  build: (reading, ctx) => buildShatter(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: ShatterBoard,
};
