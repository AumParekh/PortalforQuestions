import { useMemo } from 'react';
import { useFormulaDeck } from './deck';
import { buildIndex } from './games';
import type { DeckIndex } from './games';

/** Deck-wide lookups (twins, neighbours by reading and area), rebuilt only when the deck changes. */
export function useDeckIndex(): DeckIndex {
  const formulas = useFormulaDeck((s) => s.formulas);
  const byId = useFormulaDeck((s) => s.byId);
  const twinsOf = useFormulaDeck((s) => s.twinsOf);
  return useMemo(() => buildIndex(formulas, byId, twinsOf), [formulas, byId, twinsOf]);
}
