import { create } from 'zustand';
import type { AnswerRecord, CellStatus, OptionKey, SessionConfig } from '../types';

interface SessionState {
  status: 'idle' | 'active' | 'finished';
  config: SessionConfig | null;
  /** Question ids in the order they will be presented. Skip may reorder or shrink this. */
  queue: string[];
  currentIndex: number;
  answers: Record<string, AnswerRecord>;
  skipped: Record<string, true>;
  marked: Record<string, true>;
  startedAt: string | null;
  endedAt: string | null;

  start: (config: SessionConfig, queue: string[]) => void;
  answer: (id: string, selected: OptionKey | '', correct: boolean, timeTakenSeconds: number, timedOut?: boolean) => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  jumpTo: (index: number) => void;
  toggleMark: (id: string) => void;
  finish: () => void;
  reset: () => void;
}

const empty = {
  status: 'idle' as const,
  config: null,
  queue: [],
  currentIndex: 0,
  answers: {},
  skipped: {},
  marked: {},
  startedAt: null,
  endedAt: null,
};

export const useSession = create<SessionState>((set, get) => ({
  ...empty,

  start: (config, queue) =>
    set({ ...empty, status: 'active', config, queue, startedAt: new Date().toISOString() }),

  answer: (id, selected, correct, timeTakenSeconds, timedOut = false) => {
    if (get().answers[id]) return;
    const skipped = { ...get().skipped };
    delete skipped[id];
    set({ answers: { ...get().answers, [id]: { selected, correct, timeTakenSeconds, timedOut } }, skipped });
  },

  next: () => {
    const { currentIndex, queue } = get();
    if (currentIndex < queue.length - 1) set({ currentIndex: currentIndex + 1 });
  },

  prev: () => {
    const { currentIndex } = get();
    if (currentIndex > 0) set({ currentIndex: currentIndex - 1 });
  },

  // Default: requeue the current question at the end. With config.skipDrops: remove it from the session.
  skip: () => {
    const { queue, currentIndex, config, answers } = get();
    const id = queue[currentIndex];
    if (!id || answers[id]) return;
    if (config?.skipDrops) {
      const nextQueue = queue.filter((_, i) => i !== currentIndex);
      set({ queue: nextQueue, currentIndex: Math.min(currentIndex, Math.max(nextQueue.length - 1, 0)) });
      return;
    }
    const skipped = { ...get().skipped, [id]: true as const };
    if (currentIndex === queue.length - 1) {
      set({ skipped });
      return;
    }
    const nextQueue = [...queue.slice(0, currentIndex), ...queue.slice(currentIndex + 1), id];
    set({ queue: nextQueue, skipped });
  },

  jumpTo: (index) => {
    const { queue } = get();
    if (index >= 0 && index < queue.length) set({ currentIndex: index });
  },

  toggleMark: (id) => {
    const marked = { ...get().marked };
    if (marked[id]) delete marked[id];
    else marked[id] = true;
    set({ marked });
  },

  finish: () => set({ status: 'finished', endedAt: new Date().toISOString() }),

  reset: () => set({ ...empty }),
}));

/** Jump-drawer colour for a queue cell. Precedence: current > marked > answered > skipped > unseen. */
export function cellStatus(
  s: Pick<SessionState, 'queue' | 'currentIndex' | 'answers' | 'skipped' | 'marked'>,
  index: number,
): CellStatus {
  const id = s.queue[index];
  if (index === s.currentIndex) return 'current';
  if (s.marked[id]) return 'marked';
  const a = s.answers[id];
  if (a) return a.correct ? 'correct' : 'wrong';
  if (s.skipped[id]) return 'skipped';
  return 'unseen';
}
