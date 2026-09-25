// Frontier Rider: the unconstrained Markowitz engine and chart geometry. Pure; no React, no DOM.
//
// The maths is exactly the "conventions" string of content/games/mechanics/frontier-rider.json
// (and tools/games/validate_frontier-rider.py, which recomputes every item with it):
//   inputs       mu_i, sigma_i, rf in percent per year  ->  m = mu/100, s = sigma/100, r = rf/100
//   covariance   S_ij = corr_ij * s_i * s_j
//   min-variance w = S^-1 1 / (1' S^-1 1)                    (ignores m and rf)
//   tangency     w = S^-1 (m - r 1) / (1' S^-1 (m - r 1))    (needs the min-variance mean > r)
//   portfolio    E = w'm, sd = sqrt(w' S w)
//   complete     y* = (E_T - r) / (A sd_T^2), A on decimal returns; point (y* sd_T, r + y*(E_T - r))
//   frontier     var(E) = (A0 E^2 - 2 B0 E + C0) / (A0 C0 - B0^2), A0 = 1'S^-1 1, B0 = 1'S^-1 m, C0 = m'S^-1 m
//   move code    signs of d(sigma) and d(mu) of the point, |d| < 1e-6 counts as zero
// Everything returned for plotting is in percent.

export type PointKind = 'tangency' | 'complete' | 'min-variance';
export const POINT_KINDS: readonly PointKind[] = ['tangency', 'complete', 'min-variance'];

export type Compass = 'up-right' | 'up-left' | 'down-right' | 'down-left' | 'up' | 'down' | 'right' | 'left' | 'stays';
export type Jump = 'to-min-variance' | 'to-tangency' | 'to-rf';
export type MoveCode = Compass | Jump;
export const COMPASS: readonly Compass[] = ['up-right', 'up-left', 'down-right', 'down-left', 'up', 'down', 'right', 'left', 'stays'];
export const JUMPS: readonly Jump[] = ['to-min-variance', 'to-tangency', 'to-rf'];

/** |d| below this counts as no movement (the validator's ZERO). */
export const ZERO = 1e-6;

export interface Inputs {
  /** Expected returns, percent per year. */
  mu: number[];
  /** Volatilities, percent per year. */
  sigma: number[];
  corr: number[][];
  /** Risk-free rate (or the benchmark in active space), percent. */
  rf: number;
  /** Risk aversion on decimal returns; only used for the complete point. */
  A: number | null;
}

export type SliderParam =
  | { kind: 'rf' }
  | { kind: 'A' }
  | { kind: 'mu'; i: number }
  | { kind: 'sigma'; i: number }
  | { kind: 'corr'; i: number; j: number };

export interface Pt {
  /** Volatility (x), percent. */
  sigma: number;
  /** Expected return (y), percent. */
  mu: number;
}

export interface Portfolio extends Pt {
  w: number[];
}

/** Everything the plane shows at one input state. */
export interface State {
  inputs: Inputs;
  /** Frontier constants on decimal returns. */
  a0: number;
  b0: number;
  c0: number;
  /** A0 C0 - B0^2; the frontier is a single point when this is ~0 (all means equal). */
  d: number;
  mv: Portfolio;
  /** Null when the min-variance mean is not above rf (no efficient tangency). */
  tangency: (Portfolio & { sharpe: number }) | null;
  /** Null unless A > 0 and the tangency exists with y* > 0. */
  complete: (Portfolio & { y: number }) | null;
}

export interface RiderPoint extends Portfolio {
  /** Share in the risky (tangency) portfolio; 1 for tangency and min-variance points. */
  y: number;
}

// ---------------------------------------------------------------------------------------------
// Slider parameters

const PARAM_RE = /^(rf|A|mu\[(\d)\]|sigma\[(\d)\]|corr\[(\d)\]\[(\d)\])$/;

/** Parses "rf" | "A" | "mu[i]" | "sigma[i]" | "corr[i][j]" (off-diagonal) for n assets. */
export function parseParam(s: string, n: number): SliderParam | null {
  const m = PARAM_RE.exec(s);
  if (!m) return null;
  if (m[1] === 'rf') return { kind: 'rf' };
  if (m[1] === 'A') return { kind: 'A' };
  const idx = (g: string | undefined) => (g === undefined ? -1 : Number(g));
  if (m[2] !== undefined) return idx(m[2]) < n ? { kind: 'mu', i: idx(m[2]) } : null;
  if (m[3] !== undefined) return idx(m[3]) < n ? { kind: 'sigma', i: idx(m[3]) } : null;
  const i = idx(m[4]);
  const j = idx(m[5]);
  if (i >= n || j >= n || i === j) return null;
  return { kind: 'corr', i, j };
}

export function paramValue(inp: Inputs, p: SliderParam): number | null {
  switch (p.kind) {
    case 'rf':
      return inp.rf;
    case 'A':
      return inp.A;
    case 'mu':
      return inp.mu[p.i];
    case 'sigma':
      return inp.sigma[p.i];
    case 'corr':
      return inp.corr[p.i][p.j];
  }
}

/** A copy of the inputs with exactly one parameter changed (corr[j][i] kept equal to corr[i][j]). */
export function applySlider(inp: Inputs, p: SliderParam, v: number): Inputs {
  const x: Inputs = { mu: [...inp.mu], sigma: [...inp.sigma], corr: inp.corr.map((r) => [...r]), rf: inp.rf, A: inp.A };
  switch (p.kind) {
    case 'rf':
      x.rf = v;
      break;
    case 'A':
      x.A = v;
      break;
    case 'mu':
      x.mu[p.i] = v;
      break;
    case 'sigma':
      x.sigma[p.i] = v;
      break;
    case 'corr':
      x.corr[p.i][p.j] = v;
      x.corr[p.j][p.i] = v;
      break;
  }
  return x;
}

// ---------------------------------------------------------------------------------------------
// Linear algebra (small dense matrices)

/** Gauss-Jordan inverse with partial pivoting; null when singular. */
export function matInv(M: readonly (readonly number[])[]): number[][] | null {
  const n = M.length;
  const a = M.map((row, i) => [...row.map(Number), ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-18) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const pv = a[c][c];
    a[c] = a[c].map((x) => x / pv);
    for (let r = 0; r < n; r++) {
      if (r === c || a[r][c] === 0) continue;
      const f = a[r][c];
      a[r] = a[r].map((x, k) => x - f * a[c][k]);
    }
  }
  return a.map((row) => row.slice(n));
}

/** Cholesky test for positive definiteness. */
export function isPosDef(M: readonly (readonly number[])[]): boolean {
  const n = M.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = M[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 1e-14)) return false;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  return true;
}

export function matVec(M: readonly (readonly number[])[], v: readonly number[]): number[] {
  return M.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));
}

export function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((s, x, k) => s + x * b[k], 0);
}

/** Covariance on decimal returns: S_ij = corr_ij * s_i * s_j with s = sigma / 100. */
export function covMatrix(sigmaPct: readonly number[], corr: readonly (readonly number[])[]): number[][] {
  const s = sigmaPct.map((x) => x / 100);
  return s.map((si, i) => s.map((sj, j) => corr[i][j] * si * sj));
}

// ---------------------------------------------------------------------------------------------
// The engine

/**
 * Solves one input state: min-variance, tangency (when the min-variance mean exceeds rf) and the
 * complete portfolio (when A > 0 and y* > 0). Null when the covariance is not positive definite.
 */
export function solveState(inp: Inputs): State | null {
  const n = inp.mu.length;
  if (n < 2 || inp.sigma.length !== n || inp.corr.length !== n) return null;
  const S = covMatrix(inp.sigma, inp.corr);
  if (!isPosDef(S)) return null;
  const Si = matInv(S);
  if (!Si) return null;
  const m = inp.mu.map((x) => x / 100);
  const r = inp.rf / 100;
  const ones = new Array<number>(n).fill(1);
  const Si1 = matVec(Si, ones);
  const Sim = matVec(Si, m);
  const a0 = Si1.reduce((s, x) => s + x, 0);
  if (!(a0 > 0)) return null;
  const b0 = dot(ones, Sim);
  const c0 = dot(m, Sim);
  const d = a0 * c0 - b0 * b0;
  const stats = (w: number[]): Portfolio => {
    const E = dot(w, m);
    const v = dot(w, matVec(S, w));
    return { w, mu: E * 100, sigma: Math.sqrt(Math.max(0, v)) * 100 };
  };
  const mv = stats(Si1.map((x) => x / a0));
  let tangency: State['tangency'] = null;
  let complete: State['complete'] = null;
  if (mv.mu / 100 > r) {
    const v = matVec(
      Si,
      m.map((x) => x - r),
    );
    const t = v.reduce((s, x) => s + x, 0);
    if (t > 0) {
      const p = stats(v.map((x) => x / t));
      const sd = p.sigma / 100;
      const ex = p.mu / 100 - r;
      if (sd > 0) {
        tangency = { ...p, sharpe: ex / sd };
        if (inp.A !== null && inp.A > 0) {
          const y = ex / (inp.A * sd * sd);
          if (y > 0) complete = { w: p.w, y, sigma: y * p.sigma, mu: (r + y * ex) * 100 };
        }
      }
    }
  }
  return { inputs: inp, a0, b0, c0, d, mv, tangency, complete };
}

/** The item's point in a solved state; null when it is not defined there. */
export function riderOf(s: State, kind: PointKind): RiderPoint | null {
  if (kind === 'min-variance') return { ...s.mv, y: 1 };
  if (kind === 'tangency') return s.tangency ? { ...s.tangency, y: 1 } : null;
  return s.complete ? { ...s.complete } : null;
}

/** Frontier volatility (percent) at expected return E (percent); NaN when degenerate. */
export function frontierSd(s: State, ePct: number): number {
  if (!(s.d > 1e-14)) return NaN;
  const E = ePct / 100;
  const v = (s.a0 * E * E - 2 * s.b0 * E + s.c0) / s.d;
  return v > 0 ? Math.sqrt(v) * 100 : NaN;
}

export function sgn(d: number): -1 | 0 | 1 {
  return Math.abs(d) < ZERO ? 0 : d > 0 ? 1 : -1;
}

export function moveCode(dSigma: number, dMu: number): Compass {
  const a = sgn(dSigma);
  const b = sgn(dMu);
  if (a === 0 && b === 0) return 'stays';
  const v = b > 0 ? 'up' : b < 0 ? 'down' : '';
  const h = a > 0 ? 'right' : a < 0 ? 'left' : '';
  return (v && h ? `${v}-${h}` : v || h) as Compass;
}

/** Screen direction of a compass move (x right, y up), unit-ish; null for 'stays'. */
export function compassVector(c: Compass): { dx: number; dy: number } | null {
  if (c === 'stays') return null;
  const dy = c.startsWith('up') ? 1 : c.startsWith('down') ? -1 : 0;
  const dx = c.endsWith('right') ? 1 : c.endsWith('left') ? -1 : 0;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len };
}

export function isCompass(x: string): x is Compass {
  return (COMPASS as readonly string[]).includes(x);
}
export function isJump(x: string): x is Jump {
  return (JUMPS as readonly string[]).includes(x);
}
export function isMoveCode(x: string): x is MoveCode {
  return isCompass(x) || isJump(x);
}

/** Where a "jump" prediction lands, in a given state. */
export function jumpTarget(s: State, j: Jump): Pt | null {
  if (j === 'to-min-variance') return { sigma: s.mv.sigma, mu: s.mv.mu };
  if (j === 'to-tangency') return s.tangency ? { sigma: s.tangency.sigma, mu: s.tangency.mu } : null;
  return { sigma: 0, mu: s.inputs.rf };
}

// ---------------------------------------------------------------------------------------------
// Slider path

/** The slider's grid from `from` to `to` (inclusive), or null unless step splits it into 2..1000 steps. */
export function sliderGrid(from: number, to: number, step: number): number[] | null {
  if (![from, to, step].every(Number.isFinite) || !(step > 0) || from === to) return null;
  const raw = Math.abs(to - from) / step;
  const n = Math.round(raw);
  if (Math.abs(raw - n) > 1e-6 || n < 2 || n > 1000) return null;
  return Array.from({ length: n + 1 }, (_, k) => (k === n ? to : from + (k * (to - from)) / n));
}

/** Nearest grid value to v, measured from `from`, clamped to the slider's range. */
export function snapToGrid(v: number, from: number, to: number, step: number): number {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const c = Math.max(lo, Math.min(hi, v));
  const k = Math.round((c - from) / step);
  const s = from + k * step;
  if (Math.abs(s - to) < step * 1e-6) return to;
  return Math.max(lo, Math.min(hi, s));
}

export interface Path {
  grid: number[];
  states: State[];
  points: RiderPoint[];
  /** Net move of the point from slider.from to slider.to. */
  move: Compass;
  /** Every step moves the same way as the net move (the animation never doubles back). */
  monotone: boolean;
}

/** Solves every grid step; null if the covariance or the point breaks anywhere on the slider. */
export function tracePath(base: Inputs, p: SliderParam, grid: readonly number[], kind: PointKind): Path | null {
  const states: State[] = [];
  const points: RiderPoint[] = [];
  for (const v of grid) {
    const s = solveState(applySlider(base, p, v));
    if (!s) return null;
    const pt = riderOf(s, kind);
    if (!pt) return null;
    states.push(s);
    points.push(pt);
  }
  const a = points[0];
  const b = points[points.length - 1];
  const dS = b.sigma - a.sigma;
  const dM = b.mu - a.mu;
  const move = moveCode(dS, dM);
  const ss = sgn(dS);
  const sm = sgn(dM);
  let monotone = true;
  for (let k = 1; k < points.length; k++) {
    const ds = points[k].sigma - points[k - 1].sigma;
    const dm = points[k].mu - points[k - 1].mu;
    if ((ss === 0 && Math.abs(ds) > ZERO) || (ss !== 0 && ds * ss < -1e-12)) monotone = false;
    if ((sm === 0 && Math.abs(dm) > ZERO) || (sm !== 0 && dm * sm < -1e-12)) monotone = false;
  }
  return { grid: [...grid], states, points, move, monotone };
}

/** How the line from rf through the tangency tilts between two states. */
export function calTilt(s0: State, s1: State): 'steeper' | 'flatter' | 'same' | null {
  if (!s0.tangency || !s1.tangency) return null;
  const d = s1.tangency.sharpe - s0.tangency.sharpe;
  return Math.abs(d) < 1e-9 ? 'same' : d > 0 ? 'steeper' : 'flatter';
}

// ---------------------------------------------------------------------------------------------
// Chart geometry

export interface Win {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Plot window for the whole slider: origin, rf, every asset, the three special points, the path. */
export function mainWindow(path: Path): Win {
  const xs: number[] = [0];
  const ys: number[] = [0];
  const add = (p: Pt | null) => {
    if (!p || !Number.isFinite(p.sigma) || !Number.isFinite(p.mu)) return;
    xs.push(p.sigma);
    ys.push(p.mu);
  };
  const ends = [path.states[0], path.states[path.states.length - 1]];
  for (const s of ends) {
    s.inputs.mu.forEach((mu, i) => add({ sigma: s.inputs.sigma[i], mu }));
    add({ sigma: 0, mu: s.inputs.rf });
    add(s.mv);
    add(s.tangency);
    add(s.complete);
  }
  for (const p of path.points) add(p);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = Math.max(0.1 * (yMax - yMin), 0.25);
  return {
    x0: 0,
    x1: xMax * 1.12 + 0.2,
    y0: yMin >= 0 ? 0 : yMin - yPad,
    y1: yMax + yPad,
  };
}

/** Pixel length of the point's net move in a nominal 300 × 200 plot of the window. */
export function nominalDisplacement(path: Path, w: Win): number {
  const a = path.points[0];
  const b = path.points[path.points.length - 1];
  return Math.hypot(((b.sigma - a.sigma) / (w.x1 - w.x0)) * 300, ((b.mu - a.mu) / (w.y1 - w.y0)) * 200);
}

/** A close-up is shown when the move would be under this many pixels in the full plane. */
export const LOUPE_BELOW_PX = 40;

export function needsLoupe(path: Path, w: Win): boolean {
  return nominalDisplacement(path, w) < LOUPE_BELOW_PX;
}

/**
 * Close-up window around the point's path: 1.8 × the move on each axis, but never narrower than
 * 3.5% of the full plane's span, so a tiny sideways drift still shows and a zero move stays put.
 */
export function loupeWindow(path: Path, main: Win): Win {
  const xsP = path.points.map((p) => p.sigma);
  const ysP = path.points.map((p) => p.mu);
  const lo = (v: number[]) => Math.min(...v);
  const hi = (v: number[]) => Math.max(...v);
  const cx = (lo(xsP) + hi(xsP)) / 2;
  const cy = (lo(ysP) + hi(ysP)) / 2;
  const sx = Math.max((hi(xsP) - lo(xsP)) * 1.8, 0.035 * (main.x1 - main.x0));
  const sy = Math.max((hi(ysP) - lo(ysP)) * 1.8, 0.035 * (main.y1 - main.y0));
  return { x0: cx - sx / 2, x1: cx + sx / 2, y0: cy - sy / 2, y1: cy + sy / 2 };
}

/** Efficient (upper) and inefficient (lower) frontier branches sampled over the window's returns. */
export function frontierBranches(s: State, w: Win, samples = 120): { upper: Pt[]; lower: Pt[] } {
  if (!(s.d > 1e-14)) return { upper: [], lower: [] };
  const eMv = s.mv.mu;
  const span = w.y1 - w.y0;
  // Reach a little past the window so the clipped line runs off the edges.
  const top = w.y1 + span * 0.25;
  const bottom = w.y0 - span * 0.25;
  const branch = (from: number, to: number): Pt[] => {
    if (!(to > from)) return [];
    const out: Pt[] = [];
    for (let k = 0; k <= samples; k++) {
      // Denser near the vertex, where the curve turns.
      const t = k / samples;
      const e = from + (to - from) * t * t;
      const sd = frontierSd(s, e);
      if (Number.isFinite(sd)) out.push({ sigma: sd, mu: e });
    }
    return out;
  };
  const upper = eMv < top ? branch(Math.max(eMv, bottom), top) : [];
  const lowerRaw = eMv > bottom ? branch(0, eMv - Math.max(bottom, -1e9)).map((p) => ({ sigma: p.sigma, mu: eMv - (p.mu - 0) })) : [];
  // Recompute sd for the mirrored returns (the parabola is symmetric in E about eMv, so this is exact).
  const lower = lowerRaw.map((p) => ({ sigma: frontierSd(s, p.mu), mu: p.mu })).filter((p) => Number.isFinite(p.sigma));
  if (eMv >= bottom && eMv <= top) {
    if (upper.length) upper[0] = { sigma: s.mv.sigma, mu: eMv };
    if (lower.length) lower[0] = { sigma: s.mv.sigma, mu: eMv };
  }
  return { upper, lower };
}

/** Nice round tick values inside [min, max]. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min) || count < 1) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function tickDecimals(ticks: readonly number[]): number {
  if (ticks.length < 2) return 0;
  const step = Math.abs(ticks[1] - ticks[0]);
  for (let d = 0; d <= 4; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  return 4;
}

/** Decimals needed to show a slider step (capped at 2). */
export function stepDecimals(step: number): number {
  for (let d = 0; d <= 2; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-9) return d;
  return 2;
}

/** Fixed decimals with a real minus sign; "-0.00" becomes "0.00". */
export function fmt(v: number, dec: number): string {
  const s = v.toFixed(dec);
  const z = Number(s) === 0 ? (0).toFixed(dec) : s;
  return z.replace(/^-/, '−');
}

export function easeInOut(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}
