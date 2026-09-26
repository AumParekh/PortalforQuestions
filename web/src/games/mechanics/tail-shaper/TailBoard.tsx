// Tail Shaper board: a split Student-t density on a hand-rolled SVG canvas, a magnified view of its
// tails against the lognormal benchmark, and four native range sliders (left tail, right tail,
// mean shift, variance). The player bends the density until it matches the notes' description.
// Snap: the sliders that matter glide onto the notes' values and every slider locks, the curve
// pulses green, and the implied-volatility curve that distribution produces draws itself in.
// Miss (time or "Show me"): the player's curve holds for a beat, then the notes' density fades in
// underneath, the sliders that matter pulse with the accepted band marked on their tracks, and the
// volatility curve is drawn anyway.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import { GameButton, GameCard, TimerBar } from '../../theme/primitives';
import type { ParamName, ParamSpec, Params, SmilePoint, Thresholds } from './maths';
import {
  PARAM_NAMES,
  boxOf,
  decimalsOf,
  densityCurve,
  easeOut,
  fmt,
  lerpParams,
  linspace,
  matches,
  normalPdf,
  onGrid,
  tailRatios,
  tailWord,
  ticks,
  volAxis,
  withinOne,
} from './maths';
import type { TailPayload } from './build';
import { LABEL_READING, LABEL_TERM, pretty, smileCaption } from './build';
import './tail-shaper.css';

const HOLD_MS = 800;
const FADE_MS = 520;
const SNAP_TWEEN_MS = 340;
const RESET_TWEEN_MS = 260;
const SAMPLES = 321;
/** The return axis (% log return over the option's life) and the density axis, fixed across rounds so the variance slider is visible. */
const X_MIN = -10;
const X_MAX = 10;
const Y_MAX = 0.85;
/** The tail view: the same x axis, the density axis magnified about 14 times. */
const LENS_Y_MAX = 0.06;
const MONEYNESS: [number, number] = [0.75, 1.25];

type Status = 'play' | 'snapped' | 'missed';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Width of an element, tracked with ResizeObserver (each SVG's viewBox follows it 1:1, so 15px text stays 15px). */
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

// ---------------------------------------------------------------------------------------------
// Chart plumbing

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

function frameOf(width: number, height: number, x: [number, number], y: [number, number], left = 52): Frame {
  const W = Math.max(280, width || 320);
  const H = height;
  const right = 14;
  const top = 12;
  const bottom = 34;
  return {
    W,
    H,
    left,
    right,
    top,
    bottom,
    sx: (v) => left + ((v - x[0]) / (x[1] - x[0])) * (W - left - right),
    sy: (v) => top + (1 - (v - y[0]) / (y[1] - y[0])) * (H - top - bottom),
  };
}

function linePath(xs: readonly number[], ys: readonly number[], f: Frame, yCap: number): string {
  let d = '';
  for (let i = 0; i < xs.length; i++) {
    // Far-off values stay drawable; the clip path hides what leaves the canvas.
    const y = Math.min(ys[i], yCap);
    d += `${i ? 'L' : 'M'}${f.sx(xs[i]).toFixed(1)},${f.sy(y).toFixed(1)}`;
  }
  return d;
}

function areaPath(xs: readonly number[], ys: readonly number[], f: Frame, yCap: number): string {
  const line = linePath(xs, ys, f, yCap);
  return `${line}L${f.sx(xs[xs.length - 1]).toFixed(1)},${f.sy(0).toFixed(1)}L${f.sx(xs[0]).toFixed(1)},${f.sy(0).toFixed(1)}Z`;
}

/** Filled regions where `a` is above `b` (extra mass against the benchmark). */
function excessPath(xs: readonly number[], a: readonly number[], b: readonly number[], f: Frame, yCap: number): string {
  let d = '';
  let i = 0;
  while (i < xs.length) {
    if (!(a[i] > b[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < xs.length && a[j + 1] > b[j + 1]) j++;
    const top: string[] = [];
    const bot: string[] = [];
    for (let k = i; k <= j; k++) {
      top.push(`${f.sx(xs[k]).toFixed(1)},${f.sy(Math.min(a[k], yCap)).toFixed(1)}`);
      bot.push(`${f.sx(xs[k]).toFixed(1)},${f.sy(Math.min(b[k], yCap)).toFixed(1)}`);
    }
    d += `M${top.join('L')}L${bot.reverse().join('L')}Z`;
    i = j + 1;
  }
  return d;
}

function Axes({ f, xTicks, yTicks, xLabel, yLabel }: { f: Frame; xTicks: number[]; yTicks: number[]; xLabel: (v: number) => string; yLabel: (v: number) => string }) {
  return (
    <g>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line className="ts-gridline" x1={f.left} x2={f.W - f.right} y1={f.sy(t)} y2={f.sy(t)} />
          <text className="ts-tick-label" x={f.left - 8} y={f.sy(t)} textAnchor="end" dominantBaseline="middle">
            {yLabel(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line className="ts-gridline" x1={f.sx(t)} x2={f.sx(t)} y1={f.top} y2={f.H - f.bottom} />
          <text className="ts-tick-label" x={f.sx(t)} y={f.H - f.bottom + 22} textAnchor="middle">
            {xLabel(t)}
          </text>
        </g>
      ))}
      <line className="ts-axis" x1={f.left} x2={f.left} y1={f.top} y2={f.H - f.bottom} />
      <line className="ts-axis" x1={f.left} x2={f.W - f.right} y1={f.H - f.bottom} y2={f.H - f.bottom} />
    </g>
  );
}

function LegendRow({ rows }: { rows: { cls: string; label: string; fill?: boolean }[] }) {
  return (
    <ul className="ts-legend flex flex-wrap gap-x-5 gap-y-1" aria-label="Legend">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <svg width="30" height="14" viewBox="0 0 30 14" aria-hidden="true">
            {r.fill ? <rect className={r.cls} x="2" y="2" width="26" height="10" rx="2" /> : <path className={r.cls} d="M2,7 L28,7" />}
          </svg>
          <span>{r.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// The density and its tails

interface DensityProps {
  params: Params;
  startParams: Params;
  /** The notes' density (only drawn after a miss). */
  targetParams: Params;
  status: Status;
  clipId: string;
}

function curveClass(status: Status): string {
  return `ts-curve${status === 'snapped' ? ' is-snapped' : status === 'missed' ? ' is-missed' : ''}`;
}

function DensityChart({ params, startParams, targetParams, status, clipId }: DensityProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = Math.round(Math.min(300, Math.max(210, (width || 320) * 0.56)));
  const f = frameOf(width, H, [X_MIN, X_MAX], [0, Y_MAX]);
  const xs = useMemo(() => linspace(X_MIN, X_MAX, SAMPLES), []);
  const cur = densityCurve(xs, params);
  const bench = xs.map((x) => normalPdf(x, params.mu, params.s));
  const startYs = useMemo(() => densityCurve(xs, startParams), [xs, startParams]);
  const targetYs = useMemo(() => densityCurve(xs, targetParams), [xs, targetParams]);
  const cap = Y_MAX * 1.2;
  return (
    <div ref={ref} className="ts-chart w-full">
      <svg viewBox={`0 0 ${f.W} ${f.H}`} width="100%" height={f.H} role="img" aria-label="Density of returns against return in percent, with the lognormal benchmark" preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id={clipId}>
            <rect x={f.left} y={f.top - 2} width={f.W - f.left - f.right} height={f.H - f.top - f.bottom + 2} />
          </clipPath>
        </defs>
        <Axes f={f} xTicks={ticks(X_MIN, X_MAX, 5)} yTicks={ticks(0, Y_MAX, 0.2)} xLabel={(v) => fmt(v, 0)} yLabel={(v) => fmt(v, 1)} />
        <g clipPath={`url(#${clipId})`}>
          <path className={`ts-area${status === 'snapped' ? ' is-snapped' : ''}`} d={areaPath(xs, cur, f, cap)} />
          <path className={`ts-start${status === 'play' ? '' : ' is-overlay'}`} d={linePath(xs, startYs, f, cap)} />
          <path className="ts-bench" d={linePath(xs, bench, f, cap)} />
          {status === 'missed' && <path className="ts-target" d={linePath(xs, targetYs, f, cap)} style={{ '--ts-delay': `${HOLD_MS}ms` } as CSSProperties} />}
          <path className={curveClass(status)} d={linePath(xs, cur, f, cap)} />
          <line className="ts-mu" x1={f.sx(params.mu)} x2={f.sx(params.mu)} y1={f.sy(0)} y2={f.sy(Math.min(Y_MAX, densityCurve([params.mu], params)[0]))} />
        </g>
      </svg>
    </div>
  );
}

function TailLens({ params, targetParams, status, clipId }: Omit<DensityProps, 'startParams'>) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = Math.round(Math.min(210, Math.max(150, (width || 320) * 0.4)));
  const f = frameOf(width, H, [X_MIN, X_MAX], [0, LENS_Y_MAX]);
  const xs = useMemo(() => linspace(X_MIN, X_MAX, SAMPLES), []);
  const cur = densityCurve(xs, params);
  const bench = xs.map((x) => normalPdf(x, params.mu, params.s));
  const targetYs = useMemo(() => densityCurve(xs, targetParams), [xs, targetParams]);
  const cap = LENS_Y_MAX * 1.5;
  return (
    <div ref={ref} className="ts-chart w-full">
      <svg viewBox={`0 0 ${f.W} ${f.H}`} width="100%" height={f.H} role="img" aria-label="The tails magnified: your density against the lognormal benchmark" preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id={clipId}>
            <rect x={f.left} y={f.top} width={f.W - f.left - f.right} height={f.H - f.top - f.bottom} />
          </clipPath>
        </defs>
        <Axes f={f} xTicks={ticks(X_MIN, X_MAX, 5)} yTicks={ticks(0, LENS_Y_MAX, 0.02)} xLabel={(v) => fmt(v, 0)} yLabel={(v) => fmt(v, 2)} />
        <g clipPath={`url(#${clipId})`}>
          <path className="ts-extra" d={excessPath(xs, cur, bench, f, cap)} />
          <path className="ts-bench" d={linePath(xs, bench, f, cap)} />
          {status === 'missed' && <path className="ts-target" d={linePath(xs, targetYs, f, cap)} style={{ '--ts-delay': `${HOLD_MS}ms` } as CSSProperties} />}
          <path className={curveClass(status)} d={linePath(xs, cur, f, cap)} />
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The implied-volatility overlay

function SmileChart({ points, before, clipId }: { points: readonly SmilePoint[]; before: readonly SmilePoint[] | null; clipId: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = Math.round(Math.min(260, Math.max(190, (width || 320) * 0.5)));
  const vols = [...points.map((q) => q[1]), ...(before ?? []).map((q) => q[1])];
  const [lo, hi] = volAxis(vols);
  const xr: [number, number] = [Math.min(MONEYNESS[0], points[0][0]), Math.max(MONEYNESS[1], points[points.length - 1][0])];
  const f = frameOf(width, H, xr, [lo, hi], 44);
  const path = (pts: readonly SmilePoint[]) => pts.map((q, i) => `${i ? 'L' : 'M'}${f.sx(q[0]).toFixed(1)},${f.sy(q[1]).toFixed(1)}`).join('');
  const atm = points.find((q) => Math.abs(q[0] - 1) < 1e-9);
  return (
    <div ref={ref} className="ts-chart w-full">
      <svg viewBox={`0 0 ${f.W} ${f.H}`} width="100%" height={f.H} role="img" aria-label="Implied volatility against strike over spot" preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id={clipId}>
            <rect x={f.left} y={f.top - 4} width={f.W - f.left - f.right} height={f.H - f.top - f.bottom + 8} />
          </clipPath>
        </defs>
        <Axes f={f} xTicks={ticks(xr[0], xr[1], 0.1)} yTicks={ticks(lo, hi, 4)} xLabel={(v) => fmt(v, 1)} yLabel={(v) => fmt(v, 0)} />
        <line className="ts-atm" x1={f.sx(1)} x2={f.sx(1)} y1={f.top} y2={f.H - f.bottom} />
        <g clipPath={`url(#${clipId})`}>
          {atm && <line className="ts-level" x1={f.left} x2={f.W - f.right} y1={f.sy(atm[1])} y2={f.sy(atm[1])} />}
          {before && <path className="ts-before" d={path(before)} pathLength={1} />}
          <path className="ts-smile" d={path(points)} pathLength={1} />
          {points.map((q) => (
            <circle key={q[0]} className="ts-smile-dot" cx={f.sx(q[0])} cy={f.sy(q[1])} r={3.5} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function SmilePanel({ p, id }: { p: TailPayload; id: string }) {
  const sm = p.item.smile;
  const rows: { cls: string; label: string }[] = [{ cls: 'ts-smile is-static', label: sm.before ? 'After the move' : 'Implied volatility' }];
  if (sm.before) rows.push({ cls: 'ts-before is-static', label: 'Before the move' });
  rows.push({ cls: 'ts-level', label: 'At-the-money level' });
  return (
    <figure className="ts-overlay g-assemble space-y-2" aria-live="polite">
      <div className="ts-overlay-kicker">{sm.label === 'flat' ? 'Flat' : sm.label === 'volatility skew' ? 'Volatility skew' : 'Volatility smile'}</div>
      <figcaption className="ts-chart-title">What the option market quotes for this density</figcaption>
      <div className="ts-axis-title">↑ Implied volatility (%)</div>
      <SmileChart points={sm.points} before={sm.before} clipId={`${id}-smile`} />
      <div className="ts-axis-title text-right">Strike over spot, K/S₀ →</div>
      <LegendRow rows={rows} />
      <p className="ts-text">{LABEL_READING[sm.label]}</p>
      <p className="ts-note">Low strikes (left) pay off in the left tail; high strikes (right) in the right tail.</p>
      <p className="ts-caption">{smileCaption(sm.note)}</p>
    </figure>
  );
}

// ---------------------------------------------------------------------------------------------
// Sliders

function frac(p: ParamSpec, v: number): number {
  return Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)));
}

/** Track positions account for the 28px thumb: its centre runs from 14px to width - 14px. */
function trackLeft(p: ParamSpec, v: number): string {
  return `calc(14px + (100% - 28px) * ${frac(p, v).toFixed(4)})`;
}

function SliderRow({
  p,
  value,
  start,
  band,
  locked,
  pulse,
  bounce,
  onChange,
}: {
  p: ParamSpec;
  value: number;
  start: number;
  /** The accepted interval, marked on the track after a miss or on a hint. */
  band: [number, number] | null;
  locked: boolean;
  pulse: boolean;
  /** Snapped onto the notes' value: a small settle bounce as it locks. */
  bounce: boolean;
  onChange: (v: number) => void;
}) {
  const dec = decimalsOf(p.step);
  const id = `ts-${p.name}`;
  const shown = fmt(value, dec);
  const label = pretty(p.label);
  const cls = ['ts-row', locked ? 'is-locked' : '', pulse ? 'is-pulse' : '', bounce ? 'is-bounce' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <label htmlFor={id} className="ts-param-label">
          {label}
        </label>
        <span className="ts-value" aria-hidden="true">
          {shown}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="g-btn ts-step" onClick={() => onChange(onGrid(p, value - p.step))} disabled={locked || value <= p.min} aria-label={`Lower ${label}`}>
          −
        </button>
        <div className="ts-track relative min-w-0 flex-1">
          {band && (
            <span
              className="ts-band"
              style={{ left: trackLeft(p, band[0]), width: `calc((100% - 28px) * ${(frac(p, band[1]) - frac(p, band[0])).toFixed(4)})` }}
              aria-hidden="true"
            />
          )}
          <input
            id={id}
            type="range"
            className="ts-range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={value}
            disabled={locked}
            aria-valuetext={`${shown}${p.lowLabel && value <= p.min + (p.max - p.min) * 0.1 ? `, ${pretty(p.lowLabel)}` : ''}${p.highLabel && value >= p.max - (p.max - p.min) * 0.1 ? `, ${pretty(p.highLabel)}` : ''}`}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(onGrid(p, Number(e.currentTarget.value)))}
          />
          <span className="ts-tick" style={{ left: trackLeft(p, start) }} aria-hidden="true" />
        </div>
        <button type="button" className="g-btn ts-step" onClick={() => onChange(onGrid(p, value + p.step))} disabled={locked || value >= p.max} aria-label={`Raise ${label}`}>
          +
        </button>
      </div>
      {(p.lowLabel || p.highLabel) && (
        <div className="ts-ends flex flex-wrap justify-between gap-x-4">
          <span>← {pretty(p.lowLabel)}</span>
          <span className="text-right">{pretty(p.highLabel)} →</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One round

function TailChips({ nuL, nuR, th }: { nuL: number; nuR: number; th: Thresholds }) {
  const [rl, rr] = tailRatios(nuL, nuR, th.tailZ);
  const chip = (side: string, r: number) => {
    const w = tailWord(r, th);
    const tone = w === 'near lognormal' ? 'is-thin' : w === 'slightly fat' ? 'is-mid' : 'is-fat';
    return (
      <span className={`ts-chip ${tone}`}>
        {side} tail: {w}
      </span>
    );
  };
  return (
    <div className="flex flex-wrap gap-2" aria-live="polite">
      {chip('Left', rl)}
      {chip('Right', rr)}
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
  round: MechanicRound<TailPayload>;
  phase: PlayPhase;
  onAnswered: (r: RoundResult) => void;
  onNext: () => void;
  last: boolean;
}) {
  const p = round.payload;
  const { item, specs, thresholds } = p;
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
  const idBase = `ts-${round.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

  /** The notes' density with the player's own values on the sliders the description leaves free. */
  const targetShown = useMemo<Params>(() => {
    const out = { ...params };
    for (const n of item.matters) out[n] = item.target[n];
    return out;
    // Only recomputed when the round resolves, so it doesn't chase the player's sliders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, item]);

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const tween = (from: Params, to: Params, ms: number, done?: () => void) => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (prefersReducedMotion()) {
      setParams({ ...to });
      done?.();
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      setParams(k >= 1 ? { ...to } : lerpParams(from, to, easeOut(k)));
      if (k < 1) raf.current = requestAnimationFrame(step);
      else {
        raf.current = null;
        done?.();
      }
    };
    raf.current = requestAnimationFrame(step);
  };

  const setParam = (name: ParamName, v: number) => {
    if (answeredRef.current) return;
    const next = { ...params, [name]: v };
    if (raf.current !== null) {
      // Interrupting a "start over" glide: the other sliders sit mid-tween, so put them back on the grid.
      cancelAnimationFrame(raf.current);
      raf.current = null;
      for (const n of PARAM_NAMES) if (n !== name) next[n] = onGrid(specs[n], next[n]);
    }
    setParams(next);
    if (matches(next, item.target, item.tolerance)) {
      answeredRef.current = true;
      setStatus('snapped');
      onAnswered({ roundId: round.id, correct: true, timeMs: performance.now() - started.current, grade: hint ? 3 : undefined });
      // The snap: the sliders the words pin down glide onto the notes' values, then everything locks.
      const to = { ...next };
      for (const n of item.matters) to[n] = item.target[n];
      raf.current = requestAnimationFrame(() => tween(next, to, SNAP_TWEEN_MS, () => setSettled(true)));
    }
  };

  const miss = (byTimer: boolean) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    setStatus('missed');
    setTimedOut(byTimer);
    onAnswered({ roundId: round.id, correct: false, timeMs: performance.now() - started.current, timedOut: byTimer });
  };

  const startOver = () => {
    if (answeredRef.current) return;
    tween(params, p.startParams, RESET_TWEEN_MS);
  };

  // Pressure clock.
  useEffect(() => {
    if (!timed || status !== 'play' || !round.timeLimitMs) return;
    const left = Math.max(0, round.timeLimitMs - (performance.now() - started.current));
    const t = window.setTimeout(() => miss(true), left);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, status]);

  // A miss holds the player's curve for a beat, then the notes' density fades in; only then may they move on.
  useEffect(() => {
    if (status !== 'missed') return;
    const t = window.setTimeout(() => setSettled(true), prefersReducedMotion() ? HOLD_MS : HOLD_MS + FADE_MS);
    return () => window.clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (settled) nextRef.current?.focus();
  }, [settled]);

  const resolved = status !== 'play';
  const outOfBox = item.matters.filter((n) => !withinOne(params[n], item.target[n], item.tolerance[n]));
  const [rl, rr] = tailRatios(params.nuL, params.nuR, thresholds.tailZ);
  const densityCaption =
    discovery || resolved
      ? `Left tail ${tailWord(rl, thresholds)}, right tail ${tailWord(rr, thresholds)}, against the dashed lognormal benchmark.`
      : 'Your density against the dashed lognormal benchmark.';
  const densityLegend = [
    { cls: curveClass(status), label: status === 'snapped' ? 'Your density, matching the notes' : 'Your density' },
    { cls: 'ts-bench', label: 'Lognormal benchmark (normal returns)' },
    { cls: `ts-start${status === 'play' ? '' : ' is-overlay'}`, label: 'Where it started' },
  ];
  if (status === 'missed') densityLegend.push({ cls: 'ts-target is-static', label: 'The notes’ density' });

  return (
    <GameCard className="g-enter relative space-y-5 !px-4 sm:!px-6">
      {timed && !resolved && round.timeLimitMs && <TimerBar ms={round.timeLimitMs} />}

      <div className="space-y-3">
        <h2 className="ts-title">{pretty(item.title)}</h2>
        <p className="ts-desc">{pretty(p.description)}</p>
        {(discovery || resolved) && <TailChips nuL={params.nuL} nuR={params.nuR} th={thresholds} />}
      </div>

      <figure className="space-y-2">
        <figcaption className="ts-chart-title">Density of returns</figcaption>
        <div className="ts-axis-title">↑ Density (per % of return)</div>
        <DensityChart params={params} startParams={p.startParams} targetParams={targetShown} status={status} clipId={`${idBase}-d`} />
        <div className="ts-axis-title text-right">Return over the option’s life (%) →</div>
        <LegendRow rows={densityLegend} />
        <p className="ts-note">{densityCaption}</p>
      </figure>

      <figure className="space-y-2">
        <figcaption className="ts-chart-title">The tails, magnified</figcaption>
        <div className="ts-axis-title">↑ Density (per % of return)</div>
        <TailLens params={params} targetParams={targetShown} status={status} clipId={`${idBase}-l`} />
        <div className="ts-axis-title text-right">Return over the option’s life (%) →</div>
        <LegendRow
          rows={[
            { cls: 'ts-extra', label: 'More mass than lognormal', fill: true },
            { cls: 'ts-bench', label: 'Lognormal benchmark' },
          ]}
        />
      </figure>

      {(status === 'snapped' || (status === 'missed' && settled)) && <SmilePanel p={p} id={idBase} />}

      <div className="space-y-3" role="group" aria-label="Density settings">
        {PARAM_NAMES.map((n) => {
          const matter = item.matters.includes(n);
          const showBand = matter && (status === 'missed' || (hint && status === 'play'));
          return (
            <SliderRow
              key={n}
              p={specs[n]}
              value={params[n]}
              start={p.startParams[n]}
              band={showBand ? boxOf(specs[n], item.target[n], item.tolerance[n]) : null}
              locked={resolved}
              pulse={(hint && status === 'play' && outOfBox.includes(n)) || (status === 'missed' && settled && matter)}
              bounce={status === 'snapped' && settled && matter}
              onChange={(v) => setParam(n, v)}
            />
          );
        })}
      </div>

      {!resolved && (
        <div className="flex flex-wrap gap-3">
          {discovery && (
            <GameButton onClick={() => setHint(true)} disabled={hint}>
              Which sliders?
            </GameButton>
          )}
          <GameButton variant="quiet" onClick={startOver}>
            Start over
          </GameButton>
          <GameButton variant="quiet" onClick={() => miss(false)}>
            Show me
          </GameButton>
        </div>
      )}
      {!resolved && hint && (
        <p className="ts-note">
          The sliders still out of place are pulsing; the green band on each is the range the notes’ words allow. The others can sit anywhere.
        </p>
      )}

      {status === 'snapped' && (
        <div className="g-assemble space-y-3 border-l-[3px] pl-4" style={{ borderColor: 'var(--g-green)' }}>
          <p className="ts-text">
            <span className="g-strong">Matched.</span> {LABEL_TERM[item.smile.label]}.
          </p>
          <p className="ts-reading">{pretty(item.explanation)}</p>
        </div>
      )}

      {status === 'missed' && (
        <div className="space-y-3">
          <p className="ts-note">{timedOut ? 'Time ran out.' : 'Here is the notes’ density.'}</p>
          <div className="ts-hold-right space-y-3" style={{ '--ts-delay': `${HOLD_MS}ms` } as CSSProperties} aria-live="polite">
            <p className="ts-text">
              <span className="g-strong">{LABEL_TERM[item.smile.label]}.</span>{' '}
              {item.matters.length === 1 ? 'The slider that matters is' : 'The sliders that matter are'}{' '}
              {item.matters.map((n) => pretty(specs[n].label).replace(/\s*\(.*\)$/, '').toLowerCase()).join(' and ')}; the green band on each is what the words allow.
            </p>
            <p className="ts-reading">{pretty(item.explanation)}</p>
          </div>
        </div>
      )}

      {resolved && (
        <div className="flex justify-end">
          <button ref={nextRef} type="button" className="g-btn is-primary" onClick={onNext} disabled={!settled}>
            {last ? 'Continue' : 'Next distribution'}
          </button>
        </div>
      )}
    </GameCard>
  );
}

/** One short rule per round this phase: pending, current, matched, missed. No numbers. */
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

export function TailBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<TailPayload>) {
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
      <div className="ts-phase-label">{phase === 'discovery' ? 'At the bench' : 'Under pressure'}</div>
      <Docket total={rounds.length} index={index} results={results} />
      <Round key={round.id} round={round} phase={phase} onAnswered={answered} onNext={next} last={index + 1 === rounds.length} />
    </div>
  );
}
