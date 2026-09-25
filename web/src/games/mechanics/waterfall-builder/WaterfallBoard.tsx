// Waterfall Builder board. An empty column with the flow's pieces scattered in a tray below; the
// player drops them in top to bottom (drag onto the column, or tap / Enter on a tile). A tile that
// belongs locks into the next slot with a snap, its one-line detail appears, and the flow pours down
// the rail to it. A tile that doesn't belongs shows in the slot for a beat while the flow leaks off
// the rail (a phantom branch), then bounces back to the tray and, in discovery, the right tile
// pulses. When the last tile lands the whole column lights; a loop draws its return channel and
// settles into a ring. Under pressure a drained timer fills the rest in after an 800 ms hold.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import { GameCard, TimerBar } from '../../theme/primitives';
import type { StackState } from './flow';
import {
  GUTTER,
  NODE_R,
  RAIL_X,
  columnLayout,
  easeInOutCubic,
  initialStack,
  isComplete,
  lerpPoints,
  litThrough,
  phantomPath,
  placeTile,
  railGeometry,
  remainingTiles,
  revealRest,
  ringArc,
  ringArrow,
  ringFrame,
  ringLayout,
  slipGrade,
} from './flow';
import type { WaterfallPayload } from './build';
import { KIND_WORD, openCount, sentence } from './build';
import type { FlowItem } from './schema';
import './waterfall-builder.css';

const POUR_MS = 140;
const REJECT_MS = 650;
const BOUNCE_MS = 480;
const HOLD_MS = 800;
const FADE_MS = 520;
const LOOP_DRAW_MS = 700;
const MORPH_MS = 900;
const DRAG_THRESHOLD = 6;

type Status = 'play' | 'hold' | 'done';

interface Outcome {
  correct: boolean;
  timedOut: boolean;
  errors: number;
}

interface Rect {
  left: number;
  top: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Width of an element, tracked with ResizeObserver (an SVG's viewBox follows it 1:1). */
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

const delayStyle = (ms: number): CSSProperties => ({ '--wb-delay': `${Math.max(0, Math.round(ms))}ms` }) as CSSProperties;

// ---------------------------------------------------------------------------------------------
// The ring a closed loop settles into

function RingFigure({ item, delayMs }: { item: FlowItem; delayMs: number }) {
  const [setRef, width] = useWidth<HTMLDivElement>();
  const n = item.steps.length;
  const reduced = useRef(prefersReducedMotion()).current;
  const [t, setT] = useState(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const u = Math.min(1, (now - start) / MORPH_MS);
      setT(u);
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [reduced, delayMs]);

  const f = ringFrame(width || 300, n);
  const ring = ringLayout(n, f.cx, f.cy, f.radius);
  const col = columnLayout(n, f.cx, f.cy, f.H - 44);
  const pts = lerpPoints(col, ring, easeInOutCubic(t));
  const r = 16;
  const pad = r + 4;
  const label = `${item.steps.map((s, i) => `${i + 1}: ${s.text}`).join('; ')}; then back to 1.`;
  return (
    <figure className="space-y-2" aria-label="The loop closes">
      <div className="g-kicker">The loop closes</div>
      <div ref={setRef} className="w-full">
        {width > 0 && (
          <svg width="100%" viewBox={`0 0 ${f.W} ${f.H}`} role="img" aria-label={`Loop: ${label}`} style={{ display: 'block', maxWidth: f.W }}>
            {t < 1 &&
              pts.slice(0, -1).map((p, i) => <line key={`c${i}`} className="wb-ring-chain" x1={p.x} y1={p.y} x2={pts[i + 1].x} y2={pts[i + 1].y} />)}
            {t >= 1 &&
              ring.map((_, i) => {
                const closure = i === n - 1;
                const style = { animationDelay: `${closure ? 260 : i * 40}ms` };
                return (
                  <g key={`a${i}`}>
                    <path className={`wb-ring-arc${closure ? ' is-closure' : ''}`} d={ringArc(i, n, f.cx, f.cy, f.radius, pad)} style={style} />
                    <polygon
                      className={`wb-ring-arc wb-ring-arrow${closure ? ' is-closure' : ''}`}
                      points={ringArrow(i, n, f.cx, f.cy, f.radius, pad)}
                      style={style}
                    />
                  </g>
                );
              })}
            {pts.map((p, i) => (
              <g key={`n${i}`}>
                <circle className={`wb-ring-node${i === 0 ? ' is-first' : ''}`} cx={p.x} cy={p.y} r={r} />
                <text className="wb-ring-num" x={p.x} y={p.y}>
                  {i + 1}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
      {item.loopClosure && <figcaption className="g-serif">{item.loopClosure}</figcaption>}
    </figure>
  );
}

// ---------------------------------------------------------------------------------------------
// A tray tile: tap / Enter drops it into the next slot; a drag snaps it there if released over the column.

function Tile({
  text,
  disabled,
  away,
  bounce,
  pulse,
  columnRect,
  onPlace,
  onOver,
}: {
  text: string;
  disabled: boolean;
  away: boolean;
  bounce: boolean;
  pulse: boolean;
  columnRect: () => DOMRect | null;
  onPlace: (from: Rect) => void;
  onOver: (over: boolean) => void;
}) {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; id: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);

  const inside = (x: number, y: number) => {
    const r = columnRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      s.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setOffset({ x: dx, y: dy });
    onOver(inside(e.clientX, e.clientY));
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId || !s.dragging) return;
    // The click that follows a drag's release is not a tap.
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 60);
    const r = e.currentTarget.getBoundingClientRect();
    setOffset(null);
    onOver(false);
    if (inside(e.clientX, e.clientY)) onPlace({ left: r.left, top: r.top });
  };
  const onPointerCancel = () => {
    start.current = null;
    setOffset(null);
    onOver(false);
  };
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (disabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPlace({ left: r.left, top: r.top });
  };
  const lifted = offset !== null;
  return (
    <button
      type="button"
      className={`wb-tile${lifted ? ' is-lifted' : ''}${away ? ' is-away' : ''}${bounce ? ' is-bounce' : ''}${pulse ? ' is-pulse' : ''}`}
      style={lifted ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(1.035)` } : undefined}
      disabled={disabled}
      aria-label={`${text}. Place in the next slot.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
    >
      {text}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// One round

function Round({
  round,
  phase,
  onAnswered,
  onNext,
  last,
}: {
  round: MechanicRound<WaterfallPayload>;
  phase: PlayPhase;
  onAnswered: (r: RoundResult) => void;
  onNext: () => void;
  last: boolean;
}) {
  const p = round.payload;
  const item = p.item;
  const n = item.steps.length;
  const loop = item.kind === 'loop';
  const reduced = useRef(prefersReducedMotion()).current;
  const pour = reduced ? 0 : POUR_MS;
  const timed = phase === 'pressure' && !!round.timeLimitMs;

  const [stack, setStack] = useState<StackState>(() => initialStack(p.slots, p.open));
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const [status, setStatus] = useState<Status>('play');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const outcomeRef = useRef<Outcome | null>(null);
  const [settled, setSettled] = useState(false);
  const [reject, setReject] = useState<{ step: number; slot: number } | null>(null);
  const [bounce, setBounce] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const [closed, setClosed] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [flip, setFlip] = useState<{ slot: number; from: Rect; key: number } | null>(null);
  const started = useRef(performance.now());
  const columnRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef<(HTMLLIElement | null)[]>([]);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const [centres, setCentres] = useState<number[]>([]);
  const [height, setHeight] = useState(0);
  const [, setMeasureTick] = useState(0);

  // ---- where the flow has reached, and the pour delays for what just lit
  // Kept per lit value (not per render), so the re-render that re-measures the rail after a
  // placement doesn't zero the delays before the browser has started the transitions.
  const lit = litThrough(stack.filled);
  const pourRef = useRef({ lit, from: lit + 1 });
  if (pourRef.current.lit !== lit) pourRef.current = { lit, from: pourRef.current.lit + 1 };
  const firstNew = pourRef.current.from;
  const pourDelay = (e: number) => (e >= firstNew ? (e - firstNew) * pour : 0);
  const pourSpan = Math.max(0, lit - firstNew + 1) * pour;

  // ---- measure the slot centres so the rail lines up with the HTML column
  useLayoutEffect(() => {
    const col = columnRef.current;
    if (!col) return;
    const cs = slotRefs.current.slice(0, n).map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : 0));
    const h = col.offsetHeight;
    setCentres((prev) => (prev.length === cs.length && prev.every((v, i) => Math.abs(v - cs[i]) < 0.5) ? prev : cs));
    setHeight((prev) => (Math.abs(prev - h) < 0.5 ? prev : h));
  });
  useEffect(() => {
    const col = columnRef.current;
    if (!col || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => setMeasureTick((x) => x + 1));
    obs.observe(col);
    return () => obs.disconnect();
  }, []);

  // ---- snap: the placed tile glides from where it was dropped into its slot
  useLayoutEffect(() => {
    if (!flip || reduced) return;
    const el = slotRefs.current[flip.slot];
    if (!el) return;
    const to = el.getBoundingClientRect();
    el.style.transition = 'none';
    el.style.transform = `translate(${flip.from.left - to.left}px, ${flip.from.top - to.top}px) scale(1.03)`;
    void el.offsetWidth;
    el.style.transition = 'transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1.15)';
    el.style.transform = '';
    const t = window.setTimeout(() => {
      el.style.transition = '';
    }, 300);
    return () => window.clearTimeout(t);
  }, [flip, reduced]);

  const finish = (s: StackState, timedOut: boolean) => {
    if (outcomeRef.current) return;
    const o: Outcome = { correct: !timedOut && s.errors === 0, timedOut, errors: s.errors };
    outcomeRef.current = o;
    setOutcome(o);
    onAnswered({
      roundId: round.id,
      correct: o.correct,
      timeMs: performance.now() - started.current,
      timedOut,
      grade: slipGrade(s.errors, openCount(p), timedOut),
    });
  };

  const place = (step: number, from: Rect | null) => {
    if (status !== 'play' || reject) return;
    const cur = stackRef.current;
    const slot = cur.cursor;
    if (slot < 0) return;
    const { state, correct } = placeTile(cur, step);
    stackRef.current = state;
    setStack(state);
    if (correct) {
      setFlip(from ? { slot, from, key: performance.now() } : null);
      const nextSlot = state.cursor;
      setAnnounce(
        `Locked in: ${item.steps[step].text}. ${nextSlot < 0 ? 'The flow is complete.' : `Next: slot ${nextSlot + 1} of ${n}.`}`,
      );
      if (isComplete(state)) {
        finish(state, false);
        setStatus('done');
      }
    } else {
      setReject({ step, slot });
      setAnnounce(`${item.steps[step].text} does not go there. It goes back to the tray.`);
    }
  };

  // Wrong tile: it shows in the slot while the flow leaks, then bounces back to the tray.
  useEffect(() => {
    if (!reject) return;
    const t = window.setTimeout(() => {
      setBounce(reject.step);
      setReject(null);
    }, reduced ? 350 : REJECT_MS);
    return () => window.clearTimeout(t);
  }, [reject, reduced]);
  useEffect(() => {
    if (bounce === null) return;
    const t = window.setTimeout(() => setBounce(null), BOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [bounce]);

  // Pressure: when the timer drains, hold what's built for a beat, then fill the rest in.
  useEffect(() => {
    if (!timed || status !== 'play') return;
    const left = Math.max(0, (round.timeLimitMs ?? 0) - (performance.now() - started.current));
    const t = window.setTimeout(() => {
      finish(stackRef.current, true);
      setReject(null);
      setStatus('hold');
      setAnnounce('Time ran out.');
    }, left);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, status]);
  useEffect(() => {
    if (status !== 'hold') return;
    const t = window.setTimeout(() => {
      const s = revealRest(stackRef.current);
      stackRef.current = s;
      setStack(s);
      setStatus('done');
    }, HOLD_MS);
    return () => window.clearTimeout(t);
  }, [status]);

  // Done: let the flow pour (and a loop close) before the player moves on.
  useEffect(() => {
    if (status !== 'done') return;
    const wait = outcomeRef.current?.timedOut ? FADE_MS + (reduced ? 0 : n * 90) : pourSpan + (reduced ? 0 : 300);
    const t1 = window.setTimeout(() => setClosed(loop), loop ? pourSpan + (reduced ? 0 : 200) : 0);
    const t2 = window.setTimeout(() => setSettled(true), wait);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useEffect(() => {
    if (settled) nextRef.current?.focus();
  }, [settled]);

  // Keyboard: after a tile leaves the tray, keep focus in the tray.
  useEffect(() => {
    if (status !== 'play') return;
    const active = document.activeElement;
    if (!active || active === document.body) trayRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [stack, status]);

  const complete = isComplete(stack);
  const clean = complete && status === 'done' && !!outcome?.correct;
  const tiles = remainingTiles(stack, p.tray);
  const expected = stack.cursor >= 0 ? stack.slots[stack.cursor] : null;
  const pulseAfter = phase === 'discovery' ? 1 : 2;
  const pulseStep = expected !== null && stack.cursor >= 0 && stack.slipsAt[stack.cursor] >= pulseAfter && !reject ? expected : null;

  // ---- rail geometry
  const rail = centres.length === n && height > 0 ? railGeometry(centres, loop) : null;
  const activeNode = stack.cursor >= 0 && rail ? rail.nodes[stack.cursor] : null;
  const firstY = rail?.nodes[0]?.y ?? 0;
  const lastY = rail?.nodes[n - 1]?.y ?? 0;

  const instruction =
    p.variant.kind === 'build'
      ? loop
        ? 'A loop has no top of its own, so it starts where the notes start it. Drop the rest in, going round: drag one onto the column, or tap it.'
        : 'Drop the pieces in, top to bottom: drag one onto the column, or tap it.'
      : p.variant.kind === 'rotated'
        ? 'This loop is picked up part-way round. Carry on from the top until it closes.'
        : 'Part of the flow is already in place. Fill the gap, top to bottom.';

  const slips = stack.slipsAt
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c > 0)
    .map((x) => ({ slot: x.i, right: item.steps[stack.slots[x.i]].text, tried: stack.firstWrong[x.i] >= 0 ? item.steps[stack.firstWrong[x.i]].text : '' }));
  const source = `block ${round.blockId}`;

  return (
    <GameCard className="g-enter wb-board relative space-y-5">
      {timed && status === 'play' && <TimerBar ms={round.timeLimitMs ?? 30000} />}

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="g-chip">{KIND_WORD[item.kind]}</span>
          <span className="g-kicker">{phase === 'discovery' ? 'Build the flow' : 'Against the clock'}</span>
        </div>
        <h2 className="g-serif text-[1.3rem] font-semibold leading-snug" style={{ color: 'var(--g-navy)' }}>
          {item.title}
        </h2>
        {phase === 'discovery' && <p className="g-serif g-muted">{sentence(item.directionLabel)}</p>}
        {status === 'play' && <p className="g-small g-muted">{instruction}</p>}
      </header>

      <div
        ref={columnRef}
        className={`wb-stack is-${item.kind}${complete ? ' is-complete' : ''}${clean ? ' is-clean' : ''}`}
        style={{ paddingLeft: GUTTER }}
      >
        {rail && (
          <svg className="wb-rail" width={GUTTER} height={height} viewBox={`0 0 ${GUTTER} ${height}`} aria-hidden="true">
            {rail.pipes.map((d, i) => {
              const on = lit >= i + 1;
              const style = delayStyle(pourDelay(i + 1) - pour / 2);
              const endY = rail.nodes[i + 1].y - NODE_R - 2;
              const long = endY - (rail.nodes[i].y + NODE_R + 2) > 12;
              return (
                <g key={`p${i}`}>
                  <path className="wb-pipe" d={d} />
                  <path className={`wb-pipe-lit${on ? ' is-lit' : ''}`} d={d} pathLength={1} style={style} />
                  {long && (
                    <polygon
                      className={`wb-head${on ? ' is-lit' : ''}`}
                      points={`${RAIL_X - 5},${endY - 6} ${RAIL_X + 5},${endY - 6} ${RAIL_X},${endY + 1}`}
                      style={style}
                    />
                  )}
                </g>
              );
            })}
            {rail.loop && (
              <g>
                <path
                  className="wb-loop"
                  d={rail.loop}
                  style={{ strokeDasharray: rail.loopLength, strokeDashoffset: closed ? 0 : rail.loopLength, transitionDuration: reduced ? '0ms' : `${LOOP_DRAW_MS}ms` }}
                />
                <polygon
                  className={`wb-loop-head${closed ? ' is-on' : ''}`}
                  points={`${RAIL_X - NODE_R - 8},${firstY - 5} ${RAIL_X - NODE_R - 8},${firstY + 5} ${RAIL_X - NODE_R},${firstY}`}
                />
              </g>
            )}
            {complete && status === 'done' && settled && (
              <g>
                <path className="wb-current" d={`M ${RAIL_X} ${firstY} L ${RAIL_X} ${lastY}`} />
                {closed && rail.loop && <path className="wb-current" d={rail.loop} />}
              </g>
            )}
            {rail.nodes.map((pt, i) => {
              const filled = stack.filled[i];
              const on = lit >= i;
              const cls = on ? 'is-lit' : filled ? 'is-dim' : i === stack.cursor ? 'is-active' : '';
              return (
                <g key={`n${i}`}>
                  <circle className={`wb-node ${cls}`} cx={pt.x} cy={pt.y} r={NODE_R} style={delayStyle(pourDelay(i))} />
                  {i === stack.cursor && status === 'play' && <circle className="wb-node-ring" cx={pt.x} cy={pt.y} r={NODE_R} />}
                  {status === 'done' && (
                    <text className={`wb-node-num${on ? '' : ' is-dark'}`} x={pt.x} y={pt.y}>
                      {stack.slots[i] + 1}
                    </text>
                  )}
                </g>
              );
            })}
            {reject && activeNode && (
              <g key={`leak-${stack.errors}`}>
                <path className="wb-phantom" d={phantomPath(activeNode)} />
                <circle className="wb-drip" cx={Math.max(4, activeNode.x - 26)} cy={activeNode.y + 40} r={3.5} />
              </g>
            )}
          </svg>
        )}

        <ol className="wb-slots" aria-label={`${item.title}, top to bottom`}>
          {stack.slots.map((stepIdx, i) => {
            const step = item.steps[stepIdx];
            const filled = stack.filled[i];
            const how = stack.how[i];
            const active = i === stack.cursor && status === 'play';
            const rejecting = active && reject?.slot === i;
            const cls = [
              'wb-slot',
              filled ? 'is-filled' : '',
              how === 'locked' ? 'is-locked' : '',
              how === 'revealed' ? 'is-revealed' : '',
              lit >= i ? 'is-lit' : '',
              active ? 'is-active' : '',
              active && over ? 'is-over' : '',
              rejecting ? 'is-reject' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const showDetail = filled && (how !== 'locked' || status === 'done');
            return (
              <li
                key={i}
                ref={(el: HTMLLIElement | null) => {
                  slotRefs.current[i] = el;
                }}
                className={cls}
                style={{ ...delayStyle(pourDelay(i)), ...(how === 'revealed' ? { animationDelay: `${i * 90}ms` } : {}) }}
              >
                {filled ? (
                  <>
                    <span className="wb-slot-text">{step.text}</span>
                    {showDetail && <span className="wb-slot-detail">{step.detail}</span>}
                  </>
                ) : rejecting && reject ? (
                  <span className="wb-ghost">{item.steps[reject.step].text}</span>
                ) : active ? (
                  <span className="wb-slot-hint">{over ? 'Let go to drop it here' : 'Next piece goes here'}</span>
                ) : (
                  <span className="sr-only">Empty slot</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {status === 'play' && tiles.length > 0 && (
        <div className="space-y-2">
          <div className="g-kicker">Pieces</div>
          <div ref={trayRef} className="wb-tray" role="group" aria-label="Pieces to place">
            {tiles.map((s) => (
              <Tile
                key={s}
                text={item.steps[s].text}
                disabled={false}
                away={reject?.step === s}
                bounce={bounce === s}
                pulse={pulseStep === s}
                columnRect={() => columnRef.current?.getBoundingClientRect() ?? null}
                onPlace={(from) => place(s, from)}
                onOver={setOver}
              />
            ))}
          </div>
        </div>
      )}

      {status === 'hold' && <p className="g-small g-muted">Time ran out. The rest of the flow fills in below what you built.</p>}

      {status === 'done' && outcome && (
        <div className="space-y-4" style={{ animation: `wb-fade 420ms ease ${outcome.timedOut ? 0 : pourSpan}ms both` }}>
          {outcome.correct ? (
            <div className="g-assemble border-l-[3px] pl-4" style={{ borderColor: 'var(--g-green)' }}>
              <p className="g-serif">
                <span className="g-strong">The flow runs.</span> {sentence(item.directionLabel)}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {outcome.timedOut && (
                <p className="g-small g-muted">Time ran out. The pieces you hadn&rsquo;t placed are filled in, edged in gold.</p>
              )}
              {slips.map((s) => (
                <p key={s.slot} className="wb-slip g-serif">
                  Slot {s.slot + 1} is <span className="g-strong">{s.right}</span>
                  {s.tried ? <>, not {s.tried}.</> : '.'}
                </p>
              ))}
              <p className="g-serif">
                <span className="g-strong">Which way it runs:</span> {sentence(item.directionLabel)}
              </p>
            </div>
          )}

          {loop && closed && <RingFigure item={item} delayMs={reduced ? 0 : LOOP_DRAW_MS} />}

          <p className="g-serif">{item.explanation}</p>
          <p className="g-source">{source}</p>

          <div className="flex justify-end">
            <button ref={nextRef} type="button" className="g-btn is-primary" onClick={onNext} disabled={!settled}>
              {last ? 'Continue' : 'Next flow'}
            </button>
          </div>
        </div>
      )}
    </GameCard>
  );
}

/** One short rule per round this phase: pending, current, clean, slipped. No numbers. */
function Docket({ total, index, results }: { total: number; index: number; results: boolean[] }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => {
        const bg =
          i < results.length ? (results[i] ? 'var(--g-green)' : 'var(--g-red)') : i === index ? 'var(--g-gold)' : 'var(--g-rule)';
        return <span key={i} className="h-1 flex-1" style={{ background: bg }} />;
      })}
    </div>
  );
}

export function WaterfallBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<WaterfallPayload>) {
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
      <div className="g-kicker">{phase === 'discovery' ? 'Laying the channel' : 'Under pressure'}</div>
      <Docket total={rounds.length} index={index} results={results} />
      <Round key={round.id} round={round} phase={phase} onAnswered={answered} onNext={next} last={index + 1 === rounds.length} />
    </div>
  );
}
