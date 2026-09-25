// Round builders: everything random about a round (option order, numbers, which variable) is decided
// here once, so a round renders the same after a re-render or a detour away from the screen.
import { MEMORY_PAIRS, canPlay } from './games';
import type { DeckIndex } from './games';
import { highlightSymbol, normTex, skeletonSlots, symbolBase } from './latex';
import { pickOne, randInt, shuffle } from './random';
import { texValid } from './tex';
import type { Formula, FormulaGame, RepairCategory } from './types';
import { MAX_WORKED_CHARS, exampleLine } from './worked';
import { newId } from '../store/session';

interface Base {
  key: string;
  /** Formulas this round is logged against; the first is the one it drills. */
  ids: string[];
}

export type Round =
  | (Base & { game: 'recall' })
  | (Base & { game: 'forge'; tiles: string[] })
  /** `corruption` null = the real formula. */
  | (Base & { game: 'rigged'; options: { latex: string; corruption: number | null }[] })
  | (Base & { game: 'spot'; corruption: number | null })
  | (Base & { game: 'whichway'; sensitivity: number })
  /** Variable indexes shown as symbols, and the same indexes in the order their meanings are listed. */
  | (Base & { game: 'symbols'; symbols: number[]; meanings: number[] })
  | (Base & { game: 'calc'; values: Record<string, number>; answer: number })
  | (Base & { game: 'twins'; why: string; /** Display order of ids[0] and ids[1]. */ order: [string, string] })
  | (Base & { game: 'memory'; numbers: boolean; cards: MemoryCard[] })
  | (Base & { game: 'repair'; marked: string; bad: string; fix: string; tiles: string[]; category: RepairCategory; why: string })
  | (Base & { game: 'auction'; variable: number; highlighted: string | null; options: string[]; answer: number });

export interface MemoryCard {
  key: string;
  formulaId: string;
  face: 'formula' | 'key' | 'number';
  /** For number cards: the worked line shown. */
  text?: string;
}

const roundKey = () => newId('fr');

// ---- Calc helpers ----

function decimalsOf(n: number): number {
  const s = String(n);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

/** A random value in [min, max] on the input's step grid, rounded so float noise never shows. */
export function sampleInput(min: number, max: number, step: number): number {
  if (max <= min) return min;
  if (step <= 0) return Number((min + Math.random() * (max - min)).toFixed(2));
  const n = Math.floor((max - min) / step + 1e-9);
  const places = Math.min(10, Math.max(decimalsOf(step), decimalsOf(min)));
  return Number((min + randInt(n) * step).toFixed(places));
}

/** Accepts within 1% relative or half a unit in the last shown decimal, whichever is looser. */
export function withinTolerance(given: number, answer: number, decimals: number): boolean {
  const diff = Math.abs(given - answer);
  return diff <= Math.abs(answer) * 0.01 + 1e-12 || diff <= 0.5 * 10 ** -decimals + 1e-12;
}

/** Parses typed numbers leniently: spaces, thousands commas, a decimal comma and a trailing % or unit. */
export function parseAnswer(raw: string): number | null {
  let s = raw.trim().replace(/\s+/g, '').replace(/[%$€£]/g, '').replace(/[−–]/g, '-');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d*,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

// ---- Builders ----

function buildForge(f: Formula): Round | null {
  if (!f.skeleton) return null;
  return { key: roundKey(), game: 'forge', ids: [f.id], tiles: shuffle([...f.slots, ...f.decoys]) };
}

function buildRigged(f: Formula): Round | null {
  if (f.corruptions.length === 0) return null;
  const wrong = shuffle(f.corruptions.map((_, i) => i)).slice(0, 3);
  const options = shuffle([{ latex: f.latex, corruption: null }, ...wrong.map((i) => ({ latex: f.corruptions[i].latex, corruption: i }))]);
  return { key: roundKey(), game: 'rigged', ids: [f.id], options };
}

function buildSpot(f: Formula): Round | null {
  if (f.corruptions.length === 0) return null;
  return { key: roundKey(), game: 'spot', ids: [f.id], corruption: Math.random() < 0.5 ? null : randInt(f.corruptions.length - 1) };
}

function buildSymbols(f: Formula): Round | null {
  if (f.variables.length < 3) return null;
  const chosen = shuffle(f.variables.map((_, i) => i)).slice(0, 5);
  return { key: roundKey(), game: 'symbols', ids: [f.id], symbols: shuffle(chosen), meanings: shuffle(chosen) };
}

function buildCalc(f: Formula): Round | null {
  const c = f.calc;
  if (!c) return null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const values: Record<string, number> = {};
    for (const i of c.inputs) values[i.name] = sampleInput(i.min, i.max, i.step);
    const answer = c.evaluate(values);
    if (Number.isFinite(answer) && Math.abs(answer) < 1e12) return { key: roundKey(), game: 'calc', ids: [f.id], values, answer };
  }
  // Ranges that rarely give a finite answer: fall back to the notes' own example.
  if (c.example) {
    const answer = c.evaluate(c.example.inputs);
    if (Number.isFinite(answer)) return { key: roundKey(), game: 'calc', ids: [f.id], values: { ...c.example.inputs }, answer };
  }
  return null;
}

function buildTwins(f: Formula, index: DeckIndex): Round | null {
  const twin = pickOne((index.twinsOf[f.id] ?? []).filter((t) => index.byId[t.a] && index.byId[t.b]));
  if (!twin) return null;
  const other = twin.a === f.id ? twin.b : twin.a;
  const order: [string, string] = Math.random() < 0.5 ? [f.id, other] : [other, f.id];
  return { key: roundKey(), game: 'twins', ids: [f.id, other], why: twin.why, order };
}

const SIGNS = new Set(['+', '-', '\\pm', '\\mp', '−']);

function repairCategory(f: Formula, bad: string, fix: string, index: DeckIndex): RepairCategory {
  const b = normTex(bad);
  if (SIGNS.has(b) && SIGNS.has(normTex(fix))) return 'Sign';
  const symbols = new Set<string>();
  for (const id of index.byReading[f.readingId] ?? [f.id]) for (const v of index.byId[id]?.variables ?? []) symbols.add(normTex(v.symbol));
  return symbols.has(b) ? 'Sibling' : 'Formula';
}

function buildRepair(f: Formula, index: DeckIndex): Round | null {
  const fromData = shuffle(f.corruptions.filter((c) => c.repair));
  for (const c of fromData) {
    const r = c.repair!;
    const tiles = shuffle([r.fix, ...shuffle(r.distractors.filter((d) => normTex(d) !== normTex(r.bad))).slice(0, 3)]);
    if (tiles.length < 2) continue;
    if (!texValid(r.marked.split('{{bad}}').join(`{${r.bad}}`)) || !texValid(r.marked.split('{{bad}}').join(`{${r.fix}}`))) continue;
    return { key: roundKey(), game: 'repair', ids: [f.id], marked: r.marked, bad: r.bad, fix: r.fix, tiles, category: r.category, why: c.why };
  }
  // Fallback: a decoy dropped into one slot of the skeleton is the broken element.
  if (!f.skeleton || f.decoys.length === 0) return null;
  const slotNums = skeletonSlots(f.skeleton);
  for (const n of shuffle(slotNums)) {
    const fix = f.slots[n - 1];
    const bad = pickOne(f.decoys.filter((d) => normTex(d) !== normTex(fix)));
    if (!bad) continue;
    const marked = f.skeleton.replace(/\{\{(\d+)\}\}/g, (_, d: string) => (Number(d) === n ? '{{bad}}' : `{${f.slots[Number(d) - 1]}}`));
    const pool = [...f.decoys, ...f.slots].filter((t) => normTex(t) !== normTex(fix) && normTex(t) !== normTex(bad));
    const distractors = shuffle([...new Map(pool.map((t) => [normTex(t), t])).values()]).slice(0, 3);
    if (distractors.length === 0) continue;
    if (!texValid(marked.split('{{bad}}').join(`{${bad}}`))) continue;
    return {
      key: roundKey(),
      game: 'repair',
      ids: [f.id],
      marked,
      bad,
      fix,
      tiles: shuffle([fix, ...distractors]),
      category: repairCategory(f, bad, fix, index),
      why: '',
    };
  }
  return null;
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'as', 'is', 'at', 'by', 'with', 'from', 'its', 'per']);

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/**
 * Whether two definitions say the same thing: one's content words all appear in the other ("number of
 * observations" vs "number of samples (observations in the window)"), or they are near-identical. Siblings
 * that differ by a word each ("…of asset returns" vs "…of portfolio returns") are kept: telling those apart
 * is the point of the game.
 */
export function tooSimilar(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common === Math.min(wa.size, wb.size) || common / (wa.size + wb.size - common) >= 0.75;
}

function buildAuction(f: Formula, index: DeckIndex): Round | null {
  if (f.variables.length === 0) return null;
  // Prefer a variable that can be highlighted inside the formula.
  const order = shuffle(f.variables.map((_, i) => i));
  let variable = order[0];
  let highlighted: string | null = null;
  for (const i of order) {
    const h = highlightSymbol(f.latex, f.variables[i].symbol);
    if (h) {
      variable = i;
      highlighted = h;
      break;
    }
  }
  const target = f.variables[variable];
  const own = new Set(f.variables.map((v) => v.meaning.toLowerCase()));
  const base = symbolBase(target.symbol);
  const exact = normTex(target.symbol);
  // Neighbours first (same reading), then the rest of the area; similar symbols rank highest.
  const pools = [index.byReading[f.readingId] ?? [], index.byArea[f.area] ?? []];
  const picked: string[] = [];
  for (const pool of pools) {
    const candidates: { meaning: string; score: number }[] = [];
    for (const id of pool) {
      if (id === f.id) continue;
      for (const v of index.byId[id]?.variables ?? []) {
        if (own.has(v.meaning.toLowerCase())) continue;
        const score = (normTex(v.symbol) === exact ? 3 : symbolBase(v.symbol) === base ? 2 : 0) + Math.random();
        candidates.push({ meaning: v.meaning, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates) {
      if (picked.length >= 3) break;
      if (tooSimilar(c.meaning, target.meaning) || picked.some((p) => tooSimilar(p, c.meaning))) continue;
      picked.push(c.meaning);
    }
    if (picked.length >= 3) break;
  }
  if (picked.length < 3) return null;
  const options = shuffle([target.meaning, ...picked]);
  return { key: roundKey(), game: 'auction', ids: [f.id], variable, highlighted, options, answer: options.indexOf(target.meaning) };
}

/** Builds one round of `game` for formula `f`; null when the card can't support it. */
export function buildRound(game: Exclude<FormulaGame, 'memory'>, f: Formula, index: DeckIndex): Round | null {
  if (!canPlay(game, f, index)) return null;
  switch (game) {
    case 'recall':
      return { key: roundKey(), game: 'recall', ids: [f.id] };
    case 'forge':
      return buildForge(f);
    case 'rigged':
      return buildRigged(f);
    case 'spot':
      return buildSpot(f);
    case 'whichway':
      return { key: roundKey(), game: 'whichway', ids: [f.id], sensitivity: randInt(f.sensitivities.length - 1) };
    case 'symbols':
      return buildSymbols(f);
    case 'calc':
      return buildCalc(f);
    case 'twins':
      return buildTwins(f, index);
    case 'repair':
      return buildRepair(f, index);
    case 'auction':
      return buildAuction(f, index);
  }
}

// ---- Memory Match ----

function keySignature(f: Formula): Set<string> {
  return new Set(f.variables.map((v) => normTex(v.symbol)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  const union = a.size + b.size - common;
  return union === 0 ? 1 : common / union;
}

/**
 * A Memory Match board: up to eight formulas from `candidates` (already in priority order), skipping any
 * whose partner card would look near-identical to one already on the board. Null below three pairs.
 */
export function buildMemory(candidates: Formula[], index: DeckIndex, numbers: boolean): Round | null {
  const chosen: { f: Formula; text?: string }[] = [];
  const texts = new Set<string>();
  for (const f of candidates) {
    if (chosen.length >= MEMORY_PAIRS) break;
    if (!canPlay('memory', f, index, { numbers })) continue;
    if (numbers) {
      const line = pickOne(f.worked.filter((w) => w.display.length <= MAX_WORKED_CHARS))?.display ?? exampleLine(f);
      if (!line || texts.has(line)) continue;
      texts.add(line);
      chosen.push({ f, text: line });
    } else {
      const sig = keySignature(f);
      if (chosen.some((c) => jaccard(keySignature(c.f), sig) >= 0.6)) continue;
      chosen.push({ f });
    }
  }
  if (chosen.length < 3) return null;
  const cards: MemoryCard[] = [];
  for (const { f, text } of chosen) {
    cards.push({ key: `${f.id}:formula`, formulaId: f.id, face: 'formula' });
    cards.push(numbers ? { key: `${f.id}:number`, formulaId: f.id, face: 'number', text } : { key: `${f.id}:key`, formulaId: f.id, face: 'key' });
  }
  return { key: roundKey(), game: 'memory', ids: chosen.map((c) => c.f.id), numbers, cards: shuffle(cards) };
}
