// Order Game (brief §7.2, drilling the Sequence trap category): pure round building. Each round is
// one sequence from the reading, shuffled; the player puts it back in the notes' order. Sources,
// all used only where the notes make the order meaningful:
//   · lists (enumerate / itemize / lettered) introduced as steps, stages, a procedure, a cycle or
//     "in this order", or whose items carry their own ordinals (Firstly … Finally);
//   · worked examples (exbox) with numbered Step 1, Step 2, … labels;
//   · table rows keyed by Step / Stage / Phase, rows a caption says are ordered, and year-keyed
//     timelines of events;
//   · TikZ diagrams whose nodes are numbered steps, stages, phases, tiers or levels.
// Nothing is generated: every step shown is the notes' own text, with only its give-away ordinal
// ("Firstly,", "Step 2 —", "3.") lifted off while playing; the original text returns in feedback.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { Block, ItemSrs, Reading, TableRow, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { contentTitle, latexTextToPlain, splitMath, toDisplay } from '../../text';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';

export type SequenceSource = 'list' | 'exbox' | 'table' | 'tikz' | 'chain';
export type SequenceKind = 'process' | 'derivation' | 'ranking' | 'timeline' | 'hierarchy' | 'cycle';

export interface OrderStep {
  /** Stable key within the sequence (sub-item ID when the notes give one). */
  key: string;
  /** What the player arranges: the step with any give-away ordinal lifted off (LaTeX/plain). */
  text: string;
  /** The step exactly as the notes give it, shown in feedback. */
  original: string;
  /** A marker the notes attach (a year, "Stage 2", "Tier 1"), revealed in feedback only. */
  marker?: string;
}

export interface OrderSequence {
  /** Stable SRS item ID: the block ID, or the first step's sub-item ID when a block holds several sequences. */
  id: string;
  blockId: string;
  objectiveId?: string;
  source: SequenceSource;
  kind: SequenceKind;
  /** What is being ordered, in the notes' words (lead-in, caption, example title). No answer in it. */
  prompt: string;
  /** Optional extra context (a worked example's question). */
  context?: string;
  /** Concept name for §8.3. */
  concept: string;
  /** Steps in the notes' order. */
  steps: OrderStep[];
  /** A closed loop: the first step is pinned so the order has one reading. */
  anchored?: boolean;
  /** The whole sentence a text chain came from, shown in feedback. */
  note?: string;
  /** Distinguishes several sequences drawn from one block (first node / sub-item). */
  chainHead?: string;
}

/**
 * arrange — the whole sequence arrives shuffled; put it back.
 * restore — the sequence arrives in order except one step, which has been moved (the Sequence
 *           trap: the right steps in the wrong order); find it and put it back.
 */
export type RoundMode = 'arrange' | 'restore';

export interface OrderPayload {
  seq: OrderSequence;
  mode: RoundMode;
  /** Starting arrangement: indices into seq.steps, never the identity. */
  start: number[];
  /** restore: the index (in seq.steps) of the step that was moved. */
  displaced?: number;
}

export const MIN_STEPS = 3;
export const MAX_STEPS = 7;
/** Longest single step (display characters) and whole sequence we are willing to put on a phone screen. */
export const MAX_STEP_CHARS = 360;
export const MAX_SEQ_CHARS = 1500;
export const MIN_ROUNDS = 6;
export const MAX_ROUNDS = 10;
/** A full arc needs at least two sequences and enough steps that restore rounds do not repeat a set to death. */
export const MIN_SEQUENCES = 2;
export const MIN_TOTAL_STEPS = 7;

// ---------------------------------------------------------------------------------------------
// Order signals

/** Context that says the list is an ordered sequence. */
const ORDER_CONTEXT =
  /\b(?:steps?|stages?|phases?|sequence|sequential(?:ly)?|chronolog\w*|timeline|life[- ]?cycle|procedure|algorithm|workflow|step[- ]by[- ]step|progression|in (?:this|that|the following) order|runs? in (?:this )?order|in order|cycle (?:involves|runs|consists|comprises|has|goes|works))\b/i;
/** Extra words that count in a block title (short, deliberate). */
const TITLE_CONTEXT = /\b(?:process|procedure|chain|cycle|sequence|order|steps?|stages?|phases?)\b/i;
/** "can be applied in any order" and friends: the notes say the order does not matter. */
const NO_ORDER = /\b(?:any|no particular|no specific|arbitrary|no fixed)\s+order\b|\bnot (?:necessarily )?(?:sequential|in (?:any|a fixed) order)\b|\bin no (?:particular )?order\b/i;
/** Lists of things that happen to be numbered but are not steps. */
const NOT_A_SEQUENCE_TITLE = /learning objectives|advantages|disadvantages|benefits|limitations|drawbacks|examples?\b|properties|trap|summary|remember|pros|cons|challenges|features|characteristics/i;
/** "include(s)" lists are inventories, not sequences, unless the lead-in names steps / stages / order. */
const INVENTORY = /\binclud(?:e|es|ed|ing)\b|\bsuch as\b|\bamong (?:them|others)\b/i;
const STRONG_ORDER = /\b(?:steps?|stages?|phases?|in (?:this|that|the following) order|runs? in (?:this )?order|sequence|chronolog\w*)\b/i;

/** Ordinal lead-ins on a step ("Firstly, …", "The third stage involves …", "Finally, …"). */
const ORDINAL_WORD = '(?:first|second|third|fourth|fifth|sixth|seventh|final|last|next)';
const ITEM_ORDINAL = new RegExp(
  `^\\s*(?:(?:firstly|secondly|thirdly|fourthly|fifthly|finally|lastly|first|second|third|fourth|fifth|then|next|subsequently|afterwards?)(?:[,:]\\s*|\\s+)` +
    `|(?:in|at|during) the ${ORDINAL_WORD} (?:step|stage|phase)(?: of [^,]{1,40})?,\\s*` +
    `|the ${ORDINAL_WORD} (?:step|stage|phase)(?: of [^,]{1,40})? (?:involves|is|requires|consists of|comprises)\\s*` +
    `|the ${ORDINAL_WORD} (?:step|stage|phase)(?: of [^,]{1,40})?\\s*[:—–-]+\\s*` +
    `|(?:step|stage|phase)\\s+\\d+[a-z]?\\s*(?:[:.)—–-]+|---|--)?\\s*)`,
  'i',
);
/** Enumerators a list or table cell carries: "1.", "2)", "(3)", "a)", "iv.", "2a)". */
const ENUMERATOR = /^\s*(?:\(?\d{1,2}[a-z]?[.)]|\(?[a-h][.)](?=\s)|\(?(?:i|ii|iii|iv|v|vi|vii|viii)[.)](?=\s))\s*/i;

/** Fields the extractor emits that the shared Block type does not declare. */
type BlockExtras = Block & { lead_in?: unknown; node_text?: unknown; mcq?: unknown };

function cleanSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function capitalise(s: string): string {
  const m = /^(\s*)([a-z])/.exec(s);
  return m ? s.slice(0, m[1].length) + m[2].toUpperCase() + s.slice(m[1].length + 1) : s;
}

/** Lifts a give-away ordinal / enumerator off the front of a step. */
export function stripOrdinal(s: string): string {
  // A leading bold enumerator or step label ("\textbf{a)} policy rate", "\textbf{Step 2:}") is unwrapped first.
  let t = cleanSpaces(s).replace(/^\\textbf\{\s*([^{}]{1,24}?)\s*\}\s*/, (m, inner: string) =>
    ENUMERATOR.test(`${inner} `) || /^(?:step|stage|phase)\s*\d/i.test(inner) ? `${inner} ` : m,
  );
  for (let n = 0; n < 2; n++) {
    const next = t.replace(ITEM_ORDINAL, '').replace(ENUMERATOR, '');
    if (next === t) break;
    t = next;
  }
  return capitalise(t.trim());
}

export function hasOrdinalLead(s: string): boolean {
  return ITEM_ORDINAL.test(cleanSpaces(s));
}

/** Length of the text a player reads (math kept compact). */
function displayLength(s: string): number {
  return toDisplay(s).length;
}

/** Normalised comparison key: two steps that read the same make the order ambiguous. */
function stepKey(s: string): string {
  return toDisplay(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function wordCount(s: string): number {
  return toDisplay(s).split(/\s+/).filter(Boolean).length;
}

/**
 * Lifting "First line:" / "Second line:" leaves the same bare label on every step: the ordinal was
 * the name, so there is nothing left to order by content.
 */
export function labelResidue(steps: readonly OrderStep[]): boolean {
  const heads = steps.map((s) => /^([A-Za-z]+)\s*:/.exec(toDisplay(s.text))?.[1]?.toLowerCase()).filter((x): x is string => !!x);
  return heads.length >= 2 && new Set(heads).size < heads.length;
}

/** A sequence is playable only when every step is non-empty, distinct and phone-sized. */
export function playableSteps(steps: readonly OrderStep[]): boolean {
  if (steps.length < MIN_STEPS || steps.length > MAX_STEPS) return false;
  const keys = new Set<string>();
  let total = 0;
  for (const s of steps) {
    const k = stepKey(s.text);
    if (!k || keys.has(k) || wordCount(s.text) < 2) return false;
    const len = displayLength(s.text);
    if (len > MAX_STEP_CHARS) return false;
    total += len;
    keys.add(k);
  }
  return total <= MAX_SEQ_CHARS;
}

// ---------------------------------------------------------------------------------------------
// Lists inside a block's LaTeX

const LIST_ENVS = new Set(['enumerate', 'itemize', 'lettered', 'checks']);

export interface ParsedList {
  env: string;
  /** Number of top-level \item entries. */
  items: number;
  /** LaTeX between the previous top-level list (or the block start) and this list. */
  before: string;
}

/** Top-level lists in document order, with their top-level item counts (nested lists are part of their parent item). */
export function parseLists(latex: string): ParsedList[] {
  const re = /\\begin\{(\w+)\}|\\end\{(\w+)\}|\\item\b/g;
  const stack: { env: string; list: ParsedList | null }[] = [];
  const out: ParsedList[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latex))) {
    if (m[1]) {
      const env = m[1];
      const inList = stack.some((s) => LIST_ENVS.has(s.env));
      if (LIST_ENVS.has(env) && !inList) {
        const list: ParsedList = { env, items: 0, before: latex.slice(lastEnd, m.index) };
        out.push(list);
        stack.push({ env, list });
      } else stack.push({ env, list: null });
    } else if (m[2]) {
      const top = stack.pop();
      if (top?.list) lastEnd = m.index + m[0].length;
    } else {
      const lists = stack.filter((s) => LIST_ENVS.has(s.env));
      if (lists.length === 1 && lists[0].list) lists[0].list.items++;
    }
  }
  return out;
}

/** The last sentence of the LaTeX before a list — its local lead-in. */
export function lastSentence(latex: string): string {
  const plain = toDisplay(latex.replace(/\\(?:small|footnotesize|normalsize|par|medskip|smallskip|bigskip|noindent)\b/g, ' '));
  if (!plain) return '';
  const parts = plain.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return cleanSpaces(parts[parts.length - 1] ?? '');
}

interface Bullet {
  id?: string;
  text: string;
  depth: number;
}

function bulletsOf(b: Block): Bullet[] {
  const out: Bullet[] = [];
  for (const x of b.bullets ?? []) {
    if (!x) continue;
    if (typeof x === 'string') {
      if (x.trim()) out.push({ text: x, depth: 1 });
      continue;
    }
    const text = x.text ?? x.plain_text ?? '';
    const depth = typeof (x as { depth?: unknown }).depth === 'number' ? (x as { depth: number }).depth : 1;
    if (typeof text === 'string' && text.trim()) out.push({ id: x.id, text, depth });
  }
  return out;
}

const LIST_BLOCK_TYPES = new Set(['prose_para', 'keybox', 'defbox', 'gapbox', 'notebox', 'exbox', 'fmlbox']);

function sectionName(b: Block): string {
  return b.section ? cleanSpaces(toDisplay(b.section).replace(ENUMERATOR, '')) : '';
}

function titleOf(b: Block): string {
  const title = contentTitle(b.title);
  return title ? cleanSpaces(toDisplay(title)) : '';
}

/** A concept name: a non-generic block title, else the section heading, else the lead-in itself. */
function conceptFor(b: Block, lead: string): string {
  const title = titleOf(b).replace(/^(?:worked )?example\s*\d*\s*[—–:-]+\s*/i, '');
  if (title && !NOT_A_SEQUENCE_TITLE.test(title) && !/^examples?$/i.test(title)) return title;
  const sec = sectionName(b);
  if (sec) return sec;
  const fromLead = lead
    .replace(/\s*(?:are|is)?\s*(?:as follows)?\s*[:.]\s*$/i, '')
    .replace(/\s+(?:involves|includes?|consists of|comprises|entails)\s*$/i, '')
    .trim();
  // A long caption sentence is a reading of the figure, not a name; the objective names it instead.
  return fromLead.length <= 90 && !/\bthis (?:objective|reading|figure|diagram|table)\b/i.test(fromLead) ? fromLead : '';
}

function kindFromContext(ctx: string): SequenceKind {
  if (/\bchronolog|timeline|history|evolution\b/i.test(ctx)) return 'timeline';
  if (/\btiers?|levels?|hierarch|ladder|seniority\b/i.test(ctx)) return 'hierarchy';
  return 'process';
}

/** Ordered lists in one block. */
export function listSequences(b: Block): Omit<OrderSequence, 'id' | 'objectiveId'>[] {
  if (!LIST_BLOCK_TYPES.has(b.type)) return [];
  if ((b as BlockExtras).mcq) return [];
  const title = titleOf(b);
  if (NOT_A_SEQUENCE_TITLE.test(title)) return [];
  const latex = typeof b.body_latex === 'string' ? b.body_latex : '';
  const top = bulletsOf(b).filter((x) => x.depth === 1);
  const lists = parseLists(latex);
  if (!lists.length || lists.reduce((n, l) => n + l.items, 0) !== top.length) return [];
  const rawLead = (b as BlockExtras).lead_in;
  const leadIn = typeof rawLead === 'string' ? cleanSpaces(rawLead) : '';
  const out: Omit<OrderSequence, 'id' | 'objectiveId'>[] = [];
  let i = 0;
  lists.forEach((l, li) => {
    const items = top.slice(i, i + l.items);
    i += l.items;
    if (items.length < MIN_STEPS || items.length > MAX_STEPS) return;
    const local = lastSentence(l.before);
    // Only the sentence that introduces the list counts ("Last step. … Three scenarios are included:" is an inventory).
    const lead = (li === 0 && leadIn ? lastSentence(leadIn) || leadIn : local) || '';
    const context = `${lead} ${title}`;
    if (NO_ORDER.test(context) || NO_ORDER.test(l.before)) return;
    const ordinals = items.filter((x) => hasOrdinalLead(x.text)).length;
    const itemsOrdered = ordinals >= Math.max(2, Math.ceil(items.length / 2)) && hasOrdinalLead(items[0].text);
    const leadOrdered = ORDER_CONTEXT.test(lead) && (!INVENTORY.test(lead) || STRONG_ORDER.test(lead));
    const titleOrdered = !!title && TITLE_CONTEXT.test(title) && !INVENTORY.test(lead);
    if (!(itemsOrdered || leadOrdered || titleOrdered)) return;
    // Exbox lists are usually answer options; only a lead-in that names steps makes them a sequence.
    if (b.type === 'exbox' && !(leadOrdered || itemsOrdered)) return;
    const steps: OrderStep[] = items.map((x, k) => ({
      key: x.id ?? `${b.id}#${li}.${k + 1}`,
      text: stripOrdinal(x.text),
      original: cleanSpaces(x.text),
    }));
    if (!playableSteps(steps) || labelResidue(steps)) return;
    const prompt = lead || title || sectionName(b);
    if (!prompt) return;
    out.push({
      blockId: b.id,
      source: 'list',
      kind: kindFromContext(`${lead} ${title}`),
      prompt,
      concept: conceptFor(b, lead),
      steps,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Worked examples: numbered Step labels

interface ExStep {
  n?: unknown;
  label?: unknown;
  text?: unknown;
}

/**
 * Step labels from an exbox: its `steps` field when present, else "Step N — label." in the solution.
 * `work` is the step's own working (the notes' text under the label), used to check the order is forced.
 */
export function exboxStepLabels(b: Block): { n: number; label: string; work: string }[] {
  const fromField: { n: number; label: string; work: string }[] = [];
  if (Array.isArray(b.steps)) {
    b.steps.forEach((s, k) => {
      const st = (s ?? {}) as ExStep;
      const label = typeof st.label === 'string' ? st.label : '';
      const n = typeof st.n === 'number' ? st.n : k + 1;
      fromField.push({ n, label, work: typeof st.text === 'string' ? st.text : '' });
    });
    if (fromField.length) return fromField;
  }
  const src = typeof b.solution_latex === 'string' && b.solution_latex ? b.solution_latex : typeof b.body_latex === 'string' ? b.body_latex : '';
  const re = /(?:\\textbf\{\s*)?Step\s+(\d+)\s*(?:\}\s*)?(?:---|--|[—–:.])?\s*(?:\}\s*)?([^\n]*)/g;
  const out: { n: number; label: string; work: string }[] = [];
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // The label runs to the first display math or the end of the sentence.
    let label = m[2].split(/\$\$|\\\[|\\begin\{/)[0];
    const stop = /\.(?:\s|$)/.exec(label);
    if (stop) label = label.slice(0, stop.index + 1);
    starts.push(m.index);
    out.push({ n: Number(m[1]), label: `Step ${m[1]} ${label}`, work: '' });
  }
  // Each step's working runs to the next Step label.
  out.forEach((o, k) => (o.work = src.slice(starts[k], starts[k + 1] ?? src.length)));
  return out;
}

/** Numbers in LaTeX working, thousands separators removed. */
function numbersIn(s: string): number[] {
  const t = s.replace(/\{,\}/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1');
  return (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * The values a step's working arrives at: every right-hand side of an "=" that is plain numbers, no
 * arithmetic ("= 0.0565", "= \mathbf{\$360 million}", "= 23.77\%"), a percentage also read as a decimal.
 * Single-digit integers are too common to trace and are left out.
 */
export function stepResults(work: string): number[] {
  const out: number[] = [];
  const parts = work.split('=');
  for (let k = 1; k < parts.length; k++) {
    const rhs = parts[k].split(/\\\\|&|\\qquad|\\quad|\n|\\text\{,/)[0];
    if (/\\times|×|\\cdot|\+|\\frac|\\tfrac|\\dfrac|\\sqrt|\/|\^/.test(rhs)) continue;
    const t = rhs.replace(/\{,\}/g, '').replace(/(\d),(?=\d{3}\b)/g, '$1');
    // A plain value, or a row of them ("= (0.0047 \;\; 0.0019)").
    for (const n of t.match(/\d+(?:\.\d+)?\s*(?:\\?%)?/g) ?? []) {
      const v = parseFloat(n);
      if (!(Number.isInteger(v) && v < 10)) out.push(v);
      if (/%/.test(n)) out.push(v / 100);
    }
  }
  return out;
}

/**
 * A worked example's order is forced only when every step works on the value the step before it
 * arrived at. Steps that each start from the question's own data (total the uses; total the sources;
 * the asset leg; the liability leg) can be done in either order, so the notes' order is one of several
 * right answers and the set is not playable.
 */
export function exboxOrderForced(works: readonly string[]): boolean {
  if (works.some((w) => !w.trim())) return false;
  for (let k = 1; k < works.length; k++) {
    const prev = stepResults(works[k - 1]);
    const here = numbersIn(works[k]);
    if (!prev.some((v) => here.some((x) => Math.abs(x - v) <= 1e-9 * Math.max(1, Math.abs(v))))) return false;
  }
  return true;
}

const INTERPRETIVE_STEP = /^(?:what (?:this|it) means|interpretation|interpret|check|answer|conclusion|so what|the point)\b/i;

/** Words outside math. */
function proseWords(s: string): number {
  return splitMath(s)
    .filter((x) => x.kind === 'text')
    .map((x) => (x.kind === 'text' ? latexTextToPlain(x.text) : ''))
    .join(' ')
    .split(/\s+/)
    .filter((w) => /\p{L}{2,}/u.test(w)).length;
}

export function exboxSequence(b: Block): Omit<OrderSequence, 'id' | 'objectiveId'> | null {
  if (b.type !== 'exbox') return null;
  const labels = exboxStepLabels(b);
  if (labels.length < MIN_STEPS) return null;
  // Numbered 1…n with no gaps or repeats, or the order is not the notes' order.
  if (!labels.every((l, k) => l.n === k + 1)) return null;
  let steps: OrderStep[] = labels.map((l) => {
    const original = cleanSpaces(l.label.replace(/^\\textbf\{([^{}]*)\}/, '$1'));
    const text = stripOrdinal(original).replace(/^[\s:.—–-]+/, '');
    return { key: `${b.id}.step.${l.n}`, text: capitalise(text.replace(/[\s:]+$/, '')), original, marker: `Step ${l.n}` };
  });
  // A closing "What this means" step is always last, so it orders nothing: drop trailing interpretation.
  while (steps.length && INTERPRETIVE_STEP.test(toDisplay(steps[steps.length - 1].text))) steps = steps.slice(0, -1);
  // Labels must be words, not an equation lifted out of an aligned block.
  if (steps.some((st) => /&|\\quad|\\frac/.test(st.text) || proseWords(st.text) < 1)) return null;
  if (!playableSteps(steps)) return null;
  // Only a calculation whose order is forced is a sequence (see exboxOrderForced).
  if (!exboxOrderForced(labels.slice(0, steps.length).map((l) => l.work))) return null;
  const title = titleOf(b);
  // A data table inside the question does not read as a sentence on the card: the question stays, the table goes.
  const question =
    typeof b.question_latex === 'string'
      ? cleanSpaces(
          b.question_latex
            .replace(/\\begin\{(tabularx?)\}[\s\S]*?\\end\{\1\}/g, ' ')
            .replace(/\\(?:smallskip|medskip|bigskip|centering|footnotesize|small|par|noindent)\b/g, ' '),
        )
      : '';
  return {
    blockId: b.id,
    source: 'exbox',
    kind: 'derivation',
    prompt: title || 'A worked example, step by step',
    context: question && displayLength(question) <= 900 ? question : undefined,
    concept: conceptFor(b, title),
    steps,
  };
}

// ---------------------------------------------------------------------------------------------
// Tables

const PROCESS_HEADER = /^(?:step|stage|phase)s?\b/i;
const PROCESS_CELL = /^\s*(?:step|stage|phase)\s*(\d+)\b/i;
const ORDERED_CAPTION =
  /\bin (?:increasing|decreasing|ascending|descending|chronological) order\b|\bordered (?:by|from)\b|\bin (?:the )?order of\b|\bprogression\b|\bladder\b|\bin sequence\b|\bchronolog\w*/i;
const YEAR_HEADER = /^(?:year|date|when)\b/i;

function firstSentence(s: string): string {
  const plain = cleanSpaces(toDisplay(s));
  const m = /^(.+?[.!?])(?:\s+[A-Z]|$)/.exec(plain);
  return m ? m[1] : plain;
}

function leadingNumber(cell: string): number | null {
  const m = /^\s*\(?(\d{1,2})[a-z]?[.)]?(?:\s|$)/i.exec(cell) ?? PROCESS_CELL.exec(cell);
  return m ? Number(m[1]) : null;
}

function isNumericCell(c: string): boolean {
  const t = toDisplay(c).replace(/[\s,$%€£()+\-−–—.:×x]|bp|bps|million|billion|m\b|bn\b/gi, '');
  return t.length === 0 || /^\d*$/.test(t);
}

function rowsOf(b: Block): TableRow[] {
  return (Array.isArray(b.rows) ? b.rows : []).filter(
    (r): r is TableRow => !!r && Array.isArray(r.cells) && r.cells.every((c) => typeof c === 'string'),
  );
}

export function tableSequence(b: Block): Omit<OrderSequence, 'id' | 'objectiveId'> | null {
  if (b.type !== 'table') return null;
  const rows = rowsOf(b).filter((r) => r.cells.some((c) => c.trim()));
  if (rows.length < MIN_STEPS || rows.length > MAX_STEPS) return null;
  const headers = (Array.isArray(b.headers) ? b.headers : rows[0]?.headers ?? []).filter((h): h is string => typeof h === 'string');
  const h0 = toDisplay(headers[0] ?? '');
  const caption = typeof b.caption === 'string' ? b.caption : '';
  const title = titleOf(b);
  const firsts = rows.map((r) => r.cells[0] ?? '');
  const rowKey = (r: TableRow, k: number) => r.id ?? `${b.id}.row.${k + 1}`;

  // Step / Stage / Phase tables: numbered rows, numbers strictly increasing.
  const processRows = firsts.filter((c) => PROCESS_CELL.test(c) || /^\s*\d{1,2}[a-z]?[.)]?(?:\s|$)/.test(c)).length;
  if (PROCESS_HEADER.test(h0) || firsts.filter((c) => PROCESS_CELL.test(c)).length >= MIN_STEPS) {
    if (processRows !== rows.length) return null;
    const nums = firsts.map(leadingNumber);
    if (nums.some((n) => n === null)) return null;
    for (let k = 1; k < nums.length; k++) if ((nums[k] as number) <= (nums[k - 1] as number)) return null;
    const steps: OrderStep[] = rows.map((r, k) => {
      const first = stripOrdinal(r.cells[0] ?? '');
      const useFirst = wordCount(first) >= 2;
      const text = useFirst ? first : cleanSpaces(r.cells[1] ?? '');
      const original = useFirst ? cleanSpaces(r.cells[0]) : `${cleanSpaces(r.cells[0])} — ${cleanSpaces(r.cells[1] ?? '')}`;
      return { key: rowKey(r, k), text, original, marker: `${h0 && !/^\d/.test(h0) ? h0.replace(/s$/i, '') : 'Step'} ${nums[k]}` };
    });
    if (!playableSteps(steps)) return null;
    const prompt = caption ? firstSentence(caption) : title || sectionName(b) || `The ${h0.toLowerCase() || 'step'}s, in order`;
    // A caption that calls the rows a ladder or tiers makes them rungs, not steps that feed one another.
    return { blockId: b.id, source: 'table', kind: kindFromContext(prompt), prompt, concept: conceptFor(b, prompt), steps };
  }

  // Rows the caption itself calls ordered (a progression, a ladder, "in increasing order of …").
  const capOrdered = ORDERED_CAPTION.test(caption) || ORDERED_CAPTION.test(title);
  if (capOrdered && !NO_ORDER.test(caption)) {
    const steps: OrderStep[] = rows.map((r, k) => {
      const first = stripOrdinal(r.cells[0] ?? '');
      return { key: rowKey(r, k), text: first, original: cleanSpaces(r.cells[0] ?? '') };
    });
    if (steps.some((s) => wordCount(s.text) < 1)) return null;
    // Single-word row names are fine here (they are the names being ranked).
    const keys = new Set(steps.map((s) => stepKey(s.text)));
    if (keys.size !== steps.length || [...keys].some((k) => !k)) return null;
    if (steps.some((s) => displayLength(s.text) > MAX_STEP_CHARS)) return null;
    const sentence = ORDERED_CAPTION.test(caption)
      ? (cleanSpaces(toDisplay(caption)).split(/(?<=[.!?])\s+/).find((x) => ORDERED_CAPTION.test(x)) ?? firstSentence(caption))
      : title;
    return {
      blockId: b.id,
      source: 'table',
      kind: /ladder|tier|level|senior/i.test(sentence) ? 'hierarchy' : 'ranking',
      prompt: sentence,
      concept: conceptFor(b, sentence),
      steps,
    };
  }

  // Timelines: year-keyed rows of events (text, not data), years strictly increasing.
  if (YEAR_HEADER.test(h0)) {
    const years = firsts.map((c) => {
      const m = /^\s*(1[89]\d\d|20\d\d)\b/.exec(toDisplay(c));
      return m ? Number(m[1]) : null;
    });
    if (years.some((y) => y === null)) return null;
    for (let k = 1; k < years.length; k++) if ((years[k] as number) <= (years[k - 1] as number)) return null;
    const steps: OrderStep[] = [];
    for (const [k, r] of rows.entries()) {
      const textCells = r.cells.slice(1).filter((c) => c.trim() && !isNumericCell(c));
      if (!textCells.length || wordCount(textCells[0]) < 3) return null;
      steps.push({ key: rowKey(r, k), text: cleanSpaces(textCells[0]), original: cleanSpaces(textCells[0]), marker: toDisplay(r.cells[0]) });
    }
    if (!playableSteps(steps)) return null;
    const prompt = caption ? firstSentence(caption) : title || sectionName(b) || 'These events, in the order they happened';
    return { blockId: b.id, source: 'table', kind: 'timeline', prompt, concept: conceptFor(b, prompt), steps };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// TikZ diagrams with numbered nodes

const TIKZ_MARKED = /^\s*(step|stage|phase|tier|level)\s+(\d+)\s*[:.—–-]?\s*(.+)$/i;
const TIKZ_NUMBERED = /^\s*(\d{1,2})[.)]\s+(.+)$/;
const TIKZ_PROCESS_CAPTION = /\b(?:process|steps?|stages?|phases?|cycle|loop|pipeline|sequence|procedure|workflow)\b/i;

/**
 * A caption sentence about the page rather than the content ("that is the whole content of this
 * objective", "redrawn from the notes' hand-written working", "the loop on the left") does not say what
 * is being ordered, and on a card with no figure it points at nothing.
 */
const META_CAPTION = /\bthis (?:objective|reading|figure|diagram|chart|extract)\b|\bon the (?:left|right)\b|\bredrawn\b|\bhand-?written\b/i;

/** The caption's first sentence as a prompt, or the figure's title / section when that sentence is about the page. */
function captionPrompt(b: Block, caption: string): string {
  const first = caption ? firstSentence(caption) : '';
  return first && !META_CAPTION.test(first) ? first : titleOf(b) || sectionName(b);
}

export function tikzSequence(b: Block): Omit<OrderSequence, 'id' | 'objectiveId'> | null {
  if (b.type !== 'tikzpicture') return null;
  const rawNodes = (b as BlockExtras).node_text;
  const nodes = (Array.isArray(rawNodes) ? (rawNodes as unknown[]) : []).filter((x): x is string => typeof x === 'string');
  const caption = typeof b.caption === 'string' ? b.caption : '';
  const title = titleOf(b);
  type Hit = { n: number; word: string; text: string; original: string };
  let hits: Hit[] = [];
  for (const node of nodes) {
    const m = TIKZ_MARKED.exec(node);
    if (m) hits.push({ n: Number(m[2]), word: m[1], text: m[3], original: node });
  }
  if (hits.length < MIN_STEPS && TIKZ_PROCESS_CAPTION.test(`${caption} ${title}`)) {
    hits = [];
    for (const node of nodes) {
      const m = TIKZ_NUMBERED.exec(node);
      // A node that packs several numbered entries is a list inside one box, not a step.
      if (m && !/\s\d{1,2}[.)]\s/.test(m[2])) hits.push({ n: Number(m[1]), word: '', text: m[2], original: node });
    }
  }
  if (hits.length < MIN_STEPS || hits.length > MAX_STEPS) return null;
  const nums = hits.map((h) => h.n);
  if (new Set(nums).size !== nums.length) return null;
  const words = new Set(hits.map((h) => h.word.toLowerCase()));
  if (words.size !== 1) return null;
  const word = [...words][0];
  const sorted = [...hits].sort((a, c) => a.n - c.n);
  const steps: OrderStep[] = sorted.map((h) => ({
    key: `${b.id}.node.${h.n}`,
    text: capitalise(cleanSpaces(h.text)),
    original: cleanSpaces(h.original),
    marker: word ? `${capitalise(word)} ${h.n}` : `${h.n}`,
  }));
  if (!playableSteps(steps)) return null;
  const prompt = caption ? captionPrompt(b, caption) : title;
  if (!prompt && !caption) return null;
  const kind: SequenceKind = word === 'tier' || word === 'level' ? 'hierarchy' : 'process';
  return { blockId: b.id, source: 'tikz', kind, prompt, concept: conceptFor(b, prompt), steps };
}

// ---------------------------------------------------------------------------------------------
// TikZ flowcharts: chains of nodes joined by straight arrows

/** The caption has to say the diagram is read in order: a chain, loop, process, sequence, phases … */
const CHAIN_CAPTION =
  /\b(?:sequence|in sequence|loop|chains?|transmission|spiral|steps?|stages?|phases?|process|pipeline|waterfall|cycle|circuit|episodes?|sits between|timeline|evolution|in order|runs from|feeds? (?:back|into)|once)\b/i;

/** Content of a balanced {…} group starting at `open` (the index of "{"). */
function braced(src: string, open: number): { body: string; end: number } | null {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { body: src.slice(open + 1, j), end: j + 1 };
    }
  }
  return null;
}

/** Node text → LaTeX the NoteText renderer can show: line breaks, colours and font switches removed. */
export function tikzNodeLatex(s: string): string {
  let t = s;
  t = t.replace(/\\\\(?:\[[^\]]*\])?/g, ' ');
  t = t.replace(/\\textcolor\{[^{}]*\}/g, '').replace(/\\color\{[^{}]*\}/g, '');
  t = t.replace(/\\(?:scriptsize|footnotesize|small|tiny|normalsize|large|sffamily|bfseries|itshape|rmfamily|ttfamily|centering|strut|hfill|par)\b\s*/g, '');
  t = t.replace(/\\textbullet\b/g, '·').replace(/\\(?:quad|qquad)\b/g, ' ').replace(/\\ /g, ' ');
  t = t.replace(/\{\s*\}/g, '');
  return cleanSpaces(t);
}

function arrowStyles(src: string): Map<string, string> {
  const styles = new Map<string, string>();
  const re = /([A-Za-z][\w ]*)\/\.style\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const g = braced(src, m.index + m[0].length - 1);
    if (g) styles.set(m[1].trim(), g.body);
  }
  return styles;
}

/** Whether draw options give a one-way arrow (directly or through a named style). */
function isOneWayArrow(opts: string, styles: Map<string, string>): boolean {
  let o = opts;
  for (const part of opts.split(',')) {
    const s = styles.get(part.trim());
    if (s) o += `,${s}`;
  }
  const twoWay = /<->|\{?\s*(?:Stealth|Latex|latex|stealth)(?:\[[^\]]*\])?\s*\}?\s*-\s*\{?\s*(?:Stealth|Latex|latex|stealth)|(?:^|,)\s*<-/.test(o);
  if (twoWay) return false;
  return /(?:^|[,\s])-(?:>|\{?\s*(?:Stealth|stealth|Latex|latex|Triangle|To)\b|latex|stealth)/.test(o);
}

interface TikzGraph {
  nodes: Map<string, string>;
  /** First option of each node ("st", "ph", …): a head drawn in a different style is a column header. */
  styles: Map<string, string>;
  order: string[];
  edges: [string, string][];
}

export function parseTikzGraph(src: string): TikzGraph {
  const styles = arrowStyles(src);
  const nodes = new Map<string, string>();
  const nodeStyles = new Map<string, string>();
  const order: string[] = [];
  const nodeRe = /\\node\s*(\[(?:[^[\]]|\[[^\]]*\])*\])?\s*\((\w+)\)\s*(?:at\s*\([^)]*\)\s*)?\{/g;
  let m: RegExpExecArray | null;
  while ((m = nodeRe.exec(src))) {
    const g = braced(src, m.index + m[0].length - 1);
    const name = m[2];
    if (g && !nodes.has(name)) {
      nodes.set(name, g.body);
      nodeStyles.set(name, (m[1] ?? '').replace(/^\[|\]$/g, '').split(',')[0].trim());
      order.push(name);
    }
  }
  const edges: [string, string][] = [];
  // \foreach \a/\b in {x/y, …} \draw[opts] (\a) -- (\b);
  const forRe = /\\foreach\s*\\(\w+)\s*\/\s*\\(\w+)\s*in\s*\{([^{}]*)\}\s*\\draw\s*(\[(?:[^[\]]|\[[^\]]*\])*\])?\s*\(\\(\w+)(?:\.[\w ]+)?\)\s*--\s*\(\\(\w+)(?:\.[\w ]+)?\)\s*;/g;
  while ((m = forRe.exec(src))) {
    const [, v1, v2, pairs, opts, from, to] = m;
    if (!isOneWayArrow((opts ?? '').replace(/^\[|\]$/g, ''), styles)) continue;
    if (!((from === v1 && to === v2) || (from === v2 && to === v1))) continue;
    for (const p of pairs.split(',')) {
      const [a, b] = p.split('/').map((x) => x.trim());
      if (!a || !b) continue;
      edges.push(from === v1 ? [a, b] : [b, a]);
    }
  }
  // \draw[opts] (a) -- (b);  Only straight two-point arrows: routed ones (|-, -|, ++) are feedback or annotation.
  // An end written as a calc coordinate on a bare anchor, "($(a.south)$)", is the same node.
  const drawRe = /\\draw\s*(\[(?:[^[\]]|\[[^\]]*\])*\])?\s*\((?:\$\()?(\w+)(?:\.[\w ]+)?(?:\)\$)?\)\s*--\s*\((?:\$\()?(\w+)(?:\.[\w ]+)?(?:\)\$)?\)\s*;/g;
  while ((m = drawRe.exec(src))) {
    const [, opts, a, b] = m;
    if (!nodes.has(a) || !nodes.has(b)) continue;
    if (!isOneWayArrow((opts ?? '').replace(/^\[|\]$/g, ''), styles)) continue;
    edges.push([a, b]);
  }
  return { nodes, styles: nodeStyles, order, edges };
}

/** Simple chains (and closed loops) of ≥3 nodes in a directed graph, in declaration order. */
export function graphChains(g: TikzGraph): { names: string[]; cycle: boolean }[] {
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  for (const n of g.order) {
    out.set(n, new Set());
    inn.set(n, new Set());
  }
  for (const [a, b] of g.edges) {
    if (a === b || !out.has(a) || !out.has(b)) continue;
    out.get(a)!.add(b);
    inn.get(b)!.add(a);
  }
  const one = (s: Set<string>) => (s.size === 1 ? [...s][0] : null);
  const used = new Set<string>();
  const res: { names: string[]; cycle: boolean }[] = [];
  for (const s of g.order) {
    if (used.has(s) || out.get(s)!.size !== 1) continue;
    const pred = one(inn.get(s)!);
    // Interior of a chain (single predecessor that itself has one successor): start further back.
    if (pred && out.get(pred)!.size === 1) continue;
    const chain = [s];
    let cur = s;
    for (;;) {
      const nx = one(out.get(cur)!);
      if (!nx || inn.get(nx)!.size !== 1 || chain.includes(nx)) break;
      chain.push(nx);
      cur = nx;
    }
    if (chain.length >= MIN_STEPS) {
      res.push({ names: chain, cycle: false });
      chain.forEach((n) => used.add(n));
    }
  }
  for (const s of g.order) {
    if (used.has(s) || out.get(s)!.size !== 1 || inn.get(s)!.size !== 1) continue;
    const chain = [s];
    let cur = s;
    let closed = false;
    for (;;) {
      const nx = one(out.get(cur)!);
      if (!nx) break;
      if (nx === s) {
        closed = true;
        break;
      }
      if (chain.includes(nx) || out.get(nx)!.size !== 1 || inn.get(nx)!.size !== 1) break;
      chain.push(nx);
      cur = nx;
    }
    if (closed && chain.length >= MIN_STEPS) {
      res.push({ names: chain, cycle: true });
      chain.forEach((n) => used.add(n));
    }
  }
  return res;
}

export function tikzChainSequences(b: Block): Omit<OrderSequence, 'id' | 'objectiveId'>[] {
  if (b.type !== 'tikzpicture' || typeof b.body_latex !== 'string') return [];
  const caption = typeof b.caption === 'string' ? b.caption : '';
  if (!CHAIN_CAPTION.test(caption) || NO_ORDER.test(caption)) return [];
  const g = parseTikzGraph(b.body_latex);
  const out: Omit<OrderSequence, 'id' | 'objectiveId'>[] = [];
  // Empty when the caption is about the page and the figure has no title or section: the objective fills it in.
  const prompt = captionPrompt(b, caption);
  // The section counts for the kind too ("How the framework evolved" is a chronology, not a process).
  const kindText = `${caption} ${titleOf(b)} ${sectionName(b)}`;
  for (const ch of graphChains(g)) {
    let names = ch.names;
    let header = '';
    // A head drawn in its own style above a column of same-style steps is the column's label
    // ("Phase 1 (1980 to mid-1980s)"), not a step: it becomes context.
    const st = (n: string) => g.styles.get(n) ?? '';
    if (!ch.cycle && names.length > MIN_STEPS && st(names[0]) !== st(names[1]) && st(names[1]) === st(names[2])) {
      header = tikzNodeLatex(g.nodes.get(names[0]) ?? '');
      names = names.slice(1);
    }
    if (names.length > MAX_STEPS) continue;
    const steps: OrderStep[] = names.map((n) => {
      const original = tikzNodeLatex(g.nodes.get(n) ?? '');
      return { key: `${b.id}.node.${n}`, text: stripOrdinal(original), original };
    });
    if (!playableSteps(steps)) continue;
    out.push({
      blockId: b.id,
      source: 'tikz',
      kind: ch.cycle ? 'cycle' : /phase|episode|timeline|evol(?:ution|ved)/i.test(kindText) ? 'timeline' : 'process',
      prompt,
      context: header || undefined,
      concept: conceptFor(b, prompt),
      steps,
      anchored: ch.cycle,
      chainHead: `${b.id}.node.${ch.names[0]}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Arrow chains written in the text: "Zero cost → pooled average → separate averages → …"

const ARROW_SPLIT = /\s*(?:→|⟶|\$\s*\\(?:to|rightarrow|longrightarrow)\s*\$|\\(?:to|rightarrow)\b)\s*/;
const CATEGORY_LEAD = /^(?:Polarity|Sibling|Role|Sign|Scope|Definition|Formula|Intermediate result|Sequence|Ordering|Calculation)\s*[.:]\s*/i;

export function arrowChainSequences(b: Block): Omit<OrderSequence, 'id' | 'objectiveId'>[] {
  if (b.type === 'tikzpicture' || b.type === 'table') return [];
  const sources: { key?: string; text: string }[] = [];
  const bullets = bulletsOf(b);
  if (bullets.length) for (const x of bullets) sources.push({ key: x.id, text: x.text });
  else if (typeof b.plain_text === 'string') sources.push({ text: b.plain_text });
  const out: Omit<OrderSequence, 'id' | 'objectiveId'>[] = [];
  for (const src of sources) {
    const sentences = src.text.split(/(?<=[.!?;])\s+|\n+/);
    for (const [j, sentence] of sentences.entries()) {
      const bare = sentence.replace(/^[•\-\s]+/, '');
      // The trap-summary label ("Sibling.") may head the sentence or stand as its own.
      const label = (CATEGORY_LEAD.exec(bare) ?? CATEGORY_LEAD.exec(`${(sentences[j - 1] ?? '').replace(/^[•\-\s]+/, '').trim()} `))?.[0] ?? '';
      const body = cleanSpaces(bare.replace(CATEGORY_LEAD, ''));
      const parts = body.split(ARROW_SPLIT).map((p) => p.replace(/[.;:,]+$/, '').trim());
      if (parts.length < MIN_STEPS || parts.length > MAX_STEPS || parts.some((p) => !p)) continue;
      const words = parts.map((p) => p.split(/\s+/).length);
      // Short links only; a long first link is a sentence that happens to start the chain.
      if (words.some((w) => w > 12) || words[0] > Math.max(...words.slice(1))) continue;
      const steps: OrderStep[] = parts.map((p, k) => ({ key: `${src.key ?? b.id}.link.${k + 1}`, text: capitalise(p), original: body }));
      const keys = new Set(steps.map((s) => stepKey(s.text)));
      if (keys.size !== steps.length) continue;
      const title = titleOf(b);
      // Empty when the block has no usable title or section: the objective's text fills it in later.
      let prompt = title && !NOT_A_SEQUENCE_TITLE.test(title) ? title : sectionName(b);
      if (!prompt && b.type === 'trapbox') {
        // A reading's consolidated trap summary sits under its last objective, so that objective does
        // not name the chain. The notes' own gloss right after the chain does ("One axis, increasing
        // granularity"); without one the chain has nothing honest to be called and is skipped.
        const gloss = cleanSpaces((sentences[j + 1] ?? '').replace(/[;:,.]+$/, ''));
        if (!gloss || CATEGORY_LEAD.test(`${gloss}.`) || wordCount(gloss) > 12 || promptRevealsOrder(gloss, steps) || stepKey(gloss).split(' ').some((w) => w.length >= 5 && steps.some((s) => stepKey(s.text).includes(w)))) continue;
        prompt = gloss;
      }
      out.push({
        blockId: b.id,
        source: 'chain',
        // Siblings on one axis ("Sibling. A → B → C") are a ranking, not steps that feed each other.
        kind: /^(?:sibling|ordering)\b/i.test(label) ? 'ranking' : 'process',
        prompt,
        concept: conceptFor(b, prompt),
        steps: steps.map((s) => ({ ...s, original: s.text })),
        note: body,
        chainHead: src.key,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Whole reading

/** A lead-in that names no concept ("The process involves three steps", "Steps involved"). */
const GENERIC_CONCEPT = /^(?:the\s+|it\s+)?(?:key\s+|core\s+)?(?:process|procedure|steps?|stages?|phases?)\b[\s,\w]{0,30}[:.]?$/i;

/**
 * A lead-in that says there are steps but not of what ("The key steps are:", "Steps involved:",
 * "It involves four control steps:"): on a card without the notes around it, the subject is missing.
 */
const PROMPT_FILLER = new Set(
  'the a an key core main process procedure step steps stage stages phase phases involves involved include includes consists consist of comprises are is as follows following in order two three four five six seven'.split(' '),
);
export function genericPrompt(prompt: string): boolean {
  const t = toDisplay(prompt).trim();
  if (/^(?:it|this|they|these)\s+(?:involves|includes|consists|comprises|has|have|runs|run)\b/i.test(t)) return true;
  const words = t.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  return words.length > 0 && words.every((w) => PROMPT_FILLER.has(w));
}

/** Two sentences run together: a full stop between them unless the first already ends in one. */
function joinSentences(a: string, b: string): string {
  const x = a.trim();
  return /[.!?:;]$/.test(x) ? `${x} ${b}` : `${x}. ${b}`;
}

/** Objective verbs ("Describe", "Define … and describe …"): an LO is an instruction, not a concept name. */
const LO_VERB =
  '(?:describe|define|explain|identify|calculate|compute|compare|contrast|distinguish|differentiate|discuss|evaluate|assess|apply|estimate|interpret|analy[sz]e|summari[sz]e|outline|understand|recogni[sz]e|list|examine|illustrate|determine|derive|demonstrate|construct|critique)';
const LO_LEAD = new RegExp(`^${LO_VERB}\\s+(?:(?:and|or)\\s+${LO_VERB}\\s+)?(?:how\\s+|what\\s+|why\\s+|the\\s+(?:concept|process|idea)\\s+of\\s+)?`, 'i');
const LO_TAIL = new RegExp(`(?:,\\s*|\\s+)(?:and|or)\\s+${LO_VERB}\\b.*$`, 'i');

/** "Define implied correlation and describe how it can be measured." → "Implied correlation". */
export function conceptFromObjective(text: string): string {
  const t = cleanSpaces(text).replace(/[.;:]+$/, '');
  const stripped = t.replace(LO_LEAD, '').replace(LO_TAIL, '').trim();
  return stripped.length >= 3 && stripped !== t ? capitalise(stripped) : t;
}

const STOP = new Set(
  'about above after again against among another because before being below between cannot could does doing during each either every first from further have having however into itself later might more most much must never other their there these they those through under until upon very were what when where which while whose will with within without would your'.split(
    ' ',
  ),
);

function contentWords(s: string): string[] {
  return toDisplay(s)
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 5 && !STOP.has(w));
}

/**
 * Whether a prompt names two or more of the steps by their distinctive words — a caption that walks
 * through the diagram ("the equity tranche receives the residual once the senior and mezzanine
 * claims are satisfied") gives the order away.
 */
export function promptRevealsOrder(prompt: string, steps: readonly OrderStep[]): boolean {
  const words = new Set(contentWords(prompt));
  const perStep = steps.map((s) => new Set(contentWords(s.text)));
  let named = 0;
  perStep.forEach((ws, i) => {
    const own = [...ws].filter((w) => perStep.every((o, j) => j === i || !o.has(w)));
    if (own.some((w) => words.has(w))) named++;
  });
  return named >= 2;
}

/** Every playable sequence in a reading, in reading order, with stable IDs. */
export function readingSequences(reading: Reading, corpus?: Corpus): OrderSequence[] {
  const out: OrderSequence[] = [];
  // Step keys are SRS item IDs for restore rounds: unique across the whole reading.
  const stepKeys = new Set<string>();
  for (const o of Array.isArray(reading.objectives) ? reading.objectives : []) {
    for (const b of Array.isArray(o.blocks) ? o.blocks : []) {
      if (!b || typeof b.id !== 'string' || typeof b.type !== 'string') continue;
      let found: Omit<OrderSequence, 'id' | 'objectiveId'>[] = [];
      try {
        const ex = exboxSequence(b);
        const tb = tableSequence(b);
        const tk = tikzSequence(b);
        found = ex ? [ex] : tb ? [tb] : tk ? [tk] : [...tikzChainSequences(b), ...listSequences(b), ...arrowChainSequences(b)];
      } catch {
        // Malformed content in one block never takes down the reading.
        found = [];
      }
      const objectiveId = corpus?.objectiveOfBlock[b.id] ?? o.id;
      const seen = new Set(out.map((s) => s.id));
      found.forEach((s) => {
        const steps = s.steps.map((st) => {
          let key = st.key;
          while (stepKeys.has(key)) key = `${key}#2`;
          stepKeys.add(key);
          return key === st.key ? st : { ...st, key };
        });
        // One sequence per block keys on the block; several key on their own sub-item (first bullet,
        // the bullet a chain is written in, or the diagram node the chain starts from).
        let id = found.length === 1 ? b.id : (s.chainHead ?? steps[0].key);
        while (seen.has(id)) id = `${id}#2`;
        seen.add(id);
        const loText = o.text ? conceptFromObjective(toDisplay(o.text)) : '';
        let concept = s.concept && !GENERIC_CONCEPT.test(s.concept) ? s.concept : loText || s.concept || s.prompt;
        // A name lifted from a caption that walks through the steps is itself a give-away.
        if (loText && promptRevealsOrder(concept, steps) && !promptRevealsOrder(loText, steps)) concept = loText;
        let prompt = s.prompt || loText || 'A chain from the notes';
        let note = s.note;
        // A prompt that walks through the steps gives the answer away: name the concept instead and
        // keep the notes' sentence for feedback.
        if (promptRevealsOrder(prompt, steps)) {
          note = note ? (note.includes(prompt) ? note : joinSentences(prompt, note)) : prompt;
          prompt = promptRevealsOrder(concept, steps) ? 'A sequence from the notes' : concept;
        } else if (genericPrompt(prompt) && concept && !genericPrompt(concept) && !promptRevealsOrder(concept, steps)) {
          // Name what the steps are of, ahead of the notes' own lead-in.
          prompt = joinSentences(concept, prompt);
        }
        out.push({ ...s, id, objectiveId, prompt, concept, steps, note });
      });
    }
  }
  return out;
}

const cache = new WeakMap<Reading, OrderSequence[]>();
function cachedSequences(reading: Reading, corpus?: Corpus): OrderSequence[] {
  let seqs = cache.get(reading);
  if (!seqs) {
    seqs = readingSequences(reading, corpus);
    cache.set(reading, seqs);
  }
  return seqs;
}

export interface ArcCapacity {
  sequences: number;
  steps: number;
  /** Restore rounds available across the sets (see restoreQuota). */
  movable: number;
}

/**
 * Restore rounds one set may carry in a session: a 3-step set once (a second would be a giveaway
 * after arranging it), longer sets up to steps − 2.
 */
export function restoreQuota(s: OrderSequence): number {
  const movable = s.steps.length - (s.anchored ? 1 : 0);
  return Math.max(1, Math.min(movable, s.steps.length - 2));
}

export function capacity(seqs: readonly OrderSequence[]): ArcCapacity {
  const ids = new Set(seqs.map((s) => s.id));
  return {
    sequences: seqs.length,
    steps: seqs.reduce((n, s) => n + s.steps.length, 0),
    movable: seqs.reduce((n, s) => {
      const free = s.steps.filter((st, i) => !(s.anchored && i === 0) && !ids.has(st.key)).length;
      return n + Math.min(restoreQuota(s), free);
    }, 0),
  };
}

/** Enough for 3+ discovery and 3+ pressure rounds, each on its own item. */
export function hasFullArc(seqs: readonly OrderSequence[]): boolean {
  const c = capacity(seqs);
  if (c.sequences < MIN_SEQUENCES || c.steps < MIN_TOTAL_STEPS) return false;
  // Arrange rounds use the sequences; restore rounds use steps; together at least six rounds.
  return Math.min(c.sequences, MAX_ROUNDS) + c.movable >= MIN_ROUNDS;
}

const supportCache = new WeakMap<Reading, boolean>();

/**
 * Honest support: the capacity check, then a dry build (fixed seed, no SRS history) so a reading
 * that passes here really yields a 3–5 + 3–5 arc.
 */
export function supportsOrderGame(reading: Reading, corpus?: Corpus): boolean {
  if (!hasFullArc(cachedSequences(reading, corpus))) return false;
  if (!corpus) return true;
  let ok = supportCache.get(reading);
  if (ok === undefined) {
    let seed = 0x2f6b;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    const plan = buildOrderGame(reading, { corpus, srs: {}, today: '1970-01-01', rng, priorityCategory: null });
    ok = !!plan && plan.rounds.filter((r) => r.phase === 'discovery').length >= 3 && plan.rounds.filter((r) => r.phase === 'pressure').length >= 3;
    supportCache.set(reading, ok);
  }
  return ok;
}

// ---------------------------------------------------------------------------------------------
// Rounds

/** A starting arrangement: a shuffle that leaves at most a third of the steps in place (never the identity). */
export function scramble(n: number, rng: () => number, anchored = false): number[] {
  const ids = Array.from({ length: n }, (_, i) => i);
  const free = anchored ? ids.slice(1) : ids;
  const head = anchored ? [0] : [];
  let best = ids;
  let bestFixed = n + 1;
  for (let tries = 0; tries < 12; tries++) {
    const p = [...head, ...shuffle(free, rng)];
    const fixed = p.filter((v, i) => v === i).length - head.length;
    if (fixed < bestFixed) {
      best = p;
      bestFixed = fixed;
    }
    if (fixed <= Math.floor(free.length / 3)) break;
  }
  if (best.every((v, i) => v === i)) best = [...head, ...free.slice(1), free[0]];
  return best;
}

/** The notes' order with step `d` lifted out and dropped at position `to`. */
export function displace(n: number, d: number, to: number): number[] {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== d);
  rest.splice(to, 0, d);
  return rest;
}

/** Where to drop a displaced step: never its own slot, never ahead of a pinned head; further away when the set is long. */
export function displaceTarget(n: number, d: number, rng: () => number, anchored = false): number {
  const lo = anchored ? 1 : 0;
  const all = Array.from({ length: n }, (_, i) => i).filter((p) => p >= lo && p !== d);
  const far = all.filter((p) => Math.abs(p - d) >= 2);
  const pool = n >= 5 && far.length ? far : all;
  return pool[Math.floor(rng() * pool.length)] ?? (d === lo ? lo + 1 : lo);
}

/** Positions in `arrangement` (indices into steps) that hold the right step. */
export function positionsRight(arrangement: readonly number[]): boolean[] {
  return arrangement.map((v, i) => v === i);
}

/** Moves the entry at `from` to `to` (the others shift). */
export function moveTo(arrangement: readonly number[], from: number, to: number): number[] {
  const a = [...arrangement];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

/** SRS grade for a checked arrangement: all right → the shell's speed grade; else partial credit. */
export function partialGrade(arrangement: readonly number[], mode: RoundMode = 'arrange'): number | undefined {
  const right = positionsRight(arrangement).filter(Boolean).length;
  if (right === arrangement.length) return undefined;
  if (mode === 'restore') return 1;
  return right * 2 >= arrangement.length ? 2 : 1;
}

function seqChars(seq: OrderSequence): number {
  return seq.steps.reduce((n, s) => n + displayLength(s.text), 0);
}

/** Comfortable time: reading every step plus a few seconds a move. Pressure shrinks it (15–45 s, §10.3). */
export function timeFor(seq: OrderSequence, mode: RoundMode, pressureStep: number | null): number {
  const chars = seqChars(seq);
  const base =
    mode === 'arrange'
      ? Math.min(45000, Math.max(18000, 6000 + seq.steps.length * 3500 + chars * 22))
      : Math.min(35000, Math.max(18000, 7000 + chars * 18));
  if (pressureStep === null) return Math.round(base * 1.5);
  // Structural rounds stay within 15–45 s (§10.3) however far the clock has tightened.
  return Math.max(15000, Math.round(base * Math.pow(0.92, pressureStep)));
}

export interface OrderBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
  priorityCategory: TrapCategory | null;
}

/** Due first, then unseen, then the rest; shuffled within a tier. */
function bySrs<T>(xs: readonly T[], id: (x: T) => string, ctx: OrderBuildInput): T[] {
  return shuffle(xs, ctx.rng)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => srsPriority(ctx.srs[id(a.x)], ctx.today) - srsPriority(ctx.srs[id(b.x)], ctx.today) || a.i - b.i)
    .map((e) => e.x);
}

const KIND_LINE: Record<SequenceKind, string> = {
  process: 'the steps only work in this order; each one takes what the one before it produced.',
  derivation: 'each step of the calculation needs the result of the one before it.',
  ranking: 'the notes rank these on one scale; the position is the claim.',
  timeline: 'the order is chronology: what came first shaped what followed.',
  hierarchy: 'each rung sits above or below its neighbours; moving one moves the meaning.',
  cycle: 'the loop closes on itself: each link produces the next, and the last feeds the first.',
};
const KIND_UNIT: Record<SequenceKind, string> = {
  process: 'steps',
  derivation: 'steps',
  ranking: 'places',
  timeline: 'events',
  hierarchy: 'rungs',
  cycle: 'links',
};

export function namingFor(corpus: Corpus, reading: Reading, seq: OrderSequence): ConceptNaming {
  const los = learningObjectives(reading);
  const objectiveId = seq.objectiveId ?? corpus.objectiveOfBlock[seq.blockId] ?? los[los.length - 1]?.id ?? reading.reading_id;
  return {
    term: seq.concept,
    blockId: seq.blockId,
    objectiveId,
    line: `${seq.steps.length} ${KIND_UNIT[seq.kind]} in a fixed order, and ${KIND_LINE[seq.kind]}`,
  };
}

interface Planned {
  seq: OrderSequence;
  mode: RoundMode;
  displaced?: number;
}

/** Restore candidates, one step per sequence per pass so no set is hit twice while another waits. */
function restorePicks(
  seqs: readonly OrderSequence[],
  count: number,
  taken: Set<string>,
  used: Map<string, number>,
  ctx: OrderBuildInput,
  prefer: readonly OrderSequence[],
): Planned[] {
  const queues = new Map<OrderSequence, number[]>();
  for (const s of seqs) {
    const idx = s.steps.map((_, i) => i).filter((i) => !(s.anchored && i === 0) && !taken.has(s.steps[i].key));
    queues.set(s, bySrs(idx, (i) => s.steps[i].key, ctx));
  }
  const order = [...prefer, ...seqs.filter((s) => !prefer.includes(s))];
  const out: Planned[] = [];
  let progress = true;
  while (out.length < count && progress) {
    progress = false;
    for (const s of order) {
      if (out.length >= count) break;
      if ((used.get(s.id) ?? 0) >= restoreQuota(s)) continue;
      const q = queues.get(s)!;
      let d = q.shift();
      // Checked at pick time too: every round in a session reviews its own item.
      while (d !== undefined && taken.has(s.steps[d].key)) d = q.shift();
      if (d === undefined) continue;
      taken.add(s.steps[d].key);
      used.set(s.id, (used.get(s.id) ?? 0) + 1);
      out.push({ seq: s, mode: 'restore', displaced: d });
      progress = true;
    }
  }
  return out;
}

export function buildOrderGame(reading: Reading, ctx: OrderBuildInput): MechanicPlan<OrderPayload> | null {
  const all = cachedSequences(reading, ctx.corpus);
  if (!hasFullArc(all)) return null;
  const seqs = bySrs(all, (s) => s.id, ctx);
  // Item IDs already in use: a restore round must not review the same ID as an arrange round.
  const taken = new Set<string>(seqs.map((s) => s.id));

  // Discovery: whole sets, shortest first-ish (feel the idea on small boards); topped up with restore rounds.
  const nSeq = Math.min(seqs.length, MAX_ROUNDS);
  const discArrange = nSeq >= MIN_ROUNDS ? Math.min(5, Math.floor(nSeq / 2)) : Math.min(nSeq, 5);
  const discSeqs = seqs
    .slice(0, discArrange)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.steps.length - b.s.steps.length || a.i - b.i)
    .map((x) => x.s);
  const discovery: Planned[] = discSeqs.map((seq) => ({ seq, mode: 'arrange' }));
  const used = new Map<string, number>();
  if (discovery.length < 3) discovery.push(...restorePicks(discSeqs, 3 - discovery.length, taken, used, ctx, []));

  // Pressure: unseen sets first (novel items), then restore rounds across the sets, 3–5 in all.
  const fresh = seqs.slice(discArrange, discArrange + 5);
  const pressure: Planned[] = fresh.map((seq) => ({ seq, mode: 'arrange' }));
  const wantPressure = Math.max(3, Math.min(5, pressure.length || 4));
  if (pressure.length < wantPressure) {
    pressure.push(...restorePicks(seqs, wantPressure - pressure.length, taken, used, ctx, bySrs(seqs.filter((s) => !discSeqs.includes(s)), (s) => s.id, ctx)));
  }
  if (discovery.length < 3 || pressure.length < 3) return null;
  // Pressure climbs: restore rounds (quick detection) interleave, longer boards later.
  pressure.sort((a, b) => a.seq.steps.length - b.seq.steps.length);

  const toRound = (pl: Planned, phase: 'discovery' | 'pressure', step: number): MechanicRound<OrderPayload> => {
    const { seq, mode } = pl;
    const limit = phase === 'pressure' ? timeFor(seq, mode, step) : undefined;
    const n = seq.steps.length;
    const start =
      mode === 'restore' && pl.displaced !== undefined
        ? displace(n, pl.displaced, displaceTarget(n, pl.displaced, ctx.rng, seq.anchored))
        : scramble(n, ctx.rng, seq.anchored);
    const itemId = mode === 'restore' && pl.displaced !== undefined ? seq.steps[pl.displaced].key : seq.id;
    return {
      id: `${itemId}#${phase}`,
      phase,
      itemId,
      blockId: seq.blockId,
      objectiveId: seq.objectiveId,
      category: 'Sequence',
      timeLimitMs: limit,
      targetMs: limit ?? timeFor(seq, mode, 0),
      payload: { seq, mode, start, displaced: pl.displaced },
    };
  };
  const rounds = [...discovery.map((p) => toRound(p, 'discovery', 0)), ...pressure.map((p, i) => toRound(p, 'pressure', i))];
  const first = rounds.find((r) => r.payload.mode === 'arrange') ?? rounds[0];
  const concept = namingFor(ctx.corpus, reading, first.payload.seq);
  const sets = new Set(rounds.map((r) => r.payload.seq.id)).size;
  return {
    rounds,
    target: concept.term,
    // Only promise the one-piece-out rounds when the session has them.
    opening: `Order Game. ${sets} ${sets === 1 ? 'set' : 'sets'} of steps from this reading. ${
      rounds.some((r) => r.payload.mode === 'restore') ? 'Some arrive shuffled; later ones arrive nearly right, with one piece out of place.' : 'Each arrives shuffled.'
    } Put each back the way the notes run it.`,
    concept,
  };
}

/** Names the sequence the player got most wrong in discovery, else the first whole set they arranged. */
export function nameAfterDiscovery(
  corpus: Corpus,
  reading: Reading,
  plan: MechanicPlan<OrderPayload>,
  discovery: readonly RoundResult[],
): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const played = discovery
    .map((d) => ({ d, r: byId.get(d.roundId) }))
    .filter((x): x is { d: RoundResult; r: MechanicRound<OrderPayload> } => !!x.r);
  const missed = played.filter((x) => !x.d.correct).sort((a, b) => (a.d.grade ?? 1) - (b.d.grade ?? 1));
  const pick = missed[0] ?? played.find((x) => x.r.payload.mode === 'arrange') ?? played[0];
  return pick ? namingFor(corpus, reading, pick.r.payload.seq) : plan.concept;
}
