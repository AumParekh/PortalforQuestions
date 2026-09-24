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
}

export interface AnswerRecord {
  /** Empty string when the timer expired without a selection. */
  selected: OptionKey | '';
  correct: boolean;
  timeTakenSeconds: number;
  timedOut: boolean;
}

export type CellStatus = 'unseen' | 'current' | 'correct' | 'wrong' | 'skipped' | 'marked';
