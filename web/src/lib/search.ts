import type { Question } from '../types';

export interface SearchEntry {
  id: string;
  topic: string;
  lo: string;
  subject: string;
  searchable: string;
}

let cache: { source: Question[]; index: SearchEntry[] } | null = null;

/** Built once per loaded question array and reused; never rebuilt per keystroke. */
export function getSearchIndex(questions: Question[]): SearchEntry[] {
  if (cache?.source === questions) return cache.index;
  const index = questions.map((q) => ({
    id: q.id,
    topic: q.topic,
    lo: q.lo,
    subject: q.subject,
    searchable: [
      q.topic,
      q.loText,
      q.reading,
      q.question,
      ...q.options.map((o) => o.text),
      q.solution,
      ...q.trap.operators,
      ...q.trap.operators.map((o) => o.replace(/-/g, ' ')),
    ]
      .join(' \u0000 ')
      .toLowerCase(),
  }));
  cache = { source: questions, index };
  return index;
}

/** Case-insensitive substring AND-match over every term. Returns ids in source order, or null for an empty query. */
export function search(query: string, index: SearchEntry[]): string[] | null {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
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
