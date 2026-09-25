// Bucket Drop (brief §7.2): pure round building. Items are dealt onto a board; the player drops
// each into the bucket the notes file it under. Buckets come only from classification schemes
// the reading itself draws:
//   table-columns  a comparison table's column headers (GEV | POT, Advantages | Disadvantages);
//                  each cell is an item, its row label (if any) rides along as context.
//   table-rows     a table whose first column names things (Approach: Age-weighted, …); the
//                  first-column values are the buckets and the other cells are the items.
//   headings       bullets that sit under different section headings (or box titles / list
//                  lead-ins) within one objective.
//   labels         a list whose bullets each open with a bold / \term label ("Substandard.",
//                  "Doubtful.", …); the labels are the buckets, the rest of each bullet the item.
//   nested         a list whose top-level bullets head their own sub-lists.
// Nothing is invented: every item is a cell or bullet from the notes, and every bucket shown
// (including the ones no item belongs in) is a real category of the same scheme.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { Block, ItemSrs, Reading, SubItem, SubItemLike, TableRow, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound } from '../../arc/plugin';
import { normWord, toDisplay } from '../../text';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';

export type SchemeKind = 'table-columns' | 'table-rows' | 'headings' | 'labels' | 'nested';

export interface Bucket {
  id: string;
  /** Label as written in the notes (LaTeX-ish; rendered with NoteText). */
  label: string;
}

export interface SchemeItem {
  /** Stable extracted-item ID: a table row ID or a bullet ID. */
  itemId: string;
  blockId: string;
  objectiveId?: string;
  /** The item as written (LaTeX-ish). The bucket's own name is blanked out if it appears. */
  text: string;
  /** Other axis of a table (row label or column header), shown on the card. */
  context?: string;
  bucketId: string;
}

export interface Scheme {
  key: string;
  kind: SchemeKind;
  /** Block the scheme is named from (the table, the list, or the first heading's block). */
  blockId: string;
  objectiveId?: string;
  /** Neutral one-line instruction for the board (no concept names). */
  prompt: string;
  /** Concept name for the just-in-time naming step. */
  name: string;
  /** One line on what the scheme does in the reading. */
  line: string;
  buckets: Bucket[];
  items: SchemeItem[];
}

export interface BoardSpec {
  key: string;
  kind: SchemeKind;
  prompt: string;
  buckets: Bucket[];
}

export interface BucketPayload {
  board: BoardSpec;
  text: string;
  context?: string;
  bucketId: string;
}

export const MIN_BOARD_ITEMS = 3;
export const MAX_BOARD_ITEMS = 5;
export const MAX_BUCKETS = 4;
export const MIN_TOTAL = MIN_BOARD_ITEMS * 2;

const MAX_ITEM_WORDS = 48;
const MAX_LABEL_WORDS = 10;
const GENERIC_FIRST_HEADER = /^(features?|aspects?|dimensions?|criteri(on|a)|characteristics?|attributes?|propert(y|ies)|items?|basis|points?|factors?|comparison|issues?|elements?|questions?|topics?|areas?|dimension)$/i;
const GENERIC_TITLE = /learning objective|objectives (in|for) this reading|trap|consolidated|summary|label collision|ordering note|stale wording|numbering warning|correction/i;

// ---------------------------------------------------------------------------------------------
// Text helpers

function plain(s: string | null | undefined): string {
  if (!s || typeof s !== 'string') return '';
  return toDisplay(s).replace(/\s+/g, ' ').trim();
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function letterWords(s: string): number {
  return s.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w.replace(/\$[^$]*\$/g, ''))).length;
}

function normKey(s: string): string {
  return plain(s)
    .split(/\s+/)
    .map(normWord)
    .filter(Boolean)
    .join(' ');
}

/** Leading list enumerators the notes put inside cells and headings: "a.", "1)", "(ii)". */
function stripEnumerator(s: string): string {
  return s.replace(/^\s*(?:\(?(?:[a-z]|\d{1,2}|[ivx]{1,4})[.)]\s+)/i, '').trim();
}

/** Rejoins words a table line break split at a hyphen ("Volatility- weighted"); keeps "short- and long-term". */
export function tidy(s: string): string {
  return s.replace(/(\p{L})- (?!(?:and|or|to|vs)\b)(\p{Ll})/gu, '$1-$2');
}

function cleanLabel(s: string): string {
  return tidy(stripEnumerator(s))
    .replace(/[\s.:;,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A usable bucket label: some letters, not a sentence. */
function okLabel(label: string): boolean {
  const p = plain(label);
  // "model price = market price" is a mis-parsed first row, not a category.
  return p.length >= 2 && /\p{L}/u.test(p) && !/[=<>≤≥]/.test(p) && wordCount(p) <= MAX_LABEL_WORDS && p.length <= 90;
}

/** A usable item: a phrase with content words, short enough to read on a card. */
function okItem(text: string): boolean {
  const p = plain(text);
  return letterWords(p) >= 2 && wordCount(p) <= MAX_ITEM_WORDS && p.length >= 8;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Blanks the bucket's own name out of an item, so a card can't be sorted by string matching.
 * Only distinctive names are blanked (several words, or one long word) and only whole words.
 */
export function maskLabel(text: string, label: string): string {
  const p = plain(label);
  if (/[$\\]/.test(label) || !p) return text;
  const words = p.split(/\s+/);
  if (words.length === 1 && p.length < 7) return text;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p)}(?=$|[^\\p{L}\\p{N}])`, 'giu');
  return text.replace(re, '$1____');
}

// ---------------------------------------------------------------------------------------------
// Scheme extraction

function objectiveOf(corpus: Corpus, blockId: string): string | undefined {
  return corpus.objectiveOfBlock[blockId];
}

function bulletObjects(list: SubItemLike[] | undefined): SubItem[] {
  return (Array.isArray(list) ? list : []).filter(
    (x): x is SubItem => !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.text === 'string',
  );
}

function depthOf(x: SubItem): number {
  const d = (x as { depth?: unknown }).depth;
  return typeof d === 'number' ? d : 1;
}

/**
 * Drops items whose text appears under more than one bucket (they'd have no single right answer)
 * and duplicates, judged on the text as written; then blanks each bucket's own name out of its
 * items and drops any card the blank leaves too thin to sort ("No ____").
 */
function finaliseItems(items: SchemeItem[], buckets: readonly Bucket[]): SchemeItem[] {
  const labelOf = new Map(buckets.map((x) => [x.id, x.label]));
  const owners = new Map<string, Set<string>>();
  for (const it of items) {
    const k = normKey(it.text);
    if (!owners.has(k)) owners.set(k, new Set());
    owners.get(k)!.add(it.bucketId);
  }
  const seen = new Set<string>();
  const out: SchemeItem[] = [];
  for (const it of items) {
    const k = normKey(it.text);
    if (!k || (owners.get(k)?.size ?? 0) > 1) continue;
    const dup = `${it.bucketId}|${k}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    const label = labelOf.get(it.bucketId);
    const text = label ? maskLabel(it.text, label) : it.text;
    if (text !== it.text && !okItem(text.replace(/_{4}/g, ' '))) continue;
    out.push(text === it.text ? it : { ...it, text });
  }
  return out;
}

/** Lower-cases a heading for use mid-sentence, leaving acronyms ("ALM", "LGC") as written. */
function lowerNoun(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (/\p{Lu}.*\p{Lu}/u.test(w) ? w : w.toLowerCase()))
    .join(' ');
}

/** A scheme needs at least two buckets holding items and enough distinct items for one board. */
function viable(s: Scheme): boolean {
  const used = new Set(s.items.map((i) => i.bucketId));
  return s.buckets.length >= 2 && used.size >= 2 && new Set(s.items.map((i) => i.itemId)).size >= MIN_BOARD_ITEMS;
}

function tableCells(row: TableRow): string[] {
  return Array.isArray(row?.cells) ? row.cells.map((c) => (typeof c === 'string' ? c.trim() : '')) : [];
}

function listLabels(labels: string[]): string {
  const ls = labels.map(plain);
  if (ls.length <= 2) return ls.join(' and ');
  return `${ls.slice(0, -1).join(', ')} and ${ls[ls.length - 1]}`;
}

export function tableSchemes(corpus: Corpus, b: Block): Scheme[] {
  const rows = (Array.isArray(b.rows) ? b.rows : []).filter((r) => r && typeof r.id === 'string' && tableCells(r).length > 0);
  const headers = (Array.isArray(b.headers) ? b.headers : []).map((h) => (typeof h === 'string' ? h.trim() : ''));
  if (rows.length < 2 || headers.length < 2) return [];
  const ncol = headers.length;
  const objectiveId = objectiveOf(corpus, b.id);
  const firstCol = rows.map((r) => cleanLabel(tableCells(r)[0] ?? ''));
  const firstPlain = firstCol.map(plain).filter(Boolean);
  const avgFirst = firstPlain.reduce((n, x) => n + wordCount(x), 0) / Math.max(1, firstPlain.length);
  const firstDistinct = new Set(firstPlain.map((x) => x.toLowerCase())).size === firstPlain.length;
  const firstIsLabel =
    !headers[0] || (firstPlain.length === rows.length && firstDistinct && avgFirst <= 6 && firstCol.every(okLabel));
  const where = b.title ? stripEnumerator(plain(b.title)) || null : b.section ? stripEnumerator(plain(b.section)) || null : null;
  const caption = b.caption ? plain(b.caption) : '';

  const asColumns = !headers[0] || !firstIsLabel || GENERIC_FIRST_HEADER.test(plain(headers[0]));
  if (asColumns) {
    // A column is a bucket only if most of its cells are readable phrases: a column of numbers,
    // symbols or yes/no marks would sit on the board as a bucket no card can go in, and a spare
    // like "EUR Spot" beside a card reading "EUR spot" invites the wrong drop.
    const cols: number[] = [];
    const perCol = new Map<number, { raw: string; row: TableRow }[]>();
    for (let c = firstIsLabel ? 1 : 0; c < ncol; c++) {
      if (!headers[c] || !okLabel(cleanLabel(headers[c]))) continue;
      const filled = rows.filter((r) => plain(tableCells(r)[c] ?? '')).length;
      const good = rows
        .map((row) => ({ raw: tidy(stripEnumerator(tableCells(row)[c] ?? '')), row }))
        .filter((x) => x.raw && okItem(x.raw));
      if (good.length === 0 || good.length * 2 < filled) continue;
      cols.push(c);
      perCol.set(c, good);
    }
    const labels = cols.map((c) => cleanLabel(headers[c]));
    if (cols.length < 2 || new Set(labels.map((l) => normKey(l))).size !== labels.length) return [];
    const buckets: Bucket[] = cols.map((c) => ({ id: `${b.id}#col${c}`, label: cleanLabel(headers[c]) }));
    const items: SchemeItem[] = [];
    cols.forEach((c, k) => {
      for (const { raw, row } of perCol.get(c) ?? []) {
        const rowLabel = firstIsLabel ? cleanLabel(tableCells(row)[0] ?? '') : '';
        items.push({
          itemId: row.id as string,
          blockId: b.id,
          objectiveId,
          text: raw,
          context: rowLabel && okLabel(rowLabel) ? rowLabel : undefined,
          bucketId: buckets[k].id,
        });
      }
    });
    const firstHead = headers[0] ? lowerNoun(plain(headers[0])) : '';
    const s: Scheme = {
      key: `${b.id}#columns`,
      kind: 'table-columns',
      blockId: b.id,
      objectiveId,
      prompt: firstIsLabel && firstHead ? `Each card is one cell of a table, tagged with its ${firstHead}. Which column is it from?` : 'Each card is one cell of a table. Which column is it from?',
      name: where ?? listLabels(labels),
      line: caption && wordCount(caption) <= 45 ? caption : `The table sets ${listLabels(labels)} side by side${where ? `, under ${where}` : ''}.`,
      buckets,
      items: finaliseItems(items, buckets),
    };
    return viable(s) ? [s] : [];
  }

  // Rows: the first-column values are the buckets.
  const buckets: Bucket[] = [];
  const items: SchemeItem[] = [];
  rows.forEach((r) => {
    const cells = tableCells(r);
    const label = cleanLabel(cells[0] ?? '');
    if (!okLabel(label)) return;
    const bucket = { id: `${r.id}#row`, label };
    buckets.push(bucket);
    for (let c = 1; c < cells.length; c++) {
      const raw = tidy(stripEnumerator(cells[c] ?? ''));
      if (!raw || !okItem(raw)) continue;
      const head = headers[c] ? cleanLabel(headers[c]) : '';
      items.push({
        itemId: r.id as string,
        blockId: b.id,
        objectiveId,
        text: raw,
        context: head && okLabel(head) ? head : undefined,
        bucketId: bucket.id,
      });
    }
  });
  const kind = plain(headers[0]);
  const s: Scheme = {
    key: `${b.id}#rows`,
    kind: 'table-rows',
    blockId: b.id,
    objectiveId,
    prompt: `Each card is one cell of a table, tagged with its column. Which row is it from? The rows are named in the “${kind}” column.`,
    name: where ?? kind,
    line: caption && wordCount(caption) <= 45 ? caption : `The table takes each ${lowerNoun(kind)} in turn: ${listLabels(buckets.map((x) => x.label))}.`,
    buckets,
    items: finaliseItems(items, buckets),
  };
  return viable(s) ? [s] : [];
}

/** The balanced {...} argument starting at `open` (index of "{"); null if unbalanced. */
function braceArg(s: string, open: number): { arg: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return { arg: s.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

const LABEL_BLOCKS = new Set(['keybox', 'defbox', 'prose_para', 'notebox', 'gapbox']);

/** Bullets that each open with a \term{…} / \textbf{…} label; the label is the bucket. */
export function labelScheme(corpus: Corpus, b: Block): Scheme | null {
  if (!LABEL_BLOCKS.has(b.type) || (b.title && GENERIC_TITLE.test(b.title))) return null;
  const bullets = bulletObjects(b.bullets);
  if (bullets.length < 3 || bullets.some((x) => depthOf(x) !== 1)) return null;
  const body = typeof b.body_latex === 'string' ? b.body_latex : '';
  const segs = body.split(/\\item\b/).slice(1);
  if (segs.length !== bullets.length) return null;
  const objectiveId = objectiveOf(corpus, b.id);
  const buckets: Bucket[] = [];
  const items: SchemeItem[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i].replace(/^\s*\[[^\]]*\]/, '');
    const m = /^\s*\\(?:term|textbf)\s*\{/.exec(seg);
    if (!m) return null;
    const arg = braceArg(seg, m[0].length - 1);
    if (!arg) return null;
    const label = cleanLabel(arg.arg);
    if (!okLabel(label)) return null;
    const bullet = bullets[i];
    const labelPlain = plain(label);
    let desc = (bullet.text ?? '').trim();
    if (desc.toLowerCase().startsWith(labelPlain.toLowerCase())) desc = desc.slice(labelPlain.length);
    else {
      const rest = seg
        .slice(arg.end)
        .replace(/\\end\{(?:itemize|enumerate|description)\}[\s\S]*$/, '')
        .replace(/\\begin\{[^}]*\}(?:\[[^\]]*\])?/g, ' ');
      desc = plain(rest);
    }
    desc = tidy(desc.replace(/^[\s.:;,—–-]+/, '').trim());
    if (desc) desc = desc[0].toUpperCase() + desc.slice(1);
    const bucket = { id: `${bullet.id}#label`, label };
    buckets.push(bucket);
    if (desc && okItem(desc)) items.push({ itemId: bullet.id as string, blockId: b.id, objectiveId, text: desc, bucketId: bucket.id });
  }
  if (new Set(buckets.map((x) => normKey(x.label))).size !== buckets.length) return null;
  const lead = typeof (b as { lead_in?: unknown }).lead_in === 'string' ? plain((b as { lead_in?: string }).lead_in) : '';
  const heading = b.title ? plain(b.title) : lead && wordCount(lead) <= 14 ? lead.replace(/[:.]$/, '') : b.section ? plain(b.section) : null;
  const s: Scheme = {
    key: `${b.id}#labels`,
    kind: 'labels',
    blockId: b.id,
    objectiveId,
    prompt: 'Each card is the rest of a point the notes open with a bold name. Which name does it follow?',
    name: heading ?? listLabels(buckets.map((x) => x.label)),
    line: `The notes list ${buckets.length} by name: ${listLabels(buckets.map((x) => x.label))}.`,
    buckets,
    items: finaliseItems(items, buckets),
  };
  return viable(s) ? s : null;
}

/** Top-level bullets that head their own sub-lists. */
export function nestedScheme(corpus: Corpus, b: Block): Scheme | null {
  if (b.type === 'trapbox' || (b.title && GENERIC_TITLE.test(b.title))) return null;
  const bullets = bulletObjects(b.bullets);
  const objectiveId = objectiveOf(corpus, b.id);
  const buckets: Bucket[] = [];
  const items: SchemeItem[] = [];
  let parent: Bucket | null = null;
  for (const x of bullets) {
    const d = depthOf(x);
    if (d === 1) {
      const label = cleanLabel(x.text ?? '');
      parent = okLabel(label) ? { id: `${x.id}#parent`, label } : null;
    } else if (d === 2 && parent) {
      if (!buckets.includes(parent)) buckets.push(parent);
      const text = tidy(stripEnumerator(x.text ?? ''));
      if (okItem(text)) items.push({ itemId: x.id as string, blockId: b.id, objectiveId, text, bucketId: parent.id });
    }
  }
  if (buckets.length < 2) return null;
  const s: Scheme = {
    key: `${b.id}#nested`,
    kind: 'nested',
    blockId: b.id,
    objectiveId,
    prompt: 'Each card is a sub-point. Which point does it sit under?',
    name: b.title ? plain(b.title) : listLabels(buckets.map((x) => x.label)),
    line: `The notes break ${listLabels(buckets.map((x) => x.label))} into their own sub-points.`,
    buckets,
    items: finaliseItems(items, buckets),
  };
  return viable(s) ? s : null;
}

/** The headings themselves when they fit on a title line; else the objective they serve. */
function headingsName(buckets: readonly Bucket[], objectiveText: string | null | undefined): string {
  const labels = listLabels(buckets.map((x) => x.label));
  if (buckets.length <= 4 && labels.length <= 110) return labels;
  const lo = plain(objectiveText);
  if (lo && wordCount(lo) <= 25) return lo.replace(/[.;:]+$/, '');
  return `${listLabels(buckets.slice(0, 3).map((x) => x.label))}, and more`;
}

const HEADING_BLOCKS = new Set(['keybox', 'defbox', 'prose_para', 'notebox', 'gapbox']);

/** Bullets under different headings (sections, else box titles / list lead-ins) within one objective. */
export function headingScheme(reading: Reading, objectiveIdx: number): Scheme | null {
  const o = reading.objectives[objectiveIdx];
  if (!o) return null;
  const blocks = o.blocks.filter(
    (b) => b && HEADING_BLOCKS.has(b.type) && !(b.title && GENERIC_TITLE.test(b.title)) && bulletObjects(b.bullets).length > 0,
  );
  if (blocks.length < 2) return null;
  const section = (b: Block) => (b.section ? cleanLabel(b.section) : '');
  const own = (b: Block) => {
    const lead = (b as { lead_in?: unknown }).lead_in;
    const raw = b.title ?? (typeof lead === 'string' ? lead : '');
    return raw ? cleanLabel(raw) : '';
  };
  const distinct = (f: (b: Block) => string) => new Set(blocks.map(f).filter((l) => l && okLabel(l)).map(normKey)).size;
  const headingOf = distinct(section) >= 2 ? section : distinct(own) >= 2 ? own : null;
  if (!headingOf) return null;
  const buckets: Bucket[] = [];
  const byKey = new Map<string, Bucket>();
  const items: SchemeItem[] = [];
  for (const b of blocks) {
    const label = headingOf(b);
    if (!label || !okLabel(label)) continue;
    const k = normKey(label);
    let bucket = byKey.get(k);
    if (!bucket) {
      bucket = { id: `${o.id}#heading:${b.id}`, label };
      byKey.set(k, bucket);
      buckets.push(bucket);
    }
    for (const x of bulletObjects(b.bullets)) {
      if (depthOf(x) !== 1) continue;
      const text = tidy(stripEnumerator(x.text ?? ''));
      if (okItem(text)) items.push({ itemId: x.id as string, blockId: b.id, objectiveId: o.id, text, bucketId: bucket.id });
    }
  }
  const firstBlock = blocks.find((b) => headingOf(b)) ?? blocks[0];
  const s: Scheme = {
    key: `${o.id}#headings`,
    kind: 'headings',
    blockId: firstBlock.id,
    objectiveId: o.id,
    prompt: 'Each card is a point from the notes. Which heading was it listed under?',
    name: headingsName(buckets, o.text),
    line: `Under ${o.id}, the notes list their points under ${buckets.length} headings: ${listLabels(buckets.map((x) => x.label))}.`,
    buckets,
    items: finaliseItems(items, buckets),
  };
  return viable(s) ? s : null;
}

const schemeCache = new WeakMap<Reading, Scheme[]>();

/** Every classification scheme in the reading that can carry a board. */
export function readingSchemes(corpus: Corpus, reading: Reading): Scheme[] {
  const hit = schemeCache.get(reading);
  if (hit) return hit;
  const out: Scheme[] = [];
  const objectives = Array.isArray(reading.objectives) ? reading.objectives : [];
  objectives.forEach((o, i) => {
    for (const b of Array.isArray(o?.blocks) ? o.blocks : []) {
      if (!b || typeof b.id !== 'string') continue;
      try {
        if (b.type === 'table') out.push(...tableSchemes(corpus, b));
        else {
          const l = labelScheme(corpus, b);
          if (l) out.push(l);
          const n = nestedScheme(corpus, b);
          if (n) out.push(n);
        }
      } catch {
        // A malformed block only loses its own scheme.
      }
    }
    try {
      const h = headingScheme(reading, i);
      if (h) out.push(h);
    } catch {
      // As above.
    }
  });
  schemeCache.set(reading, out);
  return out;
}

function distinctIds(s: Scheme, exclude: ReadonlySet<string> = new Set()): number {
  return new Set(s.items.map((i) => i.itemId).filter((id) => !exclude.has(id))).size;
}

/** Honest support: two boards of at least three distinct items each can be dealt. */
export function canPlay(schemes: readonly Scheme[]): boolean {
  if (schemes.some((s) => distinctIds(s) >= MIN_TOTAL)) return true;
  for (const a of schemes) {
    if (distinctIds(a) < MIN_BOARD_ITEMS) continue;
    const used = new Set(a.items.map((i) => i.itemId));
    // Worst case the first board takes items the second one also has; require room beyond all of them.
    for (const b of schemes) if (b !== a && distinctIds(b, used) >= MIN_BOARD_ITEMS) return true;
  }
  // Two schemes sharing items: the first board only takes MIN_BOARD_ITEMS, so check the union.
  for (const a of schemes) {
    for (const b of schemes) {
      if (a === b || distinctIds(a) < MIN_BOARD_ITEMS || distinctIds(b) < MIN_BOARD_ITEMS) continue;
      const union = new Set([...a.items, ...b.items].map((i) => i.itemId));
      if (union.size >= MIN_TOTAL && distinctIds(b, new Set(a.items.map((i) => i.itemId))) >= MIN_BOARD_ITEMS) return true;
    }
  }
  return false;
}

export function supportsBucketDrop(reading: Reading, corpus: Corpus): boolean {
  try {
    return canPlay(readingSchemes(corpus, reading));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Dealing boards

export interface BucketBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
  priorityCategory: TrapCategory | null;
}

/** Richer shapes first: many items per bucket beats one-to-one matching. */
const KIND_WEIGHT: Record<SchemeKind, number> = { 'table-columns': 0, headings: 0, nested: 0, 'table-rows': 1, labels: 1 };

/** Lower is better: due items pull a scheme forward, then unseen ones. */
function schemeScore(s: Scheme, ctx: BucketBuildInput, exclude: ReadonlySet<string>): number {
  const ids = [...new Set(s.items.map((i) => i.itemId))].filter((id) => !exclude.has(id));
  const due = ids.filter((id) => srsPriority(ctx.srs[id], ctx.today) === 0).length;
  const unseen = ids.filter((id) => srsPriority(ctx.srs[id], ctx.today) === 1).length;
  const fresh = Math.min(MAX_BOARD_ITEMS, due * 2 + unseen);
  return -fresh + KIND_WEIGHT[s.kind] * 1.5 + ctx.rng() * 1.2;
}

/**
 * Picks up to `n` items: due first, then unseen, then the rest; one per item ID; spread across
 * buckets round-robin; at most MAX_BUCKETS distinct buckets.
 */
export function dealItems(s: Scheme, n: number, used: ReadonlySet<string>, ctx: BucketBuildInput): SchemeItem[] {
  const pool = shuffle(
    s.items.filter((i) => !used.has(i.itemId)),
    ctx.rng,
  )
    .map((it, k) => ({ it, k, tier: srsPriority(ctx.srs[it.itemId], ctx.today) }))
    .sort((a, b) => a.tier - b.tier || a.k - b.k)
    .map((x) => x.it);
  const byBucket = new Map<string, SchemeItem[]>();
  for (const it of pool) {
    if (!byBucket.has(it.bucketId)) byBucket.set(it.bucketId, []);
    byBucket.get(it.bucketId)!.push(it);
  }
  // Buckets in the order their best item appears, capped.
  const order = [...byBucket.keys()].slice(0, MAX_BUCKETS);
  const picked: SchemeItem[] = [];
  const ids = new Set<string>();
  let progress = true;
  while (picked.length < n && progress) {
    progress = false;
    for (const bid of order) {
      if (picked.length >= n) break;
      const list = byBucket.get(bid)!;
      while (list.length && ids.has(list[0].itemId)) list.shift();
      const it = list.shift();
      if (!it) continue;
      picked.push(it);
      ids.add(it.itemId);
      progress = true;
    }
  }
  return picked;
}

/** The board's buckets: every bucket an item belongs in, topped up with the scheme's other buckets, in the notes' order. */
export function boardFor(s: Scheme, items: readonly SchemeItem[], ctx: BucketBuildInput): BoardSpec {
  const need = new Set(items.map((i) => i.bucketId));
  const others = shuffle(
    s.buckets.filter((b) => !need.has(b.id)),
    ctx.rng,
  ).slice(0, Math.max(0, MAX_BUCKETS - need.size));
  const keep = new Set([...need, ...others.map((b) => b.id)]);
  return { key: s.key, kind: s.kind, prompt: s.prompt, buckets: s.buckets.filter((b) => keep.has(b.id)) };
}

/** Comfortable reading + dropping time for a card, scaled down step by step under pressure. */
export function timeFor(text: string, context: string | undefined, pressureStep: number | null): number {
  const words = wordCount(plain(text)) + (context ? wordCount(plain(context)) : 0);
  const base = Math.min(15000, Math.max(6500, 4000 + words * 260));
  if (pressureStep === null) return Math.round(base * 1.5);
  return Math.round(base * Math.pow(0.93, pressureStep));
}

export function namingFor(reading: Reading, s: Scheme): ConceptNaming {
  const los = learningObjectives(reading);
  return {
    term: s.name,
    blockId: s.blockId,
    objectiveId: s.objectiveId ?? los[0]?.id ?? reading.reading_id,
    line: s.line,
  };
}

export function buildBucketDrop(reading: Reading, ctx: BucketBuildInput): MechanicPlan<BucketPayload> | null {
  const schemes = readingSchemes(ctx.corpus, reading);
  if (!canPlay(schemes)) return null;

  const used = new Set<string>();
  const ranked = (exclude: ReadonlySet<string>) =>
    schemes
      .filter((s) => distinctIds(s, exclude) >= MIN_BOARD_ITEMS)
      .map((s) => ({ s, score: schemeScore(s, ctx, exclude) }))
      .sort((a, b) => a.score - b.score)
      .map((x) => x.s);

  // Discovery board: the best scheme that still leaves a pressure board somewhere.
  let first: Scheme | null = null;
  let second: Scheme | null = null;
  for (const a of ranked(used)) {
    const aIds = new Set(a.items.map((i) => i.itemId));
    const other = ranked(aIds).find((b) => b !== a);
    if (other) {
      first = a;
      second = other;
      break;
    }
    if (distinctIds(a) >= MIN_TOTAL) {
      first = a;
      second = a;
      break;
    }
  }
  if (!first) {
    // Schemes overlap: take a small first board and check what's left.
    for (const a of ranked(used)) {
      const trial = dealItems(a, MIN_BOARD_ITEMS, used, ctx);
      const left = new Set(trial.map((i) => i.itemId));
      const other = ranked(left).find((b) => b !== a) ?? (distinctIds(a, left) >= MIN_BOARD_ITEMS ? a : undefined);
      if (other && trial.length >= MIN_BOARD_ITEMS) {
        first = a;
        second = other;
        break;
      }
    }
  }
  if (!first || !second) return null;

  const same = first === second;
  const firstAvail = distinctIds(first);
  const nDisc = same ? Math.min(MAX_BOARD_ITEMS, Math.max(MIN_BOARD_ITEMS, Math.floor(firstAvail / 2))) : Math.min(MAX_BOARD_ITEMS, firstAvail);
  let disc = dealItems(first, nDisc, used, ctx);
  disc.forEach((i) => used.add(i.itemId));
  let pres = dealItems(second, MAX_BOARD_ITEMS, used, ctx);
  if (pres.length < MIN_BOARD_ITEMS && !same && distinctIds(first, used) >= MIN_BOARD_ITEMS) {
    second = first;
    pres = dealItems(first, MAX_BOARD_ITEMS, used, ctx);
  }
  if (disc.length < MIN_BOARD_ITEMS || pres.length < MIN_BOARD_ITEMS) return null;
  // Discovery 3–5, pressure 3–5.
  disc = disc.slice(0, MAX_BOARD_ITEMS);

  const discBoard = boardFor(first, disc, ctx);
  const presBoard = boardFor(second, pres, ctx);
  const toRound = (it: SchemeItem, board: BoardSpec, phase: 'discovery' | 'pressure', step: number): MechanicRound<BucketPayload> => {
    const limit = phase === 'pressure' ? timeFor(it.text, it.context, step) : undefined;
    return {
      id: `${it.itemId}#${phase}`,
      phase,
      itemId: it.itemId,
      blockId: it.blockId,
      objectiveId: it.objectiveId,
      timeLimitMs: limit,
      targetMs: limit ?? timeFor(it.text, it.context, null),
      payload: { board, text: it.text, context: it.context, bucketId: it.bucketId },
    };
  };
  const rounds = [
    ...shuffle(disc, ctx.rng).map((it) => toRound(it, discBoard, 'discovery', 0)),
    ...shuffle(pres, ctx.rng).map((it, i) => toRound(it, presBoard, 'pressure', i)),
  ];
  const concept = namingFor(reading, first);
  const total = rounds.length;
  return {
    rounds,
    target: concept.term,
    opening: `${reading.reading_id} · Bucket Drop. ${total} pieces of this reading, and the bins the notes keep them in. Drop each piece where it lives. The first board waits for you; the second one deals against a clock.`,
    concept,
  };
}

/** Bucket label by ID, for feedback. */
export function bucketLabel(board: BoardSpec, id: string): string {
  return board.buckets.find((b) => b.id === id)?.label ?? '';
}

