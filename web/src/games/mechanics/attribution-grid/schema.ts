// Attribution Grid: the curated data contract (content/games/mechanics/attribution-grid.json,
// loaded into corpus.extras['attribution-grid']) and a defensive type guard. Pure; no React.
// Malformed roles fall back to their default label; malformed items are dropped, never guessed.

export type RoleId = 'first' | 'second' | 'third' | 'board';

/** Slot order on the board: the three lines left to right, the board above them. */
export const ROLE_IDS: readonly RoleId[] = ['first', 'second', 'third', 'board'];

const DEFAULT_LABEL: Record<RoleId, string> = {
  first: 'First line',
  second: 'Second line',
  third: 'Third line',
  board: 'Board / committee',
};

export interface AgRole {
  id: RoleId;
  label: string;
  /** Two or three lines, general, from the notes. Empty when the data file lacked it. */
  responsibility: string;
  examples: string[];
}

export interface AgItem {
  id: string;
  readingId: string;
  sourceBlock: string;
  sourceFile: string | null;
  sourceLine: number | null;
  /** The activity, decision, report or control, phrased without naming the role. */
  statement: string;
  role: RoleId;
  /** One line citing the notes' logic for the right role. */
  why: string;
  /** The role people wrongly pick, if the notes suggest one (never equal to `role`). */
  confusable: RoleId | null;
  /** One line: why the confusable role is wrong. */
  whyNot: string;
}

export interface AgData {
  roles: Record<RoleId, AgRole>;
  items: AgItem[];
}

export function isRoleId(x: unknown): x is RoleId {
  return typeof x === 'string' && (ROLE_IDS as readonly string[]).includes(x);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.replace(/\s+/g, ' ').trim() : null;
}

function parseRole(x: unknown): AgRole | null {
  if (!isRecord(x) || !isRoleId(x.id)) return null;
  return {
    id: x.id,
    label: str(x.label) ?? DEFAULT_LABEL[x.id],
    responsibility: str(x.responsibility) ?? '',
    examples: Array.isArray(x.examples) ? x.examples.map(str).filter((e): e is string => e !== null) : [],
  };
}

/** One item, or null when any required field is missing or has the wrong type. */
export function parseItem(x: unknown): AgItem | null {
  if (!isRecord(x)) return null;
  const id = str(x.id);
  const readingId = str(x.reading_id);
  const sourceBlock = str(x.source_block);
  const statement = str(x.statement);
  const why = str(x.why);
  if (!id || !readingId || !sourceBlock || !statement || !why || !isRoleId(x.role)) return null;
  if (x.confusable_with !== null && x.confusable_with !== undefined && !isRoleId(x.confusable_with)) return null;
  const confusable = isRoleId(x.confusable_with) && x.confusable_with !== x.role ? x.confusable_with : null;
  const line = typeof x.source_line === 'number' && Number.isFinite(x.source_line) ? Math.round(x.source_line) : null;
  return {
    id,
    readingId,
    sourceBlock,
    sourceFile: str(x.source_file),
    sourceLine: line,
    statement,
    role: x.role,
    why,
    confusable,
    // A why-not only makes sense against a confusable role.
    whyNot: confusable ? (str(x.why_not) ?? '') : '',
  };
}

/** Parses the whole file. Null when it is not an attribution-grid file at all. */
export function parseAttributionData(raw: unknown): AgData | null {
  if (!isRecord(raw)) return null;
  if (raw.mechanic !== undefined && raw.mechanic !== 'attribution-grid') return null;
  if (!Array.isArray(raw.items)) return null;
  const blank = (id: RoleId): AgRole => ({ id, label: DEFAULT_LABEL[id], responsibility: '', examples: [] });
  const roles: Record<RoleId, AgRole> = { first: blank('first'), second: blank('second'), third: blank('third'), board: blank('board') };
  if (Array.isArray(raw.roles)) {
    for (const r of raw.roles) {
      const role = parseRole(r);
      if (role) roles[role.id] = role;
    }
  }
  const items: AgItem[] = [];
  const ids = new Set<string>();
  const statements = new Set<string>();
  for (const x of raw.items) {
    const item = parseItem(x);
    if (!item) continue;
    const key = item.statement.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    // Duplicate ids or statements would make SRS and grading ambiguous: keep the first.
    if (ids.has(item.id) || statements.has(key)) continue;
    ids.add(item.id);
    statements.add(key);
    items.push(item);
  }
  return { roles, items };
}

const cache = new WeakMap<object, AgData | null>();

/** Parsed data for a corpus's extras entry, parsed once per loaded file. */
export function attributionData(extras: Record<string, unknown> | undefined): AgData | null {
  const raw = extras?.['attribution-grid'];
  if (!isRecord(raw)) return null;
  if (!cache.has(raw)) cache.set(raw, parseAttributionData(raw));
  return cache.get(raw) ?? null;
}

/** The first sentence of a role's responsibility, for one-line summaries. */
export function firstSentence(s: string): string {
  const m = /^(.+?[.;])(\s|$)/.exec(s);
  return (m ? m[1] : s).replace(/[.;]$/, '').trim();
}
