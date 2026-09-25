import type { MechanicPlugin } from '../../arc/plugin';
import { buildCaseDocket, supportsCaseDocket } from './build';
import type { DocketPayload } from './build';
import { CaseDocketBoard } from './CaseDocketBoard';

/**
 * Case Docket (brief §7.4): a named case comes before the bench with a stack of fact chips from
 * the notes, its own name redacted; some belong to it, some come from other cases' files. Discovery
 * files one docket ("this case" / "not this case"), untimed; pressure puts two cases side by side
 * and deals chips against a clock, each routed to the case it came from. Supports only readings
 * that name two cases with enough facts in the notes for a whole arc.
 */
export const plugin: MechanicPlugin<DocketPayload> = {
  id: 'case-docket',
  title: 'Case Docket',
  frames: ['night-court', 'autopsy-room', 'heist-debrief', 'swearing-in'],
  drills: ['Role', 'Sibling', 'Polarity'],
  supports: (reading, corpus) => supportsCaseDocket(reading, corpus),
  build: (reading, ctx) => buildCaseDocket(reading, ctx),
  Render: CaseDocketBoard,
};

export const caseDocket = plugin;
