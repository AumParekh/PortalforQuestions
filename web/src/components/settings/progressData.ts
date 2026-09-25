import type { AttemptRecord, OptionKey, QuestionState, ScopeKind, SessionMode, SessionRecord } from '../../types';
import { getAll, openDb } from '../../lib/db';

/** File format for "Export progress" / "Import progress". */
export interface ProgressExport {
  version: 1;
  exportedAt: string;
  questionState: QuestionState[];
  attempts: AttemptRecord[];
  sessions: SessionRecord[];
}

export interface ParsedImport {
  data: ProgressExport;
  /** Rows that failed validation and will be left out. */
  skipped: number;
}

export async function buildExport(): Promise<ProgressExport> {
  const [questionState, attempts, sessions] = await Promise.all([getAll('questionState'), getAll('attempts'), getAll('sessions')]);
  attempts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return { version: 1, exportedAt: new Date().toISOString(), questionState, attempts, sessions };
}

export function exportFileName(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `frm-progress-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Validation ----

type Rec = Record<string, unknown>;

const OPTION_KEYS: readonly string[] = ['a', 'b', 'c', 'd', 'e'];
const MODES: readonly string[] = ['drill', 'review-wrong', 'quest', 'mock'];
const SCOPES: readonly string[] = ['subject', 'reading', 'topic', 'lo'];

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): v is number => num(v) && v >= 0;
const isoDate = (v: unknown): v is string => str(v) && !Number.isNaN(Date.parse(v));
const strOr = (v: unknown, d: string) => (str(v) ? v : d);
const numOr = (v: unknown, d: number) => (num(v) ? v : d);

function selected(v: unknown): OptionKey | '' | null | undefined {
  if (v === '' || v === null) return v;
  return str(v) && OPTION_KEYS.includes(v) ? (v as OptionKey) : undefined;
}

function questionState(v: unknown): QuestionState | null {
  if (!isRec(v) || !nonEmpty(v.questionId) || !str(v.subject)) return null;
  if (!count(v.totalAttempts) || !count(v.totalCorrect) || !count(v.totalWrong)) return null;
  const lastResult = v.lastResult === 'correct' || v.lastResult === 'wrong' ? v.lastResult : null;
  const lastSelected = selected(v.lastSelected);
  return {
    questionId: v.questionId,
    subject: v.subject,
    reading: strOr(v.reading, ''),
    topic: strOr(v.topic, ''),
    lo: strOr(v.lo, ''),
    loText: strOr(v.loText, ''),
    totalAttempts: v.totalAttempts,
    totalCorrect: v.totalCorrect,
    totalWrong: v.totalWrong,
    consecutiveCorrect: count(v.consecutiveCorrect) ? v.consecutiveCorrect : 0,
    lastResult,
    lastAttempted: isoDate(v.lastAttempted) ? v.lastAttempted : null,
    lastSelected: lastSelected === undefined ? null : lastSelected,
    avgTimeSeconds: count(v.avgTimeSeconds) ? v.avgTimeSeconds : 0,
    interval: numOr(v.interval, 0),
    repetition: numOr(v.repetition, 0),
    efactor: numOr(v.efactor, 2.5),
    dueDate: str(v.dueDate) ? v.dueDate : null,
    markedForReview: v.markedForReview === true,
  };
}

function attempt(v: unknown): AttemptRecord | null {
  if (!isRec(v) || !nonEmpty(v.attemptId) || !nonEmpty(v.questionId) || !isoDate(v.timestamp)) return null;
  if (typeof v.isCorrect !== 'boolean') return null;
  const sel = selected(v.selectedOption);
  if (sel === undefined || sel === null) return null;
  if (!str(v.correctOption) || !OPTION_KEYS.includes(v.correctOption)) return null;
  return {
    attemptId: v.attemptId,
    questionId: v.questionId,
    timestamp: v.timestamp,
    sessionId: strOr(v.sessionId, ''),
    selectedOption: sel,
    correctOption: v.correctOption as OptionKey,
    isCorrect: v.isCorrect,
    timeTakenSeconds: count(v.timeTakenSeconds) ? v.timeTakenSeconds : 0,
    timedOut: v.timedOut === true,
    mode: str(v.mode) && MODES.includes(v.mode) ? (v.mode as SessionMode) : 'drill',
  };
}

function session(v: unknown): SessionRecord | null {
  if (!isRec(v) || !nonEmpty(v.sessionId) || !isoDate(v.startedAt)) return null;
  const scope = isRec(v.scope) ? v.scope : {};
  return {
    sessionId: v.sessionId,
    startedAt: v.startedAt,
    endedAt: isoDate(v.endedAt) ? v.endedAt : v.startedAt,
    mode: str(v.mode) && MODES.includes(v.mode) ? (v.mode as SessionMode) : 'drill',
    scope: {
      kind: str(scope.kind) && SCOPES.includes(scope.kind) ? (scope.kind as ScopeKind) : 'subject',
      keys: Array.isArray(scope.keys) ? scope.keys.filter(str) : [],
    },
    totalQuestions: count(v.totalQuestions) ? v.totalQuestions : 0,
    answered: count(v.answered) ? v.answered : 0,
    skipped: count(v.skipped) ? v.skipped : 0,
    correct: count(v.correct) ? v.correct : 0,
    wrong: count(v.wrong) ? v.wrong : 0,
    accuracy: num(v.accuracy) ? Math.min(1, Math.max(0, v.accuracy)) : 0,
    avgTimeSeconds: count(v.avgTimeSeconds) ? v.avgTimeSeconds : 0,
  };
}

function rows<T>(list: unknown[], parse: (v: unknown) => T | null, key: (t: T) => string): { ok: T[]; bad: number } {
  const byKey = new Map<string, T>();
  let bad = 0;
  for (const item of list) {
    const r = parse(item);
    if (r) byKey.set(key(r), r);
    else bad++;
  }
  return { ok: [...byKey.values()], bad };
}

/** Throws an Error with a user-facing message when the file is not a usable export. */
export function parseImport(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isRec(data)) throw new Error('This file is not a progress export.');
  if (data.version !== 1) {
    throw new Error(
      data.version === undefined ? 'This file is not a progress export (no version).' : `Unsupported export version: ${String(data.version)}.`,
    );
  }
  if (!Array.isArray(data.questionState) || !Array.isArray(data.attempts) || !Array.isArray(data.sessions)) {
    throw new Error('This file is missing questionState, attempts or sessions.');
  }
  const qs = rows(data.questionState, questionState, (r) => r.questionId);
  const at = rows(data.attempts, attempt, (r) => r.attemptId);
  const se = rows(data.sessions, session, (r) => r.sessionId);
  const total = data.questionState.length + data.attempts.length + data.sessions.length;
  const skipped = qs.bad + at.bad + se.bad;
  if (total > 0 && skipped === total) throw new Error('None of the records in this file could be read.');
  return {
    data: {
      version: 1,
      exportedAt: isoDate(data.exportedAt) ? data.exportedAt : '',
      questionState: qs.ok,
      attempts: at.ok,
      sessions: se.ok,
    },
    skipped,
  };
}

/**
 * Replaces all progress with the imported data in a single transaction, so a failure part-way
 * leaves the existing progress untouched. The meta store (resume state, etc.) is not changed.
 */
export async function replaceProgress(data: ProgressExport): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['questionState', 'attempts', 'sessions'], 'readwrite');
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Import was aborted'));
  });
  const qs = tx.objectStore('questionState');
  const at = tx.objectStore('attempts');
  const se = tx.objectStore('sessions');
  qs.clear();
  at.clear();
  se.clear();
  for (const r of data.questionState) qs.put(r);
  for (const r of data.attempts) at.put(r);
  for (const r of data.sessions) se.put(r);
  await done;
}
