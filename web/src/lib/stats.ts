import type { AttemptRecord, Question, QuestionState } from '../types';

export type QuestionProgress = 'new' | 'correct' | 'wrong';

export function questionProgress(state: QuestionState | undefined): QuestionProgress {
  if (!state || state.totalAttempts === 0) return 'new';
  return state.lastResult === 'correct' ? 'correct' : 'wrong';
}

export function accuracyOf(correct: number, attempts: number): number | null {
  return attempts > 0 ? correct / attempts : null;
}

export interface OverallStats {
  questionsAttempted: number;
  totalAttempts: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
  secondsStudied: number;
}

export function overallStats(states: Record<string, QuestionState>, attempts: AttemptRecord[]): OverallStats {
  let questionsAttempted = 0;
  let totalAttempts = 0;
  let correct = 0;
  let wrong = 0;
  for (const s of Object.values(states)) {
    if (s.totalAttempts === 0) continue;
    questionsAttempted++;
    totalAttempts += s.totalAttempts;
    correct += s.totalCorrect;
    wrong += s.totalWrong;
  }
  const secondsStudied = attempts.reduce((sum, a) => sum + a.timeTakenSeconds, 0);
  return { questionsAttempted, totalAttempts, correct, wrong, accuracy: accuracyOf(correct, totalAttempts), secondsStudied };
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1).toISOString());
}

/** Consecutive local days with at least one answer. The current streak survives until a full day is missed. */
export function streaks(attempts: AttemptRecord[], now = new Date()): { current: number; longest: number; studiedToday: boolean } {
  const days = new Set(attempts.map((a) => localDay(a.timestamp)));
  const today = localDay(now.toISOString());
  let longest = 0;
  for (const day of days) {
    if (days.has(dayBefore(day))) continue;
    let len = 1;
    let d = day;
    for (;;) {
      const [y, m, dd] = d.split('-').map(Number);
      const next = localDay(new Date(y, m - 1, dd + 1).toISOString());
      if (!days.has(next)) break;
      len++;
      d = next;
    }
    longest = Math.max(longest, len);
  }
  let current = 0;
  let cursor = days.has(today) ? today : dayBefore(today);
  while (days.has(cursor)) {
    current++;
    cursor = dayBefore(cursor);
  }
  return { current, longest, studiedToday: days.has(today) };
}

export function answeredToday(attempts: AttemptRecord[], now = new Date()): number {
  const today = localDay(now.toISOString());
  return attempts.filter((a) => localDay(a.timestamp) === today).length;
}

export interface GroupProgress {
  key: string;
  label: string;
  subject: string;
  total: number;
  attempted: number;
  correct: number;
  attempts: number;
  accuracy: number | null;
  questionIds: string[];
}

/** Groups questions by a key and summarizes progress; groups keep first-appearance order. */
export function groupProgress(
  questions: Question[],
  states: Record<string, QuestionState>,
  keyOf: (q: Question) => { key: string; label: string },
): GroupProgress[] {
  const groups = new Map<string, GroupProgress>();
  for (const q of questions) {
    const { key, label } = keyOf(q);
    let g = groups.get(key);
    if (!g) {
      g = { key, label, subject: q.subject, total: 0, attempted: 0, correct: 0, attempts: 0, accuracy: null, questionIds: [] };
      groups.set(key, g);
    }
    g.total++;
    g.questionIds.push(q.id);
    const s = states[q.id];
    if (s && s.totalAttempts > 0) {
      g.attempted++;
      g.correct += s.totalCorrect;
      g.attempts += s.totalAttempts;
    }
  }
  for (const g of groups.values()) g.accuracy = accuracyOf(g.correct, g.attempts);
  return [...groups.values()];
}

/** Lowest-accuracy LOs among those with at least `minAttempts` answers. Keyed by LO text, matching the session catalog. */
export function weakestLos(questions: Question[], states: Record<string, QuestionState>, limit = 5, minAttempts = 2): GroupProgress[] {
  return groupProgress(questions, states, (q) => ({ key: `${q.subject}::${q.loText || q.lo}`, label: q.loText || q.lo }))
    .filter((g) => g.attempts >= minAttempts && g.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1) || b.attempts - a.attempts)
    .slice(0, limit);
}

/** Every question answered wrong at least once, most recently attempted first. */
export function wrongQuestionStates(states: Record<string, QuestionState>): QuestionState[] {
  return Object.values(states)
    .filter((s) => s.totalWrong > 0)
    .sort((a, b) => (b.lastAttempted ?? '').localeCompare(a.lastAttempted ?? ''));
}
