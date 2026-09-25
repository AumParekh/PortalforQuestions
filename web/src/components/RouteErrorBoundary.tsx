import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Home, RefreshCw } from 'lucide-react';
import { navigate } from '../lib/router';

interface Props {
  children?: ReactNode;
}

interface State {
  error: Error | null;
}

/** Chunk fetches fail with these after a deploy removed the old hashed files (message varies by browser). */
function isChunkLoadError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|Unable to preload/i.test(error.message);
}

/**
 * Wraps a lazily loaded screen so a chunk that fails to load (an old tab after a deploy, or offline before the
 * service worker cached it) shows a Reload prompt instead of a blank page. Keyed by route in App, so navigating
 * away clears it.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Screen failed to load', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkLoadError(error);
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16">
        <div
          role="alert"
          className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          <p className="text-lg font-semibold">Couldn't load this screen.</p>
          <p className="mt-1 text-[15px]">
            {chunk
              ? 'The app was probably updated since this tab opened. Reload to get the latest version.'
              : 'Reload to try again.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-600 px-4 font-semibold text-white hover:bg-amber-700"
            >
              <RefreshCw className="h-5 w-5" aria-hidden="true" />
              Reload
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-amber-300 px-4 font-semibold hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
            >
              <Home className="h-5 w-5" aria-hidden="true" />
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
