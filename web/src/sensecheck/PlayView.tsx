import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Timer } from 'lucide-react';
import { haptic } from '../lib/settings';
import { SESSION_SECONDS } from './rotation';
import { RoundView } from './RoundView';
import { remainingMs, useSenseRun } from './store';
import { isActivatable, mmss, prefersReducedMotion, useKeys } from './ui';

/** A miss holds this long, with the correct option rising, before the working unfolds. */
const WRONG_HOLD_MS = 1000;
const WRONG_HOLD_REDUCED_MS = 700;

/** Re-renders every `ms` while `active`. */
function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return now;
}

export function PlayView() {
  const run = useSenseRun((s) => s.run);
  const index = run?.index ?? 0;
  const scenario = run?.plan.rounds[index];
  const result = run?.results[index];
  const total = run?.plan.rounds.length ?? 0;
  const ticking = !!run && run.runningSince !== null;
  const now = useNow(ticking);
  const left = run ? remainingMs(run, ticking ? now : Date.now()) / 1000 : SESSION_SECONDS;

  // Right answers unfold at once; misses hold a beat first.
  const [revealedIndex, setRevealedIndex] = useState(-1);
  const revealed = !!result && revealedIndex === index;
  useEffect(() => {
    if (!result) return;
    if (result.correct) {
      setRevealedIndex(index);
      return;
    }
    const id = window.setTimeout(() => setRevealedIndex(index), prefersReducedMotion() ? WRONG_HOLD_REDUCED_MS : WRONG_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [result, index]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [index, run?.sessionId]);

  // Clock out while a round waits for an answer: the session ends there.
  useEffect(() => {
    if (ticking && left <= 0) useSenseRun.getState().finish(true);
  }, [ticking, left]);

  const answer = useCallback(
    (i: number) => {
      if (result || !scenario?.options[i]) return;
      haptic(scenario.options[i].correct ? 15 : [30, 40, 30]);
      useSenseRun.getState().answer(i);
    },
    [result, scenario],
  );

  const goNext = useCallback(() => {
    if (revealed) useSenseRun.getState().next();
  }, [revealed]);

  useKeys((e) => {
    if (!result) {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= (scenario?.options.length ?? 0)) {
        e.preventDefault();
        answer(n - 1);
      }
      return;
    }
    // Enter only: Space keeps scrolling a long working.
    if (e.key === 'Enter' && !isActivatable(e.target)) {
      e.preventDefault();
      goNext();
    }
  }, !!run);

  const leave = () => {
    const answered = run?.results.length ?? 0;
    if (answered > 0 && answered < total && !window.confirm('Leave this session? Your answers so far are already saved.')) return;
    if (answered > 0) useSenseRun.getState().finish(false);
    else useSenseRun.getState().toIntro();
  };

  if (!run || !scenario) return null;

  const isLast = index + 1 >= total;
  const fraction = Math.max(0, Math.min(1, left / SESSION_SECONDS));
  // Soft pace marker: where the clock would stand at the end of this round on an even pace.
  const pace = Math.max(0, 1 - (index + 1) / Math.max(1, total));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-4 py-1">
          <button
            type="button"
            onClick={leave}
            aria-label="Leave session"
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
            Round {index + 1} of {total}
          </p>
          <p
            className={`ml-auto inline-flex items-center gap-1.5 text-[15px] font-semibold tabular-nums ${
              left <= 20 ? 'text-red-700 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            <Timer className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Time left </span>
            {mmss(left)}
            {!ticking && <span className="font-medium text-slate-500 dark:text-slate-400">paused</span>}
          </p>
        </div>
        <div
          className="relative h-1 w-full bg-slate-200 dark:bg-slate-800"
          role="progressbar"
          aria-label="Session time left"
          aria-valuemin={0}
          aria-valuemax={SESSION_SECONDS}
          aria-valuenow={Math.ceil(left)}
        >
          <div
            className={`h-full transition-[width] duration-300 ease-linear motion-reduce:transition-none ${
              left <= 20 ? 'bg-red-500' : ticking ? 'bg-primary' : 'bg-primary/50'
            }`}
            style={{ width: `${fraction * 100}%` }}
          />
          <div className="absolute inset-y-0 w-0.5 bg-slate-500 dark:bg-slate-400" style={{ left: `${pace * 100}%` }} aria-hidden="true" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8 pt-5">
        <RoundView key={`${run.sessionId}-${index}`} scenario={scenario} result={result} revealed={revealed} onAnswer={answer} />
      </main>

      {revealed && (
        <footer className="sticky bottom-0 z-30 border-t border-slate-200 bg-surface-light/90 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/90">
          <div className="mx-auto w-full max-w-[720px] px-4">
            <button
              type="button"
              onClick={goNext}
              className="inline-flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-lg font-semibold text-white shadow-sm hover:bg-primary-600"
            >
              {isLast ? 'See how you did' : 'Next'}
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only"> (Enter)</span>
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
