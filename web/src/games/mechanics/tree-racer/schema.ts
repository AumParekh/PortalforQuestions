// Tree Racer: defensive reading of corpus.extras['tree-racer'] (curated, validated offline by
// tools/games/validate_tree_racer.py). Every item is type-guarded field by field and then
// re-checked with the lattice engine in maths.ts: each node is recomputed from the params with
// the model's rule, forward trees must recombine (or, for Vasicek, average the two routes), the
// race order must walk the tree date by date, each visited node needs exactly one correct
// candidate among three distinct values, and every phantom is recomputed. A malformed or edited
// item is dropped whole, so the game can only lose a tree, never ship a wrong one. Pure.
import type { BackwardParams, Computed, ForwardParams, ModelCode, Routes, Spec, Unit } from './maths';
import { RECOMBINING, close, computeTree, formatValue, halfUnit, isBackwardModel, isForwardModel, phantomFor } from './maths';

export const MECHANIC_KEY = 'tree-racer';

export type Quantity = 'rate' | 'price' | 'value';
export type NodeKey = `${number},${number}`;

export interface TreeNode {
  t: number;
  i: number;
  value: number;
  display: string;
  given: boolean;
}

export interface Candidate {
  value: number;
  display: string;
  correct: boolean;
  /** The named mistake that produces this value (null for the tree's value). */
  mistake: string | null;
  mistakeCode: string | null;
}

export interface Phantom {
  mistakeCode: string;
  fromValue: number;
  /** Forward: the wrong node's two children. Backward: the parent value(s) it would produce. */
  kind: 'children' | 'parents';
  at: [number, number][];
  values: number[];
  real: number[];
  displays: string[];
  /** Forward children past the last date of the tree. */
  beyondTree: boolean;
}

export interface TreeItem {
  id: string;
  readingId: string;
  sourceBlock: string | null;
  title: string;
  model: string;
  modelCode: ModelCode;
  /** The node rule in the notes' words, with $latex$. */
  rule: string;
  spec: Spec;
  /** The params as the notes give them (for the parameter strip). */
  rawParams: Record<string, unknown>;
  steps: number;
  quantity: Quantity;
  direction: 'forward' | 'backward';
  unit: Unit;
  decimals: number;
  recombining: boolean;
  teaches: string;
  nodes: TreeNode[][];
  order: [number, number][];
  candidates: Candidate[][];
  phantom: Phantom[][];
  /** Option items: the bond price at each node. */
  underlying: TreeNode[][] | null;
  /** Forward: [via up move, via down move] into each node, for the averaging note. */
  routes: Routes | null;
  /** Every value that can be drawn on a forward tree's axis. */
  range: [number, number];
  /** Smallest gap between two real nodes of one date (value units). */
  minSep: number;
}

export function nodeKey(t: number, i: number): NodeKey {
  return `${t},${i}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const numArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum);
const optNum = (v: unknown): number | undefined => (isNum(v) ? v : undefined);

function pair(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) ? [v[0], v[1]] : null;
}

function forwardParams(model: ModelCode, raw: Record<string, unknown>, steps: number): ForwardParams | null {
  const { r0, dt, sigma } = raw;
  if (!isNum(r0) || !isNum(dt) || !(dt > 0) || !isNum(sigma) || sigma < 0) return null;
  const P: ForwardParams = { r0, dt, sigma };
  if (raw.sigma_sqrt_dt !== undefined) {
    if (!isNum(raw.sigma_sqrt_dt)) return null;
    P.sigmaSqrtDt = raw.sigma_sqrt_dt;
  }
  // Time-dependent drifts need one entry per step plus one for a phantom past the last date.
  if (model === 'model2') {
    if (!isNum(raw.lambda)) return null;
    P.lambda = raw.lambda;
  } else if (model === 'holee') {
    if (!numArray(raw.lambda_t) || raw.lambda_t.length < steps + 1) return null;
    P.lambdaT = raw.lambda_t;
  } else if (model === 'vasicek') {
    if (!isNum(raw.k) || !isNum(raw.theta)) return null;
    P.k = raw.k;
    P.theta = raw.theta;
  } else if (model === 'lognormal_sb') {
    if (!numArray(raw.a) || raw.a.length < steps + 1) return null;
    P.a = raw.a;
  }
  return P;
}

function backwardParams(raw: Record<string, unknown>): BackwardParams | null {
  const { rates, q } = raw;
  if (!Array.isArray(rates) || rates.length === 0) return null;
  for (let t = 0; t < rates.length; t++) if (!numArray(rates[t]) || (rates[t] as number[]).length !== t + 1) return null;
  if (!Array.isArray(q) || !q.every((x) => x === null || (isNum(x) && x >= 0 && x <= 1))) return null;
  const rn = raw.round_nodes;
  if (rn !== undefined && rn !== null && !(isInt(rn) && rn >= 0 && rn <= 6)) return null;
  return {
    rates: rates as number[][],
    q: q as (number | null)[],
    face: optNum(raw.face),
    coupon: optNum(raw.coupon),
    accrual: optNum(raw.accrual),
    maturitySteps: optNum(raw.maturity_steps),
    premium: optNum(raw.premium),
    strike: optNum(raw.strike),
    expiryStep: optNum(raw.expiry_step),
    notional: optNum(raw.notional),
    fixedRate: optNum(raw.fixed_rate),
    steps: optNum(raw.steps),
    roundNodes: rn === undefined || rn === null ? null : (rn as number),
  };
}

function parseLevels(raw: unknown, unit: Unit, decimals: number, check: number[][] | null): TreeNode[][] | null {
  if (!Array.isArray(raw)) return null;
  const out: TreeNode[][] = [];
  for (let t = 0; t < raw.length; t++) {
    const row = raw[t];
    if (!Array.isArray(row) || row.length !== t + 1) return null;
    const lvl: TreeNode[] = [];
    for (let i = 0; i < row.length; i++) {
      const n = row[i];
      if (!isRecord(n) || n.t !== t || n.i !== i || !isNum(n.value) || !isStr(n.display)) return null;
      if (check) {
        const v = check[t]?.[i];
        if (v === undefined || !Number.isFinite(v) || !close(n.value, v)) return null;
      }
      if (n.display !== formatValue(unit, decimals, n.value)) return null;
      lvl.push({ t, i, value: n.value, display: n.display, given: n.given === true });
    }
    out.push(lvl);
  }
  return out;
}

function parseCandidate(raw: unknown, unit: Unit, decimals: number): Candidate | null {
  if (!isRecord(raw) || !isNum(raw.value) || !isStr(raw.display) || typeof raw.correct !== 'boolean') return null;
  if (raw.display !== formatValue(unit, decimals, raw.value)) return null;
  if (raw.correct) return { value: raw.value, display: raw.display, correct: true, mistake: null, mistakeCode: null };
  if (!isStr(raw.mistake) || !isStr(raw.mistake_code)) return null;
  return { value: raw.value, display: raw.display, correct: false, mistake: raw.mistake.trim(), mistakeCode: raw.mistake_code };
}

function parsePhantom(raw: unknown): Phantom | null {
  if (!isRecord(raw) || !isStr(raw.mistake_code) || !isNum(raw.from_value)) return null;
  if (raw.kind !== 'children' && raw.kind !== 'parents') return null;
  if (!Array.isArray(raw.at) || !numArray(raw.values) || !numArray(raw.real) || !Array.isArray(raw.displays)) return null;
  const at = raw.at.map(pair);
  if (at.some((x) => x === null)) return null;
  if (!raw.displays.every(isStr)) return null;
  return {
    mistakeCode: raw.mistake_code,
    fromValue: raw.from_value,
    kind: raw.kind,
    at: at as [number, number][],
    values: raw.values,
    real: raw.real,
    displays: raw.displays as string[],
    beyondTree: raw.beyond_tree === true,
  };
}

/** Type guard + normaliser + runtime re-check for one curated item; null when anything is off. */
export function parseItem(raw: unknown): TreeItem | null {
  if (!isRecord(raw)) return null;
  const { id, reading_id, title, model, model_code, rule, steps, quantity, direction, unit, decimals, teaches } = raw;
  if (!isStr(id) || !isStr(reading_id) || !isStr(title) || !isStr(model) || !isStr(model_code) || !isStr(rule)) return null;
  if (!isInt(steps) || steps < 2 || steps > 4) return null;
  if (quantity !== 'rate' && quantity !== 'price' && quantity !== 'value') return null;
  if (direction !== 'forward' && direction !== 'backward') return null;
  if (unit !== 'percent' && unit !== 'currency') return null;
  if (!isInt(decimals) || decimals < 0 || decimals > 6) return null;
  if (!isRecord(raw.params)) return null;
  const fwd = direction === 'forward';

  let spec: Spec;
  if (fwd) {
    if (!isForwardModel(model_code)) return null;
    const P = forwardParams(model_code, raw.params, steps);
    if (!P) return null;
    spec = { direction: 'forward', model: model_code, params: P, steps };
  } else {
    if (!isBackwardModel(model_code)) return null;
    const P = backwardParams(raw.params);
    if (!P) return null;
    spec = { direction: 'backward', model: model_code, params: P, steps };
  }
  let computed: Computed;
  try {
    computed = computeTree(spec);
  } catch {
    return null;
  }
  const { levels, routes } = computed;
  if (levels.length < 2 || levels.some((row) => row.some((v) => !Number.isFinite(v)))) return null;
  if (fwd && levels.length !== steps + 1) return null;

  const nodes = parseLevels(raw.nodes, unit, decimals, levels);
  if (!nodes || nodes.length !== levels.length) return null;
  const lastT = nodes.length - 1;
  if (fwd && !nodes[0][0].given) return null;

  // Recombination: up-then-down meets down-then-up, except Vasicek, whose routes differ and are averaged.
  if (fwd && routes) {
    for (let t = 2; t <= lastT; t++) {
      for (let i = 1; i < t; i++) {
        const [up, dn] = routes[t][i];
        if (up === null || dn === null) return null;
        if (RECOMBINING[model_code] ? !close(up, dn) : close(up, dn)) return null;
      }
    }
  }

  // Order: every node not given, once each, date by date in the item's direction.
  if (!Array.isArray(raw.order)) return null;
  const order = raw.order.map(pair);
  if (order.some((x) => x === null)) return null;
  const ord = order as [number, number][];
  const seen = new Set<string>();
  for (const [t, i] of ord) {
    const n = nodes[t]?.[i];
    if (!n || n.given || seen.has(nodeKey(t, i))) return null;
    seen.add(nodeKey(t, i));
  }
  const notGiven = nodes.flat().filter((n) => !n.given).length;
  if (seen.size !== notGiven || ord.length === 0) return null;
  for (let k = 1; k < ord.length; k++) if (fwd ? ord[k][0] < ord[k - 1][0] : ord[k][0] > ord[k - 1][0]) return null;

  // Candidates: three per visited node, one correct (the node), all values apart by more than rounding.
  if (!Array.isArray(raw.candidates) || raw.candidates.length !== ord.length) return null;
  if (!Array.isArray(raw.phantom) || raw.phantom.length !== ord.length) return null;
  const hu = halfUnit(decimals);
  const candidates: Candidate[][] = [];
  const phantom: Phantom[][] = [];
  for (let k = 0; k < ord.length; k++) {
    const [t, i] = ord[k];
    const node = nodes[t][i];
    const rc = raw.candidates[k];
    if (!Array.isArray(rc) || rc.length !== 3) return null;
    const cs = rc.map((c) => parseCandidate(c, unit, decimals));
    if (cs.some((c) => c === null)) return null;
    const list = cs as Candidate[];
    const right = list.filter((c) => c.correct);
    if (right.length !== 1 || !close(right[0].value, node.value) || right[0].display !== node.display) return null;
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        if (Math.abs(list[a].value - list[b].value) <= hu || list[a].display === list[b].display) return null;
      }
    }
    const wrong = list.filter((c) => !c.correct);
    if (new Set(wrong.map((c) => c.mistakeCode)).size !== 2) return null;

    const rp = raw.phantom[k];
    if (!Array.isArray(rp) || rp.length !== 2) return null;
    const ps = rp.map(parsePhantom);
    if (ps.some((p) => p === null)) return null;
    const phs = ps as Phantom[];
    for (const p of phs) {
      const w = wrong.find((c) => c.mistakeCode === p.mistakeCode);
      if (!w || !close(p.fromValue, w.value)) return null;
      const calc = phantomFor(spec, levels, t, i, w.value);
      if (p.kind !== calc.kind || p.at.length !== calc.at.length) return null;
      if (p.at.some(([a, b], j) => a !== calc.at[j][0] || b !== calc.at[j][1])) return null;
      if (p.values.length !== calc.values.length || p.real.length !== calc.real.length || p.displays.length !== p.values.length) return null;
      if (p.values.some((v, j) => !Number.isFinite(calc.values[j]) || !close(v, calc.values[j]))) return null;
      if (p.real.some((v, j) => !Number.isFinite(calc.real[j]) || !close(v, calc.real[j]))) return null;
      if (p.displays.some((d, j) => d !== formatValue(unit, decimals, p.values[j]))) return null;
      if (p.kind === 'children') {
        if (p.values.length !== 2 || p.beyondTree !== t + 1 > lastT) return null;
        if (p.values.some((v, j) => Math.abs(v - p.real[j]) <= hu)) return null;
      } else if (p.values.some((v, j) => Math.abs(v - p.real[j]) <= hu)) return null;
    }
    candidates.push(list);
    phantom.push(phs);
  }

  let underlying: TreeNode[][] | null = null;
  if (raw.underlying !== undefined) {
    underlying = parseLevels(raw.underlying, unit, decimals, computed.underlying);
    if (!underlying || underlying.length !== nodes.length) return null;
  }

  // Axis range and density for the forward layout.
  const all: number[] = nodes.flat().map((n) => n.value);
  for (const cs of candidates) for (const c of cs) all.push(c.value);
  if (fwd) for (const ps of phantom) for (const p of ps) all.push(...p.values, ...p.real);
  // Backward trees are drawn as a lattice (maturity nodes can all be equal), so only forward needs it.
  let minSep = fwd ? Infinity : 1;
  if (fwd) for (const row of nodes) for (let i = 1; i < row.length; i++) minSep = Math.min(minSep, Math.abs(row[i].value - row[i - 1].value));
  if (!Number.isFinite(minSep) || minSep <= 0) return null;

  return {
    id: id.trim(),
    readingId: reading_id.trim(),
    sourceBlock: isStr(raw.source_block) ? raw.source_block.trim() : null,
    title: title.trim(),
    model: model.trim(),
    modelCode: model_code,
    rule,
    spec,
    rawParams: raw.params,
    steps,
    quantity,
    direction,
    unit,
    decimals,
    recombining: RECOMBINING[model_code],
    teaches: isStr(teaches) ? teaches.trim() : '',
    nodes,
    order: ord,
    candidates,
    phantom,
    underlying,
    routes,
    range: [Math.min(...all), Math.max(...all)],
    minSep,
  };
}

/** All valid items, de-duplicated by id (first wins). */
export function parseTreeData(extra: unknown): TreeItem[] {
  const list = isRecord(extra) && Array.isArray(extra.items) ? extra.items : Array.isArray(extra) ? extra : [];
  const seen = new Set<string>();
  const out: TreeItem[] = [];
  for (const raw of list) {
    const item = parseItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
