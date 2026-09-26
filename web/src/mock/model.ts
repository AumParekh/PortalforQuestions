import type { ContentFile, MockEndReason, MockResult, MockResultItem, OptionKey, Question } from '../types';

/**
 * Timed mock exams: the pure parts (routes, the clock, scoring). The in-progress attempt and the result history live
 * in `store.ts`; `submit.ts` turns an attempt into a result and records its answers.
 */

/** GARP's pace for Part II: 80 questions in 4 hours. Used when a mock file gives no time limit. */
export const SECONDS_PER_QUESTION = 180;
/** The countdown turns amber at 10 minutes left and red at 2. */
export const WARN_SECONDS = 10 * 60;
export const DANGER_SECONDS = 2 * 60;

/** An attempt in progress (saved in localStorage so a reload or a closed tab resumes it). */
export interface MockAttempt {
  attemptId: string;
  slug: string;
  /** Epoch ms. The clock is always computed from this, so it keeps running while the app is closed. */
  startedAt: number;
  timeLimitMinutes: number;
  /** Question ids in paper order, fixed at start. */
  questionIds: string[];
  answers: Record<string, OptionKey>;
  flags: Record<string, true>;
  /** Milliseconds each question has been on screen, summed over visits. */
  times: Record<string, number>;
  currentIndex: number;
}

// ---- Files and routes ----

/** "mocks/mock-exam-1.json" → "mock-exam-1". */
export function mockSlug(path: string): string {
  return path.replace(/^mocks\//, '').replace(/\.json$/, '');
}

export function mockFileBySlug(files: ContentFile[], slug: string): ContentFile | undefined {
  return files.find((f) => f.type === 'mock' && mockSlug(f.path) === slug);
}

export type MockView =
  | { kind: 'briefing'; slug: string }
  | { kind: 'exam'; slug: string }
  | { kind: 'results'; slug: string; resultId: string }
  | { kind: 'review'; slug: string; resultId: string; index: number };

/** `#/mock/<slug>`, `#/mock/<slug>/exam`, `#/mock/<slug>/results/<id>` and `#/mock/<slug>/results/<id>/<n>` (n is 1-based). */
export function mockRoute(view: MockView): `/mock/${string}` {
  const base = `/mock/${encodeURIComponent(view.slug)}` as const;
  switch (view.kind) {
    case 'briefing':
      return base;
    case 'exam':
      return `${base}/exam`;
    case 'results':
      return `${base}/results/${encodeURIComponent(view.resultId)}`;
    case 'review':
      return `${base}/results/${encodeURIComponent(view.resultId)}/${view.index + 1}`;
  }
}

export function parseMockRoute(route: string): MockView | null {
  const parts = route.split('/').filter(Boolean);
  if (parts[0] !== 'mock' || !parts[1]) return null;
  let slug: string;
  let resultId: string;
  try {
    slug = decodeURIComponent(parts[1]);
    resultId = parts[3] ? decodeURIComponent(parts[3]) : '';
  } catch {
    return null;
  }
  if (parts.length === 2) return { kind: 'briefing', slug };
  if (parts.length === 3 && parts[2] === 'exam') return { kind: 'exam', slug };
  if (parts[2] === 'results' && resultId) {
    if (parts.length === 4) return { kind: 'results', slug, resultId };
    const n = Number(parts[4]);
    if (parts.length === 5 && Number.isInteger(n) && n >= 1) return { kind: 'review', slug, resultId, index: n - 1 };
  }
  return null;
}

// ---- Paper ----

export function timeLimitOf(file: ContentFile): number {
  const t = file.timeLimitMinutes;
  if (typeof t === 'number' && Number.isFinite(t) && t > 0) return t;
  return Math.max(1, Math.round((file.questionIds.length * SECONDS_PER_QUESTION) / 60));
}

/** The file's questions still in the loaded content, in paper order (by `number` when every question has one). */
export function paperQuestionIds(file: ContentFile, byId: Record<string, Question>): string[] {
  const ids = file.questionIds.filter((id) => byId[id]);
  if (!ids.every((id) => typeof byId[id].number === 'number')) return ids;
  return [...ids].sort((a, b) => (byId[a].number ?? 0) - (byId[b].number ?? 0));
}

/** The number shown for the question at `index`: its paper number, else its position. */
export function questionNumber(q: Pick<Question, 'number'> | undefined, index: number): number {
  return typeof q?.number === 'number' ? q.number : index + 1;
}

export interface AreaCount {
  subject: string;
  count: number;
}

/** Questions per area, largest first. */
export function areaMix(ids: string[], byId: Record<string, Question>): AreaCount[] {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const subject = byId[id]?.subject;
    if (subject) counts.set(subject, (counts.get(subject) ?? 0) + 1);
  }
  return [...counts.entries()].map(([subject, count]) => ({ subject, count })).sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject));
}

// ---- Clock ----

export function deadlineOf(a: Pick<MockAttempt, 'startedAt' | 'timeLimitMinutes'>): number {
  return a.startedAt + a.timeLimitMinutes * 60_000;
}

export function remainingMs(a: Pick<MockAttempt, 'startedAt' | 'timeLimitMinutes'>, now: number): number {
  return Math.max(0, deadlineOf(a) - now);
}

/** mm:ss with the minutes left unbounded (a 4-hour mock starts at 240:00). */
export function clockText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** h:mm:ss (or m:ss under an hour), for time left outside the exam screen. */
export function hmsText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/** Durations for summaries: "4h", "3h 12m", "12m 5s", "3m", "45s". */
export function durationText(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s % 60 > 0 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${s}s`;
}

export type ClockLevel = 'normal' | 'warn' | 'danger';

export function clockLevel(remainingSeconds: number): ClockLevel {
  if (remainingSeconds <= DANGER_SECONDS) return 'danger';
  if (remainingSeconds <= WARN_SECONDS) return 'warn';
  return 'normal';
}

export function answeredCount(a: Pick<MockAttempt, 'questionIds' | 'answers'>): number {
  return a.questionIds.reduce((n, id) => (a.answers[id] ? n + 1 : n), 0);
}

export function flaggedCount(a: Pick<MockAttempt, 'questionIds' | 'flags'>): number {
  return a.questionIds.reduce((n, id) => (a.flags[id] ? n + 1 : n), 0);
}

// ---- Scoring ----

/**
 * The result of an attempt, scored against the loaded content. Unanswered questions score as wrong. Questions a
 * content update removed since the start are left out.
 */
export function buildResult(
  a: MockAttempt,
  name: string,
  byId: Record<string, Question>,
  endedBy: MockEndReason,
  submittedAt: number,
): MockResult {
  const items: MockResultItem[] = [];
  a.questionIds.forEach((id, index) => {
    const q = byId[id];
    if (!q) return;
    const selected = a.answers[id] ?? '';
    items.push({
      questionId: id,
      number: questionNumber(q, index),
      subject: q.subject,
      selected,
      correctOption: q.answer,
      correct: selected === q.answer,
      flagged: !!a.flags[id],
      timeSeconds: Math.round((a.times[id] ?? 0) / 1000),
    });
  });
  return {
    resultId: a.attemptId,
    slug: a.slug,
    name,
    startedAt: new Date(a.startedAt).toISOString(),
    submittedAt: new Date(Math.max(a.startedAt, submittedAt)).toISOString(),
    timeLimitMinutes: a.timeLimitMinutes,
    endedBy,
    total: items.length,
    answered: items.filter((i) => i.selected !== '').length,
    correct: items.filter((i) => i.correct).length,
    items,
  };
}

export function scorePct(r: Pick<MockResult, 'correct' | 'total'>): number {
  return r.total ? Math.round((r.correct / r.total) * 100) : 0;
}

/** Wall-clock time from start to submission, capped at the limit. */
export function timeUsedSeconds(r: Pick<MockResult, 'startedAt' | 'submittedAt' | 'timeLimitMinutes'>): number {
  const used = (Date.parse(r.submittedAt) - Date.parse(r.startedAt)) / 1000;
  return Number.isFinite(used) ? Math.min(Math.max(0, used), r.timeLimitMinutes * 60) : 0;
}

export interface AreaScore {
  subject: string;
  total: number;
  correct: number;
  /** correct / total. */
  accuracy: number;
}

/** Per-area score, weakest first (ties: more questions first, then name). */
export function areaScores(r: Pick<MockResult, 'items'>): AreaScore[] {
  const bySubject = new Map<string, AreaScore>();
  for (const item of r.items) {
    let g = bySubject.get(item.subject);
    if (!g) {
      g = { subject: item.subject, total: 0, correct: 0, accuracy: 0 };
      bySubject.set(item.subject, g);
    }
    g.total++;
    if (item.correct) g.correct++;
  }
  return [...bySubject.values()]
    .map((g) => ({ ...g, accuracy: g.total ? g.correct / g.total : 0 }))
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total || a.subject.localeCompare(b.subject));
}

export type ResultFilter = 'all' | 'wrong' | 'flagged' | 'unanswered';

/** "Wrong" includes unanswered questions, since they score as wrong. */
export function matchesFilter(item: MockResultItem, filter: ResultFilter): boolean {
  switch (filter) {
    case 'wrong':
      return !item.correct;
    case 'flagged':
      return item.flagged;
    case 'unanswered':
      return item.selected === '';
    default:
      return true;
  }
}
