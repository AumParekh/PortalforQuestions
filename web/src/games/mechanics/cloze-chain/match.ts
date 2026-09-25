// Cloze Chain answer checking. Pure; no React. Typed answers accept minor spelling variation
// (a slip or two in a long word, British/American spellings, plurals, hyphens, spacing), but never
// an antonym or one of the round's own distractors, and never a different number.

/** Canonical form for comparing a typed answer with the notes' word. */
export function normAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[“”"‘’'`]/g, '')
    .replace(/\\[a-z]+\s*/g, ' ')
    .replace(/[{}$\\]/g, '')
    .replace(/[-–—/_]/g, ' ')
    .replace(/[^\p{L}\p{N}%.\s]/gu, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(canonWord)
    .join(' ');
}

/** Spelling variants collapse to one form: -ise/-ize, -our/-or, -yse/-yze, doubled l, plural s. */
function canonWord(w: string): string {
  let x = w;
  x = x.replace(/isation/g, 'ization').replace(/is(e|es|ed|ing)$/, 'iz$1');
  x = x.replace(/ys(e|es|ed|ing)$/, 'yz$1');
  x = x.replace(/our$/, 'or').replace(/ours$/, 'ors');
  x = x.replace(/ll(ed|ing)$/, 'l$1');
  x = x.replace(/tre$/, 'ter');
  if (x.length > 3 && /[^s]s$/.test(x)) x = x.slice(0, -1);
  return x;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Slips allowed for a word of this length: none up to 4 letters, one up to 8, two beyond. */
export function tolerance(len: number): number {
  if (len <= 4) return 0;
  if (len <= 8) return 1;
  return 2;
}

const SCALE_WORDS: [RegExp, string][] = [
  [/\b(trillion|tn|trn)\b/, 'trillion'],
  [/\b(billion|bn|b)\b/, 'billion'],
  [/\b(million|mn|mm|m)\b/, 'million'],
  [/\b(thousand|k)\b/, 'thousand'],
];

function scaleOf(s: string): string | null {
  const t = s.toLowerCase();
  for (const [re, name] of SCALE_WORDS) if (re.test(t)) return name;
  return null;
}

/** First number in a string ("$2.5 billion" → 2.5, "1,250" → 1250), or null. */
export function firstNumber(s: string): number | null {
  const t = s.replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/−/g, '-');
  const m = /-?\d+(?:\.\d+)?/.exec(t);
  return m ? Number(m[0]) : null;
}

export interface AnswerKey {
  kind: 'text' | 'number' | 'direction';
  /** Acceptable forms (the notes' word, and its abbreviation / long form where the notes give both). */
  accept: readonly string[];
  /** Forms that are definitely wrong even if close in spelling: antonym, distractors. */
  reject: readonly string[];
  /** For numbers: the value and its scale word, if any. */
  value?: number | null;
  scale?: string | null;
  /** Direction words only: same-direction synonyms ("greater" for "higher"), held as a close answer. */
  near?: readonly string[];
}

export type MatchVerdict = 'exact' | 'close' | 'wrong';

/** Numbers and roman numerals inside a term ("Tier 1", "Type II", "Basel III") must match exactly. */
function markers(s: string): string {
  return s
    .split(' ')
    .filter((w) => /^\d+(\.\d+)?%?$|^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(w))
    .join(' ');
}

/** Real, distinct words one or two letters apart: a slip between them is a different answer. */
const CONFUSABLE: readonly (readonly string[])[] = [
  ['systemic', 'systematic'],
  ['monotonic', 'monotone'],
  ['deviation', 'derivation'],
  ['discrete', 'discreet'],
];
function confusable(a: string, b: string): boolean {
  return CONFUSABLE.some((set) => set.some((x) => a.includes(x)) && set.some((y) => b.includes(y) && !a.includes(y)));
}

export function checkAnswer(typed: string, key: AnswerKey): MatchVerdict {
  const raw = typed.trim();
  if (!raw) return 'wrong';
  if (key.kind === 'number') {
    const v = firstNumber(raw);
    if (v === null || key.value === null || key.value === undefined) return 'wrong';
    if (Math.abs(v - key.value) > 1e-9 * Math.max(1, Math.abs(key.value))) return 'wrong';
    const s = scaleOf(raw.replace(/-?\d+(?:[.,]\d+)*/g, ' '));
    if (s && key.scale && s !== key.scale) return 'wrong';
    if (s && !key.scale) return 'wrong';
    return 'exact';
  }
  const t = normAnswer(raw);
  if (!t) return 'wrong';
  const rejects = new Set(key.reject.map(normAnswer).filter(Boolean));
  const accepts = key.accept.map(normAnswer).filter(Boolean);
  if (accepts.includes(t)) return 'exact';
  const squash = (x: string) => x.replace(/\s+/g, '');
  if (accepts.some((a) => squash(a) === squash(t))) return 'exact';
  if (rejects.has(t) || [...rejects].some((r) => squash(r) === squash(t))) return 'wrong';
  if (key.kind === 'direction') return (key.near ?? []).map(normAnswer).includes(t) ? 'close' : 'wrong';
  for (const a of accepts) {
    const A = squash(a);
    const T = squash(t);
    if (A[0] !== T[0]) continue;
    if (markers(a) !== markers(t) || confusable(a, t)) continue;
    const d = levenshtein(A, T);
    if (d > 0 && d <= tolerance(A.length)) {
      // A slip that lands exactly on (or nearer to) a distractor is not a slip.
      const nearerReject = [...rejects].some((r) => levenshtein(squash(r), T) <= d);
      if (!nearerReject) return 'close';
    }
  }
  return 'wrong';
}
