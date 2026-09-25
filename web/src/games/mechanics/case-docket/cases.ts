// Case Docket: the case index. Pure; no React. Walks the corpus once (memoised per corpus) and
// files every fact the notes state about a named historical case under that case.
//
// The registry below holds names and spellings only; every fact is a sentence, clause, table cell
// or bullet taken from the notes. A fact is filed under a case when:
//   1. it sits in a table keyed by case (a row per case, or a column per case), or
//   2. it sits in a context dedicated to one case — a reading, section or box whose heading names
//      exactly that case (IM-14 "Madoff…", ORR-9 "Equifax case study", IM-9 "Archegos, 2021"), or
//   3. its sentence (or ;-clause) names exactly one case.
// Learning-objective lists, formulas, diagrams and exam-technique sentences are never facts.
import type { Corpus } from '../../corpus';
import { compareReadings } from '../../corpus';
import type { Block, Reading, SubItemLike, TableRow, Trap, TrapCategory } from '../../types';

export interface CaseDef {
  id: string;
  name: string;
  /** Spellings used in the notes, matched case-sensitively on word boundaries. */
  aliases: readonly string[];
  /** A section heading matching this is dedicated to the case even if it names others too. */
  section?: RegExp;
  /**
   * Words redacted in the case's own facts but never used to detect the case (too broad to file a
   * sentence under it: "Russia", "China"). They would otherwise give the answer away on the chip.
   */
  maskAlso?: readonly string[];
}

/** Named cases the notes discuss. Names and spellings only: no facts live here. */
export const CASE_REGISTRY: readonly CaseDef[] = [
  { id: 'lehman', name: 'Lehman Brothers', aliases: ['Lehman Brothers', 'Lehman'] },
  { id: 'bear-stearns', name: 'Bear Stearns', aliases: ['Bear Stearns'] },
  { id: 'ltcm', name: 'LTCM', aliases: ['Long-Term Capital Management', 'Long Term Capital Management', 'LTCM'] },
  { id: 'archegos', name: 'Archegos', aliases: ['Archegos Capital Management', 'Archegos Capital', 'Archegos'] },
  {
    id: 'madoff',
    name: 'Madoff (BLMIS)',
    aliases: ['Bernard L. Madoff Investment Securities', 'Bernard L. Madoff', 'Bernard Madoff', 'Bernie Madoff', 'BLMIS', 'Madoff'],
  },
  { id: 'northern-rock', name: 'Northern Rock', aliases: ['Northern Rock'] },
  { id: 'ashanti', name: 'Ashanti Goldfields', aliases: ['Ashanti Goldfields', 'Ashanti'] },
  { id: 'metallgesellschaft', name: 'Metallgesellschaft', aliases: ['Metallgesellschaft'] },
  { id: 'barings', name: 'Barings', aliases: ['Barings Bank', 'Barings', 'Nick Leeson', 'Leeson'] },
  { id: 'london-whale', name: 'London Whale', aliases: ['London Whale', 'Bruno Iksil'] },
  { id: 'equifax', name: 'Equifax', aliases: ['Equifax'] },
  { id: 'usaa', name: 'USAA', aliases: ['USAA Federal Savings Bank', 'USAA'] },
  { id: 'capital-one', name: 'Capital One', aliases: ['Capital One'] },
  { id: 'morgan-stanley', name: 'Morgan Stanley', aliases: ['Morgan Stanley'] },
  { id: 'amaranth', name: 'Amaranth Advisors', aliases: ['Amaranth Advisors', 'Amaranth'] },
  { id: 'enron', name: 'Enron', aliases: ['Enron'] },
  { id: 'aig', name: 'AIG', aliases: ['AIG'] },
  { id: 'credit-suisse', name: 'Credit Suisse', aliases: ['Credit Suisse'] },
  { id: 'jpmorgan', name: 'JPMorgan', aliases: ['JPMorgan Chase', 'JPMorgan', 'JP Morgan', 'J.P. Morgan'] },
  { id: 'deutsche-bank', name: 'Deutsche Bank', aliases: ['Deutsche Bank'] },
  { id: 'ubs', name: 'UBS', aliases: ['UBS'] },
  { id: 'barclays', name: 'Barclays', aliases: ['Barclays'], section: /Barclays/ },
  { id: 'mars-orbiter', name: 'NASA Mars Orbiter', aliases: ['Mars Orbiter', 'Lockheed Martin', 'NASA'], section: /Mars Orbiter/ },
  { id: 'berkshire', name: 'Berkshire Hathaway', aliases: ['Berkshire Hathaway', 'Buffett'] },
  {
    id: 'russia-ukraine',
    name: 'Russia–Ukraine war (2022)',
    aliases: ['Russia–Ukraine war', 'Russia-Ukraine war', 'Russia–Ukraine', 'Russia-Ukraine'],
    maskAlso: ['Russia', 'Ukraine'],
  },
  {
    id: 'us-china',
    name: 'US–China trade tensions',
    aliases: ['US–China trade tensions', 'US-China trade tensions'],
    maskAlso: ['US–China', 'US-China', 'China'],
  },
];

/** Stands in for the owning case's name inside a masked fact. */
export const MASK = '\uE000';

export interface CaseFact {
  /** Unique per fact. */
  key: string;
  /** Stable extracted-item ID (trap, bullet, numeric item, bold claim, term, table row or block). */
  itemId: string;
  blockId: string;
  readingId: string;
  objectiveId?: string;
  /** Case the fact belongs to. */
  owner: string;
  /** The fact as the notes state it (LaTeX-ish text), shown once answered. */
  text: string;
  /** The same with the owner's name replaced by MASK. */
  masked: string;
  /** The spellings each MASK stands for, in order (to restore the notes' wording on reveal). */
  names: string[];
  /** Other cases the fact names. */
  mentions: string[];
  category: TrapCategory | null;
}

export interface Discriminator {
  kind: 'trap' | 'box';
  /** Trap ID or block ID. */
  id: string;
  blockId: string;
  readingId: string;
  cases: string[];
  /** The line as the notes state it (LaTeX-ish). */
  text: string;
}

export interface CaseInfo {
  id: string;
  name: string;
  aliases: readonly string[];
  /** Readings that name the case, in corpus order. */
  citedIn: string[];
}

export interface CaseIndex {
  cases: Record<string, CaseInfo>;
  /** Owner case id → facts, in corpus order. */
  facts: Record<string, CaseFact[]>;
  /** Reading id → case ids named anywhere in the reading (text, headings, traps, cases fields). */
  mentioned: Record<string, string[]>;
  /**
   * The notes' own lines setting cases side by side: traps that name two or more cases, then
   * boxes (key, trap, note) that do.
   */
  discriminators: Discriminator[];
}

// ---------------------------------------------------------------------------------------------
// Text helpers

const ABBREV = /^(?:[A-Z]|[A-Z]\.[A-Z]|[A-Z]\.[A-Z]\.[A-Z]|e\.g|i\.e|etc|vs|Inc|Co|Ltd|Corp|Mr|Mrs|Ms|Dr|St|No|approx|Jr|Sr|Fig|Eq|cf|al)$/;

/** Splits text into sentences on . ! ? followed by a capital, keeping abbreviations and initials intact. */
export function splitSentences(s: string): string[] {
  const out: string[] = [];
  const re = /([.!?])(["”’')\]]*)\s+(?=[A-Z0-9“"(\\$])/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(start, m.index);
    const word = (/(\S+)$/.exec(before)?.[1] ?? '').replace(/^[("“'‘[]+/, '');
    if (m[1] === '.' && ABBREV.test(word)) continue;
    const end = m.index + m[1].length + m[2].length;
    out.push(s.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  const rest = s.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** Lower-case letters and digits only, for comparing texts. */
export function flat(s: string): string {
  return s
    .replace(/\\\$/g, '$')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const META =
  /\b(?:a question|the question|any question|an option|the option|any option|distractors?|the answer|exam|the stem|candidates?|curriculum|this reading|the reading|objective|misses the point|out loud|four-statement|audit of statements|is offered|be offered|GARP|flagged|silently|the notes|source notes?)\b/i;
const PRONOUN_START = /^(?:It|Its|This|That|These|Those|They|Such|Here|There|Nothing|Neither|Either)\b/;
const LO_VERB = /^(?:Explain|Describe|Identify|Assess|Evaluate|Compare|Calculate|Discuss|Estimate|Define|Distinguish|Analy[sz]e|Apply|Summari[sz]e|Interpret|Recognize|Recognise)\b/;
const LO_TITLE = /learning objectives|objectives in this reading|the (?:two|three|four|five) objectives|official \d{4} spine/i;

function words(s: string): number {
  return s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
}

// ---------------------------------------------------------------------------------------------
// Case detection

interface Detector {
  defs: Map<string, CaseDef>;
  /** Case ids named in the text, in order of first appearance, without repeats. */
  find: (text: string | null | undefined) => string[];
  /** The text with this case's names replaced by MASK, and the spellings replaced, in order. */
  mask: (text: string, caseId: string) => { masked: string; names: string[] };
  /** Maps a `cases` field name from the JSON to a case id, if any. */
  fromField: (name: string) => string | null;
}

const BOUNDARY_L = '(^|[^\\p{L}\\p{N}])';
const BOUNDARY_R = '(?![\\p{L}\\p{N}])';

function normName(s: string): string {
  return s.toLowerCase().replace(/[–—-]/g, '-').replace(/\s+/g, ' ').trim();
}

function makeDetector(defs: readonly CaseDef[]): Detector {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const aliasOwner = new Map<string, string>();
  for (const d of defs) for (const a of d.aliases) if (!aliasOwner.has(a)) aliasOwner.set(a, d.id);
  const alts = [...aliasOwner.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const all = new RegExp(`${BOUNDARY_L}(${alts.join('|')})${BOUNDARY_R}`, 'gu');
  const perCase = new Map<string, RegExp>();
  for (const d of defs) {
    const own = [...d.aliases, ...(d.maskAlso ?? [])].sort((a, b) => b.length - a.length).map(escapeRe);
    perCase.set(d.id, new RegExp(`${BOUNDARY_L}(${own.join('|')})${BOUNDARY_R}`, 'gu'));
  }
  return {
    defs: byId,
    find: (text) => {
      if (!text) return [];
      const out: string[] = [];
      all.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = all.exec(text))) {
        const id = aliasOwner.get(m[2]);
        if (id && !out.includes(id)) out.push(id);
      }
      return out;
    },
    mask: (text, caseId) => {
      const re = perCase.get(caseId);
      const names: string[] = [];
      if (!re) return { masked: text, names };
      re.lastIndex = 0;
      const masked = text.replace(re, (_m, pre: string, name: string) => {
        names.push(name);
        return `${pre}${MASK}`;
      });
      return { masked, names };
    },
    fromField: (name) => {
      const n = normName(name);
      for (const d of defs) {
        if (normName(d.name) === n) return d.id;
        for (const a of d.aliases) {
          const an = normName(a);
          if (an === n || an.includes(n) || n.includes(an)) return d.id;
        }
      }
      return null;
    },
  };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The registry plus any case the extractor tagged in a `cases` field that the registry does not
 * know — unless it is a broad event ("… crisis", "… war") or only ever appears in worked examples
 * (the notes' invented banks).
 */
function collectDefs(corpus: Corpus): CaseDef[] {
  const base = makeDetector(CASE_REGISTRY);
  const extra = new Map<string, { name: string; real: boolean }>();
  const note = (name: unknown, real: boolean) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const n = name.trim();
    if (base.fromField(n) || /crisis|war\b|pandemic/i.test(n)) return;
    const cur = extra.get(n);
    extra.set(n, { name: n, real: (cur?.real ?? false) || real });
  };
  for (const r of corpus.readings) {
    for (const b of blocksOf(r)) for (const c of b.cases ?? []) note(c, b.type !== 'exbox');
  }
  const defs = [...CASE_REGISTRY];
  for (const { name, real } of extra.values()) {
    const id = `x-${slug(name)}`;
    if (real && id !== 'x-' && !defs.some((d) => d.id === id)) defs.push({ id, name, aliases: [name] });
  }
  return defs;
}

// ---------------------------------------------------------------------------------------------
// Fact extraction

function subText(x: SubItemLike): string {
  if (typeof x === 'string') return x;
  const t = x.text ?? x.plain_text;
  return typeof t === 'string' ? t : '';
}
function subId(x: SubItemLike): string | undefined {
  return typeof x === 'string' || typeof x.id !== 'string' ? undefined : x.id;
}

function str(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}
function subItems(xs: unknown): SubItemLike[] {
  return Array.isArray(xs) ? xs.filter((x): x is SubItemLike => typeof x === 'string' || (!!x && typeof x === 'object')) : [];
}

/**
 * A well-typed view of a block. Content is still being refined, so any field may be missing or
 * the wrong shape; malformed pieces are dropped, and a block without an ID is skipped.
 */
function sanitize(raw: unknown): Block | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Block;
  if (typeof b.id !== 'string' || !b.id) return null;
  const rows = Array.isArray(b.rows)
    ? b.rows
        .filter((r): r is TableRow => !!r && typeof r === 'object' && Array.isArray(r.cells))
        .map((r) => ({
          ...r,
          id: typeof r.id === 'string' ? r.id : undefined,
          cells: r.cells.map((c) => (typeof c === 'string' ? c : '')),
          headers: Array.isArray(r.headers) ? r.headers.map((h) => (typeof h === 'string' ? h : '')) : undefined,
        }))
    : [];
  return {
    ...b,
    type: b.type,
    title: str(b.title),
    section: str(b.section),
    plain_text: str(b.plain_text) ?? undefined,
    body_latex: str(b.body_latex) ?? undefined,
    bullets: subItems(b.bullets),
    terms: subItems(b.terms),
    numeric_items: subItems(b.numeric_items),
    bold_claims: subItems(b.bold_claims),
    headers: Array.isArray(b.headers) ? b.headers.map((h) => (typeof h === 'string' ? h : '')) : [],
    rows,
    cases: Array.isArray(b.cases) ? b.cases.filter((c): c is string => typeof c === 'string') : [],
  };
}

function blocksOf(r: Reading): Block[] {
  const out: Block[] = [];
  for (const o of Array.isArray(r.objectives) ? r.objectives : []) {
    for (const raw of o && Array.isArray(o.blocks) ? o.blocks : []) {
      const b = sanitize(raw);
      if (b) out.push(b);
    }
  }
  return out;
}

/**
 * The finest real sub-item ID that holds this sentence (a bullet with the same text, or a numeric
 * item / bold claim / marked term that occurs in it), else the container ID.
 */
function resolveItemId(sentence: string, block: Block, fallback: string): string {
  const s = flat(sentence);
  if (!s) return fallback;
  for (const x of block.bullets ?? []) {
    const id = subId(x);
    if (id && flat(subText(x)) === s) return id;
  }
  for (const list of [block.numeric_items, block.bold_claims]) {
    for (const x of list ?? []) {
      const id = subId(x);
      const own = flat(subText(x));
      if (!id || own.length < 3 || !s.includes(own)) continue;
      const c = flat(typeof x !== 'string' && typeof x.context === 'string' ? x.context : '');
      if (!c || c === s || s.includes(c) || c.includes(s)) return id;
    }
  }
  for (const x of block.terms ?? []) {
    const id = subId(x);
    const t = flat(subText(x));
    if (id && t.length >= 8 && s.includes(t)) return id;
  }
  return fallback;
}

interface Segment {
  text: string;
  itemId: string;
  blockId: string;
  readingId: string;
  objectiveId?: string;
  /** Case every sentence in this segment belongs to (keyed table, dedicated context), if any. */
  owner: string | null;
  /** Label put in front of each fact from a table cell ("What they did"). */
  prefix?: string;
  category: TrapCategory | null;
  /** When set, sentences resolve to finer sub-item IDs within this block (the segment ID is a container). */
  block?: Block;
}

/** A bullet, cell or trap no longer than this is kept whole rather than split into sentences. */
const WHOLE_MAX = 220;
const READING_REF = /\b(?:MR|CR|ORR|LTR|IM|CI)-\d+\b/;

function cleanLead(s: string): string {
  return s
    .replace(/^\s*(?:[•▸\-–—]\s*)+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalise(s: string): string {
  return s.replace(/^(\W*)(\p{Ll})/u, (_m, a: string, b: string) => a + b.toUpperCase());
}

export function buildCaseIndex(corpus: Corpus): CaseIndex {
  const defs = collectDefs(corpus);
  const det = makeDetector(defs);
  const facts: Record<string, CaseFact[]> = {};
  const seen = new Set<string>();
  const mentioned: Record<string, Set<string>> = {};
  const discriminators: CaseIndex['discriminators'] = [];

  const ownerAliasLead = (owner: string) => {
    const d = det.defs.get(owner);
    if (!d) return null;
    const alts = [...d.aliases].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    return {
      lead: new RegExp(`^(?:the\\s+)?(?:${alts})(?:['’]s?)?\\s*(?:[:=]|—|–)\\s*`, 'u'),
      paren: new RegExp(`\\s*\\((?:${alts})\\)`, 'gu'),
    };
  };
  const leadCache = new Map<string, ReturnType<typeof ownerAliasLead>>();

  /** Files one fact; 'rejected' when it fails the filters (the caller may then try its sentences). */
  const addFact = (seg: Segment, raw: string, owner: string): 'added' | 'duplicate' | 'rejected' => {
    let text = cleanLead(raw);
    const lead = leadCache.get(owner) ?? ownerAliasLead(owner);
    leadCache.set(owner, lead);
    if (lead) {
      text = text.replace(lead.lead, '').replace(lead.paren, '');
      text = capitalise(text.trim());
    }
    if (!text || /[:;,]$/.test(text)) return 'rejected';
    if (!/[.!?)”"]$/.test(text)) text += '.';
    if (text.length < 14 || text.length > 320) return 'rejected';
    if (/\$\$|\\\[|\\begin|\\end\{/.test(text) || META.test(text) || READING_REF.test(text)) return 'rejected';
    // Formula-heavy lines are worked-example arithmetic, not facts about the case.
    const math = (text.replace(/\\\$/g, '').match(/\$[^$]*\$/g) ?? []).join('').length;
    if (math > 0.25 * text.length) return 'rejected';
    const named = det.find(text);
    if (PRONOUN_START.test(text)) return 'rejected';
    if (/^Both\b/.test(text) && !named.includes(owner)) return 'rejected';
    const full = seg.prefix ? `${seg.prefix}: ${text}` : text;
    const { masked, names } = det.mask(full, owner);
    // The case only as one example in a list ("(Deutsche Bank, HSBC)") says nothing about the case.
    if (/\([^)]*\uE000[^)]*,[^)]*\)|\([^)]*,[^)]*\uE000[^)]*\)/.test(masked)) return 'rejected';
    const bare = masked.split(MASK).join(' ').trim();
    if (words(bare) < (seg.prefix ? 2 : 3) || bare.split(/\s+/).length < 3) return 'rejected';
    const dedupe = `${owner}|${flat(full)}`;
    if (seen.has(dedupe)) return 'duplicate';
    seen.add(dedupe);
    const itemId = seg.block ? resolveItemId(text, seg.block, seg.itemId) : seg.itemId;
    (facts[owner] ??= []).push({
      key: `${itemId}~${owner}~${(facts[owner]?.length ?? 0) + 1}`,
      itemId,
      blockId: seg.blockId,
      readingId: seg.readingId,
      objectiveId: seg.objectiveId,
      owner,
      text: full,
      masked,
      names,
      mentions: named.filter((c) => c !== owner),
      category: seg.category,
    });
    return 'added';
  };

  /**
   * Files a segment: each bullet / cell fragment whole when it is short and belongs to one case,
   * else sentence by sentence. Without a fixed owner a sentence (or ;-clause) must name exactly one case.
   */
  const fileSegment = (seg: Segment) => {
    for (const raw of seg.text.split(/\s*[▸•]\s+/)) {
      const fragment = raw.trim();
      if (!fragment) continue;
      if (seg.owner) {
        if (fragment.length <= WHOLE_MAX && addFact(seg, fragment, seg.owner) !== 'rejected') continue;
        for (const sentence of splitSentences(fragment)) addFact(seg, sentence, seg.owner);
        continue;
      }
      const whole = det.find(fragment);
      if (whole.length === 1 && fragment.length <= WHOLE_MAX && addFact(seg, fragment, whole[0]) !== 'rejected') continue;
      for (const sentence of splitSentences(fragment)) {
        const named = det.find(sentence);
        if (named.length === 1) addFact(seg, sentence, named[0]);
        else if (named.length > 1) {
          for (const clause of sentence.split(/;\s+/)) {
            const n = det.find(clause);
            if (n.length === 1) addFact(seg, clause, n[0]);
          }
        }
      }
    }
  };

  const single = (ids: string[]) => (ids.length === 1 ? ids[0] : null);
  /** A section, box title or reading title that names exactly one case dedicates its content to it. */
  const contextOwner = (b: Block | undefined, readingOwner: string | null): string | null => {
    if (b) {
      // A worked example set on a real firm is arithmetic, not the firm's story.
      if (b.section && !/worked (?:case|example)/i.test(b.section)) {
        const bySection = defs.find((d) => d.section?.test(b.section ?? ''));
        if (bySection) return bySection.id;
        const s = single(det.find(b.section));
        if (s) return s;
      }
      const t = single(det.find(b.title ?? ''));
      if (t) return t;
    }
    return readingOwner;
  };

  for (const r of corpus.readings) {
    const rid = r.reading_id;
    const named = (mentioned[rid] ??= new Set<string>());
    const noteText = (s: string | null | undefined) => {
      for (const id of det.find(s)) named.add(id);
    };
    const noteField = (xs: unknown) => {
      for (const x of Array.isArray(xs) ? xs : []) {
        const id = typeof x === 'string' ? det.fromField(x) : null;
        if (id) named.add(id);
      }
    };
    noteField(r.cases);
    noteText(str(r.title));
    const readingOwner = single(det.find(str(r.title)));

    // Traps first: they carry categories, and their boxes are then skipped as duplicates.
    const trapBlocks = new Set<string>();
    for (const t of Array.isArray(r.traps) ? r.traps : []) {
      if (!t || typeof t.id !== 'string' || typeof t.text !== 'string' || t.origin === 'mined') continue;
      noteText(t.text);
      const inTrap = det.find(t.text);
      const block = typeof t.source_block === 'string' ? (sanitize(corpus.blockById[t.source_block]) ?? undefined) : undefined;
      if (inTrap.length >= 2) discriminators.push({ kind: 'trap', id: t.id, blockId: block?.id ?? t.id, readingId: rid, cases: inTrap, text: t.text });
      if (block) trapBlocks.add(block.id);
      if (block && LO_TITLE.test(block.title ?? '')) continue;
      fileSegment({
        text: trapText(t),
        itemId: t.id,
        blockId: block?.id ?? t.id,
        readingId: rid,
        objectiveId: block ? corpus.objectiveOfBlock[block.id] : undefined,
        owner: contextOwner(block, readingOwner),
        category: t.category ?? null,
      });
    }

    for (const b of blocksOf(r)) {
      const objectiveId = corpus.objectiveOfBlock[b.id];
      noteField(b.cases);
      noteText(b.title);
      noteText(b.section);
      noteText(b.plain_text ?? b.body_latex);
      for (const row of b.rows ?? []) for (const c of rowCells(row)) noteText(c);
      for (const h of b.headers ?? []) noteText(h);

      if (LO_TITLE.test(b.title ?? '') || b.type === 'fmlbox' || b.type === 'tikzpicture' || b.type === 'figcap') continue;
      if (b.type === 'keybox' || b.type === 'trapbox' || b.type === 'notebox') {
        const body = (b.plain_text ?? '')
          .split(/\n+/)
          .map((l) => cleanLead(l))
          .filter(Boolean)
          .join(' ');
        const inBox = det.find(body);
        if (inBox.length >= 2 && body.length <= 700) discriminators.push({ kind: 'box', id: b.id, blockId: b.id, readingId: rid, cases: inBox, text: body });
      }
      if (b.type === 'trapbox' && trapBlocks.has(b.id)) continue;
      // A "Lessons" box is general advice drawn from the case, not a fact about it (the USAA box's
      // "Financial institutions need strong AML controls", the Barclays box's "careful data
      // management", which fits Mars Orbiter as well): only its lines that name one case are filed.
      const owner = /\blessons?\b/i.test(b.title ?? '') ? null : contextOwner(b, readingOwner);
      const base = { blockId: b.id, readingId: rid, objectiveId, category: null, block: b };
      if (b.type === 'table' && b.rows?.length) {
        fileTable(b, owner, base, det, fileSegment);
        continue;
      }
      const bulletTexts = new Set<string>();
      for (const x of b.bullets ?? []) {
        const text = subText(x);
        if (!text || LO_VERB.test(text.trim())) continue;
        bulletTexts.add(flat(text));
        const id = subId(x);
        fileSegment({ ...base, text, itemId: id ?? b.id, owner, block: id ? undefined : b });
      }
      const body = b.plain_text ?? b.body_latex ?? '';
      for (const line of body.split(/\n+/)) {
        const l = line.trim();
        if (!l || /^[•▸]/.test(l) || bulletTexts.has(flat(l)) || l.includes('$$')) continue;
        fileSegment({ ...base, text: l, itemId: b.id, owner });
      }
    }
  }

  const cases: Record<string, CaseInfo> = {};
  const readingsSorted = [...corpus.readings].sort(compareReadings);
  for (const d of defs) {
    const citedIn = readingsSorted.filter((r) => mentioned[r.reading_id]?.has(d.id)).map((r) => r.reading_id);
    cases[d.id] = { id: d.id, name: d.name, aliases: d.aliases, citedIn };
  }
  return {
    cases,
    facts,
    mentioned: Object.fromEntries(Object.entries(mentioned).map(([k, v]) => [k, [...v]])),
    discriminators,
  };
}

function rowCells(row: TableRow): string[] {
  return Array.isArray(row?.cells) ? row.cells.map((c) => (typeof c === 'string' ? c : '')) : [];
}

/** Trap text as the notes state it (the correct version when the trap was split). */
function trapText(t: Trap): string {
  return typeof t.text === 'string' && t.text.trim() ? t.text : (t.correct_text ?? '');
}

const CASE_HEADER = /^(?:case|firm|company|institution|bank|fund|entity)\b/i;

/**
 * Tables keyed by case: a column per case (headers name the cases) or a row per case (the first
 * cell names it). Each cell is a fact of that case, labelled with its header or row label.
 * Other tables contribute only sentences that name exactly one case.
 */
function fileTable(
  b: Block,
  owner: string | null,
  base: Omit<Segment, 'text' | 'itemId' | 'owner'>,
  det: Detector,
  fileSegment: (s: Segment) => void,
) {
  const rows = (b.rows ?? []).filter((r) => r && Array.isArray(r.cells));
  const headers = (Array.isArray(b.headers) && b.headers.length ? b.headers : (rows[0]?.headers ?? [])).map((h) =>
    typeof h === 'string' ? h : '',
  );
  const one = (s: string) => {
    const ids = det.find(s);
    return ids.length === 1 ? ids[0] : null;
  };
  const colCases = headers.map((h, i) => (i === 0 ? null : one(h)));
  const colKeyed = new Set(colCases.filter(Boolean)).size >= 2;
  const rowCases = rows.map((r) => one(rowCells(r)[0] ?? ''));
  const rowKeyed = !colKeyed && (new Set(rowCases.filter(Boolean)).size >= 2 || (CASE_HEADER.test(headers[0] ?? '') && rowCases.some(Boolean)));
  rows.forEach((row, ri) => {
    const cells = rowCells(row);
    const hs = (Array.isArray(row.headers) && row.headers.length ? row.headers : headers).map((h) => (typeof h === 'string' ? h : ''));
    const itemId = row.id ?? b.id;
    const label = (s: string) => {
      const t = cleanLead(s).replace(/[:.]+$/, '');
      return t && t.length <= 60 ? t : undefined;
    };
    if (colKeyed) {
      const rowLabel = label(cells[0] ?? '');
      cells.forEach((c, ci) => {
        const o = colCases[ci];
        if (ci === 0 || !o || !c.trim()) return;
        fileSegment({ ...base, text: c, itemId, owner: o, prefix: rowLabel });
      });
      return;
    }
    const o = rowKeyed ? (rowCases[ri] ?? null) : owner;
    cells.forEach((c, ci) => {
      if (!c.trim()) return;
      // The key cell of a case row, or a short row label in a table dedicated to one case, is not a fact.
      if (o && ci === 0 && (rowKeyed || c.length <= 40)) return;
      fileSegment({ ...base, text: c, itemId, owner: o, prefix: ci > 0 || !o ? label(hs[ci] ?? '') : undefined });
    });
  });
}

const CACHE = new WeakMap<Corpus, CaseIndex>();

/** The case index for a corpus, built once. */
export function caseIndex(corpus: Corpus): CaseIndex {
  let idx = CACHE.get(corpus);
  if (!idx) {
    idx = buildCaseIndex(corpus);
    CACHE.set(corpus, idx);
  }
  return idx;
}

/** Readings a case is cited in (for the docket card), and the reading's own cases that have facts. */
export function casesWithFacts(idx: CaseIndex, reading: Reading): string[] {
  return (idx.mentioned[reading.reading_id] ?? []).filter((id) => (idx.facts[id]?.length ?? 0) > 0);
}
