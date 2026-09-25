import type { MechanicPlugin } from '../../arc/plugin';
import { buildTreeRacer, nameAfterDiscovery, supportsTreeRacer } from './build';
import type { TreePayload } from './build';
import { TreeBoard } from './TreeBoard';

/**
 * Tree Racer (PORTAL_PLAN §3c visual mechanics): a recombining rate or price tree raced node by
 * node. Three candidate values per node, the wrong two built from real mistakes; a wrong pick
 * grows a phantom branch that fails to rejoin the tree. Data: curated
 * content/games/mechanics/tree-racer.json via corpus.extras['tree-racer'].
 */
export const plugin: MechanicPlugin<TreePayload> = {
  id: 'tree-racer',
  title: 'Tree Racer',
  frames: ['forecast-desk', 'heist-debrief', 'autopsy-room', 'museum-tour'],
  drills: ['Formula', 'Intermediate result'],
  supports: (reading, corpus) => supportsTreeRacer(reading, corpus),
  build: (reading, ctx) => buildTreeRacer(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: TreeBoard,
};

export const treeRacer = plugin;
