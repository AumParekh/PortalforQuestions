import { useMemo } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { escapeRegExp } from '../../lib/search';

export function SetupSearch({
  value,
  onChange,
  filterCount,
  onOpenFilters,
}: {
  value: string;
  onChange: (v: string) => void;
  filterCount: number;
  onOpenFilters: () => void;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500 dark:text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={value}
          onChange={(e: { currentTarget: HTMLInputElement }) => onChange(e.currentTarget.value)}
          placeholder="Search questions, topics, LOs…"
          aria-label="Search questions"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          className="h-12 w-full rounded-xl border border-slate-200 bg-card-light pl-10 pr-12 text-base text-slate-900 placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-card-dark dark:text-slate-100 dark:placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange('')}
            className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenFilters}
        aria-label={filterCount > 0 ? `Filters, ${filterCount} active` : 'Filters'}
        aria-haspopup="dialog"
        className={`relative inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-xl border px-3 text-[15px] font-medium transition-colors ${
          filterCount > 0
            ? 'border-transparent bg-primary-50 text-primary-700 ring-1 ring-primary dark:bg-primary/15 dark:text-primary-100'
            : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
        }`}
      >
        <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
        Filters
        {filterCount > 0 && (
          <span
            aria-hidden="true"
            className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-primary px-1.5 text-[15px] font-semibold tabular-nums text-white"
          >
            {filterCount}
          </span>
        )}
      </button>
    </div>
  );
}

/** Wraps every case-insensitive occurrence of any search term in <mark>. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const pattern = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return null;
    // Longest first so "wrong-way" wins over "wrong" when both are searched.
    terms.sort((a, b) => b.length - a.length);
    return new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  }, [query]);
  if (!pattern) return <>{text}</>;
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-yellow-200 text-inherit dark:bg-yellow-500/40">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
