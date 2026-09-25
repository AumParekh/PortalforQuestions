import { useMemo, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { fillSkeleton, normTex } from '../latex';
import type { Round } from '../rounds';
import type { RoundResult } from '../run';
import { elapsedSeconds, submitRound } from '../submit';
import { Tex } from '../tex';
import type { Formula } from '../types';
import { FormulaAnswer, RoundHeader, Text, Verdict, btnPrimary, btnSmall, card, choiceTone, useKeys } from '../ui';

export function ForgeRound({ round, formula, result }: { round: Extract<Round, { game: 'forge' }>; formula: Formula; result?: RoundResult }) {
  const n = formula.slots.length;
  // Tile index placed in each slot.
  const [fills, setFills] = useState<(number | null)[]>(() => Array.from({ length: n }, () => null));
  const [selected, setSelected] = useState<number | null>(null);
  const shownAt = useRef(performance.now());

  const used = useMemo(() => new Set(fills.filter((f): f is number => f !== null)), [fills]);
  const full = fills.every((f) => f !== null);
  const checked = !!result;
  const verdicts = checked ? fills.map((f, i) => (f === null ? null : normTex(round.tiles[f]) === normTex(formula.slots[i]))) : undefined;

  const preview = fillSkeleton(
    formula.skeleton,
    fills.map((f) => (f === null ? null : round.tiles[f])),
    { selected: checked ? null : selected, verdicts },
  );

  const placeTile = (t: number) => {
    if (checked || used.has(t)) return;
    const target = selected ?? fills.findIndex((f) => f === null);
    if (target < 0) return;
    setFills((prev) => prev.map((f, i) => (i === target ? t : f)));
    setSelected(null);
  };

  const tapSlot = (i: number) => {
    if (checked) return;
    if (fills[i] !== null) {
      // Tapping a filled slot sends its tile back to the tray and selects the slot.
      setFills((prev) => prev.map((f, j) => (j === i ? null : f)));
      setSelected(i);
    } else setSelected((s) => (s === i ? null : i));
  };

  const check = () => {
    if (checked || !full) return;
    const right = fills.filter((f, i) => f !== null && normTex(round.tiles[f]) === normTex(formula.slots[i])).length;
    submitRound(round, { correct: right === n, nearMiss: right >= Math.ceil(n / 2), seconds: elapsedSeconds(shownAt.current) });
  };

  useKeys((e) => {
    if (e.key === 'Enter' && full) {
      e.preventDefault();
      check();
    }
  }, !checked);

  const rightCount = verdicts ? verdicts.filter(Boolean).length : 0;

  return (
    <div className="space-y-4">
      <section className={card}>
        <RoundHeader formula={formula} title="Forge" />
        {formula.prompt && <Text className="mt-3 text-slate-700 dark:text-slate-300">{formula.prompt}</Text>}
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-2 dark:border-slate-600" aria-live="polite">
          <Tex latex={preview} display label="Your formula so far" />
        </div>
        {!checked && (
          <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-400">
            Tap a tile to fill the next empty slot, or tap a slot first to choose where it goes.
          </p>
        )}
      </section>

      <section aria-label="Slots" className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {fills.map((f, i) => {
            const state = verdicts ? (verdicts[i] ? 'right' : 'wrong') : selected === i ? 'selected' : 'idle';
            return (
              <button
                key={i}
                type="button"
                onClick={() => tapSlot(i)}
                disabled={checked}
                aria-pressed={selected === i}
                aria-label={`Slot ${i + 1}${f === null ? ', empty' : ''}`}
                className={`inline-flex min-h-[48px] min-w-[48px] max-w-full items-center gap-2 rounded-xl border-2 px-3 py-1 disabled:cursor-default ${choiceTone(state)}`}
              >
                <span className="text-[15px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">{i + 1}</span>
                {f === null ? <span className="text-[15px] text-slate-500 dark:text-slate-400">empty</span> : <Tex latex={round.tiles[f]} />}
              </button>
            );
          })}
        </div>
      </section>

      {!checked && (
        <section aria-label="Tiles" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {round.tiles.map((t, i) => (
              <button
                key={i}
                type="button"
                onClick={() => placeTile(i)}
                disabled={used.has(i)}
                className={`inline-flex min-h-[52px] min-w-[52px] max-w-full items-center justify-center rounded-xl border-2 px-3 py-1 transition-opacity motion-reduce:transition-none disabled:cursor-default disabled:opacity-30 ${choiceTone('idle')}`}
              >
                <Tex latex={t} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={check} disabled={!full} className={`${btnPrimary} flex-1`}>
              <Check className="h-5 w-5" aria-hidden="true" />
              Check
            </button>
            <button
              type="button"
              onClick={() => {
                setFills(fills.map(() => null));
                setSelected(null);
              }}
              disabled={used.size === 0}
              className={`${btnSmall} inline-flex items-center gap-2 disabled:opacity-40`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Clear
            </button>
          </div>
        </section>
      )}

      {checked && (
        <section className={card}>
          <Verdict correct={result.correct}>
            {result.correct ? 'Forged correctly' : `${rightCount} of ${n} slots right`}
          </Verdict>
          <div className="mt-3">
            <FormulaAnswer formula={formula} />
          </div>
        </section>
      )}
    </div>
  );
}
