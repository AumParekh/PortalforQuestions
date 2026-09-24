import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { groupProgress } from '../../lib/stats';
import type { ContentFile, Question, QuestionState } from '../../types';
import { startTopicDrill } from './launch';
import { AccuracyChip, ProgressBar } from './ProgressBar';

interface Props {
  subjectFiles: ContentFile[];
  byId: Record<string, Question>;
  states: Record<string, QuestionState>;
}

export function TopicMap({ subjectFiles, byId, states }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => (subjectFiles[0] ? { [subjectFiles[0].path]: true } : {}));

  const sections = useMemo(
    () =>
      subjectFiles.map((file) => {
        const qs = file.questionIds.map((id) => byId[id]).filter((q): q is Question => !!q);
        const topics = groupProgress(qs, states, (q) => ({ key: `${q.subject}::${q.topic}`, label: q.topic }));
        const attempted = topics.reduce((n, t) => n + t.attempted, 0);
        return { file, topics, attempted, total: qs.length };
      }),
    [subjectFiles, byId, states],
  );

  return (
    <div className="space-y-3">
      {sections.map(({ file, topics, attempted, total }) => {
        const isOpen = !!open[file.path];
        const panelId = `topics-${file.path.replace(/[^a-z0-9]/gi, '-')}`;
        return (
          <div key={file.path} className="rounded-2xl bg-card-light shadow-sm dark:bg-card-dark">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [file.path]: !o[file.path] }))}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60 sm:px-5"
            >
              {isOpen ? (
                <ChevronDown className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 font-semibold">{file.name}</span>
              <span className="shrink-0 text-[15px] tabular-nums text-slate-600 dark:text-slate-400">
                {attempted}/{total}
              </span>
            </button>
            {isOpen && (
              <ul id={panelId} className="grid grid-cols-1 gap-2 px-3 pb-3 sm:grid-cols-2 sm:px-4 sm:pb-4">
                {topics.map((t) => (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => startTopicDrill(t.key, t.questionIds)}
                      aria-label={`Drill ${t.label}: ${t.attempted} of ${t.total} attempted`}
                      className="flex h-full min-h-[44px] w-full flex-col gap-2 rounded-xl border border-slate-200 p-3 text-left transition hover:border-primary-100 hover:bg-primary-50/50 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                    >
                      <span className="flex w-full items-start justify-between gap-2">
                        <span className="min-w-0 break-words text-[15px] font-medium leading-snug">{t.label}</span>
                        <AccuracyChip accuracy={t.accuracy} />
                      </span>
                      <span className="mt-auto flex w-full items-center gap-3">
                        <ProgressBar value={t.total ? t.attempted / t.total : 0} label={`${t.label} attempted`} />
                        <span className="shrink-0 text-[15px] tabular-nums text-slate-600 dark:text-slate-400">
                          {t.attempted}/{t.total}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
