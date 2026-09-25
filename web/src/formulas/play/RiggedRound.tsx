import { useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { highlightChange } from '../latex';
import type { Round } from '../rounds';
import type { RoundResult } from '../run';
import { elapsedSeconds, submitRound } from '../submit';
import { Tex } from '../tex';
import type { Formula, FormulaCorruption } from '../types';
import { FormulaAnswer, Kbd, RoundHeader, Text, Verdict, card, choiceTone, useKeys } from '../ui';

const KIND_LABELS: Record<string, string> = {
  inverted: 'Inverted',
  sign: 'Sign flipped',
  'missing-term': 'Missing term',
  'extra-term': 'Extra term',
  exponent: 'Wrong exponent',
  'wrong-variable': 'Wrong variable',
  sibling: 'Sibling swap',
  scaling: 'Wrong scaling',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? (kind ? kind.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Broken');
}

/** A wrong version with its changed piece in red, the kind of error and why it's wrong. */
export function WhyWrong({ formula, corruption }: { formula: Formula; corruption: FormulaCorruption }) {
  // Token diffing plus KaTeX checks: worth keeping out of every re-render.
  const marked = useMemo(() => highlightChange(formula.latex, corruption.latex) ?? corruption.latex, [formula.latex, corruption.latex]);
  return (
    <div className="space-y-1">
      <Tex latex={marked} display />
      <p className="text-[15px] font-semibold text-red-700 dark:text-red-400">{kindLabel(corruption.kind)}</p>
      {corruption.why && <Text className="text-[15px] text-slate-700 dark:text-slate-300">{corruption.why}</Text>}
    </div>
  );
}

export function RiggedRound({ round, formula, result }: { round: Extract<Round, { game: 'rigged' }>; formula: Formula; result?: RoundResult }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const shownAt = useRef(performance.now());

  const pick = (i: number) => {
    if (result || !round.options[i]) return;
    setChosen(i);
    submitRound(round, { correct: round.options[i].corruption === null, seconds: elapsedSeconds(shownAt.current) });
  };

  useKeys((e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= round.options.length) {
      e.preventDefault();
      pick(n - 1);
    }
  }, !result);

  return (
    <div className="space-y-4">
      <section className={card}>
        <RoundHeader formula={formula} title="Real or Rigged" />
        <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-400">One of these is the real formula. The rest each have one thing wrong.</p>
      </section>

      <ol className="space-y-2" aria-label="Versions">
        {round.options.map((o, i) => {
          const real = o.corruption === null;
          const state = !result ? 'idle' : real ? 'right' : chosen === i ? 'wrong' : 'muted';
          const corruption = o.corruption === null ? null : formula.corruptions[o.corruption];
          const badge = (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[15px] font-semibold tabular-nums text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {!result ? i + 1 : real ? <Check className="h-5 w-5 text-emerald-600" aria-label="Real" /> : <X className="h-5 w-5 text-red-600" aria-label="Rigged" />}
            </span>
          );
          const box = `flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 px-3 py-2 text-left ${choiceTone(state)}`;
          return (
            <li key={i}>
              {result ? (
                // After answering: why each wrong version is wrong (block content, so not inside a button).
                <div className={box}>
                  {badge}
                  <div className="min-w-0 flex-1">{corruption ? <WhyWrong formula={formula} corruption={corruption} /> : <Tex latex={o.latex} display />}</div>
                </div>
              ) : (
                <button type="button" onClick={() => pick(i)} className={box}>
                  {badge}
                  <span className="min-w-0 flex-1">
                    <Tex latex={o.latex} display />
                  </span>
                  <Kbd>{i + 1}</Kbd>
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {result && (
        <section className={card}>
          <Verdict correct={result.correct}>{result.correct ? 'You found the real one' : 'That one was rigged'}</Verdict>
          <div className="mt-3">
            <FormulaAnswer formula={formula} />
          </div>
        </section>
      )}
    </div>
  );
}

export function SpotRound({ round, formula, result }: { round: Extract<Round, { game: 'spot' }>; formula: Formula; result?: RoundResult }) {
  const shownAt = useRef(performance.now());
  const [said, setSaid] = useState<boolean | null>(null);
  const corruption = round.corruption === null ? null : formula.corruptions[round.corruption] ?? null;
  const shown = corruption ? corruption.latex : formula.latex;

  const answer = (saysCorrect: boolean) => {
    if (result) return;
    setSaid(saysCorrect);
    submitRound(round, { correct: saysCorrect === (corruption === null), seconds: elapsedSeconds(shownAt.current) });
  };

  useKeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'c' || k === '1') {
      e.preventDefault();
      answer(true);
    } else if (k === 'b' || k === '2') {
      e.preventDefault();
      answer(false);
    }
  }, !result);

  const choice = (saysCorrect: boolean) => {
    if (!result) return choiceTone('idle');
    const truth = corruption === null;
    if (saysCorrect === truth) return choiceTone('right');
    return said === saysCorrect ? choiceTone('wrong') : choiceTone('muted');
  };

  return (
    <div className="space-y-4">
      <section className={card}>
        <RoundHeader formula={formula} title="Correct or broken?" />
        <div className="mt-4 rounded-xl border border-slate-200 px-2 dark:border-slate-700">
          {result && corruption ? <WhyWrong formula={formula} corruption={corruption} /> : <Tex latex={shown} display />}
        </div>
      </section>

      {!result ? (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => answer(true)} className={`inline-flex min-h-[64px] items-center justify-center gap-2 rounded-2xl border-2 text-lg font-semibold ${choice(true)}`}>
            <Check className="h-6 w-6" aria-hidden="true" />
            Correct
            <Kbd>C</Kbd>
          </button>
          <button type="button" onClick={() => answer(false)} className={`inline-flex min-h-[64px] items-center justify-center gap-2 rounded-2xl border-2 text-lg font-semibold ${choice(false)}`}>
            <X className="h-6 w-6" aria-hidden="true" />
            Broken
            <Kbd>B</Kbd>
          </button>
        </div>
      ) : (
        <section className={card}>
          <Verdict correct={result.correct}>{corruption ? 'It was broken' : 'It was the real formula'}</Verdict>
          <div className="mt-3">
            <FormulaAnswer formula={formula} />
          </div>
        </section>
      )}
    </div>
  );
}
