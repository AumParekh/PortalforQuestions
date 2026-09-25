import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Home, Layers, RefreshCw } from 'lucide-react';
import { navigate } from '../lib/router';
import { useTf } from '../store/tf';
import { TfSetupView } from '../components/truefalse/TfSetupView';
import { TfPlayView } from '../components/truefalse/TfPlayView';
import { TfSummaryView } from '../components/truefalse/TfSummaryView';
import { useTfRun } from '../components/truefalse/run';

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
          <h1 className="text-lg font-semibold">True / False</h1>
        </div>
      </header>
      <main className="mx-auto max-w-[720px] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">{children}</main>
    </div>
  );
}

function Skeleton() {
  return (
    <Shell>
      <div className="space-y-4" aria-busy="true" aria-label="Loading True/False deck">
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
          ))}
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
        ))}
        <div className="h-24 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
      </div>
    </Shell>
  );
}

function Message({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
}) {
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

const homeBtn =
  'inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';

export function TrueFalseScreen() {
  const deckStatus = useTf((s) => s.deckStatus);
  const deckError = useTf((s) => s.deckError);
  const cards = useTf((s) => s.cards);
  const states = useTf((s) => s.states);
  const progressStatus = useTf((s) => s.progressStatus);
  const phase = useTfRun((s) => s.phase);
  const run = useTfRun((s) => s.run);

  useEffect(() => {
    const tf = useTf.getState();
    void tf.loadDeck();
    void tf.loadProgress();
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase]);

  if (deckStatus === 'error') {
    return (
      <Message
        icon={<AlertCircle className="h-10 w-10 text-red-500" aria-hidden="true" />}
        title="Couldn't load the True/False deck"
        body={deckError ?? 'Something went wrong while loading the statements.'}
      >
        <button
          type="button"
          onClick={() => void useTf.getState().loadDeck()}
          className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-600"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
        <button type="button" onClick={() => navigate('/')} className={homeBtn}>
          <Home className="h-4 w-4" aria-hidden="true" />
          Home
        </button>
      </Message>
    );
  }

  if (deckStatus !== 'ready' || progressStatus === 'idle' || progressStatus === 'loading') return <Skeleton />;

  if (cards.length === 0) {
    return (
      <Message
        icon={<Layers className="h-10 w-10 text-primary" aria-hidden="true" />}
        title="The True/False deck is being prepared"
        body="Statements are still being written and checked. Check back soon."
      >
        <button type="button" onClick={() => navigate('/')} className={homeBtn}>
          <Home className="h-4 w-4" aria-hidden="true" />
          Home
        </button>
      </Message>
    );
  }

  if (run && phase === 'play') return <TfPlayView />;
  if (run && phase === 'summary') return <TfSummaryView />;
  return (
    <TfSetupView
      cards={cards}
      states={states}
      progressUnavailable={progressStatus === 'unavailable'}
      onStart={(ids) => useTfRun.getState().start(ids)}
    />
  );
}
