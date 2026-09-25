import { create } from 'zustand';
import type { CoverageRow, ItemSrs, SessionLog } from './types';
import { clearGamesDb, getAllRows, putRows, putSessionWithCoverage } from './db';
import { localDate, sm2 } from './srs';
import type { ReviewMeta } from './srs';

interface GameProgressState {
  /** 'unavailable' when the frm-games IndexedDB can't be opened; play still works, in memory only. */
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  /** Oldest → newest. */
  sessions: SessionLog[];
  items: Record<string, ItemSrs>;
  coverage: Record<string, CoverageRow>;

  load: () => Promise<void>;
  /** One SM-2 step for an item; every answer in every mechanic goes through here. */
  review: (itemId: string, grade: number, meta?: ReviewMeta) => ItemSrs;
  /** Appends a closed session and (if its arc completed) marks its objectives closed. */
  recordSession: (log: SessionLog) => void;
  resetAll: () => Promise<void>;
}

function warn(e: unknown) {
  console.warn('[games] write failed', e);
}

export const useGameProgress = create<GameProgressState>((set, get) => ({
  status: 'idle',
  sessions: [],
  items: {},
  coverage: {},

  load: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    try {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('frm-games timed out')), 5000));
      const [sessions, items, coverage] = await Promise.race([
        Promise.all([getAllRows('sessions'), getAllRows('items'), getAllRows('coverage')]),
        timeout,
      ]);
      sessions.sort((a, b) => a.number - b.number || a.timestamp.localeCompare(b.timestamp));
      // Anything answered before load finished lives in memory; keep the newer of the two.
      const mem = get();
      const itemMap: Record<string, ItemSrs> = {};
      for (const r of items) itemMap[r.itemId] = r;
      for (const r of Object.values(mem.items)) itemMap[r.itemId] = r;
      const covMap: Record<string, CoverageRow> = {};
      for (const r of coverage) covMap[r.objectiveId] = r;
      set({ status: 'ready', sessions, items: itemMap, coverage: covMap });
    } catch (e) {
      console.warn('[games] IndexedDB unavailable, game history will not be saved', e);
      set({ status: 'unavailable' });
    }
  },

  review: (itemId, grade, meta) => {
    const next = sm2(get().items[itemId], itemId, grade, new Date(), meta);
    set({ items: { ...get().items, [itemId]: next } });
    if (get().status === 'ready') putRows('items', [next]).catch(warn);
    return next;
  },

  recordSession: (log) => {
    const coverage = { ...get().coverage };
    const touched: CoverageRow[] = [];
    if (log.completed) {
      for (const objectiveId of log.objectivesClosed) {
        const prev = coverage[objectiveId];
        const row: CoverageRow = {
          objectiveId,
          readingId: log.readingId,
          closedAt: log.timestamp,
          firstClosedAt: prev?.firstClosedAt ?? log.timestamp,
          times: (prev?.times ?? 0) + 1,
        };
        coverage[objectiveId] = row;
        touched.push(row);
      }
    }
    const sessions = [...get().sessions.filter((s) => s.sessionId !== log.sessionId), log];
    set({ sessions, coverage });
    if (get().status === 'ready') putSessionWithCoverage(log, touched).catch(warn);
  },

  resetAll: async () => {
    set({ sessions: [], items: {}, coverage: {} });
    if (get().status === 'ready') await clearGamesDb();
  },
}));

/** Shared spaced-repetition entry point: `review(itemId, grade)` from anywhere. */
export function review(itemId: string, grade: number, meta?: ReviewMeta): ItemSrs {
  return useGameProgress.getState().review(itemId, grade, meta);
}

/** Local dates (YYYY-MM-DD) with at least one game session: for the dashboard streak / daily goal. */
export function gameDays(sessions: readonly SessionLog[]): string[] {
  return [...new Set(sessions.map((s) => localDate(new Date(s.timestamp))))].sort();
}
