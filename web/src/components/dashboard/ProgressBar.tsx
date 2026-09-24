export function ProgressBar({ value, label, tone = 'bg-primary' }: { value: number; label: string; tone?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span
      className="block h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <span className={`block h-full rounded-full ${tone} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function AccuracyChip({ accuracy }: { accuracy: number | null }) {
  if (accuracy === null) return null;
  const pct = Math.round(accuracy * 100);
  const tone =
    pct >= 70
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
      : pct >= 50
        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
        : 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300';
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[15px] font-medium tabular-nums ${tone}`}>{pct}%</span>;
}
