import { Search, X } from 'lucide-react';

export { Highlight } from './SetupSearch';

/** Lowercase search terms of a query; empty when the query is blank. */
export function queryTerms(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** True when every term of the query appears somewhere in the given texts (case-insensitive). A blank query matches. */
export function matchesQuery(query: string, ...texts: (string | null | undefined)[]): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return true;
  const haystack = texts.filter(Boolean).join(' ').toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

/**
 * Search box for narrowing a chapter list. `tone="game"` follows the notes-games theme (its CSS variables) instead
 * of the app's Tailwind palette.
 */
export function ChapterSearch({
  value,
  onChange,
  placeholder = 'Search chapters…',
  label = 'Search chapters',
  tone = 'app',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  tone?: 'app' | 'game';
}) {
  const game = tone === 'game';
  return (
    <div className="relative min-w-0">
      <Search
        className={`pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 ${game ? '' : 'text-slate-500 dark:text-slate-400'}`}
        style={game ? { color: 'var(--g-ink-muted)' } : undefined}
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(e: { currentTarget: HTMLInputElement }) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        className={`h-12 w-full rounded-xl border pl-10 pr-12 text-base focus:outline-none focus:ring-2 [&::-webkit-search-cancel-button]:hidden ${
          game
            ? 'focus:ring-[color:var(--g-navy)]'
            : 'border-slate-200 bg-card-light text-slate-900 placeholder:text-slate-500 focus:border-primary focus:ring-primary/30 dark:border-slate-700 dark:bg-card-dark dark:text-slate-100 dark:placeholder:text-slate-400'
        }`}
        style={game ? { background: 'var(--g-card)', color: 'var(--g-ink)', borderColor: 'var(--g-rule)', fontFamily: 'var(--g-sans)' } : undefined}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className={`absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg ${
            game ? '' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
          style={game ? { color: 'var(--g-ink-muted)' } : undefined}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
