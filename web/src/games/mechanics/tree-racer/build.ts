// Tree Racer: pure round building. One round is one node of a curated tree: the node is
// highlighted, three candidate values are offered (the tree's value and two real mistakes), and
// the player picks. Rounds run node by node in the tree's own order, so a phase is one or two
// uninterrupted races: discovery starts a tree from its first node, pressure finishes it (or
// races the next tree). SRS keys are per node: "<item id>:<t>.<i>". No React.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { ItemSrs, Reading, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { Candidate, TreeItem } from './schema';
import { MECHANIC_KEY, parseTreeData } from './schema';

export const MIN_DISCOVERY = 3;
export const MAX_DISCOVERY = 5;
export const MIN_PRESSURE = 3;
export const MAX_PRESSURE = 5;
export const MIN_ROUNDS = MIN_DISCOVERY + MIN_PRESSURE;
/** Comfortable untimed answer times: building a rate is one addition, a valuation node a small sum. */
export const DISCOVERY_TARGET_MS = { forward: 25000, backward: 40000 } as const;
/** First pressure limit, then 10% shorter per round, never under the floor. */
export const PRESSURE_START_MS = { forward: 20000, backward: 32000 } as const;
export const PRESSURE_FLOOR_MS = { forward: 11000, backward: 18000 } as const;

export interface TreePayload {
  item: TreeItem;
  /** Index into item.order of the node this round races. */
  step: number;
  /** Order index where this run on the tree began; earlier nodes are already on the tree. */
  segmentStart: number;
  /** The three candidates in play order (shuffled with the session rng). */
  candidates: Candidate[];
}

export interface Segment {
  item: TreeItem;
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------------------------
// Data access, cached per corpus

const itemsCache = new WeakMap<Corpus, Map<string, TreeItem[]>>();

/** Valid curated trees grouped by reading (readings the corpus doesn't know are ignored). */
export function itemsByReading(corpus: Corpus): Map<string, TreeItem[]> {
  const hit = itemsCache.get(corpus);
  if (hit) return hit;
  const map = new Map<string, TreeItem[]>();
  for (const item of parseTreeData(corpus.extras?.[MECHANIC_KEY])) {
    if (!corpus.readingById[item.readingId]) continue;
    const list = map.get(item.readingId) ?? [];
    list.push(item);
    map.set(item.readingId, list);
  }
  itemsCache.set(corpus, map);
  return map;
}

export function readingTrees(reading: Reading, corpus: Corpus): TreeItem[] {
  return itemsByReading(corpus).get(reading.reading_id) ?? [];
}

export function nodeItemId(item: TreeItem, step: number): string {
  const [t, i] = item.order[step];
  return `${item.id}:${t}.${i}`;
}

/** Order indices where a new date starts, plus the end: a run that stops on one finishes a date. */
export function dateBoundaries(item: TreeItem): Set<number> {
  const out = new Set<number>([item.order.length]);
  for (let k = 1; k < item.order.length; k++) if (item.order[k][0] !== item.order[k - 1][0]) out.add(k);
  return out;
}

/** Longest run length in [lo, hi] (≤ n) ending on a date boundary, else the longest allowed. */
function runLength(item: TreeItem, from: number, lo: number, hi: number): number | null {
  const n = item.order.length - from;
  const bounds = dateBoundaries(item);
  const opts: number[] = [];
  for (let L = Math.min(hi, n); L >= lo; L--) opts.push(L);
  if (!opts.length) return null;
  return opts.find((L) => bounds.has(from + L)) ?? opts[0];
}

/**
 * Discovery: the first ranked tree from its first node, 3–5 nodes, ending on a finished date
 * where possible. Pressure: the rest of that tree, then the next trees from their first node,
 * until 3–5 nodes. Null when the reading can't fill both phases.
 */
export function planSegments(ranked: readonly TreeItem[]): { discovery: Segment[]; pressure: Segment[] } | null {
  const a = ranked.find((it) => it.order.length >= MIN_DISCOVERY);
  if (!a) return null;
  const others = ranked.filter((it) => it !== a);
  const otherNodes = others.reduce((s, it) => s + it.order.length, 0);
  const n = a.order.length;
  const bounds = dateBoundaries(a);
  const lens: number[] = [];
  for (let L = Math.min(MAX_DISCOVERY, n); L >= MIN_DISCOVERY; L--) if (n - L + otherNodes >= MIN_PRESSURE) lens.push(L);
  if (!lens.length) return null;
  const dLen = lens.find((L) => bounds.has(L)) ?? lens[0];
  const discovery: Segment[] = [{ item: a, start: 0, end: dLen }];
  const pressure: Segment[] = [];
  let count = 0;
  if (dLen < n) {
    const take = Math.min(n - dLen, MAX_PRESSURE);
    pressure.push({ item: a, start: dLen, end: dLen + take });
    count = take;
  }
  for (const b of others) {
    if (count >= MIN_PRESSURE) break;
    const L = runLength(b, 0, Math.min(MIN_PRESSURE - count, b.order.length), MAX_PRESSURE - count);
    if (!L) continue;
    pressure.push({ item: b, start: 0, end: L });
    count += L;
  }
  return count >= MIN_PRESSURE ? { discovery, pressure } : null;
}

export function supportsTreeRacer(reading: Reading, corpus: Corpus): boolean {
  const trees = readingTrees(reading, corpus);
  return trees.reduce((s, it) => s + it.order.length, 0) >= MIN_ROUNDS && planSegments(trees) !== null;
}

// ---------------------------------------------------------------------------------------------
// Text helpers

function trimNum(v: number, maxDec = 4): string {
  const s = v.toFixed(maxDec).replace(/\.?0+$/, '');
  return (s === '-0' ? '0' : s).replace(/^-/, '−');
}

export function dateLabel(item: TreeItem, t: number): string {
  if (t === 0) return 'Today';
  const step = item.spec.direction === 'forward' ? item.spec.params.dt : (item.spec.params.accrual ?? 1);
  const months = step * 12;
  if (Math.abs(step - 1) < 1e-9) return `Yr ${t}`;
  if (Math.abs(months - Math.round(months)) < 1e-9) return `${Math.round(months) * t} mo`;
  return `${trimNum(step * t, 2)} yr`;
}

/** Long form for sentences: "month 2", "year 1", "today". */
export function dateWords(item: TreeItem, t: number): string {
  const short = dateLabel(item, t);
  if (short === 'Today') return 'today';
  if (short.startsWith('Yr ')) return `year ${t}`;
  if (short.endsWith(' mo')) return `month ${short.slice(0, -3)}`;
  return short.replace(' yr', ' years');
}

/** Where a node sits by its moves: "up node", "top node", "1 up, 1 down", … */
export function nodeWords(t: number, i: number): string {
  if (t === 0) return 'root';
  if (t === 1) return i === 1 ? 'up node' : 'down node';
  if (i === t) return 'top node';
  if (i === 0) return 'bottom node';
  return `${i} up, ${t - i} down`;
}

export function quantityWord(item: TreeItem): string {
  return item.quantity === 'rate' ? 'rate' : item.quantity === 'price' ? 'price' : 'value';
}

/** Discovery shows mistakes by what was computed, without naming the concept still to come. */
export function mistakeLine(mistake: string, phase: 'discovery' | 'pressure'): string {
  if (phase === 'pressure') return mistake;
  const m = /^non-recombining path:\s*(.+)$/i.exec(mistake);
  if (!m) return mistake;
  return m[1][0].toUpperCase() + m[1].slice(1);
}

export interface ParamRow {
  label: string;
  value: string;
}

/** The notes' parameters as a strip of label/value pairs (rates and q are drawn on the tree itself). */
export function paramRows(item: TreeItem): ParamRow[] {
  const P = item.rawParams;
  const num = (k: string) => (typeof P[k] === 'number' && Number.isFinite(P[k]) ? (P[k] as number) : null);
  const list = (k: string) => (Array.isArray(P[k]) && (P[k] as unknown[]).every((x) => typeof x === 'number') ? (P[k] as number[]) : null);
  const rows: ParamRow[] = [];
  const push = (label: string, value: string | null) => value !== null && rows.push({ label, value });
  const pct = (k: string) => (num(k) === null ? null : `${trimNum(num(k) as number)}%`);
  const money = (k: string) => {
    const v = num(k);
    return v === null ? null : `$${trimNum(v, 2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  };
  if (item.direction === 'forward') {
    push('r₀', pct('r0'));
    const dt = num('dt');
    if (dt !== null) push('dt', Math.abs(dt - 1 / 12) < 1e-9 ? '1/12 year' : `${trimNum(dt)} year`);
    push('σ', pct('sigma'));
    if (num('sigma_sqrt_dt') !== null) push('σ√dt (as printed)', pct('sigma_sqrt_dt'));
    if (item.modelCode === 'model2') push('λ', pct('lambda'));
    if (item.modelCode === 'vasicek') {
      push('k', num('k') === null ? null : trimNum(num('k') as number));
      push('θ', pct('theta'));
    }
    const lt = list('lambda_t');
    if (item.modelCode === 'holee' && lt) push(`λ₁ … λ${subscript(lt.length)}`, lt.map((v) => `${trimNum(v)}%`).join(', '));
    const a = list('a');
    if (item.modelCode === 'lognormal_sb' && a) push(`a₁ … a${subscript(a.length)}`, a.map((v) => trimNum(v)).join(', '));
    push('p', num('p') === null ? null : trimNum(num('p') as number));
  } else {
    push('Face', money('face'));
    if (num('coupon')) push('Coupon', `${money('coupon')} per year`);
    if (num('maturity_steps') !== null) push('Bond maturity', `${dateWords(item, num('maturity_steps') as number)}`);
    if (num('strike') !== null) push('Strike', money('strike'));
    if (num('expiry_step') !== null) push('Option expiry', dateWords(item, num('expiry_step') as number));
    if (num('premium')) push('Risk premium', `${trimNum((num('premium') as number) * 100)} bp`);
    push('Notional', money('notional'));
    push('Fixed rate', pct('fixed_rate'));
    const acc = num('accrual');
    if (acc !== null && Math.abs(acc - 1) > 1e-9) push('Step', `${trimNum(acc)} year`);
  }
  return rows;
}

function subscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])
    .join('');
}

// ---------------------------------------------------------------------------------------------
// Naming (§8.3)

const TERMS: Record<TreeItem['modelCode'], string> = {
  model1: 'A recombining tree: up-then-down lands where down-then-up does',
  model2: 'Drift in a recombining tree: every branch shifts by the same λ dt',
  holee: 'Ho–Lee: a time-dependent drift that still recombines',
  vasicek: 'Mean reversion breaks recombination, so the middle node is averaged',
  lognormal_sb: 'Lognormal rate tree: steps add in ln r, so the lattice recombines',
  zero_backward: 'Backward induction: each node discounts at its own rate',
  option_backward: 'Backward induction for an option: payoff at expiry, then discount back',
  cmt_swap: 'Backward induction with a payoff at every node',
};

export function objectiveOf(corpus: Corpus, reading: Reading, item: TreeItem): string {
  const fromBlock = item.sourceBlock ? corpus.objectiveOfBlock[item.sourceBlock] : undefined;
  if (fromBlock) return fromBlock;
  const los = learningObjectives(reading);
  return los[los.length - 1]?.id ?? reading.reading_id;
}

export function blockOf(item: TreeItem): string {
  return item.sourceBlock ?? item.id;
}

export function namingFor(corpus: Corpus, reading: Reading, item: TreeItem): ConceptNaming {
  return {
    term: TERMS[item.modelCode],
    blockId: blockOf(item),
    objectiveId: objectiveOf(corpus, reading, item),
    line: item.teaches || item.title,
  };
}

// ---------------------------------------------------------------------------------------------
// Session build

export interface TreeBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
}

export function pressureLimit(direction: 'forward' | 'backward', step: number): number {
  return Math.max(PRESSURE_FLOOR_MS[direction], Math.round(PRESSURE_START_MS[direction] * Math.pow(0.9, step)));
}

/** Trees ranked for this session: any due node first, then any unseen node, then the rest; ties shuffled. */
export function rankTrees(trees: readonly TreeItem[], ctx: Pick<TreeBuildInput, 'srs' | 'today' | 'rng'>): TreeItem[] {
  const keyed = shuffle(trees, ctx.rng).map((item, order) => {
    const tiers = item.order.map((_, k) => srsPriority(ctx.srs[nodeItemId(item, k)], ctx.today));
    return { item, order, tier: Math.min(...tiers), due: tiers.filter((x) => x === 0).length };
  });
  keyed.sort((a, b) => a.tier - b.tier || b.due - a.due || a.order - b.order);
  return keyed.map((k) => k.item);
}

export function categoryOf(item: TreeItem): TrapCategory {
  return item.direction === 'forward' ? 'Formula' : 'Intermediate result';
}

export function buildTreeRacer(reading: Reading, ctx: TreeBuildInput): MechanicPlan<TreePayload> | null {
  const trees = readingTrees(reading, ctx.corpus);
  if (trees.reduce((s, it) => s + it.order.length, 0) < MIN_ROUNDS) return null;
  const plan = planSegments(rankTrees(trees, ctx));
  if (!plan) return null;

  const rounds: MechanicRound<TreePayload>[] = [];
  const add = (seg: Segment, phase: 'discovery' | 'pressure') => {
    for (let k = seg.start; k < seg.end; k++) {
      const pStep = phase === 'pressure' ? rounds.filter((r) => r.phase === 'pressure').length : 0;
      const limit = phase === 'pressure' ? pressureLimit(seg.item.direction, pStep) : undefined;
      const itemId = nodeItemId(seg.item, k);
      rounds.push({
        id: `${itemId}#${phase}`,
        phase,
        itemId,
        blockId: blockOf(seg.item),
        objectiveId: objectiveOf(ctx.corpus, reading, seg.item),
        category: categoryOf(seg.item),
        timeLimitMs: limit,
        targetMs: limit ?? DISCOVERY_TARGET_MS[seg.item.direction],
        payload: { item: seg.item, step: k, segmentStart: seg.start, candidates: shuffle(seg.item.candidates[k], ctx.rng) },
      });
    }
  };
  for (const seg of plan.discovery) add(seg, 'discovery');
  for (const seg of plan.pressure) add(seg, 'pressure');

  const first = plan.discovery[0].item;
  const concept = namingFor(ctx.corpus, reading, first);
  const noun = first.direction === 'forward' ? 'rates, built forward from today' : `${quantityWord(first)}s, worked back from the last date`;
  return {
    rounds,
    target: concept.term,
    opening: `${reading.reading_id} · Tree Racer. A tree of ${noun}, one node at a time. Each highlighted node has three candidate values and only one keeps the tree in one piece. Pick it and the tree grows; pick another and watch where that branch goes.`,
    concept,
  };
}

/** Names the tree the player raced in discovery. */
export function nameAfterDiscovery(
  corpus: Corpus,
  reading: Reading,
  plan: MechanicPlan<TreePayload>,
  discovery: readonly RoundResult[],
): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const played = discovery.map((d) => byId.get(d.roundId)).filter((r): r is MechanicRound<TreePayload> => !!r);
  return played[0] ? namingFor(corpus, reading, played[0].payload.item) : plan.concept;
}
