import { Timer as TimerIcon } from 'lucide-react';

interface Props {
  remaining: number;
  total: number;
  compact?: boolean;
}

function format(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type Level = 'normal' | 'warn' | 'danger';

function level(remaining: number, total: number): Level {
  const f = total > 0 ? remaining / total : 0;
  if (f <= 0.1) return 'danger';
  if (f <= 0.25) return 'warn';
  return 'normal';
}

const TEXT: Record<Level, string> = {
  normal: 'text-primary-600 dark:text-primary-100',
  warn: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
};

const STROKE: Record<Level, string> = {
  normal: 'stroke-primary',
  warn: 'stroke-amber-500',
  danger: 'stroke-red-600 dark:stroke-red-500',
};

export function Timer({ remaining, total, compact = false }: Props) {
  const lvl = level(remaining, total);
  const label = `${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`;

  if (compact) {
    return (
      <span
        role="timer"
        aria-label={label}
        className={`inline-flex min-h-[44px] items-center gap-1 whitespace-nowrap font-mono text-[15px] font-semibold tabular-nums ${TEXT[lvl]}`}
      >
        <TimerIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {format(remaining)}
      </span>
    );
  }

  const size = 60;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fraction = total > 0 ? remaining / total : 0;

  return (
    <div role="timer" aria-label={label} className="relative h-[60px] w-[60px] shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-slate-200 dark:stroke-slate-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fraction)}
          className={`${STROKE[lvl]} transition-[stroke-dashoffset] duration-300 ease-linear`}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-mono text-[15px] font-semibold tabular-nums ${TEXT[lvl]}`}
      >
        {format(remaining)}
      </span>
    </div>
  );
}
