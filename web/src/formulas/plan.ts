// Session planning: which formulas a session drills (due and weak first) and, for Workout, which game
// each one is met in (one it has data for and hasn't been drilled in lately).
import type { GymState } from '../types';
import { GAMES, GAME_BY_ID, canPlay } from './games';
import type { DeckIndex } from './games';
import { shuffle } from './random';
import { buildMemory, buildRound } from './rounds';
import type { Round } from './rounds';
import { isDue, localDay } from './storage';
import { effectiveDue } from '../games/examDate';
import type { Formula, FormulaGame } from './types';

export type SessionMode = FormulaGame | 'workout';
export type SessionSize = 10 | 20 | 'all';

const WORKOUT_GAMES = GAMES.filter((g) => g.inWorkout).map((g) => g.id) as Exclude<FormulaGame, 'memory'>[];

/**
 * Priority for a session: due (most overdue first), then weak (last answer wrong, or under 60% right),
 * then never seen, then the rest by accuracy. Ties shuffle, so repeated sessions don't replay one order.
 */
export function prioritise(formulas: Formula[], states: Record<string, GymState>, today = localDay()): Formula[] {
  const rank = (f: Formula): [number, string, number] => {
    const s = states[f.id];
    if (!s || s.totalAttempts === 0) return [2, '', 0];
    const accuracy = s.totalCorrect / Math.max(1, s.totalAttempts);
    // Sorted by the day it counts as due (an older schedule past exam − 2 counts as due on exam − 2).
    if (isDue(s, today)) return [0, s.dueDate ? effectiveDue(s.dueDate, s.interval, today) : '', accuracy];
    if (s.lastResult === 'wrong' || accuracy < 0.6) return [1, s.dueDate ?? '', accuracy];
    return [3, s.dueDate ?? '', accuracy];
  };
  const keyed = shuffle(formulas).map((f) => ({ f, r: rank(f) }));
  keyed.sort((a, b) => a.r[0] - b.r[0] || a.r[1].localeCompare(b.r[1]) || a.r[2] - b.r[2]);
  return keyed.map((k) => k.f);
}

function take<T>(items: T[], size: SessionSize | number): T[] {
  return size === 'all' ? items : items.slice(0, size);
}

// Games that show or rebuild the whole formula: a slight preference when a formula is met for the first time.
const FIRST_MEETING = new Set<FormulaGame>(['recall', 'forge', 'symbols', 'rigged']);

/** Workout's games for one formula, best first: ones it has data for and hasn't met lately, varied across the session. */
function workoutGame(f: Formula, state: GymState | undefined, index: DeckIndex, planned: Map<string, number>): Exclude<FormulaGame, 'memory'>[] {
  const options = WORKOUT_GAMES.filter((g) => canPlay(g, f, index));
  const fresh = !state || state.totalAttempts === 0;
  const scored = options.map((g) => {
    const recent = state ? state.recentGames.indexOf(g) : -1;
    const score =
      (recent >= 0 ? 10 - 2 * recent : 0) + // recently drilled in this game: avoid
      (state?.gameCounts[g] ?? 0) * 0.5 + // lifetime balance across games
      (planned.get(g) ?? 0) * 0.8 + // variety within this session
      (fresh && FIRST_MEETING.has(g) ? -0.5 : 0) +
      Math.random() * 0.6;
    return { g, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return [...scored.map((s) => s.g), 'recall'];
}

export interface PlannedSession {
  mode: SessionMode;
  rounds: Round[];
  /** Seconds, for timed games. */
  timeLimit: number | null;
}

/**
 * Builds a session over `scope`. Returns null when nothing in scope can be played in that mode.
 * `numbers` switches Memory Match to worked-number partner cards.
 */
export function planSession(
  mode: SessionMode,
  scope: Formula[],
  states: Record<string, GymState>,
  index: DeckIndex,
  opts: { size: SessionSize; numbers?: boolean },
): PlannedSession | null {
  const ordered = prioritise(scope, states);

  if (mode === 'memory') {
    const round = buildMemory(ordered, index, !!opts.numbers);
    return round ? { mode, rounds: [round], timeLimit: GAME_BY_ID.memory.timed!.seconds } : null;
  }

  if (mode === 'workout') {
    const picked = take(ordered, opts.size);
    const planned = new Map<string, number>();
    const rounds: Round[] = [];
    for (const f of shuffle(picked)) {
      for (const g of workoutGame(f, states[f.id], index, planned)) {
        const r = buildRound(g, f, index);
        if (!r) continue;
        rounds.push(r);
        planned.set(g, (planned.get(g) ?? 0) + 1);
        break;
      }
    }
    return rounds.length > 0 ? { mode, rounds, timeLimit: null } : null;
  }

  const info = GAME_BY_ID[mode];
  const eligible = ordered.filter((f) => canPlay(mode, f, index));
  const count = info.timed ? info.timed.rounds : opts.size;
  const rounds: Round[] = [];
  // Twin Split meets each pair once per session.
  const usedPairs = new Set<string>();
  for (const f of eligible) {
    if (count !== 'all' && rounds.length >= count) break;
    const r = buildRound(mode, f, index);
    if (!r) continue;
    if (r.game === 'twins') {
      const pair = [...r.ids].sort().join('|');
      if (usedPairs.has(pair)) continue;
      usedPairs.add(pair);
    }
    rounds.push(r);
  }
  if (rounds.length === 0) return null;
  return { mode, rounds: shuffle(rounds), timeLimit: info.timed ? info.timed.seconds : null };
}

/** How many formulas in `scope` a mode can use (for the setup screen's per-game counts). */
export function playableCount(mode: SessionMode, scope: Formula[], index: DeckIndex, numbers = false): number {
  if (mode === 'workout') return scope.length;
  return scope.filter((f) => canPlay(mode, f, index, { numbers })).length;
}
