import { useCallback, useEffect } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { navigate } from '../lib/router';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { QuestionCard } from '../components/QuestionCard';
import { SolutionPanel } from '../components/SolutionPanel';
import type { AnswerRecord } from '../types';
import { hmsText, matchesFilter, mockRoute } from './model';
import { resultFilters } from './ResultsView';
import { useMock } from './store';
import { Shell, card, iconButton } from './ui';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** One submitted question with its solution. Prev / Next step through the results list's current filter. */
export function ReviewView({ slug, resultId, index }: { slug: string; resultId: string; index: number }) {
  const result = useMock((s) => s.results.find((r) => r.resultId === resultId));
  const byId = useContent((s) => s.byId);
  const states = useProgress((s) => s.states);
  const toResults = useCallback(() => navigate(mockRoute({ kind: 'results', slug, resultId })), [slug, resultId]);

  const item = result?.items[index];
  const filter = resultFilters.get(resultId) ?? 'all';
  // Positions (in the paper) the list currently shows; if this question isn't among them, step through all.
  const inFilter = result ? result.items.map((it, i) => (matchesFilter(it, filter) ? i : -1)).filter((i) => i >= 0) : [];
  const order = inFilter.includes(index) ? inFilter : (result?.items.map((_, i) => i) ?? []);
  const at = order.indexOf(index);
  const prevIndex = at > 0 ? order[at - 1] : undefined;
  const nextIndex = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined;

  const go = useCallback((i: number | undefined) => {
    if (i !== undefined) navigate(mockRoute({ kind: 'review', slug, resultId, index: i }));
  }, [slug, resultId]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === 'ArrowLeft') go(prevIndex);
      else if (e.key === 'ArrowRight') go(nextIndex);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, prevIndex, nextIndex]);

  if (!result || !item) {
    return (
      <Shell title="Mock review" onBack={toResults} backLabel="Back to results">
        <div className={`${card} text-center`}>
          <p className="text-lg font-semibold">Question not found</p>
        </div>
      </Shell>
    );
  }

  const q = byId[item.questionId];
  const record: AnswerRecord = {
    selected: item.selected,
    correct: item.correct,
    timeTakenSeconds: item.timeSeconds,
    timedOut: result.endedBy === 'time' && item.selected === '',
  };
  const marked = !!states[item.questionId]?.markedForReview;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-2 py-2">
          <button type="button" onClick={toResults} aria-label="Back to results" className={iconButton}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="font-semibold leading-snug">
              Question {item.number} <span className="font-normal text-slate-600 dark:text-slate-400">of {result.total}</span>
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 break-words text-[15px] leading-snug text-slate-600 dark:text-slate-400">
              <span>{item.subject}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{hmsText(item.timeSeconds)} spent</span>
              {item.flagged && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Flag className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true" />
                  Flagged
                </span>
              )}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8 pt-5">
        {q ? (
          <div className="space-y-6">
            <QuestionCard question={q} record={record} animateFeedback={false} onSelect={() => undefined} />
            <SolutionPanel
              key={q.id}
              question={q}
              record={record}
              marked={marked}
              onToggleMark={() => useProgress.getState().setMarked(q, !marked)}
            />
          </div>
        ) : (
          <div className={card}>
            <p className="font-semibold">This question is no longer in the question bank.</p>
            <p className="mt-2 text-slate-600 dark:text-slate-400">
              Your answer: {item.selected ? item.selected.toUpperCase() : 'none'}. Correct answer: {item.correctOption.toUpperCase()}.
            </p>
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 z-30 border-t border-slate-200 bg-surface-light/90 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/90">
        <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-4">
          <button
            type="button"
            onClick={() => go(prevIndex)}
            disabled={prevIndex === undefined}
            className="inline-flex min-h-[48px] items-center gap-1 rounded-xl border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            Prev
          </button>
          <button
            type="button"
            onClick={toResults}
            className="inline-flex min-h-[48px] items-center rounded-xl border border-primary px-3 font-semibold text-primary hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
          >
            Results
          </button>
          <button
            type="button"
            onClick={() => go(nextIndex)}
            disabled={nextIndex === undefined}
            className="ml-auto inline-flex min-h-[48px] items-center gap-1 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-600 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            Next
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </div>
  );
}
