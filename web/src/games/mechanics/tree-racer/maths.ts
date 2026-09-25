// Tree Racer: the lattice engine, a TypeScript port of the node rules in
// tools/games/validate_tree_racer.py (MR-12, MR-13, MR-14, MR-15). Only the notes' correct rules
// live here; the named mistakes are checked offline by the validator. The engine recomputes
// every node, the two routes into each forward middle node (the Vasicek averaging), and the
// phantom children / parents a wrong value would produce. Pure: no React, no DOM.

export type ForwardModel = 'model1' | 'model2' | 'holee' | 'vasicek' | 'lognormal_sb';
export type BackwardModel = 'zero_backward' | 'option_backward' | 'cmt_swap';
export type ModelCode = ForwardModel | BackwardModel;

export const FORWARD_MODELS: readonly ForwardModel[] = ['model1', 'model2', 'holee', 'vasicek', 'lognormal_sb'];
export const BACKWARD_MODELS: readonly BackwardModel[] = ['zero_backward', 'option_backward', 'cmt_swap'];
/** Which models recombine without help (Vasicek's middle node is averaged instead). */
export const RECOMBINING: Record<ModelCode, boolean> = {
  model1: true,
  model2: true,
  holee: true,
  vasicek: false,
  lognormal_sb: true,
  zero_backward: true,
  option_backward: true,
  cmt_swap: true,
};

export function isForwardModel(m: string): m is ForwardModel {
  return (FORWARD_MODELS as readonly string[]).includes(m);
}
export function isBackwardModel(m: string): m is BackwardModel {
  return (BACKWARD_MODELS as readonly string[]).includes(m);
}

/** Rates in percent. Arrays are indexed by the step's start date t (a[0] = a_1 in the notes). */
export interface ForwardParams {
  r0: number;
  dt: number;
  sigma: number;
  /** The notes' printed (rounded) sigma*sqrt(dt), used in place of the exact step when present. */
  sigmaSqrtDt?: number;
  lambda?: number;
  lambdaT?: number[];
  k?: number;
  theta?: number;
  a?: number[];
}

export interface BackwardParams {
  /** Rate tree in percent: rates[t][i], i = number of up moves. */
  rates: number[][];
  /** Risk-neutral up probability for the step out of date t; null where the children are equal. */
  q: (number | null)[];
  face?: number;
  coupon?: number;
  accrual?: number;
  maturitySteps?: number;
  premium?: number;
  strike?: number;
  expiryStep?: number;
  notional?: number;
  fixedRate?: number;
  steps?: number;
  roundNodes?: number | null;
}

export type Levels = number[][];
/** routes[t][i] = [value via an up move from (t-1, i-1), value via a down move from (t-1, i)]. */
export type Routes = [number | null, number | null][][];

// ---------------------------------------------------------------------------------------------
// Forward (building the rate tree)

function shock(P: ForwardParams): number {
  return P.sigmaSqrtDt ?? P.sigma * Math.sqrt(P.dt);
}

/** Child of a node worth r at date t; move = +1 up, -1 down. NaN when a parameter is missing. */
export function fwdStep(model: ForwardModel, P: ForwardParams, r: number, t: number, move: 1 | -1): number {
  const dt = P.dt;
  if (model === 'lognormal_sb') {
    const a = P.a?.[t];
    if (a === undefined) return NaN;
    return r * Math.exp(a * dt + move * P.sigma * Math.sqrt(dt));
  }
  let driftRate: number;
  if (model === 'model1') driftRate = 0;
  else if (model === 'model2') driftRate = P.lambda ?? NaN;
  else if (model === 'holee') driftRate = P.lambdaT?.[t] ?? NaN;
  else driftRate = (P.k ?? NaN) * ((P.theta ?? NaN) - r);
  return r + driftRate * dt + move * shock(P);
}

export function forwardTree(model: ForwardModel, P: ForwardParams, steps: number): { levels: Levels; routes: Routes } {
  const levels: Levels = [[P.r0]];
  const routes: Routes = [[[null, null]]];
  for (let t = 0; t < steps; t++) {
    const nxt: number[] = [];
    const rts: [number | null, number | null][] = [];
    for (let i = 0; i < t + 2; i++) {
      const up = i - 1 >= 0 ? fwdStep(model, P, levels[t][i - 1], t, 1) : null;
      const dn = i <= t ? fwdStep(model, P, levels[t][i], t, -1) : null;
      let val: number;
      if (up !== null && dn !== null) val = model === 'vasicek' ? (up + dn) / 2 : up;
      else val = (up ?? dn) as number;
      nxt.push(val);
      rts.push([up, dn]);
    }
    levels.push(nxt);
    routes.push(rts);
  }
  return { levels, routes };
}

// ---------------------------------------------------------------------------------------------
// Backward (valuation on a given rate tree)

function rateAt(P: BackwardParams, t: number, i: number): number {
  const r = P.rates[t]?.[i];
  if (r === undefined) return NaN;
  return t >= 1 ? r + (P.premium ?? 0) : r;
}

function probUp(P: BackwardParams, t: number, up: number, dn: number): number {
  const q = P.q[t];
  if (q === null || q === undefined) return Math.abs(up - dn) > 1e-12 ? NaN : 0.5;
  return q;
}

/**
 * Python's '%.nf' / round(x, n): correctly rounded, and an exact binary tie (3.0625 → 3.062) goes
 * to the even digit, where Number.prototype.toFixed would round it away from zero.
 */
export function pyFixed(x: number, n: number): string {
  const ax = Math.abs(x);
  const plain = ax.toFixed(n);
  const long = ax.toFixed(Math.min(100, n + 30));
  const cut = n === 0 ? long.indexOf('.') : long.indexOf('.') + 1 + n;
  const rest = long.slice(cut).replace('.', '');
  let body = plain;
  if (/^50*$/.test(rest)) {
    const truncated = long.slice(0, cut);
    const last = Number(truncated.replace('.', '').slice(-1));
    if (last % 2 === 0) body = truncated;
  }
  return (x < 0 && Number(body) !== 0 ? '-' : '') + body;
}

export function roundTo(x: number, n: number): number {
  return Number(pyFixed(x, n));
}

function bondNode(P: BackwardParams, V: Levels, t: number, i: number): number {
  const c = P.coupon ?? 0;
  const up = V[t + 1]?.[i + 1];
  const dn = V[t + 1]?.[i];
  if (up === undefined || dn === undefined) return NaN;
  const q = probUp(P, t, up, dn);
  const ev = q * (up + c) + (1 - q) * (dn + c);
  const m = P.accrual ?? 1;
  return ev / (1 + (m * rateAt(P, t, i)) / 100);
}

export function bondTree(P: BackwardParams): Levels {
  const T = P.maturitySteps ?? NaN;
  if (!Number.isInteger(T) || T < 1 || P.face === undefined) return [];
  const V: Levels = new Array<number[]>(T + 1);
  V[T] = new Array<number>(T + 1).fill(P.face);
  for (let t = T - 1; t >= 0; t--) {
    V[t] = [];
    for (let i = 0; i <= t; i++) V[t][i] = bondNode(P, V, t, i);
  }
  return V;
}

function optionNode(P: BackwardParams, O: Levels, B: Levels, t: number, i: number): number {
  const E = P.expiryStep ?? NaN;
  const K = P.strike ?? NaN;
  if (t === E) {
    const b = B[E]?.[i];
    return b === undefined ? NaN : Math.max(b - K, 0);
  }
  const up = O[t + 1]?.[i + 1];
  const dn = O[t + 1]?.[i];
  const q = P.q[t];
  if (up === undefined || dn === undefined || q === null || q === undefined) return NaN;
  const ev = q * up + (1 - q) * dn;
  const r = P.rates[t]?.[i] ?? NaN;
  return ev / (1 + r / 100);
}

export function optionTree(P: BackwardParams): { O: Levels; B: Levels } {
  const B = bondTree(P);
  const E = P.expiryStep ?? NaN;
  if (!Number.isInteger(E) || E < 1 || E >= B.length) return { O: [], B };
  const O: Levels = new Array<number[]>(E + 1);
  O[E] = [];
  for (let i = 0; i <= E; i++) O[E][i] = optionNode(P, O, B, E, i);
  for (let t = E - 1; t >= 0; t--) {
    O[t] = [];
    for (let i = 0; i <= t; i++) O[t][i] = optionNode(P, O, B, t, i);
  }
  return { O, B };
}

function cmtPayoff(P: BackwardParams, t: number, i: number): number {
  if (t === 0) return 0;
  const N = P.notional ?? NaN;
  const r = P.rates[t]?.[i] ?? NaN;
  return ((N / 2) * (r - (P.fixedRate ?? NaN))) / 100;
}

function cmtNode(P: BackwardParams, V: Levels, t: number, i: number): number {
  const T = P.steps ?? NaN;
  let val: number;
  if (t === T) val = cmtPayoff(P, t, i);
  else {
    const up = V[t + 1]?.[i + 1];
    const dn = V[t + 1]?.[i];
    const q = P.q[t];
    if (up === undefined || dn === undefined || q === null || q === undefined) return NaN;
    const ev = q * up + (1 - q) * dn;
    const r = P.rates[t]?.[i] ?? NaN;
    val = ev / (1 + ((P.accrual ?? NaN) * r) / 100) + cmtPayoff(P, t, i);
  }
  // The notes carry each node to the cent ($2,697.53, -$2,217.35) into the next date back.
  return P.roundNodes !== undefined && P.roundNodes !== null ? roundTo(val, P.roundNodes) : val;
}

export function cmtTree(P: BackwardParams): Levels {
  const T = P.steps ?? NaN;
  if (!Number.isInteger(T) || T < 1) return [];
  const V: Levels = new Array<number[]>(T + 1);
  V[T] = [];
  for (let i = 0; i <= T; i++) V[T][i] = cmtNode(P, V, T, i);
  for (let t = T - 1; t >= 0; t--) {
    V[t] = [];
    for (let i = 0; i <= t; i++) V[t][i] = cmtNode(P, V, t, i);
  }
  return V;
}

export function backwardLevels(model: BackwardModel, P: BackwardParams): Levels {
  if (model === 'zero_backward') return bondTree(P);
  if (model === 'option_backward') return optionTree(P).O;
  return cmtTree(P);
}

/** One node recomputed from its children in `L` (which may hold a wrong value). */
export function backwardNode(model: BackwardModel, P: BackwardParams, L: Levels, t: number, i: number): number {
  if (model === 'zero_backward') return bondNode(P, L, t, i);
  if (model === 'option_backward') return optionNode(P, L, bondTree(P), t, i);
  return cmtNode(P, L, t, i);
}

// ---------------------------------------------------------------------------------------------
// Either direction

export type Spec =
  | { direction: 'forward'; model: ForwardModel; params: ForwardParams; steps: number }
  | { direction: 'backward'; model: BackwardModel; params: BackwardParams; steps: number };

export interface Computed {
  levels: Levels;
  /** Forward only: the two routes into each node. */
  routes: Routes | null;
  /** Option items: the bond price tree the payoff is read from. */
  underlying: Levels | null;
}

export function computeTree(spec: Spec): Computed {
  if (spec.direction === 'forward') {
    const { levels, routes } = forwardTree(spec.model, spec.params, spec.steps);
    return { levels, routes, underlying: null };
  }
  if (spec.model === 'option_backward') {
    const { O, B } = optionTree(spec.params);
    return { levels: O, routes: null, underlying: B };
  }
  return { levels: backwardLevels(spec.model, spec.params), routes: null, underlying: null };
}

export interface PhantomCalc {
  kind: 'children' | 'parents';
  at: [number, number][];
  values: number[];
  real: number[];
}

/**
 * What a wrong value w at (t, i) does to the rest of the tree. Forward: its two children under
 * the item's own rule, against the real node's children. Backward: the parent value(s)
 * recomputed with w in place, against the real parents (none at the root).
 */
export function phantomFor(spec: Spec, levels: Levels, t: number, i: number, w: number): PhantomCalc {
  if (spec.direction === 'forward') {
    const { model, params } = spec;
    const real = levels[t]?.[i] ?? NaN;
    return {
      kind: 'children',
      at: [
        [t + 1, i + 1],
        [t + 1, i],
      ],
      values: [fwdStep(model, params, w, t, 1), fwdStep(model, params, w, t, -1)],
      real: [fwdStep(model, params, real, t, 1), fwdStep(model, params, real, t, -1)],
    };
  }
  const at: [number, number][] = [];
  const values: number[] = [];
  const real: number[] = [];
  if (t === 0) return { kind: 'parents', at, values, real };
  const L = levels.map((row) => [...row]);
  L[t][i] = w;
  for (const [pt, pi] of [
    [t - 1, i - 1],
    [t - 1, i],
  ] as const) {
    if (pi >= 0 && pi <= pt) {
      at.push([pt, pi]);
      values.push(backwardNode(spec.model, spec.params, L, pt, pi));
      real.push(levels[pt][pi]);
    }
  }
  return { kind: 'parents', at, values, real };
}

// ---------------------------------------------------------------------------------------------
// Display

export type Unit = 'percent' | 'currency';

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The validator's fmt(): "6.346%", "$1,466.63", "-$2,217.35"; a value that rounds to zero is unsigned. */
export function formatValue(unit: Unit, decimals: number, v: number): string {
  let x = v;
  if (Math.abs(roundTo(x, decimals)) === 0) x = 0;
  if (unit === 'percent') return `${pyFixed(x, decimals)}%`;
  const [ip, fp] = pyFixed(Math.abs(x), decimals).split('.');
  const body = groupThousands(ip) + (fp !== undefined ? `.${fp}` : '');
  return (x < 0 ? '-$' : '$') + body;
}

/** Half a display unit: two values closer than this read the same. */
export function halfUnit(decimals: number): number {
  return 0.5 * Math.pow(10, -decimals);
}

/** "6.346%" → "6.346" (the tree's axis already says percent). */
export function shortDisplay(display: string): string {
  return display.endsWith('%') ? display.slice(0, -1) : display;
}

/** Equal within `tol`, relative for large magnitudes (swap values run to thousands of dollars). */
export function close(a: number, b: number, tol = 1e-9): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}
