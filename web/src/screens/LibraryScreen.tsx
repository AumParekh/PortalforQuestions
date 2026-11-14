import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Play, X } from 'lucide-react';
import type { CatalogItem, Question, SessionConfig, SessionFilters } from '../types';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { useSession } from '../store/session';
import { buildCatalog } from '../lib/catalog';
import { buildQueue, hasActiveFilters, localToday, matchesFilters } from '../lib/queue';
import { groupProgress } from '../lib/stats';
import type { GroupProgress } from '../lib/stats';
import { loCodeTest } from '../lib/search';
import { navigate } from '../lib/router';
import { SetupSearch, Highlight } from '../components/setup/SetupSearch';
import { matchesQuery } from '../components/setup/ChapterSearch';
import { FilterChip, FilterSheet } from '../components/setup/FilterSheet';
import { EMPTY_FILTERS, activeFilterCount, sanitizeFilters } from '../components/setup/filterModel';
import { BandBadge, KindBadge } from '../components/setup/BandBadge';
import { ScopeChips } from '../components/setup/ScopeChips';
import { ProgressLine, savedTimer } from './SessionSetupScreen';
import { profileKey } from '../games/profile';

/** Per profile: stored under `profileKey(...)` (games/profile.ts). */
const STORAGE_KEY = 'frm.library.v1';
const SEARCH_DEBOUNCE_MS = 150;

interface Stored {
  filters: SessionFilters;
  shuffle: boolean;
  /** Keys of the unfolded subjects and chapters. */
  open: string[];
  /** The LO or chapter opened last, marked in the list so the next one is easy to find. */
  lastKey: string | null;
}

const DEFAULTS: Stored = { filters: EMPTY_FILTERS, shuffle: false, open: [], lastKey: null };

function loadStored(): Stored {
  try {
    const raw = window.localStorage.getItem(profileKey(STORAGE_KEY));
    if (!raw) return DEFAULTS;
    const d = JSON.parse(raw) as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') return DEFAULTS;
    return {
      filters: sanitizeFilters(d.filters),
      shuffle: d.shuffle === true,
      open: Array.isArray(d.open) ? d.open.filter((k): k is string => typeof k === 'string') : [],
      lastKey: typeof d.lastKey === 'string' ? d.lastKey : null,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveStored(value: Stored) {
  try {
    window.localStorage.setItem(profileKey(STORAGE_KEY), JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode, quota); the library still works without it.
  }
}

interface Row {
  item: CatalogItem;
  /** Ids of the LO's questions that pass the filters, in bank order. */
  ids: string[];
}

interface Chapter {
  key: string;
  title: string;
  rows: Row[];
  count: number;
}

interface Subject {
  key: string;
  title: string;
  chapters: Chapter[];
  count: number;
}

const subjectKey = (subject: string) => `s|${subject}`;
const chapterKey = (subject: string, chapter: string) => `c|${subject}|${chapter}`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** One learning objective: tapping it starts a session with every question in it that passes the filters. */
function LoRow({
  row,
  query,
  filtered,
  progress,
  last,
  onStart,
}: {
  row: Row;
  query: string;
  filtered: boolean;
  progress: GroupProgress | undefined;
  last: boolean;
  onStart: () => void;
}) {
  const { item, ids } = row;
  const total = item.questionIds.length;
  // A code query ("MR-2 c") names the row; its letters are not words to mark in the wording.
  const mark = loCodeTest(query) ? '' : query;
  return (
    <button
      type="button"
      onClick={onStart}
      data-library-key={item.key}
      aria-label={`Solve all ${plural(ids.length, 'question', 'questions')} of ${item.code ?? item.label}`}
      className={`flex min-h-[56px] w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${
        last
          ? 'border-primary/50 bg-primary-50/60 dark:border-primary/50 dark:bg-primary/10'
          : 'border-slate-200 bg-card-light dark:border-slate-700 dark:bg-card-dark'
      }`}
    >
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="mb-1 flex flex-wrap items-center gap-1.5">
          {item.code && (
            <span className="text-[15px] font-semibold text-primary-700 dark:text-primary-100">
              <Highlight text={item.code} query={mark} />
            </span>
          )}
          {item.bands?.map((b) => <BandBadge key={b} band={b} />)}
          {item.loKind && <KindBadge kind={item.loKind} />}
          {last && <span className="text-[13px] font-medium text-primary-700 dark:text-primary-100">Last opened</span>}
        </span>
        <span className="block text-base leading-snug">
          <Highlight text={item.label} query={mark} />
        </span>
        <ProgressLine progress={progress} />
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2">
        <span
          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[15px] font-medium tabular-nums ${
            filtered && ids.length !== total
              ? 'bg-yellow-100 text-yellow-900 dark:bg-yellow-500/20 dark:text-yellow-100'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {filtered && ids.length !== total ? `${ids.length} of ${total}` : `${total} ${total === 1 ? 'Q' : 'Qs'}`}
        </span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white" aria-hidden="true">
          <Play className="h-4 w-4" />
        </span>
      </span>
    </button>
  );
}

/**
 * Question library: every learning objective, folded under its subject and chapter. Tapping an LO starts a session
 * with all of its questions (Session Setup caps a session at a chosen size; this does not). The same search, Priority,
 * Type and Filters apply.
 */
export function LibraryScreen() {
  const byId = useContent((s) => s.byId);
  const states = useProgress((s) => s.states);
  // Mock exams run through their own flow; the library only lists the subject banks.
  const questions = useContent((s) => s.subjectQuestions);
  const [initial] = useState(loadStored);
  const [filters, setFilters] = useState<SessionFilters>(initial.filters);
  const [shuffle, setShuffle] = useState(initial.shuffle);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(initial.open));
  const [lastKey, setLastKey] = useState<string | null>(initial.lastKey);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (searchText === query) return;
    const t = window.setTimeout(() => setQuery(searchText), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchText, query]);

  useEffect(() => {
    saveStored({ filters, shuffle, open: [...openGroups], lastKey });
  }, [filters, shuffle, openGroups, lastKey]);

  const catalog = useMemo(() => buildCatalog(questions, 'lo'), [questions]);
  const searchActive = query.trim().length > 0;
  const filtersActive = hasActiveFilters(filters);
  const filterCount = activeFilterCount(filters);

  // Search finds learning objectives and chapters by code or name; it never drops questions from an LO.
  const named = useMemo(() => {
    if (!searchActive) return catalog;
    const byCode = loCodeTest(query);
    const coded = byCode ? catalog.filter((it) => it.code && byCode(it.code)) : [];
    return coded.length > 0 ? coded : catalog.filter((it) => matchesQuery(query, it.code, it.label, it.sublabel, it.subject));
  }, [catalog, searchActive, query]);

  const rowsFor = (f: SessionFilters): Row[] => {
    if (!hasActiveFilters(f)) return named.map((item) => ({ item, ids: item.questionIds }));
    const today = localToday();
    return named
      .map((item) => ({ item, ids: item.questionIds.filter((id) => byId[id] && matchesFilters(byId[id], states[id], f, today)) }))
      .filter((r) => r.ids.length > 0);
  };
  const rows = useMemo(() => rowsFor(filters), [named, filters, byId, states]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjects = useMemo((): Subject[] => {
    const out = new Map<string, Subject>();
    for (const row of rows) {
      const { subject } = row.item;
      let s = out.get(subject);
      if (!s) {
        s = { key: subjectKey(subject), title: subject, chapters: [], count: 0 };
        out.set(subject, s);
      }
      const title = row.item.sublabel ?? 'Other';
      let c = s.chapters.find((x) => x.title === title);
      if (!c) {
        c = { key: chapterKey(subject, title), title, rows: [], count: 0 };
        s.chapters.push(c);
      }
      c.rows.push(row);
      c.count += row.ids.length;
      s.count += row.ids.length;
    }
    return [...out.values()];
  }, [rows]);

  const progressByKey = useMemo(() => {
    const m = new Map<string, GroupProgress>();
    for (const it of catalog) {
      const qs = it.questionIds.map((id) => byId[id]).filter((q): q is Question => !!q);
      const [g] = groupProgress(qs, states, () => ({ key: it.key, label: it.label }));
      if (g) m.set(it.key, g);
    }
    return m;
  }, [catalog, byId, states]);

  const allGroupKeys = useMemo(() => subjects.flatMap((s) => [s.key, ...s.chapters.map((c) => c.key)]), [subjects]);
  const allOpen = allGroupKeys.length > 0 && allGroupKeys.every((k) => openGroups.has(k));
  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Coming back from a session: bring the LO opened last into view, once the list is there. Otherwise start at the
  // top (the page keeps the scroll position of the screen it came from).
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || rows.length === 0) return;
    scrolled.current = true;
    const el = [...document.querySelectorAll<HTMLElement>('[data-library-key]')].find((n) => n.dataset.libraryKey === initial.lastKey);
    if (el) el.scrollIntoView({ block: 'center' });
    else window.scrollTo({ top: 0 });
  }, [rows, initial.lastKey]);

  const totalQuestions = rows.reduce((n, r) => n + r.ids.length, 0);

  /** Starts a session with every question of these rows that passes the filters: no cap on its size. */
  const start = (picked: Row[], key: string) => {
    const base: SessionConfig = {
      scopeKind: 'lo',
      selectedKeys: picked.map((r) => r.item.key),
      count: 'all',
      order: shuffle ? 'shuffled' : 'sequential',
      ...savedTimer(),
      trapOnly: false,
      wrongFirst: false,
      skipDrops: false,
      mode: 'drill',
      filters,
      origin: 'library',
    };
    // In order: one LO after another as the syllabus lists them, each in bank order.
    const queue = shuffle ? buildQueue(base, questions, states) : picked.flatMap((r) => r.ids);
    if (queue.length === 0) return;
    // Saved before leaving the screen, so the list reopens here after the session.
    saveStored({ filters, shuffle, open: [...openGroups], lastKey: key });
    // start() returns false when the user keeps a session already in progress.
    if (!useSession.getState().start(base, queue)) return;
    setLastKey(key);
    navigate('/session');
  };

  const clearSearch = () => {
    setSearchText('');
    setQuery('');
  };
  const pillClass =
    'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-200 px-3.5 text-[15px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';
  const headerClass = 'border-slate-200 bg-card-light dark:border-slate-700 dark:bg-card-dark';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Back to home"
            className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">Question library</h1>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] space-y-5 px-4 pb-16 pt-4">
        <section aria-label="Find a learning objective" className="space-y-3">
          <p className="text-[15px] text-slate-600 dark:text-slate-400">
            Open a subject, then a chapter, and tap a learning objective to solve every question in it.
          </p>
          <SetupSearch
            value={searchText}
            onChange={setSearchText}
            filterCount={filterCount}
            onOpenFilters={() => setFiltersOpen(true)}
            placeholder="Find an LO or chapter, MR-2 c"
            label="Find a learning objective or chapter"
          />
          <ScopeChips filters={filters} onChange={setFilters} effect="are included" />
          <FilterChip active={shuffle} title="Otherwise questions come in bank order" onClick={() => setShuffle((v) => !v)}>
            Shuffle the questions
          </FilterChip>
          {(searchActive || filterCount > 0) && (
            <div className="flex flex-wrap gap-2">
              {searchActive && (
                <button type="button" onClick={clearSearch} className={pillClass}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Clear search
                </button>
              )}
              {filterCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilters({ ...EMPTY_FILTERS, bands: filters.bands, kinds: filters.kinds, recallOnly: filters.recallOnly })}
                  className={pillClass}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Clear {filterCount} {filterCount === 1 ? 'filter' : 'filters'}
                </button>
              )}
            </div>
          )}
        </section>

        <section aria-label="Learning objectives" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-[15px] text-slate-600 dark:text-slate-400">
              {plural(rows.length, 'learning objective', 'learning objectives')} · {plural(totalQuestions, 'question', 'questions')}
            </p>
            {allGroupKeys.length > 0 && !searchActive && (
              <button
                type="button"
                onClick={() => setOpenGroups(allOpen ? new Set() : new Set(allGroupKeys))}
                className="min-h-[44px] rounded-lg px-2 text-[15px] font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="space-y-3 rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark">
              <p className="text-slate-600 dark:text-slate-400">
                {searchActive && named.length === 0
                  ? `No learning objective or chapter matches “${query.trim()}”.`
                  : 'No questions match the current filters.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {searchActive && (
                  <button type="button" onClick={clearSearch} className={pillClass}>
                    Clear search
                  </button>
                )}
                {filtersActive && (
                  <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className={pillClass}>
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            subjects.map((s) => {
              const subjectOpen = searchActive || openGroups.has(s.key);
              return (
                <div key={s.key} className="space-y-2">
                  <button
                    type="button"
                    aria-expanded={subjectOpen}
                    disabled={searchActive}
                    onClick={() => toggleGroup(s.key)}
                    className={`flex min-h-[52px] w-full items-center gap-2 rounded-xl border px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800 ${headerClass}`}
                  >
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400 ${subjectOpen ? '' : '-rotate-90'}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="block text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">{s.title}</span>
                      <span className="block text-[15px] text-slate-600 dark:text-slate-400">
                        {plural(s.chapters.length, 'chapter', 'chapters')} · {plural(s.count, 'question', 'questions')}
                      </span>
                    </span>
                  </button>
                  {subjectOpen && (
                    <div className="space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                      {s.chapters.map((c) => {
                        const chapterOpen = searchActive || openGroups.has(c.key);
                        const last = lastKey === c.key;
                        return (
                          <div key={c.key} className="space-y-2">
                            <div
                              data-library-key={c.key}
                              className={`flex items-stretch gap-1 rounded-xl border ${
                                last ? 'border-primary/50 bg-primary-50/60 dark:border-primary/50 dark:bg-primary/10' : headerClass
                              }`}
                            >
                              <button
                                type="button"
                                aria-expanded={chapterOpen}
                                disabled={searchActive}
                                onClick={() => toggleGroup(c.key)}
                                className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800"
                              >
                                <ChevronDown
                                  className={`h-5 w-5 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400 ${chapterOpen ? '' : '-rotate-90'}`}
                                  aria-hidden="true"
                                />
                                <span className="min-w-0 [overflow-wrap:anywhere]">
                                  <span className="block text-[15px] font-medium leading-snug text-slate-900 dark:text-slate-100">
                                    <Highlight text={c.title} query={loCodeTest(query) ? '' : query} />
                                  </span>
                                  <span className="block text-[15px] text-slate-600 dark:text-slate-400">
                                    {plural(c.rows.length, 'LO', 'LOs')} · {plural(c.count, 'question', 'questions')}
                                    {last && ' · last opened'}
                                  </span>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => start(c.rows, c.key)}
                                aria-label={`Solve all ${plural(c.count, 'question', 'questions')} of ${c.title}`}
                                className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-[15px] font-medium tabular-nums text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
                              >
                                <Play className="h-4 w-4" aria-hidden="true" />
                                All {c.count}
                              </button>
                            </div>
                            {chapterOpen && (
                              <ul className="space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                                {c.rows.map((row) => (
                                  <li key={row.item.key}>
                                    <LoRow
                                      row={row}
                                      query={searchActive ? query : ''}
                                      filtered={filtersActive}
                                      progress={progressByKey.get(row.item.key)}
                                      last={lastKey === row.item.key}
                                      onStart={() => start([row], row.item.key)}
                                    />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      </main>

      <FilterSheet
        open={filtersOpen}
        value={filters}
        onApply={setFilters}
        onClose={() => setFiltersOpen(false)}
        countFor={(f) => rowsFor(f).reduce((n, r) => n + r.ids.length, 0)}
      />
    </div>
  );
}
