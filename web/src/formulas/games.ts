import type { Formula, FormulaGame, FormulaTwin } from './types';

export interface GameInfo {
  id: FormulaGame;
  label: string;
  blurb: string;
  /** Seconds for a 5 and a 4 when answered correctly (slower = 3); see storage.gradeFor. */
  fast: number;
  fair: number;
  /** Timed sessions have a fixed format instead of a chosen length. */
  timed?: { seconds: number; rounds: number };
  /** Rotated through by Workout, one formula per round. */
  inWorkout: boolean;
}

export const GAMES: GameInfo[] = [
  { id: 'recall', label: 'Recall', blurb: 'See the name and cue, recall the formula, then grade yourself.', fast: 0, fair: 0, inWorkout: true },
  { id: 'forge', label: 'Forge', blurb: 'Rebuild the formula from tiles. Some tiles are look-alikes.', fast: 25, fair: 60, inWorkout: true },
  { id: 'rigged', label: 'Real or Rigged', blurb: 'Four versions, one right. Spot the real formula.', fast: 12, fair: 30, inWorkout: true },
  { id: 'spot', label: 'Correct or broken?', blurb: 'One version at a time. Is it right?', fast: 6, fair: 15, inWorkout: true },
  { id: 'whichway', label: 'Which Way?', blurb: 'If an input rises, which way does the result move?', fast: 8, fair: 20, inWorkout: true },
  { id: 'symbols', label: 'Symbol Match', blurb: 'Pair each symbol with what it means.', fast: 20, fair: 45, inWorkout: true },
  { id: 'calc', label: 'Quick Calc', blurb: 'Fresh numbers each time. Work out the answer.', fast: 45, fair: 120, inWorkout: true },
  { id: 'twins', label: 'Twin Split', blurb: 'Two look-alike formulas. Say which is which.', fast: 10, fair: 25, inWorkout: true },
  {
    id: 'memory',
    label: 'Memory Match',
    blurb: 'Flip cards to pair each formula with its key.',
    fast: 0,
    fair: 0,
    timed: { seconds: 90, rounds: 1 },
    inWorkout: false,
  },
  {
    id: 'repair',
    label: 'Formula Repair',
    blurb: 'One piece is broken. Drop in the right one.',
    fast: 8,
    fair: 20,
    timed: { seconds: 90, rounds: 6 },
    inWorkout: true,
  },
  {
    id: 'auction',
    label: 'Variable Auction',
    blurb: 'Name the highlighted variable. Every right answer raises your bid.',
    fast: 8,
    fair: 20,
    timed: { seconds: 120, rounds: 8 },
    inWorkout: true,
  },
];

export const GAME_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g])) as Record<FormulaGame, GameInfo>;

export const MEMORY_PAIRS = 8;
export const AUCTION_START_BID = 10;

/** A deck-wide view the eligibility checks need beyond the card itself. */
export interface DeckIndex {
  byId: Record<string, Formula>;
  twinsOf: Record<string, FormulaTwin[]>;
  /** Formula ids per reading and per area, for distractors drawn from neighbours. */
  byReading: Record<string, string[]>;
  byArea: Record<string, string[]>;
}

export function buildIndex(formulas: Formula[], byId: Record<string, Formula>, twinsOf: Record<string, FormulaTwin[]>): DeckIndex {
  const byReading: Record<string, string[]> = {};
  const byArea: Record<string, string[]> = {};
  for (const f of formulas) {
    (byReading[f.readingId] ??= []).push(f.id);
    (byArea[f.area] ??= []).push(f.id);
  }
  return { byId, twinsOf, byReading, byArea };
}

/** Whether a formula has the data a game needs (Quick Calc needs `calc`, Twin Split a twin, …). */
export function canPlay(game: FormulaGame, f: Formula, index: DeckIndex, opts: { numbers?: boolean } = {}): boolean {
  switch (game) {
    case 'recall':
      return true;
    case 'forge':
      return f.skeleton !== '' && f.slots.length + f.decoys.length >= 2;
    case 'rigged':
    case 'spot':
      return f.corruptions.length > 0;
    case 'whichway':
      return f.sensitivities.length > 0;
    case 'symbols':
      return f.variables.length >= 3;
    case 'calc':
      return f.calc !== null;
    case 'twins':
      return (index.twinsOf[f.id] ?? []).some((t) => index.byId[t.a] && index.byId[t.b]);
    case 'memory':
      return opts.numbers ? f.worked.length > 0 || !!f.calc?.example : f.variables.length > 0;
    case 'repair':
      return f.corruptions.some((c) => c.repair) || (f.skeleton !== '' && f.decoys.length > 0);
    case 'auction':
      return f.variables.length > 0 && hasAuctionDistractors(f, index);
  }
}

function hasAuctionDistractors(f: Formula, index: DeckIndex): boolean {
  const own = new Set(f.variables.map((v) => v.meaning.toLowerCase()));
  const meanings = new Set<string>();
  for (const id of index.byArea[f.area] ?? []) {
    if (id === f.id) continue;
    for (const v of index.byId[id]?.variables ?? []) {
      const m = v.meaning.toLowerCase();
      if (!own.has(m)) meanings.add(m);
    }
    if (meanings.size >= 3) return true;
  }
  return false;
}
