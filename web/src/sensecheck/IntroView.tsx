import { useEffect, useMemo, useState } from 'react';
import { Gauge, Play } from 'lucide-react';
import type { GymAttempt, GymState } from '../types';
import { localDay } from '../formulas/storage';
import { READING_TITLES } from '../formulas/readingTitles';
import { ScopeSwitch } from '../components/setup/ChapterPicker';
import { LoPicker } from '../components/setup/LoPicker';
import type { LoSubject } from '../components/setup/LoPicker';
import { lifetimeByMode, planSession, priorityTier, sessionSeconds } from './rotation';
import { ROUNDS_OPTIONS, leafKey, loadHistory, loadPick, savePick, useSenseRun } from './store';
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Area → chapter → learning objective. A scenario built from a bank question sits under that question's LO; one
 * written from the notes has no single LO and sits under its chapter's "from the notes" row.
 */
function loSubjects(scenarios: Scenario[], states: Record<string, GymState>, today: string): LoSubject[] {
  interface Leaf { id: string; code?: string; label: string; scenarios: number; review: number }
  const byArea = new Map<string, Map<string, Map<string, Leaf>>>();
  for (const s of scenarios) {
    const readings = byArea.get(s.area) ?? new Map<string, Map<string, Leaf>>();
    byArea.set(s.area, readings);
    const leaves = readings.get(s.reading) ?? new Map<string, Leaf>();
    readings.set(s.reading, leaves);
    const key = leafKey(s);
    const leaf = leaves.get(key) ?? { id: key, code: s.lo ?? undefined, label: s.lo ? (s.loText ?? s.lo) : 'Worked examples from the notes', scenarios: 0, review: 0 };
    leaves.set(key, leaf);
    leaf.scenarios++;
    if (priorityTier(states[s.id], today) >= 3) leaf.review++;
  }
  const numeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return AREAS.filter((a) => byArea.has(a)).map((a) => ({
    id: a,
    title: AREA_NAME[a],
    chapters: [...(byArea.get(a)?.entries() ?? [])]
      .sort(([x], [y]) => numeric(x, y))
      .map(([reading, leaves]) => ({
        id: reading,
        label: chapterLabel(reading),
        // LOs in syllabus order; the notes row (no code) last.
        los: [...leaves.values()]
          .sort((x, y) => (x.code ? 0 : 1) - (y.code ? 0 : 1) || numeric(x.code ?? '', y.code ?? ''))
          .map((l) => ({
            id: l.id,
            code: l.code,
            label: l.label,
            detail: `${plural(l.scenarios, 'scenario', 'scenarios')}${l.review > 0 ? ` · ${l.review} due or weak` : ''}`,
          })),
      })),
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
  const [pick, setPick] = useState<SensePick>(() => {
    const saved = loadPick();
    // Chapters picked before LOs could be: every LO (and the notes row) of those chapters.
    if (saved.los.length > 0 || saved.readings.length === 0) return { ...saved, readings: [] };
    const from = new Set(saved.readings);
    return { ...saved, readings: [], los: [...new Set(scenarios.filter((s) => from.has(s.reading)).map(leafKey))] };
  });
  useEffect(() => savePick(pick), [pick]);
  const groups = useMemo(() => loSubjects(scenarios, states, today), [scenarios, states, today]);
  // Learning objectives a content update removed drop out of the choice.
  const chosen = useMemo(() => {
    const known = new Set(scenarios.map(leafKey));
    return pick.los.filter((k) => known.has(k));
  }, [scenarios, pick.los]);
  const picking = pick.scope === 'chapters';
  const pool = useMemo(() => {
    if (!picking) return scenarios;
    const set = new Set(chosen);
    return scenarios.filter((s) => set.has(leafKey(s)));
  }, [scenarios, picking, chosen]);
  const all = pick.rounds === 'all';
  const size = pick.rounds === 'all' ? pool.length : pick.rounds;
  // Planned up front so the screen can say what the session is built around; Start plays exactly this plan.
  // "All" takes every scenario of the choice, so the one-area rule and the one-round-per-question rule step aside.
  const plan = useMemo(
    () => (pool.length > 0 ? planSession(pool, states, loadHistory(), { today, areaRule: !picking && !all, rounds: size, allowRepeats: all }) : null),
    [pool, states, today, picking, size, all],
  );
  const minutes = Math.round(sessionSeconds(plan ? plan.rounds.length : typeof pick.rounds === 'number' ? pick.rounds : 10) / 60);
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
{plan ? `${plural(minutes, 'minute', 'minutes')}, ${plural(plan.rounds.length, 'round', 'rounds')}.` : 'Three minutes for ten rounds.'} Make the call on instinct, then see the full working. The clock
        pauses while you read it.
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
          <ScopeSwitch value={pick.scope} onChange={(scope) => setPick((p) => ({ ...p, scope }))} pickLabel="Chapters and LOs" />
          <p className="text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">
            {picking
              ? 'Only the learning objectives you pick, due and weak scenarios first. Open a subject, then a chapter; a chapter\'s Select button takes all of its LOs.'
              : 'Every chapter in rotation: a different reading leads each session, due and weak scenarios first.'}
          </p>
          <div className="space-y-2">
            <p className="text-[15px] font-medium text-slate-700 dark:text-slate-300">Rounds</p>
            <div role="group" aria-label="Rounds" className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {ROUNDS_OPTIONS.map((o) => (
                <button
                  key={String(o.value)}
                  type="button"
                  aria-pressed={pick.rounds === o.value}
                  onClick={() => setPick((p) => ({ ...p, rounds: o.value }))}
                  className={`min-h-[44px] rounded-lg px-2 text-[15px] font-semibold transition-colors motion-reduce:transition-none ${
                    pick.rounds === o.value
                      ? 'bg-card-light text-primary-700 shadow-sm dark:bg-card-dark dark:text-primary-100'
                      : 'text-slate-700 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-700/60'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-[15px] text-slate-600 dark:text-slate-400">
              {all
                ? picking
                  ? 'All plays every scenario of the learning objectives you picked.'
                  : `All plays every scenario in the deck (${scenarios.length.toLocaleString()}). Pick chapters or LOs to play all of just those.`
                : 'The clock scales with the session: about 18 seconds a round.'}
            </p>
          </div>
          {picking && <LoPicker subjects={groups} selected={chosen} onChange={(los) => setPick((p) => ({ ...p, los }))} idPrefix="sc" />}
        </section>

        {!picking && explainer}

        {plan && picking && (
          <section aria-label="This session" className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Session {plan.n}</p>
            <p className="mt-1 break-words text-base leading-relaxed">
              {plural(plan.rounds.length, 'round', 'rounds')} from your {chosen.length === 1 ? 'learning objective' : `${chosen.length} learning objectives`}, about{' '}
              {plural(minutes, 'minute', 'minutes')}.
            </p>
            {!all && plan.rounds.length < size && (
              <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">
                That's all your choice has for one session (two rounds on the same question never share one). Pick more for the full {size}, or choose All.
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
          <p className="text-[15px] text-slate-600 dark:text-slate-400">Pick at least one learning objective to start.</p>
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
