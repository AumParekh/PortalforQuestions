// Turning the notes' LaTeX snippets into display text and word tokens. Pure; no React.

export type Segment = { kind: 'text'; text: string } | { kind: 'math'; tex: string };

export interface Token {
  /** What is shown. For math tokens, the TeX source (without $). */
  text: string;
  math: boolean;
  /** Lower-cased, punctuation-trimmed form for comparison. */
  norm: string;
}

const MACRO_SYMBOLS: Record<string, string> = {
  '\\%': '%',
  '\\&': '&',
  '\\#': '#',
  '\\_': '_',
  '\\S': '§',
  '\\ldots': '…',
  '\\dots': '…',
  '\\textendash': '–',
  '\\textemdash': '—',
  '\\,': ' ',
  '\\;': ' ',
  '\\ ': ' ',
  '\\\\': ' ',
};

/** Splits on $…$, $$…$$, \( … \) and \[ … \], honouring \$ as a literal dollar. */
export function splitMath(src: string): Segment[] {
  const out: Segment[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) out.push({ kind: 'text', text: buf });
    buf = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && src[i + 1] === '$') {
      buf += '\\$';
      i += 2;
      continue;
    }
    let open = '';
    let close = '';
    if (src.startsWith('$$', i)) [open, close] = ['$$', '$$'];
    else if (ch === '$') [open, close] = ['$', '$'];
    else if (src.startsWith('\\(', i)) [open, close] = ['\\(', '\\)'];
    else if (src.startsWith('\\[', i)) [open, close] = ['\\[', '\\]'];
    if (open) {
      let j = i + open.length;
      while (j < src.length && !(src.startsWith(close, j) && src[j - 1] !== '\\')) j++;
      if (j < src.length) {
        flush();
        out.push({ kind: 'math', tex: src.slice(i + open.length, j).trim() });
        i = j + close.length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Strips text-mode LaTeX: formatting macros keep their argument, symbols map to characters. */
export function latexTextToPlain(s: string): string {
  let t = s;
  t = t.replace(/``|''/g, (q) => (q === '``' ? '“' : '”'));
  t = t.replace(/---/g, '—').replace(/--/g, '–');
  t = t.replace(/\\\$/g, '$');
  for (const [k, v] of Object.entries(MACRO_SYMBOLS)) t = t.split(k).join(v);
  // \cmd[opt]{arg} → arg, repeatedly for nesting.
  for (let n = 0; n < 5; n++) {
    const next = t.replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1');
    if (next === t) break;
    t = next;
  }
  t = t.replace(/\\[a-zA-Z@]+\*?/g, '');
  t = t.replace(/[{}]/g, '').replace(/~/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ', kappa: 'κ', lambda: 'λ',
  mu: 'μ', nu: 'ν', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Delta: 'Δ', Gamma: 'Γ', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω', Lambda: 'Λ', Theta: 'Θ',
};
const MATH_OPS: Record<string, string> = {
  times: '×', cdot: '·', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', pm: '±', to: '→',
  rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', infty: '∞', max: 'max', min: 'min', ln: 'ln', log: 'log', exp: 'exp',
  uparrow: '↑', downarrow: '↓', sim: '~', ll: '≪', gg: '≫', quad: ' ', qquad: ' ',
};
const SUPERSCRIPT: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺', n: 'ⁿ' };

/** Simple inline math as plain Unicode ("$>$" → ">", "$\sigma^2$" → "σ²"); null when it needs KaTeX. */
export function mathToPlain(tex: string): string | null {
  let t = tex.replace(/\\(?:text|mathrm|textrm|operatorname|mathit)\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\%/g, '%').replace(/\\,|\\;|\\!|\\ /g, ' ');
  t = t.replace(/\\([a-zA-Z]+)/g, (m, name: string) => GREEK[name] ?? MATH_OPS[name] ?? m);
  t = t.replace(/\^\{?([0-9n+-]{1,3})\}?/g, (m, p: string) =>
    [...p].every((c) => SUPERSCRIPT[c]) ? [...p].map((c) => SUPERSCRIPT[c]).join('') : m,
  );
  t = t.replace(/\\left|\\right/g, '');
  if (/[\\{}^_]/.test(t)) return null;
  return t.replace(/\s+/g, ' ').trim();
}

/** Display segments for a LaTeX snippet: text is de-LaTeXed; simple math is flattened into text. */
export function toSegments(latex: string): Segment[] {
  const out: Segment[] = [];
  for (const seg of splitMath(latex)) {
    if (seg.kind === 'text') {
      const text = latexTextToPlain(seg.text);
      if (text) out.push({ kind: 'text', text: (/^\s/.test(seg.text) ? ' ' : '') + text + (/\s$/.test(seg.text) ? ' ' : '') });
    } else {
      const plain = mathToPlain(seg.tex);
      if (plain !== null) out.push({ kind: 'text', text: plain });
      else out.push(seg);
    }
  }
  // Merge neighbouring text segments.
  const merged: Segment[] = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (s.kind === 'text' && prev && prev.kind === 'text') prev.text += s.text;
    else merged.push(s.kind === 'text' ? { kind: 'text', text: s.text } : s);
  }
  return merged;
}

/** Plain one-line text of a LaTeX snippet (complex math kept as $…$ for the Markdown renderer). */
export function toDisplay(latex: string): string {
  return toSegments(latex)
    .map((s) => (s.kind === 'text' ? s.text : `$${s.tex}$`))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}$%§]+|[^\p{L}\p{N}%]+$/gu, '')
    .replace(/[’']s$/, '');
}

export function tokenize(latex: string): Token[] {
  const tokens: Token[] = [];
  for (const seg of toSegments(latex)) {
    if (seg.kind === 'math') {
      tokens.push({ text: seg.tex, math: true, norm: seg.tex.replace(/\s+/g, '') });
      continue;
    }
    for (const w of seg.text.split(/\s+/)) {
      if (w) tokens.push({ text: w, math: false, norm: normWord(w) });
    }
  }
  return tokens;
}

export interface WordDiff {
  /** Token indices in `a` not in the longest common subsequence. */
  onlyA: number[];
  /** Token indices in `b` not in the longest common subsequence. */
  onlyB: number[];
}

/** Word-level LCS diff on normalised tokens. */
export function diffTokens(a: readonly Token[], b: readonly Token[]): WordDiff {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i].norm === b[j].norm ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const inA = new Set<number>();
  const inB = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].norm === b[j].norm) {
      inA.add(i);
      inB.add(j);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return {
    onlyA: a.map((_, k) => k).filter((k) => !inA.has(k)),
    onlyB: b.map((_, k) => k).filter((k) => !inB.has(k)),
  };
}

/** Joins tokens at the given indices into a phrase, trimming outer punctuation. */
export function phrase(tokens: readonly Token[], idx: readonly number[]): string {
  return idx
    .map((k) => (tokens[k].math ? `$${tokens[k].text}$` : tokens[k].text))
    .join(' ')
    .replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}$%)]+$/gu, '');
}

/** Bold / term spans in a LaTeX snippet, in order (the notes bold their load-bearing phrases). */
export function emphasised(latex: string): string[] {
  const out: string[] = [];
  const re = /\\(?:textbf|term|emph)\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latex))) {
    const t = toDisplay(m[1]).replace(/[.:;,]+$/, '').trim();
    if (t) out.push(t);
  }
  return out;
}

/** Removes a leading category label ("\textbf{Polarity.}" / "Polarity:") from trap text. */
export function stripCategoryLead(latex: string, labels: readonly (string | null | undefined)[]): string {
  let t = latex.trim();
  for (const label of labels) {
    if (!label) continue;
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^(?:\\\\textbf\\{\\s*${esc}\\s*[.:]?\\s*\\}|${esc}\\s*[.:])\\s*[.:]?\\s*`, 'i');
    t = t.replace(re, '');
  }
  return t;
}
