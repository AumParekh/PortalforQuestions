import type { ProgressFilter, SessionFilters, TimeTarget, TrapOperator } from '../../types';

export const EMPTY_FILTERS: SessionFilters = {
  status: [],
  trapOperators: [],
  hasTrap: null,
  hasTable: null,
  hasFormula: null,
  timeTarget: [],
  minCorrect: 0,
  minWrong: 0,
};

export const STATUS_OPTIONS: { value: ProgressFilter; label: string }[] = [
  { value: 'new', label: 'Never attempted' },
  { value: 'wrong-last', label: 'Wrong last time' },
  { value: 'marked', label: 'Marked for review' },
  { value: 'due', label: 'Due for review' },
];

export const TRAP_OPTIONS: { value: TrapOperator; label: string }[] = [
  { value: 'polarity-flip', label: 'Polarity flip' },
  { value: 'sibling-swap', label: 'Sibling swap' },
  { value: 'role-misassignment', label: 'Role misassignment' },
  { value: 'scope-condition-error', label: 'Scope / condition error' },
  { value: 'absolute-claim-trap', label: 'Absolute claim' },
  { value: 'wrong-input-twin', label: 'Wrong-input twin' },
  { value: 'dropped-term', label: 'Dropped term' },
  { value: 'unit-time-conversion', label: 'Unit / time conversion' },
  { value: 'correlation-misuse', label: 'Correlation misuse' },
  { value: 'intermediate-result-trap', label: 'Intermediate result' },
  { value: 'sign-error', label: 'Sign error' },
  { value: 'calculation-slip', label: 'Calculation slip' },
  { value: 'qualifier-misread', label: 'Qualifier misread' },
];

export const TIME_OPTIONS: { value: TimeTarget; label: string }[] = [
  { value: 'fast', label: 'Under 30s' },
  { value: 'medium', label: '30–60s' },
  { value: 'slow', label: 'Over 60s' },
];

export const MAX_THRESHOLD = 20;

export function activeFilterCount(f: SessionFilters): number {
  return (
    (f.status.length > 0 ? 1 : 0) +
    (f.trapOperators.length > 0 ? 1 : 0) +
    (f.hasTrap !== null ? 1 : 0) +
    (f.hasTable !== null ? 1 : 0) +
    (f.hasFormula !== null ? 1 : 0) +
    (f.timeTarget.length > 0 ? 1 : 0) +
    (f.minCorrect > 0 ? 1 : 0) +
    (f.minWrong > 0 ? 1 : 0)
  );
}

function members<T>(value: unknown, allowed: { value: T }[]): T[] {
  if (!Array.isArray(value)) return [];
  return allowed.filter((a) => value.includes(a.value)).map((a) => a.value);
}

function triState(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function threshold(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_THRESHOLD, Math.max(0, Math.round(value))) : 0;
}

/** Rebuilds filters from untrusted storage, dropping anything unknown. 'due' is dropped until scheduling exists. */
export function sanitizeFilters(value: unknown): SessionFilters {
  if (!value || typeof value !== 'object') return EMPTY_FILTERS;
  const v = value as Record<string, unknown>;
  return {
    status: members(v.status, STATUS_OPTIONS).filter((s) => s !== 'due'),
    trapOperators: members(v.trapOperators, TRAP_OPTIONS),
    hasTrap: triState(v.hasTrap),
    hasTable: triState(v.hasTable),
    hasFormula: triState(v.hasFormula),
    timeTarget: members(v.timeTarget, TIME_OPTIONS),
    minCorrect: threshold(v.minCorrect),
    minWrong: threshold(v.minWrong),
  };
}
