import { useMemo } from 'react';
import type { Band, LoKind, SessionFilters } from '../../types';
import { useContent } from '../../store/content';
import { FilterChip } from './FilterSheet';
import { BAND_OPTIONS, KIND_OPTIONS } from './filterModel';

/**
 * Priority (P1 to P4), LO type (Numerical, Conceptual, Both), "High quality questions only", "Past year questions only" and
 * "Recall workbook only" chips. They narrow the questions; `effect` finishes the helper lines ("go into the session" on Session Setup).
 */
export function ScopeChips({
  filters,
  onChange,
  effect = 'go into the session',
}: {
  filters: SessionFilters;
  onChange: (update: (f: SessionFilters) => SessionFilters) => void;
  effect?: string;
}) {
  const bands = filters.bands ?? [];
  const kinds = filters.kinds ?? [];
  const questions = useContent((s) => s.subjectQuestions);
  const highQuality = useMemo(() => questions.reduce((n, q) => n + (q.highQuality ? 1 : 0), 0), [questions]);
  const pastYear = useMemo(() => questions.reduce((n, q) => n + (q.pastYear ? 1 : 0), 0), [questions]);
  // Kept in the printed order (P1…P4, Numerical…Both) whatever order they were tapped in.
  const toggleBand = (b: Band) =>
    onChange((f) => {
      const cur = f.bands ?? [];
      const next = cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b];
      return { ...f, bands: BAND_OPTIONS.map((o) => o.value).filter((v) => next.includes(v)) };
    });
  const toggleKind = (k: LoKind) =>
    onChange((f) => {
      const cur = f.kinds ?? [];
      const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
      return { ...f, kinds: KIND_OPTIONS.map((o) => o.value).filter((v) => next.includes(v)) };
    });
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Priority" className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-medium text-slate-700 dark:text-slate-300">Priority</span>
        {BAND_OPTIONS.map((b) => (
          <FilterChip key={b.value} active={bands.includes(b.value)} title={b.hint} onClick={() => toggleBand(b.value)}>
            {b.label}
          </FilterChip>
        ))}
      </div>
      <p className="text-[15px] text-slate-600 dark:text-slate-400">
        {bands.length === 0
          ? 'All priorities. P1 is most important; P4 is not flagged but still examinable.'
          : `Only ${bands.join(', ')} questions ${effect}.`}
      </p>
      <div role="group" aria-label="Type" className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-medium text-slate-700 dark:text-slate-300">Type</span>
        {KIND_OPTIONS.map((k) => (
          <FilterChip key={k.value} active={kinds.includes(k.value)} title={k.hint} onClick={() => toggleKind(k.value)}>
            {k.label}
          </FilterChip>
        ))}
      </div>
      <p className="text-[15px] text-slate-600 dark:text-slate-400">
        {kinds.length === 0
          ? 'All types. Each learning objective is Numerical (a calculation), Conceptual (describe or explain) or Both.'
          : `Only questions from ${kinds.join(' and ')} learning objectives ${effect}.`}
      </p>
      <div role="group" aria-label="Question set" className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-medium text-slate-700 dark:text-slate-300">Set</span>
        <FilterChip
          active={filters.highQualityOnly === true}
          title="Only the questions from the high quality question sets"
          onClick={() => onChange((f) => ({ ...f, highQualityOnly: !f.highQualityOnly }))}
        >
          High quality questions only
        </FilterChip>
        <FilterChip
          active={filters.pastYearOnly === true}
          title="Only the questions from past papers: practice exams and the past 10-year papers book"
          onClick={() => onChange((f) => ({ ...f, pastYearOnly: !f.pastYearOnly }))}
        >
          Past year questions only
        </FilterChip>
      </div>
      <p className="text-[15px] text-slate-600 dark:text-slate-400">
        {filters.highQualityOnly && filters.pastYearOnly
          ? `Only questions that are both high quality and from past papers ${effect}.`
          : filters.pastYearOnly
            ? `Only the ${pastYear.toLocaleString()} past year questions ${effect}: practice exams of 2022 to 2026 and the past 10-year papers book.`
            : filters.highQualityOnly
          ? `Only the ${highQuality.toLocaleString()} high quality questions ${effect}.`
          : `All question sets. ${pastYear.toLocaleString()} are past year questions. ${highQuality.toLocaleString()} questions are tagged high quality: one paper per learning objective, each with a full worked solution.`}
      </p>
      <FilterChip
        active={filters.recallOnly === true}
        title="The 199 questions printed in the Recall workbooks (Tier A to D)"
        onClick={() => onChange((f) => ({ ...f, recallOnly: !f.recallOnly }))}
      >
        Recall workbook questions only
      </FilterChip>
    </div>
  );
}
