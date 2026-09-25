import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import type { ClozePayload, CueLevel } from './build';
import { gradeFor } from './build';
import { checkAnswer } from './match';
import type { MatchVerdict } from './match';
import { GameButton, GameCard, NoteText, TimerBar, WrongHold } from '../../theme/primitives';

/** Nothing under 15px (PORTAL_PLAN §5): local small-text styles instead of the 14px g-small / g-source. */
const SMALL = 'text-[15px] leading-relaxed';
const LABEL = 'text-[15px] font-semibold uppercase tracking-[0.08em]';
const AUTO_ADVANCE_MS = 1200;

type LinkState = 'clean' | 'cued' | 'missed';

interface Outcome {
  verdict: MatchVerdict;
  correct: boolean;
  timedOut: boolean;
  cue: CueLevel;
  typed: string;
  /** Answered by tapping one of the three options. */
  picked: boolean;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const TONE: Record<LinkState, string> = { clean: 'var(--g-green)', cued: 'var(--g-gold)', missed: 'var(--g-red)' };
const TONE_BG: Record<LinkState, string> = { clean: 'var(--g-pale-green)', cued: 'var(--g-pale-gold)', missed: 'var(--g-pale-red)' };

/** The sentence with its blank: the notes' text either side, the slot in the middle. */
function Sentence({ p, slot, className = 'g-reading' }: { p: ClozePayload; slot: JSX.Element; className?: string }) {
  return (
    <p className={`${className} break-words`}>
      {p.before && <NoteText latex={p.before} />}
      {slot}
      {p.after && <NoteText latex={p.after} />}
    </p>
  );
}

function Filled({ text, state }: { text: string; state: LinkState }) {
  return (
    <span
      className="g-assemble rounded px-1 font-semibold"
      style={{ background: TONE_BG[state], boxShadow: `inset 0 -2px 0 ${TONE[state]}`, color: 'var(--g-ink)' }}
    >
      {text}
    </span>
  );
}

function Blank({ typed, hint }: { typed: string; hint: string | null }) {
  const shown = typed || (hint ? `${hint}…` : '');
  return (
    <span
      className="mx-0.5 inline-block min-w-[6ch] rounded-sm px-1 text-center"
      style={{ borderBottom: '2px solid var(--g-gold)', background: 'var(--g-pale-gold)', color: typed ? 'var(--g-ink)' : 'var(--g-ink-muted)' }}
    >
      <span className="sr-only">blank</span>
      {shown || ' '}
    </span>
  );
}

function Round({
  round,
  phase,
  onAnswered,
  onNext,
  last,
}: {
  round: MechanicRound<ClozePayload>;
  phase: PlayPhase;
  onAnswered: (r: RoundResult, state: LinkState) => void;
  onNext: () => void;
  last: boolean;
}) {
  const p = round.payload;
  const timed = phase === 'pressure' && !!round.timeLimitMs;
  const [typed, setTyped] = useState('');
  const [cue, setCue] = useState<CueLevel>(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settled, setSettled] = useState(false);
  const started = useRef(performance.now());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // The pressure timeout reads these, not the render-time values it closed over.
  const typedRef = useRef('');
  typedRef.current = typed;
  const cueRef = useRef<CueLevel>(0);
  cueRef.current = cue;

  const finish = (o: Omit<Outcome, 'correct'>) => {
    if (outcome) return;
    const correct = o.verdict !== 'wrong' && !o.timedOut;
    const full: Outcome = { ...o, correct };
    setOutcome(full);
    if (correct) setSettled(true);
    const state: LinkState = !correct ? 'missed' : o.cue > 0 ? 'cued' : 'clean';
    onAnswered(
      {
        roundId: round.id,
        correct,
        timeMs: performance.now() - started.current,
        timedOut: o.timedOut,
        grade: gradeFor(correct, o.cue, o.timedOut),
      },
      state,
    );
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (outcome) return;
    const t = typed.trim();
    if (!t) return;
    finish({ verdict: checkAnswer(t, p.key), timedOut: false, cue, typed: t, picked: false });
  };
  const pick = (opt: string) => {
    if (outcome) return;
    finish({ verdict: opt === p.answer ? 'exact' : 'wrong', timedOut: false, cue, typed: opt, picked: true });
  };
  const reveal = () => !outcome && finish({ verdict: 'wrong', timedOut: false, cue, typed: '', picked: false });
  const nextCue = () => {
    if (outcome || cue >= 2) return;
    setCue((c) => (c === 0 ? 1 : 2));
  };

  // On arrival: bring the new link into view and put the cursor in the slot.
  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (cue === 2 && !outcome) firstOptionRef.current?.focus();
  }, [cue, outcome]);

  // Pressure: the clock runs through cues; running out is a miss.
  useEffect(() => {
    if (!timed || outcome) return;
    const t = window.setTimeout(() => finish({ verdict: 'wrong', timedOut: true, cue: cueRef.current, typed: typedRef.current.trim(), picked: false }), round.timeLimitMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, outcome === null]);

  useEffect(() => {
    if (!outcome || !settled) return;
    nextRef.current?.focus();
    if (timed && outcome.correct) {
      const t = window.setTimeout(onNext, AUTO_ADVANCE_MS);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, settled]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // "?" asks for the next cue; no answer in the notes contains one.
    if (e.key === '?') {
      e.preventDefault();
      nextCue();
    }
  };

  const source = `block ${round.blockId}`;
  const cueLine =
    cue === 1 ? `Starts with “${p.firstLetter}”.` : cue === 2 ? `Starts with “${p.firstLetter}”. One of these three:` : null;

  return (
    <div ref={rootRef}>
      <GameCard className="g-enter relative space-y-4">
        {timed && !outcome && <TimerBar key={round.id} ms={round.timeLimitMs!} />}

        {!outcome && (
          <>
            <Sentence p={p} slot={<Blank typed={typed} hint={cue > 0 ? p.firstLetter : null} />} />
            <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor={`cz-${round.id}`}>
                The missing word
              </label>
              <input
                id={`cz-${round.id}`}
                ref={inputRef}
                type="text"
                inputMode={p.key.kind === 'number' ? 'decimal' : 'text'}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={80}
                value={typed}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setTyped(e.target.value)}
                onKeyDown={onKey}
                placeholder="Type the missing word"
                className="min-h-[48px] w-full min-w-0 flex-1 rounded-xl border px-4 py-2 text-[18px] outline-none"
                style={{ background: 'var(--g-card)', color: 'var(--g-ink)', borderColor: 'var(--g-rule)' }}
              />
              <GameButton type="submit" variant="primary" disabled={!typed.trim()}>
                Check
              </GameButton>
            </form>

            {cueLine && <p className={`${SMALL} g-muted`} aria-live="polite">{cueLine}</p>}
            {cue === 2 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Three choices">
                {p.options.map((o, i) => (
                  <button
                    key={o}
                    ref={i === 0 ? firstOptionRef : undefined}
                    type="button"
                    className="g-btn !h-auto min-h-[44px] py-2 text-left font-normal"
                    onClick={() => pick(o)}
                  >
                    <NoteText latex={o} />
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {cue < 2 && (
                <GameButton variant="quiet" onClick={nextCue}>
                  {cue === 0 ? 'Cue: first letter' : 'Cue: three choices'}
                </GameButton>
              )}
              <GameButton variant="quiet" onClick={reveal}>
                Show me
              </GameButton>
              <span className={`${SMALL} g-muted`}>
                Enter to check · <span className="g-mono">?</span> for a cue
              </span>
            </div>
          </>
        )}

        {outcome && outcome.correct && (
          <div className="space-y-2">
            <Sentence p={p} slot={<Filled text={p.answer} state={outcome.cue > 0 ? 'cued' : 'clean'} />} />
            <p className={`g-settle ${SMALL}`}>
              <span className="g-strong">
                {outcome.cue === 2
                  ? 'Picked from three; it comes back sooner.'
                  : outcome.cue === 1
                    ? 'Recalled with the first letter.'
                    : outcome.verdict === 'close'
                      ? `Held. The notes spell it “${p.answer}”.`
                      : 'Held.'}
              </span>{' '}
              <span className="g-muted">{source}</span>
            </p>
          </div>
        )}

        {outcome && !outcome.correct && (
          <div className="space-y-2">
            <p className={`${SMALL} g-muted`}>
              {outcome.timedOut
                ? 'Time ran out.'
                : outcome.typed
                  ? `${outcome.picked ? 'Picked' : 'Wrote'} “${outcome.typed}”.`
                  : 'Shown.'}
            </p>
            <WrongHold
              wrong={
                <Sentence
                  p={p}
                  className="g-serif"
                  slot={
                    <span className="mx-0.5 px-1 line-through" style={{ textDecorationColor: 'var(--g-red)' }}>
                      {outcome.typed || '  '}
                    </span>
                  }
                />
              }
              right={
                <>
                  <Sentence p={p} className="g-serif" slot={<Filled text={p.answer} state="missed" />} />
                  <span className={`block ${SMALL} g-muted`}>{source}</span>
                </>
              }
              onSettled={() => setSettled(true)}
            />
          </div>
        )}

        {outcome && (
          <div className="flex justify-end">
            <button ref={nextRef} type="button" className="g-btn is-primary" onClick={onNext} disabled={!settled}>
              {last ? 'Continue' : 'Next link'}
            </button>
          </div>
        )}
      </GameCard>
    </div>
  );
}

/** A solved link stays on the thread: the sentence with its word back in place. */
function SolvedLink({ round, state }: { round: MechanicRound<ClozePayload>; state: LinkState }) {
  return (
    <div className="space-y-1">
      <Sentence p={round.payload} className="g-serif text-[17px] leading-relaxed" slot={<Filled text={round.payload.answer} state={state} />} />
      <p className={`${SMALL} g-muted`}>
        <span className="g-mono">{round.blockId}</span>
      </p>
    </div>
  );
}

export function ClozeBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<ClozePayload>) {
  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<LinkState[]>([]);
  const done = useRef(false);

  useEffect(() => {
    if (rounds.length === 0 && !done.current) {
      done.current = true;
      onPhaseDone();
    }
  }, [rounds.length, onPhaseDone]);

  if (!rounds[index]) return null;

  const answered = (r: RoundResult, state: LinkState) => {
    onResult(r);
    setStates((xs) => [...xs, state]);
  };
  const next = () => {
    if (index + 1 < rounds.length) setIndex(index + 1);
    else if (!done.current) {
      done.current = true;
      onPhaseDone();
    }
  };

  const objective = rounds[0]?.objectiveId;

  return (
    <div className="space-y-5">
      <div className={`${LABEL} g-muted`}>
        {phase === 'discovery' ? 'The thread' : `The thread${objective ? ` · ${objective}` : ''}, under pressure`}
      </div>
      <div className="relative">
      <span className="absolute bottom-2 left-[7px] top-2 w-[2px]" style={{ background: 'var(--g-rule)' }} aria-hidden="true" />
      <ol className="relative space-y-5" aria-label="Linked sentences">
        {rounds.map((r, i) => {
          const state = states[i];
          const dot = i < index || state ? (state ? TONE[state] : 'var(--g-rule)') : i === index ? 'var(--g-gold)' : 'var(--g-card)';
          return (
            <li key={r.id} className="relative pl-8">
              <span
                className="absolute left-0 top-[0.55em] h-4 w-4 rounded-full border-2"
                style={{ background: dot, borderColor: i <= index ? dot : 'var(--g-rule)' }}
                aria-hidden="true"
              />
              {i < index && state ? (
                <SolvedLink round={r} state={state} />
              ) : i === index ? (
                <Round key={r.id} round={r} phase={phase} onAnswered={answered} onNext={next} last={index + 1 === rounds.length} />
              ) : (
                <div className="h-6" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
      </div>
    </div>
  );
}
