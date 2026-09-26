import { Check, X } from 'lucide-react';
import type { OptionKey } from '../types';
import { Markdown } from './Markdown';

/** 'selected': chosen but not yet marked (mock exams, where feedback waits for submission). */
export type OptionState = 'idle' | 'selected' | 'correct' | 'wrong' | 'reveal' | 'dimmed';

interface Props {
  letter: OptionKey;
  text: string;
  state: OptionState;
  disabled: boolean;
  shake?: boolean;
  onSelect: (key: OptionKey) => void;
}

const BOX: Record<OptionState, string> = {
  idle:
    'border-slate-200 bg-card-light hover:border-primary hover:bg-primary-50 active:scale-[0.99] dark:border-slate-700 dark:bg-card-dark dark:hover:border-primary dark:hover:bg-slate-800',
  selected: 'border-primary bg-primary-50 active:scale-[0.99] dark:border-primary dark:bg-primary/20',
  correct: 'border-emerald-600 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/40',
  wrong: 'border-red-600 bg-red-50 dark:border-red-500 dark:bg-red-950/40',
  reveal: 'border-emerald-600 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/40',
  dimmed: 'border-slate-200 bg-card-light opacity-60 dark:border-slate-700 dark:bg-card-dark',
};

const BADGE: Record<OptionState, string> = {
  idle: 'border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200',
  selected: 'border-primary bg-primary text-white',
  correct: 'border-emerald-600 bg-emerald-600 text-white',
  wrong: 'border-red-600 bg-red-600 text-white',
  reveal: 'border-emerald-600 bg-emerald-600 text-white',
  dimmed: 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400',
};

const SR_STATUS: Partial<Record<OptionState, string>> = {
  selected: ' (selected)',
  correct: ' (your answer, correct)',
  wrong: ' (your answer, incorrect)',
  reveal: ' (correct answer)',
};

export function OptionButton({ letter, text, state, disabled, shake = false, onSelect }: Props) {
  const showCheck = state === 'correct' || state === 'reveal';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(letter)}
      aria-label={`Option ${letter.toUpperCase()}${SR_STATUS[state] ?? ''}`}
      className={`flex min-h-[56px] w-full items-start gap-3 rounded-xl border-2 p-4 text-left text-base transition-colors duration-100 disabled:cursor-default ${BOX[state]} ${
        shake && state === 'wrong' ? 'animate-shake' : ''
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-[15px] font-semibold ${BADGE[state]}`}
      >
        {showCheck ? <Check className="h-4 w-4" /> : state === 'wrong' ? <X className="h-4 w-4" /> : letter.toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 break-words pt-1">
        <Markdown>{text}</Markdown>
      </span>
    </button>
  );
}
