import { useId } from 'react';
import type { ReactNode } from 'react';

export interface DataTableSpec {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}

interface Props {
  title: string;
  /** One line that reads the shape of the data: what to notice. */
  caption: ReactNode;
  legend?: ReactNode;
  controls?: ReactNode;
  table?: DataTableSpec;
  children: ReactNode;
}

/** Card chrome shared by every analytics chart: title, takeaway caption, legend, chart, data-table twin. */
export function ChartCard({ title, caption, legend, controls, table, children }: Props) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark sm:p-5">
      <h2 id={`${id}-title`} className="text-lg font-semibold leading-snug">
        {title}
      </h2>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">{caption}</p>
      {controls && <div className="mt-3">{controls}</div>}
      {legend && <div className="mt-3">{legend}</div>}
      <div className="mt-3">{children}</div>
      {table && table.rows.length > 0 && <DataTable spec={table} />}
    </section>
  );
}

function DataTable({ spec }: { spec: DataTableSpec }) {
  return (
    <details className="group mt-3 border-t border-slate-200 pt-1 dark:border-slate-700">
      <summary className="flex min-h-[44px] cursor-pointer items-center rounded-lg text-[15px] font-medium text-primary-600 hover:underline dark:text-primary-100">
        Show data table
      </summary>
      <div className="table-scroll pb-1">
        <table className="min-w-full border-collapse text-[15px] leading-snug">
          <caption className="sr-only">{spec.caption}</caption>
          <thead>
            <tr>
              {spec.columns.map((c, i) => (
                <th
                  key={c}
                  scope="col"
                  className={`border-b border-slate-200 px-2 py-1.5 font-semibold dark:border-slate-700 ${i === 0 ? 'text-left' : 'text-right'}`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, r) => (
              <tr key={r} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="px-2 py-1.5 text-left font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export interface LegendItem {
  label: string;
  /** Tailwind classes giving the swatch its colour (bg-*). */
  swatch: string;
  shape?: 'rect' | 'line';
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-slate-700 dark:text-slate-300">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`inline-block shrink-0 ${it.shape === 'line' ? 'h-0.5 w-4 rounded-full' : 'h-3 w-3 rounded-sm'} ${it.swatch}`}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

const TIP_WIDTH = 208;

/** A small readout anchored above a point in chart pixels; clamped so it never leaves the chart box. */
export function ChartTooltip({ x, y, containerWidth, children }: { x: number; y: number; containerWidth: number; children: ReactNode }) {
  const half = Math.min(TIP_WIDTH, containerWidth) / 2;
  const left = Math.max(half, Math.min(containerWidth - half, x));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] leading-snug text-slate-900 shadow-md dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      style={{ left, top: Math.max(0, y - 8), width: Math.min(TIP_WIDTH, containerWidth) }}
    >
      {children}
    </div>
  );
}
