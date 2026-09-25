// Order Game board: a column of cards the player puts back in the notes' order. Tap a card to
// pick it up, tap another card to drop it in that place; or use the arrow buttons; or, with a card
// focused, the arrow keys. Check marks every position right or wrong; a miss holds for a beat and
// the notes' order fades in underneath with its source block (§10.3).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MutableRefObject } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import type { OrderPayload, OrderStep } from './build';
import { moveTo, partialGrade, positionsRight } from './build';
import { GameCard, NoteText, TimerBar, WrongHold } from '../../theme/primitives';
import './order-game.css';

/** Pressure: a correct set moves on by itself after this beat. */
const AUTO_ADVANCE_MS = 1600;
const FLIP_MS = 220;

function prefersReducedMotion(): boolean {
  try {
    if (document.documentElement.classList.contains('reduce-motion')) return true;
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface Outcome {
  correct: boolean;
  timedOut: boolean;
  final: number[];
}

/** The arrangement column. Static (feedback) when `onMove` is absent. */
function Column({
  steps,
  arr,
  pinned,
  selected,
  marks,
  showOriginal,
  highlight,
  onSelect,
  onMove,
  bodyRefs,
  labelled,
}: {
  steps: readonly OrderStep[];
  arr: readonly number[];
  pinned: boolean;
  selected?: number | null;
  marks?: readonly boolean[];
  showOriginal?: boolean;
  /** Step index to ring (the piece that had moved, in a restore round). */
  highlight?: number;
  onSelect?: (pos: number) => void;
  onMove?: (from: number, to: number, focus?: boolean) => void;
  bodyRefs?: MutableRefObject<Map<number, HTMLElement>>;
  labelled: string;
}) {
  const interactive = !!onMove;
  const n = arr.length;
  const lo = pinned ? 1 : 0;
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, pos: number) => {
    if (!onMove || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowUp' && pos > lo) {
      e.preventDefault();
      onMove(pos, pos - 1, true);
    } else if (e.key === 'ArrowDown' && pos < n - 1 && pos >= lo) {
      e.preventDefault();
      onMove(pos, pos + 1, true);
    }
  };
  return (
    <ol className="og-list" aria-label={labelled}>
      {arr.map((v, pos) => {
        const step = steps[v];
        const locked = pinned && pos === 0;
        const isSel = selected === pos;
        const isTarget = interactive && selected !== null && selected !== undefined && !isSel && !locked;
        const mark = marks ? (marks[pos] ? ' is-right' : ' is-wrong') : '';
        const cls = `og-row${isSel ? ' is-selected' : ''}${isTarget ? ' is-target' : ''}${mark}${locked && !marks ? ' is-pinned' : ''}${highlight === v ? ' is-moved-piece' : ''}`;
        const text = showOriginal ? step.original : step.text;
        const label = `Position ${pos + 1} of ${n}${locked ? ', fixed start' : ''}${marks ? (marks[pos] ? ', right' : `, belongs at ${v + 1}`) : ''}`;
        const content = (
          <>
            <span className="og-sr">{label}. </span>
            {showOriginal && step.marker && <span className="og-marker">{step.marker}</span>}
            <span className="og-text">
              <NoteText latex={text} />
            </span>
            {locked && !marks && <span className="og-note">Fixed start of the loop</span>}
            {marks && !marks[pos] && <span className="og-note">Belongs at {v + 1}</span>}
          </>
        );
        return (
          <li key={v} className={cls} data-step={v}>
            <span className="og-pos" aria-hidden="true">
              {pos + 1}
            </span>
            {interactive && !locked ? (
              <button
                type="button"
                className="og-body"
                ref={(el: HTMLButtonElement | null) => {
                  if (!bodyRefs) return;
                  if (el) bodyRefs.current.set(v, el);
                  else bodyRefs.current.delete(v);
                }}
                aria-pressed={isSel}
                onClick={() => onSelect?.(pos)}
                onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => onKey(e, pos)}
              >
                {content}
              </button>
            ) : (
              <div className="og-body">{content}</div>
            )}
            {interactive && !locked && (
              <span className="og-steps">
                <button
                  type="button"
                  className="og-step"
                  onClick={() => onMove?.(pos, pos - 1)}
                  disabled={pos <= lo}
                  aria-label={`Move up from position ${pos + 1}`}
                >
                  <ArrowUp className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="og-step"
                  onClick={() => onMove?.(pos, pos + 1)}
                  disabled={pos >= n - 1}
                  aria-label={`Move down from position ${pos + 1}`}
                >
                  <ArrowDown className="h-5 w-5" aria-hidden="true" />
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Round({
  round,
  phase,
  onAnswered,
  onNext,
  last,
}: {
  round: MechanicRound<OrderPayload>;
  phase: PlayPhase;
  onAnswered: (r: RoundResult) => void;
  onNext: () => void;
  last: boolean;
}) {
  const { seq, mode, start, displaced } = round.payload;
  const n = seq.steps.length;
  const pinned = !!seq.anchored;
  const [arr, setArr] = useState<number[]>(() => [...start]);
  const [selected, setSelected] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settled, setSettled] = useState(false);
  const [announce, setAnnounce] = useState('');
  const started = useRef(performance.now());
  const arrRef = useRef(arr);
  arrRef.current = arr;
  const bodyRefs = useRef(new Map<number, HTMLElement>());
  const rects = useRef<Map<number, number> | null>(null);
  const focusAfter = useRef<number | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const reported = useRef(false);
  const timed = phase === 'pressure';
  const done = outcome !== null;

  const finish = (timedOut: boolean) => {
    // Exactly one report per round, whatever fires first (the clock or Check).
    if (reported.current) return;
    reported.current = true;
    const final = [...arrRef.current];
    const perfect = final.every((v, i) => v === i);
    // Time running out on a finished board still counts: the order was right.
    const o: Outcome = { correct: perfect, timedOut: timedOut && !perfect, final };
    setOutcome(o);
    setSelected(null);
    if (perfect) setSettled(true);
    onAnswered({
      roundId: round.id,
      correct: perfect,
      timeMs: performance.now() - started.current,
      timedOut: o.timedOut,
      grade: o.timedOut ? undefined : partialGrade(final, mode),
    });
  };

  const move = (from: number, to: number, keepFocus = false) => {
    if (done) return;
    const lo = pinned ? 1 : 0;
    if (from === to || from < lo || to < lo || to >= n) return;
    // FLIP: remember where every card was, animate from there after the re-render.
    const before = new Map<number, number>();
    bodyRefs.current.forEach((el, v) => {
      const li = el.closest('li');
      if (li) before.set(v, li.getBoundingClientRect().top);
    });
    rects.current = before;
    const v = arrRef.current[from];
    // At either end the arrow that was pressed disables itself; keep focus on the card instead.
    if (keepFocus || to === lo || to === n - 1) focusAfter.current = v;
    setArr(moveTo(arrRef.current, from, to));
    setSelected(null);
    setAnnounce(`Moved to position ${to + 1} of ${n}.`);
  };

  const select = (pos: number) => {
    if (done) return;
    if (selected === null) {
      setSelected(pos);
      setAnnounce(`Picked up the card at position ${pos + 1}. Choose where it goes.`);
    } else if (selected === pos) {
      setSelected(null);
      setAnnounce('Put back.');
    } else move(selected, pos, true);
  };

  useLayoutEffect(() => {
    const before = rects.current;
    rects.current = null;
    if (focusAfter.current !== null) {
      bodyRefs.current.get(focusAfter.current)?.focus();
      focusAfter.current = null;
    }
    if (!before || prefersReducedMotion()) return;
    bodyRefs.current.forEach((el, v) => {
      const li = el.closest('li');
      const was = before.get(v);
      if (!li || was === undefined || typeof li.animate !== 'function') return;
      const dy = was - li.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    });
  }, [arr]);

  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Pressure clock: when it runs out, the board is checked as it stands.
  useEffect(() => {
    if (!timed || done) return;
    const t = window.setTimeout(() => finishRef.current(true), round.timeLimitMs ?? 30000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, done]);

  // Escape puts a picked-up card back.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && selected !== null) {
        setSelected(null);
        setAnnounce('Put back.');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  useEffect(() => {
    if (!done || !settled) return;
    nextRef.current?.focus();
    if (timed && outcome?.correct) {
      const t = window.setTimeout(onNext, AUTO_ADVANCE_MS);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, settled]);

  // No category names before the naming step (§11): discovery cites the block only.
  const source = `${phase === 'pressure' ? 'Sequence · ' : ''}${seq.objectiveId ? `${seq.objectiveId} · ` : ''}block ${seq.blockId}`;
  const instruction =
    mode === 'restore'
      ? 'This set is nearly in the notes’ order: one piece has been moved. Find it and put it back.'
      : pinned
        ? 'This set closes in a loop. The first card is fixed; put the rest in the order they follow it.'
        : 'Put these back in the order the notes give them.';
  const identity = Array.from({ length: n }, (_, i) => i);
  const marks = outcome ? positionsRight(outcome.final) : undefined;
  const rightCount = marks ? marks.filter(Boolean).length : 0;

  return (
    <GameCard className="g-enter relative space-y-5 !px-4 sm:!px-6">
      {timed && !done && <TimerBar key={round.id} ms={round.timeLimitMs ?? 30000} />}

      <div className="space-y-2">
        <p className="og-prompt">
          <NoteText latex={seq.prompt} />
        </p>
        {seq.context && (
          <p className="og-context">
            <NoteText latex={seq.context} />
          </p>
        )}
      </div>

      {!done && (
        <>
          <p className="og-small g-muted">
            {instruction} Tap a card, then tap the place it belongs, or use its arrows.
            <span className="og-keyhint"> With a card focused, the arrow keys move it.</span>
          </p>
          <Column
            steps={seq.steps}
            arr={arr}
            pinned={pinned}
            selected={selected}
            onSelect={select}
            onMove={move}
            bodyRefs={bodyRefs}
            labelled="Cards to put in order"
          />
          <div className="flex justify-end">
            <button type="button" className="g-btn is-primary" onClick={() => finish(false)}>
              Check the order
            </button>
          </div>
        </>
      )}

      {done && outcome && outcome.correct && (
        <div className="space-y-4">
          <div className="og-lock">
            <Column steps={seq.steps} arr={identity} pinned={pinned} marks={identity.map(() => true)} showOriginal labelled="The notes' order" />
          </div>
          <div className="g-settle space-y-1">
            <p className="og-small">
              <span className="g-strong">
                <NoteText latex={seq.concept} />
              </span>
              <span className="g-muted">: in the notes’ order.</span>
            </p>
            {seq.note && (
              <p className="og-context">
                <NoteText latex={seq.note} />
              </p>
            )}
            <p className="og-source">{source}</p>
          </div>
        </div>
      )}

      {done && outcome && !outcome.correct && (
        <div className="space-y-3">
          <p className="og-small g-muted">
            {outcome.timedOut ? 'Time ran out. ' : ''}
            {rightCount === 0 ? 'No card was in its place.' : `${rightCount === 1 ? 'One card was' : `${rightCount} cards were`} in place.`}
          </p>
          <WrongHold
            wrong={<Column steps={seq.steps} arr={outcome.final} pinned={pinned} marks={marks} labelled="Your order, marked" />}
            right={
              <div className="space-y-2">
                <p className="og-small g-strong">{mode === 'restore' ? 'The notes’ order; the ringed card was the one moved:' : 'The notes’ order:'}</p>
                <Column
                  steps={seq.steps}
                  arr={identity}
                  pinned={pinned}
                  showOriginal
                  highlight={mode === 'restore' ? displaced : undefined}
                  labelled="The notes' order"
                />
                {seq.note && (
                  <p className="og-context">
                    <NoteText latex={seq.note} />
                  </p>
                )}
                <p className="og-source">{source}</p>
              </div>
            }
            onSettled={() => setSettled(true)}
          />
        </div>
      )}

      {done && (
        <div className="flex justify-end">
          <button ref={nextRef} type="button" className="g-btn is-primary" onClick={onNext} disabled={!settled}>
            {last ? 'Continue' : 'Next set'}
          </button>
        </div>
      )}

      <p className="og-sr" aria-live="polite">
        {announce}
      </p>
    </GameCard>
  );
}

/** One short rule per set this phase — pending, current, placed, missed. No numbers. */
function Docket({ total, index, results }: { total: number; index: number; results: boolean[] }) {
  return (
    <div className="og-docket" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            background: i < results.length ? (results[i] ? 'var(--g-green)' : 'var(--g-red)') : i === index ? 'var(--g-gold)' : undefined,
          }}
        />
      ))}
    </div>
  );
}

export function OrderBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<OrderPayload>) {
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
      <div className="og-label">{phase === 'discovery' ? 'Reconstruct' : 'Against the clock'}</div>
      <Docket total={rounds.length} index={index} results={results} />
      <Round key={round.id} round={round} phase={phase} onAnswered={answered} onNext={next} last={index + 1 === rounds.length} />
    </div>
  );
}
