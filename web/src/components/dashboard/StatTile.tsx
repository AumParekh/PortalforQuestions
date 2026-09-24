import type { ReactNode } from 'react';

export function StatTile({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
      <div className={`text-lg font-semibold tabular-nums ${className}`}>{value}</div>
      <div className="text-[15px] text-slate-600 dark:text-slate-400">{label}</div>
    </div>
  );
}
