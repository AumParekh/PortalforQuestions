// Curve Sculptor board: a curve on a hand-rolled SVG canvas with three native range sliders. One
// setting is out of place, so the curve breaks the notes' shape words; the player drags until
// the curve snaps onto the notes' shape. Snap: the sliders glide onto the notes' values, lock,
// and the curve pulses green with the starting curve overlaid. Miss (time or "Show me"): the
// player's curve holds for a beat, then the notes' curve fades in underneath and the culprit
// slider pulses with the notes' value marked on its track.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import { GameButton, GameCard, TimerBar } from '../../theme/primitives';
import type { Axis, ParamSpec } from './maths';
import { chartLayout, closeness, decimalsOf, fmt, onGrid, sample, shapeReport, snaps } from './maths';
import type { CurvePayload } from './build';
import { capitalise, derivedExplanation, lowerFirst, meaningOf, paramLabel } from './build';
import type { CurveItem } from './schema';
import './curve-sculptor.css';

const HOLD_MS = 800;
const FADE_MS = 520;
const SNAP_TWEEN_MS = 300;
const CHART_SAMPLES = 241;

type Status = 'play' | 'snapped' | 'missed';
type Params = Record<string, number>;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Width of an element, tracked with ResizeObserver (the SVG's viewBox follows it 1:1). */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const obs = useRef<ResizeObserver | null>(null);
  const setRef = useCallback((el: T | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    obs.current = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    obs.current.observe(el);
  }, []);
  useEffect(() => () => obs.current?.disconnect(), []);
  return [setRef, width];
}

export function axisTitle(a: Axis): string {
  const unit = a.unit.trim();
  if (!unit || a.label.toLowerCase().includes(unit.toLowerCase())) return a.label;
  return `${a.label} (${unit})`;
}

// ---------------------------------------------------------------------------------------------
// Chart

interface Frame {
  W: number;
  H: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  sx: (x: number) => number;
  sy: (y: number) => number;
}

/** Path through the sampled points; a non-finite value breaks the line. Clipped to the plot. */
function pathOf(xs: readonly number[], ys: readonly number[], f: Frame, span: number, yMin: number): string {
  let d = '';
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (!Number.isFinite(y)) {
      pen = false;
      continue;
    }
    // Keep far-off points drawable; the clip path hides what leaves the canvas.
    const yc = Math.max(yMin - 3 * span, Math.min(yMin + 4 * span, y));
    d += `${pen ? 'L' : 'M'}${f.sx(xs[i]).toFixed(1)},${f.sy(yc).toFixed(1)}`;
    pen = true;
  }
  return d;
}

interface ChartProps {
  item: CurveItem;
  params: Params;
  startParams: Params;
  status: Status;
  /** Discovery warmth 0..1 (gold glow under the curve); null hides it. */
  warmth: number | null;
  clipId: string;
}

function CurveChart({ item, params, startParams, status, warmth, clipId }: ChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { x, y } = item;
  const L = useMemo(() => chartLayout(x, y, width), [x, y, width]);
  const { W, H, left, right, top, bottom, xTicks, xLabels, yTicks, yLabels } = L;
  const xs = useMemo(() => Array.from({ length: CHART_SAMPLES }, (_, i) => x.min + ((x.max - x.min) * i) / (CHART_SAMPLES - 1)), [x.min, x.max]);
  const f: Frame = {
    W,
    H,
    left,
    right,
    top,
    bottom,
    sx: (v) => left + ((v - x.min) / (x.max - x.min)) * (W - left - right),
    sy: (v) => top + (1 - (v - y.min) / (y.max - y.min)) * (H - top - bottom),
  };
  const span = y.max - y.min;
  const fn = item.fn;
  const cur = xs.map((v) => fn(v, params));
  const startYs = useMemo(() => xs.map((v) => fn(v, startParams)), [xs, fn, startParams]);
  const targetYs = useMemo(() => xs.map((v) => fn(v, item.target)), [xs, fn, item.target]);
  const curPath = pathOf(xs, cur, f, span, y.min);
  const startPath = pathOf(xs, startYs, f, span, y.min);
  const targetPath = pathOf(xs, targetYs, f, span, y.min);
  const zeroInside = y.min < 0 && y.max > 0;

  return (
    <div ref={ref} className="cs-chart w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`${axisTitle(y)} against ${axisTitle(x)}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={top - 2} width={W - left - right} height={H - top - bottom + 4} />
          </clipPath>
        </defs>
        {/* Grid and axes: straight edges, sharp corners only on the axes. */}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line className="cs-gridline" x1={left} x2={W - right} y1={f.sy(t)} y2={f.sy(t)} />
            <text className="cs-tick-label" x={left - 8} y={f.sy(t)} textAnchor="end" dominantBaseline="middle">
              {yLabels[i]}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line className="cs-gridline" x1={f.sx(t)} x2={f.sx(t)} y1={top} y2={H - bottom} />
            <text className="cs-tick-label" x={f.sx(t)} y={H - bottom + 22} textAnchor="middle">
              {xLabels[i]}
            </text>
          </g>
        ))}
        {zeroInside && <line className="cs-zero" x1={left} x2={W - right} y1={f.sy(0)} y2={f.sy(0)} />}
        <line className="cs-axis" x1={left} x2={left} y1={top} y2={H - bottom} />
        <line className="cs-axis" x1={left} x2={W - right} y1={H - bottom} y2={H - bottom} />

        <g clipPath={`url(#${clipId})`}>
          {/* Where it started: a faint dotted ghost while playing, a clear overlay once resolved. */}
          <path className={`cs-start${status === 'play' ? '' : ' is-overlay'}`} d={startPath} />
          {status === 'missed' && <path className="cs-target" d={targetPath} style={{ '--cs-delay': `${HOLD_MS}ms` } as CSSProperties} />}
          {warmth !== null && status === 'play' && <path className="cs-glow" d={curPath} style={{ opacity: 0.08 + warmth * 0.32 }} />}
          <path className={`cs-curve${status === 'snapped' ? ' is-snapped' : status === 'missed' ? ' is-missed' : ''}`} d={curPath} />
        </g>
      </svg>
    </div>
  );
}

function Legend({ status }: { status: Status }) {
  const rows: { cls: string; label: string }[] = [
    {
      cls: status === 'snapped' ? 'cs-curve is-snapped' : status === 'missed' ? 'cs-curve is-missed' : 'cs-curve',
      label: status === 'snapped' ? 'Your curve, on the notes’ shape' : 'Your curve',
    },
    { cls: `cs-start${status === 'play' ? '' : ' is-overlay'}`, label: 'Where it started' },
  ];
  if (status === 'missed') rows.push({ cls: 'cs-target is-static', label: 'The notes’ shape' });
  return (
    <ul className="cs-legend flex flex-wrap gap-x-5 gap-y-1" aria-label="Legend">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <svg width="30" height="12" viewBox="0 0 30 12" aria-hidden="true">
            <path className={r.cls} d="M2,6 L28,6" />
          </svg>
          <span>{r.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// Sliders

function tickLeft(p: ParamSpec, v: number): string {
  const frac = Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)));
  return `calc(14px + (100% - 28px) * ${frac.toFixed(4)})`;
}

function SliderRow({
  p,
  value,
  start,
  target,
  locked,
  culprit,
  pulse,
  onChange,
}: {
  p: ParamSpec;
  value: number;
  start: number;
  /** The notes' value, marked on the track once the round resolves on this slider. */
  target: number | null;
  locked: boolean;
  culprit: boolean;
  pulse: boolean;
  onChange: (v: number) => void;
}) {
  const dec = decimalsOf(p.step);
  const id = `cs-${p.name}`;
  const shown = fmt(value, dec);
  const cls = ['cs-row', locked ? 'is-locked' : '', culprit ? 'is-culprit' : '', pulse ? 'is-pulse' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <label htmlFor={id} className="cs-param-label">
          {p.label}
        </label>
        <span className="cs-value" aria-hidden="true">
          {shown}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="g-btn cs-step"
          onClick={() => onChange(onGrid(p, value - p.step))}
          disabled={locked || value <= p.min}
          aria-label={`Lower ${p.label}`}
        >
          −
        </button>
        <div className="cs-track relative min-w-0 flex-1">
          <input
            id={id}
            type="range"
            className="cs-range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={value}
            disabled={locked}
            aria-valuetext={shown}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(onGrid(p, Number(e.currentTarget.value)))}
          />
          <span className="cs-tick" style={{ left: tickLeft(p, start) }} aria-hidden="true" title="Where it started" />
          {target !== null && <span className="cs-tick is-target" style={{ left: tickLeft(p, target) }} aria-hidden="true" />}
        </div>
        <button
          type="button"
          className="g-btn cs-step"
          onClick={() => onChange(onGrid(p, value + p.step))}
          disabled={locked || value >= p.max}
          aria-label={`Raise ${p.label}`}
        >
          +
        </button>
      </div>
      {target !== null && culprit && (
        <p className="cs-note">
          The notes’ curve has it at <span className="cs-value">{fmt(target, dec)}</span>; it started at{' '}
          <span className="cs-value">{fmt(start, dec)}</span>.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One round

function ShapeChips({ words, report, live }: { words: readonly string[]; report: Record<string, boolean>; live: boolean }) {
  return (
    <div className="flex flex-wrap gap-2" aria-live={live ? 'polite' : undefined}>
      {words.map((w) => {
        const on = live && report[w];
        return (
          <span key={w} className={`cs-chip${live ? (on ? ' is-on' : ' is-off') : ''}`}>
            {live && (
              <span className="cs-chip-mark" aria-hidden="true">
                {on ? '✓' : '·'}
              </span>
            )}
            {w}
            {live && <span className="sr-only">{on ? ': the curve shows this now' : ': not yet'}</span>}
          </span>
        );
      })}
    </div>
  );
}

function Round({
  round,
  phase,
  onAnswered,
  onNext,
  last,
}: {
  round: MechanicRound<CurvePayload>;
  phase: PlayPhase;
  onAnswered: (r: RoundResult) => void;
  onNext: () => void;
  last: boolean;
}) {
  const p = round.payload;
  const { item, variant } = p;
  const [params, setParams] = useState<Params>(() => ({ ...p.startParams }));
  const [status, setStatus] = useState<Status>('play');
  const [timedOut, setTimedOut] = useState(false);
  const [hint, setHint] = useState(false);
  const [settled, setSettled] = useState(false);
  const started = useRef(performance.now());
  const raf = useRef<number | null>(null);
  /** Set synchronously on snap / miss, so a second input event in the same frame can't answer twice. */
  const answeredRef = useRef(false);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const timed = phase === 'pressure';
  const discovery = phase === 'discovery';

  const targetYs = useMemo(() => sample(item, item.target), [item]);
  const startYs = useMemo(() => sample(item, p.startParams), [item, p.startParams]);
  const ys = useMemo(() => sample(item, params), [item, params]);
  const report = useMemo(() => shapeReport(item, ys), [item, ys]);
  const warmth = discovery ? closeness(ys, startYs, targetYs) : null;

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  const setParam = (name: string, v: number) => {
    if (answeredRef.current) return;
    const next = { ...params, [name]: v };
    setParams(next);
    if (snaps(item, next, p.radius, targetYs)) {
      answeredRef.current = true;
      setStatus('snapped');
      onAnswered({ roundId: round.id, correct: true, timeMs: performance.now() - started.current, grade: hint ? 3 : undefined });
      // Glide from the snapped position on the next frame so the drag's own value lands first.
      raf.current = requestAnimationFrame(() => glideToTarget(next));
    }
  };

  /** Glide every slider onto the notes' values (the snap), then lock. */
  const glideToTarget = (from: Params) => {
    if (prefersReducedMotion()) {
      setParams({ ...item.target });
      setSettled(true);
      return;
    }
    const to = item.target;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / SNAP_TWEEN_MS);
      const e = 1 - Math.pow(1 - k, 3);
      const next: Params = {};
      for (const q of item.params) next[q.name] = from[q.name] + (to[q.name] - from[q.name]) * e;
      setParams(k >= 1 ? { ...to } : next);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else {
        raf.current = null;
        setSettled(true);
      }
    };
    raf.current = requestAnimationFrame(step);
  };

  const miss = (byTimer: boolean) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    setStatus('missed');
    setTimedOut(byTimer);
    onAnswered({ roundId: round.id, correct: false, timeMs: performance.now() - started.current, timedOut: byTimer });
  };

  // Pressure clock.
  useEffect(() => {
    if (!timed || status !== 'play' || !round.timeLimitMs) return;
    const left = Math.max(0, round.timeLimitMs - (performance.now() - started.current));
    const t = window.setTimeout(() => miss(true), left);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, status]);

  // A miss holds the player's curve for a beat, then the notes' curve fades in; only then may they move on.
  useEffect(() => {
    if (status !== 'missed') return;
    const t = window.setTimeout(() => setSettled(true), prefersReducedMotion() ? HOLD_MS : HOLD_MS + FADE_MS);
    return () => window.clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (settled) nextRef.current?.focus();
  }, [settled]);

  const resolved = status !== 'play';
  const brokenLines = (p.broken.length ? p.broken : item.shapeWords).map((w) => ({ w, m: meaningOf(w) }));
  const culprit = variant.param;
  const culpritLabel = paramLabel(item, culprit);
  const source = `block ${round.blockId}`;

  return (
    <GameCard className="g-enter relative space-y-5 !px-4 sm:!px-6">
      {timed && !resolved && round.timeLimitMs && <TimerBar ms={round.timeLimitMs} />}

      <div className="space-y-3">
        <p className="cs-desc">{item.description}</p>
        <ShapeChips words={item.shapeWords} report={report} live={discovery || resolved} />
      </div>

      <figure className="space-y-2">
        <figcaption className="cs-chart-title">
          {capitalise(axisTitle(item.y))} against {lowerFirst(axisTitle(item.x))}
        </figcaption>
        <div className="cs-axis-title">↑ {axisTitle(item.y)}</div>
        <CurveChart item={item} params={params} startParams={p.startParams} status={status} warmth={warmth} clipId={`cs-clip-${round.id.replace(/[^A-Za-z0-9_-]/g, '_')}`} />
        <div className="cs-axis-title text-right">{axisTitle(item.x)} →</div>
        <Legend status={status} />
      </figure>

      <div className="space-y-3" role="group" aria-label="Curve settings">
        {item.params.map((q) => (
          <SliderRow
            key={q.name}
            p={q}
            value={params[q.name]}
            start={p.startParams[q.name]}
            target={status === 'missed' && q.name === culprit ? item.target[q.name] : null}
            locked={resolved}
            culprit={status === 'missed' && q.name === culprit}
            pulse={(hint && status === 'play' && q.name === culprit) || (status === 'missed' && settled && q.name === culprit)}
            onChange={(v) => setParam(q.name, v)}
          />
        ))}
      </div>

      {!resolved && (
        <div className="flex flex-wrap gap-3">
          {discovery && (
            <GameButton onClick={() => setHint(true)} disabled={hint}>
              Which setting?
            </GameButton>
          )}
          <GameButton variant="quiet" onClick={() => !answeredRef.current && setParams({ ...p.startParams })}>
            Start over
          </GameButton>
          <GameButton variant="quiet" onClick={() => miss(false)}>
            Show me
          </GameButton>
        </div>
      )}
      {!resolved && hint && (
        <p className="cs-note">The setting that is out of place is pulsing. Drag it until the curve fits the words.</p>
      )}

      {status === 'snapped' && (
        <div className="g-assemble space-y-3 border-l-[3px] pl-4" style={{ borderColor: 'var(--g-green)' }}>
          <p className="cs-text">
            <span className="g-strong">Snapped.</span> The {lowerFirst(culpritLabel)} was the setting out of place.
          </p>
          <ul className="cs-text space-y-1">
            {brokenLines.map(({ w, m }) => (
              <li key={w}>
                <span className="g-strong">{capitalise(w)}</span>: {m}.
              </li>
            ))}
          </ul>
          <p className="cs-reading">{variant.curated ? item.explanation : derivedExplanation(p)}</p>
          <p className="cs-source">{source}</p>
        </div>
      )}

      {status === 'missed' && (
        <div className="space-y-3">
          <p className="cs-note">{timedOut ? 'Time ran out.' : 'Here is the notes’ curve.'}</p>
          <div className="cs-hold-right space-y-3" style={{ '--cs-delay': `${HOLD_MS}ms` } as CSSProperties} aria-live="polite">
            <p className="cs-text">
              <span className="g-strong">The {lowerFirst(culpritLabel)}</span> was the setting out of place.
            </p>
            <ul className="cs-text space-y-1">
              {brokenLines.map(({ w, m }) => (
                <li key={w}>
                  <span className="g-strong">{capitalise(w)}</span>: {m}.
                </li>
              ))}
            </ul>
            <p className="cs-reading">{variant.curated ? item.explanation : derivedExplanation(p)}</p>
            <p className="cs-source">{source}</p>
          </div>
        </div>
      )}

      {resolved && (
        <div className="flex justify-end">
          <button ref={nextRef} type="button" className="g-btn is-primary" onClick={onNext} disabled={!settled}>
            {last ? 'Continue' : 'Next curve'}
          </button>
        </div>
      )}
    </GameCard>
  );
}

/** One short rule per curve this phase: pending, current, snapped, missed. No numbers. */
function Docket({ total, index, results }: { total: number; index: number; results: boolean[] }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => {
        const bg = i < results.length ? (results[i] ? 'var(--g-green)' : 'var(--g-red)') : i === index ? 'var(--g-gold)' : 'var(--g-rule)';
        return <span key={i} className="h-1 flex-1" style={{ background: bg }} />;
      })}
    </div>
  );
}

export function CurveBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<CurvePayload>) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const done = useRef(false);

  useEffect(() => {
    if (rounds.length === 0 && !done.current) {
      done.current = true;
      onPhaseDone();
    }
  }, [rounds.length, onPhaseDone]);

  const round = rounds[index];
  if (!round) return null;

  const answered = (r: RoundResult) => {
    onResult(r);
    setResults((xs) => [...xs, r.correct]);
  };
  const next = () => {
    if (index + 1 < rounds.length) setIndex(index + 1);
    else if (!done.current) {
      done.current = true;
      onPhaseDone();
    }
  };

  return (
    <div className="space-y-5">
      <div className="cs-phase-label">{phase === 'discovery' ? 'At the drawing board' : 'Under pressure'}</div>
      <Docket total={rounds.length} index={index} results={results} />
      <Round key={round.id} round={round} phase={phase} onAnswered={answered} onNext={next} last={index + 1 === rounds.length} />
    </div>
  );
}
