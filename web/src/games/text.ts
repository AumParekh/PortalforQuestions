// Turning the notes' LaTeX snippets into display text and word tokens. Pure; no React.

export type Segment = { kind: 'text'; text: string } | { kind: 'math'; tex: string };

export interface Token {
  /** What is shown. For math tokens, the TeX source (without $). */
  text: string;
  math: boolean;
  /** Lower-cased, punctuation-trimmed form for comparison. */
  norm: string;
}

// ---------------------------------------------------------------------------------------------
// Text-mode LaTeX → plain text. Players see only the notes' words, numbers and formulas: every
// formatting command, colour, size, spacing, environment name, table spec and accent macro is
// either rendered (accents, dashes, symbols) or dropped, never shown as source.

/** Environments whose whole body is drawing or layout code: dropped with their contents. */
const DROP_ENVS = new Set(['tikzpicture', 'pgfpicture', 'axis', 'scope', 'comment']);
/** Table-like environments: bare & separates cells and \\ ends a row. */
const TABLE_ENVS = new Set(['tabular', 'tabular*', 'tabularx', 'tabulary', 'longtable', 'array', 'tabbing']);
/** Mandatory arguments that follow \begin{env} and are layout, not content (widths, column specs). */
const ENV_ARGS: Record<string, number> = {
  tabular: 1,
  'tabular*': 2,
  tabularx: 2,
  tabulary: 2,
  longtable: 1,
  array: 1,
  minipage: 1,
  multicols: 1,
  'multicols*': 1,
  wrapfigure: 2,
  adjustbox: 1,
};
/** Display-math environments written outside $…$, and the KaTeX form that renders them inline. */
const MATH_ENVS: Record<string, [string, string]> = {
  'align*': ['\\begin{aligned}', '\\end{aligned}'],
  align: ['\\begin{aligned}', '\\end{aligned}'],
  'alignat*': ['\\begin{aligned}', '\\end{aligned}'],
  'eqnarray*': ['\\begin{aligned}', '\\end{aligned}'],
  eqnarray: ['\\begin{aligned}', '\\end{aligned}'],
  'gather*': ['\\begin{gathered}', '\\end{gathered}'],
  gather: ['\\begin{gathered}', '\\end{gathered}'],
  'multline*': ['\\begin{gathered}', '\\end{gathered}'],
  multline: ['\\begin{gathered}', '\\end{gathered}'],
  'equation*': ['', ''],
  equation: ['', ''],
  displaymath: ['', ''],
  math: ['', ''],
};
/** Commands dropped with their arguments: [optional args, mandatory args]. Colours, sizes, spacing, refs. */
const DROP_CMDS: Record<string, [number, number]> = {
  color: [1, 1],
  pagecolor: [1, 1],
  definecolor: [0, 3],
  colorlet: [0, 2],
  rowcolor: [1, 1],
  cellcolor: [1, 1],
  columncolor: [1, 1],
  arrayrulecolor: [1, 1],
  fontsize: [0, 2],
  hspace: [0, 1],
  vspace: [0, 1],
  addvspace: [0, 1],
  setlength: [0, 2],
  addtolength: [0, 2],
  setcounter: [0, 2],
  addtocounter: [0, 2],
  linespread: [0, 1],
  label: [0, 1],
  ref: [0, 1],
  eqref: [0, 1],
  pageref: [0, 1],
  autoref: [0, 1],
  cref: [0, 1],
  Cref: [0, 1],
  cite: [2, 1],
  citep: [2, 1],
  citet: [2, 1],
  footnote: [1, 1],
  footnotemark: [1, 0],
  footnotetext: [1, 1],
  marginpar: [1, 1],
  includegraphics: [1, 1],
  rule: [1, 2],
  phantom: [0, 1],
  hphantom: [0, 1],
  vphantom: [0, 1],
  cmidrule: [1, 1],
  cline: [0, 1],
  addlinespace: [1, 0],
  renewcommand: [1, 2],
  newcommand: [1, 2],
  providecommand: [1, 2],
  pgfplotsset: [0, 1],
  tcbset: [0, 1],
  captionsetup: [1, 1],
  addlegendentry: [1, 1],
  addplot: [1, 0],
  url: [0, 1],
  hypersetup: [0, 1],
  usetikzlibrary: [0, 1],
  vskip: [0, 0],
  hskip: [0, 0],
};
/** Commands that wrap content after some layout arguments: [optional args, mandatory args]; the last is kept. */
const KEEP_LAST_CMDS: Record<string, [number, number]> = {
  textcolor: [1, 2],
  colorbox: [1, 2],
  fcolorbox: [1, 3],
  href: [0, 2],
  hyperref: [1, 1],
  multicolumn: [0, 3],
  multirow: [1, 3],
  makebox: [2, 1],
  framebox: [2, 1],
  parbox: [3, 2],
  raisebox: [2, 2],
  resizebox: [0, 3],
  scalebox: [1, 2],
  rotatebox: [1, 2],
  adjustbox: [0, 2],
  tcbox: [1, 1],
};
/** Box-drawn "chips" in the notes' tables that stand for a rating word. */
const CHIP_WORDS: Record<string, string> = {
  chiplow: 'Low',
  chipmod: 'Moderate',
  chiphigh: 'High',
  chipvhigh: 'Very high',
};
/** Argument-free text-mode symbols. */
const TEXT_SYMBOLS: Record<string, string> = {
  ldots: '…',
  dots: '…',
  cdots: '⋯',
  textendash: '–',
  textemdash: '—',
  textbullet: '•',
  bullet: '•',
  textperiodcentered: '·',
  checkmark: '✓',
  euro: '€',
  texteuro: '€',
  pounds: '£',
  textsterling: '£',
  yen: '¥',
  textyen: '¥',
  textdollar: '$',
  textpercent: '%',
  S: '§',
  P: '¶',
  dag: '†',
  ddag: '‡',
  textdagger: '†',
  copyright: '©',
  textcopyright: '©',
  textregistered: '®',
  texttrademark: '™',
  textdegree: '°',
  degree: '°',
  textonehalf: '½',
  textonequarter: '¼',
  textthreequarters: '¾',
  textperthousand: '‰',
  textgreater: '>',
  textless: '<',
  textasciitilde: '~',
  textasciicircum: '^',
  textbar: '|',
  textbackslash: '',
  textquotedblleft: '“',
  textquotedblright: '”',
  textquoteleft: '‘',
  textquoteright: '’',
  guillemotleft: '«',
  guillemotright: '»',
  blacktriangleright: '▸',
  triangleright: '▸',
  star: '★',
  bigstar: '★',
  i: 'ı',
  j: 'ȷ',
  ss: 'ß',
  o: 'ø',
  O: 'Ø',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  LaTeX: 'LaTeX',
  TeX: 'TeX',
  today: '',
};
/** Commands that only break or space the line. */
const SPACE_CMDS = new Set([
  'newline',
  'linebreak',
  'par',
  'break',
  'quad',
  'qquad',
  'enspace',
  'enskip',
  'thinspace',
  'hfill',
  'vfill',
  'hfil',
  'smallskip',
  'medskip',
  'bigskip',
  'noindent',
  'indent',
  'item',
  'kill',
  'cr',
  'tabularnewline',
]);
/** Accent macros → the Unicode combining mark (NFC-composed afterwards). */
const ACCENTS: Record<string, string> = {
  "'": '\u0301',
  '`': '\u0300',
  '^': '\u0302',
  '"': '\u0308',
  '~': '\u0303',
  '=': '\u0304',
  '.': '\u0307',
  c: '\u0327',
  v: '\u030C',
  u: '\u0306',
  H: '\u030B',
  r: '\u030A',
  k: '\u0328',
  d: '\u0323',
  b: '\u0331',
};
const CMD_RE = /\\([a-zA-Z@]+)(\*?)/y;
/** A \\ line break with its optional star and [length]. */
const BREAK_RE = /\\\\\*?(?:\s*\[[^\]]*\])?/y;
const ENV_RE = /\\(begin|end)\{([a-zA-Z*]+)\}/y;
/** Marks a table cell or row boundary until the separators are tidied. */
const CELL = '\uE000';

/** Index just past the balanced group that opens at `i` (`{…}` or `[…]`); -1 if none opens there. */
function groupEnd(s: string, i: number): number {
  const open = s[i];
  if (open !== '{' && open !== '[') return -1;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let brace = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (open === '[') {
      // Brackets inside a brace group ("[label=\textbf{a.}]") don't close the option list.
      if (c === '{') brace++;
      else if (c === '}') brace--;
      else if (brace === 0 && c === '[') depth++;
      else if (brace === 0 && c === ']' && --depth === 0) return j + 1;
    } else if (c === '{') depth++;
    else if (c === close && --depth === 0) return j + 1;
  }
  return -1;
}

/** Skips spaces and at most one line break (LaTeX reads arguments across them, not across a blank line). */
function skipSpace(s: string, i: number): number {
  let j = i;
  let breaks = 0;
  while (j < s.length && /\s/.test(s[j])) {
    if (s[j] === '\n' && ++breaks > 1) break;
    j++;
  }
  return j;
}

/**
 * Reads a command's arguments: up to `opt` optional [..] and `req` mandatory {..}, in any order.
 * Stops at the first thing that is neither, so an argument split off by math is simply left short.
 */
function readArgs(s: string, i: number, opt: number, req: number): { args: string[]; end: number } {
  let j = i;
  let o = opt;
  let r = req;
  const args: string[] = [];
  while (o > 0 || r > 0) {
    const k = skipSpace(s, j);
    const e = groupEnd(s, k);
    if (e < 0) break;
    if (s[k] === '[' && o > 0) o--;
    else if (s[k] === '{' && r > 0) {
      args.push(s.slice(k + 1, e - 1));
      r--;
    } else break;
    j = e;
  }
  return { args, end: j };
}

/** Index of the \end{env} closing a \begin{env} whose body starts at `from`; nesting of the same env is honoured. */
function envEnd(s: string, env: string, from: number): { bodyEnd: number; end: number } | null {
  const open = `\\begin{${env}}`;
  const close = `\\end{${env}}`;
  let depth = 1;
  let j = from;
  while (j < s.length) {
    const o = s.indexOf(open, j);
    const c = s.indexOf(close, j);
    if (c < 0) return null;
    if (o >= 0 && o < c) {
      depth++;
      j = o + open.length;
      continue;
    }
    if (--depth === 0) return { bodyEnd: c, end: c + close.length };
    j = c + close.length;
  }
  return null;
}

/** Removes drawing environments (TikZ, pgfplots) whole, before math is split out of them. */
function dropDrawings(src: string): string {
  if (!src.includes('\\begin{')) return src;
  let out = '';
  let i = 0;
  const re = /\\begin\{([a-zA-Z*]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index < i || !DROP_ENVS.has(m[1])) continue;
    const e = envEnd(src, m[1], m.index + m[0].length);
    out += src.slice(i, m.index) + ' ';
    i = e ? e.end : src.length;
    re.lastIndex = i;
  }
  return out + src.slice(i);
}

/** Inside table environments, marks bare & and \\ (outside math) as cell boundaries. */
function markTableCells(src: string): string {
  if (!/\\begin\{(?:tabular|tabularx|tabulary|longtable|tabbing)/.test(src)) return src;
  let out = '';
  let depth = 0;
  let math = '';
  for (let i = 0; i < src.length; i++) {
    ENV_RE.lastIndex = i;
    const rest = src[i] === '\\' ? ENV_RE.exec(src) : null;
    if (rest && TABLE_ENVS.has(rest[2]) && !math) {
      depth += rest[1] === 'begin' ? 1 : -1;
      out += rest[0];
      i += rest[0].length - 1;
      continue;
    }
    const c = src[i];
    if (c === '\\') {
      if (depth > 0 && !math && src[i + 1] === '\\') {
        BREAK_RE.lastIndex = i;
        const opt = BREAK_RE.exec(src);
        out += ` ${CELL} `;
        i += (opt ? opt[0].length : 2) - 1;
        continue;
      }
      out += c + (src[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '$') {
      const d = src[i + 1] === '$' ? '$$' : '$';
      if (!math) math = d;
      else if (math === d) math = '';
      out += d;
      i += d.length - 1;
      continue;
    }
    out += depth > 0 && !math && c === '&' ? ` ${CELL} ` : c;
  }
  return out;
}

function accented(base: string, mark: string): string {
  const letter = base === '\\i' ? 'i' : base === '\\j' ? 'j' : base;
  return (letter + mark).normalize('NFC');
}

/** One pass over text-mode LaTeX (no math inside). Recursive on brace groups. */
function plainPass(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const next = s[i + 1] ?? '';
      // \\ line break, with an optional [length].
      if (next === '\\') {
        BREAK_RE.lastIndex = i;
        const m = BREAK_RE.exec(s);
        if (!out.endsWith('-')) out += ' ';
        i += m ? m[0].length : 2;
        continue;
      }
      if (/[a-zA-Z@]/.test(next)) {
        CMD_RE.lastIndex = i;
        const m = CMD_RE.exec(s)!;
        const name = m[1];
        let j = i + m[0].length;
        if (ACCENTS[name] && name.length === 1) {
          // \c{c}, \v s, \u{g}: an accent macro that happens to be a letter.
          const k = skipSpace(s, j);
          const e = s[k] === '{' ? groupEnd(s, k) : -1;
          const base = e > 0 ? s.slice(k + 1, e - 1).trim() : s[k] ?? '';
          if (/^(?:[a-zA-Z]|\\[ij])$/.test(base)) {
            out += accented(base, ACCENTS[name]);
            i = e > 0 ? e : k + 1;
            continue;
          }
        }
        if (name === 'begin' || name === 'end') {
          const e = s[skipSpace(s, j)] === '{' ? groupEnd(s, skipSpace(s, j)) : -1;
          const env = e > 0 ? s.slice(skipSpace(s, j) + 1, e - 1).trim() : '';
          j = e > 0 ? e : j;
          if (name === 'begin') {
            if (DROP_ENVS.has(env)) {
              const end = envEnd(s, env, j);
              i = end ? end.end : s.length;
              out += ' ';
              continue;
            }
            // Option list ([label=…]) and layout arguments (widths, column specs).
            j = readArgs(s, j, 1, ENV_ARGS[env] ?? 0).end;
          }
          out += ' ';
          i = j;
          continue;
        }
        if (name === 'item') {
          const k = skipSpace(s, j);
          const e = s[k] === '[' ? groupEnd(s, k) : -1;
          out += e > 0 ? ` ${plainPass(s.slice(k + 1, e - 1))} ` : ' ';
          i = e > 0 ? e : j;
          continue;
        }
        if (CHIP_WORDS[name]) {
          out += CHIP_WORDS[name];
          i = j;
          continue;
        }
        const drop = DROP_CMDS[name];
        if (drop) {
          const args = readArgs(s, j, drop[0], drop[1]);
          out += name === 'hspace' || name === 'vspace' ? ' ' : '';
          i = args.end;
          continue;
        }
        const keep = KEEP_LAST_CMDS[name];
        if (keep) {
          // Only the last argument is content; if math cut it off, the layout ones are dropped alone.
          const args = readArgs(s, j, keep[0], keep[1]);
          if (args.args.length === keep[1]) out += plainPass(args.args[keep[1] - 1]);
          i = args.end;
          continue;
        }
        if (SPACE_CMDS.has(name)) {
          // "Kolmogorov-\newline Smirnov": a break after a hyphen joins the word back up.
          if (!out.endsWith('-')) out += ' ';
          i = skipSpace(s, j);
          continue;
        }
        const sym = TEXT_SYMBOLS[name] ?? GREEK[name] ?? MATH_OPS[name];
        if (sym !== undefined) {
          out += sym;
          // "\ldots{}" and "\euro{}": an empty group only ends the macro name.
          i = s.startsWith('{}', j) ? j + 2 : j;
          continue;
        }
        // Anything else (\textbf, \emph, \term, \hdr, \small, \bfseries, \selectfont …): keep the text
        // of the groups that follow, drop the command. Options in [..] are layout.
        let k = j;
        const parts: string[] = [];
        for (;;) {
          if (s[k] === '[' && parts.length === 0) {
            const e = groupEnd(s, k);
            if (e < 0 || s[e] !== '{') break;
            k = e;
            continue;
          }
          if (s[k] !== '{') break;
          const e = groupEnd(s, k);
          if (e < 0) break;
          parts.push(plainPass(s.slice(k + 1, e - 1)));
          k = e;
        }
        out += parts.join(' ');
        i = k;
        continue;
      }
      // One-character macros.
      if (ACCENTS[next]) {
        const k = i + 2;
        const e = s[k] === '{' ? groupEnd(s, k) : -1;
        const base = e > 0 ? s.slice(k + 1, e - 1).trim() : /^\\[ij](?![a-zA-Z])/.test(s.slice(k)) ? s.slice(k, k + 2) : s[k] ?? '';
        if (/^(?:[a-zA-Z]|\\[ij])$/.test(base)) {
          out += accented(base, ACCENTS[next]);
          i = e > 0 ? e : k + base.length;
          continue;
        }
        // Not an accent: tabbing's \= and \' set tab stops.
        out += next === '~' ? '~' : next === '^' ? '^' : ' ';
        i += 2;
        continue;
      }
      if ('%$&#_{}'.includes(next) && next) {
        out += next;
        i += 2;
        continue;
      }
      out += ',;: >+<'.includes(next) && next ? ' ' : '';
      i += 2;
      continue;
    }
    if (c === '{') {
      const e = groupEnd(s, i);
      if (e > 0) {
        out += plainPass(s.slice(i + 1, e - 1));
        i = e;
        continue;
      }
      i++;
      continue;
    }
    if (c === '}') {
      i++;
      continue;
    }
    if (c === '~') {
      out += ' ';
      i++;
      continue;
    }
    if (c === '-' && s.startsWith('---', i)) {
      out += '—';
      i += 3;
      continue;
    }
    if (c === '-' && s[i + 1] === '-' && s[i + 2] !== '>') {
      out += '–';
      i += 2;
      continue;
    }
    if (c === '`' && s[i + 1] === '`') {
      out += '“';
      i += 2;
      continue;
    }
    if (c === "'" && s[i + 1] === "'") {
      out += '”';
      i += 2;
      continue;
    }
    if (c === '`') {
      out += '‘';
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Splits on $…$, $$…$$, \( … \), \[ … \] and display-math environments (align*, equation, …),
 * honouring \$ as a literal dollar and \\ as a line break (not the start of \[ … \]).
 */
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
    if (ch === '\\' && (src[i + 1] === '$' || src[i + 1] === '\\')) {
      buf += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '\\' && src.startsWith('\\begin{', i)) {
      ENV_RE.lastIndex = i;
      const m = ENV_RE.exec(src);
      const wrap = m && m[1] === 'begin' ? MATH_ENVS[m[2]] : undefined;
      const body = m && wrap ? envEnd(src, m[2], i + m[0].length) : null;
      if (m && wrap && body) {
        flush();
        const tex = src
          .slice(i + m[0].length, body.bodyEnd)
          .replace(/\\(?:label|tag)\*?\{[^{}]*\}|\\(?:notag|nonumber)\b/g, '')
          .trim();
        if (tex) out.push({ kind: 'math', tex: `${wrap[0]}${tex}${wrap[1]}` });
        i = body.end;
        continue;
      }
    }
    let open = '';
    let close = '';
    if (src.startsWith('$$', i)) [open, close] = ['$$', '$$'];
    else if (ch === '$') [open, close] = ['$', '$'];
    else if (src.startsWith('\\(', i)) [open, close] = ['\\(', '\\)'];
    else if (src.startsWith('\\[', i)) [open, close] = ['\\[', '\\]'];
    // A lone $ pairs up as math only when no space sits just inside either end (as in Pandoc), so
    // the dollars in display text ("$15 million and $10 million") stay text.
    const single = open === '$';
    if (single && /\s/.test(src[i + 1] ?? ' ')) open = '';
    if (open) {
      let j = i + open.length;
      while (
        j < src.length &&
        !(src.startsWith(close, j) && src[j - 1] !== '\\' && (!single || !/\s/.test(src[j - 1])))
      )
        j++;
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

/** Text-mode LaTeX to plain text, whitespace collapsed; a space at either edge is kept for joining segments. */
function textToPlain(s: string): string {
  let t = plainPass(markTableCells(dropDrawings(s)));
  // Table cells: one " · " between cells, however many empty ones sit in between.
  t = t.replace(new RegExp(`\\s*${CELL}(?:\\s*${CELL})*\\s*`, 'g'), ' · ');
  t = t.replace(/\s+/g, ' ');
  // What a dropped reference or spacing command leaves behind: " ," and "()".
  return t.replace(/\(\s*\)/g, '').replace(/(\S) +([,.;:!?)\]])/g, '$1$2').replace(/([([]) +/g, '$1');
}

/** Drops a cell separator left dangling at the start or end of a line of text. */
function trimSeparators(t: string): string {
  return t.replace(/^\s*·\s*|\s*·\s*$/g, '');
}

/** Strips text-mode LaTeX: formatting macros keep their argument, symbols map to characters. */
export function latexTextToPlain(s: string): string {
  return trimSeparators(textToPlain(s).trim()).trim();
}

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ', kappa: 'κ', lambda: 'λ',
  mu: 'μ', nu: 'ν', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Delta: 'Δ', Gamma: 'Γ', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω', Lambda: 'Λ', Theta: 'Θ',
  xi: 'ξ', eta: 'η', zeta: 'ζ', iota: 'ι', upsilon: 'υ', vartheta: 'ϑ', varrho: 'ϱ', Xi: 'Ξ', Pi: 'Π', Psi: 'Ψ',
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
  // Drawings go first (their coordinates hold $…$); table cells are marked while & and \\ can
  // still be told apart from the math inside cells.
  for (const seg of splitMath(markTableCells(dropDrawings(latex)))) {
    if (seg.kind === 'text') {
      const text = textToPlain(seg.text);
      if (text.trim()) out.push({ kind: 'text', text });
      else if (text && out.length) out.push({ kind: 'text', text: ' ' });
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
  // Tidy the edges and any cell separators that meet across a merge.
  const cleaned: Segment[] = [];
  merged.forEach((s, k) => {
    if (s.kind === 'math') return cleaned.push(s);
    let t = s.text
      .replace(/\s+/g, ' ')
      .replace(/·(?:\s*·)+/g, '·')
      .replace(/(\S) +([,.;:!?)\]])/g, '$1$2');
    if (k === 0) t = t.replace(/^\s*·?\s*/, '');
    if (k === merged.length - 1) t = t.replace(/\s*·?\s*$/, '');
    if (t) cleaned.push({ kind: 'text', text: t });
  });
  return cleaned;
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

/** Titles that only label the box they head ("Learning objectives for this reading"), not the finance in it. */
const BOX_LABEL_TITLE = /^(?:learning objectives\b|the \w+ objectives\b|what the objective asks for$|consolidated trap summary\b)/i;

/**
 * A block title as the notes' content, or null: the gap-fill lead "What the objective asks for:" is
 * dropped ("What the objective asks for: Credit Risk Plus" → "Credit Risk Plus"), and a title that
 * only labels its box ("Consolidated trap summary — IM-1", "The four objectives in this reading") is
 * null. Returns the title's LaTeX; callers convert it for display as before.
 */
export function contentTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const t = title.replace(/^\s*what the objective asks for\s*(?:[:—–]|---?)\s*/i, '').trim();
  return t && !BOX_LABEL_TITLE.test(t) ? t : null;
}

export interface ScriptPart {
  text: string;
  /** Set when the part is a subscript or superscript of the character before it. */
  script?: 'sub' | 'sup';
}

/**
 * ASCII sub- and superscripts written into the notes' plain text: "LR_cc", "PD_A", "V_{1,L}",
 * "λ^(i−1)", "λ^n", "e^-0.015". The script must follow a letter, digit or closing bracket, so a
 * blank ("Jump-to-____") is left alone.
 */
const ASCII_SCRIPT = /(?<=[\p{L}\p{N})\]])(?:_(\{[^{}]*\}|[\p{L}\p{Nd}]+(?:,[\p{L}\p{Nd}]+)*)|\^(\([^()]*\)|\{[^{}]*\}|[-−+]?[\p{L}\p{N}.]*[\p{L}\p{N}]))/gu;

/** Splits plain text into runs and ASCII sub/superscripts ("LR_cc" → "LR", sub "cc"), so none shows as notation. */
export function scriptParts(text: string): ScriptPart[] {
  const out: ScriptPart[] = [];
  let at = 0;
  for (const m of text.matchAll(ASCII_SCRIPT)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i) });
    const sub = m[1] !== undefined;
    const body = (sub ? m[1] : m[2]).replace(/^[{(]([\s\S]*)[})]$/, '$1');
    out.push({ text: body, script: sub ? 'sub' : 'sup' });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
