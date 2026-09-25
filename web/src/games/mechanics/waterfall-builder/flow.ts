// Waterfall Builder: the pure half. Which rounds one flow yields (variants), how a round's stack is
// laid out and filled (a tiny placement state machine), grading, and the geometry of the SVG that
// draws the flow: the rail of nodes and pipes down the stack's left edge, the return channel that
// closes a loop, and the ring the loop settles into. Dependency-free (no React, no corpus) so a node
// script can test it directly.

// ---------------------------------------------------------------------------------------------
// Variants: several rounds from one flow

export type VariantKind = 'build' | 'window' | 'rotated';

export interface Variant {
  kind: VariantKind;
  /**
   * build: 0. window: first open slot (= step index). rotated: the step index locked at the top;
   * the rest follow round the loop.
   */
  start: number;
  /** Number of slots the player fills. */
  size: number;
}

/** The smallest run of open slots a window round may have. */
export const MIN_WINDOW = 2;
/** Discovery rounds need a real choice: at least this many tiles (or the whole flow). */
export const DISCOVERY_MIN_OPEN = 3;

/**
 * Every round a flow of n steps yields:
 *  - build: the empty stack, every tile to place;
 *  - window: a run of 2..n-1 consecutive slots left open, the rest locked in place from the notes;
 *  - rotated (loops only): the loop picked up at another step — that step sits at the top and the
 *    player carries on round the circle until it closes.
 */
export function deriveVariants(n: number, loop: boolean): Variant[] {
  const out: Variant[] = [{ kind: 'build', start: 0, size: n }];
  if (loop) for (let s = 1; s < n; s++) out.push({ kind: 'rotated', start: s, size: n - 1 });
  for (let k = n - 1; k >= MIN_WINDOW; k--) for (let s = 0; s + k <= n; s++) out.push({ kind: 'window', start: s, size: k });
  return out;
}

export function discoveryEligible(v: Variant, n: number): boolean {
  return v.kind !== 'window' || v.size >= Math.min(DISCOVERY_MIN_OPEN, n);
}

/** Stable sub-part key of a variant ('' for the whole build); step ids keep it stable across edits of text. */
export function variantKey(v: Variant, stepIds: readonly string[]): string {
  if (v.kind === 'build') return '';
  if (v.kind === 'rotated') return `from-${stepIds[v.start]}`;
  return `${stepIds[v.start]}..${stepIds[v.start + v.size - 1]}`;
}

/** Step index held by each slot, top to bottom. */
export function slotSteps(n: number, v: Variant): number[] {
  if (v.kind === 'rotated') return Array.from({ length: n }, (_, i) => (v.start + i) % n);
  return Array.from({ length: n }, (_, i) => i);
}

/** Which slots the player fills (true) and which are locked in from the start (false). */
export function openSlots(n: number, v: Variant): boolean[] {
  if (v.kind === 'build') return new Array<boolean>(n).fill(true);
  if (v.kind === 'rotated') return Array.from({ length: n }, (_, i) => i > 0);
  return Array.from({ length: n }, (_, i) => i >= v.start && i < v.start + v.size);
}

/**
 * Tray order for the open slots' tiles: shuffled with the session's rng, and never already in
 * fill order (with two or more tiles), so reading the tray left to right is never the answer.
 */
export function trayOrder(slots: readonly number[], open: readonly boolean[], rng: () => number): number[] {
  const tiles = slots.filter((_, i) => open[i]);
  if (tiles.length < 2) return tiles;
  for (let attempt = 0; attempt < 12; attempt++) {
    const a = [...tiles];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (a.some((x, i) => x !== tiles[i])) return a;
  }
  return [...tiles.slice(1), tiles[0]];
}

// ---------------------------------------------------------------------------------------------
// Placement: tiles go in top to bottom

export interface StackState {
  /** Step index per slot, top to bottom. */
  slots: number[];
  /** Slot filled (locked in from the start, placed by the player, or revealed). */
  filled: boolean[];
  /** How each slot came to be filled. */
  how: ('locked' | 'placed' | 'revealed' | null)[];
  /** The slot the next tile drops into; -1 when the stack is complete. */
  cursor: number;
  /** Wrong tiles tried, in total and per slot. */
  errors: number;
  slipsAt: number[];
  /** First wrong step tried at each slot (for the one-line correction), or -1. */
  firstWrong: number[];
}

function nextOpen(filled: readonly boolean[], from: number): number {
  for (let i = Math.max(0, from); i < filled.length; i++) if (!filled[i]) return i;
  return -1;
}

export function initialStack(slots: readonly number[], open: readonly boolean[]): StackState {
  const filled = open.map((o) => !o);
  return {
    slots: [...slots],
    filled,
    how: filled.map((f) => (f ? 'locked' : null)),
    cursor: nextOpen(filled, 0),
    errors: 0,
    slipsAt: slots.map(() => 0),
    firstWrong: slots.map(() => -1),
  };
}

export function expectedStep(s: StackState): number | null {
  return s.cursor < 0 ? null : s.slots[s.cursor];
}

/** Drops a tile (step index) into the next open slot: it locks if it belongs there, else bounces. */
export function placeTile(s: StackState, step: number): { state: StackState; correct: boolean } {
  if (s.cursor < 0) return { state: s, correct: false };
  if (s.slots[s.cursor] === step) {
    const filled = [...s.filled];
    const how = [...s.how];
    filled[s.cursor] = true;
    how[s.cursor] = 'placed';
    return { state: { ...s, filled, how, cursor: nextOpen(filled, s.cursor + 1) }, correct: true };
  }
  const slipsAt = [...s.slipsAt];
  const firstWrong = [...s.firstWrong];
  slipsAt[s.cursor] += 1;
  if (firstWrong[s.cursor] < 0) firstWrong[s.cursor] = step;
  return { state: { ...s, errors: s.errors + 1, slipsAt, firstWrong }, correct: false };
}

/** Time ran out (or the player gave up): the rest of the stack fills itself in, marked as revealed. */
export function revealRest(s: StackState): StackState {
  return {
    ...s,
    filled: s.filled.map(() => true),
    how: s.how.map((h) => h ?? 'revealed'),
    cursor: -1,
  };
}

export function isComplete(s: StackState): boolean {
  return s.cursor < 0;
}

/** Steps still in the tray (open, unfilled slots' steps). */
export function remainingTiles(s: StackState, tray: readonly number[]): number[] {
  const waiting = new Set(s.slots.filter((_, i) => !s.filled[i]));
  return tray.filter((t) => waiting.has(t));
}

/** Index of the lowest slot the flow reaches: every slot from the top down to it is filled. -1 if none. */
export function litThrough(filled: readonly boolean[]): number {
  let i = -1;
  while (i + 1 < filled.length && filled[i + 1]) i++;
  return i;
}

/**
 * SRS grade override: undefined for a clean round (the shell grades on speed); a single slip over
 * four or more tiles still lapses but less hard (2); otherwise the shell's wrong/timeout grade.
 */
export function slipGrade(errors: number, openCount: number, timedOut: boolean): number | undefined {
  if (timedOut || errors === 0) return undefined;
  return errors === 1 && openCount >= 4 ? 2 : 1;
}

// ---------------------------------------------------------------------------------------------
// Timing

export const DISCOVERY_MS_PER_TILE = 10000;
export const PRESSURE_BASE_MS = 6000;
export const PRESSURE_MS_PER_TILE = 4500;
export const PRESSURE_MIN_MS = 15000;
export const PRESSURE_MAX_MS = 45000;

/** Structural rounds run 15-45 s (§10.3): a base read plus a few seconds per tile, a touch shorter each round. */
export function pressureLimit(openCount: number, step: number): number {
  const raw = (PRESSURE_BASE_MS + PRESSURE_MS_PER_TILE * openCount) * Math.pow(0.95, step);
  return Math.round(Math.min(PRESSURE_MAX_MS, Math.max(PRESSURE_MIN_MS, raw)));
}

// ---------------------------------------------------------------------------------------------
// Geometry: the rail

export interface Pt {
  x: number;
  y: number;
}

export const RAIL_X = 34;
export const LOOP_X = 11;
export const NODE_R = 11;
export const GUTTER = 50;

export interface RailGeometry {
  nodes: Pt[];
  /** Pipe i joins node i to node i+1, shortened so it starts and ends at the node rims. */
  pipes: string[];
  /** Loops: the return channel from the last node back round to the first. */
  loop: string | null;
  /** Its approximate length (for a stroke-dash draw-on). */
  loopLength: number;
}

/** Straight pipes between node centres down x = RAIL_X; a loop adds a channel out to LOOP_X and back up. */
export function railGeometry(centres: readonly number[], loop: boolean, railX = RAIL_X, loopX = LOOP_X, r = NODE_R): RailGeometry {
  const nodes = centres.map((y) => ({ x: railX, y }));
  const pipes: string[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const y0 = nodes[i].y + r + 2;
    const y1 = nodes[i + 1].y - r - 2;
    pipes.push(`M ${fmt(railX)} ${fmt(y0)} L ${fmt(railX)} ${fmt(Math.max(y0, y1))}`);
  }
  if (!loop || nodes.length < 2) return { nodes, pipes, loop: null, loopLength: 0 };
  const top = nodes[0].y;
  const bottom = nodes[nodes.length - 1].y;
  const bend = Math.max(4, Math.min(18, (bottom - top) / 3));
  // Leaves the last node's rim heading left, runs up the outer channel, re-enters the first node from the left.
  const x0 = railX - r - 1;
  const d =
    `M ${fmt(x0)} ${fmt(bottom)} Q ${fmt(loopX)} ${fmt(bottom)} ${fmt(loopX)} ${fmt(bottom - bend)} ` +
    `L ${fmt(loopX)} ${fmt(top + bend)} Q ${fmt(loopX)} ${fmt(top)} ${fmt(x0)} ${fmt(top)}`;
  const q1 = quadLength({ x: x0, y: bottom }, { x: loopX, y: bottom }, { x: loopX, y: bottom - bend });
  const q2 = quadLength({ x: loopX, y: top + bend }, { x: loopX, y: top }, { x: x0, y: top });
  return { nodes, pipes, loop: d, loopLength: q1 + Math.max(0, bottom - top - 2 * bend) + q2 };
}

/** Length of a quadratic Bézier, by fine polyline. */
export function quadLength(a: Pt, c: Pt, b: Pt, samples = 32): number {
  let len = 0;
  let prev = a;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    const p = { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

/** A leak: the flow veers off the rail at a wrong tile and drips away into the gutter. */
export function phantomPath(at: Pt, gutterLeft = 2, drop = 34): string {
  const endX = Math.max(gutterLeft, at.x - 26);
  return `M ${fmt(at.x - NODE_R + 2)} ${fmt(at.y + 4)} C ${fmt(at.x - 16)} ${fmt(at.y + 10)} ${fmt(endX + 2)} ${fmt(at.y + drop * 0.45)} ${fmt(endX)} ${fmt(at.y + drop)}`;
}

// ---------------------------------------------------------------------------------------------
// Geometry: the ring a closed loop settles into

/** Node i of n on a circle, starting at twelve o'clock and running clockwise (screen coordinates). */
export function ringPoint(i: number, n: number, cx: number, cy: number, radius: number): Pt {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
}

export function ringLayout(n: number, cx: number, cy: number, radius: number): Pt[] {
  return Array.from({ length: n }, (_, i) => ringPoint(i, n, cx, cy, radius));
}

/** The same nodes stacked in a column (the ring's starting shape), centred on cy. */
export function columnLayout(n: number, cx: number, cy: number, height: number): Pt[] {
  if (n <= 1) return [{ x: cx, y: cy }];
  const gap = height / (n - 1);
  return Array.from({ length: n }, (_, i) => ({ x: cx, y: cy - height / 2 + i * gap }));
}

/**
 * Clockwise arc from node i to node i+1 (mod n) on the ring, trimmed by `pad` px at each end so it
 * runs rim to rim.
 */
export function ringArc(i: number, n: number, cx: number, cy: number, radius: number, pad: number): string {
  const step = (2 * Math.PI) / n;
  const trim = Math.min(step / 3, pad / radius);
  const a0 = -Math.PI / 2 + step * i + trim;
  const a1 = -Math.PI / 2 + step * (i + 1) - trim;
  const p0 = { x: cx + radius * Math.cos(a0), y: cy + radius * Math.sin(a0) };
  const p1 = { x: cx + radius * Math.cos(a1), y: cy + radius * Math.sin(a1) };
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${fmt(p0.x)} ${fmt(p0.y)} A ${fmt(radius)} ${fmt(radius)} 0 ${large} 1 ${fmt(p1.x)} ${fmt(p1.y)}`;
}

/** Arrowhead (polygon points) at the end of ringArc(i, …), pointing along the clockwise tangent. */
export function ringArrow(i: number, n: number, cx: number, cy: number, radius: number, pad: number, size = 8): string {
  const step = (2 * Math.PI) / n;
  const trim = Math.min(step / 3, pad / radius);
  const a1 = -Math.PI / 2 + step * (i + 1) - trim;
  const tip = { x: cx + radius * Math.cos(a1), y: cy + radius * Math.sin(a1) };
  const tx = -Math.sin(a1);
  const ty = Math.cos(a1);
  const bx = tip.x - tx * size;
  const by = tip.y - ty * size;
  const half = size * 0.6;
  const pts = [
    [tip.x + tx * 1.5, tip.y + ty * 1.5],
    [bx - ty * half, by + tx * half],
    [bx + ty * half, by - tx * half],
  ];
  return pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
}

export function lerpPoints(a: readonly Pt[], b: readonly Pt[], t: number): Pt[] {
  const u = Math.max(0, Math.min(1, t));
  return a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * u, y: p.y + (b[i].y - p.y) * u }));
}

export function easeInOutCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/** Ring size for a container width: fits a phone, never so large that the nodes drift apart. */
export function ringFrame(width: number, n: number): { W: number; H: number; cx: number; cy: number; radius: number } {
  const W = Math.max(240, Math.round(width));
  const radius = Math.round(Math.min(W / 2 - 34, 72 + 8 * n, 120));
  const H = 2 * radius + 60;
  return { W, H, cx: W / 2, cy: H / 2, radius };
}

function fmt(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}
