import { create } from 'zustand';

/**
 * Small device-local preferences (plan §4: localStorage only for tiny synchronous settings).
 * Call `applySettings()` once from main.tsx before the first render so the <html> classes
 * are in place on load; after that every setter re-applies them itself.
 */

/** Shown in Settings → About; bump alongside package.json. */
export const APP_VERSION = '0.1.0';

export const SETTINGS_KEY = 'frm.settings.v1';
/** Owned by SessionSetupScreen; Settings only merges its study defaults into `options`. */
export const SESSION_SETUP_KEY = 'frm.sessionSetup.v1';

export type HapticsMode = 'auto' | 'on' | 'off';
export type SessionCount = 10 | 20 | 50 | 'all';
export type ThemeMode = 'light' | 'dark' | 'system';

/** Must match the choices SessionSetupScreen accepts (it re-validates what it loads). */
export const TIMER_SECONDS_CHOICES = [60, 120, 180, 300] as const;
export const SESSION_COUNT_CHOICES: readonly SessionCount[] = [10, 20, 50, 'all'];

export interface Settings {
  legibleFont: boolean;
  haptics: HapticsMode;
  reduceMotion: boolean;
  defaultTimerEnabled: boolean;
  defaultTimerSeconds: number;
  defaultSessionCount: SessionCount;
}

export const DEFAULT_SETTINGS: Settings = {
  legibleFont: false,
  haptics: 'auto',
  reduceMotion: false,
  defaultTimerEnabled: true,
  defaultTimerSeconds: 120,
  defaultSessionCount: 20,
};

function isTimerSeconds(v: unknown): v is number {
  return typeof v === 'number' && (TIMER_SECONDS_CHOICES as readonly number[]).includes(v);
}

function isSessionCount(v: unknown): v is SessionCount {
  return SESSION_COUNT_CHOICES.some((c) => c === v);
}

/** Accepts anything (parsed JSON, garbage) and returns a complete, valid Settings object. */
export function sanitizeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const v = value as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    legibleFont: typeof v.legibleFont === 'boolean' ? v.legibleFont : d.legibleFont,
    haptics: v.haptics === 'auto' || v.haptics === 'on' || v.haptics === 'off' ? v.haptics : d.haptics,
    reduceMotion: typeof v.reduceMotion === 'boolean' ? v.reduceMotion : d.reduceMotion,
    defaultTimerEnabled: typeof v.defaultTimerEnabled === 'boolean' ? v.defaultTimerEnabled : d.defaultTimerEnabled,
    defaultTimerSeconds: isTimerSeconds(v.defaultTimerSeconds) ? v.defaultTimerSeconds : d.defaultTimerSeconds,
    defaultSessionCount: isSessionCount(v.defaultSessionCount) ? v.defaultSessionCount : d.defaultSessionCount,
  };
}

function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s: Settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked or full; the setting still applies for this page view.
  }
}

function pickSettings(s: Settings): Settings {
  return {
    legibleFont: s.legibleFont,
    haptics: s.haptics,
    reduceMotion: s.reduceMotion,
    defaultTimerEnabled: s.defaultTimerEnabled,
    defaultTimerSeconds: s.defaultTimerSeconds,
    defaultSessionCount: s.defaultSessionCount,
  };
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...loadSettings(),
  set: (patch) => {
    const next = sanitizeSettings({ ...pickSettings(get()), ...patch });
    set(next);
    saveSettings(next);
    applyClasses(next);
  },
}));

// Reduce motion: a stylesheet injected once so the class works without touching globals.css.
const REDUCE_MOTION_STYLE_ID = 'frm-reduce-motion';
const REDUCE_MOTION_CSS = `html.reduce-motion *, html.reduce-motion *::before, html.reduce-motion *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}`;

function ensureReduceMotionStyle() {
  if (document.getElementById(REDUCE_MOTION_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = REDUCE_MOTION_STYLE_ID;
  el.textContent = REDUCE_MOTION_CSS;
  document.head.appendChild(el);
}

function applyClasses(s: Settings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('legible', s.legibleFont);
  root.classList.toggle('reduce-motion', s.reduceMotion);
  if (s.reduceMotion) ensureReduceMotionStyle();
}

/** Applies stored settings to <html>. Call once from main.tsx before rendering. */
export function applySettings() {
  applyClasses(useSettings.getState());
}

/** True when the device should vibrate on answer feedback ('auto' = touch devices only, plan §11). */
export function hapticsEnabled(): boolean {
  const mode = useSettings.getState().haptics;
  if (mode === 'off') return false;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  if (mode === 'on') return true;
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Vibrates if haptics are enabled; silently does nothing otherwise. */
export function haptic(pattern: number | number[]) {
  if (!hapticsEnabled()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // vibrate can throw in some embedded browsers; feedback is optional.
  }
}

// ---- Theme (same contract as ThemeToggle and the index.html bootstrap: localStorage 'theme' + 'dark' class) ----

export function readTheme(): ThemeMode {
  try {
    const t = window.localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    // Storage may be blocked; fall back to system.
  }
  return 'system';
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(mode: ThemeMode) {
  const dark = mode === 'system' ? systemPrefersDark() : mode === 'dark';
  document.documentElement.classList.toggle('dark', dark);
}

export function writeTheme(mode: ThemeMode) {
  applyTheme(mode);
  try {
    if (mode === 'system') window.localStorage.removeItem('theme');
    else window.localStorage.setItem('theme', mode);
  } catch {
    // Ignore storage failures; the class toggle still applies for this page view.
  }
}

// ---- Study defaults, shared with SessionSetupScreen's saved setup ----

export interface StudyDefaults {
  timerEnabled: boolean;
  timerSeconds: number;
  count: SessionCount;
}

function readSetupRaw(): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(SESSION_SETUP_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The study defaults New Session will actually use: the saved setup's options when present and valid,
 * otherwise the Settings store values.
 */
export function readStudyDefaults(): StudyDefaults {
  const s = useSettings.getState();
  const fallback: StudyDefaults = {
    timerEnabled: s.defaultTimerEnabled,
    timerSeconds: s.defaultTimerSeconds,
    count: s.defaultSessionCount,
  };
  const setup = readSetupRaw();
  const o = setup && setup.options && typeof setup.options === 'object' ? (setup.options as Record<string, unknown>) : null;
  if (!o) return fallback;
  const minutes = o.timerMinutes;
  const secs = typeof minutes === 'number' ? minutes * 60 : NaN;
  return {
    timerEnabled: typeof o.timerEnabled === 'boolean' ? o.timerEnabled : fallback.timerEnabled,
    timerSeconds: isTimerSeconds(secs) ? secs : fallback.timerSeconds,
    count: isSessionCount(o.count) ? o.count : fallback.count,
  };
}

/**
 * Stores study defaults in Settings and merges them into the saved setup's `options`
 * (every other field of the saved setup is left untouched).
 */
export function writeStudyDefaults(patch: Partial<StudyDefaults>) {
  const next = { ...readStudyDefaults(), ...patch };
  if (!isTimerSeconds(next.timerSeconds) || !isSessionCount(next.count) || typeof next.timerEnabled !== 'boolean') return;
  useSettings.getState().set({
    defaultTimerEnabled: next.timerEnabled,
    defaultTimerSeconds: next.timerSeconds,
    defaultSessionCount: next.count,
  });
  const setup = readSetupRaw() ?? {};
  const prevOptions = setup.options && typeof setup.options === 'object' && !Array.isArray(setup.options) ? setup.options : {};
  const merged = {
    ...setup,
    options: {
      ...(prevOptions as Record<string, unknown>),
      timerEnabled: next.timerEnabled,
      timerMinutes: next.timerSeconds / 60,
      count: next.count,
    },
  };
  try {
    window.localStorage.setItem(SESSION_SETUP_KEY, JSON.stringify(merged));
  } catch {
    // Storage unavailable; New Session falls back to its own defaults.
  }
}
