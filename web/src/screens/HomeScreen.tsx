import { useMemo } from 'react';
import { useToday } from '../hooks/useToday';
import { CheckCircle2, ChevronRight, Flame, Info, Play, PlayCircle, Trophy, Zap } from 'lucide-react';
import { TabShell } from '../components/shell/TabShell';
import { ExamCountdown, TodaysPlan } from '../components/dashboard/ExamPlan';
import type { PlanRow, PlanSection } from '../components/dashboard/ExamPlan';
import { QUEST_GOAL, startDueReview, startQuest } from '../components/dashboard/launch';
import { MockResumeBanners } from '../components/dashboard/MockCard';
import { ProgressBar } from '../components/dashboard/ProgressBar';
import { navigate } from '../lib/router';
import type { Route } from '../lib/router';
import { daysToExam, examPhase } from '../games/examDate';
import type { ExamPhase } from '../games/examDate';
import { useSettings } from '../lib/settings';
import { activeProfile, switchProfile } from '../games/profile';
import { DUE_SESSION_CAP, dueQuestionIds } from '../lib/srs';
import { answeredToday, streaks } from '../lib/stats';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { useTf } from '../store/tf';
import { isDue, localDay, useGym } from '../formulas/storage';
import { useGameProgress } from '../games/progress';
import { dueItemIds } from '../games/srs';
import { useSession } from '../store/session';
import { useMock } from '../mock/store';

/** Suggested order of today's reviews by phase: the formula sheet leads in the final review. */
const PLAN_ORDER: Record<ExamPhase, PlanSection[]> = {
  setup: ['questions', 'formulas', 'truefalse', 'games', 'sense'],
  learn: ['questions', 'formulas', 'truefalse', 'games', 'sense'],
  consolidate: ['questions', 'formulas', 'sense', 'truefalse', 'games'],
  final: ['formulas', 'questions', 'sense', 'truefalse', 'games'],
  after: ['questions', 'formulas', 'truefalse', 'games', 'sense'],
};

const PLAN_ROUTE: Record<Exclude<PlanSection, 'questions'>, Route> = {
  formulas: '/formulas',
  sense: '/sense',
  truefalse: '/truefalse',
  games: '/games',
};

/**
 * Today: the first screen of a study day. What is still open (a session or a mock in progress), how far the exam is,
 * what is due for review, and the daily goal. Everything else lives under its own tab (components/shell/TabShell).
 */
export function HomeScreen() {
  const files = useContent((s) => s.files);
  const subjectQuestions = useContent((s) => s.subjectQuestions);
  const byId = useContent((s) => s.byId);
  const states = useProgress((s) => s.states);
  const attempts = useProgress((s) => s.attempts);
  const tfAttempts = useTf((s) => s.attempts);
  const gymAttempts = useGym((s) => s.attempts);
  const gameSessions = useGameProgress((s) => s.sessions);
  const gymStates = useGym((s) => s.states);
  const tfStates = useTf((s) => s.states);
  const tfById = useTf((s) => s.byId);
  const tfDeckReady = useTf((s) => s.deckStatus === 'ready');
  const gameItems = useGameProgress((s) => s.items);
  const exam = useSettings((s) => s.examDate);
  const profile = activeProfile();
  // True/False and Formula Gym answers count as study activity for the streak and today's goal.
  const studyEvents = useMemo(() => [...attempts, ...tfAttempts, ...gymAttempts], [attempts, tfAttempts, gymAttempts]);
  // A notes-game session counts as a study day for the streak, not as answers toward today's goal.
  const streakEvents = useMemo(() => [...studyEvents, ...gameSessions.map((g) => ({ timestamp: g.timestamp }))], [studyEvents, gameSessions]);
  const progressStatus = useProgress((s) => s.status);
  const sessionStatus = useSession((s) => s.status);
  const answeredCount = useSession((s) => Object.keys(s.answers).length);
  const queueLength = useSession((s) => s.queue.length);
  const mockAttempts = useMock((s) => s.attempts);
  const mockFiles = useMemo(() => files.filter((f) => f.type === 'mock'), [files]);

  const day = useToday();
  const streak = useMemo(() => streaks(streakEvents), [streakEvents, day]);
  const today = useMemo(() => answeredToday(studyEvents), [studyEvents, day]);
  const gymDue = useMemo(() => {
    const d = localDay();
    let formula = 0;
    let scenario = 0;
    for (const s of Object.values(gymStates)) {
      if (!isDue(s, d)) continue;
      if (s.kind === 'formula') formula++;
      else scenario++;
    }
    return { formula, scenario };
  }, [gymStates, day, exam]);
  // True/False has no schedule: a card counts until it is answered correctly again (only cards still in the deck
  // once the deck has loaded).
  const tfMissed = useMemo(
    () => Object.values(tfStates).filter((s) => s.lastResult === 'wrong' && (!tfDeckReady || tfById[s.cardId])).length,
    [tfStates, tfById, tfDeckReady],
  );
  const gamesDue = useMemo(() => dueItemIds(gameItems, localDay()).length, [gameItems, day, exam]);
  const examInfo = useMemo(() => {
    const d = localDay();
    return { days: daysToExam(d, exam), phase: examPhase(d, exam) };
  }, [exam, day]);
  // Spaced-repetition reviews: attempted questions whose due date is today or earlier.
  const questionsDue = useMemo(() => dueQuestionIds(states, localDay(), (id) => !!byId[id]).length, [states, byId, day, exam]);

  const questDone = today >= QUEST_GOAL;

  const planRows = useMemo((): PlanRow[] => {
    const counts: Record<PlanSection, number> = {
      questions: questionsDue,
      formulas: gymDue.formula,
      sense: gymDue.scenario,
      truefalse: tfMissed,
      games: gamesDue,
    };
    return PLAN_ORDER[examInfo.phase].map((key) => ({
      key,
      count: counts[key],
      // The row starts one "Due for review" session, which takes at most DUE_SESSION_CAP questions.
      perSession: key === 'questions' ? DUE_SESSION_CAP : undefined,
      onOpen:
        key === 'questions'
          ? () => (questionsDue > 0 ? startDueReview(states, byId, localDay()) : navigate('/setup'))
          : () => navigate(PLAN_ROUTE[key]),
    }));
  }, [questionsDue, gymDue, tfMissed, gamesDue, examInfo.phase, states, byId]);

  return (
    <TabShell
      title="Today"
      lead={
        // Each person has their own progress; switching reloads into the picker (games/profile.ts).
        <button
          type="button"
          onClick={switchProfile}
          aria-label={`Hi, ${profile.name} · Switch user`}
          className="-mx-1 flex min-h-[32px] max-w-full items-center gap-1 rounded-lg px-1 hover:text-slate-900 dark:hover:text-slate-100"
        >
          <span className="truncate">Hi, {profile.name}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 font-medium text-primary-600 dark:text-primary-100">Switch</span>
        </button>
      }
    >
      {sessionStatus === 'active' && (
        <button
          type="button"
          onClick={() => navigate('/session')}
          className="mt-4 flex min-h-[44px] w-full items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left text-amber-900 shadow-sm transition hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/40"
        >
          <PlayCircle className="h-6 w-6 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            <span className="block font-semibold">Resume session</span>
            <span className="block text-[15px] opacity-80">
              {answeredCount} of {queueLength} answered
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
        </button>
      )}

      <MockResumeBanners files={mockFiles} attempts={mockAttempts} />

      {sessionStatus === 'finished' && (
        <button
          type="button"
          onClick={() => navigate('/summary')}
          className="mt-3 inline-flex min-h-[44px] items-center gap-1 rounded-xl px-2 text-[15px] font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-slate-800"
        >
          View last summary
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      {/* Below Resume session, so a session in progress stays the first thing on the page. */}
      <ExamCountdown days={examInfo.days} phase={examInfo.phase} exam={exam} onOpenSettings={() => navigate('/settings')} />

      {progressStatus === 'unavailable' && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[15px] text-slate-600 dark:border-slate-700 dark:text-slate-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Progress can't be saved in this browser (private mode?).
        </p>
      )}

      <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Daily goal">
        <div className="flex flex-col rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark sm:p-5">
          <div className="flex items-center gap-2">
            {questDone ? (
              <Trophy className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            ) : (
              <Zap className="h-5 w-5 text-primary-600 dark:text-primary-100" aria-hidden="true" />
            )}
            <h2 className="font-semibold">Today's quest</h2>
          </div>
          <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">
            {questDone ? 'Goal reached. Extra practice still counts.' : `Answer ${QUEST_GOAL} questions today. Recent mistakes come first, then new ones.`}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <ProgressBar value={today / QUEST_GOAL} label="Today's quest progress" tone={questDone ? 'bg-emerald-500' : 'bg-primary'} />
            <span className="shrink-0 text-[15px] font-medium tabular-nums">
              {Math.min(today, QUEST_GOAL)}/{QUEST_GOAL}
            </span>
          </div>
          <div className="mt-auto pt-4">
            <button
              type="button"
              onClick={() => startQuest(subjectQuestions, states)}
              disabled={subjectQuestions.length === 0}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 font-semibold text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-5 w-5" aria-hidden="true" />
              {questDone ? 'Keep going' : today > 0 ? 'Continue quest' : "Start today's quest"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark sm:p-5">
          <div className="flex items-center gap-2">
            <Flame
              className={`h-5 w-5 ${streak.current > 0 ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}
              aria-hidden="true"
            />
            <h2 className="font-semibold">Streak</h2>
          </div>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums">{streak.current}</span>
            <span className="text-slate-600 dark:text-slate-400">{streak.current === 1 ? 'day' : 'days'}</span>
            <span className="ml-auto text-[15px] text-slate-600 dark:text-slate-400">
              Longest: {streak.longest} {streak.longest === 1 ? 'day' : 'days'}
            </span>
          </p>
          <p
            className={`mt-2 flex items-start gap-2 text-[15px] ${
              streak.studiedToday ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {streak.studiedToday && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            {streak.studiedToday
              ? 'Done for today.'
              : streak.current > 0
                ? 'Answer a question today to keep your streak.'
                : 'Answer a question today to start a streak.'}
          </p>
        </div>
      </section>

      <TodaysPlan rows={planRows} phase={examInfo.phase} />
    </TabShell>
  );
}
