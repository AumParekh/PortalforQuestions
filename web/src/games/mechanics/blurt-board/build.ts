// Blurt Board (PORTAL_PLAN §3c): pure round building. Pick an objective, hand over a blank
// board, let the player free-recall everything; on Check, the objective's extracted items
// (terms, bullets, numeric items, variables) light up as hit or missed. Discovery is a shorter
// objective, untimed; pressure is a timed blurt on another objective. Each round is one target
// item on the board, keyed by its sub-item ID so the shared SRS schedules it.
import type { Corpus } from '../../corpus';
import type { Block, ItemSrs, Objective, Reading, SubItemLike } from '../../types';
import { isLearningObjective } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { emphasised, mathToPlain, splitMath, toDisplay, toSegments } from '../../text';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { BlurtTarget, KeyWord, TargetKind } from './match';
import { contentStems, directionStems, lightForm, parseNumbers, plainOf, words } from './match';

/** One board: an objective, the targets that are scored on it, and the rest of its items. */
export interface BlurtBoardSpec {
  boardId: string;
  objectiveId: string;
  /** The objective statement (LaTeX), the only prompt on the blank board. */
  objectiveText: string;
  targets: BlurtTarget[];
  /** Other items of the objective: shown as "also recalled" when the player writes them; not scored. */
  extras: BlurtTarget[];
  /** Pressure only: the board's time limit. */
  timeLimitMs?: number;
}

export interface BlurtPayload {
  board: BlurtBoardSpec;
  /** Which target of the board this round scores. */
  itemId: string;
}

export const MIN_TARGETS = 3;
export const DISCOVERY_TARGETS = 4;
export const PRESSURE_TARGETS = 5;
/** Enough for the largest objective (58 items), so "the rest of this objective" is the whole rest. */
export const MAX_EXTRAS = 120;

/** Block types whose items are recall material. Worked examples, tables and diagrams are not. */
const SKIP_BLOCKS = new Set(['exbox', 'table', 'tikzpicture', 'figcap']);
/**
 * Numbers are recall material only in statements of fact, not in examples or tables. Trap boxes
 * (numbers from exam stems: "the stem supplies the $50 billion") and gap boxes (worked set-ups:
 * "the swap curve is flat at 5%") are left out too.
 */
const NUMBER_BLOCKS = new Set(['prose_para', 'keybox', 'defbox', 'fmlbox', 'notebox']);
/** Worked-example set-ups in prose: their numbers are illustrations, not facts to recall. */
const EXERCISE_CUE = /\b(?:calculate|compute|construct|price an?|assum(?:e|ed|ing)|suppose|consider|for example|for instance|e\.g\.|example|stem|worked|this month|last month|face value|giving|if (?:a|an|we|you|on|the)|i am|we should|for every|impl(?:y|ies|ied)|means an?)\b/i;
/** Boxes that read off a worked example's answer ("Read the result"): their numbers belong to that example. */
const RESULT_TITLE = /\b(?:result|results|answer|example|worked)\b/i;
/**
 * Trap boxes about one worked calculation ("Three ways this calculation is corrupted"): their
 * bullets carry that example's wrong answers and step numbers, not facts about the objective.
 */
const WORKED_TRAP_TITLE = /\b(?:this|the) (?:example|calculation)\b|\bcorrupted\b|\bways to get it wrong\b|\bfailure modes?\b|\bchain\b/i;
/** Box titles that are headings over the box's terms, not a term ("The three states", "What a copula is"). */
const HEADING_TITLE = /^(?:(?:what|how|why|when)\b|(?:the )?(?:two|three|four|five|six|same|difference|distinction|link|classification|structure)\b)|,|\bin one line\b/i;

/** Significant digits of a number as written ("$521.4375" → 7, "1,750,000" → 3). */
function significantDigits(text: string): number {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(text);
  if (!m) return 0;
  const digits = m[0].replace(/[,.]/g, '').replace(/^0+/, '');
  const intPart = m[0].split('.')[0].replace(/,/g, '');
  return m[0].includes('.') ? digits.length : intPart.replace(/0+$/, '').length;
}
/**
 * Worked arithmetic in a statement ("$992.556 - 990 = $2.556", "75/1000 = 7.5%",
 * "(6.258% + 6.260%) / 2 = 6.259%") or a computed figure ("$521.4375 face"): an example's working,
 * not a point to recall.
 */
export function isWorking(plain: string): boolean {
  // Escaped signs survive plain-text conversion ("6.258\% + 6.260\%").
  plain = plain.replace(/\\(?=[%$])/g, '');
  if (/\d[\d.,]*%?\)?\s*[-+−×*/÷]\s*\(?\s*\$?\s*\d[\d.,]*%?\)?\s*=/.test(plain)) return true;
  return (plain.match(/\d[\d,]*\.\d+/g) ?? []).some((x) => significantDigits(x) >= 5);
}
const TRAP_LABEL = /^[A-Z][A-Za-z]*(?:[ -][A-Za-z]+){0,2}(?:,\s*[A-Z]{1,4}-\d+\s*[a-z]?)?\s*[.:]\s+/;
/**
 * What a trap bullet shows starts after its trap label: the trap's shape, often with the objective
 * it points at ("\\term{Sibling, IM-2 e.}", "Polarity:"). A lead-in that is content ("Too many
 * exceptions:", "Smile:") stays.
 */
const TRAP_LABEL_MACRO = /^\s*\\(?:term|textbf|emph)\{([^{}]*)\}\s*/;
const TRAP_SHAPE =
  /^(?:(?:polarity|sibling|role|sign|scope|definition|formula|intermediate results?|sequence|calculation|number|ranking|input twin|confidence twin)\b[^.:]{0,40}|[A-Z]{1,4}-\d+[^.:]{0,12})\s*[.:]?$/i;
const TRAP_SHAPE_TEXT =
  /^\s*(?:polarity|sibling|role|sign|scope|definition|formula|intermediate results?|sequence|calculation|number|ranking)(?:,\s*[A-Z]{1,4}-\d+[^.:]{0,12})?\s*[.:]\s+/i;
const LO_VERB = /^(Describe|Explain|Identify|Calculate|Compare|Evaluate|Distinguish|Assess|Define|Apply|Discuss|Summari[sz]e|Differentiate|Estimate|Interpret|Analy[sz]e|Contrast|Outline|Recogni[sz]e|Construct|Derive|List)\b/;

function obj(x: SubItemLike): Record<string, unknown> | null {
  return x && typeof x === 'object' ? (x as unknown as Record<string, unknown>) : null;
}
function str(x: unknown): string {
  return typeof x === 'string' ? x : '';
}

/** First sentence of a statement (two when the first is very short), for keywording a bullet. */
export function leadSentence(plain: string): string {
  const parts = plain.split(/(?<=[.!?])\s+(?=[A-Z$(])/);
  let lead = parts[0] ?? plain;
  if (lead.split(/\s+/).length < 5 && parts[1]) lead = `${lead} ${parts[1]}`;
  return lead;
}

/** Acronyms that stand for a term: an explicit "(EAD)", or the term itself when it is one ("IRC"). */
export function acronymsOf(latex: string): string[] {
  const plain = plainOf(latex);
  const out = new Set<string>();
  for (const m of plain.matchAll(/\(([A-Za-z][A-Za-z0-9&-]{1,7})\)/g)) out.add(m[1].toLowerCase());
  const ws = plain.replace(/\([^)]*\)/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (ws.length === 1 && /^[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(ws[0]) && ws[0].length <= 7) out.add(ws[0].toLowerCase());
  return [...out].filter((a) => a.length >= 2);
}

interface RawTarget {
  itemId: string;
  blockId: string;
  kind: TargetKind;
  display: string;
  label?: string;
  context?: string;
  /** Plain text the keywords come from. */
  keyText: string;
  /** Emphasised phrases inside the item; their words weigh double. */
  emph: string[];
  acronyms: string[];
  values: number[];
  pct?: boolean;
  /** Variables: the symbol spelled out ("lambda"), which with one keyword recalls the variable. */
  symbolWords?: string[];
  /** Dedupe key. */
  key: string;
}

const normText = (x: string) => toDisplay(x).toLowerCase().replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The block's title captured as a term when it is only a heading over the block's own terms:
 * "The three states" over insolvency / default / bankruptcy, "Recombining and non-recombining"
 * over its two terms. A title the body itself uses ("... is called the failure rate") is a term.
 */
function isHeadingTerm(b: Block, text: string, all: readonly string[]): boolean {
  if (!b.title || normText(text) !== normText(b.title)) return false;
  if (normText(b.plain_text ?? b.body_latex ?? '').includes(normText(text))) return false;
  if (HEADING_TITLE.test(toDisplay(text))) return true;
  const own = contentStems(plainOf(text));
  const others = new Set(all.filter((x) => normText(x) !== normText(text)).flatMap((x) => contentStems(plainOf(x))));
  return own.length > 0 && others.size > 0 && own.every((x) => others.has(x));
}

function termTargets(b: Block): RawTarget[] {
  const out: RawTarget[] = [];
  const texts = (b.terms ?? []).map((x) => str(obj(x)?.text) || str(obj(x)?.plain_text));
  for (const x of b.terms ?? []) {
    const o = obj(x);
    const id = str(o?.id);
    // "1. Unconditional coverage": the list number is not part of the term.
    const text = (str(o?.text) || str(o?.plain_text)).replace(/^\s*\d{1,2}[.)]\s+(?=\S)/, '');
    if (!id || !text.trim()) continue;
    const plain = plainOf(text);
    const n = plain.split(/\s+/).length;
    if (plain.length < 2 || plain.length > 90 || n > 10) continue;
    const acronyms = acronymsOf(text);
    // "more than one", "no": marked, but nothing to recall on their own.
    if (!contentStems(plain).some((x) => x.length >= 3) && acronyms.length === 0) continue;
    if (isHeadingTerm(b, text, texts)) continue;
    // A bold question is a heading ("Why cutting fiscal spending is difficult"), not a term.
    if (/^(?:what|how|why)\b/i.test(plain)) continue;
    // The list's joining punctuation ("Managing accounts, including pricing ...; and") is not part of the sentence.
    const context = termSentence(b, toDisplay(text).replace(/[.:;,]+$/, '')).replace(/(?:[;,]\s*(?:and|or)|[;,])\s*$/, '');
    const shown = toDisplay(context);
    // "buying" / "shorting" inside "replicated by buying $521.4375 face of ...": the example's working.
    if (context && (isWorking(shown) || isWorking(plainOf(context)))) continue;
    // "$82.55 million" in "for every $100 million sold in T-bonds, we should buy $82.55 million": an example's answer.
    if (/^\$?\s*\d/.test(toDisplay(text)) && EXERCISE_CUE.test(shown)) continue;
    out.push({ itemId: id, blockId: b.id, kind: 'term', display: text, ...(context ? { context } : {}), keyText: plain, emph: [], acronyms, values: [], key: `t:${contentStems(plain).join(' ')}` });
  }
  return out;
}

/** Nesting depth of a bullet (1 = top level). */
function depthOf(x: SubItemLike): number {
  const d = obj(x)?.depth;
  return typeof d === 'number' ? d : 1;
}

/** Formatting macros a lead-in may carry and still render as text; anything else (a heading box, a formula) is left out. */
const FOREIGN_MACRO = /\\(?!(?:term|emph|textbf|textit)\{)[a-zA-Z]/;

/**
 * The sentence a top-level list hangs from ("A manager can lower a portfolio's VaR by:"), for its
 * bullets, which are often fragments of it ("lowering the position with the highest marginal VaR;").
 */
function listIntro(b: Block, index: number): string {
  const src = (b.body_latex ?? '').replace(/\s+/g, ' ');
  // Bullets are the block's \items in order; if the counts disagree, the position is unknown.
  const items = [...src.matchAll(/\\item\b/g)];
  if (items.length !== (b.bullets ?? []).length) return '';
  const at = items[index]?.index ?? -1;
  if (at < 0) return '';
  // The list that holds the bullet: walk back over nested lists to its own \begin.
  const marks = [...src.slice(0, at).matchAll(/\\(begin|end)\{(?:itemize|enumerate)\}/g)];
  let nested = 0;
  let openAt = -1;
  for (let k = marks.length - 1; k >= 0; k--) {
    if (marks[k][1] === 'end') nested++;
    else if (nested > 0) nested--;
    else {
      openAt = marks[k].index ?? -1;
      break;
    }
  }
  if (openAt < 0) return '';
  const before = src.slice(0, openAt);
  // Only the prose right before the list: after any earlier list or item.
  const cut = [...before.matchAll(/\\end\{(?:itemize|enumerate)\}|\\item\b/g)].pop();
  const prose = before.slice(cut ? (cut.index ?? 0) + cut[0].length : 0).trim();
  const last = prose.split(/(?<=[.!?])\s+(?=[A-Z])/).pop()?.trim() ?? '';
  return /:\s*$/.test(toDisplay(last)) ? last : '';
}

/**
 * What a sub-list hangs from in its parent bullet: the sentence that opens the sub-list when it
 * ends in a colon ("Enhanced due diligence for high-risk customers:", after a label such as
 * "Profit scoring."), else the parent's lead ("Political risk. How the government operates ...").
 */
function parentLead(raw: string): string {
  const parts = raw.split(/(?<=[.!?])\s+(?=[A-Z$(\\])/).map((x) => x.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  if (parts.length > 1 && /:\s*$/.test(toDisplay(last))) {
    const label = parts[0].split(/\s+/).length <= 6 ? parts[0] : '';
    return label ? `${label} ${last}` : last;
  }
  return leadSentence(raw);
}

function bulletTargets(b: Block, objectiveText: string): RawTarget[] {
  const out: RawTarget[] = [];
  const loKey = contentStems(plainOf(objectiveText)).join(' ');
  const list = b.bullets ?? [];
  list.forEach((x, i) => {
    const o = obj(x);
    const id = str(o?.id);
    const text = str(o?.text) || str(o?.plain_text);
    if (!id || !text.trim()) return;
    let plain = plainOf(text);
    // Learning-objective restatements are the prompt, not recall material.
    if (b.type === 'keybox' && LO_VERB.test(plain)) return;
    // A trap bullet's lead-in label is its trap category ("Sibling, IM-2 e."), not content.
    let shownText = text;
    if (b.type === 'trapbox') {
      plain = plain.replace(TRAP_LABEL, '');
      const m = TRAP_LABEL_MACRO.exec(text);
      shownText = m && TRAP_SHAPE.test(toDisplay(m[1]).trim()) ? text.slice(m[0].length) : text.replace(TRAP_SHAPE_TEXT, '');
    }
    // A bare lead-in to a sub-list ("European Union (EU):") says nothing itself; worked arithmetic is an example.
    if ((/:\s*$/.test(plain) && !/[.!?]\s/.test(plain) && plain.split(/\s+/).length <= 10) || isWorking(plain)) return;
    // An argument's set-up ("suppose for the sake of argument that ...") is not a point to recall.
    if (/\b(?:suppose|for the sake of argument)\b/i.test(plain)) return;
    // A heading over its own sub-list ("Asset servicing and redemption.", "Banks need policies for"): the sub-bullets carry it.
    const depth = depthOf(x);
    const next = list[i + 1];
    if (next !== undefined && depthOf(next) > depth && (plain.split(/\s+/).length <= 6 || !/[.!?:]\s*$/.test(plain))) return;
    const lead = leadSentence(plain);
    const stems = contentStems(lead);
    if (stems.length < 3 || lead.split(/\s+/).length > 45) return;
    if (stems.join(' ') === loKey) return;
    // What the bullet hangs from: its parent bullet ("Sensitivity depends on:"), or for a top-level
    // list, the sentence that opens it ("A credit VaR under the copula methodology is computed by:"
    // over "defining the copula function;"; "There are many ways to buy volatility protection:" over
    // "In option markets, but traders can also use other derivatives contracts ...").
    let context = '';
    if (depth > 1) {
      for (let j = i - 1; j >= 0; j--) {
        if (depthOf(list[j]) < depth) {
          const parent = obj(list[j]);
          context = parentLead(parent ? str(parent.text) || str(parent.plain_text) : typeof list[j] === 'string' ? (list[j] as string) : '');
          break;
        }
      }
    } else context = listIntro(b, i);
    if (!renderable(context)) context = '';
    // The list's joining punctuation ("...; and") is not part of the point.
    const display = shownText.replace(/(?:[;,]\s*(?:and|or)|[;,])\s*$/, '').trimEnd();
    out.push({ itemId: id, blockId: b.id, kind: 'point', display, ...(context ? { context } : {}), keyText: lead, emph: emphasised(text).map(plainOf), acronyms: [], values: [], key: `p:${stems.join(' ')}` });
  });
  return out;
}

/** Numbers of a block that belong to an illustration: a cue in their sentence, or an example box title. */
function exampleValues(b: Block): Set<number> {
  const out = new Set<number>();
  const titled = RESULT_TITLE.test(b.title ?? '');
  for (const x of b.numeric_items ?? []) {
    const o = obj(x);
    const ctx = plainOf(str(o?.context));
    if (!titled && !EXERCISE_CUE.test(ctx)) continue;
    for (const n of parseNumbers(ctx)) out.add(n.value);
  }
  return out;
}

function numberTargets(b: Block): RawTarget[] {
  if (!NUMBER_BLOCKS.has(b.type)) return [];
  const out: RawTarget[] = [];
  // A number used in an illustration is an illustration wherever the block repeats it ("$5,000").
  const illustrative = exampleValues(b);
  for (const x of b.numeric_items ?? []) {
    const o = obj(x);
    const id = str(o?.id);
    const text = str(o?.text);
    const context = str(o?.context);
    if (!id || !text.trim() || !context.trim()) continue;
    const ctxPlain = plainOf(context);
    // Arithmetic lines, number lists and display formulas are working, not facts to recall.
    if (/\d%?\s*[-+−×*/=]\s*\$?\s*\d/.test(ctxPlain) || parseNumbers(ctxPlain).length > 5) continue;
    if (EXERCISE_CUE.test(ctxPlain) || RESULT_TITLE.test(b.title ?? '')) continue;
    // A context cut off mid-sentence ("... turns negative once fewer than") states nothing.
    if (!/[.!?;:)”"]\s*$/.test(ctxPlain)) continue;
    if (splitMath(context).some((seg) => seg.kind === 'math' && mathToPlain(seg.tex) === null)) continue;
    const numPlain = plainOf(text);
    const parsed = parseNumbers(numPlain);
    const raw = typeof o?.value === 'number' ? (o.value as number) : parsed[0]?.value;
    if (raw === undefined || !Number.isFinite(raw)) continue;
    if (parsed.some((n) => illustrative.has(n.value)) || illustrative.has(Math.abs(raw))) continue;
    // 0, 1 and 100% turn up everywhere; five-plus significant digits are computed, not remembered.
    if (raw === 0 || raw === 1 || (raw === 100 && /%|percent/.test(numPlain)) || significantDigits(numPlain) > 4) continue;
    const scale = str(o?.scale).toLowerCase();
    const mult = scale === 'thousand' ? 1e3 : scale === 'million' ? 1e6 : scale === 'billion' ? 1e9 : scale === 'trillion' ? 1e12 : 1;
    const values = [Math.abs(raw)];
    if (mult !== 1) values.push(Math.abs(raw) * mult);
    let pct = str(o?.unit) === '%' || /%|percent/.test(numPlain);
    // Basis points: "50 bp" is also "0.5%" (and "0.005").
    if (str(o?.unit) === 'bp' || /\bbps?\b|basis point/i.test(numPlain)) {
      values.push(Math.abs(raw) / 100);
      pct = true;
    }
    // Keywords: the context without its numbers.
    const keyText = ctxPlain.replace(/\d[\d,.]*/g, ' ');
    if (contentStems(keyText).length < 3) continue;
    // A list item's context keeps its bullet ("• This means ..."); the tile does not need it.
    const display = context.replace(/^\s*(?:\\item\s*|[•·]\s*)/, '');
    out.push({ itemId: id, blockId: b.id, kind: 'number', display, label: text, keyText, emph: [], acronyms: [], values, pct, key: `n:${values[0]}:${contentStems(keyText).join(' ')}` });
  }
  return out;
}

function variableTargets(b: Block): RawTarget[] {
  const out: RawTarget[] = [];
  const vars = (b.variables ?? []).filter((v) => !!v && typeof v === 'object');
  const shared = (v: (typeof vars)[number]) => (v as unknown as Record<string, unknown>).shared_definition === true;
  const taken = new Set<string>();
  for (const v of vars) {
    const id = str(v.id);
    const symbol = str(v.symbol);
    // A trailing dash left from a parenthetical ("... investor — the wealth-weighted average ... —").
    const def = str(v.definition).replace(/\s*[—–]\s*$/, '');
    if (!id || !symbol.trim() || !def.trim() || taken.has(id)) continue;
    const plain = plainOf(def);
    if (contentStems(plain).length < 2) continue;
    // "$\mu$, $\sigma$ = mean and standard deviation of ...": one definition for several symbols.
    // Alone, "$\mu$ — mean and standard deviation" or "$c$ — call and put prices" is wrong; the tile names them all.
    const group = shared(v) ? vars.filter((u) => shared(u) && str(u.definition) === str(v.definition) && str(u.symbol).trim()) : [v];
    for (const u of group) taken.add(str(u.id));
    const symbols = group.map((u) => str(u.symbol)).join(', ');
    const symbolWords = group.flatMap((u) => words(plainOf(str(u.symbol)))).filter((w) => w.length >= 3);
    out.push({ itemId: id, blockId: b.id, kind: 'variable', display: `${symbols} — ${def}`, label: symbols, keyText: plain, emph: [], acronyms: [], values: [], symbolWords, key: `v:${contentStems(plain).join(' ')}` });
  }
  return out;
}

/** Two definitions of one symbol where one says no more than the other. */
function sameVariable(a: string, b: string): boolean {
  const x = contentStems(a);
  const y = contentStems(b);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length > 0 && short.every((s) => long.includes(s));
}

/** Every recall item of an objective, de-duplicated, in reading order. */
export function rawTargets(o: Objective): RawTarget[] {
  const out: RawTarget[] = [];
  const seen = new Set<string>();
  const objectiveText = o.text ?? '';
  for (const b of o.blocks ?? []) {
    if (!b || typeof b.id !== 'string' || SKIP_BLOCKS.has(b.type)) continue;
    // A consolidated trap summary spans the whole reading; it sits under the last objective only by position.
    if (b.type === 'trapbox' && /consolidated|summary/i.test(b.title ?? '')) continue;
    if (b.type === 'trapbox' && WORKED_TRAP_TITLE.test(b.title ?? '')) continue;
    const items = [...termTargets(b), ...variableTargets(b), ...numberTargets(b), ...bulletTargets(b, objectiveText)];
    for (const t of items) {
      if (seen.has(t.key) || seen.has(t.itemId)) continue;
      // One symbol keyed twice in the objective ("T — number of observations" in two formula boxes).
      if (t.kind === 'variable' && out.some((u) => u.kind === 'variable' && u.label === t.label && sameVariable(u.keyText, t.keyText))) continue;
      seen.add(t.key);
      seen.add(t.itemId);
      out.push(t);
    }
  }
  return out;
}

/** Document frequency of stems across a reading's recall items, for keyword weights. */
function documentFrequency(items: readonly RawTarget[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of items) for (const s of new Set(contentStems(t.keyText))) df.set(s, (df.get(s) ?? 0) + 1);
  return df;
}

function finalise(t: RawTarget, df: Map<string, number>, n: number): BlurtTarget {
  const emph = new Set(t.emph.flatMap((e) => contentStems(e)));
  const keys: KeyWord[] = contentStems(t.keyText).map((s) => {
    const w = 1 + Math.log(Math.max(1, n) / Math.max(1, df.get(s) ?? 1));
    return { s, w: Math.round((emph.has(s) ? 2 : 1) * w * 1000) / 1000 };
  });
  return {
    itemId: t.itemId,
    blockId: t.blockId,
    kind: t.kind,
    display: t.display,
    ...(t.label !== undefined ? { label: t.label } : {}),
    ...(t.context ? { context: t.context } : {}),
    keys,
    acronyms: [...t.acronyms, ...(t.symbolWords ?? [])].filter((a, i, xs) => xs.indexOf(a) === i),
    values: t.values,
    ...(t.pct ? { pct: true } : {}),
    // Short terms carry their direction word as a required keyword; longer ones can be flipped.
    directions: t.kind === 'term' && keys.length < 3 ? [] : directionStems(t.keyText),
    // A term that is one keyword once stop words go must be written as the term.
    ...(t.kind === 'term' && keys.length <= 1 ? { phrase: words(t.keyText).map(lightForm) } : {}),
  };
}

const targetCache = new WeakMap<Reading, Map<string, BlurtTarget[]>>();

/** Lettered objectives, skipping malformed ones (content is still being refined). */
function objectivesOf(reading: Reading): Objective[] {
  const os = Array.isArray(reading?.objectives) ? reading.objectives : [];
  return os.filter((o) => !!o && typeof o.id === 'string' && typeof o.letter === 'string' && isLearningObjective(o));
}

/** Finalised recall items of every learning objective in a reading (cached per reading object). */
export function readingTargets(reading: Reading): Map<string, BlurtTarget[]> {
  const cached = targetCache.get(reading);
  if (cached) return cached;
  const raw = new Map<string, RawTarget[]>();
  for (const o of objectivesOf(reading)) {
    try {
      raw.set(o.id, rawTargets(o));
    } catch {
      // Malformed objective (content is still being refined): skip it rather than fail the reading.
    }
  }
  const all = [...raw.values()].flat();
  const df = documentFrequency(all);
  const out = new Map<string, BlurtTarget[]>();
  for (const [id, items] of raw) out.set(id, items.map((t) => finalise(t, df, all.length)));
  targetCache.set(reading, out);
  return out;
}

/** Learning objectives with enough distinct recall items for a board. */
export function eligibleObjectives(reading: Reading): { o: Objective; items: BlurtTarget[] }[] {
  const byLo = readingTargets(reading);
  return objectivesOf(reading)
    .map((o) => ({ o, items: byLo.get(o.id) ?? [] }))
    .filter((x) => distinctItems(x.items).length >= MIN_TARGETS);
}

export function supportsBlurt(reading: Reading): boolean {
  return eligibleObjectives(reading).length >= 2;
}

export interface BlurtBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
}

const KIND_QUALITY: Record<TargetKind, number> = { term: 3, variable: 2, number: 2, point: 2 };

function quality(t: BlurtTarget): number {
  // Single-word terms without an acronym are thin recall targets; multi-word terms and acronyms are the vocabulary.
  if (t.kind === 'term' && t.keys.length <= 1 && t.acronyms.length === 0) return 1;
  // Trap-box bullets are about how the exam misleads; the objective's own content comes first.
  if (t.kind === 'point' && /\.trapbox\./.test(t.blockId)) return 1;
  return KIND_QUALITY[t.kind];
}

const flatCache = new WeakMap<BlurtTarget, string>();
function flat(t: BlurtTarget): string {
  let f = flatCache.get(t);
  if (f === undefined) {
    f = ` ${words(plainOf(t.display)).join(' ')} `;
    flatCache.set(t, f);
  }
  return f;
}

/** Two items say the same thing on a board: a term that is the lead-in of a bullet, or one text inside the other. */
export function overlaps(a: BlurtTarget, b: BlurtTarget): boolean {
  const x = flat(a);
  const y = flat(b);
  return x.trim().length > 0 && y.trim().length > 0 && (x.includes(y) || y.includes(x));
}

/** Items in reading order, leaving out any that repeat one already taken. */
export function distinctItems(items: readonly BlurtTarget[]): BlurtTarget[] {
  const out: BlurtTarget[] = [];
  for (const t of items) if (!out.some((p) => overlaps(p, t))) out.push(t);
  return out;
}

/** Picks n targets: due first, then unseen, then the rest; within a tier, richer items first; no kind takes over the board. */
export function pickTargets(items: readonly BlurtTarget[], n: number, ctx: BlurtBuildInput): BlurtTarget[] {
  const tier = (t: BlurtTarget) => srsPriority(ctx.srs[t.itemId], ctx.today);
  const ordered = shuffle(items, ctx.rng)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => tier(a.t) - tier(b.t) || quality(b.t) - quality(a.t) || a.i - b.i)
    .map((x) => x.t);
  const cap = Math.ceil(n / 2);
  const picked: BlurtTarget[] = [];
  const perKind = new Map<TargetKind, number>();
  const clashes = (t: BlurtTarget) => picked.some((p) => overlaps(p, t));
  for (const t of ordered) {
    if (picked.length >= n) break;
    if ((perKind.get(t.kind) ?? 0) >= cap || clashes(t)) continue;
    picked.push(t);
    perKind.set(t.kind, (perKind.get(t.kind) ?? 0) + 1);
  }
  // Top up past the kind cap, never with an item that repeats one on the board: one line would
  // score both ("Rating transitions" and "Rating transitions. Transition matrices show ...").
  for (const t of ordered) {
    if (picked.length >= n) break;
    if (!picked.includes(t) && !clashes(t)) picked.push(t);
  }
  // An unlucky order can strand the board below the minimum; the reading-order set never does (see eligibleObjectives).
  if (picked.length < Math.min(n, MIN_TARGETS)) {
    const base = distinctItems(items);
    picked.splice(0, picked.length, ...ordered.filter((t) => base.includes(t)).slice(0, n));
  }
  // Board order follows the reading, so the lit-up board reads like the notes.
  return items.filter((t) => picked.includes(t));
}

/** Time for a timed blurt: a settling allowance plus time per target. */
export function boardTimeMs(targets: number): number {
  return 45000 + 20000 * targets;
}

/** How long, untimed, a considered blurt of this size takes (grading speed is not used here). */
export function boardTargetMs(targets: number): number {
  return 60000 + 20000 * targets;
}

function makeBoard(o: Objective, items: readonly BlurtTarget[], n: number, phase: 'discovery' | 'pressure', ctx: BlurtBuildInput): BlurtBoardSpec {
  const targets = pickTargets(items, n, ctx);
  const extras = items.filter((t) => !targets.includes(t)).slice(0, MAX_EXTRAS);
  return {
    boardId: `${o.id}#${phase}`,
    objectiveId: o.id,
    objectiveText: o.text ?? '',
    targets,
    extras,
    ...(phase === 'pressure' ? { timeLimitMs: boardTimeMs(targets.length) } : {}),
  };
}

/** A short name for an item, for the naming step. Never cut mid-text: a label, a bold phrase, or the whole lead. */
export function shortName(t: BlurtTarget): string {
  const plain = toDisplay(t.display).replace(/\s+/g, ' ').trim();
  if (t.kind === 'term') return plain.replace(/[.:;,]+$/, '');
  if (t.kind === 'variable') return plain;
  if (t.kind === 'number') return toDisplay(t.label ?? '') || plain;
  const label = /^([^.:;]{2,60})[.:]\s/.exec(plain);
  if (label && label[1].split(/\s+/).length <= 6) return label[1];
  const emph = emphasised(t.display).filter((x) => x.split(/\s+/).length >= 2);
  return emph[0] ?? leadSentence(plain).replace(/[.;:]+$/, '');
}

/** A sentence that renders on a tile: no display formula, no layout macros. */
function renderable(latex: string): boolean {
  return !/\$\$|\\\[/.test(latex) && splitMath(latex).every((seg) => seg.kind === 'math' || !FOREIGN_MACRO.test(seg.text));
}

/**
 * What the notes say around a term, as LaTeX: the bullet of its block that carries it, else the
 * sentence that uses it. A term that is its own sentence ("Credit support amount.", "The second
 * effect dominates the first.") comes with the sentence that explains it.
 */
function termSentence(block: Block | undefined, term: string): string {
  if (!block) return '';
  const norm = (x: string) => toDisplay(x).toLowerCase().replace(/[“”"]/g, '').trim();
  const needle = term.toLowerCase().replace(/[“”"]/g, '').trim();
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // As a whole phrase: "Sharpe ratio" is not the "Sharpe ratios" of a quoted misstatement.
  const word = new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:$|[^\\p{L}\\p{N}])`, 'u');
  const has = (x: string) => word.test(norm(x));
  // Longer by at least a word ("... → IRR."), not only a list number or an article ("2) Internal
  // model-based approach.", "A payer interest rate swap collateralized by government bonds.").
  const longer = (x: string) =>
    has(x) &&
    norm(x)
      .replace(word, ' ')
      .split(/[^\p{L}\p{N}]+/u)
      .some((w) => /\p{L}/u.test(w) && w.length >= 2 && !/^(?:an|the|and|or)$/.test(w));
  const allBullets = (block.bullets ?? []).map((x) => {
    const o = obj(x);
    return o ? str(o.text) : typeof x === 'string' ? x : '';
  });
  const bullets = allBullets.filter(renderable);
  const src = block.plain_text ?? block.body_latex ?? '';
  // A display formula ends the sentence that introduces it ("... add volatility for up moves and subtract volatility for down moves:").
  const chunks = src.split(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/);
  // Sentences, grouped by list item or paragraph: a neighbour from another item explains nothing.
  const groups = chunks.flatMap((chunk, k) => {
    const items = chunk
      .split(/\s*(?:•|\n)\s*/)
      .map((item) =>
        item
          .split(/(?<=[.!?]|[.!?][”"])\s+(?=[A-Z$\\(“"])/)
          .map((x) => x.replace(/\s+/g, ' ').trim())
          .filter((x) => x.length > 0),
      )
      .filter((item) => item.length > 0);
    // A sentence that runs into a display formula ("The credit-adjusted value ... is") is cut off.
    const last = items[items.length - 1];
    if (k < chunks.length - 1 && last && !/[.!?:;]$/.test(last[last.length - 1])) last.pop();
    return items.filter((item) => item.length > 0);
  });
  const sentences = groups.flat();
  const usable = sentences.filter(renderable);
  // The sentence that opens with the term defines it ("Bankruptcy is a legal procedure ...", "A derivative
  // represents ...", "Synthetic CDOs use ..."); else the term's first use; else, in a definition box
  // titled with the term ("Heterogeneous"), its opening sentence.
  const opens = (x: string) => [norm(x), norm(x).replace(/^an? /, '')].some((y) => y.startsWith(needle) && y.length > needle.length + 3);
  // An opening sentence that sets up an example ("Assume a risk manager calculates ...") defines nothing.
  const opening = usable[0] && !/\b(?:assume|suppose|imagine|for example|for instance|calculates?|computes?)\b/i.test(toDisplay(usable[0])) ? usable[0] : undefined;
  const titled = block.type === 'defbox' && !!block.title && norm(block.title) === needle ? opening : undefined;
  const found = bullets.find(opens) ?? usable.find(opens) ?? bullets.find(longer) ?? usable.find(longer) ?? titled;
  if (found) return found;
  const same = (x: string) => norm(x).replace(/[.:;!?]+$/, '').replace(/^(?:a|an|the) /, '') === needle.replace(/^(?:a|an|the) /, '');
  const says = (x: string | undefined): x is string => !!x && renderable(x) && toDisplay(x).split(/\s+/).length >= 5;
  // A list item that is only the term: its first sub-item explains it ("Liquidity horizons." over
  // "Banks estimate the time to sell each instrument ..."); else the sentence that opens the list
  // ("The three methods are:" over "Scale the alphas.").
  const item = allBullets.findIndex(same);
  if (item >= 0) {
    const list = block.bullets ?? [];
    const sub = list[item + 1];
    if (sub !== undefined && depthOf(sub) > depthOf(list[item]) && says(allBullets[item + 1])) return `${allBullets[item]} ${allBullets[item + 1]}`;
    const intro = listIntro(block, item);
    if (intro && renderable(intro)) return intro;
  }
  // A term that is its own sentence: the sentence that explains it, after it or else before it,
  // within its own item ("Collateral pledging." takes nothing from the item before it).
  for (const group of groups) {
    const i = group.findIndex(same);
    if (i < 0) continue;
    const [prev, next] = [group[i - 1], group[i + 1]];
    if (says(next)) return `${group[i]} ${next}`;
    if (says(prev)) return `${prev} ${group[i]}`;
  }
  // A label whose text sits in the block it heads ("Risk governance" over "Sets roles and
  // responsibilities for managing risk."), or a definition box titled with the term ("Heterogeneous"):
  // the block's opening sentence defines it.
  if (!has(src) && opening && (block.type === 'defbox' || sentences.length <= 2)) return opening;
  return '';
}

/** Plain text of a context for the one-line naming; empty when it needs KaTeX. */
function plainContext(latex: string | undefined): string {
  if (!latex || toSegments(latex).some((seg) => seg.kind === 'math')) return '';
  return toDisplay(latex);
}

/** The item's name as plain text, or '' when it needs KaTeX; a symbol ("$\hat{r}(2)$") is named by its definition. */
function plainName(t: BlurtTarget): string {
  const name = plainContext(shortName(t));
  if (name || t.kind !== 'variable') return name;
  return plainContext(t.display.split(' — ').slice(1).join(' — '));
}

export function namingFor(_corpus: Corpus, t: BlurtTarget, objectiveId: string): ConceptNaming {
  const term = plainName(t) || shortName(t);
  // A context or statement that needs KaTeX is left out of the line.
  const ctx = plainContext(t.context);
  const shown = plainContext(t.display);
  const body = t.kind === 'term' ? ctx : t.kind === 'point' && ctx && shown ? `${ctx} ${shown}` : shown;
  const same = body.replace(/[.;:]+$/, '').trim().toLowerCase() === term.toLowerCase();
  return {
    term,
    blockId: t.blockId,
    objectiveId,
    // The notes' own words around the item; nothing when they only repeat its name.
    line: body && !same ? body : '',
  };
}

export function buildBlurt(reading: Reading, ctx: BlurtBuildInput): MechanicPlan<BlurtPayload> | null {
  const eligible = eligibleObjectives(reading);
  if (eligible.length < 2) return null;
  // Objectives with the most due, then unseen, items come first.
  const urgency = (items: readonly BlurtTarget[]) =>
    items.reduce((s, t) => s + (srsPriority(ctx.srs[t.itemId], ctx.today) === 0 ? 3 : srsPriority(ctx.srs[t.itemId], ctx.today) === 1 ? 1 : 0), 0) /
    Math.max(1, items.length);
  const ranked = shuffle(eligible, ctx.rng)
    .map((x, i) => ({ ...x, u: urgency(x.items), i }))
    .sort((a, b) => b.u - a.u || a.i - b.i);
  // Pressure takes the most urgent objective; discovery the shortest of the next few (a shorter LO).
  const pressureLo = ranked[0];
  const rest = ranked.slice(1, 4);
  const discoveryLo = [...rest].sort((a, b) => a.items.length - b.items.length || a.i - b.i)[0];
  if (!pressureLo || !discoveryLo) return null;

  const disc = makeBoard(discoveryLo.o, discoveryLo.items, Math.min(DISCOVERY_TARGETS, discoveryLo.items.length), 'discovery', ctx);
  const pres = makeBoard(pressureLo.o, pressureLo.items, Math.min(PRESSURE_TARGETS, pressureLo.items.length), 'pressure', ctx);
  if (disc.targets.length < MIN_TARGETS || pres.targets.length < MIN_TARGETS) return null;

  const toRound = (board: BlurtBoardSpec, t: BlurtTarget, phase: 'discovery' | 'pressure'): MechanicRound<BlurtPayload> => ({
    id: `${t.itemId}#${phase}`,
    phase,
    itemId: t.itemId,
    blockId: t.blockId,
    objectiveId: board.objectiveId,
    ...(board.timeLimitMs ? { timeLimitMs: board.timeLimitMs } : {}),
    targetMs: board.timeLimitMs ?? boardTargetMs(board.targets.length),
    payload: { board, itemId: t.itemId },
  });
  const rounds = [...disc.targets.map((t) => toRound(disc, t, 'discovery')), ...pres.targets.map((t) => toRound(pres, t, 'pressure'))];
  // The naming step is plain text: lead with an item that reads without KaTeX.
  const concept = namingFor(ctx.corpus, disc.targets.find((t) => plainName(t)) ?? disc.targets[0], disc.objectiveId);
  return {
    rounds,
    target: concept.term,
    opening: `Blurt Board. Two objectives, two blank boards. For each, write down everything you can remember — one idea per line, in your own words, in any order. Then the board shows what the notes hold that you found, and what stayed dark. The second board runs against the clock.`,
    concept,
  };
}

/** Names the first item the player left dark on the discovery board; else the first one they found. */
export function nameAfterDiscovery(corpus: Corpus, plan: MechanicPlan<BlurtPayload>, discovery: readonly RoundResult[]): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const played = discovery.map((d) => ({ d, r: byId.get(d.roundId) })).filter((x): x is { d: RoundResult; r: MechanicRound<BlurtPayload> } => !!x.r);
  const missed = played.filter((x) => !x.d.correct);
  const target = (x: { r: MechanicRound<BlurtPayload> }) => x.r.payload.board.targets.find((t) => t.itemId === x.r.itemId);
  const plain = (x: { r: MechanicRound<BlurtPayload> }) => {
    const t = target(x);
    return !!t && plainName(t) !== '';
  };
  // The naming screen prints text: an item that needs KaTeX is named only when nothing else can be.
  const pick = missed.find((x) => target(x)?.kind === 'term' && plain(x)) ?? missed.find(plain) ?? played.find(plain) ?? missed[0] ?? played[0];
  if (!pick) return plan.concept;
  const t = pick.r.payload.board.targets.find((x) => x.itemId === pick.r.itemId);
  return t ? namingFor(corpus, t, pick.r.payload.board.objectiveId) : plan.concept;
}

