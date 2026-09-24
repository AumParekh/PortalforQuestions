import type { CatalogItem, Question, ScopeKind } from '../types';

function keyFor(kind: ScopeKind, q: Question): { key: string; label: string; sublabel?: string } {
  switch (kind) {
    case 'subject':
      return { key: q.subject, label: q.subject };
    case 'reading':
      return { key: `${q.subject}::${q.reading}`, label: q.reading, sublabel: q.subject };
    case 'topic':
      return { key: `${q.subject}::${q.topic}`, label: q.topic, sublabel: q.subject };
    case 'lo':
      return { key: `${q.subject}::${q.lo}`, label: q.loText || q.lo, sublabel: `${q.subject} · ${q.lo}` };
  }
}

/** Groups questions into selectable items for a scope, preserving first-appearance (source) order. */
export function buildCatalog(questions: Question[], kind: ScopeKind): CatalogItem[] {
  const items = new Map<string, CatalogItem>();
  for (const q of questions) {
    const { key, label, sublabel } = keyFor(kind, q);
    let item = items.get(key);
    if (!item) {
      item = { key, kind, label, sublabel, subject: q.subject, questionIds: [] };
      items.set(key, item);
    }
    item.questionIds.push(q.id);
  }
  return [...items.values()];
}

/** Resolves selected catalog keys to question ids, de-duplicated, in source order. */
export function resolveSelection(questions: Question[], kind: ScopeKind, selectedKeys: string[]): string[] {
  const wanted = new Set(selectedKeys);
  return questions.filter((q) => wanted.has(keyFor(kind, q).key)).map((q) => q.id);
}
