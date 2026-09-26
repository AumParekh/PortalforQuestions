import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, LayoutGrid } from 'lucide-react';
import { navigate } from '../lib/router';
import { haptic } from '../lib/settings';
import { useContent } from '../store/content';
import { QuestionCard } from '../components/QuestionCard';
import { ConfirmDialog } from '../components/settings/controls';
import type { MockEndReason, OptionKey } from '../types';
import { ExamNavigator } from './ExamNavigator';
import { clockText, deadlineOf, mockRoute, questionNumber } from './model';
import { useMock } from './store';
import { submitMock } from './submit';
import { Countdown, iconButton, useNow } from './ui';

const KEY_MAP: Record<string, OptionKey> = { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e', a: 'a', b: 'b', c: 'c', d: 'd', e: 'e' };
/** A gap between time ticks longer than this means the device slept or the tab was frozen: not time on the question. */
const MAX_TICK_GAP_MS = 5000;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** The countdown on its own, so its ticks don't re-render the question. Calls `onExpire` once when it reaches zero. */
function ExamClock({ deadline, onExpire }: { deadline: number; onExpire: () => void }) {
  const now = useNow(500);
  const left = Math.max(0, deadline - now);
  const expired = left <= 0;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  useEffect(() => {
    if (expired) onExpireRef.current();
  }, [expired]);
  return <Countdown remainingSeconds={Math.ceil(left / 1000)} />;
}

export function ExamView({ slug }: { slug: string }) {
  // Field by field, so the once-a-second time bookkeeping (attempt.times) doesn't re-render the question.
  const attemptId = useMock((s) => s.attempts[slug]?.attemptId);
  const questionIds = useMock((s) => s.attempts[slug]?.questionIds);
  const answers = useMock((s) => s.attempts[slug]?.answers);
  const flags = useMock((s) => s.attempts[slug]?.flags);
  const currentIndex = useMock((s) => s.attempts[slug]?.currentIndex ?? 0);
  const startedAt = useMock((s) => s.attempts[slug]?.startedAt ?? 0);
  const timeLimitMinutes = useMock((s) => s.attempts[slug]?.timeLimitMinutes ?? 0);
  const results = useMock((s) => s.results);
  const byId = useContent((s) => s.byId);

  const [navOpen, setNavOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const seenAttempt = useRef(attemptId);
  const commitTime = useRef<() => void>(() => undefined);

  const ids = questionIds ?? [];
  const id = ids[currentIndex] ?? '';
  const q = id ? byId[id] : undefined;
  const numbers = useMemo(() => ids.map((qid, i) => questionNumber(byId[qid], i)), [ids, byId]);
  const answered = answers ? ids.reduce((n, qid) => (answers[qid] ? n + 1 : n), 0) : 0;
  const flagged = flags ? ids.reduce((n, qid) => (flags[qid] ? n + 1 : n), 0) : 0;
  const isFlagged = !!(id && flags?.[id]);
  const isLast = currentIndex >= ids.length - 1;

  // No attempt here: it was just submitted (here, in another tab, or by the clock) or never started.
  useEffect(() => {
    if (attemptId) {
      seenAttempt.current = attemptId;
      return;
    }
    const r = seenAttempt.current ? results.find((x) => x.resultId === seenAttempt.current) : undefined;
    navigate(r ? mockRoute({ kind: 'results', slug, resultId: r.resultId }) : mockRoute({ kind: 'briefing', slug }));
  }, [attemptId, results, slug]);

  // Time on the current question, counted only while the page is visible; banked every second so a reload keeps it.
  useEffect(() => {
    if (!id || !attemptId) return;
    let last = Date.now();
    let visible = document.visibilityState === 'visible';
    const commit = () => {
      const now = Date.now();
      const gap = now - last;
      last = now;
      if (visible && gap > 0 && gap < MAX_TICK_GAP_MS) useMock.getState().addTime(slug, id, gap);
    };
    const onVisibility = () => {
      commit();
      visible = document.visibilityState === 'visible';
    };
    commitTime.current = commit;
    const timer = window.setInterval(commit, 1000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', commit);
    return () => {
      commit();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', commit);
      commitTime.current = () => undefined;
    };
  }, [slug, id, attemptId]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [id]);

  const finish = useCallback(
    (endedBy: MockEndReason) => {
      commitTime.current();
      setConfirmOpen(false);
      setNavOpen(false);
      const r = submitMock(slug, endedBy);
      if (r) navigate(mockRoute({ kind: 'results', slug, resultId: r.resultId }));
    },
    [slug],
  );

  const onExpire = useCallback(() => {
    haptic([20, 40, 20]);
    finish('time');
  }, [finish]);

  const choose = useCallback(
    (key: OptionKey) => {
      if (!q) return;
      useMock.getState().select(slug, q.id, key);
      haptic(10);
    },
    [slug, q],
  );

  const goTo = useCallback((index: number) => useMock.getState().goTo(slug, index), [slug]);
  const prev = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex]);
  const next = useCallback(() => {
    if (isLast) setNavOpen(true);
    else goTo(currentIndex + 1);
  }, [goTo, currentIndex, isLast]);
  const toggleFlag = useCallback(() => {
    if (id) useMock.getState().toggleFlag(slug, id);
  }, [slug, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (navOpen || confirmOpen || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const optKey = KEY_MAP[k];
      if (optKey) {
        if (q?.options.some((o) => o.key === optKey)) {
          e.preventDefault();
          choose(optKey);
        }
      } else if (k === 'ArrowRight') {
        e.preventDefault();
        if (!isLast) next();
      } else if (k === 'ArrowLeft') {
        e.preventDefault();
        prev();
      } else if (k === 'f') {
        e.preventDefault();
        toggleFlag();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen, confirmOpen, q, choose, next, prev, toggleFlag, isLast]);

  if (!attemptId || !answers || !flags) return null;

  const deadline = deadlineOf({ startedAt, timeLimitMinutes });
  const unanswered = ids.length - answered;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto w-full max-w-[720px] px-4">
          <div className="flex items-center gap-1 py-1">
            <button
              type="button"
              onClick={() => navigate(mockRoute({ kind: 'briefing', slug }))}
              aria-label="Leave the exam (the clock keeps running)"
              className={iconButton}
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label={`Question ${numbers[currentIndex]} of ${ids.length}. Open the question navigator`}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-2 font-semibold tabular-nums text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <LayoutGrid className="h-5 w-5" aria-hidden="true" />
              {currentIndex + 1}/{ids.length}
            </button>
            <div className="ml-auto flex items-center gap-1">
              <ExamClock deadline={deadline} onExpire={onExpire} />
              <button
                type="button"
                onClick={toggleFlag}
                aria-label={isFlagged ? 'Remove flag' : 'Flag this question'}
                aria-pressed={isFlagged}
                className={`${iconButton} ${isFlagged ? '!text-amber-500 dark:!text-amber-400' : ''}`}
              >
                <Flag className="h-5 w-5" aria-hidden="true" fill={isFlagged ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>
          <p className="break-words pb-2 text-[15px] leading-snug text-slate-600 dark:text-slate-400">
            Question {numbers[currentIndex]}
            {q && <> · {q.subject}</>}
            <span aria-hidden="true"> · </span>
            {answered} answered
          </p>
        </div>
        <div
          className="h-1 w-full bg-slate-200 dark:bg-slate-800"
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={0}
          aria-valuemax={ids.length}
          aria-valuenow={answered}
        >
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${ids.length ? (answered / ids.length) * 100 : 0}%` }} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8 pt-5">
        {q ? (
          <QuestionCard question={q} record={undefined} animateFeedback={false} selected={answers[q.id]} onSelect={choose} />
        ) : (
          <p className="py-16 text-center text-slate-600 dark:text-slate-400">Question {id} could not be found. It will be left out of the score.</p>
        )}
      </main>

      <footer className="sticky bottom-0 z-30 border-t border-slate-200 bg-surface-light/90 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/90">
        <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-4">
          <button
            type="button"
            onClick={prev}
            disabled={currentIndex === 0}
            className="inline-flex min-h-[48px] items-center gap-1 rounded-xl border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            Prev
          </button>
          <button
            type="button"
            onClick={next}
            className="inline-flex min-h-[48px] items-center gap-1 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-600"
          >
            {isLast ? 'Overview' : 'Next'}
            {!isLast && <ChevronRight className="h-5 w-5" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="ml-auto inline-flex min-h-[48px] items-center rounded-xl border border-primary px-3 font-semibold text-primary hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
          >
            Submit
          </button>
        </div>
      </footer>

      <ExamNavigator
        open={navOpen}
        onClose={() => setNavOpen(false)}
        questionIds={ids}
        numbers={numbers}
        answers={answers}
        flags={flags}
        currentIndex={currentIndex}
        onJump={(index) => {
          goTo(index);
          setNavOpen(false);
        }}
        onSubmit={() => {
          setNavOpen(false);
          setConfirmOpen(true);
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title="Submit the exam?"
        confirmLabel="Submit exam"
        onConfirm={() => finish('submit')}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>
          {unanswered === 0 ? `All ${ids.length} questions answered` : `${unanswered} of ${ids.length} ${unanswered === 1 ? 'question is' : 'questions are'} unanswered and will count as wrong`}
          {flagged > 0 ? `, and ${flagged} ${flagged === 1 ? 'is' : 'are'} flagged.` : unanswered === 0 ? ', none flagged.' : '. None flagged.'}
        </p>
        <p>
          Time left: <span className="font-mono tabular-nums">{clockText(Math.max(0, (deadline - Date.now()) / 1000))}</span>. You can't change answers after
          submitting.
        </p>
      </ConfirmDialog>
    </div>
  );
}
