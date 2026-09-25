import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Check, Minus, Plus, X } from 'lucide-react';
import type { SessionFilters } from '../../types';
import { EMPTY_FILTERS, MAX_THRESHOLD, STATUS_OPTIONS, TIME_OPTIONS, TRAP_OPTIONS, activeFilterCount } from './filterModel';

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterChip({
  active,
  disabled = false,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-2 text-left text-[15px] font-medium leading-snug transition-colors disabled:cursor-not-allowed ${
        disabled
          ? 'border-dashed border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-500'
          : active
            ? 'border-transparent bg-primary-50 text-primary-700 ring-1 ring-primary dark:bg-primary/15 dark:text-primary-100'
            : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {active && <Check className="h-4 w-4 shrink-0" strokeWidth={3} aria-hidden="true" />}
      {children}
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {hint && <p className="text-[15px] text-slate-600 dark:text-slate-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const TRI: { value: boolean | null; label: string }[] = [
  { value: null, label: 'Any' },
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
];

function TriState({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <span className="text-base">{label}</span>
      <div role="group" aria-label={label} className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {TRI.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.label}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={`min-h-[44px] min-w-[60px] rounded-lg px-3 text-[15px] font-medium transition-colors ${
                active
                  ? 'bg-card-light text-primary-700 shadow-sm dark:bg-card-dark dark:text-primary-100'
                  : 'text-slate-700 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-700/60'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const btn =
    'flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/60';
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <span className="text-base">{label}</span>
      <div role="group" aria-label={label} className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= 0} onClick={() => onChange(value - 1)} className={btn}>
          <Minus className="h-5 w-5" aria-hidden="true" />
        </button>
        <span aria-live="polite" className="min-w-[3.5rem] text-center text-[15px] font-semibold tabular-nums">
          {value === 0 ? 'Off' : `≥ ${value}`}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= MAX_THRESHOLD}
          onClick={() => onChange(value + 1)}
          className={btn}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function FilterSheet({
  open,
  value,
  onApply,
  onClose,
  countFor,
}: {
  open: boolean;
  value: SessionFilters;
  onApply: (f: SessionFilters) => void;
  onClose: () => void;
  /** Questions the session would contain with these filters, or null when nothing is selected yet. */
  countFor: (f: SessionFilters) => number | null;
}) {
  const [draft, setDraft] = useState<SessionFilters>(value);
  const [shown, setShown] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    setDraft(valueRef.current);
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      setShown(true);
      panelRef.current?.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const set = <K extends keyof SessionFilters>(key: K, v: SessionFilters[K]) => setDraft((d) => ({ ...d, [key]: v }));

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const count = countFor(draft);
  const draftActive = activeFilterCount(draft);

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/50 transition-opacity duration-200 motion-reduce:transition-none dark:bg-black/60 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-sheet-title"
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={`absolute inset-x-0 bottom-0 flex max-h-[90vh] flex-col rounded-t-2xl border-t border-slate-200 bg-card-light shadow-2xl outline-none transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none dark:border-slate-700 dark:bg-card-dark md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[85vh] md:w-[560px] md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2 md:rounded-2xl md:border ${
          shown
            ? 'translate-y-0 md:-translate-y-1/2 md:scale-100 md:opacity-100'
            : 'translate-y-full md:-translate-y-1/2 md:scale-95 md:opacity-0'
        }`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 pb-3 pt-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2 id="filter-sheet-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Filter questions
            </h2>
            <p className="text-[15px] text-slate-600 dark:text-slate-400">
              Narrows which questions from your selection go into the session.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close filters"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4">
          <Section title="Status" hint="Matches any of the selected.">
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((o) => (
                <FilterChip
                  key={o.value}
                  active={draft.status.includes(o.value)}
                  onClick={() => set('status', toggleIn(draft.status, o.value))}
                >
                  {o.label}
                </FilterChip>
              ))}
            </div>
            <p className="text-[15px] text-slate-600 dark:text-slate-400">
              Due for review: questions whose spaced-repetition review date is today or earlier.
            </p>
          </Section>

          <Section title="Trap type" hint="Questions with any of the selected traps.">
            <div className="flex flex-wrap gap-2">
              {TRAP_OPTIONS.map((o) => (
                <FilterChip
                  key={o.value}
                  active={draft.trapOperators.includes(o.value)}
                  onClick={() => set('trapOperators', toggleIn(draft.trapOperators, o.value))}
                >
                  {o.label}
                </FilterChip>
              ))}
            </div>
          </Section>

          <Section title="Content">
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              <TriState label="Has trap card" value={draft.hasTrap} onChange={(v) => set('hasTrap', v)} />
              <TriState label="Has table" value={draft.hasTable} onChange={(v) => set('hasTable', v)} />
              <TriState label="Has formula" value={draft.hasFormula} onChange={(v) => set('hasFormula', v)} />
            </div>
          </Section>

          <Section title="Time target" hint="By your average answer time. Questions you haven't tried don't match.">
            <div className="flex flex-wrap gap-2">
              {TIME_OPTIONS.map((o) => (
                <FilterChip
                  key={o.value}
                  active={draft.timeTarget.includes(o.value)}
                  onClick={() => set('timeTarget', toggleIn(draft.timeTarget, o.value))}
                >
                  {o.label}
                </FilterChip>
              ))}
            </div>
          </Section>

          <Section title="Answer history" hint="Total times you've answered each question correctly or wrongly.">
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              <Stepper label="Correct at least" value={draft.minCorrect} onChange={(v) => set('minCorrect', v)} />
              <Stepper label="Wrong at least" value={draft.minWrong} onChange={(v) => set('minWrong', v)} />
            </div>
          </Section>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-slate-200 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-700">
          <button
            type="button"
            onClick={() => setDraft(EMPTY_FILTERS)}
            disabled={draftActive === 0}
            className="min-h-[48px] rounded-xl border border-slate-200 px-4 text-[15px] font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
            className="min-h-[48px] flex-1 rounded-xl bg-primary px-4 font-semibold text-white shadow-sm hover:bg-primary-600"
          >
            {count === null ? 'Apply' : `Apply · ${count} ${count === 1 ? 'question' : 'questions'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
