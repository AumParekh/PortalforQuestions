import type { MechanicPlugin } from '../../arc/plugin';
import { buildThreshold, nameAfterDiscovery, supportsThreshold } from './build';
import type { SliderPayload } from './build';
import { ThresholdBoard } from './ThresholdBoard';

/**
 * Threshold Slider (brief §7.2): numbers from the notes (thresholds, ratios, percentages, limits,
 * horizons, multipliers, dates) are cut out of their sentences, and the player sets a scale to
 * where the notes draw the line. Discovery shows the whole sentence with the number blanked;
 * pressure shows only a short cue against a clock. Exact on the notes' own precision; numbers the
 * notes give as approximate ("about 70%") accept ±10%.
 */
export const plugin: MechanicPlugin<SliderPayload> = {
  id: 'threshold-slider',
  title: 'Threshold Slider',
  frames: ['forecast-desk', 'museum-tour', 'field-guide', 'signal-room', 'swearing-in'],
  supports: (reading) => supportsThreshold(reading),
  build: (reading, ctx) => buildThreshold(reading, ctx),
  name: (plan, discovery, { reading, corpus }) => nameAfterDiscovery(corpus, reading, plan, discovery),
  Render: ThresholdBoard,
};

export const thresholdSlider = plugin;
