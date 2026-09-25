import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Home, RefreshCw, Sigma } from 'lucide-react';
import { navigate } from '../lib/router';
import { useFormulaDeck } from './deck';
import { useDeckIndex } from './hooks';
import { PlayView } from './PlayView';
import { useGymRun } from './run';
import { SetupView, startFromSetup } from './SetupView';
import { SheetView } from './SheetView';
import { SummaryView } from './SummaryView';
import { useGym } from './storage';
import { btnPrimary, btnSecondary } from './ui';
import { loadSetup } from './setup';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Back to home"
            className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-lg font-semibold">Formula Gym</h1>
        </div>
      </header>
      <main className="mx-auto max-w-[720px] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">{children}</main>
    </div>
  );
}

function Skeleton() {
  return (
    <Shell>
      <div className="space-y-4" aria-busy="true" aria-label="Loading the Formula Gym">
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
        ))}
      </div>
    </Shell>
  );
}

function Message({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children: ReactNode }) {
  return (
    <Shell>
      <div className="mt-6 flex flex-col items-center rounded-2xl bg-card-light px-5 py-10 text-center shadow-sm dark:bg-card-dark">
        {icon}
        <p className="mt-3 text-lg font-semibold">{title}</p>
        <p className="mt-2 break-words text-slate-600 dark:text-slate-400">{body}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>
      </div>
    </Shell>
  );
}

export function FormulaGymScreen() {
  const status = useFormulaDeck((s) => s.status);
  const error = useFormulaDeck((s) => s.error);
  const formulas = useFormulaDeck((s) => s.formulas);
  const progressStatus = useGym((s) => s.status);
  const states = useGym((s) => s.states);
  const phase = useGymRun((s) => s.phase);
  const run = useGymRun((s) => s.run);
  const index = useDeckIndex();

  useEffect(() => {
    void useFormulaDeck.getState().load();
    void useGym.getState().load();
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase]);

  if (status === 'error') {
    return (
      <Message
        icon={<AlertCircle className="h-10 w-10 text-red-500" aria-hidden="true" />}
        title="Couldn't load the formula deck"
        body={error ?? 'Something went wrong while loading the formulas.'}
      >
        <button
          type="button"
          onClick={() => {
            useFormulaDeck.setState({ status: 'idle' });
            void useFormulaDeck.getState().load();
          }}
          className={btnPrimary}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
        <button type="button" onClick={() => navigate('/')} className={btnSecondary}>
          <Home className="h-4 w-4" aria-hidden="true" />
          Home
        </button>
      </Message>
    );
  }

  if (status !== 'ready' || progressStatus === 'idle' || progressStatus === 'loading') return <Skeleton />;

  if (formulas.length === 0) {
    return (
      <Message
        icon={<Sigma className="h-10 w-10 text-primary" aria-hidden="true" />}
        title="The formula deck is being prepared"
        body="Formulas from the notes are still being extracted and checked. Check back soon."
      >
        <button type="button" onClick={() => navigate('/')} className={btnSecondary}>
          <Home className="h-4 w-4" aria-hidden="true" />
          Home
        </button>
      </Message>
    );
  }

  if (phase === 'sheet') return <SheetView formulas={formulas} initialArea={loadSetup()?.areas[0] ?? null} />;
  if (run && phase === 'play') return <PlayView />;
  if (run && phase === 'summary') return <SummaryView />;
  return (
    <SetupView
      formulas={formulas}
      states={states}
      progressUnavailable={progressStatus === 'unavailable'}
      onStart={(setup) => startFromSetup(setup, formulas, states, index, (s) => useGymRun.getState().start(s))}
      onSheet={() => useGymRun.getState().openSheet()}
    />
  );
}
