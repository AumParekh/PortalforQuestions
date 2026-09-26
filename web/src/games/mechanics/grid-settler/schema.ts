// Grid Settler: the curated data contract (content/games/mechanics/grid-settler.json, loaded into
// corpus.extras['grid-settler']) and a defensive type guard. Pure; no React, no corpus imports,
// so a node script can test it against the real file. Malformed tiles are dropped; an item that
// is left without a playable grid (6–12 tiles over at least 3 cells, every index in range) is
// dropped whole. Nothing is guessed or repaired.

export const MIN_TILES = 6;
export const MAX_TILES = 12;
export const MIN_CELLS_USED = 3;
export const MIN_AXIS_VALUES = 2;
export const MAX_AXIS_VALUES = 4;

export interface GsAxis {
  label: string;
  /** 2–4 distinct category names, in the notes' order. */
  values: string[];
}

export interface GsTile {
  id: string;
  /** At most ~10 words, shown on the tile. */
  text: string;
  /** Column (x value index). */
  x: number;
  /** Row (y value index). */
  y: number;
  /** One line from the notes on why it sits in that cell. */
  why: string;
}

export interface GsGrid {
  id: string;
  readingId: string;
  sourceBlock: string;
  sourceLine: number | null;
  title: string;
  x: GsAxis;
  y: GsAxis;
  tiles: GsTile[];
  /** What becomes visible once the grid is full (one or two sentences). */
  pattern: string;
  explanation: string;
}

export interface GsData {
  grids: GsGrid[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.replace(/\s+/g, ' ').trim() : null;
}

function isIndex(x: unknown, n: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < n;
}

/** Case- and punctuation-insensitive key, for duplicate checks. */
export function textKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function parseAxis(x: unknown): GsAxis | null {
  if (!isRecord(x)) return null;
  const label = str(x.label);
  if (!label || !Array.isArray(x.values)) return null;
  const values = x.values.map(str);
  if (values.some((v) => v === null)) return null;
  const vs = values as string[];
  if (vs.length < MIN_AXIS_VALUES || vs.length > MAX_AXIS_VALUES) return null;
  if (new Set(vs.map(textKey)).size !== vs.length) return null;
  return { label, values: vs };
}

/** One tile, or null when a field is missing, mistyped or its cell is out of range. */
export function parseTile(t: unknown, nx: number, ny: number): GsTile | null {
  if (!isRecord(t)) return null;
  const id = str(t.id);
  const text = str(t.text);
  const why = str(t.why);
  if (!id || !text || !why) return null;
  if (!Array.isArray(t.cell) || t.cell.length !== 2) return null;
  const [x, y] = t.cell as unknown[];
  if (!isIndex(x, nx) || !isIndex(y, ny)) return null;
  return { id, text, x, y, why };
}

/** Distinct cells a set of tiles occupies. */
export function cellsUsed(tiles: readonly Pick<GsTile, 'x' | 'y'>[]): number {
  return new Set(tiles.map((t) => `${t.x},${t.y}`)).size;
}

/**
 * One grid, or null. `seenTileIds` carries tile ids already taken by earlier grids, so an id
 * used twice in the file (which would make the shared SRS schedule ambiguous) keeps its first use.
 */
export function parseGrid(raw: unknown, seenTileIds: Set<string> = new Set()): GsGrid | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const readingId = str(raw.reading_id);
  const sourceBlock = str(raw.source_block);
  const title = str(raw.title);
  const pattern = str(raw.pattern);
  const x = parseAxis(raw.x);
  const y = parseAxis(raw.y);
  if (!id || !readingId || !sourceBlock || !title || !pattern || !x || !y || !Array.isArray(raw.tiles)) return null;
  const tiles: GsTile[] = [];
  const ids = new Set<string>();
  const texts = new Set<string>();
  for (const t of raw.tiles) {
    const tile = parseTile(t, x.values.length, y.values.length);
    if (!tile) continue;
    const k = textKey(tile.text);
    if (ids.has(tile.id) || seenTileIds.has(tile.id) || texts.has(k) || !k) continue;
    ids.add(tile.id);
    texts.add(k);
    tiles.push(tile);
  }
  if (tiles.length < MIN_TILES || tiles.length > MAX_TILES) return null;
  if (cellsUsed(tiles) < MIN_CELLS_USED) return null;
  for (const tid of ids) seenTileIds.add(tid);
  const line = typeof raw.source_line === 'number' && Number.isFinite(raw.source_line) ? Math.round(raw.source_line) : null;
  return {
    id,
    readingId,
    sourceBlock,
    sourceLine: line,
    title,
    x,
    y,
    tiles,
    pattern,
    explanation: str(raw.explanation) ?? '',
  };
}

/** Parses the whole file. Null when it is not a grid-settler file at all. */
export function parseGridData(raw: unknown): GsData | null {
  if (!isRecord(raw)) return null;
  if (raw.mechanic !== undefined && raw.mechanic !== 'grid-settler') return null;
  if (!Array.isArray(raw.items)) return null;
  const grids: GsGrid[] = [];
  const gridIds = new Set<string>();
  const tileIds = new Set<string>();
  for (const it of raw.items) {
    const g = parseGrid(it, tileIds);
    if (!g || gridIds.has(g.id)) continue;
    gridIds.add(g.id);
    grids.push(g);
  }
  return { grids };
}

const cache = new WeakMap<object, GsData | null>();

/** Parsed data for a corpus's extras entry, parsed once per loaded file. */
export function gridData(extras: Record<string, unknown> | undefined): GsData | null {
  const raw = extras?.['grid-settler'];
  if (!isRecord(raw)) return null;
  if (!cache.has(raw)) cache.set(raw, parseGridData(raw));
  return cache.get(raw) ?? null;
}

/** The first sentence of a passage, for one-line summaries. */
export function firstSentence(s: string): string {
  const m = /^(.+?[.;])(\s+[A-Z(]|$)/.exec(s);
  return (m ? m[1] : s).trim();
}

// ---------------------------------------------------------------------------------------------
// Display text: the notes' content only

/** A reading id as the curated file cites it ("CR-6"). */
const REF = String.raw`\b[A-Z]{2,4}-\d+\b`;
const CELL_POINTER = new RegExp(String.raw`^${REF} table:.*\bcolumn,.*\brow\.?$`);
const LEAD = new RegExp(String.raw`^${REF}(?: [a-z])?(?: summary table)?(?: \(([^()]*)\))?[:.]\s+`);
const LEAD_VERB = new RegExp(String.raw`^${REF}(?: [a-z])? (grades|lays|gives|rates|links|sets|lists|puts|draws|treats|shows)\b`);
const REF_RE = new RegExp(REF);

/**
 * A curated line with the file's pointers into the notes dropped, keeping the finance. A line that is
 * only a pointer ("CR-6 table: PIT column, Horizon row.") becomes empty; a lead-in naming the reading
 * and objective ("CR-10 a: market versus credit VaR.") loses it; "ORR-1 b grades …" reads "The notes
 * grade …"; "the trapbox flags" reads "the notes flag"; a sentence still naming a reading, or about
 * how the game was built ("… is what the objective asks for", "the offered corruption"), is dropped.
 */
export function noteLine(s: string): string {
  const t = s.trim();
  if (CELL_POINTER.test(t)) return '';
  const body = t
    .replace(LEAD, (_, aside?: string) => (aside ? `${aside}: ` : ''))
    .replace(LEAD_VERB, (_, v: string) => `The notes ${v.replace(/s$/, '')}`)
    .replace(new RegExp(String.raw`\s+in the ${REF} table\b`, 'g'), '')
    .replace(/\bthe (?:trap|key|remember|example)\s?box flags\b/gi, 'the notes flag')
    .replace(/\bthe (?:trap|key|remember|example)\s?box\b/gi, 'the notes')
    .replace(new RegExp(String.raw`\bthe ${REF}\s+`, 'g'), 'the ')
    .replace(/;[^;.]*\bwhat the objective asks for\b/g, '');
  const kept = body
    .split(/(?<=[.!?])\s+(?=[A-Z“"(])/)
    .filter((sent) => sent && !REF_RE.test(sent) && !/\boffered corruption\b/.test(sent))
    .join(' ')
    .trim();
  return kept.charAt(0).toUpperCase() + kept.slice(1);
}

/** A symbol written with an underscore ("D_A", "D_L"). */
const SUBSCRIPT = /\b([A-Z])_([A-Z])\b/g;

/**
 * Curated text as a NoteText snippet: "D_A" is set as math ($D_{A}$) and the characters LaTeX would
 * read as markup ("S&P", "M&A", a dollar amount) stay literal.
 */
export function noteLatex(s: string): string {
  return s.replace(/[&$#%]/g, (c) => `\\${c}`).replace(SUBSCRIPT, (_, b: string, i: string) => `$${b}_{${i}}$`);
}

/** Plain text for an aria-label: "D_A" reads as "DA". */
export function plainText(s: string): string {
  return s.replace(SUBSCRIPT, '$1$2');
}
