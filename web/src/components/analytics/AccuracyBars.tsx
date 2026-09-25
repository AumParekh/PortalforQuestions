import { useMemo, useState } from 'react';
import { groupProgress } from '../../lib/stats';
import type { GroupProgress } from '../../lib/stats';
import type { Question, QuestionState } from '../../types';
import { startTopicDrill } from '../dashboard/launch';
import { BarList } from './BarList';
import { ChartCard } from './ChartCard';
import { pct, plural } from './chartUtils';

function weakestFirst(groups: GroupProgress[]): GroupProgress[] {
  return groups
    .filter((g) => g.attempts > 0)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0) || b.attempts - a.attempts);
}

function detail(g: GroupProgress) {
  return `${plural(g.attempts, 'attempt')} · ${g.attempted}/${g.total} questions tried`;
}

function spreadCaption(sorted: GroupProgress[], noun: string, scope = ''): string {
  if (sorted.length === 0) return `No ${noun}s attempted yet${scope}.`;
  const weak = sorted[0];
  if (sorted.length === 1) return `Only ${weak.label} attempted so far${scope}: ${pct(weak.accuracy)} over ${plural(weak.attempts, 'attempt')}.`;
  const strong = sorted[sorted.length - 1];
  return `Weakest ${noun}${scope} is ${weak.label} at ${pct(weak.accuracy)}; strongest is ${strong.label} at ${pct(strong.accuracy)}.`;
}

export function SubjectAccuracy({ questions, states }: { questions: Question[]; states: Record<string, QuestionState> }) {
  const groups = useMemo(() => groupProgress(questions, states, (q) => ({ key: q.subject, label: q.subject })), [questions, states]);
  const sorted = useMemo(() => weakestFirst(groups), [groups]);
  const untouched = groups.length - sorted.length;
  return (
    <ChartCard
      title="Accuracy by subject"
      caption={spreadCaption(sorted, 'subject')}
      table={{
        caption: 'Accuracy by subject',
        columns: ['Subject', 'Accuracy', 'Attempts', 'Questions tried'],
        rows: sorted.map((g) => [g.label, pct(g.accuracy), g.attempts, `${g.attempted}/${g.total}`]),
      }}
    >
      <BarList
        barClass="bg-primary-600 dark:bg-indigo-400"
        rows={sorted.map((g) => ({ key: g.key, label: g.label, value: g.accuracy ?? 0, valueText: pct(g.accuracy), detail: detail(g) }))}
      />
      {untouched > 0 && (
        <p className="mt-2 text-[15px] text-slate-600 dark:text-slate-400">
          {plural(untouched, 'subject')} not started yet: {groups.filter((g) => g.attempts === 0).map((g) => g.label).join(', ')}.
        </p>
      )}
    </ChartCard>
  );
}

export function TopicAccuracy({ questions, states }: { questions: Question[]; states: Record<string, QuestionState> }) {
  const subjects = useMemo(() => {
    const bySubject = groupProgress(questions, states, (q) => ({ key: q.subject, label: q.subject }));
    return bySubject.map((g) => ({ name: g.key, attempts: g.attempts, accuracy: g.accuracy }));
  }, [questions, states]);
  const defaultSubject = useMemo(() => {
    const tried = subjects.filter((s) => s.attempts > 0).sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
    return tried[0]?.name ?? subjects[0]?.name ?? '';
  }, [subjects]);
  const [picked, setPicked] = useState<string | null>(null);
  const subject = picked && subjects.some((s) => s.name === picked) ? picked : defaultSubject;

  const groups = useMemo(
    () =>
      groupProgress(
        questions.filter((q) => q.subject === subject),
        states,
        (q) => ({ key: `${q.subject}::${q.topic}`, label: q.topic }),
      ),
    [questions, states, subject],
  );
  const sorted = useMemo(() => weakestFirst(groups), [groups]);
  const untouched = groups.length - sorted.length;

  return (
    <ChartCard
      title="Accuracy by topic"
      caption={`${spreadCaption(sorted, 'topic', ` in ${subject}`)} Tap a topic to drill it.`}
      controls={
        <div role="group" aria-label="Subject" className="flex flex-wrap gap-2">
          {subjects.map((s) => {
            const on = s.name === subject;
            return (
              <button
                key={s.name}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(s.name)}
                className={`min-h-[44px] rounded-xl border px-3 text-[15px] font-medium transition ${
                  on
                    ? 'border-primary bg-primary-50 text-primary-700 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-200'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      }
      table={{
        caption: `Accuracy by topic in ${subject}`,
        columns: ['Topic', 'Accuracy', 'Attempts', 'Questions tried'],
        rows: sorted.map((g) => [g.label, pct(g.accuracy), g.attempts, `${g.attempted}/${g.total}`]),
      }}
    >
      <BarList
        barClass="bg-primary-600 dark:bg-indigo-400"
        rows={sorted.map((g) => ({
          key: g.key,
          label: g.label,
          value: g.accuracy ?? 0,
          valueText: pct(g.accuracy),
          detail: detail(g),
          onClick: () => startTopicDrill(g.key, g.questionIds),
          actionLabel: `Drill ${g.label}: ${pct(g.accuracy)} accuracy over ${plural(g.attempts, 'attempt')}`,
        }))}
      />
      {untouched > 0 && (
        <p className="mt-2 text-[15px] text-slate-600 dark:text-slate-400">
          {plural(untouched, 'topic')} in {subject} not started yet.
        </p>
      )}
    </ChartCard>
  );
}
