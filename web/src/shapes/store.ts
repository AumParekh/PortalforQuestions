import { create } from 'zustand';
import type { ShapeTopic, ShapesFile } from './types';

interface ShapesState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  topics: ShapeTopic[];
  load: () => Promise<void>;
}

/** content/shapes/shapes.json: built by tools/content/build_shapes.py. Absent or unreadable: the area stays empty. */
export const useShapes = create<ShapesState>((set, get) => ({
  status: 'idle',
  topics: [],
  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading' });
    try {
      const r = await fetch('/content/shapes/shapes.json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const file = (await r.json()) as ShapesFile;
      set({ status: 'ready', topics: Array.isArray(file.topics) ? file.topics : [] });
    } catch {
      set({ status: 'error', topics: [] });
    }
  },
}));
