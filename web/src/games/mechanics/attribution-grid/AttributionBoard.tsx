// Attribution Grid board. One statement card sits above a governance map: the board / committee
// slot on top, the three lines below it, joined by oversight connectors. The player drags the
// card onto a slot (mouse, pen or touch), taps a slot, or presses 1–4. A correct placement snaps
// a tile into the slot and the slot locks green. A wrong one lands in the wrong slot, which
// bounces while the right slot pulses; a dashed phantom arc then carries the tile to where it
// belongs, and the panel shows the chosen role's actual responsibility and why the statement
// belongs elsewhere, with its source block. Tile flights run on requestAnimationFrame and jump
// straight to the end under reduced motion. The overlay SVG uses the container's own pixel size
// as its viewBox, so nothing in it is scaled.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import { GameCard, TimerBar } from '../../theme/primitives';
import type { AgPayload } from './build';
import type { AgRole, RoleId } from './schema';
import type { PhantomArc, Pt, Rect } from './geometry';
import { TILE, connectorPaths, easeInOutCubic, easeOutBack, flightAt, phantomArc, slotAt, tileCentre } from './geometry';
import './attribution-grid.css';

type Round = MechanicRound<AgPayload>;

/** Keys 1–4, in on-screen reading order of the lines, then the board. */
const KEY_OF: Record<RoleId, string> = { first: '1', second: '2', third: '3', board: '4' };
const LINE_IDS: readonly RoleId[] = ['first', 'second', 'third'];
/** The beat a wrong tile holds in the wrong slot (§10.3). */
const HOLD_MS = 800;
/** The correct version's fade-in after the hold (matches .g-hold-right). */
const FADE_MS = 520;
const LOCK_MS = 750;
const AUTO_ADVANCE_MS = 1600;
const DRAG_THRESHOLD = 6;

type Stage = 'ask' | 'flying' | 'hold' | 'done' | 'summary';
type TileKind = 'ok' | 'fixed';

interface Filed {
  roundId: string;
  role: RoleId;
  kind: TileKind;
}

interface Outcome {
  chosen: RoleId | null;
  correct: boolean;
  timedOut: boolean;
}

interface Geo {
  w: number;
  h: number;
  slots: Record<RoleId, Rect>;
  card: Rect;
}

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const TILE_FILL: Record<TileKind | 'wrong', string> = {
  ok: 'var(--g-green)',
  fixed: 'var(--g-gold)',
  wrong: 'var(--g-red)',
};

function lower(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** The overlay: connectors, filed tiles, the drag ghost, the phantom arc and the flying tile. */
function Overlay({
  geo,
  filed,
  pending,
  ghost,
  arc,
  flightKind,
  flyRef,
}: {
  geo: Geo;
  filed: readonly Filed[];
  pending: RoleId | null;
  ghost: Pt | null;
  arc: PhantomArc | null;
  flightKind: TileKind | 'wrong' | null;
  flyRef: { current: SVGGElement | null };
}) {
  const connectors = connectorPaths(
    geo.slots.board,
    LINE_IDS.map((id) => geo.slots[id]),
  );
  const seen: Record<RoleId, number> = { first: 0, second: 0, third: 0, board: 0 };
  const tiles = filed.map((f) => ({ f, c: tileCentre(geo.slots[f.role], seen[f.role]++) }));
  const pendingAt = pending ? tileCentre(geo.slots[pending], seen[pending]) : null;
  return (
    <svg
      className="ag-overlay"
      width={geo.w}
      height={geo.h}
      viewBox={`0 0 ${Math.max(1, geo.w)} ${Math.max(1, geo.h)}`}
      aria-hidden="true"
      focusable="false"
    >
      {connectors.map((d, i) => (
        <path key={i} d={d} className="ag-connector" />
      ))}
      {tiles.map(({ f, c }) => (
        <rect
          key={f.roundId}
          className="ag-tile"
          x={c.x - TILE / 2}
          y={c.y - TILE / 2}
          width={TILE}
          height={TILE}
          rx={2}
          style={{ fill: TILE_FILL[f.kind] }}
        />
      ))}
      {pendingAt && (
        <rect className="ag-tile ag-pending" x={pendingAt.x - TILE / 2} y={pendingAt.y - TILE / 2} width={TILE} height={TILE} rx={2} style={{ fill: TILE_FILL.wrong }} />
      )}
      {ghost && <rect className="ag-ghost" x={ghost.x - TILE / 2} y={ghost.y - TILE / 2} width={TILE} height={TILE} rx={2} />}
      {arc && (
        <g className="ag-arc">
          <path d={arc.d} />
          <polygon points={arc.head} />
        </g>
      )}
      <g
        ref={(el: SVGGElement | null) => {
          flyRef.current = el;
        }}
        style={{ visibility: flightKind ? 'visible' : 'hidden' }}
      >
        <rect width={TILE} height={TILE} rx={2} className="ag-fly" style={{ fill: TILE_FILL[flightKind ?? 'ok'] }} />
      </g>
    </svg>
  );
}

function Slot({
  role,
  armed,
  over,
  lock,
  bounce,
  pulse,
  onPlace,
  slotRef,
  wide,
}: {
  role: AgRole;
  armed: boolean;
  over: boolean;
  lock: boolean;
  bounce: boolean;
  pulse: boolean;
  onPlace: () => void;
  slotRef: (el: HTMLButtonElement | null) => void;
  wide?: boolean;
}) {
  const cls = ['ag-slot', wide ? 'is-board' : '', over ? 'is-over' : '', lock ? 'is-lock' : '', bounce ? 'is-bounce' : '', pulse ? 'is-pulse' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={slotRef}
      type="button"
      className={cls}
      onClick={armed ? onPlace : undefined}
      aria-disabled={!armed || undefined}
      aria-label={armed ? `File under ${role.label} (key ${KEY_OF[role.id]})` : role.label}
    >
      <span className="ag-slot-label">{role.label}</span>
      <span className="ag-key" aria-hidden="true">
        {KEY_OF[role.id]}
      </span>
    </button>
  );
}

/** One short rule per statement this phase: pending, current, filed first time, moved. No numbers. */
function Docket({ total, index, kinds }: { total: number; index: number; kinds: TileKind[] }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => {
        const bg = i < kinds.length ? TILE_FILL[kinds[i]] : i === index ? 'var(--g-navy)' : 'var(--g-rule)';
        return <span key={i} className="h-1 flex-1" style={{ background: bg }} />;
      })}
    </div>
  );
}

function Source({ round }: { round: Round }) {
  return (
    <p className="ag-source">
      {round.payload.item.readingId} · block <span className="ag-mono">{round.blockId}</span>
    </p>
  );
}

function Feedback({ round, outcome, phase }: { round: Round; outcome: Outcome; phase: PlayPhase }) {
  const { item, roles } = round.payload;
  const right = roles[item.role];
  if (outcome.correct) {
    return (
      <div className="ag-ok g-settle" aria-live="polite">
        <p className="ag-text">
          <span className="ag-strong">{right.label}.</span> <span className="g-serif">{item.why}</span>
        </p>
        {phase === 'discovery' && item.confusable && item.whyNot && (
          <p className="ag-text ag-muted mt-2">
            Not {lower(roles[item.confusable].label)}: {item.whyNot}
          </p>
        )}
        <Source round={round} />
      </div>
    );
  }
  const chosen = outcome.chosen ? roles[outcome.chosen] : null;
  return (
    <div className="space-y-2" style={{ '--g-hold': chosen ? `${HOLD_MS}ms` : '0ms' } as CSSProperties}>
      {chosen ? (
        <div className="g-hold-wrong ag-text">
          <p>
            <span className="ag-strong">Filed under {lower(chosen.label)}.</span>{' '}
            {chosen.responsibility ? (
              <>
                What {lower(chosen.label)} actually does: <span className="g-serif">{chosen.responsibility}</span>
              </>
            ) : null}
          </p>
          {outcome.chosen === item.confusable && item.whyNot && (
            <p className="mt-2">
              <span className="ag-strong">Why not here:</span> <span className="g-serif">{item.whyNot}</span>
            </p>
          )}
        </div>
      ) : (
        <p className="ag-text ag-muted">Time ran out.</p>
      )}
      <div className="g-hold-right ag-text" aria-live="polite">
        <p>
          <span className="ag-strong">Belongs to {lower(right.label)}.</span> <span className="g-serif">{item.why}</span>
        </p>
        <Source round={round} />
      </div>
    </div>
  );
}

/** End of phase: the grid, filled — every statement of this phase under the role it belongs to. */
function Summary({ rounds, filed, onContinue, phase }: { rounds: readonly Round[]; filed: readonly Filed[]; onContinue: () => void; phase: PlayPhase }) {
  const roles = rounds[0]?.payload.roles;
  const byId = new Map(rounds.map((r) => [r.id, r]));
  const btn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => btn.current?.focus(), []);
  if (!roles) return null;
  const order: RoleId[] = ['board', 'first', 'second', 'third'];
  return (
    <GameCard className="g-enter space-y-5">
      <div>
        <p className="ag-kicker">The grid, filed</p>
        <p className="ag-text ag-muted mt-1">Every statement from this round of play, under the desk it belongs to.</p>
      </div>
      {order.map((id) => {
        const here = filed.filter((f) => f.role === id);
        if (!here.length) return null;
        return (
          <section key={id} className="space-y-2">
            <h3 className="ag-strong ag-text">{roles[id].label}</h3>
            <ul className="space-y-2">
              {here.map((f) => {
                const r = byId.get(f.roundId);
                if (!r) return null;
                return (
                  <li key={f.roundId} className={`ag-filed ${f.kind === 'ok' ? 'is-ok' : 'is-fixed'}`}>
                    <span className="g-serif ag-text">{r.payload.item.statement}</span>
                    <span className="ag-muted ag-text block">
                      {f.kind === 'ok' ? 'Filed here first time.' : 'Moved here from another desk.'} {r.payload.item.readingId} ·{' '}
                      <span className="ag-mono">{r.blockId}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <div className="flex justify-end">
        <button ref={btn} type="button" className="g-btn is-primary" onClick={onContinue}>
          {phase === 'discovery' ? 'Continue' : 'Close the session'}
        </button>
      </div>
    </GameCard>
  );
}

export function AttributionBoard({ phase, rounds, reading, onResult, onPhaseDone }: MechanicRenderProps<AgPayload>) {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>('ask');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [filed, setFiled] = useState<Filed[]>([]);
  const [pending, setPending] = useState<RoleId | null>(null);
  const [lock, setLock] = useState<RoleId | null>(null);
  const [bounce, setBounce] = useState<RoleId | null>(null);
  const [pulse, setPulse] = useState<RoleId | null>(null);
  const [arc, setArc] = useState<PhantomArc | null>(null);
  const [flightKind, setFlightKind] = useState<TileKind | 'wrong' | null>(null);
  const [settled, setSettled] = useState(false);
  const [geo, setGeo] = useState<Geo | null>(null);
  /** Latest measured geometry, for flights already under way when the layout changes. */
  const geoRef = useRef<Geo | null>(null);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [over, setOver] = useState<RoleId | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const slotEls = useRef<Record<RoleId, HTMLButtonElement | null>>({ first: null, second: null, third: null, board: null });
  const flyRef = useRef<SVGGElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const started = useRef(performance.now());
  const busy = useRef(false);
  const alive = useRef(true);
  const timers = useRef<number[]>([]);
  const raf = useRef(0);
  const done = useRef(false);
  const dragStart = useRef<{ x: number; y: number; pointerId: number; dragging: boolean } | null>(null);

  const round: Round | undefined = rounds[index];
  const timed = phase === 'pressure';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const t of timers.current) window.clearTimeout(t);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  const finishPhase = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onPhaseDone();
  }, [onPhaseDone]);

  useEffect(() => {
    if (rounds.length === 0) finishPhase();
  }, [rounds.length, finishPhase]);

  // ---- geometry ---------------------------------------------------------------------------------
  const measure = useCallback(() => {
    const c = containerRef.current;
    const card = cardRef.current;
    if (!c || !card) return;
    const cr = c.getBoundingClientRect();
    const rel = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
    };
    const slots = {} as Record<RoleId, Rect>;
    for (const id of ['first', 'second', 'third', 'board'] as RoleId[]) {
      const el = slotEls.current[id];
      if (!el) return;
      slots[id] = rel(el);
    }
    // The card is measured by layout (offset*), so a drag transform never skews it.
    const g: Geo = { w: cr.width, h: cr.height, slots, card: { x: card.offsetLeft, y: card.offsetTop, w: card.offsetWidth, h: card.offsetHeight } };
    geoRef.current = g;
    setGeo(g);
  }, []);

  useLayoutEffect(() => {
    measure();
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(c);
    if (cardRef.current) ro.observe(cardRef.current);
    return () => ro.disconnect();
  }, [measure, stage === 'summary']);

  // ---- helpers ----------------------------------------------------------------------------------
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      timers.current.push(window.setTimeout(resolve, ms));
    });

  const fly = (from: Pt, to: Pt, ms: number, ease: (t: number) => number, ctrl?: Pt) =>
    new Promise<void>((resolve) => {
      const g = flyRef.current;
      if (!g || ms <= 0 || reducedMotion()) {
        resolve();
        return;
      }
      const t0 = performance.now();
      const place = (p: Pt) => g.setAttribute('transform', `translate(${p.x - TILE / 2} ${p.y - TILE / 2})`);
      place(from);
      const step = (now: number) => {
        if (!alive.current) return resolve();
        const t = Math.min(1, (now - t0) / ms);
        place(flightAt(from, to, ease(t), ctrl));
        if (t < 1) raf.current = requestAnimationFrame(step);
        else resolve();
      };
      raf.current = requestAnimationFrame(step);
    });

  const countIn = (role: RoleId) => filed.filter((f) => f.role === role).length;
  const cardOrigin = (g: Geo): Pt => ({ x: g.card.x + g.card.w / 2, y: g.card.y + g.card.h - 8 });

  // ---- placing ----------------------------------------------------------------------------------
  const settle = async (r: Round, o: Outcome, from: Pt | null) => {
    const { item } = r.payload;
    // Read the geometry at each step, not once: a resize or rotation mid-flight moves the slots.
    const geoNow = () => geoRef.current ?? geo;
    const g = geoNow();
    // Under reduced motion the tile never flies: it simply appears where it lands.
    const still = reducedMotion();
    const showFlight = (k: TileKind | 'wrong') => {
      if (!still) setFlightKind(k);
    };
    const origin = from ?? (g ? cardOrigin(g) : { x: 0, y: 0 });
    if (o.correct && o.chosen) {
      // Snap: a short flight with a slight overshoot, then the slot locks green.
      const dest = g ? tileCentre(g.slots[o.chosen], countIn(o.chosen)) : origin;
      showFlight('ok');
      await fly(origin, dest, from ? 240 : 360, easeOutBack);
      if (!alive.current) return;
      setFlightKind(null);
      setFiled((xs) => [...xs, { roundId: r.id, role: item.role, kind: 'ok' }]);
      setLock(item.role);
      setStage('done');
      setSettled(true);
      timers.current.push(window.setTimeout(() => alive.current && setLock(null), LOCK_MS));
      return;
    }
    const rightAt = () => {
      const gg = geoNow();
      return gg ? tileCentre(gg.slots[item.role], countIn(item.role)) : origin;
    };
    setPulse(item.role);
    let start = origin;
    if (o.chosen) {
      // Land in the wrong slot, bounce there for a beat, then travel the phantom arc.
      const wrongDest = g ? tileCentre(g.slots[o.chosen], countIn(o.chosen)) : origin;
      showFlight('wrong');
      await fly(origin, wrongDest, from ? 240 : 360, easeOutBack);
      if (!alive.current) return;
      setFlightKind(null);
      setPending(o.chosen);
      setBounce(o.chosen);
      start = wrongDest;
    }
    // The feedback panel mounts now: for a wrong slot, its hold starts as the tile lands; for a
    // timeout there is no hold and the right answer fades in while the tile travels.
    setStage('hold');
    const shownAt = performance.now();
    const hold = o.chosen ? HOLD_MS : 0;
    const a = phantomArc(start, rightAt());
    setArc(a);
    await wait(o.chosen ? HOLD_MS : 250);
    if (!alive.current) return;
    setBounce(null);
    setPending(null);
    showFlight('fixed');
    await fly(start, rightAt(), 620, easeInOutCubic, a.ctrl);
    if (!alive.current) return;
    setFlightKind(null);
    setPulse(null);
    setFiled((xs) => [...xs, { roundId: r.id, role: item.role, kind: 'fixed' }]);
    setLock(item.role);
    setStage('done');
    timers.current.push(window.setTimeout(() => alive.current && setLock(null), LOCK_MS));
    // Allow moving on only once the correction has fully faded in (hold + fade).
    await wait(Math.max(0, hold + FADE_MS - (performance.now() - shownAt)));
    if (alive.current) setSettled(true);
  };

  const answer = (o: Outcome, from: Pt | null) => {
    if (!round || busy.current || stage !== 'ask') return;
    busy.current = true;
    // A timeout can land mid-drag: drop the card back so it does not hang where the pointer was.
    endDrag();
    setOutcome(o);
    setStage('flying');
    const result: RoundResult = { roundId: round.id, correct: o.correct, timeMs: performance.now() - started.current, timedOut: o.timedOut };
    onResult(result);
    void settle(round, o, from);
  };

  const place = (role: RoleId, from: Pt | null = null) =>
    round && answer({ chosen: role, correct: role === round.payload.item.role, timedOut: false }, from);

  // Pressure clock.
  useEffect(() => {
    if (!timed || stage !== 'ask' || !round) return;
    const t = window.setTimeout(() => answer({ chosen: null, correct: false, timedOut: true }, null), round.timeLimitMs ?? 10000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, stage, timed]);

  // Keys 1–4 file the statement.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || stage !== 'ask') return;
      const role = (Object.keys(KEY_OF) as RoleId[]).find((id) => KEY_OF[id] === e.key);
      if (role) {
        e.preventDefault();
        place(role);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const next = () => {
    if (stage !== 'done') return;
    if (index + 1 < rounds.length) {
      setIndex(index + 1);
      setStage('ask');
      setOutcome(null);
      setArc(null);
      setSettled(false);
      busy.current = false;
      started.current = performance.now();
    } else {
      setArc(null);
      setStage('summary');
    }
  };

  // Settled feedback: focus Next; a correct call under pressure moves on by itself.
  useEffect(() => {
    if (stage !== 'done' || !settled) return;
    const btn = nextRef.current;
    btn?.focus({ preventScroll: true });
    // At phone width the feedback can sit below the fold: bring it into view without jumping.
    btn?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    if (timed && outcome?.correct) {
      const t = window.setTimeout(next, AUTO_ADVANCE_MS);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, settled]);

  // A new statement is announced and focusable, without scrolling the page.
  useEffect(() => {
    if (stage === 'ask') cardRef.current?.focus({ preventScroll: true });
  }, [index, stage]);

  // ---- dragging ---------------------------------------------------------------------------------
  const local = (clientX: number, clientY: number): Pt | null => {
    const c = containerRef.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stage !== 'ask') return;
    dragStart.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    s.dragging = true;
    setDrag({ dx, dy });
    const p = local(e.clientX, e.clientY);
    const hit = p && geo ? slotAt(geo.slots, p) : null;
    if (hit !== over) setOver(hit);
  };
  const endDrag = () => {
    dragStart.current = null;
    setDrag(null);
    setOver(null);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const p = local(e.clientX, e.clientY);
    const hit = s.dragging && p && geo ? slotAt(geo.slots, p) : null;
    endDrag();
    if (hit && p) place(hit, p);
  };

  if (stage === 'summary') {
    return (
      <div className="space-y-5">
        <Docket total={rounds.length} index={rounds.length} kinds={filed.map((f) => f.kind)} />
        <Summary rounds={rounds} filed={filed} phase={phase} onContinue={finishPhase} />
      </div>
    );
  }
  if (!round) return null;

  const { item, roles, topUp } = round.payload;
  const armed = stage === 'ask';
  const topUps = [...new Set(rounds.filter((r) => r.payload.topUp).map((r) => r.payload.item.readingId))];
  const ghost = over && geo ? tileCentre(geo.slots[over], countIn(over)) : null;
  const slotProps = (id: RoleId) => ({
    role: roles[id],
    armed,
    over: over === id,
    lock: lock === id,
    bounce: bounce === id,
    pulse: pulse === id,
    onPlace: () => place(id),
    slotRef: (el: HTMLButtonElement | null) => {
      slotEls.current[id] = el;
    },
  });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="ag-kicker">{phase === 'discovery' ? 'Whose job is this?' : 'Whose job is this? Under pressure'}</p>
        {topUps.length > 0 && (
          <p className="ag-text ag-muted">
            {reading.reading_id} has few statements about who does what, so some here come from {topUps.join(', ')} in the same area. Each one is marked.
          </p>
        )}
      </div>
      <Docket total={rounds.length} index={index} kinds={filed.map((f) => f.kind)} />
      {timed && stage === 'ask' && <TimerBar key={index} ms={round.timeLimitMs ?? 10000} />}

      <div ref={containerRef} className="ag-board">
        <div
          ref={cardRef}
          tabIndex={-1}
          role="group"
          aria-roledescription="statement"
          aria-live="polite"
          aria-label={`Statement: ${item.statement}`}
          className={`ag-card g-enter${drag ? ' is-lifted' : ''}${armed ? ' is-armed' : ''}`}
          style={drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(1.03) rotate(-0.6deg)` } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={endDrag}
          key={round.id}
        >
          {topUp && <span className="ag-chip">from {item.readingId}</span>}
          <p className="g-reading ag-statement">{item.statement}</p>
        </div>
        {/* Hidden rather than emptied once answered, so the slots below never shift mid-flight. */}
        <p className="ag-text ag-muted ag-hint" style={{ visibility: armed ? 'visible' : 'hidden' }} aria-hidden={!armed || undefined}>
          Drag the statement onto the desk whose job it is, or tap the desk.
          <span className="ag-keyhint"> Keys 1 to 4.</span>
        </p>

        <div className="ag-grid">
          <Slot {...slotProps('board')} wide />
          <div className="ag-lines">
            {LINE_IDS.map((id) => (
              <Slot key={id} {...slotProps(id)} />
            ))}
          </div>
        </div>

        {geo && <Overlay geo={geo} filed={filed} pending={pending} ghost={ghost} arc={arc} flightKind={flightKind} flyRef={flyRef} />}
      </div>

      <div className="ag-legend" aria-hidden="true">
        <span>
          <svg width="15" height="15" viewBox="0 0 15 15">
            <rect x="0.5" y="0.5" width="14" height="14" rx="2" style={{ fill: TILE_FILL.ok }} />
          </svg>
          filed first time
        </span>
        <span>
          <svg width="15" height="15" viewBox="0 0 15 15">
            <rect x="0.5" y="0.5" width="14" height="14" rx="2" style={{ fill: TILE_FILL.fixed }} />
          </svg>
          moved to the right desk
        </span>
      </div>

      {outcome && stage !== 'flying' && (
        <GameCard className="space-y-4">
          <Feedback round={round} outcome={outcome} phase={phase} />
          {stage === 'done' && (
            <div className="flex justify-end">
              <button ref={nextRef} type="button" className="g-btn is-primary" onClick={next} disabled={!settled}>
                {index + 1 < rounds.length ? 'Next statement' : 'See the grid'}
              </button>
            </div>
          )}
        </GameCard>
      )}
    </div>
  );
}
