import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { BarChart3, CalendarCheck, ClipboardList, Dumbbell, ListChecks, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ThemeToggle } from '../ThemeToggle';
import { navigate, useRoute } from '../../lib/router';
import type { Route } from '../../lib/router';

/**
 * The five areas of the portal, in the order a study day uses them: what is due today, the question bank, the other
 * ways to drill the notes, full mock exams, and how it is all going. Every other screen is reached from one of them
 * and goes back to it.
 */
export const TABS: { route: Route; label: string; icon: LucideIcon }[] = [
  { route: '/', label: 'Today', icon: CalendarCheck },
  { route: '/practice', label: 'Practice', icon: ListChecks },
  { route: '/drills', label: 'Drills', icon: Dumbbell },
  { route: '/mocks', label: 'Mocks', icon: ClipboardList },
  { route: '/progress', label: 'Progress', icon: BarChart3 },
];

function BottomNav() {
  const route = useRoute();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-surface-light/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-700 dark:bg-surface-dark/95"
    >
      <ul className="mx-auto grid max-w-[720px] grid-cols-5">
        {TABS.map((t) => {
          const active = t.route === route;
          const Icon = t.icon;
          return (
            <li key={t.route}>
              <button
                type="button"
                onClick={() => navigate(t.route)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[13px] font-medium leading-none transition-colors ${
                  active
                    ? 'text-primary-700 dark:text-primary-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? 'bg-primary-50 dark:bg-primary/20' : ''}`}
                  aria-hidden="true"
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                </span>
                {t.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Frame of a top-level area: its title, the same two controls top right, and the bottom navigation. */
export function TabShell({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  // Hash navigation keeps the scroll position of the screen it came from.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[720px] px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold leading-tight tracking-tight">{title}</h1>
            {lead && <div className="mt-0.5 text-[15px] text-slate-600 dark:text-slate-400">{lead}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
        {children}
      </div>
      <BottomNav />
    </div>
  );
}

/** A titled block of a top-level area, with an optional line saying what tapping its cards does. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{title}</h2>
      {hint && <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Two-column grid of cards on wide screens, one column on a phone. */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}
