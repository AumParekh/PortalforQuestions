import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type ThemeMode = 'light' | 'dark' | 'system';

const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };
const LABEL: Record<ThemeMode, string> = {
  light: 'Theme: light. Switch to dark',
  dark: 'Theme: dark. Switch to system',
  system: 'Theme: system. Switch to light',
};

function readMode(): ThemeMode {
  try {
    const t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    // Storage may be blocked; fall back to system.
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(mode: ThemeMode) {
  const dark = mode === 'system' ? systemPrefersDark() : mode === 'dark';
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(readMode);

  useEffect(() => {
    apply(mode);
    try {
      if (mode === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', mode);
    } catch {
      // Ignore storage failures; the class toggle still applies for this page view.
    }
    if (mode !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={() => setMode(NEXT[mode])}
      aria-label={LABEL[mode]}
      title={LABEL[mode]}
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-card-light text-slate-700 shadow-sm transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-card-dark dark:text-slate-200 dark:hover:bg-slate-700"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
