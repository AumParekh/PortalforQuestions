import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { navigate } from '../lib/router';
import { AREA_NAME, MODE_TITLE } from './types';
import type { Scenario, SenseMode } from './types';

export const btnPrimary =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-400';
export const btnSecondary =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800';
export const linkButton =
  '-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15';
export const card = 'rounded-2xl bg-card-light p-5 shadow-sm dark:bg-card-dark sm:p-6';

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function isActivatable(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && !!el.closest('button, a, summary, [role="button"]');
}

/** Window keydown handler while `active`; ignores modified keys and typing in fields. */
export function useKeys(handler: (e: KeyboardEvent) => void, active: boolean) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

/** Page frame with a back button; `onBack` defaults to Home. */
export function Shell({ children, onBack, title = 'Sense Check' }: { children: ReactNode; onBack?: () => void; title?: string }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={onBack ?? (() => navigate('/'))}
            aria-label={onBack ? 'Back' : 'Back to home'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-[720px] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">{children}</main>
    </div>
  );
}

const MODE_TONE: Record<SenseMode, string> = {
  direction: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100',
  magnitude: 'bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-100',
  intermediate: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
};

export function ModeTag({ mode }: { mode: SenseMode }) {
  return <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[15px] font-semibold ${MODE_TONE[mode]}`}>{MODE_TITLE[mode]}</span>;
}

/** "Credit Risk · Reading 88: Hull, …" */
export function ReadingLine({ scenario }: { scenario: Scenario }) {
  return (
    <p className="break-words text-[15px] leading-snug text-slate-600 dark:text-slate-400">
      {AREA_NAME[scenario.area]}
      <span aria-hidden="true"> · </span>
      {scenario.reading}
    </p>
  );
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
