// Cloze Chain (PORTAL_PLAN §3c): pure round building. Load-bearing sentences from one objective,
// in the order the notes give them, each with its key word blanked: a marked term (\term), a
// bolded phrase (\textbf), a defbox's own title, a number with its unit, the correct side of an
// "X, not Y" contrast, or a direction word (higher / lower, before / after, …). Every sentence is
// the notes' own text; every option offered as a cue comes from the same reading (or area).
import type { Corpus } from '../../corpus';
import type { Block, BlockType, ItemSrs, Objective, Reading, SubItem, SubItemLike, TrapCategory } from '../../types';
import { isLearningObjective } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { toDisplay } from '../../text';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { AnswerKey } from './match';
import { firstNumber, levenshtein, normAnswer } from './match';

export type ClozeKind = 'term' | 'bold' | 'definition' | 'contrast' | 'number' | 'direction';

export interface ClozePayload {
  kind: ClozeKind;
  /** LaTeX of the sentence before and after the blank (the notes' own text). */
  before: string;
  after: string;
  /** The blanked word or phrase, as display text. */
  answer: string;
  key: AnswerKey;
  /** Three options (the answer and two from the same reading or area), for the second cue. */
  options: string[];
  /** First letter (or digit) of the answer, for the first cue. */
  firstLetter: string;
  /** Title of the source block, if it has a non-generic one. */
  blockTitle: string | null;
  /** Position of the sentence in the reading (document order). */
  order: number;
}

export const MIN_LINK = 3;
export const MAX_LINK = 5;
export const MIN_ROUNDS = 6;
export const TARGET_PER_PHASE = 4;

/** Block types whose sentences are load-bearing prose (worked examples, tables, figures excluded). */
const SENTENCE_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>(['prose_para', 'keybox', 'defbox', 'trapbox', 'notebox', 'gapbox']);
const SKIP_TITLE = /objective|label collision|ordering note|stale wording|numbering warning|correction to the reconciliation/i;
const GENERIC_TITLE = /^(remember|note|lesson|direction|just remember|trap|traps|key (facts|points)|summary)\b/i;

// ---------------------------------------------------------------------------------------------
// Direction words: the antonym is always the first distractor.

type DirForm = 'comp' | 'verb' | 'verb-base' | 'verb-ed' | 'verb-ing' | 'adj' | 'prep' | 'noun' | 'super';
const DIRECTION_PAIRS: [string, string, DirForm][] = [
  ['higher', 'lower', 'comp'],
  ['larger', 'smaller', 'comp'],
  ['wider', 'narrower', 'comp'],
  ['longer', 'shorter', 'comp'],
  ['faster', 'slower', 'comp'],
  ['earlier', 'later', 'comp'],
  ['greater', 'smaller', 'comp'],
  ['more', 'less', 'comp'],
  ['highest', 'lowest', 'super'],
  ['largest', 'smallest', 'super'],
  ['increases', 'decreases', 'verb'],
  ['rises', 'falls', 'verb'],
  ['widens', 'narrows', 'verb'],
  ['overstates', 'understates', 'verb'],
  ['strengthens', 'weakens', 'verb'],
  ['increase', 'decrease', 'verb-base'],
  ['rise', 'fall', 'verb-base'],
  ['widen', 'narrow', 'verb-base'],
  ['overstate', 'understate', 'verb-base'],
  ['increased', 'decreased', 'verb-ed'],
  ['overstated', 'understated', 'verb-ed'],
  ['increasing', 'decreasing', 'verb-ing'],
  ['rising', 'falling', 'verb-ing'],
  ['widening', 'narrowing', 'verb-ing'],
  ['positive', 'negative', 'adj'],
  ['upward', 'downward', 'adj'],
  ['stabilising', 'destabilising', 'adj'],
  ['stabilizing', 'destabilizing', 'adj'],
  ['procyclical', 'countercyclical', 'adj'],
  ['above', 'below', 'prep'],
  ['before', 'after', 'prep'],
  ['inflows', 'outflows', 'noun'],
  // Second antonyms: "reduce" pairs with "increase", which keeps "decrease" as its own first antonym.
  ['reduces', 'increases', 'verb'],
  ['reduce', 'increase', 'verb-base'],
  ['reduced', 'increased', 'verb-ed'],
  ['raises', 'lowers', 'verb'],
];
const DIR_INFO = new Map<string, { antonym: string; form: DirForm }>();
for (const [a, b, form] of DIRECTION_PAIRS) {
  if (!DIR_INFO.has(a)) DIR_INFO.set(a, { antonym: b, form });
  if (!DIR_INFO.has(b)) DIR_INFO.set(b, { antonym: a, form });
}

/**
 * What each direction word moves along, and which way (+1 / -1). Words on the same axis with the
 * same sign are near-synonyms ("higher" / "greater", "reduces" / "lowers"): one can never be offered
 * as a wrong option for the other, and a typed synonym counts as held. The third option (after the
 * antonym) always comes from a different axis, so it is wrong without being the antonym again.
 */
const DIR_AXIS: Record<string, [string, 1 | -1]> = {};
const axis = (name: string, up: string[], down: string[]) => {
  for (const w of up) DIR_AXIS[w] = [name, 1];
  for (const w of down) DIR_AXIS[w] = [name, -1];
};
axis(
  'size',
  ['higher', 'larger', 'greater', 'more', 'wider', 'highest', 'largest', 'increases', 'rises', 'widens', 'raises', 'increase', 'rise', 'widen', 'increased', 'increasing', 'rising', 'widening'],
  ['lower', 'smaller', 'less', 'narrower', 'lowest', 'smallest', 'decreases', 'falls', 'narrows', 'lowers', 'reduces', 'decrease', 'fall', 'narrow', 'reduce', 'decreased', 'reduced', 'decreasing', 'falling', 'narrowing'],
);
axis('length', ['longer'], ['shorter']);
axis('speed', ['faster'], ['slower']);
axis('time', ['later', 'after'], ['earlier', 'before']);
axis('place', ['above'], ['below']);
axis('sign', ['positive', 'upward'], ['negative', 'downward']);
axis('statement', ['overstates', 'overstate', 'overstated'], ['understates', 'understate', 'understated']);
axis('strength', ['strengthens'], ['weakens']);
axis('stability', ['stabilising', 'stabilizing'], ['destabilising', 'destabilizing']);
axis('cycle', ['procyclical'], ['countercyclical']);
axis('flow', ['inflows'], ['outflows']);

/** Same-form words that mean the same direction as `w` ("higher" → "larger", "greater"). */
export function directionSynonyms(w: string): string[] {
  const a = DIR_AXIS[w.toLowerCase()];
  const info = DIR_INFO.get(w.toLowerCase());
  if (!a || !info) return [];
  return [...DIR_INFO.entries()]
    .filter(([x, i]) => x !== w.toLowerCase() && i.form === info.form && DIR_AXIS[x]?.[0] === a[0] && DIR_AXIS[x]?.[1] === a[1])
    .map(([x]) => x);
}
const DIRECTION_RE = new RegExp(`(?<![\\\\\\w-])(${[...DIR_INFO.keys()].sort((a, b) => b.length - a.length).join('|')})(?![\\w-])`, 'gi');

const STOPWORDS = new Set(
  'a an the of to in on for and or but is are was were be by with as at from that this these those it its not no than then there their which who whom what when where how also only both each either neither nor all any some such so very can may might will would should could must do does did has have had'.split(
    ' ',
  ),
);

// ---------------------------------------------------------------------------------------------
// Sentences from a block's LaTeX

interface Unit {
  latex: string;
  /** True when the unit is a list item (maps to a bullet sub-item). */
  item: boolean;
}

function stripComments(s: string): string {
  return s.replace(/(^|[^\\])%.*$/gm, '$1');
}

const DISPLAY_ENV =
  /\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\begin\{(equation|align|alignat|gather|multline|tabular|tabularx|longtable|tikzpicture|figure|table|center|minipage|array|verbatim|flalign)(\*?)\}[\s\S]*?\\end\{\1\2\}/g;

/** Splits a block body into paragraph and list-item units; display math, tables and figures are dropped. */
export function unitsOf(latex: string): Unit[] {
  let t = stripComments(latex);
  t = t.replace(DISPLAY_ENV, '\n\n');
  t = t.replace(/\\(?:begin|end)\{(?:itemize|enumerate|description|compactitem|compactenum)\}(?:\[[^\]]*\])?/g, '\n\n');
  t = t.replace(/\\(?:smallskip|medskip|bigskip|noindent|par|tcblower|small|footnotesize|centering|hfill|newline|linebreak)\b/g, ' ');
  t = t.replace(/\\vspace\*?\{[^}]*\}|\\hspace\*?\{[^}]*\}/g, ' ');
  t = t.replace(/\\(?:begin|end)\{[^}]*\}(?:\[[^\]]*\])?/g, '\n\n');
  const out: Unit[] = [];
  const parts = t.split(/\\item\b\s*/);
  parts.forEach((part, i) => {
    let p = part;
    if (i > 0) {
      const lab = /^\[([^\]]*)\]\s*/.exec(p);
      if (lab) p = `\\textbf{${lab[1]}} ${p.slice(lab[0].length)}`;
    }
    const paras = p.split(/\n\s*\n/);
    paras.forEach((para, j) => {
      const s = para.replace(/\s+/g, ' ').trim();
      if (s) out.push({ latex: s, item: i > 0 && j === 0 });
    });
  });
  return out;
}

const ABBREV = /(?:^|[\s(])(?:e\.g|i\.e|vs|cf|etc|fig|figs|eq|eqs|approx|no|st|inc|ltd|co|al|mr|dr|u\.s|u\.k|resp|incl|pp|sec|ch|art|para)\.$/i;

/** Splits a unit into sentences at top level (outside braces and math). */
export function splitSentences(unit: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let math = false;
  let start = 0;
  for (let i = 0; i < unit.length; i++) {
    const ch = unit[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === '$') math = !math;
    else if ((ch === '.' || ch === '?' || ch === '!') && !math) {
      // A sentence may end inside a bold lead-in: "\textbf{… not dollar.} The source …".
      const m = /^([}'’”)]*)\s+(?=[A-Z\\$`“(0-9])/.exec(unit.slice(i + 1));
      if (!m) continue;
      const closing = (m[1].match(/\}/g) ?? []).length;
      if (depth - closing !== 0) continue;
      const head = unit.slice(start, i + 1);
      if (ABBREV.test(head) || /(?:^|\s)[A-Z]\.$/.test(head)) continue;
      // A short bold lead-in ("\term{Bootstrap historical simulation.} This is …") stays with its sentence.
      if (closing > 0 && words(toDisplay(head)).length <= 6) continue;
      out.push((head + m[1]).trim());
      start = i + 1 + m[1].length;
      i += m[1].length;
      depth = 0;
    }
  }
  const rest = unit.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** [start, end) ranges of inline math ($…$) in a sentence. */
function mathRanges(s: string): [number, number][] {
  const out: [number, number][] = [];
  let open = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '$') {
      if (open < 0) open = i;
      else {
        out.push([open, i + 1]);
        open = -1;
      }
    }
  }
  return out;
}
const inRanges = (i: number, rs: readonly [number, number][]) => rs.some(([a, b]) => i >= a && i < b);

// ---------------------------------------------------------------------------------------------
// Candidates

interface Target {
  kind: ClozeKind;
  start: number;
  end: number;
  /** Display answer. */
  answer: string;
  itemId: string;
  numeric?: { value: number | null; scale: string | null; unit: string | null };
  /** Contrast: the "not Y" side, a natural distractor. */
  foil?: string;
}

export interface Candidate {
  itemId: string;
  kind: ClozeKind;
  blockId: string;
  objectiveId: string;
  readingId: string;
  before: string;
  after: string;
  answer: string;
  /** Forms accepted as the same answer. */
  accept: string[];
  numeric?: Target['numeric'];
  foil?: string;
  blockTitle: string | null;
  /** Document order within the reading. */
  order: number;
}

export interface Sentence {
  objectiveId: string;
  blockId: string;
  order: number;
  /** Candidate blanks in this sentence, best-first by kind. */
  targets: Candidate[];
}

const KIND_RANK: Record<ClozeKind, number> = { definition: 0, term: 0, bold: 0, contrast: 1, number: 2, direction: 3 };

const key = (s: string) => normAnswer(s);
const words = (s: string) => s.split(/\s+/).filter(Boolean);

function stripTrailingPunct(s: string): { core: string; punct: string } {
  const m = /^(.*?)([\s:;,.]*)$/s.exec(s);
  return { core: (m?.[1] ?? s).trim(), punct: (m?.[2] ?? '').trim() };
}

/** Forms of an answer the player may type: "Business Continuity Management (BCM)" → also "BCM" and the long form. */
export function alternativesOf(answer: string): string[] {
  const out = new Set([answer]);
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(answer);
  if (m && m[1].trim()) {
    out.add(m[1].trim());
    out.add(m[2].trim());
  }
  const noArticle = answer.replace(/^(the|a|an)\s+/i, '');
  if (noArticle) out.add(noArticle);
  return [...out];
}

function answerOk(answer: string, kind: ClozeKind): boolean {
  if (!answer || answer.length > 40 || /[$\\{}]/.test(answer)) return false;
  if (!/[\p{L}\p{N}]/u.test(answer)) return false;
  const ws = words(answer);
  if (ws.length > 4) return false;
  // Cross-references ("CR-14 e") are pointers, not content.
  if (/\b[A-Z]{2,3}-\d+\b/.test(answer)) return false;
  if (kind !== 'number' && kind !== 'direction') {
    const content = ws.filter((w) => !STOPWORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')));
    if (!content.length) return false;
    // A marked number ("0.8 to 0.0") or an enumerated label ("1. Unconditional coverage") is not a word to recall.
    if (!content.some((w) => /\p{L}{2}/u.test(w))) return false;
    if (/^(\(?[0-9ivx]{1,4}[.)]|[a-h][.)])\s/i.test(answer)) return false;
    // "Second step", "Step 3": the position in a list, not content.
    if (/^(first|second|third|fourth|fifth|sixth|final|last|next)\s+(step|stage|phase)s?$|^(step|stage|phase)\s+\d+$/i.test(answer)) return false;
  }
  return true;
}

function subItems(list: SubItemLike[] | undefined): SubItem[] {
  return (list ?? []).filter((x): x is SubItem => typeof x === 'object' && x !== null && typeof x.id === 'string');
}

function subText(x: SubItem): string {
  return typeof x.text === 'string' ? x.text : typeof x.plain_text === 'string' ? x.plain_text : '';
}

/** Finds the balanced-brace argument of a macro starting at `open` (index of '{'); returns end index after '}'. */
function braceEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Spans of the notes' marked vocabulary (\term) and bolded load-bearing phrases (\textbf). */
function macroTargets(s: string, block: Block): Target[] {
  const out: Target[] = [];
  const terms = subItems(block.terms);
  const bolds = subItems(block.bold_claims);
  const re = /\\(term|textbf)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].length - 1;
    const end = braceEnd(s, open);
    if (end < 0) continue;
    const inner = s.slice(open + 1, end - 1);
    const disp = toDisplay(inner);
    const { core } = stripTrailingPunct(disp);
    const k = key(core);
    if (!k) continue;
    const match = (x: SubItem) => key(stripTrailingPunct(toDisplay(subText(x))).core) === k;
    const sub = m[1] === 'term' ? (terms.find(match) ?? bolds.find(match)) : (bolds.find(match) ?? terms.find(match));
    if (!sub?.id) continue;
    out.push({ kind: m[1] === 'term' ? 'term' : 'bold', start: m.index, end, answer: core, itemId: sub.id });
  }
  return out;
}

function numberTargets(s: string, block: Block): Target[] {
  const out: Target[] = [];
  // Trap boxes' numbers are mostly wrong-answer builds and intermediate results, not facts to hold.
  if (block.type === 'trapbox') return out;
  const maths = mathRanges(s);
  for (const n of subItems(block.numeric_items)) {
    const text = subText(n).trim();
    if (!text) continue;
    const variants = [...new Set([text, text.replace(/(?<!\\)%/g, '\\%'), text.replace(/\\%/g, '%')])];
    for (const v of variants) {
      let from = 0;
      let hit = -1;
      while ((from = s.indexOf(v, from)) >= 0) {
        const before = s[from - 1] ?? ' ';
        const after = s[from + v.length] ?? ' ';
        if (!/[\w.,]/.test(before) && !/\d/.test(after) && !(after === '.' && /\d/.test(s[from + v.length + 1] ?? ''))) {
          hit = from;
          break;
        }
        from += v.length;
      }
      if (hit < 0) continue;
      let start = hit;
      let end = hit + v.length;
      if (inRanges(hit, maths)) {
        const r = maths.find(([a, b]) => hit >= a && hit < b)!;
        if (s.slice(r[0] + 1, r[1] - 1).trim() !== v) break;
        [start, end] = r;
      }
      const answer = toDisplay(s.slice(start, end)).trim();
      const value = typeof n.value === 'number' ? n.value : firstNumber(answer);
      const scale = typeof (n as { scale?: unknown }).scale === 'string' ? ((n as { scale?: string }).scale ?? null) : null;
      out.push({
        kind: 'number',
        start,
        end,
        answer,
        itemId: n.id!,
        numeric: { value, scale, unit: typeof n.unit === 'string' ? n.unit : null },
      });
      break;
    }
  }
  return out;
}

/** The innermost bold / list-item / block ID that contains a position, for sentence-level blanks. */
function containerId(s: string, pos: number, block: Block, bulletId: string | null): string {
  const bolds = subItems(block.bold_claims);
  const re = /\\textbf\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const end = braceEnd(s, m.index + m[0].length - 1);
    if (end > pos && m.index < pos) {
      const k = key(stripTrailingPunct(toDisplay(s.slice(m.index + m[0].length, end - 1))).core);
      const b = bolds.find((x) => key(stripTrailingPunct(toDisplay(subText(x))).core) === k);
      if (b?.id) return b.id;
    }
  }
  return bulletId ?? block.id;
}

function directionTargets(s: string, block: Block, bulletId: string | null): Target[] {
  const out: Target[] = [];
  const maths = mathRanges(s);
  DIRECTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIRECTION_RE.exec(s))) {
    if (inRanges(m.index, maths)) continue;
    // "gives rise to" is an idiom, not a direction.
    if (/^rise$/i.test(m[0]) && /\b(give|gives|gave|given|giving)\s*$/i.test(s.slice(0, m.index))) continue;
    // "the formula above", "see below", "sits above them": position in the text, not a direction.
    if (/^(above|below)$/i.test(m[0])) {
      const next = s.slice(m.index + m[0].length);
      const prev = s.slice(0, m.index);
      if (/^\s*([.,;:)]|$|them\b|it\b|this\b|these\b)/.test(next)) continue;
      if (/\b(formula|equation|table|figure|example|see|shown|noted|discussed|listed|described|given|as)\s*$/i.test(prev)) continue;
    }
    out.push({ kind: 'direction', start: m.index, end: m.index + m[0].length, answer: m[0], itemId: containerId(s, m.index, block, bulletId) });
  }
  return out;
}

/** "… the spread distribution, not the price distribution" → blank "spread", foil "price". */
function contrastTargets(s: string, block: Block, bulletId: string | null): Target[] {
  const out: Target[] = [];
  const maths = mathRanges(s);
  const re = /,\s+not\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (inRanges(m.index, maths)) continue;
    const clean = (w: string) => w.replace(/^[^A-Za-z]+|[^A-Za-z-]+$/g, '');
    // Right side: words up to the first punctuation.
    const right: string[] = [];
    const rs = s.slice(m.index + m[0].length);
    const rws = rs.split(/\s+/).filter(Boolean);
    // The "not Y" side must be plain words running to punctuation or the sentence end; a phrase cut
    // short by a possessive, math or a macro ("not the portfolio's volatility") gives no clean foil.
    let clean_ = false;
    for (let k = 0; k < rws.length; k++) {
      const w = rws[k];
      const c = clean(w);
      if (!c || !/^[A-Za-z][A-Za-z-]*$/.test(c) || !/^[“"‘'(]?[A-Za-z][A-Za-z-]*[”"’')]*[.,;:!?)}]*$/.test(w)) break;
      right.push(c.toLowerCase());
      if (/[.,;:)}]/.test(w) || k === rws.length - 1) {
        clean_ = true;
        break;
      }
      if (right.length >= 6) break;
    }
    if (!right.length || !clean_) continue;
    // Left side: word tokens with positions, nearest last.
    const left: { w: string; start: number; end: number }[] = [];
    const lre = /\S+/g;
    let lm: RegExpExecArray | null;
    const ls = s.slice(0, m.index);
    while ((lm = lre.exec(ls))) {
      const raw = lm[0];
      const lead = /^[^A-Za-z]*/.exec(raw)![0].length;
      const c = clean(raw);
      left.push({ w: c.toLowerCase(), start: lm.index + lead, end: lm.index + lead + c.length });
    }
    if (!left.length) continue;
    let suffix = 0;
    while (suffix < right.length - 1 && suffix < left.length - 1 && right[right.length - 1 - suffix] === left[left.length - 1 - suffix].w) suffix++;
    const rCore = right.slice(0, right.length - suffix);
    const lCore = left.slice(Math.max(0, left.length - suffix - rCore.length), left.length - suffix);
    let p = 0;
    while (p < rCore.length - 1 && p < lCore.length - 1 && rCore[p] === lCore[p].w) p++;
    let x = lCore.slice(p);
    let y = rCore.slice(p);
    while (y.length > 1 && /^(a|an|the)$/.test(y[0])) y = y.slice(1);
    if (!y.length || y.every((w) => STOPWORDS.has(w))) continue;
    while (x.length > 1 && /^(a|an|the)$/.test(x[0].w)) x = x.slice(1);
    if (x.length && STOPWORDS.has(x[0].w)) continue;
    if (!x.length || x.length > 3 || x.some((t) => !/^[a-z][a-z-]*$/.test(t.w) || inRanges(t.start, maths))) continue;
    if (x.map((t) => t.w).join(' ') === y.join(' ')) continue;
    if (x.every((t) => STOPWORDS.has(t.w))) continue;
    const start = x[0].start;
    const end = x[x.length - 1].end;
    out.push({
      kind: 'contrast',
      start,
      end,
      answer: s.slice(start, end),
      itemId: containerId(s, start, block, bulletId),
      foil: y.join(' '),
    });
  }
  return out;
}

function titleOf(b: Block): string | null {
  const t = typeof b.title === 'string' ? toDisplay(b.title) : '';
  return t && !GENERIC_TITLE.test(t) ? t : null;
}

/** Wraps a target into a candidate if the blanked sentence still reads as a clue. */
function toCandidate(s: string, t: Target, block: Block, objectiveId: string, readingId: string, order: number): Candidate | null {
  if (!answerOk(t.answer, t.kind)) return null;
  // A trap box's leading label ("\term{Sibling.}", "\textbf{Polarity:}") names the trap shape, not content.
  if (
    block.type === 'trapbox' &&
    (t.kind === 'term' || t.kind === 'bold') &&
    !s.slice(0, t.start).trim() &&
    (/[.:]$/.test(toDisplay(s.slice(t.start, t.end))) || /^[.:]/.test(s.slice(t.end).trim()))
  ) {
    return null;
  }
  // A marked word that is itself a direction ("\textbf{falls}") is drilled as one: antonym first.
  const kind: ClozeKind = (t.kind === 'term' || t.kind === 'bold') && DIR_INFO.has(t.answer.toLowerCase()) ? 'direction' : t.kind;
  const tail = t.kind === 'term' || t.kind === 'bold' ? stripTrailingPunct(toDisplay(s.slice(t.start, t.end))).punct : '';
  const before = s.slice(0, t.start);
  const after = (tail ? tail + ' ' : '') + s.slice(t.end);
  const rest = toDisplay(`${before} ${after}`);
  if (words(rest).length < 5) return null;
  const accept = alternativesOf(t.answer);
  const restKey = ` ${key(rest)} `;
  // The answer must not be sitting elsewhere in the sentence.
  if (accept.some((a) => key(a).length >= 2 && restKey.includes(` ${key(a)} `))) return null;
  return {
    itemId: t.itemId,
    kind,
    blockId: block.id,
    objectiveId,
    readingId,
    before,
    after,
    answer: t.answer,
    accept,
    numeric: t.numeric,
    foil: t.foil,
    blockTitle: titleOf(block),
    order,
  };
}

function sentenceOk(s: string): boolean {
  if (/\\begin|\\end|&|\\\\|\\item/.test(s)) return false;
  const n = words(toDisplay(s)).length;
  return n >= 6 && n <= 60;
}

/** Bullet sub-item for a list-item unit, matched on display text. */
function bulletFor(unit: Unit, block: Block, used: Set<string>): string | null {
  if (!unit.item) return null;
  const u = key(toDisplay(unit.latex));
  for (const b of subItems(block.bullets)) {
    if (used.has(b.id!)) continue;
    const k = key(toDisplay(subText(b)));
    if (k && (k === u || k.startsWith(u) || u.startsWith(k))) {
      used.add(b.id!);
      return b.id!;
    }
  }
  return null;
}

function blockSentences(block: Block, objectiveId: string, readingId: string, counter: { n: number }): Sentence[] {
  const out: Sentence[] = [];
  if (!block || typeof block.id !== 'string' || !SENTENCE_BLOCKS.has(block.type)) return out;
  if (typeof block.title === 'string' && SKIP_TITLE.test(block.title)) return out;
  const body = typeof block.body_latex === 'string' ? block.body_latex : '';
  if (!body.trim()) return out;
  const usedBullets = new Set<string>();
  let first = true;
  for (const unit of unitsOf(body)) {
    const bulletId = bulletFor(unit, block, usedBullets);
    for (const s of splitSentences(unit.latex)) {
      if (!sentenceOk(s)) continue;
      const order = counter.n++;
      const raw: Target[] = [];
      // A defbox's first sentence: blank the defined term itself (its title).
      if (first && block.type === 'defbox' && typeof block.title === 'string') {
        const deft = subItems(block.terms).find((x) => (x as { term_source?: string }).term_source === 'deftitle') ?? null;
        const title = stripTrailingPunct(toDisplay(block.title)).core;
        // Titles that list several things ("Liquid asset, liquid market", "The four term structures") aren't one term.
        const listy = /,|^(the )?(two|three|four|five|six|seven|eight|nine|ten)\b|^\d/i.test(title);
        if (deft?.id && title && !listy) {
          const head = `\\textbf{${block.title}}`;
          const c = toCandidate(`${head}: ${s}`, { kind: 'definition', start: 0, end: head.length, answer: title, itemId: deft.id }, block, objectiveId, readingId, order);
          if (c) {
            out.push({ objectiveId, blockId: block.id, order, targets: [c] });
            first = false;
            continue;
          }
        }
      }
      first = false;
      raw.push(...macroTargets(s, block), ...contrastTargets(s, block, bulletId), ...numberTargets(s, block), ...directionTargets(s, block, bulletId));
      const targets: Candidate[] = [];
      for (const t of raw) {
        const c = toCandidate(s, t, block, objectiveId, readingId, order);
        if (c && !targets.some((x) => x.itemId === c.itemId && x.answer === c.answer)) targets.push(c);
      }
      targets.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
      if (targets.length) out.push({ objectiveId, blockId: block.id, order, targets });
    }
  }
  return out;
}

const sentenceCache = new WeakMap<Reading, Sentence[]>();

/** Every cloze-able sentence in a reading, in document order. Malformed blocks are skipped. */
export function readingSentences(reading: Reading): Sentence[] {
  const hit = sentenceCache.get(reading);
  if (hit) return hit;
  const counter = { n: 0 };
  const out: Sentence[] = [];
  for (const o of Array.isArray(reading.objectives) ? reading.objectives : []) {
    if (!o || typeof o.id !== 'string') continue;
    for (const b of Array.isArray(o.blocks) ? o.blocks : []) {
      try {
        out.push(...blockSentences(b, o.id, reading.reading_id, counter));
      } catch {
        // Content is still being refined; a block we can't read is skipped, never fatal.
      }
    }
  }
  sentenceCache.set(reading, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Chains

export interface BuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
  priorityCategory?: TrapCategory | null;
}

/** One blank per sentence, one round per item ID: the best target by SRS tier, then kind. */
function chooseTargets(sentences: readonly Sentence[], input: Pick<BuildInput, 'srs' | 'today' | 'rng'> | null): Candidate[] {
  const used = new Set<string>();
  const out: Candidate[] = [];
  for (const s of sentences) {
    const scored = s.targets
      .filter((t) => !used.has(t.itemId))
      .map((t) => ({
        t,
        score: (input ? srsPriority(input.srs[t.itemId], input.today) * 10 : 0) + KIND_RANK[t.kind] * 2 + (input ? input.rng() : 0),
      }))
      .sort((a, b) => a.score - b.score);
    const best = scored[0]?.t;
    if (!best) continue;
    used.add(best.itemId);
    out.push(best);
  }
  return out;
}

/** Candidates grouped by objective, in reading order; objectives with fewer than MIN_LINK dropped. */
function threads(
  reading: Reading,
  corpus: Corpus,
  input: Pick<BuildInput, 'srs' | 'today' | 'rng'> | null,
): { objective: Objective; links: Candidate[] }[] {
  // Only blanks that can offer the three-choice cue are playable.
  const playable = readingSentences(reading)
    .map((s) => ({ ...s, targets: s.targets.filter((t) => hasOptions(t, reading, corpus)) }))
    .filter((s) => s.targets.length > 0);
  const chosen = chooseTargets(playable, input);
  const out: { objective: Objective; links: Candidate[] }[] = [];
  for (const o of reading.objectives) {
    const links = chosen.filter((c) => c.objectiveId === o.id);
    if (links.length >= MIN_LINK) out.push({ objective: o, links });
  }
  return out;
}

interface ChainPlan {
  discovery: Candidate[];
  pressure: Candidate[];
  score: number;
}

function linkScore(c: Candidate, input: Pick<BuildInput, 'srs' | 'today'> | null): number {
  if (!input) return 0;
  const p = srsPriority(input.srs[c.itemId], input.today);
  return p === 0 ? 3 : p === 1 ? 1 : 0;
}

/**
 * Picks the chain: ideally one objective long enough to carry both phases (discovery, then the
 * thread continues under pressure); else two objectives, the second following the first. Windows
 * are scored by due items (3) and unseen items (1); lettered LOs are preferred over intro sections.
 */
function planChain(reading: Reading, corpus: Corpus, input: BuildInput | null): ChainPlan | null {
  const ts = threads(reading, corpus, input);
  const rng = input?.rng ?? (() => 0);
  const plans: ChainPlan[] = [];
  const loBonus = (o: Objective) => (isLearningObjective(o) ? 2 : 0);
  const windowScore = (xs: readonly Candidate[]) => xs.reduce((n, c) => n + linkScore(c, input), 0);
  for (const { objective, links } of ts) {
    if (links.length < MIN_ROUNDS) continue;
    const total = Math.min(2 * TARGET_PER_PHASE, links.length);
    const d = Math.max(MIN_LINK, Math.min(TARGET_PER_PHASE, Math.floor(total / 2)));
    const p = total - d;
    for (let s = 0; s + total <= links.length; s++) {
      const w = links.slice(s, s + total);
      plans.push({ discovery: w.slice(0, d), pressure: w.slice(d, d + p), score: windowScore(w) + loBonus(objective) + 2 + rng() * 0.5 });
    }
  }
  for (let i = 0; i < ts.length; i++) {
    for (let j = 0; j < ts.length; j++) {
      if (i === j) continue;
      const a = ts[i];
      const b = ts[j];
      const d = Math.min(TARGET_PER_PHASE, a.links.length);
      const p = Math.min(TARGET_PER_PHASE, b.links.length);
      const follows = j === i + 1 ? 1 : 0;
      let best: ChainPlan | null = null;
      for (let s = 0; s + d <= a.links.length; s++) {
        for (let u = 0; u + p <= b.links.length; u++) {
          const disc = a.links.slice(s, s + d);
          const pres = b.links.slice(u, u + p);
          const score = windowScore(disc) + windowScore(pres) + (loBonus(a.objective) + loBonus(b.objective)) / 2 + follows * 0.5 + rng() * 0.5;
          if (!best || score > best.score) best = { discovery: disc, pressure: pres, score };
        }
      }
      if (best) plans.push(best);
    }
  }
  if (!plans.length) return null;
  plans.sort((x, y) => y.score - x.score);
  return plans[0];
}

const supportCache = new WeakMap<Reading, boolean>();

/** True when some objective (or two) carries a full chain of at least six linked sentences. */
export function supportsCloze(reading: Reading, corpus: Corpus): boolean {
  const hit = supportCache.get(reading);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    const plan = planChain(reading, corpus, null);
    ok = !!plan && plan.discovery.length >= MIN_LINK && plan.pressure.length >= MIN_LINK;
  } catch {
    ok = false;
  }
  supportCache.set(reading, ok);
  return ok;
}

// ---------------------------------------------------------------------------------------------
// Options (the second cue): the answer plus two from the same reading, else the same area.

function sameUnitClass(a: Candidate, b: Candidate): boolean {
  const ua = a.numeric?.unit ?? null;
  const ub = b.numeric?.unit ?? null;
  return ua === ub && (a.numeric?.scale ?? null) === (b.numeric?.scale ?? null);
}

function allTargets(reading: Reading): Candidate[] {
  return readingSentences(reading).flatMap((s) => s.targets);
}

function distractorsFor(c: Candidate, reading: Reading, corpus: Corpus, rng: () => number): string[] | null {
  const sentenceKey = ` ${key(toDisplay(`${c.before} ${c.after}`))} `;
  const ansKeys = c.accept.map(key);
  const foilKey = c.foil ? key(c.foil) : null;
  const chosen: string[] = [];
  const taken = new Set(ansKeys);
  const ok = (x: string) => {
    const k = key(x);
    if (!k || taken.has(k)) return false;
    if (ansKeys.some((a) => a.includes(k) || k.includes(a))) return false;
    // Never a synonym of a direction answer ("greater" for "higher").
    if (c.kind === 'direction' && directionSynonyms(c.answer).includes(x.toLowerCase())) return false;
    // Two options that are one phrase and its extension ("coverage" / "unconditional coverage") read as a hint.
    const sq = k.replace(/\s+/g, '');
    if (chosen.some((o) => {
      const q = key(o).replace(/\s+/g, '');
      return q.includes(sq) || sq.includes(q);
    })) return false;
    if (c.kind !== 'direction' && k !== foilKey && sentenceKey.includes(` ${k} `)) return false;
    return true;
  };
  const add = (x: string) => {
    if (chosen.length < 2 && ok(x)) {
      chosen.push(x);
      taken.add(key(x));
    }
  };

  if (c.kind === 'direction') {
    const info = DIR_INFO.get(c.answer.toLowerCase());
    if (!info) return null;
    const cap = (w: string) => (/^[A-Z]/.test(c.answer) ? w[0].toUpperCase() + w.slice(1) : w);
    add(cap(info.antonym));
    // A third word of the same grammatical form, preferring one the reading itself uses.
    const used = shuffle(
      allTargets(reading)
        .filter((t) => t.kind === 'direction')
        .map((t) => t.answer.toLowerCase()),
      rng,
    );
    const ax = DIR_AXIS[c.answer.toLowerCase()]?.[0];
    // Same grammatical form, different axis: never a synonym of the answer, never a second antonym.
    // An -ing slot also takes the -ing adjectives ("rising" / "falling" / "stabilising").
    const formOk = (w: string) => DIR_INFO.get(w)?.form === info.form || (info.form === 'verb-ing' && /ing$/.test(w));
    const sameForm = (w: string) => formOk(w) && w !== info.antonym && w !== c.answer.toLowerCase() && !!ax && DIR_AXIS[w]?.[0] !== ax;
    for (const w of used) if (sameForm(w)) add(cap(w));
    for (const [a, b] of shuffle(DIRECTION_PAIRS, rng)) for (const w of [a, b]) if (sameForm(w)) add(cap(w));
    return chosen.length === 2 ? shuffle([c.answer, ...chosen], rng) : null;
  }

  if (c.kind === 'contrast' && c.foil) add(c.foil);

  const sameReading = allTargets(reading);
  const areaReadings = (corpus.readingsByArea[reading.area] ?? []).filter((r) => r.reading_id !== reading.reading_id);
  const tiers: (() => Candidate[])[] = [
    () => sameReading.filter((t) => t.objectiveId === c.objectiveId),
    () => sameReading.filter((t) => t.objectiveId !== c.objectiveId),
    () => areaReadings.flatMap(allTargets),
  ];
  const wantNumber = c.kind === 'number';
  const wc = words(c.answer).length;
  for (const tier of tiers) {
    if (chosen.length >= 2) break;
    const pool = tier().filter((t) => (wantNumber ? t.kind === 'number' && sameUnitClass(t, c) && t.numeric?.value !== c.numeric?.value : t.kind !== 'number' && t.kind !== 'direction'));
    const ranked = shuffle(pool, rng)
      .map((t, i) => ({ t, i, d: wantNumber ? 0 : Math.abs(words(t.answer).length - wc) + (/^[A-Z]/.test(t.answer) === /^[A-Z]/.test(c.answer) ? 0 : 0.5) }))
      .sort((a, b) => a.d - b.d || a.i - b.i);
    for (const { t } of ranked) add(t.answer);
  }
  return chosen.length === 2 ? shuffle([c.answer, ...chosen], rng) : null;
}

const optionsCache = new WeakMap<Candidate, boolean>();

/** Whether a blank can offer its three-choice cue (independent of the shuffle). */
function hasOptions(c: Candidate, reading: Reading, corpus: Corpus): boolean {
  const hit = optionsCache.get(c);
  if (hit !== undefined) return hit;
  const ok = distractorsFor(c, reading, corpus, () => 0) !== null;
  optionsCache.set(c, ok);
  return ok;
}

function firstLetterOf(answer: string): string {
  const m = /[\p{L}\p{N}]/u.exec(answer);
  return m ? m[0] : answer.slice(0, 1);
}

export function toPayload(c: Candidate, reading: Reading, corpus: Corpus, rng: () => number): ClozePayload | null {
  const options = distractorsFor(c, reading, corpus, rng);
  if (!options) return null;
  const reject = options.filter((o) => o !== c.answer);
  const dir = c.kind === 'direction' ? DIR_INFO.get(c.answer.toLowerCase()) : undefined;
  if (dir && !reject.includes(dir.antonym)) reject.push(dir.antonym);
  if (c.foil && !reject.includes(c.foil)) reject.push(c.foil);
  // A spelling trap ("GARP writes Jegadeesh, not Jagadeesh"): the sentence's own near-miss is wrong.
  if (c.kind !== 'number' && c.kind !== 'direction' && words(c.answer).length === 1) {
    const a = key(c.answer).replace(/\s+/g, '');
    for (const w of words(key(toDisplay(`${c.before} ${c.after}`)))) {
      if (w !== a && Math.abs(w.length - a.length) <= 2 && w[0] === a[0] && levenshtein(w, a) <= 2 && !reject.includes(w)) reject.push(w);
    }
  }
  return {
    kind: c.kind,
    before: c.before,
    after: c.after,
    answer: c.answer,
    key: {
      kind: c.kind === 'number' ? 'number' : c.kind === 'direction' ? 'direction' : 'text',
      accept: c.accept,
      reject,
      value: c.numeric?.value ?? null,
      scale: c.numeric?.scale ?? null,
      near: c.kind === 'direction' ? directionSynonyms(c.answer) : [],
    },
    options,
    firstLetter: firstLetterOf(c.answer),
    blockTitle: c.blockTitle,
    order: c.order,
  };
}

// ---------------------------------------------------------------------------------------------
// Timing and grades

/** Comfortable read-and-type time for a sentence, tightening across the pressure chain. */
export function timeFor(p: ClozePayload, pressureStep: number | null): number {
  const n = words(toDisplay(`${p.before} ${p.after}`)).length;
  const base = Math.min(30000, Math.max(14000, 9000 + n * 350));
  if (pressureStep === null) return Math.round(base * 1.5);
  return Math.round(base * Math.pow(0.93, pressureStep));
}

export type CueLevel = 0 | 1 | 2;

/**
 * SRS grade for a cloze answer. A cue lowers it: recalled with the first letter caps at 3 (still a
 * pass, so the interval grows slowly); recognised from three options gives 2 (a lapse: it comes
 * back soon). Uncued answers are graded by the shell on speed.
 */
export function gradeFor(correct: boolean, cue: CueLevel, timedOut: boolean): number | undefined {
  if (timedOut) return 0;
  if (!correct) return 1;
  if (cue === 2) return 2;
  if (cue === 1) return 3;
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Plan

function objectiveText(o: Objective | undefined): string | null {
  if (!o || typeof o.text !== 'string' || !o.text.trim()) return null;
  return toDisplay(o.text).replace(/[.;:]+$/, '');
}

type Nameable = Pick<Candidate, 'kind' | 'answer' | 'blockTitle'>;

/** The concept a blank can name: its own word when that is a term, else its block's title. */
function conceptTerm(c: Nameable): string | null {
  if (c.kind === 'number' || c.kind === 'direction') return c.blockTitle;
  return c.answer;
}

/**
 * How well a blank names a concept (§8.3 wants the official term): a defined or marked multi-word
 * term or an abbreviation scores high; a lone lowercase word ("granular", "past") or a direction
 * word scores low.
 */
export function conceptScore(c: Nameable): number {
  const term = conceptTerm(c);
  if (!term) return -10;
  if (c.kind === 'number' || c.kind === 'direction') return 1;
  let n = { definition: 6, term: 4, bold: 3, contrast: 1, number: 0, direction: 0 }[c.kind];
  const ws = words(term);
  if (ws.length >= 2 || /\([^)]+\)/.test(term) || /^[A-Z][A-Z0-9-]{1,}$/.test(term)) n += 2;
  else if (/^[a-z]/.test(term)) n -= 4;
  else n -= 2;
  return n;
}

function namingFrom(reading: Reading, c: Candidate): ConceptNaming {
  const o = reading.objectives.find((x) => x.id === c.objectiveId);
  const text = objectiveText(o);
  const term = conceptTerm(c) ?? text ?? c.answer;
  const line = text
    ? `The thread you were rebuilding is ${c.objectiveId}: ${text}. “${c.answer}” is the word it hangs on here.`
    : `The thread you were rebuilding runs through ${c.blockTitle ?? `block ${c.blockId}`}; “${c.answer}” is the word it hangs on.`;
  return { term, blockId: c.blockId, objectiveId: c.objectiveId, line };
}

export function buildCloze(reading: Reading, input: BuildInput): MechanicPlan<ClozePayload> | null {
  const chain = planChain(reading, input.corpus, input);
  if (!chain) return null;
  const toRounds = (cs: readonly Candidate[], phase: 'discovery' | 'pressure'): MechanicRound<ClozePayload>[] => {
    const out: MechanicRound<ClozePayload>[] = [];
    for (const c of cs) {
      const p = toPayload(c, reading, input.corpus, input.rng);
      if (!p) continue;
      const step = phase === 'pressure' ? out.length : null;
      const limit = phase === 'pressure' ? timeFor(p, step) : undefined;
      out.push({
        id: `${c.itemId}#${phase}`,
        phase,
        itemId: c.itemId,
        blockId: c.blockId,
        objectiveId: c.objectiveId,
        timeLimitMs: limit,
        targetMs: limit ?? timeFor(p, 0),
        payload: p,
      });
    }
    return out;
  };
  const discovery = toRounds(chain.discovery, 'discovery');
  const pressure = toRounds(chain.pressure, 'pressure');
  if (discovery.length < MIN_LINK || pressure.length < MIN_LINK) return null;
  const rounds = [...discovery, ...pressure];
  // Name a concept, not a direction word or a bare number: the best term in discovery (earliest on a
  // tie), else in the pressure chain, else the discovery thread's objective.
  const best = (cs: readonly Candidate[]) => cs.reduce<Candidate | null>((b, c) => (!b || conceptScore(c) > conceptScore(b) ? c : b), null);
  const bd = best(chain.discovery);
  const bp = best(chain.pressure);
  const first = bd && conceptScore(bd) >= 2 ? bd : bp && conceptScore(bp) > (bd ? conceptScore(bd) : -Infinity) ? bp : (bd ?? chain.discovery[0]);
  const concept = namingFrom(reading, first);
  const o = reading.objectives.find((x) => x.id === first.objectiveId);
  const text = objectiveText(o);
  return {
    rounds,
    target: text ? `the thread of ${first.objectiveId}: ${text}` : `the thread of ${first.objectiveId}`,
    opening: `A run of linked sentences from one thread of this reading, in the order the notes give them, each missing the word that carries it. Type what belongs. A cue is there if you ask — first a letter, then three choices — but a cue counts against how well you hold it.`,
    concept,
  };
}

/** Names the word the player missed or needed a cue for in discovery, else the first term in the chain. */
export function nameAfterDiscovery(reading: Reading, plan: MechanicPlan<ClozePayload>, discovery: readonly RoundResult[]): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const played = discovery.map((d) => ({ d, r: byId.get(d.roundId) })).filter((x): x is { d: RoundResult; r: MechanicRound<ClozePayload> } => !!x.r);
  const weak = (x: { d: RoundResult }) => !x.d.correct || (x.d.grade !== undefined && x.d.grade < 4);
  // Name what was missed or cued, if it names a concept at least as well as the default; a direction
  // word goes through its block's title ("higher" is not a concept).
  const score = (x: { r: MechanicRound<ClozePayload> }) => conceptScore(x.r.payload);
  const floor = Math.min(2, Math.max(...plan.rounds.filter((r) => r.phase === 'discovery').map((r) => conceptScore(r.payload)), -10));
  const pick = played
    .filter(weak)
    .filter((x) => score(x) >= floor && score(x) > -10)
    .reduce<(typeof played)[number] | null>((b, x) => (!b || score(x) > score(b) ? x : b), null);
  if (!pick) return plan.concept;
  const r = pick.r;
  return namingFrom(reading, {
    itemId: r.itemId,
    kind: r.payload.kind,
    blockId: r.blockId,
    objectiveId: r.objectiveId ?? plan.concept.objectiveId,
    readingId: reading.reading_id,
    before: r.payload.before,
    after: r.payload.after,
    answer: r.payload.answer,
    accept: [...r.payload.key.accept],
    blockTitle: r.payload.blockTitle,
    order: 0,
  });
}

/** Test hook: the blanks that can actually be played (they have a three-choice cue), no SRS state. */
export function playableCandidates(reading: Reading, corpus: Corpus): Candidate[] {
  return threads(reading, corpus, null).flatMap((t) => t.links);
}

/** Test hook: a reading's full candidate list with no SRS state (document order). */
export function chainCandidates(reading: Reading): Candidate[] {
  return chooseTargets(readingSentences(reading), null);
}
