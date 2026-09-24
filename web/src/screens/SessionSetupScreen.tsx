import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Check, ChevronDown, Play } from 'lucide-react';
import type { CatalogItem, ScopeKind, SessionConfig, SessionOrder } from '../types';
import { useContent } from '../store/content';
import { useSession } from '../store/session';
import { buildCatalog } from '../lib/catalog';
import { buildQueue, countAvailable } from '../lib/queue';
import { navigate } from '../lib/router';

const STORAGE_KEY = 'frm.sessionSetup.v1';
const PHASE2_HINT = 'Available after progress tracking (Phase 2)';

type Count = number | 'all';

interface Options {
  count: Count;
  order: SessionOrder;
  timerEnabled: boolean;
  timerMinutes: number;
  trapOnly: boolean;
  skipDrops: boolean;
}

interface Stored {
  scopeKind: ScopeKind;
  selectedKeys: string[];
  trapFilter: boolean;
  options: Options;
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

const DEFAULTS: Stored = {
  scopeKind: 'subject',
  selectedKeys: [],
  trapFilter: false,
  options: {
    count: 20,
    order: 'shuffled',
    timerEnabled: true,
    timerMinutes: 2,
    trapOnly: false,
    skipDrops: false,
  },
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
    return {
      scopeKind: pick(d.scopeKind, SCOPES, DEFAULTS.scopeKind),
      selectedKeys: Array.isArray(d.selectedKeys)
        ? d.selectedKeys.filter((k): k is string => typeof k === 'string')
        : [],
      trapFilter: bool(d.trapFilter, DEFAULTS.trapFilter),
      options: {
        count: pick(o.count, COUNTS, def.count),
        order: pick(o.order, ORDERS, def.order),
        timerEnabled: bool(o.timerEnabled, def.timerEnabled),
        timerMinutes: pick(o.timerMinutes, MINUTES, def.timerMinutes),
        trapOnly: bool(o.trapOnly, def.trapOnly),
        skipDrops: bool(o.skipDrops, def.skipDrops),
      },
    };
  } catch {
    return DEFAULTS;
  }
}

function saveStored(value: Stored) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
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

function ItemRow({ item, selected, onToggle }: { item: CatalogItem; selected: boolean; onToggle: () => void }) {
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
        <span className="block text-base leading-snug">{item.label}</span>
        {item.sublabel && (
          <span className="mt-0.5 block text-[15px] text-slate-600 dark:text-slate-400">{item.sublabel}</span>
        )}
      </span>
      <span className="shrink-0 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[15px] font-medium tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        {n} {n === 1 ? 'Q' : 'Qs'}
      </span>
    </button>
  );
}

export function SessionSetupScreen() {
  const allQuestions = useContent((s) => s.questions);
  // Mock exams run through their own flow; setup only draws from subject banks.
  const questions = useMemo(() => allQuestions.filter((q) => !q.file.startsWith('mocks/')), [allQuestions]);

  const [initial] = useState(loadStored);
  const [scopeKind, setScopeKind] = useState<ScopeKind>(initial.scopeKind);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(initial.selectedKeys);
  const [trapFilter, setTrapFilter] = useState(initial.trapFilter);
  const [options, setOptions] = useState<Options>(initial.options);
  const [optionsOpen, setOptionsOpen] = useState(true);

  const catalog = useMemo(() => buildCatalog(questions, scopeKind), [questions, scopeKind]);

  const trapItemKeys = useMemo(() => {
    const trapIds = new Set(questions.filter((q) => q.trap.operators.length > 0).map((q) => q.id));
    return new Set(catalog.filter((it) => it.questionIds.some((id) => trapIds.has(id))).map((it) => it.key));
  }, [questions, catalog]);

  const visible = useMemo(
    () => (trapFilter ? catalog.filter((it) => trapItemKeys.has(it.key)) : catalog),
    [catalog, trapFilter, trapItemKeys],
  );

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

  const config: SessionConfig = useMemo(
    () => ({
      scopeKind,
      selectedKeys: [...selectedSet],
      count: options.count,
      order: options.order,
      timerEnabled: options.timerEnabled,
      timerSeconds: options.timerMinutes * 60,
      trapOnly: trapFilter || options.trapOnly,
      wrongFirst: false,
      skipDrops: options.skipDrops,
    }),
    [scopeKind, selectedSet, options, trapFilter],
  );

  const available = useMemo(() => countAvailable(config, questions), [config, questions]);

  useEffect(() => {
    saveStored({ scopeKind, selectedKeys: [...selectedSet], trapFilter, options });
  }, [scopeKind, selectedSet, trapFilter, options]);

  const setOption = <K extends keyof Options>(key: K, value: Options[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  const changeScope = (kind: ScopeKind) => {
    if (kind === scopeKind) return;
    setScopeKind(kind);
    setSelectedKeys([]);
  };

  const toggleItem = (key: string) =>
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

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

  const canStart = selectedSet.size > 0 && available > 0;

  const start = () => {
    if (!canStart) return;
    const queue = buildQueue(config, questions);
    if (queue.length === 0) return;
    useSession.getState().start(config, queue);
    navigate('/session');
  };

  const sessionSize = options.count === 'all' ? available : Math.min(options.count, available);
  const counterText =
    selectedSet.size === 0
      ? 'Nothing selected'
      : options.count === 'all' || sessionSize === available
        ? `${available} ${available === 1 ? 'question' : 'questions'} selected`
        : `${sessionSize} of ${available} questions`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-surface-light/85 backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
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

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={trapFilter}
              onClick={() => setTrapFilter((v) => !v)}
              className={`min-h-[44px] rounded-full border px-4 text-[15px] font-medium transition-colors ${
                trapFilter
                  ? 'border-transparent bg-primary-50 text-primary-700 ring-1 ring-primary dark:bg-primary/15 dark:text-primary-100'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              Has trap cards
            </button>
            {['Not started', 'Weak', 'Due'].map((chip) => (
              <button
                key={chip}
                type="button"
                aria-disabled="true"
                title={PHASE2_HINT}
                className="min-h-[44px] cursor-not-allowed rounded-full border border-dashed border-slate-300 px-4 text-[15px] text-slate-500 dark:border-slate-600 dark:text-slate-500"
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] text-slate-600 dark:text-slate-400">
              {selectedSet.size} of {catalog.length} selected
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
            <p className="rounded-2xl bg-card-light p-4 text-slate-600 shadow-sm dark:bg-card-dark dark:text-slate-400">
              No items match the current filter.
            </p>
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
                          <ItemRow item={it} selected={selectedSet.has(it.key)} onToggle={() => toggleItem(it.key)} />
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
                  checked={trapFilter || options.trapOnly}
                  onChange={(v) => {
                    setOption('trapOnly', v);
                    if (!v) setTrapFilter(false);
                  }}
                />
                <Toggle label="Wrong questions first" hint={PHASE2_HINT} checked={false} onChange={() => {}} disabled />
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
    </div>
  );
}
