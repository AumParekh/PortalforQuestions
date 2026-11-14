import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Check, ChevronDown, Play, X } from 'lucide-react';
import type { CatalogItem, Question, ScopeKind, SessionConfig, SessionFilters, SessionOrder } from '../types';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { buildCatalog } from '../lib/catalog';
import { buildQueue, countAvailable, hasActiveFilters, localToday, matchesFilters, searchHits } from '../lib/queue';
import { isQuestionDue } from '../lib/srs';
import { groupProgress } from '../lib/stats';
import type { GroupProgress } from '../lib/stats';
import { isCodeQuery, sectionCodeOf } from '../lib/search';
import { navigate } from '../lib/router';
import { SetupSearch, Highlight } from '../components/setup/SetupSearch';
import { FilterChip, FilterSheet } from '../components/setup/FilterSheet';
import { EMPTY_FILTERS, activeFilterCount, sanitizeFilters } from '../components/setup/filterModel';
import { BandBadge, KindBadge } from '../components/setup/BandBadge';
import { ScopeChips } from '../components/setup/ScopeChips';
import { profileKey } from '../games/profile';

/** Per profile: stored under `profileKey(...)` (games/profile.ts). */
const STORAGE_KEY = 'frm.sessionSetup.v1';
const SEARCH_DEBOUNCE_MS = 150;
const WEAK_THRESHOLD = 0.7;

type Count = number | 'all';
type RowChip = 'not-started' | 'weak' | 'due' | 'trap';

interface Options {
  count: Count;
  order: SessionOrder;
  timerEnabled: boolean;
  timerMinutes: number;
  trapOnly: boolean;
  wrongFirst: boolean;
  skipDrops: boolean;
}

interface Stored {
  scopeKind: ScopeKind;
  selectedKeys: string[];
  rowChips: RowChip[];
  options: Options;
  filters: SessionFilters;
}

// Chapters and LOs carry their official names; the old "topic" grouping is now the chapter itself.
// "Tier" lists the recall-workbook sections, grouped under Tier A to Tier D.
const SCOPES: { value: ScopeKind; label: string }[] = [
  { value: 'subject', label: 'Subject' },
  { value: 'reading', label: 'Chapter' },
  { value: 'lo', label: 'LO' },
  { value: 'section', label: 'Tier' },
];
const COUNTS: { value: Count; label: string }[] = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: 'all', label: 'All' },
];
const ORDERS: { value: SessionOrder; label: string }[] = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'shuffled', label: 'Shuffled' },
  { value: 'weakest', label: 'Weakest first' },
  { value: 'random', label: 'Random' },
];
const MINUTES: { value: number; label: string }[] = [
  { value: 1, label: '1 min' },
  { value: 2, label: '2 min' },
  { value: 3, label: '3 min' },
  { value: 5, label: '5 min' },
];
const ROW_CHIPS: { value: RowChip; label: string }[] = [
  { value: 'not-started', label: 'Not started' },
  { value: 'weak', label: 'Weak (<70%)' },
  { value: 'due', label: 'Due for review' },
  { value: 'trap', label: 'Has trap cards' },
];
const SCOPE_NOUN: Record<ScopeKind, string> = { subject: 'subjects', reading: 'chapters', topic: 'topics', lo: 'LOs', section: 'sections' };

const DEFAULTS: Stored = {
  scopeKind: 'subject',
  selectedKeys: [],
  rowChips: [],
  options: {
    count: 20,
    order: 'shuffled',
    timerEnabled: true,
    timerMinutes: 2,
    trapOnly: false,
    wrongFirst: false,
    skipDrops: false,
  },
  filters: EMPTY_FILTERS,
};

function pick<T>(value: unknown, allowed: { value: T }[], fallback: T): T {
  const hit = allowed.find((a) => a.value === value);
  return hit ? hit.value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** The timer the user last chose on Session Setup, for sessions started elsewhere. */
export function savedTimer(): { timerEnabled: boolean; timerSeconds: number } {
  const { timerEnabled, timerMinutes } = loadStored().options;
  return { timerEnabled, timerSeconds: timerMinutes * 60 };
}

function loadStored(): Stored {
  try {
    const raw = window.localStorage.getItem(profileKey(STORAGE_KEY));
    if (!raw) return DEFAULTS;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return DEFAULTS;
    const d = data as Record<string, unknown>;
    const o = (d.options && typeof d.options === 'object' ? d.options : {}) as Record<string, unknown>;
    const def = DEFAULTS.options;
    const rowChips = Array.isArray(d.rowChips) ? ROW_CHIPS.filter((c) => (d.rowChips as unknown[]).includes(c.value)).map((c) => c.value) : [];
    // Setups saved before row chips existed only stored the trap chip as a boolean.
    const legacyTrap = d.trapFilter === true && !Array.isArray(d.rowChips);
    if (d.trapFilter === true && !rowChips.includes('trap')) rowChips.push('trap');
    return {
      scopeKind: pick(d.scopeKind, SCOPES, DEFAULTS.scopeKind),
      selectedKeys: Array.isArray(d.selectedKeys)
        ? d.selectedKeys.filter((k): k is string => typeof k === 'string')
        : [],
      rowChips,
      options: {
        count: pick(o.count, COUNTS, def.count),
        order: pick(o.order, ORDERS, def.order),
        timerEnabled: bool(o.timerEnabled, def.timerEnabled),
        timerMinutes: pick(o.timerMinutes, MINUTES, def.timerMinutes),
        trapOnly: legacyTrap || bool(o.trapOnly, def.trapOnly),
        wrongFirst: bool(o.wrongFirst, def.wrongFirst),
        skipDrops: bool(o.skipDrops, def.skipDrops),
      },
      filters: sanitizeFilters(d.filters),
    };
  } catch {
    return DEFAULTS;
  }
}

function saveStored(value: Stored) {
  try {
    window.localStorage.setItem(profileKey(STORAGE_KEY), JSON.stringify({ ...value, trapFilter: value.rowChips.includes('trap') }));
  } catch {
    // Storage may be unavailable (private mode, quota); setup still works without it.
  }
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`min-h-[44px] rounded-lg px-2 text-[15px] font-medium leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'bg-card-light text-primary-700 shadow-sm dark:bg-card-dark dark:text-primary-100'
                : 'text-slate-700 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-700/60'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={disabled ? hint : undefined}
      onClick={() => onChange(!checked)}
      className="flex min-h-[56px] w-full items-center gap-4 py-2 text-left disabled:cursor-not-allowed"
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-base ${disabled ? 'text-slate-500 dark:text-slate-500' : ''}`}>{label}</span>
        {hint && <span className="block text-[15px] text-slate-600 dark:text-slate-400">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'
        } ${disabled ? 'opacity-50' : ''}`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[15px] font-medium text-slate-700 dark:text-slate-300">{label}</p>
      {children}
    </div>
  );
}

export function ProgressLine({ progress }: { progress: GroupProgress | undefined }) {
  if (!progress || progress.attempted === 0) {
    return <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">Not started</span>;
  }
  const pct = Math.round((progress.accuracy ?? 0) * 100);
  const weak = (progress.accuracy ?? 0) < WEAK_THRESHOLD;
  return (
    <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">
      <span className="tabular-nums">
        {progress.attempted}/{progress.total} done
      </span>
      <span aria-hidden="true"> · </span>
      <span
        className={`font-medium tabular-nums ${
          weak ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'
        }`}
      >
        {pct}% correct
      </span>
    </span>
  );
}

function ItemRow({
  item,
  selected,
  onToggle,
  query,
  matched,
  progress,
  showSublabel = true,
}: {
  item: CatalogItem;
  selected: boolean;
  onToggle: () => void;
  query: string;
  matched: number | null;
  progress: GroupProgress | undefined;
  /** False inside a folded group whose heading already says it. */
  showSublabel?: boolean;
}) {
  const n = item.questionIds.length;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={`flex min-h-[56px] w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
        selected
          ? 'border-transparent bg-primary-50 ring-1 ring-primary dark:bg-primary/15'
          : 'border-slate-200 bg-card-light hover:bg-slate-50 dark:border-slate-700 dark:bg-card-dark dark:hover:bg-slate-800'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
          selected ? 'border-primary bg-primary text-white' : 'border-slate-400 dark:border-slate-500'
        }`}
      >
        {selected && <Check className="h-4 w-4" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {(item.code || (item.kind !== 'subject' && item.bands && item.bands.length > 0)) && (
          <span className="mb-1 flex flex-wrap items-center gap-1.5">
            {item.code && (
              <span className="text-[15px] font-semibold text-primary-700 dark:text-primary-100">
                <Highlight text={item.code} query={query} />
              </span>
            )}
            {item.kind !== 'subject' && item.bands?.map((b) => <BandBadge key={b} band={b} />)}
            {item.loKind && <KindBadge kind={item.loKind} />}
          </span>
        )}
        <span className="block text-base leading-snug">
          {/* A code query ("MR-2 c") names the item; its letters are not words to mark in the wording. */}
          <Highlight text={item.label} query={isCodeQuery(query) ? '' : query} />
        </span>
        {item.sublabel && showSublabel && (
          <span className="mt-0.5 block text-[15px] text-slate-600 dark:text-slate-400">{item.sublabel}</span>
        )}
        <ProgressLine progress={progress} />
      </span>
      {matched === null ? (
        <span className="shrink-0 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[15px] font-medium tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {n} {n === 1 ? 'Q' : 'Qs'}
        </span>
      ) : (
        <span className="shrink-0 whitespace-nowrap rounded-full bg-yellow-100 px-2 py-0.5 text-[15px] font-medium tabular-nums text-yellow-900 dark:bg-yellow-500/20 dark:text-yellow-100">
          {matched} of {n} match
        </span>
      )}
    </button>
  );
}

interface ListGroup {
  key: string;
  title: string;
  items: CatalogItem[];
  subgroups: { key: string; title: string; items: CatalogItem[] }[];
}

function groupKey(scope: ScopeKind, subject: string, chapter?: string): string {
  return chapter === undefined ? `${scope}|${subject}` : `${scope}|${subject}|${chapter}`;
}

/** Chapter an LO row folds under ('' when the row has no official id). */
function chapterOf(item: CatalogItem): string {
  return item.code ? (item.sublabel ?? '') : '';
}

const COUNT_NOUN: Record<ScopeKind, [string, string]> = {
  subject: ['subject', 'subjects'],
  reading: ['chapter', 'chapters'],
  topic: ['topic', 'topics'],
  lo: ['LO', 'LOs'],
  section: ['section', 'sections'],
};

function countOf(n: number, kind: ScopeKind): string {
  return `${n} ${COUNT_NOUN[kind][n === 1 ? 0 : 1]}`;
}

/** Heading of a foldable group of rows: tap to fold or unfold; "Select" ticks every row in it. */
function GroupHeader({
  title,
  detail,
  items,
  selectedSet,
  open,
  locked,
  nested = false,
  onToggle,
  onSetAll,
}: {
  title: string;
  detail: string;
  items: CatalogItem[];
  selectedSet: Set<string>;
  open: boolean;
  /** While a search is typed every group with a match stays open. */
  locked: boolean;
  nested?: boolean;
  onToggle: () => void;
  onSetAll: (on: boolean) => void;
}) {
  const picked = items.reduce((n, it) => n + (selectedSet.has(it.key) ? 1 : 0), 0);
  const allOn = picked === items.length;
  return (
    <div
      className={`flex items-stretch gap-1 rounded-xl border ${
        picked > 0
          ? 'border-primary/40 bg-primary-50/60 dark:border-primary/40 dark:bg-primary/10'
          : 'border-slate-200 bg-card-light dark:border-slate-700 dark:bg-card-dark'
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        disabled={locked}
        onClick={onToggle}
        className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800"
      >
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400 ${open ? '' : '-rotate-90'}`}
          aria-hidden="true"
        />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className={`block leading-snug text-slate-900 dark:text-slate-100 ${nested ? 'text-[15px] font-medium' : 'text-base font-semibold'}`}>
            {title}
          </span>
          <span className="block text-[15px] text-slate-600 dark:text-slate-400">
            {detail}
            {picked > 0 && ` · ${picked} selected`}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onSetAll(!allOn)}
        aria-label={`${allOn ? 'Clear' : 'Select'} all in ${title}`}
        className="min-h-[44px] shrink-0 rounded-xl px-3 text-[15px] font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
      >
        {allOn ? 'Clear' : 'Select'}
      </button>
    </div>
  );
}

export function SessionSetupScreen() {
  const byId = useContent((s) => s.byId);
  const states = useProgress((s) => s.states);
  const pendingQuery = useUi((s) => s.pendingSetupQuery);
  // Mock exams run through their own flow; setup only draws from subject banks.
  const questions = useContent((s) => s.subjectQuestions);

  const pendingSelection = useUi((s) => s.pendingSetupSelection);
  // A scope and selection handed over by the dashboard (a tier card) replace the saved ones; options and filters stay.
  const [initial] = useState((): Stored => ({ ...loadStored(), ...useUi.getState().pendingSetupSelection }));
  const [scopeKind, setScopeKind] = useState<ScopeKind>(initial.scopeKind);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(initial.selectedKeys);
  const [rowChips, setRowChips] = useState<RowChip[]>(initial.rowChips);
  const [options, setOptions] = useState<Options>(initial.options);
  const [filters, setFilters] = useState<SessionFilters>(initial.filters);
  const [optionsOpen, setOptionsOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchText, setSearchText] = useState(() => useUi.getState().pendingSetupQuery ?? '');
  const [query, setQuery] = useState(searchText);
  const autoSelectRef = useRef<string | null>(null);

  useEffect(() => {
    if (searchText === query) return;
    const t = window.setTimeout(() => setQuery(searchText), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchText, query]);

  const catalog = useMemo(() => buildCatalog(questions, scopeKind), [questions, scopeKind]);

  const searchActive = query.trim().length > 0;
  const filtersActive = hasActiveFilters(filters);
  const bands = useMemo(() => filters.bands ?? [], [filters.bands]);
  const kinds = useMemo(() => filters.kinds ?? [], [filters.kinds]);
  const filterCount = activeFilterCount(filters);

  const matchedIds = useMemo(() => {
    if (!searchActive && !filtersActive) return null;
    const hits = searchHits(query, questions);
    const today = localToday();
    const out = new Set<string>();
    for (const q of questions) {
      if (hits && !hits.has(q.id)) continue;
      if (filtersActive && !matchesFilters(q, states[q.id], filters, today)) continue;
      out.add(q.id);
    }
    return out;
  }, [searchActive, filtersActive, query, questions, filters, states]);

  const matchCounts = useMemo(() => {
    if (!matchedIds) return null;
    const m = new Map<string, number>();
    for (const it of catalog) m.set(it.key, it.questionIds.reduce((n, id) => n + (matchedIds.has(id) ? 1 : 0), 0));
    return m;
  }, [catalog, matchedIds]);

  const progressByKey = useMemo(() => {
    const m = new Map<string, GroupProgress>();
    for (const it of catalog) {
      const qs = it.questionIds.map((id) => byId[id]).filter((q): q is Question => !!q);
      const [g] = groupProgress(qs, states, () => ({ key: it.key, label: it.label }));
      if (g) m.set(it.key, g);
    }
    return m;
  }, [catalog, byId, states]);

  const trapItemKeys = useMemo(() => {
    const trapIds = new Set(questions.filter((q) => q.trap.operators.length > 0).map((q) => q.id));
    return new Set(catalog.filter((it) => it.questionIds.some((id) => trapIds.has(id))).map((it) => it.key));
  }, [questions, catalog]);

  const dueItemKeys = useMemo(() => {
    if (!rowChips.includes('due')) return null;
    const today = localToday();
    return new Set(catalog.filter((it) => it.questionIds.some((id) => isQuestionDue(states[id], today))).map((it) => it.key));
  }, [catalog, states, rowChips]);

  // In the Tier scope a section code names one row. Its questions also sit in other sections, which would match too.
  const namedSection = useMemo(() => {
    const code = scopeKind === 'section' ? sectionCodeOf(query) : null;
    return code !== null && catalog.some((it) => it.code === code) ? code : null;
  }, [scopeKind, query, catalog]);

  const visible = useMemo(() => {
    const notStarted = rowChips.includes('not-started');
    const weak = rowChips.includes('weak');
    const trap = rowChips.includes('trap');
    return catalog.filter((it) => {
      if (namedSection !== null && it.code !== namedSection) return false;
      if (matchCounts && (matchCounts.get(it.key) ?? 0) === 0) return false;
      if (trap && !trapItemKeys.has(it.key)) return false;
      // Progress chips (not started / weak / due) match any of the selected: "not started" and "due" can't both hold.
      if (notStarted || weak || dueItemKeys) {
        const g = progressByKey.get(it.key);
        const isNew = !g || g.attempted === 0;
        const isWeak = !!g && g.attempts > 0 && g.accuracy !== null && g.accuracy < WEAK_THRESHOLD;
        if (!((notStarted && isNew) || (weak && isWeak) || (dueItemKeys && dueItemKeys.has(it.key)))) return false;
      }
      return true;
    });
  }, [catalog, rowChips, namedSection, matchCounts, trapItemKeys, dueItemKeys, progressByKey]);

  // Rows fold under their subject (or tier); in the LO scope they fold once more under their chapter.
  const groups = useMemo((): ListGroup[] => {
    if (scopeKind === 'subject') return [{ key: '', title: '', items: visible, subgroups: [] }];
    const map = new Map<string, CatalogItem[]>();
    for (const it of visible) {
      const list = map.get(it.subject);
      if (list) list.push(it);
      else map.set(it.subject, [it]);
    }
    return [...map.entries()].map(([subject, items]) => {
      const chapters = new Map<string, CatalogItem[]>();
      if (scopeKind === 'lo') {
        for (const it of items) {
          const chapter = chapterOf(it);
          const list = chapters.get(chapter);
          if (list) list.push(it);
          else chapters.set(chapter, [it]);
        }
      }
      // LOs without an official id have no chapter to fold under: the subject then lists its rows directly.
      const nested = chapters.size > 0 && !chapters.has('');
      return {
        key: groupKey(scopeKind, subject),
        title: subject,
        items,
        subgroups: nested ? [...chapters.entries()].map(([title, list]) => ({ key: groupKey(scopeKind, subject, title), title, items: list })) : [],
      };
    });
  }, [visible, scopeKind]);

  const selectedSet = useMemo(() => {
    const valid = new Set(catalog.map((it) => it.key));
    return new Set(selectedKeys.filter((k) => valid.has(k)));
  }, [catalog, selectedKeys]);

  // Groups start folded, except those that hold something already selected; a text search unfolds every match.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const openedFor = useRef<ScopeKind | null>(null);
  useEffect(() => {
    if (openedFor.current === scopeKind || catalog.length === 0) return;
    openedFor.current = scopeKind;
    const next = new Set<string>();
    for (const it of catalog) {
      if (!selectedSet.has(it.key)) continue;
      next.add(groupKey(scopeKind, it.subject));
      if (scopeKind === 'lo' && chapterOf(it)) next.add(groupKey(scopeKind, it.subject, chapterOf(it)));
    }
    setOpenGroups(next);
  }, [scopeKind, catalog, selectedSet]);
  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allGroupKeys = useMemo(() => groups.flatMap((g) => [g.key, ...g.subgroups.map((sg) => sg.key)]).filter(Boolean), [groups]);
  const allOpen = allGroupKeys.length > 0 && allGroupKeys.every((k) => openGroups.has(k));

  const hiddenSelected = useMemo(() => {
    const shown = new Set(visible.map((it) => it.key));
    let n = 0;
    for (const k of selectedSet) if (!shown.has(k)) n++;
    return n;
  }, [visible, selectedSet]);

  useEffect(() => {
    if (pendingQuery === null) return;
    setSearchText(pendingQuery);
    setQuery(pendingQuery);
    autoSelectRef.current = pendingQuery;
    useUi.getState().setPendingSetupQuery(null);
  }, [pendingQuery]);

  useEffect(() => {
    if (pendingSelection === null) return;
    setScopeKind(pendingSelection.scopeKind);
    setSelectedKeys(pendingSelection.selectedKeys);
    useUi.getState().setPendingSetupSelection(null);
    // The tier cards sit well down the dashboard and the page keeps its scroll position: show the list from its top.
    window.scrollTo({ top: 0 });
  }, [pendingSelection]);

  // Arriving from the dashboard with a query: make "start with these" a single tap unless the saved selection already covers matches.
  useEffect(() => {
    const arrivedWith = autoSelectRef.current;
    if (arrivedWith === null || questions.length === 0) return;
    autoSelectRef.current = null;
    const hits = searchHits(arrivedWith, questions);
    const selectedIds = catalog.filter((it) => selectedSet.has(it.key)).flatMap((it) => it.questionIds);
    if (selectedSet.size > 0 && (!hits || selectedIds.some((id) => hits.has(id)))) return;
    setScopeKind('subject');
    setSelectedKeys(buildCatalog(questions, 'subject').map((it) => it.key));
  }, [questions, catalog, selectedSet, pendingQuery]);

  const config: SessionConfig = useMemo(
    () => ({
      scopeKind,
      selectedKeys: [...selectedSet],
      count: options.count,
      order: options.order,
      timerEnabled: options.timerEnabled,
      timerSeconds: options.timerMinutes * 60,
      trapOnly: options.trapOnly,
      wrongFirst: options.wrongFirst,
      skipDrops: options.skipDrops,
      mode: 'drill',
      searchQuery: searchActive ? query.trim() : undefined,
      filters,
    }),
    [scopeKind, selectedSet, options, searchActive, query, filters],
  );

  const available = useMemo(() => countAvailable(config, questions, states), [config, questions, states]);

  useEffect(() => {
    saveStored({ scopeKind, selectedKeys: [...selectedSet], rowChips, options, filters });
  }, [scopeKind, selectedSet, rowChips, options, filters]);

  const setOption = <K extends keyof Options>(key: K, value: Options[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  const changeScope = (kind: ScopeKind) => {
    if (kind === scopeKind) return;
    setScopeKind(kind);
    setSelectedKeys([]);
  };

  const toggleItem = (key: string) =>
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const toggleChip = (chip: RowChip) =>
    setRowChips((prev) => (prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]));

  const setMany = (keys: string[], on: boolean) =>
    setSelectedKeys((prev) => {
      if (!on) {
        const drop = new Set(keys);
        return prev.filter((k) => !drop.has(k));
      }
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return [...next];
    });

  const clearSearch = () => {
    setSearchText('');
    setQuery('');
  };

  const countFor = (f: SessionFilters) =>
    selectedSet.size === 0 ? null : countAvailable({ ...config, filters: f }, questions, states);

  const canStart = selectedSet.size > 0 && available > 0;

  const start = () => {
    if (!canStart) return;
    const queue = buildQueue(config, questions, states);
    if (queue.length === 0) return;
    // start() returns false when the user keeps a session already in progress.
    if (!useSession.getState().start(config, queue)) return;
    navigate('/session');
  };

  const sessionSize = options.count === 'all' ? available : Math.min(options.count, available);
  const narrowed = searchActive || filtersActive || options.trapOnly;
  const counterText =
    selectedSet.size === 0
      ? 'Nothing selected'
      : available === 0
        ? narrowed
          ? 'No questions match'
          : '0 questions'
        : options.count === 'all' || sessionSize === available
          ? `${available} ${available === 1 ? 'question' : 'questions'} selected`
          : `${sessionSize} of ${available} questions`;

  const pillClass =
    'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-200 px-3.5 text-[15px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b pt-[env(safe-area-inset-top)] border-slate-200 bg-surface-light/85 backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={() => navigate('/practice')}
            aria-label="Back to Practice"
            className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">New Session</h1>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] space-y-5 px-4 pb-36 pt-4">
        <section aria-label="Scope" className="space-y-3">
          <Segmented label="Select by" value={scopeKind} options={SCOPES} onChange={changeScope} />

          <SetupSearch
            value={searchText}
            onChange={setSearchText}
            filterCount={filterCount}
            onOpenFilters={() => setFiltersOpen(true)}
          />

          <ScopeChips filters={filters} onChange={setFilters} />

          {(searchActive || filterCount > 0) && (
            <div className="flex flex-wrap gap-2">
              {searchActive && (
                <button type="button" onClick={clearSearch} className={pillClass}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Clear search
                </button>
              )}
              {filterCount > 0 && (
                <button type="button" onClick={() => setFilters({ ...EMPTY_FILTERS, bands, kinds, recallOnly: filters.recallOnly })} className={pillClass}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Clear {filterCount} {filterCount === 1 ? 'filter' : 'filters'}
                </button>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div role="group" aria-label={`Show ${SCOPE_NOUN[scopeKind]}`} className="flex flex-wrap gap-2">
              {ROW_CHIPS.map((c) => (
                <FilterChip key={c.value} active={rowChips.includes(c.value)} onClick={() => toggleChip(c.value)}>
                  {c.label}
                </FilterChip>
              ))}
            </div>
            <p className="text-[15px] text-slate-600 dark:text-slate-400">
              Chips narrow the list of {SCOPE_NOUN[scopeKind]} below. Search and Filters narrow the questions that go into the
              session.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[15px] text-slate-600 dark:text-slate-400">
              {selectedSet.size} of {catalog.length} selected
              {hiddenSelected > 0 && ` · ${hiddenSelected} hidden`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMany(visible.map((it) => it.key), true)}
                className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-[15px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setSelectedKeys([])}
                className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-[15px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Clear all
              </button>
            </div>
          </div>

          {allGroupKeys.length > 0 && !searchActive && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setOpenGroups(allOpen ? new Set() : new Set(allGroupKeys))}
                className="min-h-[44px] rounded-lg px-2 text-[15px] font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          )}

          {visible.length === 0 ? (
            <div className="space-y-3 rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark">
              <p className="text-slate-600 dark:text-slate-400">
                {searchActive && catalog.length > 0 && matchCounts && [...matchCounts.values()].every((n) => n === 0)
                  ? `No questions match “${query.trim()}”${filtersActive ? ' with the current filters' : ''}.`
                  : `No ${SCOPE_NOUN[scopeKind]} match the current search, filters and chips.`}
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
                {rowChips.length > 0 && (
                  <button type="button" onClick={() => setRowChips([])} className={pillClass}>
                    Clear chips
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => {
                const rows = (items: CatalogItem[]) => (
                  <ul className="space-y-2">
                    {items.map((it) => (
                      <li key={it.key}>
                        <ItemRow
                          item={it}
                          selected={selectedSet.has(it.key)}
                          onToggle={() => toggleItem(it.key)}
                          query={searchActive ? query : ''}
                          matched={matchCounts ? (matchCounts.get(it.key) ?? 0) : null}
                          progress={progressByKey.get(it.key)}
                          showSublabel={!g.title}
                        />
                      </li>
                    ))}
                  </ul>
                );
                if (!g.title) return <div key="all">{rows(g.items)}</div>;
                const open = searchActive || openGroups.has(g.key);
                return (
                  <div key={g.key} className="space-y-2">
                    <GroupHeader
                      title={g.title}
                      detail={
                        g.subgroups.length > 0
                          ? `${countOf(g.items.length, scopeKind)} in ${countOf(g.subgroups.length, 'reading')}`
                          : countOf(g.items.length, scopeKind)
                      }
                      items={g.items}
                      selectedSet={selectedSet}
                      open={open}
                      locked={searchActive}
                      onToggle={() => toggleGroup(g.key)}
                      onSetAll={(on) => setMany(g.items.map((it) => it.key), on)}
                    />
                    {open &&
                      (g.subgroups.length === 0 ? (
                        rows(g.items)
                      ) : (
                        <div className="space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                          {g.subgroups.map((sg) => {
                            const subOpen = searchActive || openGroups.has(sg.key);
                            return (
                              <div key={sg.key} className="space-y-2">
                                <GroupHeader
                                  title={sg.title}
                                  detail={countOf(sg.items.length, 'lo')}
                                  items={sg.items}
                                  selectedSet={selectedSet}
                                  open={subOpen}
                                  locked={searchActive}
                                  nested
                                  onToggle={() => toggleGroup(sg.key)}
                                  onSetAll={(on) => setMany(sg.items.map((it) => it.key), on)}
                                />
                                {subOpen && rows(sg.items)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-card-light shadow-sm dark:bg-card-dark">
          <button
            type="button"
            aria-expanded={optionsOpen}
            aria-controls="session-options"
            onClick={() => setOptionsOpen((v) => !v)}
            className="flex min-h-[56px] w-full items-center justify-between gap-2 px-4 text-left"
          >
            <span className="text-base font-semibold">Session options</span>
            <ChevronDown className={`h-5 w-5 transition-transform ${optionsOpen ? 'rotate-180' : ''}`} />
          </button>
          {optionsOpen && (
            <div id="session-options" className="space-y-5 border-t border-slate-200 px-4 pb-4 pt-4 dark:border-slate-700">
              <Field label="Questions">
                <Segmented label="Question count" value={options.count} options={COUNTS} onChange={(v) => setOption('count', v)} />
              </Field>
              <Field label="Order">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ORDERS.map((o) => {
                    const active = options.order === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setOption('order', o.value)}
                        className={`min-h-[44px] rounded-xl border px-2 text-[15px] font-medium transition-colors ${
                          active
                            ? 'border-transparent bg-primary-50 text-primary-700 ring-1 ring-primary dark:bg-primary/15 dark:text-primary-100'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
                {options.order === 'weakest' && (
                  <p className="text-[15px] text-slate-600 dark:text-slate-400">
                    Lowest accuracy first. Questions you haven't tried count as 50%.
                  </p>
                )}
              </Field>

              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                <Toggle label="Timer" checked={options.timerEnabled} onChange={(v) => setOption('timerEnabled', v)} />
                {options.timerEnabled && (
                  <div className="py-3">
                    <Segmented
                      label="Time per question"
                      value={options.timerMinutes}
                      options={MINUTES}
                      onChange={(v) => setOption('timerMinutes', v)}
                    />
                  </div>
                )}
                <Toggle
                  label="Trap cards only"
                  hint="Only questions with a trap explanation"
                  checked={options.trapOnly}
                  onChange={(v) => setOption('trapOnly', v)}
                />
                <Toggle
                  label="Wrong questions first"
                  hint="Questions you got wrong last time come first"
                  checked={options.wrongFirst}
                  onChange={(v) => setOption('wrongFirst', v)}
                />
                <Toggle
                  label="Skip drops question"
                  hint={options.skipDrops ? 'Skipped questions leave the session' : 'Skipped questions move to the end'}
                  checked={options.skipDrops}
                  onChange={(v) => setOption('skipDrops', v)}
                />
              </div>
            </div>
          )}
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-surface-light/85 backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p aria-live="polite" className="min-w-0 text-[15px] font-medium tabular-nums text-slate-700 dark:text-slate-300">
            {counterText}
          </p>
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            className="inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            <Play className="h-4 w-4" />
            Start Session
          </button>
        </div>
      </div>

      <FilterSheet
        open={filtersOpen}
        value={filters}
        onApply={setFilters}
        onClose={() => setFiltersOpen(false)}
        countFor={countFor}
      />
    </div>
  );
}
