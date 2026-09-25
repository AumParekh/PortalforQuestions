import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { Markdown } from '../components/Markdown';
import type { SenseResult } from './store';
import type { Scenario } from './types';
import { ModeTag, ReadingLine, prefersReducedMotion } from './ui';
import { WorkingPanel } from './Working';

type ButtonState = 'idle' | 'right' | 'wrong' | 'rising' | 'muted';

const BOX: Record<ButtonState, string> = {
  idle: 'border-slate-200 bg-card-light hover:border-primary hover:bg-primary-50 active:scale-[0.99] dark:border-slate-700 dark:bg-card-dark dark:hover:border-primary dark:hover:bg-slate-800',
  // A right answer snaps: no easing on the colour change.
  right: 'border-emerald-600 bg-emerald-50 duration-0 dark:border-emerald-500 dark:bg-emerald-950/40',
  wrong: 'border-red-600 bg-red-50 dark:border-red-500 dark:bg-red-950/40',
  // After a miss the correct option rises to meet the player.
  rising:
    'relative z-[1] -translate-y-1 border-emerald-600 bg-emerald-50 shadow-lg ring-2 ring-emerald-500/50 duration-700 ease-out motion-reduce:translate-y-0 dark:border-emerald-500 dark:bg-emerald-950/40',
  muted: 'border-slate-200 bg-card-light opacity-60 dark:border-slate-700 dark:bg-card-dark',
};

const BADGE: Record<ButtonState, string> = {
  idle: 'border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200',
  right: 'border-emerald-600 bg-emerald-600 text-white',
  wrong: 'border-red-600 bg-red-600 text-white',
  rising: 'border-emerald-600 bg-emerald-600 text-white',
  muted: 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400',
};

const SR: Partial<Record<ButtonState, string>> = {
  right: ' (your answer, correct)',
  wrong: ' (your answer, incorrect)',
  rising: ' (correct answer)',
};

function stateOf(i: number, scenario: Scenario, result: SenseResult | undefined): ButtonState {
  if (!result) return 'idle';
  if (i === result.chosen) return result.correct ? 'right' : 'wrong';
  if (!result.correct && scenario.options[i].correct) return 'rising';
  return 'muted';
}

interface Props {
  scenario: Scenario;
  result: SenseResult | undefined;
  /** True once the working should unfold (at once when right, after the hold when wrong). */
  revealed: boolean;
  onAnswer: (index: number) => void;
}

/** The shared frame for all three modes: scenario on top, 3–4 buttons, working underneath once answered. */
export function RoundView({ scenario, result, revealed, onAnswer }: Props) {
  const workingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!revealed) return;
    workingRef.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [revealed]);

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <ModeTag mode={scenario.mode} />
        <ReadingLine scenario={scenario} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-card-light p-4 shadow-sm dark:border-slate-700 dark:bg-card-dark sm:p-6">
        <Markdown className="text-lg leading-relaxed text-slate-900 dark:text-slate-100">{scenario.setup}</Markdown>
        <Markdown className="mt-4 text-xl font-semibold leading-snug text-slate-900 dark:text-slate-50">{scenario.ask}</Markdown>
      </div>

      <div className="flex flex-col gap-3" role="group" aria-label="Your call">
        {scenario.options.map((opt, i) => {
          const state = stateOf(i, scenario, result);
          return (
            <button
              key={i}
              type="button"
              disabled={!!result}
              onClick={() => onAnswer(i)}
              className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-base transition-[transform,box-shadow,background-color,border-color,opacity] motion-reduce:transition-none disabled:cursor-default ${BOX[state]}`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-[15px] font-semibold ${BADGE[state]}`}
                aria-hidden="true"
              >
                {state === 'right' || state === 'rising' ? <Check className="h-4 w-4" /> : state === 'wrong' ? <X className="h-4 w-4" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1 break-words">
                <Markdown className="leading-relaxed text-slate-900 dark:text-slate-100">{opt.label}</Markdown>
                {SR[state] && <span className="sr-only">{SR[state]}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {result && (
        <p role="status" className="sr-only">
          {result.correct ? 'Correct.' : `Not quite. The answer is ${scenario.options.find((o) => o.correct)?.label ?? ''}.`}
        </p>
      )}

      {result && revealed && (
        <div ref={workingRef} className="scroll-mt-24">
          <WorkingPanel scenario={scenario} chosen={result.chosen} />
        </div>
      )}
    </div>
  );
}
