// Drag-and-drop primitives for board mechanics (§10.3): drags snap to targets, lift with a soft
// shadow on grab, and are never free-floating. Pointer events cover mouse, pen and touch. The
// keyboard / tap alternative: pick an item (Enter, Space or tap), then choose a target the same
// way; Escape puts it back. One board is active at a time.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';
import { create } from 'zustand';

interface DragState {
  /** Item picked up by keyboard or tap, waiting for a target. */
  held: string | null;
  /** Target under the pointer during a drag. */
  over: string | null;
  set: (p: Partial<Pick<DragState, 'held' | 'over'>>) => void;
}

const useDrag = create<DragState>((set) => ({
  held: null,
  over: null,
  set: (p) => set(p),
}));

const targets = new Map<string, HTMLElement>();
let dropHandler: ((itemId: string, targetId: string) => void) | null = null;

function targetAt(x: number, y: number): string | null {
  for (const [id, el] of targets) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
  }
  return null;
}

function drop(itemId: string, targetId: string) {
  useDrag.getState().set({ held: null, over: null });
  dropHandler?.(itemId, targetId);
}

/** Wraps a board: receives every drop as (itemId, targetId). The parent re-renders the item in its target. */
export function DragBoard({
  onDrop,
  children,
  className = '',
}: {
  onDrop: (itemId: string, targetId: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef(onDrop);
  ref.current = onDrop;
  useEffect(() => {
    const handler = (i: string, t: string) => ref.current(i, t);
    dropHandler = handler;
    return () => {
      if (dropHandler === handler) dropHandler = null;
      useDrag.getState().set({ held: null, over: null });
    };
  }, []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') useDrag.getState().set({ held: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <div className={className}>{children}</div>;
}

const DRAG_THRESHOLD = 5;

export function Draggable({
  id,
  children,
  disabled = false,
  className = '',
  label,
}: {
  id: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Accessible name when the content isn't plain text. */
  label?: string;
}) {
  const held = useDrag((s) => s.held === id);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; pointerId: number; dragging: boolean } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    s.dragging = true;
    setOffset({ x: dx, y: dy });
    const over = targetAt(e.clientX, e.clientY);
    if (useDrag.getState().over !== over) useDrag.getState().set({ over });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || s.pointerId !== e.pointerId) return;
    if (!s.dragging) {
      // A tap picks the item up (or puts it back); a target tap then drops it.
      const cur = useDrag.getState().held;
      useDrag.getState().set({ held: cur === id ? null : id });
      return;
    }
    const t = targetAt(e.clientX, e.clientY);
    setOffset(null);
    useDrag.getState().set({ over: null });
    if (t) drop(id, t);
  };
  const onPointerCancel = () => {
    start.current = null;
    setOffset(null);
    useDrag.getState().set({ over: null });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const cur = useDrag.getState().held;
      useDrag.getState().set({ held: cur === id ? null : id });
    }
  };

  const lifted = offset !== null;
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={held}
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={`g-draggable${lifted ? ' is-lifted' : ''}${held ? ' is-held' : ''} ${className}`}
      style={lifted ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(1.035)` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      // Taps are handled on pointerup; keep the click from also reaching an armed target around it.
      onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function DropTarget({
  id,
  children,
  className = '',
  label,
}: {
  id: string;
  children?: ReactNode;
  className?: string;
  label: string;
}) {
  const over = useDrag((s) => s.over === id);
  const held = useDrag((s) => s.held);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    targets.set(id, el);
    return () => {
      if (targets.get(id) === el) targets.delete(id);
    };
  }, [id]);
  const armed = held !== null;
  const place = () => {
    const h = useDrag.getState().held;
    if (h) drop(h, id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!armed) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      place();
    }
  };
  return (
    <div
      ref={ref}
      role={armed ? 'button' : 'group'}
      tabIndex={armed ? 0 : undefined}
      aria-label={armed ? `Place here: ${label}` : label}
      className={`g-drop${over ? ' is-over' : ''}${armed ? ' is-armed' : ''} ${className}`}
      onClick={armed ? place : undefined}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
