// Narrative frames (brief §10.4): a title card, one line of context, a closing card.
import type { FrameId } from '../types';

export interface NarrativeFrame {
  id: FrameId;
  title: string;
  /** One line of context on the title card. */
  line: string;
  /** The closing card. */
  close: string;
}

export const FRAMES: readonly NarrativeFrame[] = [
  {
    id: 'museum-tour',
    title: 'Museum tour',
    line: 'A quiet gallery. Each exhibit is a piece of the reading; look closely before you move on.',
    close: 'The gallery closes. What you examined is in the catalogue below.',
  },
  {
    id: 'night-court',
    title: 'Night court',
    line: 'The bench sits late. Each item comes before you on the record, and you rule on it.',
    close: 'Court is adjourned. The rulings stand as entered below.',
  },
  {
    id: 'autopsy-room',
    title: 'Autopsy room',
    line: 'Something on the table failed. Open it up and find exactly where.',
    close: 'The report is filed. Findings below.',
  },
  {
    id: 'heist-debrief',
    title: 'Heist debrief',
    line: 'The job is over. Reconstruct what happened, move by move.',
    close: 'Debrief closed. The reconstruction is on file below.',
  },
  {
    id: 'swearing-in',
    title: 'Swearing-in',
    line: 'You have taken the oath. Every answer from here is on the record.',
    close: 'The record is sealed. Your testimony is summarised below.',
  },
  {
    id: 'forecast-desk',
    title: 'Forecast desk',
    line: 'The desk is yours for the session. Call each one before the screen moves on.',
    close: 'Desk closed for the day. The calls are logged below.',
  },
  {
    id: 'signal-room',
    title: 'Signal room',
    line: 'Intercepts are coming in. Read each one and say what it really says.',
    close: 'Transmission ends. The decoded traffic is below.',
  },
  {
    id: 'field-guide',
    title: 'Field guide',
    line: 'Out in the field with a notebook. Identify each specimen as it shows itself.',
    close: 'Notebook closed. The specimens you identified are listed below.',
  },
];

export function frameById(id: FrameId): NarrativeFrame {
  return FRAMES.find((f) => f.id === id) ?? FRAMES[0];
}

/**
 * Picks a frame that was not used last time: from the mechanic's preferred frames if given,
 * choosing the one used least recently.
 */
export function pickFrame(recentFrames: readonly FrameId[], preferred?: readonly FrameId[]): NarrativeFrame {
  const pool = (preferred && preferred.length > 0 ? preferred : FRAMES.map((f) => f.id)).filter(
    (id) => id !== recentFrames[recentFrames.length - 1],
  );
  const candidates = pool.length > 0 ? pool : FRAMES.map((f) => f.id).filter((id) => id !== recentFrames[recentFrames.length - 1]);
  const lastUse = (id: FrameId) => recentFrames.lastIndexOf(id);
  const best = [...candidates].sort((a, b) => lastUse(a) - lastUse(b))[0];
  return frameById(best);
}
