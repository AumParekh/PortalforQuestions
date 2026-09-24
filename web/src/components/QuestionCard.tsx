import type { AnswerRecord, OptionKey, Question } from '../types';
import { Markdown } from './Markdown';
import { OptionButton, type OptionState } from './OptionButton';

interface Props {
  question: Question;
  record: AnswerRecord | undefined;
  /** True only right after the user answered this question, so the wrong-answer shake doesn't replay on revisit. */
  animateFeedback: boolean;
  onSelect: (key: OptionKey) => void;
}

function optionState(key: OptionKey, question: Question, record: AnswerRecord | undefined): OptionState {
  if (!record) return 'idle';
  if (key === record.selected) return record.correct ? 'correct' : 'wrong';
  if (key === question.answer) return 'reveal';
  return 'dimmed';
}

export function QuestionCard({ question, record, animateFeedback, onSelect }: Props) {
  const stemSize = question.question.length > 800 ? 'text-lg' : 'text-xl';
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-card-light p-5 shadow-sm dark:border-slate-700 dark:bg-card-dark sm:p-6">
        <Markdown className={`${stemSize} leading-relaxed`}>{question.question}</Markdown>
      </div>
      <div className="flex flex-col gap-3" role="group" aria-label="Answer options">
        {question.options.map((opt) => (
          <OptionButton
            key={opt.key}
            letter={opt.key}
            text={opt.text}
            state={optionState(opt.key, question, record)}
            disabled={!!record}
            shake={animateFeedback}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
