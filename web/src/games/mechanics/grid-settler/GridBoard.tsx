// Grid Settler board. A two-axis grid from the notes sits above a tray of tiles. The player drags
// a tile onto a cell (mouse, pen or touch; a drop in the gutter snaps to the nearest cell), or taps
// a tile and then a cell; every cell is a button, so the keyboard works the same way.
//
// - Right cell: the tile snaps in (a short flight with a slight overshoot) and the cell locks green.
// - Wrong cell: the tile lands, the cell bounces, and after a beat (~800 ms) the tile bounces back
//   to the tray while the right cell pulses. A dashed phantom arc runs from the tile to the right
//   cell, the correction fades in with its source block, and the player settles the tile there.
// - Time out (pressure): the tile travels the phantom arc to its cell on its own.
// - Full grid: cells shade by how many tiles they hold, empty cells hatch, marginal bars rise along
//   the bottom and right edges, and the pattern from the notes appears as the grid's caption.
//
// Flights run on requestAnimationFrame and are skipped under reduced motion. The overlay SVG uses
// the board's own pixel size as its viewBox, so nothing drawn in it is ever scaled.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { MechanicRenderProps, MechanicRound } from '../../arc/plugin';
import { GameCard, TimerBar } from '../../theme/primitives';
import type { GsPayload, PresetKind } from './build';
import type { GsGrid, GsTile } from './schema';
import type { Pt, Rect } from './maths';
import {
  bands,
  cellCounts,
  cellKey,
  centre,
  easeInOutCubic,
  easeOutBack,
  flightOffset,
  frameOf,
  heat,
  marginalBars,
  marginals,
  phantomArc,
  snapCell,
} from './maths';
import './grid-settler.css';

type Round = MechanicRound<GsPayload>;
type Kind = PresetKind | 'ok' | 'fixed';
type Stage = 'ask' | 'flying' | 'hold' | 'fix' | 'done' | 'end';

/** The beat a wrong tile sits in the wrong cell (§10.3). */
const HOLD_MS = 800;
/** The correction's fade-in after the hold (matches .g-hold-right). */
const FADE_MS = 520;
const LOCK_MS = 700;
const SNAP_MS = 300;
const BACK_MS = 420;
const ARC_MS = 680;
/** A right call under pressure moves on by itself after this beat. */
const AUTO_ADVANCE_MS = 1100;
const DRAG_THRESHOLD = 6;
/** Room kept along the bottom and right of the cells for the reveal's marginal bars. */
const BAR_DEPTH = 18;

interface Flight {
  from: Pt;
  ctrl?: Pt;
  ms: number;
  ease: 'back' | 'inout';
  at: number;
}
type Flights = MutableRefObject<Map<string, Flight>>;

interface Feedback {
  roundId: string;
  kind: 'ok' | 'wrong' | 'timeout' | 'fixed';
  chosen: string | null;
}

interface Geo {
  w: number;
  h: number;
  cells: Record<string, Rect>;
  cards: Record<string, Rect>;
}

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Flies an element in from `flights[key]` when it mounts (or the key changes): it starts where the
 * flight began and eases to its resting place. Under reduced motion it simply appears.
 */
function useFlyIn(ref: MutableRefObject<HTMLElement | null>, key: string, flights: Flights) {
  useLayoutEffect(() => {
    const el = ref.current;
    const f = flights.current.get(key);
    // A flight is for the mount it was set up for; a stale one (older than a second) is dropped.
    if (!el || !f || performance.now() - f.at > 1000) return;
    if (reducedMotion()) {
      flights.current.delete(key);
      return;
    }
    const r = el.getBoundingClientRect();
    const to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const ease = f.ease === 'back' ? easeOutBack : easeInOutCubic;
    const lift = el.closest<HTMLElement>('.gs-cell') ?? el;
    const t0 = performance.now();
    let raf = 0;
    const put = (e: number) => {
      const o = flightOffset(f.from, to, e, f.ctrl);
      el.style.transform = `translate(${o.x}px, ${o.y}px)`;
    };
    const clear = () => {
      el.style.transform = '';
      el.style.transition = '';
      lift.style.zIndex = '';
    };
    // The flight owns the transform: no CSS transition may smooth it.
    el.style.transition = 'none';
    lift.style.zIndex = '20';
    put(0);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / f.ms);
      put(ease(t));
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        flights.current.delete(key);
        clear();
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

function Chip({ tile, kind, flights, flightKey }: { tile: GsTile; kind: Kind | 'wrong'; flights: Flights; flightKey: string }) {
  const ref = useRef<HTMLElement | null>(null);
  useFlyIn(ref, flightKey, flights);
  return (
    <span
      ref={(el: HTMLSpanElement | null) => {
        ref.current = el;
      }}
      className={`gs-chip is-${kind}`}
    >
      {tile.text}
    </span>
  );
}

function TrayCard({
  round,
  selected,
  draggable,
  lifted,
  drag,
  flights,
  cardRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onSelect,
}: {
  round: Round;
  selected: boolean;
  draggable: boolean;
  lifted: boolean;
  drag: { dx: number; dy: number } | null;
  flights: Flights;
  cardRef: (el: HTMLDivElement | null) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useFlyIn(ref, `card:${round.id}`, flights);
  const cls = ['gs-card', selected ? 'is-selected' : '', draggable ? 'is-armed' : 'is-idle', lifted ? 'is-lifted' : ''].filter(Boolean).join(' ');
  return (
    <div
      ref={(el: HTMLDivElement | null) => {
        ref.current = el;
        cardRef(el);
      }}
      role="button"
      tabIndex={draggable ? 0 : -1}
      aria-pressed={selected}
      aria-disabled={!draggable || undefined}
      aria-label={`Tile: ${round.payload.tile.text}${selected ? ' (picked up; now choose a cell)' : ''}`}
      className={cls}
      style={drag ? ({ transform: `translate(${drag.dx}px, ${drag.dy}px) scale(1.035) rotate(-0.6deg)` } as CSSProperties) : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!draggable) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {round.payload.tile.text}
    </div>
  );
}

/** One short rule per tile this phase: settled first time, corrected, current, still to come. No numbers. */
function Docket({ rounds, outcome, current }: { rounds: readonly Round[]; outcome: Record<string, Kind>; current: string | null }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {rounds.map((r) => {
        const k = outcome[r.id];
        const bg = k === 'ok' ? 'var(--g-green)' : k === 'fixed' ? 'var(--g-gold)' : r.id === current ? 'var(--g-navy)' : 'var(--g-rule)';
        return <span key={r.id} className="h-1 flex-1" style={{ background: bg }} />;
      })}
    </div>
  );
}

function cellName(grid: GsGrid, x: number, y: number): string {
  return `${grid.x.values[x]} · ${grid.y.values[y]}`;
}

function Source({ grid, blockId }: { grid: GsGrid; blockId: string }) {
  return (
    <p className="gs-source">
      {grid.readingId} · block <span className="gs-mono">{blockId}</span>
    </p>
  );
}

function FeedbackPanel({ fb, round, children }: { fb: Feedback; round: Round; children?: ReactNode }) {
  const { grid, tile } = round.payload;
  const right = cellName(grid, tile.x, tile.y);
  if (fb.kind === 'ok' || fb.kind === 'fixed') {
    return (
      <GameCard className="g-settle space-y-3">
        <div className={fb.kind === 'ok' ? 'gs-ok' : 'gs-fixed'} aria-live="polite">
          <p className="gs-text">
            <span className="gs-strong">{fb.kind === 'ok' ? 'Locked' : 'Settled'}: {right}.</span> <span className="g-serif">{tile.why}</span>
          </p>
          <Source grid={grid} blockId={round.blockId} />
        </div>
        {children}
      </GameCard>
    );
  }
  const [cx, cy] = (fb.chosen ?? '').split(',').map(Number);
  const wrong = fb.chosen ? cellName(grid, cx, cy) : null;
  return (
    <GameCard className="space-y-3">
      <div className="space-y-2" style={{ '--g-hold': wrong ? `${HOLD_MS}ms` : '0ms' } as CSSProperties}>
        {wrong ? (
          <p className="g-hold-wrong gs-text">
            <span className="gs-strong">Not {wrong}.</span> “{tile.text}” is not a {grid.x.label.toLowerCase()} of {grid.x.values[cx]} with {grid.y.label.toLowerCase()}{' '}
            {grid.y.values[cy]}.
          </p>
        ) : (
          <p className="gs-text gs-muted">Time ran out.</p>
        )}
        <div className="g-hold-right gs-text" aria-live="polite">
          <p>
            <span className="gs-strong">It belongs at {right}.</span> <span className="g-serif">{tile.why}</span>
          </p>
          <Source grid={grid} blockId={round.blockId} />
        </div>
      </div>
      {children}
    </GameCard>
  );
}

export function GridBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<GsPayload>) {
  const grid: GsGrid | undefined = rounds[0]?.payload.grid;
  const completes = rounds[0]?.payload.completes ?? true;
  const timed = phase === 'pressure';
  const nx = grid?.x.values.length ?? 0;
  const ny = grid?.y.values.length ?? 0;

  const [placed, setPlaced] = useState<Record<string, Kind>>(() => {
    const out: Record<string, Kind> = {};
    for (const p of rounds[0]?.payload.preset ?? []) out[p.tileId] = p.kind;
    return out;
  });
  /** Outcome per round id, once settled. */
  const [outcome, setOutcome] = useState<Record<string, Kind>>({});
  const [answered, setAnswered] = useState<Record<string, true>>({});
  const [selected, setSelected] = useState<string | null>(rounds[0]?.id ?? null);
  const [stage, setStage] = useState<Stage>('ask');
  const [fb, setFb] = useState<Feedback | null>(null);
  const [wrongChip, setWrongChip] = useState<{ roundId: string; cell: string } | null>(null);
  const [lockCell, setLockCell] = useState<string | null>(null);
  const [bounceCell, setBounceCell] = useState<string | null>(null);
  const [pulseCell, setPulseCell] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [drag, setDrag] = useState<{ roundId: string; dx: number; dy: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cellEls = useRef<Record<string, HTMLButtonElement | null>>({});
  const cardEls = useRef<Record<string, HTMLDivElement | null>>({});
  const wrongEl = useRef<HTMLSpanElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const endRef = useRef<HTMLButtonElement | null>(null);
  const flights = useRef(new Map<string, Flight>());
  const started = useRef(performance.now());
  const alive = useRef(true);
  const timers = useRef<number[]>([]);
  const done = useRef(false);
  const dragStart = useRef<{ roundId: string; x: number; y: number; pointerId: number; dragging: boolean } | null>(null);

  const roundById = useMemo(() => new Map(rounds.map((r) => [r.id, r])), [rounds]);
  const current = selected ? roundById.get(selected) : undefined;
  const unanswered = rounds.filter((r) => !outcome[r.id]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const t of timers.current) window.clearTimeout(t);
    };
  }, []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(
      window.setTimeout(() => {
        if (alive.current) fn();
      }, ms),
    );
  };

  const finishPhase = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onPhaseDone();
  }, [onPhaseDone]);

  useEffect(() => {
    if (rounds.length === 0 || !grid) finishPhase();
  }, [rounds.length, grid, finishPhase]);

  // ---- geometry ---------------------------------------------------------------------------------
  const measure = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const cr = c.getBoundingClientRect();
    const rel = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
    };
    // Cells and cards are measured by layout box (the board is their offset parent), so a bounce,
    // a drag or a flight transform never skews the geometry.
    const box = (el: HTMLElement): Rect =>
      el.offsetParent === c ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : rel(el);
    const cells: Record<string, Rect> = {};
    for (const [k, el] of Object.entries(cellEls.current)) if (el) cells[k] = box(el);
    const cards: Record<string, Rect> = {};
    for (const [k, el] of Object.entries(cardEls.current)) if (el) cards[k] = box(el);
    setGeo({ w: cr.width, h: cr.height, cells, cards });
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
    return () => ro.disconnect();
  }, [measure]);

  // Chips and cards change the layout without resizing the container's width: measure again.
  useLayoutEffect(() => {
    measure();
  }, [measure, placed, wrongChip, stage, answered, selected]);

  // ---- placing ----------------------------------------------------------------------------------
  const clientCentreOfCard = (roundId: string): Pt | null => {
    const el = cardEls.current[roundId];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const containerOrigin = (): Pt => {
    const r = containerRef.current?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: r?.top ?? 0 };
  };

  const settleInto = (r: Round, kind: 'ok' | 'fixed', flight: Omit<Flight, 'at'> | null) => {
    const { tile } = r.payload;
    const key = cellKey(tile.x, tile.y);
    if (flight) flights.current.set(`chip:${tile.id}`, { ...flight, at: performance.now() });
    setPlaced((p) => ({ ...p, [tile.id]: kind }));
    setOutcome((o) => ({ ...o, [r.id]: kind }));
    setPulseCell(null);
    setLockCell(key);
    later(() => setLockCell((c) => (c === key ? null : c)), LOCK_MS);
  };

  /** Next tile: the next unsettled one (pressure keeps the planned order), or the end of the phase. */
  const advance = (justSettled: string) => {
    const left = rounds.filter((r) => !outcome[r.id] && r.id !== justSettled);
    setDrag(null);
    setOver(null);
    setSettled(false);
    if (left.length === 0) {
      setSelected(null);
      setStage('end');
      return;
    }
    setSelected(left[0].id);
    setStage('ask');
    started.current = performance.now();
  };

  const answer = (r: Round, cell: string | null, from: Pt | null, timedOut = false) => {
    if (answered[r.id]) return;
    const { tile } = r.payload;
    const right = cellKey(tile.x, tile.y);
    const correct = cell === right;
    setAnswered((a) => ({ ...a, [r.id]: true }));
    onResult({ roundId: r.id, correct, timeMs: performance.now() - started.current, timedOut });
    const origin = from ?? clientCentreOfCard(r.id);
    if (correct) {
      setFb({ roundId: r.id, kind: 'ok', chosen: cell });
      settleInto(r, 'ok', origin ? { from: origin, ms: SNAP_MS, ease: 'back' } : null);
      if (timed) {
        // A beat to see the lock, then the next tile (or skip it with Next).
        setStage('done');
        setSettled(true);
      } else {
        advance(r.id);
      }
      return;
    }
    setPulseCell(right);
    if (cell) {
      // Land in the wrong cell, bounce there for a beat, then bounce back to the tray.
      if (origin) flights.current.set(`wrong:${tile.id}`, { from: origin, ms: SNAP_MS, ease: 'back', at: performance.now() });
      setWrongChip({ roundId: r.id, cell });
      setBounceCell(cell);
      setFb({ roundId: r.id, kind: 'wrong', chosen: cell });
      setStage('hold');
      later(() => {
        const w = wrongEl.current?.getBoundingClientRect();
        if (w) flights.current.set(`card:${r.id}`, { from: { x: w.left + w.width / 2, y: w.top + w.height / 2 }, ms: BACK_MS, ease: 'back', at: performance.now() });
        setWrongChip(null);
        setBounceCell(null);
        setStage('fix');
      }, HOLD_MS);
      later(() => setSettled(true), HOLD_MS + FADE_MS);
      return;
    }
    // Timed out: the tile travels the phantom arc to its cell by itself.
    setFb({ roundId: r.id, kind: 'timeout', chosen: null });
    const g = geo;
    const start = origin;
    const o = containerOrigin();
    const target = g?.cells[right];
    const ctrl =
      start && target
        ? (() => {
            const a = phantomArc({ x: start.x - o.x, y: start.y - o.y }, centre(target));
            return { x: a.ctrl.x + o.x, y: a.ctrl.y + o.y };
          })()
        : undefined;
    setStage('flying');
    settleInto(r, 'fixed', start ? { from: start, ctrl, ms: ARC_MS, ease: 'inout' } : null);
    later(() => {
      setStage('done');
      setSettled(true);
    }, ARC_MS);
  };

  /** A placement: the first one is graded; during a correction only the right cell takes the tile. */
  const place = (roundId: string, cell: string, from: Pt | null = null) => {
    const r = roundById.get(roundId);
    if (!r) return;
    if (stage === 'ask' && !answered[r.id]) {
      answer(r, cell, from);
      return;
    }
    if (stage === 'fix' && fb?.roundId === r.id) {
      const right = cellKey(r.payload.tile.x, r.payload.tile.y);
      if (cell !== right) {
        // Only the pulsing cell takes it now; any other cell shrugs it off.
        setBounceCell(cell);
        later(() => setBounceCell((c) => (c === cell ? null : c)), 620);
        return;
      }
      const origin = from ?? clientCentreOfCard(r.id);
      settleInto(r, 'fixed', origin ? { from: origin, ms: SNAP_MS, ease: 'back' } : null);
      setFb({ roundId: r.id, kind: 'fixed', chosen: fb.chosen });
      advance(r.id);
    }
  };

  // Pressure clock: one tile at a time.
  useEffect(() => {
    if (!timed || stage !== 'ask' || !current) return;
    const r = current;
    const t = window.setTimeout(() => {
      endDrag();
      answer(r, null, null, true);
    }, r.timeLimitMs ?? 12000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, stage, timed]);

  // A right call under pressure moves on by itself.
  useEffect(() => {
    if (!timed || stage !== 'done' || fb?.kind !== 'ok') return;
    const t = window.setTimeout(() => advance(fb.roundId), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, fb]);

  // Focus follows the play: the tile in hand, the pulsing cell during a correction, Next, Continue.
  useEffect(() => {
    if (stage === 'ask' && selected) cardEls.current[selected]?.focus({ preventScroll: true });
    if (stage === 'fix' && pulseCell) cellEls.current[pulseCell]?.focus({ preventScroll: true });
    if (stage === 'done' && settled) nextRef.current?.focus({ preventScroll: true });
    if (stage === 'end') {
      const b = endRef.current;
      b?.focus({ preventScroll: true });
      b?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }, [stage, selected, settled, pulseCell]);

  // ---- dragging ---------------------------------------------------------------------------------
  const local = (clientX: number, clientY: number): Pt | null => {
    const c = containerRef.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const canHold = (roundId: string) =>
    (stage === 'ask' && !answered[roundId] && (!timed || roundId === selected)) || (stage === 'fix' && fb?.roundId === roundId);

  const endDrag = () => {
    dragStart.current = null;
    setDrag(null);
    setOver(null);
  };
  const pointerHandlers = (roundId: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!canHold(roundId)) return;
      dragStart.current = { roundId, x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = dragStart.current;
      if (!s || s.pointerId !== e.pointerId || s.roundId !== roundId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!s.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!s.dragging && selected !== roundId && stage === 'ask') setSelected(roundId);
      s.dragging = true;
      setDrag({ roundId, dx, dy });
      const p = local(e.clientX, e.clientY);
      const hit = p && geo ? snapCell(geo.cells, p) : null;
      if (hit !== over) setOver(hit);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = dragStart.current;
      if (!s || s.pointerId !== e.pointerId || s.roundId !== roundId) return;
      const p = local(e.clientX, e.clientY);
      const hit = s.dragging && p && geo ? snapCell(geo.cells, p) : null;
      const wasDrag = s.dragging;
      endDrag();
      if (hit) place(roundId, hit, { x: e.clientX, y: e.clientY });
      // A tap picks the tile up (discovery lets you choose which tile to settle next).
      else if (!wasDrag && stage === 'ask') setSelected(roundId);
    },
    onPointerCancel: endDrag,
  });

  if (!grid) return null;

  // ---- render -------------------------------------------------------------------------------------
  const full = grid.tiles.every((t) => placed[t.id]);
  const reveal = stage === 'end' && completes && full;
  const placedTiles = grid.tiles.filter((t) => placed[t.id]);
  const counts = cellCounts(placedTiles, nx, ny);
  const heats = heat(counts);
  const armedCells = stage === 'ask' ? !!selected && !answered[selected] : stage === 'fix';
  const trayRounds =
    stage === 'end'
      ? []
      : rounds.filter(
          (r) =>
            !outcome[r.id] &&
            wrongChip?.roundId !== r.id &&
            // Pressure shows only the tile in hand (or the one being corrected).
            (!timed || r.id === selected || (stage === 'fix' && fb?.roundId === r.id)),
        );
  const handRound = stage === 'fix' && fb ? roundById.get(fb.roundId) : current;

  // Overlay geometry: phantom arc during a correction, the drag ghost, the reveal's marginal bars.
  let arc: ReturnType<typeof phantomArc> | null = null;
  if (geo && stage === 'fix' && fb) {
    const r = roundById.get(fb.roundId);
    const card = geo.cards[fb.roundId];
    const target = r ? geo.cells[cellKey(r.payload.tile.x, r.payload.tile.y)] : undefined;
    if (card && target) arc = phantomArc({ x: card.x + card.w / 2, y: card.y }, centre(target), { gap: 8 });
  }
  const frame = geo ? frameOf(geo.cells) : null;
  const band = geo ? bands(geo.cells, nx, ny) : null;
  const bars = reveal && frame && band ? marginalBars(band.cols, band.rows, marginals(counts), frame, BAR_DEPTH) : null;

  const cellLabel = (x: number, y: number) => {
    const name = `${grid.x.label}: ${grid.x.values[x]}; ${grid.y.label}: ${grid.y.values[y]}`;
    const inHand = handRound?.payload.tile.text;
    return armedCells && inHand ? `Place “${inHand}” at ${name}` : name;
  };

  const cellOrder: { x: number; y: number }[] = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) cellOrder.push({ x, y });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="gs-kicker">{timed ? 'Settle each tile. Under pressure' : 'Settle each tile'}</p>
        <h2 className="gs-title">{grid.title}</h2>
      </div>
      <Docket rounds={rounds} outcome={outcome} current={stage === 'end' ? null : (fb && stage !== 'ask' ? fb.roundId : selected)} />
      {timed && stage === 'ask' && current && <TimerBar key={current.id} ms={current.timeLimitMs ?? 12000} />}

      <div ref={containerRef} className={`gs-board${reveal ? ' is-reveal' : ''}`} style={{ '--gs-nx': nx, '--gs-bar': `${BAR_DEPTH + 8}px` } as CSSProperties}>
        <p className="gs-axis">
          <span className="gs-axis-key">Across</span> {grid.x.label}
          <span className="gs-axis-sep" aria-hidden="true">
            {' '}
            ·{' '}
          </span>
          <span className="gs-axis-key">Down</span> {grid.y.label}
        </p>
        <div className="gs-grid" role="group" aria-label={`${grid.title}: ${grid.x.label} across, ${grid.y.label} down`}>
          <div className="gs-corner" aria-hidden="true" />
          {grid.x.values.map((v, x) => (
            <div key={`h${x}`} className="gs-colhead">
              {v}
            </div>
          ))}
          {grid.y.values.map((yv, y) => (
            <div key={`r${y}`} className="gs-row">
              <div className="gs-rowhead">
                {yv}
              </div>
              {grid.x.values.map((_, x) => {
                const k = cellKey(x, y);
                const here = grid.tiles.filter((t) => placed[t.id] && t.x === x && t.y === y);
                const wrongHere = wrongChip && wrongChip.cell === k ? roundById.get(wrongChip.roundId) : undefined;
                const cls = [
                  'gs-cell',
                  armedCells ? 'is-armed' : '',
                  over === k ? 'is-over' : '',
                  lockCell === k ? 'is-lock' : '',
                  bounceCell === k ? 'is-bounce' : '',
                  pulseCell === k ? 'is-pulse' : '',
                  reveal && counts[y][x] === 0 ? 'is-empty' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={k}
                    ref={(el: HTMLButtonElement | null) => {
                      cellEls.current[k] = el;
                    }}
                    type="button"
                    className={cls}
                    style={{ '--gs-heat': heats[y][x], '--gs-i': y * nx + x } as CSSProperties}
                    aria-disabled={!armedCells || undefined}
                    aria-label={cellLabel(x, y)}
                    onClick={() => {
                      if (!armedCells) return;
                      const id = stage === 'fix' ? fb?.roundId : selected;
                      if (id) place(id, k);
                    }}
                  >
                    {here.map((t) => (
                      <Chip key={t.id} tile={t} kind={placed[t.id]} flights={flights} flightKey={`chip:${t.id}`} />
                    ))}
                    {wrongHere && (
                      <span
                        ref={(el: HTMLSpanElement | null) => {
                          wrongEl.current = el;
                        }}
                        className="gs-wrong-wrap"
                      >
                        <Chip tile={wrongHere.payload.tile} kind="wrong" flights={flights} flightKey={`wrong:${wrongHere.payload.tile.id}`} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {stage !== 'end' && (
          <div className="gs-tray">
            <p className="gs-text gs-muted gs-hint">
              {stage === 'fix'
                ? 'Now settle it in the pulsing cell: drag it there, or tap the cell.'
                : timed
                  ? 'Drag the tile onto its cell, or tap the cell.'
                  : 'Pick up any tile: drag it onto its cell, or tap it and then tap the cell.'}
            </p>
            <div className="gs-cards">
              {trayRounds.map((r) => (
                <TrayCard
                  key={r.id}
                  round={r}
                  selected={(stage === 'fix' ? fb?.roundId : selected) === r.id}
                  draggable={canHold(r.id)}
                  lifted={drag?.roundId === r.id}
                  drag={drag?.roundId === r.id ? drag : null}
                  flights={flights}
                  cardRef={(el) => {
                    cardEls.current[r.id] = el;
                  }}
                  {...pointerHandlers(r.id)}
                  onSelect={() => {
                    if (stage === 'ask' && !answered[r.id]) setSelected(r.id);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {geo && (
          <svg className="gs-overlay" width={geo.w} height={geo.h} viewBox={`0 0 ${Math.max(1, geo.w)} ${Math.max(1, geo.h)}`} aria-hidden="true" focusable="false">
            {bars && (
              <g className="gs-bars">
                {bars.cols.map((b, i) => (
                  <rect key={`c${i}`} className="gs-bar is-col" x={b.x} y={b.y} width={b.w} height={Math.max(0, b.h)} style={{ '--gs-i': i } as CSSProperties} />
                ))}
                {bars.rows.map((b, i) => (
                  <rect key={`r${i}`} className="gs-bar is-row" x={b.x} y={b.y} width={Math.max(0, b.w)} height={b.h} style={{ '--gs-i': i } as CSSProperties} />
                ))}
              </g>
            )}
            {arc && (
              <g className="gs-arc">
                <path d={arc.d} />
                <polygon points={arc.head} />
              </g>
            )}
          </svg>
        )}
      </div>

      <div className="gs-legend" aria-hidden="true">
        <span>
          <i className="gs-swatch is-ok" /> settled first time
        </span>
        <span>
          <i className="gs-swatch is-fixed" /> settled after a correction
        </span>
        {grid.tiles.some((t) => placed[t.id] === 'given') && (
          <span>
            <i className="gs-swatch is-given" /> placed from the notes
          </span>
        )}
        {grid.tiles.some((t) => placed[t.id] === 'earlier') && (
          <span>
            <i className="gs-swatch is-earlier" /> settled before the pause
          </span>
        )}
      </div>

      {fb && stage !== 'end' && stage !== 'flying' && (() => {
        const r = roundById.get(fb.roundId);
        if (!r) return null;
        return (
          <FeedbackPanel key={`${fb.roundId}:${fb.kind}`} fb={fb} round={r}>
            {stage === 'done' && (
              <div className="flex justify-end">
                <button ref={nextRef} type="button" className="g-btn is-primary" disabled={!settled} onClick={() => advance(fb.roundId)}>
                  {unanswered.filter((u) => u.id !== fb.roundId).length ? 'Next tile' : 'See the grid'}
                </button>
              </div>
            )}
          </FeedbackPanel>
        );
      })()}

      {stage === 'end' && (
        <GameCard className="g-enter space-y-4">
          {reveal ? (
            <>
              <p className="gs-kicker">What the full grid shows</p>
              <p className="g-reading g-assemble">{grid.pattern}</p>
              {grid.explanation && <p className="gs-text gs-muted g-serif">{grid.explanation}</p>}
              <p className="gs-text gs-muted">Shading marks how many tiles each cell holds; the bars along the bottom and right edge total each column and row.</p>
              <Source grid={grid} blockId={grid.sourceBlock} />
            </>
          ) : (
            <>
              <p className="gs-kicker">The grid so far</p>
              <p className="gs-text">The rest of this grid is settled after a short pause to name what you have been sorting. Its pattern shows only once every cell has its tiles.</p>
            </>
          )}
          <div className="flex justify-end">
            <button ref={endRef} type="button" className="g-btn is-primary" onClick={finishPhase}>
              {phase === 'discovery' ? 'Continue' : 'Close the session'}
            </button>
          </div>
        </GameCard>
      )}
    </div>
  );
}
