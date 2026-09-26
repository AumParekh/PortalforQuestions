import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Flag, Send, X } from 'lucide-react';
import type { OptionKey } from '../types';

type Filter = 'all' | 'unanswered' | 'flagged';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unanswered', label: 'Unanswered' },
  { key: 'flagged', label: 'Flagged' },
];

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  onClose: () => void;
  questionIds: string[];
  /** Paper number for each position. */
  numbers: number[];
  answers: Record<string, OptionKey>;
  flags: Record<string, true>;
  currentIndex: number;
  onJump: (index: number) => void;
  onSubmit: () => void;
}

/**
 * The exam's question grid: answered / flagged / current, never right or wrong. A bottom sheet on phones and a side
 * panel from md up; the grid wraps to the panel width, so it can't push the page sideways.
 */
export function ExamNavigator({ open, onClose, questionIds, numbers, answers, flags, currentIndex, onJump, onSubmit }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      setShown(true);
      panelRef.current?.focus({ preventScroll: true });
      scrollRef.current?.querySelector<HTMLElement>('[data-current="true"]')?.scrollIntoView({ block: 'center' });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open]);

  const counts = useMemo(() => {
    let answered = 0;
    let flagged = 0;
    for (const id of questionIds) {
      if (answers[id]) answered++;
      if (flags[id]) flagged++;
    }
    return { all: questionIds.length, answered, unanswered: questionIds.length - answered, flagged };
  }, [questionIds, answers, flags]);

  const items = useMemo(
    () =>
      questionIds
        .map((id, index) => ({ id, index }))
        .filter(({ id }) => (filter === 'unanswered' ? !answers[id] : filter === 'flagged' ? !!flags[id] : true)),
    [questionIds, answers, flags, filter],
  );

  if (!open) return null;

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const chipBase =
    'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-medium transition-colors duration-200 motion-reduce:transition-none';

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/50 transition-opacity duration-200 motion-reduce:transition-none dark:bg-black/60 ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Question navigator"
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={`absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-slate-200 bg-card-light pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none transition-transform duration-200 ease-out motion-reduce:transition-none dark:border-slate-700 dark:bg-card-dark md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[380px] md:rounded-none md:border-l md:border-t-0 ${
          shown ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-x-full md:translate-y-0'
        }`}
      >
        <div className="shrink-0 border-b border-slate-200 px-4 pb-3 pt-4 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Questions</h2>
              <p className="text-[15px] text-slate-600 dark:text-slate-400">
                {counts.answered}/{counts.all} answered
                {counts.flagged > 0 && (
                  <>
                    <span aria-hidden="true"> · </span>
                    {counts.flagged} flagged
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div role="group" aria-label="Show" className="mt-3 flex flex-wrap gap-2">
            {FILTERS.map(({ key, label }) => {
              const active = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(key)}
                  className={`${chipBase} ${
                    active
                      ? 'border-primary bg-primary text-white'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {label}
                  <span className={`rounded-full px-1.5 tabular-nums ${active ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'}`}>{counts[key]}</span>
                </button>
              );
            })}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-slate-600 dark:text-slate-400">
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-primary" aria-hidden="true" />
              Answered
            </li>
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
              Unanswered
            </li>
            <li className="flex items-center gap-1.5">
              <Flag className="h-3.5 w-3.5 text-amber-500" fill="currentColor" aria-hidden="true" />
              Flagged
            </li>
          </ul>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {items.length === 0 ? (
            <p className="py-8 text-center text-[15px] text-slate-600 dark:text-slate-400">No questions match this filter.</p>
          ) : (
            <div className="grid grid-cols-5 gap-2.5 sm:grid-cols-6">
              {items.map(({ id, index }) => {
                const current = index === currentIndex;
                const answered = !!answers[id];
                const flagged = !!flags[id];
                return (
                  <button
                    key={id}
                    type="button"
                    data-current={current}
                    aria-current={current ? 'true' : undefined}
                    aria-label={`Question ${numbers[index]}, ${answered ? 'answered' : 'not answered'}${flagged ? ', flagged' : ''}${current ? ', current' : ''}`}
                    onClick={() => onJump(index)}
                    className={`relative flex min-h-[44px] min-w-0 items-center justify-center rounded-lg text-base font-semibold tabular-nums transition-colors duration-200 motion-reduce:transition-none ${
                      answered
                        ? 'bg-primary text-white hover:bg-primary-600'
                        : 'bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600'
                    } ${current ? 'ring-2 ring-slate-900 ring-offset-2 ring-offset-card-light dark:ring-white dark:ring-offset-card-dark' : ''}`}
                  >
                    {numbers[index]}
                    {flagged && (
                      <Flag className="absolute right-0.5 top-0.5 h-3.5 w-3.5 text-amber-500 dark:text-amber-400" fill="currentColor" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={onSubmit}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-primary px-4 font-semibold text-primary hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Submit exam
          </button>
        </div>
      </div>
    </div>
  );
}
