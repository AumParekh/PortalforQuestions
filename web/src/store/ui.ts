import { create } from 'zustand';
import type { ScopeKind } from '../types';

/** What Session Setup should open with: a "Select by" scope and the rows ticked in it. */
export interface SetupSelection {
  scopeKind: ScopeKind;
  selectedKeys: string[];
}

interface UiState {
  /** True once saved progress is loaded and any unfinished session is restored (or storage is unavailable). */
  persistenceReady: boolean;
  /** A search query handed from the dashboard to Session Setup, consumed once on arrival. */
  pendingSetupQuery: string | null;
  setPendingSetupQuery: (q: string | null) => void;
  /** A scope and selection handed from the dashboard to Session Setup (a tier card), consumed once on arrival. */
  pendingSetupSelection: SetupSelection | null;
  setPendingSetupSelection: (s: SetupSelection | null) => void;
}

export const useUi = create<UiState>((set) => ({
  persistenceReady: false,
  pendingSetupQuery: null,
  setPendingSetupQuery: (q) => set({ pendingSetupQuery: q }),
  pendingSetupSelection: null,
  setPendingSetupSelection: (s) => set({ pendingSetupSelection: s }),
}));
