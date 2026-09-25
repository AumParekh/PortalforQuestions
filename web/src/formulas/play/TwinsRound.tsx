import { useMemo, useRef, useState } from 'react';
import type { Round } from '../rounds';
import type { RoundResult } from '../run';
import { elapsedSeconds, submitRound } from '../submit';
import { Tex } from '../tex';
import type { Formula } from '../types';
import { Kbd, ReadingLine, Text, Verdict, card, choiceTone, useKeys } from '../ui';

export function TwinsRound({ round, byId, result }: { round: Extract<Round, { game: 'twins' }>; byId: Record<string, Formula>; result?: RoundResult }) {
  const [first, second] = round.order.map((id) => byId[id]);
  // Names in a fixed alphabetical order, so their position gives nothing away.
  const names = useMemo(() => [first, second].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)), [first, second]);
  const [chosen, setChosen] = useState<string | null>(null);
  const shownAt = useRef(performance.now());

  const answer = (id: string) => {
    if (result) return;
    setChosen(id);
    submitRound(round, { correct: id === round.order[0], seconds: elapsedSeconds(shownAt.current) });
  };

  useKeys((e) => {
    const n = Number(e.key);
    if ((n === 1 || n === 2) && names[n - 1]) {
      e.preventDefault();
      answer(names[n - 1].id);
    }
  }, !result);

  if (!first || !second) return null;

  const panel = (f: Formula, n: 1 | 2) => (
    <section className={`${card} ${result ? 'border-2 border-slate-200 dark:border-slate-700' : ''}`} aria-label={`Formula ${n}`}>
      <p className="text-[15px] font-semibold text-slate-600 dark:text-slate-400">Formula {n}</p>
      <Tex latex={f.latex} display />
      {result && (
        <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
          <p className="break-words text-lg font-semibold">{f.name}</p>
          <ReadingLine formula={f} />
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[15px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-100">Twin Split</p>
        <p className="mt-1 text-lg text-slate-900 dark:text-slate-50">Two look-alikes. Which is which?</p>
      </div>
      {panel(first, 1)}
      {panel(second, 2)}

      <section aria-label="Formula 1 is" className="space-y-2">
        <p className="text-[15px] font-medium text-slate-700 dark:text-slate-300">Formula 1 is…</p>
        {names.map((f, i) => {
          const state = !result ? 'idle' : f.id === round.order[0] ? 'right' : chosen === f.id ? 'wrong' : 'muted';
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => answer(f.id)}
              disabled={!!result}
              className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-2 text-left text-base font-semibold disabled:cursor-default ${choiceTone(state)}`}
            >
              <span className="min-w-0 flex-1 break-words">{f.name}</span>
              <Kbd>{i + 1}</Kbd>
            </button>
          );
        })}
      </section>

      {result && (
        <section className={card}>
          <Verdict correct={result.correct}>{result.correct ? 'Split correctly' : 'Swapped'}</Verdict>
          {round.why && <Text className="mt-2 text-slate-800 dark:text-slate-200">{round.why}</Text>}
        </section>
      )}
    </div>
  );
}
