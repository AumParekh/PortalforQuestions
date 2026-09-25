// Table Fill (brief §7.2): pure round building. A table from the reading appears with some cells
// lifted out; the removed cells lie loose below and the player puts each back. One round per table
// row (itemId = the row's sub-item ID), grouped into sheets: one sheet is one table on screen.
// Discovery sheets blank about one cell per row in the full table; pressure sheets blank a whole
// column across the rows in play plus a second cell per row where the row still keeps an anchor.
// Nothing is invented: every tile is a cell the notes wrote into that same table.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { Block, ItemSrs, PlayPhase, Reading, TableRow, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { toDisplay } from '../../text';
import { seededRng, shuffle } from '../../random';
import { srsPriority } from '../../srs';

/** Longest cell (display characters) that can travel as a tile. */
export const MAX_TILE_CHARS = 120;
export const MIN_PHASE_ROUNDS = 3;
export const MAX_PHASE_ROUNDS = 5;
/** A sheet needs at least this many blanks, with at least two different answers, to be a choice. */
export const MIN_SHEET_BLANKS = 3;

export interface SheetRow {
  /** Row sub-item ID; null for rows the extractor gave no ID (display only). */
  id: string | null;
  cells: string[];
  group: string | null;
  target: boolean;
}

export interface Blank {
  /** `${row}:${col}` within the sheet. */
  key: string;
  row: number;
  col: number;
  /** The cell as the notes have it (LaTeX). */
  answer: string;
  norm: string;
}

export interface Tile {
  id: string;
  text: string;
  norm: string;
}

export interface Sheet {
  key: string;
  blockId: string;
  phase: PlayPhase;
  /** Heading for the table: title, title row or section; null when none is usable. */
  heading: string | null;
  /** The notes' caption (reads the shape); shown once the sheet is filled. */
  caption: string | null;
  headers: string[];
  rows: SheetRow[];
  blanks: Blank[];
  /** The removed cells, shuffled: exactly one tile per blank. */
  tiles: Tile[];
  /** Column blanked across every row in play (pressure), else null. */
  wholeColumn: number | null;
  /** Whole-sheet time limit under pressure (ms): the sum of its rounds' limits. */
  timeLimitMs?: number;
}

export interface TableFillPayload {
  sheet: Sheet;
  /** Index into sheet.rows. */
  rowIndex: number;
  blankKeys: string[];
}

export function normCell(s: string): string {
  return toDisplay(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function str(x: unknown): string {
  return typeof x === 'string' ? x : '';
}

/** Headers for a table block: the block's, else the first row's; blank entries kept as ''. */
export function tableHeaders(b: Block): string[] {
  const own = Array.isArray(b.headers) ? b.headers.map(str) : [];
  if (own.length) return own;
  const first = (b.rows ?? []).find((r) => r && Array.isArray(r.headers) && r.headers.length);
  return first ? (first.headers ?? []).map(str) : [];
}

function validRows(b: Block): TableRow[] {
  return (Array.isArray(b.rows) ? b.rows : []).filter((r): r is TableRow => !!r && Array.isArray(r.cells));
}

/** A cell can be lifted out: its column has a header, it has letters or digits, and it's short enough to carry. */
export function isBlankable(cell: string, header: string): boolean {
  if (!header.trim()) return false;
  const d = toDisplay(cell);
  if (!d || d.length > MAX_TILE_CHARS) return false;
  if (!/[\p{L}\p{N}]/u.test(d)) return false;
  if (normCell(cell) === normCell(header)) return false;
  // A computed figure to four or more significant digits (2.0618) is working, not something to recall.
  if (isBareNumber(cell) && d.includes('.') && d.replace(/[^0-9]/g, '').replace(/^0+/, '').length >= 4) return false;
  return true;
}

/** A cell that is only a number (with sign, currency, commas, brackets or %). */
export function isBareNumber(cell: string): boolean {
  return /^[-+−–]?[$€£]?\(?[\d,]*\.?\d+\)?%?$/.test(toDisplay(cell).replace(/\s+/g, ''));
}

/** A leading list marker: "a. ", "b) ", "(ii) ", "3. ", "2a) ". */
const ENUMERATOR = /^\s*(?:\(?[ivx]{1,4}[.)]|\(?\d{1,2}[a-z]?[.)]|\(?[a-z][.)]|\([a-z]{1,2}\))\s+/i;

export function stripEnumerator(cell: string): string {
  const m = ENUMERATOR.exec(cell);
  return m && cell.length > m[0].length ? cell.slice(m[0].length) : cell;
}

/** Headers of two side-by-side lists rather than one row per thing (the pairing across a row means nothing). */
const LIST_HEADER = /\b(advantages?|disadvantages?|pros|cons|benefits?|drawbacks?|strengths?|weaknesse?s?|limitations?)\b/i;

export interface GridRow {
  /** Row sub-item ID; null when the extractor gave none (display only). */
  id: string | null;
  /** Cells padded to the table width, list markers stripped from enumerated columns. */
  cells: string[];
  group: string | null;
  /** Cell count matched the headers, so the row can be played. */
  aligned: boolean;
}

export interface EligibleRow {
  id: string;
  /** Index into the table's grid. */
  index: number;
  cells: string[];
  blankable: number[];
}

export interface EligibleTable {
  block: Block;
  objectiveId: string;
  headers: string[];
  grid: GridRow[];
  eligible: EligibleRow[];
}

function nonEmptyCount(cells: readonly string[]): number {
  return cells.filter((c) => normCell(c)).length;
}

/** Most blanks a row can take while keeping one filled cell on screen as its anchor (two at most). */
function rowCapacity(e: EligibleRow): number {
  return Math.min(2, e.blankable.length, nonEmptyCount(e.cells) - 1);
}

/**
 * Tables with at least two headed columns whose rows can each lose a cell and still keep an anchor
 * (another non-empty cell) on screen, and with room for at least three blanks in all. Rows whose
 * cell count doesn't match the headers are shown but never played. Two side-by-side lists
 * (Advantages | Disadvantages, or every column a numbered list) are left to other mechanics: the
 * pairing across a row carries nothing to recall.
 */
export function eligibleTables(reading: Reading): EligibleTable[] {
  const out: EligibleTable[] = [];
  for (const o of Array.isArray(reading.objectives) ? reading.objectives : []) {
    for (const b of Array.isArray(o?.blocks) ? o.blocks : []) {
      if (!b || b.type !== 'table' || typeof b.id !== 'string') continue;
      const rawHeaders = tableHeaders(b);
      const headed = rawHeaders.map((h, i) => (h.trim() ? i : -1)).filter((i) => i >= 0);
      if (rawHeaders.length < 2 || headed.length < 2) continue;
      if (headed.every((i) => LIST_HEADER.test(toDisplay(rawHeaders[i])))) continue;
      const rows = validRows(b);
      const width = Math.max(rawHeaders.length, ...rows.map((r) => r.cells.length));
      const headers = [...rawHeaders, ...new Array<string>(width - rawHeaders.length).fill('')];
      const grid: GridRow[] = rows.map((r) => {
        const cells = r.cells.map(str);
        return {
          id: typeof r.id === 'string' && r.id ? r.id : null,
          cells: [...cells, ...new Array<string>(width - cells.length).fill('')],
          group: str((r as TableRow & { group?: unknown }).group).trim() || null,
          aligned: cells.length === rawHeaders.length,
        };
      });
      // Columns that are numbered lists lose their markers, or the numbers would give the rows away.
      const enumerated = headers.map((_, c) => {
        const col = grid.filter((g) => g.aligned && normCell(g.cells[c])).map((g) => g.cells[c]);
        return col.length >= 2 && col.filter((x) => ENUMERATOR.test(x)).length * 2 >= col.length;
      });
      if (headed.every((c) => enumerated[c])) continue;
      for (const g of grid) g.cells = g.cells.map((x, c) => (enumerated[c] ? stripEnumerator(x) : x));
      const eligible: EligibleRow[] = [];
      grid.forEach((g, index) => {
        if (!g.id || !g.aligned || nonEmptyCount(g.cells) < 2) return;
        const blankable = g.cells.map((x, c) => (isBlankable(x, headers[c]) ? c : -1)).filter((c) => c >= 0);
        if (blankable.length) eligible.push({ id: g.id, index, cells: g.cells, blankable });
      });
      if (eligible.reduce((n, e) => n + rowCapacity(e), 0) < MIN_SHEET_BLANKS) continue;
      out.push({ block: b, objectiveId: o.id, headers, grid, eligible });
    }
  }
  return out;
}

export interface BuildCtx {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
  priorityCategory?: TrapCategory | null;
}

/** Choice of blanks for a sheet's target rows. Returns row index → columns. */
function chooseBlanks(
  targets: readonly EligibleRow[],
  phase: PlayPhase,
  rng: () => number,
): { byRow: Map<number, number[]>; wholeColumn: number | null } {
  const byRow = new Map<number, number[]>();
  // Keeps at least one non-empty cell on screen in the row.
  const keepsAnchor = (e: EligibleRow, cols: readonly number[]) =>
    e.cells.some((c, i) => !cols.includes(i) && normCell(c) !== '');
  const add = (e: EligibleRow, col: number) => {
    const cur = byRow.get(e.index) ?? [];
    if (cur.includes(col) || !e.blankable.includes(col) || !keepsAnchor(e, [...cur, col])) return false;
    byRow.set(e.index, [...cur, col].sort((a, b) => a - b));
    return true;
  };
  let wholeColumn: number | null = null;
  if (phase === 'pressure' && targets.length >= 2) {
    // The column blankable in the most rows in play; the row-label column only as a last resort.
    const counts = new Map<number, number>();
    for (const e of targets) for (const c of e.blankable) counts.set(c, (counts.get(c) ?? 0) + 1);
    const cols = shuffle([...counts.keys()], rng).sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || Number(a === 0) - Number(b === 0),
    );
    const best = cols[0];
    if (best !== undefined && (counts.get(best) ?? 0) >= 2) {
      wholeColumn = best;
      for (const e of targets) add(e, best);
    }
  }
  // One blank in every target row, preferring columns other than the row label.
  for (const e of targets) {
    if (byRow.get(e.index)?.length) continue;
    const rank = (c: number) => Number(c === 0) + Number(isBareNumber(e.cells[c]));
    const pref = shuffle(e.blankable, rng).sort((a, b) => rank(a) - rank(b));
    for (const c of pref) if (add(e, c)) break;
  }
  // Pressure: a second cell per row. Discovery: top up only to reach the minimum.
  const total = () => [...byRow.values()].reduce((n, xs) => n + xs.length, 0);
  for (const e of shuffle(targets, rng)) {
    if (phase === 'discovery' && total() >= MIN_SHEET_BLANKS) break;
    if ((byRow.get(e.index)?.length ?? 0) >= 2) continue;
    for (const c of shuffle(e.blankable, rng)) if (add(e, c)) break;
  }
  return { byRow, wholeColumn };
}

const GENERIC_HEADING = /^(summary|table|comparison|overview)\.?$/i;

function headingOf(b: Block): string | null {
  const titleRow = str((b as unknown as { title_row?: unknown }).title_row);
  for (const h of [str(b.title), titleRow, str(b.section)]) {
    const d = h.trim();
    if (d && !GENERIC_HEADING.test(toDisplay(d))) return d;
  }
  return null;
}

function captionOf(b: Block): string | null {
  const c = str(b.caption_latex) || str(b.caption);
  return c.trim() ? c : null;
}

/** Comfortable fill time for a row's blanks (ms). */
export function rowTimeMs(answers: readonly string[], pressureStep: number | null): number {
  const base = 3000 + answers.reduce((n, a) => n + 3500 + Math.min(MAX_TILE_CHARS, toDisplay(a).length) * 30, 0);
  if (pressureStep === null) return Math.round(base * 1.5);
  return Math.round(base * Math.pow(0.92, pressureStep));
}

interface SheetDraft {
  table: EligibleTable;
  targets: EligibleRow[];
}

/**
 * Assembles a sheet: which rows are on screen, which cells are lifted out, and the loose tiles.
 * Null when it can't offer a real choice (fewer than three blanks or a single distinct answer).
 */
export function assembleSheet(draft: SheetDraft, phase: PlayPhase, key: string, rng: () => number): Sheet | null {
  const { table: t, targets } = draft;
  const { byRow, wholeColumn } = chooseBlanks(targets, phase, rng);
  const targetIdx = new Set(targets.filter((e) => byRow.get(e.index)?.length).map((e) => e.index));
  if (targetIdx.size === 0) return null;
  // Discovery shows the whole table for context; pressure shows only the rows in play.
  const shown = t.grid.map((g, i) => ({ g, i })).filter(({ i }) => phase === 'discovery' || targetIdx.has(i));
  const rows: SheetRow[] = [];
  const blanks: Blank[] = [];
  for (const { g, i } of shown) {
    const row = rows.length;
    for (const col of targetIdx.has(i) ? (byRow.get(i) ?? []) : []) {
      blanks.push({ key: `${row}:${col}`, row, col, answer: g.cells[col], norm: normCell(g.cells[col]) });
    }
    rows.push({ id: g.id, cells: [...g.cells], group: g.group, target: targetIdx.has(i) });
  }
  if (blanks.length < MIN_SHEET_BLANKS || new Set(blanks.map((b) => b.norm)).size < 2) return null;
  if (ambiguous(rows, blanks)) return null;
  const tiles = shuffle(
    blanks.map((b, n) => ({ id: `${key}~${n}`, text: b.answer, norm: b.norm })),
    rng,
  );
  return {
    key,
    blockId: t.block.id,
    phase,
    heading: headingOf(t.block),
    caption: captionOf(t.block),
    headers: [...t.headers],
    rows,
    blanks,
    tiles,
    wholeColumn,
  };
}

/**
 * True when two blanks in one column hold different cells but their rows look the same once the
 * blanks are out (e.g. "[ ] | Lower is better" twice): nothing on screen could tell them apart.
 */
export function ambiguous(rows: readonly SheetRow[], blanks: readonly Blank[]): boolean {
  const signature = (row: number) => {
    const cols = new Set(blanks.filter((b) => b.row === row).map((b) => b.col));
    return rows[row].cells.map((c, i) => (cols.has(i) ? '\u0000' : normCell(c))).join('\u0001');
  };
  for (let i = 0; i < blanks.length; i++) {
    for (let j = i + 1; j < blanks.length; j++) {
      const a = blanks[i];
      const b = blanks[j];
      if (a.col === b.col && a.row !== b.row && a.norm !== b.norm && signature(a.row) === signature(b.row)) return true;
    }
  }
  return false;
}

/** Rows of a table ordered for play: due first, then unseen, then the rest (random within a tier). */
function orderRows(rows: readonly EligibleRow[], ctx: BuildCtx): EligibleRow[] {
  return shuffle(rows, ctx.rng)
    .map((e, n) => ({ e, n, p: srsPriority(ctx.srs[e.id], ctx.today) }))
    .sort((a, b) => a.p - b.p || a.n - b.n)
    .map((x) => x.e);
}

function phaseRounds(sheets: readonly Sheet[], phase: PlayPhase, ctx: BuildCtx): MechanicRound<TableFillPayload>[] {
  const rounds: MechanicRound<TableFillPayload>[] = [];
  sheets.forEach((sheet, step) => {
    let sheetMs = 0;
    const own: MechanicRound<TableFillPayload>[] = [];
    sheet.rows.forEach((row, rowIndex) => {
      const blanks = sheet.blanks.filter((b) => b.row === rowIndex);
      if (!row.target || !row.id || blanks.length === 0) return;
      const answers = blanks.map((b) => b.answer);
      const limit = phase === 'pressure' ? rowTimeMs(answers, step) : undefined;
      sheetMs += limit ?? 0;
      own.push({
        id: `${row.id}#${phase}`,
        phase,
        itemId: row.id,
        blockId: sheet.blockId,
        objectiveId: ctx.corpus.objectiveOfBlock[sheet.blockId],
        timeLimitMs: limit,
        targetMs: limit ?? rowTimeMs(answers, 0),
        payload: { sheet, rowIndex, blankKeys: blanks.map((b) => b.key) },
      });
    });
    if (phase === 'pressure') sheet.timeLimitMs = sheetMs;
    rounds.push(...own);
  });
  return rounds;
}

/**
 * Fills one phase with sheets: tables in `order`, each contributing its best rows until `want`
 * rounds are placed. A table whose sheet can't offer a real choice is skipped.
 */
function fillPhase(
  order: readonly EligibleTable[],
  used: ReadonlySet<string>,
  want: number,
  phase: PlayPhase,
  ctx: BuildCtx,
): { sheets: Sheet[]; rowIds: Set<string> } {
  const sheets: Sheet[] = [];
  const rowIds = new Set<string>();
  let left = want;
  const cap = () => MAX_PHASE_ROUNDS - (want - left);
  for (const t of order) {
    if (left <= 0) break;
    const free = orderRows(t.eligible.filter((e) => !used.has(e.id)), ctx);
    if (free.length === 0) continue;
    // Take the rows still wanted; if that can't make a real choice, take a few more (up to the phase cap).
    let sheet: Sheet | null = null;
    for (let take = Math.min(left, free.length); !sheet && take <= Math.min(free.length, cap()); take++) {
      sheet = assembleSheet({ table: t, targets: free.slice(0, take) }, phase, `${phase}.${sheets.length}.${t.block.id}`, ctx.rng);
    }
    if (!sheet) continue;
    const n = sheet.rows.filter((r) => r.target).length;
    sheets.push(sheet);
    for (const r of sheet.rows) if (r.target && r.id) rowIds.add(r.id);
    left -= n;
  }
  return { sheets, rowIds };
}

/** Most urgent row first (due, then unseen); within a tier, tables of words before tables of figures. */
function tablePriority(t: EligibleTable, ctx: BuildCtx): number {
  const urgent = Math.min(...t.eligible.map((e) => srsPriority(ctx.srs[e.id], ctx.today)));
  const cells = t.eligible.flatMap((e) => e.blankable.map((c) => e.cells[c]));
  const numeric = cells.filter(isBareNumber).length * 2 > cells.length;
  return urgent * 2 + Number(numeric);
}

/** Tables ordered for play: the one holding the most urgent row first; random among equals. */
function orderTables(tables: readonly EligibleTable[], ctx: BuildCtx): EligibleTable[] {
  return shuffle(tables, ctx.rng)
    .map((t, n) => ({ t, n, p: tablePriority(t, ctx) }))
    .sort((a, b) => a.p - b.p || a.n - b.n)
    .map((x) => x.t);
}

function countRounds(sheets: readonly Sheet[]): number {
  return sheets.reduce((n, s) => n + s.rows.filter((r) => r.target).length, 0);
}

/** Up to this many draws of tables, rows and blanks before a reading is judged unplayable. */
const ATTEMPTS = 4;

export function buildTableFill(reading: Reading, ctx: BuildCtx): MechanicPlan<TableFillPayload> | null {
  const tables = eligibleTables(reading);
  for (let n = 0; n < ATTEMPTS; n++) {
    const plan = attempt(reading, tables, ctx);
    if (plan) return plan;
  }
  return null;
}

function attempt(reading: Reading, tables: readonly EligibleTable[], ctx: BuildCtx): MechanicPlan<TableFillPayload> | null {
  if (tables.length === 0) return null;
  const total = tables.reduce((n, t) => n + t.eligible.length, 0);
  if (total < 2 * MIN_PHASE_ROUNDS) return null;
  const wantDisc = Math.min(MAX_PHASE_ROUNDS, Math.max(MIN_PHASE_ROUNDS, Math.min(4, Math.floor(total / 2))));
  const order = orderTables(tables, ctx);

  const disc = fillPhase(order, new Set(), wantDisc, 'discovery', ctx);
  if (countRounds(disc.sheets) < MIN_PHASE_ROUNDS) return null;
  const wantPress = total - countRounds(disc.sheets) >= 4 ? 4 : MIN_PHASE_ROUNDS;
  // Pressure prefers tables discovery didn't show (discovery displayed every row of its tables).
  const usedTables = new Set(disc.sheets.map((s) => s.blockId));
  const pressOrder = [...order.filter((t) => !usedTables.has(t.block.id)), ...order.filter((t) => usedTables.has(t.block.id))];
  const press = fillPhase(pressOrder, disc.rowIds, wantPress, 'pressure', ctx);
  if (countRounds(press.sheets) < MIN_PHASE_ROUNDS) return null;

  const rounds = [...phaseRounds(disc.sheets, 'discovery', ctx), ...phaseRounds(press.sheets, 'pressure', ctx)];
  const nd = rounds.filter((r) => r.phase === 'discovery').length;
  const np = rounds.length - nd;
  if (nd < MIN_PHASE_ROUNDS || np < MIN_PHASE_ROUNDS || nd > MAX_PHASE_ROUNDS || np > MAX_PHASE_ROUNDS) return null;

  const first = disc.sheets[0];
  const concept = namingFor(ctx.corpus, reading, first.blockId);
  const nTables = new Set([...disc.sheets, ...press.sheets].map((s) => s.blockId)).size;
  return {
    rounds,
    target: concept.term,
    opening: `${reading.reading_id} · Table Fill. ${nTables === 1 ? 'A table' : `${nTables} tables`} from this reading, with cells lifted out and laid loose underneath. The headers and the cells left standing are your only clues: put every loose cell back where the notes have it. Later, whole columns go.`,
    concept,
  };
}

const supportCache = new WeakMap<Reading, boolean>();

/** Deterministic feasibility check across a few seeds: honest about a full arc. Cached per reading. */
export function supportsTableFill(reading: Reading, corpus: Corpus): boolean {
  const hit = supportCache.get(reading);
  if (hit !== undefined) return hit;
  const ok = checkSupport(reading, corpus);
  supportCache.set(reading, ok);
  return ok;
}

function checkSupport(reading: Reading, corpus: Corpus): boolean {
  const tables = eligibleTables(reading);
  if (tables.reduce((n, t) => n + t.eligible.length, 0) < 2 * MIN_PHASE_ROUNDS) return false;
  for (const seed of [1, 7, 42, 1234, 99991]) {
    const plan = buildTableFill(reading, { corpus, srs: {}, today: '2000-01-01', rng: seededRng(seed) });
    if (!plan) return false;
  }
  return true;
}

/** Just-in-time naming for a table: its heading, and the caption as the one line. */
export function namingFor(corpus: Corpus, reading: Reading, blockId: string): ConceptNaming {
  const b = corpus.blockById[blockId];
  const heading = b ? headingOf(b) : null;
  const headers = b ? tableHeaders(b).map((h) => toDisplay(h)).filter(Boolean) : [];
  const term = heading ? toDisplay(heading).replace(/^summary:\s*/i, '').replace(/[.:;]+$/, '') : headers.join(' · ') || `Table in ${reading.reading_id}`;
  const caption = b ? captionOf(b) : null;
  const los = learningObjectives(reading);
  const objectiveId = corpus.objectiveOfBlock[blockId] ?? los[los.length - 1]?.id ?? reading.reading_id;
  const line = caption
    ? toDisplay(caption)
    : headers.length
      ? `The table in ${reading.reading_id} that lines up ${headers.join(', ')} row by row.`
      : `A table from ${reading.reading_id}.`;
  return { term: term.charAt(0).toUpperCase() + term.slice(1), blockId, objectiveId, line };
}

/** Names the table the player missed most in discovery, else the first one they filled. */
export function nameAfterDiscovery(
  corpus: Corpus,
  reading: Reading,
  plan: MechanicPlan<TableFillPayload>,
  discovery: readonly RoundResult[],
): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const misses = new Map<string, number>();
  for (const d of discovery) {
    const r = byId.get(d.roundId);
    if (r && !d.correct) misses.set(r.blockId, (misses.get(r.blockId) ?? 0) + 1);
  }
  const worst = [...misses.entries()].sort((a, b) => b[1] - a[1])[0];
  return worst ? namingFor(corpus, reading, worst[0]) : plan.concept;
}

/**
 * Grade for a finished row: undefined lets the shell grade a clean row by speed; a row with some
 * cells right and some wrong is a partial lapse (2); all wrong is 1; time running out is 0.
 */
export function rowGrade(right: number, wrong: number, timedOut: boolean): number | undefined {
  if (timedOut) return 0;
  if (wrong === 0) return undefined;
  return right > 0 ? 2 : 1;
}
