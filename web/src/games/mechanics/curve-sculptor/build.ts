// Curve Sculptor: pure round building. Each curated item (a curve the notes describe by its shape)
// seeds its own puzzle plus derived ones where a different slider is the wrong one (maths.ts,
// deriveVariants). A reading is supported when it has puzzles for a full arc: 3 discovery + 3
// pressure. No React.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { ItemSrs, Reading } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { Variant } from './maths';
import { SHAPE_MEANING, deriveVariants, sample, shapeReport, snapRadius } from './maths';
import type { CurveItem } from './schema';
import { MECHANIC_KEY, parseCurveData } from './schema';

export const MIN_DISCOVERY = 3;
export const MAX_DISCOVERY = 5;
export const MIN_PRESSURE = 3;
export const MAX_PRESSURE = 5;
export const MIN_ROUNDS = MIN_DISCOVERY + MIN_PRESSURE;
/** Comfortable time to read a description and sculpt the curve, untimed discovery. */
export const DISCOVERY_TARGET_MS = 45000;
/** First pressure round's limit; each later one is 8% shorter, never under the floor. */
export const PRESSURE_START_MS = 32000;
export const PRESSURE_FLOOR_MS = 18000;

export interface Puzzle {
  /** Stable SRS key: the item id for the curated puzzle, "<item id>:<param><+|->" for a derived one. */
  itemId: string;
  item: CurveItem;
  variant: Variant;
}

export interface CurvePayload extends Puzzle {
  /** Snap when every shape word holds and the curve is within this sup distance of the notes' curve. */
  radius: number;
  /** Shape words the starting curve breaks (what the player has to restore). */
  broken: string[];
  startParams: Record<string, number>;
}

// ---------------------------------------------------------------------------------------------
// Data access, cached per corpus

const itemsCache = new WeakMap<Corpus, Map<string, CurveItem[]>>();
const puzzleCache = new WeakMap<CurveItem, Puzzle[]>();

/** Valid curated items grouped by reading (readings the corpus doesn't know are ignored). */
export function itemsByReading(corpus: Corpus): Map<string, CurveItem[]> {
  const hit = itemsCache.get(corpus);
  if (hit) return hit;
  const map = new Map<string, CurveItem[]>();
  for (const item of parseCurveData(corpus.extras?.[MECHANIC_KEY])) {
    if (!corpus.readingById[item.readingId]) continue;
    const list = map.get(item.readingId) ?? [];
    list.push(item);
    map.set(item.readingId, list);
  }
  itemsCache.set(corpus, map);
  return map;
}

export function puzzlesOf(item: CurveItem): Puzzle[] {
  const hit = puzzleCache.get(item);
  if (hit) return hit;
  const out = deriveVariants(item, { param: item.wrongParam, start: item.startValue, tolerance: item.tolerance }).map((variant) => ({
    itemId: variant.curated ? item.id : `${item.id}:${variant.key}`,
    item,
    variant,
  }));
  puzzleCache.set(item, out);
  return out;
}

export function readingPuzzles(reading: Reading, corpus: Corpus): Puzzle[] {
  return (itemsByReading(corpus).get(reading.reading_id) ?? []).flatMap(puzzlesOf);
}

export function supportsCurveSculptor(reading: Reading, corpus: Corpus): boolean {
  return readingPuzzles(reading, corpus).length >= MIN_ROUNDS;
}

// ---------------------------------------------------------------------------------------------
// Payloads and text

export function paramLabel(item: CurveItem, name: string): string {
  return item.params.find((p) => p.name === name)?.label ?? name;
}

export function toPayload(pz: Puzzle): CurvePayload {
  const startParams = { ...pz.item.target, [pz.variant.param]: pz.variant.start };
  const report = shapeReport(pz.item, sample(pz.item, startParams));
  return {
    ...pz,
    radius: snapRadius(pz.item, pz.variant),
    broken: pz.item.shapeWords.filter((w) => !report[w]),
    startParams,
  };
}

export function meaningOf(word: string): string {
  return SHAPE_MEANING[word] ?? '';
}

/**
 * Lower-cases only the leading capital of a label for use mid-sentence, leaving symbols and
 * acronyms alone: "Face value of the debt, F" -> "face value of the debt, F", "BSM vol" unchanged.
 */
export function lowerFirst(s: string): string {
  if (s.length < 2 || !/^[A-Z][a-z]/.test(s)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

export function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "smile", "smile and shallow", "a, b and c" */
export function wordList(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Why the start was wrong, for a derived puzzle (the curated one carries the notes-based explanation). */
export function derivedExplanation(p: CurvePayload): string {
  const label = lowerFirst(paramLabel(p.item, p.variant.param));
  const broken = p.broken.length ? p.broken : p.item.shapeWords;
  const lines = broken.map((w) => `${w} (${meaningOf(w)})`);
  return `With the ${label} where it started, the curve was no longer ${wordList(lines)}. Put back where the notes have it, the shape returns; the other two settings were never the problem.`;
}

export function objectiveOf(corpus: Corpus, reading: Reading, item: CurveItem): string {
  const fromBlock = item.sourceBlock ? corpus.objectiveOfBlock[item.sourceBlock] : undefined;
  if (fromBlock) return fromBlock;
  const los = learningObjectives(reading);
  return los[los.length - 1]?.id ?? reading.reading_id;
}

export function blockOf(item: CurveItem): string {
  return item.sourceBlock ?? item.id;
}

/**
 * Just-in-time naming (§8.3): the shape word and the setting the notes tie it to. Always the
 * curated puzzle's setting: a derived puzzle's culprit (say the tilt of a smile) only has to be
 * right for the word to show, it is not what the word means.
 */
export function namingFor(corpus: Corpus, reading: Reading, pz: Puzzle): ConceptNaming {
  const words = wordList(pz.item.shapeWords.map((w, i) => `“${i === 0 ? capitalise(w) : w}”`));
  return {
    term: `${words}: set by the ${lowerFirst(paramLabel(pz.item, pz.item.wrongParam))}`,
    blockId: blockOf(pz.item),
    objectiveId: objectiveOf(corpus, reading, pz.item),
    line: pz.item.description,
  };
}

// ---------------------------------------------------------------------------------------------
// Session build

export interface CurveBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
}

export function pressureLimit(step: number): number {
  return Math.max(PRESSURE_FLOOR_MS, Math.round(PRESSURE_START_MS * Math.pow(0.92, step)));
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * Greedy pick of k puzzles: SRS tier first (due, unseen, rest), then fewest repeats of the same
 * curve (in this phase, and in discovery for pressure), then curated before derived when asked,
 * then the shuffled order.
 */
function pick(
  pool: readonly { pz: Puzzle; tier: number; order: number }[],
  k: number,
  used: Set<string>,
  seenItems: Map<string, number>,
  preferCurated: boolean,
): Puzzle[] {
  const out: Puzzle[] = [];
  const count = new Map(seenItems);
  while (out.length < k) {
    let best: { pz: Puzzle; key: number[] } | null = null;
    for (const c of pool) {
      if (used.has(c.pz.itemId)) continue;
      const key = [c.tier, count.get(c.pz.item.id) ?? 0, preferCurated && !c.pz.variant.curated ? 1 : 0, c.order];
      if (!best || lexLess(key, best.key)) best = { pz: c.pz, key };
    }
    if (!best) break;
    used.add(best.pz.itemId);
    count.set(best.pz.item.id, (count.get(best.pz.item.id) ?? 0) + 1);
    out.push(best.pz);
  }
  return out;
}

export function buildCurveSculptor(reading: Reading, ctx: CurveBuildInput): MechanicPlan<CurvePayload> | null {
  const puzzles = readingPuzzles(reading, ctx.corpus);
  if (puzzles.length < MIN_ROUNDS) return null;
  const pool = shuffle(puzzles, ctx.rng).map((pz, order) => ({ pz, order, tier: srsPriority(ctx.srs[pz.itemId], ctx.today) }));
  const total = Math.min(MAX_DISCOVERY + MAX_PRESSURE, puzzles.length);
  const nDisc = Math.max(MIN_DISCOVERY, Math.min(MAX_DISCOVERY, Math.floor(total / 2)));
  const nPress = Math.max(MIN_PRESSURE, Math.min(MAX_PRESSURE, total - nDisc));
  const used = new Set<string>();
  // Discovery: the notes' own puzzles first, one curve each where possible.
  const disc = pick(pool, nDisc, used, new Map(), true);
  // Pressure: curves not yet seen this session first (novel), derived puzzles welcome.
  const seen = new Map<string, number>();
  for (const pz of disc) seen.set(pz.item.id, (seen.get(pz.item.id) ?? 0) + 1);
  const press = pick(pool, nPress, used, seen, false);
  if (disc.length < MIN_DISCOVERY || press.length < MIN_PRESSURE) return null;

  const toRound = (pz: Puzzle, phase: 'discovery' | 'pressure', step: number): MechanicRound<CurvePayload> => {
    const limit = phase === 'pressure' ? pressureLimit(step) : undefined;
    return {
      id: `${pz.itemId}#${phase}`,
      phase,
      itemId: pz.itemId,
      blockId: blockOf(pz.item),
      objectiveId: objectiveOf(ctx.corpus, reading, pz.item),
      timeLimitMs: limit,
      targetMs: limit ?? DISCOVERY_TARGET_MS,
      payload: toPayload(pz),
    };
  };
  const rounds = [...disc.map((pz) => toRound(pz, 'discovery', 0)), ...press.map((pz, i) => toRound(pz, 'pressure', i))];
  const concept = namingFor(ctx.corpus, reading, disc[0]);
  return {
    rounds,
    target: concept.term,
    opening: `Curve Sculptor. ${rounds.length} curves this reading describes in words. Each is drawn with one of its three settings out of place, so it doesn't look the way the words say. Find the setting that's wrong and drag it until the curve snaps into shape.`,
    concept,
  };
}

/** Names the curve the player missed in discovery, else the first one they sculpted. */
export function nameAfterDiscovery(
  corpus: Corpus,
  reading: Reading,
  plan: MechanicPlan<CurvePayload>,
  discovery: readonly RoundResult[],
): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const played = discovery.map((d) => ({ d, r: byId.get(d.roundId) })).filter((x): x is { d: RoundResult; r: MechanicRound<CurvePayload> } => !!x.r);
  const pickRound = played.find((x) => !x.d.correct) ?? played[0];
  return pickRound ? namingFor(corpus, reading, pickRound.r.payload) : plan.concept;
}
