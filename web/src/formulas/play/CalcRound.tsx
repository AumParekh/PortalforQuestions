import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check } from 'lucide-react';
import { formatNumber, substituteReadable } from '../expr';
import { parseAnswer, withinTolerance } from '../rounds';
import { MAX_WORKED_CHARS, unitSuffix } from '../worked';
import type { Round } from '../rounds';
import type { RoundResult } from '../run';
import { elapsedSeconds, submitRound } from '../submit';
import { Tex } from '../tex';
import type { Formula } from '../types';
import { FormulaAnswer, RoundHeader, Verdict, btnPrimary, card } from '../ui';

export function CalcRound({ round, formula, result }: { round: Extract<Round, { game: 'calc' }>; formula: Formula; result?: RoundResult }) {
  const calc = formula.calc;
  const [text, setText] = useState('');
  const [given, setGiven] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(performance.now());
  const inputRef = useRef<HTMLInputElement>(null);

  if (!calc) return null;
  const { decimals, unit, symbol } = calc.output;
  const suffix = unitSuffix(unit);
  const answerText = `${formatNumber(round.answer, decimals)}${suffix}`;
  // Series approximations (e.g. a normal CDF) make an unreadable line; those show only the answer.
  const sub = substituteReadable(calc.expr, round.values);
  const worked = sub && sub.length <= MAX_WORKED_CHARS * 2 ? sub : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (result) return;
    const parsed = parseAnswer(text);
    // "5%" typed for an answer asked as a decimal means 0.05.
    const v = parsed !== null && text.includes('%') && (!unit.trim() || /\bdecimal\b|probability/i.test(unit)) ? parsed / 100 : parsed;
    if (v === null) {
      setError('Enter a number, e.g. 12.5');
      return;
    }
    setError(null);
    setGiven(v);
    inputRef.current?.blur();
    const correct = withinTolerance(v, round.answer, decimals);
    const nearMiss = Math.abs(v - round.answer) <= Math.abs(round.answer) * 0.05;
    submitRound(round, { correct, nearMiss, seconds: elapsedSeconds(shownAt.current) });
  };

  return (
    <div className="space-y-4">
      <section className={card}>
        <RoundHeader formula={formula} title="Quick Calc" />
        <dl className="mt-4 space-y-2">
          {calc.inputs.map((i) => (
            <div key={i.name} className="flex flex-wrap items-baseline gap-x-2 text-lg">
              <dt>
                <Tex latex={i.symbol} />
              </dt>
              <dd className="font-medium tabular-nums">
                = {formatNumber(round.values[i.name], 6)}
                {unitSuffix(i.unit)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-lg text-slate-900 dark:text-slate-50">
          Find {symbol ? <Tex latex={symbol} /> : 'the result'}
          {suffix.trim() && <span> in {unit}</span>}.
        </p>
        <p className="text-[15px] text-slate-600 dark:text-slate-400">
          {/\bdecimal\b/i.test(unit) ? 'As a decimal, ' : ''}
          {decimals === 0 ? 'to a whole number' : `to ${decimals} decimal ${decimals === 1 ? 'place' : 'places'}`}. Within 1% counts.
        </p>

        <form onSubmit={submit} className="mt-4 flex gap-2">
          <label htmlFor="calc-answer" className="sr-only">
            Your answer
          </label>
          <input
            ref={inputRef}
            id="calc-answer"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={text}
            readOnly={!!result}
            onChange={(e: { currentTarget: HTMLInputElement }) => setText(e.currentTarget.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'calc-error' : undefined}
            className="min-h-[52px] min-w-0 flex-1 rounded-xl border-2 border-slate-300 bg-white px-3 font-mono text-lg tabular-nums text-slate-900 focus:border-primary dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            placeholder="Answer"
          />
          {!result && (
            <button type="submit" className={`${btnPrimary} shrink-0`}>
              <Check className="h-5 w-5" aria-hidden="true" />
              Check
            </button>
          )}
        </form>
        {error && (
          <p id="calc-error" role="alert" className="mt-2 text-[15px] text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className={card}>
          <Verdict correct={result.correct}>{result.correct ? `Right: ${answerText}` : `The answer is ${answerText}`}</Verdict>
          {given !== null && !result.correct && (
            <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">
              You entered {formatNumber(given, 8)}
              {suffix}.
            </p>
          )}
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
            <FormulaAnswer formula={formula} showVariables={false} />
            {worked && (
              <div>
                <p className="text-[15px] font-semibold text-slate-600 dark:text-slate-400">Worked</p>
                <p className="mt-1 overflow-x-auto break-words rounded-lg bg-slate-100 px-3 py-2 font-mono text-base leading-relaxed text-slate-900 dark:bg-slate-800 dark:text-slate-100">
                  {symbol && (
                    <>
                      <Tex latex={symbol} /> ={' '}
                    </>
                  )}
                  {worked} = {formatNumber(round.answer, Math.max(decimals, 4))}
                  {suffix}
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
