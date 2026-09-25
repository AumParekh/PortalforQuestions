import { useMemo } from 'react';
import type { AttemptRecord, Question } from '../../types';
import { BarList } from './BarList';
import { ChartCard } from './ChartCard';
import { pct, plural, trapName } from './chartUtils';

interface TrapRow {
  op: string;
  attempts: number;
  wrong: number;
  rate: number;
}

function buildRows(attempts: AttemptRecord[], byId: Record<string, Question>): TrapRow[] {
  const map = new Map<string, TrapRow>();
  for (const a of attempts) {
    const ops = byId[a.questionId]?.trap?.operators;
    if (!ops || ops.length === 0) continue;
    for (const op of new Set(ops)) {
      let r = map.get(op);
      if (!r) {
        r = { op, attempts: 0, wrong: 0, rate: 0 };
        map.set(op, r);
      }
      r.attempts++;
      if (!a.isCorrect) r.wrong++;
    }
  }
  const rows = [...map.values()];
  for (const r of rows) r.rate = r.wrong / r.attempts;
  return rows.sort((a, b) => b.rate - a.rate || b.attempts - a.attempts);
}

export function TrapPerformance({ attempts, byId }: { attempts: AttemptRecord[]; byId: Record<string, Question> }) {
  const rows = useMemo(() => buildRows(attempts, byId), [attempts, byId]);
  const top = rows[0];
  const caption = !top
    ? 'None of your answered questions are tagged with a trap yet.'
    : top.wrong === 0
      ? 'How often you fall for each trap type. So far you have dodged every one.'
      : `How often you fall for each trap type: you miss ${pct(top.rate)} of ${trapName(top.op).toLowerCase()} questions, your costliest trap.`;
  return (
    <ChartCard
      title="Trap performance"
      caption={caption}
      table={{
        caption: 'Wrong-answer rate by trap type',
        columns: ['Trap type', 'Wrong rate', 'Wrong', 'Attempts'],
        rows: rows.map((r) => [trapName(r.op), pct(r.rate), r.wrong, r.attempts]),
      }}
    >
      {rows.length > 0 && (
        <BarList
          barClass="bg-orange-500 dark:bg-orange-400"
          rows={rows.map((r) => ({
            key: r.op,
            label: trapName(r.op),
            value: r.rate,
            valueText: `${pct(r.rate)} wrong`,
            detail: `Wrong on ${r.wrong} of ${plural(r.attempts, 'attempt')}`,
          }))}
        />
      )}
    </ChartCard>
  );
}
