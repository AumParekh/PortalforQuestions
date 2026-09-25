import { create } from 'zustand';
import { newId } from '../../store/session';

export interface TfResult {
  cardId: string;
  answeredTrue: boolean;
  correct: boolean;
  seconds: number;
}

export interface TfRun {
  sessionId: string;
  ids: string[];
  index: number;
  results: TfResult[];
}

interface RunStore {
  phase: 'setup' | 'play' | 'summary';
  run: TfRun | null;
  start: (ids: string[]) => void;
  /** Records the answer for the current card; ignored if it was already answered. */
  answer: (result: TfResult) => void;
  next: () => void;
  toSetup: () => void;
}

// Lives outside the screen so a deck survives a detour to "Open the full question" and back.
export const useTfRun = create<RunStore>((set, get) => ({
  phase: 'setup',
  run: null,

  start: (ids) => {
    if (ids.length === 0) return;
    set({ phase: 'play', run: { sessionId: newId('tfs'), ids, index: 0, results: [] } });
  },

  answer: (result) => {
    const run = get().run;
    if (!run || run.results.length !== run.index || run.ids[run.index] !== result.cardId) return;
    set({ run: { ...run, results: [...run.results, result] } });
  },

  next: () => {
    const run = get().run;
    if (!run || run.results.length <= run.index) return;
    if (run.index + 1 >= run.ids.length) set({ phase: 'summary' });
    else set({ run: { ...run, index: run.index + 1 } });
  },

  toSetup: () => set({ phase: 'setup', run: null }),
}));
