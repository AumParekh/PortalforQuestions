// SM-2 spaced repetition, shared by every mechanic. Pure functions only; the store in
// progress.ts applies them (`review(itemId, grade)`) and persists the result.
import type { ItemSrs, TrapCategory } from './types';

export const MIN_EFACTOR = 1.3;
export const START_EFACTOR = 2.5;

/** Local calendar date as YYYY-MM-DD (due dates are day-granular, in the player's time zone). */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

/**
 * Grade 0–5 from correctness and speed. `targetMs` is the round's comfortable answer time
 * (its time limit under pressure, or a mechanic default in discovery).
 *   5 correct and quick (≤ half the target) · 4 correct · 3 correct but slow (over target)
 *   1 wrong · 0 timed out / no answer
 */
export function gradeFromAnswer(correct: boolean, timeMs: number, targetMs: number, timedOut = false): number {
  if (timedOut) return 0;
  if (!correct) return 1;
  if (targetMs > 0 && timeMs <= targetMs / 2) return 5;
  if (targetMs > 0 && timeMs > targetMs) return 3;
  return 4;
}

export interface ReviewMeta {
  readingId?: string;
  category?: TrapCategory;
}

/**
 * One SM-2 step. Grades ≥ 3 advance (1 day, 6 days, then interval × EF) — at most once per
 * item per local day; grades < 3 lapse:
 * repetition resets and the item is due again today, so a miss anywhere resurfaces in the very
 * next session of any mechanic.
 */
export function sm2(prev: ItemSrs | undefined, itemId: string, grade: number, now: Date = new Date(), meta: ReviewMeta = {}): ItemSrs {
  const q = Math.max(0, Math.min(5, Number.isFinite(grade) ? Math.round(grade) : 0));
  const today = localDate(now);
  // A second pass on the same day (two rounds on one item, or a replay) is not spaced
  // repetition: it must not climb 1 → 6 → 15 days in one sitting. Once an item has been passed
  // today, further passes today are recorded but leave the schedule alone; a miss still lapses.
  if (prev && q >= 3 && prev.lastResult === 'correct' && prev.lastReviewed && localDate(new Date(prev.lastReviewed)) === today) {
    return {
      ...prev,
      itemId,
      lastGrade: q,
      lastReviewed: now.toISOString(),
      reviews: (prev.reviews ?? 0) + 1,
      readingId: meta.readingId ?? prev.readingId,
      category: meta.category ?? prev.category,
    };
  }
  const efPrev = prev?.efactor ?? START_EFACTOR;
  const efactor = Math.max(MIN_EFACTOR, efPrev + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  let repetition = prev?.repetition ?? 0;
  let interval: number;
  let lapses = prev?.lapses ?? 0;
  if (q >= 3) {
    if (repetition === 0) interval = 1;
    else if (repetition === 1) interval = 6;
    else interval = Math.max(1, Math.round((prev?.interval ?? 1) * efactor));
    repetition += 1;
  } else {
    if (prev) lapses += 1;
    repetition = 0;
    interval = 0;
  }
  return {
    itemId,
    interval,
    repetition,
    efactor: Math.round(efactor * 1000) / 1000,
    dueDate: addDays(today, interval),
    lastResult: q >= 3 ? 'correct' : 'wrong',
    lastGrade: q,
    lastReviewed: now.toISOString(),
    reviews: (prev?.reviews ?? 0) + 1,
    lapses,
    readingId: meta.readingId ?? prev?.readingId,
    category: meta.category ?? prev?.category,
  };
}

export function isDue(s: ItemSrs | undefined, today: string = localDate()): boolean {
  return !!s && s.dueDate <= today;
}

/** IDs of due items, most overdue first (then most lapses). */
export function dueItemIds(items: Record<string, ItemSrs>, today: string = localDate()): string[] {
  return Object.values(items)
    .filter((s) => s.dueDate <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.lapses - a.lapses || a.itemId.localeCompare(b.itemId))
    .map((s) => s.itemId);
}

/** Due-item count per reading (items carry the reading they were last reviewed in). */
export function dueCountByReading(items: Record<string, ItemSrs>, today: string = localDate()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of Object.values(items)) {
    if (s.dueDate <= today && s.readingId) out[s.readingId] = (out[s.readingId] ?? 0) + 1;
  }
  return out;
}

/**
 * Sort key for picking items inside a mechanic: due items first (most overdue), then never-seen,
 * then the rest by soonest due. Lower is sooner.
 */
export function srsPriority(s: ItemSrs | undefined, today: string = localDate()): number {
  if (!s) return 1;
  if (s.dueDate <= today) return 0;
  return 2;
}
