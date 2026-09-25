// Shatter (brief §7.1): pure round building. A statement appears; the player rules TRUE / FLIPPED /
// SWAPPED, then names the flipped word or the sibling that belongs. Source: the reading's traps —
// correct_text + corrupted_text pairs make FLIPPED / SWAPPED items; a trap without a corrupted
// version is used only as a TRUE item. Nothing is generated: every statement is a trap's own text.
import type { Corpus } from '../../corpus';
import { trapObjective } from '../../corpus';
import type { ItemSrs, Reading, Trap, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { diffTokens, emphasised, normWord, phrase, stripCategoryLead, toDisplay, tokenize } from '../../text';
import type { Token } from '../../text';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';

export type Verdict = 'TRUE' | 'FLIPPED' | 'SWAPPED';

export interface ShatterPayload {
  trapId: string;
  verdict: Verdict;
  category: TrapCategory;
  /** The statement shown (LaTeX from the notes). */
  statement: string;
  tokens: Token[];
  /** The correct version (LaTeX), shown on a miss and after a catch. */
  correct: string;
  /** FLIPPED: indices into `tokens` that carry the flip; empty → no word to name. */
  flipIdx: number[];
  /** SWAPPED: the phrase that belongs, the candidates, and what was swapped in. */
  swap: { answer: string; options: string[]; swappedIn: string } | null;
  /** Correct-version token indices that differ from the corrupted one (for highlighting). */
  correctIdx: number[];
}

export const MIN_CORRUPTED = 2;
export const MIN_ROUNDS = 6;
export const TARGET_ROUNDS = 8;
export const MAX_ROUNDS = 10;

const FLIP_CATEGORIES: readonly TrapCategory[] = ['Polarity', 'Sign', 'Sequence'];
const NEGATIONS = new Set(['not', 'no', 'never', 'cannot', "can't", "isn't", "doesn't", "don't", 'without', 'nor', 'neither', 'none']);
const ANTONYMS: [string, string][] = [
  ['higher', 'lower'], ['high', 'low'], ['increase', 'decrease'], ['increases', 'decreases'], ['rises', 'falls'],
  ['rise', 'fall'], ['up', 'down'], ['more', 'less'], ['greater', 'smaller'], ['larger', 'smaller'], ['bigger', 'smaller'],
  ['above', 'below'], ['before', 'after'], ['positive', 'negative'], ['long', 'short'], ['buy', 'sell'], ['gain', 'loss'],
  ['wider', 'narrower'], ['widens', 'narrows'], ['stabilising', 'destabilising'], ['stabilizing', 'destabilizing'],
  ['overstates', 'understates'], ['over', 'under'], ['first', 'last'], ['inflows', 'outflows'], ['inflow', 'outflow'],
  ['add', 'subtract'], ['adds', 'subtracts'], ['plus', 'minus'], ['maximum', 'minimum'], ['max', 'min'], ['cap', 'floor'],
  ['caps', 'floors'], ['upper', 'lower'], ['earlier', 'later'], ['faster', 'slower'], ['strengthens', 'weakens'],
  ['convex', 'concave'], ['premium', 'discount'], ['asset', 'liability'], ['assets', 'liabilities'], ['pays', 'receives'],
  ['lender', 'borrower'], ['long', 'short'], ['rich', 'cheap'], ['most', 'least'], ['highest', 'lowest'], ['always', 'never'],
];
const ANTONYM_OF = new Map<string, string>();
for (const [a, b] of ANTONYMS) {
  ANTONYM_OF.set(a, b);
  ANTONYM_OF.set(b, a);
}

/** Trap text without its leading category label. */
export function trapBody(t: Trap, which: 'text' | 'correct' | 'corrupted'): string {
  const raw = which === 'corrupted' ? (t.corrupted_text ?? '') : which === 'correct' ? (t.correct_text ?? t.text) : t.text;
  return stripCategoryLead(raw, [t.raw_category, t.category]);
}

export interface Corruption {
  verdict: 'FLIPPED' | 'SWAPPED';
  correctTokens: Token[];
  corruptTokens: Token[];
  onlyCorrect: number[];
  onlyCorrupt: number[];
}

/** Classifies a correct/corrupted pair as a flip (direction, sign, order, negation) or a swap (sibling concept). */
export function classifyCorruption(t: Trap): Corruption | null {
  if (!t.corrupted_text || !(t.correct_text ?? t.text)) return null;
  const correctTokens = tokenize(trapBody(t, 'correct'));
  const corruptTokens = tokenize(trapBody(t, 'corrupted'));
  const d = diffTokens(correctTokens, corruptTokens);
  if (d.onlyA.length === 0 && d.onlyB.length === 0) return null;
  const a = d.onlyA.map((i) => correctTokens[i].norm);
  const b = d.onlyB.map((i) => corruptTokens[i].norm);
  const negation = (a.length === 0 && b.every((w) => NEGATIONS.has(w))) || (b.length === 0 && a.every((w) => NEGATIONS.has(w)));
  const antonym = a.length > 0 && a.length === b.length && a.every((w, i) => ANTONYM_OF.get(w) === b[i] || ANTONYM_OF.get(w) === b[b.length - 1 - i]);
  const signFlip = a.length > 0 && a.length === b.length && a.every((w, i) => /^[-+<>≤≥]$/.test(w) && /^[-+<>≤≥]$/.test(b[i]));
  const flipped = negation || antonym || signFlip || FLIP_CATEGORIES.includes(t.category);
  return { verdict: flipped ? 'FLIPPED' : 'SWAPPED', correctTokens, corruptTokens, onlyCorrect: d.onlyA, onlyCorrupt: d.onlyB };
}

/** First contiguous run of indices. */
function firstRun(idx: readonly number[]): number[] {
  const out: number[] = [];
  for (const i of idx) {
    if (out.length && i !== out[out.length - 1] + 1) break;
    out.push(i);
  }
  return out;
}

function candidatePhrases(traps: readonly Trap[]): string[] {
  const out: string[] = [];
  for (const t of traps) for (const p of emphasised(trapBody(t, 'text'))) out.push(p);
  return out;
}

/** Sibling candidates for a SWAPPED item: bold phrases from the trap itself, then its siblings. */
export function swapOptions(t: Trap, answer: string, swappedIn: string, siblings: readonly Trap[], rng: () => number): string[] | null {
  const key = (s: string) => s.split(/\s+/).map(normWord).join(' ');
  const seen = new Set([key(answer), key(swappedIn)]);
  const pool: string[] = [];
  const sameCat = siblings.filter((s) => s.id !== t.id && s.category === t.category);
  const others = siblings.filter((s) => s.id !== t.id && s.category !== t.category);
  for (const p of [...candidatePhrases([t]), ...shuffle(candidatePhrases(sameCat), rng), ...shuffle(candidatePhrases(others), rng)]) {
    const k = key(p);
    if (!k || seen.has(k) || p.length > 70) continue;
    seen.add(k);
    pool.push(p);
    if (pool.length === 3) break;
  }
  if (pool.length === 0) return null;
  return shuffle([answer, ...pool], rng);
}

export function buildPayload(t: Trap, siblings: readonly Trap[], rng: () => number, asTrue: boolean): ShatterPayload {
  const c = asTrue ? null : classifyCorruption(t);
  if (!c) {
    const statement = trapBody(t, t.correct_text ? 'correct' : 'text');
    return {
      trapId: t.id,
      verdict: 'TRUE',
      category: t.category,
      statement,
      tokens: tokenize(statement),
      correct: statement,
      flipIdx: [],
      swap: null,
      correctIdx: [],
    };
  }
  const statement = trapBody(t, 'corrupted');
  const correct = trapBody(t, 'correct');
  let swap: ShatterPayload['swap'] = null;
  if (c.verdict === 'SWAPPED' && c.onlyCorrect.length) {
    const answer = phrase(c.correctTokens, firstRun(c.onlyCorrect));
    const swappedIn = phrase(c.corruptTokens, firstRun(c.onlyCorrupt));
    const options = answer ? swapOptions(t, answer, swappedIn, siblings, rng) : null;
    if (answer && options) swap = { answer, options, swappedIn };
  }
  return {
    trapId: t.id,
    verdict: c.verdict,
    category: t.category,
    statement,
    tokens: c.corruptTokens,
    correct,
    flipIdx: c.verdict === 'FLIPPED' ? c.onlyCorrupt : [],
    swap,
    correctIdx: c.onlyCorrect,
  };
}

export function corruptibleTraps(reading: Reading): Trap[] {
  return reading.traps.filter((t) => classifyCorruption(t) !== null);
}

export function supportsShatter(reading: Reading): boolean {
  return corruptibleTraps(reading).length >= MIN_CORRUPTED && reading.traps.length >= MIN_ROUNDS;
}

/** Comfortable reading + ruling time for a statement, scaled for pressure. */
export function timeFor(tokens: readonly Token[], pressureStep: number | null): number {
  const base = Math.min(12000, Math.max(6000, 3500 + tokens.length * 180));
  if (pressureStep === null) return Math.round(base * 1.5);
  return Math.round(base * Math.pow(0.9, pressureStep));
}

/** What each trap shape does, for the one-line naming (§8.3). */
export const TRAP_SHAPE: Record<TrapCategory, string> = {
  Polarity: 'the direction is the whole claim, and the reversed version reads just as smoothly.',
  Sibling: 'two neighbouring concepts trade places; each is right somewhere else.',
  Role: 'the right action pinned on the wrong party.',
  Sign: 'the right quantity with its sign or inequality turned.',
  Scope: 'a true claim stretched past where the notes limit it.',
  Definition: 'a near-miss definition that drops or adds one condition.',
  Formula: 'the right inputs assembled the wrong way.',
  'Intermediate result': 'a correct number that answers a different step of the chain.',
  Sequence: 'the right steps in the wrong order.',
};

const GENERIC_TITLE = /trap|summary|remember|key (facts|points)|note/i;

/**
 * A concept to name from a trap: its longest emphasised multi-word phrase; else the statement
 * itself when short; else a non-generic block title; else the category.
 */
export function namingFor(corpus: Corpus, reading: Reading, t: Trap): ConceptNaming {
  const correct = trapBody(t, t.correct_text ? 'correct' : 'text');
  const block = t.source_block ? corpus.blockById[t.source_block] : undefined;
  const phrases = emphasised(correct).filter((x) => x.split(/\s+/).length >= 2);
  const sentence = toDisplay(correct);
  const title = block?.title && !GENERIC_TITLE.test(block.title) ? toDisplay(block.title) : null;
  const longest = phrases.sort((a, b) => b.length - a.length)[0];
  const term =
    longest ?? (sentence.split(/\s+/).length <= 16 ? sentence.replace(/[.;:]+$/, '') : null) ?? title ?? `${t.category} trap`;
  const objectiveId = trapObjective(corpus, t) ?? reading.objectives[reading.objectives.length - 1]?.id ?? reading.reading_id;
  return {
    term,
    blockId: t.source_block ?? t.id,
    objectiveId,
    line: `${t.category} trap: ${TRAP_SHAPE[t.category]}`,
  };
}

export interface ShatterBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
  priorityCategory: TrapCategory | null;
}

/** Orders traps: due first, then unseen, then the rest; priority category first within a tier. */
function prioritise(traps: readonly Trap[], ctx: ShatterBuildInput): Trap[] {
  const shuffled = shuffle(traps, ctx.rng);
  const tier = (t: Trap) => srsPriority(ctx.srs[t.id], ctx.today) * 2 + (ctx.priorityCategory && t.category === ctx.priorityCategory ? 0 : 1);
  return shuffled.map((t, i) => ({ t, i })).sort((a, b) => tier(a.t) - tier(b.t) || a.i - b.i).map((x) => x.t);
}

export function buildShatter(reading: Reading, ctx: ShatterBuildInput): MechanicPlan<ShatterPayload> | null {
  const corruptible = prioritise(corruptibleTraps(reading), ctx);
  if (corruptible.length < MIN_CORRUPTED) return null;
  const truths = prioritise(
    reading.traps.filter((t) => !corruptible.includes(t)),
    ctx,
  );
  const total = Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.min(TARGET_ROUNDS, corruptible.length + truths.length)));
  if (corruptible.length + truths.length < MIN_ROUNDS) return null;
  // About five in eight are corrupted, never fewer than two, topped up from whichever pool has items.
  let nCorrupt = Math.min(corruptible.length, Math.max(MIN_CORRUPTED, Math.round(total * 0.625)));
  let nTrue = Math.min(truths.length, total - nCorrupt);
  if (nCorrupt + nTrue < total) nCorrupt = Math.min(corruptible.length, total - nTrue);
  // Corrupted traps may also serve as TRUE items (their correct text) when true-only traps run out.
  const extraTrue = corruptible.slice(nCorrupt, nCorrupt + Math.max(0, total - nCorrupt - nTrue));
  nTrue += extraTrue.length;

  const siblings = reading.traps;
  const corruptItems = corruptible.slice(0, nCorrupt).map((t) => buildPayload(t, siblings, ctx.rng, false));
  const trueItems = [...truths.slice(0, nTrue - extraTrue.length), ...extraTrue].map((t) => buildPayload(t, siblings, ctx.rng, true));

  // Discovery: roughly half, with at least one of each kind; pressure gets the rest (all novel).
  const nDisc = Math.max(3, Math.min(5, Math.floor((corruptItems.length + trueItems.length) / 2)));
  const discT = Math.min(trueItems.length, nDisc - Math.round(nDisc * 0.6));
  // At least one corrupted item on each side of the naming step.
  const discC = Math.max(1, Math.min(corruptItems.length - 1, nDisc - discT));
  const discovery = shuffle([...corruptItems.slice(0, discC), ...trueItems.slice(0, discT)], ctx.rng);
  const pressure = shuffle([...corruptItems.slice(discC), ...trueItems.slice(discT)], ctx.rng);

  const toRound = (p: ShatterPayload, phase: 'discovery' | 'pressure', step: number): MechanicRound<ShatterPayload> => {
    const t = ctx.corpus.trapById[p.trapId];
    const limit = phase === 'pressure' ? timeFor(p.tokens, step) : undefined;
    return {
      id: `${p.trapId}#${phase}`,
      phase,
      itemId: p.trapId,
      blockId: t?.source_block ?? p.trapId,
      objectiveId: t ? trapObjective(ctx.corpus, t) : undefined,
      category: p.category,
      timeLimitMs: limit,
      targetMs: limit ?? timeFor(p.tokens, 0),
      payload: p,
    };
  };
  const rounds = [...discovery.map((p) => toRound(p, 'discovery', 0)), ...pressure.map((p, i) => toRound(p, 'pressure', i))];
  const firstCorrupt = rounds.find((r) => r.payload.verdict !== 'TRUE') ?? rounds[0];
  const concept = namingFor(ctx.corpus, reading, ctx.corpus.trapById[firstCorrupt.payload.trapId]);
  return {
    rounds,
    target: concept.term,
    opening: `${reading.reading_id} · Shatter. ${rounds.length} statements from this reading. Some stand as written; some have had one word turned around; some have had one idea traded for its neighbour. Rule on each, then point to the break.`,
    concept,
  };
}

/** Names the trap the player just missed in discovery, else the first corrupted one they saw. */
export function nameAfterDiscovery(
  corpus: Corpus,
  reading: Reading,
  plan: MechanicPlan<ShatterPayload>,
  discovery: readonly RoundResult[],
): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const played = discovery.map((d) => ({ d, r: byId.get(d.roundId) })).filter((x) => x.r);
  const pick =
    played.find((x) => !x.d.correct && x.r!.payload.verdict !== 'TRUE') ??
    played.find((x) => !x.d.correct) ??
    played.find((x) => x.r!.payload.verdict !== 'TRUE');
  const trap = pick ? corpus.trapById[pick.r!.payload.trapId] : undefined;
  return trap ? namingFor(corpus, reading, trap) : plan.concept;
}
