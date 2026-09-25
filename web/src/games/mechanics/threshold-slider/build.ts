// Threshold Slider (brief §7.2): pure round building. A number from the notes is blanked out of
// its sentence; the player sets a slider (or types) to the value. The scale is built around the
// true value (plausible bounds, random offset so the answer is never predictably central).
// Discovery shows the whole sentence with the number blanked; pressure shows only a short cue
// cut from the same sentence. Source: numeric_items on the reading's blocks — every prompt is the
// notes' own text, nothing is generated.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { Block, ItemSrs, Reading, SubItem, SubItemLike, TableRow, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { emphasised, latexTextToPlain, toDisplay } from '../../text';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';

export const MIN_ITEMS = 6;
export const TARGET_ROUNDS = 8;
export const MAX_ROUNDS = 10;
/** Worked examples and diagram labels are calculation inputs, not facts to remember. */
const SKIP_BLOCKS = new Set(['exbox', 'tikzpicture']);
const MAX_SIG_DIGITS = 3;
const MIN_WORDS = 6;
const MAX_WORDS = 90;
/** Words that make a number approximate ("about 13%") and earn a tolerance instead of an exact match. */
const APPROX = /(?:\b(?:about|around|approximately|approx\.?|roughly|nearly|almost|circa|some|close to)\s*|~\s*|≈\s*|\\approx\s*|\\sim\s*)$/i;
const FACT_CUE =
  /\b(threshold|minimum|maximum|at least|at most|no more than|no less than|more than|less than|limit|cap|capped|floor|ratio|requir|must|set at|buffer|horizon|confidence|basel|regulat|percentile|trigger|benchmark|rule|standard|typically|between|range|ranging|weight|haircut|charge|multiplier|factor|coverage|leverage|surcharge)/i;
const EXAMPLE_START = /^\s*(?:•\s*)?(?:suppose|assume|consider|given|say|imagine|for example|e\.g\.|if (?:a|an|the|we)\b)/i;
const EXAMPLE_CUE = /\b(worked example|we get|gives|yields|therefore|hence|thus|so the|plugging|substitut)/i;
const GENERIC_TITLE = /^(?:trap|summary|remember|key (?:facts|points)|note|outcome|source|consolidated)/i;

export interface SliderScale {
  lo: number;
  hi: number;
  /** Drag snaps to this grid (about a hundredth of the range). */
  detent: number;
  /** Finest settable step: ±buttons, Shift+Arrow and typing. The answer is always on this grid. */
  fine: number;
  /** Labelled ticks along the rule. */
  ticks: number[];
  /** Start position shown before the player touches the scale (never the answer). */
  start: number;
}

export interface SliderPayload {
  itemId: string;
  blockId: string;
  /** Full context as LaTeX fragments; a blank sits between each consecutive pair (discovery). */
  parts: string[];
  /** Short cue for pressure: fragments around the blank from the same sentence, with elisions. */
  cue: string[];
  /** Label shown above the cue under pressure (block title, table row label or section). */
  lead: string | null;
  /** The number as written in the notes (LaTeX), shown in the revealed sentence. */
  answerText: string;
  answer: number;
  prefix: string;
  suffix: string;
  scale: SliderScale;
  /** Accepted absolute distance from the answer. */
  tolerance: number;
  approx: boolean;
  /** Where the number sat: a sentence, or a table row rendered "Header: cell; …". */
  kind: 'sentence' | 'row';
  score: number;
}

// ---------------------------------------------------------------------------------------------
// Numbers

export interface ParsedNumber {
  prefix: string;
  suffix: string;
  value: number;
  /** Decimals as written. */
  decimals: number;
  sig: number;
  /** Grouped with commas as written ("1,000,000"). */
  grouped: boolean;
}

/** Splits "\$5 billion" / "3.44\%" / "-3.03\%" / "25 bp" into prefix, value and suffix. */
export function parseNumberText(latex: string): ParsedNumber | null {
  if (typeof latex !== 'string') return null;
  const plain = latexTextToPlain(latex).replace(/\{,\}/g, ',');
  const m = /^([^\d\-−+]*?)([-−+]?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(plain.trim());
  if (!m) return null;
  const prefix = m[1].trim();
  if (prefix && !/^[$€£¥]$/.test(prefix)) return null;
  const raw = m[2].replace('−', '-');
  const digits = raw.replace(/[-+]/, '');
  if (/,\d{0,2}(?:\.|$)|,\d{4,}/.test(digits)) return null; // not a thousands separator
  const numStr = digits.replace(/,/g, '');
  const value = Number((raw.startsWith('-') ? '-' : '') + numStr);
  if (!Number.isFinite(value)) return null;
  const [int, frac = ''] = numStr.split('.');
  const decimals = frac.length;
  const sigStr = (int.replace(/^0+/, '') + frac).replace(/^0+/, '');
  const sig = decimals > 0 ? Math.max(1, sigStr.length) : Math.max(1, int.replace(/^0+/, '').replace(/0+$/, '').length);
  const suffix = m[3].replace(/[\s,.;:)\]]+$/, '');
  if (suffix.length > 16 || /\d/.test(suffix)) return null;
  return { prefix, suffix, value, decimals, sig, grouped: /,/.test(digits) };
}

/** Smallest of 1, 2, 2.5, 5 × 10^k that is ≥ x. */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const k = Math.floor(Math.log10(x));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const c = m * Math.pow(10, k);
    if (c >= x * (1 - 1e-12)) return c;
  }
  return 10 * Math.pow(10, k);
}

export function roundTo(x: number, step: number): number {
  const r = Math.round(x / step) * step;
  const d = decimalsOf(step);
  return Number(r.toFixed(Math.min(12, d)));
}

export function decimalsOf(step: number): number {
  return step >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

/**
 * The scale: width from the value's magnitude (a percentage near 100 gets a window below 100),
 * a fine step at three significant figures of the width (never coarser than the notes' own
 * precision, so the step does not give away how the number was written), and a random offset.
 */
export function buildScale(n: ParsedNumber, isPercent: boolean, rng: () => number): SliderScale | null {
  const v = n.value;
  const abs = Math.abs(v);
  // The notes' own precision: decimals as written, or the trailing zeros of a whole number.
  const trailing = n.decimals > 0 ? 0 : (/0+$/.exec(String(Math.round(abs)))?.[0].length ?? 0);
  const textStep = n.decimals > 0 ? Math.pow(10, -n.decimals) : abs === 0 ? 1 : Math.pow(10, trailing);
  const minWidth = n.decimals > 0 ? 20 * textStep : abs === 0 ? 10 : 0;
  const highPct = isPercent && v > 50 && v <= 100;
  let width = highPct ? niceCeil(Math.max(2.5 * (100 - v), minWidth, 20)) : niceCeil(Math.max(2.5 * abs, minWidth));
  if (isPercent && v >= 0 && v <= 100) width = Math.min(width, 100);
  const fine = Math.min(textStep, Math.pow(10, Math.floor(Math.log10(width)) - 2));
  const tick = width / 10;
  const detent = Math.max(fine, roundTo(width / 100, fine));
  // The answer lands between 15% and 85% along the rule, snapped to a tick for the bounds.
  const u = 0.15 + 0.7 * rng();
  let lo = Math.floor((v - width * u) / tick) * tick;
  if (v >= 0 && lo < 0) lo = 0;
  if (isPercent && v >= 0 && v <= 100 && lo + width > 100) lo = Math.max(0, 100 - width);
  lo = roundTo(lo, fine);
  const hi = roundTo(lo + width, fine);
  if (!(v >= lo && v <= hi) || !(hi > lo)) return null;
  // The answer must be settable exactly.
  if (Math.abs(roundTo(v, fine) - v) > fine * 1e-6) return null;
  const ticks: number[] = [];
  for (let i = 0; i <= 10; i++) ticks.push(roundTo(lo + tick * i, fine));
  // Start the thumb away from the answer: the opposite third of the rule.
  const along = (v - lo) / (hi - lo);
  const startAlong = along < 0.5 ? 0.75 + 0.15 * rng() : 0.1 + 0.15 * rng();
  const start = roundTo(lo + Math.round(((hi - lo) * startAlong) / detent) * detent, fine);
  return { lo, hi, detent, fine, ticks, start: Math.min(hi, Math.max(lo, start)) };
}

/** Readout for a value on the scale, in the notes' style (prefix, grouping, suffix). */
export function formatValue(v: number, p: Pick<SliderPayload, 'prefix' | 'suffix' | 'scale'>, grouped = false): string {
  const d = decimalsOf(p.scale.fine);
  let s = Math.abs(v).toFixed(d);
  if (d > 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (grouped || Math.abs(v) >= 10000) {
    const [i, f] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
  }
  const sign = v < 0 ? '−' : '';
  return `${sign}${p.prefix}${s}${p.suffix}`;
}

/** Reads a typed value: tolerates the unit, currency sign, commas and a unicode minus. */
export function parseTyped(input: string): number | null {
  const t = input.replace(/[−–]/g, '-').replace(/[,\s$€£¥%]/g, '').replace(/(bp|bps|million|billion|trillion|percent|m|bn)$/i, '');
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export type Verdict = 'exact' | 'close' | 'off';

/** Exact within the tolerance; "close" is a near miss (graded above a plain miss, still a miss). */
export function judge(guess: number, p: Pick<SliderPayload, 'answer' | 'tolerance' | 'scale'>): Verdict {
  const d = Math.abs(guess - p.answer);
  if (d <= p.tolerance + p.scale.fine * 1e-6) return 'exact';
  if (d <= Math.max(3 * p.tolerance, 0.05 * Math.abs(p.answer), p.scale.fine)) return 'close';
  return 'off';
}

// ---------------------------------------------------------------------------------------------
// Context: blanks and the short cue

interface Span {
  start: number;
  end: number;
}

/** Positions (outside math, whole numbers only) where the item's text sits in the context. */
export function findOccurrences(context: string, text: string): Span[] {
  const out: Span[] = [];
  if (!text) return out;
  let from = 0;
  for (;;) {
    const i = context.indexOf(text, from);
    if (i === -1) break;
    from = i + 1;
    const prev = context[i - 1] ?? '';
    const next = context[i + text.length] ?? '';
    const next2 = context[i + text.length + 1] ?? '';
    if (/\d/.test(text[0]) && /[\d.]/.test(prev)) continue;
    if (/\d/.test(text[0]) && prev === ',' && /\d/.test(context[i - 2] ?? '')) continue;
    if (/\d/.test(text[0]) && /[-−]/.test(prev) && !/[-−]/.test(context[i - 2] ?? '')) continue;
    if (/\d$/.test(text) && (/\d/.test(next) || (/[.,]/.test(next) && /\d/.test(next2)))) continue;
    if (inMath(context, i)) continue;
    out.push({ start: i, end: i + text.length });
  }
  return out;
}

/** True when position i is inside $…$ (counting unescaped dollars) or \( … \) / \[ … \]. */
export function inMath(s: string, i: number): boolean {
  let dollars = 0;
  let paren = 0;
  for (let k = 0; k < i; k++) {
    if (s[k] === '\\') {
      const n = s[k + 1];
      if (n === '(' || n === '[') paren++;
      else if (n === ')' || n === ']') paren = Math.max(0, paren - 1);
      k++;
      continue;
    }
    if (s[k] === '$') dollars++;
  }
  return dollars % 2 === 1 || paren > 0;
}

function words(latex: string): number {
  const t = toDisplay(latex);
  return t ? t.split(/\s+/).length : 0;
}

/** Clause boundaries at depth 0 outside math: after ". ", "; ", ": ", ", ", " — ", " -- ". */
export function clauseBreaks(s: string): number[] {
  const out: number[] = [];
  let depth = 0;
  let dollars = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') {
      k++;
      continue;
    }
    if (c === '$') dollars++;
    else if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    if (depth > 0 || dollars % 2 === 1) continue;
    if (/[.;:,!?]/.test(c) && /\s/.test(s[k + 1] ?? '') && !(c === '.' && /\d/.test(s[k - 1] ?? '') && /\d/.test(s[k + 2] ?? ''))) {
      out.push(k + 1);
    } else if ((c === '—' || s.startsWith('---', k) || s.startsWith('--', k)) && /\s/.test(s[k - 1] ?? '')) {
      out.push(k);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Splits [start, end) of the context into fragments around the occurrences that fall inside it. */
function fragments(context: string, occ: readonly Span[], start: number, end: number): string[] {
  const parts: string[] = [];
  let at = start;
  for (const o of occ) {
    if (o.start < start || o.end > end) continue;
    parts.push(context.slice(at, o.start));
    at = o.end;
  }
  parts.push(context.slice(at, end));
  return parts;
}

/**
 * The short cue for pressure: the clause holding the (first) blank, widened by neighbouring
 * clauses until it carries enough words to be answerable. A long clause is kept whole rather than cut
 * mid-phrase.
 */
export function shortCue(context: string, occ: readonly Span[], minWords = 7): string[] {
  const first = occ[0];
  const cuts = [0, ...clauseBreaks(context).filter((b) => b > 0 && b < context.length), context.length];
  const bounds = [...new Set(cuts)].sort((a, b) => a - b);
  let s = bounds.filter((b) => b <= first.start).pop() ?? 0;
  let e = bounds.find((b) => b >= first.end) ?? context.length;
  const grow = () => {
    const before = bounds.filter((b) => b < s).pop();
    const after = bounds.find((b) => b > e);
    const wb = before === undefined ? Infinity : words(context.slice(before, s));
    const wa = after === undefined ? Infinity : words(context.slice(e, after));
    if (wb === Infinity && wa === Infinity) return false;
    // Prefer the preceding clause: the subject usually sits before the number.
    if (wb <= wa + 4 && before !== undefined) s = before;
    else if (after !== undefined) e = after;
    else s = before!;
    return true;
  };
  while (words(context.slice(s, e)) < minWords && grow()) {
    /* widen */
  }
  const parts = fragments(context, occ, s, e);
  parts[0] = parts[0].replace(/^[\s,;:.—-]+/, '').replace(/^•\s*/, '');
  parts[parts.length - 1] = parts[parts.length - 1].replace(/[\s,;:—-]+$/, '');
  if (s > 0) parts[0] = `… ${parts[0]}`;
  if (e < context.length && !/[.!?]$/.test(parts[parts.length - 1])) parts[parts.length - 1] = `${parts[parts.length - 1]} …`;
  return parts;
}

// ---------------------------------------------------------------------------------------------
// Candidates

function asSubItem(x: SubItemLike): SubItem | null {
  return x && typeof x === 'object' ? x : null;
}

function rowText(row: TableRow, headers: readonly string[]): string {
  const hs = row.headers ?? headers;
  return row.cells
    .map((c, i) => ({ c: (c ?? '').trim(), h: (hs[i] ?? '').trim() }))
    .filter((x) => x.c)
    .map((x) => (x.h ? `${x.h}: ${x.c}` : x.c))
    .join('; ');
}

/** For a table numeric item whose context is a pipe-joined row: the row, as "Header: cell; …", and a label. */
function tableRowContext(b: Block, item: SubItem): { context: string; label: string } | null {
  const ctx = (item.context ?? '').trim();
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const headers = Array.isArray(b.headers) ? b.headers : [];
  const norm = (s: string) => s.replace(/\s*\|\s*/g, '|').replace(/\|+$/, '').trim();
  const row = rows.find((r) => Array.isArray(r.cells) && norm(r.cells.join(' | ')) === norm(ctx));
  if (!row) return null;
  const hs = row.headers ?? headers;
  const text = item.text ?? '';
  const col = row.cells.findIndex((c) => typeof c === 'string' && findOccurrences(c, text).length > 0);
  if (col === -1 || !(hs[col] ?? '').trim()) return null;
  // A label cell with words (not another number) so the cue names what the number belongs to.
  const label = row.cells.find((c, i) => i !== col && typeof c === 'string' && /[A-Za-z]{3,}/.test(latexTextToPlain(c)) && latexTextToPlain(c).length <= 80);
  if (!label) return null;
  // Rows that are mostly numbers are computation tables (copula steps, PIT values), not facts.
  const numeric = row.cells.filter((c) => typeof c === 'string' && /^[\s$\\%.,\-−\d()]+$/.test(c) && /\d/.test(c)).length;
  if (numeric > Math.ceil(row.cells.length / 2) + 1) return null;
  return { context: rowText(row, headers), label: toDisplay(label) };
}

export interface Candidate {
  item: SubItem;
  id: string;
  block: Block;
  objectiveId: string;
  context: string;
  occ: Span[];
  number: ParsedNumber;
  isPercent: boolean;
  approx: boolean;
  kind: 'sentence' | 'row';
  rowLabel: string | null;
  score: number;
}

function factScore(block: Block, context: string, number: ParsedNumber): number {
  const plain = toDisplay(context);
  let s = 0;
  if (FACT_CUE.test(plain)) s += 2;
  if (['keybox', 'defbox', 'notebox', 'gapbox', 'prose_para', 'figcap'].includes(block.type)) s += 1;
  if (block.type === 'trapbox' && !/consolidated/i.test(block.title ?? '')) s += 1;
  if (number.sig <= 2) s += 1;
  if (EXAMPLE_START.test(plain)) s -= 3;
  if (EXAMPLE_CUE.test(plain)) s -= 2;
  if (number.prefix && number.decimals > 0 && Math.abs(number.value) >= 10) s -= 2;
  return s;
}

/** Every numeric item in the reading that can be played faithfully, one per context. */
export function candidates(reading: Reading): Candidate[] {
  const out: Candidate[] = [];
  const seenCtx = new Set<string>();
  const seenId = new Set<string>();
  for (const o of reading.objectives ?? []) {
    for (const b of o.blocks ?? []) {
      if (!b || typeof b.id !== 'string' || SKIP_BLOCKS.has(b.type)) continue;
      for (const raw of Array.isArray(b.numeric_items) ? b.numeric_items : []) {
        const item = asSubItem(raw);
        if (!item || typeof item.id !== 'string' || seenId.has(item.id)) continue;
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        let context = typeof item.context === 'string' ? item.context.trim() : '';
        if (!text || !context) continue;
        const number = parseNumberText(text);
        if (!number || number.sig > MAX_SIG_DIGITS) continue;
        let kind: Candidate['kind'] = 'sentence';
        let rowLabel: string | null = null;
        if (/\s\|\s|\|$/.test(context)) {
          if (b.type !== 'table') continue;
          const row = tableRowContext(b, item);
          if (!row) continue;
          context = row.context;
          rowLabel = row.label;
          kind = 'row';
        }
        if (/^\s*(\$\$|\\\[|\\begin)/.test(context)) continue;
        const plain = toDisplay(context);
        if (/=/.test(plain.replace(/\$[^$]*\$/g, ''))) continue;
        const n = plain.split(/\s+/).length;
        if (n < MIN_WORDS || n > MAX_WORDS) continue;
        const occ = findOccurrences(context, text);
        if (occ.length === 0) continue;
        const key = `${plain.toLowerCase()}`;
        if (seenCtx.has(key)) continue;
        const score = factScore(b, context, number);
        if (score < -1) continue;
        const unit = (item.unit ?? '').toString();
        const isPercent = unit === '%' || /%|percent/.test(number.suffix);
        const before = context.slice(Math.max(0, occ[0].start - 24), occ[0].start);
        seenCtx.add(key);
        seenId.add(item.id);
        out.push({
          item,
          id: item.id,
          block: b,
          objectiveId: o.id,
          context,
          occ,
          number,
          isPercent,
          approx: APPROX.test(before),
          kind,
          rowLabel,
          score,
        });
      }
    }
  }
  return out;
}

export function supportsThreshold(reading: Reading): boolean {
  try {
    return candidates(reading).length >= MIN_ITEMS;
  } catch {
    return false;
  }
}

function leadFor(c: Candidate): string | null {
  if (c.rowLabel) return c.rowLabel;
  const title = c.block.title && !GENERIC_TITLE.test(c.block.title.trim()) ? toDisplay(c.block.title) : null;
  if (title && title.length <= 90) return title;
  const section = c.block.section ? toDisplay(c.block.section) : null;
  return section && section.length <= 90 ? section : null;
}

export function toPayload(c: Candidate, rng: () => number): SliderPayload | null {
  const scale = buildScale(c.number, c.isPercent, rng);
  if (!scale) return null;
  const tolerance = c.approx ? Math.max(scale.fine / 2, roundTo(0.1 * Math.abs(c.number.value), scale.fine)) : scale.fine / 2;
  const parts = fragments(c.context, c.occ, 0, c.context.length);
  const cue = c.kind === 'row' ? rowCue(c) : shortCue(c.context, c.occ);
  return {
    itemId: c.id,
    blockId: c.block.id,
    parts,
    cue,
    lead: leadFor(c),
    answerText: c.item.text ?? '',
    answer: c.number.value,
    prefix: c.number.prefix,
    suffix: c.number.suffix,
    scale,
    tolerance,
    approx: c.approx,
    kind: c.kind,
    score: c.score,
  };
}

/** For a table row: just "Header: ___", with the row label as the lead. */
function rowCue(c: Candidate): string[] {
  const segs = c.context.split('; ');
  const i = segs.findIndex((s) => findOccurrences(s, c.item.text ?? '').length > 0);
  const seg = i >= 0 ? segs[i] : c.context;
  const occ = findOccurrences(seg, c.item.text ?? '');
  return occ.length ? fragments(seg, occ, 0, seg.length) : fragments(c.context, c.occ, 0, c.context.length);
}

// ---------------------------------------------------------------------------------------------
// Plan

export interface ThresholdBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
  priorityCategory: TrapCategory | null;
}

/** Comfortable time to read the cue and set the slider, shrinking under pressure. */
export function timeFor(p: SliderPayload, pressureStep: number | null): number {
  const w = words(p.cue.join(' ')) + (p.lead ? words(p.lead) : 0);
  const base = Math.min(24000, Math.max(14000, 11000 + w * 400));
  if (pressureStep === null) return base + 6000;
  return Math.round(base * Math.pow(0.92, pressureStep));
}

/** Due first, then unseen, then the rest; within a tier, the more fact-like numbers first. */
function prioritise(cs: readonly Candidate[], ctx: ThresholdBuildInput): Candidate[] {
  const shuffled = shuffle(cs, ctx.rng);
  const band = (c: Candidate) => (c.score >= 3 ? 0 : c.score >= 1 ? 1 : 2);
  return shuffled
    .map((c, i) => ({ c, i }))
    .sort((a, b) => srsPriority(ctx.srs[a.c.id], ctx.today) - srsPriority(ctx.srs[b.c.id], ctx.today) || band(a.c) - band(b.c) || a.i - b.i)
    .map((x) => x.c);
}

export function buildThreshold(reading: Reading, ctx: ThresholdBuildInput): MechanicPlan<SliderPayload> | null {
  const all = candidates(reading);
  const pool = prioritise(all, ctx);
  if (pool.length < MIN_ITEMS) return null;
  const picked: { c: Candidate; p: SliderPayload }[] = [];
  for (const c of pool) {
    if (picked.length >= Math.min(MAX_ROUNDS, TARGET_ROUNDS)) break;
    const p = toPayload(c, ctx.rng);
    if (p) picked.push({ c, p });
  }
  if (picked.length < MIN_ITEMS) return null;
  const nDisc = Math.max(3, Math.min(5, Math.floor(picked.length / 2)));
  const disc = picked.slice(0, nDisc);
  const press = picked.slice(nDisc, nDisc + 5);
  if (press.length < 3) return null;
  // Discovery in reading order (the numbers build on each other); pressure shuffled.
  const readingOrder = new Map(all.map((c, i) => [c.id, i]));
  disc.sort((a, b) => (readingOrder.get(a.c.id) ?? 0) - (readingOrder.get(b.c.id) ?? 0));
  const pressure = shuffle(press, ctx.rng);

  const toRound = (x: { c: Candidate; p: SliderPayload }, phase: 'discovery' | 'pressure', step: number): MechanicRound<SliderPayload> => {
    const limit = phase === 'pressure' ? timeFor(x.p, step) : undefined;
    return {
      id: `${x.c.id}#${phase}`,
      phase,
      itemId: x.c.id,
      blockId: x.c.block.id,
      objectiveId: ctx.corpus.objectiveOfBlock[x.c.block.id] ?? x.c.objectiveId,
      timeLimitMs: limit,
      targetMs: limit ?? timeFor(x.p, null),
      payload: x.p,
    };
  };
  const rounds = [...disc.map((x) => toRound(x, 'discovery', 0)), ...pressure.map((x, i) => toRound(x, 'pressure', i))];
  const concept = namingFor(ctx.corpus, reading, rounds[0].payload);
  return {
    rounds,
    target: concept.term,
    opening: `${reading.reading_id} · Threshold Slider. ${rounds.length} numbers from this reading, each cut out of its sentence. Slide the marker to where the notes draw the line — first with the whole sentence in view, then from a short cue.`,
    concept,
  };
}

/** Naming (§8.3): the number and what it belongs to, the notes' sentence as the one line. */
export function namingFor(corpus: Corpus, reading: Reading, p: SliderPayload): ConceptNaming {
  const block = corpus.blockById[p.blockId];
  const sentence = toDisplay(p.parts.join(p.answerText));
  const emph = emphasised(p.parts.join(p.answerText)).filter((x) => x.split(/\s+/).length >= 2 && x.length <= 60)[0];
  const label = p.lead ?? emph ?? (block?.section ? toDisplay(block.section) : null) ?? reading.title;
  const value = formatValue(p.answer, p, false);
  const los = learningObjectives(reading);
  return {
    term: `${value} · ${label}`,
    blockId: p.blockId,
    objectiveId: corpus.objectiveOfBlock[p.blockId] ?? los[0]?.id ?? reading.reading_id,
    line: sentence,
  };
}

/** Names the first number the player missed in discovery, else the first one they set. */
export function nameAfterDiscovery(
  corpus: Corpus,
  reading: Reading,
  plan: MechanicPlan<SliderPayload>,
  discovery: readonly RoundResult[],
): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const missed = discovery.filter((d) => !d.correct).map((d) => byId.get(d.roundId)).filter((r): r is MechanicRound<SliderPayload> => !!r);
  const pick = missed[0] ?? plan.rounds.find((r) => r.phase === 'discovery');
  return pick ? namingFor(corpus, reading, pick.payload) : plan.concept;
}
