// Case Docket (brief §7.4): pure round building. A named case comes before the bench with a stack
// of fact chips; some are true of it, some were lifted from other cases' files. Discovery sorts one
// docket ("this case" / "not this case"), untimed. Pressure puts two cases on the bench and deals
// chips one at a time against a clock, each routed to the case it belongs to.
//
// Every chip is a fact from the notes (see cases.ts), with its own case's name redacted. Each chip
// is one round, keyed by the fact's extracted-item ID, so the shared SRS schedule applies; no two
// chips in a session share an item.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { Reading, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicContext, MechanicPlan, MechanicRound } from '../../arc/plugin';
import { srsPriority } from '../../srs';
import { seededRng, shuffle } from '../../random';
import { toDisplay } from '../../text';
import { MASK, caseIndex, casesWithFacts } from './cases';
import type { CaseFact, CaseIndex, Discriminator } from './cases';

export type DocketMode = 'docket' | 'compare';

export interface DocketCase {
  id: string;
  name: string;
  /** Readings that name the case, for the case card. */
  citedIn: string[];
}

export interface DocketPayload {
  mode: DocketMode;
  /** Docket: the one case on trial. Compare: [left, right]. */
  cases: DocketCase[];
  /** Case the fact belongs to. */
  owner: string;
  ownerName: string;
  /** The fact with its own case's name redacted (MASK marks each redaction). */
  masked: string;
  /** What each redaction stands for, in order. */
  names: string[];
  /** The fact as the notes state it. */
  text: string;
  /** Reading the fact comes from. */
  factReading: string;
  /** Docket: 'this' | 'not'. Compare: the owning case id. */
  answer: string;
  category: TrapCategory | null;
}

export type BuildInput = Pick<MechanicContext, 'corpus' | 'srs' | 'today' | 'rng' | 'priorityCategory'>;

export const MIN_PHASE_ROUNDS = 3;
export const MAX_PHASE_ROUNDS = 5;

/** Facts in play order: items not shared with the rival first, then due, unseen, seen; this reading first. */
function ordered(facts: readonly CaseFact[], ctx: BuildInput, readingId: string, shared: ReadonlySet<string>): CaseFact[] {
  const tier = (f: CaseFact) =>
    (shared.has(f.itemId) ? 100 : 0) +
    srsPriority(ctx.srs[f.itemId], ctx.today) * 4 +
    (ctx.priorityCategory && f.category === ctx.priorityCategory ? 0 : 2) +
    (f.readingId === readingId ? 0 : 1);
  return shuffle(facts, ctx.rng)
    .map((f, i) => ({ f, i, t: tier(f) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.f);
}

/** Takes up to n facts whose items are unused and that name none of the forbidden cases. */
function take(list: readonly CaseFact[], n: number, used: Set<string>, forbid: readonly string[] = []): CaseFact[] {
  const out: CaseFact[] = [];
  for (const f of list) {
    if (out.length >= n) break;
    if (used.has(f.itemId) || f.mentions.some((m) => forbid.includes(m))) continue;
    used.add(f.itemId);
    out.push(f);
  }
  return out;
}

export interface Allocation {
  a: string;
  b: string;
  docketTrue: CaseFact[];
  docketFalse: CaseFact[];
  pressure: CaseFact[];
}

/**
 * Distractors for the docket: one of the rival's own facts, then other cases this reading names,
 * then cases from the same area, then anywhere in the corpus; one fact per case in turn.
 */
function distractors(
  idx: CaseIndex,
  corpus: Corpus,
  reading: Reading,
  a: string,
  b: string,
  bLeft: CaseFact[],
  n: number,
  used: Set<string>,
  ctx: BuildInput,
): CaseFact[] {
  const out = take(bLeft, 1, used, [a]);
  const named = new Set(casesWithFacts(idx, reading));
  const others = Object.keys(idx.facts).filter((id) => id !== a && id !== b);
  const area = (f: CaseFact) => corpus.readingById[f.readingId]?.area;
  const tiers: ((f: CaseFact) => boolean)[] = [
    (f) => named.has(f.owner),
    (f) => area(f) === reading.area,
    () => true,
  ];
  for (const inTier of tiers) {
    if (out.length >= n) break;
    const groups = shuffle(others, ctx.rng)
      .map((id) => ordered((idx.facts[id] ?? []).filter(inTier), ctx, reading.reading_id, new Set()))
      .filter((g) => g.length > 0);
    let progress = true;
    while (out.length < n && progress) {
      progress = false;
      for (const g of groups) {
        if (out.length >= n) break;
        const got = take(g, 1, used, [a]);
        if (got.length) {
          out.push(...got);
          progress = true;
        }
      }
    }
  }
  return out;
}

/** Splits facts between the docket (case a on trial) and the compare bench (a against b). */
export function allocate(idx: CaseIndex, corpus: Corpus, reading: Reading, a: string, b: string, ctx: BuildInput): Allocation | null {
  const aAll = (idx.facts[a] ?? []).filter((f) => !f.mentions.includes(b));
  const bAll = (idx.facts[b] ?? []).filter((f) => !f.mentions.includes(a));
  const aItems = new Set(aAll.map((f) => f.itemId));
  const bItems = new Set(bAll.map((f) => f.itemId));
  const aList = ordered(aAll, ctx, reading.reading_id, bItems);
  const bList = ordered(bAll, ctx, reading.reading_id, aItems);
  const used = new Set<string>();
  const pB = take(bList, 2, used);
  const pA = take(aList, 1, used);
  const docketTrue = take(aList, 3, used);
  if (!pB.length || !pA.length || !docketTrue.length) return null;
  while (pA.length + pB.length < 4) {
    const moreB = pB.length < 3 ? take(bList, 1, used) : [];
    if (moreB.length) {
      pB.push(...moreB);
      continue;
    }
    const moreA = take(aList, 1, used);
    if (!moreA.length) break;
    pA.push(...moreA);
  }
  if (pA.length + pB.length < MIN_PHASE_ROUNDS) return null;
  const nFalse = Math.max(2, Math.min(3, MAX_PHASE_ROUNDS - docketTrue.length));
  const docketFalse = distractors(idx, corpus, reading, a, b, bList, nFalse, used, ctx);
  if (docketTrue.length + docketFalse.length < MIN_PHASE_ROUNDS || docketFalse.length === 0) return null;
  return { a, b, docketTrue, docketFalse, pressure: [...pA, ...pB] };
}

/** The notes' own line setting a against b: a trap before a box, this reading's before others'. */
export function discriminator(idx: CaseIndex, corpus: Corpus, reading: Reading, a: string, b: string): Discriminator | undefined {
  const rank = (d: Discriminator) => (d.kind === 'trap' ? 0 : 2) + (d.readingId === reading.reading_id ? 0 : 1);
  return idx.discriminators
    .filter((d) => d.cases.includes(a) && d.cases.includes(b) && (d.kind === 'box' || corpus.trapById[d.id]))
    .sort((x, y) => rank(x) - rank(y))[0];
}

/** Candidate pairs from the cases this reading names: the notes' own discriminators first, then due material. */
function pairs(idx: CaseIndex, corpus: Corpus, reading: Reading, ctx: BuildInput): [string, string][] {
  const named = casesWithFacts(idx, reading);
  const items = (id: string) => new Set((idx.facts[id] ?? []).map((f) => f.itemId)).size;
  const due = (id: string) => (idx.facts[id] ?? []).filter((f) => srsPriority(ctx.srs[f.itemId], ctx.today) === 0).length;
  const local = (id: string) => ((idx.facts[id] ?? []).some((f) => f.readingId === reading.reading_id) ? 0 : 1);
  const out: { p: [string, string]; k: number[] }[] = [];
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const [x, y] = [named[i], named[j]];
      // The case with more material goes on trial first; the other joins it on the bench.
      const p: [string, string] = items(x) >= items(y) ? [x, y] : [y, x];
      // The reading's own cases first, then pairs the notes set side by side, then enough material
      // on both sides, then due material.
      const thin = Math.min(items(x), items(y)) >= 2 ? 0 : 1;
      out.push({ p, k: [local(x) + local(y), discriminator(idx, corpus, reading, x, y) ? 0 : 1, thin, -(due(x) + due(y)), ctx.rng()] });
    }
  }
  out.sort((u, v) => u.k.reduce((acc, x, i) => acc || x - v.k[i], 0));
  return out.flatMap(({ p }) => [p, [p[1], p[0]] as [string, string]]);
}

function docketCase(idx: CaseIndex, id: string): DocketCase {
  const c = idx.cases[id];
  return { id, name: c?.name ?? id, citedIn: c?.citedIn ?? [] };
}

/** Plain length of a chip as read (redactions count as two words). */
function readLength(masked: string): number {
  return toDisplay(masked.split(MASK).join('the firm')).length;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

export function discoveryTargetMs(masked: string): number {
  return clamp(6000 + 60 * readLength(masked), 8000, 20000);
}

export function pressureLimitMs(masked: string, step: number): number {
  return Math.round(clamp(5000 + 55 * readLength(masked), 8000, 18000) * Math.pow(0.94, step));
}

function objectiveIn(corpus: Corpus, reading: Reading, blockId: string, fallback: readonly CaseFact[]): string {
  if (corpus.readingOfBlock[blockId] === reading.reading_id && corpus.objectiveOfBlock[blockId]) return corpus.objectiveOfBlock[blockId];
  const local = fallback.find((f) => f.readingId === reading.reading_id && f.objectiveId);
  if (local?.objectiveId) return local.objectiveId;
  const los = learningObjectives(reading);
  return los[0]?.id ?? reading.objectives[0]?.id ?? reading.reading_id;
}

/**
 * Just-in-time naming: the notes' own line separating the two cases when one exists (a trap that
 * names both), else a trap fact from the session, else the case's first fact.
 */
export function conceptFor(idx: CaseIndex, corpus: Corpus, reading: Reading, al: Allocation): ConceptNaming {
  const nameA = idx.cases[al.a]?.name ?? al.a;
  const nameB = idx.cases[al.b]?.name ?? al.b;
  const term = `${nameA} versus ${nameB}`;
  const session = [...al.docketTrue, ...al.pressure];
  const d = discriminator(idx, corpus, reading, al.a, al.b);
  if (d) return { term, blockId: d.blockId, objectiveId: objectiveIn(corpus, reading, d.blockId, session), line: toDisplay(d.text) };
  const fact = session.find((f) => f.category) ?? al.docketTrue[0] ?? session[0];
  const owner = idx.cases[fact.owner]?.name ?? fact.owner;
  return {
    term,
    blockId: fact.blockId,
    objectiveId: objectiveIn(corpus, reading, fact.blockId, session),
    line: `${owner} · ${toDisplay(fact.text)}`,
  };
}

function round(f: CaseFact, phase: 'discovery' | 'pressure', step: number, payload: DocketPayload): MechanicRound<DocketPayload> {
  const limit = phase === 'pressure' ? pressureLimitMs(f.masked, step) : undefined;
  return {
    id: `${f.itemId}#${phase}`,
    phase,
    itemId: f.itemId,
    blockId: f.blockId,
    objectiveId: f.objectiveId,
    category: f.category ?? undefined,
    timeLimitMs: limit,
    targetMs: limit ?? discoveryTargetMs(f.masked),
    payload,
  };
}

function payloadOf(idx: CaseIndex, f: CaseFact, mode: DocketMode, cases: DocketCase[], answer: string): DocketPayload {
  return {
    mode,
    cases,
    owner: f.owner,
    ownerName: idx.cases[f.owner]?.name ?? f.owner,
    masked: f.masked,
    names: f.names,
    text: f.text,
    factReading: f.readingId,
    answer,
    category: f.category,
  };
}

export function buildCaseDocket(reading: Reading, ctx: BuildInput): MechanicPlan<DocketPayload> | null {
  const idx = caseIndex(ctx.corpus);
  if (casesWithFacts(idx, reading).length < 2) return null;
  let al: Allocation | null = null;
  for (const [a, b] of pairs(idx, ctx.corpus, reading, ctx)) {
    al = allocate(idx, ctx.corpus, reading, a, b, ctx);
    if (al) break;
  }
  if (!al) return null;
  const A = docketCase(idx, al.a);
  const B = docketCase(idx, al.b);
  const discovery = shuffle([...al.docketTrue, ...al.docketFalse], ctx.rng).map((f) =>
    round(f, 'discovery', 0, payloadOf(idx, f, 'docket', [A], f.owner === al!.a ? 'this' : 'not')),
  );
  const pressure = shuffle(al.pressure, ctx.rng).map((f, i) => round(f, 'pressure', i, payloadOf(idx, f, 'compare', [A, B], f.owner)));
  const concept = conceptFor(idx, ctx.corpus, reading, al);
  return {
    rounds: [...discovery, ...pressure],
    target: concept.term,
    opening: `${reading.reading_id} · Case Docket. A case file lands on the bench with a stack of loose facts. Some belong to it; some were lifted from other files. Sort the stack. Then a second file joins the first, and every fact has to go back where it came from.`,
    concept,
  };
}

const SUPPORT = new WeakMap<Corpus, Map<string, boolean>>();

/** True only when the reading names two cases whose facts fill a whole arc. */
export function supportsCaseDocket(reading: Reading, corpus: Corpus): boolean {
  let memo = SUPPORT.get(corpus);
  if (!memo) {
    memo = new Map();
    SUPPORT.set(corpus, memo);
  }
  const hit = memo.get(reading.reading_id);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    ok = buildCaseDocket(reading, { corpus, srs: {}, today: '1970-01-01', rng: seededRng(1), priorityCategory: null }) !== null;
  } catch {
    ok = false;
  }
  memo.set(reading.reading_id, ok);
  return ok;
}
