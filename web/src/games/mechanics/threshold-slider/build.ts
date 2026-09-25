// Threshold Slider (brief §7.2): pure round building. A number from the notes is blanked out of
// its sentence; the player sets a slider (or types) to the value. The scale is built around the
// true value (plausible bounds, random offset so the answer is never predictably central).
// Discovery shows the whole sentence with the number blanked; pressure shows only a short cue
// cut from the same sentence. Source: numeric_items on the reading's blocks, plus the horizons,
// multipliers, exception counts and dated events the extractor's regex does not capture (keyed to
// the bullet, table row or block that holds them). Every prompt is the notes' own text; nothing is
// generated.
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
  /\b(threshold|minimum|maximum|at least|at most|no more than|no less than|more than|less than|limit|cap|capped|floor|ratio|requir|must|set at|buffer|horizon|confidence|basel|regulat|percentile|trigger|benchmark|rule|standard|typically|between|range|ranging|weight|haircut|charge|multiplier|factor|coverage|leverage|surcharge|period|window|survival|stress|backtest|holding|remargin|look-?back|exception|zone|notch|downgrade|phased|deadline|introduced|adopted|crisis|collapse)/i;
const EXAMPLE_START = /^\s*(?:•\s*)?(?:suppose|assume|consider|given|say|imagine|for example|e\.g\.|if (?:a|an|the|we)\b)/i;
const EXAMPLE_CUE = /\b(worked example|worked illustration|illustration|we get|gives|yields|therefore|hence|thus|so the|plugging|substitut|would give|this example|in the example|here\))/i;
const GENERIC_TITLE = /^(?:trap|summary|remember|key (?:facts|points)|note|outcome|source|consolidated)/i;
/** Latest year a dated slider may reach. */
const YEAR_CEILING = 2030;
const YEAR_WIDTH = 40;

// Numbers the extractor's numeric_items regex does not capture (it takes %, bp and currency only).
// Each pattern matches the whole span that is blanked; the number is its first run of digits.
/** Horizons and windows: "30-day", "250 trading days", "12-month", "one-year" is words and is skipped. */
const DURATION_RE =
  /(?<![\w.,\\$])\d{1,3}(?:\.\d+)?(?:-|\s|~)(?:(?:trading|business|calendar|banking)(?:-|\s|~))?(?:days?|weeks?|months?|years?|quarters?|hours?)\b/g;
/** Counts that carry their own unit: "4 exceptions", "3 notches". */
const COUNT_RE = /(?<![\w.,\\$])\d{1,3}(?:\s|~)(?:exceptions?|notches|standard deviations)\b/g;
/** Multipliers: "3 times", "12.5 times", "a multiplier of 3". */
const TIMES_RE = /(?<![\w.,\\$])\d{1,2}(?:\.\d+)?(?:\s|~)times\b/g;
const MULTIPLIER_RE = /\b(?:multiplier|multiplication factor|scaling factor|scalar)(?:\s+(?:of|is|equal to|set at))+\s+(\d{1,2}(?:\.\d+)?)(?![\d%])/gi;
/** Years, only in sentences about an event, a framework or a deadline (never a citation or a data table). */
const YEAR_RE = /(?<![\w.,\\$/–-])(?:19[5-9]|20[0-3])\d(?![\w%]|[.,]\d|\s*(?:–|--?)\s*\d)/g;
const YEAR_CUE =
  /\b(?:basel|accord|act|amendment|crisis|collapsed?|fail(?:ed|ure)|bankrupt\w*|introduced|adopted|published|issued|enacted|passed|launched|reforms?|scandal|defaulted|phased|implement\w*|effective|took effect|came into|finali[sz]ed|regulators?|directive|breach|rescued?|bail(?:ed)?[- ]?out|nationali[sz]ed)\b/i;
/** Mined numbers must sit in a sentence that reads like a rule or a fact, not an illustration. */
const MINED_MIN_SCORE = 2;

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
  /** The notes group thousands with commas ("\$5,000"); the readout follows. */
  grouped: boolean;
  prefix: string;
  suffix: string;
  scale: SliderScale;
  /** Accepted absolute distance from the answer. */
  tolerance: number;
  approx: boolean;
  /** Where the number sat: a sentence, or a table row rendered "Header: cell; …". */
  kind: 'sentence' | 'row';
  /** What sort of number: a measure (%, currency, bp, ratio), a whole count (days, times) or a year. */
  numberKind: NumberKind;
  score: number;
}

export type NumberKind = 'measure' | 'count' | 'year';

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

/** Smallest of 1, 2, 2.5, 5 × 10^k that is ≥ x (without 2.5 when ticks must stay whole). */
export function niceCeil(x: number, whole = false): number {
  if (!(x > 0)) return 1;
  const k = Math.floor(Math.log10(x));
  for (const m of whole ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]) {
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
 * Counts (days, times, exceptions) step by whole units; years sit in a 40-year window.
 */
export function buildScale(n: ParsedNumber, isPercent: boolean, rng: () => number, kind: NumberKind = 'measure'): SliderScale | null {
  const v = n.value;
  const abs = Math.abs(v);
  let width: number;
  let fine: number;
  let tick: number;
  if (kind === 'year') {
    width = YEAR_WIDTH;
    fine = 1;
    tick = 5;
  } else if (kind === 'count') {
    width = niceCeil(Math.max(2.5 * abs, 10), true);
    fine = 1;
    tick = width / 10;
  } else {
    // The notes' own precision: decimals as written, or the trailing zeros of a whole number.
    const trailing = n.decimals > 0 ? 0 : (/0+$/.exec(String(Math.round(abs)))?.[0].length ?? 0);
    const textStep = n.decimals > 0 ? Math.pow(10, -n.decimals) : abs === 0 ? 1 : Math.pow(10, trailing);
    const minWidth = n.decimals > 0 ? 20 * textStep : abs === 0 ? 10 : 0;
    const highPct = isPercent && v > 50 && v <= 100;
    width = highPct ? niceCeil(Math.max(2.5 * (100 - v), minWidth, 20)) : niceCeil(Math.max(2.5 * abs, minWidth));
    if (isPercent && v >= 0 && v <= 100) width = Math.min(width, 100);
    fine = Math.min(textStep, Math.pow(10, Math.floor(Math.log10(width)) - 2));
    tick = width / 10;
  }
  const detent = kind === 'year' ? 1 : Math.max(fine, roundTo(width / 100, fine));
  // The answer lands between 15% and 85% along the rule, snapped to a tick for the bounds.
  const u = 0.15 + 0.7 * rng();
  let lo = Math.floor((v - width * u) / tick) * tick;
  if (kind !== 'year' && v >= 0 && lo < 0) lo = 0;
  if (isPercent && v >= 0 && v <= 100 && lo + width > 100) lo = Math.max(0, 100 - width);
  if (kind === 'year' && lo + width > YEAR_CEILING) lo = Math.floor((YEAR_CEILING - width) / tick) * tick;
  lo = roundTo(lo, fine);
  const hi = roundTo(lo + width, fine);
  if (!(v >= lo && v <= hi) || !(hi > lo)) return null;
  // The answer must be settable exactly.
  if (Math.abs(roundTo(v, fine) - v) > fine * 1e-6) return null;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + tick / 2; t += tick) ticks.push(roundTo(t, fine));
  // Start the thumb away from the answer: the opposite side of the rule.
  const along = (v - lo) / (hi - lo);
  const startAlong = along < 0.5 ? 0.75 + 0.15 * rng() : 0.1 + 0.15 * rng();
  let start = roundTo(lo + Math.round(((hi - lo) * startAlong) / detent) * detent, fine);
  start = Math.min(hi, Math.max(lo, start));
  if (Math.abs(start - v) < fine / 2) start = roundTo(along < 0.5 ? hi : lo, fine);
  return { lo, hi, detent, fine, ticks, start };
}

/** Readout for a value on the scale, in the notes' style (prefix, grouping, suffix). */
export function formatValue(v: number, p: Pick<SliderPayload, 'prefix' | 'suffix' | 'scale'> & { grouped?: boolean }, grouped = p.grouped ?? false): string {
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

/** Reads a typed value: tolerates the unit or any trailing words, a currency sign, commas and a unicode minus. */
export function parseTyped(input: string): number | null {
  let t = input.trim().replace(/[−–]/g, '-').replace(/[,\s$€£¥%]/g, '');
  t = t.replace(/-?[a-z][a-z-]*$/i, '');
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
  const hs = Array.isArray(row.headers) ? row.headers : headers;
  return row.cells
    .map((c, i) => ({ c: (typeof c === 'string' ? c : '').trim(), h: (typeof hs[i] === 'string' ? hs[i] : '').trim() }))
    .filter((x) => x.c)
    .map((x) => (x.h ? `${x.h}: ${x.c}` : x.c))
    .join('; ');
}

/**
 * For a number in a table row: the row as "Header: cell; …" and a label cell (words, not another
 * number) so the cue names what the number belongs to. Null for computation rows (mostly numbers),
 * header-less columns and rows with no label.
 */
function rowContext(b: Block, row: TableRow, text: string): { context: string; label: string } | null {
  if (!Array.isArray(row.cells)) return null;
  const headers = Array.isArray(b.headers) ? b.headers : [];
  const hs = Array.isArray(row.headers) ? row.headers : headers;
  const col = row.cells.findIndex((c) => typeof c === 'string' && findOccurrences(c, text).length > 0);
  if (col === -1 || typeof hs[col] !== 'string' || !hs[col].trim()) return null;
  const label = row.cells.find(
    (c, i) => i !== col && typeof c === 'string' && /[A-Za-z]{3,}/.test(latexTextToPlain(c)) && latexTextToPlain(c).length <= 80,
  );
  if (!label) return null;
  const numeric = row.cells.filter((c) => typeof c === 'string' && /^[\s$\\%.,\-−\d()]+$/.test(c) && /\d/.test(c)).length;
  if (numeric > Math.ceil(row.cells.length / 2) + 1) return null;
  return { context: rowText(row, headers), label: toDisplay(label) };
}

/** The table row a numeric item's pipe-joined context came from. */
function rowOfContext(b: Block, ctx: string): TableRow | null {
  const norm = (x: string) => x.replace(/\s*\|\s*/g, '|').replace(/\|+$/, '').trim();
  const rows = Array.isArray(b.rows) ? b.rows : [];
  return rows.find((r) => Array.isArray(r.cells) && norm(r.cells.join(' | ')) === norm(ctx)) ?? null;
}

/** True when the number is one end of a dashed range ("20--50\%", "25–30%"): half a range is not a fact. */
export function isRangeEnd(context: string, o: Span): boolean {
  const before = context.slice(Math.max(0, o.start - 12), o.start);
  const after = context.slice(o.end, o.end + 12);
  return /\d\$?(?:\\?%)?\$?\s*(?:–|--?)\s*$/.test(before) || /^\s*(?:\\?%)?\s*(?:–|--?)\s*\\?\$?\d/.test(after);
}

/** Splits text into sentences at ". " + capital outside math and braces; keeps lines apart. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const l = line.trim();
    if (!l) continue;
    let at = 0;
    let dollars = 0;
    let depth = 0;
    for (let k = 0; k < l.length; k++) {
      const c = l[k];
      if (c === '\\') {
        k++;
        continue;
      }
      if (c === '$') dollars++;
      else if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      if (dollars % 2 || depth || !/[.!?]/.test(c) || !/\s/.test(l[k + 1] ?? '') || !/[A-Z“"(\\•]/.test(l[k + 2] ?? '')) continue;
      if (/\b(?:e\.g|i\.e|vs|etc|approx|no|fig|eq|cf|st|mr|dr|inc|co|corp)$/i.test(l.slice(at, k))) continue;
      out.push(l.slice(at, k + 1).trim());
      at = k + 1;
    }
    const rest = l.slice(at).trim();
    if (rest) out.push(rest);
  }
  return out;
}

export interface MinedNumber {
  /** The span blanked, as written ("30-day", "250 trading days", "1996"). */
  text: string;
  kind: NumberKind;
}

/**
 * Horizons, counts, multipliers and dated events in one sentence, outside math. These are the
 * numbers the extractor's numeric_items regex skips (it takes %, bp and currency only).
 */
export function mineNumbers(sentence: string): MinedNumber[] {
  const out: MinedNumber[] = [];
  const seen = new Set<string>();
  const add = (text: string, index: number, kind: NumberKind) => {
    if (seen.has(text) || inMath(sentence, index)) return;
    seen.add(text);
    out.push({ text, kind });
  };
  const whole = (t: string) => (/^\d+(?=\D|$)/.exec(t) && !/^\d+\.\d/.test(t) ? 'count' : 'measure');
  for (const re of [DURATION_RE, COUNT_RE, TIMES_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(sentence); m; m = re.exec(sentence)) add(m[0], m.index, whole(m[0]));
  }
  MULTIPLIER_RE.lastIndex = 0;
  for (let m = MULTIPLIER_RE.exec(sentence); m; m = MULTIPLIER_RE.exec(sentence)) {
    add(m[1], m.index + m[0].length - m[1].length, whole(m[1]));
  }
  if (YEAR_CUE.test(toDisplay(sentence))) {
    YEAR_RE.lastIndex = 0;
    for (let m = YEAR_RE.exec(sentence); m; m = YEAR_RE.exec(sentence)) add(m[0], m.index, 'year');
  }
  return out;
}

export interface Candidate {
  item: SubItem;
  /** Stable SRS key: the numeric item's ID, else the bullet, table row or block the number sits in. */
  id: string;
  block: Block;
  objectiveId: string;
  context: string;
  occ: Span[];
  number: ParsedNumber;
  numberKind: NumberKind;
  isPercent: boolean;
  approx: boolean;
  kind: 'sentence' | 'row';
  rowLabel: string | null;
  /** True for numbers mined here rather than taken from numeric_items. */
  mined: boolean;
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
  if (EXAMPLE_CUE.test(plain)) s -= 3;
  // Currency with decimals (or zero) is a computed result, not a figure the notes ask you to hold.
  if (number.prefix && (number.decimals > 0 || number.value === 0)) s -= 2;
  return s;
}

interface RawNumber {
  id: string;
  text: string;
  context: string;
  kind: NumberKind;
  isPercent: boolean;
  mined: boolean;
  rowLabel: string | null;
  item: SubItem;
}

/** Numeric items as the extractor recorded them; table items are re-read as their row. */
function extracted(b: Block): RawNumber[] {
  const out: RawNumber[] = [];
  for (const raw of Array.isArray(b.numeric_items) ? b.numeric_items : []) {
    const item = asSubItem(raw);
    if (!item || typeof item.id !== 'string') continue;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    let context = typeof item.context === 'string' ? item.context.trim() : '';
    if (!text || !context) continue;
    let rowLabel: string | null = null;
    if (/\s\|\s|\|$/.test(context)) {
      if (b.type !== 'table') continue;
      const row = rowOfContext(b, context);
      const rc = row ? rowContext(b, row, text) : null;
      if (!rc) continue;
      context = rc.context;
      rowLabel = rc.label;
    }
    const unit = typeof item.unit === 'string' ? item.unit : '';
    const isPercent = unit === '%' || /\\?%|percent/.test(text);
    out.push({ id: item.id, text, context, kind: 'measure', isPercent, mined: false, rowLabel, item });
  }
  return out;
}

/** Mined numbers: bullets (keyed by bullet ID), table rows (row ID), other prose (block ID). */
function minedFrom(b: Block): RawNumber[] {
  const out: RawNumber[] = [];
  const push = (id: string, context: string, m: MinedNumber, rowLabel: string | null) =>
    out.push({ id, text: m.text, context, kind: m.kind, isPercent: false, mined: true, rowLabel, item: { id, parent: b.id, subtype: 'mined', text: m.text, context } });
  const bullets = (Array.isArray(b.bullets) ? b.bullets : []).map(asSubItem).filter((x): x is SubItem => !!x && typeof x.id === 'string' && typeof x.text === 'string');
  for (const bl of bullets) for (const sen of sentences(bl.text ?? '')) for (const m of mineNumbers(sen)) push(bl.id!, sen, m, null);
  if (b.type === 'table') {
    for (const row of Array.isArray(b.rows) ? b.rows : []) {
      if (!row || typeof row.id !== 'string' || !Array.isArray(row.cells)) continue;
      for (const cell of row.cells) {
        if (typeof cell !== 'string') continue;
        for (const m of mineNumbers(cell)) {
          const rc = rowContext(b, row, m.text);
          if (rc) push(row.id, rc.context, m, rc.label);
        }
      }
    }
    return out;
  }
  const plain = typeof b.plain_text === 'string' ? b.plain_text : '';
  const lines = plain.split(/\n+/).filter((l) => !(bullets.length && /^\s*(?:•|\d+[.)]\s)/.test(l)));
  for (const sen of sentences(lines.join('\n'))) for (const m of mineNumbers(sen)) push(b.id, sen, m, null);
  return out;
}

/** Every number in the reading that can be played faithfully: one candidate per number per context. */
export function candidates(reading: Reading): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const o of Array.isArray(reading.objectives) ? reading.objectives : []) {
    for (const b of Array.isArray(o.blocks) ? o.blocks : []) {
      if (!b || typeof b.id !== 'string' || SKIP_BLOCKS.has(b.type)) continue;
      // Learning-objective lists restate the syllabus, not the notes' facts.
      if (typeof b.title === 'string' && /learning objectives/i.test(b.title)) continue;
      for (const r of [...extracted(b), ...minedFrom(b)]) {
        const number = parseNumberText(r.text);
        if (!number) continue;
        if (r.kind === 'year' ? !Number.isInteger(number.value) : number.sig > MAX_SIG_DIGITS) continue;
        if (/^\s*(\$\$|\\\[|\\begin)/.test(r.context)) continue;
        const plain = toDisplay(r.context);
        if (/=/.test(plain.replace(/\$[^$]*\$/g, ''))) continue;
        const n = plain.split(/\s+/).length;
        if (n < MIN_WORDS || n > MAX_WORDS) continue;
        const occ = findOccurrences(r.context, r.text);
        if (occ.length === 0 || occ.some((x) => isRangeEnd(r.context, x))) continue;
        const key = `${plain.toLowerCase()}|${number.value}`;
        if (seen.has(key)) continue;
        const score = factScore(b, r.context, number);
        if (score < 0) continue;
        // A mined number must read as a rule: a year needs its event (checked when mined), anything
        // else a threshold / horizon cue, so maturities in instrument names ("a 5-year swap") stay out.
        if (r.mined && (score < MINED_MIN_SCORE || (r.kind !== 'year' && !FACT_CUE.test(plain)))) continue;
        seen.add(key);
        const before = r.context.slice(Math.max(0, occ[0].start - 24), occ[0].start);
        out.push({
          item: r.item,
          id: r.id,
          block: b,
          objectiveId: o.id,
          context: r.context,
          occ,
          number,
          numberKind: r.kind,
          isPercent: r.isPercent,
          approx: APPROX.test(before),
          kind: r.rowLabel ? 'row' : 'sentence',
          rowLabel: r.rowLabel,
          mined: r.mined,
          score,
        });
      }
    }
  }
  return out;
}

/** Candidates usable together in one session: distinct item IDs and distinct contexts, in order. */
export function distinctCandidates(cs: readonly Candidate[]): Candidate[] {
  const ids = new Set<string>();
  const ctxs = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cs) {
    const k = toDisplay(c.context).toLowerCase();
    if (ids.has(c.id) || ctxs.has(k)) continue;
    ids.add(c.id);
    ctxs.add(k);
    out.push(c);
  }
  return out;
}

export function supportsThreshold(reading: Reading): boolean {
  try {
    return distinctCandidates(candidates(reading)).length >= MIN_ITEMS;
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
  const scale = buildScale(c.number, c.isPercent, rng, c.numberKind);
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
    grouped: c.number.grouped,
    prefix: c.number.prefix,
    suffix: c.number.suffix,
    scale,
    tolerance,
    approx: c.approx,
    kind: c.kind,
    numberKind: c.numberKind,
    score: c.score,
  };
}

/** For a table row: just "Header: ___" (cut to its clause when the cell is long), with the row label as the lead. */
function rowCue(c: Candidate): string[] {
  const text = c.item.text ?? '';
  const segs = c.context.split('; ');
  const i = segs.findIndex((x) => findOccurrences(x, text).length > 0);
  const seg = i >= 0 ? segs[i] : c.context;
  const occ = findOccurrences(seg, text);
  if (!occ.length) return fragments(c.context, c.occ, 0, c.context.length);
  if (words(seg) > 24) {
    const header = /^[^:]{1,60}:\s/.exec(seg);
    const cut = shortCue(seg, occ);
    // Keep the column header in front so the cue still says which column the number sits in.
    if (header && !cut[0].startsWith(header[0])) cut[0] = `${header[0].trim()} ${cut[0]}`;
    return cut;
  }
  return fragments(seg, occ, 0, seg.length);
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
  // Prioritise first, then keep one number per item ID and per sentence, so no round shows
  // another round's answer and every round reviews its own SRS item.
  const pool = distinctCandidates(prioritise(all, ctx));
  if (pool.length < MIN_ITEMS) return null;
  const picked: { c: Candidate; p: SliderPayload }[] = [];
  // At most two rounds share an answer ("15 business days" five times over teaches nothing new).
  const sameAnswer = new Map<string, number>();
  for (const pass of [0, 1]) {
    for (const c of pool) {
      if (picked.length >= Math.min(MAX_ROUNDS, TARGET_ROUNDS)) break;
      if (picked.some((x) => x.c === c)) continue;
      const key = `${c.number.value}|${c.number.suffix.trim().toLowerCase()}`;
      if (pass === 0 && (sameAnswer.get(key) ?? 0) >= 2) continue;
      const p = toPayload(c, ctx.rng);
      if (!p) continue;
      picked.push({ c, p });
      sameAnswer.set(key, (sameAnswer.get(key) ?? 0) + 1);
    }
  }
  if (picked.length < MIN_ITEMS) return null;
  const nDisc = Math.max(3, Math.min(5, Math.floor(picked.length / 2)));
  const disc = picked.slice(0, nDisc);
  const press = picked.slice(nDisc, nDisc + 5);
  if (press.length < 3) return null;
  // Discovery in reading order (the numbers build on each other); pressure shuffled.
  const readingOrder = new Map(all.map((c, i) => [c, i]));
  disc.sort((a, b) => (readingOrder.get(a.c) ?? 0) - (readingOrder.get(b.c) ?? 0));
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
  const value = formatValue(p.answer, p);
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
