import type { Question } from '../types';

export interface SearchEntry {
  id: string;
  topic: string;
  lo: string;
  subject: string;
  searchable: string;
}

// Keyed by the question array itself, so each screen's list is indexed once and reused.
const cache = new WeakMap<Question[], SearchEntry[]>();

/** Built once per loaded question array and reused; never rebuilt per keystroke. */
export function getSearchIndex(questions: Question[]): SearchEntry[] {
  const hit = cache.get(questions);
  if (hit) return hit;
  const index = questions.map((q) => ({
    id: q.id,
    topic: q.topic,
    lo: q.lo,
    subject: q.subject,
    searchable: [
      q.topic,
      // The LO id as printed ("MR-2 c") and without the space ("MR-2c"), and the priority band ("P1").
      q.lo,
      q.lo.replace(' ', ''),
      q.band ?? '',
      q.loText,
      q.reading,
      q.source ?? '',
      q.question,
      ...q.options.map((o) => o.text),
      q.solution,
      ...q.trap.operators,
      ...q.trap.operators.map((o) => o.replace(/-/g, ' ')),
    ]
      .join(' \u0000 ')
      .toLowerCase(),
  }));
  cache.set(questions, index);
  return index;
}

/** "MR-2 c", "mr2c", "MR 2.c" (one LO) or "MR-2" (a whole chapter). */
const LO_QUERY = /^([a-z]{2,3})[-\s]?(\d{1,2})(?:[\s.]?([a-z]))?$/;

/** True when the query is an LO or chapter code rather than words to look for. */
export function isCodeQuery(query: string): boolean {
  return LO_QUERY.test(query.toLowerCase().trim());
}

/**
 * Case-insensitive substring AND-match over every term. A query that is an LO or chapter code matches the questions
 * tagged with it instead (falling back to the text match when no question carries that code).
 * Returns ids in source order, or null for an empty query.
 */
export function search(query: string, index: SearchEntry[]): string[] | null {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
  const code = LO_QUERY.exec(query.toLowerCase().trim());
  if (code) {
    const prefix = `${code[1]}-${code[2]} `;
    const hits = index.filter((e) => {
      const lo = e.lo.toLowerCase();
      return code[3] ? lo === prefix + code[3] : lo.startsWith(prefix);
    });
    if (hits.length > 0) return hits.map((e) => e.id);
  }
  return index.filter((e) => terms.every((t) => e.searchable.includes(t))).map((e) => e.id);
}

export function topTopics(ids: string[], index: SearchEntry[], limit = 3): { topic: string; subject: string; count: number }[] {
  const wanted = new Set(ids);
  const counts = new Map<string, { topic: string; subject: string; count: number }>();
  for (const e of index) {
    if (!wanted.has(e.id)) continue;
    const key = `${e.subject}::${e.topic}`;
    const c = counts.get(key) ?? { topic: e.topic, subject: e.subject, count: 0 };
    c.count++;
    counts.set(key, c);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
