import type { Band, CatalogItem, Question, ScopeKind } from '../types';

export const BANDS: Band[] = ['P1', 'P2', 'P3', 'P4'];

/** Official ids look like "MR-2 c" (LO) and "MR-2: Title" (chapter). */
const OFFICIAL = /^([A-Z]+)-(\d+)(?: ([a-z]))?/;

function keyFor(kind: ScopeKind, q: Question): { key: string; label: string; sublabel?: string; code?: string } {
  switch (kind) {
    case 'subject':
      return { key: q.subject, label: q.subject };
    case 'reading':
      return { key: `${q.subject}::${q.reading}`, label: q.reading, sublabel: q.subject };
    case 'topic':
      return { key: `${q.subject}::${q.topic}`, label: q.topic, sublabel: q.subject };
    // The official LO id is the identity; the chapter it belongs to is shown under its wording.
    case 'lo':
      return OFFICIAL.test(q.lo)
        ? { key: loKey(q), label: q.loText || q.lo, sublabel: q.reading, code: q.lo }
        : { key: loKey(q), label: q.loText || q.lo, sublabel: q.subject };
  }
}

/** Identity of a question's LO, shared by the session catalog, the dashboard and the review screen. */
export function loKey(q: Pick<Question, 'subject' | 'lo' | 'loText'>): string {
  return OFFICIAL.test(q.lo) ? `${q.subject}::${q.lo}` : `${q.subject}::${q.loText || q.lo}`;
}

/** Label of a question's LO with its id in front: "MR-2 c · Compare and contrast …". */
export function loLabel(q: Pick<Question, 'lo' | 'loText'>): string {
  return OFFICIAL.test(q.lo) && q.loText ? `${q.lo} · ${q.loText}` : q.loText || q.lo;
}

/** Syllabus position of a chapter or LO id: reading number, then LO letter. Unknown ids sort last, in source order. */
function syllabusRank(id: string): number {
  const m = OFFICIAL.exec(id);
  return m ? Number(m[2]) * 100 + (m[3] ? m[3].charCodeAt(0) - 96 : 0) : Number.MAX_SAFE_INTEGER;
}

/**
 * Groups questions into selectable items for a scope. Subjects keep their source order; chapters and LOs follow the
 * syllabus (reading number, then LO letter) within each subject.
 */
export function buildCatalog(questions: Question[], kind: ScopeKind): CatalogItem[] {
  const items = new Map<string, CatalogItem & { rank: number; subjectRank: number; seen: Set<Band> }>();
  const subjects = new Map<string, number>();
  for (const q of questions) {
    if (!subjects.has(q.subject)) subjects.set(q.subject, subjects.size);
    const { key, label, sublabel, code } = keyFor(kind, q);
    let item = items.get(key);
    if (!item) {
      const rank = kind === 'lo' ? syllabusRank(q.lo) : kind === 'reading' ? syllabusRank(q.reading) : items.size;
      item = { key, kind, label, sublabel, code, subject: q.subject, questionIds: [], rank, subjectRank: subjects.get(q.subject) ?? 0, seen: new Set() };
      items.set(key, item);
    }
    item.questionIds.push(q.id);
    if (q.band) item.seen.add(q.band);
  }
  const list = [...items.values()];
  // Array.prototype.sort is stable, so items without an official id keep their source order after the others.
  if (kind === 'lo' || kind === 'reading') list.sort((a, b) => a.subjectRank - b.subjectRank || a.rank - b.rank);
  return list.map(({ rank: _rank, subjectRank: _subjectRank, seen, ...item }) => ({ ...item, bands: BANDS.filter((b) => seen.has(b)) }));
}

/** Resolves selected catalog keys to question ids, de-duplicated, in source order. */
export function resolveSelection(questions: Question[], kind: ScopeKind, selectedKeys: string[]): string[] {
  const wanted = new Set(selectedKeys);
  return questions.filter((q) => wanted.has(keyFor(kind, q).key)).map((q) => q.id);
}
