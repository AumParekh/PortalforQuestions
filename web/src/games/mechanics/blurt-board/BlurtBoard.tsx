// Blurt Board renderer: one objective, one blank board per phase. The player writes everything
// they remember; on Check, the objective's items light up where the board carried them and fade
// in, after a beat, where it did not. Calm and big: free recall is the whole game.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { MechanicRenderProps, RoundResult } from '../../arc/plugin';
import { GameButton, GameCard, NoteText, TimerBar, WrongHold } from '../../theme/primitives';
import type { BlurtBoardSpec, BlurtPayload } from './build';
import type { BlurtTarget, BoardCheck, TargetKind, TargetResult } from './match';
import { checkBoard } from './match';

/** Hold before a missed item's notes fade in (§10.3), and the fade itself. */
const HOLD_MS = 800;
const FADE_MS = 520;
/** Tiles light up one after another. */
const STAGGER_MS = 140;

const SLOT_LABEL: Record<TargetKind, string> = {
  term: 'a marked term or phrase',
  point: 'a point the notes make',
  number: 'a number',
  variable: 'a variable',
};

/** 15px floor for all secondary text (PORTAL_PLAN §5); the shared g-small / g-kicker are 14px. */
const SMALL: CSSProperties = { fontSize: 15, lineHeight: 1.55 };
/** Long player lines, block IDs and formulas wrap inside their tile instead of widening the page. */
const WRAP: CSSProperties = { overflowWrap: 'anywhere', minWidth: 0 };
const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace", fontSize: 15 };

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="g-kicker" style={{ fontSize: 15 }}>
      {children}
    </div>
  );
}

function Source({ blockId }: { blockId: string }) {
  return (
    <span className="g-muted block" style={SMALL}>
      block <span style={MONO}>{blockId}</span>
    </span>
  );
}

/** What the notes hold for one item, as shown on a lit or darkened tile. */
function ItemText({ t }: { t: BlurtTarget }) {
  if (t.kind === 'number' && t.label) {
    return (
      <span>
        <span className="g-strong">
          <NoteText latex={t.label} />
        </span>
        <span className="g-muted"> · </span>
        <NoteText latex={t.display} />
      </span>
    );
  }
  if (t.kind === 'term' && t.context) {
    // A marked phrase ("far away from 1") says nothing alone: show the notes' sentence that carries it.
    return (
      <span>
        <span className="g-strong">
          <NoteText latex={t.display} />
        </span>
        <span className="g-muted block" style={SMALL}>
          {t.context}
        </span>
      </span>
    );
  }
  return <NoteText latex={t.display} />;
}

function Quote({ text }: { text: string }) {
  return <span className="g-serif">“{text}”</span>;
}

function Slot({ t, i, result, checked }: { t: BlurtTarget; i: number; result: TargetResult | undefined; checked: boolean }) {
  const delay: CSSProperties = { animationDelay: `${i * STAGGER_MS}ms` };
  if (!checked || !result) {
    return (
      <li
        className="flex min-h-[64px] items-center rounded-xl px-4 py-3"
        style={{ ...WRAP, border: '1.5px dashed var(--g-rule)', background: 'var(--g-card)' }}
      >
        <span className="g-muted" style={{ fontSize: 16 }}>
          {SLOT_LABEL[t.kind]}
        </span>
      </li>
    );
  }
  if (result.hit) {
    return (
      <li
        className="g-assemble space-y-2 rounded-xl px-4 py-3"
        style={{ ...delay, ...WRAP, borderLeft: '4px solid var(--g-green)', background: 'var(--g-pale-green)' }}
      >
        <div className="g-serif" style={{ fontSize: 17 }}>
          <ItemText t={t} />
        </div>
        <p style={SMALL}>
          <span className="g-strong">You wrote</span> <Quote text={result.hit.text} />
        </p>
        <Source blockId={t.blockId} />
      </li>
    );
  }
  const wrong = result.flipped ? (
    <span style={SMALL}>
      <span className="g-strong">Your line turns the direction around:</span> <Quote text={result.flipped.text} />
    </span>
  ) : result.near ? (
    <span style={SMALL}>
      <span className="g-strong">Closest line:</span> <Quote text={result.near.text} />
    </span>
  ) : (
    <span style={SMALL}>Not on your board.</span>
  );
  return (
    <li style={WRAP}>
      <WrongHold
        holdMs={HOLD_MS + i * STAGGER_MS}
        wrong={wrong}
        right={
          <>
            <span style={{ fontSize: 17 }}>
              <ItemText t={t} />
            </span>
            <span className="mt-1 block">
              <Source blockId={t.blockId} />
            </span>
          </>
        }
      />
    </li>
  );
}

function YourBoard({ check, targets, extras }: { check: BoardCheck; targets: readonly BlurtTarget[]; extras: readonly BlurtTarget[] }) {
  const byId = useMemo(() => new Map([...targets, ...extras].map((t) => [t.itemId, t])), [targets, extras]);
  if (check.segments.length === 0) return <p style={SMALL}>The board was left blank.</p>;
  const anyDark = check.segmentHits.some((h) => h.length === 0);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {check.segments.map((line, i) => {
          const lit = check.segmentHits[i].length > 0;
          return (
            <li
              key={i}
              className="py-1 pl-3"
              style={{ borderLeft: `3px solid ${lit ? 'var(--g-green)' : 'var(--g-rule)'}`, overflowWrap: 'anywhere' }}
            >
              <span className={`g-serif${lit ? '' : ' g-muted'}`} style={{ fontSize: 17 }}>
                {line}
              </span>
              {lit && (
                <span className="g-muted block" style={SMALL}>
                  matched{' '}
                  {check.segmentHits[i]
                    .map((id) => byId.get(id)?.blockId)
                    .filter((x, k, xs): x is string => !!x && xs.indexOf(x) === k)
                    .map((b, k) => (
                      <span key={b}>
                        {k > 0 && ', '}
                        <span style={MONO}>{b}</span>
                      </span>
                    ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {anyDark && (
        <p className="g-muted" style={SMALL}>
          Lines on a grey rule did not match an item this objective holds in the notes. They may still be right; the board only
          knows what the notes say here.
        </p>
      )}
    </div>
  );
}

function Extras({ check, extras }: { check: BoardCheck; extras: readonly BlurtTarget[] }) {
  const found = extras.filter((t) => check.results[t.itemId]?.hit);
  const rest = extras.filter((t) => !check.results[t.itemId]?.hit);
  return (
    <div className="space-y-4">
      {found.length > 0 && (
        <div className="space-y-2">
          <Kicker>Also on your board, from the notes</Kicker>
          <ul className="space-y-3">
            {found.map((t) => (
              <li key={t.itemId} className="pl-3" style={{ ...WRAP, borderLeft: '3px solid var(--g-green)' }}>
                <div className="g-serif" style={{ fontSize: 17 }}>
                  <ItemText t={t} />
                </div>
                <Source blockId={t.blockId} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {rest.length > 0 && (
        <details className="rounded-xl" style={{ border: '1px solid var(--g-rule)' }}>
          <summary className="g-strong min-h-[48px] cursor-pointer px-4 py-3" style={{ fontSize: 16 }}>
            The rest of this objective in the notes
          </summary>
          <ul className="space-y-3 px-4 pb-4">
            {rest.map((t) => (
              <li key={t.itemId} className="pl-3" style={{ ...WRAP, borderLeft: '3px solid var(--g-rule)' }}>
                <div className="g-serif" style={{ fontSize: 17 }}>
                  <ItemText t={t} />
                </div>
                <Source blockId={t.blockId} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Grade for the shared schedule: a found item is a clean recall; a turned or near line is a lapse, but not a blank. */
function gradeOf(r: TargetResult | undefined, blankTimeout: boolean): number {
  if (blankTimeout) return 0;
  if (r?.hit) return 4;
  if (r?.flipped || r?.near) return 2;
  return 1;
}

export function BlurtBoardView({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<BlurtPayload>) {
  const board: BlurtBoardSpec | undefined = rounds[0]?.payload.board;
  const [text, setText] = useState('');
  const [check, setCheck] = useState<BoardCheck | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [settled, setSettled] = useState(false);
  const started = useRef(performance.now());
  const done = useRef(false);
  const checkedOnce = useRef(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const textNow = useRef('');
  textNow.current = text;
  const timed = phase === 'pressure' && !!board?.timeLimitMs;

  const finishPhase = () => {
    if (done.current) return;
    done.current = true;
    onPhaseDone();
  };

  useEffect(() => {
    if (!board || board.targets.length === 0) finishPhase();
    else textRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runCheck = (byTimeout: boolean) => {
    if (!board || checkedOnce.current) return;
    checkedOnce.current = true;
    const written = textNow.current;
    const res = checkBoard(written, board.targets, board.extras);
    const blank = byTimeout && written.trim() === '';
    const timeMs = performance.now() - started.current;
    setCheck(res);
    setTimedOut(byTimeout);
    for (const r of rounds) {
      const tr = res.results[r.itemId];
      const result: RoundResult = { roundId: r.id, correct: !!tr?.hit, timeMs, timedOut: blank, grade: gradeOf(tr, blank) };
      onResult(result);
    }
  };

  // Pressure: the board is checked as it stands when the time runs out.
  useEffect(() => {
    if (!timed || check || !board?.timeLimitMs) return;
    const t = window.setTimeout(() => runCheck(true), board.timeLimitMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, check]);

  // Continue unlocks once every darkened tile has held its beat and faded in.
  useEffect(() => {
    if (!check || !board) return;
    const ms = HOLD_MS + FADE_MS + board.targets.length * STAGGER_MS;
    const t = window.setTimeout(() => setSettled(true), ms);
    return () => window.clearTimeout(t);
  }, [check, board]);

  useEffect(() => {
    // Keyboard users land on Continue without the page jumping past the lit tiles.
    if (settled) nextRef.current?.focus({ preventScroll: true });
  }, [settled]);

  if (!board || board.targets.length === 0) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runCheck(false);
    }
  };

  const found = check ? board.targets.filter((t) => check.results[t.itemId]?.hit).length : 0;
  const inputId = `blurt-${board.boardId.replace(/[^a-z0-9-]/gi, '-')}`;

  return (
    <div className="space-y-5">
      <Kicker>{phase === 'discovery' ? 'A blank board' : 'A blank board, against the clock'}</Kicker>

      <GameCard tone="soft" className="space-y-2">
        <p className="g-muted" style={SMALL}>
          <span className="g-strong">{board.objectiveId}</span>
        </p>
        {board.objectiveText ? (
          <div className="g-reading">
            <NoteText latex={board.objectiveText} />
          </div>
        ) : (
          <p className="g-reading">Everything this objective covers.</p>
        )}
      </GameCard>

      {timed && !check && <TimerBar ms={board.timeLimitMs ?? 0} />}

      {/* Writing comes straight after the objective, so on a phone the prompt stays in view while typing. */}
      {!check && (
        <GameCard className="space-y-4">
          <label htmlFor={inputId} className="g-strong block" style={{ fontSize: 17 }}>
            Everything you remember
          </label>
          <textarea
            id={inputId}
            ref={textRef}
            value={text}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={8}
            spellCheck
            autoCapitalize="sentences"
            placeholder="One idea per line — terms, points, numbers, symbols. Your own words are fine."
            className="g-serif block w-full rounded-xl px-4 py-3"
            style={{
              minHeight: '15rem',
              fontSize: 18,
              lineHeight: 1.6,
              background: 'var(--g-paper)',
              color: 'var(--g-ink)',
              border: '1px solid var(--g-rule)',
              resize: 'vertical',
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="g-muted" style={SMALL}>
              Ctrl + Enter checks the board.
            </p>
            <GameButton variant="primary" onClick={() => runCheck(false)}>
              Check the board
            </GameButton>
          </div>
        </GameCard>
      )}

      <section aria-label="The board" className="space-y-3">
        {!check && <Kicker>What this board holds</Kicker>}
        <ul className="grid gap-3 sm:grid-cols-2" aria-live="polite">
          {board.targets.map((t, i) => (
            <Slot key={t.itemId} t={t} i={i} result={check?.results[t.itemId]} checked={!!check} />
          ))}
        </ul>
        {check && (
          <p className="g-settle" style={{ fontSize: 16 }}>
            {timedOut ? 'Time. The board was checked as it stood. ' : ''}
            {found === board.targets.length
              ? 'Every item on the board came back from memory.'
              : found === 0
                ? 'None of the board’s items came back this time; they are scheduled to return soon.'
                : 'The dark tiles are the ones to rebuild; they come back sooner in your next drills.'}
          </p>
        )}
      </section>

      {check && (
        <>
          <GameCard className="space-y-3">
            <Kicker>Your board</Kicker>
            <YourBoard check={check} targets={board.targets} extras={board.extras} />
          </GameCard>
          <Extras check={check} extras={board.extras} />
          <div className="flex justify-end">
            <button ref={nextRef} type="button" className="g-btn is-primary" onClick={finishPhase} disabled={!settled}>
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}
