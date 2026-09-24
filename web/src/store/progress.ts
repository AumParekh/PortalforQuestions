import { create } from 'zustand';
import type { AnswerRecord, AttemptRecord, Question, QuestionState, SessionMode, SessionRecord } from '../types';
import { clearStores, deleteQuestionStates, getAll, putAttempt, putMany } from '../lib/db';
import { newId } from './session';

interface ProgressState {
  /** 'unavailable' when IndexedDB can't be opened (e.g. some private modes); the app still works, just without history. */
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  states: Record<string, QuestionState>;
  attempts: AttemptRecord[];
  sessions: SessionRecord[];

  load: () => Promise<void>;
  recordAnswer: (q: Question, rec: AnswerRecord, sessionId: string, mode: SessionMode) => void;
  setMarked: (q: Question, marked: boolean) => void;
  recordSession: (r: SessionRecord) => void;
  resetSubject: (subject: string) => Promise<void>;
  resetAll: () => Promise<void>;
}

function blankState(q: Question): QuestionState {
  return {
    questionId: q.id,
    subject: q.subject,
    reading: q.reading,
    topic: q.topic,
    lo: q.lo,
    loText: q.loText,
    totalAttempts: 0,
    totalCorrect: 0,
    totalWrong: 0,
    consecutiveCorrect: 0,
    lastResult: null,
    lastAttempted: null,
    lastSelected: null,
    avgTimeSeconds: 0,
    interval: 0,
    repetition: 0,
    efactor: 2.5,
    dueDate: null,
    markedForReview: false,
  };
}

function warn(e: unknown) {
  console.warn('[progress] write failed', e);
}

export const useProgress = create<ProgressState>((set, get) => ({
  status: 'idle',
  states: {},
  attempts: [],
  sessions: [],

  load: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    try {
      const [rows, attempts, sessions] = await Promise.all([getAll('questionState'), getAll('attempts'), getAll('sessions')]);
      const states: Record<string, QuestionState> = {};
      for (const r of rows) states[r.questionId] = r;
      attempts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      set({ status: 'ready', states, attempts, sessions });
    } catch (e) {
      console.warn('[progress] IndexedDB unavailable, progress will not be saved', e);
      set({ status: 'unavailable' });
    }
  },

  recordAnswer: (q, rec, sessionId, mode) => {
    const now = new Date().toISOString();
    const prev = get().states[q.id] ?? blankState(q);
    const n = prev.totalAttempts + 1;
    const state: QuestionState = {
      ...prev,
      subject: q.subject,
      reading: q.reading,
      topic: q.topic,
      lo: q.lo,
      loText: q.loText,
      totalAttempts: n,
      totalCorrect: prev.totalCorrect + (rec.correct ? 1 : 0),
      totalWrong: prev.totalWrong + (rec.correct ? 0 : 1),
      consecutiveCorrect: rec.correct ? prev.consecutiveCorrect + 1 : 0,
      lastResult: rec.correct ? 'correct' : 'wrong',
      lastAttempted: now,
      lastSelected: rec.selected,
      avgTimeSeconds: (prev.avgTimeSeconds * prev.totalAttempts + rec.timeTakenSeconds) / n,
    };
    const attempt: AttemptRecord = {
      attemptId: newId('att'),
      questionId: q.id,
      timestamp: now,
      sessionId,
      selectedOption: rec.selected,
      correctOption: q.answer,
      isCorrect: rec.correct,
      timeTakenSeconds: rec.timeTakenSeconds,
      timedOut: rec.timedOut,
      mode,
    };
    set({ states: { ...get().states, [q.id]: state }, attempts: [...get().attempts, attempt] });
    if (get().status === 'ready') putAttempt(attempt, state).catch(warn);
  },

  setMarked: (q, marked) => {
    const prev = get().states[q.id] ?? blankState(q);
    if (prev.markedForReview === marked) return;
    const state = { ...prev, markedForReview: marked };
    set({ states: { ...get().states, [q.id]: state } });
    if (get().status === 'ready') putMany('questionState', [state]).catch(warn);
  },

  recordSession: (r) => {
    const sessions = [...get().sessions.filter((s) => s.sessionId !== r.sessionId), r];
    set({ sessions });
    if (get().status === 'ready') putMany('sessions', [r]).catch(warn);
  },

  resetSubject: async (subject) => {
    const ids = Object.values(get().states)
      .filter((s) => s.subject === subject)
      .map((s) => s.questionId);
    const states = { ...get().states };
    for (const id of ids) delete states[id];
    set({ states });
    if (get().status === 'ready') await deleteQuestionStates(ids);
  },

  resetAll: async () => {
    set({ states: {}, attempts: [], sessions: [] });
    if (get().status === 'ready') await clearStores(['questionState', 'attempts', 'sessions', 'meta']);
  },
}));
