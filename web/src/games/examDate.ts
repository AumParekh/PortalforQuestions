/**
 * Exam mode (PORTAL_PLAN §0b): the exam date, the study phase it implies, and the cap every scheduler applies so
 * each item comes up again before the exam instead of after it.
 *
 * Pure day arithmetic on local YYYY-MM-DD strings, with no UI or store imports: the question bank (lib/srs.ts),
 * Formula Gym / Sense Check (formulas/storage.ts) and the notes games (games/srs.ts) all import it. It lives in
 * games/ because the games layer imports nothing from outside its own folder (its tests compile it on its own);
 * lib/ and formulas/ may import from games/. The date itself is owned by the Settings store (lib/settings.ts),
 * which pushes every change here through `setExamDate`.
 */

export const DEFAULT_EXAM_DATE = '2026-11-25';
/** Next due dates never land after this many days before the exam (while the exam is still ahead). */
export const CAP_DAYS_BEFORE_EXAM = 2;
/** The Setup phase (build and deploy) only exists for the planned exam: it ends on 6 Oct 2026. */
const SETUP_ENDS = '2026-10-06';
/** Same key as SETTINGS_KEY in lib/settings.ts; read directly so this module stays free of the store. */
const SETTINGS_KEY = 'frm.settings.v1';

export type ExamPhase = 'setup' | 'learn' | 'consolidate' | 'final' | 'after';

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar day number (days since 1970-01-01), computed in UTC so a DST change can't shift it. */
function dayNumber(day: string): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** True for a real calendar day written as YYYY-MM-DD (rejects 2026-02-30 and friends). */
export function isExamDay(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = DAY_RE.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  return y >= 2000 && y <= 2100 && fromDayNumber(dayNumber(v)) === v;
}

/** `day` moved by `n` calendar days. */
export function shiftDay(day: string, n: number): string {
  return fromDayNumber(dayNumber(day) + n);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

// ---- The current exam date ----

let current: string | null = null;

function readStoredExamDate(): string {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_EXAM_DATE;
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    const d = v && typeof v === 'object' ? (v as Record<string, unknown>).examDate : undefined;
    return isExamDay(d) ? d : DEFAULT_EXAM_DATE;
  } catch {
    return DEFAULT_EXAM_DATE;
  }
}

/** The exam date in use (YYYY-MM-DD): the one set in Settings, or 25 Nov 2026. */
export function examDate(): string {
  if (current === null) current = readStoredExamDate();
  return current;
}

/** Called by the Settings store on load and on every change; an invalid value falls back to the default. */
export function setExamDate(day: unknown) {
  current = isExamDay(day) ? day : DEFAULT_EXAM_DATE;
}

/** Days from `today` to the exam: 0 on exam day, negative afterwards. */
export function daysToExam(today: string, exam: string = examDate()): number {
  return daysBetween(today, exam);
}

/**
 * The study phase on `today` (§0b, measured back from the exam): final review from exam − 9 (16 Nov) through exam
 * day, consolidate from exam − 23 (2 Nov) to exam − 10, learn before that. Setup (until 5 Oct) only applies to the
 * planned 25 Nov exam; with any other date, learn is the first phase.
 */
export function examPhase(today: string, exam: string = examDate()): ExamPhase {
  const d = daysBetween(today, exam);
  if (d < 0) return 'after';
  if (d <= 9) return 'final';
  if (d <= 23) return 'consolidate';
  if (exam === DEFAULT_EXAM_DATE && today < SETUP_ENDS) return 'setup';
  return 'learn';
}

// ---- The exam-day cap on every scheduler ----

/** The last day a review may be scheduled for while the exam is ahead: exam − 2. */
export function examCapDay(exam: string = examDate()): string {
  return shiftDay(exam, -CAP_DAYS_BEFORE_EXAM);
}

/**
 * The due date to store for a review scheduled on `today`: never after exam − 2 while today is before that day.
 * On or after that day (and after the exam) the due date is left as it is.
 */
export function capNextDue(due: string, today: string, exam: string = examDate()): string {
  const cap = examCapDay(exam);
  return today < cap && due > cap ? cap : due;
}

/**
 * The due date to use when checking what is due on `today`, so schedules stored before the cap existed (or before
 * the exam date moved earlier) obey it too: a schedule set before exam − 2 (its due date minus its interval) that
 * lands after it counts as due on exam − 2. After the exam date there is no cap.
 */
export function effectiveDue(due: string, interval: unknown, today: string, exam: string = examDate()): string {
  if (today > exam) return due;
  const cap = examCapDay(exam);
  if (due <= cap) return due;
  // Unknown interval (a damaged row): assume it was set before the cap so it still comes up before the exam.
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 0) return cap;
  return shiftDay(due, -Math.round(interval)) < cap ? cap : due;
}
