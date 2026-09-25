import type { MechanicPlugin } from '../../arc/plugin';
import { buildBucketDrop, supportsBucketDrop } from './build';
import type { BucketPayload } from './build';
import { BucketBoard } from './BucketBoard';

/**
 * Bucket Drop (brief §7.2): cards from the reading are dealt onto a board and dropped into the
 * buckets of a classification the notes themselves draw (table columns, first-column groupings,
 * bullets under headings, labelled lists). Discovery sorts a tray untimed; pressure deals cards
 * against a clock from a second scheme.
 */
export const plugin: MechanicPlugin<BucketPayload> = {
  id: 'bucket-drop',
  title: 'Bucket Drop',
  frames: ['field-guide', 'museum-tour', 'signal-room', 'heist-debrief'],
  supports: (reading, corpus) => supportsBucketDrop(reading, corpus),
  build: (reading, ctx) => buildBucketDrop(reading, ctx),
  Render: BucketBoard,
};

export const bucketDrop = plugin;
