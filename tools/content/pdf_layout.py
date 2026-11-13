"""Geometry-aware text extraction for the LaTeX-typeset question PDFs (question banks and workbooks).

pdftotext loses what these PDFs need most: glyphs without a Unicode mapping (the "f" of fi/fl pairs, big brackets),
sub- and superscripts, fraction bars, square-root bars and ruled tables. This module reads the characters and rules
with their positions (pdfplumber) and rebuilds each page as a list of lines whose text is the portal's content
format: markdown with $...$ KaTeX math and pipe tables. Wording is never changed.

    for line in page_lines(page, cid_text):   # top to bottom
        line.text, line.x0, line.size, line.bold_prefix, line.box, line.kind ('text' | 'table')
"""
from __future__ import annotations

import re
import statistics
import unicodedata
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------------------------------------------
# Items: one per glyph, or one per rebuilt structure (fraction, root).


@dataclass
class Item:
    x0: float
    x1: float
    top: float
    bottom: float
    size: float
    text: str = ''
    bold: bool = False
    italic: bool = False
    math: bool = False
    color: tuple = ()
    #: Set on rebuilt structures: ready LaTeX (math mode).
    latex: str | None = None
    #: Vertical position used for line clustering; defaults to the box centre.
    anchor: float | None = None
    #: A bracket drawn taller than the text around it.
    big: bool = False
    #: A math-font glyph whose ASCII letters are italic variables (TeX's math italic), not upright text.
    mathit: bool = False

    @property
    def cy(self) -> float:
        return self.anchor if self.anchor is not None else (self.top + self.bottom) / 2

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2


@dataclass
class Line:
    items: list
    x0: float
    x1: float
    top: float
    bottom: float
    size: float
    text: str = ''
    #: Text of the leading bold run ('' when the line doesn't start bold), e.g. "Q45", "Answer: C", "A.".
    bold_prefix: str = ''
    #: Text after the leading bold run.
    rest: str = ''
    kind: str = 'text'
    #: 'question' | 'answer' | '' : the coloured frame the line sits in.
    box: str = ''
    page: int = 0
    color: tuple = ()
    flags: list = field(default_factory=list)


# ---------------------------------------------------------------------------------------------------------------
# Glyph text.

GREEK = {
    'ALPHA': 'alpha', 'BETA': 'beta', 'GAMMA': 'gamma', 'DELTA': 'delta', 'EPSILON': 'epsilon', 'ZETA': 'zeta',
    'ETA': 'eta', 'THETA': 'theta', 'IOTA': 'iota', 'KAPPA': 'kappa', 'LAMDA': 'lambda', 'MU': 'mu', 'NU': 'nu',
    'XI': 'xi', 'OMICRON': 'o', 'PI': 'pi', 'RHO': 'rho', 'SIGMA': 'sigma', 'FINAL SIGMA': 'varsigma', 'TAU': 'tau',
    'UPSILON': 'upsilon', 'PHI': 'phi', 'CHI': 'chi', 'PSI': 'psi', 'OMEGA': 'omega',
    'EPSILON SYMBOL': 'epsilon', 'THETA SYMBOL': 'vartheta', 'PHI SYMBOL': 'phi', 'RHO SYMBOL': 'varrho',
    'PI SYMBOL': 'varpi', 'KAPPA SYMBOL': 'varkappa', 'PARTIAL DIFFERENTIAL': 'partial', 'NABLA': 'nabla',
}
# Capital Greek letters that LaTeX writes as Latin capitals.
GREEK_CAP_LATIN = {
    'ALPHA': 'A', 'BETA': 'B', 'EPSILON': 'E', 'ZETA': 'Z', 'ETA': 'H', 'IOTA': 'I', 'KAPPA': 'K', 'MU': 'M', 'NU': 'N',
    'OMICRON': 'O', 'RHO': 'P', 'TAU': 'T', 'CHI': 'X',
}
MATH_SYMBOL = {
    '×': r'\times ', '−': '-', '·': r'\cdot ', '⋅': r'\cdot ', '÷': r'\div ', '±': r'\pm ', '∓': r'\mp ',
    '≤': r'\le ', '≥': r'\ge ', '≠': r'\ne ', '≈': r'\approx ', '≡': r'\equiv ', '∼': r'\sim ', '≃': r'\simeq ',
    '∝': r'\propto ', '∞': r'\infty ', '→': r'\to ', '←': r'\leftarrow ', '⇒': r'\Rightarrow ', '⇔': r'\Leftrightarrow ',
    '↔': r'\leftrightarrow ', '↑': r'\uparrow ', '↓': r'\downarrow ', '∑': r'\sum ', '∏': r'\prod ', '∫': r'\int ',
    '∂': r'\partial ', '∈': r'\in ', '∉': r'\notin ', '∩': r'\cap ', '∪': r'\cup ', '∅': r'\emptyset ',
    '√': r'\surd ', '∆': r'\Delta ', '∇': r'\nabla ', '′': "'", '″': "''", '∗': '*', '∘': r'\circ ', '°': r'^\circ ',
    '…': r'\dots ', '⋯': r'\cdots ', '⋮': r'\vdots ', '≪': r'\ll ', '≫': r'\gg ', '¬': r'\neg ', '∧': r'\wedge ',
    '∨': r'\vee ', '∣': r'\mid ', '∥': r'\parallel ', '⊂': r'\subset ', '⊆': r'\subseteq ', '∀': r'\forall ',
    '∃': r'\exists ', '⟹': r'\Longrightarrow ', '⟶': r'\longrightarrow ', '↦': r'\mapsto ', 'ℓ': r'\ell ',
    '⌊': r'\lfloor ', '⌋': r'\rfloor ', '⌈': r'\lceil ', '⌉': r'\rceil ', '⟨': r'\langle ', '⟩': r'\rangle ',
    '‖': r'\|', '%': r'\%', '$': r'\$', '&': r'\&', '#': r'\#', '{': r'\{', '}': r'\}', '_': r'\_', '~': r'\sim ',
    '^': r'\hat{}', '\\': r'\backslash ', '‑': '-', '–': '-', '—': '-', '’': "'", '‘': "'", '“': r'\text{“}',
    '”': r'\text{”}', '€': r'\text{€}', '£': r'\text{£}', '¥': r'\text{¥}', '§': r'\S ', '•': r'\bullet ',
    '∶': ':', 'µ': r'\mu ', '̸': r'\not ', '⊤': r'\top ', '⇐': r'\Leftarrow ', '⊗': r'\otimes ', '⊕': r'\oplus ', '∴': r'\therefore ', '∵': r'\because ', '≅': r'\cong ', '⊥': r'\perp ',
    '∠': r'\angle ', '½': r'\tfrac{1}{2}', '¼': r'\tfrac{1}{4}', '¾': r'\tfrac{3}{4}', '²': '^2', '³': '^3',
    '¹': '^1', ' ': r'\,', ' ': ' ',
}
COMBINING = {'̄': 'bar', '̂': 'hat', '̃': 'tilde', '̇': 'dot', '̈': 'ddot', '⃗': 'vec', '̅': 'bar', '¯': 'bar', 'ˆ': 'hat', '˜': 'tilde'}
OPERATOR_NAMES = {
    'ln', 'log', 'exp', 'max', 'min', 'sin', 'cos', 'tan', 'lim', 'sup', 'inf', 'det', 'arg', 'Pr', 'cov', 'var',
    'sinh', 'cosh', 'tanh', 'gcd', 'dim', 'ker', 'deg',
}
# Left member -> right member, for brackets that came as unmapped "big" glyphs.
PAIRS = {'(': ')', '[': ']', '\\{': '\\}', '\\lfloor ': '\\rfloor ', '\\lceil ': '\\rceil '}

UPRIGHT = '\x01'
BIG = '\x02'
BRACKETS = {'(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}'}
OPENERS = {'(': ')', '[': ']', '\\{': '\\}'}
_CID = re.compile(r'^\(cid:(\d+)\)$')


def math_char(ch: str, italic: bool = False) -> str:
    """LaTeX for one character typeset in math mode. `italic`: the font sets ASCII letters as italic variables."""
    if ch in MATH_SYMBOL:
        return MATH_SYMBOL[ch]
    if ch.isascii():
        # Upright letters in math (VaR, exp, ES) are marked; italic variables arrive as their own code points,
        # or as plain letters of a math-italic font.
        return UPRIGHT + ch if ch.isalpha() and not italic else ch
    name = unicodedata.name(ch, '')
    m = re.match(r'MATHEMATICAL (BOLD ITALIC|BOLD|ITALIC|SANS-SERIF(?: BOLD)?(?: ITALIC)?|SCRIPT|BOLD SCRIPT|DOUBLE-STRUCK|FRAKTUR|MONOSPACE) (CAPITAL|SMALL|DIGIT)? ?(.+)$', name)
    if m:
        style, case, what = m.group(1), m.group(2), m.group(3)
        if case == 'DIGIT' or what.startswith('DIGIT '):
            digit = what.replace('DIGIT ', '')
            base = str(['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'].index(digit)) if digit in ('ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE') else ch
        elif len(what) == 1:
            base = what if case == 'CAPITAL' else what.lower()
        elif what in GREEK or what in GREEK_CAP_LATIN:
            if case == 'CAPITAL':
                base = GREEK_CAP_LATIN.get(what) or '\\' + GREEK[what].capitalize() + ' '
            else:
                base = '\\' + GREEK[what] + ' '
        elif what in ('DOTLESS I',):
            base = r'\imath '
        elif what in ('DOTLESS J',):
            base = r'\jmath '
        else:
            return ch
        if 'BOLD' in style:
            return r'\boldsymbol{' + base.strip() + '}' if base.startswith('\\') else r'\mathbf{' + base + '}'
        if style == 'DOUBLE-STRUCK':
            return r'\mathbb{' + base + '}'
        if 'SCRIPT' in style:
            return r'\mathcal{' + base + '}'
        return base
    if ch == 'ℎ':
        return 'h'
    m = re.match(r'GREEK (CAPITAL|SMALL) LETTER (.+)$', name)
    if m:
        what = m.group(2)
        if m.group(1) == 'CAPITAL':
            return GREEK_CAP_LATIN.get(what) or ('\\' + GREEK[what].capitalize() + ' ' if what in GREEK else ch)
        return '\\' + GREEK[what] + ' ' if what in GREEK else ch
    m = re.match(r'GREEK (.+ SYMBOL)$', name)
    if m and m.group(1) in GREEK:
        return '\\' + GREEK[m.group(1)] + ' '
    if name == 'DOUBLE-STRUCK CAPITAL R':
        return r'\mathbb{R}'
    if name == 'DOUBLE-STRUCK CAPITAL E':
        return r'\mathbb{E}'
    return ch


# Characters that mean something to the markdown parser when they sit in running text.
_MD_ESCAPE = re.compile(r'([\\`*_~$|<\[\]])')


def md_escape(text: str) -> str:
    return _MD_ESCAPE.sub(r'\\\1', text)


# ---------------------------------------------------------------------------------------------------------------
# Page -> items, rules, boxes.


def _font(name: str) -> str:
    return name.split('+')[-1]


def MATH_FONT(font: str) -> bool:
    """True for fonts that only set math; a document family may replace this."""
    return 'math' in font.lower()


def MATH_ITALIC_FONT(font: str) -> bool:
    """True for math fonts whose plain ASCII letters are italic variables; a document family may replace this."""
    return False


def load_items(page, cid_text: dict, unknown: dict | None = None, keep_empty: bool = False) -> list:
    """Glyphs of a page as Items. `cid_text` maps (font, cid) to text for glyphs the PDF gives no Unicode for."""
    out = []
    for c in page.chars:
        text = c['text']
        font = _font(c['fontname'])
        m = _CID.match(text)
        big = False
        if m:
            key = (font, int(m.group(1)))
            if key in cid_text:
                text = cid_text[key]
                big = text in BRACKETS
            else:
                if unknown is not None:
                    unknown.setdefault(key, []).append(page.page_number)
                text = '�'
        # Private-use code points some fonts use for ordinary punctuation, and legacy math fonts whose slots mean
        # something other than the letter they report (a root sign, a sum, a bracket).
        text = cid_text.get(('char', text), text)
        if (font, text) in cid_text:
            text = cid_text[(font, text)]
            big = text in BRACKETS
        if c['size'] < 1:
            continue
        if text.isspace() or (not text and not keep_empty):
            continue
        low = font.lower()
        color = c.get('non_stroking_color') or ()
        if not isinstance(color, (tuple, list)):
            color = (color,)
        out.append(
            Item(
                x0=c['x0'], x1=c['x1'], top=c['top'], bottom=c['bottom'], size=c['size'], text=text,
                bold='bold' in low or low.endswith('-bd') or 'semibold' in low or 'black' in low,
                italic='italic' in low or 'oblique' in low or low.endswith('-it'),
                math=MATH_FONT(font),
                mathit=MATH_ITALIC_FONT(font),
                color=tuple(round(float(x), 2) for x in color),
                big=big,
            )
        )
    return out


def horizontal_rules(page) -> list:
    rules = []
    for o in list(page.lines) + list(page.rects):
        if abs(o['bottom'] - o['top']) < 1.6 and o['x1'] - o['x0'] > 1.5:
            rules.append({'x0': o['x0'], 'x1': o['x1'], 'y': (o['top'] + o['bottom']) / 2, 'w': o.get('linewidth') or abs(o['bottom'] - o['top'])})
    return rules


def frames(page) -> list:
    """Stroked frames (the rounded boxes around questions and answers): bbox + stroke colour."""
    out = []
    for o in list(page.curves) + list(page.rects):
        if o['x1'] - o['x0'] < 200 or o['bottom'] - o['top'] < 8:
            continue
        # These frames are drawn as two filled shapes (edge colour, then the inside); either may also be stroked.
        color = o.get('stroking_color') if o.get('stroke') else None
        fill = o.get('non_stroking_color') if o.get('fill') else None
        out.append({'x0': o['x0'], 'x1': o['x1'], 'top': o['top'], 'bottom': o['bottom'], 'stroke': color, 'fill': fill})
    return out


# ---------------------------------------------------------------------------------------------------------------
# Rows of items -> text.


def _is_script(item: Item, base: float, cy: float) -> str:
    """'sup', 'sub' or '' for an item on a row whose main glyphs have size `base` and centre `cy`."""
    if item.latex is not None or item.size >= 0.86 * base:
        return ''
    shift = (item.top + item.bottom) / 2 - cy
    if shift < -0.115 * base:
        return 'sup'
    if shift > 0.17 * base:
        return 'sub'
    return ''


def _row_metrics(items: list) -> tuple:
    glyphs = [i for i in items if i.latex is None]
    if not glyphs:
        return (10.0, statistics.median((i.top + i.bottom) / 2 for i in items))
    sizes = {}
    for i in glyphs:
        k = round(i.size, 1)
        sizes[k] = sizes.get(k, 0) + (i.x1 - i.x0)
    # The main size is the one covering the most width; scripts never dominate a row they hang from.
    base = max(sizes, key=lambda k: (sizes[k], k))
    bigger = [k for k in sizes if k > base * 1.1 and sizes[k] > 0]
    if bigger and all(_looks_like_script_row(glyphs, base, b) for b in bigger):
        base = max(bigger)
    mains = [(i.top + i.bottom) / 2 for i in glyphs if abs(i.size - base) < 0.06 * base]
    return (base, statistics.median(mains))


def _looks_like_script_row(glyphs: list, small: float, big: float) -> bool:
    """True when the `small` glyphs sit off the centre line of the `big` ones (they are its scripts)."""
    bigs = [(i.top + i.bottom) / 2 for i in glyphs if abs(i.size - big) < 0.06 * big]
    smalls = [(i.top + i.bottom) / 2 for i in glyphs if abs(i.size - small) < 0.06 * small]
    if not bigs or not smalls:
        return False
    cy = statistics.median(bigs)
    off = sum(1 for s in smalls if s - cy < -0.115 * big or s - cy > 0.17 * big)
    return off > len(smalls) / 2


def _gap_is_space(prev: Item, cur: Item) -> bool:
    size = min(prev.size, cur.size) if prev.latex is None and cur.latex is None else max(prev.size, cur.size)
    return cur.x0 - prev.x1 > 0.105 * max(size, 5.0)


def _math_tokens(items: list) -> str:
    """LaTeX for items already known to be one math row (a numerator, a radicand, a script)."""
    return _render(items, force_math=True)[0]


def _render(items: list, force_math: bool = False) -> tuple:
    """Markdown for one row of items. Returns (text, leading bold text, text after the bold run)."""
    items = sorted(items, key=lambda i: (i.x0, i.top))
    if not items:
        return ('', '', '')
    base, cy = _row_metrics(items)

    # 1. Tokens: ('t', item) text glyph, ('m', latex, has_letters) math atom, ('s',) space.
    tokens = []
    prev = None
    k = 0
    while k < len(items):
        it = items[k]
        kind = _is_script(it, base, cy)
        if kind:
            # A cluster of scripts hanging from the same base: x_{t-1}^{2} arrives interleaved by x.
            sups, subs = [], []
            j = k
            while j < len(items) and _is_script(items[j], base, cy) and (j == k or items[j].x0 - max(i.x1 for i in items[k:j]) < 0.45 * base):
                (sups if _is_script(items[j], base, cy) == 'sup' else subs).append(items[j])
                j += 1
            sup, sub = _math_tokens(sups) if sups else '', _math_tokens(subs) if subs else ''
            # Scripts split by a gap still hang from the same base: one superscript and one subscript per base.
            if tokens and tokens[-1][0] == 'm' and len(tokens[-1]) > 5:
                old = tokens.pop()[5]
                sup, sub = ' '.join(x for x in (old[0], sup) if x), ' '.join(x for x in (old[1], sub) if x)
            elif prev is not None and it.x0 - prev.x1 > 0.3 * base:
                tokens.append(('s',))
            latex = ('^{' + sup + '}' if sup else '') + ('_{' + sub + '}' if sub else '')
            tokens.append(('m', latex, True, items[k].bold, None, (sup, sub)))
            prev = max(items[k:j], key=lambda i: i.x1)
            k = j
            continue
        if it.latex is None and it.text in COMBINING and (it.math or force_math) and k + 1 < len(items) and items[k + 1].latex is None and items[k + 1].x0 - 0.5 <= it.cx <= items[k + 1].x1 + 0.5 and (prev is None or not (prev.x0 - 0.5 <= it.cx <= prev.x1 + 0.5)):
            # TeX sets an accent before the letter it sits on: wrap the next glyph.
            nxt = items[k + 1]
            if prev is not None and _gap_is_space(prev, nxt):
                tokens.append(('s',))
            inner = math_char(nxt.text, nxt.mathit or not nxt.math).replace(UPRIGHT, '').strip()
            tokens.append(('m', '\\' + COMBINING[it.text] + '{' + inner + '}', True, False))
            prev = nxt
            k += 2
            continue
        if it.latex is None and it.text in COMBINING and (it.math or force_math):
            # An accent glyph follows the letter it sits on (possibly after what looks like a gap).
            while tokens and tokens[-1][0] == 's':
                tokens.pop()
            if tokens and tokens[-1][0] in ('m', 't'):
                last = tokens.pop()
                inner = last[1] if last[0] == 'm' else math_char(last[1].text)
                accent = '\\' + COMBINING[it.text] + '{'
                tokens.append(last if last[0] == 'm' and inner.startswith(accent) else ('m', accent + inner.replace(UPRIGHT, '').strip() + '}', True, False))
            prev = it
            k += 1
            continue
        if prev is not None and _gap_is_space(prev, it):
            tokens.append(('s',))
        if it.latex is not None:
            tokens.append(('m', it.latex, True, False))
        elif it.math or force_math:
            ch = it.text
            if ch in COMBINING and tokens and tokens[-1][0] in ('m', 't'):
                last = tokens.pop()
                inner = last[1] if last[0] == 'm' else math_char(last[1].text)
                tokens.append(('m', '\\' + COMBINING[ch] + '{' + inner.strip() + '}', True, False))
            elif it.math and it.big:
                tokens.append(('m', BIG + BRACKETS[ch], True, False))
            elif it.math:
                tokens.append(('m', math_char(ch, it.mathit), ch.isalpha() or not ch.isascii() and unicodedata.category(ch)[0] == 'L', it.bold, ch))
            else:
                tokens.append(('t', it))
        else:
            tokens.append(('t', it))
        prev = it
        k += 1

    # 2. Group into math runs and text runs.
    out = []  # (is_math, text, bold)
    n = 0
    while n < len(tokens):
        tok = tokens[n]
        if tok[0] == 's':
            out.append((False, ' ', False))
            n += 1
            continue
        if tok[0] == 't' and not force_math:
            j = n
            buf = ''
            bold = tok[1].bold
            while j < len(tokens) and tokens[j][0] == 't' and tokens[j][1].bold == bold:
                buf += tokens[j][1].text
                j += 1
            out.append((False, md_escape(fix_text(buf)), bold))
            n = j
            continue
        # A math run: math atoms, the spaces between them, and (inside forced math) text glyphs as \text{}.
        j = n
        parts = []
        letters = False
        raw = ''
        while j < len(tokens):
            t = tokens[j]
            if t[0] == 'm':
                parts.append(t[1])
                letters = letters or t[2]
                raw += t[4] if len(t) > 4 and t[4] else '\x00'
            elif t[0] == 's':
                # Keep going only if math continues after the space.
                nxt = tokens[j + 1] if j + 1 < len(tokens) else None
                if nxt is None or not (nxt[0] == 'm' or (force_math and nxt[0] == 't') or (nxt[0] == 't' and _word_in_math(tokens, j + 1, parts))):
                    break
                parts.append(' ')
                raw += ' '
            elif not force_math:
                # A word or two of ordinary text inside a formula ("exp", "offer - bid") stays in the formula.
                hit = _word_in_math(tokens, j, parts)
                if not hit:
                    break
                parts.append(r'\text{' + hit[0] + '}')
                letters = True
                raw += '\x00'
                j = hit[1]
                continue
            elif force_math:
                # Text-font glyphs inside a math structure: collect the run as \text{...}.
                jj = j
                buf = ''
                while jj < len(tokens) and (tokens[jj][0] == 't' or (tokens[jj][0] == 's' and jj + 1 < len(tokens) and tokens[jj + 1][0] == 't')):
                    buf += ' ' if tokens[jj][0] == 's' else tokens[jj][1].text
                    jj += 1
                parts.append(_text_in_math(fix_text(buf)))
                letters = True
                raw += '\x00'
                j = jj
                continue
            else:
                break
            j += 1
        latex = _tidy_math(parts)
        if force_math:
            out.append((True, latex, False))
        elif not letters and '\x00' not in raw:
            # Plain arithmetic set in the math font: keep it as text so numbers read the same everywhere.
            out.append((False, md_escape(raw), False))
        else:
            out.append((True, latex, False))
        n = j

    if force_math:
        return (''.join(t for _, t, _ in out).strip(), '', '')

    # 3. Join, wrapping math in $ and bold runs in **.
    text = ''
    rest = ''
    bold_prefix = ''
    seen_non_bold = False
    for is_math, t, bold in out:
        if is_math:
            piece = '$' + t + '$'
        elif bold and t.strip():
            piece = '**' + t.strip() + '**'
            if t.startswith(' '):
                piece = ' ' + piece
            if t.endswith(' '):
                piece += ' '
        else:
            piece = t
        if not seen_non_bold:
            if bold and not is_math:
                bold_prefix += t
            elif t.strip() or is_math:
                seen_non_bold = True
            elif bold_prefix:
                bold_prefix += t
        if seen_non_bold:
            rest += piece
        text += piece

    def tidy(x):
        return re.sub(r' {2,}', ' ', re.sub(r'\*\*\s*\*\*', ' ', x)).strip()

    return (tidy(text), _unescape(bold_prefix).strip(), tidy(rest))


_FUNCTION_WORDS = {'exp', 'ln', 'log', 'max', 'min', 'Var', 'Cov', 'var', 'cov', 'E', 'N', 'Pr', 'P', 'VaR', 'ES', 'se', 'SE', 'Corr', 'corr', 'PV', 'FV'}
_OPEN_ENDS = ('=', '+', '-', '\\times ', '\\cdot ', '/', '(', '[', '\\{', '<', '>', '\\le ', '\\ge ', '\\approx ')
_CLOSE_STARTS = (')', ']', '\\}', '^', '_', '=', '\\times', '/')


def _word_in_math(tokens: list, j: int, parts: list):
    """If the text glyphs starting at tokens[j] are a short word that belongs inside the surrounding formula,
    returns (word, index after it); else None. The formula must continue after the word."""
    jj = j
    buf = ''
    while jj < len(tokens) and (tokens[jj][0] == 't' or (tokens[jj][0] == 's' and jj + 1 < len(tokens) and tokens[jj + 1][0] == 't')):
        buf += ' ' if tokens[jj][0] == 's' else tokens[jj][1].text
        jj += 1
    kk = jj + 1 if jj < len(tokens) and tokens[jj][0] == 's' else jj
    nxt = tokens[kk] if kk < len(tokens) else None
    word = fix_text(buf).strip()
    if nxt is None or nxt[0] != 'm' or not re.fullmatch(r'[A-Za-z][A-Za-z\-‑]{0,13}( [A-Za-z\-‑]{1,10})?', word):
        return None
    last = next((p for p in reversed(parts) if p.strip()), '')
    opened = last.endswith(_OPEN_ENDS) or (last.startswith(BIG) and last[1:] in OPENERS)
    after = nxt[1]
    closes = after.lstrip().startswith(_CLOSE_STARTS) or (after.startswith(BIG) and after[1:] not in OPENERS)
    applies = word in _FUNCTION_WORDS and (after.lstrip().startswith(('(', '[')) or (after.startswith(BIG) and after[1:] in OPENERS))
    if not (opened or closes or applies):
        return None
    return (word.replace('‑', '-'), jj)


def _unescape(text: str) -> str:
    return re.sub(r'\\([\\`*_~$|<\[\]])', r'\1', text)


def _text_in_math(buf: str) -> str:
    buf = buf.strip().replace('‑', '-')
    if re.fullmatch(r'[\d.,]+', buf):
        return buf.replace(',', '{,}')
    esc = buf.replace('\\', r'\textbackslash ').replace('%', r'\%').replace('$', r'\$').replace('&', r'\&').replace('#', r'\#').replace('_', r'\_').replace('{', r'\{').replace('}', r'\}').replace('^', r'\^{}').replace('~', r'\~{}')
    return r'\text{' + esc + '}'


def _tidy_math(parts: list) -> str:
    """Joins math atoms: upright letter runs become \\text{...} or operator names, big bracket pairs get \\left \\right."""
    out = []
    k = 0
    while k < len(parts):
        p = parts[k]
        if len(p) == 2 and p[0] == UPRIGHT:
            j = k
            word = ''
            while j < len(parts) and len(parts[j]) == 2 and parts[j][0] == UPRIGHT:
                word += parts[j][1]
                j += 1
            if len(word) == 1:
                out.append(r'\mathrm{' + word + '}')
            elif word in OPERATOR_NAMES:
                out.append('\\' + word + ' ' if word not in ('cov', 'var') else r'\operatorname{' + word + '}')
            else:
                out.append(r'\text{' + word + '}')
            k = j
            continue
        if p == ',' and out and out[-1][-1:].isdigit() and k + 1 < len(parts) and parts[k + 1][:1].isdigit():
            out.append('{,}')
        else:
            out.append(p)
        k += 1
    out = _size_brackets(out)
    s = ''.join(out).replace(UPRIGHT, '')
    s = re.sub(r' {2,}', ' ', s)
    # "\alpha n" needs its space, "\times 100" too; a control word directly before a letter must stay separated.
    s = re.sub(r'(\\[a-zA-Z]+) (?=[^a-zA-Z])', r'\1', s)
    return s.strip()


def _size_brackets(parts: list) -> list:
    """Big brackets that open and close in the same run become \\left ... \\right; a lone one stays plain."""
    parts = list(parts)
    stack = []
    for n, p in enumerate(parts):
        if not p.startswith(BIG):
            continue
        b = p[1:]
        if b in OPENERS:
            stack.append(n)
        elif stack and OPENERS.get(parts[stack[-1]][1:]) == b:
            o = stack.pop()
            parts[o] = '\\left' + parts[o][1:]
            parts[n] = '\\right' + b
    return [p[1:] if p.startswith(BIG) else p for p in parts]


def fix_text(text: str) -> str:
    """Composes accents and repairs UTF-8 that a source typeset as Windows-1252 ("Ïƒ" for σ, "âˆ’" for −)."""
    text = unicodedata.normalize('NFC', text)
    if not re.search('[ÃÂÎÏâ]', text):
        return text

    def decode(m):
        try:
            return m.group(0).encode('cp1252').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            return m.group(0)

    return re.sub('[ÃÂÎÏ][\u0080-\u00ff\u0152-\u2122]|â[\u0080-\u00ff\u0152-\u2122]{2}', decode, text)


# ---------------------------------------------------------------------------------------------------------------
# Rules -> roots and fractions.

RADICALS = {'√', '√'}


def _is_radical(item: Item) -> bool:
    return item.latex is None and item.text.startswith('√')


def build_structures(items: list, rules: list) -> tuple:
    """Turns square-root bars and fraction bars into single items. Returns (items, rules left over)."""
    left = []
    # Glyphs stacked on or under some bar: they never count as "the line beside" another bar.
    stacked = set()
    for r in rules:
        if any(_is_radical(it) and abs(it.x1 - r['x0']) < 0.9 and it.top - 26 < r['y'] < it.bottom + 2 for it in items):
            continue
        span = [it for it in items if r['x0'] - 1.2 <= it.cx <= r['x1'] + 1.2]
        stacked.update(id(i) for i in _stack(span, r['y'], above=True) + _stack(span, r['y'], above=False))
    for r in sorted(rules, key=lambda r: r['x1'] - r['x0']):
        if not _consume_rule(items, r, stacked):
            left.append(r)
    return items, left


def _consume_rule(items: list, r: dict, stacked: set = frozenset()) -> bool:
    y, x0, x1 = r['y'], r['x0'], r['x1']
    # Square root: the bar starts where a radical sign ends. Fonts report the sign's box differently (level with
    # the bar, or hanging from it), so the bar may sit anywhere from above the box to just under its bottom.
    # The sign ends exactly where its bar starts, which is what tells it from the sign on the next line.
    cands = [it for it in items if _is_radical(it) and abs(it.x1 - x0) < 0.9 and it.top - 26 < y < it.bottom + 2]
    rad = min(cands, key=lambda it: (round(abs(it.x1 - x0), 1), abs(y - it.top))) if cands else None
    if rad is not None:
        # The radicand is the first line of glyphs under the bar, with their scripts. A tall radical's bar sits well
        # above that line, and glyph boxes are a full em high (they may poke above a low bar): go by centres.
        under = [it for it in items if it is not rad and x0 - 0.6 <= it.cx <= x1 + 0.6 and (it.top + it.bottom) / 2 > y + 0.5 and it.top < y + 26]
        inside = []
        if under:
            def line_top(it):
                return it.anchor - it.size / 2 if it.latex is not None and it.anchor is not None else it.top

            # The line nearest the bar (a root inside an exponent has the next text line under it too).
            nearest = min(line_top(i) for i in under)
            line = [i for i in under if line_top(i) <= nearest + 6]
            size = max(i.size for i in line)
            first = min(line_top(i) for i in line if i.size >= 0.9 * size)
            inside = [it for it in under if first - 0.6 * size <= line_top(it) <= first + 0.85 * size]
        if inside:
            comp = Item(
                x0=rad.x0, x1=max(x1, max(i.x1 for i in inside)), top=y, bottom=max(i.bottom for i in inside),
                size=max(i.size for i in inside), latex=r'\sqrt{' + _math_tokens(inside) + '}', math=True,
                anchor=statistics.median(i.cy for i in inside),
            )
            for it in inside + [rad]:
                items.remove(it)
            items.append(comp)
            return True
        return False
    # Fraction: glyphs sitting on the bar and hanging under it.
    span = [it for it in items if x0 - 1.2 <= it.cx <= x1 + 1.2]
    den = _stack(span, y, above=False)
    num = _stack(span, y, above=True)
    if den and not _own_numerator(items, num, x0, x1):
        # A bar over glyphs that stand on the line like their neighbours is an overline (a mean), not a fraction.
        lo, hi = min(i.top for i in den), max(i.bottom for i in den)
        size = max(i.size for i in den)
        ids = {id(i) for i in span}
        beside = [
            it for it in items
            if id(it) not in ids and id(it) not in stacked and it.latex is None and 0.9 * size <= it.size <= 1.15 * size
            and it.text not in '∑∏∫'
            and (0 <= x0 - it.x1 < 40 or 0 <= it.x0 - x1 < 40)
            and min(it.bottom, hi) - max(it.top, lo) > 0.5 * (it.bottom - it.top)
        ]
        if beside:
            line_cy = statistics.median((i.top + i.bottom) / 2 for i in beside)
            den_cy = statistics.median((i.top + i.bottom) / 2 for i in den if i.latex is None) if any(i.latex is None for i in den) else line_cy + 9
            if line_cy - y > 3.5 and abs(den_cy - line_cy) < 2.2:
                comp = Item(
                    x0=min(i.x0 for i in den), x1=max(i.x1 for i in den), top=y, bottom=hi, size=size,
                    latex=r'\overline{' + _math_tokens(den) + '}', math=True, anchor=line_cy,
                )
                for it in den:
                    items.remove(it)
                items.append(comp)
                return True
    if num and den:
        size = max(i.size for i in num + den)
        comp = Item(
            x0=min(x0, min(i.x0 for i in num + den)), x1=max(x1, max(i.x1 for i in num + den)),
            top=min(i.top for i in num), bottom=max(i.bottom for i in den), size=size,
            latex=r'\frac{' + _math_tokens(num) + '}{' + _math_tokens(den) + '}', math=True,
            # The bar sits on the math axis, about a quarter em above the baseline; lines are clustered on centres.
            anchor=y - 0.02 * size,
        )
        for it in num + den:
            items.remove(it)
        items.append(comp)
        return True
    return False


def _own_numerator(items: list, num: list, x0: float, x1: float) -> bool:
    """True when the glyphs above a bar are a numerator of that bar, rather than a piece of the text line above
    that the bar happens to lie under (then a word is cut at an end of the bar)."""
    if not num:
        return False
    lo, hi = min(i.top for i in num), max(i.bottom for i in num)
    left, right = min(i.x0 for i in num), max(i.x1 for i in num)
    ids = {id(i) for i in num}
    for it in items:
        if id(it) in ids or it.latex is not None:
            continue
        if min(it.bottom, hi) - max(it.top, lo) < 0.6 * (it.bottom - it.top):
            continue
        if -0.6 <= left - it.x1 < 1.0 or -0.6 <= it.x0 - right < 1.0:
            return False
    return True


def _stack(span: list, y: float, above: bool) -> list:
    """Glyphs forming the numerator (above) or denominator of the bar at height y."""
    if above:
        seeds = [it for it in span if y - 5.2 <= it.bottom <= y + 1.0]
    else:
        seeds = [it for it in span if y - 1.0 <= it.top <= y + 5.2]
    if not seeds:
        return []
    lo, hi = min(i.top for i in seeds), max(i.bottom for i in seeds)
    grown = list(seeds)
    for it in span:
        if it in grown:
            continue
        if above and it.bottom > y + 1.0 or not above and it.top < y - 1.0:
            continue
        overlap = min(it.bottom, hi) - max(it.top, lo)
        if overlap > 0.5 * (it.bottom - it.top) and it.size <= max(i.size for i in seeds) * 1.05:
            grown.append(it)
    return grown


# ---------------------------------------------------------------------------------------------------------------
# Items -> lines.


def cluster_lines(items: list) -> list:
    """Groups items into text lines (top to bottom). Scripts and inline fractions stay with the line they belong to."""
    if not items:
        return []
    big = sorted((i for i in items if i.size >= 8.4 or i.latex is not None), key=lambda i: i.cy)
    small = [i for i in items if not (i.size >= 8.4 or i.latex is not None)]
    rows = []
    for it in big:
        if rows and abs(it.cy - rows[-1]['cy']) < 4.2:
            rows[-1]['items'].append(it)
            glyphs = [i.cy for i in rows[-1]['items'] if i.latex is None] or [i.cy for i in rows[-1]['items']]
            rows[-1]['cy'] = statistics.median(glyphs)
        else:
            rows.append({'items': [it], 'cy': it.cy})
    loose = []
    for it in small:
        best = None
        for row in rows:
            d = abs(it.cy - row['cy'])
            if d < 6.6 and (best is None or d < best[0]):
                # A small glyph on the row's own baseline belongs to it (a right-aligned tag); one that is raised or
                # lowered belongs only if the row has glyphs near it horizontally (a script).
                near = d < 2.0 or any(abs(o.x1 - it.x0) < 40 or abs(it.x1 - o.x0) < 40 or (o.x0 <= it.cx <= o.x1) for o in row['items'] if o is not it)
                if near:
                    best = (d, row)
        if best:
            best[1]['items'].append(it)
        else:
            loose.append(it)
    small_rows = []
    for it in sorted(loose, key=lambda i: i.cy):
        if small_rows and abs(it.cy - small_rows[-1]['cy']) < 2.6:
            small_rows[-1]['items'].append(it)
            small_rows[-1]['cy'] = statistics.median(i.cy for i in small_rows[-1]['items'])
        else:
            small_rows.append({'items': [it], 'cy': it.cy})
    kept = []
    for sr in small_rows:
        sx0, sx1 = min(i.x0 for i in sr['items']), max(i.x1 for i in sr['items'])
        host = None
        if sx1 - sx0 < 80:
            for row in rows:
                if abs(sr['cy'] - row['cy']) < 11 and any(
                    -2.5 <= sx0 - o.x1 <= 6 and o.top - 8 <= sr["cy"] <= o.bottom + 3
                    and (o.big or o.latex is not None or o.bottom - o.top > 13 or (sx1 - sx0 < 30 and sx0 - o.x1 <= 3))
                    for o in row['items']
                ):
                    host = row
                    break
        if host:
            host['items'] += sr['items']
        else:
            kept.append(sr)
    small_rows = kept
    lines = []
    for row in rows + small_rows:
        its = row['items']
        base, _ = _row_metrics(its)
        text, bold_prefix, rest = _render(its)
        first = min(its, key=lambda i: i.x0)
        lines.append(
            Line(
                items=its, x0=min(i.x0 for i in its), x1=max(i.x1 for i in its), top=min(i.top for i in its),
                bottom=max(i.bottom for i in its), size=base, text=text, bold_prefix=bold_prefix, rest=rest, color=first.color,
            )
        )
    lines.sort(key=lambda l: (l.top + l.bottom) / 2)
    return lines


# ---------------------------------------------------------------------------------------------------------------
# Ruled tables.


#: Line widths (pt) of the bars the math font draws; set per document family before reading pages.
MATH_RULE = (0.55, 0.75)


def find_tables(rules: list) -> list:
    """Ruled (booktabs) tables: a thick rule on top, thin rules inside, a thick rule at the bottom, all the same
    width. Returns bboxes, top to bottom."""
    groups = {}
    for r in rules:
        # Fraction and root bars are drawn at the math font's rule thickness; table rules are thicker or thinner.
        if MATH_RULE[0] <= r['w'] <= MATH_RULE[1]:
            continue
        groups.setdefault((round(r['x0']), round(r['x1'])), []).append(r)
    tables = []
    for (x0, x1), rs in groups.items():
        if len(rs) < 2 or x1 - x0 < 30:
            continue
        rs = sorted(rs, key=lambda r: r['y'])
        thick = max(r['w'] for r in rs) * 0.8
        if all(r['w'] >= thick for r in rs):
            # No thin rules to tell top from bottom: consecutive pairs.
            runs = [rs[k:k + 2] for k in range(0, len(rs) - 1, 2)]
        else:
            runs, cur = [], None
            for r in rs:
                if cur is None:
                    if r['w'] >= thick:
                        cur = [r]
                    continue
                cur.append(r)
                if r['w'] >= thick:
                    runs.append(cur)
                    cur = None
        for run in runs:
            ys = [r['y'] for r in run]
            tables.append({'x0': x0 - 1.5, 'x1': x1 + 1.5, 'top': ys[0], 'bottom': ys[-1], 'rules': ys})
    return sorted(tables, key=lambda t: t['top'])


def JOIN(a: str, b: str) -> str:
    """Joins two lines of one table cell; extractors replace it with a hyphenation-aware join."""
    return a + ' ' + b


def table_markdown(items: list, table: dict) -> tuple:
    """Pipe table for the items inside a ruled table. Returns (markdown, flags)."""
    flags = []
    lines = cluster_lines(items)
    if not lines:
        return ('', ['empty-table'])
    rows = []
    for ln in lines:
        its = sorted(ln.items, key=lambda i: i.x0)
        cells = [[its[0]]]
        for prev, cur in zip(its, its[1:]):
            if cur.x0 - max(i.x1 for i in cells[-1]) > 0.62 * ln.size:
                cells.append([cur])
            else:
                cells[-1].append(cur)
        rows.append({'cy': (ln.top + ln.bottom) / 2, 'cells': cells})
    # Columns: connected groups of cells that overlap horizontally.
    spans = sorted(((min(i.x0 for i in c), max(i.x1 for i in c)) for r in rows for c in r['cells']))
    cols = []
    for a, b in spans:
        if cols and a < cols[-1][1] - 0.5:
            cols[-1][1] = max(cols[-1][1], b)
        else:
            cols.append([a, b])
    grid = []
    for r in rows:
        out = [''] * len(cols)
        for c in r['cells']:
            a, b = min(i.x0 for i in c), max(i.x1 for i in c)
            k = max(range(len(cols)), key=lambda n: min(b, cols[n][1]) - max(a, cols[n][0]))
            text = _render(c)[0].replace('|', r'\|')
            out[k] = (out[k] + ' ' + text).strip()
        grid.append((r['cy'], out))
    # A row holding text in one column only, under a row that has that column filled, is that cell's next line.
    merged_rows = []
    for cy, out in grid:
        filled = [k for k, v in enumerate(out) if v]
        if merged_rows and len(cols) > 1 and len(filled) == 1 and filled[0] > 0 and merged_rows[-1][1][filled[0]]:
            k = filled[0]
            merged_rows[-1][1][k] = JOIN(merged_rows[-1][1][k], out[k])
        else:
            merged_rows.append((cy, out))
    grid = merged_rows
    inner = [y for y in table['rules'][1:-1]]
    header_end = inner[0] if inner else None
    head = [g for g in grid if header_end is not None and g[0] < header_end]
    body = [g for g in grid if not (header_end is not None and g[0] < header_end)]
    if not head and len(grid) > 1:
        # No rule under a first row: the table has no header (markdown still needs the row, so it is left blank).
        head = [(grid[0][0], [''] * len(cols))]
    elif not head:
        head, body = body[:1], body[1:]
    if len(head) > 1:
        # A header set on two lines: stack the pieces of each column.
        merged = [' '.join(x for x in col if x) for col in zip(*[h[1] for h in head])]
        head = [(head[0][0], merged)]
    if not body:
        # One ruled row of values (a list of returns): wide spaces keep them apart and let them wrap on a phone.
        return ('\u2003'.join(x for x in head[0][1] if x), flags)
    md = ['| ' + ' | '.join(head[0][1]) + ' |', '|' + '---|' * len(cols)]
    md += ['| ' + ' | '.join(g[1]) + ' |' for g in body]
    if any(not g[1][0] for g in body) and len(cols) > 1:
        flags.append('table-row-without-first-cell')
    return ('\n'.join(md), flags)


# ---------------------------------------------------------------------------------------------------------------
# Whole page.


def page_lines(page, cid_text: dict, unknown: dict | None = None, box_kind=None, clip: tuple = (40.0, 800.0), flag_cids: dict | None = None) -> list:
    """Lines of a page, top to bottom, with tables as single 'table' lines.

    `box_kind(frame) -> str` names a frame from its stroke colour; `clip` is the (top, bottom) band holding the
    body (running head and page number lie outside); `flag_cids` maps (font, cid) of glyphs that mark a layout
    needing a human look (matrix brackets) to the flag put on nearby lines.
    """
    items = [i for i in load_items(page, cid_text, unknown, keep_empty=True) if clip[0] <= (i.top + i.bottom) / 2 <= clip[1]]
    # Layouts the line model cannot express: a bracket spanning stacked rows (matrix, cases), an under/over-brace.
    special = [(i.cy, 'brace') for i in items if not i.text]
    for c in page.chars if flag_cids else []:
        m = _CID.match(c['text'])
        if m and (_font(c['fontname']), int(m.group(1))) in flag_cids:
            special.append(((c['top'] + c['bottom']) / 2, flag_cids[(_font(c['fontname']), int(m.group(1)))]))
    items = [i for i in items if i.text]
    rules = [r for r in horizontal_rules(page) if clip[0] <= r['y'] <= clip[1]]
    tables = find_tables(rules)
    table_ys = {round(y, 1) for t in tables for y in t['rules']}
    other = [r for r in rules if not (round(r['y'], 1) in table_ys and any(abs(r['x0'] - (t['x0'] + 1.5)) < 1.5 for t in tables))]
    out = []
    for t in tables:
        inside = [i for i in items if t['top'] - 1 <= i.cy <= t['bottom'] + 1 and t['x0'] - 3 <= i.cx <= t['x1'] + 3]
        for i in inside:
            items.remove(i)
        inside, _ = build_structures(inside, [r for r in other if t['top'] <= r['y'] <= t['bottom']])
        md, flags = table_markdown(inside, t)
        out.append(Line(items=[], x0=t['x0'], x1=t['x1'], top=t['top'], bottom=t['bottom'], size=9.0, text=md, kind='table', flags=flags))
    other = [r for r in other if not any(t['top'] <= r['y'] <= t['bottom'] and t['x0'] <= r['x0'] <= t['x1'] for t in tables)]
    items, left = build_structures(items, other)
    lines = cluster_lines(items) + out
    lines.sort(key=lambda l: (l.top + l.bottom) / 2)
    fr = frames(page) if box_kind else []
    for ln in lines:
        ln.page = page.page_number
        for y, name in special:
            if ln.top - 14 <= y <= ln.bottom + 14 and name not in ln.flags:
                ln.flags.append(name)
        if left:
            near = [r for r in left if ln.top - 2 <= r['y'] <= ln.bottom + 2 and ln.x0 - 2 <= r['x0'] <= ln.x1 + 2]
            if near:
                ln.flags.append('unused-rule')
        cy = (ln.top + ln.bottom) / 2
        for f in fr:
            if f['top'] - 1 <= cy <= f['bottom'] + 1:
                kind = box_kind(f)
                if kind:
                    ln.box = kind
                    break
    return lines
