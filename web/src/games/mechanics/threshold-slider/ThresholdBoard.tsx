// Threshold Slider board. Each round is one number cut out of the notes: the sentence (discovery)
// or a short cue (pressure) sits above a straight scale, and the blank fills live as the marker
// moves. Drag snaps to detents; arrow keys step a detent, Shift+arrow the finest step, Page keys a
// tick; the ± buttons step finely by tap; or type the value and press Enter. Locking in drops a
// green post where the notes draw the line; a miss holds the player's mark for a beat, then the
// sentence is shown whole.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import type { SliderPayload, Verdict } from './build';
import { decimalsOf, formatValue, judge, parseTyped, roundTo } from './build';
import { GameButton, GameCard, NoteText, ShatterBurst, TimerBar, WrongHold } from '../../theme/primitives';
import './threshold-slider.css';

type Round = MechanicRound<SliderPayload>;

interface Outcome {
  verdict: Verdict;
  timedOut: boolean;
  /** What the player locked in; null when the clock ran out untouched. */
  guess: number | null;
}

/** Grade for a near miss: still a lapse in SM-2 (< 3), but above a plain miss. */
const CLOSE_GRADE = 2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Snaps to a grid anchored at the scale's low end, on the fine grid, inside the scale. */
function snap(v: number, p: SliderPayload, grid: number): number {
  const { lo, hi, fine } = p.scale;
  return clamp(roundTo(lo + Math.round((v - lo) / grid) * grid, fine), lo, hi);
}

function pct(v: number, p: SliderPayload): number {
  const { lo, hi } = p.scale;
  return (clamp(v, lo, hi) - lo) / (hi - lo) * 100;
}

/** Short tick label: keeps a currency sign and a % but drops longer units ("trading days"). */
function tickLabel(v: number, p: SliderPayload): string {
  const unit = p.suffix.trim();
  const keep = unit === '%' || unit === '\\%' || unit.length <= 1 ? p.suffix : '';
  return formatValue(v, { ...p, suffix: keep.replace('\\%', '%') });
}

/** The value as the notes would write it, with a unit the reader can see ("\%" → "%"). */
function readout(v: number, p: SliderPayload): string {
  return formatValue(v, { ...p, suffix: p.suffix.replace('\\%', '%') });
}

function stepLabel(p: SliderPayload): string {
  const d = decimalsOf(p.scale.fine);
  return p.scale.fine.toFixed(d);
}

/** The notes' text with each blank rendered as a chip. */
function Sentence({ parts, fill, state }: { parts: string[]; fill: string | null; state: 'empty' | 'live' | 'right' | 'wrong' }) {
  return (
    <p className="g-reading ts-sentence">
      {parts.map((part, i) => (
        <span key={i}>
          <NoteText latex={part} />
          {i < parts.length - 1 && (
            <span className={`ts-blank is-${state}`} aria-label={fill ? undefined : 'blank'}>
              {fill ?? '?'}
            </span>
          )}
        </span>
      ))}
    </p>
  );
}

/** The notes' sentence with the number restored, as written. */
function Restored({ p }: { p: SliderPayload }) {
  return (
    <p className="g-serif ts-sentence" style={{ fontSize: '1.0625rem' }}>
      {p.parts.map((part, i) => (
        <span key={i}>
          <NoteText latex={part} />
          {i < p.parts.length - 1 && (
            <span className="ts-blank is-right">
              <NoteText latex={p.answerText} />
            </span>
          )}
        </span>
      ))}
    </p>
  );
}

function Scale({
  p,
  value,
  onChange,
  onCommit,
  disabled,
  reveal,
  scaleRef,
}: {
  p: SliderPayload;
  value: number | null;
  onChange: (v: number) => void;
  onCommit: () => void;
  disabled: boolean;
  reveal: { outcome: Outcome; now: boolean } | null;
  scaleRef: { current: HTMLDivElement | null };
}) {
  const band = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  // The ref answers pointermove before React re-renders with the new state.
  const draggingRef = useRef(false);
  const shown = value ?? p.scale.start;
  const tickStep = p.scale.ticks.length > 1 ? p.scale.ticks[1] - p.scale.ticks[0] : p.scale.detent * 10;
  const n = p.scale.ticks.length;
  // Wide screens label every other tick (at most six labels); a phone labels the ends and the middle.
  const labelEvery = Math.max(1, Math.ceil((n - 1) / 5));
  const mid = (n - 1) % 2 === 0 ? (n - 1) / 2 : -1;
  const wideLabel = (i: number) => i % labelEvery === 0;
  const narrowLabel = (i: number) => i === 0 || i === n - 1 || i === mid;

  const fromX = (clientX: number) => {
    const el = band.current;
    if (!el) return shown;
    const r = el.getBoundingClientRect();
    const f = r.width > 0 ? clamp((clientX - r.left) / r.width, 0, 1) : 0;
    return snap(p.scale.lo + f * (p.scale.hi - p.scale.lo), p, p.scale.detent);
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    onChange(fromX(e.clientX));
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current && !disabled) onChange(fromX(e.clientX));
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    draggingRef.current = false;
    setDragging(false);
  };

  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = e.shiftKey ? p.scale.fine : p.scale.detent;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = snap(shown + step, p, e.shiftKey ? p.scale.fine : p.scale.detent);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = snap(shown - step, p, e.shiftKey ? p.scale.fine : p.scale.detent);
        break;
      case 'PageUp':
        next = snap(shown + tickStep, p, p.scale.fine);
        break;
      case 'PageDown':
        next = snap(shown - tickStep, p, p.scale.fine);
        break;
      case 'Home':
        next = p.scale.lo;
        break;
      case 'End':
        next = p.scale.hi;
        break;
      case 'Enter':
        e.preventDefault();
        if (value !== null) onCommit();
        return;
      default:
        return;
    }
    e.preventDefault();
    onChange(next);
  };

  const o = reveal?.outcome;
  const thumbState = o ? (o.verdict === 'exact' ? 'is-right' : 'is-wrong') : value === null ? 'is-idle' : '';
  const tolLo = p.answer - p.tolerance;
  const tolHi = p.answer + p.tolerance;
  const showTol = !!o && p.approx;

  return (
    <div
      ref={(el: HTMLDivElement | null) => {
        scaleRef.current = el;
      }}
      className={`ts-scale${disabled ? ' is-disabled' : ''}${dragging ? ' is-dragging' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Set the number"
      aria-valuemin={p.scale.lo}
      aria-valuemax={p.scale.hi}
      aria-valuenow={shown}
      aria-valuetext={value === null ? 'not set' : readout(shown, p)}
      aria-disabled={disabled}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <div ref={band} className="ts-band">
        <span className="ts-rule" aria-hidden="true" />
        {value !== null && !o && <span className="ts-fill" style={{ width: `${pct(shown, p)}%` }} aria-hidden="true" />}
        {p.scale.ticks.map((t, i) => (
          <span key={i} className={`ts-tick${i % labelEvery === 0 ? ' is-major' : ''}`} style={{ left: `${pct(t, p)}%` }} aria-hidden="true" />
        ))}
        {showTol && (
          <span
            className="ts-tol"
            style={{ left: `${pct(tolLo, p)}%`, width: `${Math.max(0.6, pct(tolHi, p) - pct(tolLo, p))}%` }}
            aria-hidden="true"
          />
        )}
        {o && <span className={`ts-post${reveal?.now ? ' is-now' : ''}`} style={{ left: `${pct(p.answer, p)}%` }} aria-hidden="true" />}
        {(value !== null || !o) && (
          <span className={`ts-thumb ${thumbState}`} style={{ left: `${pct(o?.guess ?? shown, p)}%` }} aria-hidden="true" />
        )}
        {o?.verdict === 'exact' && (
          <span className="ts-burst-at" style={{ left: `${pct(p.answer, p)}%` }} aria-hidden="true">
            <ShatterBurst />
          </span>
        )}
      </div>
      <div className="ts-ticklabels" aria-hidden="true">
        {p.scale.ticks.map((t, i) =>
          wideLabel(i) || narrowLabel(i) ? (
            <span
              key={i}
              className={[
                i === 0 ? 'is-first' : '',
                i === n - 1 ? 'is-last' : '',
                !narrowLabel(i) ? 'is-wide' : '',
                !wideLabel(i) ? 'is-narrow' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: `${pct(t, p)}%` }}
            >
              {tickLabel(t, p)}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function RoundCard({
  round,
  phase,
  onAnswered,
  onNext,
  last,
}: {
  round: Round;
  phase: PlayPhase;
  onAnswered: (r: RoundResult) => void;
  onNext: () => void;
  last: boolean;
}) {
  const p = round.payload;
  const timed = phase === 'pressure';
  const [value, setValue] = useState<number | null>(null);
  const valueRef = useRef<number | null>(null);
  valueRef.current = value;
  const [typed, setTyped] = useState('');
  const [typedBad, setTypedBad] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settled, setSettled] = useState(false);
  const started = useRef(performance.now());
  const scaleRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const inputId = `ts-input-${round.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  // Guards against a second report in the same tick (a double tap on Lock in, or the clock
  // firing as the player locks in) before the outcome state has re-rendered.
  const reported = useRef(false);
  const finish = (o: Outcome) => {
    if (outcome || reported.current) return;
    reported.current = true;
    setOutcome(o);
    if (o.verdict === 'exact') setSettled(true);
    onAnswered({
      roundId: round.id,
      correct: o.verdict === 'exact',
      timeMs: performance.now() - started.current,
      timedOut: o.timedOut,
      grade: o.verdict === 'close' && !o.timedOut ? CLOSE_GRADE : undefined,
    });
  };

  const commit = (v: number | null = value) => {
    if (outcome || v === null) return;
    finish({ verdict: judge(v, p), timedOut: false, guess: v });
  };

  const change = (v: number) => {
    if (outcome) return;
    setValue(v);
    setTyped('');
    setTypedBad(false);
  };

  const nudge = (dir: 1 | -1) => change(snap((value ?? p.scale.start) + dir * p.scale.fine, p, p.scale.fine));

  const onType = (s: string) => {
    setTyped(s);
    const v = parseTyped(s);
    setTypedBad(s.trim() !== '' && v === null);
    // The typed number is judged exactly as typed; the marker follows it (pinned at an end if outside).
    if (v !== null && !outcome) setValue(v);
  };

  // Keyboard players start on the scale.
  useEffect(() => {
    scaleRef.current?.focus({ preventScroll: true });
  }, []);

  // Pressure clock: whatever is set when it runs out is not locked in; the round is a miss.
  useEffect(() => {
    if (!timed || outcome) return;
    const left = Math.max(0, (round.timeLimitMs ?? 16000) - (performance.now() - started.current));
    const t = window.setTimeout(() => finish({ verdict: 'off', timedOut: true, guess: valueRef.current }), left);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, outcome]);

  useEffect(() => {
    if (outcome && settled) nextRef.current?.focus({ preventScroll: true });
  }, [outcome, settled]);

  const live = value === null ? null : readout(value, p);
  const answer = readout(p.answer, p);
  const shownParts = phase === 'discovery' ? p.parts : p.cue;

  return (
    <GameCard className="g-enter relative space-y-5">
      {timed && !outcome && <TimerBar ms={round.timeLimitMs ?? 16000} />}

      {!outcome && (
        <div className="space-y-2">
          {phase === 'pressure' && p.lead && (
            <p className="ts-lead">
              <NoteText latex={p.lead} />
            </p>
          )}
          <Sentence parts={shownParts} fill={live} state={live === null ? 'empty' : 'live'} />
        </div>
      )}

      {outcome && outcome.verdict === 'exact' && (
        <div className="g-assemble space-y-1 border-l-[3px] pl-4" style={{ borderColor: 'var(--g-green)' }} role="status">
          <p className="ts-small">
            <span className="g-strong">On the line: {answer}.</span>
          </p>
          <Restored p={p} />
        </div>
      )}

      {outcome && outcome.verdict !== 'exact' && (
        <div className="space-y-2">
          <p className="ts-small g-muted">
            {outcome.timedOut
              ? outcome.guess === null
                ? 'Time ran out before a mark was set.'
                : `Time ran out with the marker on ${readout(outcome.guess, p)}, not locked in.`
              : outcome.verdict === 'close'
                ? `Close, at ${readout(outcome.guess ?? 0, p)}, but not where the notes draw the line.`
                : `Set at ${readout(outcome.guess ?? 0, p)}.`}
          </p>
          <WrongHold
            wrong={<Sentence parts={shownParts} fill={outcome.guess === null ? null : readout(outcome.guess, p)} state="wrong" />}
            right={
              <>
                <span className="ts-small g-strong block">The notes: {answer}</span>
                <Restored p={p} />
              </>
            }
            onSettled={() => setSettled(true)}
          />
        </div>
      )}

      <div className="space-y-3">
        <div className={`ts-readout${value === null ? ' is-idle' : ''}`} aria-hidden="true">
          {outcome
            ? outcome.verdict === 'exact'
              ? answer
              : `${outcome.guess === null ? '—' : readout(outcome.guess, p)}${settled ? ` → ${answer}` : ''}`
            : (live ?? '—')}
        </div>
        <Scale
          p={p}
          value={outcome ? (outcome.guess ?? null) : value}
          onChange={change}
          onCommit={() => commit()}
          disabled={!!outcome}
          reveal={outcome ? { outcome, now: outcome.verdict === 'exact' } : null}
          scaleRef={scaleRef}
        />
      </div>

      {!outcome && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <GameButton className="ts-step" onClick={() => nudge(-1)} ariaLabel={`Down by ${stepLabel(p)}`}>
              −
            </GameButton>
            <GameButton className="ts-step" onClick={() => nudge(1)} ariaLabel={`Up by ${stepLabel(p)}`}>
              +
            </GameButton>
            <span className="ts-small g-muted">steps of {stepLabel(p)}</span>
          </div>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const v = parseTyped(typed);
              if (v !== null) commit(v);
              else if (typed.trim() === '') commit();
              else setTypedBad(true);
            }}
          >
            <label className="min-w-[10rem] flex-1 space-y-1" htmlFor={inputId}>
              <span className="ts-small g-muted block">Or type it</span>
              <input
                id={inputId}
                className="ts-input"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                aria-invalid={typedBad}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onType(e.currentTarget.value)}
              />
            </label>
            <GameButton type="submit" variant="primary" disabled={value === null && parseTyped(typed) === null}>
              Lock in
            </GameButton>
          </form>
          {typedBad && <p className="ts-small" style={{ color: 'var(--g-red)' }}>That is not a number the scale can take.</p>}
          <p className="ts-small g-muted">Drag the marker, use the arrow keys (Shift for the finest step), or type. Enter locks it in.</p>
        </div>
      )}

      {outcome && (
        <div className="flex justify-end">
          <button ref={nextRef} type="button" className="g-btn is-primary" onClick={onNext} disabled={!settled}>
            {last ? 'Continue' : 'Next number'}
          </button>
        </div>
      )}
    </GameCard>
  );
}

/** One short rule per round this phase: pending, current, on the line, missed. No numbers. */
function Ledger({ total, index, results }: { total: number; index: number; results: boolean[] }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => {
        const bg = i < results.length ? (results[i] ? 'var(--g-green)' : 'var(--g-red)') : i === index ? 'var(--g-gold)' : 'var(--g-rule)';
        return <span key={i} className="h-1 flex-1" style={{ background: bg }} />;
      })}
    </div>
  );
}

export function ThresholdBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<SliderPayload>) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const done = useRef(false);
  const safeRounds = useMemo(() => rounds.filter((r) => r.payload && r.payload.scale && r.payload.parts.length >= 2), [rounds]);

  useEffect(() => {
    if (safeRounds.length === 0 && !done.current) {
      done.current = true;
      onPhaseDone();
    }
  }, [safeRounds.length, onPhaseDone]);

  const round = safeRounds[index];
  if (!round) return null;

  const answered = (r: RoundResult) => {
    onResult(r);
    setResults((xs) => [...xs, r.correct]);
  };
  const next = () => {
    if (index + 1 < safeRounds.length) setIndex(index + 1);
    else if (!done.current) {
      done.current = true;
      onPhaseDone();
    }
  };

  return (
    <div className="space-y-5">
      <div className="ts-label">{phase === 'discovery' ? 'Find the line' : 'Under pressure'}</div>
      <Ledger total={safeRounds.length} index={index} results={results} />
      <RoundCard key={round.id} round={round} phase={phase} onAnswered={answered} onNext={next} last={index + 1 === safeRounds.length} />
    </div>
  );
}
