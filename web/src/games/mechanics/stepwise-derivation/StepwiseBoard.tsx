// Stepwise Derivation board: the worked example as a ladder of lines. The gap sits where the notes'
// next step goes; three moves are on the table. Choosing one places its consequence — the notes'
// own line — on the ladder: the right move assembles into place; a wrong move holds for a beat
// with its own line (and where it comes from), then the notes' line fades in beneath it.
import { useEffect, useRef, useState } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import { GameCard, NoteText, ShatterBurst, TimerBar, WrongHold } from '../../theme/primitives';
import type { Choice, Example, StepPayload } from './build';
import type { Move } from './parse';
import { MathLine, Parts } from './Parts';
import './stepwise-derivation.css';

const KEYS = ['1', '2', '3'];
const LETTERS = ['a', 'b', 'c'];
/** Under pressure, a right move advances by itself after this beat (unless the example's end is being shown). */
const AUTO_ADVANCE_MS = 1500;

function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) return true;
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A placed step: its heading (label moves), then the notes' lines. */
function MoveView({ m, showLead = true }: { m: Move; showLead?: boolean }) {
  return (
    <div className="sd-move">
      {showLead && <Parts parts={m.lead} className="sd-lead" />}
      {m.labelFull && (
        <p className="sd-step-label">
          <NoteText latex={m.labelFull} />
        </p>
      )}
      <Parts parts={m.body} />
    </div>
  );
}

/** The operation a choice names: a label in words, or an equation's setup. */
function OpView({ c }: { c: Choice }) {
  if (c.shape === 'label') {
    return (
      <span className="sd-op-label">
        <NoteText latex={c.op} />
      </span>
    );
  }
  return <MathLine tex={c.op} className="sd-op-math" />;
}

/** Why a move is where it is, in one line: the notes' content only, never where it sits. */
function choiceNote(c: Choice, ex: Example): string {
  if (c.kind === 'true') return "The notes' next step.";
  if (c.kind === 'ahead') return `A later step of this same example: it needs ${c.needs ?? 'a result'}, which the working has not produced yet.`;
  if (c.blockId === ex.blockId) return 'Another step of this example.';
  return c.title ? `A step from another worked example (${c.title}). There it leads to:` : 'A step from another worked example. There it leads to:';
}

/**
 * A move with where it leads: the operation, a one-line note, then its own lines from the notes.
 * An equation's line already starts with its setup, so only a label is shown separately.
 */
function ChoiceView({ c, ex }: { c: Choice; ex: Example }) {
  return (
    <div className="sd-choice-view">
      {c.shape === 'label' && (
        <div className="sd-choice-op">
          <OpView c={c} />
        </div>
      )}
      <p className="sd-note">
        <NoteText latex={choiceNote(c, ex)} />
      </p>
      <Parts parts={c.leadsTo} className="sd-leads-to" />
    </div>
  );
}

interface Outcome {
  picked: number | null;
  correct: boolean;
  timedOut: boolean;
}

function Round({
  round,
  phase,
  onAnswered,
  onNext,
  lastInPhase,
}: {
  round: MechanicRound<StepPayload>;
  phase: PlayPhase;
  onAnswered: (r: RoundResult) => void;
  onNext: () => void;
  lastInPhase: boolean;
}) {
  const p = round.payload;
  const ex = p.example;
  const gapMove = ex.moves[p.blank];
  const timed = phase === 'pressure';
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settled, setSettled] = useState(false);
  const started = useRef(performance.now());
  const gapRef = useRef<HTMLLIElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const reduced = useRef(prefersReducedMotion());
  // A tap, a key and the timeout can land in the same tick, before `outcome` re-renders: report once.
  const answered = useRef(false);

  const finish = (o: Outcome) => {
    if (outcome || answered.current) return;
    answered.current = true;
    setOutcome(o);
    if (o.correct) setSettled(true);
    onAnswered({ roundId: round.id, correct: o.correct, timeMs: performance.now() - started.current, timedOut: o.timedOut });
  };
  const choose = (i: number) => {
    if (outcome || answered.current || i < 0 || i >= p.options.length) return;
    finish({ picked: i, correct: i === p.answer, timedOut: false });
  };

  // Bring the gap into view when the round opens.
  useEffect(() => {
    gapRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduced.current ? 'auto' : 'smooth' });
  }, []);

  // Pressure: the move must be made before the rule drains.
  useEffect(() => {
    if (!timed || outcome) return;
    const t = window.setTimeout(() => finish({ picked: null, correct: false, timedOut: true }), round.timeLimitMs ?? 20000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, outcome]);

  // Keyboard: 1 / 2 / 3 (or A / B / C) to choose.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (outcome || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const i = KEYS.indexOf(k) >= 0 ? KEYS.indexOf(k) : LETTERS.indexOf(k);
      if (i >= 0 && i < p.options.length) {
        e.preventDefault();
        choose(i);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const revealTail = !!outcome && settled && p.last && p.tail;
  const autoAdvance = timed && !!outcome?.correct && !revealTail;
  useEffect(() => {
    if (!outcome || !settled) return;
    nextRef.current?.focus({ preventScroll: true });
    if (autoAdvance) {
      const t = window.setTimeout(onNext, AUTO_ADVANCE_MS);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, settled]);

  const picked = outcome?.picked != null ? p.options[outcome.picked] : null;
  const others = p.options.filter((_c, i) => i !== p.answer && i !== outcome?.picked);
  const tail = ex.moves.slice(p.blank + 1);

  return (
    <GameCard className="sd-card g-enter relative space-y-5" label="Worked example">
      {timed && !outcome && <TimerBar ms={round.timeLimitMs ?? 20000} />}

      <header className="space-y-3">
        {ex.heading && (
          <h2 className="sd-heading">
            <NoteText latex={ex.heading} />
          </h2>
        )}
        {ex.context.length > 0 && (
          <div className="sd-context">
            <p className="sd-note">Carried over from the example before:</p>
            <Parts parts={ex.context} />
          </div>
        )}
        <Parts parts={ex.prompt} className="sd-prompt" />
      </header>

      <ol className="sd-ladder" aria-label="The working so far">
        {ex.moves.slice(0, p.blank).map((m, i) => (
          <li key={i} className="sd-rung">
            <MoveView m={m} />
          </li>
        ))}

        <li ref={gapRef} className={`sd-rung is-gap ${outcome ? 'is-filled' : ''}`} aria-live="polite">
          <Parts parts={gapMove.lead} className="sd-lead" />
          {!outcome && (
            <div className="sd-slot">
              <span>{gapMove.kind === 'label' ? 'Next step: which move?' : 'Next line: which calculation?'}</span>
            </div>
          )}
          {outcome?.correct && (
            <div className="relative">
              <div className="g-assemble">
                <MoveView m={gapMove} showLead={false} />
              </div>
              <ShatterBurst />
            </div>
          )}
          {outcome && !outcome.correct && (
            <div className="space-y-2">
              <p className="sd-note">{outcome.timedOut ? 'Time ran out before a move was made.' : 'That move leads somewhere else:'}</p>
              <WrongHold
                wrong={picked ? <ChoiceView c={picked} ex={ex} /> : <span className="sd-note">No move made.</span>}
                right={
                  <>
                    <p className="sd-kicker">The notes' next step</p>
                    <MoveView m={gapMove} showLead={false} />
                  </>
                }
                onSettled={() => setSettled(true)}
              />
            </div>
          )}
        </li>

        {revealTail &&
          tail.map((m, i) => (
            <li key={`t${i}`} className="sd-rung g-enter">
              <MoveView m={m} />
            </li>
          ))}
      </ol>

      {!outcome && (
        <div className="space-y-3" role="group" aria-label="Choose the next move">
          {p.options.map((c, i) => (
            <button
              key={i}
              type="button"
              className="sd-option"
              onClick={() => choose(i)}
              aria-keyshortcuts={KEYS[i]}
            >
              <span className="sd-key" aria-hidden="true">
                {KEYS[i]}
              </span>
              <span className="sd-option-body">
                <OpView c={c} />
              </span>
            </button>
          ))}
        </div>
      )}

      {outcome && settled && phase === 'discovery' && others.length > 0 && (
        <section className="sd-elsewhere g-enter" aria-label="Where the other moves lead">
          <p className="sd-kicker">Where the other {others.length === 1 ? 'move leads' : 'moves lead'}</p>
          {others.map((c, i) => (
            <ChoiceView key={i} c={c} ex={ex} />
          ))}
        </section>
      )}

      {outcome && settled && p.last && !p.tail && <p className="sd-note">This example picks up again under pressure.</p>}

      {outcome && (
        <div className="flex justify-end">
          <button ref={nextRef} type="button" className="g-btn is-primary" onClick={onNext} disabled={!settled}>
            {lastInPhase ? 'Continue' : p.last ? 'Next example' : 'Next gap'}
          </button>
        </div>
      )}
    </GameCard>
  );
}

/** One short rule per gap this phase: pending, current, placed, missed. No numbers. */
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

export function StepwiseBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<StepPayload>) {
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
      <p className="sd-kicker">{phase === 'discovery' ? 'Working through' : 'Under pressure'}</p>
      <Docket total={rounds.length} index={index} results={results} />
      <Round key={round.id} round={round} phase={phase} onAnswered={answered} onNext={next} lastInPhase={index + 1 === rounds.length} />
    </div>
  );
}
