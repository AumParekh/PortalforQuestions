import { useEffect } from 'react';
import { useContent } from './store/content';
import { useSession } from './store/session';
import { navigate, useRoute } from './lib/router';
import { initPersistence } from './lib/persistence';
import { useUi } from './store/ui';
import { HomeScreen } from './screens/HomeScreen';
import { SessionSetupScreen } from './screens/SessionSetupScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { DevLongestScreen } from './screens/DevLongestScreen';
import { ReviewWrongScreen } from './screens/ReviewWrongScreen';

function Skeleton() {
  return (
    <div className="mx-auto max-w-[720px] space-y-4 px-4 py-8" aria-busy="true" aria-label="Loading questions">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      ))}
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const { status, error, load } = useContent();
  const sessionStatus = useSession((s) => s.status);
  const persistenceReady = useUi((s) => s.persistenceReady);

  useEffect(() => {
    load();
    initPersistence();
  }, [load]);

  // A restored session may reference questions a content update removed; drop them rather than strand the user.
  useEffect(() => {
    if (status !== 'ready' || !persistenceReady) return;
    const s = useSession.getState();
    if (s.status === 'idle') return;
    const byId = useContent.getState().byId;
    const queue = s.queue.filter((id) => byId[id]);
    if (queue.length === s.queue.length) return;
    if (queue.length === 0) s.reset();
    else useSession.setState({ queue, currentIndex: Math.min(s.currentIndex, queue.length - 1) });
  }, [status, persistenceReady]);

  // A session route with no active session (e.g. after reload) goes back to setup.
  useEffect(() => {
    if (status !== 'ready' || !persistenceReady) return;
    if (route === '/session' && sessionStatus === 'idle') navigate('/setup');
    if (route === '/summary' && sessionStatus !== 'finished') navigate('/');
  }, [status, persistenceReady, route, sessionStatus]);

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 text-center">
        <p className="text-lg font-semibold">Couldn't load questions.</p>
        <p className="mt-2 text-slate-600 dark:text-slate-400">{error}</p>
        <button
          className="mt-6 min-h-[44px] rounded-xl bg-primary px-5 font-medium text-white"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }
  if (status !== 'ready' || !persistenceReady) return <Skeleton />;

  switch (route) {
    case '/setup':
      return <SessionSetupScreen />;
    case '/session':
      return sessionStatus === 'idle' ? <Skeleton /> : <QuestionScreen />;
    case '/summary':
      return <SummaryScreen />;
    case '/review':
      return <ReviewWrongScreen />;
    case '/dev/longest':
      return <DevLongestScreen />;
    default:
      return <HomeScreen />;
  }
}
