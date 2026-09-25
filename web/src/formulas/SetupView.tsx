import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  Brain,
  Calculator,
  Check,
  ChevronDown,
  Dumbbell,
  Gavel,
  Grid3x3,
  Hammer,
  Link2,
  Play,
  Scale,
  Split,
  Timer,
  Wrench,
  Zap,
} from 'lucide-react';
import { navigate } from '../lib/router';
import type { GymState } from '../types';
import { AREAS, compareReadings, readingTitle } from './deck';
import { GAMES, GAME_BY_ID } from './games';
import { useDeckIndex } from './hooks';
import { planSession, playableCount } from './plan';
import { DEFAULT_SETUP, SIZE_OPTIONS, loadSetup, saveSetup, scopeOf } from './setup';
import type { GymSetup, SetupChoice } from './setup';
import { isDue, isMastered, localDay } from './storage';
import type { Formula, FormulaGame } from './types';
import { btnPrimary, btnSmall } from './ui';

const ICONS: Record<SetupChoice, ReactNode> = {
  workout: <Dumbbell className="h-5 w-5" aria-hidden="true" />,
  sheet: <BookOpen className="h-5 w-5" aria-hidden="true" />,
  recall: <Brain className="h-5 w-5" aria-hidden="true" />,
  forge: <Hammer className="h-5 w-5" aria-hidden="true" />,
  rigged: <Scale className="h-5 w-5" aria-hidden="true" />,
  spot: <Zap className="h-5 w-5" aria-hidden="true" />,
  whichway: <ArrowUpDown className="h-5 w-5" aria-hidden="true" />,
  symbols: <Link2 className="h-5 w-5" aria-hidden="true" />,
  calc: <Calculator className="h-5 w-5" aria-hidden="true" />,
  twins: <Split className="h-5 w-5" aria-hidden="true" />,
  memory: <Grid3x3 className="h-5 w-5" aria-hidden="true" />,
  repair: <Wrench className="h-5 w-5" aria-hidden="true" />,
  auction: <Gavel className="h-5 w-5" aria-hidden="true" />,
};

const CHOICES: { id: SetupChoice; label: string; blurb: string }[] = [
  { id: 'workout', label: 'Workout', blurb: 'Due and weak formulas first, each met in a different game.' },
  ...GAMES.map((g) => ({ id: g.id as SetupChoice, label: g.label, blurb: g.blurb })),
  { id: 'sheet', label: 'Formula Sheet', blurb: 'Every formula by reading, right-hand side covered until you tap.' },
];

/** Why a game has nothing to play in the current scope. */
const NEEDS: Partial<Record<FormulaGame, string>> = {
  forge: 'No tile data in this selection',
  rigged: 'No wrong versions in this selection',
  spot: 'No wrong versions in this selection',
  whichway: 'No sensitivities in this selection',
  symbols: 'No formula with three or more variables here',
  calc: 'No calculable formulas in this selection',
  twins: 'No look-alike pairs in this selection',
  memory: 'Needs at least three formulas',
  repair: 'No repairable formulas in this selection',
  auction: 'Not enough variables in this area yet',
};

interface Tally {
  total: number;
  due: number;
  mastered: number;
  seen: number;
}

function tally(formulas: Formula[], states: Record<string, GymState>, today: string): Tally {
  const t = { total: formulas.length, due: 0, mastered: 0, seen: 0 };
  for (const f of formulas) {
    const s = states[f.id];
    if (!s || s.totalAttempts === 0) continue;
    t.seen++;
    if (isDue(s, today)) t.due++;
    if (isMastered(s)) t.mastered++;
  }
  return t;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`min-h-[44px] rounded-lg px-1.5 py-1 text-[15px] font-medium leading-tight transition-colors motion-reduce:transition-none ${
              active
                ? 'bg-card-light text-primary-700 shadow-sm dark:bg-card-dark dark:text-primary-100'
                : 'text-slate-700 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-700/60'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Tile({ value, label, tone = '' }: { value: string; label: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-card-light px-3 py-2 dark:border-slate-700 dark:bg-card-dark">
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[15px] leading-snug text-slate-600 dark:text-slate-400">{label}</div>
    </div>
  );
}

interface Props {
  formulas: Formula[];
  states: Record<string, GymState>;
  progressUnavailable: boolean;
  onStart: (setup: GymSetup) => boolean;
  onSheet: () => void;
}

export function SetupView({ formulas, states, progressUnavailable, onStart, onSheet }: Props) {
  const index = useDeckIndex();
  const today = localDay();
  const areas = useMemo(() => AREAS.filter((a) => formulas.some((f) => f.area === a.code)), [formulas]);

  const [setup, setSetup] = useState<GymSetup>(() => {
    const codes = new Set(formulas.map((f) => f.area as string));
    const readingIds = new Set(formulas.map((f) => f.readingId));
    const saved = loadSetup();
    const all = AREAS.map((a) => a.code as string).filter((c) => codes.has(c));
    if (!saved) return { ...DEFAULT_SETUP, areas: all };
    const kept = saved.areas.filter((a) => codes.has(a));
    const keptAreas = kept.length > 0 ? kept : all;
    return { ...saved, areas: keptAreas, readings: saved.readings.filter((r) => readingIds.has(r) && keptAreas.includes(r.split('-')[0])) };
  });
  const [readingsOpen, setReadingsOpen] = useState(() => setup.readings.length > 0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => saveSetup(setup), [setup]);

  const update = (patch: Partial<GymSetup>) => {
    setNotice(null);
    setSetup((prev) => ({ ...prev, ...patch }));
  };

  const byArea = useMemo(() => {
    const out: Record<string, Formula[]> = {};
    for (const f of formulas) (out[f.area] ??= []).push(f);
    return out;
  }, [formulas]);

  const readingsByArea = useMemo(() => {
    const out: Record<string, { id: string; count: number }[]> = {};
    for (const [area, list] of Object.entries(byArea)) {
      const counts = new Map<string, number>();
      for (const f of list) counts.set(f.readingId, (counts.get(f.readingId) ?? 0) + 1);
      out[area] = [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => compareReadings(a.id, b.id));
    }
    return out;
  }, [byArea]);

  const overall = useMemo(() => tally(formulas, states, today), [formulas, states, today]);
  const areaTallies = useMemo(() => {
    const out: Record<string, Tally> = {};
    for (const a of areas) out[a.code] = tally(byArea[a.code] ?? [], states, today);
    return out;
  }, [areas, byArea, states, today]);

  const scope = useMemo(() => scopeOf(formulas, setup), [formulas, setup]);
  const scopeTally = useMemo(() => tally(scope, states, today), [scope, states, today]);
  const counts = useMemo(() => {
    const out: Partial<Record<SetupChoice, number>> = { workout: scope.length, sheet: scope.length };
    for (const g of GAMES) out[g.id] = playableCount(g.id, scope, index, g.id === 'memory' && setup.numbers);
    return out;
  }, [scope, index, setup.numbers]);

  const toggleArea = (code: string) =>
    update(
      setup.areas.includes(code)
        ? { areas: setup.areas.filter((a) => a !== code), readings: setup.readings.filter((r) => r.split('-')[0] !== code) }
        : { areas: [...setup.areas, code] },
    );
  const toggleReading = (id: string) =>
    update({ readings: setup.readings.includes(id) ? setup.readings.filter((r) => r !== id) : [...setup.readings, id] });

  const mode = setup.mode;
  const game = mode === 'workout' || mode === 'sheet' ? null : GAME_BY_ID[mode];
  const playable = counts[mode] ?? 0;
  const enough = mode === 'memory' ? playable >= 3 : playable > 0;
  const sessionCount = game?.timed ? Math.min(game.timed.rounds, playable) : setup.size === 'all' ? playable : Math.min(setup.size, playable);

  const counter =
    setup.areas.length === 0
      ? 'No area selected'
      : !enough
        ? 'Nothing to play here'
        : mode === 'sheet'
          ? `${playable} ${playable === 1 ? 'formula' : 'formulas'}`
          : mode === 'memory'
            ? `${Math.min(8, playable)} pairs · 90 s`
            : game?.timed
              ? `${sessionCount} rounds · ${game.timed.seconds} s`
              : `${sessionCount} ${sessionCount === 1 ? 'formula' : 'formulas'}`;

  const start = () => {
    if (!enough) return;
    if (mode === 'sheet') {
      onSheet();
      return;
    }
    if (!onStart(setup)) setNotice('Couldn’t build a session from this selection. Try another game or a wider selection.');
  };

  const shownAreas = areas.filter((a) => setup.areas.includes(a.code));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Back to home"
            className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-lg font-semibold">Formula Gym</h1>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] space-y-6 px-4 pb-36 pt-4">
        <p className="text-[15px] text-slate-600 dark:text-slate-400">
          Short drills to get every formula in the notes into long-term memory. Every answer, in any game, schedules the formula's next review.
        </p>

        <section aria-label="Your formula progress" className="grid grid-cols-3 gap-2">
          <Tile value={`${overall.seen}/${overall.total}`} label="formulas seen" />
          <Tile value={String(overall.due)} label="due today" tone={overall.due > 0 ? 'text-amber-700 dark:text-amber-400' : ''} />
          <Tile value={`${pct(overall.mastered, overall.total)}%`} label="mastered" tone="text-emerald-700 dark:text-emerald-400" />
        </section>

        {progressUnavailable && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-[15px] text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
            Progress storage isn't available in this browser, so answers only last until you close the tab.
          </p>
        )}

        <section aria-labelledby="fg-areas" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="fg-areas" className="text-base font-semibold">
              Areas
            </h2>
            <div className="flex gap-2">
              <button type="button" className={btnSmall} onClick={() => update({ areas: areas.map((a) => a.code) })}>
                Select all
              </button>
              <button type="button" className={btnSmall} onClick={() => update({ areas: [], readings: [] })}>
                Clear
              </button>
            </div>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {areas.map((a) => {
              const on = setup.areas.includes(a.code);
              const t = areaTallies[a.code];
              return (
                <li key={a.code}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleArea(a.code)}
                    className={`flex min-h-[56px] w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors motion-reduce:transition-none ${
                      on
                        ? 'border-primary bg-primary-50 dark:bg-primary/15'
                        : 'border-slate-200 bg-card-light hover:bg-slate-50 dark:border-slate-700 dark:bg-card-dark dark:hover:bg-slate-800'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        on ? 'border-primary bg-primary text-white' : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-medium">{a.name}</span>
                      <span className="block text-[15px] text-slate-600 dark:text-slate-400">
                        {t.total} {t.total === 1 ? 'formula' : 'formulas'}
                        {t.seen > 0 ? ` · ${t.due} due · ${pct(t.mastered, t.total)}% mastered` : ' · not started'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {shownAreas.length > 0 && (
          <section className="rounded-2xl bg-card-light shadow-sm dark:bg-card-dark">
            <button
              type="button"
              aria-expanded={readingsOpen}
              aria-controls="fg-readings"
              onClick={() => setReadingsOpen((v) => !v)}
              className="flex min-h-[56px] w-full items-center justify-between gap-2 px-4 text-left"
            >
              <span className="min-w-0">
                <span className="block text-base font-semibold">Readings</span>
                <span className="block text-[15px] text-slate-600 dark:text-slate-400">
                  {setup.readings.length === 0
                    ? 'Optional: all readings of the chosen areas'
                    : `${setup.readings.length} ${setup.readings.length === 1 ? 'reading' : 'readings'} chosen`}
                </span>
              </span>
              <ChevronDown
                className={`h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none ${readingsOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
            {readingsOpen && (
              <div id="fg-readings" className="space-y-5 border-t border-slate-200 px-4 pb-4 pt-4 dark:border-slate-700">
                <p className="text-[15px] text-slate-600 dark:text-slate-400">
                  Pick readings to narrow an area. An area with no reading picked keeps all of them.
                </p>
                {shownAreas.map((a) => (
                  <div key={a.code} className="space-y-2">
                    <h3 className="text-[15px] font-semibold text-slate-800 dark:text-slate-200">{a.name}</h3>
                    <div className="flex flex-wrap gap-2">
                      {(readingsByArea[a.code] ?? []).map((r) => {
                        const on = setup.readings.includes(r.id);
                        const title = readingTitle(r.id);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleReading(r.id)}
                            className={`inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-2xl border px-3.5 py-1.5 text-left text-[15px] font-medium leading-snug transition-colors motion-reduce:transition-none ${
                              on
                                ? 'border-primary bg-primary text-white'
                                : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span className="min-w-0 break-words">
                              <span className="font-semibold">{r.id}</span>
                              {title ? ` ${title}` : ''}
                            </span>
                            <span className={`shrink-0 rounded-full px-1.5 tabular-nums ${on ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'}`}>{r.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {setup.readings.length > 0 && (
                  <button type="button" className={btnSmall} onClick={() => update({ readings: [] })}>
                    Clear readings
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {setup.areas.length > 0 && (
          <p className="text-[15px] text-slate-600 dark:text-slate-400">
            In this selection: {scopeTally.total} {scopeTally.total === 1 ? 'formula' : 'formulas'}, {scopeTally.due} due, {pct(scopeTally.mastered, scopeTally.total)}% mastered.
          </p>
        )}

        <section aria-labelledby="fg-games" className="space-y-3">
          <h2 id="fg-games" className="text-base font-semibold">
            Game
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {CHOICES.map((c) => {
              const on = mode === c.id;
              const n = counts[c.id] ?? 0;
              const g = c.id === 'workout' || c.id === 'sheet' ? null : GAME_BY_ID[c.id];
              const usable = c.id === 'memory' ? n >= 3 : n > 0;
              const detail = !usable
                ? (g && NEEDS[g.id]) ?? 'Nothing in this selection'
                : g?.timed
                  ? `${g.timed.seconds} s · ${g.id === 'memory' ? '8 pairs' : `${g.timed.rounds} rounds`} · ${n} playable`
                  : `${n} ${n === 1 ? 'formula' : 'formulas'}`;
              return (
                <li key={c.id} className={c.id === 'workout' ? 'sm:col-span-2' : ''}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => update({ mode: c.id })}
                    className={`flex min-h-[72px] w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors motion-reduce:transition-none ${
                      on
                        ? 'border-primary bg-primary-50 dark:bg-primary/15'
                        : 'border-slate-200 bg-card-light hover:bg-slate-50 dark:border-slate-700 dark:bg-card-dark dark:hover:bg-slate-800'
                    } ${usable ? '' : 'opacity-70'}`}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        on ? 'bg-primary text-white' : 'bg-primary-50 text-primary-600 dark:bg-slate-800 dark:text-primary-100'
                      }`}
                    >
                      {ICONS[c.id]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 font-semibold">
                        {c.label}
                        {g?.timed && <Timer className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-label="Timed" />}
                        {c.id === 'workout' && <span className="text-[15px] font-medium text-primary-600 dark:text-primary-100">Recommended</span>}
                      </span>
                      <span className="block text-[15px] leading-snug text-slate-600 dark:text-slate-400">{c.blurb}</span>
                      <span className="mt-0.5 block text-[15px] font-medium leading-snug text-slate-700 dark:text-slate-300">{detail}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {mode === 'memory' && (
          <div className="space-y-2">
            <p className="text-[15px] font-medium text-slate-700 dark:text-slate-300">Partner cards</p>
            <Segmented
              label="Partner cards"
              value={setup.numbers ? 'numbers' : 'keys'}
              options={[
                { value: 'keys', label: 'Variable keys' },
                { value: 'numbers', label: 'Numbers (harder)' },
              ]}
              onChange={(v) => update({ numbers: v === 'numbers' })}
            />
          </div>
        )}

        {!game?.timed && mode !== 'sheet' && (
          <div className="space-y-2">
            <p className="text-[15px] font-medium text-slate-700 dark:text-slate-300">Session length</p>
            <Segmented label="Session length" value={setup.size} options={SIZE_OPTIONS} onChange={(size) => update({ size })} />
          </div>
        )}

        {notice && (
          <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-[15px] text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
            {notice}
          </p>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-surface-light/85 backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <p aria-live="polite" className="min-w-0 text-[15px] font-medium tabular-nums text-slate-700 dark:text-slate-300">
            {counter}
          </p>
          <button type="button" onClick={start} disabled={!enough || setup.areas.length === 0} className={`${btnPrimary} shrink-0`}>
            {mode === 'sheet' ? <BookOpen className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {mode === 'sheet' ? 'Open' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Builds and starts a session for a setup; false when nothing could be built. */
export function startFromSetup(
  setup: GymSetup,
  formulas: Formula[],
  states: Record<string, GymState>,
  index: ReturnType<typeof useDeckIndex>,
  start: (s: NonNullable<ReturnType<typeof planSession>>) => void,
): boolean {
  if (setup.mode === 'sheet') return false;
  const session = planSession(setup.mode, scopeOf(formulas, setup), states, index, { size: setup.size, numbers: setup.numbers });
  if (!session) return false;
  start(session);
  return true;
}
