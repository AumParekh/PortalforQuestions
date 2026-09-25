// Tail Shaper: pure maths. No React, no imports, so node can test a compiled copy directly.
//
// The one parametric family (content/games/mechanics/tail-shaper.json, "family_spec"): a split
// (two-piece) Student-t with a common scale s.
//   z = (x - mu) / s
//   k_nu(z) = (1 + z^2/nu)^(-(nu+1)/2)
//   C_nu = Gamma((nu+1)/2) / (sqrt(nu*pi) * Gamma(nu/2))           (t_nu(z) = C_nu k_nu(z))
//   A = 2 C_L C_R / (s (C_L + C_R)),  C_L = C_{nuL}, C_R = C_{nuR}
//   f(x) = A k_{nuL}(z) for x < mu,   f(x) = A k_{nuR}(z) for x >= mu
// Each half is a half-t reweighted so both sides meet at A (continuous at mu) and the total is 1;
// the mass left of mu is C_R / (C_L + C_R).
//
// Tail classification (ported from tools/games/validate_tail-shaper.py): R_side is the mass beyond
// 2.5 s on that side over a normal's one-sided mass beyond 2.5 sd. It depends on nuL and nuR only.
// The validator integrates with Simpson's rule; the board uses the exact t tail (regularised
// incomplete beta) and the node test checks the two agree.

export const PARAM_NAMES = ['nuL', 'nuR', 'mu', 's'] as const;
export type ParamName = (typeof PARAM_NAMES)[number];
export type Params = Record<ParamName, number>;

export interface ParamSpec {
  name: ParamName;
  label: string;
  min: number;
  max: number;
  step: number;
  lowLabel: string;
  highLabel: string;
}

export type SmileLabel = 'volatility skew' | 'volatility smile' | 'flat';
export const SMILE_LABELS: readonly SmileLabel[] = ['volatility skew', 'volatility smile', 'flat'];
export type ShapeClass = SmileLabel | 'none';

export interface Thresholds {
  tailZ: number;
  heavy: number;
  fatter: number;
  light: number;
  symmetryMax: number;
  skewRatioMin: number;
  skewNuMargin: number;
}

/** The validator's constants; the JSON's "classification" block must restate them. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  tailZ: 2.5,
  heavy: 3.0,
  fatter: 1.8,
  light: 1.6,
  symmetryMax: 2.5,
  skewRatioMin: 2.0,
  skewNuMargin: 20.0,
};

// ---------------------------------------------------------------------------------------------
// Special functions

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** log Gamma(x) for x > 0 (Lanczos, g = 7): ~1e-15 relative, plenty for C_nu. */
export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  const y = x - 1;
  let a = LANCZOS[0];
  const t = y + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** P(T_nu > t) for t >= 0. */
export function tUpperTail(nu: number, t: number): number {
  if (t <= 0) return 0.5;
  return 0.5 * betai(nu / 2, 0.5, nu / (nu + t * t));
}

/** Standard normal one-sided tail P(Z > 2.5) = 0.5 erfc(2.5/sqrt 2). */
export const NORMAL_TAIL_25 = 0.006209665325776139;

/** P(Z > t) for the standard normal, via erfc (series below 2, continued fraction above). */
export function normalUpperTail(t: number): number {
  if (Math.abs(t - 2.5) < 1e-15) return NORMAL_TAIL_25;
  const x = t / Math.SQRT2;
  return 0.5 * erfc(x);
}

function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2) {
    // erf series: 2/sqrt(pi) * sum (-1)^n x^(2n+1) / (n! (2n+1))
    let sum = 0;
    let term = x;
    for (let n = 0; n < 200; n++) {
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17) break;
      term *= (-x * x) / (n + 1);
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  // Lentz continued fraction for erfc.
  const FPMIN = 1e-300;
  let f = x;
  let C = x;
  let D = 0;
  for (let n = 1; n < 300; n++) {
    const an = n / 2;
    D = x + an * D;
    if (Math.abs(D) < FPMIN) D = FPMIN;
    C = x + an / C;
    if (Math.abs(C) < FPMIN) C = FPMIN;
    D = 1 / D;
    const del = C * D;
    f *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
}

// ---------------------------------------------------------------------------------------------
// The family

/** C_nu = Gamma((nu+1)/2) / (sqrt(nu pi) Gamma(nu/2)): the t density at 0. */
export function cNu(nu: number): number {
  return Math.exp(lgamma((nu + 1) / 2) - lgamma(nu / 2)) / Math.sqrt(nu * Math.PI);
}

export function kernel(z: number, nu: number): number {
  return Math.pow(1 + (z * z) / nu, -(nu + 1) / 2);
}

/** Peak height A = 2 C_L C_R / (s (C_L + C_R)), reached at x = mu from both sides. */
export function peak(p: Params): number {
  const cl = cNu(p.nuL);
  const cr = cNu(p.nuR);
  return (2 * cl * cr) / (p.s * (cl + cr));
}

export function density(x: number, p: Params): number {
  const z = (x - p.mu) / p.s;
  return peak(p) * kernel(z, x < p.mu ? p.nuL : p.nuR);
}

/** Density on a grid, computing A once. */
export function densityCurve(xs: readonly number[], p: Params): number[] {
  const a = peak(p);
  return xs.map((x) => {
    const z = (x - p.mu) / p.s;
    return a * kernel(z, x < p.mu ? p.nuL : p.nuR);
  });
}

/** The benchmark: normal log-returns with the same location and scale (the nu -> infinity limit). */
export function normalPdf(x: number, mu: number, sd: number): number {
  const z = (x - mu) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

export function leftMass(p: Pick<Params, 'nuL' | 'nuR'>): number {
  const cl = cNu(p.nuL);
  const cr = cNu(p.nuR);
  return cr / (cl + cr);
}

export function meanClosed(p: Params): number {
  const cl = cNu(p.nuL);
  const cr = cNu(p.nuR);
  return p.mu + ((p.s * 2 * cl * cr) / (cl + cr)) * (p.nuR / (p.nuR - 1) - p.nuL / (p.nuL - 1));
}

export function sdClosed(p: Params): number {
  const cl = cNu(p.nuL);
  const cr = cNu(p.nuR);
  const wl = cr / (cl + cr);
  const wr = cl / (cl + cr);
  const ez = ((2 * cl * cr) / (cl + cr)) * (p.nuR / (p.nuR - 1) - p.nuL / (p.nuL - 1));
  const ez2 = (wl * p.nuL) / (p.nuL - 2) + (wr * p.nuR) / (p.nuR - 2);
  return p.s * Math.sqrt(ez2 - ez * ez);
}

// ---------------------------------------------------------------------------------------------
// Numerical integration (the validator's scheme, for the node test)

export function simpson(f: (x: number) => number, a: number, b: number, n = 400): number {
  const m = n % 2 ? n + 1 : n;
  const h = (b - a) / m;
  let tot = f(a) + f(b);
  for (let i = 1; i < m; i++) tot += (i % 2 ? 4 : 2) * f(a + i * h);
  return (tot * h) / 3;
}

export const Z_EDGES = [0, 0.5, 1, 2, 2.5, 4, 8, 16, 32, 64, 128, 512, 2048, 1e4, 1e5, 1e6];

/** Integral of g(z * side) over |z| from zFrom to 1e6, piecewise Simpson. */
export function integrateSide(g: (z: number) => number, side: 1 | -1, zFrom = 0): number {
  const edges = [zFrom, ...Z_EDGES.filter((z) => z > zFrom)];
  let total = 0;
  for (let i = 0; i + 1 < edges.length; i++) total += simpson((z) => g(z * side), edges[i], edges[i + 1]);
  return total;
}

/** Total mass of f by Simpson over x = mu + s z, |z| <= 1e6. */
export function totalMass(p: Params): number {
  let m = 0;
  for (const side of [-1, 1] as const) m += p.s * integrateSide((z) => density(p.mu + p.s * z, p), side);
  return m;
}

/** Tail ratios by Simpson, exactly as the validator computes them. */
export function tailRatiosSimpson(p: Params, tailZ = DEFAULT_THRESHOLDS.tailZ): [number, number] {
  const ref = normalUpperTail(tailZ);
  const left = p.s * integrateSide((z) => density(p.mu + p.s * z, p), -1, tailZ);
  const right = p.s * integrateSide((z) => density(p.mu + p.s * z, p), 1, tailZ);
  return [left / ref, right / ref];
}

// ---------------------------------------------------------------------------------------------
// Tail classification

const ratioCache = new Map<string, [number, number]>();

/**
 * [R_L, R_R]: each side's mass beyond tailZ scale units over a normal's one-sided tail.
 * Left = (2 C_R/(C_L+C_R)) P(T_nuL > z0); right = (2 C_L/(C_L+C_R)) P(T_nuR > z0).
 */
export function tailRatios(nuL: number, nuR: number, tailZ = DEFAULT_THRESHOLDS.tailZ): [number, number] {
  const key = `${nuL}|${nuR}|${tailZ}`;
  const hit = ratioCache.get(key);
  if (hit) return hit;
  const cl = cNu(nuL);
  const cr = cNu(nuR);
  const ref = normalUpperTail(tailZ);
  const out: [number, number] = [
    ((2 * cr) / (cl + cr)) * (tUpperTail(nuL, tailZ) / ref),
    ((2 * cl) / (cl + cr)) * (tUpperTail(nuR, tailZ) / ref),
  ];
  if (ratioCache.size > 4000) ratioCache.clear();
  ratioCache.set(key, out);
  return out;
}

export function classify(nuL: number, nuR: number, th: Thresholds = DEFAULT_THRESHOLDS): ShapeClass {
  const [rl, rr] = tailRatios(nuL, nuR, th.tailZ);
  if (rl >= th.heavy && rr <= th.light && rl / rr >= th.skewRatioMin && nuR - nuL >= th.skewNuMargin) return 'volatility skew';
  if (rl >= th.fatter && rr >= th.fatter && Math.max(rl, rr) / Math.min(rl, rr) <= th.symmetryMax) return 'volatility smile';
  if (rl <= th.light && rr <= th.light) return 'flat';
  return 'none';
}

export type TailWord = 'heavy' | 'fat' | 'slightly fat' | 'near lognormal';

/** One tail in words, from its ratio against the normal (the thresholds' own bands). */
export function tailWord(r: number, th: Thresholds = DEFAULT_THRESHOLDS): TailWord {
  if (r >= th.heavy) return 'heavy';
  if (r >= th.fatter) return 'fat';
  if (r > th.light) return 'slightly fat';
  return 'near lognormal';
}

// ---------------------------------------------------------------------------------------------
// Sliders and the match rule

export function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

/** Nearest slider value on the grid, inside the range. */
export function onGrid(spec: Pick<ParamSpec, 'min' | 'max' | 'step'>, v: number): number {
  const k = Math.round((v - spec.min) / spec.step);
  const x = spec.min + k * spec.step;
  const d = decimalsOf(spec.step);
  return Math.min(spec.max, Math.max(spec.min, Number(x.toFixed(d))));
}

export function isOnGrid(spec: Pick<ParamSpec, 'min' | 'step'>, v: number): boolean {
  const k = (v - spec.min) / spec.step;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

/** The accepted interval for one slider: target ± tolerance, clipped to the range. */
export function boxOf(spec: Pick<ParamSpec, 'min' | 'max'>, target: number, tol: number): [number, number] {
  return [Math.max(spec.min, target - tol), Math.min(spec.max, target + tol)];
}

export function withinOne(v: number, target: number, tol: number): boolean {
  return Math.abs(v - target) <= tol + 1e-9;
}

/** The JSON's match rule: every slider within its tolerance of the target. */
export function matches(p: Params, target: Params, tol: Params): boolean {
  return PARAM_NAMES.every((n) => withinOne(p[n], target[n], tol[n]));
}

/** The 16 corners of the tolerance box (clipped to the slider ranges). */
export function boxCorners(specs: Readonly<Record<ParamName, ParamSpec>>, target: Params, tol: Params): Params[] {
  const out: Params[] = [];
  for (let m = 0; m < 16; m++) {
    const p = { ...target };
    PARAM_NAMES.forEach((n, i) => {
      const [a, b] = boxOf(specs[n], target[n], tol[n]);
      p[n] = (m >> i) & 1 ? b : a;
    });
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Implied-volatility curve shapes (the validator's rules)

export type SmilePoint = readonly [number, number];

export function smileShapeOk(label: SmileLabel, pts: readonly SmilePoint[]): boolean {
  if (pts.length < 7) return false;
  const xs = pts.map((q) => q[0]);
  const vs = pts.map((q) => q[1]);
  if (!xs.every((x, i) => i === 0 || x > xs[i - 1])) return false;
  if (!xs.some((x) => Math.abs(x - 1) < 1e-12)) return false;
  if (!(xs[0] <= 0.8 && xs[xs.length - 1] >= 1.2)) return false;
  if (!vs.every((v) => v > 0)) return false;
  if (label === 'volatility skew') {
    return vs.every((v, i) => i === 0 || v < vs[i - 1]) && vs[0] - vs[vs.length - 1] >= 2;
  }
  if (label === 'volatility smile') {
    const lo = Math.min(...vs);
    const k = vs.indexOf(lo);
    if (!(k > 0 && k < vs.length - 1 && xs[k] >= 0.95 && xs[k] <= 1.05)) return false;
    for (let i = 1; i <= k; i++) if (!(vs[i] < vs[i - 1])) return false;
    for (let i = k + 1; i < vs.length; i++) if (!(vs[i] > vs[i - 1])) return false;
    return vs[0] - lo >= 0.5 && vs[vs.length - 1] - lo >= 0.5;
  }
  return Math.max(...vs) - Math.min(...vs) <= 0.5;
}

// ---------------------------------------------------------------------------------------------
// Chart helpers

/** Evenly spaced grid of n points on [a, b]. */
export function linspace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

/** Round ticks from lo to hi with the given step (inclusive, float-safe). */
export function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  const d = decimalsOf(step);
  for (let k = first; k <= last; k++) out.push(Number((k * step).toFixed(d)));
  return out;
}

export function fmt(v: number, decimals: number): string {
  const s = v.toFixed(decimals);
  if (Number(s) === 0) return (0).toFixed(decimals);
  return s.replace(/^-/, '−');
}

/** A vol axis [lo, hi] in multiples of `step` that holds every value with a little room. */
export function volAxis(values: readonly number[], fallback: [number, number] = [12, 28], step = 4): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return fallback;
  const lo = Math.min(fallback[0], Math.floor((Math.min(...finite) - 0.5) / step) * step);
  const hi = Math.max(fallback[1], Math.ceil((Math.max(...finite) + 0.5) / step) * step);
  return [lo, hi];
}

/** Ease-out cubic, 0..1 → 0..1. */
export function easeOut(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return 1 - Math.pow(1 - c, 3);
}

/** Linear blend of two parameter sets. */
export function lerpParams(a: Params, b: Params, k: number): Params {
  const out = { ...a };
  for (const n of PARAM_NAMES) out[n] = a[n] + (b[n] - a[n]) * k;
  return out;
}
