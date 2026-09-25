import type { MechanicPlugin } from '../../arc/plugin';
import { buildFrameworkNavigator, nameAfterDiscovery, supportsFrameworkNavigator } from './build';
import type { FnPayload } from './build';
import { FrameworkBoard } from './FrameworkBoard';

/**
 * Framework Navigator (PORTAL_PLAN §3c visual mechanics): the regulatory frameworks in the notes as
 * one navigable tree, one lane per lineage. Open a node to see what it introduced, restricted and
 * was responding to; place a change on its node; compare two neighbours. Data:
 * content/games/mechanics/framework-navigator.json → corpus.extras['framework-navigator'].
 */
export const plugin: MechanicPlugin<FnPayload> = {
  id: 'framework-navigator',
  title: 'Framework Navigator',
  frames: ['museum-tour', 'field-guide', 'heist-debrief', 'signal-room'],
  drills: ['Sibling'],
  supports: (reading, corpus) => supportsFrameworkNavigator(reading, corpus),
  build: (reading, ctx) => buildFrameworkNavigator(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: FrameworkBoard,
};

export const frameworkNavigator = plugin;
