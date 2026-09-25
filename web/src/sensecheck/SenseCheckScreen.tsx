import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Gauge, Home, RefreshCw } from 'lucide-react';
import { navigate } from '../lib/router';
import { useGym } from '../formulas/storage';
import { IntroView } from './IntroView';
import { PlayView } from './PlayView';
import { useSenseDeck, useSenseRun } from './store';
import { SummaryView } from './SummaryView';
import { Shell, btnPrimary, btnSecondary } from './ui';

function Message({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children: ReactNode }) {
  return (
    <Shell>
      <div className="mt-6 flex flex-col items-center rounded-2xl bg-card-light px-5 py-10 text-center shadow-sm dark:bg-card-dark">
        {icon}
        <p className="mt-3 text-lg font-semibold">{title}</p>
        <p className="mt-2 break-words text-base text-slate-600 dark:text-slate-400">{body}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>
      </div>
    </Shell>
  );
}

function Skeleton() {
  return (
    <Shell>
      <div className="space-y-4" aria-busy="true" aria-label="Loading Sense Check">
        <div className="h-56 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
        <div className="h-14 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
      </div>
    </Shell>
  );
}

const HomeButton = () => (
  <button type="button" onClick={() => navigate('/')} className={btnSecondary}>
    <Home className="h-4 w-4" aria-hidden="true" />
    Home
  </button>
);

export function SenseCheckScreen() {
  const status = useSenseDeck((s) => s.status);
  const error = useSenseDeck((s) => s.error);
  const scenarios = useSenseDeck((s) => s.scenarios);
  const progressStatus = useGym((s) => s.status);
  const states = useGym((s) => s.states);
  const attempts = useGym((s) => s.attempts);
  const phase = useSenseRun((s) => s.phase);
  const run = useSenseRun((s) => s.run);

  useEffect(() => {
    void useSenseDeck.getState().load();
    void useGym.getState().load();
  }, []);

  if (status === 'error') {
    return (
      <Message
        icon={<AlertCircle className="h-10 w-10 text-red-500" aria-hidden="true" />}
        title="Couldn't load Sense Check"
        body={error ?? 'Something went wrong while loading the scenarios.'}
      >
        <button type="button" onClick={() => useSenseDeck.getState().retry()} className={btnPrimary}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
        <HomeButton />
      </Message>
    );
  }

  if (status !== 'ready' || progressStatus === 'idle' || progressStatus === 'loading') return <Skeleton />;

  if (run && phase === 'play') return <PlayView />;
  if (run && phase === 'summary') return <SummaryView />;

  if (scenarios.length === 0) {
    return (
      <Message
        icon={<Gauge className="h-10 w-10 text-primary" aria-hidden="true" />}
        title="Sense Check is being prepared"
        body="The scenarios are still being built from the question bank and the notes, and every number is being re-checked. Check back soon."
      >
        <HomeButton />
      </Message>
    );
  }

  return <IntroView scenarios={scenarios} states={states} attempts={attempts} progressUnavailable={progressStatus === 'unavailable'} />;
}
