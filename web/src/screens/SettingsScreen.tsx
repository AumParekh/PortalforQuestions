import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Monitor, Moon, Sun } from 'lucide-react';
import { navigate } from '../lib/router';
import { useContent } from '../store/content';
import {
  APP_VERSION,
  SESSION_COUNT_CHOICES,
  TIMER_SECONDS_CHOICES,
  applyTheme,
  readStudyDefaults,
  readTheme,
  useSettings,
  writeStudyDefaults,
  writeTheme,
} from '../lib/settings';
import type { HapticsMode, SessionCount, StudyDefaults, ThemeMode } from '../lib/settings';
import { Segmented, SettingsRow, SettingsSection, Switch } from '../components/settings/controls';
import { ProgressDataSection } from '../components/settings/ProgressDataSection';
import { ExamDateSection } from '../components/settings/ExamDateSection';

const THEMES: { value: ThemeMode; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" aria-hidden="true" /> },
  { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" aria-hidden="true" /> },
];
const HAPTICS: { value: HapticsMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];
const TIMERS = TIMER_SECONDS_CHOICES.map((s) => ({ value: s as number, label: `${s / 60} min` }));
const COUNTS = SESSION_COUNT_CHOICES.map((c) => ({ value: c, label: c === 'all' ? 'All' : String(c) }));

function canVibrate() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function ContentCounts() {
  const status = useContent((s) => s.status);
  const files = useContent((s) => s.files);
  if (status !== 'ready') return <>Question banks are still loading.</>;
  const subjects = files.filter((f) => f.type === 'subject');
  const mocks = files.filter((f) => f.type === 'mock');
  const n = (list: typeof files) => list.reduce((sum, f) => sum + f.questionIds.length, 0);
  return (
    <>
      {subjects.length} subject {subjects.length === 1 ? 'bank' : 'banks'} with {n(subjects).toLocaleString()} questions
      {mocks.length > 0 && (
        <>
          , plus {mocks.length} mock {mocks.length === 1 ? 'exam' : 'exams'} ({n(mocks).toLocaleString()} questions)
        </>
      )}
      .
    </>
  );
}

export function SettingsScreen() {
  const legibleFont = useSettings((s) => s.legibleFont);
  const reduceMotion = useSettings((s) => s.reduceMotion);
  const haptics = useSettings((s) => s.haptics);
  const setSettings = useSettings((s) => s.set);

  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  // Reflects what New Session will use (its saved setup), which may have changed since Settings was last opened.
  const [study, setStudy] = useState<StudyDefaults>(readStudyDefaults);

  // Follow the OS while on "System", same as ThemeToggle.
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const changeTheme = (mode: ThemeMode) => {
    setTheme(mode);
    writeTheme(mode);
  };

  const changeStudy = (patch: Partial<StudyDefaults>) => {
    writeStudyDefaults(patch);
    setStudy(readStudyDefaults());
  };

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
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] space-y-6 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-4">
        <ExamDateSection />

        <SettingsSection title="Appearance">
          <SettingsRow label="Theme" hint="System follows your device's light or dark setting.">
            <Segmented label="Theme" value={theme} options={THEMES} onChange={changeTheme} />
          </SettingsRow>
          <Switch
            label="Hyperlegible font"
            hint="Use Atkinson Hyperlegible, designed for easier reading."
            checked={legibleFont}
            onChange={(v) => setSettings({ legibleFont: v })}
          />
          <Switch
            label="Reduce motion"
            hint="Turn off animations such as the wrong-answer shake."
            checked={reduceMotion}
            onChange={(v) => setSettings({ reduceMotion: v })}
          />
        </SettingsSection>

        <SettingsSection title="Study defaults" description="Used by New Session. You can still change them there for each session.">
          <Switch
            label="Question timer"
            hint="An unanswered question is marked wrong when time runs out."
            checked={study.timerEnabled}
            onChange={(v) => changeStudy({ timerEnabled: v })}
          />
          <SettingsRow label="Time per question">
            <Segmented
              label="Time per question"
              value={study.timerSeconds}
              options={TIMERS}
              disabled={!study.timerEnabled}
              onChange={(v) => changeStudy({ timerSeconds: v })}
            />
          </SettingsRow>
          <SettingsRow label="Questions per session">
            <Segmented<SessionCount>
              label="Questions per session"
              value={study.count}
              options={COUNTS}
              onChange={(v) => changeStudy({ count: v })}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Feedback">
          <SettingsRow
            label="Haptics"
            hint={
              canVibrate()
                ? 'Vibrate on correct and wrong answers. Auto turns this on for phones and tablets only.'
                : "Vibrate on correct and wrong answers. This browser doesn't support vibration, so the setting has no effect here."
            }
          >
            <Segmented label="Haptics" value={haptics} options={HAPTICS} onChange={(v) => setSettings({ haptics: v })} />
          </SettingsRow>
        </SettingsSection>

        <ProgressDataSection />

        <SettingsSection title="About">
          <div className="space-y-1 py-3 text-[15px] text-slate-700 dark:text-slate-300">
            <p>
              <span className="font-medium text-slate-900 dark:text-slate-100">FRM Part II Study Portal</span> · version {APP_VERSION}
            </p>
            <p>
              <ContentCounts />
            </p>
            <p>Progress is stored on this device only; sync arrives later.</p>
          </div>
        </SettingsSection>
      </main>
    </div>
  );
}
