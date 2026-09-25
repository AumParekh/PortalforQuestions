// Safe evaluation of a card's `calc.expr`. The expression comes from content, so it is never passed to
// `new Function` until every token is on a whitelist: input names, numbers, arithmetic operators,
// parentheses, commas and a fixed set of pure Math members. No property access, brackets, strings,
// assignment or other identifiers can get through.

const MATH_FUNCTIONS = new Set([
  'abs',
  'sqrt',
  'cbrt',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log10',
  'log2',
  'pow',
  'min',
  'max',
  'floor',
  'ceil',
  'round',
  'trunc',
  'sign',
  'hypot',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
]);
const MATH_CONSTANTS = new Set(['E', 'PI', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2']);

// Reserved words and globals an input may not be named after (it becomes a function parameter).
const RESERVED = new Set([
  'Math',
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'NaN',
  'Infinity',
]);

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type Token =
  | { kind: 'num'; text: string }
  | { kind: 'name'; text: string }
  | { kind: 'math'; text: string; member: string }
  | { kind: 'op'; text: string }
  | { kind: 'paren'; text: '(' | ')' }
  | { kind: 'comma'; text: ',' };

const TOKEN_RE = /\s+|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|(Math\.[A-Za-z0-9_]+)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/%])|([()])|(,)/y;

/** Tokenises and whitelists `expr`; returns null if anything is not allowed. */
export function tokenize(expr: string, names: ReadonlySet<string>): Token[] | null {
  const out: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < expr.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(expr);
    if (!m || m.index !== pos) return null;
    pos = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) out.push({ kind: 'num', text: m[1] });
    else if (m[2] !== undefined) {
      const member = m[2].slice(5);
      if (!MATH_FUNCTIONS.has(member) && !MATH_CONSTANTS.has(member)) return null;
      out.push({ kind: 'math', text: m[2], member });
    } else if (m[3] !== undefined) {
      if (!names.has(m[3])) return null;
      out.push({ kind: 'name', text: m[3] });
    } else if (m[4] !== undefined) out.push({ kind: 'op', text: m[4] });
    else if (m[5] !== undefined) out.push({ kind: 'paren', text: m[5] as '(' | ')' });
    else if (m[6] !== undefined) out.push({ kind: 'comma', text: ',' });
    // Whitespace: nothing to keep.
  }
  // Parentheses must balance, and a Math function must be called.
  let depth = 0;
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (t.kind === 'paren') depth += t.text === '(' ? 1 : -1;
    if (depth < 0) return null;
    if (t.kind === 'math' && MATH_FUNCTIONS.has(t.member) && out[i + 1]?.text !== '(') return null;
  }
  return depth === 0 && out.length > 0 ? out : null;
}

/**
 * Compiles `expr` over the given input names, or returns null when it fails the whitelist or doesn't parse.
 * The result reads its inputs from a plain record and returns NaN for a missing one.
 */
export function compileExpr(expr: string, names: string[]): ((values: Record<string, number>) => number) | null {
  if (typeof expr !== 'string' || expr.length === 0 || expr.length > 2000) return null;
  if (names.some((n) => !NAME_RE.test(n) || RESERVED.has(n)) || new Set(names).size !== names.length) return null;
  const tokens = tokenize(expr, new Set(names));
  if (!tokens) return null;
  // Rebuilt from tokens, so nothing outside the whitelist can reach the Function body.
  const body = tokens.map((t) => t.text).join(' ');
  let fn: (...args: number[]) => unknown;
  try {
    fn = new Function(...names, `"use strict"; return (${body});`) as (...args: number[]) => unknown;
  } catch {
    return null;
  }
  return (values) => {
    try {
      const v = fn(...names.map((n) => (typeof values[n] === 'number' ? values[n] : NaN)));
      return typeof v === 'number' ? v : NaN;
    } catch {
      return NaN;
    }
  };
}

const MATH_LABELS: Record<string, string> = { log: 'ln', log10: 'log₁₀', log2: 'log₂', PI: 'π', E: 'e', SQRT2: '√2' };

/** Formats a number for display: up to `decimals` places, trailing zeros trimmed, thousands grouped. */
export function formatNumber(v: number, decimals = 4): string {
  if (!Number.isFinite(v)) return String(v);
  return v.toLocaleString('en-US', { maximumFractionDigits: Math.max(0, Math.min(10, decimals)), useGrouping: true });
}

/**
 * The expression with numbers substituted for its inputs, in readable arithmetic
 * ("100 × 0.068 ÷ 0.084"). Used for Quick Calc's worked answer and Memory Match's number cards.
 */
export function substituteReadable(expr: string, values: Record<string, number>): string | null {
  const tokens = tokenize(expr, new Set(Object.keys(values)));
  if (!tokens) return null;
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    // Unary minus binds to what follows it.
    const unary = t.kind === 'op' && t.text === '-' && (!prev || prev.kind === 'op' || prev.text === '(' || prev.kind === 'comma');
    if (t.kind === 'name') {
      const v = values[t.text];
      parts.push(v < 0 ? `(${formatNumber(v, 6)})` : formatNumber(v, 6));
    } else if (t.kind === 'math') parts.push(MATH_LABELS[t.member] ?? t.member);
    else if (t.kind === 'op') {
      if (unary) parts.push('−');
      else parts.push(t.text === '*' ? ' × ' : t.text === '/' ? ' ÷ ' : t.text === '**' ? '^' : t.text === '-' ? ' − ' : ` ${t.text} `);
    } else if (t.kind === 'comma') parts.push(', ');
    else parts.push(t.text);
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}
