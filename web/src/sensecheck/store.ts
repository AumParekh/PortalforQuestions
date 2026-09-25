import { create } from 'zustand';
import { newId } from '../store/session';
import { gradeFor, recordGymAnswer } from '../formulas/storage';
import { parseSenseDeck } from './parse';
import { EMPTY_HISTORY, SESSION_SECONDS, parseHistory, withSession } from './rotation';
import type { SenseHistory, SessionPlan } from './rotation';
import type { Scenario, SenseMode } from './types';

export const SENSE_PATH = 'games/sensecheck.json';
export const SENSE_GAME = 'sense-check';
const HISTORY_KEY = 'frm.senseCheck.v1';
/** Grade speed bands (seconds): a quick call is the skill being trained. */
const FAST_SECONDS = 8;
const FAIR_SECONDS = 20;

// ---- Deck ----

interface DeckStore {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  scenarios: Scenario[];
  load: () => Promise<void>;
  retry: () => void;
}

export const useSenseDeck = create<DeckStore>((set, get) => ({
  status: 'idle',
  error: null,
  scenarios: [],
  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null });
    try {
      const manifest: unknown = await fetch('/content/manifest.json').then((r) => {
        if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
        return r.json();
      });
      let scenarios: Scenario[] = [];
      // Not generated yet → an empty deck, which the screen shows as "being prepared".
      if (Array.isArray(manifest) && manifest.includes(SENSE_PATH)) {
        const r = await fetch(`/content/${SENSE_PATH}`);
        if (!r.ok) throw new Error(`${SENSE_PATH}: HTTP ${r.status}`);
        scenarios = parseSenseDeck(await r.json());
      }
      set({ status: 'ready', scenarios });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
  retry: () => {
    set({ status: 'idle' });
    void get().load();
  },
}));

// ---- Rotation history (localStorage; best effort) ----

export function loadHistory(): SenseHistory {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? parseHistory(JSON.parse(raw)) : EMPTY_HISTORY;
  } catch {
    return EMPTY_HISTORY;
  }
}

function saveHistory(history: SenseHistory) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Private mode or storage full: rotation just restarts next time.
  }
}

// ---- Running session ----

export interface SenseResult {
  scenarioId: string;
  mode: SenseMode;
  /** Index of the chosen option. */
  chosen: number;
  correct: boolean;
  seconds: number;
}

export interface SenseRun {
  sessionId: string;
  plan: SessionPlan;
  index: number;
  results: SenseResult[];
  /** Session clock. It runs only while a round is waiting for an answer; reading the working is free. */
  usedMs: number;
  runningSince: number | null;
  roundStartedAt: number;
  timedOut: boolean;
}

export function remainingMs(run: SenseRun, now: number): number {
  const used = run.usedMs + (run.runningSince !== null ? now - run.runningSince : 0);
  return Math.max(0, SESSION_SECONDS * 1000 - used);
}

interface RunStore {
  phase: 'intro' | 'play' | 'summary';
  run: SenseRun | null;
  start: (plan: SessionPlan) => void;
  /** Answers the current round with option `chosen`; ignored once answered or after time is up. */
  answer: (chosen: number) => void;
  next: () => void;
  /** Ends the session now (clock ran out, or leaving early). */
  finish: (timedOut: boolean) => void;
  toIntro: () => void;
}

// Module-level so a session survives leaving the route and coming back.
export const useSenseRun = create<RunStore>((set, get) => ({
  phase: 'intro',
  run: null,

  start: (plan) => {
    if (plan.rounds.length === 0) return;
    const now = Date.now();
    set({
      phase: 'play',
      run: { sessionId: newId('scs'), plan, index: 0, results: [], usedMs: 0, runningSince: now, roundStartedAt: now, timedOut: false },
    });
  },

  answer: (chosen) => {
    const run = get().run;
    if (!run || run.results.length !== run.index || run.runningSince === null) return;
    const now = Date.now();
    if (remainingMs(run, now) <= 0) return;
    const scenario = run.plan.rounds[run.index];
    const option = scenario?.options[chosen];
    if (!scenario || !option) return;
    // The session enters the rotation history once it is really played, so an accidental Start doesn't use up a reading.
    if (run.results.length === 0) {
      const { plan } = run;
      saveHistory(withSession(loadHistory(), { n: plan.n, at: new Date(now).toISOString(), featured: plan.featured, readings: plan.readings, area: plan.area }));
    }
    const seconds = (now - run.roundStartedAt) / 1000;
    const result: SenseResult = { scenarioId: scenario.id, mode: scenario.mode, chosen, correct: option.correct, seconds };
    set({ run: { ...run, results: [...run.results, result], usedMs: run.usedMs + (now - run.runningSince), runningSince: null } });
    recordGymAnswer({
      itemId: scenario.id,
      kind: 'scenario',
      readingId: scenario.readingId ?? scenario.reading,
      game: SENSE_GAME,
      correct: option.correct,
      grade: gradeFor(option.correct, seconds, FAST_SECONDS, FAIR_SECONDS),
      timeTakenSeconds: seconds,
      sessionId: run.sessionId,
      measure: scenario.mode,
    });
  },

  next: () => {
    const run = get().run;
    if (!run || run.results.length <= run.index) return;
    const now = Date.now();
    if (run.index + 1 >= run.plan.rounds.length || remainingMs(run, now) <= 0) {
      set({ phase: 'summary' });
      return;
    }
    set({ run: { ...run, index: run.index + 1, runningSince: now, roundStartedAt: now } });
  },

  finish: (timedOut) => {
    const run = get().run;
    if (!run) return;
    set({ phase: 'summary', run: { ...run, timedOut, runningSince: null } });
  },

  toIntro: () => set({ phase: 'intro', run: null }),
}));
