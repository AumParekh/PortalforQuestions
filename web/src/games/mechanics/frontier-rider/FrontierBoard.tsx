// Frontier Rider board. A live mean–standard deviation plane, one input on a native range slider,
// one portfolio marked. The slider stays locked until the player calls where the portfolio goes.
// Then it moves: in discovery the player drags it; under pressure the call is timed and the
// move plays by itself. While it moves, the old frontier and line stay behind as a dotted ghost
// and the new ones re-form over them; the rider leaves a trail. When it arrives, a right call
// locks with a pulse. A wrong call keeps its red arrow for a beat (it bounces), and the true path
// and the notes' reasoning fade in underneath. Tiny moves also get a close-up plane.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import { GameCard, TimerBar } from '../../theme/primitives';
import type { Pt, State } from './maths';
import { applySlider, easeInOut, fmt, riderOf, snapToGrid, solveState } from './maths';
import type { FrOption, FrontierPayload } from './build';
import { axisShort, factLines, lineName, pointName, sliderValue } from './build';
import type { CallStatus, RiderStatus } from './Plane';
import { Plane } from './Plane';
import './frontier-rider.css';

const HOLD_MS = 800;
const FADE_MS = 520;
const LOCK_MS = 420;
/** Full slider sweep when the move plays by itself. */
const PLAY_MS = 1600;

type Stage = 'predict' | 'watch' | 'revealed';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function Legend({ payload, named, moved, called, revealedWrong }: { payload: FrontierPayload; named: boolean; moved: boolean; called: boolean; revealedWrong: boolean }) {
  const item = payload.item;
  const rows: { key: string; swatch: JSX.Element; text: string }[] = [
    {
      key: 'rider',
      swatch: <circle className="fr-rider is-idle" cx="15" cy="7" r="6" />,
      text: `the marked portfolio: ${pointName(item, item.point, named)}`,
    },
    {
      key: 'frontier',
      swatch: <path className="fr-frontier" d="M2,7 L28,7" />,
      text: named ? 'efficient frontier (faint: its inefficient half)' : 'lowest-risk mixes for each return (faint: the wasteful half)',
    },
  ];
  if (item.path.states[0].tangency || item.path.states[item.path.states.length - 1].tangency) {
    rows.push({ key: 'cal', swatch: <path className="fr-cal" d="M2,7 L28,7" />, text: lineName(item, named) });
  }
  if (item.point !== 'tangency') rows.push({ key: 'tan', swatch: <circle className="fr-tan" cx="15" cy="7" r="5" />, text: pointName(item, 'tangency', named) });
  if (item.point !== 'min-variance') {
    rows.push({ key: 'mv', swatch: <rect className="fr-mv" x="10" y="2" width="9" height="9" transform="rotate(45 14.5 6.5)" />, text: pointName(item, 'min-variance', named) });
  }
  rows.push({ key: 'asset', swatch: <circle className="fr-asset" cx="15" cy="7" r="4" />, text: item.plane.active ? 'the managers' : 'the holdings' });
  if (moved) rows.push({ key: 'ghost', swatch: <path className="fr-ghost-swatch" d="M2,7 L28,7" />, text: 'before the slider moved' });
  if (moved) rows.push({ key: 'trail', swatch: <path className="fr-trail" d="M2,7 L28,7" />, text: 'where the marked portfolio has been' });
  if (revealedWrong) rows.push({ key: 'truth', swatch: <path className="fr-path is-truth" d="M2,7 L28,7" />, text: 'the true path' });
  if (called && payload.kind === 'move') rows.push({ key: 'call', swatch: <path className="fr-call-swatch" d="M2,7 L28,7" />, text: 'your call' });
  return (
    <ul className="fr-legend flex flex-wrap gap-x-5 gap-y-1" aria-label="Legend">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2">
          <svg width="30" height="14" viewBox="0 0 30 14" aria-hidden="true" className="shrink-0">
            {r.swatch}
          </svg>
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

function tickLeft(from: number, to: number, v: number): string {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const frac = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return `calc(14px + (100% - 28px) * ${frac.toFixed(4)})`;
}

function Round({
  round,
  phase,
  onAnswered,
  onNext,
  last,
}: {
  round: MechanicRound<FrontierPayload>;
  phase: PlayPhase;
  onAnswered: (r: RoundResult) => void;
  onNext: () => void;
  last: boolean;
}) {
  const p = round.payload;
  const item = p.item;
  const sl = item.slider;
  const timed = phase === 'pressure';
  const named = phase === 'pressure';
  const [stage, setStage] = useState<Stage>('predict');
  const [choice, setChoice] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [value, setValue] = useState(sl.from);
  const [settled, setSettled] = useState(false);
  const [playing, setPlaying] = useState(false);
  const started = useRef(performance.now());
  const answeredRef = useRef(false);
  const revealedRef = useRef(false);
  const raf = useRef<number | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const lastGood = useRef<State>(item.path.states[0]);

  const solved = useMemo(() => solveState(applySlider(item.base, sl.param, value)), [item, sl.param, value]);
  if (solved && riderOf(solved, item.point)) lastGood.current = solved;
  const cur = lastGood.current;
  const rider = riderOf(cur, item.point) ?? item.path.points[0];
  const from = item.path.points[0];
  const moved = Math.abs(value - sl.from) > sl.step * 1e-6;
  const dir = Math.sign(sl.to - sl.from);

  const trail = useMemo(() => {
    const out: Pt[] = [];
    item.path.grid.forEach((g, k) => {
      if ((g - sl.from) * dir <= (value - sl.from) * dir + 1e-12) out.push(item.path.points[k]);
    });
    out.push(rider);
    return out;
  }, [item, sl.from, dir, value, rider]);

  const correct = p.options.find((o) => o.correct) as FrOption;
  const picked = p.options.find((o) => o.key === choice) ?? null;
  const right = !!picked && picked.correct;
  const revealed = stage === 'revealed';

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const reveal = () => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    setStage('revealed');
  };

  /** Glide the slider to `target` (the move plays by itself); reveals on arrival at slider.to. */
  const play = (fromValue: number, target: number, then?: () => void) => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (prefersReducedMotion()) {
      setValue(target);
      setPlaying(false);
      then?.();
      return;
    }
    const span = Math.abs(sl.to - sl.from);
    const ms = Math.max(350, (PLAY_MS * Math.abs(target - fromValue)) / span);
    const t0 = performance.now();
    setPlaying(true);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const v = fromValue + (target - fromValue) * easeInOut(k);
      setValue(k >= 1 ? target : v);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else {
        raf.current = null;
        setPlaying(false);
        then?.();
      }
    };
    raf.current = requestAnimationFrame(step);
  };

  const answer = (key: string | null, byTimer: boolean) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    const opt = p.options.find((o) => o.key === key);
    setChoice(key);
    setTimedOut(byTimer);
    setStage('watch');
    onAnswered({ roundId: round.id, correct: !!opt?.correct, timeMs: performance.now() - started.current, timedOut: byTimer });
    // Under pressure the move plays itself; in discovery the player drags (or taps "Play the move").
    if (timed) window.setTimeout(() => play(sl.from, sl.to, reveal), prefersReducedMotion() ? 0 : 260);
  };

  const onSlide = (e: ChangeEvent<HTMLInputElement>) => {
    if (stage === 'predict' || playing) return;
    const v = snapToGrid(Number(e.currentTarget.value), sl.from, sl.to, sl.step);
    setValue(v);
    if (stage === 'watch' && Math.abs(v - sl.to) < sl.step / 2) reveal();
  };

  // Pressure clock on the call.
  useEffect(() => {
    if (!timed || stage !== 'predict' || !round.timeLimitMs) return;
    const left = Math.max(0, round.timeLimitMs - (performance.now() - started.current));
    const t = window.setTimeout(() => answer(null, true), left);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, stage]);

  // A right call locks quickly; a wrong one holds for a beat, then the truth fades in.
  useEffect(() => {
    if (!revealed) return;
    const ms = prefersReducedMotion() ? (right ? 0 : HOLD_MS) : right ? LOCK_MS : HOLD_MS + FADE_MS;
    const t = window.setTimeout(() => setSettled(true), ms);
    return () => window.clearTimeout(t);
  }, [revealed, right]);

  useEffect(() => {
    if (settled) nextRef.current?.focus();
  }, [settled]);

  // Keyboard: 1-4 to call.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (stage !== 'predict' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = Number(e.key);
      if (Number.isInteger(k) && k >= 1 && k <= p.options.length) {
        e.preventDefault();
        answer(p.options[k - 1].key, false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const callStatus: CallStatus = !revealed ? 'pending' : right ? 'right' : 'wrong';
  const call = p.kind === 'move' && picked?.move ? { move: picked.move, status: callStatus } : null;
  const riderStatus: RiderStatus = revealed ? (right ? 'locked' : 'missed') : moved ? 'moving' : 'idle';
  const fullPath = revealed ? item.path.points : null;
  const xName = axisShort(item.plane.xLabel);
  const yName = axisShort(item.plane.yLabel);
  const clipBase = `fr-${round.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const chartLabel = (where: string) =>
    `${where}. The marked portfolio is at ${xName} ${fmt(rider.sigma, 2)}% and ${yName} ${fmt(rider.mu, 2)}%.`;
  const facts = factLines(item, named);
  const source = `block ${round.blockId}${item.sourceLine ? ` · ${item.readingId} l.${item.sourceLine}` : ''}`;
  const lo = Math.min(sl.from, sl.to);
  const hi = Math.max(sl.from, sl.to);

  const planeProps = { item, cur, rider, ghost: moved ? item.path.states[0] : null, trail, fullPath, call, riderStatus };

  const truth = (
    <div className="space-y-3">
      <p className="fr-text">
        <span className="g-strong">{correct.label}</span>
        {correct.why && <span className="block mt-1">{correct.why}</span>}
      </p>
      <ul className="fr-facts space-y-1">
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <p className="fr-reading">{item.explanation}</p>
      <p className="fr-source">{source}</p>
    </div>
  );

  return (
    <GameCard className="g-enter relative space-y-5 !px-4 sm:!px-6">
      {timed && stage === 'predict' && round.timeLimitMs && <TimerBar ms={round.timeLimitMs} />}

      <div className="space-y-2">
        {p.kind === 'move' && <p className="fr-title">{item.title}</p>}
        <p className="fr-question">{p.question}</p>
      </div>

      <figure className="space-y-2">
        <figcaption className="fr-chart-title">
          {yName.charAt(0).toUpperCase() + yName.slice(1)} against {xName}
        </figcaption>
        <div className="fr-axis-title">↑ {item.plane.yLabel}</div>
        <Plane {...planeProps} win={item.main} variant="main" clipId={`${clipBase}-main`} label={chartLabel('Risk–return plane')} />
        <div className="fr-axis-title text-right">{item.plane.xLabel} →</div>
      </figure>

      {/* Only after the call: showing a close-up earlier would hint that the move is small. */}
      {item.loupe && stage !== 'predict' && (
        <figure className="fr-loupe space-y-2">
          <figcaption className="fr-chart-title">Close-up around the marked portfolio</figcaption>
          <p className="fr-note">Both axes are stretched so a small move shows; the directions are true.</p>
          <Plane {...planeProps} win={item.loupe} variant="loupe" clipId={`${clipBase}-loupe`} label={chartLabel('Close-up')} />
          <div className="fr-axis-title text-right">{xName} →</div>
        </figure>
      )}

      <Legend payload={p} named={named} moved={moved} called={!!picked} revealedWrong={revealed && !right} />

      {/* The slider: locked until the call. */}
      <div className={`fr-slider${stage === 'predict' ? ' is-locked' : ''}${stage === 'watch' && !timed && !playing ? ' is-live' : ''}${revealed ? (right ? ' is-done' : ' is-missed') : ''}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <label htmlFor={`${clipBase}-range`} className="fr-param-label">
            {sl.label}
          </label>
          <span className="fr-value" aria-hidden="true">
            {sliderValue(item, value)}
          </span>
        </div>
        <div className="fr-track relative">
          <input
            id={`${clipBase}-range`}
            type="range"
            className="fr-range"
            min={lo}
            max={hi}
            step={sl.step}
            value={value}
            disabled={stage === 'predict' || playing}
            aria-valuetext={sliderValue(item, value)}
            onChange={onSlide}
          />
          <span className="fr-tick" style={{ left: tickLeft(sl.from, sl.to, sl.from) }} aria-hidden="true" />
          <span className="fr-tick is-to" style={{ left: tickLeft(sl.from, sl.to, sl.to) }} aria-hidden="true" />
        </div>
        <div className="flex justify-between gap-3 fr-note">
          <span>{sliderValue(item, lo)}</span>
          <span>{sliderValue(item, hi)}</span>
        </div>
        {stage !== 'predict' && (
          <p className="fr-readout">
            Marked portfolio now: {xName} <span className="fr-num">{fmt(rider.sigma, 2)}%</span>, {yName}{' '}
            <span className="fr-num">{fmt(rider.mu, 2)}%</span>
            {item.point === 'complete' && (
              <>
                , in the {item.plane.active ? 'manager mix' : 'risky mix'} <span className="fr-num">{fmt(rider.y * 100, 1)}%</span>
              </>
            )}
            {moved && (
              <span className="fr-note block">
                started at {fmt(from.sigma, 2)}%, {fmt(from.mu, 2)}%
              </span>
            )}
          </p>
        )}
      </div>

      {stage === 'predict' && (
        <p className="fr-note">{timed ? 'Call it before the clock runs out. Keys 1–' + p.options.length + ' work too.' : 'Call it first. The slider unlocks once you have.'}</p>
      )}

      <div className="grid gap-2" role="group" aria-label="Your call">
        {p.options.map((o, i) => {
          const cls = [
            'fr-option',
            o.key === choice ? 'is-picked' : '',
            revealed && o.correct ? 'is-right' : '',
            revealed && o.key === choice && !o.correct ? 'is-wrong' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button key={o.key} type="button" className={cls} disabled={stage !== 'predict'} onClick={() => answer(o.key, false)} aria-pressed={o.key === choice}>
              <span className="fr-option-key" aria-hidden="true">
                {i + 1}
              </span>
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>

      {stage === 'watch' && !timed && !playing && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="fr-note flex-1">
            Called. Now drag the slider to <span className="fr-num">{sliderValue(item, sl.to)}</span> and watch the marked portfolio.
          </p>
          <button type="button" className="g-btn" onClick={() => play(value, sl.to, reveal)}>
            Play the move
          </button>
        </div>
      )}
      {stage === 'watch' && (timed || playing) && <p className="fr-note">{timedOut ? 'Time ran out. Watch where it goes.' : 'Watch.'}</p>}

      {revealed && right && (
        <div className="fr-right g-assemble" aria-live="polite">
          {truth}
        </div>
      )}

      {revealed && !right && (
        <div className="space-y-3">
          <div className="fr-held">
            <p className="fr-text">
              {timedOut || !picked ? (
                'Time ran out before a call.'
              ) : (
                <>
                  You called: <span className="g-strong">{picked.label}</span>
                </>
              )}
            </p>
            {picked?.why && <p className="fr-text fr-muted">{picked.why}</p>}
          </div>
          <div className="fr-hold-right" style={{ '--fr-delay': `${HOLD_MS}ms` } as CSSProperties} aria-live="polite">
            {truth}
          </div>
        </div>
      )}

      {revealed && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="g-btn is-quiet" onClick={() => play(sl.from, sl.to)} disabled={playing}>
            Replay the move
          </button>
          <button ref={nextRef} type="button" className="g-btn is-primary" onClick={onNext} disabled={!settled}>
            {last ? 'Continue' : 'Next call'}
          </button>
        </div>
      )}
    </GameCard>
  );
}

/** One short rule per call this phase: pending, current, right, wrong. No numbers. */
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

export function FrontierBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<FrontierPayload>) {
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
    if (index + 1 < rounds.length) {
      setIndex(index + 1);
      window.scrollTo?.({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } else if (!done.current) {
      done.current = true;
      onPhaseDone();
    }
  };

  return (
    <div className="space-y-5">
      <div className="fr-phase-label">{phase === 'discovery' ? 'Call it, then watch' : 'Under pressure'}</div>
      <Docket total={rounds.length} index={index} results={results} />
      <Round key={round.id} round={round} phase={phase} onAnswered={answered} onNext={next} last={index + 1 === rounds.length} />
    </div>
  );
}
