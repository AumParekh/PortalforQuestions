import { useMemo, useState } from 'react';
import { Check, ChevronRight, Flag, Home, Minus, RotateCcw, X } from 'lucide-react';
import { navigate } from '../lib/router';
import { useContent } from '../store/content';
import { AccuracyChip, ProgressBar } from '../components/dashboard/ProgressBar';
import type { MockResultItem } from '../types';
import { areaScores, durationText, hmsText, matchesFilter, mockFileBySlug, mockRoute, scorePct, timeUsedSeconds } from './model';
import type { ResultFilter } from './model';
import { resultsFor, useMock } from './store';
import { Shell, Stat, btnPrimary, btnSecondary, card, formatWhen, sectionTitle } from './ui';

const FILTERS: { key: ResultFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'wrong', label: 'Wrong' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'unanswered', label: 'Unanswered' },
];

/** The list filter per result, so coming back from a question keeps it (and review steps through the same list). */
export const resultFilters = new Map<string, ResultFilter>();

function Badge({ item }: { item: MockResultItem }) {
  const b =
    item.selected === ''
      ? { Icon: Minus, text: 'Unanswered', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' }
      : item.correct
        ? { Icon: Check, text: 'Correct', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' }
        : { Icon: X, text: 'Wrong', cls: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[15px] font-medium ${b.cls}`}>
      <b.Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {b.text}
    </span>
  );
}

export function ResultsView({ slug, resultId }: { slug: string; resultId: string }) {
  const results = useMock((s) => s.results);
  const files = useContent((s) => s.files);
  const [filter, setFilterState] = useState<ResultFilter>(() => resultFilters.get(resultId) ?? 'all');
  const result = results.find((r) => r.resultId === resultId);
  const hasFile = !!mockFileBySlug(files, slug);
  const back = () => navigate(hasFile ? mockRoute({ kind: 'briefing', slug }) : '/');

  const areas = useMemo(() => (result ? areaScores(result) : []), [result]);
  const counts = useMemo(() => {
    const c: Record<ResultFilter, number> = { all: 0, wrong: 0, flagged: 0, unanswered: 0 };
    for (const item of result?.items ?? []) for (const f of FILTERS) if (matchesFilter(item, f.key)) c[f.key]++;
    return c;
  }, [result]);
  const previous = useMemo(() => {
    if (!result) return undefined;
    return resultsFor(results, slug).find((r) => r.submittedAt < result.submittedAt);
  }, [results, slug, result]);

  if (!result) {
    return (
      <Shell title="Mock results" onBack={back} backLabel="Back">
        <div className={`${card} text-center`}>
          <p className="text-lg font-semibold">Result not found</p>
          <p className="mt-2 text-slate-600 dark:text-slate-400">It may have been erased with a progress reset, or saved in another browser.</p>
        </div>
      </Shell>
    );
  }

  const setFilter = (f: ResultFilter) => {
    resultFilters.set(resultId, f);
    setFilterState(f);
  };
  const pct = scorePct(result);
  const wrongAnswered = result.answered - result.correct;
  const unanswered = result.total - result.answered;
  const flagged = counts.flagged;
  const totalItemSeconds = result.items.reduce((sum, i) => sum + i.timeSeconds, 0);
  const shown = result.items.map((item, index) => ({ item, index })).filter(({ item }) => matchesFilter(item, filter));

  return (
    <Shell title={`${result.name}: results`} onBack={back} backLabel={hasFile ? 'Back to the mock' : 'Back to home'}>
      <div className="space-y-6">
        <section className={card} aria-label="Score">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
            <p className="text-4xl font-bold tabular-nums">
              {result.correct}
              <span className="text-2xl font-semibold text-slate-500 dark:text-slate-400"> / {result.total}</span>
            </p>
            <p className="pb-1 text-2xl font-semibold tabular-nums text-slate-700 dark:text-slate-200">{pct}%</p>
          </div>
          <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">
            Submitted {formatWhen(result.submittedAt)}
            {result.endedBy === 'time' && ' automatically when time ran out'}.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Correct" value={result.correct} className="text-emerald-600 dark:text-emerald-400" />
            <Stat label="Wrong" value={wrongAnswered} className="text-red-600 dark:text-red-400" />
            <Stat label="Unanswered" value={unanswered} className="text-amber-600 dark:text-amber-400" />
            <Stat label="Flagged" value={flagged} />
            <Stat label="Time used" value={`${durationText(timeUsedSeconds(result))} of ${durationText(result.timeLimitMinutes * 60)}`} />
            <Stat label="Avg / question" value={hmsText(result.total ? totalItemSeconds / result.total : 0)} />
          </div>
          <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
            GARP doesn't publish a pass mark, so read this against your other attempts and the areas below.
            {previous && ` Previous attempt: ${previous.correct}/${previous.total} (${scorePct(previous)}%) on ${formatWhen(previous.submittedAt)}.`}
          </p>
        </section>

        <section aria-labelledby="areas-title">
          <h2 id="areas-title" className={sectionTitle}>
            By area, weakest first
          </h2>
          <ul className={`${card} mt-3 space-y-4`}>
            {areas.map((a) => (
              <li key={a.subject}>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words font-medium">{a.subject}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-[15px] tabular-nums text-slate-600 dark:text-slate-400">
                      {a.correct}/{a.total}
                    </span>
                    <AccuracyChip accuracy={a.accuracy} />
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar
                    value={a.accuracy}
                    label={`${a.subject}: ${a.correct} of ${a.total} correct`}
                    tone={a.accuracy >= 0.7 ? 'bg-emerald-500' : a.accuracy >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {hasFile && (
            <button type="button" onClick={() => navigate(mockRoute({ kind: 'briefing', slug }))} className={btnPrimary}>
              <RotateCcw className="h-5 w-5" aria-hidden="true" />
              Mock page and history
            </button>
          )}
          <button type="button" onClick={() => navigate('/')} className={btnSecondary}>
            <Home className="h-5 w-5" aria-hidden="true" />
            Home
          </button>
        </div>

        <section aria-labelledby="questions-title">
          <h2 id="questions-title" className={sectionTitle}>
            Questions
          </h2>
          <div role="group" aria-label="Show" className="mt-3 flex flex-wrap gap-2">
            {FILTERS.map(({ key, label }) => {
              const active = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(key)}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-medium transition-colors ${
                    active
                      ? 'border-primary bg-primary text-white'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {label}
                  <span className={`rounded-full px-1.5 tabular-nums ${active ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'}`}>{counts[key]}</span>
                </button>
              );
            })}
          </div>
          {shown.length === 0 ? (
            <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">No questions match this filter.</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {shown.map(({ item, index }) => (
                <li key={item.questionId}>
                  <button
                    type="button"
                    onClick={() => navigate(mockRoute({ kind: 'review', slug, resultId, index }))}
                    className="flex min-h-[44px] w-full items-start gap-3 rounded-2xl bg-card-light p-4 text-left shadow-sm transition hover:shadow-md dark:bg-card-dark"
                  >
                    <span className="w-8 shrink-0 pt-0.5 text-[15px] font-semibold tabular-nums text-slate-600 dark:text-slate-400">{item.number}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words leading-snug">{item.subject}</span>
                      <span className="mt-1 flex flex-wrap gap-x-3 text-[15px] text-slate-600 dark:text-slate-400">
                        <span>Yours: {item.selected ? item.selected.toUpperCase() : '–'}</span>
                        <span>Answer: {item.correctOption.toUpperCase()}</span>
                        <span className="tabular-nums">{hmsText(item.timeSeconds)}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge item={item} />
                      {item.flagged && (
                        <span className="inline-flex items-center gap-1 text-[15px] text-amber-600 dark:text-amber-400">
                          <Flag className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true" />
                          Flagged
                        </span>
                      )}
                    </span>
                    <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Shell>
  );
}
