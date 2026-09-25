import type { MechanicPlugin } from '../../arc/plugin';
import { buildBlurt, nameAfterDiscovery, supportsBlurt } from './build';
import type { BlurtPayload } from './build';
import { BlurtBoardView } from './BlurtBoard';

/**
 * Blurt Board (PORTAL_PLAN §3c): free recall onto a blank board for one objective, then the
 * objective's extracted items (terms, bullets, numeric items, variables) light up as hit or
 * missed. Discovery is a shorter objective, untimed; pressure a timed blurt on another. Every
 * target item is one round, keyed by its sub-item ID, so hits and misses feed the shared SRS.
 */
export const plugin: MechanicPlugin<BlurtPayload> = {
  id: 'blurt-board',
  title: 'Blurt Board',
  frames: ['museum-tour', 'field-guide', 'heist-debrief', 'swearing-in'],
  supports: (reading) => supportsBlurt(reading),
  build: (reading, ctx) => buildBlurt(reading, ctx),
  name: (plan, discovery, { corpus }) => nameAfterDiscovery(corpus, plan, discovery),
  Render: BlurtBoardView,
};

export const blurtBoard = plugin;
