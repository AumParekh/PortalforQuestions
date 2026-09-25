import { useEffect, useRef, useState } from 'react';
import { haptic } from '../../lib/settings';
import type { Round } from '../rounds';
import type { RoundResult } from '../run';
import { elapsedSeconds, submitRound } from '../submit';
import { Tex } from '../tex';
import type { Formula } from '../types';
import { FormulaAnswer, RoundHeader, Verdict, card, choiceTone } from '../ui';

const FLASH_MS = 450;

export function SymbolsRound({ round, formula, result }: { round: Extract<Round, { game: 'symbols' }>; formula: Formula; result?: RoundResult }) {
  // Variable indexes matched so far, per side; a pair is right when a symbol meets its own meaning
  // (or an identical one, should two variables share a meaning).
  const [matchedSymbols, setMatchedSymbols] = useState<number[]>(() => (result ? [...round.symbols] : []));
  const [matchedMeanings, setMatchedMeanings] = useState<number[]>(() => (result ? [...round.meanings] : []));
  const [symbol, setSymbol] = useState<number | null>(null);
  const [meaning, setMeaning] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ symbol: number; meaning: number } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const shownAt = useRef(performance.now());
  const flashTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const tryPair = (s: number, m: number) => {
    setSymbol(null);
    setMeaning(null);
    const same = s === m || formula.variables[s].meaning.toLowerCase() === formula.variables[m].meaning.toLowerCase();
    if (same) {
      const next = [...matchedSymbols, s];
      setMatchedSymbols(next);
      setMatchedMeanings((prev) => [...prev, m]);
      haptic(8);
      if (next.length === round.symbols.length) {
        submitRound(round, { correct: mistakes === 0, nearMiss: mistakes === 1, seconds: elapsedSeconds(shownAt.current) });
      }
      return;
    }
    setMistakes((n) => n + 1);
    haptic([20, 40, 20]);
    setFlash({ symbol: s, meaning: m });
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  const tapSymbol = (s: number) => {
    if (result || matchedSymbols.includes(s)) return;
    if (meaning !== null) tryPair(s, meaning);
    else setSymbol((cur) => (cur === s ? null : s));
  };

  const tapMeaning = (m: number) => {
    if (result || matchedMeanings.includes(m)) return;
    if (symbol !== null) tryPair(symbol, m);
    else setMeaning((cur) => (cur === m ? null : m));
  };

  const tone = (done: boolean, selected: boolean, flashing: boolean) =>
    done ? choiceTone('right') : flashing ? choiceTone('wrong') : selected ? choiceTone('selected') : choiceTone('idle');

  return (
    <div className="space-y-4">
      <section className={card}>
        <RoundHeader formula={formula} title="Symbol Match" />
        <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-400">Tap a symbol, then what it means (either order works).</p>
      </section>

      <section aria-label="Symbols" className="flex flex-wrap gap-2">
        {round.symbols.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => tapSymbol(s)}
            disabled={!!result || matchedSymbols.includes(s)}
            aria-pressed={symbol === s}
            className={`inline-flex min-h-[52px] min-w-[56px] max-w-full items-center justify-center rounded-xl border-2 px-3 py-1 disabled:cursor-default ${tone(
              matchedSymbols.includes(s),
              symbol === s,
              flash?.symbol === s,
            )}`}
          >
            <Tex latex={formula.variables[s].symbol} className="text-lg" />
          </button>
        ))}
      </section>

      <section aria-label="Meanings" className="space-y-2">
        {round.meanings.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => tapMeaning(m)}
            disabled={!!result || matchedMeanings.includes(m)}
            aria-pressed={meaning === m}
            className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 px-3 py-2 text-left disabled:cursor-default ${tone(
              matchedMeanings.includes(m),
              meaning === m,
              flash?.meaning === m,
            )}`}
          >
            {matchedMeanings.includes(m) && (
              <span className="shrink-0">
                <Tex latex={formula.variables[m].symbol} />
              </span>
            )}
            <span className="min-w-0 flex-1 break-words text-base leading-snug">{formula.variables[m].meaning}</span>
          </button>
        ))}
      </section>

      {result && (
        <section className={card}>
          <Verdict correct={result.correct}>{result.correct ? 'All matched first time' : `Matched, with ${mistakes || 'some'} wrong ${mistakes === 1 ? 'pairing' : 'pairings'}`}</Verdict>
          <div className="mt-3">
            <FormulaAnswer formula={formula} />
          </div>
        </section>
      )}
    </div>
  );
}
