import type { MechanicPlugin } from '../../arc/plugin';
import { buildGrid, nameAfterDiscovery, supportsGrid } from './build';
import type { GsPayload } from './build';
import { GridBoard } from './GridBoard';

/**
 * Grid Settler: a two-axis classification grid from the notes (frequency × severity, a comparison
 * table's columns × rows, …) and a tray of tiles. Right placements lock; wrong ones bounce back
 * while the right cell pulses; the pattern the notes draw from the grid appears once it is full.
 * Data: content/games/mechanics/grid-settler.json.
 */
export const plugin: MechanicPlugin<GsPayload> = {
  id: 'grid-settler',
  title: 'Grid Settler',
  frames: ['field-guide', 'museum-tour', 'autopsy-room', 'signal-room'],
  drills: ['Sibling', 'Scope'],
  supports: (reading, corpus) => supportsGrid(reading, corpus),
  build: (reading, ctx) => buildGrid(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: GridBoard,
};

export const gridSettler = plugin;
