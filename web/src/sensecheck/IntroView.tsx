import { useEffect, useMemo, useState } from 'react';
import { Gauge, Play } from 'lucide-react';
import type { GymAttempt, GymState } from '../types';
import { localDay } from '../formulas/storage';
import { READING_TITLES } from '../formulas/readingTitles';
import { ChapterPicker, ScopeSwitch } from '../components/setup/ChapterPicker';
import type { ChapterGroup } from '../components/setup/ChapterPicker';
import { SESSION_ROUNDS, SESSION_SECONDS, lifetimeByMode, planSession, priorityTier } from './rotation';
import { loadHistory, loadPick, savePick, useSenseRun } from './store';
import type { SensePick } from './store';
import { AREAS, AREA_NAME, MODES, MODE_LABEL } from './types';
import type { Scenario, SenseMode } from './types';
import { ModeTag, Shell, btnPrimary, card } from './ui';

const MODE_BLURB: Record<SenseMode, string> = {
  direction: 'A full setup changes one thing. Which way does the answer move?',
  magnitude: 'Four values, far apart. Which is it closest to, without computing it?',
  intermediate: 'A chain partly worked. What is the sign or size of the next step?',
};

/** A bare reading id ("MR-12") gets its title from the notes; full labels are shown as they are. */
function chapterLabel(reading: string): string {
  const title = /^[A-Z]+-\d+$/.test(reading.trim()) ? READING_TITLES[reading.trim()] : undefined;
  return title ? `${reading}: ${title}` : reading;
}

function chapterGroups(scenarios: Scenario[], states: Record<string, GymState>, today: string): ChapterGroup[] {
  const byArea = new Map<string, Map<string, { scenarios: number; review: number }>>();
  for (const s of scenarios) {
    const readings = byArea.get(s.area) ?? new Map<string, { scenarios: number; review: number }>();
    byArea.set(s.area, readings);
    const r = readings.get(s.reading) ?? { scenarios: 0, review: 0 };
    readings.set(s.reading, r);
    r.scenarios++;
    if (priorityTier(states[s.id], today) >= 3) r.review++;
  }
  return AREAS.filter((a) => byArea.has(a)).map((a) => ({
    id: a,
    title: AREA_NAME[a],
    chapters: [...(byArea.get(a)?.entries() ?? [])]
      .map(([reading, n]) => ({
        id: reading,
        label: chapterLabel(reading),
        keywords: a,
        detail: `${n.scenarios} ${n.scenarios === 1 ? 'scenario' : 'scenarios'}${n.review > 0 ? ` · ${n.review} due or weak` : ''}`,
      }))
      .sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true })),
  }));
}

interface Props {
  scenarios: Scenario[];
  states: Record<string, GymState>;
  attempts: GymAttempt[];
  progressUnavailable: boolean;
}

export function IntroView({ scenarios, states, attempts, progressUnavailable }: Props) {
  const today = localDay();
  const [pick, setPick] = useState<SensePick>(loadPick);
  useEffect(() => savePick(pick), [pick]);
  const groups = useMemo(() => chapterGroups(scenarios, states, today), [scenarios, states, today]);
  // Chapters a content update removed drop out of the choice.
  const chosen = useMemo(() => {
    const known = new Set(scenarios.map((s) => s.reading));
    return pick.readings.filter((r) => known.has(r));
  }, [scenarios, pick.readings]);
  const picking = pick.scope === 'chapters';
  const pool = useMemo(() => {
    if (!picking) return scenarios;
    const set = new Set(chosen);
    return scenarios.filter((s) => set.has(s.reading));
  }, [scenarios, picking, chosen]);
  // Planned up front so the screen can say what the session is built around; Start plays exactly this plan.
  const plan = useMemo(
    () => (pool.length > 0 ? planSession(pool, states, loadHistory(), { today, areaRule: !picking }) : null),
    [pool, states, today, picking],
  );
  const lifetime = useMemo(() => lifetimeByMode(attempts), [attempts]);
  const played = MODES.some((m) => lifetime[m].total > 0);
  const review = plan ? plan.rounds.filter((s) => priorityTier(states[s.id], today) >= 3).length : 0;

  const explainer = (
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
  );

  return (
    <Shell>
      <div className="space-y-5">
        <section aria-label="What to practise" className="space-y-3">
          <ScopeSwitch value={pick.scope} onChange={(scope) => setPick((p) => ({ ...p, scope }))} />
          <p className="text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">
            {picking
              ? 'Only the chapters you pick, due and weak scenarios first, in a shuffled order.'
              : 'Every chapter in rotation: a different reading leads each session, due and weak scenarios first.'}
          </p>
          {picking && <ChapterPicker groups={groups} selected={chosen} onChange={(readings) => setPick((p) => ({ ...p, readings }))} idPrefix="sc" />}
        </section>

        {!picking && explainer}

        {plan && picking && (
          <section aria-label="This session" className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Session {plan.n}</p>
            <p className="mt-1 break-words text-base leading-relaxed">
              {plan.rounds.length} {plan.rounds.length === 1 ? 'round' : 'rounds'} from your {chosen.length === 1 ? 'chapter' : `${chosen.length} chapters`}.
            </p>
            {plan.rounds.length < SESSION_ROUNDS && (
              <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">
                That's all these chapters have for one session. Pick more for the full {SESSION_ROUNDS}.
              </p>
            )}
            {review > 0 && (
              <p className="mt-1 text-base text-amber-800 dark:text-amber-300">
                {review} {review === 1 ? 'round is' : 'rounds are'} due or worth another go.
              </p>
            )}
          </section>
        )}

        {plan && !picking && (
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

        {picking && chosen.length === 0 && (
          <p className="text-[15px] text-slate-600 dark:text-slate-400">Pick at least one chapter to start.</p>
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

        {picking && explainer}
      </div>
    </Shell>
  );
}
