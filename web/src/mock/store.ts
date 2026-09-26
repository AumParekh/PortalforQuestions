import { create } from 'zustand';
import type { MockResult, OptionKey } from '../types';
import { getAll, putMany } from '../lib/db';
import { newId } from '../store/session';
import type { MockAttempt } from './model';

/**
 * Mock exam state: attempts in progress (localStorage, one per mock, written synchronously on every change so a reload
 * or a closed tab loses nothing) and submitted results (IndexedDB store "mockResults", included in progress export).
 */

const ATTEMPTS_KEY = 'frm.mockAttempts.v1';

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const OPTION_KEYS: readonly string[] = ['a', 'b', 'c', 'd', 'e'];

/** A saved attempt read defensively; null when it can't be resumed. */
function parseAttempt(v: unknown): MockAttempt | null {
  if (!isRec(v) || typeof v.attemptId !== 'string' || typeof v.slug !== 'string') return null;
  if (typeof v.startedAt !== 'number' || !Number.isFinite(v.startedAt)) return null;
  if (typeof v.timeLimitMinutes !== 'number' || !(v.timeLimitMinutes > 0)) return null;
  if (!Array.isArray(v.questionIds) || v.questionIds.length === 0) return null;
  const questionIds = v.questionIds.filter((id): id is string => typeof id === 'string');
  const answers: Record<string, OptionKey> = {};
  if (isRec(v.answers)) for (const [id, k] of Object.entries(v.answers)) if (typeof k === 'string' && OPTION_KEYS.includes(k)) answers[id] = k as OptionKey;
  const flags: Record<string, true> = {};
  if (isRec(v.flags)) for (const [id, f] of Object.entries(v.flags)) if (f === true) flags[id] = true;
  const times: Record<string, number> = {};
  if (isRec(v.times)) for (const [id, t] of Object.entries(v.times)) if (typeof t === 'number' && Number.isFinite(t) && t >= 0) times[id] = t;
  const index = typeof v.currentIndex === 'number' && Number.isInteger(v.currentIndex) ? v.currentIndex : 0;
  return {
    attemptId: v.attemptId,
    slug: v.slug,
    startedAt: v.startedAt,
    timeLimitMinutes: v.timeLimitMinutes,
    questionIds,
    answers,
    flags,
    times,
    currentIndex: Math.min(Math.max(0, index), questionIds.length - 1),
  };
}

/** Saved attempts by slug; null when localStorage can't be read (private mode, blocked storage). */
function readAttempts(): Record<string, MockAttempt> | null {
  try {
    const raw = window.localStorage.getItem(ATTEMPTS_KEY);
    const out: Record<string, MockAttempt> = {};
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (isRec(parsed)) {
      for (const v of Object.values(parsed)) {
        const a = parseAttempt(v);
        if (a) out[a.slug] = a;
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** False once a write has failed: storage then lags memory and can't be trusted to say what is still open. */
let writable = true;

function writeAttempts(attempts: Record<string, MockAttempt>) {
  try {
    if (Object.keys(attempts).length === 0) window.localStorage.removeItem(ATTEMPTS_KEY);
    else window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
  } catch {
    // Storage blocked or full: the attempt still runs in memory, it just won't survive a reload.
    writable = false;
  }
}

function warn(e: unknown) {
  console.warn('[mock] write failed', e);
}

function byTime(a: MockResult, b: MockResult): number {
  return a.submittedAt.localeCompare(b.submittedAt);
}

interface MockStore {
  /** Loading state of the result history; 'unavailable' when IndexedDB can't be opened (results then last this visit only). */
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  /** Attempts in progress, by mock slug. */
  attempts: Record<string, MockAttempt>;
  /** Submitted results, oldest first. */
  results: MockResult[];

  load: () => Promise<void>;
  begin: (slug: string, questionIds: string[], timeLimitMinutes: number) => MockAttempt;
  select: (slug: string, questionId: string, key: OptionKey) => void;
  toggleFlag: (slug: string, questionId: string) => void;
  goTo: (slug: string, index: number) => void;
  addTime: (slug: string, questionId: string, ms: number) => void;
  discard: (slug: string) => void;
  /**
   * Removes the attempt from progress and returns its latest saved state, or null when there is none: already
   * submitted (possibly in another tab) or discarded. Submitting goes through this so an attempt is scored once.
   */
  take: (slug: string) => MockAttempt | null;
  addResult: (r: MockResult) => void;
  clearAll: () => void;
}

export const useMock = create<MockStore>((set, get) => {
  const update = (slug: string, change: (a: MockAttempt) => MockAttempt | null) => {
    const cur = get().attempts[slug];
    if (!cur) return;
    const next = change(cur);
    if (!next || next === cur) return;
    const attempts = { ...get().attempts, [slug]: next };
    set({ attempts });
    writeAttempts(attempts);
  };

  return {
    status: 'idle',
    attempts: {},
    results: [],

    load: async () => {
      if (get().status !== 'idle') return;
      set({ status: 'loading', attempts: readAttempts() ?? {} });
      // Another tab answering, flagging or submitting: follow it, so neither tab overwrites the other's answers.
      window.addEventListener('storage', (e) => {
        if (e.key !== ATTEMPTS_KEY && e.key !== null) return;
        const attempts = readAttempts();
        if (attempts) set({ attempts });
      });
      try {
        const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('IndexedDB timed out')), 4000));
        const rows = await Promise.race([getAll('mockResults'), timeout]);
        // Results added this visit before the load finished are kept.
        const known = new Set(rows.map((r) => r.resultId));
        set({ status: 'ready', results: [...rows, ...get().results.filter((r) => !known.has(r.resultId))].sort(byTime) });
      } catch (e) {
        console.warn('[mock] IndexedDB unavailable, mock results will not be saved', e);
        set({ status: 'unavailable' });
      }
    },

    begin: (slug, questionIds, timeLimitMinutes) => {
      const attempt: MockAttempt = {
        attemptId: newId('mock'),
        slug,
        startedAt: Date.now(),
        timeLimitMinutes,
        questionIds: [...questionIds],
        answers: {},
        flags: {},
        times: {},
        currentIndex: 0,
      };
      const attempts = { ...get().attempts, [slug]: attempt };
      set({ attempts });
      writeAttempts(attempts);
      return attempt;
    },

    select: (slug, questionId, key) =>
      update(slug, (a) => (a.answers[questionId] === key ? a : { ...a, answers: { ...a.answers, [questionId]: key } })),

    toggleFlag: (slug, questionId) =>
      update(slug, (a) => {
        const flags = { ...a.flags };
        if (flags[questionId]) delete flags[questionId];
        else flags[questionId] = true;
        return { ...a, flags };
      }),

    goTo: (slug, index) =>
      update(slug, (a) => (index === a.currentIndex || index < 0 || index >= a.questionIds.length ? a : { ...a, currentIndex: index })),

    addTime: (slug, questionId, ms) =>
      update(slug, (a) => (ms > 0 ? { ...a, times: { ...a.times, [questionId]: (a.times[questionId] ?? 0) + ms } } : a)),

    discard: (slug) => {
      const attempts = { ...get().attempts };
      delete attempts[slug];
      set({ attempts });
      writeAttempts(attempts);
    },

    take: (slug) => {
      const mine = get().attempts[slug];
      // localStorage is shared and synchronous across tabs, so it is the authority on whether this is still open.
      const saved = writable ? readAttempts() : null;
      const latest = saved ? saved[slug] : mine;
      if (!mine || !latest || latest.attemptId !== mine.attemptId) {
        if (saved) set({ attempts: saved });
        return null;
      }
      const attempts = { ...(saved ?? get().attempts) };
      delete attempts[slug];
      set({ attempts });
      writeAttempts(attempts);
      return latest;
    },

    addResult: (r) => {
      set({ results: [...get().results.filter((x) => x.resultId !== r.resultId), r].sort(byTime) });
      if (get().status === 'ready') putMany('mockResults', [r]).catch(warn);
    },

    clearAll: () => {
      set({ attempts: {}, results: [] });
      writeAttempts({});
    },
  };
});

/** Results for one mock, newest first. */
export function resultsFor(results: MockResult[], slug: string): MockResult[] {
  return results.filter((r) => r.slug === slug).reverse();
}
