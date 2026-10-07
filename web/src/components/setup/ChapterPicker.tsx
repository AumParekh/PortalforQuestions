import { useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { ChapterSearch, Highlight, matchesQuery } from './ChapterSearch';

export interface ChapterItem {
  id: string;
  /** Shown and searched. */
  label: string;
  /** Second line, e.g. "12 formulas · 3 due". */
  detail?: string;
  /** Extra text the search matches but doesn't show (codes, alternative titles). */
  keywords?: string;
}

export interface ChapterGroup {
  id: string;
  title: string;
  chapters: ChapterItem[];
}

/**
 * Searchable, grouped multi-select of chapters. Groups start collapsed unless they hold a chosen chapter; while a
 * search is typed every group with a match opens, so a chapter is a few letters away instead of a long scroll.
 */
export function ChapterPicker({
  groups,
  selected,
  onChange,
  idPrefix,
}: {
  groups: ChapterGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Keeps element ids unique per screen. */
  idPrefix: string;
}) {
  const [query, setQuery] = useState('');
  const chosen = useMemo(() => new Set(selected), [selected]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.filter((g) => g.chapters.some((c) => chosen.has(c.id))).map((g) => g.id)));

  const searching = query.trim().length > 0;
  const shown = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          chapters: searching ? g.chapters.filter((c) => matchesQuery(query, c.label, c.keywords, g.title)) : g.chapters,
        }))
        .filter((g) => g.chapters.length > 0),
    [groups, query, searching],
  );
  const shownIds = useMemo(() => shown.flatMap((g) => g.chapters.map((c) => c.id)), [shown]);
  const byId = useMemo(() => new Map(groups.flatMap((g) => g.chapters.map((c) => [c.id, c] as const))), [groups]);
  const chosenItems = selected.map((id) => byId.get(id)).filter((c): c is ChapterItem => !!c);

  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const toggleGroup = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShownChosen = shownIds.length > 0 && shownIds.every((id) => chosen.has(id));
  const smallBtn =
    'min-h-[44px] rounded-xl border border-slate-200 px-3 text-[15px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';

  return (
    <div className="space-y-3">
      <ChapterSearch value={query} onChange={setQuery} />

      {chosenItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[15px] font-medium text-slate-700 dark:text-slate-300">
              {chosenItems.length} {chosenItems.length === 1 ? 'chapter' : 'chapters'} chosen
            </p>
            <button type="button" className={smallBtn} onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="Chosen chapters">
            {chosenItems.map((c) => (
              <li key={c.id} className="max-w-full">
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  aria-label={`Remove ${c.label}`}
                  className="inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-left text-[15px] font-medium leading-snug text-white hover:bg-primary-600"
                >
                  <span className="min-w-0 break-words">{c.label}</span>
                  <X className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {searching && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-[15px] text-slate-600 dark:text-slate-400">
            {shownIds.length === 0 ? `No chapters match “${query.trim()}”` : `${shownIds.length} ${shownIds.length === 1 ? 'chapter matches' : 'chapters match'}`}
          </p>
          {shownIds.length > 1 && (
            <button
              type="button"
              className={smallBtn}
              onClick={() =>
                onChange(allShownChosen ? selected.filter((id) => !shownIds.includes(id)) : [...selected, ...shownIds.filter((id) => !chosen.has(id))])
              }
            >
              {allShownChosen ? 'Unselect these' : 'Select these'}
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {shown.map((g) => {
          const expanded = searching || open.has(g.id);
          const total = groups.find((x) => x.id === g.id)?.chapters ?? g.chapters;
          const picked = total.filter((c) => chosen.has(c.id)).length;
          const panelId = `${idPrefix}-group-${g.id}`;
          return (
            <section key={g.id} className="rounded-2xl bg-card-light shadow-sm dark:bg-card-dark">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                disabled={searching}
                onClick={() => toggleGroup(g.id)}
                className="flex min-h-[52px] w-full items-center justify-between gap-2 px-4 text-left disabled:cursor-default"
              >
                <span className="min-w-0">
                  <span className="block break-words font-semibold">{g.title}</span>
                  <span className="block text-[15px] text-slate-600 dark:text-slate-400">
                    {total.length} {total.length === 1 ? 'chapter' : 'chapters'}
                    {picked > 0 ? ` · ${picked} chosen` : ''}
                  </span>
                </span>
                {!searching && (
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                )}
              </button>
              {expanded && (
                <ul id={panelId} className="divide-y divide-slate-200 border-t border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                  {g.chapters.map((c) => {
                    const on = chosen.has(c.id);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(c.id)}
                          className={`flex min-h-[52px] w-full items-start gap-3 px-4 py-2.5 text-left transition-colors motion-reduce:transition-none ${
                            on ? 'bg-primary-50 dark:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                              on ? 'border-primary bg-primary text-white' : 'border-slate-300 dark:border-slate-600'
                            }`}
                          >
                            {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-words font-medium leading-snug">
                              <Highlight text={c.label} query={query} />
                            </span>
                            {c.detail && <span className="block text-[15px] leading-snug text-slate-600 dark:text-slate-400">{c.detail}</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export type ChapterScope = 'shuffle' | 'chapters';

/** The two ways into a drill: everything shuffled, or only the chapters picked below. */
export function ScopeSwitch({
  value,
  onChange,
  shuffleLabel = 'Shuffle',
}: {
  value: ChapterScope;
  onChange: (v: ChapterScope) => void;
  shuffleLabel?: string;
}) {
  const options: { value: ChapterScope; label: string }[] = [
    { value: 'shuffle', label: shuffleLabel },
    { value: 'chapters', label: 'Pick chapters' },
  ];
  return (
    <div role="group" aria-label="What to practise" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`min-h-[44px] rounded-lg px-1.5 py-1 text-[15px] font-semibold leading-tight transition-colors motion-reduce:transition-none ${
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
