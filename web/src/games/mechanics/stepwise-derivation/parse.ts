// Stepwise Derivation: pure parsing of a worked example's LaTeX into display parts and "moves".
// No React. Everything shown later is a slice of the notes' own LaTeX: nothing is rewritten,
// numbers are never recomputed or reformatted.
//
// A move is one step of the working. Two shapes:
//   label    — the notes head the step with a bold operation ("Step 3 — take the root for σ_P."),
//              and the body under it is the consequence (lines, tables, prose).
//   equation — an unlabelled display line "lhs = setup = … = result"; the setup is the operation
//              and the full line is the consequence.
// Anything else (formula statements, prose, answer notes) is a context move, shown as reached.

export interface Cell {
  latex: string;
  span: number;
}

export type Part =
  | { kind: 'text'; latex: string }
  | { kind: 'math'; tex: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; head: Cell[][]; body: Cell[][] };

export type MoveKind = 'label' | 'equation' | 'context';

export interface Move {
  /** Stable step number within the example: the notes' "Step N" when given, else the ordinal. */
  n: number;
  kind: MoveKind;
  /** Shown before the gap (context the notes give ahead of this line). */
  lead: Part[];
  /** label: the bold operation (text LaTeX, ordinal lifted). */
  label?: string;
  /** The label exactly as written, ordinal included (shown once the step is placed). */
  labelFull?: string;
  /** equation: the setup, as math TeX. */
  op?: string;
  /** equation: the result after the setup, as math TeX. */
  result?: string;
  /** The consequence: the notes' own lines for this step. */
  body: Part[];
  /** Whether the step can be blanked (a real calculation with an operation to name). */
  blankable: boolean;
}

// ---------------------------------------------------------------------------------------------
// Low-level scanning

/** Index just past the brace group opening at `i` (s[i] === '{'); -1 if unbalanced. */
export function skipGroup(s: string, i: number): number {
  if (s[i] !== '{') return -1;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/** Index of the `\end{name}` matching a `\begin{name}` whose body starts at `from`; -1 if none. */
function findEnd(s: string, name: string, from: number): number {
  const esc = name.replace(/[*]/g, '\\*');
  const re = new RegExp(`\\\\(begin|end)\\{${esc}\\}`, 'g');
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    depth += m[1] === 'begin' ? 1 : -1;
    if (depth === 0) return m.index;
  }
  return -1;
}

interface Depth {
  brace: number;
  env: number;
  paren: number;
}

/**
 * Walks `s` at brace / environment / bracket depth, calling `at(i, d)` for each index outside
 * escapes. Return a number from `at` to jump to that index.
 */
function walk(s: string, at: (i: number, d: Depth) => number | void) {
  const d: Depth = { brace: 0, env: 0, paren: 0 };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      if (s.startsWith('\\begin{', i)) {
        const j = skipGroup(s, i + 6);
        d.env++;
        i = (j > 0 ? j : i + 7) - 1;
        continue;
      }
      if (s.startsWith('\\end{', i)) {
        const j = skipGroup(s, i + 4);
        d.env = Math.max(0, d.env - 1);
        i = (j > 0 ? j : i + 5) - 1;
        continue;
      }
      const jump = at(i, d);
      if (typeof jump === 'number') {
        i = jump - 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === '{') d.brace++;
    else if (c === '}') d.brace = Math.max(0, d.brace - 1);
    else if (c === '(' || c === '[') d.paren++;
    else if (c === ')' || c === ']') d.paren = Math.max(0, d.paren - 1);
    const jump = at(i, d);
    if (typeof jump === 'number') i = jump - 1;
  }
}

/** Splits on top-level `\\` (row breaks), dropping any `[3pt]` spacing argument. */
export function splitRows(s: string): string[] {
  const rows: string[] = [];
  let last = 0;
  walk(s, (i, d) => {
    if (d.brace === 0 && d.env === 0 && s.startsWith('\\\\', i)) {
      rows.push(s.slice(last, i));
      let j = i + 2;
      const m = /^\s*\[[^\]]*\]/.exec(s.slice(j));
      if (m) j += m[0].length;
      last = j;
      return j;
    }
  });
  rows.push(s.slice(last));
  return rows;
}

/** Splits on top-level `&` (not `\&`, not inside a matrix or a group). */
export function splitCells(s: string): string[] {
  const out: string[] = [];
  let last = 0;
  walk(s, (i, d) => {
    if (s[i] === '&' && d.brace === 0 && d.env === 0) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  });
  out.push(s.slice(last));
  return out;
}

/** Top-level relation positions ('=' and \approx) outside groups, brackets and environments. */
export function relationSplit(s: string): { parts: string[]; seps: string[] } {
  const parts: string[] = [];
  const seps: string[] = [];
  let last = 0;
  walk(s, (i, d) => {
    if (d.brace !== 0 || d.env !== 0 || d.paren !== 0) return;
    if (s[i] === '=') {
      parts.push(s.slice(last, i));
      seps.push('=');
      last = i + 1;
      return;
    }
    const m = /^\\approx(?![a-zA-Z])/.exec(s.slice(i, i + 8));
    if (m) {
      parts.push(s.slice(last, i));
      seps.push('\\approx');
      last = i + m[0].length;
      return last;
    }
  });
  parts.push(s.slice(last));
  return { parts, seps };
}

// ---------------------------------------------------------------------------------------------
// Cleaning

const LAYOUT_MACROS =
  /\\(?:small|footnotesize|normalsize|scriptsize|large|centering|raggedright|raggedleft|medskip|smallskip|bigskip|noindent|par|tcblower|toprule|midrule|bottomrule|hline|tabfont|selectfont|sffamily|bfseries|linebreak|newline)(?![a-zA-Z])/g;

/** Drops comments, spacing and layout commands; maps a few text symbols. */
export function cleanLatex(s: string): string {
  let t = s.replace(/(^|[^\\])%.*$/gm, '$1');
  t = t.replace(/\\(?:vspace|hspace)\*?\{[^{}]*\}/g, ' ');
  t = t.replace(/\\renewcommand\{[^{}]*\}\{[^{}]*\}/g, '');
  t = t.replace(/\\(?:arrayrulecolor|rowcolor|color)\{[^{}]*\}/g, '');
  t = t.replace(/\\fontsize\{[^{}]*\}\{[^{}]*\}/g, '');
  t = t.replace(/\\cmidrule(?:\([^)]*\))?\{[^{}]*\}/g, '');
  t = t.replace(/\\(?:begin|end)\{(?:center|minipage|flushleft|flushright)\}(?:\{[^{}]*\})?/g, '\n\n');
  t = t.replace(LAYOUT_MACROS, ' ');
  t = t.replace(/\\euro(?![a-zA-Z])\s?/g, '€').replace(/\\textonehalf(?![a-zA-Z])/g, '½');
  t = t.replace(/\\(?:thead|thd|hdr)\{((?:[^{}]|\{[^{}]*\})*)\}/g, '$1');
  t = t.replace(/\\phantom\{[^{}]*\}/g, '');
  return t;
}

/** One display row, ready for KaTeX: alignment marks and step tags lifted, spacing trimmed. */
export function cleanRow(row: string): string {
  let r = row.trim();
  r = r.replace(/^\\textbf\{\s*Step\s*\d+\s*[:.]?\s*\}\s*(?:\\q?quad)?/i, '');
  r = splitCells(r).join(' ');
  r = r.replace(/^\s*(?:\\q?quad\s*)+/, '').replace(/(?:\s*\\q?quad)+\s*$/, '');
  r = r.replace(/\\(?:label|tag)\{[^{}]*\}/g, '');
  return r.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------
// LaTeX → parts

const OPENERS =
  /\\\[|(?<!\\)\$\$|\\begin\{(align\*?|aligned|equation\*?|gather\*?|multline\*?|displaymath|itemize|enumerate|tabular\*?|tabularx|longtable)\}/g;
const MATH_ENVS = /^(?:align\*?|aligned|equation\*?|gather\*?|multline\*?|displaymath)$/;

function pushText(out: Part[], text: string) {
  for (const para of text.split(/\n\s*\n/)) {
    const t = para
      .replace(/\\\\(?:\[[^\]]*\])?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (t && /[\p{L}\p{N}$]/u.test(t)) out.push({ kind: 'text', latex: t });
  }
}

function parseList(body: string, ordered: boolean): Part | null {
  const items: string[] = [];
  let depth = 0;
  let last = -1;
  const re = /\\(begin|end)\{[^{}]*\}|\\item(?![a-zA-Z])/g;
  let m: RegExpExecArray | null;
  const flush = (end: number) => {
    if (last < 0) return;
    let item = body.slice(last, end).trim();
    if (item.startsWith('[')) {
      // \item[label]: the optional label is dropped (lists render with their own markers).
      let d = 0;
      for (let k = 0; k < item.length; k++) {
        if (item[k] === '[') d++;
        else if (item[k] === ']' && --d === 0) {
          item = item.slice(k + 1).trim();
          break;
        }
      }
    }
    if (item) items.push(item.replace(/\s+/g, ' '));
  };
  while ((m = re.exec(body))) {
    if (m[1] === 'begin') depth++;
    else if (m[1] === 'end') depth--;
    else if (depth === 0) {
      flush(m.index);
      last = m.index + m[0].length;
    }
  }
  flush(body.length);
  return items.length ? { kind: 'list', ordered, items } : null;
}

function parseCell(raw: string): Cell {
  const m = /^\s*\\multicolumn\{(\d+)\}\{[^{}]*\}\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}\s*$/.exec(raw);
  if (m) return { latex: m[2].trim(), span: Math.max(1, Number(m[1])) };
  return { latex: raw.trim(), span: 1 };
}

function parseTable(body: string, rawHeaderHint: boolean): Part | null {
  const rows = splitRows(body)
    .map((r) => r.trim())
    .filter((r) => r && /\S/.test(r.replace(/&/g, '')))
    .map((r) => splitCells(r).map(parseCell));
  if (rows.length === 0) return null;
  const head = rawHeaderHint && rows.length > 1 ? [rows[0]] : [];
  return { kind: 'table', head, body: head.length ? rows.slice(1) : rows };
}

/** Splits a LaTeX snippet into display parts: text paragraphs, display math, lists and tables. */
export function toParts(src: string): Part[] {
  const s = cleanLatex(src);
  const out: Part[] = [];
  let pos = 0;
  OPENERS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPENERS.exec(s))) {
    const start = m.index;
    let bodyStart = start + m[0].length;
    let bodyEnd: number;
    let next: number;
    const env = m[1];
    if (m[0] === '\\[') {
      bodyEnd = s.indexOf('\\]', bodyStart);
      next = bodyEnd + 2;
    } else if (m[0] === '$$') {
      bodyEnd = s.indexOf('$$', bodyStart);
      next = bodyEnd + 2;
    } else {
      bodyEnd = findEnd(s, env, bodyStart);
      next = bodyEnd + `\\end{${env}}`.length;
    }
    if (bodyEnd < 0) break;
    pushText(out, s.slice(pos, start));
    if (!env || MATH_ENVS.test(env)) {
      const body = s.slice(bodyStart, bodyEnd);
      const rows = splitRows(body)
        .map(cleanRow)
        .filter((r) => r.length > 0);
      if (rows.length === 1) out.push({ kind: 'math', tex: rows[0] });
      else if (rows.length > 1) {
        // Keep the notes' alignment for display.
        const aligned = splitRows(body)
          .map((r) => r.replace(/^\s*\\textbf\{\s*Step\s*\d+\s*[:.]?\s*\}\s*(?:\\q?quad)?/i, '').trim())
          .filter(Boolean)
          .join(' \\\\ ');
        out.push({ kind: 'math', tex: `\\begin{aligned}${aligned}\\end{aligned}` });
      }
    } else if (env === 'itemize' || env === 'enumerate') {
      const p = parseList(s.slice(bodyStart, bodyEnd), env === 'enumerate');
      if (p) out.push(p);
    } else {
      // tabular / tabularx / longtable: skip the width and column-spec arguments.
      let j = bodyStart;
      for (let k = 0; k < (env === 'tabularx' ? 2 : 1); k++) {
        while (s[j] === ' ' || s[j] === '\n') j++;
        if (s[j] === '[') j = s.indexOf(']', j) + 1;
        if (s[j] === '{') j = skipGroup(s, j);
        if (j < 0) break;
      }
      if (j > 0) bodyStart = j;
      const raw = s.slice(bodyStart, bodyEnd);
      const headerHint = /\\(?:thead|thd|hdr)\{|\\toprule/.test(src);
      const p = parseTable(raw, headerHint);
      if (p) out.push(p);
    }
    pos = next;
    OPENERS.lastIndex = next;
  }
  pushText(out, s.slice(pos));
  return out;
}

/** The rows of a math part (one row for a single display; aligned rows split back out). */
export function mathRows(p: Extract<Part, { kind: 'math' }>): string[] {
  const m = /^\\begin\{aligned\}([\s\S]*)\\end\{aligned\}$/.exec(p.tex);
  if (!m) return [p.tex];
  return splitRows(m[1])
    .map(cleanRow)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// Numbers (for "is this line possible yet?")

/** Numbers that turn up everywhere (small integers, day counts) prove nothing about a line. */
export function isCommonNumber(v: number): boolean {
  if (Number.isInteger(v) && Math.abs(v) <= 12) return true;
  return [0.5, 100, 1000, 360, 365, 252, 10000].includes(Math.abs(v));
}

export interface NumberHit {
  raw: string;
  value: number;
  /** Written as a percentage ("5\\%"). */
  pct: boolean;
}

/** Numbers written in a LaTeX snippet, in order. Subscripts and step tags are ignored. */
export function numbersIn(tex: string): NumberHit[] {
  const t = tex
    .replace(/\{,\}/g, ",")
    .replace(/_\{[^{}]*\}|_\d/g, ' ')
    .replace(/\\(?:q?quad|[,;:! ])/g, ' ')
    .replace(/Step\s*\d+/gi, ' ');
  const out: NumberHit[] = [];
  const re = /(?<![A-Za-z\d.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?|(?<![\d.])\.(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const raw = m[0];
    const value = Number(raw.replace(/,/g, ''));
    const pct = /^\s*(?:\\?%|\\text\{\s*\\?%)/.test(t.slice(m.index + raw.length, m.index + raw.length + 10));
    if (Number.isFinite(value)) out.push({ raw, value, pct });
  }
  return out;
}

/** Canonical key of a value. */
export function numKey(v: number): string {
  return String(Number(v.toPrecision(10)));
}

/** Keys a written number matches: itself, and its decimal twin when written as a percentage (5% ↔ 0.05). */
export function numberKeys(n: NumberHit): string[] {
  return n.pct ? [numKey(n.value), numKey(n.value / 100)] : [numKey(n.value)];
}

/** Whether a written number is among `keys`, directly or as the percentage of a decimal there. */
export function hasNumber(keys: ReadonlySet<string>, n: NumberHit): boolean {
  return keys.has(numKey(n.value)) || (n.pct && keys.has(numKey(n.value / 100))) || (!n.pct && n.value < 1 && keys.has(`%${numKey(n.value * 100)}`));
}

/** Every number key in a list of parts. */
export function partNumbers(parts: readonly Part[]): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    for (const n of numbersIn(s)) {
      for (const key of numberKeys(n)) out.add(key);
      // Remember percentages so a later decimal (0.2377 after 23.77%) matches them.
      if (n.pct) out.add(`%${numKey(n.value)}`);
    }
  };
  for (const p of parts) {
    if (p.kind === 'text') add(p.latex);
    else if (p.kind === 'math') add(p.tex);
    else if (p.kind === 'list') p.items.forEach(add);
    else for (const row of [...p.head, ...p.body]) for (const c of row) add(c.latex);
  }
  return out;
}

/** Numbers in `tex` that are not common and not in `avail`, as written. */
export function unseenNumbers(tex: string, avail: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const n of numbersIn(tex)) {
    if (isCommonNumber(n.value)) continue;
    if (!hasNumber(avail, n)) out.push(n.raw);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------
// Moves

const OPERATOR = /\\times|\\cdot|\\frac|\\tfrac|\\dfrac|\\sqrt|\\div|\\ln|\\log|\\max|\\min|\\exp|e\^|[+\-*/^]|N\\!?\s*\(|N\^\{-1\}|N\\left|N\\bigl/;
const MULTI_EQUATION = /\\qquad|\\Longrightarrow|\\Rightarrow|\\iff|:\s*\\quad/;

/** "lhs = setup = … = result" → the setup (the operation) and the result. Null if not a calculation. */
export function splitEquation(row: string): { op: string; result: string } | null {
  if (MULTI_EQUATION.test(row)) return null;
  const { parts, seps } = relationSplit(row);
  if (parts.length < 2) return null;
  const p0 = parts[0].trim();
  const hasDigit = (x: string) => /\d/.test(x.replace(/_\{[^{}]*\}|_\d/g, ''));
  const computes = (x: string) => hasDigit(x) && OPERATOR.test(x);
  let cut: number;
  if (computes(p0)) cut = 1;
  else if (parts.length >= 3 && hasDigit(parts[1])) cut = 2;
  else return null;
  const join = (from: number, to: number) =>
    parts
      .slice(from, to)
      .map((p, i) => (i === 0 ? p : `${seps[from + i - 1]}${p}`))
      .join('')
      .trim();
  const trimSpace = (x: string) => x.replace(/^(?:\s|\\[,;:!]|\\q?quad)+|(?:\s|\\[,;:!]|\\q?quad)+$/g, '');
  const op = trimSpace(join(0, cut));
  const result = trimSpace(join(cut, parts.length));
  if (!op || !result || !hasDigit(op) || !hasDigit(result)) return null;
  // An identity ("λ(5)×5 = λ(3)×3 + λ×2") states a relation; a calculation lands on a value.
  if (!numbersIn(result).some((n) => !isCommonNumber(n.value))) return null;
  // A setup that is just a bare number (the "result = formula" order) has no operation to name.
  if (!OPERATOR.test(op.replace(/^\s*-/, ''))) return null;
  return { op, result };
}

/** "Step 2 —", "Step 3.", "2." — a bare number counts only with its separator ("10-day" is not an ordinal). */
const STEP_PREFIX =
  /^\s*(?:step\s*(\d+)[a-z]?\s*(?:[.:)]|---|--|—|–)?|(\d+)\s*(?:[.:)]|---|--|—|–)(?!\d))\s*(?:---|--|—|–)?\s*/i;

/** A label with its ordinal lifted, and the ordinal if one was given. */
export function liftOrdinal(label: string): { text: string; n: number | null } {
  const m = STEP_PREFIX.exec(label);
  if (m && (m[1] || m[2])) {
    const text = label.slice(m[0].length).trim();
    return { text, n: Number(m[1] ?? m[2]) };
  }
  return { text: label.trim(), n: null };
}

/** Labels that head commentary, answers or cases rather than an operation. */
const NON_OP =
  /^(?:what this means|interpretation|answer|note|notes|why|check|cross-check|the contrast|intuition|takeaway|result|so\b|therefore|reading|[a-d]\s+is\s+(?:in)?correct|option\b|(?:time|year|month|day|period|case|question|part|scenario)\s*\d|at\s+\d|the trade|anticipated result|total gain)/i;

export function isOpLabel(label: string): boolean {
  const { text } = liftOrdinal(label);
  const plain = text.replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}$]/g, ' ');
  if (!/[A-Za-z]{3,}/.test(plain)) return false;
  if (NON_OP.test(plain.trim())) return false;
  return plain.trim().length <= 160;
}

/** Leading \textbf{…} label of a paragraph, and the rest. */
export function leadingLabel(latex: string): { label: string; rest: string } | null {
  const t = latex.trimStart();
  if (!t.startsWith('\\textbf{')) return null;
  const end = skipGroup(t, 7);
  if (end < 0) return null;
  const label = t.slice(8, end - 1).trim();
  const rest = t.slice(end).replace(/^\s*[:.]\s*/, ' ').trim();
  if (!label) return null;
  return { label, rest };
}

/** Whether parts contain an actual calculation (a line with a number and an equals sign). */
export function computes(parts: readonly Part[]): boolean {
  for (const p of parts) {
    if (p.kind === 'math' && mathRows(p).some((r) => /\d/.test(r) && /=|\\approx/.test(r))) return true;
    if (p.kind === 'text') {
      const inline = p.latex.match(/(?<!\\)\$[^$]+\$/g) ?? [];
      if (inline.some((x) => /\d/.test(x) && /=/.test(x))) return true;
    }
    if (p.kind === 'list' && p.items.some((x) => /\$[^$]*\d[^$]*=[^$]*\$/.test(x))) return true;
  }
  return false;
}

function labelMoves(parts: readonly Part[]): Move[] | null {
  interface Group {
    label: string | null;
    body: Part[];
  }
  const groups: Group[] = [];
  let cur: Group = { label: null, body: [] };
  for (const p of parts) {
    const lab = p.kind === 'text' ? leadingLabel(p.latex) : null;
    if (lab) {
      if (cur.label !== null || cur.body.length) groups.push(cur);
      cur = { label: lab.label, body: lab.rest ? [{ kind: 'text', latex: lab.rest }] : [] };
    } else cur.body.push(p);
  }
  if (cur.label !== null || cur.body.length) groups.push(cur);
  const ops = groups.filter((g) => g.label !== null && isOpLabel(g.label) && computes(g.body));
  if (ops.length < 2) return null;
  const moves: Move[] = [];
  let ordinal = 0;
  for (const g of groups) {
    ordinal++;
    if (g.label === null) {
      moves.push({ n: ordinal, kind: 'context', lead: [], body: g.body, blankable: false });
      continue;
    }
    const { text, n } = liftOrdinal(g.label);
    const isOp = ops.includes(g);
    moves.push({
      n: n ?? ordinal,
      kind: isOp ? 'label' : 'context',
      lead: [],
      label: isOp ? text.replace(/[.:]\s*$/, '').trim() : undefined,
      labelFull: g.label,
      body: g.body,
      blankable: isOp,
    });
  }
  return moves;
}

function equationMoves(parts: readonly Part[]): Move[] {
  const moves: Move[] = [];
  let lead: Part[] = [];
  for (const p of parts) {
    if (p.kind !== 'math') {
      lead.push(p);
      continue;
    }
    // Continuation rows ("= 28.75") belong to the row above.
    const rows: string[] = [];
    for (const r of mathRows(p)) {
      if (/^(?:=|\\approx)/.test(r) && rows.length) rows[rows.length - 1] += ` ${r}`;
      else rows.push(r);
    }
    for (const row of rows) {
      const eq = splitEquation(row);
      moves.push({
        n: moves.length + 1,
        kind: eq ? 'equation' : 'context',
        lead,
        op: eq?.op,
        result: eq?.result,
        body: [{ kind: 'math', tex: row }],
        blankable: !!eq,
      });
      lead = [];
    }
  }
  if (lead.length) moves.push({ n: moves.length + 1, kind: 'context', lead: [], body: lead, blankable: false });
  return moves;
}

/** Moves of a worked example's working, label-headed when the notes head at least two steps. */
export function parseMoves(parts: readonly Part[]): Move[] {
  const moves = labelMoves(parts) ?? equationMoves(parts);
  // Step numbers must be unique for stable item IDs; fall back to ordinals if the notes repeat one.
  const ns = new Set(moves.map((m) => m.n));
  if (ns.size !== moves.length) moves.forEach((m, i) => (m.n = i + 1));
  return moves;
}

// ---------------------------------------------------------------------------------------------
// Problem / working split

/** The "Answer" / "Solution" heading some notes put inside the question box. */
const ANSWER_MARK = /\\noindent\s*\{[^\n]*?(?:Answer|Solution)\s*\}\s*(?:\\par)?/;

export interface Problem {
  prompt: Part[];
  working: Part[];
}

function startsWorking(p: Part): boolean {
  if (p.kind === 'math') return mathRows(p).some((r) => splitEquation(r) !== null);
  if (p.kind === 'text') {
    const lab = leadingLabel(p.latex);
    return !!lab && /^\s*step\s*\d/i.test(lab.label);
  }
  return false;
}

/**
 * Splits an exbox into what the player is given and the working. The notes put the working in
 * the lower box when there is one; otherwise it follows an "Answer" heading or simply follows
 * the givens in the question box.
 */
export function splitProblem(question: string | null | undefined, solution: string | null | undefined): Problem {
  let q = typeof question === 'string' ? question : '';
  const s = typeof solution === 'string' ? solution : '';
  let carried = '';
  const mark = ANSWER_MARK.exec(q);
  if (mark) {
    carried = q.slice(mark.index + mark[0].length);
    q = q.slice(0, mark.index);
  }
  const qParts = toParts(q);
  const sParts = [...toParts(carried), ...toParts(s)];
  if (sParts.length) return { prompt: qParts, working: sParts };
  const cut = qParts.findIndex(startsWorking);
  if (cut < 0) return { prompt: qParts, working: [] };
  // Keep a lead-in paragraph that ends in a colon with the working it introduces.
  let at = cut;
  const prev = qParts[cut - 1];
  if (prev && prev.kind === 'text' && /:\s*$/.test(prev.latex) && cut - 1 > 0) at = cut - 1;
  return { prompt: qParts.slice(0, at), working: qParts.slice(at) };
}
