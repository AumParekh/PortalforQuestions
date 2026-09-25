import { create } from 'zustand';
import type { TFAttempt, TFCard, TFState } from '../types';
import { getAll, putTfAttempt } from '../lib/db';
import { newId } from './session';

interface DeckFile {
  type: 'truefalse';
  subject: string;
  cards: TFCard[];
}

interface TfStore {
  deckStatus: 'idle' | 'loading' | 'ready' | 'error';
  deckError: string | null;
  cards: TFCard[];
  byId: Record<string, TFCard>;
  /** 'unavailable' when IndexedDB can't be used; answers then live only in memory. */
  progressStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  states: Record<string, TFState>;
  attempts: TFAttempt[];

  loadDeck: () => Promise<void>;
  loadProgress: () => Promise<void>;
  recordAnswer: (card: TFCard, answeredTrue: boolean, timeTakenSeconds: number, sessionId: string) => boolean;
  clearAll: () => void;
}

export const useTf = create<TfStore>((set, get) => ({
  deckStatus: 'idle',
  deckError: null,
  cards: [],
  byId: {},
  progressStatus: 'idle',
  states: {},
  attempts: [],

  loadDeck: async () => {
    if (get().deckStatus === 'loading' || get().deckStatus === 'ready') return;
    set({ deckStatus: 'loading', deckError: null });
    try {
      const manifest: string[] = await fetch('/content/manifest.json').then((r) => {
        if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
        return r.json();
      });
      const paths = manifest.filter((p) => p.startsWith('flashcards/')).sort();
      const decks = await Promise.all(
        paths.map(async (p) => {
          const r = await fetch(`/content/${p}`);
          if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
          return (await r.json()) as DeckFile | null;
        }),
      );
      // Only real decks: any other JSON dropped into flashcards/ (reports, etc.) is ignored.
      const cards = decks.flatMap((d) => (d?.type === 'truefalse' && Array.isArray(d.cards) ? d.cards : []));
      const byId: Record<string, TFCard> = {};
      for (const c of cards) byId[c.id] = c;
      set({ deckStatus: 'ready', cards, byId });
    } catch (e) {
      set({ deckStatus: 'error', deckError: e instanceof Error ? e.message : String(e) });
    }
  },

  loadProgress: async () => {
    if (get().progressStatus !== 'idle') return;
    set({ progressStatus: 'loading' });
    try {
      const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('IndexedDB timed out')), 4000));
      const [rows, attempts] = await Promise.race([Promise.all([getAll('tfState'), getAll('tfAttempts')]), timeout]);
      const states: Record<string, TFState> = {};
      for (const r of rows) states[r.cardId] = r;
      attempts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      set({ progressStatus: 'ready', states, attempts });
    } catch (e) {
      console.warn('[tf] progress unavailable', e);
      set({ progressStatus: 'unavailable' });
    }
  },

  recordAnswer: (card, answeredTrue, timeTakenSeconds, sessionId) => {
    const isCorrect = answeredTrue === card.isTrue;
    const now = new Date().toISOString();
    const prev = get().states[card.id];
    const state: TFState = {
      cardId: card.id,
      subject: card.subject,
      topic: card.topic,
      totalAttempts: (prev?.totalAttempts ?? 0) + 1,
      totalCorrect: (prev?.totalCorrect ?? 0) + (isCorrect ? 1 : 0),
      totalWrong: (prev?.totalWrong ?? 0) + (isCorrect ? 0 : 1),
      lastResult: isCorrect ? 'correct' : 'wrong',
      lastAttempted: now,
    };
    const attempt: TFAttempt = { attemptId: newId('tfa'), cardId: card.id, sessionId, timestamp: now, answeredTrue, isCorrect, timeTakenSeconds };
    set({ states: { ...get().states, [card.id]: state }, attempts: [...get().attempts, attempt] });
    if (get().progressStatus === 'ready') putTfAttempt(attempt, state).catch((e) => console.warn('[tf] write failed', e));
    return isCorrect;
  },

  clearAll: () => set({ states: {}, attempts: [] }),
}));
