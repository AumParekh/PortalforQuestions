// Tail Shaper: defensive reading of corpus.extras['tail-shaper'] (curated, validated offline by
// tools/games/validate_tail-shaper.py). The family block must name the four fixed sliders; each item
// is re-checked here with the same predicates as the validator (targets on the slider grid, the
// start outside the tolerance box, the curve label holding at the target and at every box corner,
// the implied-volatility points having the label's shape). Anything malformed is dropped item by
// item, so a bad edit to the JSON can only remove a puzzle, never ship one whose overlay lies.
// Pure; no React.
import type { ParamName, ParamSpec, Params, SmileLabel, SmilePoint, Thresholds } from './maths';
import { DEFAULT_THRESHOLDS, PARAM_NAMES, SMILE_LABELS, boxCorners, boxOf, classify, isOnGrid, smileShapeOk, withinOne } from './maths';

export const MECHANIC_KEY = 'tail-shaper';

export interface SmileCurve {
  label: SmileLabel;
  points: SmilePoint[];
  note: string;
  /** Only for the "whole curve shifts" item: the curve before the move. */
  before: SmilePoint[] | null;
}

export interface TailItem {
  id: string;
  readingId: string;
  sourceBlock: string | null;
  title: string;
  description: string;
  explanation: string;
  target: Params;
  tolerance: Params;
  start: Params;
  /** Sliders the description pins down; the rest accept their whole range. */
  matters: ParamName[];
  smile: SmileCurve;
}

export interface TailData {
  specs: Record<ParamName, ParamSpec>;
  thresholds: Thresholds;
  items: TailItem[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isParamName = (v: unknown): v is ParamName => typeof v === 'string' && (PARAM_NAMES as readonly string[]).includes(v);

function specOf(v: unknown): ParamSpec | null {
  if (!isRecord(v) || !isParamName(v.name) || !isStr(v.label)) return null;
  const { min, max, step } = v;
  if (!isNum(min) || !isNum(max) || !isNum(step) || !(max > min) || !(step > 0) || step > max - min) return null;
  // The family's own constraints: nu > 2 keeps the variance finite; the scale is positive.
  if ((v.name === 'nuL' || v.name === 'nuR') && !(min > 2)) return null;
  if (v.name === 's' && !(min > 0)) return null;
  return {
    name: v.name,
    label: v.label.trim(),
    min,
    max,
    step,
    lowLabel: typeof v.low_label === 'string' ? v.low_label.trim() : '',
    highLabel: typeof v.high_label === 'string' ? v.high_label.trim() : '',
  };
}

/** The four sliders from family.params; null unless all four are present and sane. */
export function parseSpecs(family: unknown): Record<ParamName, ParamSpec> | null {
  if (!isRecord(family) || !Array.isArray(family.params)) return null;
  const out: Partial<Record<ParamName, ParamSpec>> = {};
  for (const raw of family.params) {
    const s = specOf(raw);
    if (!s || out[s.name]) return null;
    out[s.name] = s;
  }
  return PARAM_NAMES.every((n) => out[n]) ? (out as Record<ParamName, ParamSpec>) : null;
}

/** Thresholds from the JSON's classification block when complete, else the validator's defaults. */
export function parseThresholds(v: unknown): Thresholds {
  if (!isRecord(v)) return DEFAULT_THRESHOLDS;
  const t = {
    tailZ: v.tail_z,
    heavy: v.heavy_ratio,
    fatter: v.fatter_ratio,
    light: v.light_ratio,
    symmetryMax: v.smile_symmetry_max,
    skewRatioMin: v.skew_ratio_min,
    skewNuMargin: v.skew_nu_margin,
  };
  const vals = Object.values(t);
  if (!vals.every((x) => isNum(x) && x > 0)) return DEFAULT_THRESHOLDS;
  const th = t as Thresholds;
  // Bands must be ordered or the words and the labels contradict each other.
  if (!(th.light < th.fatter && th.fatter <= th.heavy)) return DEFAULT_THRESHOLDS;
  return th;
}

function paramsOf(v: unknown): Params | null {
  if (!isRecord(v)) return null;
  const out = {} as Params;
  for (const n of PARAM_NAMES) {
    const x = v[n];
    if (!isNum(x)) return null;
    out[n] = x;
  }
  return out;
}

function pointsOf(v: unknown): SmilePoint[] | null {
  if (!Array.isArray(v)) return null;
  const out: SmilePoint[] = [];
  for (const q of v) {
    if (!Array.isArray(q) || q.length !== 2 || !isNum(q[0]) || !isNum(q[1])) return null;
    out.push([q[0], q[1]]);
  }
  return out;
}

function smileOf(v: unknown): SmileCurve | null {
  if (!isRecord(v)) return null;
  const label = SMILE_LABELS.find((l) => l === v.label);
  if (!label) return null;
  const points = pointsOf(v.points);
  if (!points || !smileShapeOk(label, points)) return null;
  const note = typeof v.smile_note === 'string' ? v.smile_note.trim() : '';
  if (!/illustrative/i.test(note)) return null;
  let before: SmilePoint[] | null = null;
  if (v.before_points !== undefined) {
    before = pointsOf(v.before_points);
    if (!before || before.length !== points.length || !before.every((q, i) => q[0] === points[i][0] && q[1] > 0)) return null;
  }
  return { label, points, note, before };
}

/** Type guard + normaliser for one curated item; null when anything is off. */
export function parseItem(raw: unknown, specs: Record<ParamName, ParamSpec>, th: Thresholds): TailItem | null {
  if (!isRecord(raw)) return null;
  const { id, reading_id, title, description, explanation } = raw;
  if (!isStr(id) || !isStr(reading_id) || !isStr(title) || !isStr(description) || !isStr(explanation)) return null;
  const target = paramsOf(raw.target);
  const tolerance = paramsOf(raw.tolerance);
  const start = paramsOf(raw.start);
  if (!target || !tolerance || !start) return null;
  if (!Array.isArray(raw.matters) || raw.matters.length === 0 || !raw.matters.every(isParamName)) return null;
  const matters = PARAM_NAMES.filter((n) => (raw.matters as unknown[]).includes(n));
  const smile = smileOf(raw.smile);
  if (!smile) return null;

  for (const n of PARAM_NAMES) {
    const sp = specs[n];
    const inRange = (x: number) => x >= sp.min - 1e-9 && x <= sp.max + 1e-9 && isOnGrid(sp, x);
    if (!inRange(target[n]) || !inRange(start[n])) return null;
    if (!(tolerance[n] >= sp.step / 2)) return null;
    // The box must hold at least one reachable slider value.
    const [a, b] = boxOf(sp, target[n], tolerance[n]);
    const first = sp.min + Math.ceil((a - sp.min) / sp.step - 1e-9) * sp.step;
    if (first > b + 1e-9) return null;
    if (matters.includes(n)) {
      if (!(tolerance[n] < (sp.max - sp.min) / 2)) return null;
    } else if (!(target[n] - tolerance[n] <= sp.min + 1e-9 && target[n] + tolerance[n] >= sp.max - 1e-9)) {
      return null;
    }
  }
  // The start must need fixing.
  if (!matters.some((n) => !withinOne(start[n], target[n], tolerance[n]))) return null;
  // Any accepted slider position must give the overlaid curve.
  if (classify(target.nuL, target.nuR, th) !== smile.label) return null;
  for (const c of boxCorners(specs, target, tolerance)) if (classify(c.nuL, c.nuR, th) !== smile.label) return null;

  return {
    id: id.trim(),
    readingId: reading_id.trim(),
    sourceBlock: isStr(raw.source_block) ? raw.source_block.trim() : null,
    title: title.trim(),
    description: description.trim(),
    explanation: explanation.trim(),
    target,
    tolerance,
    start,
    matters,
    smile,
  };
}

/** The whole file: null when the family block is unusable; otherwise every valid item, de-duplicated by id. */
export function parseTailData(extra: unknown): TailData | null {
  if (!isRecord(extra)) return null;
  const specs = parseSpecs(extra.family);
  if (!specs) return null;
  const thresholds = parseThresholds(extra.classification);
  const list = Array.isArray(extra.items) ? extra.items : [];
  const seen = new Set<string>();
  const items: TailItem[] = [];
  for (const raw of list) {
    const item = parseItem(raw, specs, thresholds);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return { specs, thresholds, items };
}
