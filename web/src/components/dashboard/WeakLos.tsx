import { ChevronRight, Target } from 'lucide-react';
import type { GroupProgress } from '../../lib/stats';
import { startLoDrill } from './launch';
import { AccuracyChip } from './ProgressBar';

export function WeakLos({ groups }: { groups: GroupProgress[] }) {
  if (groups.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-card-light p-4 text-[15px] text-slate-600 shadow-sm dark:bg-card-dark dark:text-slate-400 sm:p-5">
        <Target className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>Answer a few questions and your weakest learning objectives will show up here.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-200 rounded-2xl bg-card-light shadow-sm dark:divide-slate-700 dark:bg-card-dark">
      {groups.map((g) => (
        <li key={g.key}>
          <button
            type="button"
            onClick={() => startLoDrill(g.key, g.questionIds)}
            className="flex min-h-[56px] w-full items-start gap-3 p-4 text-left transition first:rounded-t-2xl last:rounded-b-2xl hover:bg-slate-50 dark:hover:bg-slate-800/60 sm:px-5"
          >
            <span className="min-w-0 flex-1">
              <span className="block break-words leading-snug">{g.label}</span>
              <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">
                {g.subject} · {g.attempts} {g.attempts === 1 ? 'attempt' : 'attempts'} · {g.total} {g.total === 1 ? 'question' : 'questions'}
              </span>
            </span>
            <AccuracyChip accuracy={g.accuracy} />
            <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
