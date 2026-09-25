// Attribution Grid: board geometry. Pure maths, dependency-free, no React, no DOM — tested by a
// node script. Coordinates are CSS pixels relative to the board container, so the overlay SVG's
// viewBox is the container's own size and text inside it is never scaled down.

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

/** Filed-statement tiles: small squares along the bottom of a slot. */
export const TILE = 14;
export const TILE_GAP = 6;
export const TILE_PAD = 12;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function centre(r: Rect): Pt {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function contains(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Tiles per row inside a slot of width w (at least one). */
export function tilesPerRow(w: number): number {
  return Math.max(1, Math.floor((w - 2 * TILE_PAD + TILE_GAP) / (TILE + TILE_GAP)));
}

/**
 * Top-left corner of the index-th tile in a slot. Tiles fill left to right along the bottom
 * edge, and further rows stack upwards, so the slot's label at the top is never covered.
 */
export function tileAt(slot: Rect, index: number): Pt {
  const per = tilesPerRow(slot.w);
  const row = Math.floor(Math.max(0, index) / per);
  const col = Math.max(0, index) % per;
  return {
    x: slot.x + TILE_PAD + col * (TILE + TILE_GAP),
    y: slot.y + slot.h - TILE_PAD - TILE - row * (TILE + TILE_GAP),
  };
}

/** Centre of the index-th tile. */
export function tileCentre(slot: Rect, index: number): Pt {
  const p = tileAt(slot, index);
  return { x: p.x + TILE / 2, y: p.y + TILE / 2 };
}

/**
 * The oversight connectors between the board slot and the three line slots: a trunk down from
 * the board, a horizontal bus, and a drop into each line. Orthogonal paths, as SVG `d` strings.
 * Lines not below the board (a stacked layout) get no connector.
 */
export function connectorPaths(board: Rect, lines: readonly Rect[]): string[] {
  const bottom = board.y + board.h;
  const below = lines.filter((l) => l.y >= bottom);
  if (below.length === 0) return [];
  const top = Math.min(...below.map((l) => l.y));
  const busY = bottom + (top - bottom) / 2;
  const xs = below.map((l) => l.x + l.w / 2);
  const trunkX = clamp(board.x + board.w / 2, Math.min(...xs), Math.max(...xs));
  const r = (n: number) => Math.round(n * 10) / 10;
  const out = [`M${r(trunkX)} ${r(bottom)}V${r(busY)}`];
  if (xs.length > 1) out.push(`M${r(Math.min(...xs))} ${r(busY)}H${r(Math.max(...xs))}`);
  for (const l of below) out.push(`M${r(l.x + l.w / 2)} ${r(busY)}V${r(l.y)}`);
  return out;
}

/** Point on a quadratic Bézier. */
export function quadAt(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

/** Derivative of a quadratic Bézier (direction of travel). */
export function quadTangent(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  return {
    x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x),
    y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y),
  };
}

/**
 * Control point for the phantom arc from a wrong slot to the right one: the chord's midpoint
 * pushed sideways by `bow` × chord length. Mostly-horizontal moves bow upwards (over the slots);
 * mostly-vertical ones bow to the right. A zero-length chord gets no bow.
 */
export function arcControl(from: Pt, to: Pt, bow = 0.28): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (len < 1e-6) return mid;
  // The two unit normals; pick the one pointing up (or right, for vertical chords).
  let nx = -dy / len;
  let ny = dx / len;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if ((horizontal && ny > 0) || (!horizontal && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: mid.x + nx * bow * len, y: mid.y + ny * bow * len };
}

/** Largest t in [0, 1] whose curve point is at least `gap` px from the end point (binary search). */
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

/** The part of a quadratic Bézier for t in [0, t1], as a new control point and end point. */
export function splitQuad(p0: Pt, c: Pt, p1: Pt, t1: number): { c: Pt; end: Pt } {
  // de Casteljau: the first segment's control point is lerp(p0, c, t1).
  return { c: { x: p0.x + (c.x - p0.x) * t1, y: p0.y + (c.y - p0.y) * t1 }, end: quadAt(p0, c, p1, t1) };
}

export interface PhantomArc {
  /** The curve, stopping short of the target so the arrowhead does not cover the tile. */
  d: string;
  /** Arrowhead triangle, pointing along the curve at its end. */
  head: string;
  /** Control point of the full (untrimmed) curve, for animating a tile along it. */
  ctrl: Pt;
}

/** Dashed arc with an arrowhead from the wrong placement to where the statement belongs. */
export function phantomArc(from: Pt, to: Pt, opts: { bow?: number; gap?: number; head?: number } = {}): PhantomArc {
  const ctrl = arcControl(from, to, opts.bow ?? 0.28);
  const t1 = trimEnd(from, ctrl, to, opts.gap ?? 12);
  const seg = splitQuad(from, ctrl, to, t1);
  const tan = quadTangent(from, ctrl, to, t1);
  const tl = Math.hypot(tan.x, tan.y) || 1;
  const ux = tan.x / tl;
  const uy = tan.y / tl;
  const size = opts.head ?? 9;
  const tip = seg.end;
  const base = { x: tip.x - ux * size, y: tip.y - uy * size };
  const half = size * 0.55;
  const r = (n: number) => Math.round(n * 10) / 10;
  const left = { x: base.x - uy * half, y: base.y + ux * half };
  const right = { x: base.x + uy * half, y: base.y - ux * half };
  return {
    d: `M${r(from.x)} ${r(from.y)}Q${r(seg.c.x)} ${r(seg.c.y)} ${r(tip.x)} ${r(tip.y)}`,
    head: `${r(tip.x)},${r(tip.y)} ${r(left.x)},${r(left.y)} ${r(right.x)},${r(right.y)}`,
    ctrl,
  };
}

// ---- Easing -------------------------------------------------------------------------------------

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Overshoots slightly then settles: the "snap" into a slot. Ends exactly at 1. */
export function easeOutBack(t: number, s = 1.70158): number {
  const x = clamp(t, 0, 1) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
}

/** Position of a flying tile at progress t (0–1): straight line, or along a curve when ctrl is given. */
export function flightAt(from: Pt, to: Pt, t: number, ctrl?: Pt): Pt {
  if (ctrl) return quadAt(from, ctrl, to, clamp(t, 0, 1));
  // Straight flights may overshoot (easeOutBack), so t is not clamped above.
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Which slot a point falls in, by id; null when it is over none. */
export function slotAt<K extends string>(slots: Partial<Record<K, Rect>>, p: Pt): K | null {
  for (const [k, r] of Object.entries(slots) as [K, Rect | undefined][]) if (r && contains(r, p)) return k;
  return null;
}
