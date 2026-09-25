import { addDays, sm2 } from '../formulas/storage';
import type { AnswerRecord, QuestionState } from '../types';

/**
 * Spaced repetition for the question bank (plan §4). Uses the same SM-2 step as the Formula Gym
 * (`formulas/storage.ts`) and the same rule that a correct answer before the due date leaves the
 * schedule alone. Days are local YYYY-MM-DD strings.
 */

/** A correct answer at or under this many seconds grades 5; slower grades 4. */
export const PAR_SECONDS = 90;
/** Most questions in one "Due for review" session. */
export const DUE_SESSION_CAP = 20;
/** Longest interval kept, so a corrupt or imported row (huge interval or ease) can't produce an invalid date. */
export const MAX_INTERVAL_DAYS = 3650;

export type QuestionSchedule = Pick<QuestionState, 'interval' | 'repetition' | 'efactor' | 'dueDate'>;

const DAY = /^\d{4}-\d{2}-\d{2}/;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Par time for a session: 90 s, or the question timer when a shorter one is running. */
export function parSeconds(timerEnabled?: boolean, timerSeconds?: number): number {
  return timerEnabled && num(timerSeconds) && timerSeconds > 0 ? Math.min(PAR_SECONDS, timerSeconds) : PAR_SECONDS;
}

/** SM-2 quality from correctness and speed: wrong (or timed out) = 1, correct within par = 5, correct but slow = 4. */
export function questionGrade(rec: Pick<AnswerRecord, 'correct' | 'timedOut' | 'timeTakenSeconds'>, par = PAR_SECONDS): number {
  if (!rec.correct || rec.timedOut) return 1;
  return rec.timeTakenSeconds <= par ? 5 : 4;
}

/** The local day part of a stored due date, or null when there is none (or it is malformed). */
export function dueDay(dueDate: unknown): string | null {
  return typeof dueDate === 'string' && DAY.test(dueDate) ? dueDate.slice(0, 10) : null;
}

/** A row's schedule, read defensively: rows saved before scheduling existed (or imported without it) count as never scheduled. */
export function scheduleOf(s: Partial<QuestionSchedule> | undefined): QuestionSchedule {
  return {
    interval: num(s?.interval) && s.interval >= 0 ? Math.min(MAX_INTERVAL_DAYS, s.interval) : 0,
    repetition: num(s?.repetition) && s.repetition >= 0 ? Math.round(s.repetition) : 0,
    efactor: num(s?.efactor) ? Math.max(1.3, s.efactor) : 2.5,
    dueDate: dueDay(s?.dueDate),
  };
}

/**
 * The schedule after one answer. A miss restarts SM-2 and is due again today (next session). A correct answer on
 * or after the due date (or the first time a question is scheduled) advances it; a correct answer before the due
 * date keeps the schedule as it is, so answering the same question repeatedly can't inflate its interval.
 */
export function nextSchedule(
  prev: Partial<QuestionSchedule> | undefined,
  rec: Pick<AnswerRecord, 'correct' | 'timedOut' | 'timeTakenSeconds'>,
  today: string,
  par = PAR_SECONDS,
): QuestionSchedule {
  const cur = scheduleOf(prev);
  const grade = questionGrade(rec, par);
  if (grade < 3) return { ...sm2(cur, grade), dueDate: today };
  if (cur.dueDate && cur.dueDate > today) return cur;
  const next = sm2(cur, grade);
  const interval = Math.min(MAX_INTERVAL_DAYS, next.interval);
  return { ...next, interval, dueDate: addDays(today, interval) };
}

/** Attempted, scheduled, and due on or before `today`. */
export function isQuestionDue(s: QuestionState | undefined, today: string): boolean {
  if (!s || !(s.totalAttempts > 0)) return false;
  const due = dueDay(s.dueDate);
  return !!due && due <= today;
}

/**
 * Due question ids, most overdue first (then last answered wrong, then lower ease), limited to ids `include`
 * accepts (e.g. questions still in the loaded content). `limit` caps the result.
 */
export function dueQuestionIds(
  states: Record<string, QuestionState>,
  today: string,
  include: (id: string) => boolean = () => true,
  limit = Infinity,
): string[] {
  return Object.values(states)
    .filter((s) => isQuestionDue(s, today) && include(s.questionId))
    .sort(
      (a, b) =>
        (dueDay(a.dueDate) ?? '').localeCompare(dueDay(b.dueDate) ?? '') ||
        Number(b.lastResult === 'wrong') - Number(a.lastResult === 'wrong') ||
        scheduleOf(a).efactor - scheduleOf(b).efactor ||
        a.questionId.localeCompare(b.questionId),
    )
    .slice(0, limit)
    .map((s) => s.questionId);
}

/** The earliest upcoming due day after `today` and how many questions fall on it, for "nothing due" messages. */
export function nextDue(
  states: Record<string, QuestionState>,
  today: string,
  include: (id: string) => boolean = () => true,
): { day: string; count: number } | null {
  let day: string | null = null;
  let count = 0;
  for (const s of Object.values(states)) {
    if (!(s.totalAttempts > 0) || !include(s.questionId)) continue;
    const d = dueDay(s.dueDate);
    if (!d || d <= today) continue;
    if (day === null || d < day) {
      day = d;
      count = 1;
    } else if (d === day) count++;
  }
  return day ? { day, count } : null;
}
