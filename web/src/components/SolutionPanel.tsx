import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, Clock, Flag, ListChecks, MinusCircle, XCircle } from 'lucide-react';
import type { AnswerRecord, Question } from '../types';
import { Markdown } from './Markdown';

interface Props {
  question: Question;
  record: AnswerRecord;
  marked: boolean;
  onToggleMark: () => void;
}

function humanize(op: string): string {
  const s = op.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CARD = 'rounded-2xl border border-slate-200 bg-card-light p-4 shadow-sm dark:border-slate-700 dark:bg-card-dark sm:p-6';

export function SolutionPanel({ question, record, marked, onToggleMark }: Props) {
  const { operators, explanation } = question.trap;
  const hasTrap = operators.length > 0;
  const notAnswered = record.selected === '' && !record.timedOut;

  return (
    <section className="space-y-4" aria-label="Solution">
      <div
        className={`flex items-start gap-3 rounded-2xl border p-4 ${
          notAnswered
            ? 'border-amber-500/50 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200'
            : record.correct
            ? 'border-emerald-600/40 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200'
            : 'border-red-600/40 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200'
        }`}
        role="status"
      >
        {notAnswered ? (
          <MinusCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        ) : record.timedOut ? (
          <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        ) : record.correct ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        )}
        <p className="font-medium">
          {notAnswered
            ? `Not answered. The correct answer is ${question.answer.toUpperCase()}.`
            : record.timedOut
            ? `Time's up. The correct answer is ${question.answer.toUpperCase()}.`
            : record.correct
              ? 'Correct.'
              : `Incorrect. The correct answer is ${question.answer.toUpperCase()}.`}
        </p>
      </div>

      <div className={CARD}>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
          Solution
        </h2>
        <Markdown>{question.solution}</Markdown>
      </div>

      <div className={CARD}>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="h-5 w-5 text-primary" aria-hidden="true" />
          Option analysis
        </h2>
        <div className="space-y-2">
          {question.options.map((opt) => {
            const analysis = question.optionAnalysis[opt.key];
            const isCorrect = analysis ? analysis.verdict === 'correct' : opt.key === question.answer;
            const isChosen = opt.key === record.selected;
            return (
              <details
                key={opt.key}
                open={isChosen || opt.key === question.answer}
                className="group rounded-xl border border-slate-200 dark:border-slate-700"
              >
                <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 text-[15px] font-semibold dark:border-slate-600">
                    {opt.key.toUpperCase()}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[15px] font-medium ${
                      isCorrect
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                    }`}
                  >
                    {isCorrect ? 'Correct' : 'Incorrect'}
                  </span>
                  {isChosen && <span className="text-[15px] text-slate-600 dark:text-slate-400">Your answer</span>}
                  <ChevronDown
                    className="ml-auto h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="space-y-3 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
                  <Markdown className="text-slate-600 dark:text-slate-400">{opt.text}</Markdown>
                  {analysis?.reason ? <Markdown>{analysis.reason}</Markdown> : null}
                </div>
              </details>
            );
          })}
        </div>
      </div>

      {hasTrap && (
        <div className="rounded-2xl border border-amber-500/50 bg-amber-50 p-4 shadow-sm dark:border-amber-500/40 dark:bg-amber-950/30 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-[15px] font-semibold text-white dark:bg-amber-600">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Trap
            </span>
            {operators.map((op) => (
              <span
                key={op}
                className="rounded-full border border-amber-500/50 px-2.5 py-0.5 text-[15px] text-amber-800 dark:text-amber-200"
              >
                {humanize(op)}
              </span>
            ))}
          </div>
          {explanation ? <Markdown>{explanation}</Markdown> : null}
        </div>
      )}

      <button
        type="button"
        onClick={onToggleMark}
        aria-pressed={marked}
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 font-medium transition-colors ${
          marked
            ? 'border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-950/40 dark:text-purple-200'
            : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
        }`}
      >
        <Flag className="h-4 w-4" aria-hidden="true" fill={marked ? 'currentColor' : 'none'} />
        {marked ? 'Marked for review' : 'Mark for review'}
      </button>
    </section>
  );
}
