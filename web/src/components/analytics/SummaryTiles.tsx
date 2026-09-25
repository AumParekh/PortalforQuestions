import type { ReactNode } from 'react';
import { CheckCircle2, Clock, Flame, Target } from 'lucide-react';
import type { OverallStats } from '../../lib/stats';
import { formatDuration, pct, plural } from './chartUtils';

function Tile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark">
      <div className="flex items-center gap-2 text-[15px] text-slate-600 dark:text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-[15px] text-slate-600 dark:text-slate-400">{sub}</div>
    </div>
  );
}

interface Props {
  stats: OverallStats;
  /** Rows in the attempt log, the denominator for time per answer. */
  attemptCount: number;
  streak: { current: number; longest: number };
}

export function SummaryTiles({ stats, attemptCount, streak }: Props) {
  const icon = 'h-4 w-4 shrink-0';
  const avg = attemptCount > 0 ? Math.round(stats.secondsStudied / attemptCount) : 0;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile
        icon={<CheckCircle2 className={icon} aria-hidden="true" />}
        label="Answered"
        value={stats.totalAttempts.toLocaleString()}
        sub={plural(stats.questionsAttempted, 'unique question')}
      />
      <Tile
        icon={<Target className={icon} aria-hidden="true" />}
        label="Accuracy"
        value={pct(stats.accuracy)}
        sub={`${stats.correct.toLocaleString()} right · ${stats.wrong.toLocaleString()} wrong`}
      />
      <Tile
        icon={<Clock className={icon} aria-hidden="true" />}
        label="Time studied"
        value={formatDuration(stats.secondsStudied)}
        sub={`${avg} s per answer`}
      />
      <Tile
        icon={<Flame className={icon} aria-hidden="true" />}
        label="Streak"
        value={plural(streak.current, 'day')}
        sub={`Longest ${plural(streak.longest, 'day')}`}
      />
    </div>
  );
}
