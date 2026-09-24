import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, LayoutGrid, SkipForward } from 'lucide-react';
import { useSession } from '../store/session';
import { useContent } from '../store/content';
import { navigate } from '../lib/router';
import { useTimer } from '../hooks/useTimer';
import { Timer } from '../components/Timer';
import { QuestionCard } from '../components/QuestionCard';
import { SolutionPanel } from '../components/SolutionPanel';
import { JumpDrawer } from '../components/JumpDrawer';
import type { OptionKey } from '../types';

const UNTIMED_SECONDS = 24 * 60 * 60;
const TABLE_RE = /^\s*\|.*\|\s*$/m;
const KEY_MAP: Record<string, OptionKey> = { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e', a: 'a', b: 'b', c: 'c', d: 'd', e: 'e' };

function haptic(pattern: number | number[]) {
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches) navigator.vibrate?.(pattern);
  } catch {
    // vibrate can throw in some embedded browsers; feedback is optional
  }
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function QuestionScreen() {
  const status = useSession((s) => s.status);
  const config = useSession((s) => s.config);
  const queue = useSession((s) => s.queue);
  const currentIndex = useSession((s) => s.currentIndex);
  const answers = useSession((s) => s.answers);
  const marked = useSession((s) => s.marked);
  const answer = useSession((s) => s.answer);
  const next = useSession((s) => s.next);
  const prev = useSession((s) => s.prev);
  const skip = useSession((s) => s.skip);
  const toggleMark = useSession((s) => s.toggleMark);
  const finish = useSession((s) => s.finish);
  const byId = useContent((s) => s.byId);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [justAnswered, setJustAnswered] = useState<string | null>(null);

  const id = queue[currentIndex] ?? '';
  const q = id ? byId[id] : undefined;
  const record = id ? answers[id] : undefined;
  const answered = !!record;
  const isLast = currentIndex >= queue.length - 1;
  const timerEnabled = !!config?.timerEnabled;
  const timerSeconds = config?.timerSeconds ?? 120;
  const compact = !!q && (q.question.length > 500 || TABLE_RE.test(q.question));
  const answeredCount = queue.reduce((n, qid) => (answers[qid] ? n + 1 : n), 0);

  const onExpire = useCallback(() => {
    if (!timerEnabled || !id || useSession.getState().answers[id]) return;
    answer(id, '', false, timerSeconds, true);
    setJustAnswered(id);
    haptic([20, 40, 20]);
  }, [timerEnabled, id, answer, timerSeconds]);

  // Always runs while unanswered so time taken is recorded even with the countdown off.
  const { remaining, elapsed } = useTimer(
    timerEnabled ? timerSeconds : UNTIMED_SECONDS,
    !answered && status === 'active' && !!q,
    id,
    onExpire,
  );

  const finishSession = useCallback(() => {
    finish();
    navigate('/summary');
  }, [finish]);

  useEffect(() => {
    if (status === 'active' && queue.length === 0) finishSession();
  }, [status, queue.length, finishSession]);

  useEffect(() => {
    setJustAnswered(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [id]);

  const choose = useCallback(
    (key: OptionKey) => {
      if (!q || useSession.getState().answers[q.id]) return;
      const correct = key === q.answer;
      answer(q.id, key, correct, elapsed);
      setJustAnswered(q.id);
      haptic(correct ? 10 : [20, 40, 20]);
    },
    [q, answer, elapsed],
  );

  const goNext = useCallback(() => {
    if (isLast) {
      const left = queue.length - answeredCount;
      if (left > 0 && !window.confirm(`Finish with ${left} unanswered question${left === 1 ? '' : 's'}?`)) return;
      finishSession();
      return;
    }
    if (answered) next();
  }, [answered, isLast, finishSession, next, queue.length, answeredCount]);

  const doSkip = useCallback(() => {
    if (!answered) skip();
  }, [answered, skip]);

  const leave = () => {
    if (!window.confirm('Leave this session?')) return;
    useSession.getState().reset();
    navigate('/setup');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (drawerOpen || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const optKey = KEY_MAP[k];
      if (optKey && q && !answered) {
        if (q.options.some((o) => o.key === optKey)) {
          e.preventDefault();
          choose(optKey);
        }
        return;
      }
      if (k === 'ArrowRight' || (k === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLElement && e.target.closest('summary, a')))) {
        if (answered) {
          e.preventDefault();
          goNext();
        }
      } else if (k === 'ArrowLeft') {
        e.preventDefault();
        prev();
      } else if (k === 's') {
        doSkip();
      } else if (k === 'm' && id) {
        toggleMark(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, q, answered, choose, goNext, prev, doSkip, toggleMark, id]);

  const isMarked = !!(id && marked[id]);
  const progress = queue.length > 0 ? (answeredCount / queue.length) * 100 : 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto w-full max-w-[720px] px-4">
          <div className="flex items-center gap-1 py-1">
            <button
              type="button"
              onClick={leave}
              aria-label="Leave session"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Jump to question"
              className="min-h-[44px] shrink-0 rounded-xl px-3 font-semibold tabular-nums text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              {queue.length > 0 ? currentIndex + 1 : 0} / {queue.length}
            </button>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open question grid"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LayoutGrid className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => id && toggleMark(id)}
                aria-label={isMarked ? 'Unmark question' : 'Mark for review'}
                aria-pressed={isMarked}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 ${
                  isMarked ? 'text-purple-600 dark:text-purple-400' : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                <Flag className="h-5 w-5" aria-hidden="true" fill={isMarked ? 'currentColor' : 'none'} />
              </button>
              {timerEnabled && !answered && q && <Timer remaining={remaining} total={timerSeconds} compact={compact} />}
            </div>
          </div>
          {q && (
            <p className="break-words pb-2 text-[15px] leading-snug text-slate-600 dark:text-slate-400">{q.topic}</p>
          )}
        </div>
        <div
          className="h-1 w-full bg-slate-200 dark:bg-slate-800"
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={0}
          aria-valuemax={queue.length}
          aria-valuenow={answeredCount}
        >
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8 pt-5">
        {q ? (
          <div className="space-y-6">
            <QuestionCard question={q} record={record} animateFeedback={justAnswered === q.id} onSelect={choose} />
            {record && (
              <SolutionPanel
                key={q.id}
                question={q}
                record={record}
                marked={isMarked}
                onToggleMark={() => toggleMark(q.id)}
              />
            )}
          </div>
        ) : (
          <p className="py-16 text-center text-slate-600 dark:text-slate-400">
            {id ? `Question ${id} could not be found.` : 'No questions left in this session.'}
          </p>
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
          {!answered && q && (
            <button
              type="button"
              onClick={doSkip}
              className="inline-flex min-h-[48px] items-center gap-1 rounded-xl border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <SkipForward className="h-4 w-4" aria-hidden="true" />
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={goNext}
            disabled={!answered && !isLast}
            className="ml-auto inline-flex min-h-[48px] items-center gap-1 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-600 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            {isLast ? 'Finish Session' : 'Next'}
            {!isLast && <ChevronRight className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </footer>

      <JumpDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
