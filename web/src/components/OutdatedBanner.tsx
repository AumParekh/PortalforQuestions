import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { DB_OUTDATED_EVENT, isDbOutdated } from '../lib/db';

/** Shown when a newer version of the app (another tab) upgraded storage, so this tab's answers would no longer save. */
export function OutdatedBanner() {
  const [outdated, setOutdated] = useState(isDbOutdated);
  useEffect(() => {
    const on = () => setOutdated(true);
    window.addEventListener(DB_OUTDATED_EVENT, on);
    return () => window.removeEventListener(DB_OUTDATED_EVENT, on);
  }, []);
  if (!outdated) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-300 bg-amber-50 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-[720px] flex-wrap items-center gap-3">
        <p className="flex-1 text-[15px]">The app was updated in another tab. Reload to keep saving your answers.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-600 px-4 font-semibold text-white hover:bg-amber-700"
        >
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
          Reload
        </button>
      </div>
    </div>
  );
}
