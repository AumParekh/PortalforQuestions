import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Equal, HelpCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { outputOf } from '../latex';
import type { Round } from '../rounds';
import type { RoundResult } from '../run';
import { elapsedSeconds, submitRound } from '../submit';
import { Tex } from '../tex';
import type { Direction, Formula } from '../types';
import { FormulaAnswer, Kbd, RoundHeader, Text, Verdict, card, choiceTone, useKeys } from '../ui';

const CHOICES: { dir: Direction; label: string; icon: ReactNode; key: string }[] = [
  { dir: 'up', label: 'Rises', icon: <ArrowUp className="h-6 w-6" aria-hidden="true" />, key: '1' },
  { dir: 'down', label: 'Falls', icon: <ArrowDown className="h-6 w-6" aria-hidden="true" />, key: '2' },
  { dir: 'none', label: 'No change', icon: <Equal className="h-6 w-6" aria-hidden="true" />, key: '3' },
  { dir: 'depends', label: 'Depends', icon: <HelpCircle className="h-6 w-6" aria-hidden="true" />, key: '4' },
];

const SAY: Record<Direction, string> = { up: 'rises', down: 'falls', none: 'doesn’t change', depends: 'depends on other inputs' };

export function WhichWayRound({ round, formula, result }: { round: Extract<Round, { game: 'whichway' }>; formula: Formula; result?: RoundResult }) {
  const s = formula.sensitivities[round.sensitivity];
  const [chosen, setChosen] = useState<Direction | null>(null);
  const shownAt = useRef(performance.now());
  const output = outputOf(formula.latex) ?? formula.calc?.output.symbol ?? null;

  const answer = (dir: Direction) => {
    if (result || !s) return;
    setChosen(dir);
    submitRound(round, { correct: dir === s.direction, seconds: elapsedSeconds(shownAt.current) });
  };

  useKeys((e) => {
    const map: Record<string, Direction> = { '1': 'up', '2': 'down', '3': 'none', '4': 'depends', ArrowUp: 'up', ArrowDown: 'down' };
    const dir = map[e.key];
    if (dir) {
      e.preventDefault();
      answer(dir);
    }
  }, !result);

  if (!s) return null;

  return (
    <div className="space-y-4">
      <section className={card}>
        <RoundHeader formula={formula} title="Which Way?" />
        <p className="mt-4 text-xl leading-relaxed text-slate-900 dark:text-slate-50">
          If <Tex latex={s.variable} /> rises, {output ? <Tex latex={output} /> : <span className="font-semibold">the result</span>} …
        </p>
        <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">Everything else held constant.</p>
      </section>

      <div className="grid grid-cols-2 gap-2">
        {CHOICES.map((c) => {
          const state = !result ? 'idle' : c.dir === s.direction ? 'right' : chosen === c.dir ? 'wrong' : 'muted';
          return (
            <button
              key={c.dir}
              type="button"
              onClick={() => answer(c.dir)}
              disabled={!!result}
              className={`inline-flex min-h-[64px] items-center justify-center gap-2 rounded-2xl border-2 px-2 text-lg font-semibold disabled:cursor-default ${choiceTone(state)}`}
            >
              {c.icon}
              {c.label}
              <Kbd>{c.key}</Kbd>
            </button>
          );
        })}
      </div>

      {result && (
        <section className={card}>
          <Verdict correct={result.correct}>
            {output ? (
              <span>
                <Tex latex={output} /> {SAY[s.direction]}
              </span>
            ) : (
              `It ${SAY[s.direction]}`
            )}
          </Verdict>
          {s.why && <Text className="mt-2 text-slate-800 dark:text-slate-200">{s.why}</Text>}
          <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
            <FormulaAnswer formula={formula} showVariables={false} />
          </div>
        </section>
      )}
    </div>
  );
}
