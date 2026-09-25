import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { mostBehind, subjectCoverage } from '../../lib/examWeights';
import type { SubjectCoverage } from '../../lib/examWeights';
import { useContent } from '../../store/content';
import type { Question, QuestionState } from '../../types';
import { startSubjectQuick } from '../dashboard/launch';
import { ChartCard } from './ChartCard';
import { pct } from './chartUtils';

function caption(behind: SubjectCoverage | null, rows: SubjectCoverage[]): string {
  if (!behind) return 'No subject banks loaded.';
  if (rows.every((r) => r.attempted === 0)) {
    return `Nothing tried yet. Start with ${behind.subject}: ${pct(behind.weight)} of the exam.`;
  }
  return `Most behind for its weight: ${behind.subject} (${pct(behind.weight)} of the exam), ${pct(behind.coverage)} of its questions tried${
    behind.accuracy === null ? '' : ` at ${pct(behind.accuracy)} accuracy`
  }. Tap a subject for a 20-question drill.`;
}

/** Share of each subject's question bank tried at least once, and accuracy, against the FRM Part II exam weights. */
export function ExamCoverage({ questions, states }: { questions: Question[]; states: Record<string, QuestionState> }) {
  const files = useContent((s) => s.files);
  const rows = useMemo(() => subjectCoverage(questions, states), [questions, states]);
  const behind = useMemo(() => mostBehind(rows), [rows]);

  return (
    <ChartCard
      title="Coverage vs exam weights"
      caption={caption(behind, rows)}
      table={{
        caption: 'Coverage and accuracy by subject against exam weight',
        columns: ['Subject', 'Exam weight', 'Questions tried', 'Accuracy'],
        rows: rows.map((r) => [r.subject, pct(r.weight), `${r.attempted}/${r.total} (${pct(r.coverage)})`, pct(r.accuracy)]),
      }}
    >
      <ul className="-mx-2 space-y-1">
        {rows.map((r) => {
          const file = files.find((f) => f.path === `${r.code}.json`);
          const flagged = behind?.code === r.code;
          return (
            <li key={r.code}>
              <button
                type="button"
                disabled={!file}
                onClick={() => file && startSubjectQuick(r.subject, file)}
                aria-label={`Drill ${r.subject}: ${pct(r.weight)} of the exam, ${pct(r.coverage)} of questions tried, accuracy ${pct(r.accuracy)}${
                  flagged ? ', most behind for its weight' : ''
                }`}
                className={`block min-h-[44px] w-full rounded-xl border px-2 py-2 text-left transition hover:bg-slate-50 disabled:cursor-default dark:hover:bg-slate-800/60 ${
                  flagged ? 'border-amber-400 bg-amber-50/60 dark:border-amber-600 dark:bg-amber-950/30' : 'border-transparent'
                }`}
              >
                <span className="flex items-start gap-3">
                  <span className="min-w-0 flex-1 break-words leading-snug">
                    <span className="font-medium">{r.subject}</span>
                    <span className="ml-2 inline-block text-[15px] text-slate-600 dark:text-slate-400">{pct(r.weight)} of exam</span>
                    {flagged && (
                      <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 text-[15px] font-medium text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
                        Most behind
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{pct(r.coverage)}</span>
                  {file && <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />}
                </span>
                <span aria-hidden="true" className="mt-2 block h-2.5 w-full rounded-[4px] bg-slate-100 dark:bg-slate-700/70">
                  <span
                    className={`block h-full rounded-r-[4px] ${flagged ? 'bg-amber-500 dark:bg-amber-400' : 'bg-primary-600 dark:bg-indigo-400'}`}
                    style={{ width: `${Math.max(0, Math.min(1, r.coverage)) * 100}%` }}
                  />
                </span>
                <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">
                  {r.attempted}/{r.total} questions tried · {r.accuracy === null ? 'no answers yet' : `${pct(r.accuracy)} accuracy`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}
