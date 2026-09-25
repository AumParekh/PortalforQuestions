import { useRef, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { Round } from '../rounds';
import type { RoundResult } from '../run';
import { elapsedSeconds, submitRound } from '../submit';
import { Tex } from '../tex';
import type { Formula } from '../types';
import { Kbd, RoundHeader, Text, Verdict, VariableList, card, choiceTone, useKeys } from '../ui';

export function AuctionRound({
  round,
  formula,
  result,
  bid,
}: {
  round: Extract<Round, { game: 'auction' }>;
  formula: Formula;
  result?: RoundResult;
  /** The session's bid after this round, when bidding (timed Variable Auction). */
  bid: number | null;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const shownAt = useRef(performance.now());
  const v = formula.variables[round.variable];

  const pick = (i: number) => {
    if (result) return;
    setChosen(i);
    submitRound(round, { correct: i === round.answer, seconds: elapsedSeconds(shownAt.current) });
  };

  useKeys((e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= round.options.length) {
      e.preventDefault();
      pick(n - 1);
    }
  }, !result);

  if (!v) return null;

  return (
    <div className="space-y-4">
      <section className={card}>
        <RoundHeader formula={formula} title="Variable Auction" />
        <div className="mt-3 rounded-xl border border-slate-200 px-2 dark:border-slate-700">
          <Tex latex={round.highlighted ?? formula.latex} display />
        </div>
        <p className="mt-3 text-lg text-slate-900 dark:text-slate-50">
          What is <Tex latex={v.symbol} /> here?
        </p>
      </section>

      <section aria-label="Definitions" className="space-y-2">
        {round.options.map((o, i) => {
          const state = !result ? 'idle' : i === round.answer ? 'right' : chosen === i ? 'wrong' : 'muted';
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              disabled={!!result}
              className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-2 text-left disabled:cursor-default ${choiceTone(state)}`}
            >
              <span className="min-w-0 flex-1 break-words text-base leading-snug">{o}</span>
              <Kbd>{i + 1}</Kbd>
            </button>
          );
        })}
      </section>

      {result && (
        <section className={card}>
          <Verdict correct={result.correct}>{result.correct ? 'Right' : 'Not that one'}</Verdict>
          {bid !== null && (
            <p
              className={`mt-1 inline-flex items-center gap-1.5 text-[15px] font-semibold ${
                result.correct ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
              }`}
            >
              {result.correct ? <TrendingUp className="h-4 w-4" aria-hidden="true" /> : <TrendingDown className="h-4 w-4" aria-hidden="true" />}
              Bid {result.correct ? 'raised' : 'down'} to {bid}
            </p>
          )}
          {formula.intuition && <Text className="mt-2 text-slate-700 dark:text-slate-300">{formula.intuition}</Text>}
          <VariableList formula={formula} className="mt-3" />
        </section>
      )}
    </div>
  );
}
