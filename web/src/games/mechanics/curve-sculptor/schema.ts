// Curve Sculptor: defensive reading of corpus.extras['curve-sculptor'] (curated, validated offline
// by tools/games/validate_curve-sculptor.py). Anything malformed is dropped item by item; each
// kept item is re-checked here with the same predicates, so a bad edit to the JSON can only
// remove a puzzle, never ship one that snaps to the wrong shape. Pure; no React.
import type { Axis, CurveSpec, ParamSpec } from './maths';
import { allFinite, allShapes, compileExpr, inRange, isShapeWord, sample } from './maths';

export const MECHANIC_KEY = 'curve-sculptor';

export interface CurveItem extends CurveSpec {
  id: string;
  readingId: string;
  sourceBlock: string | null;
  description: string;
  explanation: string;
  expr: string;
  wrongParam: string;
  startValue: number;
  tolerance: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function axisOf(v: unknown): Axis | null {
  if (!isRecord(v) || !isStr(v.label) || !isNum(v.min) || !isNum(v.max) || !(v.max > v.min)) return null;
  return { label: v.label.trim(), min: v.min, max: v.max, unit: typeof v.unit === 'string' ? v.unit.trim() : '' };
}

function paramOf(v: unknown): ParamSpec | null {
  if (!isRecord(v) || !isStr(v.name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name) || v.name === 'x') return null;
  if (!isStr(v.label) || !isNum(v.min) || !isNum(v.max) || !isNum(v.step) || !(v.max > v.min) || !(v.step > 0)) return null;
  return { name: v.name, label: v.label.trim(), min: v.min, max: v.max, step: v.step };
}

/** Type guard + normaliser for one curated item; null when anything is off. */
export function parseItem(raw: unknown): CurveItem | null {
  if (!isRecord(raw)) return null;
  const { id, reading_id, description, explanation, expr, wrong_param, start_value, tolerance } = raw;
  if (!isStr(id) || !isStr(reading_id) || !isStr(description) || !isStr(explanation) || !isStr(expr)) return null;
  if (!isStr(wrong_param) || !isNum(start_value) || !isNum(tolerance) || !(tolerance > 0)) return null;
  const x = axisOf(raw.x);
  const y = axisOf(raw.y);
  if (!x || !y) return null;
  if (!Array.isArray(raw.params) || raw.params.length !== 3) return null;
  const params = raw.params.map(paramOf);
  if (params.some((p) => p === null)) return null;
  const ps = params as ParamSpec[];
  if (new Set(ps.map((p) => p.name)).size !== 3) return null;
  if (!Array.isArray(raw.shape_words) || raw.shape_words.length === 0) return null;
  const shapeWords = raw.shape_words.filter((w): w is string => typeof w === 'string');
  if (shapeWords.length !== raw.shape_words.length || !shapeWords.every(isShapeWord)) return null;
  if (!isRecord(raw.target)) return null;
  const target: Record<string, number> = {};
  for (const p of ps) {
    const t = raw.target[p.name];
    if (!isNum(t) || t < p.min - 1e-12 || t > p.max + 1e-12) return null;
    target[p.name] = t;
  }
  const wp = ps.find((p) => p.name === wrong_param);
  if (!wp || start_value < wp.min - 1e-12 || start_value > wp.max + 1e-12) return null;
  if (!(tolerance < Math.abs(start_value - target[wp.name]) / 3)) return null;
  const fn = compileExpr(expr, ps.map((p) => p.name));
  if (!fn) return null;
  const item: CurveItem = {
    id: id.trim(),
    readingId: reading_id.trim(),
    sourceBlock: isStr(raw.source_block) ? raw.source_block.trim() : null,
    description: description.trim(),
    explanation: explanation.trim(),
    expr,
    x,
    y,
    params: ps,
    target,
    shapeWords,
    fn,
    wrongParam: wp.name,
    startValue: start_value,
    tolerance,
  };
  // Runtime re-check of the puzzle's promise: target on the canvas and showing every word; start
  // on the canvas and breaking at least one.
  const tYs = sample(item, target);
  const sYs = sample(item, { ...target, [wp.name]: start_value });
  if (!allFinite(tYs) || !inRange(tYs, y) || !allShapes(item, tYs)) return null;
  if (!allFinite(sYs) || !inRange(sYs, y) || allShapes(item, sYs)) return null;
  return item;
}

/** All valid items, de-duplicated by id (first wins). */
export function parseCurveData(extra: unknown): CurveItem[] {
  const list = isRecord(extra) && Array.isArray(extra.items) ? extra.items : Array.isArray(extra) ? extra : [];
  const seen = new Set<string>();
  const out: CurveItem[] = [];
  for (const raw of list) {
    const item = parseItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
