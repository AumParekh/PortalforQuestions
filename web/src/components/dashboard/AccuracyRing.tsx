export function accuracyTone(pct: number): string {
  return pct >= 70 ? 'text-emerald-600 dark:text-emerald-400' : pct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
}

export function AccuracyRing({ accuracy }: { accuracy: number | null }) {
  const pct = accuracy === null ? null : Math.round(accuracy * 100);
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - (pct ?? 0) / 100);
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg
        viewBox="0 0 120 120"
        className="h-full w-full -rotate-90"
        role="img"
        aria-label={pct === null ? 'Accuracy: nothing answered yet' : `Overall accuracy ${pct}%`}
      >
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-slate-200 dark:stroke-slate-700" />
        {pct !== null && (
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            stroke="currentColor"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className={`${accuracyTone(pct)} transition-[stroke-dashoffset] duration-700`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums">{pct === null ? '—' : `${pct}%`}</span>
        <span className="text-[15px] text-slate-600 dark:text-slate-400">accuracy</span>
      </div>
    </div>
  );
}
