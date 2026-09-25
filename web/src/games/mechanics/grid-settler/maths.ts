// Grid Settler: pure maths. Dependency-free (no React, no DOM, no corpus), so a node script tests
// it directly. Geometry is in CSS pixels relative to the board container: the overlay SVG uses the
// container's own size as its viewBox, so nothing drawn in it is ever scaled down.

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function centre(r: Rect): Pt {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function contains(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Key of a cell, "x,y". */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Which cell a point falls in; null when over none. */
export function cellAt(cells: Readonly<Record<string, Rect>>, p: Pt): string | null {
  for (const [k, r] of Object.entries(cells)) if (contains(r, p)) return k;
  return null;
}

/**
 * The nearest cell to a point within `reach` px of its edge, for a forgiving snap when a drop
 * lands in the gutter between two cells. Inside a cell wins outright.
 */
export function snapCell(cells: Readonly<Record<string, Rect>>, p: Pt, reach = 14): string | null {
  const inside = cellAt(cells, p);
  if (inside) return inside;
  let best: string | null = null;
  let bestD = Infinity;
  for (const [k, r] of Object.entries(cells)) {
    const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
    const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
    const d = Math.hypot(dx, dy);
    if (d <= reach && d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

// ---- The phantom arc: from where the tile went (or the tray) to where it belongs --------------

export function quadAt(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}

export function quadTangent(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  return { x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x), y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y) };
}

/**
 * Control point: the chord's midpoint pushed sideways by `bow` × chord length. Mostly-horizontal
 * chords bow upwards; mostly-vertical ones bow to the right. A zero-length chord gets no bow.
 */
export function arcControl(from: Pt, to: Pt, bow = 0.25): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (len < 1e-6) return mid;
  let nx = -dy / len;
  let ny = dx / len;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if ((horizontal && ny > 0) || (!horizontal && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: mid.x + nx * bow * len, y: mid.y + ny * bow * len };
}

/** Largest t in [0, 1] whose curve point is at least `gap` px from the end point. */
export function trimEnd(p0: Pt, c: Pt, p1: Pt, gap: number): number {
  if (gap <= 0) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    const q = quadAt(p0, c, p1, m);
    if (Math.hypot(q.x - p1.x, q.y - p1.y) >= gap) lo = m;
    else hi = m;
  }
  return lo;
}

export interface PhantomArc {
  d: string;
  head: string;
  ctrl: Pt;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Dashed arc with an arrowhead, stopping `gap` px short of the target. */
export function phantomArc(from: Pt, to: Pt, opts: { bow?: number; gap?: number; head?: number } = {}): PhantomArc {
  const ctrl = arcControl(from, to, opts.bow ?? 0.25);
  const t1 = trimEnd(from, ctrl, to, opts.gap ?? 10);
  // de Casteljau: the first segment's control point is lerp(p0, c, t1).
  const segC = { x: from.x + (ctrl.x - from.x) * t1, y: from.y + (ctrl.y - from.y) * t1 };
  const tip = quadAt(from, ctrl, to, t1);
  const tan = quadTangent(from, ctrl, to, t1);
  const tl = Math.hypot(tan.x, tan.y) || 1;
  const ux = tan.x / tl;
  const uy = tan.y / tl;
  const size = opts.head ?? 10;
  const base = { x: tip.x - ux * size, y: tip.y - uy * size };
  const half = size * 0.55;
  return {
    d: `M${r1(from.x)} ${r1(from.y)}Q${r1(segC.x)} ${r1(segC.y)} ${r1(tip.x)} ${r1(tip.y)}`,
    head: `${r1(tip.x)},${r1(tip.y)} ${r1(base.x - uy * half)},${r1(base.y + ux * half)} ${r1(base.x + uy * half)},${r1(base.y - ux * half)}`,
    ctrl,
  };
}

// ---- Easing and flight ---------------------------------------------------------------------

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Overshoots slightly then settles: the snap into a cell. Ends exactly at 1. */
export function easeOutBack(t: number, s = 1.70158): number {
  const x = clamp(t, 0, 1) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
}

/** Offset (relative to the resting place `to`) of a flying tile at eased progress e. */
export function flightOffset(from: Pt, to: Pt, e: number, ctrl?: Pt): Pt {
  if (ctrl) {
    const p = quadAt(from, ctrl, to, clamp(e, 0, 1));
    return { x: p.x - to.x, y: p.y - to.y };
  }
  // A straight flight may overshoot (easeOutBack), so e is not clamped above.
  return { x: (from.x - to.x) * (1 - e), y: (from.y - to.y) * (1 - e) };
}

// ---- The full-grid reveal --------------------------------------------------------------------

/** Tile count per cell, as counts[y][x]. */
export function cellCounts(tiles: readonly { x: number; y: number }[], nx: number, ny: number): number[][] {
  const out = Array.from({ length: ny }, () => Array.from({ length: nx }, () => 0));
  for (const t of tiles) if (t.y >= 0 && t.y < ny && t.x >= 0 && t.x < nx) out[t.y][t.x]++;
  return out;
}

/** Heat per cell in [0, 1]: count over the busiest cell's count. An empty grid is all zero. */
export function heat(counts: readonly (readonly number[])[]): number[][] {
  const max = Math.max(0, ...counts.flat());
  return counts.map((row) => row.map((c) => (max > 0 ? c / max : 0)));
}

/** Column and row totals: how the tiles spread along each axis. */
export function marginals(counts: readonly (readonly number[])[]): { cols: number[]; rows: number[] } {
  const nx = counts[0]?.length ?? 0;
  const cols = Array.from({ length: nx }, (_, x) => counts.reduce((s, row) => s + (row[x] ?? 0), 0));
  const rows = counts.map((row) => row.reduce((s, c) => s + c, 0));
  return { cols, rows };
}

/**
 * Marginal bars for the reveal: one bar per column (along the top edge of the grid, growing up)
 * and one per row (along the left edge, growing left), each scaled to `depth` px by its share of
 * the largest total. Rects are in board pixels, from the column and row bands' measured extents.
 */
export function marginalBars(
  cols: readonly { x: number; w: number }[],
  rows: readonly { y: number; h: number }[],
  totals: { cols: readonly number[]; rows: readonly number[] },
  frame: { top: number; left: number },
  depth: number,
  inset = 6,
): { cols: Rect[]; rows: Rect[] } {
  const max = Math.max(1, ...totals.cols, ...totals.rows);
  const colBars = cols.map((c, i) => {
    const h = ((totals.cols[i] ?? 0) / max) * depth;
    return { x: c.x + inset, y: frame.top - h, w: Math.max(0, c.w - 2 * inset), h };
  });
  const rowBars = rows.map((r, i) => {
    const w = ((totals.rows[i] ?? 0) / max) * depth;
    return { x: frame.left - w, y: r.y + inset, w, h: Math.max(0, r.h - 2 * inset) };
  });
  return { cols: colBars, rows: rowBars };
}

// ---- Round planning and timing ---------------------------------------------------------------

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Comfortable time to read a tile and place it on a grid of `cells` cells. Pressure limits tighten
 * about 7% a round; discovery has no limit, only this target (× 1.5) for the SRS speed grade.
 */
export function timeFor(text: string, cells: number, pressureStep: number | null): number {
  const base = clamp(4500 + wordCount(text) * 380 + cells * 320, 8000, 16000);
  if (pressureStep === null) return Math.round(base * 1.5);
  return Math.round(base * Math.pow(0.93, pressureStep));
}

/** Discovery / pressure split for `total` rounds: 3–5 each (total 6–10). */
export function splitCounts(total: number): { discovery: number; pressure: number } {
  const discovery = clamp(Math.floor(total / 2), 3, 5);
  return { discovery, pressure: Math.max(0, total - discovery) };
}

/**
 * Picks `n` tiles for discovery from an ordered list (already sorted by SRS priority), preferring
 * tiles that open a column or row not yet seen, so the player meets as much of both axes as
 * possible before the naming step. Ties keep list order. Returns indices into `tiles`.
 */
export function spreadPick(tiles: readonly { x: number; y: number; tier: number }[], n: number): number[] {
  const out: number[] = [];
  const xs = new Set<number>();
  const ys = new Set<number>();
  const left = tiles.map((_, i) => i);
  while (out.length < n && left.length) {
    let best = 0;
    let bestScore = -Infinity;
    for (let k = 0; k < left.length; k++) {
      const t = tiles[left[k]];
      // Priority tier dominates; fresh axis values break ties within a tier.
      const score = -t.tier * 10 + (xs.has(t.x) ? 0 : 2) + (ys.has(t.y) ? 0 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    const [i] = left.splice(best, 1);
    out.push(i);
    xs.add(tiles[i].x);
    ys.add(tiles[i].y);
  }
  return out;
}
