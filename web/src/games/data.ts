import { create } from 'zustand';
import type { GameBlocks } from './types';
import { buildCorpus } from './corpus';
import type { Corpus } from './corpus';

export const GAME_BLOCKS_URL = '/content/games/game-blocks.json';

interface GameDataState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Normalised content plus derived lookups (readings by area, items by id, trap_index). Null until ready. */
  corpus: Corpus | null;
  load: () => Promise<void>;
}

/** Lazy loader for game-blocks.json: nothing is fetched until the games screen asks for it. */
export const useGameData = create<GameDataState>((set, get) => ({
  status: 'idle',
  error: null,
  corpus: null,
  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null });
    try {
      const r = await fetch(GAME_BLOCKS_URL);
      if (!r.ok) throw new Error(`game-blocks.json: HTTP ${r.status}`);
      const raw = (await r.json()) as GameBlocks;
      set({ status: 'ready', corpus: buildCorpus(raw) });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
