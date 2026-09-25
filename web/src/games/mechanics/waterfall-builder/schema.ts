// Waterfall Builder: defensive reading of corpus.extras['waterfall-builder'] (curated, validated
// offline by tools/games/validate_waterfall-builder.py). The runtime re-checks the structural half
// of that contract item by item (kinds, 4-8 steps, unique ids and texts, short step texts, loops
// carry a closure) and drops anything malformed, so a bad edit to the JSON can only remove a flow,
// never ship one the board can't play. Pure; no React.

export const MECHANIC_KEY = 'waterfall-builder';

export type FlowKind = 'stack' | 'process' | 'loop';
export const FLOW_KINDS: readonly FlowKind[] = ['stack', 'process', 'loop'];

export const MIN_STEPS = 4;
export const MAX_STEPS = 8;
export const MAX_STEP_WORDS = 12;

export interface FlowStep {
  id: string;
  /** Tile text: at most 12 words, faithful to the notes. */
  text: string;
  /** One line shown once the tile is placed. */
  detail: string;
}

export interface FlowItem {
  id: string;
  readingId: string;
  sourceBlock: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  title: string;
  kind: FlowKind;
  /** What flows and which way. */
  directionLabel: string;
  /** Steps in the notes' order, top to bottom (for a loop, the last feeds the first). */
  steps: FlowStep[];
  /** Loops only: how the last step feeds the first. */
  loopClosure: string | null;
  explanation: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function wordCount(s: string): number {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Case- and spacing-insensitive key used for the unique-text check. */
export function textKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function stepOf(v: unknown): FlowStep | null {
  if (!isRecord(v) || !isStr(v.id) || !isStr(v.text) || !isStr(v.detail)) return null;
  const text = oneLine(v.text);
  const words = wordCount(text);
  if (words < 1 || words > MAX_STEP_WORDS) return null;
  // LaTeX residue would render as raw markup on a tile.
  if (/\\|[{}]/.test(text)) return null;
  return { id: v.id.trim(), text, detail: oneLine(v.detail) };
}

function isKind(v: unknown): v is FlowKind {
  return typeof v === 'string' && (FLOW_KINDS as readonly string[]).includes(v);
}

/** Type guard + normaliser for one curated item; null when anything is off. */
export function parseItem(raw: unknown): FlowItem | null {
  if (!isRecord(raw)) return null;
  const { id, reading_id, title, kind, direction_label, explanation } = raw;
  if (!isStr(id) || !isStr(reading_id) || !/^[A-Z]+-\d+$/.test(reading_id.trim())) return null;
  if (!isStr(title) || !isKind(kind) || !isStr(direction_label) || !isStr(explanation)) return null;
  if (!Array.isArray(raw.steps) || raw.steps.length < MIN_STEPS || raw.steps.length > MAX_STEPS) return null;
  const steps = raw.steps.map(stepOf);
  if (steps.some((s) => s === null)) return null;
  const ok = steps as FlowStep[];
  if (new Set(ok.map((s) => s.id)).size !== ok.length) return null;
  if (new Set(ok.map((s) => textKey(s.text))).size !== ok.length) return null;
  const closure = isStr(raw.loop_closure) ? oneLine(raw.loop_closure) : null;
  // A loop must say how it closes; anything else must not claim to.
  if ((kind === 'loop') !== (closure !== null)) return null;
  const line = raw.source_line;
  return {
    id: id.trim(),
    readingId: reading_id.trim(),
    sourceBlock: isStr(raw.source_block) ? raw.source_block.trim() : null,
    sourceFile: isStr(raw.source_file) ? raw.source_file.trim() : null,
    sourceLine: typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : null,
    title: oneLine(title),
    kind,
    directionLabel: oneLine(direction_label),
    steps: ok,
    loopClosure: closure,
    explanation: oneLine(explanation),
  };
}

/** All valid items, de-duplicated by id (first wins). Accepts the file envelope or a bare list. */
export function parseWaterfallData(extra: unknown): FlowItem[] {
  if (isRecord(extra) && extra.mechanic !== undefined && extra.mechanic !== MECHANIC_KEY) return [];
  const list = isRecord(extra) && Array.isArray(extra.items) ? extra.items : Array.isArray(extra) ? extra : [];
  const seen = new Set<string>();
  const out: FlowItem[] = [];
  for (const raw of list) {
    const item = parseItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
