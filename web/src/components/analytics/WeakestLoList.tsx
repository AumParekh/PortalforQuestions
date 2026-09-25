import { useMemo } from 'react';
import { weakestLos } from '../../lib/stats';
import type { Question, QuestionState } from '../../types';
import { startLoDrill } from '../dashboard/launch';
import { BarList } from './BarList';
import { ChartCard } from './ChartCard';
import { pct, plural } from './chartUtils';

const LIMIT = 8;
const MIN_ATTEMPTS = 2;

export function WeakestLoList({ questions, states }: { questions: Question[]; states: Record<string, QuestionState> }) {
  const groups = useMemo(() => weakestLos(questions, states, LIMIT, MIN_ATTEMPTS), [questions, states]);
  const caption =
    groups.length === 0
      ? `Answer questions on a learning objective at least ${MIN_ATTEMPTS} times and your weakest ones will be ranked here.`
      : `The learning objectives costing you the most marks, weakest first. Tap one to drill every question on it.`;
  return (
    <ChartCard
      title="Weakest learning objectives"
      caption={caption}
      table={{
        caption: 'Weakest learning objectives',
        columns: ['Learning objective', 'Accuracy', 'Attempts', 'Questions'],
        rows: groups.map((g) => [g.label, pct(g.accuracy), g.attempts, g.total]),
      }}
    >
      {groups.length > 0 && (
        <BarList
          barClass="bg-primary-600 dark:bg-indigo-400"
          rows={groups.map((g) => ({
            key: g.key,
            label: g.label,
            value: g.accuracy ?? 0,
            valueText: pct(g.accuracy),
            detail: `${g.subject} · ${plural(g.attempts, 'attempt')} · ${plural(g.total, 'question')}`,
            onClick: () => startLoDrill(g.key, g.questionIds),
            actionLabel: `Drill this learning objective (${pct(g.accuracy)} accuracy over ${plural(g.attempts, 'attempt')}): ${g.label}`,
          }))}
        />
      )}
    </ChartCard>
  );
}
