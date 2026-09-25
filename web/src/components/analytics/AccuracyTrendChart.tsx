import { useMemo, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { AttemptRecord } from '../../types';
import { ChartCard, ChartTooltip, Legend } from './ChartCard';
import { CHROME, addDays, columnPath, dayKey, dayKeyOf, longDate, pct, plural, shortDate, useChartWidth } from './chartUtils';

const DAYS = 30;

interface Day {
  date: Date;
  total: number;
  correct: number;
  accuracy: number | null;
}

function buildDays(attempts: AttemptRecord[], now: Date): Day[] {
  const start = addDays(now, -(DAYS - 1));
  const index = new Map<string, number>();
  const days: Day[] = [];
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(start, i);
    index.set(dayKey(date), i);
    days.push({ date, total: 0, correct: 0, accuracy: null });
  }
  for (const a of attempts) {
    const i = index.get(dayKeyOf(a.timestamp));
    if (i === undefined) continue;
    days[i].total++;
    if (a.isCorrect) days[i].correct++;
  }
  for (const d of days) d.accuracy = d.total > 0 ? d.correct / d.total : null;
  return days;
}

function pooled(days: Day[]): number {
  const t = days.reduce((n, d) => n + d.total, 0);
  return t ? days.reduce((n, d) => n + d.correct, 0) / t : 0;
}

function captionFor(days: Day[]): string {
  const active = days.filter((d) => d.total > 0);
  if (active.length === 0) return 'No answers in the last 30 days. Your full history is in the study calendar.';
  if (active.length === 1) {
    const d = active[0];
    return `One study day so far (${shortDate(d.date)}): ${pct(d.accuracy)} on ${plural(d.total, 'answer')}. A few more days will draw a trend.`;
  }
  const mid = Math.floor(active.length / 2);
  const early = pooled(active.slice(0, mid));
  const late = pooled(active.slice(mid));
  const diff = late - early;
  if (Math.abs(diff) < 0.05) return `Holding steady around ${pct(pooled(active))} across ${active.length} study days.`;
  if (diff > 0) return `Accuracy is climbing: ${pct(early)} on your earlier study days, ${pct(late)} on the more recent ones.`;
  return `Accuracy slipped from ${pct(early)} to ${pct(late)} on recent days. A Review Wrong pass can pull it back.`;
}

const M = { left: 44, right: 14, top: 14 };
const ACC_H = 150;
const GAP = 22;
const CNT_H = 56;
const AXIS_H = 28;
const HEIGHT = M.top + ACC_H + GAP + CNT_H + AXIS_H;

export function AccuracyTrendChart({ attempts, now }: { attempts: AttemptRecord[]; now: Date }) {
  const days = useMemo(() => buildDays(attempts, now), [attempts, now]);
  const caption = useMemo(() => captionFor(days), [days]);
  const { ref, width } = useChartWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const W = Math.max(width, 240);
  const plotW = W - M.left - M.right;
  const band = plotW / DAYS;
  const cx = (i: number) => M.left + band * (i + 0.5);
  const yAcc = (v: number) => M.top + (1 - v) * ACC_H;
  const cntTop = M.top + ACC_H + GAP;
  const cntBase = cntTop + CNT_H;
  const maxCount = Math.max(1, ...days.map((d) => d.total));
  const barW = Math.max(2, Math.min(24, band - 2));

  // Consecutive days with data join into one segment; an empty day breaks the line.
  const segments: number[][] = [];
  let run: number[] = [];
  days.forEach((d, i) => {
    if (d.accuracy === null) {
      if (run.length) segments.push(run);
      run = [];
    } else run.push(i);
  });
  if (run.length) segments.push(run);
  const activeCount = days.filter((d) => d.total > 0).length;
  const lastActive = days.reduce((last, d, i) => (d.total > 0 ? i : last), -1);

  const labelIdx = [0, 7, 14, 21, DAYS - 1];

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((e.clientX - rect.left) * W) / rect.width;
    setHover(Math.max(0, Math.min(DAYS - 1, Math.floor((x - M.left) / band))));
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    setHover((h) => Math.max(0, Math.min(DAYS - 1, (h ?? (lastActive >= 0 ? lastActive : DAYS - 1)) + (h === null ? 0 : step))));
  };

  const hovered = hover === null ? null : days[hover];

  return (
    <ChartCard
      title="Accuracy over time"
      caption={caption}
      legend={
        <Legend
          items={[
            { label: 'Daily accuracy', swatch: 'bg-primary-600 dark:bg-indigo-400', shape: 'line' },
            { label: 'Questions answered', swatch: 'bg-slate-300 dark:bg-slate-500' },
          ]}
        />
      }
      table={{
        caption: 'Daily accuracy and answers, last 30 days',
        columns: ['Day', 'Accuracy', 'Answered'],
        rows: days.filter((d) => d.total > 0).map((d) => [longDate(d.date), pct(d.accuracy), d.total]),
      }}
    >
      <div ref={ref} className="relative w-full">
        <svg
          viewBox={`0 0 ${W} ${HEIGHT}`}
          width="100%"
          role="img"
          tabIndex={0}
          aria-label={`Daily accuracy for the last 30 days. ${caption} Use left and right arrow keys to read each day.`}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="block touch-pan-y overflow-visible rounded-lg"
        >
          {/* accuracy panel grid */}
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={M.left} x2={W - M.right} y1={yAcc(v)} y2={yAcc(v)} strokeWidth={1} className={v === 0 ? CHROME.axis : CHROME.grid} />
              <text x={M.left - 8} y={yAcc(v)} dy="0.35em" textAnchor="end" fontSize={15} className={`${CHROME.tick} tabular-nums`}>
                {Math.round(v * 100)}%
              </text>
            </g>
          ))}

          {/* answered-count panel: its own scale, sharing only the x axis */}
          <line x1={M.left} x2={W - M.right} y1={cntTop} y2={cntTop} strokeWidth={1} className={CHROME.grid} />
          <text x={M.left - 8} y={cntTop} dy="0.35em" textAnchor="end" fontSize={15} className={`${CHROME.tick} tabular-nums`}>
            {maxCount}
          </text>
          <text x={M.left - 8} y={cntBase} dy="0.35em" textAnchor="end" fontSize={15} className={`${CHROME.tick} tabular-nums`}>
            0
          </text>
          {days.map((d, i) =>
            d.total > 0 ? (
              <path
                key={i}
                d={columnPath(cx(i) - barW / 2, cntBase - (d.total / maxCount) * CNT_H, barW, (d.total / maxCount) * CNT_H, Math.min(4, barW / 2))}
                className={hover === i ? 'fill-slate-400 dark:fill-slate-400' : 'fill-slate-300 dark:fill-slate-500'}
              />
            ) : null,
          )}
          <line x1={M.left} x2={W - M.right} y1={cntBase} y2={cntBase} strokeWidth={1} className={CHROME.axis} />

          {/* x axis */}
          {labelIdx.map((i, k) => (
            <text
              key={i}
              x={k === 0 ? M.left : k === labelIdx.length - 1 ? W - M.right : cx(i)}
              y={cntBase + 20}
              textAnchor={k === 0 ? 'start' : k === labelIdx.length - 1 ? 'end' : 'middle'}
              fontSize={15}
              className={CHROME.tick}
            >
              {i === DAYS - 1 ? 'Today' : shortDate(days[i].date)}
            </text>
          ))}

          {/* crosshair */}
          {hover !== null && (
            <line x1={cx(hover)} x2={cx(hover)} y1={M.top} y2={cntBase} strokeWidth={1} className="stroke-slate-400 dark:stroke-slate-500" />
          )}

          {/* accuracy line, broken on empty days */}
          <g className="text-primary-600 dark:text-indigo-400">
            {segments.map((seg) =>
              seg.length > 1 ? (
                <path
                  key={seg[0]}
                  d={seg.map((i, k) => `${k === 0 ? 'M' : 'L'}${cx(i)},${yAcc(days[i].accuracy ?? 0)}`).join('')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null,
            )}
            {days.map((d, i) => {
              if (d.accuracy === null) return null;
              const isolated = segments.some((s) => s.length === 1 && s[0] === i);
              const show = isolated || i === lastActive || i === hover || activeCount <= 10;
              if (!show) return null;
              return (
                <circle
                  key={i}
                  cx={cx(i)}
                  cy={yAcc(d.accuracy)}
                  r={i === hover ? 5.5 : 4}
                  fill="currentColor"
                  strokeWidth={2}
                  className="stroke-card-light dark:stroke-card-dark"
                />
              );
            })}
            {lastActive >= 0 && hover === null && days[lastActive].accuracy !== null && (
              <text
                x={cx(lastActive)}
                y={yAcc(days[lastActive].accuracy ?? 0)}
                dy={(days[lastActive].accuracy ?? 0) > 0.85 ? 22 : -10}
                textAnchor={cx(lastActive) > W - M.right - 30 ? 'end' : 'middle'}
                fontSize={15}
                fontWeight={600}
                className={`${CHROME.label} tabular-nums`}
              >
                {pct(days[lastActive].accuracy)}
              </text>
            )}
          </g>

          {/* hit layer: the whole plot, so the pointer finds the day rather than the 2px line */}
          <rect
            x={M.left}
            y={M.top}
            width={plotW}
            height={cntBase - M.top}
            fill="transparent"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hovered && hover !== null && (
          <ChartTooltip x={cx(hover)} y={hovered.accuracy === null ? cntTop : yAcc(hovered.accuracy)} containerWidth={W}>
            <div className="font-semibold tabular-nums">{hovered.total > 0 ? `${pct(hovered.accuracy)} correct` : 'No answers'}</div>
            <div className="text-slate-600 dark:text-slate-400">
              {longDate(hovered.date)}
              {hovered.total > 0 && ` · ${plural(hovered.total, 'answer')}`}
            </div>
          </ChartTooltip>
        )}
      </div>
    </ChartCard>
  );
}
