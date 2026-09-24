import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowRight, Search, SearchX, X } from 'lucide-react';
import { navigate } from '../../lib/router';
import { getSearchIndex, search, topTopics } from '../../lib/search';
import { useUi } from '../../store/ui';
import type { Question } from '../../types';

const DEBOUNCE_MS = 150;

interface Props {
  /** All loaded questions; the search index is cached against this exact array. */
  questions: Question[];
  /** Only these ids count as results (Session Setup excludes mock files). */
  allowedIds: Set<string>;
}

export function SearchBox({ questions, allowedIds }: Props) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [input]);

  const index = useMemo(() => getSearchIndex(questions), [questions]);

  const results = useMemo(() => {
    const ids = search(query, index);
    return ids === null ? null : ids.filter((id) => allowedIds.has(id));
  }, [query, index, allowedIds]);

  const topics = useMemo(() => (results && results.length > 0 ? topTopics(results, index, 3) : []), [results, index]);

  const clear = () => {
    setInput('');
    setQuery('');
  };

  const startWithQuery = () => {
    const q = input.trim();
    if (!q) return;
    useUi.getState().setPendingSetupQuery(q);
    navigate('/setup');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      clear();
    } else if (e.key === 'Enter' && results && results.length > 0 && query === input.trim()) {
      e.preventDefault();
      startWithQuery();
    }
  };

  const pending = input.trim() !== query;

  return (
    <div>
      <label htmlFor="dashboard-search" className="sr-only">
        Find questions
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <input
          id="dashboard-search"
          type="search"
          value={input}
          onChange={(e: { currentTarget: HTMLInputElement }) => setInput(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="Find questions about…"
          autoComplete="off"
          enterKeyHint="search"
          aria-controls="dashboard-search-results"
          className="min-h-[48px] w-full rounded-2xl border border-slate-200 bg-card-light py-3 pl-11 pr-12 text-base text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-card-dark dark:text-slate-100 dark:placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {input && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div id="dashboard-search-results" aria-live="polite">
        {results !== null && (
          <div className="mt-2 rounded-2xl border border-slate-200 bg-card-light p-4 shadow-sm dark:border-slate-700 dark:bg-card-dark">
            {results.length === 0 ? (
              <div className="flex items-start gap-3 text-slate-600 dark:text-slate-400">
                <SearchX className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div className="text-[15px]">
                  <p className="font-medium text-slate-800 dark:text-slate-200">No questions match “{query}”.</p>
                  <p className="mt-0.5">Every word must appear somewhere in a question. Try fewer or shorter words.</p>
                </div>
              </div>
            ) : (
              <>
                <p className={`text-[15px] font-semibold ${pending ? 'opacity-60' : ''}`}>
                  {results.length} {results.length === 1 ? 'question' : 'questions'} found
                </p>
                <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
                  {topics.map((t) => (
                    <li key={`${t.subject}::${t.topic}`} className="flex items-start justify-between gap-3 py-2">
                      <span className="min-w-0 break-words text-[15px]">
                        <span className="font-medium">{t.topic}</span>
                        <span className="text-slate-600 dark:text-slate-400"> · {t.subject}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[15px] tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {t.count}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={startWithQuery}
                  className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 font-semibold text-white transition hover:bg-primary-600"
                >
                  Start session with these
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
