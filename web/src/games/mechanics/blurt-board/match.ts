// Blurt Board: the pure free-recall matcher. The player's board (free text, one idea per line or
// running prose) is split into segments; each extracted item of the objective carries weighted
// keywords (light stems), explicit acronyms and, for numeric items, the number itself. An item is
// hit when one segment carries enough of it. No React; unit-tested in node against the real JSON.
import { toDisplay } from '../../text';

export type TargetKind = 'term' | 'point' | 'number' | 'variable';

export interface KeyWord {
  /** Light stem, lower case. */
  s: string;
  /** Weight: rarer words in the reading count for more. */
  w: number;
}

/** One extracted item of an objective, ready to match. Everything shown comes from the notes. */
export interface BlurtTarget {
  /** Stable sub-item ID (term / bullet / numeric item / variable): the SRS key. */
  itemId: string;
  blockId: string;
  kind: TargetKind;
  /** LaTeX from the notes, shown on the board after the check. */
  display: string;
  /** The number (numeric items) or symbol (variables), as LaTeX. */
  label?: string;
  keys: KeyWord[];
  /** Acronyms that on their own recall the item (a term's "(EAD)", or its initials). */
  acronyms: string[];
  /** Numeric items: values that count as the number (value, and value × scale). */
  values: number[];
  /** Numeric items: the number is a percentage. */
  pct?: boolean;
  /** Direction words the item states; writing only their opposites is a flip, not a hit. */
  directions: string[];
}

export interface Hit {
  /** Index of the segment that carried the item. */
  segment: number;
  /** The player's own words that matched. */
  text: string;
  score: number;
}

export interface TargetResult {
  itemId: string;
  hit: Hit | null;
  /** Best partial match when missed (shown as "closest you came"). */
  near: Hit | null;
  /** The player's segment turned the item's direction around. */
  flipped: Hit | null;
}

export interface BoardCheck {
  segments: string[];
  results: Record<string, TargetResult>;
  /** Segment index → item IDs it matched (targets and extras). */
  segmentHits: string[][];
}

// ---------------------------------------------------------------------------------------------
// Normalisation

const STOP = new Set(
  (
    'a an the and or but nor so yet of to in on at by for with from into onto over under about as than then that this these those ' +
    'is are was were be been being am do does did done has have had having it its it\'s they them their there here which who whom whose ' +
    'what when where why how can could may might must shall should will would not no also only just very such each every any all some ' +
    'one ones other another both either neither more most less least much many few own same too via per i we you he she his her our your ' +
    'if else because while whereas although though since until unless whether up down out off e.g i.e eg ie etc vs versus rather ' +
    'called known use used using make makes made give gives given get gets way ways thing things something'
  ).split(/\s+/),
);

const GREEK_NAMES: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', θ: 'theta', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu',
  π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega', Δ: 'delta', Γ: 'gamma', Σ: 'sigma',
  Φ: 'phi', Ω: 'omega', Λ: 'lambda', Θ: 'theta',
};

/** Plain lower-case text of a LaTeX snippet, with Greek letters spelled out. */
export function plainOf(latex: string): string {
  let t = toDisplay(latex);
  // Leftover math (kept as $…$ for KaTeX): drop command names except Greek, keep letters/digits.
  t = t.replace(/\\([a-zA-Z]+)/g, (_, name: string) => (/^(alpha|beta|gamma|delta|epsilon|theta|kappa|lambda|mu|nu|pi|rho|sigma|tau|phi|chi|psi|omega)$/i.test(name) ? ` ${name.toLowerCase()} ` : ' '));
  t = t.replace(/[αβγδεθκλμνπρστφχψωΔΓΣΦΩΛΘ]/g, (c) => ` ${GREEK_NAMES[c] ?? c} `);
  return t.replace(/[${}^_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Light, symmetric stemmer: same rule on both sides matters more than linguistic accuracy. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[’']s$/, '').replace(/[’']/g, '');
  // British / American spelling: -ise → -ize, -isation → -ization, -our → -or.
  w = w.replace(/is(e|ed|es|ing|ation|ations|er|ers)$/, 'iz$1').replace(/our$/, 'or');
  if (w.length > 5 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 5 && /(sses|shes|ches|xes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 6 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 5 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 5 && w.endsWith('ly')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** Word tokens (letters/digits), lower case. Hyphens and slashes split words. */
export function words(plain: string): string[] {
  return plain
    .toLowerCase()
    .split(/[^\p{L}\p{N}’']+/u)
    .map((w) => w.replace(/^[’']+|[’']+$/g, ''))
    .filter(Boolean);
}

export function isContent(w: string): boolean {
  return w.length >= 2 && !STOP.has(w) && !/^\d/.test(w);
}

/** Content stems of a plain text, in order, de-duplicated. */
export function contentStems(plain: string): string[] {
  const out: string[] = [];
  for (const w of words(plain)) {
    if (!isContent(w)) continue;
    const s = stem(w);
    if (s.length >= 2 && !out.includes(s)) out.push(s);
  }
  return out;
}

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Stems match exactly, by a shared long prefix (liquid / liquidity), or within a typo. */
export function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length >= 5 && long.startsWith(short)) return true;
  if (short.length >= 5) return lev(a, b, short.length >= 9 ? 2 : 1) <= (short.length >= 9 ? 2 : 1);
  return false;
}

// ---------------------------------------------------------------------------------------------
// Numbers

export interface NumberToken {
  value: number;
  pct: boolean;
}

const SCALE: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mn: 1e6, billion: 1e9, bn: 1e9, b: 1e9, trillion: 1e12, tn: 1e12 };

/** Numbers in plain text, with % / percent / basis points and thousand/million/billion scales. */
export function parseNumbers(plain: string): NumberToken[] {
  const out: NumberToken[] = [];
  const re = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d*\.\d+|\d+)\s*(%|percent|per cent|bps?|basis points?|thousand|million|billion|trillion|mn|bn|tn|k|m|b)?(?![\p{L}\p{N}])/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) {
    const v = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v)) continue;
    const unit = (m[2] ?? '').toLowerCase();
    const pct = unit === '%' || unit.startsWith('percent') || unit === 'per cent';
    out.push({ value: v, pct });
    if (SCALE[unit]) out.push({ value: v * SCALE[unit], pct: false });
    if (/^(bps?|basis)/.test(unit)) out.push({ value: v / 100, pct: true });
  }
  return out;
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function numberMatches(t: BlurtTarget, seen: readonly NumberToken[]): boolean {
  for (const n of seen) {
    for (const v of t.values) {
      if (sameNumber(n.value, v)) return true;
      // "1%" written as "0.01", or the other way round.
      if (t.pct && !n.pct && sameNumber(n.value * 100, v)) return true;
      if (!t.pct && n.pct && sameNumber(n.value / 100, v)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Directions: a line that says "lower" where the notes say "higher" is a flip, not a hit.

const DIRECTION_PAIRS: [string, string][] = [
  ['higher', 'lower'], ['increase', 'decrease'], ['rise', 'fall'], ['more', 'less'], ['above', 'below'], ['before', 'after'],
  ['positive', 'negative'], ['wider', 'narrower'], ['widen', 'narrow'], ['greater', 'smaller'], ['larger', 'smaller'],
  ['overstate', 'understate'], ['maximum', 'minimum'], ['buy', 'sell'], ['inflow', 'outflow'], ['long', 'short'],
  ['stabiliz', 'destabiliz'], ['upper', 'lower'], ['earlier', 'later'], ['faster', 'slower'], ['strengthen', 'weaken'],
];
const OPPOSITE = new Map<string, string>();
for (const [a, b] of DIRECTION_PAIRS) {
  OPPOSITE.set(stem(a), stem(b));
  OPPOSITE.set(stem(b), stem(a));
}

export function directionStems(plain: string): string[] {
  const out: string[] = [];
  for (const w of words(plain)) {
    const s = stem(w);
    if (OPPOSITE.has(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Segments

/** Splits the board into lines (ideas), dropping list markers and blank lines. */
export function segmentBoard(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n|\s+[•·]\s+/)) {
    const s = line.replace(/^\s*(?:[-*•·>]+|\(?(?:\d{1,2}|[a-z])[.)])\s+/i, '').trim();
    if (s && /[\p{L}\p{N}]/u.test(s)) out.push(s);
  }
  return out;
}

/** Longest line matched as a whole; longer lines (running prose) match sentence by sentence. */
export const MAX_UNIT_WORDS = 40;

/** Matching units of one line: the line itself, or its sentences and adjacent sentence pairs. */
export function lineUnits(line: string): string[] {
  if (line.split(/\s+/).length <= MAX_UNIT_WORDS) return [line];
  const sentences = line.split(/(?<=[.!?])\s+(?=\S)/).filter((x) => /[\p{L}\p{N}]/u.test(x));
  const out = [...sentences];
  for (let i = 0; i + 1 < sentences.length; i++) out.push(`${sentences[i]} ${sentences[i + 1]}`);
  return out;
}

interface SegmentIndex {
  stems: string[];
  stemSet: Set<string>;
  wordSet: Set<string>;
  numbers: NumberToken[];
}

function indexSegment(seg: string): SegmentIndex {
  const plain = plainOf(seg);
  const ws = words(plain);
  const stems = ws.map(stem);
  return { stems, stemSet: new Set(stems), wordSet: new Set(ws), numbers: parseNumbers(plain) };
}

function hasStem(ix: SegmentIndex, s: string): boolean {
  if (ix.stemSet.has(s)) return true;
  if (s.length < 5) return false;
  return ix.stems.some((x) => x.length >= 5 && stemsMatch(x, s));
}

/** Share of the target's keyword weight present in the segment, and how many keywords. */
function coverage(t: BlurtTarget, ix: SegmentIndex): { score: number; count: number } {
  let total = 0;
  let got = 0;
  let count = 0;
  for (const k of t.keys) {
    total += k.w;
    if (hasStem(ix, k.s)) {
      got += k.w;
      count++;
    }
  }
  return { score: total > 0 ? got / total : 0, count };
}

/** Keyword-share threshold and minimum keyword count for a hit, by kind and size. */
export function hitRule(t: BlurtTarget): { share: number; min: number } {
  const n = t.keys.length;
  switch (t.kind) {
    case 'term':
      return { share: n >= 4 ? 0.5 : n === 3 ? 0.6 : 0.99, min: Math.min(n, n >= 4 ? 2 : n) };
    case 'variable':
      return { share: 0.5, min: Math.min(2, n) };
    case 'point':
      return { share: n >= 8 ? 0.35 : 0.4, min: Math.min(n, 2) };
    case 'number':
      return { share: 0, min: Math.min(1, n) };
  }
}

function flips(t: BlurtTarget, ix: SegmentIndex): boolean {
  if (!t.directions.length) return false;
  return t.directions.some((d) => !ix.stemSet.has(d) && ix.stemSet.has(OPPOSITE.get(d) ?? ''));
}

/** Scores one target against one segment: 0 when not a hit; the keyword share otherwise. */
export function scoreSegment(t: BlurtTarget, ix: SegmentIndex): { hit: boolean; score: number; flipped: boolean } {
  const acronymHit = t.acronyms.some((a) => ix.wordSet.has(a));
  if (t.kind === 'number') {
    if (!numberMatches(t, ix.numbers)) return { hit: false, score: 0, flipped: false };
    const { score, count } = coverage(t, ix);
    const rule = hitRule(t);
    const hit = count >= rule.min || acronymHit;
    return { hit: hit && !flips(t, ix), score: Math.max(0.5, score), flipped: hit && flips(t, ix) };
  }
  const { score, count } = coverage(t, ix);
  const rule = hitRule(t);
  const byWords = count >= rule.min && score >= rule.share && count > 0;
  // A variable's spelled-out symbol ("lambda") needs one keyword of its definition alongside it.
  const hit = byWords || (acronymHit && (t.kind !== 'variable' || count >= 1));
  const flipped = hit && flips(t, ix);
  return { hit: hit && !flipped, score: acronymHit && hit ? Math.max(score, 1) : score, flipped };
}

/** Checks a whole board against targets (logged) and extras (shown as "also recalled"). */
export function checkBoard(text: string, targets: readonly BlurtTarget[], extras: readonly BlurtTarget[] = []): BoardCheck {
  const segments = segmentBoard(text);
  const units = segments.flatMap((line, i) => lineUnits(line).map((u) => ({ i, text: u, ix: indexSegment(u) })));
  const results: Record<string, TargetResult> = {};
  const segmentHits: string[][] = segments.map(() => []);
  const all = [...targets, ...extras];
  for (const t of all) {
    let hit: Hit | null = null;
    let near: Hit | null = null;
    let flipped: Hit | null = null;
    units.forEach(({ i, text: unitText, ix }) => {
      const r = scoreSegment(t, ix);
      const h = { segment: i, text: unitText, score: r.score };
      if (r.hit && (!hit || r.score > hit.score)) hit = h;
      else if (r.flipped && !flipped) flipped = h;
      else if (!r.hit && r.score >= 0.3 && (!near || r.score > near.score)) near = h;
    });
    results[t.itemId] = { itemId: t.itemId, hit, near: hit ? null : near, flipped: hit ? null : flipped };
    const h = hit as Hit | null;
    if (h) segmentHits[h.segment].push(t.itemId);
  }
  return { segments, results, segmentHits };
}
