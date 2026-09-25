import { useMemo, useRef } from 'react';
import { useToday } from '../hooks/useToday';
import { BarChart3, BookOpen, CheckCircle2, CheckSquare, ChevronRight, ClipboardList, Dices, Flame, History, Info, Play, PlayCircle, Settings, Trophy, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from '../components/ThemeToggle';
import { AccuracyRing } from '../components/dashboard/AccuracyRing';
import { QUEST_GOAL, startMock, startQuest, startRandomDrill, startSubjectQuick } from '../components/dashboard/launch';
import { AccuracyChip, ProgressBar } from '../components/dashboard/ProgressBar';
import { SearchBox } from '../components/dashboard/SearchBox';
import { StatTile } from '../components/dashboard/StatTile';
import { TopicMap } from '../components/dashboard/TopicMap';
import { WeakLos } from '../components/dashboard/WeakLos';
import { navigate } from '../lib/router';
import { accuracyOf, answeredToday, overallStats, streaks, weakestLos, wrongQuestionStates } from '../lib/stats';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { useTf } from '../store/tf';
import { useSession } from '../store/session';
import type { ContentFile, QuestionState } from '../types';

interface FileProgress {
  attempted: number;
  accuracy: number | null;
}

function fileProgress(file: ContentFile, states: Record<string, QuestionState>): FileProgress {
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

function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
      {children}
    </h2>
  );
}

function FileCard({ file, progress, onOpen }: { file: ContentFile; progress: FileProgress; onOpen: () => void }) {
  const tierCount = file.tiers?.length ?? 0;
  const Icon = file.type === 'mock' ? ClipboardList : BookOpen;
  const total = file.questionIds.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[44px] w-full items-start gap-3 rounded-2xl border border-transparent bg-card-light p-4 text-left shadow-sm transition hover:border-primary-100 hover:shadow-md dark:bg-card-dark dark:hover:border-slate-600 sm:p-5"
    >
      <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-slate-800 dark:text-primary-100">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="block font-semibold leading-snug">{file.name}</span>
          <AccuracyChip accuracy={progress.accuracy} />
        </span>
        <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">
          {total} questions
          {tierCount > 0 && ` · ${tierCount} ${tierCount === 1 ? 'tier' : 'tiers'}`}
          {file.type === 'mock' && file.timeLimitMinutes ? ` · ${file.timeLimitMinutes} min` : ''}
        </span>
        <span className="mt-2 flex items-center gap-3">
          <ProgressBar value={total ? progress.attempted / total : 0} label={`${file.name} attempted`} />
          <span className="shrink-0 text-[15px] tabular-nums text-slate-600 dark:text-slate-400">
            {progress.attempted}/{total}
          </span>
        </span>
        <span className="mt-2 block text-[15px] font-medium text-primary-600 dark:text-primary-100">
          {file.type === 'mock' ? 'Start full mock' : 'Quick 20 · shuffled'}
        </span>
      </span>
      <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  );
}

function QuickAction({
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
    </button>
  );
}

export function HomeScreen() {
  const files = useContent((s) => s.files);
  const questions = useContent((s) => s.questions);
  const byId = useContent((s) => s.byId);
  const states = useProgress((s) => s.states);
  const attempts = useProgress((s) => s.attempts);
  const tfAttempts = useTf((s) => s.attempts);
  const tfCount = useTf((s) => s.cards.length);
  // True/False answers count as study activity for the streak and today's goal.
  const studyEvents = useMemo(() => [...attempts, ...tfAttempts], [attempts, tfAttempts]);
  const progressStatus = useProgress((s) => s.status);
  const sessionStatus = useSession((s) => s.status);
  const answeredCount = useSession((s) => Object.keys(s.answers).length);
  const queueLength = useSession((s) => s.queue.length);
  const mocksRef = useRef<HTMLElement>(null);

  const subjectFiles = useMemo(() => files.filter((f) => f.type === 'subject'), [files]);
  const mockFiles = useMemo(() => files.filter((f) => f.type === 'mock'), [files]);
  const subjectQuestions = useMemo(() => {
    const paths = new Set(subjectFiles.map((f) => f.path));
    return questions.filter((q) => paths.has(q.file));
  }, [questions, subjectFiles]);
  const subjectIds = useMemo(() => new Set(subjectQuestions.map((q) => q.id)), [subjectQuestions]);

  const stats = useMemo(() => overallStats(states, attempts), [states, attempts]);
  const day = useToday();
  const streak = useMemo(() => streaks(studyEvents), [studyEvents, day]);
  const today = useMemo(() => answeredToday(studyEvents), [studyEvents, day]);
  const weak = useMemo(() => weakestLos(subjectQuestions, states, 5), [subjectQuestions, states]);
  // Matches Review Wrong's default "Still wrong only" view.
  const wrongCount = useMemo(
    () => wrongQuestionStates(states).filter((s) => s.lastResult === 'wrong' && byId[s.questionId]).length,
    [states, byId],
  );
  const progressByPath = useMemo(() => {
    const out: Record<string, FileProgress> = {};
    for (const f of files) out[f.path] = fileProgress(f, states);
    return out;
  }, [files, states]);

  const questDone = today >= QUEST_GOAL;

  const scrollToMocks = () => mocksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-3">
        <span className="text-lg font-bold tracking-tight">FRM Part II</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate('/analytics')}
            aria-label="Analytics"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <BarChart3 className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            aria-label="Settings"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </button>
          <ThemeToggle />
        </div>
      </header>

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

      {progressStatus === 'unavailable' && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[15px] text-slate-600 dark:border-slate-700 dark:text-slate-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Progress can't be saved in this browser (private mode?).
        </p>
      )}

      <section className="mt-8">
        <h1 className="text-3xl font-bold tracking-tight">Ready to study?</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400">
          {questions.length} questions across {files.length} {files.length === 1 ? 'set' : 'sets'}.
        </p>
      </section>

      <section className="mt-6">
        <SearchBox questions={questions} allowedIds={subjectIds} />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <ProgressBar
              value={today / QUEST_GOAL}
              label="Today's quest progress"
              tone={questDone ? 'bg-emerald-500' : 'bg-primary'}
            />
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
          </p>
          <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">
            Longest: {streak.longest} {streak.longest === 1 ? 'day' : 'days'}
          </p>
          <p
            className={`mt-3 flex items-start gap-2 text-[15px] ${
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

      <section className="mt-3 rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark sm:p-5" aria-labelledby="overview-title">
        <h2 id="overview-title" className="sr-only">
          Overall progress
        </h2>
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <AccuracyRing accuracy={stats.accuracy} />
          <div className="grid w-full flex-1 grid-cols-2 gap-2">
            <StatTile label="Attempted" value={`${stats.questionsAttempted}/${questions.length}`} />
            <StatTile label="Time studied" value={formatDuration(stats.secondsStudied)} />
            <StatTile label="Correct" value={stats.correct} className="text-emerald-600 dark:text-emerald-400" />
            <StatTile label="Wrong" value={stats.wrong} className="text-red-600 dark:text-red-400" />
          </div>
        </div>
      </section>

      <section className="mt-10">
        <SectionTitle>Quick start</SectionTitle>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <QuickAction
            primary
            icon={<Play className="h-5 w-5" aria-hidden="true" />}
            title="New Session"
            detail="Pick subjects, readings or LOs"
            onClick={() => navigate('/setup')}
          />
          <QuickAction
            icon={<Dices className="h-5 w-5" aria-hidden="true" />}
            title="Random Drill"
            detail="20 random questions, all subjects"
            onClick={() => startRandomDrill(subjectQuestions)}
            disabled={subjectQuestions.length === 0}
          />
          <QuickAction
            icon={<History className="h-5 w-5" aria-hidden="true" />}
            title={wrongCount > 0 ? `Review Wrong (${wrongCount})` : 'Review Wrong'}
            detail={wrongCount > 0 ? 'Every question you have missed' : 'Nothing to review yet: questions you miss land here'}
            onClick={() => navigate('/review')}
            disabled={wrongCount === 0}
          />
          <QuickAction
            icon={<CheckSquare className="h-5 w-5" aria-hidden="true" />}
            title="True / False"
            detail={tfCount > 0 ? `${tfCount.toLocaleString()} statements to judge` : 'Judge statements from your question bank'}
            onClick={() => navigate('/truefalse')}
          />
          <QuickAction
            icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
            title="Analytics"
            detail="Accuracy over time, weak topics, trap types"
            onClick={() => navigate('/analytics')}
          />
          {mockFiles.length > 0 && (
            <QuickAction
              icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />}
              title="Mock Exam"
              detail={`${mockFiles.length} full ${mockFiles.length === 1 ? 'exam' : 'exams'} available`}
              onClick={scrollToMocks}
            />
          )}
        </div>
      </section>

      <section className="mt-10">
        <SectionTitle>Weakest learning objectives</SectionTitle>
        <div className="mt-3">
          <WeakLos groups={weak} />
        </div>
      </section>

      {subjectFiles.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <SectionTitle>Topic map</SectionTitle>
          </div>
          <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">Tap a topic for a 20-question drill.</p>
          <div className="mt-3">
            <TopicMap subjectFiles={subjectFiles} byId={byId} states={states} />
          </div>
        </section>
      )}

      {subjectFiles.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Subjects</SectionTitle>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {subjectFiles.map((f) => (
              <FileCard
                key={f.path}
                file={f}
                progress={progressByPath[f.path]}
                onOpen={() => startSubjectQuick(byId[f.questionIds[0]]?.subject ?? f.name, f)}
              />
            ))}
          </div>
        </section>
      )}

      {mockFiles.length > 0 && (
        <section ref={mocksRef} className="mt-10 scroll-mt-4">
          <SectionTitle>Mock exams</SectionTitle>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {mockFiles.map((f) => (
              <FileCard key={f.path} file={f} progress={progressByPath[f.path]} onOpen={() => startMock(f)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
