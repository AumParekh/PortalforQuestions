// Attribution Grid: pure round building. A statement about a control, a report or a risk decision
// is filed on one of four slots: first line, second line, third line, board / committee. Every
// statement, role and explanation comes from the curated file (validated against the notes by
// tools/games/validate_attribution-grid.py); nothing is generated here.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { ItemSrs, Reading, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { AgData, AgItem, AgRole, RoleId } from './schema';
import { ROLE_IDS, attributionData, firstSentence } from './schema';

export interface AgPayload {
  item: AgItem;
  /** All four roles, so the board can show a role's responsibility on a wrong placement. */
  roles: Record<RoleId, AgRole>;
  /** True when the item comes from another reading in the same area (a top-up). */
  topUp: boolean;
}

export const MIN_ROUNDS = 6;
export const MAX_ROUNDS = 8;
/** Attribution is the Role trap in its purest form (brief §7.1, Party Line / Role traps). */
export const CATEGORY: TrapCategory = 'Role';

export interface AgBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
}

function areaOf(corpus: Corpus, readingId: string): string {
  const r = corpus.readingById[readingId];
  if (r) return String(r.area);
  return readingId.replace(/-\d+.*$/, '');
}

/** The reading's own items, then same-area items from other readings (the top-up pool). */
export function itemPool(corpus: Corpus, reading: Reading, data: AgData | null = attributionData(corpus.extras)): { own: AgItem[]; topUp: AgItem[] } {
  if (!data) return { own: [], topUp: [] };
  const area = String(reading.area);
  const own = data.items.filter((i) => i.readingId === reading.reading_id);
  const topUp = data.items.filter((i) => i.readingId !== reading.reading_id && areaOf(corpus, i.readingId) === area);
  return { own, topUp };
}

/** A full arc needs at least one statement from the reading itself and six in all (own + same-area top-up). */
export function supportsAttribution(reading: Reading, corpus: Corpus): boolean {
  const { own, topUp } = itemPool(corpus, reading);
  return own.length >= 1 && own.length + topUp.length >= MIN_ROUNDS;
}

/**
 * Picks `n` items: the reading's own before top-ups; within that, due before unseen before the
 * rest (shared SRS); then the role filed least so far, so the board sees every slot; ties go to
 * a seeded shuffle.
 */
export function pickItems(own: readonly AgItem[], topUp: readonly AgItem[], n: number, ctx: Pick<AgBuildInput, 'srs' | 'today' | 'rng'>): AgItem[] {
  const cands = [...shuffle(own, ctx.rng).map((item) => ({ item, own: 0 })), ...shuffle(topUp, ctx.rng).map((item) => ({ item, own: 1 }))].map(
    (c, i) => ({ ...c, tier: srsPriority(ctx.srs[c.item.id], ctx.today), i }),
  );
  const counts: Record<RoleId, number> = { first: 0, second: 0, third: 0, board: 0 };
  const out: AgItem[] = [];
  const left = [...cands];
  while (out.length < n && left.length) {
    let best = 0;
    for (let k = 1; k < left.length; k++) {
      const a = left[k];
      const b = left[best];
      const d = a.own - b.own || a.tier - b.tier || counts[a.item.role] - counts[b.item.role] || a.i - b.i;
      if (d < 0) best = k;
    }
    const [c] = left.splice(best, 1);
    counts[c.item.role]++;
    out.push(c.item);
  }
  return out;
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Time to read a statement and file it. Pressure limits tighten ~7% a round; discovery has no
 * limit, only this comfortable target (×1.5) for the SRS speed grade.
 */
export function timeFor(statement: string, pressureStep: number | null): number {
  const base = clamp(4500 + wordCount(statement) * 320, 8000, 13000);
  if (pressureStep === null) return Math.round(base * 1.5);
  return Math.round(base * Math.pow(0.93, pressureStep));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Discovery / pressure split for a session of `total` rounds (3–5 each). */
export function splitCounts(total: number): { discovery: number; pressure: number } {
  const discovery = clamp(Math.floor(total / 2), 3, 5);
  return { discovery, pressure: total - discovery };
}

/** The default naming (§8.3): the frame itself, one line per slot from the roles' own summaries. */
export function defaultNaming(roles: Record<RoleId, AgRole>, blockId: string, objectiveId: string): ConceptNaming {
  const parts = ROLE_IDS.map((id) => {
    const s = firstSentence(roles[id].responsibility);
    return s ? `${roles[id].label}: ${s.charAt(0).toLowerCase()}${s.slice(1)}.` : '';
  }).filter(Boolean);
  return {
    term: 'Three lines of defence, with the board above them',
    blockId,
    objectiveId,
    line: parts.length ? parts.join(' ') : `Who does what here: own the risk, oversee it, assure it, and set direction from above.`,
  };
}

export function buildAttribution(reading: Reading, ctx: AgBuildInput): MechanicPlan<AgPayload> | null {
  const data = attributionData(ctx.corpus.extras);
  if (!data) return null;
  const { own, topUp } = itemPool(ctx.corpus, reading, data);
  if (own.length < 1 || own.length + topUp.length < MIN_ROUNDS) return null;
  const total = Math.min(MAX_ROUNDS, own.length + topUp.length);
  const picked = pickItems(own, topUp, total, ctx);
  const { discovery: nDisc } = splitCounts(picked.length);
  // Own items come first in `picked`, so discovery is the reading's own material where it can be.
  const disc = shuffle(picked.slice(0, nDisc), ctx.rng);
  const press = shuffle(picked.slice(nDisc), ctx.rng);

  const toRound = (item: AgItem, phase: 'discovery' | 'pressure', step: number): MechanicRound<AgPayload> => {
    const limit = phase === 'pressure' ? timeFor(item.statement, step) : undefined;
    return {
      id: `${item.id}#${phase}`,
      phase,
      itemId: item.id,
      blockId: item.sourceBlock,
      objectiveId: ctx.corpus.objectiveOfBlock[item.sourceBlock],
      category: CATEGORY,
      timeLimitMs: limit,
      targetMs: limit ?? timeFor(item.statement, null),
      payload: { item, roles: data.roles, topUp: item.readingId !== reading.reading_id },
    };
  };
  const rounds = [...disc.map((it) => toRound(it, 'discovery', 0)), ...press.map((it, i) => toRound(it, 'pressure', i))];

  const anchor = rounds.find((r) => !r.payload.topUp) ?? rounds[0];
  const los = learningObjectives(reading);
  const objectiveId = (anchor.payload.topUp ? undefined : anchor.objectiveId) ?? los[0]?.id ?? reading.reading_id;
  const concept = defaultNaming(data.roles, anchor.blockId, objectiveId);
  const topUps = rounds.filter((r) => r.payload.topUp).length;
  const n = rounds.length;
  return {
    rounds,
    target: 'whose job each control, report and risk decision is',
    opening:
      `Attribution Grid. ${n} statements about a control, a report or a risk decision, and four desks to file them on. ` +
      `Before you answer, ask whose job it is.` +
      (topUps ? ` This reading gives ${n - topUps}; the rest come from neighbouring readings.` : ''),
    concept,
  };
}

/**
 * Names what the player just missed in discovery (the reading's own item first): the right slot
 * against the one people confuse it with, in the notes' words. Else the default frame naming.
 */
export function nameAfterDiscovery(corpus: Corpus, reading: Reading, plan: MechanicPlan<AgPayload>, discovery: readonly RoundResult[]): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const missed = discovery
    .filter((d) => !d.correct)
    .map((d) => byId.get(d.roundId))
    .filter((r): r is MechanicRound<AgPayload> => !!r);
  const pick = missed.find((r) => !r.payload.topUp) ?? missed[0];
  if (!pick) return plan.concept;
  const { item, roles } = pick.payload;
  const right = roles[item.role].label;
  const wrong = item.confusable ? roles[item.confusable].label : null;
  const los = learningObjectives(reading);
  const objectiveId = pick.payload.topUp ? plan.concept.objectiveId : (corpus.objectiveOfBlock[item.sourceBlock] ?? los[0]?.id ?? reading.reading_id);
  return {
    term: wrong ? `${right}, not ${wrong.charAt(0).toLowerCase()}${wrong.slice(1)}` : right,
    blockId: item.sourceBlock,
    objectiveId,
    line: [item.why, item.whyNot].filter(Boolean).join(' '),
  };
}
