import { ChevronRight, ClipboardList, PlayCircle } from 'lucide-react';
import { navigate } from '../../lib/router';
import { answeredCount, durationText, hmsText, mockRoute, mockSlug, remainingMs, timeLimitOf } from '../../mock/model';
import type { MockAttempt } from '../../mock/model';
import { useNow } from '../../mock/ui';
import type { ContentFile, MockResult } from '../../types';
import { AccuracyChip } from './ProgressBar';

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Ticks on its own so Home doesn't re-render every second. */
function TimeLeft({ attempt }: { attempt: MockAttempt }) {
  const now = useNow(1000);
  return <>{hmsText(remainingMs(attempt, now) / 1000)} left</>;
}

/**
 * A mock exam on Home: the last score and date if taken, and Resume while an attempt is in progress. The card opens
 * the briefing (rules, area mix, past attempts); Resume goes straight back into the exam.
 */
export function MockCard({ file, results, attempt }: { file: ContentFile; results: MockResult[]; attempt?: MockAttempt }) {
  const slug = mockSlug(file.path);
  const last = results[0];
  const total = file.questionIds.length;
  const briefing = () => navigate(mockRoute({ kind: 'briefing', slug }));
  return (
    <div className="flex flex-col rounded-2xl bg-card-light shadow-sm dark:bg-card-dark">
      <button
        type="button"
        onClick={briefing}
        className="flex min-h-[44px] w-full flex-1 items-start gap-3 rounded-2xl border border-transparent p-4 text-left transition hover:border-primary-100 hover:shadow-md dark:hover:border-slate-600 sm:p-5"
      >
        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-slate-800 dark:text-primary-100">
          <ClipboardList className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="block font-semibold leading-snug">{file.name}</span>
            {last && <AccuracyChip accuracy={last.total ? last.correct / last.total : null} />}
          </span>
          <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">
            {total} questions · {durationText(timeLimitOf(file) * 60)}
          </span>
          <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">
            {last
              ? `Last: ${last.correct}/${last.total} on ${day(last.submittedAt)}${results.length > 1 ? ` · ${results.length} attempts` : ''}`
              : 'Not taken yet'}
          </span>
          {!attempt && <span className="mt-2 block text-[15px] font-medium text-primary-600 dark:text-primary-100">Start full mock</span>}
        </span>
        <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
      </button>
      {attempt && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <button
            type="button"
            onClick={() => navigate(mockRoute({ kind: 'exam', slug }))}
            className="flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-left text-amber-900 transition hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/40"
          >
            <PlayCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Resume</span>
              <span className="block text-[15px] opacity-80">
                {answeredCount(attempt)} of {attempt.questionIds.length} answered · <TimeLeft attempt={attempt} />
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Top-of-Home shortcut back into any mock whose clock is running (the mock cards sit far down the page). */
export function MockResumeBanners({ files, attempts }: { files: ContentFile[]; attempts: Record<string, MockAttempt> }) {
  const running = files.flatMap((f) => {
    const attempt = f.type === 'mock' ? attempts[mockSlug(f.path)] : undefined;
    return attempt ? [{ file: f, attempt }] : [];
  });
  return (
    <>
      {running.map(({ file, attempt }) => (
        <button
          key={file.path}
          type="button"
          onClick={() => navigate(mockRoute({ kind: 'exam', slug: attempt.slug }))}
          className="mt-4 flex min-h-[44px] w-full items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left text-amber-900 shadow-sm transition hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/40"
        >
          <PlayCircle className="h-6 w-6 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block break-words font-semibold">Resume {file.name}</span>
            <span className="block text-[15px] opacity-80">
              {answeredCount(attempt)} of {attempt.questionIds.length} answered · <TimeLeft attempt={attempt} />
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
        </button>
      ))}
    </>
  );
}
