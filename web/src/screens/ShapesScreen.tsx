import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Play } from 'lucide-react';
import type { Question, RecallTier, SessionConfig, SessionFilters } from '../types';
import type { ShapeSelector, ShapeTopic } from '../shapes/types';
import { useShapes } from '../shapes/store';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { hasActiveFilters, localToday, matchesFilters } from '../lib/queue';
import { shuffle as shuffled } from '../components/dashboard/launch';
import { RECALL_SECTIONS, RECALL_TIERS } from '../lib/recallTiers';
import { navigate } from '../lib/router';
import { ChapterSearch, matchesQuery } from '../components/setup/ChapterSearch';
import { FilterChip } from '../components/setup/FilterSheet';
import { EMPTY_FILTERS, sanitizeFilters } from '../components/setup/filterModel';
import { ScopeChips } from '../components/setup/ScopeChips';
import { savedTimer } from './SessionSetupScreen';
import { profileKey } from '../games/profile';

/** Per profile: stored under `profileKey(...)` (games/profile.ts). */
const STORAGE_KEY = 'frm.shapes.v1';

interface Stored {
  filters: SessionFilters;
  shuffle: boolean;
  /** Keys of the unfolded tiers and topics. */
  open: string[];
  /** The topic or shape opened last. */
  lastKey: string | null;
}

const DEFAULTS: Stored = { filters: EMPTY_FILTERS, shuffle: false, open: ['t|A'], lastKey: null };

function loadStored(): Stored {
  try {
    const raw = window.localStorage.getItem(profileKey(STORAGE_KEY));
    if (!raw) return DEFAULTS;
    const d = JSON.parse(raw) as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') return DEFAULTS;
    return {
      filters: sanitizeFilters(d.filters),
      shuffle: d.shuffle === true,
      open: Array.isArray(d.open) ? d.open.filter((k): k is string => typeof k === 'string') : DEFAULTS.open,
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
    // Storage may be unavailable (private mode, quota); the screen still works without it.
  }
}

/** Recall workbook sections with no learning objective in the Master LO Map: not examinable in 2026, so no topic. */
const OUT_OF_SYLLABUS = new Set(['B5', 'D17']);
const tierKey = (tier: RecallTier) => `t|${tier}`;
const topicKey = (id: string) => `p|${id}`;
const shapeKey = (topic: string, id: string) => `s|${topic}|${id}`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const KIND_LABEL: Record<ShapeSelector['kind'], string> = {
  shape: 'Reported shape',
  map: 'Also reported in the Map',
  vardeez: 'Vardeez focus',
};

const ACTION_TONE: Record<string, string> = {
  'Strike first': 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100',
  'Quick win': 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100',
  Grind: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
  Defer: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

interface ShapeRowData {
  selector: ShapeSelector;
  /** Ids that are in the bank and pass the filters, the recall workbook's own first. */
  ids: string[];
  total: number;
  done: number;
}

interface TopicRowData {
  topic: ShapeTopic;
  shapes: ShapeRowData[];
  /** Each question once, however many shapes it sits under. */
  ids: string[];
}

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[13px] font-semibold leading-none ${tone}`}>{children}</span>;
}

/** One reported shape: tapping it starts a session with every question that practises it. */
function ShapeRow({ row, filtered, last, onStart }: { row: ShapeRowData; filtered: boolean; last: boolean; onStart: () => void }) {
  const { selector, ids, total, done } = row;
  const empty = ids.length === 0;
  return (
    <button
      type="button"
      onClick={onStart}
      disabled={empty}
      aria-label={`Solve all ${plural(ids.length, 'question', 'questions')} of ${selector.name}`}
      className={`flex min-h-[56px] w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800 ${
        last
          ? 'border-primary/50 bg-primary-50/60 dark:border-primary/50 dark:bg-primary/10'
          : 'border-slate-200 bg-card-light dark:border-slate-700 dark:bg-card-dark'
      }`}
    >
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="text-[15px] font-semibold text-primary-700 dark:text-primary-100">{selector.id}</span>
          {selector.august && <Chip tone="bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100">Seen in August</Chip>}
          {selector.kind !== 'shape' && <Chip tone="bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">{KIND_LABEL[selector.kind]}</Chip>}
          {last && <span className="text-[13px] font-medium text-primary-700 dark:text-primary-100">Last opened</span>}
        </span>
        <span className="block text-base font-medium leading-snug">{selector.name}</span>
        <span className="mt-0.5 block text-[15px] leading-snug text-slate-600 dark:text-slate-400">{selector.what}</span>
        <span className="mt-1 block text-[15px] text-slate-600 dark:text-slate-400">
          {empty ? (filtered && total > 0 ? 'No question passes the filters' : 'No question in the library for this one yet') : done === 0 ? 'Not started' : `${done}/${ids.length} done`}
        </span>
      </span>
      {!empty && (
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
      )}
    </button>
  );
}

/** What the sources say about a topic: the August 2026 recall, the Priority Map and Vardeez. */
function TopicNotes({ topic }: { topic: ShapeTopic }) {
  const hasMore = topic.maps.length > 0 || !!topic.vardeez;
  if (!topic.august && !hasMore) return null;
  return (
    <div className="space-y-2 rounded-xl bg-slate-100 px-3 py-3 text-[15px] leading-snug dark:bg-slate-800">
      {topic.august && (
        <p>
          <span className="font-semibold">Your August 2026 recall: </span>
          {topic.august}
        </p>
      )}
      {hasMore && (
        <details>
          <summary className="min-h-[32px] cursor-pointer font-medium text-primary-700 dark:text-primary-100">What the sources report</summary>
          <div className="mt-2 space-y-2 text-slate-700 dark:text-slate-300">
            {topic.maps.map((m) => (
              <div key={m.number} className="space-y-1">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  Priority Map #{m.number}
                  {m.sources ? ` · ${m.sources} sources` : ''}
                  {m.rating ? ` · ${m.rating}` : ''}
                </p>
                {m.tested && <p>{m.tested}</p>}
                {m.specifics && (
                  <p>
                    <span className="font-medium">Reported: </span>
                    {m.specifics}
                  </p>
                )}
              </div>
            ))}
            {topic.vardeez && (
              <p>
                <span className="font-semibold text-slate-900 dark:text-slate-100">Vardeez: </span>
                {topic.vardeez}
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Exam shapes: the recall-workbook topics, Tier A first, each holding only the questions that practise something the
 * sources report as examined (a workbook shape, a Priority Map point, a Vardeez pointer). Tap a shape or a topic to
 * solve every question in it; the same Priority, Type and set chips apply as in the Question library.
 */
export function ShapesScreen() {
  const byId = useContent((s) => s.byId);
  const states = useProgress((s) => s.states);
  const topics = useShapes((s) => s.topics);
  const status = useShapes((s) => s.status);
  useEffect(() => {
    void useShapes.getState().load();
  }, []);

  const [initial] = useState(loadStored);
  // A tier card on Practice asks for its tier: that one opens, and the page starts there.
  const [asked] = useState(() => useUi.getState().pendingShapesTier);
  useEffect(() => {
    useUi.getState().setPendingShapesTier(null);
  }, []);
  const [filters, setFilters] = useState<SessionFilters>(initial.filters);
  const [shuffle, setShuffle] = useState(initial.shuffle);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(asked ? [...initial.open, tierKey(asked)] : initial.open));
  const [lastKey, setLastKey] = useState<string | null>(initial.lastKey);
  const [query, setQuery] = useState('');

  useEffect(() => {
    saveStored({ filters, shuffle, open: [...openGroups], lastKey });
  }, [filters, shuffle, openGroups, lastKey]);

  const filtersActive = hasActiveFilters(filters);
  const searching = query.trim().length > 0;

  const rows = useMemo((): TopicRowData[] => {
    const today = localToday();
    const passes = (id: string) => {
      const q: Question | undefined = byId[id];
      return !!q && (!filtersActive || matchesFilters(q, states[id], filters, today));
    };
    return topics
      .filter((t) => !searching || matchesQuery(query, t.id, t.title, ...t.readings, ...t.selectors.map((s) => s.name)))
      .map((topic) => {
        const seen = new Set<string>();
        const shapes = topic.selectors.map((selector) => {
          const known = selector.questions.map(([id]) => id).filter((id) => byId[id]);
          const ids = known.filter(passes);
          for (const id of ids) seen.add(id);
          return { selector, ids, total: known.length, done: ids.reduce((n, id) => n + ((states[id]?.totalAttempts ?? 0) > 0 ? 1 : 0), 0) };
        });
        return { topic, shapes, ids: [...seen] };
      });
  }, [topics, byId, states, filters, filtersActive, query, searching]);

  const tiers = useMemo(
    () =>
      RECALL_TIERS.map((info) => {
        const list = rows.filter((r) => r.topic.tier === info.id);
        return { info, topics: list, count: new Set(list.flatMap((r) => r.ids)).size };
      }).filter((t) => t.topics.length > 0),
    [rows],
  );

  const isOpen = (key: string) => (searching && !key.startsWith('p|')) || openGroups.has(key);
  const toggle = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Topics are matched to shapes tier by tier, so some may still be on their way.
  const pending = useMemo(() => {
    const have = new Set(topics.map((t) => t.id));
    const parts = RECALL_TIERS.map((info) => {
      const all = RECALL_SECTIONS.filter((x) => x.tier === info.id && !OUT_OF_SYLLABUS.has(x.id));
      const ready = all.filter((x) => have.has(x.id)).length;
      return ready === all.length ? null : ready === 0 ? `${info.name}: not matched yet` : `${info.name}: ${ready} of ${all.length} topics ready`;
    }).filter((x): x is string => x !== null);
    return parts.length > 0 ? `Still being matched to shapes. ${parts.join('; ')}. Until a topic is ready, find its questions through New Session (choose tiers) or the Question library.` : '';
  }, [topics]);

  // Arriving from a tier card: start at that tier. Coming back from a session: bring the row opened last into view.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || rows.length === 0) return;
    scrolled.current = true;
    const want = asked ? tierKey(asked) : initial.lastKey;
    const el = [...document.querySelectorAll<HTMLElement>('[data-shapes-key]')].find((n) => n.dataset.shapesKey === want);
    if (el) el.scrollIntoView({ block: asked ? 'start' : 'center' });
    else window.scrollTo({ top: 0 });
  }, [rows, asked, initial.lastKey]);

  /** Starts a session with every one of these questions: no cap on its size. */
  const start = (topic: ShapeTopic, ids: string[], key: string) => {
    const queue = shuffle ? shuffled(ids) : ids;
    if (queue.length === 0) return;
    const base: SessionConfig = {
      scopeKind: 'section',
      selectedKeys: [`section::${topic.id}`],
      count: 'all',
      order: shuffle ? 'shuffled' : 'sequential',
      ...savedTimer(),
      trapOnly: false,
      wrongFirst: false,
      skipDrops: false,
      mode: 'drill',
      filters,
      origin: 'shapes',
    };
    // Saved before leaving the screen, so the list reopens here after the session.
    saveStored({ filters, shuffle, open: [...openGroups], lastKey: key });
    // start() returns false when the user keeps a session already in progress.
    if (!useSession.getState().start(base, queue)) return;
    setLastKey(key);
    navigate('/session');
  };

  const total = new Set(rows.flatMap((r) => r.ids)).size;
  const headerClass = 'border-slate-200 bg-card-light dark:border-slate-700 dark:bg-card-dark';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={() => navigate('/practice')}
            aria-label="Back to Practice"
            className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">Exam shapes</h1>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] space-y-5 px-4 pb-16 pt-4">
        <section aria-label="Find a topic" className="space-y-3">
          <p className="text-[15px] text-slate-600 dark:text-slate-400">
            The tier topics, holding only the questions that practise what was reported: the recall workbook's shapes, the Priority Map and Vardeez's
            focus. Open a topic and tap a shape to solve every question in it.
          </p>
          {pending && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[15px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">{pending}</p>
          )}
          <ChapterSearch value={query} onChange={setQuery} placeholder="Find a topic or shape, RAROC" label="Find a topic or shape" />
          <ScopeChips filters={filters} onChange={setFilters} effect="are included" />
          <FilterChip active={shuffle} title="Otherwise the recall workbook's questions come first, then bank order" onClick={() => setShuffle((v) => !v)}>
            Shuffle the questions
          </FilterChip>
        </section>

        <section aria-label="Topics" className="space-y-3">
          <p aria-live="polite" className="text-[15px] text-slate-600 dark:text-slate-400">
            {status === 'loading' || status === 'idle'
              ? 'Loading…'
              : `${plural(rows.length, 'topic', 'topics')} · ${plural(total, 'question', 'questions')}`}
          </p>
          {status === 'error' && (
            <p className="rounded-2xl bg-card-light p-5 text-center shadow-sm dark:bg-card-dark">The shapes could not be loaded. Check your connection and reopen the app.</p>
          )}
          {status === 'ready' && rows.length === 0 && (
            <p className="rounded-2xl bg-card-light p-5 text-center shadow-sm dark:bg-card-dark">
              {searching ? `Nothing matches “${query.trim()}”.` : 'No topics yet.'}
            </p>
          )}
          {tiers.map((tier) => {
            const tKey = tierKey(tier.info.id);
            const tierOpen = isOpen(tKey);
            return (
              <div key={tKey} className="space-y-2">
                <button
                  type="button"
                  data-shapes-key={tKey}
                  aria-expanded={tierOpen}
                  disabled={searching}
                  onClick={() => toggle(tKey)}
                  className={`flex min-h-[52px] w-full scroll-mt-16 items-center gap-2 rounded-xl border px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800 ${headerClass}`}
                >
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400 ${tierOpen ? '' : '-rotate-90'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="block text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">
                      {tier.info.name}: {tier.info.description}
                    </span>
                    <span className="block text-[15px] text-slate-600 dark:text-slate-400">
                      {plural(tier.topics.length, 'topic', 'topics')} · {plural(tier.count, 'question', 'questions')}
                    </span>
                  </span>
                </button>
                {tierOpen && (
                  <div className="space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                    {tier.topics.map(({ topic, shapes, ids }) => {
                      const pKey = topicKey(topic.id);
                      const topicOpen = openGroups.has(pKey);
                      const last = lastKey === pKey;
                      return (
                        <div key={pKey} className="space-y-2">
                          <div
                            data-shapes-key={pKey}
                            className={`flex items-stretch gap-1 rounded-xl border ${
                              last ? 'border-primary/50 bg-primary-50/60 dark:border-primary/50 dark:bg-primary/10' : headerClass
                            }`}
                          >
                            <button
                              type="button"
                              aria-expanded={topicOpen}
                              onClick={() => toggle(pKey)}
                              className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <ChevronDown
                                className={`h-5 w-5 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400 ${topicOpen ? '' : '-rotate-90'}`}
                                aria-hidden="true"
                              />
                              <span className="min-w-0 [overflow-wrap:anywhere]">
                                <span className="block text-[15px] font-medium leading-snug text-slate-900 dark:text-slate-100">
                                  <span className="font-semibold text-primary-700 dark:text-primary-100">{topic.id}</span> {topic.title}
                                </span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px] text-slate-600 dark:text-slate-400">
                                  {topic.action && <Chip tone={ACTION_TONE[topic.action] ?? ACTION_TONE.Defer}>{topic.action}</Chip>}
                                  <span>
                                    {plural(shapes.length, 'shape', 'shapes')} · {plural(ids.length, 'question', 'questions')}
                                    {last && ' · last opened'}
                                  </span>
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => start(topic, ids, pKey)}
                              disabled={ids.length === 0}
                              aria-label={`Solve all ${plural(ids.length, 'question', 'questions')} of ${topic.title}`}
                              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-[15px] font-medium tabular-nums text-primary-600 hover:bg-primary-50 disabled:opacity-40 dark:text-primary-100 dark:hover:bg-primary/15"
                            >
                              <Play className="h-4 w-4" aria-hidden="true" />
                              All {ids.length}
                            </button>
                          </div>
                          {topicOpen && (
                            <div className="space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                              <TopicNotes topic={topic} />
                              <ul className="space-y-2">
                                {shapes.map((row) => {
                                  const sKey = shapeKey(topic.id, row.selector.id);
                                  return (
                                    <li key={sKey} data-shapes-key={sKey}>
                                      <ShapeRow row={row} filtered={filtersActive} last={lastKey === sKey} onStart={() => start(topic, row.ids, sKey)} />
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
