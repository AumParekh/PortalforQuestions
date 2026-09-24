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
import { groupProgress } from '../lib/stats';
import type { GroupProgress } from '../lib/stats';
import { navigate } from '../lib/router';
import { SetupSearch, Highlight } from '../components/setup/SetupSearch';
import { DUE_HINT, FilterChip, FilterSheet } from '../components/setup/FilterSheet';
import { EMPTY_FILTERS, activeFilterCount, sanitizeFilters } from '../components/setup/filterModel';

const STORAGE_KEY = 'frm.sessionSetup.v1';
const SEARCH_DEBOUNCE_MS = 150;
const WEAK_THRESHOLD = 0.7;

type Count = number | 'all';
type RowChip = 'not-started' | 'weak' | 'trap';

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

const SCOPES: { value: ScopeKind; label: string }[] = [
  { value: 'subject', label: 'Subject' },
  { value: 'reading', label: 'Reading' },
  { value: 'topic', label: 'Topic' },
  { value: 'lo', label: 'LO' },
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
  { value: 'trap', label: 'Has trap cards' },
];
const SCOPE_NOUN: Record<ScopeKind, string> = { subject: 'subjects', reading: 'readings', topic: 'topics', lo: 'LOs' };

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

function loadStored(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return DEFAULTS;
    const d = data as Record<string, unknown>;
    const o = (d.options && typeof d.options === 'object' ? d.options : {}) as Record<string, unknown>;
    const def = DEFAULTS.options;
    const rowChips = Array.isArray(d.rowChips) ? ROW_CHIPS.filter((c) => (d.rowChips as unknown[]).includes(c.value)).map((c) => c.value) : [];
    // Setups saved before row chips existed only stored the trap chip as a boolean.
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
        trapOnly: bool(o.trapOnly, def.trapOnly),
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...value, trapFilter: value.rowChips.includes('trap') }));
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

function ProgressLine({ progress }: { progress: GroupProgress | undefined }) {
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
}: {
  item: CatalogItem;
  selected: boolean;
  onToggle: () => void;
  query: string;
  matched: number | null;
  progress: GroupProgress | undefined;
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
        <span className="block text-base leading-snug">
          <Highlight text={item.label} query={query} />
        </span>
        {item.sublabel && (
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

export function SessionSetupScreen() {
  const allQuestions = useContent((s) => s.questions);
  const byId = useContent((s) => s.byId);
  const states = useProgress((s) => s.states);
  const pendingQuery = useUi((s) => s.pendingSetupQuery);
  // Mock exams run through their own flow; setup only draws from subject banks.
  const questions = useMemo(() => allQuestions.filter((q) => !q.file.startsWith('mocks/')), [allQuestions]);

  const [initial] = useState(loadStored);
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

  const visible = useMemo(() => {
    const notStarted = rowChips.includes('not-started');
    const weak = rowChips.includes('weak');
    const trap = rowChips.includes('trap');
    return catalog.filter((it) => {
      if (matchCounts && (matchCounts.get(it.key) ?? 0) === 0) return false;
      if (trap && !trapItemKeys.has(it.key)) return false;
      if (notStarted || weak) {
        const g = progressByKey.get(it.key);
        const isNew = !g || g.attempted === 0;
        const isWeak = !!g && g.attempts > 0 && g.accuracy !== null && g.accuracy < WEAK_THRESHOLD;
        if (!((notStarted && isNew) || (weak && isWeak))) return false;
      }
      return true;
    });
  }, [catalog, rowChips, matchCounts, trapItemKeys, progressByKey]);

  const groups = useMemo(() => {
    if (scopeKind === 'subject') return [{ subject: '', items: visible }];
    const map = new Map<string, CatalogItem[]>();
    for (const it of visible) {
      const list = map.get(it.subject);
      if (list) list.push(it);
      else map.set(it.subject, [it]);
    }
    return [...map.entries()].map(([subject, items]) => ({ subject, items }));
  }, [visible, scopeKind]);

  const selectedSet = useMemo(() => {
    const valid = new Set(catalog.map((it) => it.key));
    return new Set(selectedKeys.filter((k) => valid.has(k)));
  }, [catalog, selectedKeys]);

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
    useSession.getState().start(config, queue);
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
            onClick={() => navigate('/')}
            aria-label="Back to home"
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

          {(searchActive || filtersActive) && (
            <div className="flex flex-wrap gap-2">
              {searchActive && (
                <button type="button" onClick={clearSearch} className={pillClass}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Clear search
                </button>
              )}
              {filtersActive && (
                <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className={pillClass}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Clear {filterCount} {filterCount === 1 ? 'filter' : 'filters'}
                </button>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div role="group" aria-label={`Show ${SCOPE_NOUN[scopeKind]}`} className="flex flex-wrap gap-2">
              {ROW_CHIPS.slice(0, 2).map((c) => (
                <FilterChip key={c.value} active={rowChips.includes(c.value)} onClick={() => toggleChip(c.value)}>
                  {c.label}
                </FilterChip>
              ))}
              <FilterChip active={false} disabled title={DUE_HINT} onClick={() => {}}>
                Due for review
              </FilterChip>
              <FilterChip active={rowChips.includes('trap')} onClick={() => toggleChip('trap')}>
                Has trap cards
              </FilterChip>
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
            <div className="space-y-5">
              {groups.map((g) => {
                const allOn = g.items.every((it) => selectedSet.has(it.key));
                return (
                  <div key={g.subject || 'all'} className="space-y-2">
                    {g.subject && (
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <h2 className="text-[15px] font-semibold text-slate-800 dark:text-slate-200">{g.subject}</h2>
                        <button
                          type="button"
                          onClick={() => setMany(g.items.map((it) => it.key), !allOn)}
                          className="min-h-[44px] shrink-0 rounded-lg px-2 text-[15px] font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
                        >
                          {allOn ? 'Clear group' : 'Select group'}
                        </button>
                      </div>
                    )}
                    <ul className="space-y-2">
                      {g.items.map((it) => (
                        <li key={it.key}>
                          <ItemRow
                            item={it}
                            selected={selectedSet.has(it.key)}
                            onToggle={() => toggleItem(it.key)}
                            query={searchActive ? query : ''}
                            matched={matchCounts ? (matchCounts.get(it.key) ?? 0) : null}
                            progress={progressByKey.get(it.key)}
                          />
                        </li>
                      ))}
                    </ul>
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
