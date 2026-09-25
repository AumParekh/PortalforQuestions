import { useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import type { Round } from '../rounds';
import type { RoundResult } from '../run';
import { elapsedSeconds, submitRound } from '../submit';
import type { Formula } from '../types';
import { FormulaAnswer, Kbd, RoundHeader, Text, btnPrimary, card, useKeys } from '../ui';

const GRADES = [
  { label: 'Again', grade: 1, hint: 'Didn’t have it', tone: 'border-red-600 text-red-700 hover:bg-red-50 dark:border-red-500 dark:text-red-300 dark:hover:bg-red-500/10' },
  { label: 'Hard', grade: 3, hint: 'Got there, slowly', tone: 'border-amber-500 text-amber-800 hover:bg-amber-50 dark:border-amber-400 dark:text-amber-200 dark:hover:bg-amber-400/10' },
  { label: 'Good', grade: 4, hint: 'Had it', tone: 'border-emerald-600 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-500/10' },
  { label: 'Easy', grade: 5, hint: 'Instant', tone: 'border-primary text-primary-700 hover:bg-primary-50 dark:border-primary dark:text-primary-100 dark:hover:bg-primary/15' },
];

export function RecallRound({ round, formula, result }: { round: Extract<Round, { game: 'recall' }>; formula: Formula; result?: RoundResult }) {
  const [revealed, setRevealed] = useState(!!result);
  const [chosen, setChosen] = useState<number | null>(null);
  const shownAt = useRef(performance.now());

  const grade = (i: number) => {
    if (result || !revealed) return;
    const g = GRADES[i];
    setChosen(i);
    submitRound(round, { correct: g.grade >= 3, grade: g.grade, seconds: elapsedSeconds(shownAt.current) });
  };

  useKeys((e) => {
    if (!revealed) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setRevealed(true);
      }
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 4) {
      e.preventDefault();
      grade(n - 1);
    }
  }, !result);

  return (
    <div className="space-y-4">
      <section className={card}>
        <RoundHeader formula={formula} title="Recall" />
        {formula.prompt && <Text className="mt-4 text-lg text-slate-800 dark:text-slate-100">{formula.prompt}</Text>}
        {!revealed ? (
          <>
            <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">Write it down or say it out loud, then reveal.</p>
            <button type="button" onClick={() => setRevealed(true)} className={`${btnPrimary} mt-4 w-full`}>
              <Eye className="h-5 w-5" aria-hidden="true" />
              Reveal
              <Kbd>Space</Kbd>
            </button>
          </>
        ) : (
          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
            <FormulaAnswer formula={formula} />
          </div>
        )}
      </section>

      {revealed && (
        <section aria-label="How well did you recall it?" className="space-y-2">
          <p className="text-[15px] font-medium text-slate-700 dark:text-slate-300">
            {result ? 'Graded. It comes back sooner the lower you graded it.' : 'How well did you have it?'}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GRADES.map((g, i) => {
              const picked = chosen === i;
              return (
                <button
                  key={g.label}
                  type="button"
                  disabled={!!result}
                  aria-pressed={picked}
                  onClick={() => grade(i)}
                  className={`flex min-h-[64px] flex-col items-center justify-center rounded-2xl border-2 bg-card-light px-2 py-2 text-center font-semibold transition-colors motion-reduce:transition-none disabled:cursor-default dark:bg-card-dark ${g.tone} ${
                    result && !picked ? 'opacity-50' : ''
                  } ${picked ? 'ring-2 ring-current ring-offset-2 ring-offset-surface-light dark:ring-offset-surface-dark' : ''}`}
                >
                  <span className="text-lg">
                    {g.label}
                    <Kbd>{i + 1}</Kbd>
                  </span>
                  <span className="text-[15px] font-normal opacity-80">{g.hint}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
