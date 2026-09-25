// Pure normalisation and indexing of game-blocks.json. No React, no zustand, so it can be
// unit-tested in node.
import type { Area, Block, GameBlocks, Reading, SubItem, SubItemLike, Trap, TrapCategory } from './types';
import { AREAS, TRAP_CATEGORIES } from './types';

export interface Corpus {
  data: GameBlocks;
  /** Readings in a stable order: area (MR, CR, ORR, LTR, IM, CI), then reading number. */
  readings: Reading[];
  readingById: Record<string, Reading>;
  readingsByArea: Record<string, Reading[]>;
  blockById: Record<string, Block>;
  /** Block ID → objective ID ("LTR-1 a"). */
  objectiveOfBlock: Record<string, string>;
  /** Block ID → reading ID. */
  readingOfBlock: Record<string, string>;
  trapById: Record<string, Trap>;
  /** Trap ID → reading ID. */
  readingOfTrap: Record<string, string>;
  /** Sub-items that carry their own ID (terms, bullets, numeric items, variables, rows). */
  subItemById: Record<string, SubItem>;
  /** Category → trap IDs; taken from the file when present, else rebuilt. */
  trapIndex: Record<TrapCategory, string[]>;
  objectiveCount: number;
}

const CATEGORY_ALIASES: Record<string, TrapCategory> = {
  polarity: 'Polarity',
  sibling: 'Sibling',
  'input twin': 'Sibling',
  'confidence twin': 'Sibling',
  role: 'Role',
  sign: 'Sign',
  scope: 'Scope',
  definition: 'Definition',
  formula: 'Formula',
  calculation: 'Formula',
  'intermediate result': 'Intermediate result',
  intermediate: 'Intermediate result',
  sequence: 'Sequence',
  ordering: 'Sequence',
  order: 'Sequence',
};

export function normaliseCategory(raw: unknown): TrapCategory | null {
  if (typeof raw !== 'string') return null;
  const exact = TRAP_CATEGORIES.find((c) => c === raw);
  if (exact) return exact;
  return CATEGORY_ALIASES[raw.trim().toLowerCase().replace(/[.:]+$/, '')] ?? null;
}

export function areaRank(area: string): number {
  const i = AREAS.indexOf(area as Area);
  return i === -1 ? AREAS.length : i;
}

function readingNumber(id: string): number {
  const m = /(\d+)\s*$/.exec(id);
  return m ? Number(m[1]) : 0;
}

export function compareReadings(a: Reading, b: Reading): number {
  return (
    areaRank(a.area) - areaRank(b.area) ||
    readingNumber(a.reading_id) - readingNumber(b.reading_id) ||
    a.reading_id.localeCompare(b.reading_id)
  );
}

/** The display text of a sub-item that may be a bare string or an object. */
export function subItemText(x: SubItemLike): string {
  if (typeof x === 'string') return x;
  return x.plain_text ?? x.text ?? '';
}

function collectSubItems(b: Block, out: Record<string, SubItem>) {
  const lists: (SubItemLike[] | undefined)[] = [b.terms, b.bold_claims, b.numeric_items, b.bullets, b.section_headings];
  for (const list of lists) {
    for (const x of list ?? []) if (typeof x !== 'string' && x.id) out[x.id] = { parent: b.id, ...x };
  }
  for (const v of b.variables ?? []) {
    if (v.id) out[v.id] = { id: v.id, parent: b.id, subtype: 'variable', text: `${v.symbol}: ${v.definition}` };
  }
  for (const r of b.rows ?? []) {
    if (r.id) out[r.id] = { id: r.id, parent: b.id, subtype: 'table_row', text: r.cells.join(' | ') };
  }
}

/** Fills in missing arrays and normalises trap categories so the rest of the layer can trust the shape. */
export function normaliseReading(r: Reading, key: string): Reading {
  const traps: Trap[] = [];
  for (const t of Array.isArray(r.traps) ? r.traps : []) {
    if (!t || typeof t.id !== 'string') continue;
    const category = normaliseCategory(t.category) ?? normaliseCategory(t.raw_category);
    if (!category) continue; // Source notes and unknown categories are not playable traps.
    traps.push({ ...t, category, text: typeof t.text === 'string' ? t.text : (t.correct_text ?? '') });
  }
  return {
    ...r,
    reading_id: r.reading_id || key,
    title: r.title ?? key,
    area: r.area ?? key.replace(/-\d+.*$/, ''),
    objectives: (Array.isArray(r.objectives) ? r.objectives : []).map((o) => ({
      ...o,
      blocks: Array.isArray(o.blocks) ? o.blocks : [],
    })),
    traps,
    mechanics_supported: Array.isArray(r.mechanics_supported) ? r.mechanics_supported : [],
  };
}

export function buildCorpus(raw: GameBlocks): Corpus {
  if (!raw || typeof raw !== 'object' || !raw.readings || typeof raw.readings !== 'object') {
    throw new Error('game-blocks.json has no readings');
  }
  const readings = Object.entries(raw.readings)
    .map(([k, r]) => normaliseReading(r, k))
    .sort(compareReadings);
  const readingById: Record<string, Reading> = {};
  const readingsByArea: Record<string, Reading[]> = {};
  const blockById: Record<string, Block> = {};
  const objectiveOfBlock: Record<string, string> = {};
  const readingOfBlock: Record<string, string> = {};
  const trapById: Record<string, Trap> = {};
  const readingOfTrap: Record<string, string> = {};
  const subItemById: Record<string, SubItem> = {};
  let objectiveCount = 0;
  for (const r of readings) {
    readingById[r.reading_id] = r;
    (readingsByArea[r.area] ??= []).push(r);
    for (const o of r.objectives) {
      objectiveCount++;
      for (const b of o.blocks) {
        blockById[b.id] = b;
        objectiveOfBlock[b.id] = o.id;
        readingOfBlock[b.id] = r.reading_id;
        collectSubItems(b, subItemById);
      }
    }
    for (const t of r.traps) {
      trapById[t.id] = t;
      readingOfTrap[t.id] = r.reading_id;
    }
  }
  const trapIndex = Object.fromEntries(TRAP_CATEGORIES.map((c) => [c, [] as string[]])) as Record<TrapCategory, string[]>;
  const fileIndex = raw.trap_index ?? {};
  let fromFile = false;
  for (const [k, ids] of Object.entries(fileIndex)) {
    const c = normaliseCategory(k);
    if (!c || !Array.isArray(ids)) continue;
    for (const id of ids) if (trapById[id]) trapIndex[c].push(id);
    fromFile = true;
  }
  if (!fromFile) for (const t of Object.values(trapById)) trapIndex[t.category].push(t.id);
  return {
    data: raw,
    readings,
    readingById,
    readingsByArea,
    blockById,
    objectiveOfBlock,
    readingOfBlock,
    trapById,
    readingOfTrap,
    subItemById,
    trapIndex,
    objectiveCount,
  };
}

/** Objective a trap belongs to: its own field, else the objective holding its source block. */
export function trapObjective(corpus: Corpus, t: Trap): string | undefined {
  if (t.objective) return t.objective;
  if (t.source_block) return corpus.objectiveOfBlock[t.source_block];
  return undefined;
}
