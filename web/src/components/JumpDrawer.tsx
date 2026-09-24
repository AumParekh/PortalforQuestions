import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { LayoutGrid, List, X } from 'lucide-react';
import { cellStatus, useSession } from '../store/session';
import { useContent } from '../store/content';
import type { CellStatus } from '../types';

type Filter = 'all' | 'unanswered' | 'wrong' | 'skipped' | 'marked';
type View = 'grid' | 'list';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unanswered', label: 'Unanswered' },
  { key: 'wrong', label: 'Wrong' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'marked', label: 'Marked' },
];

const CELL_CLASS: Record<CellStatus, string> = {
  unseen:
    'bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600',
  current:
    'bg-primary text-white ring-2 ring-primary ring-offset-2 ring-offset-card-light dark:ring-offset-card-dark',
  correct: 'bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500',
  wrong: 'bg-red-500 text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500',
  skipped: 'bg-amber-300 text-amber-950 hover:bg-amber-400 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300',
  marked: 'bg-violet-500 text-white hover:bg-violet-600 dark:bg-violet-600 dark:hover:bg-violet-500',
};

const DOT_CLASS: Record<CellStatus, string> = {
  unseen: 'bg-slate-300 dark:bg-slate-500',
  current: 'bg-primary',
  correct: 'bg-emerald-500',
  wrong: 'bg-red-500',
  skipped: 'bg-amber-400',
  marked: 'bg-violet-500',
};

const STATUS_LABEL: Record<CellStatus, string> = {
  unseen: 'not answered',
  current: 'current question',
  correct: 'answered correctly',
  wrong: 'answered incorrectly',
  skipped: 'skipped',
  marked: 'marked for review',
};

const LEGEND: { status: CellStatus; label: string }[] = [
  { status: 'current', label: 'Current' },
  { status: 'correct', label: 'Correct' },
  { status: 'wrong', label: 'Wrong' },
  { status: 'skipped', label: 'Skipped' },
  { status: 'marked', label: 'Marked' },
  { status: 'unseen', label: 'Not reached' },
];

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function snippet(text: string): string {
  const clean = text
    .replace(/\*\*/g, '')
    .replace(/[$|`#]/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 140 ? `${clean.slice(0, 140).trimEnd()}…` : clean;
}

function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
}

export function JumpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queue = useSession((s) => s.queue);
  const currentIndex = useSession((s) => s.currentIndex);
  const answers = useSession((s) => s.answers);
  const skipped = useSession((s) => s.skipped);
  const marked = useSession((s) => s.marked);
  const byId = useContent((s) => s.byId);

  const [view, setView] = useState<View>('grid');
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      setShown(false);
      setDragY(0);
      setDragging(false);
      return;
    }
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      setShown(true);
      panelRef.current?.focus({ preventScroll: true });
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

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>('[data-current="true"]');
      el?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, view]);

  const counts = useMemo(() => {
    let answered = 0;
    let correct = 0;
    let wrong = 0;
    let skippedCount = 0;
    let markedCount = 0;
    for (const id of queue) {
      const a = answers[id];
      if (a) {
        answered += 1;
        if (a.correct) correct += 1;
        else wrong += 1;
      }
      if (skipped[id]) skippedCount += 1;
      if (marked[id]) markedCount += 1;
    }
    return {
      all: queue.length,
      answered,
      correct,
      wrong,
      unanswered: queue.length - answered,
      skipped: skippedCount,
      marked: markedCount,
    };
  }, [queue, answers, skipped, marked]);

  const items = useMemo(() => {
    const state = { queue, currentIndex, answers, skipped, marked };
    return queue
      .map((id, index) => ({ id, index, status: cellStatus(state, index) }))
      .filter(({ id }) => {
        switch (filter) {
          case 'unanswered':
            return !answers[id];
          case 'wrong':
            return !!answers[id] && !answers[id].correct;
          case 'skipped':
            return !!skipped[id];
          case 'marked':
            return !!marked[id];
          default:
            return true;
        }
      });
  }, [queue, currentIndex, answers, skipped, marked, filter]);

  if (!open) return null;

  const jump = (index: number) => {
    useSession.getState().jumpTo(index);
    onClose();
  };

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

  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isDesktop() || (e.target as HTMLElement).closest('button')) return;
    dragStartRef.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return;
    setDragY(Math.max(0, e.clientY - dragStartRef.current));
  };

  const onDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return;
    const delta = e.clientY - dragStartRef.current;
    dragStartRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (delta > 80) onClose();
    else setDragY(0);
  };

  const chipBase =
    'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-medium transition-colors duration-200 motion-reduce:transition-none';

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/50 transition-opacity duration-200 motion-reduce:transition-none dark:bg-black/60 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to question"
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
        className={`absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-slate-200 bg-card-light pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none focus-visible:ring-0 dark:border-slate-700 dark:bg-card-dark md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[380px] md:rounded-none md:border-l md:border-t-0 ${
          dragging ? '' : 'transition-transform duration-200 ease-out motion-reduce:transition-none'
        } ${shown ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-x-full md:translate-y-0'}`}
      >
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="shrink-0 touch-none border-b border-slate-200 px-4 pb-3 dark:border-slate-700 md:touch-auto md:pt-4"
        >
          <div className="flex justify-center pb-2 pt-3 md:hidden">
            <div className="h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Questions</h2>
              <p className="text-[15px] text-slate-600 dark:text-slate-400">
                {counts.answered}/{counts.all} answered
                <span aria-hidden="true"> · </span>
                <span className="text-emerald-700 dark:text-emerald-400">{counts.correct} correct</span>
                <span aria-hidden="true"> · </span>
                <span className="text-red-700 dark:text-red-400">{counts.wrong} wrong</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div
                role="group"
                aria-label="View"
                className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700"
              >
                <button
                  type="button"
                  aria-label="Grid view"
                  aria-pressed={view === 'grid'}
                  onClick={() => setView('grid')}
                  className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-200 motion-reduce:transition-none ${
                    view === 'grid'
                      ? 'bg-primary text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
                  }`}
                >
                  <LayoutGrid className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={view === 'list'}
                  onClick={() => setView('list')}
                  className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-200 motion-reduce:transition-none ${
                    view === 'list'
                      ? 'bg-primary text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
                  }`}
                >
                  <List className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-b border-slate-200 dark:border-slate-700">
          <div role="group" aria-label="Filter questions" className="flex gap-2 overflow-x-auto px-4 py-3">
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
                      : 'border-slate-200 bg-transparent text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {label}
                  <span
                    className={`rounded-full px-1.5 text-[15px] tabular-nums ${
                      active ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'
                    }`}
                  >
                    {counts[key]}
                  </span>
                </button>
              );
            })}
          </div>
          {view === 'grid' && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-[15px] text-slate-600 dark:text-slate-400">
              {LEGEND.map(({ status, label }) => (
                <li key={status} className="flex items-center gap-1.5">
                  <span className={`inline-block h-3 w-3 rounded-sm ${DOT_CLASS[status]}`} aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {items.length === 0 ? (
            <p className="py-8 text-center text-[15px] text-slate-600 dark:text-slate-400">
              No questions match this filter.
            </p>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-5 gap-2.5 sm:grid-cols-6">
              {items.map(({ id, index, status }) => (
                <button
                  key={`${id}-${index}`}
                  type="button"
                  data-current={status === 'current'}
                  aria-current={status === 'current' ? 'true' : undefined}
                  aria-label={`Question ${index + 1}, ${STATUS_LABEL[status]}`}
                  onClick={() => jump(index)}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-base font-semibold tabular-nums transition-colors duration-200 motion-reduce:transition-none ${CELL_CLASS[status]}`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          ) : (
            <ul className="-mx-1 flex flex-col gap-1">
              {items.map(({ id, index, status }) => {
                const q = byId[id];
                const isCurrent = status === 'current';
                return (
                  <li key={`${id}-${index}`}>
                    <button
                      type="button"
                      data-current={isCurrent}
                      aria-current={isCurrent ? 'true' : undefined}
                      aria-label={`Question ${index + 1}, ${STATUS_LABEL[status]}${q?.topic ? `, ${q.topic}` : ''}`}
                      onClick={() => jump(index)}
                      className={`flex min-h-[56px] w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-200 motion-reduce:transition-none ${
                        isCurrent
                          ? 'bg-primary-50 ring-1 ring-primary dark:bg-primary/20'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-700/60'
                      }`}
                    >
                      <span className="flex w-10 shrink-0 items-center gap-1.5 pt-0.5">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT_CLASS[status]}`} aria-hidden="true" />
                        <span className="text-[15px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {index + 1}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-slate-600 dark:text-slate-400">
                          {q?.topic ?? id}
                        </span>
                        {q && (
                          <span className="mt-0.5 block break-words text-[15px] leading-snug text-slate-800 dark:text-slate-200">
                            {snippet(q.question)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
