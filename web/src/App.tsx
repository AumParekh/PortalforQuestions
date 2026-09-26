import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import { useContent } from './store/content';
import { useSession } from './store/session';
import { navigate, useRoute } from './lib/router';
import { initPersistence } from './lib/persistence';
import { useUi } from './store/ui';
import { HomeScreen } from './screens/HomeScreen';
import { SessionSetupScreen } from './screens/SessionSetupScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { ReviewWrongScreen } from './screens/ReviewWrongScreen';
import { useGameProgress } from './games/progress';
import { useTf } from './store/tf';
import { useGym } from './formulas/storage';
import { OutdatedBanner } from './components/OutdatedBanner';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { useMock } from './mock/store';
import { settleExpiredMocks } from './mock/submit';

// The core question loop (Home, Setup, Question, Summary, Review) ships in the main chunk; every other screen is
// its own chunk, fetched on first visit (the service worker precaches them all for offline use).
const loadTrueFalse = () => import('./screens/TrueFalseScreen');
const loadFormulaGym = () => import('./formulas/FormulaGymScreen');
const loadSenseCheck = () => import('./sensecheck/SenseCheckScreen');
const loadGames = () => import('./games/GamesScreen');
const loadAnalytics = () => import('./screens/AnalyticsScreen');
const loadSettings = () => import('./screens/SettingsScreen');
const loadDevLongest = () => import('./screens/DevLongestScreen');
const loadMock = () => import('./mock/MockScreen');

const TrueFalseScreen = lazy(() => loadTrueFalse().then((m) => ({ default: m.TrueFalseScreen })));
const FormulaGymScreen = lazy(() => loadFormulaGym().then((m) => ({ default: m.FormulaGymScreen })));
const SenseCheckScreen = lazy(() => loadSenseCheck().then((m) => ({ default: m.SenseCheckScreen })));
const GamesScreen = lazy(() => loadGames().then((m) => ({ default: m.GamesScreen })));
const AnalyticsScreen = lazy(() => loadAnalytics().then((m) => ({ default: m.AnalyticsScreen })));
const SettingsScreen = lazy(() => loadSettings().then((m) => ({ default: m.SettingsScreen })));
const DevLongestScreen = lazy(() => loadDevLongest().then((m) => ({ default: m.DevLongestScreen })));
const MockScreen = lazy(() => loadMock().then((m) => ({ default: m.MockScreen })));

const LAZY_ROUTES: Record<string, () => Promise<unknown>> = {
  '/truefalse': loadTrueFalse,
  '/formulas': loadFormulaGym,
  '/sense': loadSenseCheck,
  '/games': loadGames,
  '/analytics': loadAnalytics,
  '/settings': loadSettings,
  '/dev/longest': loadDevLongest,
};

/** Mock exam routes carry a slug (/mock/<slug>/…), so they are matched by prefix. */
const isMockRoute = (route: string) => route.startsWith('/mock/');

function Skeleton({ label = 'Loading questions' }: { label?: string }) {
  return (
    <div className="mx-auto max-w-[720px] space-y-4 px-4 py-8" aria-busy="true" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      ))}
    </div>
  );
}

/** A lazily loaded screen: skeleton while its chunk downloads, Reload prompt if the download fails. */
function LazyRoute({ route, children }: { route: string; children: ReactNode }) {
  return (
    <RouteErrorBoundary key={route}>
      <Suspense fallback={<Skeleton label="Loading" />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

export default function App() {
  return (
    <>
      <Routes />
      <OutdatedBanner />
    </>
  );
}

function Routes() {
  const route = useRoute();
  const { status, error, load } = useContent();
  const sessionStatus = useSession((s) => s.status);
  const persistenceReady = useUi((s) => s.persistenceReady);
  const mockStatus = useMock((s) => s.status);
  const mockInProgress = useMock((s) => Object.keys(s.attempts).length > 0);

  useEffect(() => {
    // A deep link to a lazy screen starts fetching its chunk now, alongside the question bank, rather than after it.
    (isMockRoute(route) ? loadMock : LAZY_ROUTES[route])?.().catch(() => undefined);
    load();
    initPersistence();
    useTf.getState().loadProgress();
    // Game sessions count as study days for the streak (PORTAL_PLAN §3c).
    useGameProgress.getState().load();
    // Formula Gym answers count toward the streak on Home, so load them up front too.
    useGym.getState().load();
    // Home shows each mock's last score and any attempt in progress.
    void useMock.getState().load();
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

  // A mock's clock runs while the app is closed or on another screen: one whose time is up is submitted, as the exam
  // would have been (the exam screen submits its own; this catches the rest).
  useEffect(() => {
    if (status !== 'ready' || !persistenceReady || mockStatus === 'idle' || mockStatus === 'loading' || !mockInProgress) return;
    settleExpiredMocks();
    const id = window.setInterval(() => settleExpiredMocks(), 5000);
    return () => window.clearInterval(id);
  }, [status, persistenceReady, mockStatus, mockInProgress]);

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

  if (isMockRoute(route)) {
    return (
      <LazyRoute route={route}>
        <MockScreen route={route} />
      </LazyRoute>
    );
  }

  switch (route) {
    case '/setup':
      return <SessionSetupScreen />;
    case '/session':
      return sessionStatus === 'idle' ? <Skeleton /> : <QuestionScreen />;
    case '/summary':
      return <SummaryScreen />;
    case '/review':
      return <ReviewWrongScreen />;
    case '/truefalse':
      return <LazyRoute route={route}><TrueFalseScreen /></LazyRoute>;
    case '/formulas':
      return <LazyRoute route={route}><FormulaGymScreen /></LazyRoute>;
    case '/sense':
      return <LazyRoute route={route}><SenseCheckScreen /></LazyRoute>;
    case '/games':
      return <LazyRoute route={route}><GamesScreen /></LazyRoute>;
    case '/analytics':
      return <LazyRoute route={route}><AnalyticsScreen /></LazyRoute>;
    case '/settings':
      return <LazyRoute route={route}><SettingsScreen /></LazyRoute>;
    case '/dev/longest':
      return <LazyRoute route={route}><DevLongestScreen /></LazyRoute>;
    default:
      return <HomeScreen />;
  }
}
