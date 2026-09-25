import { useMemo, useState } from 'react';
import { ChevronDown, Home, Layers, RotateCcw } from 'lucide-react';
import { navigate } from '../../lib/router';
import { useTf } from '../../store/tf';
import { Markdown } from '../Markdown';
import type { TFCard } from '../../types';
import { mmss, pct, shuffle } from './deck';
import { useTfRun } from './run';
import type { TfResult } from './run';
import { TfExplanation } from './TfPlayView';

function AccuracyRing({ value }: { value: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const tone = value >= 70 ? 'text-emerald-500' : value >= 50 ? 'text-amber-500' : 'text-red-500';
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={`Accuracy ${value}%`}>
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-slate-200 dark:stroke-slate-700" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          className={`${tone} transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums">{value}%</span>
        <span className="text-[15px] text-slate-600 dark:text-slate-400">accuracy</span>
      </div>
    </div>
  );
}

function Stat({ label, value, className = '' }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
      <div className={`text-lg font-semibold tabular-nums ${className}`}>{value}</div>
      <div className="text-[15px] text-slate-600 dark:text-slate-400">{label}</div>
    </div>
  );
}

function MissedItem({ card, result }: { card: TFCard; result: TfResult }) {
  const [open, setOpen] = useState(false);
  const panelId = `tf-missed-${card.id}`;
  return (
    <li className="rounded-2xl border-2 border-red-200 bg-card-light p-4 shadow-sm dark:border-red-500/40 dark:bg-card-dark">
      <p className="break-words text-[15px] leading-snug text-slate-600 dark:text-slate-400">
        {card.subject}
        <span aria-hidden="true"> · </span>
        {card.topic}
      </p>
      <Markdown className="mt-2 text-lg font-medium leading-relaxed text-slate-900 dark:text-slate-50">{card.statement}</Markdown>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-900 dark:bg-slate-700 dark:text-slate-50">
          This statement is {card.isTrue ? 'TRUE' : 'FALSE'}
        </span>
        <span className="text-red-700 dark:text-red-400">You said {result.answeredTrue ? 'True' : 'False'}</span>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="-ml-2 mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
      >
        {open ? 'Hide explanation' : 'Show explanation'}
        <ChevronDown
          className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={panelId} className="mt-1 border-t border-slate-200 pt-3 dark:border-slate-700">
          <TfExplanation card={card} />
        </div>
      )}
    </li>
  );
}

export function TfSummaryView() {
  const run = useTfRun((s) => s.run);
  const byId = useTf((s) => s.byId);

  const summary = useMemo(() => {
    const results = run?.results ?? [];
    const correct = results.filter((r) => r.correct).length;
    const seconds = results.reduce((n, r) => n + r.seconds, 0);
    const missed = results.filter((r) => !r.correct && byId[r.cardId]).map((r) => ({ card: byId[r.cardId], result: r }));
    return { answered: results.length, correct, wrong: results.length - correct, seconds, missed };
  }, [run, byId]);

  const accuracy = pct(summary.correct, summary.answered);
  const missedIds = [...new Set(summary.missed.map((m) => m.card.id))];

  const btn =
    'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors motion-reduce:transition-none';

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-[720px] space-y-6 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold">Deck complete</h1>

        <section className="flex flex-col items-center gap-5 rounded-2xl bg-card-light p-5 shadow-sm dark:bg-card-dark sm:flex-row sm:items-center">
          <AccuracyRing value={accuracy} />
          <div className="grid w-full grid-cols-2 gap-2">
            <Stat label="correct" value={summary.correct} className="text-emerald-700 dark:text-emerald-400" />
            <Stat label="wrong" value={summary.wrong} className="text-red-700 dark:text-red-400" />
            <Stat label="time" value={mmss(summary.seconds)} />
            <Stat
              label="per statement"
              value={summary.answered > 0 ? `${Math.round(summary.seconds / summary.answered)}s` : '–'}
            />
          </div>
        </section>

        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            disabled={missedIds.length === 0}
            onClick={() => useTfRun.getState().start(shuffle(missedIds))}
            className={`${btn} bg-primary text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-400`}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retry missed{missedIds.length > 0 ? ` (${missedIds.length})` : ''}
          </button>
          <button
            type="button"
            onClick={() => useTfRun.getState().toSetup()}
            className={`${btn} border border-slate-200 text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800`}
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
            New deck
          </button>
          <button
            type="button"
            onClick={() => {
              useTfRun.getState().toSetup();
              navigate('/');
            }}
            className={`${btn} border border-slate-200 text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800`}
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Home
          </button>
        </div>

        <section aria-labelledby="tf-missed" className="space-y-3">
          <h2 id="tf-missed" className="text-lg font-semibold">
            Missed statements
          </h2>
          {summary.missed.length === 0 ? (
            <p className="rounded-2xl bg-card-light p-4 text-slate-700 shadow-sm dark:bg-card-dark dark:text-slate-300">
              No misses in this deck. Every statement judged correctly.
            </p>
          ) : (
            <ul className="space-y-3">
              {summary.missed.map(({ card, result }) => (
                <MissedItem key={card.id} card={card} result={result} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
