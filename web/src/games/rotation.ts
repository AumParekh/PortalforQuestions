// Session rotation (brief §9.1–9.2, §12.3–12.4). Pure functions over the game log so they can be
// unit-tested in node.
import type { MechanicId, TrapCategory } from './types';
import { TRAP_CATEGORIES } from './types';

export const RECENT_WINDOW = 3;
/** "A category missed more than twice in a row" → three consecutive misses. */
export const PRIORITY_STREAK = 3;

/** The part of a logged session rotation reads. Sessions are ordered oldest → newest. */
export interface RotationSession {
  mechanic: MechanicId;
  readingId: string;
  rounds: readonly { category?: TrapCategory; correct: boolean }[];
  /** The logged "#N"; when present the next session is numbered after the highest (as the log numbers it). */
  number?: number;
}

export interface RotationReading {
  reading_id: string;
  src?: number | null;
  mechanics_supported?: readonly string[];
}

export interface RotationMechanic {
  id: MechanicId;
  supports: (readingId: string) => boolean;
  /** Trap categories this mechanic drills well; used when a category becomes the priority. */
  drills?: readonly TrapCategory[];
}

export interface RotationInput {
  sessions: readonly RotationSession[];
  /** Readings in their stable display order. */
  readings: readonly RotationReading[];
  /** Playable (registered) mechanics, in catalogue order. */
  mechanics: readonly RotationMechanic[];
  /** Due SRS items per reading. */
  dueByReading?: Readonly<Record<string, number>>;
  /** Trap counts per reading per category, for steering a priority category to a reading rich in it. */
  trapsByReading?: Readonly<Record<string, Partial<Record<TrapCategory, number>>>>;
  namedReading?: string | null;
  namedMechanic?: MechanicId | null;
}

export type RotationReason =
  | 'named-reading'
  | 'named-mechanic'
  | 'every-20th'
  | 'every-10th'
  | 'every-5th'
  | 'priority-category'
  | 'longest-drought';

export interface RotationChoice {
  mechanic: MechanicId;
  readingId: string;
  reason: RotationReason;
  /** The number this session will carry in the log (#N). */
  sessionNumber: number;
  priorityCategory: TrapCategory | null;
  /** Rotation constraints that had to be relaxed because nothing else was playable. */
  relaxed: ('mechanic-repeat' | 'reading-repeat')[];
  last: { mechanic: MechanicId; readingId: string } | null;
}

export function recentMechanics(sessions: readonly RotationSession[], n = RECENT_WINDOW): MechanicId[] {
  return sessions.slice(-n).map((s) => s.mechanic);
}

export function recentReadings(sessions: readonly RotationSession[], n = RECENT_WINDOW): string[] {
  return sessions.slice(-n).map((s) => s.readingId);
}

/** Sessions since each mechanic was last played; never played → Infinity. */
export function droughts(sessions: readonly RotationSession[], ids: readonly MechanicId[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    let d = Infinity;
    for (let i = sessions.length - 1; i >= 0; i--) {
      if (sessions[i].mechanic === id) {
        d = sessions.length - 1 - i;
        break;
      }
    }
    out[id] = d;
  }
  return out;
}

/** Current run of consecutive misses per trap category, across sessions in play order. */
export function missStreaks(sessions: readonly RotationSession[]): Record<TrapCategory, number> {
  const streak = Object.fromEntries(TRAP_CATEGORIES.map((c) => [c, 0])) as Record<TrapCategory, number>;
  for (const s of sessions) {
    for (const r of s.rounds) {
      if (!r.category) continue;
      streak[r.category] = r.correct ? 0 : streak[r.category] + 1;
    }
  }
  return streak;
}

/** The category with the longest current miss streak of at least PRIORITY_STREAK, if any. */
export function priorityCategory(sessions: readonly RotationSession[]): TrapCategory | null {
  const streaks = missStreaks(sessions);
  let best: TrapCategory | null = null;
  for (const c of TRAP_CATEGORIES) {
    if (streaks[c] >= PRIORITY_STREAK && (best === null || streaks[c] > streaks[best])) best = c;
  }
  return best;
}

/** Every 20th session Coverage View, every 10th Case Docket, every 5th Concept Inventory. */
export function scheduledMechanic(sessionNumber: number): { id: MechanicId; reason: RotationReason } | null {
  if (sessionNumber % 20 === 0) return { id: 'coverage-view', reason: 'every-20th' };
  if (sessionNumber % 10 === 0) return { id: 'case-docket', reason: 'every-10th' };
  if (sessionNumber % 5 === 0) return { id: 'concept-inventory', reason: 'every-5th' };
  return null;
}

/**
 * Best reading for a mechanic: readings with due SRS items first; then readings not yet played
 * with this mechanic (so rotation sweeps the corpus instead of cycling the top few); then highest
 * SRC, most due items, widest mechanics_supported, display order. With a focus category, the
 * reading richest in that category's traps leads.
 */
export function rankReadings(
  readings: readonly RotationReading[],
  dueByReading: Readonly<Record<string, number>> = {},
  focus: { category: TrapCategory; trapsByReading: Readonly<Record<string, Partial<Record<TrapCategory, number>>>> } | null = null,
  playedWithMechanic: ReadonlySet<string> = new Set(),
): RotationReading[] {
  const order = new Map(readings.map((r, i) => [r.reading_id, i]));
  const focusCount = (r: RotationReading) => (focus ? (focus.trapsByReading[r.reading_id]?.[focus.category] ?? 0) : 0);
  return [...readings].sort((a, b) => {
    const da = dueByReading[a.reading_id] ?? 0;
    const db = dueByReading[b.reading_id] ?? 0;
    return (
      focusCount(b) - focusCount(a) ||
      Number(db > 0) - Number(da > 0) ||
      Number(playedWithMechanic.has(a.reading_id)) - Number(playedWithMechanic.has(b.reading_id)) ||
      (b.src ?? 0) - (a.src ?? 0) ||
      db - da ||
      (b.mechanics_supported?.length ?? 0) - (a.mechanics_supported?.length ?? 0) ||
      (order.get(a.reading_id) ?? 0) - (order.get(b.reading_id) ?? 0)
    );
  });
}

/** Mechanics ordered longest drought first; never-played first of all; ties keep catalogue order. */
export function byDrought(sessions: readonly RotationSession[], mechanics: readonly RotationMechanic[]): RotationMechanic[] {
  const d = droughts(
    sessions,
    mechanics.map((m) => m.id),
  );
  return mechanics
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const x = d[a.m.id];
      const y = d[b.m.id];
      if (x !== y) return x === Infinity ? -1 : y === Infinity ? 1 : y - x;
      return a.i - b.i;
    })
    .map((e) => e.m);
}

// Strict first; then let a mechanic repeat (few mechanics built); then a reading; then both.
const RELAXATIONS: [boolean, boolean][] = [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
];

function relaxedList(relaxM: boolean, relaxR: boolean): RotationChoice['relaxed'] {
  const out: RotationChoice['relaxed'] = [];
  if (relaxM) out.push('mechanic-repeat');
  if (relaxR) out.push('reading-repeat');
  return out;
}

/** Picks the next session's mechanic and reading. Returns null when nothing is playable. */
export function chooseSession(input: RotationInput): RotationChoice | null {
  const { sessions, readings, mechanics } = input;
  const due = input.dueByReading ?? {};
  // Same numbering the session log uses (highest #N + 1), so "session #10 is a tenth" matches the
  // GAME LOG line even if an import left gaps.
  const sessionNumber = sessions.reduce((n, s, i) => Math.max(n, typeof s.number === 'number' ? s.number : i + 1), 0) + 1;
  const lastS = sessions[sessions.length - 1];
  const last = lastS ? { mechanic: lastS.mechanic, readingId: lastS.readingId } : null;
  const recentM = new Set(recentMechanics(sessions));
  const recentR = new Set(recentReadings(sessions));
  const priority = priorityCategory(sessions);
  const make = (
    mechanic: MechanicId,
    readingId: string,
    reason: RotationReason,
    relaxed: RotationChoice['relaxed'] = [],
  ): RotationChoice => ({ mechanic, readingId, reason, sessionNumber, priorityCategory: priority, relaxed, last });

  if (mechanics.length === 0 || readings.length === 0) return null;

  const pickReading = (m: RotationMechanic, relaxR: boolean, focus: TrapCategory | null): string | null => {
    const pool = readings.filter((r) => m.supports(r.reading_id) && (relaxR || !recentR.has(r.reading_id)));
    const played = new Set(sessions.filter((s) => s.mechanic === m.id).map((s) => s.readingId));
    const ranked = rankReadings(
      pool,
      due,
      focus && input.trapsByReading ? { category: focus, trapsByReading: input.trapsByReading } : null,
      played,
    );
    return ranked[0]?.reading_id ?? null;
  };

  // A named reading is honoured even if it was played recently.
  if (input.namedReading) {
    const rid = input.namedReading;
    if (!readings.some((r) => r.reading_id === rid)) return null;
    if (input.namedMechanic) {
      const m = mechanics.find((x) => x.id === input.namedMechanic);
      return m && m.supports(rid) ? make(m.id, rid, 'named-mechanic') : null;
    }
    const sched = scheduledMechanic(sessionNumber);
    const schedM = sched && mechanics.find((m) => m.id === sched.id && m.supports(rid));
    if (sched && schedM) return make(schedM.id, rid, sched.reason);
    const ordered = byDrought(sessions, mechanics).filter((m) => m.supports(rid));
    const fresh = ordered.find((m) => !recentM.has(m.id));
    if (fresh) return make(fresh.id, rid, 'named-reading');
    return ordered[0] ? make(ordered[0].id, rid, 'named-reading', ['mechanic-repeat']) : null;
  }

  if (input.namedMechanic) {
    const m = mechanics.find((x) => x.id === input.namedMechanic);
    if (!m) return null;
    for (const relaxR of [false, true]) {
      const rid = pickReading(m, relaxR, priority);
      if (rid) return make(m.id, rid, 'named-mechanic', relaxedList(false, relaxR));
    }
    return null;
  }

  const sched = scheduledMechanic(sessionNumber);
  const schedM = sched ? mechanics.find((m) => m.id === sched.id) : undefined;
  if (sched && schedM) {
    for (const relaxR of [false, true]) {
      const rid = pickReading(schedM, relaxR, priority);
      if (rid) return make(schedM.id, rid, sched.reason, relaxedList(false, relaxR));
    }
  }

  const ordered = byDrought(sessions, mechanics);

  if (priority) {
    // The priority steers which mechanic and reading come next, but never overrides the no-repeat
    // rules (§12.4) while something else is playable: only drillers not played in the last three
    // sessions, on readings not played in the last three. Otherwise the general pass below runs,
    // and build() still weights the category up through ctx.priorityCategory.
    for (const m of ordered) {
      if (!m.drills?.includes(priority) || recentM.has(m.id)) continue;
      const rid = pickReading(m, false, priority);
      if (rid) return make(m.id, rid, 'priority-category');
    }
  }

  for (const [relaxM, relaxR] of RELAXATIONS) {
    for (const m of ordered) {
      if (!relaxM && recentM.has(m.id)) continue;
      const rid = pickReading(m, relaxR, null);
      if (rid) return make(m.id, rid, 'longest-drought', relaxedList(relaxM, relaxR));
    }
  }
  return null;
}
