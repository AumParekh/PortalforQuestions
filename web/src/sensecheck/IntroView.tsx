import { useMemo } from 'react';
import { Gauge, Play } from 'lucide-react';
import type { GymAttempt, GymState } from '../types';
import { localDay } from '../formulas/storage';
import { SESSION_ROUNDS, SESSION_SECONDS, lifetimeByMode, planSession, priorityTier } from './rotation';
import { loadHistory, useSenseRun } from './store';
import { AREA_NAME, MODES, MODE_LABEL } from './types';
import type { Scenario, SenseMode } from './types';
import { ModeTag, Shell, btnPrimary, card } from './ui';

const MODE_BLURB: Record<SenseMode, string> = {
  direction: 'A full setup changes one thing. Which way does the answer move?',
  magnitude: 'Four values, far apart. Which is it closest to, without computing it?',
  intermediate: 'A chain partly worked. What is the sign or size of the next step?',
};

interface Props {
  scenarios: Scenario[];
  states: Record<string, GymState>;
  attempts: GymAttempt[];
  progressUnavailable: boolean;
}

export function IntroView({ scenarios, states, attempts, progressUnavailable }: Props) {
  const today = localDay();
  // Planned up front so the screen can say what the session is built around; Start plays exactly this plan.
  const plan = useMemo(() => planSession(scenarios, states, loadHistory(), { today }), [scenarios, states, today]);
  const lifetime = useMemo(() => lifetimeByMode(attempts), [attempts]);
  const played = MODES.some((m) => lifetime[m].total > 0);
  const review = plan ? plan.rounds.filter((s) => priorityTier(states[s.id], today) >= 3).length : 0;

  return (
    <Shell>
      <div className="space-y-5">
        <section className={card}>
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary/15 dark:text-primary-100">
              <Gauge className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="text-xl font-semibold leading-snug">Size it before you solve it</h2>
          </div>
          <p className="mt-3 text-base leading-relaxed text-slate-700 dark:text-slate-300">
            {SESSION_SECONDS / 60} minutes, {SESSION_ROUNDS} rounds. Make the call on instinct, then see the full working. The clock pauses while you read it.
          </p>
          <ul className="mt-4 space-y-3">
            {MODES.map((m) => (
              <li key={m} className="space-y-1">
                <ModeTag mode={m} />
                <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300">{MODE_BLURB[m]}</p>
              </li>
            ))}
          </ul>
        </section>

        {plan && (
          <section aria-label="This session" className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Session {plan.n}</p>
            {plan.area ? (
              <p className="mt-1 text-base leading-relaxed">
                <span className="font-semibold">{AREA_NAME[plan.area]} only.</span> Every third session stays in one area to build a feel for it.
              </p>
            ) : null}
            <p className="mt-1 break-words text-base leading-relaxed">
              Built around <span className="font-semibold">{plan.featured}</span>
              {plan.readings.length > 1 ? `, with ${plan.readings.length - 1} more ${plan.readings.length === 2 ? 'reading' : 'readings'}` : ''}.
            </p>
            {review > 0 && (
              <p className="mt-1 text-base text-amber-800 dark:text-amber-300">
                {review} {review === 1 ? 'round is' : 'rounds are'} due or worth another go.
              </p>
            )}
          </section>
        )}

        {played && (
          <p className="text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">
            All sessions so far: {MODES.map((m) => `${MODE_LABEL[m]} ${lifetime[m].correct}/${lifetime[m].total}`).join(' · ')}
          </p>
        )}

        {progressUnavailable && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-[15px] text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
            Progress storage isn't available in this browser, so answers only last until you close the tab.
          </p>
        )}

        <button
          type="button"
          disabled={!plan}
          onClick={() => plan && useSenseRun.getState().start(plan)}
          className={`${btnPrimary} min-h-[56px] w-full text-lg`}
        >
          <Play className="h-5 w-5" aria-hidden="true" />
          Start
        </button>
      </div>
    </Shell>
  );
}
