// Curve Sculptor: pure maths. No React, no imports, so node can test a compiled copy directly.
//
// - A whitelisted arithmetic expression compiler (x, the item's three parameter names, numbers,
//   + - * / ** ( ) , and Math.exp/log/sqrt/pow/abs/min/max). It builds closures over real JS
//   operators, so the semantics are JavaScript's own; nothing is passed to eval / new Function.
// - The shape predicates, ported one-for-one from tools/games/validate_curve-sculptor.py (same
//   241-point grid, same thresholds measured against the canvas height Y = y.max - y.min).
// - Variant derivation: the curated puzzle plus puzzles where a different parameter is the wrong
//   one, each re-checked with the same predicates, so one item can seed several rounds.
// - Snap test, axis ticks and number formatting for the board.

export const N_GRID = 241;
const MATH_FUNCS = ['exp', 'log', 'sqrt', 'pow', 'abs', 'min', 'max'] as const;
type MathFn = (typeof MATH_FUNCS)[number];

// ---------------------------------------------------------------------------------------------
// Expression compiler

type Tok = { kind: 'num'; v: number } | { kind: 'name'; v: string } | { kind: 'math'; v: MathFn } | { kind: 'op'; v: string };

const TOKEN_RE = /\s*(?:(\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?)|Math\.([a-z]+)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/(),]))/y;

export function tokenizeExpr(src: string): Tok[] | null {
  const out: Tok[] = [];
  const s = src.trimEnd();
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < s.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(s);
    if (!m || TOKEN_RE.lastIndex === pos) return null;
    if (m[1] !== undefined) out.push({ kind: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) {
      if (!(MATH_FUNCS as readonly string[]).includes(m[2])) return null;
      out.push({ kind: 'math', v: m[2] as MathFn });
    } else if (m[3] !== undefined) out.push({ kind: 'name', v: m[3] });
    else out.push({ kind: 'op', v: m[4] });
    pos = TOKEN_RE.lastIndex;
  }
  return out;
}

/** y = f(x, params). Returns NaN rather than throwing. */
export type CurveFn = (x: number, p: Readonly<Record<string, number>>) => number;
type Node = (x: number, p: Readonly<Record<string, number>>) => number;

/**
 * Compiles a whitelisted expression. Null when it uses anything outside the vocabulary, names an
 * identifier other than x and `names`, or would be a JavaScript syntax error (e.g. `-a ** 2`).
 */
export function compileExpr(src: string, names: readonly string[]): CurveFn | null {
  const parsed = tokenizeExpr(src);
  if (!parsed || parsed.length === 0) return null;
  const toks: Tok[] = parsed;
  const allowed = new Set(['x', ...names]);
  let i = 0;
  const peekOp = (v: string) => i < toks.length && toks[i].kind === 'op' && toks[i].v === v;
  const fail = (): never => {
    throw new Error('parse');
  };
  const eatOp = (v: string) => (peekOp(v) ? i++ : fail());

  function additive(): Node {
    let left = multiplicative();
    while (peekOp('+') || peekOp('-')) {
      const op = toks[i++].v;
      const l = left;
      const r = multiplicative();
      left = op === '+' ? (x, p) => l(x, p) + r(x, p) : (x, p) => l(x, p) - r(x, p);
    }
    return left;
  }
  function multiplicative(): Node {
    let left = unary();
    while (peekOp('*') || peekOp('/')) {
      const op = toks[i++].v;
      const l = left;
      const r = unary();
      left = op === '*' ? (x, p) => l(x, p) * r(x, p) : (x, p) => l(x, p) / r(x, p);
    }
    return left;
  }
  function unary(): Node {
    if (peekOp('-') || peekOp('+')) {
      const op = toks[i++].v;
      const start = i;
      const v = unary();
      // JS rejects a unary operator applied directly to a ** base: -a ** b.
      if (toks[start] && toks[start].kind !== 'op' && toks[start + 1]?.kind === 'op' && toks[start + 1].v === '**') fail();
      return op === '-' ? (x, p) => -v(x, p) : v;
    }
    return power();
  }
  function power(): Node {
    const base = primary();
    if (peekOp('**')) {
      i++;
      const exp = unary();
      return (x, p) => base(x, p) ** exp(x, p);
    }
    return base;
  }
  function primary(): Node {
    const t = toks[i];
    if (!t) return fail();
    if (t.kind === 'num') {
      i++;
      const v = t.v;
      return () => v;
    }
    if (t.kind === 'name') {
      if (!allowed.has(t.v)) fail();
      i++;
      const name = t.v;
      return name === 'x' ? (x) => x : (_x, p) => (p[name] ?? NaN);
    }
    if (t.kind === 'math') {
      i++;
      eatOp('(');
      const args: Node[] = [additive()];
      while (peekOp(',')) {
        i++;
        args.push(additive());
      }
      eatOp(')');
      const a = args[0];
      const b = args[1];
      switch (t.v) {
        case 'exp':
          return args.length === 1 ? (x, p) => Math.exp(a(x, p)) : fail();
        case 'log':
          return args.length === 1 ? (x, p) => Math.log(a(x, p)) : fail();
        case 'sqrt':
          return args.length === 1 ? (x, p) => Math.sqrt(a(x, p)) : fail();
        case 'abs':
          return args.length === 1 ? (x, p) => Math.abs(a(x, p)) : fail();
        case 'pow':
          return args.length === 2 ? (x, p) => Math.pow(a(x, p), b(x, p)) : fail();
        case 'min':
          return (x, p) => Math.min(...args.map((f) => f(x, p)));
        case 'max':
          return (x, p) => Math.max(...args.map((f) => f(x, p)));
      }
    }
    if (t.kind === 'op' && t.v === '(') {
      i++;
      const v = additive();
      eatOp(')');
      return v;
    }
    return fail();
  }

  try {
    const root = additive();
    if (i !== toks.length) return null;
    return (x, p) => {
      const v = root(x, p);
      return typeof v === 'number' ? v : NaN;
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Curve items (the data contract, already validated) and sampling

export interface Axis {
  label: string;
  min: number;
  max: number;
  unit: string;
}

export interface ParamSpec {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** The maths-relevant part of a curated item. */
export interface CurveSpec {
  x: Axis;
  y: Axis;
  params: ParamSpec[];
  target: Record<string, number>;
  shapeWords: string[];
  fn: CurveFn;
}

export function grid(x: Axis, n = N_GRID): number[] {
  return Array.from({ length: n }, (_, i) => x.min + ((x.max - x.min) * i) / (n - 1));
}

export function sample(spec: Pick<CurveSpec, 'x' | 'fn'>, params: Readonly<Record<string, number>>, n = N_GRID): number[] {
  return grid(spec.x, n).map((x) => spec.fn(x, params));
}

export const allFinite = (ys: readonly number[]) => ys.every((v) => Number.isFinite(v));

export function inRange(ys: readonly number[], y: Axis): boolean {
  const eps = 1e-9 * (y.max - y.min);
  return ys.every((v) => Number.isFinite(v) && v >= y.min - eps && v <= y.max + eps);
}

// ---------------------------------------------------------------------------------------------
// Shape predicates (validator port; thresholds against Y = canvas height)

type Pred = (xs: readonly number[], ys: readonly number[], Y: number) => boolean;

const diffs = (ys: readonly number[]) => ys.slice(1).map((v, i) => v - ys[i]);
const neg = (ys: readonly number[]) => ys.map((v) => -v);
const argmax = (ys: readonly number[]) => ys.reduce((best, v, i) => (v > ys[best] ? i : best), 0);
const argmin = (ys: readonly number[]) => ys.reduce((best, v, i) => (v < ys[best] ? i : best), 0);
const pyRound = (v: number) => {
  // Python's round(): banker's rounding at exact .5.
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};

const pIncreasing: Pred = (_xs, ys, Y) => Math.min(...diffs(ys)) >= -1e-6 * Y && ys[ys.length - 1] - ys[0] >= 0.08 * Y;
const pDecreasing: Pred = (xs, ys, Y) => pIncreasing(xs, neg(ys), Y);
const pFlat: Pred = (_xs, ys, Y) => Math.max(...ys) - Math.min(...ys) <= 0.03 * Y;
const pShallow: Pred = (_xs, ys, Y) => Math.max(...ys) - Math.min(...ys) <= 0.12 * Y;
const pHumped: Pred = (_xs, ys, Y) => {
  const n = ys.length;
  const i = argmax(ys);
  if (i < 0.05 * (n - 1) || i > 0.95 * (n - 1)) return false;
  return ys[i] - ys[0] >= 0.05 * Y && ys[i] - ys[n - 1] >= 0.05 * Y;
};
const pSmile: Pred = (_xs, ys, Y) => {
  const n = ys.length;
  const i = argmin(ys);
  if (i < 0.05 * (n - 1) || i > 0.95 * (n - 1)) return false;
  return ys[0] - ys[i] >= 0.03 * Y && ys[n - 1] - ys[i] >= 0.03 * Y;
};
const slopes = (ys: readonly number[], Y: number) => diffs(ys).map((d) => (d / Y) * (ys.length - 1));
const pConvex: Pred = (_xs, ys, Y) => {
  const d2 = diffs(diffs(ys));
  const s = slopes(ys, Y);
  return Math.min(...d2) >= -1e-9 * Y && s[s.length - 1] - s[0] >= 0.2;
};
const pConcave: Pred = (xs, ys, Y) => pConvex(xs, neg(ys), Y);
const pLinear: Pred = (_xs, ys, Y) => {
  const n = ys.length;
  let dev = 0;
  for (let i = 0; i < n; i++) dev = Math.max(dev, Math.abs(ys[i] - (ys[0] + ((ys[n - 1] - ys[0]) * i) / (n - 1))));
  return dev <= 0.005 * Y;
};
const monotoneMove = (xs: readonly number[], ys: readonly number[], Y: number) => pIncreasing(xs, ys, Y) || pDecreasing(xs, ys, Y);
const segSlope = (ys: readonly number[], a: number, b: number) => {
  const n = ys.length - 1;
  const i = pyRound(a * n);
  const j = pyRound(b * n);
  return (ys[j] - ys[i]) / Math.max(j - i, 1);
};
type Mono = (xs: readonly number[], ys: readonly number[], Y: number) => boolean;
const meanRevertingWith =
  (mono: Mono): Pred =>
  (xs, ys, Y) => {
    if (!mono(xs, ys, Y)) return false;
    const d = diffs(ys).map(Math.abs);
    for (let i = 1; i < d.length; i++) if (d[i] > d[i - 1] + 1e-9 * Y) return false;
    const first = Math.abs(segSlope(ys, 0, 0.1));
    const last = Math.abs(segSlope(ys, 0.9, 1));
    return first > 0 && last <= 0.35 * first;
  };
const levelsOffWith =
  (mono: Mono): Pred =>
  (xs, ys, Y) => {
    if (!mono(xs, ys, Y)) return false;
    return Math.abs(segSlope(ys, 0.9, 1)) <= 0.35 * Math.abs(segSlope(ys, 0, 1));
  };
const pMeanReverting: Pred = meanRevertingWith(monotoneMove);
const pLevelsOff: Pred = levelsOffWith(monotoneMove);
/** Monotone with any visible move (0.1% of the canvas): the size-free reading of the move clause. */
const monotoneAnyMove: Mono = (_xs, ys, Y) => {
  const d = diffs(ys);
  const up = Math.min(...d) >= -1e-6 * Y;
  const down = Math.max(...d) <= 1e-6 * Y;
  return (up || down) && Math.abs(ys[ys.length - 1] - ys[0]) >= 1e-3 * Y;
};
/**
 * Words about HOW a curve moves, not how far: the same predicates with the 8%-of-canvas move
 * requirement dropped. A derived start that still passes these only "breaks" the word because its
 * gap is small (e.g. a Vasicek path starting just above theta is still mean-reverting).
 */
const SIZE_FREE: Readonly<Record<string, Pred>> = {
  'mean-reverting': meanRevertingWith(monotoneAnyMove),
  'levels-off': levelsOffWith(monotoneAnyMove),
};
/** Words read from the moments of a density, which a canvas that cuts off a tail can distort. */
const MOMENT_WORDS = new Set(['right-skewed', 'left-skewed', 'negatively-skewed', 'symmetric', 'fat-tailed']);

const pCapped: Pred = (_xs, ys, Y) => {
  const m = Math.max(...ys);
  return ys.filter((v) => v >= m - 0.01 * Y).length >= 0.1 * ys.length;
};
const pFloored: Pred = (_xs, ys, Y) => {
  const m = Math.min(...ys);
  return ys.filter((v) => v <= m + 0.01 * Y).length >= 0.1 * ys.length;
};

/** [standardised skew, excess kurtosis] of y read as a density over x; null if not a density. */
export function moments(xs: readonly number[], ys: readonly number[]): [number, number] | null {
  if (Math.min(...ys) < 0) return null;
  const w = ys.reduce((a, b) => a + b, 0);
  if (w <= 0) return null;
  let mu = 0;
  for (let i = 0; i < xs.length; i++) mu += xs[i] * ys[i];
  mu /= w;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = xs[i] - mu;
    m2 += d * d * ys[i];
    m3 += d * d * d * ys[i];
    m4 += d * d * d * d * ys[i];
  }
  m2 /= w;
  m3 /= w;
  m4 /= w;
  if (m2 <= 0) return null;
  return [m3 / m2 ** 1.5, m4 / m2 ** 2 - 3];
}

const pRightSkewed: Pred = (xs, ys) => {
  const m = moments(xs, ys);
  return m !== null && m[0] >= 0.5;
};
const pLeftSkewed: Pred = (xs, ys) => {
  const m = moments(xs, ys);
  return m !== null && m[0] <= -0.5;
};
const pSymmetric: Pred = (xs, ys) => {
  const m = moments(xs, ys);
  return m !== null && Math.abs(m[0]) <= 0.1;
};
const pFatTailed: Pred = (xs, ys) => {
  const m = moments(xs, ys);
  return m !== null && m[1] >= 1.0;
};
const pHeavyTailed: Pred = (_xs, ys) => {
  const n = ys.length;
  const tail = ys.slice(Math.floor(0.6 * (n - 1)));
  if (Math.min(...tail) <= 0 || tail[tail.length - 1] < 1e-4 * Math.max(...ys)) return false;
  const ly = tail.map(Math.log);
  return Math.min(...diffs(diffs(ly))) >= -1e-9;
};
const pBounded: Pred = (_xs, ys, Y) => {
  const n = ys.length;
  const zero = ys.map((v) => Math.abs(v) <= 1e-9 * Y);
  if (zero[0]) return false;
  // Some i in the first 90% from which every point is zero.
  let firstZeroRun = n;
  for (let i = n - 1; i >= 0 && zero[i]; i--) firstZeroRun = i;
  return firstZeroRun <= Math.floor(0.9 * (n - 1));
};
const pThroughOrigin: Pred = (xs, ys, Y) => xs[0] === 0 && Math.abs(ys[0]) <= 0.01 * Y;
const signChanges = (ys: readonly number[], Y: number) => {
  const s = ys.map((v) => (v > 1e-9 * Y ? 1 : v < -1e-9 * Y ? -1 : 0)).filter((v) => v !== 0);
  let k = 0;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) k++;
  return { k, s };
};
const pSignOnce: Pred = (_xs, ys, Y) => {
  const { k, s } = signChanges(ys, Y);
  return k === 1 && s[0] < 0 && s[s.length - 1] > 0;
};
const pSignTwice: Pred = (_xs, ys, Y) => signChanges(ys, Y).k === 2;

export const SHAPES: Readonly<Record<string, Pred>> = {
  increasing: pIncreasing,
  'upward-sloping': pIncreasing,
  rising: pIncreasing,
  decreasing: pDecreasing,
  'downward-sloping': pDecreasing,
  inverted: pDecreasing,
  declining: pDecreasing,
  flat: pFlat,
  shallow: pShallow,
  humped: pHumped,
  'hump-shaped': pHumped,
  peaked: pHumped,
  frown: pHumped,
  smile: pSmile,
  'U-shaped': pSmile,
  convex: pConvex,
  concave: pConcave,
  linear: pLinear,
  'mean-reverting': pMeanReverting,
  'levels-off': pLevelsOff,
  capped: pCapped,
  floored: pFloored,
  'right-skewed': pRightSkewed,
  'left-skewed': pLeftSkewed,
  'negatively-skewed': pLeftSkewed,
  symmetric: pSymmetric,
  'fat-tailed': pFatTailed,
  'heavy-tailed': pHeavyTailed,
  bounded: pBounded,
  'through-origin': pThroughOrigin,
  'changes-sign-once': pSignOnce,
  'changes-sign-twice': pSignTwice,
};

/** What each shape word means on the axes, in plain words (shown after a round resolves). */
export const SHAPE_MEANING: Readonly<Record<string, string>> = {
  increasing: 'never steps down, and ends clearly higher than it starts',
  'upward-sloping': 'never steps down, and ends clearly higher than it starts',
  rising: 'never steps down, and ends clearly higher than it starts',
  decreasing: 'never steps up, and ends clearly lower than it starts',
  'downward-sloping': 'never steps up, and ends clearly lower than it starts',
  inverted: 'slopes down: the long end sits below the short end',
  declining: 'never steps up, and ends clearly lower than it starts',
  flat: 'barely moves across the whole axis',
  shallow: 'moves only a little from one end to the other',
  humped: 'rises to a peak inside the range, then falls away',
  'hump-shaped': 'rises to a peak inside the range, then falls away',
  peaked: 'rises to a peak inside the range, then falls away',
  frown: 'peaks in the middle and droops at both ends',
  smile: 'dips in the middle and rises at both ends',
  'U-shaped': 'dips in the middle and rises at both ends',
  convex: 'bends upward: its slope keeps increasing',
  concave: 'bends downward: its slope keeps falling',
  linear: 'a straight line, with no bend anywhere',
  'mean-reverting': 'moves fast at first, then ever more slowly as it settles toward a long-run level',
  'levels-off': 'flattens out at the far end',
  capped: 'hits a ceiling and runs flat along it',
  floored: 'hits a floor and runs flat along it',
  'right-skewed': 'bunched on the left with a long tail to the right',
  'left-skewed': 'bunched on the right with a long tail to the left',
  'negatively-skewed': 'bunched on the right with a long tail to the left',
  symmetric: 'the same on both sides of its centre',
  'fat-tailed': 'more weight far from the centre than a normal curve carries',
  'heavy-tailed': 'a right tail that decays no faster than exponentially',
  bounded: 'drops to zero and stays there: the tail has an end-point',
  'through-origin': 'starts at zero',
  'changes-sign-once': 'negative at the short end, positive at the long end, crossing zero once',
  'changes-sign-twice': 'crosses zero twice',
};

export function isShapeWord(w: string): boolean {
  return Object.prototype.hasOwnProperty.call(SHAPES, w);
}

/** Per shape word: does this y sample show it? A non-finite sample shows nothing. */
export function shapeReport(spec: Pick<CurveSpec, 'x' | 'y' | 'shapeWords'>, ys: readonly number[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const finite = allFinite(ys);
  const xs = grid(spec.x, ys.length);
  const Y = spec.y.max - spec.y.min;
  for (const w of spec.shapeWords) out[w] = finite && isShapeWord(w) && SHAPES[w](xs, ys, Y);
  return out;
}

export function allShapes(spec: Pick<CurveSpec, 'x' | 'y' | 'shapeWords'>, ys: readonly number[]): boolean {
  return Object.values(shapeReport(spec, ys)).every(Boolean);
}

// ---------------------------------------------------------------------------------------------
// Slider values

export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  const e = /e-(\d+)$/.exec(s);
  if (e) return Number(e[1]);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Snaps a value to the parameter's step grid (anchored at min) and clamps it to the range. */
export function onGrid(p: ParamSpec, v: number): number {
  const k = Math.round((v - p.min) / p.step);
  const snapped = p.min + k * p.step;
  const d = decimalsOf(p.step) + decimalsOf(p.min);
  return Math.min(p.max, Math.max(p.min, Number(snapped.toFixed(Math.min(12, d + 2)))));
}

export function stepsBetween(p: ParamSpec, a: number, b: number): number {
  return Math.round(Math.abs(a - b) / p.step);
}

// ---------------------------------------------------------------------------------------------
// Variants: one puzzle = one wrong parameter, its starting value and its snap tolerance

export interface Variant {
  /** '' for the curated puzzle; else "<param><+|->" for a derived one. */
  key: string;
  param: string;
  start: number;
  tolerance: number;
  curated: boolean;
}

export function sup(a: readonly number[], b: readonly number[]): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** A derived start must sit at least this share of the canvas height away from the notes' curve. */
export const MIN_START_GAP = 0.1;

const withParam = (target: Record<string, number>, name: string, v: number) => ({ ...target, [name]: v });

/** Whether a sampled curve is a fair board state: finite, on the canvas. */
function onCanvas(spec: CurveSpec, ys: readonly number[]) {
  return inRange(ys, spec.y);
}

/** Largest snap window (in steps) around the target in which every grid value keeps every shape word. */
function windowSteps(spec: CurveSpec, p: ParamSpec, maxSteps: number): number {
  const t = spec.target[p.name];
  let k = 0;
  while (k < maxSteps) {
    const next = k + 1;
    let ok = true;
    for (const dir of [-1, 1]) {
      const v = t + dir * next * p.step;
      if (v < p.min - 1e-12 || v > p.max + 1e-12) continue;
      const ys = sample(spec, withParam(spec.target, p.name, v));
      if (!onCanvas(spec, ys) || !allShapes(spec, ys)) ok = false;
    }
    if (!ok) break;
    k = next;
  }
  return k;
}

/** Words whose true meaning survives any y -> a·y + b with a > 0 (only the thresholds could break). */
const AFFINE_INVARIANT = new Set([
  'increasing', 'upward-sloping', 'rising', 'decreasing', 'downward-sloping', 'inverted', 'declining',
  'humped', 'hump-shaped', 'peaked', 'frown', 'smile', 'U-shaped', 'convex', 'concave', 'linear',
  'mean-reverting', 'levels-off', 'capped', 'floored',
]);
/** ...and those that also survive a pure rescale y -> a·y, a > 0. */
const SCALE_INVARIANT = new Set([
  ...AFFINE_INVARIANT,
  'through-origin', 'changes-sign-once', 'changes-sign-twice', 'right-skewed', 'left-skewed',
  'negatively-skewed', 'symmetric', 'fat-tailed', 'heavy-tailed', 'bounded',
]);

/** Share of a density's weight lying more than two (target) standard deviations from the target mean. */
function outerShare(xs: readonly number[], ys: readonly number[], mu: number, sd: number): number {
  let all = 0;
  let out = 0;
  for (let i = 0; i < xs.length; i++) {
    all += ys[i];
    if (Math.abs(xs[i] - mu) > 2 * sd) out += ys[i];
  }
  return all > 0 ? out / all : 0;
}

/**
 * A derived start that breaks a shape word only through a threshold, not through the shape itself,
 * would teach the wrong thing ("shrinking the curve makes it stop rising"). Rejected:
 *  - a start that is a positive rescale / shift of the notes' curve (or the curve collapsed onto
 *    zero), when every word it breaks is invariant under that map (the shape is identical; only
 *    the size moved);
 *  - a start that "breaks" fat-tailed while putting MORE weight far from the centre than the notes'
 *    curve (an artefact of computing kurtosis on a truncated canvas);
 *  - a start that breaks only mean-reverting / levels-off while still moving that way across a
 *    smaller gap (the move-size clause, not the dynamics);
 *  - a start that breaks only moment words (skew, symmetric, fat-tailed) but shows them once the
 *    x-range is widened, i.e. the canvas edge was cutting off its tail (needs `startParams`).
 */
export function thresholdArtefact(
  spec: CurveSpec,
  targetYs: readonly number[],
  startYs: readonly number[],
  startParams?: Readonly<Record<string, number>>,
): boolean {
  const Y = spec.y.max - spec.y.min;
  const report = shapeReport(spec, startYs);
  const broken = spec.shapeWords.filter((w) => !report[w]);
  if (!broken.length) return false;
  const n = targetYs.length;
  const mt = targetYs.reduce((a, b) => a + b, 0) / n;
  const ms = startYs.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vt = 0;
  for (let i = 0; i < n; i++) {
    cov += (targetYs[i] - mt) * (startYs[i] - ms);
    vt += (targetYs[i] - mt) ** 2;
  }
  if (vt > 1e-18 * Y * Y) {
    const a = cov / vt;
    const b = ms - a * mt;
    let resid = 0;
    for (let i = 0; i < n; i++) resid = Math.max(resid, Math.abs(startYs[i] - (a * targetYs[i] + b)));
    const pureScale = Math.abs(b) <= 1e-6 * Y;
    // a = 0 with no shift is the curve collapsed onto zero: the shape is gone, not changed.
    if ((a > 0 || (pureScale && a >= -1e-12)) && resid <= 1e-6 * Y) {
      const invariant = pureScale ? SCALE_INVARIANT : AFFINE_INVARIANT;
      if (broken.every((w) => invariant.has(w))) return true;
    }
  }
  if (broken.includes('fat-tailed')) {
    const xs = grid(spec.x, n);
    const m = moments(xs, targetYs);
    if (m) {
      let w = 0;
      let mu = 0;
      for (let i = 0; i < n; i++) {
        w += targetYs[i];
        mu += xs[i] * targetYs[i];
      }
      mu /= w;
      let v = 0;
      for (let i = 0; i < n; i++) v += (xs[i] - mu) ** 2 * targetYs[i];
      const sd = Math.sqrt(v / w);
      if (outerShare(xs, startYs, mu, sd) >= outerShare(xs, targetYs, mu, sd)) return true;
    }
  }
  // Mean-reverting / levels-off: the start still moves that way, just across a smaller gap.
  const xsGrid = grid(spec.x, n);
  if (broken.every((w) => SIZE_FREE[w]?.(xsGrid, startYs, Y) === true)) return true;
  // Moment words: judge the start on an x-range five times as wide. If it shows the word there,
  // the canvas edge was cutting off its tail (e.g. sliding a skewed density toward one edge).
  if (startParams && broken.every((w) => MOMENT_WORDS.has(w))) {
    const span = spec.x.max - spec.x.min;
    const m = 5 * (N_GRID - 1) + 1;
    const wideXs = Array.from({ length: m }, (_, i) => spec.x.min - 2 * span + (5 * span * i) / (m - 1));
    const wideYs = wideXs.map((x) => spec.fn(x, startParams));
    if (wideYs.every((v) => Number.isFinite(v) && v >= 0) && broken.every((w) => SHAPES[w](wideXs, wideYs, Y))) return true;
  }
  return false;
}

/**
 * The curated puzzle plus derived ones. A derived puzzle moves one parameter (others at target) to
 * the side of the target where the curve stays on the canvas but breaks a shape word; the start is
 * placed in the middle of that breaking run (at least two steps and MIN_START_GAP·Y away from the
 * target curve), and the tolerance is the widest shape-keeping window, capped at 6% of the slider
 * and strictly below a third of the start distance (the validator's rule).
 */
export function deriveVariants(spec: CurveSpec, curated: { param: string; start: number; tolerance: number }): Variant[] {
  const out: Variant[] = [{ key: '', param: curated.param, start: curated.start, tolerance: curated.tolerance, curated: true }];
  const Y = spec.y.max - spec.y.min;
  const targetYs = sample(spec, spec.target);
  for (const p of spec.params) {
    const t = spec.target[p.name];
    const totalSteps = Math.round((p.max - p.min) / p.step);
    const cap = Math.max(0, Math.floor(totalSteps * 0.06));
    const win = windowSteps(spec, p, cap);
    for (const dir of [-1, 1] as const) {
      if (p.name === curated.param && Math.sign(curated.start - t) === dir) continue;
      // Walk outward; collect the first contiguous run of on-canvas values that break a shape word.
      const run: { v: number; k: number; dist: number }[] = [];
      for (let k = 1; ; k++) {
        const v = onGrid(p, t + dir * k * p.step);
        if ((dir < 0 && v > t - (k - 0.5) * p.step) || (dir > 0 && v < t + (k - 0.5) * p.step)) break; // clamped at the end
        const ys = sample(spec, withParam(spec.target, p.name, v));
        const ok = onCanvas(spec, ys);
        const breaks = ok && !allShapes(spec, ys);
        if (ok && breaks) run.push({ v, k, dist: sup(ys, targetYs) });
        else if (run.length) break;
        if (!ok && run.length === 0 && k > win + 1) break; // left the canvas before breaking
      }
      const usable = run.filter(
        (r) => r.k >= 2 && r.dist >= MIN_START_GAP * Y && !thresholdArtefact(spec, targetYs, sample(spec, withParam(spec.target, p.name, r.v)), withParam(spec.target, p.name, r.v)),
      );
      if (!usable.length) continue;
      const pick = usable[Math.floor((usable.length - 1) / 2)];
      // Tolerance: the shape-keeping window, strictly under a third of the distance to the start.
      const tolSteps = Math.min(win, Math.floor((pick.k - 1) / 3));
      out.push({ key: `${p.name}${dir < 0 ? '-' : '+'}`, param: p.name, start: pick.v, tolerance: tolSteps * p.step, curated: false });
    }
  }
  return out;
}

/**
 * Sup distance from the notes' curve that still counts as "on the shape". It is the nearer window
 * edge's distance (so a value past the window on the steeper side cannot sneak in), but never less
 * than the farthest slider position inside the window, so every in-window position snaps.
 */
export function snapRadius(spec: CurveSpec, v: Pick<Variant, 'param' | 'tolerance'>): number {
  const p = spec.params.find((q) => q.name === v.param);
  const Y = spec.y.max - spec.y.min;
  if (!p) return 1e-9 * Y;
  const t = spec.target[p.name];
  const targetYs = sample(spec, spec.target);
  const dist = (val: number) => {
    const ys = sample(spec, withParam(spec.target, p.name, val));
    return allFinite(ys) ? sup(ys, targetYs) : Infinity;
  };
  let edge = Infinity;
  for (const e of [t - v.tolerance, t + v.tolerance]) if (e >= p.min - 1e-12 && e <= p.max + 1e-12) edge = Math.min(edge, dist(e));
  let inside = 0;
  const n = Math.floor(v.tolerance / p.step + 1e-9);
  for (let k = -n; k <= n; k++) {
    const val = onGrid(p, t + k * p.step);
    if (Math.abs(val - t) <= v.tolerance + 1e-12) inside = Math.max(inside, dist(val));
  }
  const r = Number.isFinite(edge) ? Math.max(edge, inside) : inside;
  return Math.max(r, 1e-9 * Y) * (1 + 1e-9);
}

/**
 * The snap: the current curve shows every shape word and sits within the snap window's distance
 * of the notes' curve. Any route counts, including compensating with another slider.
 */
export function snaps(spec: CurveSpec, params: Readonly<Record<string, number>>, radius: number, targetYs?: readonly number[]): boolean {
  const ys = sample(spec, params);
  if (!allFinite(ys) || !allShapes(spec, ys)) return false;
  return sup(ys, targetYs ?? sample(spec, spec.target)) <= radius;
}

/** How close the curve is to the notes' curve, 0 (start or worse) to 1 (on it). Discovery warmth only. */
export function closeness(current: readonly number[], start: readonly number[], target: readonly number[]): number {
  if (!allFinite(current)) return 0;
  const d0 = sup(start, target);
  if (d0 <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - sup(current, target) / d0));
}

// ---------------------------------------------------------------------------------------------
// Axis ticks and number display

/**
 * Round-number ticks inside [min, max]: about `target` of them, never fewer than max(2, target - 1)
 * (drops to the next finer 1-2-2.5-5 step until there are enough).
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min];
  const ladder = [10, 5, 2.5, 2, 1];
  const raw = (max - min) / Math.max(1, target - 1);
  let mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  let li = f <= 1 ? 4 : f <= 2 ? 3 : f <= 2.5 ? 2 : f <= 5 ? 1 : 0;
  const need = Math.max(2, target - 1);
  for (let guard = 0; guard < 12; guard++) {
    const step = ladder[li] * mag;
    const out: number[] = [];
    const first = Math.ceil(min / step - 1e-9) * step;
    for (let v = first; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
    if (out.length >= need) return out;
    li++;
    if (li >= ladder.length) {
      li = 0;
      mag /= 10;
    }
  }
  return [min, max];
}

export function tickDecimals(ticks: readonly number[]): number {
  let d = 0;
  for (const t of ticks) {
    const s = String(t);
    const dot = s.indexOf('.');
    if (dot !== -1 && !s.includes('e')) d = Math.max(d, s.length - dot - 1);
  }
  return Math.min(d, 4);
}

/** A number for display: fixed decimals, true minus sign. */
export function fmt(v: number, decimals: number): string {
  const s = v.toFixed(decimals);
  return (Number(s) === 0 ? s.replace(/^-/, '') : s).replace(/^-/, '−');
}

// ---------------------------------------------------------------------------------------------
// Chart layout (pure, so the 375px case can be tested without a browser)

/** Approximate advance of a 15px sans digit, for sizing tick-label gutters. */
export const TICK_CHAR_W = 8.6;

export interface ChartLayout {
  W: number;
  H: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  xTicks: number[];
  xLabels: string[];
  yTicks: number[];
  yLabels: string[];
}

const within = (ts: number[], a: Axis) => ts.filter((t) => t >= a.min - 1e-9 && t <= a.max + 1e-9);

/**
 * Layout for a chart `width` px wide drawn in a 1:1 viewBox: height ~0.62 W (230–340), a y-label
 * gutter sized to the widest tick label, and as many x ticks as fit without their 15px labels
 * touching (at least two).
 */
export function chartLayout(x: Axis, y: Axis, width: number): ChartLayout {
  const W = Math.max(260, Math.round(width) || 320);
  const H = Math.round(Math.min(340, Math.max(230, W * 0.62)));
  const yTicks = within(niceTicks(y.min, y.max, H < 260 ? 4 : 5), y);
  const yDec = tickDecimals(yTicks);
  const yLabels = yTicks.map((t) => fmt(t, yDec));
  const left = Math.ceil(Math.max(1, ...yLabels.map((l) => l.length)) * TICK_CHAR_W + 14);
  const top = 14;
  const bottom = 34;
  let want = 6;
  let xTicks: number[] = [];
  let xLabels: string[] = [];
  let right = 12;
  for (; want >= 2; want--) {
    xTicks = within(niceTicks(x.min, x.max, want), x);
    const xDec = tickDecimals(xTicks);
    xLabels = xTicks.map((t) => fmt(t, xDec));
    right = Math.ceil(Math.max(12, ((xLabels[xLabels.length - 1]?.length ?? 1) * TICK_CHAR_W) / 2 + 4));
    const plotW = W - left - right;
    const widest = Math.max(1, ...xLabels.map((l) => l.length)) * TICK_CHAR_W;
    const gap = xTicks.length > 1 ? (plotW * (xTicks[1] - xTicks[0])) / (x.max - x.min) : Infinity;
    if (gap >= widest + 12 || xTicks.length <= 2) break;
  }
  return { W, H, left, right, top, bottom, xTicks, xLabels, yTicks, yLabels };
}
