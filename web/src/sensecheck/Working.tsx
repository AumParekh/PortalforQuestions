import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ExternalLink, Lightbulb } from 'lucide-react';
import { Markdown } from '../components/Markdown';
import { QuestionCard } from '../components/QuestionCard';
import { useContent } from '../store/content';
import type { AnswerRecord } from '../types';
import type { Scenario } from './types';
import { linkButton, prefersReducedMotion, scrollX } from './ui';

/** Delay between working steps as they unfold. */
const STEP_MS = 240;
// Reveals the correct option of a question preview without marking any choice (as in True/False).
const PREVIEW: AnswerRecord = { selected: '', correct: false, timeTakenSeconds: 0, timedOut: false };

/** Fades and lifts its content in once mounted (instant with reduced motion). */
function Appear({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setOn(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className={`transition duration-300 ease-out motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none ${
        on ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The full working, one named step at a time, then (after a miss) why the chosen option was wrong, and the takeaway.
 * `animate` is false for the summary's review, where everything shows at once.
 */
export function WorkingPanel({ scenario, chosen, animate = true }: { scenario: Scenario; chosen: number | null; animate?: boolean }) {
  const steps = scenario.working;
  const [shown, setShown] = useState(() => (animate && !prefersReducedMotion() ? 1 : steps.length));
  useEffect(() => {
    if (shown >= steps.length) return;
    const id = window.setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => window.clearTimeout(id);
  }, [shown, steps.length]);
  const done = shown >= steps.length;
  const wrong = chosen !== null ? scenario.options[chosen] : undefined;
  const missed = !!wrong && !wrong.correct;

  return (
    <div className="space-y-4">
      {missed && wrong && (
        <Appear className="rounded-xl border border-red-600/30 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-950/30">
          {/* The label is Markdown (it can hold $…$ math), so it is rendered, not printed raw. */}
          <div className="flex flex-wrap items-baseline text-[15px] font-semibold text-red-800 dark:text-red-200">
            <span className="mr-1">Why not</span>
            <span aria-hidden="true">“</span>
            <Markdown className={`${scrollX} min-w-0 [&_p]:inline`}>{wrong.label}</Markdown>
            <span aria-hidden="true">”</span>
          </div>
          {wrong.why ? (
            <Markdown className={`${scrollX} mt-1 text-base leading-relaxed text-slate-900 dark:text-slate-100`}>{wrong.why}</Markdown>
          ) : (
            <p className="mt-1 text-base leading-relaxed text-slate-900 dark:text-slate-100">The working below shows where it lands.</p>
          )}
          {scenario.trapCategory && <p className="mt-2 text-[15px] font-medium text-red-800 dark:text-red-200">Trap: {scenario.trapCategory}</p>}
        </Appear>
      )}

      {steps.length > 0 && (
        <section aria-label="Working" className="rounded-2xl border border-slate-200 bg-card-light p-4 dark:border-slate-700 dark:bg-card-dark">
          <h3 className="text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Working</h3>
          <ol className="mt-2 space-y-3" aria-live="polite">
            {steps.slice(0, shown).map((step, i) => (
              <li key={i}>
                <Appear>
                  {step.label && <p className="break-words text-[15px] font-semibold text-primary-700 dark:text-primary-100">{step.label}</p>}
                  <Markdown className={`${scrollX} text-base leading-relaxed text-slate-900 dark:text-slate-100`}>{step.display}</Markdown>
                </Appear>
              </li>
            ))}
          </ol>
        </section>
      )}

      {done && scenario.takeaway && (
        <Appear className="flex gap-2 rounded-xl bg-primary-50 px-3 py-2.5 dark:bg-primary/15">
          <Lightbulb className="mt-1 h-4 w-4 shrink-0 text-primary-700 dark:text-primary-100" aria-hidden="true" />
          <Markdown className={`${scrollX} min-w-0 flex-1 text-base leading-relaxed text-slate-900 dark:text-slate-50`}>{scenario.takeaway}</Markdown>
        </Appear>
      )}

      {done && scenario.source.kind === 'bank' && <SourceQuestion questionId={scenario.source.questionId} />}
    </div>
  );
}

/** "Open the question": a read-only preview of the bank question a round was built from. Nothing is recorded. */
export function SourceQuestion({ questionId }: { questionId: string }) {
  const question = useContent((s) => s.byId[questionId]);
  const [open, setOpen] = useState(false);
  if (!question) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={linkButton}>
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        {open ? 'Hide the question' : 'Open the question'}
        <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        // Read-only: the correct option is shown and nothing here records an answer or starts a session.
        <div className={`${scrollX} mt-2 space-y-4`}>
          <p className="text-[15px] text-slate-600 dark:text-slate-400">
            {question.id} · {question.subject}
          </p>
          <QuestionCard question={question} record={PREVIEW} animateFeedback={false} onSelect={() => undefined} />
          {question.solution && <Markdown className="text-base leading-relaxed text-slate-800 dark:text-slate-200">{question.solution}</Markdown>}
        </div>
      )}
    </div>
  );
}
