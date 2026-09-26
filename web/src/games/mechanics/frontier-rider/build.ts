// Frontier Rider: pure round building. Each curated item (one input on a slider, one point to
// track) gives a "move" round: predict where the point goes, then watch. Two follow-up rounds are
// derived from the same live maths when they have a clear answer: "cal" (does the line from the
// risk-free asset tilt steeper, flatter or stay?) and "mix" (which holding gains weight, or, for
// the complete point, does money move into or out of the risky mix?). A reading is supported
// when its rounds fill a full arc: 3 discovery + 3 pressure. No React.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { ItemSrs, Reading } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { MoveCode } from './maths';
import { fmt, stepDecimals } from './maths';
import type { FrItem } from './schema';
import { MECHANIC_KEY, parseFrontierData } from './schema';

export const MIN_DISCOVERY = 3;
export const MAX_DISCOVERY = 5;
export const MIN_PRESSURE = 3;
export const MAX_PRESSURE = 5;
export const MIN_ROUNDS = MIN_DISCOVERY + MIN_PRESSURE;
/** A weight or share change below this (0.5 percentage points) is too small to ask about. */
export const MIX_MIN_CHANGE = 0.005;
/** Below this the weights count as unchanged (they are exactly invariant, e.g. min-variance vs m). */
export const MIX_ZERO = 1e-6;
export const PRESSURE_FLOOR_MS = 12000;

export type RoundKind = 'move' | 'cal' | 'mix';

export interface FrOption {
  key: string;
  label: string;
  /** Why this option is right or wrong; empty for derived options (the facts carry it). */
  why: string;
  correct: boolean;
  /** Direction drawn as the prediction arrow (move rounds only). */
  move: MoveCode | null;
}

export interface FrontierPayload {
  kind: RoundKind;
  item: FrItem;
  question: string;
  options: FrOption[];
}

export interface Candidate {
  /** Stable SRS key: the item id, or "<item id>#cal" / "<item id>#mix". */
  itemId: string;
  kind: RoundKind;
  item: FrItem;
}

// ---------------------------------------------------------------------------------------------
// Data access, cached per corpus

const itemsCache = new WeakMap<Corpus, Map<string, FrItem[]>>();

/** Valid curated items grouped by reading (readings the corpus doesn't know are ignored). */
export function itemsByReading(corpus: Corpus): Map<string, FrItem[]> {
  const hit = itemsCache.get(corpus);
  if (hit) return hit;
  const map = new Map<string, FrItem[]>();
  for (const item of parseFrontierData(corpus.extras?.[MECHANIC_KEY])) {
    if (!corpus.readingById[item.readingId]) continue;
    const list = map.get(item.readingId) ?? [];
    list.push(item);
    map.set(item.readingId, list);
  }
  itemsCache.set(corpus, map);
  return map;
}

// ---------------------------------------------------------------------------------------------
// Words

/** Name of the tracked point. Discovery uses plain words; formal names only after the naming step. */
export function pointName(item: FrItem, kind: FrItem['point'], named: boolean): string {
  const active = item.plane.active;
  if (kind === 'min-variance') return named ? 'global minimum-variance portfolio' : 'minimum-risk portfolio';
  if (kind === 'tangency') {
    if (active) return named ? 'maximum-IR manager mix (tangency)' : 'best manager mix';
    return named ? 'tangency portfolio' : 'optimal risky portfolio';
  }
  if (active) return named ? 'optimal mix of managers and benchmark' : 'chosen mix of managers and benchmark';
  return named ? 'optimal complete portfolio' : 'chosen portfolio';
}

/** "the line from the risk-free asset" / "the capital allocation line". */
export function lineName(item: FrItem, named: boolean): string {
  if (!named) return `line from the ${item.plane.rfName}`;
  return item.plane.active ? 'line from the benchmark (slope = information ratio)' : 'capital allocation line';
}

export function riskyName(item: FrItem): string {
  return item.plane.active ? 'manager mix' : 'risky mix';
}

/** Axis label without its unit in brackets. */
export function axisShort(label: string): string {
  return label.replace(/\s*\([^()]*\)\s*$/, '').trim() || label;
}

export function sliderValue(item: FrItem, v: number): string {
  const s = item.slider;
  return fmt(v, s.param.kind === 'A' ? Math.min(2, Math.max(1, stepDecimals(s.step))) : stepDecimals(s.step));
}

export function sliderSentence(item: FrItem): string {
  return `${item.slider.label}: ${sliderValue(item, item.slider.from)} → ${sliderValue(item, item.slider.to)}.`;
}

const pct = (x: number) => `${fmt(x * 100, 1)}%`;

/** What the maths did between slider.from and slider.to, one short line each. */
export function factLines(item: FrItem, named: boolean): string[] {
  const pts = item.path.points;
  const st = item.path.states;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const s0 = st[0];
  const s1 = st[st.length - 1];
  const out = [
    `${axisShort(item.plane.xLabel)}: ${fmt(a.sigma, 2)}% → ${fmt(b.sigma, 2)}%; ${axisShort(item.plane.yLabel)}: ${fmt(a.mu, 2)}% → ${fmt(b.mu, 2)}%.`,
  ];
  const w = item.assets.map((x, i) => `${x.short} ${pct(a.w[i])} → ${pct(b.w[i])}`);
  out.push(`${item.point === 'complete' ? `Inside the ${riskyName(item)}` : 'Weights'}: ${w.join(', ')}.`);
  if (item.point === 'complete') {
    out.push(`In the ${riskyName(item)}: ${pct(a.y)} → ${pct(b.y)}; in the ${item.plane.rfName}: ${pct(1 - a.y)} → ${pct(1 - b.y)}.`);
  }
  if (item.point !== 'min-variance' && s0.tangency && s1.tangency) {
    const ratio = named ? (item.plane.active ? ' (information ratio)' : ' (Sharpe ratio)') : '';
    out.push(`Slope of the ${lineName(item, false)}${ratio}: ${fmt(s0.tangency.sharpe, 3)} → ${fmt(s1.tangency.sharpe, 3)}.`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Display text: the notes' content only

/** A reading id as the curated file cites it ("IM-5"). */
const REF = String.raw`\b[A-Z]{2,4}-\d+\b`;
/** One pointer to a line of the notes: "l.533", "IM-5 l.523-526", "table l.196-197", "IM-6 figure caption l.353-357". */
const LINE = String.raw`(?:${REF}(?:'s)?\s+)?(?:(?:figure caption|table|trap summary)\s+)?\bl\.\s?\d+(?:\s?[-–]\s?\d+)?`;
/** A run of them ("l.559 / l.505", "IM-1 l.128-129; table l.196-197"), with an "as in"/"as used at" lead-in and the comma before. */
const LINES = new RegExp(String.raw`(?:\s*,)?\s*(?:as (?:in|at|used at)\s+)?${LINE}(?:\s*[,;/]\s*${LINE})*`, 'g');
const REF_VERB = new RegExp(String.raw`^${REF}\s+(backs|links|makes|gives|sets|says|calls|draws|lists|flags|treats|adds|uses|puts|keeps|states|shows|does|has)\b`);
const REF_RE = new RegExp(REF);

function verbBase(v: string): string {
  return v === 'does' ? 'do' : v === 'has' ? 'have' : v.replace(/s$/, '');
}

/** "IM-4 links …" → "The notes link …" (at the start of a sentence or a bracket). */
function refSubject(s: string, capital: boolean): string {
  return s.replace(REF_VERB, (_, v: string) => `${capital ? 'The' : 'the'} notes ${verbBase(v)}`);
}

/**
 * Drops the curated file's pointers into the notes and keeps the finance: line references ("(IM-5
 * l.523-526)", ", l.285,"), item ids ("as in fr-IM-4-01") and reading ids used as a source ("the
 * IM-5 two-currency universe" → "the two-currency universe", "IM-4 links" → "The notes link"). A
 * bracket left empty goes with its space; a sentence still naming a reading is dropped.
 */
export function withoutRefs(text: string): string {
  let t = text.replace(/\s+as in fr-[A-Za-z0-9-]+/g, '');
  t = t.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => {
    let body = inner
      .replace(LINES, '')
      .replace(/^[\s,;:/]+|[\s,;:/]+$/g, '')
      .trim();
    if (!body || new RegExp(String.raw`^${REF}$`).test(body)) return '';
    body = refSubject(body, false).replace(new RegExp(String.raw`^${REF}\s+`), '');
    return `${/^\s/.test(whole) ? ' ' : ''}(${body})`;
  });
  t = t
    .replace(LINES, '')
    .replace(/\bStart \(([^()]*)\)/g, 'Start: $1')
    .replace(new RegExp(String.raw`\bthe ${REF}\s+`, 'g'), 'the ')
    .replace(new RegExp(String.raw`\b${REF}'s own\b`, 'g'), "the notes' own");
  return t
    .split(/(?<=[.!?])\s+(?=[A-Z“"(])/)
    .map((sent) => refSubject(sent, true))
    .filter((sent) => sent && !REF_RE.test(sent))
    .join(' ')
    .trim();
}

const GREEK = 'lambda|sigma|gamma|beta|rho|mu';

function symbol(base: string, sub?: string, sup?: string): string {
  const b = new RegExp(`^(?:${GREEK})$`).test(base) ? `\\${base}` : base.length > 1 ? `\\mathrm{${base}}` : base;
  const s = sub ? `_{${sub.length > 1 && !/^\d+$/.test(sub) ? `\\mathrm{${sub}}` : sub}}` : '';
  const p = sup ? `^{${sup}}` : '';
  return `${b}${s}${p}`;
}

/**
 * The notes' ASCII notation as a NoteText snippet: "lambda_A = IR / (2 sigma_A)" gets its symbols set
 * as math ($\lambda_A$, $\sigma_A$), as do "gamma-bar", "y*", "S^-1", "sqrt(…)", "sigma1" and "w1";
 * "->" becomes an arrow, "x" between numbers a times sign, and dollar, ampersand and hash signs stay
 * literal. Pointers into the notes are dropped first (withoutRefs).
 */
export function noteLatex(text: string): string {
  const math: string[] = [];
  const keep = (tex: string) => `\u0000${math.push(tex) - 1}\u0000`;
  let t = withoutRefs(text)
    .replace(/->/g, '→')
    .replace(/\s~\s/g, ' ≈ ')
    .replace(/(\d%?)\s+x\s+(?=[\w(])/g, '$1 × ')
    .replace(/\bsqrt\(([^()]*)\)/g, (_, inner: string) => keep(`\\sqrt{${inner.replace(/\^-?(\d+)/g, (m) => `^{${m.slice(1)}}`)}}`))
    .replace(/\bE\(([A-Za-z])_([A-Za-z])\)/g, (_, b: string, i: string) => keep(`E(${b}_{${i}})`))
    .replace(/\bgamma-bar\b/g, () => keep('\\bar{\\gamma}'))
    .replace(/\by\*/g, () => keep('y^*'))
    .replace(new RegExp(String.raw`\b(${GREEK}|[A-Za-z]+)(?:_([A-Za-z0-9]+))?(?:\^(-?\d+))?(?![\w^])`, 'g'), (m, base: string, sub?: string, sup?: string) => {
      const greek = new RegExp(`^(?:${GREEK})$`).test(base);
      if (!sub && !sup && !(greek && base !== 'beta' && base !== 'mu')) return m;
      return keep(symbol(base, sub, sup));
    })
    .replace(new RegExp(String.raw`\b(${GREEK}|w)(\d)\b`, 'g'), (_, base: string, d: string) => keep(symbol(base, d)));
  t = t.replace(/[$&#%_]/g, (c) => `\\${c}`);
  return t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `$${math[Number(i)]}$`);
}

// ---------------------------------------------------------------------------------------------
// Rounds from one item

function moveRound(item: FrItem, rng: () => number): Omit<FrontierPayload, 'kind' | 'item'> {
  const options = shuffle(
    item.options.map((o, i) => ({ key: `o${i}`, label: o.label, why: o.why, correct: o.correct, move: o.move })),
    rng,
  );
  return { question: item.question, options };
}

function calRound(item: FrItem, named: boolean, rng: () => number): Omit<FrontierPayload, 'kind' | 'item'> | null {
  if (!item.calSlope) return null;
  const unit = item.plane.active ? 'active return for each unit of TEV' : 'return for each unit of risk';
  const through = pointName(item, 'tangency', named);
  const options: FrOption[] = [
    { key: 'steeper', label: `Steeper: more ${unit}`, why: '', correct: item.calSlope === 'steeper', move: null },
    { key: 'flatter', label: `Flatter: less ${unit}`, why: '', correct: item.calSlope === 'flatter', move: null },
    { key: 'same', label: 'Same slope: it keeps its angle', why: '', correct: item.calSlope === 'same', move: null },
  ];
  return {
    question: `${sliderSentence(item)} Which way does the ${lineName(item, false)} through the ${through} tilt?`,
    options: shuffle(options, rng),
  };
}

function mixRound(item: FrItem, named: boolean, rng: () => number): Omit<FrontierPayload, 'kind' | 'item'> | null {
  const pts = item.path.points;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const name = pointName(item, item.point, named);
  if (item.point === 'complete') {
    const dy = b.y - a.y;
    if (Math.abs(dy) >= MIX_ZERO && Math.abs(dy) < MIX_MIN_CHANGE) return null;
    const rfName = item.plane.rfName;
    const risky = riskyName(item);
    const options: FrOption[] = [
      { key: 'into-risky', label: `More in the ${risky}, less in the ${rfName}`, why: '', correct: dy >= MIX_MIN_CHANGE, move: null },
      { key: 'into-rf', label: `More in the ${rfName}, less in the ${risky}`, why: '', correct: dy <= -MIX_MIN_CHANGE, move: null },
      { key: 'same', label: 'The split does not change', why: '', correct: Math.abs(dy) < MIX_ZERO, move: null },
    ];
    return {
      question: `${sliderSentence(item)} How does the ${name} split its money between the ${risky} and the ${rfName}?`,
      options: shuffle(options, rng),
    };
  }
  const dw = item.assets.map((_, i) => b.w[i] - a.w[i]);
  const maxAbs = Math.max(...dw.map(Math.abs));
  if (maxAbs >= MIX_ZERO && maxAbs < MIX_MIN_CHANGE) return null;
  const unchanged = maxAbs < MIX_ZERO;
  const gainer = unchanged ? -1 : dw.indexOf(Math.max(...dw));
  let assetOpts: FrOption[] = item.assets.map((x, i) => ({ key: `a${i}`, label: `More ${x.short}`, why: '', correct: i === gainer, move: null }));
  if (assetOpts.length > 3) {
    // Keep at most four options: the right asset plus two others.
    const keep = new Set([...shuffle(assetOpts.filter((o) => !o.correct), rng).slice(0, unchanged ? 3 : 2), ...assetOpts.filter((o) => o.correct)]);
    assetOpts = assetOpts.filter((o) => keep.has(o));
  }
  const options: FrOption[] = [...assetOpts, { key: 'same', label: 'Neither: the weights do not change', why: '', correct: unchanged, move: null }];
  return {
    question: `${sliderSentence(item)} Which holding gains weight in the ${name}?`,
    options: shuffle(options, rng),
  };
}

/** Rounds one item can give (move always; cal and mix when they have a clear answer). */
export function candidatesOf(item: FrItem): Candidate[] {
  const out: Candidate[] = [{ itemId: item.id, kind: 'move', item }];
  const probe = () => 0.5;
  if (calRound(item, false, probe)) out.push({ itemId: `${item.id}#cal`, kind: 'cal', item });
  if (mixRound(item, false, probe)) out.push({ itemId: `${item.id}#mix`, kind: 'mix', item });
  return out;
}

export function readingCandidates(reading: Reading, corpus: Corpus): Candidate[] {
  return (itemsByReading(corpus).get(reading.reading_id) ?? []).flatMap(candidatesOf);
}

export function supportsFrontierRider(reading: Reading, corpus: Corpus): boolean {
  const c = readingCandidates(reading, corpus);
  return c.length >= MIN_ROUNDS && c.filter((x) => x.kind === 'move').length >= 2;
}

export function toPayload(c: Candidate, named: boolean, rng: () => number): FrontierPayload | null {
  const body = c.kind === 'move' ? moveRound(c.item, rng) : c.kind === 'cal' ? calRound(c.item, named, rng) : mixRound(c.item, named, rng);
  if (!body || body.options.filter((o) => o.correct).length !== 1) return null;
  return { kind: c.kind, item: c.item, ...body };
}

// ---------------------------------------------------------------------------------------------
// Naming

const TERM: Record<FrItem['point'], [string, string]> = {
  tangency: [
    'Tangency portfolio: weights $\\propto \\Sigma^{-1}(\\mu - r_f\\mathbf{1})$',
    'Maximum-IR manager mix: the tangency portfolio, with the benchmark as $r_f$',
  ],
  'min-variance': ['Global minimum-variance portfolio: weights $\\propto \\Sigma^{-1}\\mathbf{1}$', 'Global minimum-variance portfolio: weights $\\propto \\Sigma^{-1}\\mathbf{1}$'],
  complete: [
    'Optimal complete portfolio: $y^* = (E[R_T] - r_f) / (A\\sigma_T^2)$',
    'Optimal active risk on the line from the benchmark: $\\sigma = \\mathrm{IR} / A$',
  ],
};

/** The explanation's first sentence (two when the first is very short). */
export function leadSentence(text: string): string {
  const parts: string[] = [];
  const re = /[.!?](?=\s+[A-Z“"(])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && parts.join(' ').length < 80) {
    parts.push(text.slice(last, m.index + 1).trim());
    last = m.index + 1;
  }
  if (parts.length === 0) return text.trim();
  return parts.join(' ');
}

export function objectiveOf(corpus: Corpus, reading: Reading, item: FrItem): string {
  const fromBlock = item.sourceBlock ? corpus.objectiveOfBlock[item.sourceBlock] : undefined;
  if (fromBlock) return fromBlock;
  const los = learningObjectives(reading);
  return los[los.length - 1]?.id ?? reading.reading_id;
}

export function blockOf(item: FrItem): string {
  return item.sourceBlock ?? item.id;
}

export function namingFor(corpus: Corpus, reading: Reading, item: FrItem): ConceptNaming {
  return {
    term: TERM[item.point][item.plane.active ? 1 : 0],
    blockId: blockOf(item),
    objectiveId: objectiveOf(corpus, reading, item),
    line: noteLatex(leadSentence(withoutRefs(item.explanation))),
  };
}

// ---------------------------------------------------------------------------------------------
// Session build

export interface FrontierBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
}

function wordsIn(p: FrontierPayload): number {
  return [p.question, ...p.options.map((o) => o.label)].join(' ').split(/\s+/).filter(Boolean).length;
}

/** Comfortable time to read the question and options and call the move. */
export function readTimeMs(p: FrontierPayload): number {
  return Math.max(15000, Math.min(32000, 9000 + wordsIn(p) * 230));
}

export function pressureLimit(p: FrontierPayload, step: number): number {
  return Math.max(PRESSURE_FLOOR_MS, Math.round(readTimeMs(p) * Math.pow(0.92, step)));
}

interface Ranked extends Candidate {
  tier: number;
  order: number;
}

export function buildFrontierRider(reading: Reading, ctx: FrontierBuildInput): MechanicPlan<FrontierPayload> | null {
  const items = itemsByReading(ctx.corpus).get(reading.reading_id) ?? [];
  const all = items.flatMap(candidatesOf);
  if (all.length < MIN_ROUNDS || all.filter((c) => c.kind === 'move').length < 2) return null;

  // Items in play order: due first, then unseen, then the rest (shuffled within a tier).
  const tierOf = (id: string) => srsPriority(ctx.srs[id], ctx.today);
  const ranked: Ranked[] = shuffle(all, ctx.rng).map((c, order) => ({ ...c, tier: tierOf(c.itemId), order }));
  const itemTier = (it: FrItem) => Math.min(...ranked.filter((c) => c.item === it).map((c) => c.tier));
  const itemOrder = (it: FrItem) => Math.min(...ranked.filter((c) => c.item === it).map((c) => c.order));
  const orderedItems = [...items].sort((a, b) => itemTier(a) - itemTier(b) || itemOrder(a) - itemOrder(b));
  const byItem = (it: FrItem) => ranked.filter((c) => c.item === it).sort((a, b) => a.tier - b.tier || a.order - b.order);

  const total = Math.min(MAX_DISCOVERY + MAX_PRESSURE, all.length);
  const nDisc = Math.max(MIN_DISCOVERY, Math.min(MAX_DISCOVERY, Math.floor(total / 2)));
  const nPress = Math.max(MIN_PRESSURE, Math.min(MAX_PRESSURE, total - nDisc));
  // At least two headline moves in discovery, so a follow-up never has to come straight after its
  // own item's move (whose feedback already prints the slope and the weights). Half the items
  // otherwise, keeping fresh moves for pressure.
  const dItemsN = Math.min(nDisc, Math.max(Math.min(2, orderedItems.length), Math.ceil(orderedItems.length / 2)));
  const used = new Set<string>();
  const take = (c: Ranked, into: Ranked[]) => {
    used.add(c.itemId);
    into.push(c);
  };

  // Discovery: watch the headline move of the first items, then their follow-ups.
  const disc: Ranked[] = [];
  const dItems = orderedItems.slice(0, dItemsN);
  for (const it of dItems) take(byItem(it).find((c) => c.kind === 'move')!, disc);
  const discFollow = dItems.flatMap((it) => byItem(it).filter((c) => c.kind !== 'move')).sort((a, b) => a.tier - b.tier || a.order - b.order);
  for (const c of discFollow) if (disc.length < nDisc) take(c, disc);
  for (const it of orderedItems.slice(dItemsN)) {
    if (disc.length >= nDisc) break;
    take(byItem(it).find((c) => c.kind === 'move')!, disc);
  }
  // Every move first, then the follow-ups in item order. The previous round's feedback prints the
  // slope and weight changes, so a follow-up straight after its own move would be a giveaway: if
  // the first follow-up belongs to the last move's item, swap the last two moves.
  const discOrder = new Map(orderedItems.map((it, i) => [it, i]));
  const kindRank: Record<RoundKind, number> = { move: 0, mix: 1, cal: 2 };
  disc.sort(
    (a, b) =>
      Number(a.kind !== 'move') - Number(b.kind !== 'move') ||
      (discOrder.get(a.item) ?? 99) - (discOrder.get(b.item) ?? 99) ||
      kindRank[a.kind] - kindRank[b.kind],
  );
  const firstFollow = disc.findIndex((c) => c.kind !== 'move');
  if (firstFollow >= 2 && disc[firstFollow - 1].item === disc[firstFollow].item) {
    [disc[firstFollow - 2], disc[firstFollow - 1]] = [disc[firstFollow - 1], disc[firstFollow - 2]];
  }

  // Pressure: items not yet seen first (novel), then follow-ups, due before unseen before the rest.
  const discItems = new Set(disc.map((c) => c.item));
  const rest = ranked
    .filter((c) => !used.has(c.itemId))
    .sort(
      (a, b) =>
        Number(discItems.has(a.item)) - Number(discItems.has(b.item)) ||
        kindRank[a.kind] - kindRank[b.kind] ||
        a.tier - b.tier ||
        a.order - b.order,
    );
  const press: Ranked[] = [];
  for (const c of rest) if (press.length < nPress) take(c, press);
  if (disc.length < MIN_DISCOVERY || press.length < MIN_PRESSURE) return null;
  // Moves first so a follow-up never gives its own item's move away; follow-ups shuffled.
  const pressMoves = press.filter((c) => c.kind === 'move');
  const pressFollow = shuffle(
    press.filter((c) => c.kind !== 'move'),
    ctx.rng,
  );
  // As in discovery: the first follow-up should not belong to the move just played.
  const lastMove = pressMoves[pressMoves.length - 1];
  if (lastMove && pressFollow.length > 0 && pressFollow[0].item === lastMove.item) {
    const k = pressFollow.findIndex((c) => c.item !== lastMove.item);
    if (k > 0) pressFollow.unshift(...pressFollow.splice(k, 1));
    else if (pressMoves.length >= 2) pressMoves.splice(pressMoves.length - 2, 2, lastMove, pressMoves[pressMoves.length - 2]);
  }
  const pressOrdered = [...pressMoves, ...pressFollow];

  const rounds: MechanicRound<FrontierPayload>[] = [];
  const push = (c: Ranked, phase: 'discovery' | 'pressure', step: number) => {
    const payload = toPayload(c, phase === 'pressure', ctx.rng);
    if (!payload) return;
    const limit = phase === 'pressure' ? pressureLimit(payload, step) : undefined;
    rounds.push({
      id: `${c.itemId}#${phase}`,
      phase,
      itemId: c.itemId,
      blockId: blockOf(c.item),
      objectiveId: objectiveOf(ctx.corpus, reading, c.item),
      timeLimitMs: limit,
      targetMs: limit ?? Math.round(readTimeMs(payload) * 1.5),
      payload,
    });
  };
  disc.forEach((c) => push(c, 'discovery', 0));
  pressOrdered.forEach((c, i) => push(c, 'pressure', i));
  const nd = rounds.filter((r) => r.phase === 'discovery').length;
  if (nd < MIN_DISCOVERY || rounds.length - nd < MIN_PRESSURE) return null;

  const concept = namingFor(ctx.corpus, reading, disc[0].item);
  return {
    rounds,
    target: concept.term,
    opening: `Frontier Rider. ${rounds.length} calls on a risk–return plane. Each time, one input sits on a slider and one portfolio is marked. Before anything moves, call where it goes. Then move the slider and watch the curve and the line break and re-form.`,
    concept,
  };
}

/** Names the item behind the first discovery miss, else the first item watched. */
export function nameAfterDiscovery(
  corpus: Corpus,
  reading: Reading,
  plan: MechanicPlan<FrontierPayload>,
  discovery: readonly RoundResult[],
): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const played = discovery
    .map((d) => ({ d, r: byId.get(d.roundId) }))
    .filter((x): x is { d: RoundResult; r: MechanicRound<FrontierPayload> } => !!x.r);
  const pick = played.find((x) => !x.d.correct) ?? played[0];
  return pick ? namingFor(corpus, reading, pick.r.payload.item) : plan.concept;
}
