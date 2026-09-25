import type { SessionMode, SessionSize } from './plan';
import type { Formula } from './types';
import { GAMES } from './games';

export type SetupChoice = SessionMode | 'sheet';

export interface GymSetup {
  areas: string[];
  /** Reading ids. An area with none of its readings listed contributes all of them. */
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

const STORAGE_KEY = 'frm.formulaGym.v1';

export const DEFAULT_SETUP: GymSetup = { areas: [], readings: [], mode: 'workout', size: 10, numbers: false };

const MODES: SetupChoice[] = ['workout', 'sheet', ...GAMES.map((g) => g.id)];

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The saved setup, or null. Areas and readings are validated against the deck by the caller. */
export function loadSetup(): GymSetup | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== 'object') return null;
    const o = d as Record<string, unknown>;
    return {
      areas: strings(o.areas),
      readings: strings(o.readings),
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // Storage may be unavailable (private mode, quota); setup still works without it.
  }
}

/** Formulas in the chosen areas, narrowed to the chosen readings of each area that has any. */
export function scopeOf(formulas: Formula[], setup: Pick<GymSetup, 'areas' | 'readings'>): Formula[] {
  const areas = new Set(setup.areas);
  const readings = new Set(setup.readings);
  const narrowed = new Set(setup.readings.map((r) => r.split('-')[0]));
  return formulas.filter((f) => areas.has(f.area) && (!narrowed.has(f.area) || readings.has(f.readingId)));
}
