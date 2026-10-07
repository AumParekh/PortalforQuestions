import type { SessionMode, SessionSize } from './plan';
import type { Formula } from './types';
import { GAMES } from './games';
import { profileKey } from '../games/profile';

export type SetupChoice = SessionMode | 'sheet';

export interface GymSetup {
  /** 'shuffle' drills the chosen areas; 'chapters' drills only the chosen readings, whatever their area. */
  scope: 'shuffle' | 'chapters';
  areas: string[];
  /** Reading ids, used when `scope` is 'chapters'. */
  readings: string[];
  mode: SetupChoice;
  size: SessionSize;
  /** Memory Match partner cards: worked numbers instead of variable keys. */
  numbers: boolean;
}

export const SIZE_OPTIONS: { value: SessionSize; label: string }[] = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 'all', label: 'All' },
];

/** Per profile: stored under `profileKey(...)` (games/profile.ts). */
const STORAGE_KEY = 'frm.formulaGym.v1';

export const DEFAULT_SETUP: GymSetup = { scope: 'shuffle', areas: [], readings: [], mode: 'workout', size: 10, numbers: false };

const MODES: SetupChoice[] = ['workout', 'sheet', ...GAMES.map((g) => g.id)];

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The saved setup, or null. Areas and readings are validated against the deck by the caller. */
export function loadSetup(): GymSetup | null {
  try {
    const raw = window.localStorage.getItem(profileKey(STORAGE_KEY));
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== 'object') return null;
    const o = d as Record<string, unknown>;
    const readings = strings(o.readings);
    return {
      // Setups saved before the switch existed narrowed areas by reading: those open on their chapters.
      scope: o.scope === 'chapters' ? 'chapters' : o.scope === 'shuffle' ? 'shuffle' : readings.length > 0 ? 'chapters' : 'shuffle',
      areas: strings(o.areas),
      readings,
      mode: MODES.find((m) => m === o.mode) ?? DEFAULT_SETUP.mode,
      size: SIZE_OPTIONS.find((s) => s.value === o.size)?.value ?? DEFAULT_SETUP.size,
      numbers: o.numbers === true,
    };
  } catch {
    return null;
  }
}

export function saveSetup(setup: GymSetup) {
  try {
    window.localStorage.setItem(profileKey(STORAGE_KEY), JSON.stringify(setup));
  } catch {
    // Storage may be unavailable (private mode, quota); setup still works without it.
  }
}

/** Formulas of the chosen chapters, or of the chosen areas when shuffling. */
export function scopeOf(formulas: Formula[], setup: Pick<GymSetup, 'scope' | 'areas' | 'readings'>): Formula[] {
  if (setup.scope === 'chapters') {
    const readings = new Set(setup.readings);
    return formulas.filter((f) => readings.has(f.readingId));
  }
  const areas = new Set(setup.areas);
  return formulas.filter((f) => areas.has(f.area));
}
