// Frontier Rider: defensive reading of corpus.extras['frontier-rider'] (curated, validated offline
// by tools/games/validate_frontier-rider.py). Malformed items are dropped one by one. Every kept
// item is re-solved here with the same maths (maths.ts). An item is dropped when the engine
// disagrees with the curated answer: the correct option's move, a distractor that has the true
// move, a stored from/to point more than 1e-3 away, or a path that doubles back. A bad edit to
// the JSON can remove a round but can never ship one with the wrong answer. Pure; no React.
import type { Compass, Inputs, MoveCode, Path, PointKind, SliderParam, Win } from './maths';
import {
  POINT_KINDS,
  calTilt,
  isMoveCode,
  jumpTarget,
  loupeWindow,
  mainWindow,
  needsLoupe,
  paramValue,
  parseParam,
  riderOf,
  sliderGrid,
  tracePath,
} from './maths';

export const MECHANIC_KEY = 'frontier-rider';

export interface FrAsset {
  name: string;
  /** Short chart label: the name without a trailing parenthetical. */
  short: string;
  mu: number;
  sigma: number;
}

export interface FrOptionData {
  label: string;
  correct: boolean;
  why: string;
  move: MoveCode;
}

export interface FrSlider {
  param: SliderParam;
  paramText: string;
  label: string;
  from: number;
  to: number;
  step: number;
}

export interface FrPlane {
  xLabel: string;
  yLabel: string;
  /** Full label for the risk-free point, e.g. "benchmark (0 active return, 0 TEV)". */
  rfLabel: string;
  /** Short name: "risk-free asset" or "benchmark". */
  rfName: string;
  /** Active space: the risk-free asset is the benchmark, sigma is TEV, Sharpe is IR. */
  active: boolean;
}

export interface FrItem {
  id: string;
  readingId: string;
  sourceBlock: string | null;
  sourceLine: number | null;
  title: string;
  question: string;
  explanation: string;
  assets: FrAsset[];
  base: Inputs;
  point: PointKind;
  slider: FrSlider;
  options: FrOptionData[];
  plane: FrPlane;
  /** Curated CAL tilt, kept only when the engine agrees; null for min-variance points. */
  calSlope: 'steeper' | 'flatter' | 'same' | null;
  /** Solved at every slider step. */
  path: Path;
  /** The correct move (== path.move). */
  move: Compass;
  main: Win;
  /** Close-up window when the move is too small to see in the full plane. */
  loupe: Win | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const DEFAULT_PLANE = { x: 'volatility (% per year)', y: 'expected return (% per year)', rf: 'risk-free asset' };

export function shortName(name: string): string {
  const s = name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return s || name.trim();
}

function assetOf(v: unknown): FrAsset | null {
  if (!isRecord(v) || !isStr(v.name) || !isNum(v.mu) || !isNum(v.sigma)) return null;
  if (!(v.sigma > 0 && v.sigma < 100 && v.mu > -50 && v.mu < 100)) return null;
  return { name: v.name.trim(), short: shortName(v.name), mu: v.mu, sigma: v.sigma };
}

function corrOf(v: unknown, n: number): number[][] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  const rows: number[][] = [];
  for (const r of v) {
    if (!Array.isArray(r) || r.length !== n || !r.every(isNum)) return null;
    rows.push(r.map(Number));
  }
  for (let i = 0; i < n; i++) {
    if (rows[i][i] !== 1) return null;
    for (let j = 0; j < n; j++) {
      if (rows[i][j] !== rows[j][i]) return null;
      if (i !== j && !(rows[i][j] > -1 && rows[i][j] < 1)) return null;
    }
  }
  return rows;
}

function optionOf(v: unknown): FrOptionData | null {
  if (!isRecord(v) || !isStr(v.label) || typeof v.correct !== 'boolean' || !isStr(v.why) || typeof v.move !== 'string') return null;
  if (!isMoveCode(v.move)) return null;
  return { label: v.label.trim(), correct: v.correct, why: v.why.trim(), move: v.move };
}

function planeOf(v: unknown): FrPlane {
  const r = isRecord(v) ? v : {};
  const xLabel = isStr(r.x_label) ? r.x_label.trim() : DEFAULT_PLANE.x;
  const yLabel = isStr(r.y_label) ? r.y_label.trim() : DEFAULT_PLANE.y;
  const rfLabel = isStr(r.rf_label) ? r.rf_label.trim() : DEFAULT_PLANE.rf;
  const active = /benchmark/i.test(rfLabel);
  return { xLabel, yLabel, rfLabel, rfName: shortName(rfLabel), active };
}

/** Type guard + normaliser for one curated item; null when anything is off. */
export function parseItem(raw: unknown): FrItem | null {
  if (!isRecord(raw)) return null;
  const { id, reading_id, title, question, explanation, point, rf } = raw;
  if (!isStr(id) || !isStr(reading_id) || !isStr(title) || !isStr(question) || !isStr(explanation)) return null;
  if (typeof point !== 'string' || !(POINT_KINDS as readonly string[]).includes(point) || !isNum(rf) || !(rf >= -5 && rf < 20)) return null;
  const kind = point as PointKind;
  if (!Array.isArray(raw.assets) || raw.assets.length < 2 || raw.assets.length > 4) return null;
  const assets = raw.assets.map(assetOf);
  if (assets.some((a) => a === null)) return null;
  const as = assets as FrAsset[];
  const n = as.length;
  const corr = corrOf(raw.corr, n);
  if (!corr) return null;
  let A: number | null = null;
  if (kind === 'complete') {
    if (!isNum(raw.A) || !(raw.A > 0)) return null;
    A = raw.A;
  }
  const base: Inputs = { mu: as.map((a) => a.mu), sigma: as.map((a) => a.sigma), corr, rf, A };

  // Slider
  const sl = raw.slider;
  if (!isRecord(sl) || typeof sl.param !== 'string' || !isStr(sl.label) || !isNum(sl.from) || !isNum(sl.to) || !isNum(sl.step)) return null;
  const param = parseParam(sl.param, n);
  if (!param || (param.kind === 'A' && kind !== 'complete')) return null;
  const grid = sliderGrid(sl.from, sl.to, sl.step);
  if (!grid) return null;
  const bv = paramValue(base, param);
  if (bv === null || Math.abs(bv - sl.from) > 1e-12) return null;
  const slider: FrSlider = { param, paramText: sl.param, label: sl.label.trim(), from: sl.from, to: sl.to, step: sl.step };

  // Options: 3-4, exactly one correct, distinct labels and moves.
  if (!Array.isArray(raw.options) || raw.options.length < 3 || raw.options.length > 4) return null;
  const opts = raw.options.map(optionOf);
  if (opts.some((o) => o === null)) return null;
  const options = opts as FrOptionData[];
  if (options.filter((o) => o.correct).length !== 1) return null;
  if (new Set(options.map((o) => o.label)).size !== options.length || new Set(options.map((o) => o.move)).size !== options.length) return null;

  // Live re-solve: PD and a defined point at every step, the curated answer matches the engine.
  const path = tracePath(base, param, grid, kind);
  if (!path || !path.monotone) return null;
  const correct = options.find((o) => o.correct)!;
  if (correct.move !== path.move) return null;
  const p0 = path.points[0];
  const p1 = path.points[path.points.length - 1];
  const s1 = path.states[path.states.length - 1];
  for (const o of options) {
    if (o.correct) continue;
    if (o.move === path.move) return null;
    if (o.move === 'to-min-variance' || o.move === 'to-tangency' || o.move === 'to-rf') {
      const dest = jumpTarget(s1, o.move);
      if (dest && Math.hypot(dest.sigma - p1.sigma, dest.mu - p1.mu) < 0.05) return null;
    }
  }
  const ans = raw.answer;
  if (isRecord(ans)) {
    for (const [tag, pt] of [
      ['from', p0],
      ['to', p1],
    ] as const) {
      const st = ans[tag];
      if (!isRecord(st)) continue;
      if ((isNum(st.sigma) && Math.abs(st.sigma - pt.sigma) > 1e-3) || (isNum(st.mu) && Math.abs(st.mu - pt.mu) > 1e-3)) return null;
    }
  }
  let calSlope: FrItem['calSlope'] = null;
  if (kind !== 'min-variance' && typeof raw.cal_slope === 'string') {
    const tilt = calTilt(path.states[0], s1);
    if (tilt && tilt === raw.cal_slope) calSlope = tilt;
  }
  // The point must also be defined for the plane to draw it (riderOf checked on every step above).
  if (!riderOf(path.states[0], kind)) return null;

  const main = mainWindow(path);
  return {
    id: id.trim(),
    readingId: reading_id.trim(),
    sourceBlock: isStr(raw.source_block) ? raw.source_block.trim() : null,
    sourceLine: isNum(raw.source_line) ? raw.source_line : null,
    title: title.trim(),
    question: question.trim(),
    explanation: explanation.trim(),
    assets: as,
    base,
    point: kind,
    slider,
    options,
    plane: planeOf(raw.plane),
    calSlope,
    path,
    move: path.move,
    main,
    loupe: needsLoupe(path, main) ? loupeWindow(path, main) : null,
  };
}

/** All valid items, de-duplicated by id (first wins). */
export function parseFrontierData(extra: unknown): FrItem[] {
  const list = isRecord(extra) && Array.isArray(extra.items) ? extra.items : Array.isArray(extra) ? extra : [];
  const seen = new Set<string>();
  const out: FrItem[] = [];
  for (const raw of list) {
    const item = parseItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
