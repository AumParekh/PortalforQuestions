import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilterX,
  History,
  Play,
  Plus,
  SearchX,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { navigate } from '../lib/router';
import { wrongQuestionStates } from '../lib/stats';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { useSession } from '../store/session';
import type { Question, QuestionState, SessionConfig, TrapOperator } from '../types';

type DateRange = 'all' | '7' | '30';

interface Row {
  q: Question;
  state: QuestionState;
  lastMissed: string | null;
  loKey: string;
  stillWrong: boolean;
}

const REVIEW_CONFIG: SessionConfig = {
  scopeKind: 'subject',
  selectedKeys: [],
  count: 'all',
  order: 'shuffled',
  timerEnabled: true,
  timerSeconds: 120,
  trapOnly: false,
  wrongFirst: false,
  skipDrops: false,
  mode: 'review-wrong',
};

const DATE_OPTIONS: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
];

const DAY_MS = 86_400_000;

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function snippet(text: string): string {
  const clean = text
    .replace(/\\(?:text|mathrm|mathbf|operatorname|left|right|displaystyle)\b/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/[$|\\`#{}]/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 140 ? `${clean.slice(0, 140).trimEnd()}…` : clean;
}

function humanizeTrap(op: TrapOperator): string {
  const words = op.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function relativeDay(iso: string | null, now: Date): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function isWide(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches;
}

const selectClass =
  'mt-1 block min-h-[44px] w-full rounded-xl border border-slate-200 bg-card-light px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-card-dark dark:text-slate-100';

function chipClass(active: boolean): string {
  return `inline-flex min-h-[44px] items-center rounded-full border px-3 text-[15px] font-medium transition ${
    active
      ? 'border-primary bg-primary-50 text-primary-700 dark:border-primary-500 dark:bg-primary-500/20 dark:text-primary-100'
      : 'border-slate-200 bg-card-light text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-card-dark dark:text-slate-200 dark:hover:bg-slate-700'
  }`;
}

function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/85">
      <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-4 py-1">
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="Back to home"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="text-lg font-semibold tracking-tight">Review wrong</h1>
      </div>
    </header>
  );
}

function StorageNotice() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[15px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p>
        This browser won't let the app save progress (often a private-browsing restriction). Questions you miss appear here only until
        you close or reload the page.
      </p>
    </div>
  );
}

export function ReviewWrongScreen() {
  const states = useProgress((s) => s.states);
  const attempts = useProgress((s) => s.attempts);
  const progressStatus = useProgress((s) => s.status);
  const byId = useContent((s) => s.byId);

  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [lo, setLo] = useState('');
  const [traps, setTraps] = useState<TrapOperator[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [stillWrongOnly, setStillWrongOnly] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(isWide);

  // Re-read the clock whenever attempts change so "today"/"yesterday" stay right after a drill.
  const now = useMemo(() => new Date(), [attempts]);

  const lastMissedById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of attempts) {
      if (a.isCorrect) continue;
      const prev = map.get(a.questionId);
      if (!prev || a.timestamp > prev) map.set(a.questionId, a.timestamp);
    }
    return map;
  }, [attempts]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const state of wrongQuestionStates(states)) {
      const q = byId[state.questionId];
      if (!q) continue;
      out.push({
        q,
        state,
        lastMissed: lastMissedById.get(q.id) ?? (state.lastResult === 'wrong' ? state.lastAttempted : null),
        loKey: q.loText || q.lo,
        stillWrong: state.lastResult === 'wrong',
      });
    }
    return out;
  }, [states, byId, lastMissedById]);

  const subjects = useMemo(() => uniqueSorted(rows.map((r) => r.q.subject)), [rows]);
  const topics = useMemo(() => uniqueSorted(rows.filter((r) => !subject || r.q.subject === subject).map((r) => r.q.topic)), [rows, subject]);
  const los = useMemo(
    () =>
      uniqueSorted(
        rows.filter((r) => (!subject || r.q.subject === subject) && (!topic || r.q.topic === topic)).map((r) => r.loKey),
      ),
    [rows, subject, topic],
  );
  const trapOptions = useMemo(() => {
    const set = new Set<TrapOperator>();
    for (const r of rows) for (const op of r.q.trap?.operators ?? []) set.add(op);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const cutoff = dateRange === 'all' ? null : startOfDay(now) - (Number(dateRange) - 1) * DAY_MS;
    return rows.filter((r) => {
      if (stillWrongOnly && !r.stillWrong) return false;
      if (subject && r.q.subject !== subject) return false;
      if (topic && r.q.topic !== topic) return false;
      if (lo && r.loKey !== lo) return false;
      if (traps.length > 0 && !(r.q.trap?.operators ?? []).some((op) => traps.includes(op))) return false;
      if (cutoff !== null) {
        const t = r.lastMissed ? Date.parse(r.lastMissed) : NaN;
        if (!Number.isFinite(t) || t < cutoff) return false;
      }
      return true;
    });
  }, [rows, stillWrongOnly, subject, topic, lo, traps, dateRange, now]);

  const activeFilterCount =
    (subject ? 1 : 0) + (topic ? 1 : 0) + (lo ? 1 : 0) + (traps.length > 0 ? 1 : 0) + (dateRange !== 'all' ? 1 : 0);
  const hasAnyFilter = activeFilterCount > 0 || !stillWrongOnly;
  const stillWrongCount = useMemo(() => rows.filter((r) => r.stillWrong).length, [rows]);

  const clearFilters = () => {
    setSubject('');
    setTopic('');
    setLo('');
    setTraps([]);
    setDateRange('all');
    setStillWrongOnly(true);
  };

  const toggleTrap = (op: TrapOperator) =>
    setTraps((prev) => (prev.includes(op) ? prev.filter((t) => t !== op) : [...prev, op]));

  const startSession = (ids: string[]) => {
    if (ids.length === 0) return;
    useSession.getState().start({ ...REVIEW_CONFIG }, ids);
    navigate('/session');
  };

  const drillAll = () => startSession(shuffle(filtered.map((r) => r.q.id)));

  if (rows.length === 0) {
    return (
      <div className="flex min-h-screen flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[720px] flex-1 space-y-4 px-4 py-6">
          {progressStatus === 'unavailable' && <StorageNotice />}
          <section className="flex flex-col items-center rounded-2xl bg-card-light px-5 py-10 text-center shadow-sm dark:bg-card-dark">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <History className="h-7 w-7" aria-hidden="true" />
            </span>
            <p className="mt-4 text-lg font-semibold">Nothing to review yet</p>
            <p className="mt-1 max-w-sm text-slate-600 dark:text-slate-400">Questions you get wrong will collect here.</p>
            <button
              type="button"
              onClick={() => navigate('/setup')}
              className="mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary px-5 font-medium text-white shadow-sm transition hover:bg-primary-600"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              Start a session
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />

      <main className="mx-auto w-full max-w-[720px] flex-1 space-y-4 px-4 py-4">
        {progressStatus === 'unavailable' && <StorageNotice />}

        <section className="rounded-2xl bg-card-light p-3 shadow-sm dark:bg-card-dark sm:p-4" aria-label="Filters">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls="review-filters"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
              Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary px-2 text-[15px] font-semibold leading-6 text-white">{activeFilterCount}</span>
              )}
              <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            <button
              type="button"
              role="switch"
              aria-checked={stillWrongOnly}
              onClick={() => setStillWrongOnly((v) => !v)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-2 text-[15px] font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <span
                className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
                  stillWrongOnly ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'
                }`}
                aria-hidden="true"
              >
                <span
                  className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    stillWrongOnly ? 'translate-x-[18px]' : 'translate-x-0.5'
                  }`}
                />
              </span>
              Still wrong only
            </button>
          </div>

          {filtersOpen && (
            <div id="review-filters" className="mt-3 space-y-4 border-t border-slate-200 pt-3 dark:border-slate-700">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-[15px] font-medium text-slate-600 dark:text-slate-400">
                  Subject
                  <select
                    className={selectClass}
                    value={subject}
                    onChange={(e: { currentTarget: HTMLSelectElement }) => {
                      setSubject(e.currentTarget.value);
                      setTopic('');
                      setLo('');
                    }}
                  >
                    <option value="">All subjects</option>
                    {subjects.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[15px] font-medium text-slate-600 dark:text-slate-400">
                  Topic
                  <select
                    className={selectClass}
                    value={topic}
                    onChange={(e: { currentTarget: HTMLSelectElement }) => {
                      setTopic(e.currentTarget.value);
                      setLo('');
                    }}
                  >
                    <option value="">All topics</option>
                    {topics.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[15px] font-medium text-slate-600 dark:text-slate-400 sm:col-span-2">
                  Learning objective
                  <select className={selectClass} value={lo} onChange={(e: { currentTarget: HTMLSelectElement }) => setLo(e.currentTarget.value)}>
                    <option value="">All learning objectives</option>
                    {los.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset>
                <legend className="text-[15px] font-medium text-slate-600 dark:text-slate-400">Last missed</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {DATE_OPTIONS.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      aria-pressed={dateRange === d.key}
                      onClick={() => setDateRange(d.key)}
                      className={chipClass(dateRange === d.key)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {trapOptions.length > 0 && (
                <fieldset>
                  <legend className="text-[15px] font-medium text-slate-600 dark:text-slate-400">Trap type</legend>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {trapOptions.map((op) => (
                      <button
                        key={op}
                        type="button"
                        aria-pressed={traps.includes(op)}
                        onClick={() => toggleTrap(op)}
                        className={chipClass(traps.includes(op))}
                      >
                        {humanizeTrap(op)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
            <p className="text-[15px] text-slate-600 dark:text-slate-400" aria-live="polite">
              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{filtered.length}</span>{' '}
              {filtered.length === 1 ? 'question' : 'questions'}
              {stillWrongOnly && stillWrongCount < rows.length && (
                <span> · {rows.length - stillWrongCount} fixed hidden</span>
              )}
            </p>
            {hasAnyFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-[15px] font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary-500/20"
              >
                <FilterX className="h-4 w-4" aria-hidden="true" />
                Clear filters
              </button>
            )}
          </div>
        </section>

        {filtered.length === 0 ? (
          <section className="flex flex-col items-center rounded-2xl bg-card-light px-5 py-10 text-center shadow-sm dark:bg-card-dark">
            <SearchX className="h-8 w-8 text-slate-400" aria-hidden="true" />
            <p className="mt-3 text-lg font-semibold">No questions match these filters</p>
            {stillWrongOnly && stillWrongCount === 0 && (
              <p className="mt-1 max-w-sm text-slate-600 dark:text-slate-400">
                Every question you've missed has since been answered correctly. Turn off "Still wrong only" to drill them again.
              </p>
            )}
            <button
              type="button"
              onClick={clearFilters}
              className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 px-4 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FilterX className="h-5 w-5" aria-hidden="true" />
              Clear filters
            </button>
          </section>
        ) : (
          <ul className="space-y-2">
            {filtered.map((r) => {
              const operators = r.q.trap?.operators ?? [];
              return (
                <li key={r.q.id}>
                  <button
                    type="button"
                    onClick={() => startSession([r.q.id])}
                    className="flex min-h-[56px] w-full items-start gap-3 rounded-2xl bg-card-light p-4 text-left shadow-sm transition hover:shadow-md dark:bg-card-dark"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {r.stillWrong ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[15px] font-medium text-red-700 dark:bg-red-900/50 dark:text-red-300">
                            <XCircle className="h-4 w-4" aria-hidden="true" />
                            Still wrong
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[15px] font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            Fixed
                          </span>
                        )}
                        <span className="text-[15px] font-medium tabular-nums text-red-700 dark:text-red-300">
                          missed {r.state.totalWrong}×
                        </span>
                        <span className="text-[15px] text-slate-600 dark:text-slate-400">last missed {relativeDay(r.lastMissed, now)}</span>
                      </span>
                      <span className="mt-2 block font-medium leading-snug text-slate-900 dark:text-slate-100">{snippet(r.q.question)}</span>
                      <span className="mt-1.5 block text-[15px] leading-snug text-slate-700 dark:text-slate-300">{r.loKey}</span>
                      <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">
                        {r.q.subject} · {r.q.topic}
                      </span>
                      {operators.length > 0 && (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {operators.map((op) => (
                            <span
                              key={op}
                              className="rounded-md bg-amber-100 px-2 py-0.5 text-[15px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                            >
                              {humanizeTrap(op)}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <footer className="sticky bottom-0 z-30 border-t border-slate-200 bg-surface-light/90 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md dark:border-slate-700 dark:bg-surface-dark/90">
        <div className="mx-auto flex w-full max-w-[720px] items-center gap-3 px-4">
          <p className="text-[15px] text-slate-600 dark:text-slate-400">
            <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{filtered.length}</span> shuffled
          </p>
          <button
            type="button"
            onClick={drillAll}
            disabled={filtered.length === 0}
            className="ml-auto inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            <Play className="h-5 w-5" aria-hidden="true" />
            Drill these
          </button>
        </div>
      </footer>
    </div>
  );
}
