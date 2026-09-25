import { create } from 'zustand';
import { newId } from '../store/session';
import { AUCTION_START_BID } from './games';
import type { PlannedSession, SessionMode } from './plan';
import type { Round } from './rounds';
import type { FormulaGame } from './types';

export interface RoundResult {
  key: string;
  game: FormulaGame;
  /** Per-formula outcome as logged (Twin Split covers two formulas, Memory Match up to eight). */
  items: { id: string; correct: boolean }[];
  correct: boolean;
  seconds: number;
}

export interface GymRun {
  sessionId: string;
  mode: SessionMode;
  rounds: Round[];
  index: number;
  results: RoundResult[];
  /** Seconds for timed games; the clock runs from `startedAt` (Date.now()). */
  timeLimit: number | null;
  startedAt: number;
  /** Variable Auction's bid; null in every other mode. */
  bid: number | null;
  /** True when the clock ran out before the last round. */
  timedOut: boolean;
}

interface RunStore {
  phase: 'setup' | 'play' | 'summary' | 'sheet';
  run: GymRun | null;
  start: (session: PlannedSession) => void;
  /** Records the current round's result; ignored if it was already answered. */
  answer: (result: RoundResult) => void;
  next: () => void;
  /** Ends the session now (clock ran out, or leaving a timed game early). */
  finish: (timedOut?: boolean) => void;
  toSetup: () => void;
  openSheet: () => void;
}

// Lives outside the screen so a session survives leaving the Formula Gym route and coming back.
export const useGymRun = create<RunStore>((set, get) => ({
  phase: 'setup',
  run: null,

  start: (session) => {
    if (session.rounds.length === 0) return;
    set({
      phase: 'play',
      run: {
        sessionId: newId('fgs'),
        mode: session.mode,
        rounds: session.rounds,
        index: 0,
        results: [],
        timeLimit: session.timeLimit,
        startedAt: Date.now(),
        bid: session.mode === 'auction' ? AUCTION_START_BID : null,
        timedOut: false,
      },
    });
  },

  answer: (result) => {
    const run = get().run;
    if (!run || run.results.length !== run.index || run.rounds[run.index]?.key !== result.key) return;
    const bid = run.bid === null ? null : run.bid + (result.correct ? 1 : -1);
    set({ run: { ...run, results: [...run.results, result], bid } });
  },

  next: () => {
    const run = get().run;
    if (!run || run.results.length <= run.index) return;
    if (run.index + 1 >= run.rounds.length) set({ phase: 'summary' });
    else set({ run: { ...run, index: run.index + 1 } });
  },

  finish: (timedOut = false) => {
    const run = get().run;
    if (!run) return;
    set({ phase: 'summary', run: { ...run, timedOut } });
  },

  toSetup: () => set({ phase: 'setup', run: null }),
  openSheet: () => set({ phase: 'sheet', run: null }),
}));
