import type { Band, LoKind } from '../../types';

const TONE: Record<Band, string> = {
  P1: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
  P2: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
  P3: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100',
  P4: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

export const BAND_MEANING: Record<Band, string> = {
  P1: 'most important',
  P2: 'important',
  P3: 'worth covering',
  P4: 'not flagged, still examinable',
};

/** Priority band of a learning objective (Master LO Map). */
export function BandBadge({ band }: { band: Band }) {
  return (
    <span
      title={`Priority ${band.slice(1)}: ${BAND_MEANING[band]}`}
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[13px] font-semibold leading-none ${TONE[band]}`}
    >
      {band}
      <span className="sr-only"> ({BAND_MEANING[band]})</span>
    </span>
  );
}

export const KIND_MEANING: Record<LoKind, string> = {
  Numerical: 'the learning objective asks for a calculation',
  Conceptual: 'the learning objective asks to describe or explain',
  Both: 'the learning objective is examined as a calculation and as a concept',
};

/** Type of a learning objective: Numerical, Conceptual or Both. */
export function KindBadge({ kind }: { kind: LoKind }) {
  return (
    <span
      title={KIND_MEANING[kind]}
      className="inline-flex shrink-0 items-center rounded-md border border-slate-300 px-1.5 py-0.5 text-[13px] font-medium leading-none text-slate-700 dark:border-slate-600 dark:text-slate-300"
    >
      {kind}
      <span className="sr-only"> ({KIND_MEANING[kind]})</span>
    </span>
  );
}
