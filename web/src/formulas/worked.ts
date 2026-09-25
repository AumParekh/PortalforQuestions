// Readable worked numbers for cards: a formula's own example with its inputs substituted.
import { formatNumber, substituteReadable } from './expr';
import type { Formula } from './types';

export function unitSuffix(unit: string): string {
  const u = unit.trim();
  // "decimal", "per year (decimal)": a plain number, no suffix.
  if (!u || /\bdecimal\b/i.test(u)) return '';
  return u === '%' ? '%' : ` ${u}`;
}

/** Longest worked line worth reading on a card; longer ones (series approximations) are skipped. */
export const MAX_WORKED_CHARS = 120;

/** "100 × 0.068 ÷ 0.084 = 80.95 $M" for a formula's own example; null when it has none or it's unreadably long. */
export function exampleLine(f: Formula): string | null {
  const c = f.calc;
  if (!c?.example) return null;
  const sub = substituteReadable(c.expr, c.example.inputs);
  if (!sub || sub.length > MAX_WORKED_CHARS) return null;
  return `${sub} = ${formatNumber(c.example.output, c.output.decimals)}${unitSuffix(c.output.unit)}`;
}
