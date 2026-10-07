import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Check, Play } from 'lucide-react';
import { navigate } from '../../lib/router';
import type { TFCard, TFState } from '../../types';
import {
  DEFAULT_SETUP,
  ORDER_OPTIONS,
  SIZE_OPTIONS,
  STATUS_OPTIONS,
  buildDeck,
  filterPool,
  loadSetup,
  pct,
  saveSetup,
  subjectInfo,
  topicKey,
} from './deck';
import type { StatusFilter, TfSetup } from './deck';
import { ChapterPicker, ScopeSwitch } from '../setup/ChapterPicker';
import type { ChapterGroup } from '../setup/ChapterPicker';

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[15px] font-medium text-slate-700 dark:text-slate-300">{label}</p>
      {children}
    </div>
  );
}

function StatButton({
  value,
  label,
  action,
  active,
  onClick,
  tone = '',
}: {
  value: string;
  label: string;
  action: string;
  active: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-[44px] flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors motion-reduce:transition-none ${
        active
          ? 'border-primary bg-primary-50 dark:border-primary dark:bg-primary/15'
          : 'border-slate-200 bg-card-light hover:bg-slate-50 dark:border-slate-700 dark:bg-card-dark dark:hover:bg-slate-800'
      }`}
    >
      <span className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</span>
      <span className="text-[15px] leading-snug text-slate-600 dark:text-slate-400">{label}</span>
      <span className="mt-0.5 text-[15px] font-medium leading-snug text-primary-600 dark:text-primary-100">{action}</span>
    </button>
  );
}

interface Props {
  cards: TFCard[];
  states: Record<string, TFState>;
  progressUnavailable: boolean;
  onStart: (ids: string[]) => void;
}

export function TfSetupView({ cards, states, progressUnavailable, onStart }: Props) {
  const subjects = useMemo(() => subjectInfo(cards, states), [cards, states]);

  const [setup, setSetup] = useState<TfSetup>(() => {
    const all = subjectInfo(cards, {});
    const names = new Set(all.map((s) => s.subject));
    const topicKeys = new Set(all.flatMap((s) => s.topics.map((t) => t.key)));
    const saved = loadSetup();
    if (!saved) return { ...DEFAULT_SETUP, subjects: all.map((s) => s.subject) };
    const kept = saved.subjects.filter((s) => names.has(s));
    return {
      ...saved,
      subjects: kept.length > 0 ? kept : all.map((s) => s.subject),
      topics: saved.topics.filter((k) => topicKeys.has(k)),
    };
  });

  useEffect(() => saveSetup(setup), [setup]);

  const selected = useMemo(() => new Set(setup.subjects), [setup.subjects]);
  const chapterGroups = useMemo((): ChapterGroup[] => {
    // A topic's readings and objectives are searchable too, so "Hull" or "smile" finds it.
    const extra = new Map<string, Set<string>>();
    for (const c of cards) {
      const k = topicKey(c.subject, c.topic);
      const set = extra.get(k) ?? new Set<string>();
      extra.set(k, set);
      set.add(c.reading);
      set.add(c.loText);
    }
    const seen = new Map<string, { seen: number; attempts: number; correct: number }>();
    for (const c of cards) {
      const st = states[c.id];
      if (!st || st.totalAttempts === 0) continue;
      const k = topicKey(c.subject, c.topic);
      const t = seen.get(k) ?? { seen: 0, attempts: 0, correct: 0 };
      seen.set(k, t);
      t.seen += 1;
      t.attempts += st.totalAttempts;
      t.correct += st.totalCorrect;
    }
    return subjects.map((s) => ({
      id: s.subject,
      title: s.subject,
      chapters: s.topics.map((t) => {
        const p = seen.get(t.key);
        return {
          id: t.key,
          label: t.topic,
          keywords: [...(extra.get(t.key) ?? [])].join(' '),
          detail: `${t.total} ${t.total === 1 ? 'statement' : 'statements'}${p ? ` · ${pct(p.correct, p.attempts)}% · ${p.seen} seen` : ' · not started'}`,
        };
      }),
    }));
  }, [cards, states, subjects]);
  const pool = useMemo(() => filterPool(cards, states, setup), [cards, states, setup]);

  const overall = useMemo(() => {
    let seen = 0;
    let attempts = 0;
    let correct = 0;
    let stillWrong = 0;
    for (const c of cards) {
      const st = states[c.id];
      if (!st || st.totalAttempts === 0) continue;
      seen += 1;
      attempts += st.totalAttempts;
      correct += st.totalCorrect;
      if (st.lastResult === 'wrong') stillWrong += 1;
    }
    return { seen, attempts, correct, stillWrong };
  }, [cards, states]);

  const update = (patch: Partial<TfSetup>) => setSetup((prev) => ({ ...prev, ...patch }));

  const toggleSubject = (subject: string) =>
    setSetup((prev) => ({
      ...prev,
      subjects: prev.subjects.includes(subject) ? prev.subjects.filter((s) => s !== subject) : [...prev.subjects, subject],
    }));

  const picking = setup.scope === 'chapters';
  const nothingChosen = picking ? setup.topics.length === 0 : setup.subjects.length === 0;

  const setStatus = (status: StatusFilter) => update({ status });

  const deckCount = setup.size === 'all' ? pool.length : Math.min(setup.size, pool.length);
  const canStart = pool.length > 0;
  const counter =
    nothingChosen
      ? picking
        ? 'No chapter picked'
        : 'No subject selected'
      : pool.length === 0
        ? 'No statements match'
        : deckCount === pool.length
          ? `${pool.length} ${pool.length === 1 ? 'statement' : 'statements'}`
          : `${deckCount} of ${pool.length} statements`;

  const start = () => {
    if (!canStart) return;
    onStart(buildDeck(cards, states, setup));
  };

  const smallBtn =
    'min-h-[44px] rounded-xl border border-slate-200 px-3 text-[15px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';

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
          <h1 className="text-lg font-semibold">True / False</h1>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] space-y-6 px-4 pb-36 pt-4">
        <p className="text-[15px] text-slate-600 dark:text-slate-400">
          Judge one statement at a time. Each one comes from an answer option in the question bank, with a short
          explanation after you answer.
        </p>

        <section aria-label="Your True/False progress" className="grid grid-cols-3 gap-2">
          <StatButton
            value={String(overall.seen)}
            label={`of ${cards.length} seen`}
            action="Drill unseen"
            active={setup.status === 'new'}
            onClick={() => setStatus('new')}
          />
          <StatButton
            value={overall.attempts > 0 ? `${pct(overall.correct, overall.attempts)}%` : '–'}
            label="accuracy"
            action="Drill missed"
            active={setup.status === 'missed'}
            onClick={() => setStatus('missed')}
          />
          <StatButton
            value={String(overall.stillWrong)}
            label="still wrong"
            action="Drill these"
            active={setup.status === 'wrong'}
            onClick={() => setStatus('wrong')}
            tone={overall.stillWrong > 0 ? 'text-red-700 dark:text-red-400' : ''}
          />
        </section>

        {progressUnavailable && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-[15px] text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
            Progress storage isn't available in this browser, so answers only last until you close the tab.
          </p>
        )}

        <section aria-label="What to practise" className="space-y-3">
          <ScopeSwitch value={setup.scope} onChange={(scope) => update({ scope })} />
          <p className="text-[15px] text-slate-600 dark:text-slate-400">
            {picking ? 'Only statements from the chapters you pick.' : 'Statements from the subjects you choose, mixed together.'}
          </p>
        </section>

        {picking ? (
          <ChapterPicker groups={chapterGroups} selected={setup.topics} onChange={(topics) => update({ topics })} idPrefix="tf" />
        ) : (
          <section aria-labelledby="tf-subjects" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="tf-subjects" className="text-base font-semibold">
                Subjects
              </h2>
              <div className="flex gap-2">
                <button type="button" className={smallBtn} onClick={() => update({ subjects: subjects.map((s) => s.subject) })}>
                  Select all
                </button>
                <button type="button" className={smallBtn} onClick={() => update({ subjects: [] })}>
                  Clear
                </button>
              </div>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {subjects.map((s) => {
                const on = selected.has(s.subject);
                return (
                  <li key={s.subject}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleSubject(s.subject)}
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
                        <span className="block break-words font-medium">{s.subject}</span>
                        <span className="block text-[15px] text-slate-600 dark:text-slate-400">
                          {s.total} statements
                          {s.attempts > 0 ? ` · ${pct(s.correct, s.attempts)}% · ${s.seen} seen` : ' · not started'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <Field label="Statements">
          <Segmented label="Statement status" value={setup.status} options={STATUS_OPTIONS} onChange={setStatus} />
        </Field>

        <Field label="Deck size">
          <Segmented label="Deck size" value={setup.size} options={SIZE_OPTIONS} onChange={(size) => update({ size })} />
        </Field>

        <Field label="Order">
          <Segmented label="Order" value={setup.order} options={ORDER_OPTIONS} onChange={(order) => update({ order })} />
          {setup.order === 'weakest' && (
            <p className="text-[15px] text-slate-600 dark:text-slate-400">
              Lowest accuracy first. Statements you haven't seen count as 50%.
            </p>
          )}
        </Field>

        {!nothingChosen && pool.length === 0 && setup.status !== 'all' && (
          <div className="space-y-3 rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark">
            <p className="text-slate-700 dark:text-slate-300">
              No statements in this selection are{' '}
              {setup.status === 'new' ? 'unseen' : setup.status === 'missed' ? 'missed before' : 'still wrong'}.
            </p>
            <button type="button" className={smallBtn} onClick={() => setStatus('all')}>
              Show all statements
            </button>
          </div>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-surface-light/85 backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <p aria-live="polite" className="min-w-0 text-[15px] font-medium tabular-nums text-slate-700 dark:text-slate-300">
            {counter}
          </p>
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            className="inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
