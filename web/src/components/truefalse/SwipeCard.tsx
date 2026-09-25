import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { prefersReducedMotion } from './deck';

const THRESHOLD = 80;
const DEAD_ZONE = 10;

interface Props {
  /** When false the card ignores gestures (e.g. once the statement is answered). */
  enabled: boolean;
  onSwipe: (answeredTrue: boolean) => void;
  className: string;
  children: ReactNode;
}

interface Drag {
  x: number;
  y: number;
  locked: boolean;
}

/**
 * Touch swipe: right = True, left = False. The card follows the finger at a damped rate and tilts,
 * and snaps back if released before the threshold. Vertical drags are left to the browser (touch-action: pan-y).
 */
export function SwipeCard({ enabled, onSwipe, className, children }: Props) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const reduced = useRef(prefersReducedMotion());

  useEffect(() => {
    if (enabled) return;
    drag.current = null;
    setDx(0);
    setDragging(false);
  }, [enabled]);

  const reset = () => {
    drag.current = null;
    setDx(0);
    setDragging(false);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || e.pointerType === 'mouse') return;
    // Let wide formulas/tables scroll sideways instead of starting a swipe.
    const scroller = e.target instanceof Element ? e.target.closest<HTMLElement>('.katex-display, .table-scroll, pre') : null;
    if (scroller && scroller.scrollWidth > scroller.clientWidth) return;
    reduced.current = prefersReducedMotion();
    drag.current = { x: e.clientX, y: e.clientY, locked: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.locked) {
      if (Math.abs(mx) < DEAD_ZONE && Math.abs(my) < DEAD_ZONE) return;
      if (Math.abs(my) > Math.abs(mx)) {
        drag.current = null;
        return;
      }
      d.locked = true;
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // capture is best-effort
      }
    }
    setDx(mx);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const locked = d.locked;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    reset();
    if (!locked) return;
    if (mx >= THRESHOLD) onSwipe(true);
    else if (mx <= -THRESHOLD) onSwipe(false);
  };

  const strength = Math.min(1, Math.abs(dx) / THRESHOLD);
  const move = reduced.current ? undefined : `translateX(${dx * 0.6}px) rotate(${Math.max(-8, Math.min(8, dx * 0.04))}deg)`;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      style={{ touchAction: 'pan-y', transform: dragging ? move : undefined }}
      className={`relative ${dragging ? 'select-none' : 'transition-[transform,border-color] duration-200 ease-out motion-reduce:transition-none'} ${className}`}
    >
      {dragging && dx !== 0 && (
        <span
          aria-hidden="true"
          style={{ opacity: strength }}
          className={`pointer-events-none absolute top-3 z-10 rounded-lg border-2 px-3 py-1 text-base font-bold uppercase tracking-wider ${
            dx > 0
              ? 'left-3 border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-300'
              : 'right-3 border-red-600 bg-red-50 text-red-700 dark:border-red-400 dark:bg-red-950 dark:text-red-300'
          }`}
        >
          {dx > 0 ? 'True' : 'False'}
        </span>
      )}
      {children}
    </div>
  );
}
