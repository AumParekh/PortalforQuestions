import { create } from 'zustand';

interface UiState {
  /** True once saved progress is loaded and any unfinished session is restored (or storage is unavailable). */
  persistenceReady: boolean;
  /** A search query handed from the dashboard to Session Setup, consumed once on arrival. */
  pendingSetupQuery: string | null;
  setPendingSetupQuery: (q: string | null) => void;
}

export const useUi = create<UiState>((set) => ({
  persistenceReady: false,
  pendingSetupQuery: null,
  setPendingSetupQuery: (q) => set({ pendingSetupQuery: q }),
}));
