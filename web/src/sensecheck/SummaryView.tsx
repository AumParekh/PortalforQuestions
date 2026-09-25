import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Home, RotateCcw, X } from 'lucide-react';
import { Markdown } from '../components/Markdown';
import { navigate } from '../lib/router';
import { countByMode } from './rotation';
import { useSenseRun } from './store';
import type { SenseResult } from './store';
import { MODES, MODE_LABEL } from './types';
import type { Scenario } from './types';
import { ModeTag, ReadingLine, Shell, btnPrimary, btnSecondary, card, focusIfLost, linkButton, scrollX } from './ui';
import { WorkingPanel } from './Working';

function MissedRound({ scenario, result }: { scenario: Scenario; result: SenseResult }) {
  const [open, setOpen] = useState(false);
  const chosen = scenario.options[result.chosen];
  const right = scenario.options.find((o) => o.correct);
  return (
    <li className={card}>
      <div className="space-y-1.5">
        <ModeTag mode={scenario.mode} />
        <ReadingLine scenario={scenario} />
      </div>
      <Markdown className={`${scrollX} mt-3 text-lg font-semibold leading-snug text-slate-900 dark:text-slate-50`}>{scenario.ask}</Markdown>
      <div className="mt-3 space-y-1.5 text-base">
        <div className="flex items-start gap-2 text-red-800 dark:text-red-300">
          <X className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Your call: </span>
          <Markdown className={`${scrollX} min-w-0 flex-1 leading-relaxed`}>{chosen?.label ?? ''}</Markdown>
        </div>
        {right && (
          <div className="flex items-start gap-2 text-emerald-800 dark:text-emerald-300">
            <Check className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">Correct: </span>
            <Markdown className={`${scrollX} min-w-0 flex-1 leading-relaxed`}>{right.label}</Markdown>
          </div>
        )}
      </div>
      {scenario.takeaway && (
        <div className="mt-3 rounded-xl bg-primary-50 px-3 py-2.5 dark:bg-primary/15">
          <Markdown className={`${scrollX} text-base leading-relaxed text-slate-900 dark:text-slate-50`}>{scenario.takeaway}</Markdown>
        </div>
      )}
      <div className="mt-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={linkButton}>
          {open ? 'Hide the working' : 'Show the working'}
          <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {open && (
          <div className="mt-2 space-y-4">
            <Markdown className={`${scrollX} text-base leading-relaxed text-slate-800 dark:text-slate-200`}>{scenario.setup}</Markdown>
            <WorkingPanel scenario={{ ...scenario, takeaway: '' }} chosen={result.chosen} animate={false} />
          </div>
        )}
      </div>
    </li>
  );
}

export function SummaryView() {
  const run = useSenseRun((s) => s.run);
  const counts = useMemo(() => countByMode(run?.results ?? []), [run]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    // The round that had focus is gone (and time running out moves here unprompted): land on the verdict.
    focusIfLost(headingRef.current);
  }, []);

  if (!run) return null;
  const byId = new Map(run.plan.rounds.map((s) => [s.id, s]));
  const missed = run.results.filter((r) => !r.correct);
  const played = run.results.length;
  const total = run.plan.rounds.length;
  const toIntro = () => useSenseRun.getState().toIntro();

  return (
    <Shell onBack={toIntro}>
      <div className="space-y-6">
        <section className={card}>
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none focus-visible:ring-0">
            {run.timedOut ? 'Time’s up' : played < total ? 'Session ended' : 'Session done'}
          </h2>
          {/* One line, three separate counts: never a composite score. */}
          <p className="mt-3 text-lg font-semibold tabular-nums leading-relaxed text-slate-900 dark:text-slate-50">
            {MODES.map((m) => `${MODE_LABEL[m]} ${counts[m].total > 0 ? `${counts[m].correct}/${counts[m].total}` : '–'}`).join(' · ')}
          </p>
          {played < total && (
            <p className="mt-2 text-base text-slate-600 dark:text-slate-400">
              {played} of {total} rounds played.
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={toIntro} className={btnPrimary}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Next session
            </button>
            <button type="button" onClick={() => navigate('/')} className={btnSecondary}>
              <Home className="h-4 w-4" aria-hidden="true" />
              Home
            </button>
          </div>
        </section>

        {missed.length > 0 ? (
          <section aria-labelledby="sc-missed" className="space-y-3">
            <h2 id="sc-missed" className="text-base font-semibold">
              Missed {missed.length === 1 ? 'call' : 'calls'}
            </h2>
            <ul className="space-y-3">
              {missed.map((r) => {
                const s = byId.get(r.scenarioId);
                return s ? <MissedRound key={r.scenarioId} scenario={s} result={r} /> : null;
              })}
            </ul>
          </section>
        ) : (
          played > 0 && <p className="text-base text-slate-700 dark:text-slate-300">No missed calls this session.</p>
        )}
      </div>
    </Shell>
  );
}
