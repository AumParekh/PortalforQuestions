// Waterfall Builder: pure round building. Each curated flow (a stack, a process or a loop the notes
// put in order) yields its full build plus derived rounds: a run of slots left open with the rest
// locked in place, and for loops the circle picked up at another step (flow.ts, deriveVariants).
// Discovery builds whole flows first; pressure mixes in the partial rounds, timed. No React.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { ItemSrs, Reading } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { Variant } from './flow';
import { DISCOVERY_MS_PER_TILE, deriveVariants, discoveryEligible, openSlots, pressureLimit, slotSteps, trayOrder, variantKey } from './flow';
import type { FlowItem } from './schema';
import { MECHANIC_KEY, parseWaterfallData } from './schema';

export const MIN_DISCOVERY = 3;
export const MAX_DISCOVERY = 5;
export const MIN_PRESSURE = 3;
export const MAX_PRESSURE = 5;

export interface Puzzle {
  /** Stable SRS key: the item id for the full build, "<item id>:<sub-part>" for a derived round. */
  itemId: string;
  item: FlowItem;
  variant: Variant;
}

export interface WaterfallPayload extends Puzzle {
  /** Step index per slot, top to bottom. */
  slots: number[];
  /** Slots the player fills; the others are locked in from the start. */
  open: boolean[];
  /** Tray tiles (step indices) in display order. */
  tray: number[];
}

// ---------------------------------------------------------------------------------------------
// Data access, cached per corpus

const itemsCache = new WeakMap<Corpus, Map<string, FlowItem[]>>();
const puzzleCache = new WeakMap<FlowItem, Puzzle[]>();

/** Valid curated flows grouped by reading (readings the corpus doesn't know are ignored). */
export function itemsByReading(corpus: Corpus): Map<string, FlowItem[]> {
  const hit = itemsCache.get(corpus);
  if (hit) return hit;
  const map = new Map<string, FlowItem[]>();
  for (const item of parseWaterfallData(corpus.extras?.[MECHANIC_KEY])) {
    if (!corpus.readingById[item.readingId]) continue;
    const list = map.get(item.readingId) ?? [];
    list.push(item);
    map.set(item.readingId, list);
  }
  itemsCache.set(corpus, map);
  return map;
}

export function puzzlesOf(item: FlowItem): Puzzle[] {
  const hit = puzzleCache.get(item);
  if (hit) return hit;
  const ids = item.steps.map((s) => s.id);
  const out = deriveVariants(item.steps.length, item.kind === 'loop').map((variant) => {
    const key = variantKey(variant, ids);
    return { itemId: key ? `${item.id}:${key}` : item.id, item, variant };
  });
  puzzleCache.set(item, out);
  return out;
}

export function readingPuzzles(reading: Reading, corpus: Corpus): Puzzle[] {
  return (itemsByReading(corpus).get(reading.reading_id) ?? []).flatMap(puzzlesOf);
}

/** A full arc needs 3 discovery-worthy rounds and 3 more for pressure. */
export function supportsWaterfall(reading: Reading, corpus: Corpus): boolean {
  const pz = readingPuzzles(reading, corpus);
  const disc = pz.filter((p) => discoveryEligible(p.variant, p.item.steps.length)).length;
  return disc >= MIN_DISCOVERY && pz.length >= MIN_DISCOVERY + MIN_PRESSURE;
}

// ---------------------------------------------------------------------------------------------
// Payloads and text

export function toPayload(pz: Puzzle, rng: () => number): WaterfallPayload {
  const n = pz.item.steps.length;
  const slots = slotSteps(n, pz.variant);
  const open = openSlots(n, pz.variant);
  return { ...pz, slots, open, tray: trayOrder(slots, open, rng) };
}

export function openCount(p: Pick<WaterfallPayload, 'open'>): number {
  return p.open.filter(Boolean).length;
}

/** The source block if the corpus knows it, else the curated item's own id. */
export function blockOf(corpus: Corpus, item: FlowItem): string {
  return item.sourceBlock && corpus.blockById[item.sourceBlock] ? item.sourceBlock : item.id;
}

export function objectiveOf(corpus: Corpus, reading: Reading, item: FlowItem): string {
  const fromBlock = item.sourceBlock ? corpus.objectiveOfBlock[item.sourceBlock] : undefined;
  if (fromBlock) return fromBlock;
  const los = learningObjectives(reading);
  return los[los.length - 1]?.id ?? reading.reading_id;
}

export function sentence(s: string): string {
  const t = s.trim();
  return /[.!?”"]$/.test(t) ? t : `${t}.`;
}

export const KIND_WORD: Record<FlowItem['kind'], string> = { stack: 'stack', process: 'process', loop: 'loop' };

/** Just-in-time naming (§8.3): the flow's name and which way it runs. */
export function namingFor(corpus: Corpus, reading: Reading, item: FlowItem): ConceptNaming {
  const tail = item.kind === 'loop' && item.loopClosure ? ` ${sentence(item.loopClosure)}` : '';
  return {
    term: item.title,
    blockId: blockOf(corpus, item),
    objectiveId: objectiveOf(corpus, reading, item),
    line: `${sentence(item.directionLabel)}${tail}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Session build

export interface WaterfallBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
}

interface Candidate {
  pz: Puzzle;
  tier: number;
  order: number;
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

function pickBest(pool: readonly Candidate[], used: Set<string>, key: (c: Candidate) => number[] | null): Candidate | null {
  let best: { c: Candidate; k: number[] } | null = null;
  for (const c of pool) {
    if (used.has(c.pz.itemId)) continue;
    const k = key(c);
    if (!k) continue;
    if (!best || lexLess(k, best.k)) best = { c, k };
  }
  return best?.c ?? null;
}

/** Target discovery and pressure counts for a reading with `flows` flows (the picks stop early if the pool runs dry). */
export function phaseCounts(flows: number): { disc: number; press: number } {
  const disc = Math.min(MAX_DISCOVERY, Math.max(MIN_DISCOVERY, Math.min(4, flows)));
  const press = Math.min(MAX_PRESSURE, Math.max(MIN_PRESSURE, flows >= 3 ? 5 : 4));
  return { disc, press };
}

export function buildWaterfall(reading: Reading, ctx: WaterfallBuildInput): MechanicPlan<WaterfallPayload> | null {
  const items = itemsByReading(ctx.corpus).get(reading.reading_id) ?? [];
  const puzzles = items.flatMap(puzzlesOf);
  if (!supportsWaterfall(reading, ctx.corpus)) return null;
  const pool: Candidate[] = shuffle(puzzles, ctx.rng).map((pz, order) => ({ pz, order, tier: srsPriority(ctx.srs[pz.itemId], ctx.today) }));
  const { disc: nDisc, press: nPress } = phaseCounts(items.length);
  const used = new Set<string>();
  const perItem = new Map<string, number>();
  const take = (c: Candidate, into: Puzzle[]) => {
    used.add(c.pz.itemId);
    perItem.set(c.pz.item.id, (perItem.get(c.pz.item.id) ?? 0) + 1);
    into.push(c.pz);
  };

  // Discovery: whole flows first (due, then unseen, then the rest), one per flow; then the widest
  // partial rounds of flows already built this session, so nothing is met in pieces first.
  const disc: Puzzle[] = [];
  while (disc.length < nDisc) {
    const c = pickBest(pool, used, (x) => (x.pz.variant.kind === 'build' ? [x.tier, x.order] : null));
    if (!c) break;
    take(c, disc);
  }
  const built = new Set(disc.map((p) => p.item.id));
  while (disc.length < nDisc) {
    const c = pickBest(pool, used, (x) =>
      built.has(x.pz.item.id) && discoveryEligible(x.pz.variant, x.pz.item.steps.length)
        ? [x.tier, perItem.get(x.pz.item.id) ?? 0, -x.pz.variant.size, x.order]
        : null,
    );
    if (!c) break;
    take(c, disc);
  }

  // Pressure: due first, then unseen; spread across flows; runs of three or more tiles first, then a
  // timed rebuild of a flow built in discovery (from memory, against the clock), pairs last.
  const rebuildable = new Set(disc.filter((p) => p.variant.kind === 'build').map((p) => p.itemId));
  for (const id of rebuildable) used.delete(id);
  const press: Puzzle[] = [];
  while (press.length < nPress) {
    const c = pickBest(pool, used, (x) => {
      const rebuild = rebuildable.has(x.pz.itemId);
      return [rebuild ? 1 : x.tier, perItem.get(x.pz.item.id) ?? 0, rebuild ? 1 : x.pz.variant.size >= 3 ? 0 : 2, x.order];
    });
    if (!c) break;
    take(c, press);
  }
  // Rebuilds close the session: the whole flow, once more, under the clock.
  press.sort((a, b) => Number(rebuildable.has(a.itemId)) - Number(rebuildable.has(b.itemId)));
  if (disc.length < MIN_DISCOVERY || press.length < MIN_PRESSURE) return null;

  const toRound = (pz: Puzzle, phase: 'discovery' | 'pressure', step: number): MechanicRound<WaterfallPayload> => {
    const payload = toPayload(pz, ctx.rng);
    const k = openCount(payload);
    const limit = phase === 'pressure' ? pressureLimit(k, step) : undefined;
    return {
      id: `${pz.itemId}#${phase}`,
      phase,
      itemId: pz.itemId,
      blockId: blockOf(ctx.corpus, pz.item),
      objectiveId: objectiveOf(ctx.corpus, reading, pz.item),
      category: 'Sequence',
      timeLimitMs: limit,
      targetMs: limit ?? DISCOVERY_MS_PER_TILE * k,
      payload,
    };
  };
  const rounds = [...disc.map((pz) => toRound(pz, 'discovery', 0)), ...press.map((pz, i) => toRound(pz, 'pressure', i))];
  const concept = namingFor(ctx.corpus, reading, disc[0].item);
  const flows = new Set(rounds.map((r) => r.payload.item.id)).size;
  const hasLoop = rounds.some((r) => r.payload.item.kind === 'loop');
  return {
    rounds,
    target: concept.term,
    opening:
      `${reading.reading_id} · Waterfall Builder. ${flows === 1 ? 'One flow' : `${flows} flows`} from this reading, each an empty column with its pieces scattered below. ` +
      `Drop them in top to bottom, in the order things actually happen. A column that works lights up as it fills` +
      (hasLoop ? '; a flow that feeds itself closes into a circle.' : '.'),
    concept,
  };
}

/** Names the flow the player slipped on most in discovery, else the first one they built. */
export function nameAfterDiscovery(
  corpus: Corpus,
  reading: Reading,
  plan: MechanicPlan<WaterfallPayload>,
  discovery: readonly RoundResult[],
): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const played = discovery
    .map((d) => ({ d, r: byId.get(d.roundId) }))
    .filter((x): x is { d: RoundResult; r: MechanicRound<WaterfallPayload> } => !!x.r);
  const missed = played.filter((x) => !x.d.correct).sort((a, b) => (a.d.grade ?? 1) - (b.d.grade ?? 1));
  const pickRound = missed[0] ?? played[0];
  return pickRound ? namingFor(corpus, reading, pickRound.r.payload.item) : plan.concept;
}
