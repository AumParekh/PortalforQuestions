import { create } from 'zustand';
import { compileExpr } from './expr';
import { normTex, skeletonSlots } from './latex';
import { READING_TITLES } from './readingTitles';
import type {
  AreaCode,
  CalcInput,
  Direction,
  Formula,
  FormulaCalc,
  FormulaCorruption,
  FormulaRepair,
  FormulaSensitivity,
  FormulaTwin,
  FormulaVariable,
  RepairCategory,
  WorkedLine,
} from './types';

export const FORMULAS_PATH = 'games/formulas.json';

export const AREAS: { code: AreaCode; name: string }[] = [
  { code: 'MR', name: 'Market Risk' },
  { code: 'CR', name: 'Credit Risk' },
  { code: 'IM', name: 'Investment Management' },
  { code: 'LTR', name: 'Liquidity and Treasury Risk' },
  { code: 'ORR', name: 'Operational Risk and Resilience' },
  { code: 'CI', name: 'Current Issues' },
];

const AREA_CODES = new Set<string>(AREAS.map((a) => a.code));

export function areaName(code: string): string {
  return AREAS.find((a) => a.code === code)?.name ?? code;
}

export function readingTitle(readingId: string): string | null {
  return READING_TITLES[readingId] ?? null;
}

/** Readings sort by area order, then number (MR-2 before MR-10). */
export function compareReadings(a: string, b: string): number {
  const [aa, an] = a.split('-');
  const [ba, bn] = b.split('-');
  const ai = AREAS.findIndex((x) => x.code === aa);
  const bi = AREAS.findIndex((x) => x.code === ba);
  if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  return (Number(an) || 0) - (Number(bn) || 0) || a.localeCompare(b);
}

// ---- Normalisation: every optional field may be missing or null ----

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => list(v).map(str).filter(Boolean);

function dedupe(values: string[], exclude: string[] = []): string[] {
  const seen = new Set(exclude.map(normTex));
  const out: string[] = [];
  for (const v of values) {
    const k = normTex(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

const CATEGORIES: RepairCategory[] = ['Sign', 'Formula', 'Sibling'];
const DIRECTIONS: Direction[] = ['up', 'down', 'none', 'depends'];

function repairOf(v: unknown): FormulaRepair | null {
  if (!isRec(v)) return null;
  const marked = str(v.marked);
  const bad = str(v.bad);
  const fix = str(v.fix);
  if (!marked.includes('{{bad}}') || !bad || !fix || normTex(bad) === normTex(fix)) return null;
  const category = CATEGORIES.find((c) => c.toLowerCase() === str(v.category).toLowerCase()) ?? 'Formula';
  return { marked, bad, fix, distractors: dedupe(strings(v.distractors), [fix]), category };
}

function calcOf(v: unknown): FormulaCalc | null {
  if (!isRec(v)) return null;
  const inputs: CalcInput[] = [];
  for (const i of list(v.inputs)) {
    if (!isRec(i)) return null;
    const name = str(i.name);
    const min = num(i.min);
    const max = num(i.max);
    const step = num(i.step);
    if (!name || min === null || max === null || max < min) return null;
    inputs.push({ name, symbol: str(i.symbol) || name, min, max, step: step !== null && step > 0 ? step : 0, unit: str(i.unit) });
  }
  const out = isRec(v.output) ? v.output : {};
  const decimals = num(out.decimals);
  const evaluate = compileExpr(str(v.expr), inputs.map((i) => i.name));
  if (!evaluate || inputs.length === 0) return null;
  let example: FormulaCalc['example'] = null;
  if (isRec(v.example)) {
    const ex = v.example;
    const values: Record<string, number> = {};
    // Inputs as a { name: value } map, or as [{ name, value }].
    if (isRec(ex.inputs)) for (const [k, n] of Object.entries(ex.inputs)) if (num(n) !== null) values[k] = n as number;
    for (const e of list(ex.inputs)) if (isRec(e) && str(e.name) && num(e.value) !== null) values[str(e.name)] = e.value as number;
    const output = num(ex.output);
    if (output !== null && inputs.every((i) => values[i.name] !== undefined)) example = { inputs: values, output };
  }
  return {
    expr: str(v.expr),
    inputs,
    output: {
      symbol: str(out.symbol),
      unit: str(out.unit),
      decimals: decimals !== null ? Math.min(8, Math.max(0, Math.round(decimals))) : 2,
    },
    example,
    evaluate,
  };
}

function formulaOf(v: unknown): Formula | null {
  if (!isRec(v)) return null;
  const id = str(v.id);
  const latex = str(v.latex);
  if (!id || !latex) return null;
  // "MR-11-F01" → "MR-11" when reading_id is missing.
  const readingId = str(v.reading_id) || id.split('-').slice(0, 2).join('-');
  const area = readingId.split('-')[0];
  if (!AREA_CODES.has(area)) return null;

  const variables: FormulaVariable[] = [];
  for (const x of list(v.variables)) {
    if (!isRec(x)) continue;
    const symbol = str(x.symbol);
    const meaning = str(x.meaning);
    if (symbol && meaning && !variables.some((o) => normTex(o.symbol) === normTex(symbol))) variables.push({ symbol, meaning });
  }

  // A skeleton is only usable when its slots are exactly 1..n and there is one answer per slot.
  let skeleton = str(v.skeleton);
  let slots = strings(v.slots);
  const used = skeletonSlots(skeleton);
  const exact = used.length === slots.length && used.length > 0 && [...used].sort((a, b) => a - b).every((n, i) => n === i + 1);
  if (!exact) {
    skeleton = '';
    slots = [];
  }

  const corruptions: FormulaCorruption[] = [];
  for (const c of list(v.corruptions)) {
    if (!isRec(c)) continue;
    const cl = str(c.latex);
    if (!cl || normTex(cl) === normTex(latex) || corruptions.some((o) => normTex(o.latex) === normTex(cl))) continue;
    corruptions.push({ latex: cl, kind: str(c.kind), why: str(c.why), repair: repairOf(c.repair) });
  }

  const sensitivities: FormulaSensitivity[] = [];
  for (const s of list(v.sensitivities)) {
    if (!isRec(s)) continue;
    const variable = str(s.variable);
    const direction = DIRECTIONS.find((d) => d === str(s.direction).toLowerCase());
    if (variable && direction) sensitivities.push({ variable, direction, why: str(s.why) });
  }

  const worked: WorkedLine[] = [];
  for (const w of list(v.worked)) {
    if (!isRec(w)) continue;
    const display = str(w.display);
    const value = num(w.value);
    if (display && value !== null) worked.push({ display, value, source: str(w.source) || undefined });
  }

  return {
    id,
    readingId,
    area: area as AreaCode,
    sourceFile: str(v.source_file),
    sourceLine: num(v.source_line),
    objective: str(v.objective) || null,
    name: str(v.name) || id,
    prompt: str(v.prompt),
    latex,
    variables,
    skeleton,
    slots,
    decoys: dedupe(strings(v.decoys), slots),
    corruptions,
    sensitivities,
    intuition: str(v.intuition),
    calc: calcOf(v.calc),
    worked,
    tags: strings(v.tags),
  };
}

export interface ParsedDeck {
  formulas: Formula[];
  twins: FormulaTwin[];
}

/** Normalises formulas.json; bad cards are dropped, never fatal. */
export function parseDeck(data: unknown): ParsedDeck {
  const d = isRec(data) ? data : {};
  const raw = Array.isArray(data) ? data : list(d.formulas);
  const formulas: Formula[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const f = formulaOf(r);
    if (f && !ids.has(f.id)) {
      ids.add(f.id);
      formulas.push(f);
    }
  }
  formulas.sort((a, b) => compareReadings(a.readingId, b.readingId) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const twins: FormulaTwin[] = [];
  const pairKeys = new Set<string>();
  for (const t of list(d.twins)) {
    if (!isRec(t)) continue;
    const a = str(t.a);
    const b = str(t.b);
    const key = [a, b].sort().join('|');
    if (!ids.has(a) || !ids.has(b) || a === b || pairKeys.has(key)) continue;
    pairKeys.add(key);
    twins.push({ a, b, why: str(t.why) });
  }
  return { formulas, twins };
}

// ---- Store ----

interface DeckStore {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  formulas: Formula[];
  byId: Record<string, Formula>;
  twins: FormulaTwin[];
  /** Twin pairs each formula belongs to. */
  twinsOf: Record<string, FormulaTwin[]>;
  load: () => Promise<void>;
}

export const useFormulaDeck = create<DeckStore>((set, get) => ({
  status: 'idle',
  error: null,
  formulas: [],
  byId: {},
  twins: [],
  twinsOf: {},

  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null });
    try {
      // The manifest says whether the deck exists yet; a missing file is an empty deck, not an error.
      const manifest: string[] = await fetch('/content/manifest.json').then((r) => {
        if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
        return r.json();
      });
      let parsed: ParsedDeck = { formulas: [], twins: [] };
      if (Array.isArray(manifest) && manifest.includes(FORMULAS_PATH)) {
        const r = await fetch(`/content/${FORMULAS_PATH}`);
        if (!r.ok) throw new Error(`${FORMULAS_PATH}: HTTP ${r.status}`);
        parsed = parseDeck(await r.json());
      }
      const byId: Record<string, Formula> = {};
      for (const f of parsed.formulas) byId[f.id] = f;
      const twinsOf: Record<string, FormulaTwin[]> = {};
      for (const t of parsed.twins) {
        (twinsOf[t.a] ??= []).push(t);
        (twinsOf[t.b] ??= []).push(t);
      }
      set({ status: 'ready', formulas: parsed.formulas, byId, twins: parsed.twins, twinsOf });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
