import { sourceKey } from './parse';
import { AREAS, MODES } from './types';
import type { Scenario, SenseArea, SenseMode } from './types';

/**
 * Pure session planning for Sense Check (plan §3d). No React, no stores, no storage: everything the planner
 * needs comes in as arguments, so it runs the same in node tests.
 *
 * Rotation: every session has a featured reading that was not used in the previous session, and every third
 * session is restricted to one area, with the areas taken in turn. Within that constraint, due and weak
 * scenarios come first.
 */

export const SESSION_SECONDS = 180;
export const SESSION_ROUNDS = 10;
/** Mode mix for a full session: direction calls lead, the others split the rest. */
const QUOTA: Record<SenseMode, number> = { direction: 4, magnitude: 3, intermediate: 3 };
/** Sessions kept in the rotation history. */
const HISTORY_KEEP = 24;

// ---- History (the caller persists it; see store.ts) ----

export interface SessionRecord {
  /** 1-based session number. */
  n: number;
  at: string;
  /** The reading the session was built around. */
  featured: string;
  /** Every reading that supplied a round. */
  readings: string[];
  /** Set on every third session: the one area it was restricted to. */
  area: SenseArea | null;
}

export interface SenseHistory {
  /** Sessions started so far (never trimmed; drives the every-third-session rule). */
  count: number;
  /** Most recent last. */
  sessions: SessionRecord[];
}

export const EMPTY_HISTORY: SenseHistory = { count: 0, sessions: [] };

/** Validates a stored history; anything unusable becomes an empty history. */
export function parseHistory(raw: unknown): SenseHistory {
  if (!raw || typeof raw !== 'object') return EMPTY_HISTORY;
  const r = raw as Record<string, unknown>;
  const sessions: SessionRecord[] = [];
  for (const s of Array.isArray(r.sessions) ? r.sessions : []) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    if (typeof o.featured !== 'string') continue;
    sessions.push({
      n: typeof o.n === 'number' ? o.n : 0,
      at: typeof o.at === 'string' ? o.at : '',
      featured: o.featured,
      readings: Array.isArray(o.readings) ? o.readings.filter((x): x is string => typeof x === 'string') : [o.featured],
      area: typeof o.area === 'string' && (AREAS as string[]).includes(o.area) ? (o.area as SenseArea) : null,
    });
  }
  const count = typeof r.count === 'number' && Number.isFinite(r.count) && r.count >= 0 ? Math.floor(r.count) : sessions.length;
  return { count: Math.max(count, sessions.length ? sessions[sessions.length - 1].n : 0), sessions: sessions.slice(-HISTORY_KEEP) };
}

export function withSession(history: SenseHistory, record: SessionRecord): SenseHistory {
  return { count: Math.max(history.count, record.n), sessions: [...history.sessions, record].slice(-HISTORY_KEEP) };
}

// ---- Progress (the subset of GymState the planner reads) ----

export interface ItemProgress {
  dueDate: string | null;
  lastResult: 'correct' | 'wrong' | null;
  totalCorrect: number;
  totalWrong: number;
}

/** Higher = more worth playing now. Tiers: due (4–5), weak (3), unseen (2), seen and not due (1). */
export function priorityTier(p: ItemProgress | undefined, today: string): number {
  if (!p || p.totalCorrect + p.totalWrong === 0) return 2;
  const weak = p.lastResult === 'wrong' || p.totalWrong > p.totalCorrect;
  if (p.dueDate && p.dueDate <= today) return weak ? 5 : 4;
  return weak ? 3 : 1;
}

// ---- Planning ----

export interface SessionPlan {
  rounds: Scenario[];
  featured: string;
  area: SenseArea | null;
  readings: string[];
  n: number;
}

export interface PlanOptions {
  today: string;
  rng?: () => number;
  rounds?: number;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function distinctSources(items: Scenario[]): number {
  return new Set(items.map(sourceKey)).size;
}

/** The area for an area-only session: the next area (in AREAS order) after the last area session's, among playable ones. */
export function nextArea(scenarios: Scenario[], history: SenseHistory, minRounds: number): SenseArea | null {
  const byArea = new Map<SenseArea, Scenario[]>();
  for (const s of scenarios) byArea.set(s.area, [...(byArea.get(s.area) ?? []), s]);
  let playable = AREAS.filter((a) => distinctSources(byArea.get(a) ?? []) >= minRounds);
  if (playable.length === 0) playable = AREAS.filter((a) => (byArea.get(a) ?? []).length > 0);
  if (playable.length === 0) return null;
  const last = [...history.sessions].reverse().find((s) => s.area)?.area ?? null;
  if (!last) return playable[0];
  const start = AREAS.indexOf(last);
  for (let k = 1; k <= AREAS.length; k++) {
    const a = AREAS[(start + k) % AREAS.length];
    if (playable.includes(a)) return a;
  }
  return playable[0];
}

/** Sessions since `reading` was last featured (Infinity if never). */
function featuredAgo(reading: string, history: SenseHistory): number {
  for (let i = history.sessions.length - 1; i >= 0; i--) if (history.sessions[i].featured === reading) return history.sessions.length - i;
  return Infinity;
}

/** Orders rounds so the same mode rarely comes twice in a row, in an order that differs from session to session. */
export function interleave(rounds: Scenario[], rng: () => number): Scenario[] {
  const left = shuffle(rounds, rng);
  const out: Scenario[] = [];
  while (left.length > 0) {
    const prev = out[out.length - 1]?.mode;
    const remaining = (m: SenseMode) => left.filter((s) => s.mode === m).length;
    const candidates = MODES.filter((m) => m !== prev && remaining(m) > 0);
    // A mode holding more than half of what's left must go now, or it bunches up at the end.
    const pressing = candidates.find((m) => remaining(m) * 2 > left.length);
    let mode: SenseMode | undefined = pressing;
    if (!mode && candidates.length > 0) {
      // Otherwise pick at random, weighted by how many of each mode are left.
      let x = rng() * candidates.reduce((sum, m) => sum + remaining(m), 0);
      mode = candidates.find((m) => (x -= remaining(m)) < 0) ?? candidates[candidates.length - 1];
    }
    const i = left.findIndex((s) => s.mode === (mode ?? prev));
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

/**
 * Plans the next session, or null when there is nothing to play. The caller records the returned plan in the
 * history (`withSession`) when the session starts.
 */
export function planSession(
  scenarios: Scenario[],
  progress: Record<string, ItemProgress | undefined>,
  history: SenseHistory,
  options: PlanOptions,
): SessionPlan | null {
  const rng = options.rng ?? Math.random;
  const size = options.rounds ?? SESSION_ROUNDS;
  if (scenarios.length === 0) return null;
  const n = history.count + 1;
  const area = n % 3 === 0 ? nextArea(scenarios, history, Math.ceil(size / 2)) : null;
  const pool = area ? scenarios.filter((s) => s.area === area) : scenarios;
  if (pool.length === 0) return null;

  const last = history.sessions[history.sessions.length - 1];
  const lastReadings = new Set(last?.readings ?? []);

  // Per-scenario priority with jitter, so equal tiers vary between sessions.
  const score = new Map<string, number>();
  for (const s of pool) score.set(s.id, priorityTier(progress[s.id], options.today) + rng() * 0.9);

  const byReading = new Map<string, Scenario[]>();
  for (const s of pool) byReading.set(s.reading, [...(byReading.get(s.reading) ?? []), s]);
  for (const list of byReading.values()) list.sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0));

  // Rotation first: readings featured longest ago (or never) lead. A reading's due and weak scenarios pull it
  // forward (each worth about a session and a half of waiting, up to five), and unseen ones a little; chance breaks ties.
  const need = (reading: string) => {
    let dueWeak = 0;
    let unseen = 0;
    for (const s of byReading.get(reading) ?? []) {
      const t = priorityTier(progress[s.id], options.today);
      if (t >= 3) dueWeak++;
      else if (t === 2) unseen++;
    }
    return Math.min(dueWeak, 5) * 1.5 + (unseen > 0 ? 1 : 0);
  };
  const recencyCap = Math.max(3, Math.min(20, byReading.size));
  const readingRank = new Map<string, number>();
  for (const r of byReading.keys()) readingRank.set(r, Math.min(featuredAgo(r, history), recencyCap) + need(r) + rng());
  const byRank = (a: string, b: string) => (readingRank.get(b) ?? 0) - (readingRank.get(a) ?? 0);

  const readings = [...byReading.keys()];
  // Featured: never a reading from the last session when another exists; failing that, not last session's featured one.
  const fresh = readings.filter((r) => !lastReadings.has(r));
  const notLastFeatured = readings.filter((r) => r !== last?.featured);
  const featuredPool = fresh.length > 0 ? fresh : notLastFeatured.length > 0 ? notLastFeatured : readings;
  const featured = [...featuredPool].sort(byRank)[0];

  // Fill order: the featured reading, then fresh readings, then last session's.
  const order = [
    featured,
    ...readings.filter((r) => r !== featured && !lastReadings.has(r)).sort(byRank),
    ...readings.filter((r) => r !== featured && lastReadings.has(r)).sort(byRank),
  ];

  const quota: Record<SenseMode, number> = { ...QUOTA };
  // Scale the quota for shorter sessions (tests, tiny decks) while keeping all three modes.
  if (size !== SESSION_ROUNDS) {
    const total = QUOTA.direction + QUOTA.magnitude + QUOTA.intermediate;
    for (const m of MODES) quota[m] = Math.max(1, Math.round((QUOTA[m] * size) / total));
  }
  const picked: Scenario[] = [];
  const usedSources = new Set<string>();
  const usedIds = new Set<string>();
  const take = (s: Scenario) => {
    picked.push(s);
    usedIds.add(s.id);
    usedSources.add(sourceKey(s));
    quota[s.mode]--;
  };
  const tierOf = (s: Scenario) => priorityTier(progress[s.id], options.today);
  // The featured reading always supplies the first round, even when none of its scenarios is due.
  const lead = byReading.get(featured)?.[0];
  if (lead) take(lead);
  // Pass 1 keeps the mode mix and skips scenarios already seen and not due, so a due or weak scenario from a later
  // reading beats a merely-seen one from an earlier reading; pass 2 lets those in; pass 3 tops up whatever the mix
  // couldn't fill.
  const passes: { respectQuota: boolean; minTier: number }[] = [
    { respectQuota: true, minTier: 2 },
    { respectQuota: true, minTier: 0 },
    { respectQuota: false, minTier: 0 },
  ];
  for (const { respectQuota, minTier } of passes) {
    for (const r of order) {
      for (const s of byReading.get(r) ?? []) {
        if (picked.length >= size) break;
        // Rounds built on the same question would give each other's answers away.
        if (usedIds.has(s.id) || usedSources.has(sourceKey(s))) continue;
        if (respectQuota && quota[s.mode] <= 0) continue;
        if (tierOf(s) < minTier) continue;
        take(s);
      }
    }
  }
  if (picked.length === 0) return null;

  const used = [...new Set(picked.map((s) => s.reading))];
  return { rounds: interleave(picked, rng), featured, area, readings: used, n };
}

// ---- Counts ----

export interface ModeCount {
  correct: number;
  total: number;
}

export function countByMode(results: { mode: SenseMode; correct: boolean }[]): Record<SenseMode, ModeCount> {
  const out = { direction: { correct: 0, total: 0 }, magnitude: { correct: 0, total: 0 }, intermediate: { correct: 0, total: 0 } };
  for (const r of results) {
    out[r.mode].total++;
    if (r.correct) out[r.mode].correct++;
  }
  return out;
}

/** Lifetime counts from gym attempts logged by Sense Check (`measure` holds the mode). */
export function lifetimeByMode(attempts: { game: string; measure?: string; correct: boolean }[]): Record<SenseMode, ModeCount> {
  const rows: { mode: SenseMode; correct: boolean }[] = [];
  for (const a of attempts) {
    if (a.game === 'sense-check' && (MODES as string[]).includes(a.measure ?? '')) rows.push({ mode: a.measure as SenseMode, correct: a.correct });
  }
  return countByMode(rows);
}
