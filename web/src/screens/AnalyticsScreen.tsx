import { useMemo } from 'react';
import { AlertTriangle, ArrowLeft, BarChart3, Plus } from 'lucide-react';
import { AccuracyTrendChart } from '../components/analytics/AccuracyTrendChart';
import { SubjectAccuracy, TopicAccuracy } from '../components/analytics/AccuracyBars';
import { SessionList } from '../components/analytics/SessionList';
import { StudyHeatmap } from '../components/analytics/StudyHeatmap';
import { SummaryTiles } from '../components/analytics/SummaryTiles';
import { TimeHistogram } from '../components/analytics/TimeHistogram';
import { TrapPerformance } from '../components/analytics/TrapPerformance';
import { WeakestLoList } from '../components/analytics/WeakestLoList';
import { useToday } from '../hooks/useToday';
import { navigate } from '../lib/router';
import { overallStats, streaks } from '../lib/stats';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { useTf } from '../store/tf';
import { useGym } from '../formulas/storage';

function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/85">
      <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-4 py-1">
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="Back to home"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>
      </div>
    </header>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-card-light px-6 py-10 text-center shadow-sm dark:bg-card-dark">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-slate-800 dark:text-primary-100">
        <BarChart3 className="h-7 w-7" aria-hidden="true" />
      </span>
      <p className="mt-4 text-lg font-semibold">Answer a few questions and your analytics appear here</p>
      <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">
        Accuracy trends, your study calendar, time per question and the traps that catch you, all built from your answers.
      </p>
      <button
        type="button"
        onClick={() => navigate('/setup')}
        className="mt-6 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-white shadow-sm transition hover:bg-primary-600"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        New Session
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading analytics">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="h-72 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      ))}
    </div>
  );
}

export function AnalyticsScreen() {
  const status = useProgress((s) => s.status);
  const states = useProgress((s) => s.states);
  const attempts = useProgress((s) => s.attempts);
  const sessions = useProgress((s) => s.sessions);
  const subjectQuestions = useContent((s) => s.subjectQuestions);
  const byId = useContent((s) => s.byId);
  const tfAttempts = useTf((s) => s.attempts);
  const gymAttempts = useGym((s) => s.attempts);
  // True/False and Formula Gym answers count toward study days, matching the streak on Home.
  const studyEvents = useMemo(
    () => [...attempts, ...tfAttempts, ...gymAttempts.map((a) => ({ timestamp: a.timestamp, isCorrect: a.correct }))],
    [attempts, tfAttempts, gymAttempts],
  );

  const day = useToday();
  // Recomputed when the local date rolls over so "today" and the 30-day window stay current on long-lived tabs.
  const now = useMemo(() => new Date(), [day]);
  const stats = useMemo(() => overallStats(states, attempts), [states, attempts]);
  const streak = useMemo(() => streaks(studyEvents, now), [studyEvents, now]);

  const loading = status === 'idle' || status === 'loading';

  return (
    <div className="min-h-screen pb-[max(4rem,env(safe-area-inset-bottom))]">
      <TopBar />
      <main className="mx-auto w-full max-w-[720px] space-y-4 px-4 pt-4">
        {status === 'unavailable' && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[15px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>This browser can't save your history, so analytics only cover answers from this visit.</p>
          </div>
        )}
        {loading ? (
          <Skeleton />
        ) : studyEvents.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <SummaryTiles stats={stats} attemptCount={attempts.length} streak={streak} />
            <AccuracyTrendChart attempts={attempts} now={now} />
            <StudyHeatmap attempts={studyEvents} now={now} currentStreak={streak.current} />
            <SubjectAccuracy questions={subjectQuestions} states={states} />
            <TopicAccuracy questions={subjectQuestions} states={states} />
            <WeakestLoList questions={subjectQuestions} states={states} />
            <TimeHistogram attempts={attempts} />
            <TrapPerformance attempts={attempts} byId={byId} />
            <SessionList sessions={sessions} />
          </>
        )}
      </main>
    </div>
  );
}
