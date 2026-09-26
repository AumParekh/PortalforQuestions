import { useMemo, useState } from 'react';
import { ChevronRight, Clock, Flag, Info, ListChecks, Play, PlayCircle, Trash2 } from 'lucide-react';
import { navigate } from '../lib/router';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { ConfirmDialog } from '../components/settings/controls';
import { AccuracyChip } from '../components/dashboard/ProgressBar';
import type { ContentFile } from '../types';
import { answeredCount, areaMix, durationText, flaggedCount, hmsText, mockRoute, paperQuestionIds, remainingMs, timeLimitOf, timeUsedSeconds } from './model';
import { resultsFor, useMock } from './store';
import { Shell, btnDangerText, btnPrimary, card, formatWhen, sectionTitle, useNow } from './ui';

const RULES = [
  'No feedback until you submit: nothing is marked right or wrong before the end.',
  'You can change any answer, flag questions to come back to, and jump to any question.',
  "The clock keeps running if you leave this screen, switch apps or reload. You'll pick up where you were.",
  'When time runs out the exam is submitted automatically. Unanswered questions count as wrong.',
];

export function BriefingView({ slug, file }: { slug: string; file: ContentFile }) {
  const byId = useContent((s) => s.byId);
  const attempt = useMock((s) => s.attempts[slug]);
  const allResults = useMock((s) => s.results);
  const mockStatus = useMock((s) => s.status);
  const progressStatus = useProgress((s) => s.status);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const now = useNow(1000);

  const ids = useMemo(() => paperQuestionIds(file, byId), [file, byId]);
  const mix = useMemo(() => areaMix(ids, byId), [ids, byId]);
  const results = useMemo(() => resultsFor(allResults, slug), [allResults, slug]);
  const limit = timeLimitOf(file);

  const start = () => {
    if (ids.length === 0) return;
    useMock.getState().begin(slug, ids, limit);
    navigate(mockRoute({ kind: 'exam', slug }));
  };

  const resume = () => navigate(mockRoute({ kind: 'exam', slug }));

  const discard = () => {
    useMock.getState().discard(slug);
    setConfirmDiscard(false);
  };

  const left = attempt ? remainingMs(attempt, now) / 1000 : 0;

  return (
    <Shell title={file.name}>
      <div className="space-y-6">
        <section className={card} aria-label="Exam details">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[15px] text-slate-600 dark:text-slate-400">Questions</div>
              <div className="text-2xl font-bold tabular-nums">{ids.length}</div>
            </div>
            <div>
              <div className="text-[15px] text-slate-600 dark:text-slate-400">Time limit</div>
              <div className="text-2xl font-bold tabular-nums">{durationText(limit * 60)}</div>
            </div>
          </div>
          <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-400">
            About {durationText(ids.length ? (limit * 60) / ids.length : 0)} per question.
          </p>
          {mix.length > 0 && (
            <>
              <h2 className={`${sectionTitle} mt-5`}>Area mix</h2>
              <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
                {mix.map((a) => (
                  <li key={a.subject} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 break-words">{a.subject}</span>
                    <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-400">
                      {a.count} <span className="sr-only">questions</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className={card} aria-labelledby="rules-title">
          <h2 id="rules-title" className="flex items-center gap-2 font-semibold">
            <ListChecks className="h-5 w-5 text-primary" aria-hidden="true" />
            How it works
          </h2>
          <ul className="mt-3 space-y-2 text-base leading-relaxed">
            {RULES.map((r) => (
              <li key={r} className="flex gap-2">
                <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-400">
            Keys: 1–4 or A–D choose an answer, ← → move between questions, F flags.
          </p>
        </section>

        {(progressStatus === 'unavailable' || mockStatus === 'unavailable') && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[15px] text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            This browser isn't letting the portal save data, so the result will only last until you close the tab.
          </p>
        )}

        {attempt ? (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 sm:p-5" aria-label="Attempt in progress">
            <p className="flex items-center gap-2 font-semibold">
              <PlayCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              Attempt in progress
            </p>
            <p className="mt-1 text-[15px]">
              Started {formatWhen(new Date(attempt.startedAt).toISOString())} · {answeredCount(attempt)} of {attempt.questionIds.length} answered
              {flaggedCount(attempt) > 0 && ` · ${flaggedCount(attempt)} flagged`}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[15px] font-medium tabular-nums">
              <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
              {left > 0 ? `${hmsText(left)} left` : "Time's up: submitting…"}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={resume} className={`${btnPrimary} w-full sm:w-auto`}>
                <Play className="h-5 w-5" aria-hidden="true" />
                Resume
              </button>
              <button type="button" onClick={() => setConfirmDiscard(true)} className={`${btnDangerText} w-full sm:w-auto`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Discard attempt
              </button>
            </div>
          </section>
        ) : (
          <button type="button" onClick={start} disabled={ids.length === 0} className={`${btnPrimary} min-h-[56px] w-full text-lg`}>
            <Play className="h-5 w-5" aria-hidden="true" />
            Start
          </button>
        )}

        <section aria-labelledby="history-title">
          <h2 id="history-title" className={sectionTitle}>
            Past attempts
          </h2>
          {results.length === 0 ? (
            <p className="mt-2 text-[15px] text-slate-600 dark:text-slate-400">None yet. Your score and review will be kept here after you submit.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {results.map((r) => (
                <li key={r.resultId}>
                  <button
                    type="button"
                    onClick={() => navigate(mockRoute({ kind: 'results', slug, resultId: r.resultId }))}
                    className="flex min-h-[44px] w-full items-start gap-3 rounded-2xl bg-card-light p-4 text-left shadow-sm transition hover:shadow-md dark:bg-card-dark"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold tabular-nums">
                        {r.correct} / {r.total}
                      </span>
                      <span className="mt-0.5 block text-[15px] text-slate-600 dark:text-slate-400">
                        {formatWhen(r.submittedAt)} · {durationText(timeUsedSeconds(r))}
                        {r.endedBy === 'time' && ' · time ran out'}
                      </span>
                      {r.items.some((i) => i.flagged) && (
                        <span className="mt-0.5 flex items-center gap-1 text-[15px] text-slate-600 dark:text-slate-400">
                          <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                          {r.items.filter((i) => i.flagged).length} flagged
                        </span>
                      )}
                    </span>
                    <AccuracyChip accuracy={r.total ? r.correct / r.total : null} />
                    <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this attempt?"
        confirmLabel="Discard attempt"
        danger
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      >
        <p>Your answers so far are thrown away and nothing is scored or recorded. This can't be undone.</p>
      </ConfirmDialog>
    </Shell>
  );
}
