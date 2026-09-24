import { Bookmark, Check, ChevronRight, Home, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { navigate } from '../lib/router';
import { useContent } from '../store/content';
import { useSession } from '../store/session';
import type { SessionConfig } from '../types';

const FALLBACK_CONFIG: SessionConfig = {
  scopeKind: 'subject',
  selectedKeys: [],
  count: 'all',
  order: 'sequential',
  timerEnabled: true,
  timerSeconds: 120,
  trapOnly: false,
  wrongFirst: false,
  skipDrops: false,
};

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function AccuracyRing({ pct }: { pct: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const tone = pct >= 70 ? 'text-emerald-500' : pct >= 50 ? 'text-amber-500' : 'text-red-500';
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={`Accuracy ${pct}%`}>
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-slate-200 dark:stroke-slate-700" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={`${tone} transition-[stroke-dashoffset] duration-700`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums">{pct}%</span>
        <span className="text-[15px] text-slate-600 dark:text-slate-400">accuracy</span>
      </div>
    </div>
  );
}

function Stat({ label, value, className = '' }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
      <div className={`text-lg font-semibold tabular-nums ${className}`}>{value}</div>
      <div className="text-[15px] text-slate-600 dark:text-slate-400">{label}</div>
    </div>
  );
}

export function SummaryScreen() {
  const queue = useSession((s) => s.queue);
  const answers = useSession((s) => s.answers);
  const skipped = useSession((s) => s.skipped);
  const marked = useSession((s) => s.marked);
  const startedAt = useSession((s) => s.startedAt);
  const endedAt = useSession((s) => s.endedAt);
  const config = useSession((s) => s.config);
  const byId = useContent((s) => s.byId);

  const answeredIds = queue.filter((id) => answers[id]);
  const correctCount = answeredIds.filter((id) => answers[id]?.correct).length;
  const wrongIds = answeredIds.filter((id) => !answers[id]?.correct);
  const unansweredCount = queue.length - answeredIds.length;
  const skippedCount = queue.filter((id) => !answers[id] && skipped[id]).length;
  const pct = answeredIds.length ? Math.round((correctCount / answeredIds.length) * 100) : 0;

  const start = startedAt ? Date.parse(startedAt) : NaN;
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  const totalSeconds = Number.isFinite(start) ? (end - start) / 1000 : 0;
  const answerSeconds = answeredIds.reduce((sum, id) => sum + (answers[id]?.timeTakenSeconds ?? 0), 0);
  const avgSeconds = answeredIds.length ? answerSeconds / answeredIds.length : 0;

  const openItem = (index: number) => {
    // Status stays 'finished', which the question screen treats as read-only review.
    useSession.setState({ currentIndex: index });
    navigate('/session');
  };

  const retryWrong = () => {
    if (wrongIds.length === 0) return;
    useSession.getState().start(config ?? FALLBACK_CONFIG, [...wrongIds]);
    navigate('/session');
  };

  const goSetup = () => {
    useSession.getState().reset();
    navigate('/setup');
  };

  const goHome = () => {
    useSession.getState().reset();
    navigate('/');
  };

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="text-2xl font-bold tracking-tight">Session complete</h1>

      <section className="mt-5 rounded-2xl bg-card-light p-5 shadow-sm dark:bg-card-dark">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <AccuracyRing pct={pct} />
          <div className="grid w-full flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Answered" value={`${answeredIds.length}/${queue.length}`} />
            <Stat label="Correct" value={correctCount} className="text-emerald-600 dark:text-emerald-400" />
            <Stat label="Wrong" value={wrongIds.length} className="text-red-600 dark:text-red-400" />
            <Stat
              label={skippedCount > 0 ? `Unanswered (${skippedCount} skipped)` : 'Unanswered'}
              value={unansweredCount}
              className="text-amber-600 dark:text-amber-400"
            />
            <Stat label="Total time" value={mmss(totalSeconds)} />
            <Stat label="Avg / question" value={mmss(avgSeconds)} />
          </div>
        </div>
      </section>

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={goSetup}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary px-4 font-medium text-white shadow-sm transition hover:bg-primary-600"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          New session
        </button>
        {wrongIds.length > 0 && (
          <button
            type="button"
            onClick={retryWrong}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 font-medium text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/40"
          >
            <RotateCcw className="h-5 w-5" aria-hidden="true" />
            Retry wrong ones ({wrongIds.length})
          </button>
        )}
        <button
          type="button"
          onClick={goHome}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-card-light px-4 font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:bg-card-dark dark:hover:bg-slate-700"
        >
          <Home className="h-5 w-5" aria-hidden="true" />
          Home
        </button>
      </div>

      <section className="mt-8">
        <h2 className="text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Review</h2>
        <ol className="mt-3 space-y-2">
          {queue.map((id, index) => {
            const a = answers[id];
            const q = byId[id];
            const status = a ? (a.correct ? 'correct' : 'wrong') : 'unanswered';
            const badge =
              status === 'correct'
                ? { Icon: Check, text: 'Correct', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' }
                : status === 'wrong'
                  ? { Icon: X, text: a?.timedOut ? 'Timed out' : 'Wrong', cls: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' }
                  : { Icon: Minus, text: skipped[id] ? 'Skipped' : 'Unanswered', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' };
            return (
              <li key={`${id}-${index}`}>
                <button
                  type="button"
                  onClick={() => openItem(index)}
                  className="flex min-h-[44px] w-full items-start gap-3 rounded-2xl bg-card-light p-4 text-left shadow-sm transition hover:shadow-md dark:bg-card-dark"
                >
                  <span className="w-7 shrink-0 pt-0.5 text-[15px] font-semibold tabular-nums text-slate-600 dark:text-slate-400">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block leading-snug">{q ? q.topic : id}</span>
                    <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">
                      {q ? `${q.subject} · ${q.id}` : 'Question not found'}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[15px] font-medium ${badge.cls}`}>
                      <badge.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {badge.text}
                    </span>
                    {marked[id] && (
                      <span className="inline-flex items-center gap-1 text-[15px] text-amber-600 dark:text-amber-400">
                        <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                        Marked
                      </span>
                    )}
                  </span>
                  <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
