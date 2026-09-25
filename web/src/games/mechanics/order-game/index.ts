import type { MechanicPlugin } from '../../arc/plugin';
import { buildOrderGame, nameAfterDiscovery, supportsOrderGame } from './build';
import type { OrderPayload } from './build';
import { OrderBoard } from './OrderBoard';

/**
 * Order Game (brief §7.2), drilling the Sequence trap: steps, stages, phases, rankings and
 * flowchart chains from the reading, each played two ways. Arrange rounds deal a whole set
 * shuffled (itemId = the sequence's block, or its first sub-item when a block holds several);
 * restore rounds deal a set in order with one step moved (itemId = that step's sub-item / row /
 * node key). Only sequences whose order the notes make meaningful are used.
 */
export const plugin: MechanicPlugin<OrderPayload> = {
  id: 'order-game',
  title: 'Order Game',
  frames: ['heist-debrief', 'autopsy-room', 'museum-tour', 'field-guide'],
  drills: ['Sequence'],
  supports: (reading, corpus) => supportsOrderGame(reading, corpus),
  build: (reading, ctx) => buildOrderGame(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: OrderBoard,
};

export const orderGame = plugin;
