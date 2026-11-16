import { create } from 'zustand';
import type { RecallTier, ScopeKind } from '../types';

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
  /** Which view the Question library should open on (handed over by a dashboard card), consumed once on arrival. */
  pendingLibraryView: 'all' | 'marked' | null;
  setPendingLibraryView: (v: 'all' | 'marked' | null) => void;
  /** Which tier Exam shapes should open on (handed over by a tier card), consumed once on arrival. */
  pendingShapesTier: RecallTier | null;
  setPendingShapesTier: (t: RecallTier | null) => void;
}

export const useUi = create<UiState>((set) => ({
  persistenceReady: false,
  pendingSetupQuery: null,
  setPendingSetupQuery: (q) => set({ pendingSetupQuery: q }),
  pendingSetupSelection: null,
  setPendingSetupSelection: (s) => set({ pendingSetupSelection: s }),
  pendingLibraryView: null,
  setPendingLibraryView: (v) => set({ pendingLibraryView: v }),
  pendingShapesTier: null,
  setPendingShapesTier: (t) => set({ pendingShapesTier: t }),
}));
