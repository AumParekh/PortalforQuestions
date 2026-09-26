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

/** A reading cited in a curated line ("ORR-2", "LTR-9"), with any notes line after it ("l.148"). */
const REF = String.raw`\b(?:MR|CR|ORR|LTR|IM|CI)-\d+\b(?:\s+l\.\s?\d+(?:[-–]\d+)?)?`;
/** Third-person verbs whose plural is not the word less its final s. */
/** A bracketed notes line on its own: "(l.201)", "(ll.12-14)". */
const LINE_REF = /\s*\((?:ll?\.|lines?)\s?\d+(?:[-–]\d+)?(?:(?:,\s*|\s+and\s+)(?:ll?\.\s?)?\d+(?:[-–]\d+)?)*\)/g;
const PLURAL_VERB: Record<string, string> = { has: 'have', does: 'do', goes: 'go', is: 'are', was: 'were' };

/**
 * Takes the reading citations out of a curated line, leaving only what the notes say: a
 * citation in brackets or heading a sentence goes ("(LTR-6)", "ORR-2: …", "CR-2 oversight
 * principle: …", "(l.201)"), and a reading used as a noun becomes "the notes" ("CR-3 lists …" → "The notes
 * list …", "ORR-2's table" → "the notes' table", "in ORR-2" → "in the notes").
 */
export function dropReadingRefs(s: string): string {
  const startsSentence = (src: string, at: number) => /(?:^|[.!?]\s+)$/.test(src.slice(0, at));
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const notes = (src: string, at: number) => (startsSentence(src, at) ? 'The notes' : 'the notes');
  return (
    s
      // "(LTR-6)", "(ORR-2 l.148)", "(the excess-loss model of MR-3)", "(l.201)"
      .replace(LINE_REF, '')
      .replace(new RegExp(String.raw`\s*\([^()]*${REF}[^()]*\)`, 'g'), '')
      // "ORR-19 (BIS): the board …", "CR-2's independence principle: …" heading a sentence
      .replace(
        new RegExp(String.raw`(^|[.!?]\s+)${REF}(?:'s)?(?:\s*\([^()]*\))?(?:\s+([a-z]+(?:[ -][a-z]+){0,2}))?:\s*([a-z]?)`, 'g'),
        (_m, lead: string, head: string | undefined, next: string) => (head ? `${lead}${cap(head)}: ${next}` : `${lead}${next.toUpperCase()}`),
      )
      // "LTR-9 and LTR-6 place …"
      .replace(new RegExp(String.raw`${REF}(?:,\s*${REF})*,?\s+and\s+${REF}`, 'g'), (_m, at: number, src: string) => notes(src, at))
      // "ORR-2's table"
      .replace(new RegExp(`${REF}'s\\b`, 'g'), (_m, at: number, src: string) => `${notes(src, at)}'`)
      // "CR-3 lists …": the verb follows the plural subject
      .replace(new RegExp(String.raw`(?<!\b(?:in|of|by|from|to|with|under|than|and)\s)${REF}\s+([a-z]+)`, 'g'), (_m, verb: string, at: number, src: string) => {
        const plural = PLURAL_VERB[verb] ?? (/[^s]s$/.test(verb) ? verb.slice(0, -1) : verb);
        return `${notes(src, at)} ${plural}`;
      })
      .replace(new RegExp(REF, 'g'), (_m, at: number, src: string) => notes(src, at))
      .trim()
  );
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
    why: dropReadingRefs(why),
    confusable,
    // A why-not only makes sense against a confusable role.
    whyNot: confusable ? dropReadingRefs(str(x.why_not) ?? '') : '',
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
