import { create } from 'zustand';
import type { GameBlocks } from './types';
import { buildCorpus } from './corpus';
import type { Corpus } from './corpus';

export const GAME_BLOCKS_URL = '/content/games/game-blocks.json';
const MECHANIC_DATA_PREFIX = 'games/mechanics/';

/** Loads every content/games/mechanics/<id>.json listed in the content manifest; a missing or bad file is skipped. */
async function loadExtras(): Promise<Record<string, unknown>> {
  const extras: Record<string, unknown> = {};
  try {
    const r = await fetch('/content/manifest.json');
    if (!r.ok) return extras;
    const manifest: unknown = await r.json();
    const paths = Array.isArray(manifest)
      ? manifest.filter((p): p is string => typeof p === 'string' && p.startsWith(MECHANIC_DATA_PREFIX) && p.endsWith('.json'))
      : [];
    await Promise.all(
      paths.map(async (p) => {
        try {
          const res = await fetch(`/content/${p}`);
          if (res.ok) extras[p.slice(MECHANIC_DATA_PREFIX.length, -'.json'.length)] = await res.json();
        } catch {
          // One mechanic's data failing to load only disables that mechanic.
        }
      }),
    );
  } catch {
    // No manifest: curated mechanics report themselves unsupported.
  }
  return extras;
}

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
      const [raw, extras] = await Promise.all([
        fetch(GAME_BLOCKS_URL).then(async (r) => {
          if (!r.ok) throw new Error(`game-blocks.json: HTTP ${r.status}`);
          return (await r.json()) as GameBlocks;
        }),
        loadExtras(),
      ]);
      set({ status: 'ready', corpus: buildCorpus(raw, extras) });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
