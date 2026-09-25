import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Markdown } from '../components/Markdown';
import { areaName, readingTitle } from './deck';
import { Tex } from './tex';
import type { Formula } from './types';

export const btnPrimary =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-400';
export const btnSecondary =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800';
export const btnSmall =
  'min-h-[44px] rounded-xl border border-slate-200 px-3 text-[15px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';
export const card = 'rounded-2xl bg-card-light p-5 shadow-sm dark:bg-card-dark sm:p-6';

/** Choice button tones before and after an answer. */
export function choiceTone(state: 'idle' | 'right' | 'wrong' | 'muted' | 'selected'): string {
  switch (state) {
    case 'right':
      return 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-100';
    case 'wrong':
      return 'border-red-600 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-500/15 dark:text-red-100';
    case 'muted':
      return 'border-slate-200 bg-card-light text-slate-600 dark:border-slate-700 dark:bg-card-dark dark:text-slate-400';
    case 'selected':
      return 'border-primary bg-primary-50 text-slate-900 dark:border-primary dark:bg-primary/15 dark:text-slate-50';
    default:
      return 'border-slate-200 bg-card-light text-slate-900 hover:bg-slate-50 active:bg-slate-100 dark:border-slate-700 dark:bg-card-dark dark:text-slate-50 dark:hover:bg-slate-800';
  }
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function isActivatable(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && !!el.closest('button, a, summary, [role="button"]');
}

/**
 * Window keydown handler while `active`; ignores modified keys, typing in fields, auto-repeat (a held Enter
 * must not answer the next round too) and Enter/Space on a focused button, which the button itself handles.
 */
export function useKeys(handler: (e: KeyboardEvent) => void, active: boolean) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      if ((e.key === 'Enter' || e.key === ' ') && isActivatable(e.target)) return;
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

/** "MR-11 · Title" line shown above a formula. */
export function ReadingLine({ formula }: { formula: Formula }) {
  const title = readingTitle(formula.readingId);
  return (
    <p className="break-words text-[15px] leading-snug text-slate-600 dark:text-slate-400">
      {areaName(formula.area)}
      <span aria-hidden="true"> · </span>
      {formula.readingId}
      {title ? `: ${title}` : ''}
    </p>
  );
}

/** Plain text that may carry $…$ math. */
export function Text({ children, className = '' }: { children: string; className?: string }) {
  return <Markdown className={`text-base leading-relaxed ${className}`}>{children}</Markdown>;
}

export function VariableList({ formula, className = '' }: { formula: Formula; className?: string }) {
  if (formula.variables.length === 0) return null;
  return (
    <dl className={`space-y-1.5 ${className}`}>
      {formula.variables.map((v) => (
        <div key={v.symbol} className="flex items-baseline gap-3">
          <dt className="min-w-[3.5rem] shrink-0 text-right">
            <Tex latex={v.symbol} />
          </dt>
          <dd className="min-w-0 flex-1 break-words text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">{v.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The correct formula with its variables and intuition: shown after every answer and in the summary. */
export function FormulaAnswer({ formula, showVariables = true }: { formula: Formula; showVariables?: boolean }) {
  return (
    <div className="space-y-3">
      <Tex latex={formula.latex} display label={formula.name} />
      {formula.intuition && (
        <div className="rounded-xl bg-primary-50 px-3 py-2 dark:bg-primary/15">
          <Text className="text-slate-800 dark:text-slate-100">{formula.intuition}</Text>
        </div>
      )}
      {showVariables && <VariableList formula={formula} />}
    </div>
  );
}

export function Verdict({ correct, children }: { correct: boolean; children?: ReactNode }) {
  return (
    <p
      className={`flex items-center gap-2 text-lg font-semibold ${
        correct ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
      }`}
    >
      {correct ? <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" /> : <XCircle className="h-5 w-5 shrink-0" aria-hidden="true" />}
      {children ?? (correct ? 'Correct' : 'Not quite')}
    </p>
  );
}

/** Card header: game name, the formula's name and where it comes from. */
export function RoundHeader({ formula, title, hideName = false }: { formula: Formula; title: string; hideName?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[15px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-100">{title}</p>
      {!hideName && <h2 className="break-words text-xl font-semibold leading-snug text-slate-900 dark:text-slate-50">{formula.name}</h2>}
      <ReadingLine formula={formula} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ml-1 hidden rounded border border-current px-1.5 text-[15px] font-medium opacity-70 sm:inline">{children}</kbd>;
}
