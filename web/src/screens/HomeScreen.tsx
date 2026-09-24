import { BookOpen, ChevronRight, ClipboardList, Play, PlayCircle } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';
import { navigate } from '../lib/router';
import { useContent } from '../store/content';
import { useSession } from '../store/session';
import type { ContentFile, SessionConfig } from '../types';

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const BASE_CONFIG: Omit<SessionConfig, 'selectedKeys' | 'count' | 'order'> = {
  scopeKind: 'subject',
  timerEnabled: true,
  timerSeconds: 120,
  trapOnly: false,
  wrongFirst: false,
  skipDrops: false,
};

function startSubject(file: ContentFile) {
  const config: SessionConfig = { ...BASE_CONFIG, selectedKeys: [file.name], count: 20, order: 'shuffled' };
  const queue = shuffle(file.questionIds).slice(0, 20);
  if (queue.length === 0) return;
  useSession.getState().start(config, queue);
  navigate('/session');
}

function startMock(file: ContentFile) {
  const config: SessionConfig = { ...BASE_CONFIG, selectedKeys: [file.name], count: 'all', order: 'sequential' };
  if (file.questionIds.length === 0) return;
  useSession.getState().start(config, [...file.questionIds]);
  navigate('/session');
}

function FileCard({ file, onOpen }: { file: ContentFile; onOpen: (f: ContentFile) => void }) {
  const tierCount = file.tiers?.length ?? 0;
  const Icon = file.type === 'mock' ? ClipboardList : BookOpen;
  return (
    <button
      type="button"
      onClick={() => onOpen(file)}
      className="flex min-h-[44px] w-full items-start gap-3 rounded-2xl border border-transparent bg-card-light p-4 text-left shadow-sm transition hover:border-primary-100 hover:shadow-md dark:bg-card-dark dark:hover:border-slate-600 sm:p-5"
    >
      <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-slate-800 dark:text-primary-100">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug">{file.name}</span>
        <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">
          {file.questionIds.length} questions
          {tierCount > 0 && ` · ${tierCount} ${tierCount === 1 ? 'tier' : 'tiers'}`}
          {file.type === 'mock' && file.timeLimitMinutes ? ` · ${file.timeLimitMinutes} min` : ''}
        </span>
        <span className="mt-2 block text-[15px] font-medium text-primary-600 dark:text-primary-100">
          {file.type === 'mock' ? 'Start full mock' : 'Quick 20 · shuffled'}
        </span>
      </span>
      <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  );
}

export function HomeScreen() {
  const files = useContent((s) => s.files);
  const totalQuestions = useContent((s) => s.questions.length);
  const sessionStatus = useSession((s) => s.status);
  const answeredCount = useSession((s) => Object.keys(s.answers).length);
  const queueLength = useSession((s) => s.queue.length);

  const subjects = files.filter((f) => f.type === 'subject');
  const mocks = files.filter((f) => f.type === 'mock');

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-3">
        <span className="text-lg font-bold tracking-tight">FRM Part II</span>
        <ThemeToggle />
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

      <section className="mt-8">
        <h1 className="text-3xl font-bold tracking-tight">Ready to study?</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400">
          {totalQuestions} questions across {files.length} {files.length === 1 ? 'set' : 'sets'}.
        </p>
      </section>

      <button
        type="button"
        onClick={() => navigate('/setup')}
        className="mt-6 flex min-h-[64px] w-full items-center gap-4 rounded-2xl bg-primary p-5 text-left text-white shadow-sm transition hover:bg-primary-600"
      >
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <Play className="h-6 w-6" aria-hidden="true" />
        </span>
        <span className="flex-1">
          <span className="block text-lg font-semibold">New Session</span>
          <span className="block text-[15px] text-white/80">Pick subjects, readings or LOs and configure your drill</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
      </button>

      {subjects.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Subjects</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {subjects.map((f) => (
              <FileCard key={f.path} file={f} onOpen={startSubject} />
            ))}
          </div>
        </section>
      )}

      {mocks.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Mock exams</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {mocks.map((f) => (
              <FileCard key={f.path} file={f} onOpen={startMock} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
