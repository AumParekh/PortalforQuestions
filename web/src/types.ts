export type OptionKey = 'a' | 'b' | 'c' | 'd' | 'e';

export type TrapOperator =
  | 'polarity-flip'
  | 'sibling-swap'
  | 'role-misassignment'
  | 'scope-condition-error'
  | 'absolute-claim-trap'
  | 'wrong-input-twin'
  | 'dropped-term'
  | 'unit-time-conversion'
  | 'correlation-misuse'
  | 'intermediate-result-trap'
  | 'sign-error'
  | 'calculation-slip'
  | 'qualifier-misread';

export type LoType = 'Numerical' | 'Non-Numerical' | 'Qualitative';

export interface QuestionOption {
  key: OptionKey;
  text: string;
}

export interface OptionVerdict {
  verdict: 'correct' | 'incorrect';
  reason: string;
}

export interface Question {
  id: string;
  subject: string;
  tier: string;
  lo: string;
  loText: string;
  reading: string;
  topic: string;
  question: string;
  options: QuestionOption[];
  answer: OptionKey;
  solution: string;
  optionAnalysis: Partial<Record<OptionKey, OptionVerdict>>;
  trap: { operators: TrapOperator[]; explanation: string };
  notes: { added: boolean; typeMismatch: boolean; loType: LoType };
  /** Set by the loader: the content file this question came from, e.g. "IR.json" or "mocks/mock-exam-1.json". */
  file: string;
}

export interface ContentFile {
  path: string;
  type: 'subject' | 'mock';
  name: string;
  tiers?: string[];
  timeLimitMinutes?: number;
  questionIds: string[];
}

export type ScopeKind = 'subject' | 'reading' | 'topic' | 'lo';

export interface CatalogItem {
  key: string;
  kind: ScopeKind;
  label: string;
  sublabel?: string;
  subject: string;
  questionIds: string[];
}

export type SessionOrder = 'sequential' | 'shuffled' | 'weakest' | 'random';

export interface SessionConfig {
  scopeKind: ScopeKind;
  selectedKeys: string[];
  count: number | 'all';
  order: SessionOrder;
  timerEnabled: boolean;
  timerSeconds: number;
  trapOnly: boolean;
  wrongFirst: boolean;
  skipDrops: boolean;
  /** Defaults to 'drill' when absent. */
  mode?: SessionMode;
  /** Free-text search applied before filters (see lib/search.ts). */
  searchQuery?: string;
  filters?: SessionFilters;
}

export type ProgressFilter = 'new' | 'wrong-last' | 'marked' | 'due';
export type TimeTarget = 'fast' | 'medium' | 'slow';

/** Structured filters from the Session Setup sheet; all combine with the scope selection and search using AND. */
export interface SessionFilters {
  status: ProgressFilter[];
  trapOperators: TrapOperator[];
  hasTrap: boolean | null;
  hasTable: boolean | null;
  hasFormula: boolean | null;
  timeTarget: TimeTarget[];
  minCorrect: number;
  minWrong: number;
}

export interface AnswerRecord {
  /** Empty string when the timer expired without a selection. */
  selected: OptionKey | '';
  correct: boolean;
  timeTakenSeconds: number;
  timedOut: boolean;
}

export type CellStatus = 'unseen' | 'current' | 'correct' | 'wrong' | 'skipped' | 'marked';

export type SessionMode = 'drill' | 'review-wrong' | 'review-due' | 'quest' | 'mock';

/** One persisted row per question ever attempted (IndexedDB store "questionState"). */
export interface QuestionState {
  questionId: string;
  subject: string;
  reading: string;
  topic: string;
  lo: string;
  loText: string;
  totalAttempts: number;
  totalCorrect: number;
  totalWrong: number;
  consecutiveCorrect: number;
  lastResult: 'correct' | 'wrong' | null;
  lastAttempted: string | null;
  lastSelected: OptionKey | '' | null;
  avgTimeSeconds: number;
  // SM-2 fields, updated on every answer (lib/srs.ts). dueDate is a local YYYY-MM-DD; null = never scheduled.
  interval: number;
  repetition: number;
  efactor: number;
  dueDate: string | null;
  markedForReview: boolean;
}

/** Append-only record of every answer (IndexedDB store "attempts"). */
export interface AttemptRecord {
  attemptId: string;
  questionId: string;
  timestamp: string;
  sessionId: string;
  selectedOption: OptionKey | '';
  correctOption: OptionKey;
  isCorrect: boolean;
  timeTakenSeconds: number;
  timedOut: boolean;
  mode: SessionMode;
}

/** Written once when a session finishes (IndexedDB store "sessions"). */
export interface SessionRecord {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  mode: SessionMode;
  scope: { kind: ScopeKind; keys: string[] };
  totalQuestions: number;
  answered: number;
  skipped: number;
  correct: number;
  wrong: number;
  accuracy: number;
  avgTimeSeconds: number;
}

/** One True/False statement derived from a question option (content/flashcards/<CODE>.json). */
export interface TFCard {
  id: string;
  sourceId: string;
  optionKey: OptionKey;
  subject: string;
  tier: string;
  topic: string;
  lo: string;
  loText: string;
  reading: string;
  statement: string;
  isTrue: boolean;
  explanation: string;
  edited: boolean;
  originalText?: string;
  /** On a false card: the same sentence with the few words changed that make it true. */
  correction?: string;
  changes?: { from: string; to: string }[];
  /** 'corrected' = a true twin derived from a false card by that minimal edit. */
  variant?: 'original' | 'corrected';
  /** The linked card (false original ↔ corrected twin). */
  twinId?: string;
}

/** Per-card progress (IndexedDB store "tfState"). */
export interface TFState {
  cardId: string;
  subject: string;
  topic: string;
  totalAttempts: number;
  totalCorrect: number;
  totalWrong: number;
  lastResult: 'correct' | 'wrong' | null;
  lastAttempted: string | null;
}

/** Append-only log of every True/False answer (IndexedDB store "tfAttempts"). */
export interface TFAttempt {
  attemptId: string;
  cardId: string;
  sessionId: string;
  timestamp: string;
  answeredTrue: boolean;
  isCorrect: boolean;
  timeTakenSeconds: number;
}

/** What a gym item is: a formula card (Formula Gym) or a scenario item (Sense Check). */
export type GymKind = 'formula' | 'scenario';

/**
 * Per-item progress and SM-2 schedule for the Formula Gym and its sibling games (IndexedDB store "gymState").
 * Formula items use the card id as `itemId`.
 */
export interface GymState {
  itemId: string;
  kind: GymKind;
  readingId: string;
  // SM-2 fields: one schedule per item, fed by every game.
  repetition: number;
  interval: number;
  efactor: number;
  /** Local YYYY-MM-DD; null until first answered. */
  dueDate: string | null;
  totalAttempts: number;
  totalCorrect: number;
  totalWrong: number;
  lastResult: 'correct' | 'wrong' | null;
  lastAttempted: string | null;
  /** Answers per game id. */
  gameCounts: Record<string, number>;
  /** Most recent game first, at most four; Workout rotates away from these. */
  recentGames: string[];
}

/** Append-only log of every gym answer (IndexedDB store "gymAttempts"). */
export interface GymAttempt {
  attemptId: string;
  itemId: string;
  kind: GymKind;
  game: string;
  correct: boolean;
  /** SM-2 quality, 0–5. */
  grade: number;
  timeTakenSeconds: number;
  sessionId: string;
  timestamp: string;
  /** Optional skill tag, for per-skill counts (e.g. Sense Check's measure). */
  measure?: string;
}
