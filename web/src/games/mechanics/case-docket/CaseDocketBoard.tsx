// Case Docket board. Discovery: one case on the docket and a tray of fact chips, untimed; each chip
// is filed under "This case" or "Not this case". Pressure: two cases share the bench; chips are
// dealt one at a time against a draining clock and routed to the case they belong to.
//
// Every chip has its own route buttons (tap, or Tab + Enter); keys T / N (docket) or 1 / 2 and the
// arrow keys (bench) route the chip in focus, else the next one. Mouse and pen can also drag a chip
// onto a lane; touch uses the buttons so the page still scrolls. A wrong filing holds in the wrong
// lane for a beat, then the chip moves to the right one with its case named and its source block.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { MechanicRenderProps, MechanicRound } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import type { DocketCase, DocketPayload } from './build';
import { MASK } from './cases';
import { GameCard, NoteText, TimerBar } from '../../theme/primitives';
import './case-docket.css';

type Round = MechanicRound<DocketPayload>;

/** The beat a wrong chip holds in the wrong lane before it moves (§10.3). */
const HOLD_MS = 800;
/** Pause after a correct filing under pressure before the next chip is dealt. */
const COOLDOWN_MS = 650;
const DRAG_THRESHOLD = 6;

interface Lane {
  id: string;
  label: string;
  sub?: string;
  keys: string[];
  keyHint: string;
}

interface Placement {
  /** Lane the chip ends up in (always the right one once settled). */
  lane: string;
  /** Lane the player chose; null when the clock ran out. */
  chosen: string | null;
  correct: boolean;
}

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** The fact with its case's name redacted, or (revealed) restored and marked. */
function Fact({ p, revealed }: { p: DocketPayload; revealed: boolean }) {
  const parts = p.masked.split(MASK);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part) out.push(<NoteText key={`t${i}`} latex={part} />);
    if (i < parts.length - 1) {
      out.push(
        revealed ? (
          <mark key={`n${i}`} className="cd-name">
            {p.names[i] ?? p.ownerName}
          </mark>
        ) : (
          <span key={`m${i}`} className="cd-redact" role="img" aria-label="name withheld" />
        ),
      );
    }
  });
  return <p className="cd-fact">{out}</p>;
}

function lanesFor(phase: PlayPhase, cases: DocketCase[]): Lane[] {
  if (phase === 'discovery' || cases.length < 2) {
    return [
      { id: 'this', label: 'This case', sub: cases[0]?.name, keys: ['t', '1', 'arrowleft'], keyHint: 'T' },
      { id: 'not', label: 'Not this case', sub: 'from another file', keys: ['n', '2', 'arrowright'], keyHint: 'N' },
    ];
  }
  return [
    { id: cases[0].id, label: cases[0].name, keys: ['1', 'arrowleft'], keyHint: '1' },
    { id: cases[1].id, label: cases[1].name, keys: ['2', 'arrowright'], keyHint: '2' },
  ];
}

/** One short rule per chip this phase: pending, current, filed right, filed wrong. No numbers. */
function Rules({ rounds, placed, current }: { rounds: Round[]; placed: Record<string, Placement>; current: string | null }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {rounds.map((r) => {
        const p = placed[r.id];
        const bg = p ? (p.correct ? 'var(--g-green)' : 'var(--g-red)') : r.id === current ? 'var(--g-gold)' : 'var(--g-rule)';
        return <span key={r.id} className="h-1 flex-1" style={{ background: bg }} />;
      })}
    </div>
  );
}

function CaseCards({ phase, cases }: { phase: PlayPhase; cases: DocketCase[] }) {
  const shown = phase === 'discovery' ? cases.slice(0, 1) : cases.slice(0, 2);
  return (
    <div className={`grid gap-3 ${shown.length > 1 ? 'grid-cols-2' : ''}`}>
      {shown.map((c) => (
        <GameCard key={c.id} tone="soft" className="cd-case space-y-1">
          <div className="cd-label">{phase === 'discovery' ? 'On the docket' : 'On the bench'}</div>
          <h2 className="cd-case-name">{c.name}</h2>
          {c.citedIn.length > 0 && <p className="cd-small">Cited in {c.citedIn.join(' · ')}</p>}
        </GameCard>
      ))}
    </div>
  );
}

/** A loose chip: the fact, its route buttons, and a mouse / pen drag handle on the card itself. */
function Chip({
  round,
  lanes,
  disabled,
  active,
  onRoute,
  onDragMove,
  onDragEnd,
  onFocusChip,
  chipRef,
}: {
  round: Round;
  lanes: Lane[];
  disabled: boolean;
  active: boolean;
  onRoute: (roundId: string, lane: string) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (roundId: string, x: number, y: number) => void;
  onFocusChip: (roundId: string) => void;
  chipRef?: (el: HTMLElement | null) => void;
}) {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; pointerId: number; dragging: boolean } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (disabled || e.pointerType === 'touch' || (e.target as HTMLElement).closest('button')) return;
    start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    s.dragging = true;
    setOffset({ x: dx, y: dy });
    onDragMove(e.clientX, e.clientY);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || s.pointerId !== e.pointerId || !s.dragging) return;
    setOffset(null);
    onDragEnd(round.id, e.clientX, e.clientY);
  };
  const onPointerCancel = () => {
    start.current = null;
    setOffset(null);
    onDragMove(-1, -1);
  };

  const lifted = offset !== null;
  return (
    <article
      ref={chipRef}
      className={`cd-chip${lifted ? ' is-lifted' : ''}${active ? ' is-active' : ''}`}
      style={lifted ? { transform: `translate(${offset.x}px, ${offset.y}px) rotate(-0.6deg)` } : undefined}
      data-draggable={disabled ? undefined : 'true'}
      aria-label="Fact to file"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onFocus={() => onFocusChip(round.id)}
    >
      <Fact p={round.payload} revealed={false} />
      <div className="cd-routes" role="group" aria-label="File this fact">
        {lanes.map((l, i) => (
          <button
            key={l.id}
            type="button"
            className="g-btn cd-route"
            disabled={disabled}
            data-first={i === 0 ? 'true' : undefined}
            onClick={() => onRoute(round.id, l.id)}
          >
            <span>{l.label}</span>
            <kbd className="cd-key" aria-hidden="true">
              {l.keyHint}
            </kbd>
          </button>
        ))}
      </div>
    </article>
  );
}

/** A filed chip inside a lane, with its case named and its source once settled. */
function Filed({ round, placement, holding, phase, lanes }: { round: Round; placement: Placement; holding: boolean; phase: PlayPhase; lanes: Lane[] }) {
  const p = round.payload;
  const chosenLabel = lanes.find((l) => l.id === placement.chosen)?.label;
  const source = phase === 'discovery' || !p.category ? `block ${round.blockId}` : `${p.category} · block ${round.blockId}`;
  if (holding) {
    return (
      <div className="cd-filed is-holding" aria-hidden="true">
        <Fact p={p} revealed={false} />
      </div>
    );
  }
  const where =
    placement.chosen === null
      ? `Time ran out. From the ${p.ownerName} file.`
      : placement.correct
        ? `From the ${p.ownerName} file.`
        : `Filed under “${chosenLabel ?? placement.chosen}”; it belongs to the ${p.ownerName} file.`;
  return (
    <div className={`cd-filed ${placement.correct ? 'is-hit cd-stamp' : 'is-missed g-assemble'}`}>
      <Fact p={p} revealed />
      <p className="cd-source">
        {where}{' '}
        <span className="g-mono">
          {p.factReading} · {source}
        </span>
      </p>
    </div>
  );
}

export function CaseDocketBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<DocketPayload>) {
  const timed = phase === 'pressure';
  const cases = rounds[0]?.payload.cases ?? [];
  const lanes = useMemo(() => lanesFor(phase, cases), [phase, cases]);
  const [placed, setPlaced] = useState<Record<string, Placement>>({});
  const [hold, setHold] = useState<{ roundId: string; chosen: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Pressure pacing: dealing, a short pause after a catch, or waiting for "Next fact" after a miss. */
  const [gate, setGate] = useState<'deal' | 'cooldown' | 'await'>('deal');
  const [message, setMessage] = useState('');
  const clock = useRef(performance.now());
  const done = useRef(false);
  const laneEls = useRef(new Map<string, HTMLElement>());
  const chipEls = useRef(new Map<string, HTMLElement>());
  const boardRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  /** Whether the last filing was made with focus on the board (keyboard or assistive tech). */
  const keyboardFlow = useRef(false);

  const byId = useMemo(() => new Map(rounds.map((r) => [r.id, r])), [rounds]);
  const remaining = rounds.filter((r) => !placed[r.id] && hold?.roundId !== r.id);
  const current = timed && gate === 'deal' && !hold ? (remaining[0] ?? null) : null;
  const complete = remaining.length === 0 && !hold;
  const locked = hold !== null || complete;

  const finishPhase = () => {
    if (done.current) return;
    done.current = true;
    onPhaseDone();
  };

  useEffect(() => {
    if (rounds.length === 0) finishPhase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds.length]);

  /** Keeps keyboard users moving: focus the next loose chip's first button (only if they were on the board). */
  const focusNext = (skip?: string) => {
    if (!keyboardFlow.current) return;
    const next = rounds.find((r) => !placed[r.id] && r.id !== skip && hold?.roundId !== r.id);
    if (!next) return;
    window.setTimeout(() => {
      chipEls.current.get(next.id)?.querySelector<HTMLButtonElement>('button[data-first]')?.focus();
    }, 0);
  };

  const record = (roundId: string, p: Placement) => setPlaced((xs) => ({ ...xs, [roundId]: p }));

  const route = (roundId: string, laneId: string) => {
    const round = byId.get(roundId);
    if (!round || locked || placed[roundId]) return;
    if (timed && roundId !== current?.id) return;
    keyboardFlow.current = !!boardRef.current?.contains(document.activeElement);
    const correct = laneId === round.payload.answer;
    const now = performance.now();
    onResult({ roundId, correct, timeMs: now - clock.current, timedOut: false });
    clock.current = now;
    const answerLabel = lanes.find((l) => l.id === round.payload.answer)?.label ?? round.payload.answer;
    if (correct) {
      record(roundId, { lane: laneId, chosen: laneId, correct: true });
      setMessage(`Filed under ${answerLabel}. From the ${round.payload.ownerName} file, block ${round.blockId}.`);
      if (timed) setGate('cooldown');
      focusNext(roundId);
      return;
    }
    setHold({ roundId, chosen: laneId });
    setMessage(`Not ${lanes.find((l) => l.id === laneId)?.label ?? laneId}. It belongs to the ${round.payload.ownerName} file, block ${round.blockId}.`);
  };

  // Wrong filing: hold in the wrong lane for a beat, then settle into the right one.
  useEffect(() => {
    if (!hold) return;
    const round = byId.get(hold.roundId);
    const t = window.setTimeout(() => {
      if (round) record(hold.roundId, { lane: round.payload.answer, chosen: hold.chosen, correct: false });
      setHold(null);
      if (timed) setGate('await');
      else focusNext(hold.roundId);
    }, HOLD_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  // Pressure: the dealt chip's clock.
  useEffect(() => {
    if (!current) return;
    clock.current = performance.now();
    const limit = current.timeLimitMs ?? 12000;
    const t = window.setTimeout(() => {
      onResult({ roundId: current.id, correct: false, timeMs: limit, timedOut: true });
      record(current.id, { lane: current.payload.answer, chosen: null, correct: false });
      setMessage(`Time ran out. It belongs to the ${current.payload.ownerName} file, block ${current.blockId}.`);
      setGate('await');
    }, limit);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  useEffect(() => {
    if (!timed || gate !== 'cooldown') return;
    const t = window.setTimeout(() => setGate('deal'), reducedMotion() ? COOLDOWN_MS / 2 : COOLDOWN_MS);
    return () => window.clearTimeout(t);
  }, [gate, timed]);

  useEffect(() => {
    if (timed && gate === 'deal' && current) {
      window.setTimeout(() => chipEls.current.get(current.id)?.querySelector<HTMLButtonElement>('button[data-first]')?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  useEffect(() => {
    if (gate === 'await' && !complete) nextRef.current?.focus();
    if (complete) continueRef.current?.focus();
  }, [gate, complete]);

  // Keyboard: T / N or 1 / 2 or the arrows file the focused chip, else the next one.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || locked) return;
      const k = e.key.toLowerCase();
      const lane = lanes.find((l) => l.keys.includes(k));
      if (!lane) return;
      const target = timed ? current : (rounds.find((r) => r.id === focusId && !placed[r.id]) ?? remaining[0]);
      if (!target) return;
      e.preventDefault();
      route(target.id, lane.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const laneAt = (x: number, y: number): string | null => {
    for (const [id, el] of laneEls.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  };
  const onDragMove = (x: number, y: number) => {
    const o = x < 0 ? null : laneAt(x, y);
    if (o !== over) setOver(o);
  };
  const onDragEnd = (roundId: string, x: number, y: number) => {
    const o = laneAt(x, y);
    setOver(null);
    if (o) route(roundId, o);
  };

  const inLane = (laneId: string) => {
    const out: { r: Round; p: Placement; holding: boolean }[] = [];
    for (const r of rounds) {
      const p = placed[r.id];
      if (p && p.lane === laneId) out.push({ r, p, holding: false });
      if (hold?.roundId === r.id && hold.chosen === laneId) out.push({ r, p: { lane: laneId, chosen: laneId, correct: false }, holding: true });
    }
    return out;
  };

  const loose = timed ? (current ? [current] : []) : remaining;

  return (
    <div ref={boardRef} className="cd-board space-y-5">
      <div className="cd-label">{timed ? 'Under pressure: two files, one bench' : 'On the record'}</div>
      <Rules rounds={rounds} placed={placed} current={current?.id ?? (timed ? null : (remaining[0]?.id ?? null))} />
      <CaseCards phase={phase} cases={cases} />

      {!complete && (
        <section className="space-y-3" aria-label={timed ? 'The dealt fact' : 'Loose facts'}>
          <div className="cd-small">
            {timed
              ? 'Send each fact to the file it came from before the clock runs down.'
              : 'Each fact is either from this case’s file or lifted from another. File it.'}
          </div>
          {timed && current && <TimerBar key={current.id} ms={current.timeLimitMs ?? 12000} />}
          <div className="space-y-3">
            {loose.map((r) => (
              <Chip
                key={r.id}
                round={r}
                lanes={lanes}
                disabled={locked}
                active={timed || focusId === r.id}
                onRoute={route}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                onFocusChip={setFocusId}
                chipRef={(el: HTMLElement | null) => {
                  if (el) chipEls.current.set(r.id, el);
                  else chipEls.current.delete(r.id);
                }}
              />
            ))}
          </div>
          {timed && gate === 'await' && (
            <div className="flex justify-end">
              <button ref={nextRef} type="button" className="g-btn is-primary" onClick={() => setGate('deal')}>
                Next fact
              </button>
            </div>
          )}
          {timed && gate === 'cooldown' && <p className="cd-small">Filed.</p>}
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {lanes.map((l) => {
          const items = inLane(l.id);
          return (
            <section
              key={l.id}
              ref={(el: HTMLElement | null) => {
                if (el) laneEls.current.set(l.id, el);
                else laneEls.current.delete(l.id);
              }}
              className={`cd-lane${over === l.id ? ' is-over' : ''}`}
              aria-label={`${l.label}: filed facts`}
            >
              <header className="mb-3">
                <div className="cd-lane-title">{l.label}</div>
                {l.sub && <div className="cd-small">{l.sub}</div>}
              </header>
              <div className="space-y-2">
                {items.length === 0 && <p className="cd-small cd-empty">Nothing filed yet.</p>}
                {items.map(({ r, p, holding }) => (
                  <Filed key={`${r.id}${holding ? '-hold' : ''}`} round={r} placement={p} holding={holding} phase={phase} lanes={lanes} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {complete && (
        <div className="flex justify-end">
          <button ref={continueRef} type="button" className="g-btn is-primary" onClick={finishPhase}>
            Continue
          </button>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
