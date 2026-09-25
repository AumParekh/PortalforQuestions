/** Sense Check (plan §3d): size and sign an answer before computing it. */

export type SenseMode = 'direction' | 'magnitude' | 'intermediate';
export type SenseArea = 'MR' | 'CR' | 'IM' | 'LTR' | 'ORR' | 'CI';

export type ScenarioSource = { kind: 'bank'; questionId: string } | { kind: 'notes'; file: string; line: number | null };

export interface ScenarioOption {
  label: string;
  correct: boolean;
  /** Why this option is wrong (the named slip); only on wrong options. */
  why: string | null;
}

export interface WorkingStep {
  label: string;
  /** Markdown with $…$ math. */
  display: string;
  value: number | null;
}

export interface Scenario {
  id: string;
  mode: SenseMode;
  area: SenseArea;
  /** Reading label; the rotation key. */
  reading: string;
  readingId: string | null;
  source: ScenarioSource;
  trapCategory: string | null;
  setup: string;
  ask: string;
  options: ScenarioOption[];
  working: WorkingStep[];
  takeaway: string;
}

export const MODES: SenseMode[] = ['direction', 'magnitude', 'intermediate'];

export const MODE_LABEL: Record<SenseMode, string> = {
  direction: 'Direction',
  magnitude: 'Magnitude',
  intermediate: 'Intermediate',
};

export const MODE_TITLE: Record<SenseMode, string> = {
  direction: 'Direction call',
  magnitude: 'Magnitude call',
  intermediate: 'Intermediate call',
};

export const AREAS: SenseArea[] = ['MR', 'CR', 'IM', 'LTR', 'ORR', 'CI'];

export const AREA_NAME: Record<SenseArea, string> = {
  MR: 'Market Risk',
  CR: 'Credit Risk',
  IM: 'Investment Management',
  LTR: 'Liquidity and Treasury Risk',
  ORR: 'Operational Risk and Resilience',
  CI: 'Current Issues',
};
