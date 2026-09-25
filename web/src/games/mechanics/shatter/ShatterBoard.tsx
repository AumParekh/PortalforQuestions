import { useEffect, useRef, useState } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import type { ShatterPayload, Verdict } from './build';
import { GameButton, GameCard, InlineMath, NoteText, ShatterBurst, TimerBar, WrongHold } from '../../theme/primitives';

const VERDICTS: { v: Verdict; key: string; hint: string }[] = [
  { v: 'TRUE', key: 't', hint: 'stands as written' },
  { v: 'FLIPPED', key: 'f', hint: 'one word turned around' },
  { v: 'SWAPPED', key: 's', hint: 'one idea traded for its neighbour' },
];

/** Name-the-break window under pressure, after a correct ruling. */
const NAME_LIMIT_MS = 7000;
const AUTO_ADVANCE_MS = 1200;

type Stage = 'classify' | 'name' | 'done';

interface Outcome {
  correct: boolean;
  timedOut: boolean;
  ruling: Verdict | null;
  tapped: number | null;
  picked: string | null;
}

function Statement({
  p,
  tappable,
  onTap,
  marks,
}: {
  p: ShatterPayload;
  tappable: boolean;
  onTap?: (i: number) => void;
  marks?: { flip?: boolean; tapped?: number | null; hitOk?: boolean };
}) {
  return (
    <p className="g-reading">
      {p.tokens.map((t, i) => {
        const cls = [
          'g-token',
          tappable ? 'is-tappable' : '',
          marks?.flip && p.flipIdx.includes(i) ? 'is-flip' : '',
          marks?.tapped === i ? (marks.hitOk ? 'is-hit' : 'is-miss') : '',
        ]
          .filter(Boolean)
          .join(' ');
        const body = t.math ? <InlineMath tex={t.text} /> : t.text;
        return (
          <span key={i}>
            {tappable ? (
              <button type="button" className={cls} onClick={() => onTap?.(i)}>
                {body}
              </button>
            ) : (
              <span className={cls}>{body}</span>
            )}{' '}
          </span>
        );
      })}
    </p>
  );
}

function Round({
  round,
  phase,
  onAnswered,
  onNext,
  last,
}: {
  round: MechanicRound<ShatterPayload>;
  phase: PlayPhase;
  onAnswered: (r: RoundResult) => void;
  onNext: () => void;
  last: boolean;
}) {
  const p = round.payload;
  const [stage, setStage] = useState<Stage>('classify');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [ruling, setRuling] = useState<Verdict | null>(null);
  const [settled, setSettled] = useState(false);
  const started = useRef(performance.now());
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const timed = phase === 'pressure';

  const finish = (o: Outcome) => {
    if (outcome) return;
    setOutcome(o);
    setStage('done');
    if (o.correct) setSettled(true);
    onAnswered({ roundId: round.id, correct: o.correct, timeMs: performance.now() - started.current, timedOut: o.timedOut });
  };

  const rule = (v: Verdict) => {
    if (stage !== 'classify') return;
    setRuling(v);
    if (v !== p.verdict) return finish({ correct: false, timedOut: false, ruling: v, tapped: null, picked: null });
    if ((v === 'FLIPPED' && p.flipIdx.length) || (v === 'SWAPPED' && p.swap)) return setStage('name');
    finish({ correct: true, timedOut: false, ruling: v, tapped: null, picked: null });
  };
  const tap = (i: number) =>
    stage === 'name' && finish({ correct: p.flipIdx.includes(i), timedOut: false, ruling, tapped: i, picked: null });
  const pick = (opt: string) =>
    stage === 'name' && finish({ correct: opt === p.swap?.answer, timedOut: false, ruling, tapped: null, picked: opt });

  // Pressure timers: one for the ruling, a fresh one for naming the break.
  useEffect(() => {
    if (!timed || stage === 'done') return;
    const ms = stage === 'classify' ? (round.timeLimitMs ?? 8000) : NAME_LIMIT_MS;
    const t = window.setTimeout(() => finish({ correct: false, timedOut: true, ruling, tapped: null, picked: null }), ms);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, timed]);

  // Keyboard: T / F / S to rule; Enter for next once feedback has settled.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (stage === 'classify') {
        const hit = VERDICTS.find((x) => x.key === e.key.toLowerCase());
        if (hit) {
          e.preventDefault();
          rule(hit.v);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (stage !== 'done' || !settled) return;
    nextRef.current?.focus();
    if (timed && outcome?.correct) {
      const t = window.setTimeout(onNext, AUTO_ADVANCE_MS);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, settled]);

  // No trap-category names before the naming step (§11): discovery cites the block only.
  const source = phase === 'discovery' || !p.category ? `block ${round.blockId}` : `${p.category} · block ${round.blockId}`;
  const verdictLine =
    p.verdict === 'TRUE' ? 'Stands as written.' : p.verdict === 'FLIPPED' ? 'Flipped. The notes say:' : 'Swapped. The notes say:';

  return (
    <GameCard className="g-enter relative space-y-5">
      {timed && stage !== 'done' && <TimerBar key={stage} ms={stage === 'classify' ? (round.timeLimitMs ?? 8000) : NAME_LIMIT_MS} />}

      {stage !== 'done' && <Statement p={p} tappable={stage === 'name' && p.verdict === 'FLIPPED'} onTap={tap} />}

      {stage === 'classify' && (
        <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Rule on the statement">
          {VERDICTS.map(({ v, key, hint }) => (
            <GameButton key={v} onClick={() => rule(v)} className="!h-auto flex-col !rounded-xl py-3">
              <span className="tracking-wide">{v}</span>
              <span className="g-small g-muted font-normal">
                {hint} <span className="g-mono">({key.toUpperCase()})</span>
              </span>
            </GameButton>
          ))}
        </div>
      )}

      {stage === 'name' && p.verdict === 'FLIPPED' && <p className="g-small g-muted">Right. Now tap the word that was turned around.</p>}
      {stage === 'name' && p.verdict === 'SWAPPED' && p.swap && (
        <div className="space-y-3">
          <p className="g-small g-muted">Right. One idea was traded for its neighbour. Which one belongs?</p>
          <div className="flex flex-wrap gap-2">
            {p.swap.options.map((o) => (
              <GameButton key={o} onClick={() => pick(o)} className="!h-auto py-2 text-left font-normal">
                <NoteText latex={o} />
              </GameButton>
            ))}
          </div>
        </div>
      )}

      {stage === 'done' && outcome && outcome.correct && (
        <div className="space-y-4">
          <div className="relative">
            <Statement p={p} tappable={false} marks={{ flip: p.verdict === 'FLIPPED', tapped: outcome.tapped, hitOk: true }} />
            <ShatterBurst />
          </div>
          {p.verdict === 'TRUE' ? (
            <p className="g-settle g-small">
              <span className="g-strong">Stands as written.</span> <span className="g-muted">{source}</span>
            </p>
          ) : (
            <div className="g-assemble border-l-[3px] pl-4" style={{ borderColor: 'var(--g-green)' }}>
              <p className="g-serif">
                <NoteText latex={p.correct} />
              </p>
              {p.swap && (
                <p className="g-small">
                  <span className="g-strong">{p.swap.answer}</span>, not {p.swap.swappedIn}.
                </p>
              )}
              <p className="g-source">{source}</p>
            </div>
          )}
        </div>
      )}

      {stage === 'done' && outcome && !outcome.correct && (
        <div className="space-y-3">
          <p className="g-small g-muted">
            {outcome.timedOut ? 'Time ran out.' : outcome.ruling && outcome.ruling !== p.verdict ? `Ruled ${outcome.ruling}.` : outcome.picked ? `Picked "${outcome.picked}".` : 'That word is not the break.'}
          </p>
          <WrongHold
            wrong={<Statement p={p} tappable={false} marks={{ flip: false, tapped: outcome.tapped, hitOk: false }} />}
            right={
              <>
                <span className="g-strong">{verdictLine}</span>{' '}
                <NoteText latex={p.correct} />
                {p.swap && (
                  <span className="block g-small mt-1">
                    {p.swap.answer}, not {p.swap.swappedIn}.
                  </span>
                )}
              </>
            }
            source={source}
            onSettled={() => setSettled(true)}
          />
        </div>
      )}

      {stage === 'done' && (
        <div className="flex justify-end">
          <button ref={nextRef} type="button" className="g-btn is-primary" onClick={onNext} disabled={!settled}>
            {last ? 'Continue' : 'Next statement'}
          </button>
        </div>
      )}
    </GameCard>
  );
}

/** Docket: one short rule per statement this phase — pending, current, caught, missed. No numbers. */
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

export function ShatterBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<ShatterPayload>) {
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
      <div className="flex items-center justify-between gap-3">
        <div className="g-kicker">{phase === 'discovery' ? 'On the record' : 'Under pressure'}</div>
      </div>
      <Docket total={rounds.length} index={index} results={results} />
      <Round key={round.id} round={round} phase={phase} onAnswered={answered} onNext={next} last={index + 1 === rounds.length} />
    </div>
  );
}
