import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, ChevronRight, X, XCircle } from 'lucide-react';
import { Markdown } from '../Markdown';
import { startLoDrill } from '../dashboard/launch';
import { useContent } from '../../store/content';
import { useTf } from '../../store/tf';
import type { TFCard } from '../../types';
import { haptic, isCoarsePointer } from './deck';
import { useTfRun } from './run';
import { SwipeCard } from './SwipeCard';

const WRONG_HOLD_MS = 800;
const MAX_SECONDS = 600;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function isActivatable(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && !!el.closest('button, a, summary, [role="button"]');
}

/** Renders text with the given phrases wrapped in <mark>, longest phrase first so overlaps resolve sensibly. */
function Highlighted({ text, phrases, tone }: { text: string; phrases: string[]; tone: 'fix' | 'wrong' }) {
  const wanted = [...new Set(phrases.map((p) => p.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (wanted.length === 0) return <>{text}</>;
  const re = new RegExp(`(${wanted.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const cls =
    tone === 'fix'
      ? 'rounded bg-emerald-100 px-0.5 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-100'
      : 'rounded bg-red-100 px-0.5 text-red-900 line-through decoration-2 dark:bg-red-500/25 dark:text-red-100';
  return (
    <>
      {text.split(re).map((part, i) => (wanted.includes(part) ? <mark key={i} className={cls}>{part}</mark> : <span key={i}>{part}</span>))}
    </>
  );
}

/** Explanation, the corrected/original wording, and a link to the source question. Shared with the summary's missed list. */
export function TfExplanation({ card }: { card: TFCard }) {
  const source = useContent((s) => s.byId[card.sourceId]);
  const twin = useTf((s) => (card.twinId ? s.byId[card.twinId] : undefined));
  return (
    <div className="space-y-3">
      {!card.isTrue && card.correction && (
        <div className="rounded-xl border border-emerald-600/30 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-950/30">
          <p className="text-[15px] font-semibold text-emerald-800 dark:text-emerald-200">What would make it true</p>
          <p className="mt-1 text-base leading-relaxed text-slate-900 dark:text-slate-100">
            <Highlighted text={card.correction} phrases={(card.changes ?? []).map((c) => c.to)} tone="fix" />
          </p>
        </div>
      )}
      {card.variant === 'corrected' && twin && (
        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300">The false version it was fixed from</p>
          <p className="mt-1 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
            <Highlighted text={twin.statement} phrases={(twin.changes ?? []).map((c) => c.from)} tone="wrong" />
          </p>
        </div>
      )}
      <Markdown className="text-base leading-relaxed text-slate-800 dark:text-slate-200">{card.explanation}</Markdown>
      {card.edited && card.originalText && (
        <div className="text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">
          <p className="font-medium">Original option</p>
          <Markdown>{card.originalText}</Markdown>
        </div>
      )}
      {source && (
        <button
          type="button"
          onClick={() => startLoDrill(`${source.subject}::${source.loText || source.lo}`, [source.id])}
          className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
        >
          Open the full question
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function TfPlayView() {
  const run = useTfRun((s) => s.run);
  const byId = useTf((s) => s.byId);

  const [holding, setHolding] = useState(false);
  const [coarse] = useState(isCoarsePointer);
  const shownAt = useRef(performance.now());
  const holdTimer = useRef<number | null>(null);

  const index = run?.index ?? 0;
  const sessionId = run?.sessionId ?? '';
  const cardId = run?.ids[index] ?? '';
  const card: TFCard | undefined = cardId ? byId[cardId] : undefined;
  const result = run?.results[index];
  const revealed = !!result && !holding;
  const total = run?.ids.length ?? 0;
  const answeredCount = run?.results.length ?? 0;
  const correctCount = run ? run.results.reduce((n, r) => (r.correct ? n + 1 : n), 0) : 0;
  const isLast = index + 1 >= total;

  const clearHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  useEffect(() => {
    shownAt.current = performance.now();
    clearHold();
    setHolding(false);
    window.scrollTo({ top: 0 });
  }, [index, sessionId]);

  useEffect(() => clearHold, []);

  const answer = useCallback(
    (answeredTrue: boolean) => {
      if (!card || result || holding) return;
      const seconds = Math.min(MAX_SECONDS, Math.max(0, Math.round((performance.now() - shownAt.current) / 1000)));
      const correct = useTf.getState().recordAnswer(card, answeredTrue, seconds, sessionId);
      useTfRun.getState().answer({ cardId: card.id, answeredTrue, correct, seconds });
      haptic(correct ? 10 : [20, 40, 20]);
      if (!correct) {
        setHolding(true);
        clearHold();
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          setHolding(false);
        }, WRONG_HOLD_MS);
      }
    },
    [card, result, holding, sessionId],
  );

  const goNext = useCallback(() => {
    if (!revealed) return;
    useTfRun.getState().next();
  }, [revealed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (!result) {
        if (k === 't' || k === 'f') {
          e.preventDefault();
          answer(k === 't');
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        // A focused button (e.g. "Open the full question") handles its own Enter/Space.
        if (isActivatable(e.target)) return;
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, answer, goNext]);

  const leave = () => {
    const mid = answeredCount > 0 && answeredCount < total;
    if (mid && !window.confirm('Leave this deck? Your answers so far are already saved.')) return;
    useTfRun.getState().toSetup();
  };

  if (!run) return null;

  const progress = total > 0 ? (answeredCount / total) * 100 : 0;
  const border = !result
    ? 'border-slate-200 dark:border-slate-700'
    : result.correct
      ? 'border-emerald-500 dark:border-emerald-500'
      : 'border-red-500 dark:border-red-500';
  const verdict = card?.isTrue ? 'TRUE' : 'FALSE';

  const choiceBase =
    'inline-flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl border-2 px-3 text-lg font-semibold transition-colors duration-150 motion-reduce:transition-none disabled:cursor-default';
  const choiceClass = (forTrue: boolean) => {
    const chosen = result && result.answeredTrue === forTrue;
    if (chosen) {
      return result.correct
        ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-600'
        : 'border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-600';
    }
    if (result) return 'border-slate-200 bg-card-light text-slate-500 dark:border-slate-700 dark:bg-card-dark dark:text-slate-400';
    return forTrue
      ? 'border-emerald-600 bg-card-light text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100 dark:border-emerald-500 dark:bg-card-dark dark:text-emerald-300 dark:hover:bg-emerald-500/10'
      : 'border-red-600 bg-card-light text-red-700 hover:bg-red-50 active:bg-red-100 dark:border-red-500 dark:bg-card-dark dark:text-red-300 dark:hover:bg-red-500/10';
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-4 py-1">
          <button
            type="button"
            onClick={leave}
            aria-label="Leave deck"
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100" aria-label={`Statement ${index + 1} of ${total}`}>
            {index + 1} / {total}
          </p>
          <p className="ml-auto text-[15px] font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
            {correctCount} correct
          </p>
        </div>
        <div
          className="h-1 w-full bg-slate-200 dark:bg-slate-800"
          role="progressbar"
          aria-label="Statements answered"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answeredCount}
        >
          <div className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 space-y-4 px-4 pb-8 pt-5">
        {card ? (
          <>
            <SwipeCard
              key={`${sessionId}-${index}`}
              enabled={!result}
              onSwipe={answer}
              className={`flex min-h-[240px] flex-col rounded-2xl border-2 bg-card-light p-5 shadow-sm dark:bg-card-dark sm:p-6 ${border} ${
                result && !result.correct && holding ? 'animate-shake' : ''
              }`}
            >
              <p className="break-words text-[15px] leading-snug text-slate-600 dark:text-slate-400">
                {card.subject}
                <span aria-hidden="true"> · </span>
                {card.topic}
              </p>
              <div className="flex flex-1 items-center py-5">
                <Markdown className="w-full text-xl font-medium leading-relaxed text-slate-900 dark:text-slate-50 sm:text-2xl sm:leading-relaxed">
                  {card.statement}
                </Markdown>
              </div>
              {result ? (
                <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <p
                    className={`flex items-center gap-2 font-semibold ${
                      result.correct ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {result.correct ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
                    ) : (
                      <XCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
                    )}
                    {result.correct ? 'Correct' : `Not quite: you said ${result.answeredTrue ? 'True' : 'False'}`}
                  </p>
                  {revealed && (
                    <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                      This statement is <span className="tracking-wide">{verdict}</span>
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[15px] text-slate-600 dark:text-slate-400">
                  {coarse ? 'Swipe right for True, left for False' : 'Press T for True, F for False'}
                </p>
              )}
            </SwipeCard>

            <p className="sr-only" aria-live="polite">
              {result ? (revealed ? `${result.correct ? 'Correct.' : 'Incorrect.'} This statement is ${verdict}.` : '') : ''}
            </p>

            {revealed && (
              <section aria-label="Explanation" className="rounded-2xl bg-card-light p-5 shadow-sm dark:bg-card-dark sm:p-6">
                <h2 className="mb-2 text-[15px] font-semibold text-slate-600 dark:text-slate-400">Why</h2>
                <TfExplanation card={card} />
              </section>
            )}
          </>
        ) : (
          <p className="py-16 text-center text-slate-600 dark:text-slate-400">This statement could not be found.</p>
        )}
      </main>

      <footer className="sticky bottom-0 z-30 border-t border-slate-200 bg-surface-light/90 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/90">
        <div className="mx-auto w-full max-w-[720px] px-4">
          {revealed || !card ? (
            <button
              type="button"
              onClick={card ? goNext : () => useTfRun.getState().toSetup()}
              className="inline-flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-lg font-semibold text-white shadow-sm hover:bg-primary-600"
            >
              {!card ? 'Back to setup' : isLast ? 'See results' : 'Next'}
              {card && <ChevronRight className="h-5 w-5" aria-hidden="true" />}
              {card && !coarse && <span className="sr-only"> (Enter)</span>}
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => answer(true)} disabled={!!result} className={`${choiceBase} ${choiceClass(true)}`}>
                <Check className="h-6 w-6" aria-hidden="true" />
                True
                {!coarse && (
                  <kbd className="ml-1 hidden rounded border border-current px-1.5 text-[15px] font-medium opacity-70 sm:inline">T</kbd>
                )}
              </button>
              <button type="button" onClick={() => answer(false)} disabled={!!result} className={`${choiceBase} ${choiceClass(false)}`}>
                <X className="h-6 w-6" aria-hidden="true" />
                False
                {!coarse && (
                  <kbd className="ml-1 hidden rounded border border-current px-1.5 text-[15px] font-medium opacity-70 sm:inline">F</kbd>
                )}
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
