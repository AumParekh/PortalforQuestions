import { useMemo, useState } from 'react';
import type { AttemptRecord } from '../../types';
import { ChartCard, ChartTooltip } from './ChartCard';
import { CHROME, addDays, dayKey, dayKeyOf, longDate, pct, plural, shortDate, shortMonth, useChartWidth } from './chartUtils';

const WEEKS = 16;
const LABEL_W = 40;
const TOP_H = 24;
const GAP = 3;

interface Cell {
  date: Date;
  week: number;
  weekday: number;
  total: number;
  correct: number;
}

/** Fixed, readable thresholds (answers per day) rather than quantiles, so the legend means the same thing every week. */
const LEVELS = [
  { min: 0, label: '0', fill: 'fill-slate-100 dark:fill-slate-700/60', bg: 'bg-slate-100 dark:bg-slate-700/60' },
  { min: 1, label: '1–5', fill: 'fill-indigo-200 dark:fill-indigo-800', bg: 'bg-indigo-200 dark:bg-indigo-800' },
  { min: 6, label: '6–15', fill: 'fill-indigo-400 dark:fill-indigo-600', bg: 'bg-indigo-400 dark:bg-indigo-600' },
  { min: 16, label: '16–30', fill: 'fill-indigo-600 dark:fill-indigo-400', bg: 'bg-indigo-600 dark:bg-indigo-400' },
  { min: 31, label: '31+', fill: 'fill-indigo-800 dark:fill-indigo-200', bg: 'bg-indigo-800 dark:bg-indigo-200' },
] as const;

function levelOf(n: number) {
  let lv: (typeof LEVELS)[number] = LEVELS[0];
  for (const l of LEVELS) if (n >= l.min) lv = l;
  return lv;
}

function buildCells(attempts: AttemptRecord[], now: Date): Cell[] {
  const today = addDays(now, 0);
  const firstSunday = addDays(today, -today.getDay() - (WEEKS - 1) * 7);
  const cells: Cell[] = [];
  const index = new Map<string, Cell>();
  for (let i = 0; ; i++) {
    const date = addDays(firstSunday, i);
    if (date > today) break;
    const cell: Cell = { date, week: Math.floor(i / 7), weekday: i % 7, total: 0, correct: 0 };
    cells.push(cell);
    index.set(dayKey(date), cell);
  }
  for (const a of attempts) {
    const c = index.get(dayKeyOf(a.timestamp));
    if (!c) continue;
    c.total++;
    if (a.isCorrect) c.correct++;
  }
  return cells;
}

export function StudyHeatmap({ attempts, now, currentStreak }: { attempts: AttemptRecord[]; now: Date; currentStreak: number }) {
  const cells = useMemo(() => buildCells(attempts, now), [attempts, now]);
  const { ref, width } = useChartWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const active = cells.filter((c) => c.total > 0);
  const busiest = active.reduce<Cell | null>((b, c) => (!b || c.total > b.total ? c : b), null);
  const caption =
    active.length === 0
      ? `No study days in the last ${WEEKS} weeks yet.`
      : `You studied on ${active.length} of the last ${cells.length} days${busiest ? `; busiest was ${shortDate(busiest.date)} with ${plural(busiest.total, 'answer')}` : ''}. ${
          currentStreak > 0 ? `Current streak: ${plural(currentStreak, 'day')}.` : 'Answer one question today to start a new streak.'
        }`;

  const W = Math.max(width, 240);
  const step = Math.max(10, Math.min(30, Math.floor((W - LABEL_W) / WEEKS)));
  const cell = step - GAP;
  const gridW = LABEL_W + step * WEEKS;
  const H = TOP_H + step * 7;
  const x = (week: number) => LABEL_W + week * step;
  const y = (weekday: number) => TOP_H + weekday * step;

  // Month labels at the first week that starts in a new month, skipped if they would collide with the previous one.
  const months: { week: number; label: string }[] = [];
  let lastX = -Infinity;
  for (let w = 0; w < WEEKS; w++) {
    const first = cells[w * 7];
    if (!first) break;
    const prev = w === 0 ? null : cells[(w - 1) * 7];
    if (prev && prev.date.getMonth() === first.date.getMonth()) continue;
    if (x(w) - lastX < 40) continue;
    months.push({ week: w, label: shortMonth(first.date) });
    lastX = x(w);
  }

  const hovered = hover === null ? null : cells[hover];

  return (
    <ChartCard
      title="Study calendar"
      caption={caption}
      legend={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-slate-700 dark:text-slate-300">
          <span className="text-slate-600 dark:text-slate-400">Answers per day:</span>
          {LEVELS.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-sm ${l.bg}`} />
              {l.label}
            </span>
          ))}
        </div>
      }
      table={{
        caption: `Answers per study day, last ${WEEKS} weeks`,
        columns: ['Day', 'Answered', 'Accuracy'],
        rows: [...active].reverse().map((c) => [longDate(c.date), c.total, pct(c.correct / c.total)]),
      }}
    >
      <div ref={ref} className="relative w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="group"
          aria-label={`Study calendar for the last ${WEEKS} weeks. ${caption}`}
          className="block"
          onPointerLeave={() => setHover(null)}
        >
          <g transform={`translate(${Math.max(0, (W - gridW) / 2)},0)`}>
            {months.map((m) => (
              <text key={m.week} x={x(m.week)} y={TOP_H - 8} fontSize={15} className={CHROME.tick}>
                {m.label}
              </text>
            ))}
            {[
              [1, 'Mon'],
              [3, 'Wed'],
              [5, 'Fri'],
            ].map(([d, label]) => (
              <text key={label} x={LABEL_W - 8} y={y(d as number) + cell / 2} dy="0.35em" textAnchor="end" fontSize={15} className={CHROME.tick}>
                {label}
              </text>
            ))}
            {cells.map((c, i) => (
              <rect
                key={i}
                x={x(c.week)}
                y={y(c.weekday)}
                width={cell}
                height={cell}
                rx={Math.min(4, cell / 4)}
                role="img"
                aria-label={`${longDate(c.date)}: ${c.total === 0 ? 'no answers' : `${plural(c.total, 'answer')}, ${pct(c.correct / c.total)} correct`}`}
                className={`${levelOf(c.total).fill} ${hover === i ? 'stroke-slate-900 dark:stroke-white' : ''}`}
                strokeWidth={hover === i ? 1.5 : 0}
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
              />
            ))}
          </g>
        </svg>
        {hovered && hover !== null && (
          <ChartTooltip x={Math.max(0, (W - gridW) / 2) + x(hovered.week) + cell / 2} y={y(hovered.weekday)} containerWidth={W}>
            <div className="font-semibold tabular-nums">{hovered.total === 0 ? 'No answers' : plural(hovered.total, 'answer')}</div>
            <div className="text-slate-600 dark:text-slate-400">
              {longDate(hovered.date)}
              {hovered.total > 0 && ` · ${pct(hovered.correct / hovered.total)} correct`}
            </div>
          </ChartTooltip>
        )}
      </div>
    </ChartCard>
  );
}
