import { useEffect, useRef, useState } from 'react';
import type { SessionMode, TrapOperator } from '../../types';

/**
 * Measures the chart container so the SVG viewBox can use 1 unit = 1 CSS px.
 * That keeps axis text at a true 15px on a 375px phone and on desktop alike,
 * while the SVG itself stays width="100%" and never widens the page.
 */
export function useChartWidth<T extends HTMLElement>(fallback = 320) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = Math.floor(el.clientWidth);
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayKeyOf(iso: string): string {
  return dayKey(new Date(iso));
}

/** Local midnight `offset` days from `base` (negative = past). */
export function addDays(base: Date, offset: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function shortMonth(d: Date): string {
  return MONTHS[d.getMonth()];
}

export function shortDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function longDate(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const TRAP_NAMES: Record<TrapOperator, string> = {
  'polarity-flip': 'Polarity flip',
  'sibling-swap': 'Sibling swap',
  'role-misassignment': 'Role misassignment',
  'scope-condition-error': 'Scope / condition error',
  'absolute-claim-trap': 'Absolute claim',
  'wrong-input-twin': 'Wrong input twin',
  'dropped-term': 'Dropped term',
  'unit-time-conversion': 'Unit / time conversion',
  'correlation-misuse': 'Correlation misuse',
  'intermediate-result-trap': 'Intermediate result',
  'sign-error': 'Sign error',
  'calculation-slip': 'Calculation slip',
  'qualifier-misread': 'Qualifier misread',
};

export function trapName(op: string): string {
  if (op in TRAP_NAMES) return TRAP_NAMES[op as TrapOperator];
  const words = op.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MODE_NAMES: Record<SessionMode, string> = {
  drill: 'Drill',
  'review-wrong': 'Review wrong',
  'review-due': 'Due for review',
  quest: "Today's quest",
  mock: 'Mock exam',
};

export function modeName(mode: SessionMode): string {
  return MODE_NAMES[mode] ?? mode;
}

/** A bar/column path with a rounded data-end (top) and a square baseline, per the mark spec. */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Shared SVG class names so every chart uses the same recessive chrome in both themes. */
export const CHROME = {
  grid: 'stroke-slate-200 dark:stroke-slate-700',
  axis: 'stroke-slate-300 dark:stroke-slate-600',
  tick: 'fill-slate-600 dark:fill-slate-400',
  label: 'fill-slate-900 dark:fill-slate-100',
} as const;
