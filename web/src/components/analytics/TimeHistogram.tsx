import { useMemo, useState } from 'react';
import type { AttemptRecord } from '../../types';
import { ChartCard, ChartTooltip, Legend } from './ChartCard';
import { CHROME, pct, plural, useChartWidth } from './chartUtils';

interface Bucket {
  label: string;
  min: number;
  max: number;
  correct: number;
  wrong: number;
}

const EDGES: [number, number, string][] = [
  [0, 15, '0–15 s'],
  [15, 30, '15–30 s'],
  [30, 60, '30–60 s'],
  [60, 90, '60–90 s'],
  [90, 120, '90–120 s'],
  [120, Infinity, '120 s+'],
];

function buildBuckets(attempts: AttemptRecord[]): Bucket[] {
  const buckets = EDGES.map(([min, max, label]) => ({ label, min, max, correct: 0, wrong: 0 }));
  for (const a of attempts) {
    const t = Math.max(0, a.timeTakenSeconds);
    const b = buckets.find((k) => t >= k.min && t < k.max) ?? buckets[buckets.length - 1];
    if (a.isCorrect) b.correct++;
    else b.wrong++;
  }
  return buckets;
}

const total = (b: Bucket) => b.correct + b.wrong;
const accuracy = (b: Bucket) => (total(b) ? b.correct / total(b) : null);

function captionFor(buckets: Bucket[]): string {
  const common = buckets.reduce((m, b) => (total(b) > total(m) ? b : m), buckets[0]);
  if (total(common) === 0) return 'No timed answers yet.';
  const lead = `Most answers take ${common.label}.`;
  const qualified = buckets.filter((b) => total(b) >= 3);
  if (qualified.length < 2) return `${lead} You get ${pct(accuracy(common))} of those right.`;
  const best = qualified.reduce((m, b) => ((accuracy(b) ?? 0) > (accuracy(m) ?? 0) ? b : m));
  const worst = qualified.reduce((m, b) => ((accuracy(b) ?? 1) < (accuracy(m) ?? 1) ? b : m));
  if (best === worst || (accuracy(best) ?? 0) - (accuracy(worst) ?? 0) < 0.05) return `${lead} Accuracy barely changes with speed.`;
  return `${lead} You're most accurate at ${best.label} (${pct(accuracy(best))}) and least at ${worst.label} (${pct(accuracy(worst))}).`;
}

const LABEL_W = 84;
const VALUE_W = 48;
const ROW_H = 38;
const BAR_H = 22;
const SEG_GAP = 2;

export function TimeHistogram({ attempts }: { attempts: AttemptRecord[] }) {
  const buckets = useMemo(() => buildBuckets(attempts), [attempts]);
  const caption = useMemo(() => captionFor(buckets), [buckets]);
  const { ref, width } = useChartWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const W = Math.max(width, 240);
  const plotW = W - LABEL_W - VALUE_W;
  const max = Math.max(1, ...buckets.map(total));
  const H = ROW_H * buckets.length;
  const scale = (n: number) => (n / max) * plotW;

  return (
    <ChartCard
      title="Time per question"
      caption={caption}
      legend={
        <Legend
          items={[
            { label: 'Correct', swatch: 'bg-emerald-600' },
            { label: 'Wrong or timed out', swatch: 'bg-red-500' },
          ]}
        />
      }
      table={{
        caption: 'Answers by time taken',
        columns: ['Time taken', 'Correct', 'Wrong', 'Accuracy'],
        rows: buckets.map((b) => [b.label, b.correct, b.wrong, pct(accuracy(b))]),
      }}
    >
      <div ref={ref} className="relative w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`Answers by time taken, split into correct and wrong. ${caption}`}
          className="block"
          onPointerLeave={() => setHover(null)}
        >
          <line x1={LABEL_W} x2={LABEL_W} y1={0} y2={H} strokeWidth={1} className={CHROME.axis} />
          {buckets.map((b, i) => {
            const y = i * ROW_H + (ROW_H - BAR_H) / 2;
            const cw = scale(b.correct);
            const ww = scale(b.wrong);
            const gap = cw > 0 && ww > 0 ? SEG_GAP : 0;
            const n = total(b);
            const endX = LABEL_W + cw + gap + ww;
            return (
              <g key={b.label} opacity={hover === null || hover === i ? 1 : 0.55}>
                <text x={LABEL_W - 10} y={y + BAR_H / 2} dy="0.35em" textAnchor="end" fontSize={15} className={CHROME.tick}>
                  {b.label}
                </text>
                {cw > 0 && (
                  <path
                    d={roundedEnd(LABEL_W, y, cw, BAR_H, ww > 0 ? 0 : 4)}
                    className="fill-emerald-600"
                  />
                )}
                {ww > 0 && <path d={roundedEnd(LABEL_W + cw + gap, y, ww, BAR_H, 4)} className="fill-red-500" />}
                <text x={endX + 8} y={y + BAR_H / 2} dy="0.35em" fontSize={15} className={`${CHROME.label} tabular-nums`}>
                  {n}
                </text>
                {/* hit area: the whole row, bigger than the mark */}
                <rect
                  x={0}
                  y={i * ROW_H}
                  width={W}
                  height={ROW_H}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <ChartTooltip
            x={LABEL_W + Math.max(scale(total(buckets[hover])) / 2, 40)}
            y={hover * ROW_H + (ROW_H - BAR_H) / 2}
            containerWidth={W}
          >
            <div className="font-semibold tabular-nums">
              {total(buckets[hover]) ? `${pct(accuracy(buckets[hover]))} correct` : 'No answers'}
            </div>
            <div className="text-slate-600 dark:text-slate-400">
              {buckets[hover].label} · {plural(buckets[hover].correct, 'right', 'right')}, {plural(buckets[hover].wrong, 'wrong', 'wrong')}
            </div>
          </ChartTooltip>
        )}
      </div>
    </ChartCard>
  );
}

/** Horizontal bar segment: square at the left (baseline side), rounded right end when r > 0. */
function roundedEnd(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w, h / 2);
  if (rr <= 0) return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}
