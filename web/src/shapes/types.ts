import type { RecallTier } from '../types';

/** How a question practises a shape: a calculation, its theory, the trap itself, or the recall workbook's own question. */
export type ShapeForm = 'c' | 't' | 'x' | 'r';

/** One thing the sources report as examined: a workbook shape, a Priority Map point or a Vardeez pointer. */
export interface ShapeSelector {
  /** "S1" (workbook shape), "M1" (Priority Map), "V1" (Vardeez). */
  id: string;
  kind: 'shape' | 'map' | 'vardeez';
  name: string;
  what: string;
  /** Seen in the August 2026 sitting. */
  august?: boolean;
  /** Where a Map or Vardeez point is said. */
  source?: string;
  /** Question id and form, the recall workbook's own questions first. */
  questions: [string, ShapeForm][];
}

export interface ShapeMapEntry {
  number: number;
  sources?: string;
  rating?: string;
  tested?: string;
  specifics?: string;
}

/** A recall-workbook topic ("A1 Unexpected Loss...") with only the questions that match what was reported. */
export interface ShapeTopic {
  id: string;
  tier: RecallTier;
  title: string;
  /** Official chapter codes the topic draws on: "CR-4". */
  readings: string[];
  /** Return on Learning Objective: rank of 86 and what to do ("Strike first"). */
  rank?: number;
  action?: string;
  /** The candidate's own recall of the August 2026 sitting. */
  august?: string;
  maps: ShapeMapEntry[];
  vardeez?: string;
  selectors: ShapeSelector[];
}

export interface ShapesFile {
  topics: ShapeTopic[];
}
