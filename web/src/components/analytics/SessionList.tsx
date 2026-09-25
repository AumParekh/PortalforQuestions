import type { SessionRecord } from '../../types';
import { AccuracyChip } from '../dashboard/ProgressBar';
import { ChartCard } from './ChartCard';
import { longDate, modeName, pct, plural } from './chartUtils';

const LIMIT = 10;

function when(iso: string): string {
  const d = new Date(iso);
  return `${longDate(d)}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function pooled(list: SessionRecord[]): number | null {
  const answered = list.reduce((n, s) => n + s.correct + s.wrong, 0);
  return answered ? list.reduce((n, s) => n + s.correct, 0) / answered : null;
}

export function SessionList({ sessions }: { sessions: SessionRecord[] }) {
  const recent = sessions.slice(-LIMIT).reverse();
  const earlier = sessions.slice(0, -LIMIT);
  const recentAcc = pooled(recent);
  const earlierAcc = pooled(earlier);
  const caption =
    recent.length === 0
      ? 'Finish a session and it will be listed here with its score.'
      : earlierAcc === null
        ? `${plural(sessions.length, 'session')} finished, averaging ${pct(recentAcc)} correct.`
        : `Your last ${recent.length} sessions average ${pct(recentAcc)}, against ${pct(earlierAcc)} for the ${plural(earlier.length, 'session')} before them.`;
  return (
    <ChartCard title="Recent sessions" caption={caption}>
      {recent.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {recent.map((s) => (
            <li key={s.sessionId} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1">
                <span className="block font-medium leading-snug">{modeName(s.mode)}</span>
                <span className="block text-[15px] text-slate-600 dark:text-slate-400">{when(s.startedAt)}</span>
                <span className="block text-[15px] text-slate-600 dark:text-slate-400">
                  {s.answered}/{plural(s.totalQuestions, 'question')} answered · {s.correct} right, {s.wrong} wrong
                  {s.avgTimeSeconds > 0 && ` · ${Math.round(s.avgTimeSeconds)} s avg`}
                </span>
              </span>
              {s.answered > 0 ? (
                <AccuracyChip accuracy={s.accuracy} />
              ) : (
                <span className="shrink-0 text-[15px] text-slate-600 dark:text-slate-400">No answers</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
