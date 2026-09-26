// Tail Shaper: pure round building. Each curated item (a return distribution the notes describe in
// words, plus the implied-volatility curve it produces) is one puzzle from its curated start. Items
// whose description pins down only the tails also seed derived puzzles that begin from a different
// canonical shape (thin tails, both tails fat, fat left tail, fat right tail), each re-checked: the
// derived start must break the item's curve label and sit outside its tolerance box. A reading is
// supported when it has puzzles for a full arc (3 discovery + 3 pressure) drawn from at least two
// distinct items. No React.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { ItemSrs, Reading } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { ParamName, ParamSpec, Params, SmileLabel, Thresholds } from './maths';
import { classify, onGrid, withinOne } from './maths';
import type { TailData, TailItem } from './schema';
import { MECHANIC_KEY, parseTailData } from './schema';

export const MIN_DISCOVERY = 3;
export const MAX_DISCOVERY = 5;
export const MIN_PRESSURE = 3;
export const MAX_PRESSURE = 5;
export const MIN_ROUNDS = MIN_DISCOVERY + MIN_PRESSURE;
/** A reading needs puzzles from at least this many distinct curated items. */
export const MIN_ITEMS = 2;
/** Comfortable time to read the description and shape the density, untimed discovery. */
export const DISCOVERY_TARGET_MS = 60000;
/** First pressure round's limit; each later one is 8% shorter, never under the floor. */
export const PRESSURE_START_MS = 36000;
export const PRESSURE_FLOOR_MS = 20000;
/** A derived start must differ from the curated one by at least this much total nu. */
const MIN_START_DISTANCE = 10;

export type StartKey = 'curated' | 'thin' | 'both-fat' | 'left-fat' | 'right-fat';
type DerivedKey = Exclude<StartKey, 'curated'>;

/** Canonical tail shapes a derived puzzle can start from (nu values, snapped onto the slider grid). */
const CANONICAL: Record<DerivedKey, { nuL: number; nuR: number }> = {
  thin: { nuL: 60, nuR: 60 },
  'both-fat': { nuL: 4, nuR: 4 },
  'left-fat': { nuL: 4, nuR: 50 },
  'right-fat': { nuL: 50, nuR: 4 },
};
const DERIVED_KEYS: readonly DerivedKey[] = ['thin', 'both-fat', 'left-fat', 'right-fat'];

const START_LINE: Record<DerivedKey, string> = {
  thin: 'This time you start from thin, lognormal-like tails on both sides.',
  'both-fat': 'This time you start from fat tails on both sides.',
  'left-fat': 'This time you start from a fat left tail and a lognormal-like right tail.',
  'right-fat': 'This time you start from a fat right tail and a lognormal-like left tail.',
};

export interface Puzzle {
  /** Stable SRS key: the item id for the curated start, "<item id>:from-<shape>" for a derived one. */
  itemId: string;
  item: TailItem;
  startKey: StartKey;
  startParams: Params;
  /** The description as shown: for a derived start, sentences about the curated start are swapped for one about this start. */
  description: string;
}

export interface TailPayload extends Puzzle {
  specs: Record<ParamName, ParamSpec>;
  thresholds: Thresholds;
}

// ---------------------------------------------------------------------------------------------
// Display text

/** A reading id as the curated notes cite it ("MR-17"). */
const READING_REF = String.raw`\b[A-Z]{2,4}-\d+\b`;

/**
 * Drops the curated file's pointers into the notes, keeping the finance: "(MR-1)" and
 * "(MR-17 mechanism)" go, "which MR-17 calls" reads "which the notes call", "the lognormal of MR-1"
 * loses its "of MR-1", and a sentence that is only about where something came from is dropped.
 */
export function withoutRefs(s: string): string {
  const t = s
    .replace(new RegExp(String.raw`\s*\(${READING_REF}(?:\s+\w+)?\)`, 'g'), '')
    .replace(new RegExp(String.raw`\bwhich ${READING_REF} calls\b`, 'g'), 'which the notes call')
    .replace(new RegExp(String.raw`\s+of ${READING_REF}`, 'g'), '')
    .replace(/\bthe ([\w-]+) item\b/g, '$1 options');
  const ref = new RegExp(READING_REF);
  return t
    .split(/(?<=[.!?])\s+(?=[A-Z“"(])/)
    .filter((sent) => !ref.test(sent))
    .join(' ')
    .trim();
}

/**
 * Notes-style ASCII to reading text, with the file's pointers into the notes dropped: "nu_L" → "νL",
 * "mu" → "μ", "xi" → "ξ", "S0" → "S₀", "--" → "—", "->" → "→", "~normal" → "near-normal".
 */
export function pretty(s: string): string {
  return withoutRefs(s)
    .replace(/\s--\s/g, ' — ')
    .replace(/->/g, '→')
    .replace(/~(?=[a-z])/g, 'near-')
    .replace(/\s?~\s?/g, ' ≈ ')
    .replace(/\bnu_L\b/g, 'νL')
    .replace(/\bnu_R\b/g, 'νR')
    .replace(/\bnu\b/g, 'ν')
    .replace(/\bmu\b/g, 'μ')
    .replace(/\bxi\b/g, 'ξ')
    .replace(/\bFrechet\b/g, 'Fréchet')
    .replace(/\bS0\b/g, 'S₀');
}

const START_SENTENCE = /\b(?:you start|the start|start with|starting)\b/i;

/** Drops the sentences about the curated start and adds one about the derived start. */
export function derivedDescription(description: string, key: DerivedKey): string {
  const kept = description
    .split(/(?<=[.!?])\s+/)
    .filter((sent) => sent.trim() && !START_SENTENCE.test(sent))
    .join(' ');
  return `${kept} ${START_LINE[key]}`.trim();
}

/** The curve's name for the naming step and feedback. */
export const LABEL_TERM: Record<SmileLabel, string> = {
  'volatility skew': 'Volatility skew: a fat left tail',
  'volatility smile': 'Volatility smile: fat tails on both sides',
  flat: 'Flat volatility: the lognormal BSM assumes',
};

/** What the overlaid curve shows, in the notes' mechanism (MR-17: extra mass → dearer options → higher implied vol). */
export const LABEL_READING: Record<SmileLabel, string> = {
  'volatility skew': 'Only the left tail carries more mass than lognormal, so only low strikes are dear: implied volatility falls as the strike rises.',
  'volatility smile': 'Both tails carry more mass than lognormal, so strikes away from the money are dear on both sides: implied volatility rises at both ends.',
  flat: 'No region carries more mass than lognormal, so no strike is dearer than BSM says: one volatility prices every strike.',
};

export const MECHANISM_LINE =
  'Where the implied distribution has more probability mass than lognormal, options struck there are worth more than BSM says, and implied volatility there is higher.';

/**
 * Short caption from smile_note, content only: the file and line the curve was plotted at, the
 * plotting expression and the sampling grid are dropped ("Illustrative: the curve plotted in the
 * notes. Only its shape is examinable; …").
 */
export function smileCaption(note: string): string {
  return pretty(
    note
      .replace(/\s+at\s+(?:[\w.-]+\/)*[\w.-]+\.tex(?::\d+)?/g, '')
      .replace(/\s*\(pgfplots expression .*?\)(?=,\s*sampled|\.\s|\.?$)/, '')
      .replace(/,\s*sampled at .*?(?=\.\s+[A-Z]|\.?$)/, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

// ---------------------------------------------------------------------------------------------
// Data access, cached per corpus

const dataCache = new WeakMap<Corpus, { data: TailData | null; byReading: Map<string, TailItem[]> }>();
const puzzleCache = new WeakMap<TailItem, Puzzle[]>();

export function tailData(corpus: Corpus): { data: TailData | null; byReading: Map<string, TailItem[]> } {
  const hit = dataCache.get(corpus);
  if (hit) return hit;
  const data = parseTailData(corpus.extras?.[MECHANIC_KEY]);
  const byReading = new Map<string, TailItem[]>();
  for (const item of data?.items ?? []) {
    if (!corpus.readingById[item.readingId]) continue;
    const list = byReading.get(item.readingId) ?? [];
    list.push(item);
    byReading.set(item.readingId, list);
  }
  const out = { data, byReading };
  dataCache.set(corpus, out);
  return out;
}

/** The curated puzzle plus every valid derived start. */
export function puzzlesOf(item: TailItem, data: TailData): Puzzle[] {
  const hit = puzzleCache.get(item);
  if (hit) return hit;
  const out: Puzzle[] = [{ itemId: item.id, item, startKey: 'curated', startParams: { ...item.start }, description: item.description }];
  // Only when the words pin down the tails alone: a derived start must not contradict what else the item asks for.
  const tailsOnly = item.matters.every((n) => n === 'nuL' || n === 'nuR');
  if (tailsOnly) {
    const { specs, thresholds } = data;
    for (const key of DERIVED_KEYS) {
      const c = CANONICAL[key];
      const start: Params = { ...item.start, nuL: onGrid(specs.nuL, c.nuL), nuR: onGrid(specs.nuR, c.nuR) };
      const outside = item.matters.some((n) => !withinOne(start[n], item.target[n], item.tolerance[n]));
      const breaks = classify(start.nuL, start.nuR, thresholds) !== item.smile.label;
      const distinct = out.every((p) => Math.abs(p.startParams.nuL - start.nuL) + Math.abs(p.startParams.nuR - start.nuR) >= MIN_START_DISTANCE);
      if (!outside || !breaks || !distinct) continue;
      out.push({ itemId: `${item.id}:from-${key}`, item, startKey: key, startParams: start, description: derivedDescription(item.description, key) });
    }
  }
  puzzleCache.set(item, out);
  return out;
}

export function readingPuzzles(reading: Reading, corpus: Corpus): Puzzle[] {
  const { data, byReading } = tailData(corpus);
  if (!data) return [];
  return (byReading.get(reading.reading_id) ?? []).flatMap((it) => puzzlesOf(it, data));
}

export function supportsTailShaper(reading: Reading, corpus: Corpus): boolean {
  const puzzles = readingPuzzles(reading, corpus);
  return puzzles.length >= MIN_ROUNDS && new Set(puzzles.map((p) => p.item.id)).size >= MIN_ITEMS;
}

// ---------------------------------------------------------------------------------------------
// Rounds

export function objectiveOf(corpus: Corpus, reading: Reading, item: TailItem): string {
  const fromBlock = item.sourceBlock ? corpus.objectiveOfBlock[item.sourceBlock] : undefined;
  if (fromBlock) return fromBlock;
  const los = learningObjectives(reading);
  return los[los.length - 1]?.id ?? reading.reading_id;
}

export function blockOf(item: TailItem): string {
  return item.sourceBlock ?? item.id;
}

export function namingFor(corpus: Corpus, reading: Reading, item: TailItem): ConceptNaming {
  return {
    term: LABEL_TERM[item.smile.label],
    blockId: blockOf(item),
    objectiveId: objectiveOf(corpus, reading, item),
    line: `${MECHANISM_LINE} ${LABEL_READING[item.smile.label]}`,
  };
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
 * item (this phase, plus discovery's for pressure), then curated starts first when asked, then
 * the shuffled order.
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
      const key = [c.tier, count.get(c.pz.item.id) ?? 0, preferCurated && c.pz.startKey !== 'curated' ? 1 : 0, c.order];
      if (!best || lexLess(key, best.key)) best = { pz: c.pz, key };
    }
    if (!best) break;
    used.add(best.pz.itemId);
    count.set(best.pz.item.id, (count.get(best.pz.item.id) ?? 0) + 1);
    out.push(best.pz);
  }
  return out;
}

export interface TailBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
}

export function buildTailShaper(reading: Reading, ctx: TailBuildInput): MechanicPlan<TailPayload> | null {
  const { data } = tailData(ctx.corpus);
  if (!data || !supportsTailShaper(reading, ctx.corpus)) return null;
  const puzzles = readingPuzzles(reading, ctx.corpus);
  const pool = shuffle(puzzles, ctx.rng).map((pz, order) => ({ pz, order, tier: srsPriority(ctx.srs[pz.itemId], ctx.today) }));
  const total = Math.min(MAX_DISCOVERY + MAX_PRESSURE, puzzles.length);
  const nDisc = Math.max(MIN_DISCOVERY, Math.min(MAX_DISCOVERY, Math.floor(total / 2)));
  const nPress = Math.max(MIN_PRESSURE, Math.min(MAX_PRESSURE, total - nDisc));
  const used = new Set<string>();
  // Discovery: the notes' own starts first, one item each where possible.
  const disc = pick(pool, nDisc, used, new Map(), true);
  // Pressure: items not yet seen this session first (novel), derived starts welcome.
  const seen = new Map<string, number>();
  for (const pz of disc) seen.set(pz.item.id, (seen.get(pz.item.id) ?? 0) + 1);
  const press = pick(pool, nPress, used, seen, false);
  if (disc.length < MIN_DISCOVERY || press.length < MIN_PRESSURE) return null;

  const toRound = (pz: Puzzle, phase: 'discovery' | 'pressure', step: number): MechanicRound<TailPayload> => {
    const limit = phase === 'pressure' ? pressureLimit(step) : undefined;
    return {
      id: `${pz.itemId}#${phase}`,
      phase,
      itemId: pz.itemId,
      blockId: blockOf(pz.item),
      objectiveId: objectiveOf(ctx.corpus, reading, pz.item),
      timeLimitMs: limit,
      targetMs: limit ?? DISCOVERY_TARGET_MS,
      payload: { ...pz, specs: data.specs, thresholds: data.thresholds },
    };
  };
  const rounds = [...disc.map((pz) => toRound(pz, 'discovery', 0)), ...press.map((pz, i) => toRound(pz, 'pressure', i))];
  const concept = namingFor(ctx.corpus, reading, disc[0].item);
  return {
    rounds,
    target: concept.term,
    opening: `Tail Shaper. ${rounds.length} return distributions, each described in the notes’ own words, and one density with four sliders. Bend the curve until it matches the words. When it does, the curve an options desk would quote for that distribution is drawn over it.`,
    concept,
  };
}

/** Names the curve the player missed in discovery, else the first one they shaped. */
export function nameAfterDiscovery(
  corpus: Corpus,
  reading: Reading,
  plan: MechanicPlan<TailPayload>,
  discovery: readonly RoundResult[],
): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const played = discovery
    .map((d) => ({ d, r: byId.get(d.roundId) }))
    .filter((x): x is { d: RoundResult; r: MechanicRound<TailPayload> } => !!x.r);
  const chosen = played.find((x) => !x.d.correct) ?? played[0];
  return chosen ? namingFor(corpus, reading, chosen.r.payload.item) : plan.concept;
}
