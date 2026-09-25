import { useMemo, useState } from 'react';
import { ChevronDown, Gavel, Home, Layers, RotateCcw } from 'lucide-react';
import { AccuracyRing } from '../components/dashboard/AccuracyRing';
import { StatTile } from '../components/dashboard/StatTile';
import { navigate } from '../lib/router';
import { useFormulaDeck } from './deck';
import { GAME_BY_ID } from './games';
import { useDeckIndex } from './hooks';
import { planSession } from './plan';
import { useGymRun } from './run';
import { useGym } from './storage';
import type { Formula, FormulaGame } from './types';
import { FormulaAnswer, ReadingLine, btnPrimary, btnSecondary } from './ui';

function mmss(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function MissedItem({ formula, games }: { formula: Formula; games: FormulaGame[] }) {
  const [open, setOpen] = useState(true);
  const panelId = `fg-missed-${formula.id}`;
  return (
    <li className="rounded-2xl border-2 border-red-200 bg-card-light p-4 shadow-sm dark:border-red-500/40 dark:bg-card-dark">
      <p className="break-words text-lg font-semibold leading-snug">{formula.name}</p>
      <ReadingLine formula={formula} />
      <p className="mt-1 text-[15px] text-red-700 dark:text-red-400">Missed in {games.map((g) => GAME_BY_ID[g].label).join(', ')}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="-ml-2 mt-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
      >
        {open ? 'Hide formula' : 'Show formula'}
        <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} className="mt-1 border-t border-slate-200 pt-3 dark:border-slate-700">
          <FormulaAnswer formula={formula} />
        </div>
      )}
    </li>
  );
}

export function SummaryView() {
  const run = useGymRun((s) => s.run);
  const byId = useFormulaDeck((s) => s.byId);
  const states = useGym((s) => s.states);
  const index = useDeckIndex();

  const summary = useMemo(() => {
    const results = run?.results ?? [];
    let right = 0;
    let answers = 0;
    const missed = new Map<string, FormulaGame[]>();
    for (const r of results) {
      for (const item of r.items) {
        answers++;
        if (item.correct) right++;
        else if (byId[item.id]) missed.set(item.id, [...new Set([...(missed.get(item.id) ?? []), r.game])]);
      }
    }
    const seconds = results.reduce((n, r) => n + r.seconds, 0);
    return { right, answers, rounds: results.length, seconds, missed: [...missed.entries()].map(([id, games]) => ({ formula: byId[id], games })) };
  }, [run, byId]);

  if (!run) return null;

  const accuracy = summary.answers > 0 ? summary.right / summary.answers : null;
  // A Memory board is one round that is always answered, so for it timedOut alone means the clock beat the board.
  const outOfTime = run.timedOut && (run.results.length < run.rounds.length || run.mode === 'memory');
  const title = run.mode === 'workout' ? 'Workout' : GAME_BY_ID[run.mode].label;

  const drillAgain = () => {
    const formulas = summary.missed.map((m) => m.formula);
    const session = planSession('workout', formulas, states, index, { size: 'all' });
    if (session) useGymRun.getState().start(session);
  };

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-[720px] space-y-6 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
        <div>
          <p className="text-[15px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-100">{title}</p>
          <h1 className="text-2xl font-bold">{outOfTime ? 'Time’s up' : 'Session complete'}</h1>
        </div>

        {run.bid !== null && (
          <section className="flex items-center gap-4 rounded-2xl bg-primary-50 p-5 dark:bg-primary/15">
            <Gavel className="h-8 w-8 shrink-0 text-primary-600 dark:text-primary-100" aria-hidden="true" />
            <div>
              <p className="text-[15px] text-slate-700 dark:text-slate-300">Final bid</p>
              <p className="text-3xl font-bold tabular-nums">{run.bid}</p>
            </div>
          </section>
        )}

        <section className="flex flex-col items-center gap-5 rounded-2xl bg-card-light p-5 shadow-sm dark:bg-card-dark sm:flex-row sm:items-center">
          <AccuracyRing accuracy={accuracy} />
          <div className="grid w-full grid-cols-2 gap-2">
            <StatTile label="right" value={summary.right} className="text-emerald-700 dark:text-emerald-400" />
            <StatTile label="missed" value={summary.answers - summary.right} className="text-red-700 dark:text-red-400" />
            <StatTile label={run.mode === 'memory' ? 'pairs logged' : 'rounds played'} value={run.mode === 'memory' ? summary.answers : `${summary.rounds}/${run.rounds.length}`} />
            <StatTile label="time" value={mmss(summary.seconds)} />
          </div>
        </section>

        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button" disabled={summary.missed.length === 0} onClick={drillAgain} className={btnPrimary}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Drill these again{summary.missed.length > 0 ? ` (${summary.missed.length})` : ''}
          </button>
          <button type="button" onClick={() => useGymRun.getState().toSetup()} className={btnSecondary}>
            <Layers className="h-4 w-4" aria-hidden="true" />
            New session
          </button>
          <button
            type="button"
            onClick={() => {
              useGymRun.getState().toSetup();
              navigate('/');
            }}
            className={btnSecondary}
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Home
          </button>
        </div>

        <section aria-labelledby="fg-missed" className="space-y-3">
          <h2 id="fg-missed" className="text-lg font-semibold">
            Formulas to go over
          </h2>
          {summary.missed.length === 0 ? (
            <p className="rounded-2xl bg-card-light p-4 text-slate-700 shadow-sm dark:bg-card-dark dark:text-slate-300">
              {summary.answers === 0 ? 'Nothing was answered in this session.' : 'No misses this session. Each formula is scheduled further out now.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {summary.missed.map(({ formula, games }) => (
                <MissedItem key={formula.id} formula={formula} games={games} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
