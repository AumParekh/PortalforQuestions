import { AREAS, MODES } from './types';
import type { Scenario, ScenarioOption, ScenarioSource, SenseArea, SenseMode, WorkingStep } from './types';

/** Pure normaliser for content/games/sensecheck.json. Malformed scenarios are dropped, never shown half-built. */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// Bank file prefixes that differ from the area codes.
const AREA_ALIASES: Record<string, SenseArea> = { IR: 'IM', LR: 'LTR', OR: 'ORR' };

function areaOf(v: unknown): SenseArea | null {
  const s = str(v).toUpperCase();
  if ((AREAS as string[]).includes(s)) return s as SenseArea;
  return AREA_ALIASES[s] ?? null;
}

function sourceOf(v: unknown): ScenarioSource | null {
  if (!isRec(v)) return null;
  if (v.kind === 'bank' && str(v.questionId)) return { kind: 'bank', questionId: str(v.questionId) };
  if (v.kind === 'notes' && str(v.file)) return { kind: 'notes', file: str(v.file), line: num(v.line) };
  return null;
}

function optionOf(v: unknown): ScenarioOption | null {
  if (!isRec(v)) return null;
  const label = str(v.label);
  if (!label) return null;
  return { label, correct: v.correct === true, why: str(v.why) || null };
}

function stepOf(v: unknown): WorkingStep | null {
  if (!isRec(v)) return null;
  const display = str(v.display);
  if (!display) return null;
  return { label: str(v.label), display, value: num(v.value) };
}

export function parseScenario(v: unknown): Scenario | null {
  if (!isRec(v)) return null;
  const id = str(v.id);
  const mode = str(v.mode).toLowerCase() as SenseMode;
  const area = areaOf(v.area);
  const setup = str(v.setup);
  const ask = str(v.ask);
  if (!id || !MODES.includes(mode) || !area || !setup || !ask) return null;
  const options = list(v.options).map(optionOf);
  if (options.some((o) => o === null)) return null;
  const opts = options as ScenarioOption[];
  if (opts.length < 2 || opts.length > 4 || opts.filter((o) => o.correct).length !== 1) return null;
  if (new Set(opts.map((o) => o.label)).size !== opts.length) return null;
  const working = list(v.working)
    .map(stepOf)
    .filter((s): s is WorkingStep => s !== null);
  const readingId = str(v.reading_id) || null;
  return {
    id,
    mode,
    area,
    reading: str(v.reading) || readingId || area,
    readingId,
    source: sourceOf(v.source) ?? { kind: 'notes', file: '', line: null },
    trapCategory: str(v.trap_category) || null,
    setup,
    ask,
    options: opts,
    working,
    takeaway: str(v.takeaway),
  };
}

/** `{ version, scenarios }`, or a bare array (the per-slice files used while the deck is being built). */
export function parseSenseDeck(raw: unknown): Scenario[] {
  const items = Array.isArray(raw) ? raw : isRec(raw) ? list(raw.scenarios) : [];
  const seen = new Set<string>();
  const out: Scenario[] = [];
  for (const item of items) {
    const s = parseScenario(item);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/** Key for "same underlying question": rounds sharing it would give each other's answers away. */
export function sourceKey(s: Scenario): string {
  if (s.source.kind === 'bank') return `bank:${s.source.questionId}`;
  if (s.source.file) return `notes:${s.source.file}:${s.source.line ?? ''}`;
  return `id:${s.id}`;
}
