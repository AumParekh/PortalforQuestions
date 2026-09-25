import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { normTex } from '../latex';
import type { Round } from '../rounds';
import type { RoundResult } from '../run';
import { elapsedSeconds, submitRound } from '../submit';
import { TEX_GREEN, TEX_RED, Tex } from '../tex';
import type { Formula } from '../types';
import { FormulaAnswer, Kbd, RoundHeader, Text, Verdict, card, choiceTone, useKeys } from '../ui';

function reducedMotion(): boolean {
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const CATEGORY_HINT: Record<string, string> = {
  Sign: 'a flipped sign or direction',
  Formula: 'a wrong piece of the formula',
  Sibling: 'a look-alike from a sibling formula',
};

export function RepairRound({ round, formula, result }: { round: Extract<Round, { game: 'repair' }>; formula: Formula; result?: RoundResult }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const shownAt = useRef(performance.now());
  const formulaRef = useRef<HTMLDivElement>(null);

  const placed = chosen === null ? null : round.tiles[chosen];
  const fixed = placed !== null && normTex(placed) === normTex(round.fix);
  const shown = round.marked
    .split('{{bad}}')
    .join(
      placed === null
        ? `{\\boxed{\\textcolor{${TEX_RED}}{${round.bad}}}}`
        : fixed
          ? `{\\textcolor{${TEX_GREEN}}{${placed}}}`
          : `{\\boxed{\\textcolor{${TEX_RED}}{${placed}}}}`,
    );

  // The repaired formula "snaps" into place.
  useEffect(() => {
    if (!fixed || !formulaRef.current || reducedMotion() || typeof formulaRef.current.animate !== 'function') return;
    formulaRef.current.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], {
      duration: 320,
      easing: 'ease-out',
    });
  }, [fixed]);

  const pick = (i: number) => {
    if (result || !round.tiles[i]) return;
    setChosen(i);
    submitRound(round, { correct: normTex(round.tiles[i]) === normTex(round.fix), seconds: elapsedSeconds(shownAt.current) });
  };

  useKeys((e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= round.tiles.length) {
      e.preventDefault();
      pick(n - 1);
    }
  }, !result);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const i = Number(e.dataTransfer?.getData('text/plain'));
    if (Number.isInteger(i)) pick(i);
  };

  return (
    <div className="space-y-4">
      <section className={card}>
        <RoundHeader formula={formula} title="Formula Repair" />
        <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-400">The boxed piece is broken. Put the right one in its place.</p>
        <div
          ref={formulaRef}
          onDragOver={(e: DragEvent<HTMLDivElement>) => {
            if (result) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`mt-3 rounded-xl border-2 px-2 transition-colors motion-reduce:transition-none ${
            fixed
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
              : result
                ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                : dragOver
                  ? 'border-primary bg-primary-50 dark:bg-primary/15'
                  : 'border-dashed border-slate-300 dark:border-slate-600'
          }`}
        >
          <Tex latex={shown} display />
        </div>
      </section>

      {!result && (
        <section aria-label="Replacement tiles" className="grid grid-cols-2 gap-2">
          {round.tiles.map((t, i) => (
            <button
              key={i}
              type="button"
              draggable
              onDragStart={(e: DragEvent<HTMLButtonElement>) => e.dataTransfer?.setData('text/plain', String(i))}
              onClick={() => pick(i)}
              className={`flex min-h-[64px] items-center justify-center gap-2 rounded-2xl border-2 px-3 py-2 ${choiceTone('idle')}`}
            >
              <Tex latex={t} className="text-lg" />
              <Kbd>{i + 1}</Kbd>
            </button>
          ))}
        </section>
      )}

      {result && (
        <section className={card}>
          <Verdict correct={result.correct}>{result.correct ? 'Repaired' : 'Still broken'}</Verdict>
          <p className="mt-2 inline-flex flex-wrap items-center gap-2 text-[15px]">
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">Trap: {round.category}</span>
            <span className="text-slate-600 dark:text-slate-400">{CATEGORY_HINT[round.category]}</span>
          </p>
          {round.why && <Text className="mt-2 text-slate-800 dark:text-slate-200">{round.why}</Text>}
          {!result.correct && (
            <div className="mt-3">
              <FormulaAnswer formula={formula} showVariables={false} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
