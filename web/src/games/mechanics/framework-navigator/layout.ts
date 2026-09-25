// Framework Navigator: pure tree geometry. No React, no DOM. Time runs left to right, one lane
// (row) per lineage. Columns are shared across lanes and never run backwards in time: a node dated
// later than another never sits in an earlier column, a child always sits right of its parents,
// and two nodes in one lane never share a column. Undated roots (the notes give no year and no
// dated ancestor) collect in an "undated" zone at the right. Units are CSS pixels: the layout is
// recomputed for the container's width rather than scaled, so labels stay at their true size.

export interface GraphNode {
  id: string;
  lineage: string;
  parents: readonly string[];
  /** First year, or null when undated. */
  yearStart: number | null;
  short: string;
}

export interface BaseLayout {
  /** Node id → column. */
  col: Record<string, number>;
  /** Node ids in placement order (topological, time-ordered). */
  order: string[];
  ncols: number;
  /** Column → header label (year span of its dated nodes, "" when none). */
  colLabel: string[];
  /** First column of the undated zone, or null when every node could be placed in time. */
  undatedFrom: number | null;
  /** Effective time key used for ordering (Infinity for the undated zone). */
  eff: Record<string, number>;
  lanes: string[];
}

/**
 * Effective time for ordering: a node's own year; else the latest year among its ancestors
 * (it came after them); else the earliest among its descendants; else Infinity (undated zone).
 */
export function effectiveYears(nodes: readonly GraphNode[]): Record<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, string[]>();
  for (const n of nodes) for (const p of n.parents) if (byId.has(p)) kids.set(p, [...(kids.get(p) ?? []), n.id]);
  const lowMemo = new Map<string, number | null>();
  const low = (id: string, seen: Set<string>): number | null => {
    if (lowMemo.has(id)) return lowMemo.get(id) ?? null;
    const n = byId.get(id);
    if (!n || seen.has(id)) return null;
    seen.add(id);
    let v: number | null = n.yearStart;
    if (v === null) {
      for (const p of n.parents) {
        const pv = low(p, seen);
        if (pv !== null && (v === null || pv > v)) v = pv;
      }
    }
    seen.delete(id);
    lowMemo.set(id, v);
    return v;
  };
  const highMemo = new Map<string, number | null>();
  const high = (id: string, seen: Set<string>): number | null => {
    if (highMemo.has(id)) return highMemo.get(id) ?? null;
    const n = byId.get(id);
    if (!n || seen.has(id)) return null;
    seen.add(id);
    let v: number | null = n.yearStart;
    if (v === null) {
      for (const k of kids.get(id) ?? []) {
        const kv = high(k, seen);
        if (kv !== null && (v === null || kv < v)) v = kv;
      }
    }
    seen.delete(id);
    highMemo.set(id, v);
    return v;
  };
  const out: Record<string, number> = {};
  for (const n of nodes) out[n.id] = low(n.id, new Set()) ?? high(n.id, new Set()) ?? Infinity;
  return out;
}

/** Kahn's algorithm, always releasing the earliest (eff, lane, id) node whose parents are placed. */
export function timeOrder(nodes: readonly GraphNode[], eff: Record<string, number>, lanes: readonly string[]): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  const indeg = new Map<string, number>();
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    const ps = n.parents.filter((p) => ids.has(p));
    indeg.set(n.id, ps.length);
    for (const p of ps) kids.set(p, [...(kids.get(p) ?? []), n.id]);
  }
  const laneRank = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    const i = n ? lanes.indexOf(n.lineage) : -1;
    return i === -1 ? lanes.length : i;
  };
  const key = (id: string): [number, number, string] => [eff[id] ?? Infinity, laneRank(id), id];
  const cmp = (a: string, b: string) => {
    const ka = key(a);
    const kb = key(b);
    if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
    return ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
  };
  const ready = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const out: string[] = [];
  while (ready.length) {
    ready.sort(cmp);
    const id = ready.shift() as string;
    out.push(id);
    for (const k of kids.get(id) ?? []) {
      const d = (indeg.get(k) ?? 0) - 1;
      indeg.set(k, d);
      if (d === 0) ready.push(k);
    }
  }
  // A cycle (the schema cuts them; defensive): append what's left in key order.
  if (out.length < nodes.length) out.push(...nodes.map((n) => n.id).filter((id) => !out.includes(id)).sort(cmp));
  return out;
}

function yearSpanLabel(years: number[]): string {
  if (years.length === 0) return '';
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return lo === hi ? String(lo) : `${lo}–${String(hi).slice(2)}`;
}

/** Assigns columns: right of every parent, right of the previous node in the lane, never before an earlier-dated node. */
export function baseLayout(nodes: readonly GraphNode[], lanes: readonly string[]): BaseLayout {
  const eff = effectiveYears(nodes);
  const order = timeOrder(nodes, eff, lanes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const col: Record<string, number> = {};
  const laneLast = new Map<string, number>();
  // Highest column used by nodes of each distinct effective time placed so far.
  const placed: { eff: number; col: number }[] = [];
  for (const id of order) {
    const n = byId.get(id);
    if (!n) continue;
    const e = eff[id] ?? Infinity;
    let c = 0;
    for (const p of n.parents) if (col[p] !== undefined) c = Math.max(c, col[p] + 1);
    const lp = laneLast.get(n.lineage);
    if (lp !== undefined) c = Math.max(c, lp + 1);
    for (const x of placed) if (x.eff < e) c = Math.max(c, x.col);
    col[id] = c;
    laneLast.set(n.lineage, c);
    placed.push({ eff: e, col: c });
  }
  const ncols = order.length ? Math.max(...order.map((id) => col[id])) + 1 : 0;
  const colLabel: string[] = [];
  for (let c = 0; c < ncols; c++) {
    const ys = nodes.filter((n) => col[n.id] === c && n.yearStart !== null).map((n) => n.yearStart as number);
    colLabel.push(yearSpanLabel(ys));
  }
  const undatedCols = nodes.filter((n) => eff[n.id] === Infinity).map((n) => col[n.id]);
  const undatedFrom = undatedCols.length ? Math.min(...undatedCols) : null;
  // The undated zone's own columns carry no year.
  if (undatedFrom !== null) for (let c = undatedFrom; c < ncols; c++) colLabel[c] = '';
  return { col, order, ncols, colLabel, undatedFrom, eff, lanes: [...lanes] };
}

/** Splits a short name over two lines at the space nearest its middle (the later one on a tie, so a year stays whole). */
export function wrapLabel(short: string, max = 9): string[] {
  const s = short.trim();
  if (s.length <= max || !s.includes(' ')) return [s];
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (best === -1 || Math.abs(i - mid) <= Math.abs(best - mid))) best = i;
  return [s.slice(0, best), s.slice(best + 1)];
}

/** Rough width of a 15px Inter label (semi-bold): enough to keep neighbouring labels apart. */
export function labelWidth(line: string, px = 15): number {
  let w = 0;
  for (const ch of line) {
    if (/[ilI.,:;'|!()[\]]/.test(ch)) w += 0.3;
    else if (/[mwMW@]/.test(ch)) w += 0.86;
    else if (/[A-Z0-9]/.test(ch)) w += 0.66;
    else if (ch === ' ') w += 0.28;
    else w += 0.55;
  }
  return w * px;
}

export const GEOM = {
  axisH: 34,
  laneTitleH: 24,
  /** Node centre below the lane title band. */
  nodeDy: 24,
  nodeR: 12,
  /** Label baseline below the node centre, and line height. */
  labelDy: 32,
  lineH: 19,
  laneGap: 8,
  collapsedH: 16,
  dotR: 4,
  padX: 16,
  minStep: 60,
  maxStep: 150,
};

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  expanded: boolean;
  lines: string[];
}

export interface PlacedLane {
  id: string;
  y: number;
  h: number;
  expanded: boolean;
  /** Rail y (node centres). */
  railY: number;
  /** x where the lane's rail starts (its first node) and ends. */
  x0: number;
  x1: number;
}

export interface PlacedEdge {
  from: string;
  to: string;
  d: string;
}

export interface TreeLayout {
  width: number;
  height: number;
  step: number;
  nodes: Record<string, PlacedNode>;
  lanes: PlacedLane[];
  cols: { x: number; label: string }[];
  edges: PlacedEdge[];
  /** x of the dashed divider before the undated zone, if any. */
  undatedX: number | null;
}

/** Cubic from a parent to a child: leaves horizontally, arrives horizontally. */
export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(18, (x2 - x1) * 0.5);
  return `M${r1(x1)},${r1(y1)} C${r1(x1 + dx)},${r1(y1)} ${r1(x2 - dx)},${r1(y2)} ${r1(x2)},${r1(y2)}`;
}

function r1(v: number): number {
  return Math.round(v * 10) / 10;
}

function nodeLabelWidth(n: GraphNode): number {
  return Math.max(...wrapLabel(n.short).map((l) => labelWidth(l)));
}

/**
 * The narrowest column step that keeps every label clear of its lane neighbours and every column
 * header clear of the next, never under the 44px tap target plus a margin.
 */
export function minColumnStep(nodes: readonly GraphNode[], base: BaseLayout): number {
  let need = GEOM.minStep;
  for (const label of base.colLabel) if (label) need = Math.max(need, labelWidth(label) + 12);
  const byLane = new Map<string, GraphNode[]>();
  for (const n of nodes) byLane.set(n.lineage, [...(byLane.get(n.lineage) ?? []), n]);
  for (const members of byLane.values()) {
    const ms = [...members].sort((a, b) => (base.col[a.id] ?? 0) - (base.col[b.id] ?? 0));
    for (let i = 1; i < ms.length; i++) {
      const gap = Math.max(1, (base.col[ms[i].id] ?? 0) - (base.col[ms[i - 1].id] ?? 0));
      need = Math.max(need, ((nodeLabelWidth(ms[i]) + nodeLabelWidth(ms[i - 1])) / 2 + 12) / gap);
    }
  }
  return Math.ceil(need);
}

/** The column step that fills `width`, but never narrower than the labels need. */
export function columnStep(nodes: readonly GraphNode[], base: BaseLayout, width: number): number {
  const need = minColumnStep(nodes, base);
  if (base.ncols === 0) return need;
  // Solve ncols·step + 2·(padX + edge(step)) = width, where edge(step) = max(0, half label − step/2 + 4).
  const half = Math.max(0, ...nodes.map((n) => nodeLabelWidth(n) / 2));
  let fit = (width - 2 * GEOM.padX) / base.ncols;
  if (half - fit / 2 + 4 > 0) fit = base.ncols > 1 ? (width - 2 * GEOM.padX - 2 * half - 8) / (base.ncols - 1) : fit;
  return Math.min(Math.max(need, GEOM.maxStep), Math.max(need, Math.floor(fit)));
}

/**
 * Positions for a container `width`. Expanded lanes get a title, full-size nodes and labels;
 * the rest collapse to thin rails of dots (context only).
 */
export function placeTree(
  nodes: readonly GraphNode[],
  base: BaseLayout,
  width: number,
  expanded: ReadonlySet<string>,
): TreeLayout {
  const step = columnStep(nodes, base, width);
  const edge = Math.max(0, ...nodes.map((n) => nodeLabelWidth(n) / 2 - step / 2 + 4));
  // Content wider than the container scrolls inside its own box; narrower content is centred.
  const pad = GEOM.padX + edge;
  const widthNeeded = base.ncols * step + 2 * pad;
  const W = Math.max(Math.round(width), Math.ceil(widthNeeded));
  const left = pad + (W - widthNeeded) / 2;
  const xOf = (c: number) => left + c * step + step / 2;
  const lanes: PlacedLane[] = [];
  let y = GEOM.axisH;
  const placed: Record<string, PlacedNode> = {};
  for (const lane of base.lanes) {
    const members = nodes.filter((n) => n.lineage === lane);
    if (members.length === 0) continue;
    const isOpen = expanded.has(lane);
    const lines = members.map((n) => wrapLabel(n.short));
    const maxLines = Math.max(1, ...lines.map((l) => l.length));
    const h = isOpen ? GEOM.laneTitleH + GEOM.nodeDy + GEOM.labelDy + (maxLines - 1) * GEOM.lineH + 10 : GEOM.collapsedH;
    const railY = isOpen ? y + GEOM.laneTitleH + GEOM.nodeDy : y + GEOM.collapsedH / 2;
    const xs = members.map((n) => xOf(base.col[n.id] ?? 0));
    lanes.push({ id: lane, y, h, expanded: isOpen, railY, x0: Math.min(...xs), x1: Math.max(...xs) });
    members.forEach((n, i) => {
      placed[n.id] = { id: n.id, x: xOf(base.col[n.id] ?? 0), y: railY, expanded: isOpen, lines: lines[i] };
    });
    y += h + (isOpen ? GEOM.laneGap : 2);
  }
  const edges: PlacedEdge[] = [];
  for (const n of nodes) {
    const c = placed[n.id];
    if (!c) continue;
    for (const p of n.parents) {
      const pp = placed[p];
      if (pp) edges.push({ from: p, to: n.id, d: edgePath(pp.x, pp.y, c.x, c.y) });
    }
  }
  const cols = base.colLabel.map((label, c) => ({ x: xOf(c), label }));
  const undatedX = base.undatedFrom === null ? null : left + base.undatedFrom * step;
  return { width: W, height: Math.ceil(y + 6), step, nodes: placed, lanes, cols, edges, undatedX };
}

/** Undirected shortest path between two nodes along parent edges (BFS); [] when disconnected. */
export function pathBetween(nodes: readonly GraphNode[], a: string, b: string): string[] {
  const adj = new Map<string, string[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    for (const p of n.parents) {
      if (!ids.has(p)) continue;
      adj.set(n.id, [...(adj.get(n.id) ?? []), p]);
      adj.set(p, [...(adj.get(p) ?? []), n.id]);
    }
  }
  if (!ids.has(a) || !ids.has(b)) return [];
  if (a === b) return [a];
  const prev = new Map<string, string>();
  const seen = new Set([a]);
  const queue = [a];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const nx of [...(adj.get(cur) ?? [])].sort()) {
      if (seen.has(nx)) continue;
      seen.add(nx);
      prev.set(nx, cur);
      if (nx === b) {
        const path = [b];
        let k = b;
        while (prev.has(k)) {
          k = prev.get(k) as string;
          path.unshift(k);
        }
        return path;
      }
      queue.push(nx);
    }
  }
  return [];
}

/** Arc joining two nodes above the tree (the compare link that closes the loop). */
export function arcPath(x1: number, y1: number, x2: number, y2: number, lift = 42, minY = 8): string {
  // Control height; the curve peaks three quarters of the way up, so this keeps it on the canvas.
  const top = Math.max(minY - (Math.min(y1, y2) - minY) / 3, Math.min(y1, y2) - lift - Math.abs(x2 - x1) * 0.08);
  return `M${r1(x1)},${r1(y1)} C${r1(x1)},${r1(top)} ${r1(x2)},${r1(top)} ${r1(x2)},${r1(y2)}`;
}

/** A dashed stub that grows from a wrongly chosen node and ends nowhere (the branch that doesn't exist). */
export function phantomPath(x: number, y: number, step: number): string {
  const len = Math.max(40, step * 0.62);
  return `M${r1(x)},${r1(y)} C${r1(x + len * 0.45)},${r1(y)} ${r1(x + len * 0.6)},${r1(y - 26)} ${r1(x + len)},${r1(y - 30)}`;
}

/** The scrollLeft that centres a set of x positions in a viewport, clamped to the content. */
export function scrollToFit(xs: readonly number[], viewport: number, content: number): number {
  if (xs.length === 0 || content <= viewport) return 0;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const mid = (lo + hi) / 2;
  const target = hi - lo > viewport - 120 ? lo - 60 : mid - viewport / 2;
  return Math.max(0, Math.min(content - viewport, Math.round(target)));
}
