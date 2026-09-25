// Stepwise Derivation (brief §7.4): pure round building. A worked example (exbox) from the reading
// is laid out line by line with steps held back. At each gap three moves are offered: the notes'
// next step, and two wrong moves that are themselves lines from the notes —
//   · "ahead": a later step of the same example that needs a number the working has not produced
//     yet (the Intermediate-result / Sequence trap: the right line at the wrong time);
//   · "other": a step from another worked example in the same reading (else the same area) that
//     works with numbers this example never gives, or names an operation this example never does.
// Picking any move shows where it leads (its own line in the notes, with its block ID). Nothing is
// generated or recomputed: every line is a slice of the notes' LaTeX.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { Block, ItemSrs, Reading, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { toDisplay } from '../../text';
import { srsPriority } from '../../srs';
import { seededRng, shuffle } from '../../random';
import type { Move, NumberHit, Part } from './parse';
import {
  isCommonNumber,
  mathRows,
  numberKeys,
  numbersIn,
  parseMoves,
  partNumbers,
  relationSplit,
  splitProblem,
  unseenNumbers,
} from './parse';

export type Shape = 'label' | 'equation';
export type ChoiceKind = 'true' | 'ahead' | 'other';

export interface Example {
  blockId: string;
  readingId: string;
  objectiveId?: string;
  /** Example title as the notes give it, "Example —" lifted (LaTeX); null when untitled. */
  title: string | null;
  /** The section the example sits in (the concept, for naming). */
  section: string | null;
  /** What the player is given. */
  prompt: Part[];
  moves: Move[];
}

export interface Choice {
  kind: ChoiceKind;
  shape: Shape;
  /** label: the operation (text LaTeX); equation: the setup (math TeX). */
  op: string;
  /** Where the move leads: the notes' own lines for it. */
  leadsTo: Part[];
  blockId: string;
  /** Title of the example it comes from (LaTeX), for feedback. */
  title: string | null;
  /** Its step number in that example. */
  n: number;
  /** ahead: a number this line needs that the working has not produced yet, as written. */
  needs?: string;
  /** other: a number in it that this example never gives, as written. */
  foreign?: string;
}

export interface StepPayload {
  example: Example;
  /** Index into example.moves of the step held back. */
  blank: number;
  shape: Shape;
  /** Three moves in play order. */
  options: Choice[];
  /** Index of the notes' move in `options`. */
  answer: number;
  /** Last gap of this example in this phase. */
  last: boolean;
  /** After the last gap, the rest of the example is revealed (it does not continue in a later phase). */
  tail: boolean;
}

export const MIN_ROUNDS = 6;
export const MAX_ROUNDS = 10;
export const MIN_PHASE = 3;
export const MAX_PHASE = 5;
/** Rounds taken from one example before another example is brought in. */
export const PER_EXAMPLE = 4;
export const MAX_LABEL_CHARS = 160;
export const MAX_OP_TEX = 260;

// ---------------------------------------------------------------------------------------------
// Examples

type ExboxFields = Block & { question_latex?: unknown; solution_latex?: unknown; body_latex?: unknown };

/** Lifts "Example —", "Example 2:", "Question 1 —" from a title; null when nothing else is left. */
export function cleanTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const t = title
    .replace(/^\s*(?:worked\s+)?(?:example|examples|question)\s*\d*\s*(?:continued)?\s*(?:—|–|---|--|:|\.)?\s*/i, '')
    .trim();
  if (!t || /^(?:example|examples|none)$/i.test(t)) return null;
  return t;
}

function strOrNull(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x : null;
}

const exampleCache = new WeakMap<Block, Example | null>();

/** A worked example's prompt and moves; null when the block has nothing to blank or is malformed. */
export function exampleOf(block: Block, readingId: string, objectiveId?: string): Example | null {
  if (exampleCache.has(block)) return exampleCache.get(block) ?? null;
  let ex: Example | null = null;
  try {
    const b = block as ExboxFields;
    if (b && b.type === 'exbox' && typeof b.id === 'string') {
      let q = strOrNull(b.question_latex);
      let s = strOrNull(b.solution_latex);
      if (!q && !s) {
        const body = strOrNull(b.body_latex);
        if (body) [q, s] = body.includes('\\tcblower') ? (body.split('\\tcblower', 2) as [string, string]) : [body, null];
      }
      const { prompt, working } = splitProblem(q, s);
      const moves = parseMoves(working);
      for (const m of moves) {
        // Options must fit a phone: very long setups stay in the working but are never blanked.
        if (m.kind === 'label' && m.label && toDisplay(m.label).length > MAX_LABEL_CHARS) m.blankable = false;
        if (m.kind === 'equation' && m.op && m.op.length > MAX_OP_TEX) m.blankable = false;
      }
      if (moves.some((m) => m.blankable)) {
        ex = {
          blockId: b.id,
          readingId,
          objectiveId,
          title: cleanTitle(b.title),
          section: strOrNull(b.section),
          prompt,
          moves,
        };
      }
    }
  } catch {
    ex = null;
  }
  exampleCache.set(block, ex);
  return ex;
}

const readingCache = new WeakMap<Reading, Example[]>();

export function readingExamples(reading: Reading): Example[] {
  const hit = readingCache.get(reading);
  if (hit) return hit;
  const out: Example[] = [];
  for (const o of reading.objectives ?? []) {
    for (const b of o.blocks ?? []) {
      if (!b || b.type !== 'exbox') continue;
      const ex = exampleOf(b, reading.reading_id, o.id);
      if (ex) out.push(ex);
    }
  }
  readingCache.set(reading, out);
  return out;
}

export function itemIdOf(ex: Example, m: Move): string {
  return `${ex.blockId}.step.${m.n}`;
}

// ---------------------------------------------------------------------------------------------
// What a move needs and produces

function key(v: number): string {
  return String(Number(v.toPrecision(10)));
}

/** Inline math snippets in text LaTeX. */
function inlineMath(latex: string): string[] {
  return (latex.match(/(?<!\\)\$[^$]+\$/g) ?? []).map((x) => x.slice(1, -1));
}

interface IO {
  inputs: NumberHit[];
  outputs: Set<string>;
}

const ioCache = new WeakMap<Move, IO>();

/** Numbers a move works from (left of its last '=') and numbers it produces (right of it, tables, prose). */
export function ioOf(m: Move): IO {
  const hit = ioCache.get(m);
  if (hit) return hit;
  const inputs: NumberHit[] = [];
  const outputs = new Set<string>();
  const addOut = (s: string) => {
    for (const n of numbersIn(s)) for (const k of numberKeys(n.value)) outputs.add(k);
  };
  const eq = (row: string) => {
    const { parts } = relationSplit(row);
    if (parts.length < 2) {
      inputs.push(...numbersIn(row));
      return;
    }
    for (const p of parts.slice(0, -1)) inputs.push(...numbersIn(p));
    addOut(parts[parts.length - 1]);
  };
  if (m.kind === 'equation' && m.op && m.result) {
    inputs.push(...numbersIn(m.op));
    addOut(m.result);
  } else {
    for (const p of m.body) {
      if (p.kind === 'math') mathRows(p).forEach(eq);
      else if (p.kind === 'text') {
        inlineMath(p.latex).forEach(eq);
        addOut(p.latex.replace(/(?<!\\)\$[^$]+\$/g, ' '));
      } else if (p.kind === 'list') for (const it of p.items) inlineMath(it).forEach(eq);
      else for (const row of [...p.head, ...p.body]) for (const c of row) addOut(c.latex);
    }
  }
  const io = { inputs, outputs };
  ioCache.set(m, io);
  return io;
}

/** Number keys the player has seen by the time the gap at `b` opens. */
export function availableAt(ex: Example, b: number): Set<string> {
  const seen: Part[] = [...ex.prompt];
  if (ex.title) seen.push({ kind: 'text', latex: ex.title });
  for (let i = 0; i < b; i++) {
    const m = ex.moves[i];
    seen.push(...m.lead, ...m.body);
    if (m.labelFull) seen.push({ kind: 'text', latex: m.labelFull });
  }
  seen.push(...ex.moves[b].lead);
  return partNumbers(seen);
}

/** A quantity name from an equation's left-hand side ("\mathrm{EL}_A" → "el"); null if it is not a name. */
export function quantityKey(lhs: string): string | null {
  let t = lhs;
  for (let k = 0; k < 3; k++) t = t.replace(/\\(?:mathrm|text|textrm|operatorname|mathit|mathbf|bar|hat|tilde|overline)\{([^{}]*)\}/g, '$1');
  t = t
    .replace(/_\{[^{}]*\}|_\\?[A-Za-z0-9]+/g, '')
    .replace(/\^\{[^{}]*\}|\^[A-Za-z0-9]/g, '')
    .replace(/\\(?:left|right|bigl|bigr|Bigl|Bigr)/g, '')
    .replace(/\([^()]*\)/g, '')
    .replace(/\\[,;!:]|[{}\s]/g, '')
    .toLowerCase();
  if (!t || t.length > 24 || !/^[a-z\\]+$/.test(t)) return null;
  return t;
}

const keyCache = new WeakMap<Move, Set<string>>();

/** Quantities a move computes (left-hand sides of its lines). */
export function quantityKeys(m: Move): Set<string> {
  const hit = keyCache.get(m);
  if (hit) return hit;
  const out = new Set<string>();
  const add = (row: string) => {
    const { parts } = relationSplit(row);
    if (parts.length < 2) return;
    const k = quantityKey(parts[0]);
    if (k) out.add(k);
  };
  if (m.op) add(`${m.op}=0`);
  for (const p of m.body) {
    if (p.kind === 'math') mathRows(p).forEach(add);
    else if (p.kind === 'text') inlineMath(p.latex).forEach(add);
  }
  keyCache.set(m, out);
  return out;
}

const LABEL_STOP = new Set([
  'the', 'and', 'for', 'each', 'both', 'with', 'from', 'step', 'compute', 'calculate', 'apply', 'value', 'into', 'then',
  'this', 'that', 'its', 'per', 'all', 'get', 'take', 'set', 'total', 'find', 'use', 'work', 'out', 'over', 'two', 'one',
]);

export function labelWords(label: string): Set<string> {
  return new Set((toDisplay(label).toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !LABEL_STOP.has(w)));
}

function tooSimilar(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both) >= 0.5;
}

/** Comparison form of an operation: spacing macros and whitespace dropped. */
export function normOp(s: string): string {
  return s
    .replace(/\\(?:[,;:!]|q?quad|left|right|bigl|bigr|Bigl|Bigr)/g, '')
    .replace(/\{,\}/g, ',')
    .replace(/\s+/g, '')
    .replace(/[.:]+$/, '')
    .toLowerCase();
}

function shapeOf(m: Move): Shape | null {
  return m.blankable && (m.kind === 'label' || m.kind === 'equation') ? m.kind : null;
}

function opOf(m: Move): string {
  return (m.kind === 'label' ? m.label : m.op) ?? '';
}

function choiceOf(ex: Example, m: Move, kind: ChoiceKind, extra: Partial<Choice> = {}): Choice {
  return {
    kind,
    shape: m.kind === 'label' ? 'label' : 'equation',
    op: opOf(m),
    leadsTo: m.body,
    blockId: ex.blockId,
    title: ex.title,
    n: m.n,
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------
// Distractors

export interface Pool {
  ahead: Choice[];
  /** Wrong moves from other examples, nearest tier first (same reading, then same area). */
  other: Choice[][];
}

/**
 * Every honest wrong move for the gap at `b`: later steps of the same example that cannot be done
 * yet, and steps of other examples that are wrong here. `others` are tiers (same reading, then
 * same area).
 */
export function distractorPool(ex: Example, b: number, others: readonly (readonly Example[])[]): Pool {
  const m = ex.moves[b];
  const shape = shapeOf(m);
  if (!shape) return { ahead: [], other: [] };
  const avail = availableAt(ex, b);
  const trueOp = normOp(opOf(m));
  const ownOps = new Set(ex.moves.filter((x) => x.blankable).map((x) => normOp(opOf(x))));
  const ahead: Choice[] = [];
  for (let j = b + 1; j < ex.moves.length; j++) {
    const later = ex.moves[j];
    if (shapeOf(later) !== shape || normOp(opOf(later)) === trueOp) continue;
    const produced = new Set<string>();
    for (let k = b; k < j; k++) for (const x of ioOf(ex.moves[k]).outputs) produced.add(x);
    const dep = ioOf(later).inputs.find((h) => !isCommonNumber(h.value) && produced.has(key(h.value)) && !avail.has(key(h.value)));
    if (dep) ahead.push(choiceOf(ex, later, 'ahead', { needs: dep.raw }));
  }
  const other: Choice[][] = [];
  const seen = new Set<string>([...ownOps]);
  const trueNums = new Set(numbersIn(opOf(m)).map((h) => key(h.value)));
  const ownKeys = new Set<string>();
  const ownWords: Set<string>[] = [];
  if (shape === 'label') {
    for (const x of ex.moves) {
      for (const k of quantityKeys(x)) ownKeys.add(k);
      if (x.label) ownWords.push(labelWords(x.label));
    }
  }
  for (const tier of others) {
    const found: Choice[] = [];
    for (const o of tier) {
      if (o.blockId === ex.blockId) continue;
      for (const om of o.moves) {
        if (shapeOf(om) !== shape) continue;
        const op = opOf(om);
        const k = normOp(op);
        if (!k || seen.has(k)) continue;
        if (shape === 'equation') {
          const foreign = unseenNumbers(op, avail).filter((raw) => !trueNums.has(key(Number(raw.replace(/,/g, '')))));
          if (!foreign.length) continue;
          seen.add(k);
          found.push(choiceOf(o, om, 'other', { foreign: foreign[0] }));
        } else {
          // A label only names an operation, so it must be one this example never does.
          if ([...quantityKeys(om)].some((q) => ownKeys.has(q))) continue;
          const words = labelWords(op);
          if (ownWords.some((w) => tooSimilar(w, words))) continue;
          seen.add(k);
          found.push(choiceOf(o, om, 'other'));
        }
      }
    }
    other.push(found);
  }
  return { ahead, other };
}

export function poolSize(p: Pool): number {
  return p.ahead.length + p.other.reduce((n, t) => n + t.length, 0);
}

/** Two distractors: at most one "ahead", the rest from the nearest tier, near the true move in length. */
export function pickDistractors(p: Pool, trueOp: string, rng: () => number): Choice[] {
  const len = (c: Choice) => (c.shape === 'label' ? toDisplay(c.op).length : c.op.length);
  const target = Math.max(1, trueOp.length);
  const closeness = (c: Choice) => Math.min(4, Math.floor((Math.abs(len(c) - target) / target) * 4));
  const out: Choice[] = [];
  const ahead = shuffle(p.ahead, rng).sort((a, b) => closeness(a) - closeness(b));
  if (ahead.length) out.push(ahead[0]);
  // A second "ahead" only when no other example can supply a wrong move.
  for (const tier of [...p.other, ahead.slice(1)]) {
    if (out.length >= 2) break;
    const ranked = shuffle(tier, rng).sort((a, b) => closeness(a) - closeness(b));
    // Prefer a source block not already used.
    ranked.sort((a, b) => Number(out.some((x) => x.blockId === a.blockId)) - Number(out.some((x) => x.blockId === b.blockId)));
    for (const c of ranked) {
      if (out.length >= 2) break;
      if (!out.some((x) => normOp(x.op) === normOp(c.op))) out.push(c);
    }
  }
  return out.length === 2 ? out : [];
}

// ---------------------------------------------------------------------------------------------
// Plan

export interface BuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
  priorityCategory: TrapCategory | null;
}

interface Candidate {
  ex: Example;
  blank: number;
  itemId: string;
  pool: Pool;
}

function areaExamples(reading: Reading, corpus: Corpus): Example[] {
  const out: Example[] = [];
  for (const r of corpus.readingsByArea[reading.area] ?? []) if (r.reading_id !== reading.reading_id) out.push(...readingExamples(r));
  return out;
}

/** Every gap in the reading that has two honest wrong moves, grouped by example in move order. */
export function readingCandidates(reading: Reading, corpus: Corpus): Candidate[][] {
  const own = readingExamples(reading);
  if (!own.length) return [];
  let area: Example[] | null = null;
  const groups: Candidate[][] = [];
  for (const ex of own) {
    const group: Candidate[] = [];
    ex.moves.forEach((m, b) => {
      if (!m.blankable) return;
      let pool = distractorPool(ex, b, [own]);
      if (poolSize(pool) < 2) {
        area ??= areaExamples(reading, corpus);
        pool = distractorPool(ex, b, [own, area]);
      }
      if (poolSize(pool) >= 2) group.push({ ex, blank: b, itemId: itemIdOf(ex, m), pool });
    });
    if (group.length) groups.push(group);
  }
  return groups;
}

export function categoryOf(shape: Shape, hasAhead: boolean): TrapCategory {
  if (!hasAhead) return 'Formula';
  return shape === 'equation' ? 'Intermediate result' : 'Sequence';
}

/** Comfortable time to read three moves and choose (ms). */
export function timeFor(options: readonly Choice[], pressureStep: number | null): number {
  const chars = options.reduce((n, c) => n + (c.shape === 'label' ? toDisplay(c.op).length : Math.round(c.op.length * 0.6)), 0);
  const base = Math.min(40000, Math.max(15000, 12000 + chars * 70));
  if (pressureStep === null) return Math.round(base * 1.5);
  return Math.max(15000, Math.round(base * Math.pow(0.94, pressureStep)));
}

/** Chosen gaps, in play order, split into discovery and pressure. */
function selectGaps(groups: Candidate[][], ctx: BuildInput): { discovery: Candidate[][]; pressure: Candidate[][] } | null {
  const prio = (c: Candidate) => srsPriority(ctx.srs[c.itemId], ctx.today);
  const wantsAhead = ctx.priorityCategory === 'Intermediate result' || ctx.priorityCategory === 'Sequence';
  const score = (g: Candidate[]) => Math.min(...g.map(prio)) * 2 + (wantsAhead && g.some((c) => c.pool.ahead.length) ? 0 : 1);
  const ordered = shuffle(groups, ctx.rng)
    .map((g, i) => ({ g, i }))
    .sort((a, b) => score(a.g) - score(b.g) || a.i - b.i)
    .map((x) => x.g);

  const take = (g: Candidate[], cap: number): Candidate[] => {
    if (g.length <= cap) return [...g];
    const byPrio = shuffle(g, ctx.rng)
      .map((c, i) => ({ c, i }))
      .sort((a, b) => prio(a.c) - prio(b.c) || a.i - b.i)
      .slice(0, cap)
      .map((x) => x.c);
    return g.filter((c) => byPrio.includes(c));
  };
  const chosen: Candidate[][] = [];
  let total = 0;
  for (const g of ordered) {
    if (total >= 8) break;
    const part = take(g, Math.min(PER_EXAMPLE, MAX_ROUNDS - total));
    chosen.push(part);
    total += part.length;
  }
  // Too few gaps at one-example-in-four: let chosen examples give more.
  for (let i = 0; i < chosen.length && total < MIN_ROUNDS; i++) {
    const g = ordered[i];
    const more = g.filter((c) => !chosen[i].includes(c)).slice(0, MAX_ROUNDS - total);
    chosen[i] = g.filter((c) => chosen[i].includes(c) || more.includes(c));
    total += more.length;
  }
  if (total < MIN_ROUNDS) return null;
  if (total > MAX_ROUNDS) return null;

  // Split at an example boundary when one gives both phases 3–5 gaps; else inside an example.
  const cum: number[] = [];
  chosen.reduce((n, g) => (cum.push(n + g.length), n + g.length), 0);
  const fits = (d: number) => d >= MIN_PHASE && d <= MAX_PHASE && total - d >= MIN_PHASE && total - d <= MAX_PHASE;
  const boundary = cum
    .map((d, j) => ({ d, j }))
    .filter((x) => fits(x.d))
    .sort((a, b) => Math.abs(a.d - total / 2) - Math.abs(b.d - total / 2))[0];
  if (boundary) return { discovery: chosen.slice(0, boundary.j + 1), pressure: chosen.slice(boundary.j + 1) };
  const d = Math.min(MAX_PHASE, Math.max(MIN_PHASE, Math.floor(total / 2)));
  if (!fits(d)) return null;
  const flat = chosen.flat();
  const regroup = (xs: Candidate[]) => {
    const out: Candidate[][] = [];
    for (const c of xs) {
      const last = out[out.length - 1];
      if (last && last[0].ex === c.ex) last.push(c);
      else out.push([c]);
    }
    return out;
  };
  return { discovery: regroup(flat.slice(0, d)), pressure: regroup(flat.slice(d)) };
}

function toRounds(groups: Candidate[][], phase: 'discovery' | 'pressure', continues: ReadonlySet<Example>, ctx: BuildInput, stepFrom: number): MechanicRound<StepPayload>[] {
  const rounds: MechanicRound<StepPayload>[] = [];
  let step = stepFrom;
  for (const g of groups) {
    g.forEach((c, i) => {
      const m = c.ex.moves[c.blank];
      const shape = shapeOf(m) as Shape;
      const truth = choiceOf(c.ex, m, 'true');
      const wrong = pickDistractors(c.pool, truth.op, ctx.rng);
      const options = shuffle([truth, ...wrong], ctx.rng);
      const last = i === g.length - 1;
      const limit = phase === 'pressure' ? timeFor(options, step) : undefined;
      rounds.push({
        id: `${c.itemId}#${phase}`,
        phase,
        itemId: c.itemId,
        blockId: c.ex.blockId,
        objectiveId: c.ex.objectiveId ?? ctx.corpus.objectiveOfBlock[c.ex.blockId],
        category: categoryOf(shape, wrong.some((w) => w.kind === 'ahead')),
        timeLimitMs: limit,
        targetMs: limit ?? timeFor(options, null),
        payload: {
          example: c.ex,
          blank: c.blank,
          shape,
          options,
          answer: options.indexOf(truth),
          last,
          tail: last && !continues.has(c.ex),
        },
      });
      step++;
    });
  }
  return rounds;
}

const GENERIC_SECTION = /^(?:worked examples?|examples?|practice|exercises?|questions?|summary|remember|key (?:facts|points))$/i;

/** Plain text of an example's title, for lines of feedback and naming. */
export function titleText(ex: Example): string {
  return ex.title ? toDisplay(ex.title) : `Worked example ${ex.blockId}`;
}

/** Just-in-time naming (§8.3): the concept the example works, its block, its LO, and the notes' order of moves. */
export function namingFor(ex: Example, reading: Reading, corpus: Corpus): ConceptNaming {
  const section = ex.section ? toDisplay(ex.section) : '';
  const term = section && !GENERIC_SECTION.test(section) ? section : titleText(ex);
  const labels = ex.moves.filter((m) => m.kind === 'label' && m.label).map((m) => toDisplay(m.label as string));
  const lines = ex.moves.filter((m) => m.kind === 'equation').length;
  const line =
    labels.length >= 2
      ? `${titleText(ex)}, in the notes' order: ${labels.join(' → ')}.`
      : `${titleText(ex)}: ${lines} calculated lines, each one built from the numbers the line before it produced.`;
  const los = learningObjectives(reading);
  const objectiveId = ex.objectiveId ?? corpus.objectiveOfBlock[ex.blockId] ?? los[los.length - 1]?.id ?? reading.reading_id;
  return { term, blockId: ex.blockId, objectiveId, line };
}

export function buildStepwise(reading: Reading, ctx: BuildInput): MechanicPlan<StepPayload> | null {
  const groups = readingCandidates(reading, ctx.corpus);
  if (!groups.length) return null;
  const split = selectGaps(groups, ctx);
  if (!split) return null;
  const inPressure = new Set(split.pressure.flat().map((c) => c.ex));
  const discovery = toRounds(split.discovery, 'discovery', inPressure, ctx, 0);
  const pressure = toRounds(split.pressure, 'pressure', new Set(), ctx, 0);
  const rounds = [...discovery, ...pressure];
  if (rounds.some((r) => r.payload.options.length !== 3 || r.payload.answer < 0)) return null;
  const examples = new Set(rounds.map((r) => r.payload.example));
  const first = rounds[0].payload.example;
  const concept = namingFor(first, reading, ctx.corpus);
  const n = examples.size;
  return {
    rounds,
    target: concept.term,
    opening: `${reading.reading_id} · Stepwise Derivation. ${n === 1 ? 'A worked example' : `${n} worked examples`} from this reading, with lines held back. At each gap three moves are on the table and only one is the notes' next step. Choose one and see where it leads.`,
    concept,
  };
}

const supportCache = new WeakMap<Reading, boolean>();

/** True only when the reading's worked examples give a full arc (3–5 gaps per phase, two wrong moves each). */
export function supportsStepwise(reading: Reading, corpus: Corpus): boolean {
  const hit = supportCache.get(reading);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    ok = buildStepwise(reading, { corpus, srs: {}, today: '1970-01-01', rng: seededRng(1), priorityCategory: null }) !== null;
  } catch {
    ok = false;
  }
  supportCache.set(reading, ok);
  return ok;
}

/** Names the example where discovery went worst (most misses), else the first one played. */
export function nameAfterDiscovery(
  plan: MechanicPlan<StepPayload>,
  discovery: readonly RoundResult[],
  reading: Reading,
  corpus: Corpus,
): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const misses = new Map<Example, number>();
  for (const d of discovery) {
    const r = byId.get(d.roundId);
    if (r && !d.correct) misses.set(r.payload.example, (misses.get(r.payload.example) ?? 0) + 1);
  }
  const worst = [...misses.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return worst ? namingFor(worst, reading, corpus) : plan.concept;
}
