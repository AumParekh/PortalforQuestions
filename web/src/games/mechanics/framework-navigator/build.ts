// Framework Navigator: pure round building. No React.
//
// A session is tied to a reading. The whole regulatory tree is shown for context; the reading's
// frameworks (nodes whose reading_ids include it) are lit. Three round kinds:
//   explore  (discovery) — open a lit node and sort a handful of its items into what it
//            INTRODUCED / RESTRICTED / was RESPONDING TO; the full node is revealed after.
//   place    — a regulatory change (curated, never naming the framework) or one of a node's own
//            items is placed on the right node among 3–4 highlighted candidates (the curated
//            decoys for changes; look-alikes, siblings and lane-mates for items).
//   compare  (pressure) — two neighbouring frameworks; sort items to the one they belong to, then
//            the curated differences are revealed.
// Every round's item is an extracted id: the change id, `fn:<node>` for an explore round,
// `fn:<node>:<facet>:<i>` for a node item, and the pair id (or `fn:<a>~<b>`) for a compare.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { Block, ItemSrs, Reading, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { Facet, FnData, FnNode } from './schema';
import { FACETS, frameworkData } from './schema';

export interface FactChip {
  /** `fn:<node>:<facet>:<index>` */
  id: string;
  node: string;
  facet: Facet;
  text: string;
  sourceFile: string | null;
  sourceLine: number | null;
}

export interface ExplorePayload {
  kind: 'explore';
  node: string;
  chips: FactChip[];
}

export interface PlacePayload {
  kind: 'place';
  source: 'change' | 'fact';
  text: string;
  /** For a node item: which of the three it was. */
  facet: Facet | null;
  answer: string;
  /** Answer plus decoys, shuffled. */
  candidates: string[];
  /** One line (curated for changes); empty for node items, whose node summary is shown instead. */
  why: string;
}

export interface CompareChip extends FactChip {
  side: 'a' | 'b';
}

export interface ComparePayload {
  kind: 'compare';
  a: string;
  b: string;
  chips: CompareChip[];
  /** Curated differences (a vs b); empty for an uncurated neighbour pair. */
  differences: string[];
  pairId: string | null;
}

export type FnPayload = ExplorePayload | PlacePayload | ComparePayload;
export type FnRound = MechanicRound<FnPayload>;

export const MIN_PHASE = 3;
export const TARGET_PHASE = 4;
export const MAX_PHASE = 5;
export const MAX_EXPLORE_CHIPS = 6;
export const MAX_COMPARE_SIDE = 3;
export const CATEGORY: TrapCategory = 'Sibling';

// ---------------------------------------------------------------------------------------------
// Text checks

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The names a node goes by: name, short name and aliases. */
export function namesOf(n: FnNode): string[] {
  return [n.name, n.short, ...n.aliases].filter((s) => s.trim().length >= 2);
}

/** True when `text` names the node (whole-word, case-insensitive) — a giveaway. */
export function mentions(text: string, n: FnNode): boolean {
  return namesOf(n).some((name) => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(name.trim())}($|[^A-Za-z0-9])`, 'i').test(text));
}

function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9%.]+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ''))
      .filter((w) => w.length >= 4),
  );
}

/** Jaccard overlap of content words: ≥ 0.5 reads as the same claim. */
export function nearDuplicate(a: string, b: string): boolean {
  const A = contentWords(a);
  const B = contentWords(b);
  if (A.size === 0 || B.size === 0) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.5;
}

// ---------------------------------------------------------------------------------------------
// Facts and graph neighbourhoods

export function factsOf(n: FnNode): FactChip[] {
  const out: FactChip[] = [];
  for (const facet of FACETS) {
    n[facet].forEach((text, index) => {
      const ev = n.evidence.find((e) => e.field === facet && e.index === index);
      out.push({
        id: `fn:${n.id}:${facet}:${index}`,
        node: n.id,
        facet,
        text,
        sourceFile: ev?.sourceFile ?? n.sourceFile,
        sourceLine: ev?.sourceLine ?? n.sourceLine,
      });
    });
  }
  return out;
}

function nonEmptyFacets(n: FnNode): Facet[] {
  return FACETS.filter((f) => n[f].length > 0);
}

export function relatedOf(data: FnData, id: string): string[] {
  const n = data.nodeById[id];
  if (!n) return [];
  const back = data.nodes.filter((m) => m.related.includes(id)).map((m) => m.id);
  return [...new Set([...n.related, ...back])].filter((x) => x !== id);
}

export function siblingsOf(data: FnData, id: string): string[] {
  const n = data.nodeById[id];
  if (!n) return [];
  const out = new Set<string>();
  for (const p of n.parents) for (const k of data.childrenOf[p] ?? []) if (k !== id) out.add(k);
  return [...out];
}

/** Direct parents and children: a fact of one may carry over to the other, so never a decoy. */
export function adjacent(data: FnData, id: string): Set<string> {
  const n = data.nodeById[id];
  return new Set([...(n?.parents ?? []), ...(data.childrenOf[id] ?? [])]);
}

/**
 * Decoys for placing one of node `id`'s items: the node's curated change decoys, then its declared
 * look-alikes, then siblings, then lane-mates. Never the node itself, a direct parent or child, a
 * node the text names, or a node holding a near-identical item. Up to three; null if fewer than two.
 */
export function factDecoys(data: FnData, id: string, text: string, rng: () => number): string[] | null {
  const n = data.nodeById[id];
  if (!n) return null;
  const banned = adjacent(data, id);
  banned.add(id);
  const ok = (d: string) => {
    const m = data.nodeById[d];
    if (!m || banned.has(d) || mentions(text, m)) return false;
    return !factsOf(m).some((f) => nearDuplicate(f.text, text));
  };
  const tiers = [
    [...new Set(data.changes.filter((c) => c.node === id).flatMap((c) => c.decoys))],
    relatedOf(data, id),
    siblingsOf(data, id),
    data.nodes.filter((m) => m.lineage === n.lineage).map((m) => m.id),
  ];
  const out: string[] = [];
  for (const tier of tiers) {
    for (const d of shuffle(tier, rng)) {
      if (out.length >= 3) break;
      if (!out.includes(d) && ok(d)) out.push(d);
    }
  }
  return out.length >= 2 ? out : null;
}

// ---------------------------------------------------------------------------------------------
// Blocks: map a cited file + line to the extracted block that holds it

const blockIndexCache = new WeakMap<Corpus, Map<string, Block[]>>();

function blocksByFile(corpus: Corpus): Map<string, Block[]> {
  let idx = blockIndexCache.get(corpus);
  if (!idx) {
    idx = new Map();
    for (const r of corpus.readings) {
      if (!r.source_file) continue;
      const blocks = r.objectives.flatMap((o) => o.blocks).filter((b) => typeof b.source_line === 'number');
      blocks.sort((a, b) => (a.source_line as number) - (b.source_line as number));
      idx.set(r.source_file, [...(idx.get(r.source_file) ?? []), ...blocks]);
    }
    blockIndexCache.set(corpus, idx);
  }
  return idx;
}

/**
 * The block starting at or before `line` in `file` (the one that contains it); a line above the
 * first block (a chapter heading) maps to the first block. Null if the file is unknown.
 */
export function blockAt(corpus: Corpus, file: string | null, line: number | null): string | null {
  if (!file || line === null) return null;
  const blocks = blocksByFile(corpus).get(file);
  if (!blocks || blocks.length === 0) return null;
  let best: Block | null = null;
  for (const b of blocks) {
    if ((b.source_line as number) <= line) best = b;
    else break;
  }
  return (best ?? blocks[0]).id;
}

function nodeBlock(corpus: Corpus, n: FnNode): string {
  if (n.sourceBlock && corpus.blockById[n.sourceBlock]) return n.sourceBlock;
  return blockAt(corpus, n.sourceFile, n.sourceLine) ?? n.sourceBlock ?? n.id;
}

function factBlock(corpus: Corpus, f: FactChip): string {
  const n = corpus.extras ? frameworkData(corpus.extras)?.nodeById[f.node] : undefined;
  return blockAt(corpus, f.sourceFile, f.sourceLine) ?? (n ? nodeBlock(corpus, n) : f.node);
}

// ---------------------------------------------------------------------------------------------
// Candidate pools for a reading

export function readingNodes(data: FnData, readingId: string): FnNode[] {
  return data.nodes.filter((n) => n.readingIds.includes(readingId));
}

interface PlaceCandidate {
  itemId: string;
  blockId: string;
  /** 0 curated change, 1 item cited in this reading's file, 2 item cited elsewhere. */
  rank: number;
  payload: PlacePayload;
  /** Node whose item this is (facts), to keep explore chips out of discovery placements. */
  factId: string | null;
}

interface ExploreCandidate {
  itemId: string;
  blockId: string;
  payload: ExplorePayload;
}

interface CompareCandidate {
  itemId: string;
  blockId: string;
  curated: boolean;
  payload: ComparePayload;
}

export interface Pools {
  explore: ExploreCandidate[];
  place: PlaceCandidate[];
  compare: CompareCandidate[];
}

function pickExploreChips(n: FnNode, readingFile: string | null, rng: () => number): FactChip[] {
  const facts = shuffle(factsOf(n), rng).sort((a, b) => Number(b.sourceFile === readingFile) - Number(a.sourceFile === readingFile));
  const chosen: FactChip[] = [];
  // One of each facet present first, so every bin is in play.
  for (const f of nonEmptyFacets(n)) {
    const hit = facts.find((x) => x.facet === f);
    if (hit) chosen.push(hit);
  }
  for (const x of facts) {
    if (chosen.length >= MAX_EXPLORE_CHIPS) break;
    if (!chosen.includes(x)) chosen.push(x);
  }
  return shuffle(chosen, rng);
}

function compareChips(data: FnData, a: FnNode, b: FnNode, rng: () => number): CompareChip[] | null {
  const clean = (n: FnNode, other: FnNode) =>
    factsOf(n).filter((f) => !mentions(f.text, a) && !mentions(f.text, b) && !factsOf(other).some((g) => nearDuplicate(f.text, g.text)));
  const fa = shuffle(clean(a, b), rng);
  const fb = shuffle(clean(b, a), rng);
  if (fa.length < 2 || fb.length < 2 || !data.nodeById[a.id]) return null;
  const k = Math.min(MAX_COMPARE_SIDE, Math.max(fa.length, fb.length));
  const take = (fs: FactChip[], side: 'a' | 'b') => fs.slice(0, k).map((f) => ({ ...f, side }));
  return shuffle([...take(fa, 'a'), ...take(fb, 'b')], rng);
}

export function candidatePools(data: FnData, reading: Reading, corpus: Corpus, rng: () => number): Pools {
  const rid = reading.reading_id;
  const file = reading.source_file ?? null;
  const nodes = readingNodes(data, rid);
  const place: PlaceCandidate[] = [];
  for (const c of data.changes) {
    if (c.readingId !== rid) continue;
    const node = data.nodeById[c.node];
    if (!node || mentions(c.text, node)) continue;
    const decoys = c.decoys.filter((d) => data.nodeById[d] && !mentions(c.text, data.nodeById[d]));
    if (decoys.length < 2 && c.decoys.length >= 2) continue;
    if (decoys.length < 1) continue;
    const blockId =
      (c.sourceBlock && corpus.blockById[c.sourceBlock] ? c.sourceBlock : null) ?? blockAt(corpus, c.sourceFile, c.sourceLine) ?? c.sourceBlock ?? c.id;
    place.push({
      itemId: c.id,
      blockId,
      rank: 0,
      factId: null,
      payload: { kind: 'place', source: 'change', text: c.text, facet: null, answer: c.node, candidates: shuffle([c.node, ...decoys], rng), why: c.why },
    });
  }
  for (const n of nodes) {
    for (const f of factsOf(n)) {
      if (mentions(f.text, n)) continue;
      const decoys = factDecoys(data, n.id, f.text, rng);
      if (!decoys) continue;
      place.push({
        itemId: f.id,
        blockId: factBlock(corpus, f),
        rank: f.sourceFile === file ? 1 : 2,
        factId: f.id,
        payload: { kind: 'place', source: 'fact', text: f.text, facet: f.facet, answer: n.id, candidates: shuffle([n.id, ...decoys], rng), why: '' },
      });
    }
  }
  const explore: ExploreCandidate[] = [];
  for (const n of nodes) {
    const facts = factsOf(n);
    if (nonEmptyFacets(n).length < 2 || facts.length < 3) continue;
    explore.push({ itemId: `fn:${n.id}`, blockId: nodeBlock(corpus, n), payload: { kind: 'explore', node: n.id, chips: pickExploreChips(n, file, rng) } });
  }
  const compare: CompareCandidate[] = [];
  const seenPair = new Set<string>();
  for (const p of data.pairs) {
    if (p.readingId !== rid) continue;
    const a = data.nodeById[p.a];
    const b = data.nodeById[p.b];
    const chips = a && b ? compareChips(data, a, b, rng) : null;
    if (!a || !b || !chips) continue;
    seenPair.add([a.id, b.id].sort().join('~'));
    const src = p.differenceSources[0];
    const blockId =
      (src ? blockAt(corpus, src.sourceFile, src.sourceLine) : null) ?? nodeBlock(corpus, a.readingIds.includes(rid) ? a : b);
    compare.push({ itemId: p.id, blockId, curated: true, payload: { kind: 'compare', a: a.id, b: b.id, chips, differences: p.differences, pairId: p.id } });
  }
  for (const n of nodes) {
    const partners = [...new Set([...relatedOf(data, n.id), ...n.parents, ...(data.childrenOf[n.id] ?? [])])].sort();
    for (const m of partners) {
      const key = [n.id, m].sort().join('~');
      if (seenPair.has(key)) continue;
      const other = data.nodeById[m];
      if (!other) continue;
      const chips = compareChips(data, n, other, rng);
      if (!chips) continue;
      seenPair.add(key);
      compare.push({
        itemId: `fn:${key}`,
        blockId: nodeBlock(corpus, n),
        curated: false,
        payload: { kind: 'compare', a: n.id, b: m, chips, differences: [], pairId: null },
      });
    }
  }
  return { explore, place, compare };
}

// ---------------------------------------------------------------------------------------------
// Timing

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Placement: read the change, find the node. 9–16 s, tightening 7% per pressure round. */
export function placeLimit(text: string, step: number): number {
  const base = Math.min(16000, Math.max(9000, 7000 + words(text) * 350));
  return Math.round(base * Math.pow(0.93, step));
}

/** Compare: sort 4–6 items between two nodes. About 18 s plus 4 s an item. */
export function compareLimit(chips: number, step: number): number {
  return Math.round((18000 + chips * 4000) * Math.pow(0.95, step));
}

// ---------------------------------------------------------------------------------------------
// Plan

export interface BuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
}

function bySrs<T extends { itemId: string }>(xs: readonly T[], ctx: BuildInput, extra: (x: T) => number = () => 0): T[] {
  return shuffle(xs, ctx.rng)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => srsPriority(ctx.srs[a.x.itemId], ctx.today) - srsPriority(ctx.srs[b.x.itemId], ctx.today) || extra(a.x) - extra(b.x) || a.i - b.i)
    .map((v) => v.x);
}

interface Slot {
  kind: 'explore' | 'place' | 'compare';
  itemId: string;
  blockId: string;
  payload: FnPayload;
}

/** Splits the pools into discovery and pressure slots; null if either phase can't reach three. */
export function allocate(pools: Pools, ctx: BuildInput): { discovery: Slot[]; pressure: Slot[] } | null {
  const explore = bySrs(pools.explore, ctx, (x) => -x.payload.chips.length);
  const compare = bySrs(pools.compare, ctx, (x) => (x.curated ? 0 : 1));
  const place = bySrs(pools.place, ctx, (x) => x.rank);
  const discovery: Slot[] = [];
  const pressure: Slot[] = [];
  const used = new Set<string>();
  const take = (s: { itemId: string; blockId: string; payload: FnPayload }, into: Slot[]) => {
    used.add(s.itemId);
    into.push({ kind: s.payload.kind, itemId: s.itemId, blockId: s.blockId, payload: s.payload });
  };
  if (explore[0]) take(explore[0], discovery);
  const exploreChips = new Set(discovery.flatMap((s) => (s.payload.kind === 'explore' ? s.payload.chips.map((c) => c.id) : [])));
  // Discovery placements: not the items just sorted in the explore round.
  for (const p of place) {
    if (discovery.length >= TARGET_PHASE) break;
    if (!used.has(p.itemId) && !(p.factId && exploreChips.has(p.factId))) take(p, discovery);
  }
  if (compare[0]) take(compare[0], pressure);
  for (const p of place) {
    if (pressure.length >= TARGET_PHASE) break;
    if (!used.has(p.itemId)) take(p, pressure);
  }
  // Short on placements: a second explore round before, more compares after.
  for (const e of explore) if (discovery.length < MIN_PHASE && !used.has(e.itemId)) take(e, discovery);
  for (const c of compare) if (pressure.length < MIN_PHASE && !used.has(c.itemId)) take(c, pressure);
  // Still short: a leftover placement (even one whose item was an explore chip) or compare may cross over.
  for (const p of place) if (discovery.length < MIN_PHASE && !used.has(p.itemId)) take(p, discovery);
  for (const c of compare) if (discovery.length < MIN_PHASE && !used.has(c.itemId)) take(c, discovery);
  if (discovery.length < MIN_PHASE || pressure.length < MIN_PHASE) return null;
  return { discovery: discovery.slice(0, MAX_PHASE), pressure: pressure.slice(0, MAX_PHASE) };
}

/** Explore first (open the node, then place); pressure ends on the compare. */
function orderPhase(slots: Slot[], phase: 'discovery' | 'pressure', rng: () => number): Slot[] {
  const rank = (s: Slot) => (phase === 'discovery' ? (s.kind === 'explore' ? 0 : s.kind === 'place' ? 1 : 2) : s.kind === 'place' ? 0 : 1);
  return shuffle(slots, rng)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map((x) => x.s);
}

export function namingFor(data: FnData, corpus: Corpus, reading: Reading, nodeId: string, blockHint?: string): ConceptNaming {
  const n = data.nodeById[nodeId];
  const los = learningObjectives(reading);
  const fallbackLo = los[0]?.id ?? reading.reading_id;
  if (!n) return { term: reading.title, blockId: blockHint ?? reading.reading_id, objectiveId: fallbackLo, line: '' };
  const blockId = blockHint && corpus.blockById[blockHint] ? blockHint : nodeBlock(corpus, n);
  const own = corpus.readingOfBlock[blockId] === reading.reading_id ? corpus.objectiveOfBlock[blockId] : undefined;
  const why = n.responding_to[0] ? ` It was answering: ${n.responding_to[0].replace(/[.;]+$/, '').toLowerCase()}.` : '';
  return {
    term: n.name,
    blockId,
    objectiveId: own ?? fallbackLo,
    line: `${n.summary}${why}`.trim(),
  };
}

/** Node a round is about (answer node, explored node, or the reading-side node of a compare). */
export function roundNode(p: FnPayload, readingNodeIds: ReadonlySet<string>): string {
  if (p.kind === 'explore') return p.node;
  if (p.kind === 'place') return p.answer;
  return readingNodeIds.has(p.a) || !readingNodeIds.has(p.b) ? p.a : p.b;
}

export function buildFrameworkNavigator(reading: Reading, ctx: BuildInput): MechanicPlan<FnPayload> | null {
  const data = frameworkData(ctx.corpus.extras);
  if (!data) return null;
  const pools = candidatePools(data, reading, ctx.corpus, ctx.rng);
  const split = allocate(pools, ctx);
  if (!split) return null;
  const toRound = (s: Slot, phase: 'discovery' | 'pressure', step: number): FnRound => {
    let limit: number | undefined;
    let target: number;
    if (s.payload.kind === 'place') {
      limit = phase === 'pressure' ? placeLimit(s.payload.text, step) : undefined;
      target = limit ?? placeLimit(s.payload.text, 0);
    } else if (s.payload.kind === 'compare') {
      limit = phase === 'pressure' ? compareLimit(s.payload.chips.length, step) : undefined;
      target = limit ?? compareLimit(s.payload.chips.length, 0);
    } else {
      target = 12000 + s.payload.chips.length * 5000;
    }
    const obj = ctx.corpus.objectiveOfBlock[s.blockId];
    return {
      id: `${s.itemId}#${phase}`,
      phase,
      itemId: s.itemId,
      blockId: s.blockId,
      objectiveId: obj,
      category: s.kind === 'explore' ? undefined : CATEGORY,
      timeLimitMs: limit,
      targetMs: target,
      payload: s.payload,
    };
  };
  const disc = orderPhase(split.discovery, 'discovery', ctx.rng).map((s) => toRound(s, 'discovery', 0));
  const press = orderPhase(split.pressure, 'pressure', ctx.rng).map((s, i) => toRound(s, 'pressure', i));
  const rounds = [...disc, ...press];
  const lit = readingNodes(data, reading.reading_id);
  const litIds = new Set(lit.map((n) => n.id));
  const first = disc[0];
  const concept = namingFor(data, ctx.corpus, reading, roundNode(first.payload, litIds), first.payload.kind === 'place' ? undefined : first.blockId);
  const shorts = lit.map((n) => n.short);
  return {
    rounds,
    target: `${shorts.slice(0, 4).join(', ')}${shorts.length > 4 ? ' …' : ''}: what each introduced, restricted and answered`,
    opening: `${reading.reading_id} · Framework Navigator. One map of how the rules grew, lineage by lineage, oldest on the left. ${
      lit.length === 1 ? 'One node belongs to this reading; it is lit.' : `${lit.length} nodes belong to this reading; they are lit.`
    } Open them, put each change where it was made, then tell close neighbours apart against the clock.`,
    concept,
  };
}

/** Names the framework the player missed first in discovery, else the first one they opened. */
export function nameAfterDiscovery(corpus: Corpus, reading: Reading, plan: MechanicPlan<FnPayload>, discovery: readonly RoundResult[]): ConceptNaming {
  const data = frameworkData(corpus.extras);
  if (!data) return plan.concept;
  const lit = new Set(readingNodes(data, reading.reading_id).map((n) => n.id));
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const missed = discovery.map((d) => ({ d, r: byId.get(d.roundId) })).find((x) => x.r && !x.d.correct);
  if (!missed?.r) return plan.concept;
  const p = missed.r.payload;
  return namingFor(data, corpus, reading, roundNode(p, lit), p.kind === 'place' ? undefined : missed.r.blockId);
}

/** Whether the reading's nodes, changes and pairs fill a full arc (three rounds each side). */
export function supportsFrameworkNavigator(reading: Reading, corpus: Corpus): boolean {
  const data = frameworkData(corpus.extras);
  if (!data || readingNodes(data, reading.reading_id).length === 0) return false;
  // Deterministic dry run: allocation only depends on pool sizes, not on the seed.
  const rng = () => 0.5;
  const pools = candidatePools(data, reading, corpus, rng);
  return allocate(pools, { corpus, srs: {}, today: '1970-01-01', rng }) !== null;
}

/** Grade for a partly right sort: all right → shell grades by speed; else 2 when most were right, 1 otherwise. */
export function sortGrade(right: number, total: number, timedOut: boolean): number | undefined {
  if (total > 0 && right === total && !timedOut) return undefined;
  if (timedOut && right === 0) return 0;
  return total > 0 && right / total >= 2 / 3 ? 2 : 1;
}
