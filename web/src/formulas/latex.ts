// String-level LaTeX helpers for the formula games. Anything generated here is vetted with KaTeX
// (texValid) before use, and callers fall back to the plain formula when a result doesn't parse.
import { TEX_GREEN, TEX_PRIMARY, TEX_RED, texValid } from './tex';

/** Whitespace-insensitive form for comparing tiles, slots and corruptions. */
export function normTex(s: string): string {
  return (
    s
      // Protect explicit spaces ("\ ") so the punctuation rule below can't strip them.
      .replace(/\\ /g, '\u0000')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}^_=+\-*/(),[\]])\s*/g, '$1')
      .replace(/([_^])\{([A-Za-z0-9])\}/g, '$1$2')
      .replace(/\u0000/g, '\\ ')
      .trim()
  );
}

/** Splits at the first top-level `=` (outside braces); null for environments or when there is none. */
export function splitEquation(latex: string): { lhs: string; rhs: string } | null {
  if (/\\begin\{/.test(latex)) return null;
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '=' && depth === 0) {
      let cut = i;
      // `:=` and `\coloneqq`-style definitions keep the colon with the operator.
      if (latex[i - 1] === ':') cut = i - 1;
      const lhs = latex.slice(0, cut).trim();
      const rhs = latex.slice(i + 1).trim();
      if (!lhs || !rhs) return null;
      return { lhs, rhs };
    }
  }
  return null;
}

/** The output side of a formula for prompts ("If σ rises, VaR …"); null when it has none. */
export function outputOf(latex: string): string | null {
  return splitEquation(latex)?.lhs ?? null;
}

const SLOT_RE = /\{\{(\d+)\}\}/g;

/** Slot numbers used in a skeleton, in order of first appearance. */
export function skeletonSlots(skeleton: string): number[] {
  const seen: number[] = [];
  for (const m of skeleton.matchAll(SLOT_RE)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

/**
 * Fills a skeleton's slots for display: a filled slot shows its tile (red/green once checked), an empty one
 * a numbered box, and the selected slot is drawn in the primary colour.
 */
export function fillSkeleton(
  skeleton: string,
  fills: (string | null)[],
  opts: { selected?: number | null; verdicts?: (boolean | null)[] } = {},
): string {
  return skeleton.replace(SLOT_RE, (_, d: string) => {
    const i = Number(d) - 1;
    const tile = fills[i];
    const verdict = opts.verdicts?.[i];
    if (tile) {
      const body = `{${tile}}`;
      if (verdict === true) return `{\\textcolor{${TEX_GREEN}}${body}}`;
      if (verdict === false) return `{\\textcolor{${TEX_RED}}${body}}`;
      if (opts.selected === i) return `{\\textcolor{${TEX_PRIMARY}}{\\underline${body}}}`;
      return body;
    }
    const box = `\\boxed{\\,${i + 1}\\,}`;
    return opts.selected === i ? `{\\textcolor{${TEX_PRIMARY}}{${box}}}` : `{\\textcolor{#94a3b8}{${box}}}`;
  });
}

// ---- Token diff, for highlighting what a corruption changed ----

const TOKEN_RE = /\\[A-Za-z]+|\\.|\s+|./gs;

/** LaTeX tokens; whitespace runs are kept as a single ' ' so text like \text{a b} survives a rebuild. */
function tokens(latex: string): string[] {
  return (latex.match(TOKEN_RE) ?? []).map((t) => (/^\s+$/.test(t) ? ' ' : t));
}

/** Indices of the non-space tokens: comparisons ignore spacing. */
function significant(toks: string[]): number[] {
  const out: number[] = [];
  toks.forEach((t, i) => {
    if (t !== ' ') out.push(i);
  });
  return out;
}

function join(toks: string[]): string {
  let out = '';
  for (const t of toks) {
    // A command followed by a letter needs a separating space ("\alpha x").
    if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(t)) out += ' ';
    out += t;
  }
  return out;
}

function balanced(toks: string[]): boolean {
  let braces = 0;
  let lr = 0;
  let env = 0;
  for (const t of toks) {
    if (t === '{') braces++;
    else if (t === '}') braces--;
    else if (t === '\\left') lr++;
    else if (t === '\\right') lr--;
    else if (t === '\\begin') env++;
    else if (t === '\\end') env--;
    if (braces < 0) return false;
  }
  return braces === 0 && lr === 0 && env === 0;
}

/**
 * `wrong` with the span that differs from `right` drawn in red (common prefix and suffix trimmed at token
 * level). Returns null when the changed span can't be wrapped cleanly; callers then show it unmarked.
 */
export function highlightChange(right: string, wrong: string): string | null {
  const a = tokens(right);
  const b = tokens(wrong);
  const sa = significant(a);
  const sb = significant(b);
  let start = 0;
  while (start < sa.length && start < sb.length && a[sa[start]] === b[sb[start]]) start++;
  let endA = sa.length;
  let endB = sb.length;
  while (endA > start && endB > start && a[sa[endA - 1]] === b[sb[endB - 1]]) {
    endA--;
    endB--;
  }
  if (endB <= start) return null;
  const from = sb[start];
  const to = sb[endB - 1] + 1;
  const changed = b.slice(from, to);
  if (!balanced(changed)) return null;
  // A lone `^`/`_` or a command that expects arguments can't be wrapped; KaTeX vetting catches those.
  const out = join([...b.slice(0, from), `{\\textcolor{${TEX_RED}}{`, ...changed, '}}', ...b.slice(to)]);
  return texValid(out) ? out : null;
}

/** Base of a symbol without sub/superscripts and braces, for "similar symbol" matching (σ_p ~ σ). */
export function symbolBase(symbol: string): string {
  const t = tokens(symbol.replace(/\\(mathrm|mathit|mathbf|text|operatorname|hat|bar|tilde|widehat|overline)\b/g, ''));
  const out: string[] = [];
  for (const tok of t) {
    if (tok === '_' || tok === '^') break;
    if (tok === '{' || tok === '}') continue;
    out.push(tok);
  }
  return out.join('');
}

/**
 * `latex` with the first occurrence of `symbol` boxed and tinted, for Variable Auction. Matching ignores
 * spacing and single-character braces; the symbol must not run on into a longer name (\sigma vs \sigmaX,
 * or σ_p when asked for σ). Returns null when the symbol can't be found or the result doesn't parse.
 */
export function highlightSymbol(latex: string, symbol: string): string | null {
  const hay = tokens(normTex(latex));
  const needle = tokens(normTex(symbol)).filter((t) => t !== ' ');
  if (needle.length === 0) return null;
  const sig = significant(hay);
  for (let i = 0; i + needle.length <= sig.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[sig[i + j]] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const prev = i > 0 ? hay[sig[i - 1]] : undefined;
    const next = hay[sig[i + needle.length]];
    const letter = (t: string | undefined) => t !== undefined && /^[A-Za-z]$/.test(t);
    // σ must not match the start of σ_p, and a letter must not match inside a word (the p in \text{spread}).
    if (next === '_' && !needle.includes('_')) continue;
    if ((letter(needle[0]) && letter(prev)) || (letter(needle[needle.length - 1]) && letter(next))) continue;
    const from = sig[i];
    const to = sig[i + needle.length - 1] + 1;
    const body = join(hay.slice(from, to));
    const tinted = join([...hay.slice(0, from), `{\\colorbox{#fde68a}{$\\textcolor{#0f172a}{${body}}$}}`, ...hay.slice(to)]);
    if (texValid(tinted)) return tinted;
    const boxed = join([...hay.slice(0, from), `{\\boxed{\\textcolor{${TEX_PRIMARY}}{${body}}}}`, ...hay.slice(to)]);
    return texValid(boxed) ? boxed : null;
  }
  return null;
}
