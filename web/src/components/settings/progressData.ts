import type {
  AttemptRecord,
  FormulaAttempt,
  FormulaGame,
  FormulaState,
  OptionKey,
  QuestionState,
  ScopeKind,
  SessionMode,
  SessionRecord,
  TFAttempt,
  TFState,
} from '../../types';
import { getAll, openDb } from '../../lib/db';

/** File format for "Export progress" / "Import progress". */
/**
 * Version 2 adds the True/False stores, version 3 the Formula Gym stores. Older files still import,
 * with the stores they predate left empty.
 */
export interface ProgressExport {
  version: 3;
  exportedAt: string;
  questionState: QuestionState[];
  attempts: AttemptRecord[];
  sessions: SessionRecord[];
  tfState: TFState[];
  tfAttempts: TFAttempt[];
  formulaState: FormulaState[];
  formulaAttempts: FormulaAttempt[];
}

export interface ParsedImport {
  data: ProgressExport;
  /** Rows that failed validation and will be left out. */
  skipped: number;
}

export async function buildExport(): Promise<ProgressExport> {
  const [questionState, attempts, sessions, tfState, tfAttempts, formulaState, formulaAttempts] = await Promise.all([
    getAll('questionState'),
    getAll('attempts'),
    getAll('sessions'),
    getAll('tfState'),
    getAll('tfAttempts'),
    getAll('formulaState'),
    getAll('formulaAttempts'),
  ]);
  attempts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  tfAttempts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  formulaAttempts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    questionState,
    attempts,
    sessions,
    tfState,
    tfAttempts,
    formulaState,
    formulaAttempts,
  };
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
const FORMULA_GAMES: readonly string[] = ['recall', 'forge', 'rigged', 'spot', 'whichway', 'symbols', 'calc', 'twins'];

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

function tfState(v: unknown): TFState | null {
  if (!isRec(v) || !nonEmpty(v.cardId) || !str(v.subject)) return null;
  if (!count(v.totalAttempts) || !count(v.totalCorrect) || !count(v.totalWrong)) return null;
  return {
    cardId: v.cardId,
    subject: v.subject,
    topic: strOr(v.topic, ''),
    totalAttempts: v.totalAttempts,
    totalCorrect: v.totalCorrect,
    totalWrong: v.totalWrong,
    lastResult: v.lastResult === 'correct' || v.lastResult === 'wrong' ? v.lastResult : null,
    lastAttempted: isoDate(v.lastAttempted) ? v.lastAttempted : null,
  };
}

function tfAttempt(v: unknown): TFAttempt | null {
  if (!isRec(v) || !nonEmpty(v.attemptId) || !nonEmpty(v.cardId) || !isoDate(v.timestamp)) return null;
  if (typeof v.answeredTrue !== 'boolean' || typeof v.isCorrect !== 'boolean') return null;
  return {
    attemptId: v.attemptId,
    cardId: v.cardId,
    sessionId: strOr(v.sessionId, ''),
    timestamp: v.timestamp,
    answeredTrue: v.answeredTrue,
    isCorrect: v.isCorrect,
    timeTakenSeconds: count(v.timeTakenSeconds) ? v.timeTakenSeconds : 0,
  };
}

const isGame = (v: unknown): v is FormulaGame => str(v) && FORMULA_GAMES.includes(v);
const localDate = (v: unknown): v is string => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

function formulaState(v: unknown): FormulaState | null {
  if (!isRec(v) || !nonEmpty(v.formulaId)) return null;
  if (!count(v.totalAttempts) || !count(v.totalCorrect) || !count(v.totalWrong)) return null;
  const gameCounts: Partial<Record<FormulaGame, number>> = {};
  if (isRec(v.gameCounts)) for (const [k, n] of Object.entries(v.gameCounts)) if (isGame(k) && count(n)) gameCounts[k] = n;
  return {
    formulaId: v.formulaId,
    readingId: strOr(v.readingId, ''),
    repetition: count(v.repetition) ? v.repetition : 0,
    interval: count(v.interval) ? v.interval : 0,
    efactor: num(v.efactor) ? Math.max(1.3, v.efactor) : 2.5,
    dueDate: localDate(v.dueDate) ? v.dueDate : null,
    totalAttempts: v.totalAttempts,
    totalCorrect: v.totalCorrect,
    totalWrong: v.totalWrong,
    lastResult: v.lastResult === 'correct' || v.lastResult === 'wrong' ? v.lastResult : null,
    lastAttempted: isoDate(v.lastAttempted) ? v.lastAttempted : null,
    gameCounts,
    recentGames: Array.isArray(v.recentGames) ? v.recentGames.filter(isGame).slice(0, 4) : [],
  };
}

function formulaAttempt(v: unknown): FormulaAttempt | null {
  if (!isRec(v) || !nonEmpty(v.attemptId) || !nonEmpty(v.formulaId) || !isoDate(v.timestamp)) return null;
  if (!isGame(v.game) || typeof v.correct !== 'boolean') return null;
  return {
    attemptId: v.attemptId,
    formulaId: v.formulaId,
    game: v.game,
    correct: v.correct,
    grade: num(v.grade) ? Math.min(5, Math.max(0, Math.round(v.grade))) : v.correct ? 4 : 1,
    timeTakenSeconds: count(v.timeTakenSeconds) ? v.timeTakenSeconds : 0,
    sessionId: strOr(v.sessionId, ''),
    timestamp: v.timestamp,
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
  if (data.version !== 1 && data.version !== 2 && data.version !== 3) {
    throw new Error(
      data.version === undefined ? 'This file is not a progress export (no version).' : `Unsupported export version: ${String(data.version)}.`,
    );
  }
  if (!Array.isArray(data.questionState) || !Array.isArray(data.attempts) || !Array.isArray(data.sessions)) {
    throw new Error('This file is missing questionState, attempts or sessions.');
  }
  // Stores a version predates import as empty, so older files still restore everything they hold.
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const tfStateRows = list(data.tfState);
  const tfAttemptRows = list(data.tfAttempts);
  const formulaStateRows = list(data.formulaState);
  const formulaAttemptRows = list(data.formulaAttempts);
  const qs = rows(data.questionState, questionState, (r) => r.questionId);
  const at = rows(data.attempts, attempt, (r) => r.attemptId);
  const se = rows(data.sessions, session, (r) => r.sessionId);
  const ts = rows(tfStateRows, tfState, (r) => r.cardId);
  const ta = rows(tfAttemptRows, tfAttempt, (r) => r.attemptId);
  const fs = rows(formulaStateRows, formulaState, (r) => r.formulaId);
  const fa = rows(formulaAttemptRows, formulaAttempt, (r) => r.attemptId);
  const total =
    data.questionState.length +
    data.attempts.length +
    data.sessions.length +
    tfStateRows.length +
    tfAttemptRows.length +
    formulaStateRows.length +
    formulaAttemptRows.length;
  const skipped = qs.bad + at.bad + se.bad + ts.bad + ta.bad + fs.bad + fa.bad;
  if (total > 0 && skipped === total) throw new Error('None of the records in this file could be read.');
  return {
    data: {
      version: 3,
      exportedAt: isoDate(data.exportedAt) ? data.exportedAt : '',
      questionState: qs.ok,
      attempts: at.ok,
      sessions: se.ok,
      tfState: ts.ok,
      tfAttempts: ta.ok,
      formulaState: fs.ok,
      formulaAttempts: fa.ok,
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
  const tx = db.transaction(
    ['questionState', 'attempts', 'sessions', 'tfState', 'tfAttempts', 'formulaState', 'formulaAttempts'],
    'readwrite',
  );
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Import was aborted'));
  });
  const qs = tx.objectStore('questionState');
  const at = tx.objectStore('attempts');
  const se = tx.objectStore('sessions');
  const ts = tx.objectStore('tfState');
  const ta = tx.objectStore('tfAttempts');
  const fs = tx.objectStore('formulaState');
  const fa = tx.objectStore('formulaAttempts');
  qs.clear();
  at.clear();
  se.clear();
  ts.clear();
  ta.clear();
  fs.clear();
  fa.clear();
  for (const r of data.questionState) qs.put(r);
  for (const r of data.attempts) at.put(r);
  for (const r of data.sessions) se.put(r);
  for (const r of data.tfState) ts.put(r);
  for (const r of data.tfAttempts) ta.put(r);
  for (const r of data.formulaState) fs.put(r);
  for (const r of data.formulaAttempts) fa.put(r);
  await done;
}
