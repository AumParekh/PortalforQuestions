import type { ReactNode } from 'react';
import { BookOpen, ChevronRight } from 'lucide-react';
import type { RecallTierInfo } from '../../lib/recallTiers';
import { accuracyOf } from '../../lib/stats';
import type { ContentFile, QuestionState } from '../../types';
import { AccuracyChip, ProgressBar } from './ProgressBar';

export interface FileProgress {
  attempted: number;
  accuracy: number | null;
}

export function fileProgress(file: Pick<ContentFile, 'questionIds'>, states: Record<string, QuestionState>): FileProgress {
  let attempted = 0;
  let correct = 0;
  let attempts = 0;
  for (const id of file.questionIds) {
    const s = states[id];
    if (!s || s.totalAttempts === 0) continue;
    attempted++;
    correct += s.totalCorrect;
    attempts += s.totalAttempts;
  }
  return { attempted, accuracy: accuracyOf(correct, attempts) };
}

/** One way into the portal: an icon, what it is, and one line on what it does or what is waiting there. */
export function ActionCard({
  icon,
  title,
  detail,
  onClick,
  disabled = false,
  primary = false,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const tone = primary
    ? 'bg-primary text-white hover:bg-primary-600'
    : 'bg-card-light text-slate-900 hover:border-primary-100 hover:shadow-md dark:bg-card-dark dark:text-slate-100 dark:hover:border-slate-600';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[64px] w-full items-start gap-3 rounded-2xl border border-transparent p-4 text-left shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-transparent disabled:hover:shadow-sm ${tone}`}
    >
      <span
        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          primary ? 'bg-white/15' : 'bg-primary-50 text-primary-600 dark:bg-slate-800 dark:text-primary-100'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug">{title}</span>
        <span className={`mt-0.5 block text-[15px] ${primary ? 'text-white/85' : 'text-slate-600 dark:text-slate-400'}`}>{detail}</span>
      </span>
      <ChevronRight className={`mt-2.5 h-5 w-5 shrink-0 ${primary ? 'text-white/70' : 'text-slate-400'}`} aria-hidden="true" />
    </button>
  );
}

export function FileCard({ file, progress, onOpen }: { file: ContentFile; progress: FileProgress; onOpen: () => void }) {
  const total = file.questionIds.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[44px] w-full items-start gap-3 rounded-2xl border border-transparent bg-card-light p-4 text-left shadow-sm transition hover:border-primary-100 hover:shadow-md dark:bg-card-dark dark:hover:border-slate-600 sm:p-5"
    >
      <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-slate-800 dark:text-primary-100">
        <BookOpen className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="block font-semibold leading-snug">{file.name}</span>
          <AccuracyChip accuracy={progress.accuracy} />
        </span>
        <span className="mt-2 flex items-center gap-3">
          <ProgressBar value={total ? progress.attempted / total : 0} label={`${file.name} attempted`} />
          <span className="shrink-0 text-[15px] tabular-nums text-slate-600 dark:text-slate-400">
            {progress.attempted.toLocaleString()}/{total.toLocaleString()}
          </span>
        </span>
      </span>
      <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  );
}

/** One recall-workbook tier: its questions (tiers overlap) and the Session Setup keys of its sections. */
export interface TierGroup {
  info: RecallTierInfo;
  questionIds: string[];
  sectionKeys: string[];
}

export function TierCard({ tier, progress, onOpen }: { tier: TierGroup; progress: FileProgress; onOpen: () => void }) {
  const total = tier.questionIds.length;
  const sections = tier.sectionKeys.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[44px] w-full items-start gap-3 rounded-2xl border border-transparent bg-card-light p-4 text-left shadow-sm transition hover:border-primary-100 hover:shadow-md dark:bg-card-dark dark:hover:border-slate-600 sm:p-5"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-lg font-bold text-primary-600 dark:bg-slate-800 dark:text-primary-100"
      >
        {tier.info.id}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="block font-semibold leading-snug">{tier.info.name}</span>
          <AccuracyChip accuracy={progress.accuracy} />
        </span>
        <span className="mt-0.5 block text-[15px] leading-snug text-slate-600 dark:text-slate-400">
          {tier.info.description} · {sections} {sections === 1 ? 'section' : 'sections'}
        </span>
        <span className="mt-2 flex items-center gap-3">
          <ProgressBar value={total ? progress.attempted / total : 0} label={`${tier.info.name} attempted`} />
          <span className="shrink-0 text-[15px] tabular-nums text-slate-600 dark:text-slate-400">
            {progress.attempted.toLocaleString()}/{total.toLocaleString()}
          </span>
        </span>
      </span>
      <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  );
}
