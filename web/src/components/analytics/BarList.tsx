import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export interface BarRowData {
  key: string;
  label: string;
  /** 0..1, drawn as the bar length. */
  value: number;
  valueText: string;
  detail: ReactNode;
  onClick?: () => void;
  actionLabel?: string;
}

/**
 * Horizontal bars laid out in HTML so long labels (topic names, full LO text) wrap instead of being clipped.
 * Every value is printed as text beside its bar, so nothing depends on colour or hover.
 */
export function BarList({ rows, barClass }: { rows: BarRowData[]; barClass: string }) {
  return (
    <ul className="-mx-2 space-y-1">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="flex items-start gap-3">
              <span className="min-w-0 flex-1 break-words leading-snug">{r.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">{r.valueText}</span>
              {r.onClick && <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />}
            </span>
            <span aria-hidden="true" className="mt-2 block h-2.5 w-full rounded-[4px] bg-slate-100 dark:bg-slate-700/70">
              <span
                className={`block h-full rounded-r-[4px] ${barClass}`}
                style={{ width: `${Math.max(0, Math.min(1, r.value)) * 100}%` }}
              />
            </span>
            <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">{r.detail}</span>
          </>
        );
        return (
          <li key={r.key}>
            {r.onClick ? (
              <button
                type="button"
                onClick={r.onClick}
                aria-label={r.actionLabel}
                className="block min-h-[44px] w-full rounded-xl px-2 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                {inner}
              </button>
            ) : (
              <div className="px-2 py-2">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
