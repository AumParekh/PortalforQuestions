// Bucket Drop board. Discovery lays the whole tray out, untimed: pick any card (tap, Enter or
// Space), then a bucket (tap, Enter, or its number key). Pressure deals one card at a time into a
// chute with a draining clock; the dealt card is already in hand, so one tap or key drops it.
// Mouse and pen can also drag a card onto a bucket; touch uses tap-tap so the page still scrolls.
// A wrong drop shakes in the bucket it landed in for a beat while the right bucket lights up, then
// the card settles into the right bucket with the source block ID.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import type { BoardSpec, BucketPayload } from './build';
import { bucketLabel } from './build';
import { toDisplay } from '../../text';
import { GameCard, NoteText, TimerBar } from '../../theme/primitives';
import './bucket-drop.css';

type Round = MechanicRound<BucketPayload>;

/** The beat a wrong card holds in the wrong bucket before it moves (§10.3). */
const HOLD_MS = 800;
/** Pause after a correct drop under pressure before the next card is dealt. */
const COOLDOWN_MS = 420;
const DRAG_THRESHOLD = 6;

interface Placement {
  bucketId: string;
  correct: boolean;
  /** Where the player dropped it; null when the clock ran out. */
  dropped: string | null;
}

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function plainLabel(latex: string): string {
  return toDisplay(latex);
}

function CardBody({ p }: { p: BucketPayload }) {
  return (
    <>
      {p.context && (
        <span className="bd-context mb-1 block">
          <NoteText latex={p.context} />
        </span>
      )}
      <span className="g-serif bd-text block">
        <NoteText latex={p.text} />
      </span>
    </>
  );
}

/** A card in the tray or chute: a button (tap / Enter / Space to pick up), draggable by mouse or pen. */
function Card({
  round,
  selected,
  disabled,
  fall,
  onPick,
  onDragMove,
  onDragEnd,
  cardRef,
}: {
  round: Round;
  selected: boolean;
  disabled: boolean;
  fall?: boolean;
  onPick: (id: string) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  cardRef?: (el: HTMLButtonElement | null) => void;
}) {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; pointerId: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    suppressClick.current = false;
    if (disabled || e.pointerType === 'touch') return;
    start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    s.dragging = true;
    setOffset({ x: dx, y: dy });
    onDragMove(e.clientX, e.clientY);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || s.pointerId !== e.pointerId || !s.dragging) return;
    suppressClick.current = true;
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
    <button
      ref={cardRef}
      type="button"
      className={`bd-card${selected ? ' is-selected' : ''}${lifted ? ' is-lifted' : ''}${fall ? ' bd-fall' : ''}`}
      style={lifted ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(1.02)` } : undefined}
      aria-pressed={selected}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onPick(round.id);
      }}
    >
      <CardBody p={round.payload} />
    </button>
  );
}

/** One short rule per card this phase — pending, current, caught, missed. No numbers. */
function Docket({ rounds, placed, current }: { rounds: Round[]; placed: Record<string, Placement>; current: string | null }) {
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

function Board({
  board,
  rounds,
  phase,
  onResult,
  onDone,
  last,
}: {
  board: BoardSpec;
  rounds: Round[];
  phase: PlayPhase;
  onResult: (r: RoundResult) => void;
  onDone: () => void;
  last: boolean;
}) {
  const timed = phase === 'pressure';
  const [placed, setPlaced] = useState<Record<string, Placement>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [hold, setHold] = useState<{ roundId: string; dropped: string | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  /** Pressure pacing: dealing, a short pause after a catch, or waiting for "Next card" after a miss. */
  const [gate, setGate] = useState<'deal' | 'cooldown' | 'await'>('deal');
  const [lastMiss, setLastMiss] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const clock = useRef(performance.now());
  const boardRef = useRef<HTMLDivElement | null>(null);
  const bucketEls = useRef(new Map<string, HTMLElement>());
  const cardEls = useRef(new Map<string, HTMLButtonElement>());
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);

  const byId = useMemo(() => new Map(rounds.map((r) => [r.id, r])), [rounds]);
  const remaining = rounds.filter((r) => !placed[r.id] && hold?.roundId !== r.id);
  const current = timed && gate === 'deal' && !hold ? (remaining[0] ?? null) : null;
  const active = timed ? (current?.id ?? null) : selected;
  const complete = remaining.length === 0 && !hold;
  const locked = hold !== null || complete;

  const record = (roundId: string, p: Placement) => {
    setPlaced((xs) => ({ ...xs, [roundId]: p }));
    setOrder((xs) => [...xs, roundId]);
  };

  const drop = (roundId: string, bucketId: string) => {
    const round = byId.get(roundId);
    if (!round || hold || placed[roundId]) return;
    if (timed && roundId !== current?.id) return;
    const correct = bucketId === round.payload.bucketId;
    onResult({ roundId, correct, timeMs: performance.now() - clock.current, timedOut: false });
    setSelected(null);
    setOver(null);
    setLastMiss(null);
    if (correct) {
      record(roundId, { bucketId, correct: true, dropped: bucketId });
      setMessage(`Filed under ${plainLabel(bucketLabel(board, bucketId))}.`);
      clock.current = performance.now();
      if (timed) setGate('cooldown');
    } else {
      setHold({ roundId, dropped: bucketId });
      setMessage(
        `Not ${plainLabel(bucketLabel(board, bucketId))}. It belongs under ${plainLabel(bucketLabel(board, round.payload.bucketId))}. Block ${round.blockId}.`,
      );
    }
  };

  const timeOut = (round: Round) => {
    if (hold || placed[round.id]) return;
    onResult({ roundId: round.id, correct: false, timeMs: round.timeLimitMs ?? performance.now() - clock.current, timedOut: true });
    setHold({ roundId: round.id, dropped: null });
    setMessage(`Time ran out. It belongs under ${plainLabel(bucketLabel(board, round.payload.bucketId))}. Block ${round.blockId}.`);
  };

  // A wrong card holds for a beat, then settles into the right bucket.
  useEffect(() => {
    if (!hold) return;
    const round = byId.get(hold.roundId);
    const right = round ? bucketEls.current.get(round.payload.bucketId) : undefined;
    right?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    const t = window.setTimeout(() => {
      if (round) {
        record(round.id, { bucketId: round.payload.bucketId, correct: false, dropped: hold.dropped });
        setLastMiss(round.payload.bucketId);
      }
      setHold(null);
      clock.current = performance.now();
      if (timed) setGate('await');
    }, HOLD_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  // Pressure: after a catch, a short pause, then the next card falls.
  useEffect(() => {
    if (gate !== 'cooldown') return;
    const t = window.setTimeout(() => setGate('deal'), COOLDOWN_MS);
    return () => window.clearTimeout(t);
  }, [gate]);

  // Pressure: each dealt card starts its own clock.
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (!timed || !currentId) return;
    clock.current = performance.now();
    const round = byId.get(currentId);
    if (!round) return;
    const t = window.setTimeout(() => timeOut(round), round.timeLimitMs ?? 10000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, timed]);

  // Keyboard: number keys drop the card in hand into that bucket; Escape puts it back.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape' && !timed) {
        setSelected(null);
        return;
      }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > board.buckets.length || !active || locked) return;
      e.preventDefault();
      drop(active, board.buckets[n - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keep keyboard focus on the board: after a drop, move to the next card in the tray.
  useEffect(() => {
    if (timed || complete) return;
    const ae = document.activeElement as HTMLElement | null;
    const lost = !ae || ae === document.body || !ae.isConnected;
    const onBucket = !!ae && !!boardRef.current?.contains(ae) && !!ae.closest('[data-bd-bucket]');
    if (!lost && !onBucket) return;
    const next = remaining[0];
    if (next) cardEls.current.get(next.id)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.length]);

  // Pressure: a newly dealt card takes focus if the last drop left focus nowhere (the bucket
  // button it was on is disabled during the pause), so Tab and screen readers pick up the card.
  const chuteRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!timed || !currentId) return;
    const ae = document.activeElement as HTMLElement | null;
    const lost = !ae || ae === document.body || !ae.isConnected || (ae as HTMLButtonElement).disabled === true;
    if (lost) chuteRef.current?.focus();
  }, [currentId, timed]);

  useEffect(() => {
    if (complete) doneRef.current?.focus();
    else if (gate === 'await') nextRef.current?.focus();
  }, [complete, gate]);

  const bucketAt = (x: number, y: number): string | null => {
    for (const [id, el] of bucketEls.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  };
  const onDragMove = (x: number, y: number) => {
    const t = x < 0 ? null : bucketAt(x, y);
    if (t !== over) setOver(t);
  };
  const onDragEnd = (id: string, x: number, y: number) => {
    const t = bucketAt(x, y);
    setOver(null);
    if (t) drop(id, t);
  };
  const pick = (id: string) => {
    if (locked || timed) return;
    setSelected((s) => (s === id ? null : id));
  };

  const holdRound = hold ? byId.get(hold.roundId) : undefined;
  const answerBucket = holdRound?.payload.bucketId ?? lastMiss;
  const armed = active !== null && !locked;

  return (
    <div ref={boardRef} className="space-y-5">
      <div className="space-y-3">
        <div className="bd-label">{timed ? 'Against the clock' : 'Sort the tray'}</div>
        <Docket rounds={rounds} placed={placed} current={active} />
        <p className="bd-text g-muted">{board.prompt}</p>
      </div>

      {/* Tray (discovery) or chute (pressure). */}
      {!timed && !complete && (
        <GameCard tone="soft" className="space-y-3 !p-4" label="Cards to sort">
          {remaining.length > 0 ? (
            <ul className="grid gap-3">
              {remaining.map((r) => (
                <li key={r.id}>
                  <Card
                    round={r}
                    selected={selected === r.id}
                    disabled={locked}
                    onPick={pick}
                    onDragMove={onDragMove}
                    onDragEnd={onDragEnd}
                    cardRef={(el) => {
                      if (el) cardEls.current.set(r.id, el);
                      else cardEls.current.delete(r.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="bd-small g-muted">Watch where it goes.</p>
          )}
          <p className="bd-small g-muted">
            {lastMiss && message ? message : selected ? 'Now choose its bucket.' : 'Pick a card, then choose its bucket.'}
            <span className="bd-key ml-2" aria-hidden="true">
              1–{board.buckets.length}
            </span>
          </p>
        </GameCard>
      )}

      {timed && !complete && (
        <div className="bd-chute space-y-3" role="group" aria-label="Card in hand">
          {current && (
            <>
              <TimerBar key={current.id} ms={current.timeLimitMs ?? 10000} />
              <Card
                key={current.id}
                round={current}
                selected
                disabled={false}
                fall
                onPick={() => undefined}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                cardRef={(el) => {
                  chuteRef.current = el;
                }}
              />
              <p className="bd-small g-muted">Choose its bucket.</p>
            </>
          )}
          {hold && hold.dropped === null && holdRound && (
            <>
              <p className="bd-small g-muted">Time ran out.</p>
              <div className="bd-placed is-holding">
                <CardBody p={holdRound.payload} />
              </div>
            </>
          )}
          {gate === 'await' && !hold && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="bd-small g-muted min-w-0 flex-1">{message}</p>
              <button
                ref={nextRef}
                type="button"
                className="g-btn is-primary"
                onClick={() => {
                  setLastMiss(null);
                  setGate('deal');
                }}
              >
                Next card
              </button>
            </div>
          )}
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {message}
      </p>

      {/* Buckets */}
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Buckets">
        {board.buckets.map((b, i) => {
          const here = order.filter((id) => placed[id]?.bucketId === b.id).map((id) => byId.get(id)!);
          const holding = hold && hold.dropped === b.id ? holdRound : undefined;
          const cls = [
            'bd-bucket',
            armed ? 'is-armed' : '',
            over === b.id ? 'is-over' : '',
            answerBucket === b.id ? 'is-answer' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={b.id}
              data-bd-bucket=""
              ref={(el: HTMLDivElement | null) => {
                if (el) bucketEls.current.set(b.id, el);
                else bucketEls.current.delete(b.id);
              }}
              className={cls}
              onClick={() => armed && active && drop(active, b.id)}
            >
              <button
                type="button"
                className="bd-bucket-head"
                disabled={!armed}
                aria-label={armed ? `Drop into ${plainLabel(b.label)}` : plainLabel(b.label)}
              >
                <span className="min-w-0">
                  <NoteText latex={b.label} />
                </span>
                <span className="bd-key" aria-hidden="true">
                  {i + 1}
                </span>
              </button>
              {here.map((r) => {
                const p = placed[r.id];
                const missed = !p.correct;
                return (
                  <div key={r.id} className={`bd-placed ${missed ? 'is-missed bd-fade' : 'g-snap-in'}`}>
                    <CardBody p={r.payload} />
                    <p className="bd-source mt-1 font-sans">
                      {missed ? (p.dropped ? `You dropped it under ${plainLabel(bucketLabel(board, p.dropped))}. ` : 'Time ran out. ') : ''}
                      block <span className="font-mono">{r.blockId}</span>
                    </p>
                  </div>
                );
              })}
              {holding && (
                <div className="bd-placed is-holding">
                  <CardBody p={holding.payload} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {complete && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="bd-text g-muted">{timed ? 'The board is full.' : 'Every card is in its bucket.'}</p>
          <button ref={doneRef} type="button" className="g-btn is-primary" onClick={onDone}>
            {last ? 'Continue' : 'Next board'}
          </button>
        </div>
      )}
    </div>
  );
}

export function BucketBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<BucketPayload>) {
  // Rounds share a board object per scheme; keep boards in play order.
  const boards = useMemo(() => {
    const out: { board: BoardSpec; rounds: Round[] }[] = [];
    for (const r of rounds) {
      const b = out.find((x) => x.board.key === r.payload.board.key);
      if (b) b.rounds.push(r);
      else out.push({ board: r.payload.board, rounds: [r] });
    }
    return out;
  }, [rounds]);
  const [index, setIndex] = useState(0);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onPhaseDone();
  };

  useEffect(() => {
    if (boards.length === 0) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards.length]);

  const cur = boards[index];
  if (!cur) return null;
  return (
    <Board
      key={cur.board.key}
      board={cur.board}
      rounds={cur.rounds}
      phase={phase}
      onResult={onResult}
      last={index + 1 === boards.length}
      onDone={() => (index + 1 < boards.length ? setIndex(index + 1) : finish())}
    />
  );
}
