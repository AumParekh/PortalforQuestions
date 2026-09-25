// Tree Racer: SVG geometry. The viewBox is the container's measured width 1:1, so a 15px font
// in viewBox units is 15px on screen. Forward (rate-building) trees place each node at its value
// on a labelled rate axis, so a wrong branch visibly lands off the lattice; backward (valuation)
// trees are a classic lattice of value chips. Pure; no React.

/** Label font size in px (PORTAL_PLAN §5: nothing under 15px). */
export const FONT = 15;
export const LINE = 19;

/** Approximate advance width of a label at 15px sans with tabular figures. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/[0-9$]/.test(ch)) w += 8.9;
    else if (ch === '.' || ch === ',' || ch === ':') w += 4.4;
    else if (ch === '%') w += 12.8;
    else if (ch === '-' || ch === '−') w += 6;
    else if (ch === ' ') w += 4.3;
    else if (/[A-Zmw]/.test(ch)) w += 10.5;
    else w += 8.2;
  }
  return Math.ceil(w);
}

/** 1-2-5 ticks covering [lo, hi], about n of them. */
export function niceTicks(lo: number, hi: number, n: number): number[] {
  if (!(hi > lo) || n < 2) return [lo];
  const raw = (hi - lo) / (n - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export function tickDecimals(ticks: readonly number[]): number {
  let d = 0;
  for (const t of ticks) {
    while (d < 4 && Math.abs(t * Math.pow(10, d) - Math.round(t * Math.pow(10, d))) > 1e-7) d++;
  }
  return d;
}

// ---------------------------------------------------------------------------------------------
// Forward: value axis

export interface ForwardGeom {
  /** SVG width; wider than the container only if the tree cannot fit (it then scrolls in its own box). */
  width: number;
  height: number;
  left: number;
  top: number;
  plotH: number;
  /** x of dates 0..steps, then the "next" column where a last-date phantom lands. */
  xs: number[];
  gap: number;
  lo: number;
  hi: number;
  ticks: { v: number; y: number; label: string }[];
}

export const FWD_TOP = 34;
export const FWD_BOTTOM = 36;
/** Minimum on-screen distance between two real nodes of the same date. */
export const FWD_MIN_NODE_SEP = 40;
export const FWD_MIN_PLOT = 240;
export const FWD_MAX_PLOT = 420;
export const MAX_COL_GAP = 150;

export function yOf(g: Pick<ForwardGeom, 'top' | 'plotH' | 'lo' | 'hi'>, v: number): number {
  return g.top + (1 - (v - g.lo) / (g.hi - g.lo)) * g.plotH;
}

/**
 * @param lo,hi   every value that can appear (nodes, candidates, phantoms)
 * @param minSep  smallest gap between two real nodes of the same date, in value units
 * @param labelW  widest node label, px
 */
export function forwardGeometry(opts: { width: number; steps: number; lo: number; hi: number; minSep: number; labelW: number }): ForwardGeom {
  const { steps, labelW } = opts;
  const span0 = Math.max(opts.hi - opts.lo, 1e-6);
  const lo = opts.lo - span0 * 0.06;
  const hi = opts.hi + span0 * 0.06;
  const span = hi - lo;
  const plotH = Math.round(Math.min(FWD_MAX_PLOT, Math.max(FWD_MIN_PLOT, (FWD_MIN_NODE_SEP * span) / Math.max(opts.minSep, 1e-9))));
  const nTicks = plotH >= 340 ? 6 : 5;
  const tv = niceTicks(lo, hi, nTicks).filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9);
  const dec = tickDecimals(tv);
  const labels = tv.map((v) => v.toFixed(dec));
  const left = Math.max(...labels.map(textWidth), 16) + 10;
  const cols = steps + 1; // gaps: dates 0..steps plus the "next" column
  const firstX0 = left + labelW / 2 + 8;
  const lastX0 = opts.width - labelW / 2 - 4;
  const minGap = labelW + 8;
  let gap = (lastX0 - firstX0) / cols;
  let firstX = firstX0;
  let width = opts.width;
  if (gap > MAX_COL_GAP) {
    gap = MAX_COL_GAP;
    firstX = firstX0 + (lastX0 - firstX0 - gap * cols) / 2;
  } else if (gap < minGap) {
    gap = minGap;
    width = Math.ceil(firstX0 + gap * cols + labelW / 2 + 4);
  }
  const xs = Array.from({ length: steps + 2 }, (_, t) => firstX + t * gap);
  const top = FWD_TOP;
  const g = { top, plotH, lo, hi };
  return {
    width,
    height: top + plotH + FWD_BOTTOM,
    left,
    top,
    plotH,
    xs,
    gap,
    lo,
    hi,
    ticks: tv.map((v, k) => ({ v, y: yOf(g, v), label: labels[k] })),
  };
}

// ---------------------------------------------------------------------------------------------
// Backward: lattice of chips

export interface LatticeGeom {
  width: number;
  height: number;
  xs: number[];
  gap: number;
  chipW: number;
  chipH: number;
  /** Vertical distance for one up or down move. */
  half: number;
  top: number;
  T: number;
}

export const LAT_TOP = 34;
export const LAT_BOTTOM = 36;
export const CHIP_PAD_X = 16;

export function chipHeight(lines: number): number {
  return lines * LINE + 12;
}

export function latticeGeometry(opts: { width: number; T: number; chipW: number; chipH: number }): LatticeGeom {
  const { T, chipW, chipH } = opts;
  const firstX0 = chipW / 2 + 2;
  const lastX0 = opts.width - chipW / 2 - 2;
  const minGap = chipW + 14;
  let gap = T > 0 ? (lastX0 - firstX0) / T : 0;
  let firstX = firstX0;
  let width = opts.width;
  const maxGap = Math.max(minGap, 190);
  if (gap > maxGap) {
    gap = maxGap;
    firstX = firstX0 + (lastX0 - firstX0 - gap * T) / 2;
  } else if (gap < minGap) {
    gap = minGap;
    width = Math.ceil(firstX0 + gap * T + chipW / 2 + 2);
  }
  const half = Math.ceil(chipH / 2 + 8);
  const top = LAT_TOP;
  return {
    width,
    height: top + chipH + 2 * T * half + LAT_BOTTOM,
    xs: Array.from({ length: T + 1 }, (_, t) => firstX + t * gap),
    gap,
    chipW,
    chipH,
    half,
    top,
    T,
  };
}

/** Centre of lattice node (t, i); more up moves sit higher. */
export function latticeXY(g: LatticeGeom, t: number, i: number): [number, number] {
  const k = 2 * i - t;
  return [g.xs[t], g.top + g.chipH / 2 + (g.T - k) * g.half];
}

// ---------------------------------------------------------------------------------------------
// Label relaxation

/**
 * Nudges label centres (one column) apart to at least `minGap`, keeping them inside [lo, hi].
 * Order is preserved; returns the new centres by key.
 */
export function relaxLabels(items: readonly { key: string; y: number }[], minGap: number, lo: number, hi: number): Map<string, number> {
  const s = [...items].sort((a, b) => a.y - b.y || a.key.localeCompare(b.key)).map((x) => ({ key: x.key, y: Math.min(hi, Math.max(lo, x.y)) }));
  for (let pass = 0; pass < 4; pass++) {
    for (let k = 1; k < s.length; k++) if (s[k].y - s[k - 1].y < minGap) s[k].y = s[k - 1].y + minGap;
    if (s.length && s[s.length - 1].y > hi) s[s.length - 1].y = hi;
    for (let k = s.length - 2; k >= 0; k--) if (s[k + 1].y - s[k].y < minGap) s[k].y = s[k + 1].y - minGap;
    if (s.length && s[0].y < lo) s[0].y = lo;
  }
  return new Map(s.map((x) => [x.key, x.y]));
}
