import { useEffect, useRef, useState } from 'react';
import { Calculator, Check, KeyRound, Sigma } from 'lucide-react';
import { haptic } from '../../lib/settings';
import type { MemoryCard, Round } from '../rounds';
import { useGymRun } from '../run';
import type { RoundResult } from '../run';
import { useGym } from '../storage';
import { elapsedSeconds } from '../submit';
import { Tex } from '../tex';
import type { Formula } from '../types';
import { VariableList, Verdict, card } from '../ui';

const MISMATCH_MS = 800;

const FACE_LABEL: Record<MemoryCard['face'], string> = { formula: 'Formula', key: 'Key', number: 'Number' };

function FaceIcon({ face, className }: { face: MemoryCard['face']; className: string }) {
  if (face === 'formula') return <Sigma className={className} aria-hidden="true" />;
  if (face === 'key') return <KeyRound className={className} aria-hidden="true" />;
  return <Calculator className={className} aria-hidden="true" />;
}

/** A face-up card's full content, shown legibly in the tray under the grid. */
function CardContent({ c, formula }: { c: MemoryCard; formula: Formula }) {
  if (c.face === 'formula') return <Tex latex={formula.latex} display />;
  if (c.face === 'key') return <VariableList formula={formula} />;
  return <p className="overflow-x-auto break-words font-mono text-base leading-relaxed">{c.text}</p>;
}

export function MemoryBoard({
  round,
  byId,
  result,
  timeUp,
}: {
  round: Extract<Round, { game: 'memory' }>;
  byId: Record<string, Formula>;
  result?: RoundResult;
  timeUp: boolean;
}) {
  const [up, setUp] = useState<number[]>([]);
  const [matched, setMatched] = useState<string[]>(() => (result ? result.items.filter((i) => i.correct).map((i) => i.id) : []));
  const [seen, setSeen] = useState<string[]>([]);
  const [errored, setErrored] = useState<string[]>([]);
  const [tray, setTray] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const shownAt = useRef(performance.now());
  const holdTimer = useRef<number | null>(null);
  const done = useRef(!!result);
  const total = round.ids.length;

  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    },
    [],
  );

  const log = (id: string, correct: boolean, grade: number) => {
    const run = useGymRun.getState().run;
    if (!run) return;
    useGym.getState().record([
      {
        itemId: id,
        kind: 'formula',
        readingId: byId[id]?.readingId ?? '',
        game: 'memory',
        correct,
        grade,
        timeTakenSeconds: elapsedSeconds(shownAt.current),
        sessionId: run.sessionId,
      },
    ]);
  };

  /** Ends the board: formulas with memory errors that never got matched are logged as misses. */
  const finish = (matchedNow: string[], erroredNow: string[]) => {
    if (done.current) return;
    done.current = true;
    const unmatchedErrors = erroredNow.filter((id) => !matchedNow.includes(id));
    for (const id of unmatchedErrors) log(id, false, 1);
    const items = [...matchedNow.map((id) => ({ id, correct: !erroredNow.includes(id) })), ...unmatchedErrors.map((id) => ({ id, correct: false }))];
    useGymRun.getState().answer({
      key: round.key,
      game: 'memory',
      items,
      correct: matchedNow.length === total && erroredNow.length === 0,
      seconds: elapsedSeconds(shownAt.current),
    });
  };

  useEffect(() => {
    if (timeUp && !done.current) {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      setLocked(true);
      finish(matched, errored);
    }
    // Runs once when the clock hits zero; finish() reads the latest state from this render.
  }, [timeUp]);

  const flip = (pos: number) => {
    const c = round.cards[pos];
    if (!c || done.current || locked || timeUp) return;
    if (matched.includes(c.formulaId)) {
      // A matched pair can be re-read in the tray.
      setTray(round.cards.map((x, i) => (x.formulaId === c.formulaId ? i : -1)).filter((i) => i >= 0));
      return;
    }
    if (up.includes(pos)) return;
    if (up.length === 0) {
      setUp([pos]);
      setTray([pos]);
      return;
    }
    const first = up[0];
    const a = round.cards[first];
    setUp([first, pos]);
    setTray([first, pos]);
    const nextSeen = [...new Set([...seen, a.key, c.key])];
    if (a.formulaId === c.formulaId) {
      const nowMatched = [...matched, c.formulaId];
      const clean = !errored.includes(c.formulaId);
      log(c.formulaId, clean, clean ? 4 : 2);
      haptic(12);
      setMatched(nowMatched);
      setUp([]);
      setSeen(nextSeen);
      if (nowMatched.length === total) finish(nowMatched, errored);
      return;
    }
    // A mismatch is a memory error only for a card that had been seen before this turn.
    const nowErrored = [...errored];
    for (const x of [a, c]) if (seen.includes(x.key) && !nowErrored.includes(x.formulaId)) nowErrored.push(x.formulaId);
    setErrored(nowErrored);
    setSeen(nextSeen);
    haptic([20, 40, 20]);
    setLocked(true);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      setUp([]);
      setLocked(false);
    }, MISMATCH_MS);
  };

  const finished = !!result;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[15px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-100">Memory Match</p>
        <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">
          Pair each formula with its {round.numbers ? 'worked number' : 'variable key'}. Face-up cards show below the grid.
        </p>
        <p className="mt-1 text-[15px] font-medium tabular-nums text-slate-700 dark:text-slate-300" aria-live="polite">
          {matched.length} of {total} pairs matched
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Cards">
        {round.cards.map((c, i) => {
          const isMatched = matched.includes(c.formulaId);
          const isUp = up.includes(i) || isMatched || finished;
          const inTray = tray.includes(i);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => flip(i)}
              aria-label={isUp ? `Card ${i + 1}: ${FACE_LABEL[c.face]}${isMatched ? ', matched' : ''}` : `Card ${i + 1}, face down`}
              className={`flex aspect-square min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border-2 p-1 text-center transition-colors duration-150 motion-reduce:transition-none ${
                isMatched
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                  : isUp
                    ? 'border-primary bg-card-light text-slate-900 dark:bg-card-dark dark:text-slate-50'
                    : 'border-transparent bg-primary text-white hover:bg-primary-600'
              } ${inTray && isUp ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface-light dark:ring-offset-surface-dark' : ''}`}
            >
              {isUp ? (
                <>
                  {isMatched ? <Check className="h-5 w-5" aria-hidden="true" /> : <FaceIcon face={c.face} className="h-5 w-5" />}
                  <span className="text-[15px] font-semibold leading-tight">{FACE_LABEL[c.face]}</span>
                </>
              ) : (
                <span className="text-[15px] font-semibold tabular-nums opacity-80">{i + 1}</span>
              )}
            </button>
          );
        })}
      </div>

      <section aria-label="Face-up cards" aria-live="polite" className="space-y-2">
        {tray.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-[15px] text-slate-600 dark:border-slate-600 dark:text-slate-400">
            Tap a card to turn it over.
          </p>
        ) : (
          tray.map((pos) => {
            const c = round.cards[pos];
            const f = c ? byId[c.formulaId] : undefined;
            if (!c || !f) return null;
            return (
              <div key={c.key} className={card}>
                <p className="flex items-center gap-2 text-[15px] font-semibold text-slate-600 dark:text-slate-400">
                  <FaceIcon face={c.face} className="h-4 w-4" />
                  Card {pos + 1}: {FACE_LABEL[c.face]}
                  {matched.includes(c.formulaId) && <span className="text-emerald-700 dark:text-emerald-400">· {f.name}</span>}
                </p>
                <div className="mt-2">
                  <CardContent c={c} formula={f} />
                </div>
              </div>
            );
          })
        )}
      </section>

      {finished && result && (
        <section className={card}>
          <Verdict correct={result.correct}>
            {matched.length === total ? (result.correct ? 'Board cleared, no slips' : 'Board cleared') : `${matched.length} of ${total} pairs before time ran out`}
          </Verdict>
        </section>
      )}
    </div>
  );
}
