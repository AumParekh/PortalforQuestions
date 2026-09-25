import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Gavel, Timer } from 'lucide-react';
import { useFormulaDeck } from './deck';
import { GAME_BY_ID } from './games';
import type { Round } from './rounds';
import { useGymRun } from './run';
import type { RoundResult } from './run';
import type { Formula } from './types';
import { isActivatable, useKeys } from './ui';
import { RecallRound } from './play/RecallRound';
import { ForgeRound } from './play/ForgeRound';
import { RiggedRound, SpotRound } from './play/RiggedRound';
import { WhichWayRound } from './play/WhichWayRound';
import { SymbolsRound } from './play/SymbolsRound';
import { CalcRound } from './play/CalcRound';
import { TwinsRound } from './play/TwinsRound';
import { MemoryBoard } from './play/MemoryBoard';
import { RepairRound } from './play/RepairRound';
import { AuctionRound } from './play/AuctionRound';

/** In timed games a right answer moves on by itself after this pause. */
const AUTO_NEXT_MS = 1100;

function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds left on a timed run, ticking; null for untimed runs. */
function useCountdown(startedAt: number | undefined, limit: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!limit) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [limit, startedAt]);
  if (!limit || startedAt === undefined) return null;
  return Math.max(0, limit - (now - startedAt) / 1000);
}

function RoundView({ round, byId, result, timeUp, bid }: { round: Round; byId: Record<string, Formula>; result?: RoundResult; timeUp: boolean; bid: number | null }) {
  const formula = byId[round.ids[0]];
  if (round.game === 'twins') return <TwinsRound round={round} byId={byId} result={result} />;
  if (round.game === 'memory') return <MemoryBoard round={round} byId={byId} result={result} timeUp={timeUp} />;
  if (!formula) return <p className="py-16 text-center text-slate-600 dark:text-slate-400">This formula could not be found.</p>;
  switch (round.game) {
    case 'recall':
      return <RecallRound round={round} formula={formula} result={result} />;
    case 'forge':
      return <ForgeRound round={round} formula={formula} result={result} />;
    case 'rigged':
      return <RiggedRound round={round} formula={formula} result={result} />;
    case 'spot':
      return <SpotRound round={round} formula={formula} result={result} />;
    case 'whichway':
      return <WhichWayRound round={round} formula={formula} result={result} />;
    case 'symbols':
      return <SymbolsRound round={round} formula={formula} result={result} />;
    case 'calc':
      return <CalcRound round={round} formula={formula} result={result} />;
    case 'repair':
      return <RepairRound round={round} formula={formula} result={result} />;
    case 'auction':
      return <AuctionRound round={round} formula={formula} result={result} bid={bid} />;
  }
}

export function PlayView() {
  const run = useGymRun((s) => s.run);
  const byId = useFormulaDeck((s) => s.byId);

  const index = run?.index ?? 0;
  const round = run?.rounds[index];
  const result = run?.results[index];
  const total = run?.rounds.length ?? 0;
  const answered = run?.results.length ?? 0;
  const isLast = index + 1 >= total;
  const timed = !!run?.timeLimit;
  const left = useCountdown(run?.startedAt, run?.timeLimit);
  const timeUp = left !== null && left <= 0;

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [index, run?.sessionId]);

  // Clock out: end the session, once a Memory board has logged what it saw.
  useEffect(() => {
    if (!timeUp || !round) return;
    if (round.game !== 'memory' || result) useGymRun.getState().finish(true);
  }, [timeUp, round, result]);

  // Timed games keep moving after a right answer.
  useEffect(() => {
    if (!timed || !result?.correct || round?.game === 'memory') return;
    const id = window.setTimeout(() => useGymRun.getState().next(), AUTO_NEXT_MS);
    return () => window.clearTimeout(id);
  }, [timed, result, round]);

  const goNext = useCallback(() => {
    if (result) useGymRun.getState().next();
  }, [result]);

  useKeys((e) => {
    // Enter only: Space keeps scrolling a long explanation.
    if (e.key === 'Enter' && !isActivatable(e.target)) {
      e.preventDefault();
      goNext();
    }
  }, !!result);

  const leave = () => {
    // A Memory board has no round result until it ends, but its matches are already logged.
    const mid = ((answered > 0 && answered < total) || (round?.game === 'memory' && !result)) && !timeUp;
    if (mid && !window.confirm('Leave this session? Your answers so far are already saved.')) return;
    if (answered > 0) useGymRun.getState().finish(false);
    else useGymRun.getState().toSetup();
  };

  if (!run || !round) return null;

  const progress = total > 0 ? (answered / total) * 100 : 0;

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
          <div className="shrink-0">
            <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {round.game === 'memory' ? 'Memory Match' : `${index + 1} / ${total}`}
            </p>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {run.bid !== null && (
              <p className="inline-flex items-center gap-1.5 text-[15px] font-semibold tabular-nums text-primary-700 dark:text-primary-100" aria-label={`Bid ${run.bid}`}>
                <Gavel className="h-4 w-4" aria-hidden="true" />
                {run.bid}
              </p>
            )}
            {left !== null && (
              <p
                className={`inline-flex items-center gap-1.5 text-[15px] font-semibold tabular-nums ${
                  left <= 10 ? 'text-red-700 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'
                }`}
                aria-label={`${Math.ceil(left)} seconds left`}
              >
                <Timer className="h-4 w-4" aria-hidden="true" />
                {mmss(left)}
              </p>
            )}
            {run.mode === 'workout' && (
              <p className="min-w-0 text-right text-[15px] font-medium leading-snug text-slate-600 dark:text-slate-400">Workout · {GAME_BY_ID[round.game].label}</p>
            )}
          </div>
        </div>
        <div
          className="h-1 w-full bg-slate-200 dark:bg-slate-800"
          role="progressbar"
          aria-label="Rounds answered"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answered}
        >
          <div className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8 pt-5">
        <RoundView key={round.key} round={round} byId={byId} result={result} timeUp={timeUp} bid={run.bid} />
      </main>

      {result && (
        <footer className="sticky bottom-0 z-30 border-t border-slate-200 bg-surface-light/90 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/90">
          <div className="mx-auto w-full max-w-[720px] px-4">
            <button
              type="button"
              onClick={goNext}
              className="inline-flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-lg font-semibold text-white shadow-sm hover:bg-primary-600"
            >
              {isLast ? 'See results' : 'Next'}
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only"> (Enter)</span>
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
