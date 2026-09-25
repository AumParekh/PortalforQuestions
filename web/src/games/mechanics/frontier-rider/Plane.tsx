// Frontier Rider: the mean–standard deviation plane, hand-rolled SVG. The viewBox follows the
// container width 1:1, so 15px SVG text is 15px on screen at any width. Draws the frontier
// (efficient half solid, inefficient half faint), the line from the risk-free asset through the
// tangency portfolio, the assets, the special points, the rider and its trail, the player's call
// as an arrow, and a dotted ghost of the plane as it was before the slider moved.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Jump, MoveCode, Pt, State, Win } from './maths';
import { compassVector, fmt, frontierBranches, isCompass, jumpTarget, niceTicks, tickDecimals } from './maths';
import type { FrItem } from './schema';

const TICK_CHAR_W = 9;

export type RiderStatus = 'idle' | 'moving' | 'locked' | 'missed';
export type CallStatus = 'pending' | 'right' | 'wrong';

/** Width of an element, tracked with ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
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

export interface PlaneProps {
  item: FrItem;
  win: Win;
  variant: 'main' | 'loupe';
  /** The plane at the slider's current value. */
  cur: State;
  /** The rider at the current value. */
  rider: Pt;
  /** The plane before the slider moved; drawn dotted while the slider is away from its start. */
  ghost: State | null;
  /** Rider positions from the start up to now. */
  trail: Pt[];
  /** The whole path from slider.from to slider.to, once revealed. */
  fullPath: Pt[] | null;
  /** The player's call (move rounds only). */
  call: { move: MoveCode; status: CallStatus } | null;
  riderStatus: RiderStatus;
  clipId: string;
  label: string;
}

function pathD(pts: readonly Pt[], sx: (v: number) => number, sy: (v: number) => number): string {
  let d = '';
  for (const p of pts) {
    const x = sx(p.sigma);
    const y = sy(p.mu);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    // Keep far-off points drawable; the clip path hides what leaves the plot.
    const cx = Math.max(-1e5, Math.min(1e5, x));
    const cy = Math.max(-1e5, Math.min(1e5, y));
    d += `${d ? 'L' : 'M'}${cx.toFixed(1)},${cy.toFixed(1)}`;
  }
  return d;
}

export function Plane({ item, win, variant, cur, rider, ghost, trail, fullPath, call, riderStatus, clipId, label }: PlaneProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const W = Math.max(260, width || 320);
  const H = variant === 'main' ? Math.round(Math.min(380, Math.max(230, W * 0.68))) : Math.round(Math.min(300, Math.max(200, W * 0.55)));

  const yTicks = niceTicks(win.y0, win.y1, H < 260 ? 4 : 5).filter((t) => t >= win.y0 - 1e-9 && t <= win.y1 + 1e-9);
  const yDec = tickDecimals(yTicks);
  const yLabels = yTicks.map((t) => fmt(t, yDec));
  const left = Math.ceil(Math.max(1, ...yLabels.map((l) => l.length)) * TICK_CHAR_W + 14);
  const top = 12;
  const bottom = 34;
  let right = 16;
  let xTicks: number[] = [];
  let xLabels: string[] = [];
  for (let want = 6; want >= 2; want--) {
    xTicks = niceTicks(win.x0, win.x1, want).filter((t) => t >= win.x0 - 1e-9 && t <= win.x1 + 1e-9);
    const dec = tickDecimals(xTicks);
    xLabels = xTicks.map((t) => fmt(t, dec));
    right = Math.max(16, Math.ceil(((xLabels[xLabels.length - 1]?.length ?? 1) * TICK_CHAR_W) / 2 + 4));
    const plotW = W - left - right;
    const widest = Math.max(1, ...xLabels.map((l) => l.length)) * TICK_CHAR_W;
    const gap = xTicks.length > 1 ? (plotW * (xTicks[1] - xTicks[0])) / (win.x1 - win.x0) : Infinity;
    if (gap >= widest + 12 || xTicks.length <= 2) break;
  }
  const sx = (v: number) => left + ((v - win.x0) / (win.x1 - win.x0)) * (W - left - right);
  const sy = (v: number) => top + (1 - (v - win.y0) / (win.y1 - win.y0)) * (H - top - bottom);

  const fr = useMemo(() => frontierBranches(cur, win), [cur, win]);
  const gh = useMemo(() => (ghost ? frontierBranches(ghost, win) : null), [ghost, win]);

  const calLine = (s: State) => {
    if (!s.tangency) return null;
    const x0 = Math.max(0, win.x0);
    const x1 = win.x1;
    if (!(x1 > x0)) return null;
    const r = s.inputs.rf;
    const k = s.tangency.sharpe;
    return { x1: sx(x0), y1: sy(r + k * x0), x2: sx(x1), y2: sy(r + k * x1) };
  };
  const cal = calLine(cur);
  const ghostCal = ghost ? calLine(ghost) : null;
  const start = trail[0] ?? rider;

  // The call: an arrow from where the rider started, in the called direction or to the jump target.
  let arrow: { x1: number; y1: number; x2: number; y2: number } | null = null;
  let ring = false;
  if (call) {
    const x0 = sx(start.sigma);
    const y0 = sy(start.mu);
    const len = variant === 'main' ? 46 : 42;
    if (isCompass(call.move)) {
      const v = compassVector(call.move);
      if (v) arrow = { x1: x0, y1: y0, x2: x0 + v.dx * len, y2: y0 - v.dy * len };
      else ring = true;
    } else {
      const last = item.path.states[item.path.states.length - 1];
      const dest = jumpTarget(last, call.move as Jump);
      if (dest) {
        const dx = sx(dest.sigma) - x0;
        const dy = sy(dest.mu) - y0;
        const d = Math.hypot(dx, dy);
        // Point at the target; stop short of it so the head doesn't hide the marker.
        const L = d - 8;
        if (L > 4) arrow = { x1: x0, y1: y0, x2: x0 + (dx / d) * L, y2: y0 + (dy / d) * L };
      }
    }
  }
  const callCls = call ? `fr-call is-${call.status}` : '';
  const markerId = `${clipId}-head`;

  const showTangency = item.point !== 'tangency' && !!cur.tangency;
  const showMv = item.point !== 'min-variance';
  const assets = cur.inputs.mu.map((mu, i) => ({ mu, sigma: cur.inputs.sigma[i], name: item.assets[i].short }));
  const rf = cur.inputs.rf;
  const rfInside = win.x0 <= 0 && rf >= win.y0 && rf <= win.y1;
  const zeroInside = win.y0 < 0 && win.y1 > 0;

  return (
    <div ref={ref} className="fr-chart w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={top} width={Math.max(1, W - left - right)} height={Math.max(1, H - top - bottom)} />
          </clipPath>
          {(['pending', 'right', 'wrong'] as const).map((s) => (
            <marker key={s} id={`${markerId}-${s}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className={`fr-head is-${s}`} d="M0,0 L10,5 L0,10 z" />
            </marker>
          ))}
        </defs>

        {/* Grid and axes: straight edges, sharp corners only on the axes. */}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line className="fr-gridline" x1={left} x2={W - right} y1={sy(t)} y2={sy(t)} />
            <text className="fr-tick" x={left - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle">
              {yLabels[i]}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line className="fr-gridline" x1={sx(t)} x2={sx(t)} y1={top} y2={H - bottom} />
            <text className="fr-tick" x={sx(t)} y={H - bottom + 22} textAnchor="middle">
              {xLabels[i]}
            </text>
          </g>
        ))}
        {zeroInside && <line className="fr-zero" x1={left} x2={W - right} y1={sy(0)} y2={sy(0)} />}
        <line className="fr-axis" x1={left} x2={left} y1={top} y2={H - bottom} />
        <line className="fr-axis" x1={left} x2={W - right} y1={H - bottom} y2={H - bottom} />

        <g clipPath={`url(#${clipId})`}>
          {/* The plane before the change: it breaks, the new one re-forms over it. */}
          {gh && (
            <g className="fr-ghost">
              <path d={pathD(gh.lower, sx, sy)} />
              <path d={pathD(gh.upper, sx, sy)} />
              {ghostCal && <line {...ghostCal} />}
            </g>
          )}
          <path className="fr-frontier is-lower" d={pathD(fr.lower, sx, sy)} />
          <path className="fr-frontier" d={pathD(fr.upper, sx, sy)} />
          {cal && <line className="fr-cal" {...cal} />}

          {fullPath && fullPath.length > 1 && <path className={`fr-path${riderStatus === 'missed' ? ' is-truth' : ''}`} d={pathD(fullPath, sx, sy)} />}
          {trail.length > 1 && <path className="fr-trail" d={pathD(trail, sx, sy)} />}

          {showMv && (
            <rect
              className="fr-mv"
              x={sx(cur.mv.sigma) - 5}
              y={sy(cur.mv.mu) - 5}
              width={10}
              height={10}
              transform={`rotate(45 ${sx(cur.mv.sigma)} ${sy(cur.mv.mu)})`}
            />
          )}
          {showTangency && cur.tangency && <circle className="fr-tan" cx={sx(cur.tangency.sigma)} cy={sy(cur.tangency.mu)} r={6} />}
          {assets.map((a, i) => (
            <circle key={i} className="fr-asset" cx={sx(a.sigma)} cy={sy(a.mu)} r={4.5} />
          ))}
          {rfInside && <rect className="fr-rf" x={sx(0) - 5} y={sy(rf) - 5} width={10} height={10} />}

          {call && arrow && (
            <g className={callCls}>
              <line x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2} markerEnd={`url(#${markerId}-${call.status})`} />
            </g>
          )}
          {call && ring && (
            <g className={callCls}>
              <circle cx={sx(start.sigma)} cy={sy(start.mu)} r={17} />
            </g>
          )}

          {riderStatus === 'locked' && <circle key="lock" className="fr-lock-ring" cx={sx(rider.sigma)} cy={sy(rider.mu)} r={9} />}
          <circle className={`fr-rider is-${riderStatus}`} cx={sx(rider.sigma)} cy={sy(rider.mu)} r={7.5} />
        </g>

        {/* Labels sit outside the clip so they never get cut off at the plot edge. */}
        {variant === 'main' &&
          assets.map((a, i) => {
            const x = sx(a.sigma);
            const y = sy(a.mu);
            if (x < left - 1 || x > W - right + 1 || y < top - 1 || y > H - bottom + 1) return null;
            const end = x > left + (W - left - right) * 0.55;
            return (
              <text key={`l${i}`} className="fr-label" x={end ? x - 9 : x + 9} y={y - 9} textAnchor={end ? 'end' : 'start'}>
                {a.name}
              </text>
            );
          })}
        {variant === 'main' && rfInside && (
          <text className="fr-label is-muted" x={sx(0) + 10} y={sy(rf) - 10} textAnchor="start">
            {item.plane.rfName}
          </text>
        )}
      </svg>
    </div>
  );
}
