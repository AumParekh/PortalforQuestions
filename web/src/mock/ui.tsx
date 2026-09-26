import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Clock } from 'lucide-react';
import { navigate } from '../lib/router';
import { clockLevel, clockText } from './model';
import type { ClockLevel } from './model';

export const btnPrimary =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-400';
export const btnSecondary =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800';
export const btnDangerText =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40';
export const card = 'rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark sm:p-5';
export const sectionTitle = 'text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400';
export const iconButton =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

/** Page frame with a back button (Home unless `onBack` is given). */
export function Shell({ title, onBack, backLabel = 'Back to home', children }: { title: string; onBack?: () => void; backLabel?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center gap-2 px-2 py-2">
          <button type="button" onClick={onBack ?? (() => navigate('/'))} aria-label={backLabel} className={iconButton}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="min-w-0 break-words text-lg font-semibold leading-snug">{title}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-[720px] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">{children}</main>
    </div>
  );
}

const CLOCK_TONE: Record<ClockLevel, string> = {
  normal: 'text-slate-800 dark:text-slate-100',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
};

/** The exam countdown: mm:ss, amber from 10 minutes left, red from 2. */
export function Countdown({ remainingSeconds }: { remainingSeconds: number }) {
  const level = clockLevel(remainingSeconds);
  const m = Math.floor(remainingSeconds / 60);
  return (
    <span
      role="timer"
      aria-label={`${m} ${m === 1 ? 'minute' : 'minutes'} ${Math.floor(remainingSeconds % 60)} seconds left`}
      data-level={level}
      className={`inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg px-2 font-mono text-base font-semibold tabular-nums ${CLOCK_TONE[level]}`}
    >
      <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
      {clockText(remainingSeconds)}
    </span>
  );
}

export function Stat({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <div className="text-[15px] text-slate-600 dark:text-slate-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${className}`}>{value}</div>
    </div>
  );
}

/** The current time, refreshed every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
