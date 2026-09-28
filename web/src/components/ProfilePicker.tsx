import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, GraduationCap } from 'lucide-react';
import { PROFILES } from '../games/profile';
import type { ProfileId } from '../games/profile';

/** Keys that pick a profile: its number in the list, or its initial. */
const KEYS: Record<string, ProfileId> = { '1': 'chelsi', c: 'chelsi', '2': 'aum', a: 'aum' };

/**
 * "Who's studying?": shown on every page load before anything else (main.tsx), since two people share the app and
 * each has their own progress. Touches no storage: `suggested` (highlighted, and taken by Enter) comes from main.tsx,
 * and `onChoose` loads the app for that person, rejecting if it can't (offline before the app was ever cached, say).
 */
export function ProfilePicker({ suggested, onChoose }: { suggested: ProfileId; onChoose: (id: ProfileId) => Promise<void> }) {
  const [chosen, setChosen] = useState<ProfileId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const suggestedRef = useRef<HTMLButtonElement>(null);

  const choose = (id: ProfileId) => {
    if (chosen) return;
    setChosen(id);
    setError(null);
    onChoose(id).catch((e: unknown) => {
      setChosen(null);
      setError(e instanceof Error ? e.message : String(e));
    });
  };

  // Enter (or Space) takes the highlighted person straight away.
  useEffect(() => suggestedRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const id = KEYS[e.key.toLowerCase()];
      if (!id) return;
      e.preventDefault();
      choose(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main
      data-profile-picker=""
      aria-busy={chosen !== null}
      className="flex min-h-screen flex-col items-center justify-center px-4 py-[max(2rem,env(safe-area-inset-top))]"
    >
      <div className="w-full max-w-[480px]">
        <p className="flex items-center justify-center gap-2 text-[15px] font-medium text-slate-600 dark:text-slate-400">
          <GraduationCap className="h-5 w-5 text-primary-600 dark:text-primary-100" aria-hidden="true" />
          FRM Part II
        </p>
        <h1 className="mt-2 text-center text-2xl font-bold tracking-tight">Who's studying?</h1>
        <p className="mt-1 text-center text-[15px] text-slate-600 dark:text-slate-400">Each of you has your own progress and exam date.</p>

        <div role="group" aria-label="Choose who is studying" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PROFILES.map((p, i) => {
            const highlighted = p.id === suggested;
            const opening = chosen === p.id;
            return (
              <button
                key={p.id}
                ref={highlighted ? suggestedRef : undefined}
                type="button"
                disabled={chosen !== null}
                onClick={() => choose(p.id)}
                aria-keyshortcuts={`${i + 1} ${p.name[0]}`}
                className={`flex min-h-[88px] w-full items-center gap-4 rounded-2xl border-2 bg-card-light p-4 text-left shadow-sm transition hover:shadow-md disabled:cursor-wait dark:bg-card-dark ${
                  highlighted ? 'border-primary' : 'border-transparent'
                } ${chosen !== null && !opening ? 'opacity-50' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xl font-bold text-primary-700 dark:bg-primary-700/40 dark:text-primary-100"
                >
                  {p.name[0]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xl font-semibold leading-tight">{p.name}</span>
                  {/* No exam date here: it may have been changed in Settings, and nothing reads a profile's storage
                      before the choice. */}
                  {opening && <span className="block text-[15px] text-slate-600 dark:text-slate-400">Opening…</span>}
                </span>
                <kbd className="hidden shrink-0 rounded-md border border-slate-300 px-1.5 font-mono text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400 sm:inline">
                  {i + 1}
                </kbd>
              </button>
            );
          })}
        </div>

        {error && (
          <div role="alert" className="mt-4 flex gap-3 text-[15px] text-red-700 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p>Couldn't open the app: {error}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 min-h-[44px] rounded-xl bg-primary px-5 font-medium text-white"
              >
                Reload
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
