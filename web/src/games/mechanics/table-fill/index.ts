import type { MechanicPlugin } from '../../arc/plugin';
import { buildTableFill, nameAfterDiscovery, supportsTableFill } from './build';
import type { TableFillPayload } from './build';
import { TableFillBoard } from './TableFillBoard';

/**
 * Table Fill (brief §7.2): a table from the reading with cells lifted out; the player puts each
 * loose cell back (tap a blank then a tile, or drag). One round per table row (itemId = row ID).
 * Pressure sheets take out a whole column and a second cell per row, on one timer per table.
 */
export const plugin: MechanicPlugin<TableFillPayload> = {
  id: 'table-fill',
  title: 'Table Fill',
  frames: ['museum-tour', 'field-guide', 'heist-debrief', 'autopsy-room', 'signal-room'],
  supports: (reading, corpus) => supportsTableFill(reading, corpus),
  build: (reading, ctx) => buildTableFill(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: TableFillBoard,
};

export const tableFill = plugin;
