// Stability measurements for the games screen: the only numbers the game layer shows
// (traps caught/missed by category, items due, objectives covered, sessions played).
import type { CategoryTally, CoverageRow, ItemSrs, Reading, SessionLog, TrapCategory } from './types';
import { TRAP_CATEGORIES } from './types';
import type { Corpus } from './corpus';
import type { RotationInput } from './rotation';
import type { AnyMechanicPlugin } from './arc/plugin';
import { dueCountByReading } from './srs';
import { learningObjectives } from './corpus';

export function categoryTotals(sessions: readonly SessionLog[]): Record<TrapCategory, CategoryTally> {
  const out = Object.fromEntries(TRAP_CATEGORIES.map((c) => [c, { caught: 0, missed: 0 }])) as Record<TrapCategory, CategoryTally>;
  for (const s of sessions) {
    for (const r of s.rounds) {
      if (!r.category) continue;
      if (r.correct) out[r.category].caught++;
      else out[r.category].missed++;
    }
  }
  return out;
}

export interface ReadingCoverage {
  closed: number;
  total: number;
}

export function readingCoverage(r: Reading, coverage: Readonly<Record<string, CoverageRow>>): ReadingCoverage {
  const los = learningObjectives(r);
  return { closed: los.filter((o) => coverage[o.id]).length, total: los.length };
}

export function areaCoverage(readings: readonly Reading[], coverage: Readonly<Record<string, CoverageRow>>): ReadingCoverage {
  let closed = 0;
  let total = 0;
  for (const r of readings) {
    const c = readingCoverage(r, coverage);
    closed += c.closed;
    total += c.total;
  }
  return { closed, total };
}

export function trapsByReading(corpus: Corpus): Record<string, Partial<Record<TrapCategory, number>>> {
  const out: Record<string, Partial<Record<TrapCategory, number>>> = {};
  for (const r of corpus.readings) {
    const m: Partial<Record<TrapCategory, number>> = {};
    for (const t of r.traps) if (t.category) m[t.category] = (m[t.category] ?? 0) + 1;
    out[r.reading_id] = m;
  }
  return out;
}

/** Assembles the pure rotation input from the loaded corpus, the game log and the SRS state. */
export function rotationInput(
  corpus: Corpus,
  sessions: readonly SessionLog[],
  items: Readonly<Record<string, ItemSrs>>,
  mechanics: readonly AnyMechanicPlugin[],
  today: string,
): RotationInput {
  return {
    sessions,
    readings: corpus.readings,
    mechanics: mechanics.map((m) => {
      const cache = new Map<string, boolean>();
      return {
        id: m.id,
        drills: m.drills,
        supports: (rid: string) => {
          let v = cache.get(rid);
          if (v === undefined) {
            const r = corpus.readingById[rid];
            try {
              v = !!r && m.supports(r, corpus);
            } catch {
              v = false;
            }
            cache.set(rid, v);
          }
          return v;
        },
      };
    }),
    dueByReading: dueCountByReading(items as Record<string, ItemSrs>, today),
    trapsByReading: trapsByReading(corpus),
  };
}
