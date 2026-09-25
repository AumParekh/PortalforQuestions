import type { MechanicPlugin } from '../../arc/plugin';
import { buildCloze, nameAfterDiscovery, supportsCloze } from './build';
import type { ClozePayload } from './build';
import { ClozeBoard } from './ClozeBoard';

/**
 * Cloze Chain (PORTAL_PLAN §3c): linked load-bearing sentences from one objective, each with its
 * key term, number or direction word blanked; cues (first letter, then three options) only on
 * request, and a cue lowers the item's SRS grade.
 */
export const plugin: MechanicPlugin<ClozePayload> = {
  id: 'cloze-chain',
  title: 'Cloze Chain',
  frames: ['signal-room', 'heist-debrief', 'museum-tour', 'swearing-in', 'field-guide'],
  supports: (reading) => supportsCloze(reading),
  build: (reading, ctx) => buildCloze(reading, ctx),
  name: (plan, discovery, { reading }) => nameAfterDiscovery(reading, plan, discovery),
  Render: ClozeBoard,
};

export const clozeChain = plugin;
