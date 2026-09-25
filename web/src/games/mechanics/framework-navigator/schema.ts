// Framework Navigator: the curated data contract (content/games/mechanics/framework-navigator.json,
// loaded into corpus.extras['framework-navigator']) and a defensive type guard. Pure; no React.
// Malformed items are dropped, never guessed: a node without an id / name / known lineage goes,
// a parent or decoy pointing at a missing node goes, and parent edges that would close a cycle
// or run backwards in time are cut so the tree can always be laid out left to right.

export type Facet = 'introduced' | 'restricted' | 'responding_to';
export const FACETS: readonly Facet[] = ['introduced', 'restricted', 'responding_to'];
export const FACET_LABEL: Record<Facet, string> = {
  introduced: 'Introduced',
  restricted: 'Restricted',
  responding_to: 'Responding to',
};

export interface FnLineage {
  id: string;
  label: string;
}

export interface FnEvidence {
  field: Facet;
  index: number;
  sourceFile: string;
  sourceLine: number;
}

export interface FnNode {
  id: string;
  name: string;
  /** ≤ 14 characters, for the tree. */
  short: string;
  /** As written in the data: a year, a 'YYYY–YYYY' range, or null (the notes give no date). */
  year: number | string | null;
  /** First year of the range; null when undated. */
  yearStart: number | null;
  lineage: string;
  parents: string[];
  readingIds: string[];
  sourceFile: string | null;
  sourceLine: number | null;
  sourceBlock: string | null;
  introduced: string[];
  restricted: string[];
  responding_to: string[];
  evidence: FnEvidence[];
  summary: string;
  /** Other names the notes use (never shown as a giveaway in a change or fact). */
  aliases: string[];
  /** Declared look-alikes (plausible confusions). */
  related: string[];
}

export interface FnChange {
  id: string;
  readingId: string;
  text: string;
  node: string;
  decoys: string[];
  why: string;
  sourceFile: string | null;
  sourceLine: number | null;
  sourceBlock: string | null;
}

export interface FnPair {
  id: string;
  a: string;
  b: string;
  readingId: string;
  differences: string[];
  /** Source line per difference index, when given. */
  differenceSources: { index: number; sourceFile: string; sourceLine: number }[];
}

export interface FnData {
  lineages: FnLineage[];
  nodes: FnNode[];
  changes: FnChange[];
  pairs: FnPair[];
  nodeById: Record<string, FnNode>;
  childrenOf: Record<string, string[]>;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.replace(/\s+/g, ' ').trim() : null;
}

function strList(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const v of x) {
    const s = str(v);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function posInt(x: unknown): number | null {
  return typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : null;
}

/** 1988 → 1988; "2015–2019" (en dash or hyphen) → 2015; anything else → null. */
export function yearStartOf(y: unknown): number | null {
  if (typeof y === 'number' && Number.isInteger(y) && y >= 1800 && y <= 2100) return y;
  if (typeof y === 'string') {
    const m = /^\s*(\d{4})\s*(?:[–—-]\s*(\d{4}))?\s*$/.exec(y);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Year as shown: "1988", "2015–2019", or null when undated. */
export function yearLabel(n: Pick<FnNode, 'year' | 'yearStart'>): string | null {
  if (n.yearStart === null) return null;
  if (typeof n.year === 'string') return n.year.replace(/\s*[-—]\s*/, '–').trim();
  return String(n.yearStart);
}

function parseLineage(x: unknown): FnLineage | null {
  if (!isRecord(x)) return null;
  const id = str(x.id);
  if (!id) return null;
  return { id, label: str(x.label) ?? id };
}

function isFacet(x: unknown): x is Facet {
  return typeof x === 'string' && (FACETS as readonly string[]).includes(x);
}

function parseEvidence(x: unknown): FnEvidence[] {
  if (!Array.isArray(x)) return [];
  const out: FnEvidence[] = [];
  for (const e of x) {
    if (!isRecord(e) || !isFacet(e.field)) continue;
    const index = typeof e.index === 'number' && Number.isInteger(e.index) && e.index >= 0 ? e.index : null;
    const sourceFile = str(e.source_file);
    const sourceLine = posInt(e.source_line);
    if (index === null || !sourceFile || sourceLine === null) continue;
    out.push({ field: e.field, index, sourceFile, sourceLine });
  }
  return out;
}

function parseNode(x: unknown, lineages: ReadonlySet<string>): FnNode | null {
  if (!isRecord(x)) return null;
  const id = str(x.id);
  const name = str(x.name);
  const lineage = str(x.lineage);
  if (!id || !name || !lineage || !lineages.has(lineage)) return null;
  const introduced = strList(x.introduced);
  const restricted = strList(x.restricted);
  const responding_to = strList(x.responding_to);
  if (introduced.length + restricted.length + responding_to.length === 0) return null;
  const year = typeof x.year === 'number' || typeof x.year === 'string' ? x.year : null;
  const yearStart = yearStartOf(year);
  return {
    id,
    name,
    short: str(x.short) ?? name,
    year: yearStart === null ? null : year,
    yearStart,
    lineage,
    parents: strList(x.parents).filter((p) => p !== id),
    readingIds: strList(x.reading_ids),
    sourceFile: str(x.source_file),
    sourceLine: posInt(x.source_line),
    sourceBlock: str(x.source_block),
    introduced,
    restricted,
    responding_to,
    evidence: parseEvidence(x.evidence),
    summary: str(x.summary) ?? '',
    aliases: strList(x.aliases),
    related: strList(x.related).filter((r) => r !== id),
  };
}

function parseChange(x: unknown, nodes: Record<string, FnNode>): FnChange | null {
  if (!isRecord(x)) return null;
  const id = str(x.id);
  const readingId = str(x.reading_id);
  const text = str(x.text);
  const node = str(x.node);
  if (!id || !readingId || !text || !node || !nodes[node]) return null;
  const decoys = strList(x.decoys).filter((d) => d !== node && !!nodes[d]);
  if (decoys.length < 1) return null;
  return {
    id,
    readingId,
    text,
    node,
    decoys: decoys.slice(0, 3),
    why: str(x.why) ?? '',
    sourceFile: str(x.source_file),
    sourceLine: posInt(x.source_line),
    sourceBlock: str(x.source_block),
  };
}

function parsePair(x: unknown, nodes: Record<string, FnNode>): FnPair | null {
  if (!isRecord(x)) return null;
  const a = str(x.a);
  const b = str(x.b);
  const readingId = str(x.reading_id);
  if (!a || !b || a === b || !nodes[a] || !nodes[b] || !readingId) return null;
  const differences = strList(x.differences);
  if (differences.length === 0) return null;
  const differenceSources: FnPair['differenceSources'] = [];
  if (Array.isArray(x.difference_sources)) {
    for (const s of x.difference_sources) {
      if (!isRecord(s)) continue;
      const index = typeof s.index === 'number' && Number.isInteger(s.index) && s.index >= 0 ? s.index : null;
      const sourceFile = str(s.source_file);
      const sourceLine = posInt(s.source_line);
      if (index !== null && sourceFile && sourceLine !== null) differenceSources.push({ index, sourceFile, sourceLine });
    }
  }
  return { id: str(x.id) ?? `fnp:${a}~${b}`, a, b, readingId, differences, differenceSources };
}

/**
 * Cuts parent edges that run backwards in time (child dated before its parent) and any edge left
 * inside a cycle after Kahn's algorithm, so the graph is a DAG whose dates never decrease.
 */
export function sanitiseParents(nodes: FnNode[]): FnNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let out = nodes.map((n) => ({
    ...n,
    parents: n.parents.filter((p) => {
      const parent = byId.get(p);
      if (!parent) return false;
      return parent.yearStart === null || n.yearStart === null || n.yearStart >= parent.yearStart;
    }),
  }));
  // Kahn: whatever never reaches in-degree zero sits on (or behind) a cycle.
  const indeg = new Map(out.map((n) => [n.id, n.parents.length]));
  const kids = new Map<string, string[]>();
  for (const n of out) for (const p of n.parents) kids.set(p, [...(kids.get(p) ?? []), n.id]);
  const queue = out.filter((n) => n.parents.length === 0).map((n) => n.id);
  const done = new Set<string>();
  while (queue.length) {
    const id = queue.shift() as string;
    done.add(id);
    for (const k of kids.get(id) ?? []) {
      const d = (indeg.get(k) ?? 0) - 1;
      indeg.set(k, d);
      if (d === 0) queue.push(k);
    }
  }
  if (done.size < out.length) {
    out = out.map((n) => (done.has(n.id) ? n : { ...n, parents: n.parents.filter((p) => done.has(p)) }));
  }
  return out;
}

/** Validates the curated file; null when there is nothing playable in it. */
export function parseFrameworkData(raw: unknown): FnData | null {
  if (!isRecord(raw)) return null;
  if (raw.mechanic !== undefined && raw.mechanic !== 'framework-navigator') return null;
  const lineages: FnLineage[] = [];
  for (const l of Array.isArray(raw.lineages) ? raw.lineages : []) {
    const p = parseLineage(l);
    if (p && !lineages.some((x) => x.id === p.id)) lineages.push(p);
  }
  const laneIds = new Set(lineages.map((l) => l.id));
  const parsed: FnNode[] = [];
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    const p = parseNode(n, laneIds);
    if (p && !parsed.some((x) => x.id === p.id)) parsed.push(p);
  }
  if (parsed.length === 0) return null;
  const ids = new Set(parsed.map((n) => n.id));
  const nodes = sanitiseParents(parsed.map((n) => ({ ...n, related: n.related.filter((r) => ids.has(r)) })));
  const nodeById: Record<string, FnNode> = {};
  for (const n of nodes) nodeById[n.id] = n;
  const childrenOf: Record<string, string[]> = {};
  for (const n of nodes) for (const p of n.parents) (childrenOf[p] ??= []).push(n.id);
  const changes: FnChange[] = [];
  for (const c of Array.isArray(raw.changes) ? raw.changes : []) {
    const p = parseChange(c, nodeById);
    if (p && !changes.some((x) => x.id === p.id)) changes.push(p);
  }
  const pairs: FnPair[] = [];
  for (const c of Array.isArray(raw.pairs) ? raw.pairs : []) {
    const p = parsePair(c, nodeById);
    if (p && !pairs.some((x) => x.id === p.id)) pairs.push(p);
  }
  // Only lineages that hold a node are drawn.
  const usedLanes = lineages.filter((l) => nodes.some((n) => n.lineage === l.id));
  return { lineages: usedLanes, nodes, changes, pairs, nodeById, childrenOf };
}

const cache = new WeakMap<object, FnData | null>();

/** Parsed data from corpus.extras, memoised per loaded object. */
export function frameworkData(extras: Record<string, unknown>): FnData | null {
  const raw = extras['framework-navigator'];
  if (!isRecord(raw)) return null;
  if (!cache.has(raw)) cache.set(raw, parseFrameworkData(raw));
  return cache.get(raw) ?? null;
}
