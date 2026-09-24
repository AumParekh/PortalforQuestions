import type { Question, QuestionState, SessionConfig, SessionFilters } from '../types';
import { resolveSelection } from './catalog';
import { getSearchIndex, search } from './search';

const TABLE_ROW = /^\s*\|.*\|\s*$/m;

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const shapeCache = new WeakMap<Question, { table: boolean; formula: boolean }>();

function shapeOf(q: Question): { table: boolean; formula: boolean } {
  let s = shapeCache.get(q);
  if (!s) {
    s = {
      table: TABLE_ROW.test(q.question) || TABLE_ROW.test(q.solution),
      formula: q.question.includes('$') || q.solution.includes('$'),
    };
    shapeCache.set(q, s);
  }
  return s;
}

export function hasActiveFilters(f: SessionFilters | undefined): boolean {
  if (!f) return false;
  return (
    f.status.length > 0 ||
    f.trapOperators.length > 0 ||
    f.hasTrap !== null ||
    f.hasTable !== null ||
    f.hasFormula !== null ||
    f.timeTarget.length > 0 ||
    f.minCorrect > 0 ||
    f.minWrong > 0
  );
}

/** Ids matching a free-text search, or null when the query is empty (no constraint). */
export function searchHits(query: string | undefined, questions: Question[]): Set<string> | null {
  const ids = query ? search(query, getSearchIndex(questions)) : null;
  return ids ? new Set(ids) : null;
}

export function matchesFilters(q: Question, s: QuestionState | undefined, f: SessionFilters, today = localToday()): boolean {
  const attempted = !!s && s.totalAttempts > 0;
  if (f.status.length > 0) {
    const hit = f.status.some((st) => {
      switch (st) {
        case 'new':
          return !attempted;
        case 'wrong-last':
          return s?.lastResult === 'wrong';
        case 'marked':
          return !!s?.markedForReview;
        case 'due':
          return !!s?.dueDate && s.dueDate.slice(0, 10) <= today;
      }
    });
    if (!hit) return false;
  }
  if (f.trapOperators.length > 0 && !f.trapOperators.some((op) => q.trap.operators.includes(op))) return false;
  if (f.hasTrap !== null && q.trap.operators.length > 0 !== f.hasTrap) return false;
  if (f.hasTable !== null || f.hasFormula !== null) {
    const shape = shapeOf(q);
    if (f.hasTable !== null && shape.table !== f.hasTable) return false;
    if (f.hasFormula !== null && shape.formula !== f.hasFormula) return false;
  }
  if (f.timeTarget.length > 0) {
    if (!s || !attempted) return false;
    const t = s.avgTimeSeconds;
    const bucket = t < 30 ? 'fast' : t <= 60 ? 'medium' : 'slow';
    if (!f.timeTarget.includes(bucket)) return false;
  }
  if (f.minCorrect > 0 && (s?.totalCorrect ?? 0) < f.minCorrect) return false;
  if (f.minWrong > 0 && (s?.totalWrong ?? 0) < f.minWrong) return false;
  return true;
}

/** Scope selection, then search, then structured filters, then trap-only; source order is preserved. */
export function filterPool(config: SessionConfig, questions: Question[], states: Record<string, QuestionState>): Question[] {
  const selected = new Set(resolveSelection(questions, config.scopeKind, config.selectedKeys));
  const hits = searchHits(config.searchQuery, questions);
  const filters = hasActiveFilters(config.filters) ? config.filters : undefined;
  const today = localToday();
  return questions.filter(
    (q) =>
      selected.has(q.id) &&
      (!hits || hits.has(q.id)) &&
      (!filters || matchesFilters(q, states[q.id], filters, today)) &&
      (!config.trapOnly || q.trap.operators.length > 0),
  );
}

export function countAvailable(config: SessionConfig, questions: Question[], states: Record<string, QuestionState>): number {
  return filterPool(config, questions, states).length;
}

// Never-attempted questions sit mid-table so brand-new material mixes in with known weak spots.
function weaknessScore(s: QuestionState | undefined): number {
  return s && s.totalAttempts > 0 ? s.totalCorrect / s.totalAttempts : 0.5;
}

export function buildQueue(config: SessionConfig, questions: Question[], states: Record<string, QuestionState>): string[] {
  let ids = filterPool(config, questions, states).map((q) => q.id);

  switch (config.order) {
    case 'shuffled':
    case 'random':
      ids = shuffle(ids);
      break;
    case 'weakest': {
      const score = new Map(ids.map((id) => [id, weaknessScore(states[id])]));
      ids = [...ids].sort((a, b) => (score.get(a) ?? 0.5) - (score.get(b) ?? 0.5));
      break;
    }
    case 'sequential':
      break;
  }

  if (config.wrongFirst) {
    const wrong = ids.filter((id) => states[id]?.lastResult === 'wrong');
    if (wrong.length > 0) ids = [...wrong, ...ids.filter((id) => states[id]?.lastResult !== 'wrong')];
  }

  return config.count === 'all' ? ids : ids.slice(0, Math.max(0, config.count));
}
