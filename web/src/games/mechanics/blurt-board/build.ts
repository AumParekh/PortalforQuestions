// Blurt Board (PORTAL_PLAN §3c): pure round building. Pick an objective, hand over a blank
// board, let the player free-recall everything; on Check, the objective's extracted items
// (terms, bullets, numeric items, variables) light up as hit or missed. Discovery is a shorter
// objective, untimed; pressure is a timed blurt on another objective. Each round is one target
// item on the board, keyed by its sub-item ID so the shared SRS schedules it.
import type { Corpus } from '../../corpus';
import type { Block, ItemSrs, Objective, Reading, SubItemLike } from '../../types';
import { isLearningObjective } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { emphasised, mathToPlain, splitMath, toDisplay } from '../../text';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { BlurtTarget, KeyWord, TargetKind } from './match';
import { contentStems, directionStems, lightForm, parseNumbers, plainOf, words } from './match';

/** One board: an objective, the targets that are scored on it, and the rest of its items. */
export interface BlurtBoardSpec {
  boardId: string;
  objectiveId: string;
  /** The objective statement (LaTeX), the only prompt on the blank board. */
  objectiveText: string;
  targets: BlurtTarget[];
  /** Other items of the objective: shown as "also recalled" when the player writes them; not scored. */
  extras: BlurtTarget[];
  /** Pressure only: the board's time limit. */
  timeLimitMs?: number;
}

export interface BlurtPayload {
  board: BlurtBoardSpec;
  /** Which target of the board this round scores. */
  itemId: string;
}

export const MIN_TARGETS = 3;
export const DISCOVERY_TARGETS = 4;
export const PRESSURE_TARGETS = 5;
/** Enough for the largest objective (58 items), so "the rest of this objective" is the whole rest. */
export const MAX_EXTRAS = 120;

/** Block types whose items are recall material. Worked examples, tables and diagrams are not. */
const SKIP_BLOCKS = new Set(['exbox', 'table', 'tikzpicture', 'figcap']);
/**
 * Numbers are recall material only in statements of fact, not in examples or tables. Trap boxes
 * (numbers from exam stems: "the stem supplies the $50 billion") and gap boxes (worked set-ups:
 * "the swap curve is flat at 5%") are left out too.
 */
const NUMBER_BLOCKS = new Set(['prose_para', 'keybox', 'defbox', 'fmlbox', 'notebox']);
/** Worked-example set-ups in prose: their numbers are illustrations, not facts to recall. */
const EXERCISE_CUE = /\b(?:calculate|compute|price an?|assum(?:e|ed|ing)|suppose|consider|for example|for instance|e\.g\.|example|stem|worked|this month|last month|face value)\b/i;

/** Significant digits of a number as written ("$521.4375" → 7, "1,750,000" → 3). */
function significantDigits(text: string): number {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(text);
  if (!m) return 0;
  const digits = m[0].replace(/[,.]/g, '').replace(/^0+/, '');
  const intPart = m[0].split('.')[0].replace(/,/g, '');
  return m[0].includes('.') ? digits.length : intPart.replace(/0+$/, '').length;
}
const TRAP_LABEL = /^[A-Z][A-Za-z]*(?:[ -][A-Za-z]+){0,2}(?:,\s*[A-Z]{1,4}-\d+\s*[a-z]?)?\s*[.:]\s+/;
const LO_VERB = /^(Describe|Explain|Identify|Calculate|Compare|Evaluate|Distinguish|Assess|Define|Apply|Discuss|Summari[sz]e|Differentiate|Estimate|Interpret|Analy[sz]e|Contrast|Outline|Recogni[sz]e|Construct|Derive|List)\b/;

function obj(x: SubItemLike): Record<string, unknown> | null {
  return x && typeof x === 'object' ? (x as unknown as Record<string, unknown>) : null;
}
function str(x: unknown): string {
  return typeof x === 'string' ? x : '';
}

/** First sentence of a statement (two when the first is very short), for keywording a bullet. */
export function leadSentence(plain: string): string {
  const parts = plain.split(/(?<=[.!?])\s+(?=[A-Z$(])/);
  let lead = parts[0] ?? plain;
  if (lead.split(/\s+/).length < 5 && parts[1]) lead = `${lead} ${parts[1]}`;
  return lead;
}

/** Acronyms that stand for a term: an explicit "(EAD)", or the term itself when it is one ("IRC"). */
export function acronymsOf(latex: string): string[] {
  const plain = plainOf(latex);
  const out = new Set<string>();
  for (const m of plain.matchAll(/\(([A-Za-z][A-Za-z0-9&-]{1,7})\)/g)) out.add(m[1].toLowerCase());
  const ws = plain.replace(/\([^)]*\)/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (ws.length === 1 && /^[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(ws[0]) && ws[0].length <= 7) out.add(ws[0].toLowerCase());
  return [...out].filter((a) => a.length >= 2);
}

interface RawTarget {
  itemId: string;
  blockId: string;
  kind: TargetKind;
  display: string;
  label?: string;
  /** Plain text the keywords come from. */
  keyText: string;
  /** Emphasised phrases inside the item; their words weigh double. */
  emph: string[];
  acronyms: string[];
  values: number[];
  pct?: boolean;
  /** Variables: the symbol spelled out ("lambda"), which with one keyword recalls the variable. */
  symbolWords?: string[];
  /** Dedupe key. */
  key: string;
}

function termTargets(b: Block): RawTarget[] {
  const out: RawTarget[] = [];
  for (const x of b.terms ?? []) {
    const o = obj(x);
    const id = str(o?.id);
    const text = str(o?.text) || str(o?.plain_text);
    if (!id || !text.trim()) continue;
    const plain = plainOf(text);
    const n = plain.split(/\s+/).length;
    if (plain.length < 2 || plain.length > 90 || n > 10) continue;
    const acronyms = acronymsOf(text);
    // "more than one", "no": marked, but nothing to recall on their own.
    if (!contentStems(plain).some((x) => x.length >= 3) && acronyms.length === 0) continue;
    out.push({ itemId: id, blockId: b.id, kind: 'term', display: text, keyText: plain, emph: [], acronyms, values: [], key: `t:${contentStems(plain).join(' ')}` });
  }
  return out;
}

function bulletTargets(b: Block, objectiveText: string): RawTarget[] {
  const out: RawTarget[] = [];
  const loKey = contentStems(plainOf(objectiveText)).join(' ');
  for (const x of b.bullets ?? []) {
    const o = obj(x);
    const id = str(o?.id);
    const text = str(o?.text) || str(o?.plain_text);
    if (!id || !text.trim()) continue;
    let plain = plainOf(text);
    // Learning-objective restatements are the prompt, not recall material.
    if (b.type === 'keybox' && LO_VERB.test(plain)) continue;
    // A trap bullet's lead-in label is its trap category ("Sibling, IM-2 e."), not content.
    if (b.type === 'trapbox') plain = plain.replace(TRAP_LABEL, '');
    const lead = leadSentence(plain);
    const stems = contentStems(lead);
    if (stems.length < 3 || lead.split(/\s+/).length > 45) continue;
    if (stems.join(' ') === loKey) continue;
    out.push({ itemId: id, blockId: b.id, kind: 'point', display: text, keyText: lead, emph: emphasised(text).map(plainOf), acronyms: [], values: [], key: `p:${stems.join(' ')}` });
  }
  return out;
}

function numberTargets(b: Block): RawTarget[] {
  if (!NUMBER_BLOCKS.has(b.type)) return [];
  const out: RawTarget[] = [];
  for (const x of b.numeric_items ?? []) {
    const o = obj(x);
    const id = str(o?.id);
    const text = str(o?.text);
    const context = str(o?.context);
    if (!id || !text.trim() || !context.trim()) continue;
    const ctxPlain = plainOf(context);
    // Arithmetic lines, number lists and display formulas are working, not facts to recall.
    if (/\d%?\s*[-+−×*/=]\s*\$?\s*\d/.test(ctxPlain) || parseNumbers(ctxPlain).length > 5) continue;
    if (EXERCISE_CUE.test(ctxPlain)) continue;
    if (splitMath(context).some((seg) => seg.kind === 'math' && mathToPlain(seg.tex) === null)) continue;
    const numPlain = plainOf(text);
    const parsed = parseNumbers(numPlain);
    const raw = typeof o?.value === 'number' ? (o.value as number) : parsed[0]?.value;
    if (raw === undefined || !Number.isFinite(raw)) continue;
    // 0, 1 and 100% turn up everywhere; five-plus significant digits are computed, not remembered.
    if (raw === 0 || raw === 1 || (raw === 100 && /%|percent/.test(numPlain)) || significantDigits(numPlain) > 4) continue;
    const scale = str(o?.scale).toLowerCase();
    const mult = scale === 'thousand' ? 1e3 : scale === 'million' ? 1e6 : scale === 'billion' ? 1e9 : scale === 'trillion' ? 1e12 : 1;
    const values = [Math.abs(raw)];
    if (mult !== 1) values.push(Math.abs(raw) * mult);
    let pct = str(o?.unit) === '%' || /%|percent/.test(numPlain);
    // Basis points: "50 bp" is also "0.5%" (and "0.005").
    if (str(o?.unit) === 'bp' || /\bbps?\b|basis point/i.test(numPlain)) {
      values.push(Math.abs(raw) / 100);
      pct = true;
    }
    // Keywords: the context without its numbers.
    const keyText = ctxPlain.replace(/\d[\d,.]*/g, ' ');
    if (contentStems(keyText).length < 3) continue;
    out.push({ itemId: id, blockId: b.id, kind: 'number', display: context, label: text, keyText, emph: [], acronyms: [], values, pct, key: `n:${values[0]}:${contentStems(keyText).join(' ')}` });
  }
  return out;
}

function variableTargets(b: Block): RawTarget[] {
  const out: RawTarget[] = [];
  for (const v of b.variables ?? []) {
    if (!v || typeof v !== 'object') continue;
    const id = str(v.id);
    const symbol = str(v.symbol);
    const def = str(v.definition);
    if (!id || !symbol.trim() || !def.trim()) continue;
    const plain = plainOf(def);
    if (contentStems(plain).length < 2) continue;
    const symbolWords = words(plainOf(symbol)).filter((w) => w.length >= 3);
    out.push({ itemId: id, blockId: b.id, kind: 'variable', display: `${symbol} — ${def}`, label: symbol, keyText: plain, emph: [], acronyms: [], values: [], symbolWords, key: `v:${contentStems(plain).join(' ')}` });
  }
  return out;
}

/** Every recall item of an objective, de-duplicated, in reading order. */
export function rawTargets(o: Objective): RawTarget[] {
  const out: RawTarget[] = [];
  const seen = new Set<string>();
  const objectiveText = o.text ?? '';
  for (const b of o.blocks ?? []) {
    if (!b || typeof b.id !== 'string' || SKIP_BLOCKS.has(b.type)) continue;
    // A consolidated trap summary spans the whole reading; it sits under the last objective only by position.
    if (b.type === 'trapbox' && /consolidated|summary/i.test(b.title ?? '')) continue;
    const items = [...termTargets(b), ...variableTargets(b), ...numberTargets(b), ...bulletTargets(b, objectiveText)];
    for (const t of items) {
      if (seen.has(t.key) || seen.has(t.itemId)) continue;
      seen.add(t.key);
      seen.add(t.itemId);
      out.push(t);
    }
  }
  return out;
}

/** Document frequency of stems across a reading's recall items, for keyword weights. */
function documentFrequency(items: readonly RawTarget[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of items) for (const s of new Set(contentStems(t.keyText))) df.set(s, (df.get(s) ?? 0) + 1);
  return df;
}

function finalise(t: RawTarget, df: Map<string, number>, n: number): BlurtTarget {
  const emph = new Set(t.emph.flatMap((e) => contentStems(e)));
  const keys: KeyWord[] = contentStems(t.keyText).map((s) => {
    const w = 1 + Math.log(Math.max(1, n) / Math.max(1, df.get(s) ?? 1));
    return { s, w: Math.round((emph.has(s) ? 2 : 1) * w * 1000) / 1000 };
  });
  return {
    itemId: t.itemId,
    blockId: t.blockId,
    kind: t.kind,
    display: t.display,
    ...(t.label !== undefined ? { label: t.label } : {}),
    keys,
    acronyms: [...t.acronyms, ...(t.symbolWords ?? [])].filter((a, i, xs) => xs.indexOf(a) === i),
    values: t.values,
    ...(t.pct ? { pct: true } : {}),
    directions: t.kind === 'term' ? [] : directionStems(t.keyText),
    // A term that is one keyword once stop words go must be written as the term.
    ...(t.kind === 'term' && keys.length <= 1 ? { phrase: words(t.keyText).map(lightForm) } : {}),
  };
}

const targetCache = new WeakMap<Reading, Map<string, BlurtTarget[]>>();

/** Lettered objectives, skipping malformed ones (content is still being refined). */
function objectivesOf(reading: Reading): Objective[] {
  const os = Array.isArray(reading?.objectives) ? reading.objectives : [];
  return os.filter((o) => !!o && typeof o.id === 'string' && typeof o.letter === 'string' && isLearningObjective(o));
}

/** Finalised recall items of every learning objective in a reading (cached per reading object). */
export function readingTargets(reading: Reading): Map<string, BlurtTarget[]> {
  const cached = targetCache.get(reading);
  if (cached) return cached;
  const raw = new Map<string, RawTarget[]>();
  for (const o of objectivesOf(reading)) {
    try {
      raw.set(o.id, rawTargets(o));
    } catch {
      // Malformed objective (content is still being refined): skip it rather than fail the reading.
    }
  }
  const all = [...raw.values()].flat();
  const df = documentFrequency(all);
  const out = new Map<string, BlurtTarget[]>();
  for (const [id, items] of raw) out.set(id, items.map((t) => finalise(t, df, all.length)));
  targetCache.set(reading, out);
  return out;
}

/** Learning objectives with enough recall items for a board. */
export function eligibleObjectives(reading: Reading): { o: Objective; items: BlurtTarget[] }[] {
  const byLo = readingTargets(reading);
  return objectivesOf(reading)
    .map((o) => ({ o, items: byLo.get(o.id) ?? [] }))
    .filter((x) => x.items.length >= MIN_TARGETS);
}

export function supportsBlurt(reading: Reading): boolean {
  return eligibleObjectives(reading).length >= 2;
}

export interface BlurtBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
}

const KIND_QUALITY: Record<TargetKind, number> = { term: 3, variable: 2, number: 2, point: 2 };

function quality(t: BlurtTarget): number {
  // Single-word terms without an acronym are thin recall targets; multi-word terms and acronyms are the vocabulary.
  if (t.kind === 'term' && t.keys.length <= 1 && t.acronyms.length === 0) return 1;
  // Trap-box bullets are about how the exam misleads; the objective's own content comes first.
  if (t.kind === 'point' && /\.trapbox\./.test(t.blockId)) return 1;
  return KIND_QUALITY[t.kind];
}

function flat(t: BlurtTarget): string {
  return ` ${words(plainOf(t.display)).join(' ')} `;
}

/** Two items say the same thing on a board: a term that is the lead-in of a bullet, or one text inside the other. */
export function overlaps(a: BlurtTarget, b: BlurtTarget): boolean {
  const x = flat(a);
  const y = flat(b);
  return x.trim().length > 0 && y.trim().length > 0 && (x.includes(y) || y.includes(x));
}

/** Picks n targets: due first, then unseen, then the rest; within a tier, richer items first; no kind takes over the board. */
export function pickTargets(items: readonly BlurtTarget[], n: number, ctx: BlurtBuildInput): BlurtTarget[] {
  const tier = (t: BlurtTarget) => srsPriority(ctx.srs[t.itemId], ctx.today);
  const ordered = shuffle(items, ctx.rng)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => tier(a.t) - tier(b.t) || quality(b.t) - quality(a.t) || a.i - b.i)
    .map((x) => x.t);
  const cap = Math.ceil(n / 2);
  const picked: BlurtTarget[] = [];
  const perKind = new Map<TargetKind, number>();
  const clashes = (t: BlurtTarget) => picked.some((p) => overlaps(p, t));
  for (const t of ordered) {
    if (picked.length >= n) break;
    if ((perKind.get(t.kind) ?? 0) >= cap || clashes(t)) continue;
    picked.push(t);
    perKind.set(t.kind, (perKind.get(t.kind) ?? 0) + 1);
  }
  // Top up past the kind cap; overlapping items only if the board would otherwise be too small.
  for (const allowClash of [false, true]) {
    for (const t of ordered) {
      const room = allowClash ? MIN_TARGETS : n;
      if (picked.length >= room) break;
      if (!picked.includes(t) && (allowClash || !clashes(t))) picked.push(t);
    }
  }
  // Board order follows the reading, so the lit-up board reads like the notes.
  return items.filter((t) => picked.includes(t));
}

/** Time for a timed blurt: a settling allowance plus time per target. */
export function boardTimeMs(targets: number): number {
  return 45000 + 20000 * targets;
}

/** How long, untimed, a considered blurt of this size takes (grading speed is not used here). */
export function boardTargetMs(targets: number): number {
  return 60000 + 20000 * targets;
}

function makeBoard(o: Objective, items: readonly BlurtTarget[], n: number, phase: 'discovery' | 'pressure', ctx: BlurtBuildInput): BlurtBoardSpec {
  const targets = pickTargets(items, n, ctx);
  const extras = items.filter((t) => !targets.includes(t)).slice(0, MAX_EXTRAS);
  return {
    boardId: `${o.id}#${phase}`,
    objectiveId: o.id,
    objectiveText: o.text ?? '',
    targets,
    extras,
    ...(phase === 'pressure' ? { timeLimitMs: boardTimeMs(targets.length) } : {}),
  };
}

/** A short name for an item, for the naming step. Never cut mid-text: a label, a bold phrase, or the whole lead. */
export function shortName(t: BlurtTarget): string {
  const plain = toDisplay(t.display).replace(/\s+/g, ' ').trim();
  if (t.kind === 'term') return plain.replace(/[.:;,]+$/, '');
  if (t.kind === 'variable') return plain;
  if (t.kind === 'number') return toDisplay(t.label ?? '') || plain;
  const label = /^([^.:;]{2,60})[.:]\s/.exec(plain);
  if (label && label[1].split(/\s+/).length <= 6) return label[1];
  const emph = emphasised(t.display).filter((x) => x.split(/\s+/).length >= 2);
  return emph[0] ?? leadSentence(plain).replace(/[.;:]+$/, '');
}

const KIND_ROLE: Record<TargetKind, string> = {
  term: 'A marked term',
  point: 'A point the notes make',
  number: 'A number the notes pin down',
  variable: 'A variable from the notation key',
};

/** What the notes say around a term: the bullet of its block that carries it, else the sentence that uses it. */
function termSentence(block: Block | undefined, term: string): string {
  if (!block) return '';
  const norm = (x: string) => x.toLowerCase().replace(/[“”"]/g, '').trim();
  const needle = norm(term);
  const longer = (x: string) => norm(x).includes(needle) && norm(x).length > needle.length + 8;
  for (const x of block.bullets ?? []) {
    const o = obj(x);
    const text = toDisplay(o ? str(o.text) : typeof x === 'string' ? x : '');
    if (text && longer(text)) return text;
  }
  const src = block.plain_text ?? block.body_latex ?? '';
  const sentences = toDisplay(src)
    .split(/\s*•\s*|(?<=[.!?])\s+(?=[A-Z])/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return sentences.find(longer) ?? '';
}

export function namingFor(corpus: Corpus, t: BlurtTarget, objectiveId: string): ConceptNaming {
  const block = corpus.blockById[t.blockId];
  const term = shortName(t);
  const where = block?.title ? ` in “${toDisplay(block.title)}”` : '';
  const body = t.kind === 'term' ? termSentence(block, term) : toDisplay(t.display);
  const same = body.replace(/[.;:]+$/, '').trim().toLowerCase() === term.toLowerCase();
  return {
    term,
    blockId: t.blockId,
    objectiveId,
    line: body && !same ? `${KIND_ROLE[t.kind]} under ${objectiveId}${where}: ${body}` : `${KIND_ROLE[t.kind]} under ${objectiveId}${where}.`,
  };
}

export function buildBlurt(reading: Reading, ctx: BlurtBuildInput): MechanicPlan<BlurtPayload> | null {
  const eligible = eligibleObjectives(reading);
  if (eligible.length < 2) return null;
  // Objectives with the most due, then unseen, items come first.
  const urgency = (items: readonly BlurtTarget[]) =>
    items.reduce((s, t) => s + (srsPriority(ctx.srs[t.itemId], ctx.today) === 0 ? 3 : srsPriority(ctx.srs[t.itemId], ctx.today) === 1 ? 1 : 0), 0) /
    Math.max(1, items.length);
  const ranked = shuffle(eligible, ctx.rng)
    .map((x, i) => ({ ...x, u: urgency(x.items), i }))
    .sort((a, b) => b.u - a.u || a.i - b.i);
  // Pressure takes the most urgent objective; discovery the shortest of the next few (a shorter LO).
  const pressureLo = ranked[0];
  const rest = ranked.slice(1, 4);
  const discoveryLo = [...rest].sort((a, b) => a.items.length - b.items.length || a.i - b.i)[0];
  if (!pressureLo || !discoveryLo) return null;

  const disc = makeBoard(discoveryLo.o, discoveryLo.items, Math.min(DISCOVERY_TARGETS, discoveryLo.items.length), 'discovery', ctx);
  const pres = makeBoard(pressureLo.o, pressureLo.items, Math.min(PRESSURE_TARGETS, pressureLo.items.length), 'pressure', ctx);
  if (disc.targets.length < MIN_TARGETS || pres.targets.length < MIN_TARGETS) return null;

  const toRound = (board: BlurtBoardSpec, t: BlurtTarget, phase: 'discovery' | 'pressure'): MechanicRound<BlurtPayload> => ({
    id: `${t.itemId}#${phase}`,
    phase,
    itemId: t.itemId,
    blockId: t.blockId,
    objectiveId: board.objectiveId,
    ...(board.timeLimitMs ? { timeLimitMs: board.timeLimitMs } : {}),
    targetMs: board.timeLimitMs ?? boardTargetMs(board.targets.length),
    payload: { board, itemId: t.itemId },
  });
  const rounds = [...disc.targets.map((t) => toRound(disc, t, 'discovery')), ...pres.targets.map((t) => toRound(pres, t, 'pressure'))];
  const concept = namingFor(ctx.corpus, disc.targets[0], disc.objectiveId);
  return {
    rounds,
    target: `free recall of ${disc.objectiveId} and ${pres.objectiveId}`,
    opening: `${reading.reading_id} · Blurt Board. Two objectives, two blank boards. For each, write down everything you can remember — one idea per line, in your own words, in any order. Then the board shows what the notes hold that you found, and what stayed dark. The second board runs against the clock.`,
    concept,
  };
}

/** Names the first item the player left dark on the discovery board; else the first one they found. */
export function nameAfterDiscovery(corpus: Corpus, plan: MechanicPlan<BlurtPayload>, discovery: readonly RoundResult[]): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const played = discovery.map((d) => ({ d, r: byId.get(d.roundId) })).filter((x): x is { d: RoundResult; r: MechanicRound<BlurtPayload> } => !!x.r);
  const missed = played.filter((x) => !x.d.correct);
  const pick = missed.find((x) => x.r.payload.board.targets.find((t) => t.itemId === x.r.itemId)?.kind === 'term') ?? missed[0] ?? played[0];
  if (!pick) return plan.concept;
  const t = pick.r.payload.board.targets.find((x) => x.itemId === pick.r.itemId);
  return t ? namingFor(corpus, t, pick.r.payload.board.objectiveId) : plan.concept;
}

