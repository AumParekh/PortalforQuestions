import type { MechanicPlugin } from '../../arc/plugin';
import { buildStepwise, nameAfterDiscovery, supportsStepwise } from './build';
import type { StepPayload } from './build';
import { StepwiseBoard } from './StepwiseBoard';

/**
 * Stepwise Derivation (brief §7.4): a worked example with steps held back; the player chooses the
 * next move from three, and each choice shows where it leads in the notes.
 */
export const plugin: MechanicPlugin<StepPayload> = {
  id: 'stepwise-derivation',
  title: 'Stepwise Derivation',
  frames: ['autopsy-room', 'heist-debrief', 'museum-tour', 'forecast-desk', 'field-guide'],
  drills: ['Formula', 'Intermediate result', 'Sequence'],
  supports: (reading, corpus) => supportsStepwise(reading, corpus),
  build: (reading, ctx) => buildStepwise(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(plan, discovery, reading, corpus),
  Render: StepwiseBoard,
};

export const stepwiseDerivation = plugin;
