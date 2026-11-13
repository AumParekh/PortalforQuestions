import type { Band, CatalogItem, Question, RecallTier, ScopeKind } from '../types';
import { RECALL_SECTIONS, RECALL_TIERS } from './recallTiers';
import type { RecallSection } from './recallTiers';

export const BANDS: Band[] = ['P1', 'P2', 'P3', 'P4'];

/** Official ids look like "MR-2 c" (LO) and "MR-2: Title" (chapter). */
const OFFICIAL = /^([A-Z]+)-(\d+)(?: ([a-z]))?/;

/** Catalog key of a recall-workbook section: "section::A13". */
function sectionKey(id: string): string {
  return `section::${id}`;
}

/** Recall tiers a question belongs to (those of its sections), Tier A first. Tiers overlap: a question can be in several. */
export function tiersOf(q: Pick<Question, 'sections'>): RecallTier[] {
  const sections = q.sections;
  if (!sections || sections.length === 0) return [];
  return RECALL_TIERS.filter((t) => sections.some((id) => id.startsWith(t.id))).map((t) => t.id);
}

/** A question's recall-workbook sections with their titles, in workbook order. */
export function recallSectionsOf(q: Pick<Question, 'sections'>): RecallSection[] {
  const sections = q.sections;
  if (!sections || sections.length === 0) return [];
  return RECALL_SECTIONS.filter((s) => sections.includes(s.id));
}

/** Group heading of a tier's sections in Session Setup: "Tier A · August 2026 Recall and Core Topics". */
function tierHeading(tier: RecallTier): string {
  const info = RECALL_TIERS.find((t) => t.id === tier);
  return info ? `${info.name} · ${info.description}` : `Tier ${tier}`;
}

// Sections are handled apart: a question has one key in every other scope, but can sit in several sections.
function keyFor(kind: Exclude<ScopeKind, 'section'>, q: Question): { key: string; label: string; sublabel?: string; code?: string } {
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
 * Recall-workbook sections that have at least one question, in workbook order, grouped under their tier. A question
 * is listed under every section it sits in.
 */
function buildSectionCatalog(questions: Question[]): CatalogItem[] {
  const found = new Map<string, { questionIds: string[]; seen: Set<Band> }>();
  for (const q of questions) {
    for (const id of new Set(q.sections)) {
      let hit = found.get(id);
      if (!hit) {
        hit = { questionIds: [], seen: new Set() };
        found.set(id, hit);
      }
      hit.questionIds.push(q.id);
      if (q.band) hit.seen.add(q.band);
    }
  }
  const items: CatalogItem[] = [];
  for (const s of RECALL_SECTIONS) {
    const hit = found.get(s.id);
    if (!hit) continue;
    items.push({
      key: sectionKey(s.id),
      kind: 'section',
      label: s.title,
      code: s.id,
      subject: tierHeading(s.tier),
      bands: BANDS.filter((b) => hit.seen.has(b)),
      questionIds: hit.questionIds,
    });
  }
  return items;
}

/**
 * Groups questions into selectable items for a scope. Subjects keep their source order; chapters and LOs follow the
 * syllabus (reading number, then LO letter) within each subject; recall sections follow the workbook.
 */
export function buildCatalog(questions: Question[], kind: ScopeKind): CatalogItem[] {
  if (kind === 'section') return buildSectionCatalog(questions);
  const items = new Map<string, CatalogItem & { rank: number; subjectRank: number; seen: Set<Band> }>();
  const subjects = new Map<string, number>();
  for (const q of questions) {
    if (!subjects.has(q.subject)) subjects.set(q.subject, subjects.size);
    const { key, label, sublabel, code } = keyFor(kind, q);
    let item = items.get(key);
    if (!item) {
      const rank = kind === 'lo' ? syllabusRank(q.lo) : kind === 'reading' ? syllabusRank(q.reading) : items.size;
      item = { key, kind, label, sublabel, code, subject: q.subject, questionIds: [], rank, subjectRank: subjects.get(q.subject) ?? 0, seen: new Set() };
      if (kind === 'lo') item.loKind = q.loKind;
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
  // The union of the selected sections: a question in two of them still appears once.
  if (kind === 'section') {
    return questions.filter((q) => q.sections?.some((id) => wanted.has(sectionKey(id)))).map((q) => q.id);
  }
  return questions.filter((q) => wanted.has(keyFor(kind, q).key)).map((q) => q.id);
}
