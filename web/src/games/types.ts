// Types for the Notes → Games layer. Content types mirror game-blocks.json (brief Phase 5,
// extended per PORTAL_PLAN §3c). Fields the extractor may or may not emit are optional so the
// loader tolerates shape drift; the game layer only relies on the required ones.

export type Area = 'MR' | 'CR' | 'ORR' | 'LTR' | 'IM' | 'CI';
export const AREAS: readonly Area[] = ['MR', 'CR', 'ORR', 'LTR', 'IM', 'CI'];
export const AREA_NAMES: Record<Area, string> = {
  MR: 'Market Risk',
  CR: 'Credit Risk',
  ORR: 'Operational Risk and Resilience',
  LTR: 'Liquidity and Treasury Risk',
  IM: 'Investment Management',
  CI: 'Current Issues',
};

/** Eight canonical categories from the brief plus Sequence (§3c). */
export type TrapCategory =
  | 'Polarity'
  | 'Sibling'
  | 'Role'
  | 'Sign'
  | 'Scope'
  | 'Definition'
  | 'Formula'
  | 'Intermediate result'
  | 'Sequence';
export const TRAP_CATEGORIES: readonly TrapCategory[] = [
  'Polarity',
  'Sibling',
  'Role',
  'Sign',
  'Scope',
  'Definition',
  'Formula',
  'Intermediate result',
  'Sequence',
];

/** Ten canonical block types: the brief's nine plus tikzpicture, and notebox (§3c). */
export type BlockType =
  | 'keybox'
  | 'trapbox'
  | 'defbox'
  | 'fmlbox'
  | 'exbox'
  | 'gapbox'
  | 'figcap'
  | 'table'
  | 'prose_para'
  | 'tikzpicture'
  | 'notebox';

/**
 * A mined sub-item (term, bullet, numeric item, …). The brief shows some of these as bare
 * strings on the block and also asks for stable IDs; both shapes are accepted.
 */
export interface SubItem {
  id?: string;
  parent?: string;
  subtype?: string;
  text?: string;
  plain_text?: string;
  context?: string;
  value?: string | number;
  unit?: string;
  hash?: string;
}
export type SubItemLike = string | SubItem;

export interface VariableDef {
  id?: string;
  symbol: string;
  definition: string;
}

export interface TableRow {
  id?: string;
  cells: string[];
  headers?: string[];
}

export interface Block {
  id: string;
  type: BlockType;
  title?: string | null;
  subtype?: string | null;
  body_latex?: string;
  plain_text?: string;
  caption?: string | null;
  notation_key?: string | null;
  is_gap_fill?: boolean;
  source_line?: number;
  hash?: string;
  terms?: SubItemLike[];
  bold_claims?: SubItemLike[];
  numeric_items?: SubItemLike[];
  bullets?: SubItemLike[];
  section_headings?: SubItemLike[];
  variables?: VariableDef[];
  rows?: TableRow[];
  cross_refs?: string[];
  cases?: string[];
  provenance?: unknown;
}

export interface Objective {
  letter: string;
  text: string;
  /** e.g. "LTR-1 a" */
  id: string;
  blocks: Block[];
}

export type TrapOrigin = 'trapbox' | 'summary' | 'mined';

export interface Trap {
  id: string;
  category: TrapCategory;
  raw_category?: string | null;
  text: string;
  plain_text?: string;
  correct_text?: string | null;
  corrupted_text?: string | null;
  source_block?: string | null;
  origin?: TrapOrigin | string;
  category_inferred?: boolean;
  objective?: string | null;
  hash?: string;
}

export interface SourceNote {
  kind?: string;
  title?: string;
  text?: string;
  source_block?: string;
}

export interface Reading {
  reading_id: string;
  title: string;
  area: Area | string;
  tag?: string | null;
  src?: number | null;
  source_citation?: string | null;
  source_file?: string | null;
  objectives: Objective[];
  traps: Trap[];
  source_notes?: (SourceNote | string)[];
  mechanics_supported?: string[];
  cross_refs?: string[];
  cases?: string[];
}

export interface CorrectionRow {
  where: string;
  as_written: string;
  as_corrected: string;
}

export interface GameBlocks {
  version: string;
  generated?: string;
  sources?: Record<string, { readings: number; lines: number }>;
  readings: Record<string, Reading>;
  trap_index?: Partial<Record<TrapCategory, string[]>> & Record<string, string[] | undefined>;
  sub_item_index?: Record<string, string[] | undefined>;
  corrections_index?: CorrectionRow[];
}

// ---------------------------------------------------------------------------------------------
// Mechanics

/** Every mechanic in brief Phase 7 plus the §3c retention additions. */
export type MechanicId =
  // 7.1 detection
  | 'shatter'
  | 'trap-shape-trainer'
  | 'polarity-reflex'
  | 'sibling-duel'
  | 'confusables-duel'
  | 'fingerprint'
  | 'party-line'
  // 7.2 structural
  | 'bucket-drop'
  | 'severity-grid'
  | 'threshold-slider'
  | 'table-fill'
  | 'order-game'
  | 'classification-ladder'
  // 7.3 relational
  | 'lineage-tree'
  | 'sibling-map'
  | 'concept-atlas'
  // 7.4 application
  | 'scenario-router'
  | 'decision-tree-walk'
  | 'case-docket'
  | 'stepwise-derivation'
  | 'bridge-builder'
  // 7.5 explorable
  | 'parameter-playground'
  | 'tree-explorer'
  | 'distribution-explorer'
  | 'the-duel'
  | 'timeline-walk'
  | 'explorable'
  // 7.6 assessment
  | 'concept-inventory'
  | 'trap-audit'
  | 'formula-assembler'
  | 'coverage-view'
  // §3c retention additions
  | 'blurt-board'
  | 'cloze-chain'
  | 'memory-palace'
  | 'formula-from-memory'
  | 'interleaved-gauntlet'
  | 'explain-it-back'
  | 'pin-the-note';

export type MechanicFamily = 'detection' | 'structural' | 'relational' | 'application' | 'explorable' | 'assessment' | 'retention';

export const MECHANIC_CATALOGUE: readonly { id: MechanicId; name: string; family: MechanicFamily }[] = [
  { id: 'shatter', name: 'Shatter', family: 'detection' },
  { id: 'trap-shape-trainer', name: 'Trap Shape Trainer', family: 'detection' },
  { id: 'polarity-reflex', name: 'Polarity Reflex', family: 'detection' },
  { id: 'sibling-duel', name: 'Sibling Duel', family: 'detection' },
  { id: 'confusables-duel', name: 'Confusables Duel', family: 'detection' },
  { id: 'fingerprint', name: 'Fingerprint', family: 'detection' },
  { id: 'party-line', name: 'Party Line', family: 'detection' },
  { id: 'bucket-drop', name: 'Bucket Drop', family: 'structural' },
  { id: 'severity-grid', name: 'Severity Grid', family: 'structural' },
  { id: 'threshold-slider', name: 'Threshold Slider', family: 'structural' },
  { id: 'table-fill', name: 'Table Fill', family: 'structural' },
  { id: 'order-game', name: 'Order Game', family: 'structural' },
  { id: 'classification-ladder', name: 'Classification Ladder', family: 'structural' },
  { id: 'lineage-tree', name: 'Lineage Tree', family: 'relational' },
  { id: 'sibling-map', name: 'Sibling Map', family: 'relational' },
  { id: 'concept-atlas', name: 'Concept Atlas', family: 'relational' },
  { id: 'scenario-router', name: 'Scenario Router', family: 'application' },
  { id: 'decision-tree-walk', name: 'Decision Tree Walk', family: 'application' },
  { id: 'case-docket', name: 'Case Docket', family: 'application' },
  { id: 'stepwise-derivation', name: 'Stepwise Derivation', family: 'application' },
  { id: 'bridge-builder', name: 'Bridge Builder', family: 'application' },
  { id: 'parameter-playground', name: 'Parameter Playground', family: 'explorable' },
  { id: 'tree-explorer', name: 'Tree Explorer', family: 'explorable' },
  { id: 'distribution-explorer', name: 'Distribution Explorer', family: 'explorable' },
  { id: 'the-duel', name: 'The Duel', family: 'explorable' },
  { id: 'timeline-walk', name: 'Timeline Walk', family: 'explorable' },
  { id: 'explorable', name: 'Explorable', family: 'explorable' },
  { id: 'concept-inventory', name: 'Concept Inventory', family: 'assessment' },
  { id: 'trap-audit', name: 'Trap Audit', family: 'assessment' },
  { id: 'formula-assembler', name: 'Formula Assembler', family: 'assessment' },
  { id: 'coverage-view', name: 'Coverage View', family: 'assessment' },
  { id: 'blurt-board', name: 'Blurt Board', family: 'retention' },
  { id: 'cloze-chain', name: 'Cloze Chain', family: 'retention' },
  { id: 'memory-palace', name: 'Memory Palace', family: 'retention' },
  { id: 'formula-from-memory', name: 'Formula from Memory', family: 'retention' },
  { id: 'interleaved-gauntlet', name: 'Interleaved Gauntlet', family: 'retention' },
  { id: 'explain-it-back', name: 'Explain It Back', family: 'retention' },
  { id: 'pin-the-note', name: 'Pin the Note', family: 'retention' },
];

const NAME_BY_ID = Object.fromEntries(MECHANIC_CATALOGUE.map((m) => [m.id, m.name])) as Record<MechanicId, string>;

export function mechanicName(id: MechanicId): string {
  return NAME_BY_ID[id] ?? id;
}

/** Maps a mechanics_supported label from game-blocks.json ("Order Game") to its id, if known. */
export function mechanicIdFromName(name: string): MechanicId | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return MECHANIC_CATALOGUE.some((m) => m.id === slug) ? (slug as MechanicId) : null;
}

// ---------------------------------------------------------------------------------------------
// Narrative frames (§10.4)

export type FrameId =
  | 'museum-tour'
  | 'night-court'
  | 'autopsy-room'
  | 'heist-debrief'
  | 'swearing-in'
  | 'forecast-desk'
  | 'signal-room'
  | 'field-guide';

// ---------------------------------------------------------------------------------------------
// Persistent records (IndexedDB 'frm-games')

export type ArcPhase = 'opening' | 'discovery' | 'naming' | 'pressure' | 'close';
export type PlayPhase = 'discovery' | 'pressure';

/** One answered round, as logged. Every round logs its block ID (§9.6). */
export interface RoundLog {
  roundId: string;
  itemId: string;
  blockId: string;
  objectiveId?: string;
  category?: TrapCategory;
  phase: PlayPhase;
  correct: boolean;
  timeMs: number;
  timedOut: boolean;
  grade: number;
}

export interface CategoryTally {
  caught: number;
  missed: number;
}

export type SessionTrigger = 'auto' | 'reading' | 'mechanic';

/** One row per session — the §9.7 fields plus what rotation and coverage need. */
export interface SessionLog {
  sessionId: string;
  /** The "#N" in the GAME LOG line; 1-based count of logged sessions. */
  number: number;
  startedAt: string;
  /** ISO time the session closed. */
  timestamp: string;
  mechanic: MechanicId;
  mechanicTitle: string;
  readingId: string;
  frame: FrameId;
  trigger: SessionTrigger;
  /** True when the full five-phase arc ran; only completed arcs close objectives. */
  completed: boolean;
  roundsPlanned: number;
  rounds: RoundLog[];
  caught: number;
  /** Concept named in the just-in-time naming step. */
  taught: string;
  taughtObjective: string;
  conceptBlockId: string;
  objectivesClosed: string[];
  categoriesDrawn: TrapCategory[];
  missCategories: TrapCategory[];
  byCategory: Partial<Record<TrapCategory, CategoryTally>>;
  blockIds: string[];
  /** The three §9.7 lines as printed at close. */
  lines: string[];
}

/** SM-2 state per extracted item ID; one shared schedule across all mechanics. */
export interface ItemSrs {
  itemId: string;
  interval: number;
  repetition: number;
  efactor: number;
  /** Local calendar date YYYY-MM-DD the item is next due. */
  dueDate: string;
  lastResult: 'correct' | 'wrong';
  lastGrade: number;
  lastReviewed: string;
  reviews: number;
  lapses: number;
  readingId?: string;
  category?: TrapCategory;
}

export interface CoverageRow {
  objectiveId: string;
  readingId: string;
  /** Most recent close. */
  closedAt: string;
  firstClosedAt: string;
  times: number;
}
