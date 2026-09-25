import { create } from 'zustand';
import type { GymAttempt, GymKind, GymState } from '../types';
import { getAll, putGymAttempts } from '../lib/db';
import { newId } from '../store/session';

/**
 * Progress for the Formula Gym and its sibling games (Sense Check): one SM-2 schedule per item in
 * the shared `gymState` store, and an append-only `gymAttempts` log. Every answer in any gym game
 * goes through `recordGymAnswers`, so a miss anywhere resurfaces the item sooner everywhere.
 */

export interface GymAnswer {
  itemId: string;
  kind: GymKind;
  readingId: string;
  game: string;
  correct: boolean;
  /** SM-2 quality 0–5; see `gradeFor`. */
  grade: number;
  timeTakenSeconds: number;
  sessionId: string;
  measure?: string;
}

// ---- SM-2 ----

export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
}

interface Schedule {
  repetition: number;
  interval: number;
  efactor: number;
}

/** Classic SM-2: grade ≥ 3 advances the interval (1, 6, then × EF); below 3 starts over tomorrow. */
export function sm2(prev: Schedule, grade: number): Schedule {
  const q = Math.min(5, Math.max(0, Math.round(grade)));
  const efactor = Math.max(1.3, prev.efactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  if (q < 3) return { repetition: 0, interval: 1, efactor };
  const interval = prev.repetition === 0 ? 1 : prev.repetition === 1 ? 6 : Math.max(1, Math.round(prev.interval * prev.efactor));
  return { repetition: prev.repetition + 1, interval, efactor };
}

/**
 * Grade from correctness and speed (plan §4): correct and fast = 5, correct in fair time = 4, correct but
 * slow = 3; a near miss (e.g. one slot off) = 2, otherwise 1. `fast`/`fair` are seconds, per game.
 */
export function gradeFor(correct: boolean, seconds: number, fast: number, fair: number, nearMiss = false): number {
  if (!correct) return nearMiss ? 2 : 1;
  if (seconds <= fast) return 5;
  if (seconds <= fair) return 4;
  return 3;
}

export function isDue(state: GymState | undefined, today = localDay()): boolean {
  return !!state?.dueDate && state.dueDate <= today;
}

/** Mastered = passed at least three spaced (due) reviews in a row and last answered correctly. */
export function isMastered(state: GymState | undefined): boolean {
  return !!state && state.repetition >= 3 && state.lastResult === 'correct';
}

function blankState(itemId: string, kind: GymKind, readingId: string): GymState {
  return {
    itemId,
    kind,
    readingId,
    repetition: 0,
    interval: 0,
    efactor: 2.5,
    dueDate: null,
    totalAttempts: 0,
    totalCorrect: 0,
    totalWrong: 0,
    lastResult: null,
    lastAttempted: null,
    gameCounts: {},
    recentGames: [],
  };
}

// ---- Store ----

interface GymStore {
  /** 'unavailable' when IndexedDB can't be used; answers then live only in memory. */
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  states: Record<string, GymState>;
  attempts: GymAttempt[];

  load: () => Promise<void>;
  /** Records answers (one or several items at once) and returns the updated states. */
  record: (answers: GymAnswer[]) => GymState[];
  clearAll: () => void;
}

export const useGym = create<GymStore>((set, get) => ({
  status: 'idle',
  states: {},
  attempts: [],

  load: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    try {
      const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('IndexedDB timed out')), 4000));
      const [rows, attempts] = await Promise.race([Promise.all([getAll('gymState'), getAll('gymAttempts')]), timeout]);
      const states: Record<string, GymState> = {};
      for (const r of rows) states[r.itemId] = r;
      attempts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      set({ status: 'ready', states, attempts });
    } catch (e) {
      console.warn('[gym] progress unavailable', e);
      set({ status: 'unavailable' });
    }
  },

  record: (answers) => {
    if (answers.length === 0) return [];
    const now = new Date();
    const iso = now.toISOString();
    const today = localDay(now);
    const states = { ...get().states };
    const changed = new Map<string, GymState>();
    const rows: GymAttempt[] = [];
    for (const a of answers) {
      const prev = states[a.itemId] ?? blankState(a.itemId, a.kind, a.readingId);
      const grade = Math.min(5, Math.max(0, Math.round(a.grade)));
      // Only a review that is due (or the first sighting) moves the schedule forward. A correct answer before the
      // due date (the same formula met again in another game, "Drill these again") keeps the schedule as it is,
      // so a burst of answers in one sitting can't jump the interval or mark a formula mastered. A miss always
      // starts it over.
      const early = !!prev.dueDate && prev.dueDate > today;
      const next: Schedule =
        early && grade >= 3 ? { repetition: prev.repetition, interval: prev.interval, efactor: prev.efactor } : sm2(prev, grade);
      const state: GymState = {
        ...prev,
        kind: a.kind,
        readingId: a.readingId || prev.readingId,
        ...next,
        dueDate: early && grade >= 3 ? prev.dueDate : addDays(today, next.interval),
        totalAttempts: prev.totalAttempts + 1,
        totalCorrect: prev.totalCorrect + (a.correct ? 1 : 0),
        totalWrong: prev.totalWrong + (a.correct ? 0 : 1),
        lastResult: a.correct ? 'correct' : 'wrong',
        lastAttempted: iso,
        gameCounts: { ...prev.gameCounts, [a.game]: (prev.gameCounts[a.game] ?? 0) + 1 },
        recentGames: [a.game, ...prev.recentGames.filter((g) => g !== a.game)].slice(0, 4),
      };
      states[a.itemId] = state;
      changed.set(a.itemId, state);
      const row: GymAttempt = {
        attemptId: newId('gya'),
        itemId: a.itemId,
        kind: a.kind,
        game: a.game,
        correct: a.correct,
        grade,
        timeTakenSeconds: Math.max(0, Math.round(a.timeTakenSeconds)),
        sessionId: a.sessionId,
        timestamp: iso,
      };
      if (a.measure) row.measure = a.measure;
      rows.push(row);
    }
    set({ states, attempts: [...get().attempts, ...rows] });
    const updated = [...changed.values()];
    if (get().status === 'ready') putGymAttempts(rows, updated).catch((e) => console.warn('[gym] write failed', e));
    return updated;
  },

  clearAll: () => set({ states: {}, attempts: [] }),
}));

/** Records one answer; see `useGym.record`. */
export function recordGymAnswer(answer: GymAnswer): GymState | undefined {
  return useGym.getState().record([answer])[0];
}
