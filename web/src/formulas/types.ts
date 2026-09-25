// Formula Gym deck types. The raw file (content/games/formulas.json) uses snake_case and may omit
// optional fields; deck.ts normalises it into these shapes once, so games never re-check the data.

export type AreaCode = 'MR' | 'CR' | 'IM' | 'LTR' | 'ORR' | 'CI';

export type FormulaGame =
  | 'recall'
  | 'forge'
  | 'rigged'
  | 'spot'
  | 'whichway'
  | 'symbols'
  | 'calc'
  | 'twins'
  | 'memory'
  | 'repair'
  | 'auction';

export type Direction = 'up' | 'down' | 'none' | 'depends';

export type RepairCategory = 'Sign' | 'Formula' | 'Sibling';

export interface FormulaVariable {
  /** LaTeX. */
  symbol: string;
  meaning: string;
}

/** One broken element of a corruption, for Formula Repair. `marked` holds `{{bad}}` where the wrong element sits. */
export interface FormulaRepair {
  marked: string;
  bad: string;
  fix: string;
  distractors: string[];
  category: RepairCategory;
}

export interface FormulaCorruption {
  latex: string;
  kind: string;
  why: string;
  repair: FormulaRepair | null;
}

export interface FormulaSensitivity {
  /** LaTeX symbol. */
  variable: string;
  direction: Direction;
  why: string;
}

export interface CalcInput {
  name: string;
  /** LaTeX. */
  symbol: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export interface FormulaCalc {
  expr: string;
  inputs: CalcInput[];
  output: { symbol: string; unit: string; decimals: number };
  example: { inputs: Record<string, number>; output: number } | null;
  /** Compiled once from `expr` after a whitelist check (see expr.ts). */
  evaluate: (values: Record<string, number>) => number;
}

/** A worked number from the notes or the question bank, e.g. "100 × 0.068 ÷ 0.084 = 80.95 $M". */
export interface WorkedLine {
  display: string;
  value: number;
  source?: string;
}

export interface Formula {
  id: string;
  readingId: string;
  area: AreaCode;
  sourceFile: string;
  sourceLine: number | null;
  objective: string | null;
  name: string;
  prompt: string;
  latex: string;
  variables: FormulaVariable[];
  /** LaTeX with {{1}}, {{2}}… slots; empty when the card has no Forge data. */
  skeleton: string;
  slots: string[];
  decoys: string[];
  corruptions: FormulaCorruption[];
  sensitivities: FormulaSensitivity[];
  intuition: string;
  calc: FormulaCalc | null;
  worked: WorkedLine[];
  tags: string[];
}

export interface FormulaTwin {
  a: string;
  b: string;
  why: string;
}
