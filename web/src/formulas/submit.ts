import { haptic } from '../lib/settings';
import { GAME_BY_ID } from './games';
import type { Round } from './rounds';
import { useGymRun } from './run';
import { gradeFor, useGym } from './storage';
import { useFormulaDeck } from './deck';

const MAX_SECONDS = 600;

export interface Outcome {
  correct: boolean;
  seconds: number;
  /** Explicit SM-2 grade (Recall's self-grade); otherwise derived from correctness and speed. */
  grade?: number;
  /** A wrong answer that was close (grade 2 instead of 1). */
  nearMiss?: boolean;
}

export function elapsedSeconds(since: number): number {
  return Math.min(MAX_SECONDS, Math.max(0, Math.round((performance.now() - since) / 1000)));
}

/** Logs one grade per formula in the round, records the round result, and buzzes. */
export function submitRound(round: Round, outcome: Outcome) {
  const run = useGymRun.getState().run;
  if (!run || run.results.some((r) => r.key === round.key)) return;
  const info = GAME_BY_ID[round.game];
  const grade = outcome.grade ?? gradeFor(outcome.correct, outcome.seconds, info.fast, info.fair, outcome.nearMiss);
  const byId = useFormulaDeck.getState().byId;
  useGym.getState().record(
    round.ids.map((id) => ({
      itemId: id,
      kind: 'formula' as const,
      readingId: byId[id]?.readingId ?? '',
      game: round.game,
      correct: outcome.correct,
      grade,
      timeTakenSeconds: outcome.seconds,
      sessionId: run.sessionId,
    })),
  );
  useGymRun.getState().answer({
    key: round.key,
    game: round.game,
    items: round.ids.map((id) => ({ id, correct: outcome.correct })),
    correct: outcome.correct,
    seconds: outcome.seconds,
  });
  haptic(outcome.correct ? 10 : [20, 40, 20]);
}
