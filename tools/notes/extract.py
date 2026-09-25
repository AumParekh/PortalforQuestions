#!/usr/bin/env python3
"""Deterministic extraction of the FRM Part II LaTeX notes into content/games/game-blocks.json.

Part A (Phases 2-6) of docs/notes-games-brief.md, with the overrides recorded in PORTAL_PLAN.md
section 3c and the Phase 1 audit rules (listed in docs/extraction-coverage.md section 6.6).

Pure Python 3 standard library. Same sources in -> byte-identical output out (apart from the
`generated` timestamp, which --generated pins).

    python3 tools/notes/extract.py                      # write JSON + coverage report
    python3 tools/notes/extract.py --only 01_LR_LTR1.tex  # one reading's JSON to stdout
    python3 tools/notes/extract.py --generated 2026-01-01T00:00:00Z
"""
import argparse
import bisect
import datetime
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
NOTES = os.path.join(ROOT, 'notes')
VOLS = ['FRM_Consolidated_Vol1', 'FRM_Consolidated_Vol2']
OUT_JSON = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')
OUT_MD = os.path.join(ROOT, 'docs', 'extraction-coverage.md')
VERSION = '1.0.0'

AREA_OF = {'LR': 'LTR', 'MR': 'MR', 'IM': 'IM', 'OR': 'ORR', 'CR': 'CR', 'CI': 'CI'}
AREA_ORDER = ['MR', 'CR', 'ORR', 'LTR', 'IM', 'CI']
EXPECTED = OrderedDict([('MR', 18), ('LTR', 17), ('IM', 17), ('ORR', 24), ('CR', 23), ('CI', 8)])
BLOCK_TYPES = ['keybox', 'trapbox', 'defbox', 'fmlbox', 'exbox', 'gapbox', 'figcap', 'table',
               'prose_para', 'tikzpicture', 'notebox']
CATEGORIES = ['Polarity', 'Sibling', 'Role', 'Sign', 'Scope', 'Definition', 'Formula',
              'Intermediate result', 'Sequence']
SUBITEM_KEYS = ['terms', 'bold_claims', 'numeric_items', 'bullets', 'variables', 'cross_refs']
SUBITEM_TAG = {'terms': 'term', 'bold_claims': 'bold_claim', 'numeric_items': 'numeric_item',
               'bullets': 'bullet', 'variables': 'variable', 'cross_refs': 'cross_ref',
               'table_rows': 'table_row'}

# ----------------------------------------------------------------------------- alias map
BOX_ENVS = {}
for _t, _envs in [
    ('keybox', ['keybox', 'mrkeybox', 'imkeybox', 'crkeybox', 'lrkeybox', 'orkeybox', 'cikeybox']),
    ('trapbox', ['trapbox', 'trapboxnb', 'mrtrapbox', 'imtrapbox', 'crtrapbox', 'lrtrapbox',
                 'lrtrapboxnb', 'citrapbox']),
    ('defbox', ['defbox', 'mrdefbox', 'imdefbox', 'crdefbox', 'ordefbox', 'lrdefbox', 'cidefbox']),
    ('fmlbox', ['fmlbox', 'mrfmlbox', 'imfmlbox', 'crfmlbox', 'orfmlbox', 'lrfmlbox']),
    ('exbox', ['exbox', 'mrexbox', 'imexbox', 'crexbox', 'orexambox', 'lrexbox']),
    ('gapbox', ['gapbox', 'mrgapbox', 'imgapbox', 'crgapbox', 'orgapbox', 'lrgapbox']),
    ('notebox', ['ornotebox']),
    ('srcbox', ['cisrcbox']),
]:
    for _e in _envs:
        BOX_ENVS[_e] = _t
MANDATORY_TITLE = {'ordefbox', 'ornotebox', 'orexambox'}
KEYLIST_PREFIX = ('mr', 'im', 'ci')
LR_DEFAULT_TITLE = {'lrdefbox': 'Definition', 'lrkeybox': 'Key facts', 'lrtrapbox': 'Exam trap',
                    'lrtrapboxnb': 'Exam trap', 'lrexbox': 'Worked example',
                    'lrgapbox': 'What the objective asks for', 'lrfmlbox': 'Formula'}
CONTAINER_ENVS = {'center', 'minipage', 'cifigblock', 'flushleft', 'flushright', 'figure', 'table',
                  'adjustwidth'}
LIST_ENVS = {'itemize', 'enumerate', 'lettered', 'checks', 'description'}
TABLE_ENVS = {'tabularx', 'tabular', 'longtable', 'tabular*'}
MATH_ENVS = {'align*', 'align', 'equation', 'equation*', 'gather', 'gather*', 'multline*',
             'aligned', 'bmatrix', 'pmatrix', 'array', 'cases', 'split', 'matrix'}
TEXT_ENVS = {'tabbing'}
TIKZ_INNER = {'axis', 'scope'}
KNOWN_ENVS = (set(BOX_ENVS) | CONTAINER_ENVS | LIST_ENVS | TABLE_ENVS | MATH_ENVS | TEXT_ENVS
              | TIKZ_INNER | {'tikzpicture', 'document'})
ENV_ARGS = {'minipage': 'om', 'tabularx': 'mm', 'tabular': 'om', 'tabular*': 'mom', 'longtable': 'om',
            'itemize': 'o', 'enumerate': 'o', 'lettered': 'o', 'checks': 'o', 'description': 'o',
            'tikzpicture': 'o', 'axis': 'o', 'scope': 'o', 'array': 'm', 'adjustwidth': 'mm',
            'figure': 'o', 'table': 'o'}

# ----------------------------------------------------------------------------- traps
CATMAP = {
    'polarity': 'Polarity', 'sibling': 'Sibling', 'role': 'Role', 'sign': 'Sign', 'scope': 'Scope',
    'definition': 'Definition', 'formula': 'Formula', 'intermediate result': 'Intermediate result',
    'intermediate results': 'Intermediate result', 'sequence': 'Sequence',
    'calculation': 'Formula', 'input twin': 'Sibling', 'confidence twin': 'Sibling',
    'ordering': 'Sequence', 'polarity / role': 'Polarity', 'polarity/role': 'Polarity',
    'number': 'Formula', 'units': 'Formula', 'unit': 'Formula', 'magnitude': 'Formula',
    'approximation': 'Formula', 'ranking': 'Sequence', 'direction': 'Polarity',
    'notation': 'Definition', 'source': '#SOURCE', 'numbering': '#SOURCE',
}
TITLE_CAT_RE = re.compile(r'^(Polarity|Sibling|Role|Sign|Scope|Definition|Formula|Sequence|'
                          r'Intermediate results?)\s*(?:[:.]|---|--|—|–)', re.I)
CONTENT_LIST_RE = re.compile(r'^(limitations?\b|its drawbacks|drawbacks|problems with|issues with|'
                             r'restrictions on|model \d+ effectiveness)', re.I)

# ----------------------------------------------------------------------------- meta / source notes
META_TITLE_RE = re.compile(
    r'label collision|ordering note|note on ordering|ordering and stale|stale wording|numbering|'
    r'renumber|reconciliation record|^correction|the correction|single-layer reading|'
    r'notation warning|objectives, not|off-syllabus|what the source notes carry|'
    r"source notes'? own guidance|labelling note|where this page came from|two layers|three copies|"
    r'^source note$|^about this chapter$|title carries no|thinnest reading in the source|'
    r'missing from the source notes|source notes lost|the source notes lost|in the source notes',
    re.I)
META_BODY_RE = re.compile(r'crash layer|lecture layer|reconciliation record', re.I)
CORRECTION_TITLE_RE = re.compile(r'^(a )?correction|^the correction', re.I)

# ----------------------------------------------------------------------------- retyping
OREXAM_KEYBOX_RE = re.compile(r'^(new )?decision rule|^lessons?\b|^the takeaway|^strengths|'
                              r'^reading the table', re.I)
# Audit-decided orkeybox -> defbox cases that carry no rust "E.g." aside (reading, hand title).
ORKEY_DEFBOX_EXTRA = {('ORR-11', 'Internal versus external fraud'), ('ORR-13', 'Motivations'),
                      ('ORR-16', 'Model Risk Management (MRM) team')}
NOTEBOX_SUBTYPE = [
    (re.compile(r'^remember', re.I), 'remember'),
    (re.compile(r'^outcome', re.I), 'outcome'),
    (re.compile(r'^(source note|about this chapter)', re.I), 'source'),
    (re.compile(r'weakness|limitation|challenge|shortcoming', re.I), 'list'),
    (re.compile(r'^(equity and commodity|backtesting requirement|data requirement|also worth knowing|'
                r'modeling revenues)', re.I), 'fact'),
    (re.compile(r'^note\b', re.I), 'note'),
]

# ----------------------------------------------------------------------------- cases
CASES = OrderedDict([
    ('Lehman Brothers', r'\bLehman\b'),
    ('Bear Stearns', r'\bBear Stearns\b'),
    ('LTCM', r'\bLTCM\b|Long[- ]Term Capital'),
    ('Archegos', r'\bArchegos\b'),
    ('Madoff', r'\bMadoff\b'),
    ('Northern Rock', r'\bNorthern Rock\b'),
    ('Ashanti Goldfields', r'\bAshanti\b'),
    ('Metallgesellschaft', r'\bMetallgesellschaft\b'),
    ('Barings', r'\bBarings\b'),
    ('London Whale', r'\bLondon Whale\b'),
    ('Equifax', r'\bEquifax\b'),
    ('USAA', r'\bUSAA\b'),
    ('Capital One', r'\bCapital One\b'),
    ('Enron', r'\bEnron\b'),
    ('Credit Suisse', r'\bCredit Suisse\b'),
    ('Greek debt crisis', r'\bGreece\b|\bGreek (?:debt |sovereign )?crisis\b'),
    ('AIG', r'\bAIG\b'),
    ('Amaranth', r'\bAmaranth\b'),
    ('Berkshire Hathaway', r'\bBerkshire\b|\bBuffett\b'),
    ('Russia-Ukraine', r'\bRussia\b.{0,12}\bUkraine\b|\bUkraine\b.{0,12}\bRussia'),
    ('King Bank', r'\bKing Bank\b'),
    ('Gray Sky Bank', r'\bGr[ae]y Sky Bank\b'),
    ('2007-2009 financial crisis', r'\b2007\s*(?:[-–—]+|to|/)\s*(?:20)?0[89]\b|\bglobal financial crisis\b'
                                   r'|\bfinancial crisis of 2007'),
    ('JPMorgan', r'\bJP ?Morgan\b'),
    ('Deutsche Bank', r'\bDeutsche Bank\b'),
    ('Societe Generale', r'\bSoci[ée]t[ée] G[ée]n[ée]rale\b|\\\'?\{?e\}?t'),
])
CASES['Societe Generale'] = r'\bSoci\S{0,4}t\S{0,4} G\S{0,4}n\S{0,4}rale\b'
CASE_RES = [(k, re.compile(v)) for k, v in CASES.items()]

XREF_RE = re.compile(r'(?<![A-Za-z-])(MR|LTR|IM|ORR|CR|CI)-(\d{1,2})(?![\d])(?:\s?([a-q])(?![A-Za-z]))?')
NUM_RE = re.compile(
    r'(?:\\\$|USD|EUR|GBP|CAD|CHF|JPY|€|£)\s?-?\d[\d,]*(?:\.\d+)?'
    r'(?:\s?(?:million|billion|trillion|bn|m|k)\b)?'
    r'|-?\d[\d,]*(?:\.\d+)?\s?(?:\\%|%|percent\b|per cent\b|bp\b|bps\b|basis points?\b|million\b|'
    r'billion\b|trillion\b|bn\b)')

# ----------------------------------------------------------------------------- plain-text conversion
UNWRAP1 = {'term', 'textbf', 'emph', 'textit', 'textsf', 'texttt', 'textsc', 'textnormal', 'text',
           'mbox', 'underline', 'textup', 'textmd', 'textrm', 'thd', 'thead', 'tsub', 'hdr', 'note',
           'greyline', 'gapnote', 'srcnote', 'figcap', 'orfigcap', 'uline', 'emph', 'textsl',
           'mathrm', 'mathbf', 'boxed', 'texorpdfstring', 'orsub', 'orsubb', 'subsection', 'section',
           'subsubsection', 'basics', 'vk', 'fbox', 'pgnum', 'tagword'}
UNWRAP_LAST = {'textcolor': 2, 'colorbox': 2, 'chip': 2, 'multicolumn': 3, 'raisebox': 2,
               'makebox': 1, 'parbox': 2, 'mrvk': None, 'figwrap': None}
DROP_ARGS = {'vspace': 'sm', 'hspace': 'sm', 'color': 'om', 'rowcolor': 'om', 'cellcolor': 'om',
             'arrayrulecolor': 'om', 'renewcommand': 'mm', 'setlength': 'mm', 'addlinespace': 'o',
             'fontsize': 'mm', 'label': 'm', 'needspace': 'm', 'markboth': 'mm', 'includegraphics': 'om',
             'definecolor': 'mmm', 'pgfplotsset': 'm', 'setchapctx': 'mmm', 'cmidrule': 'm',
             'phantom': 'm', 'rule': 'omm', 'linespread': 'm', 'setcounter': 'mm', 'noalign': 'm',
             'hypersetup': 'm', 'lohead': 'ommm', 'lo': 'mm', 'reading': 'mmmm', 'chapterhead': 'mmmmm',
             'newcolumntype': 'mom'}
SYMBOLS = {'euro': '€', 'texteuro': '€', 'checkmark': '✓', 'blacktriangleright': '▸', 'textbullet': '•',
           'S': '§', 'ldots': '…', 'dots': '…', 'textonehalf': '½', 'chiplow': 'Low', 'chipmod': 'Moderate',
           'chiphigh': 'High', 'chipvhigh': 'Very High', 'quad': ' ', 'qquad': ' ', 'newline': '\n',
           'par': '\n', 'smallskip': '\n', 'medskip': '\n', 'bigskip': '\n', 'tcblower': '\n',
           'item': '\n• ', 'pgdash': '–', 'textendash': '–', 'textemdash': '—', 'LaTeX': 'LaTeX',
           'enspace': ' ', 'thinspace': ' ', 'textdegree': '°', 'times': '×', 'to': '→',
           'rightarrow': '→', 'Rightarrow': '⇒', 'textasciitilde': '~', 'AA': 'Å', 'ss': 'ß'}
NOOP = {'noindent', 'centering', 'raggedright', 'raggedleft', 'small', 'footnotesize', 'scriptsize',
        'tiny', 'large', 'Large', 'LARGE', 'huge', 'normalsize', 'sffamily', 'bfseries', 'itshape',
        'mdseries', 'rmfamily', 'ttfamily', 'upshape', 'selectfont', 'tabfont', 'arraybackslash',
        'toprule', 'midrule', 'bottomrule', 'hline', 'endhead', 'endfirsthead', 'endfoot',
        'endlastfoot', 'clearpage', 'newpage', 'relax', 'displaystyle', 'textstyle', 'linewidth',
        'textwidth', 'leavevmode', 'break', 'hfill', 'vfill', 'protect', 'gapbadge', 'schweserbadge',
        'phantomsection', 'strut', 'nobreak', 'allowbreak', 'null', 'empty', 'hfil', 'kill',
        'baselineskip', 'normalfont', 'em', 'bf', 'it', 'sf', 'tt', 'scshape', 'unskip', 'ignorespaces',
        'columnwidth', 'tabcolsep', 'arraystretch', 'pagebreak', 'nopagebreak', 'filbreak',
        'hrulefill', 'dotfill', 'raggedbottom', 'onehalfspacing', 'normalcolor', 'bfseries'}
MATH_SYMBOL_SUB = {r'\blacktriangleright': '▸', r'\checkmark': '✓', r'\bullet': '•', r'\rightarrow': '→',
                   r'\Rightarrow': '⇒', r'\times': '×', r'\to': '→', r'\leftarrow': '←', r'\star': '★',
                   r'\downarrow': '↓', r'\uparrow': '↑', r'\approx': '≈', r'\leq': '≤', r'\geq': '≥',
                   r'\le': '≤', r'\ge': '≥', r'\pm': '±', '>': '>', '<': '<', r'\sim': '~',
                   r'\longrightarrow': '→', r'\Longrightarrow': '⇒', r'\leftrightarrow': '↔'}

LINE_BLANK = re.compile(r'\n[ \t]*\n')


# ============================================================================= low-level helpers
def sha12(text):
    norm = re.sub(r'\s+', ' ', text or '').strip()
    return hashlib.sha1(norm.encode('utf-8')).hexdigest()[:12]


def strip_comments(raw):
    """Remove % comments (not \\%) while keeping every newline so line numbers survive."""
    out = []
    for line in raw.split('\n'):
        i, n = 0, len(line)
        while i < n:
            c = line[i]
            if c == '\\':
                i += 2
                continue
            if c == '%':
                line = line[:i]
                break
            i += 1
        out.append(line)
    return '\n'.join(out)


def braced(s, i):
    """(content, end) of the {...} group starting at s[i] == '{'."""
    depth, j, n = 0, i, len(s)
    while j < n:
        c = s[j]
        if c == '\\':
            j += 2
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
        j += 1
    return s[i + 1:], n


def bracketed(s, i):
    """(content, end) of [...] starting at s[i] == '['; brace-aware."""
    depth, j, n = 0, i + 1, len(s)
    while j < n:
        c = s[j]
        if c == '\\':
            j += 2
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        elif c == ']' and depth == 0:
            return s[i + 1:j], j + 1
        j += 1
    return s[i + 1:], n


def read_args(s, i, spec):
    """Parse macro/env arguments. spec: o=[opt] m={mand} s=*star. Returns (args, end).
    Each arg is (content, start, end) or None when absent."""
    args = []
    j, n = i, len(s)
    for kind in spec:
        if kind == 's':
            if j < n and s[j] == '*':
                args.append(('*', j, j + 1))
                j += 1
            else:
                args.append(None)
        elif kind == 'o':
            k = j
            while k < n and s[k] in ' \t':
                k += 1
            if k < n and s[k] == '[':
                c, e = bracketed(s, k)
                args.append((c, k + 1, e - 1))
                j = e
            else:
                args.append(None)
        elif kind == 'm':
            k = j
            while k < n and s[k] in ' \t\n':
                k += 1
            if k < n and s[k] == '{':
                c, e = braced(s, k)
                args.append((c, k + 1, e - 1))
                j = e
            elif k < n and s[k] == '\\':
                m = re.match(r'\\[A-Za-z]+|\\.', s[k:])
                args.append((m.group(0), k, k + len(m.group(0))))
                j = k + len(m.group(0))
            else:
                args.append(None)
    return args, j


class Env(object):
    __slots__ = ('name', 'b0', 'b1', 'a', 'e0', 'e1', 'children', 'args')

    def __init__(self, name, b0, b1):
        self.name, self.b0, self.b1 = name, b0, b1
        self.a = b1
        self.e0 = self.e1 = None
        self.children = []
        self.args = []


BEGIN_END = re.compile(r'\\(begin|end)\s*\{([A-Za-z*]+)\}')


def parse_envs(s, anomalies=None):
    """Tree of environments (top-level list). Each env gets its argument span skipped in .a."""
    stack, top = [], []
    for m in BEGIN_END.finditer(s):
        kind, name = m.group(1), m.group(2)
        if kind == 'begin':
            stack.append(Env(name, m.start(), m.end()))
            continue
        k = len(stack) - 1
        while k >= 0 and stack[k].name != name:
            k -= 1
        if k < 0:
            if anomalies is not None:
                anomalies.append(('unmatched \\end{%s}' % name, m.start()))
            continue
        for extra in stack[k + 1:]:
            if anomalies is not None:
                anomalies.append(('unclosed \\begin{%s}' % extra.name, extra.b0))
        env = stack[k]
        del stack[k:]
        env.e0, env.e1 = m.start(), m.end()
        (stack[-1].children if stack else top).append(env)
    for env in stack:
        if anomalies is not None:
            anomalies.append(('unclosed \\begin{%s}' % env.name, env.b0))

    def fix(envs):
        envs.sort(key=lambda e: e.b0)
        for e in envs:
            spec = ENV_ARGS.get(e.name)
            if spec is None and e.name in BOX_ENVS:
                spec = 'm' if e.name in MANDATORY_TITLE else 'o'
            if spec:
                e.args, e.a = read_args(s, e.b1, spec)
            fix(e.children)
    fix(top)
    return top


ENV_OPT_RE = re.compile(r'\\begin\{([A-Za-z*]+)\}[ \t]*\[')


def mask_env_options(latex):
    """Blank the [..] option list after \\begin{env} (list labels like \\textbf{\\alph*.} are not content)."""
    spans = []
    for m in ENV_OPT_RE.finditer(latex):
        if m.group(1) in BOX_ENVS:
            continue
        _, e = bracketed(latex, m.end() - 1)
        spans.append((m.end() - 1, e))
    return mask(latex, spans)


def walk_envs(envs):
    for e in envs:
        yield e
        for x in walk_envs(e.children):
            yield x


def mask(s, spans):
    """Blank out [a,b) spans (keeping newlines) so offsets and line numbers survive."""
    if not spans:
        return s
    chars = list(s)
    for a, b in spans:
        for k in range(max(a, 0), min(b, len(chars))):
            if chars[k] != '\n':
                chars[k] = ' '
    return ''.join(chars)


def find_math_spans(s):
    """Spans of math in s: $..$, $$..$$, \\[..\\], \\(..\\), and math environments."""
    spans, i, n = [], 0, len(s)
    env_re = re.compile(r'\\begin\{(align\*?|equation\*?|gather\*?|multline\*?)\}')
    while i < n:
        c = s[i]
        if c == '\\':
            if s.startswith('\\[', i):
                e = s.find('\\]', i + 2)
                e = n if e < 0 else e + 2
                spans.append((i, e, 'display'))
                i = e
                continue
            if s.startswith('\\(', i):
                e = s.find('\\)', i + 2)
                e = n if e < 0 else e + 2
                spans.append((i, e, 'inline'))
                i = e
                continue
            m = env_re.match(s, i)
            if m:
                end_tok = '\\end{%s}' % m.group(1)
                e = s.find(end_tok, m.end())
                e = n if e < 0 else e + len(end_tok)
                spans.append((i, e, 'env'))
                i = e
                continue
            i += 2
            continue
        if c == '$':
            if s.startswith('$$', i):
                e = s.find('$$', i + 2)
                e = n if e < 0 else e + 2
                spans.append((i, e, 'display'))
                i = e
                continue
            j = i + 1
            while j < n:
                if s[j] == '\\':
                    j += 2
                    continue
                if s[j] == '$':
                    break
                j += 1
            spans.append((i, min(j + 1, n), 'inline'))
            i = j + 1
            continue
        i += 1
    return spans


# ============================================================================= plain text
class Plain(object):
    """LaTeX -> readable text. Inline math kept as $..$, display math as $$..$$; \\$ stays escaped."""

    def __init__(self):
        self.unknown = Counter()

    def __call__(self, t, cell=False):
        out = self.conv(t or '')
        out = out.replace('\r', '')
        out = re.sub(r'[ \t\u00a0]+', ' ', out)
        out = re.sub(r' *\n *', '\n', out)
        out = re.sub(r'\n{2,}', '\n', out)
        out = re.sub(r'(\n• )+(?=\n• )', '', out)
        out = re.sub(r' ([,.;:!?)])', r'\1', out)
        out = re.sub(r'\( ', '(', out)
        out = out.strip()
        if cell:
            out = re.sub(r'\s*\n\s*', ' ', out)
        return out

    def math(self, body, display):
        body = re.sub(r'\s+', ' ', body).strip()
        body = body.replace('\\euro', '\\text{€}').replace('\\texteuro', '\\text{€}')
        if not display and body in MATH_SYMBOL_SUB:
            return MATH_SYMBOL_SUB[body]
        if not body:
            return ''
        return ('$$%s$$' % body) if display else ('$%s$' % body)

    def conv(self, s):
        out = []
        i, n = 0, len(s)
        while i < n:
            c = s[i]
            if c == '$':
                if s.startswith('$$', i):
                    e = s.find('$$', i + 2)
                    e = n if e < 0 else e
                    out.append('\n' + self.math(s[i + 2:e], True) + '\n')
                    i = e + 2
                    continue
                j = i + 1
                while j < n:
                    if s[j] == '\\':
                        j += 2
                        continue
                    if s[j] == '$':
                        break
                    j += 1
                out.append(self.math(s[i + 1:j], False))
                i = j + 1
                continue
            if c == '\\':
                if i + 1 >= n:
                    i += 1
                    continue
                d = s[i + 1]
                if d == '\\':
                    j = i + 2
                    if j < n and s[j] == '*':
                        j += 1
                    k = j
                    while k < n and s[k] in ' \t':
                        k += 1
                    if k < n and s[k] == '[' and re.match(r'\[\s*-?[\d.]+\s*(pt|em|ex|mm|cm)\s*\]', s[k:]):
                        _, j = bracketed(s, k)
                    out.append('\n')
                    i = j
                    continue
                if d == '[':
                    e = s.find('\\]', i + 2)
                    e = n if e < 0 else e
                    out.append('\n' + self.math(s[i + 2:e], True) + '\n')
                    i = e + 2
                    continue
                if d == '(':
                    e = s.find('\\)', i + 2)
                    e = n if e < 0 else e
                    out.append(self.math(s[i + 2:e], False))
                    i = e + 2
                    continue
                if not d.isalpha():
                    rep = {'%': '%', '&': '&', '#': '#', '_': '_', '$': '\\$', ',': ' ', ';': ' ',
                           ':': ' ', ' ': ' ', '!': '', '{': '{', '}': '}', '-': '', '/': '', '>': ' ',
                           '=': ' ', "'": '', '`': '', '"': '', '^': '^', '~': '~', '@': ''}.get(d, '')
                    out.append(rep)
                    i += 2
                    continue
                m = re.match(r'[A-Za-z]+\*?', s[i + 1:])
                name = m.group(0)
                j = i + 1 + len(name)
                base = name.rstrip('*')
                if base == 'begin' or base == 'end':
                    em = re.match(r'\s*\{([A-Za-z*]+)\}', s[j:])
                    if em:
                        env = em.group(1)
                        j += em.end()
                        if env in ('align*', 'align', 'equation', 'equation*', 'gather*', 'gather') \
                                and base == 'begin':
                            end_tok = '\\end{%s}' % env
                            e = s.find(end_tok, j)
                            e = n if e < 0 else e
                            inner = s[j:e]
                            body = inner if env.startswith('equation') else \
                                '\\begin{aligned}%s\\end{aligned}' % inner
                            out.append('\n' + self.math(body, True) + '\n')
                            i = e + len(end_tok)
                            continue
                        if base == 'begin':
                            spec = ENV_ARGS.get(env)
                            if spec is None and env in BOX_ENVS:
                                spec = 'm' if env in MANDATORY_TITLE else 'o'
                            if spec:
                                _, j = read_args(s, j, spec)
                        out.append('\n')
                    i = j
                    continue
                if base in SYMBOLS:
                    out.append(SYMBOLS[base])
                    if base == 'item':
                        k = j
                        while k < n and s[k] in ' \t':
                            k += 1
                        if k < n and s[k] == '[':
                            lab, j = bracketed(s, k)
                            out.append(self.conv(lab) + ' ')
                    elif base in ('euro', 'texteuro', 'S') and j < n and s[j] == '{' and s[j:j + 2] == '{}':
                        j += 2
                    i = j
                    continue
                if base in NOOP:
                    if base == 'selectfont':
                        pass
                    i = j
                    continue
                if base in DROP_ARGS:
                    spec = DROP_ARGS[base]
                    if base == 'cmidrule':
                        k = j
                        if k < n and s[k] == '(':
                            k = s.find(')', k) + 1
                        _, j = read_args(s, k, 'm')
                    else:
                        _, j = read_args(s, j, spec)
                    i = j
                    continue
                if base in UNWRAP1:
                    args, j2 = read_args(s, j, 'om' if base in ('section', 'subsection') else 'm')
                    arg = args[-1]
                    if arg is None:
                        i = j
                        continue
                    if base == 'texorpdfstring':
                        args, j2 = read_args(s, j, 'mm')
                        arg = args[0]
                    out.append(self.conv(arg[0]))
                    i = j2
                    continue
                if base in UNWRAP_LAST:
                    if base == 'mrvk':
                        args, j2 = read_args(s, j, 'mm')
                        out.append(' '.join(self.conv(a[0]) for a in args if a))
                    elif base == 'figwrap':
                        args, j2 = read_args(s, j, 'mm')
                        out.append(self.conv(args[1][0]) if args[1] else '')
                    elif base == 'parbox':
                        args, j2 = read_args(s, j, 'omm')
                        out.append(self.conv(args[2][0]) if args[2] else '')
                    elif base == 'makebox':
                        args, j2 = read_args(s, j, 'oom')
                        out.append(self.conv(args[2][0]) if args[2] else '')
                    else:
                        k = UNWRAP_LAST[base]
                        spec = 'o' + 'm' * k if base in ('textcolor', 'colorbox') else 'm' * k
                        args, j2 = read_args(s, j, spec)
                        last = args[-1]
                        out.append(self.conv(last[0]) if last else '')
                    i = j2
                    continue
                # unknown macro: drop the name, keep what follows
                self.unknown[base] += 1
                i = j
                continue
            if c in '{}':
                i += 1
                continue
            if c == '\n':
                m = re.match(r'\n[ \t]*\n\s*', s[i:])
                if m:
                    out.append('\n')
                    i += m.end()
                else:
                    out.append(' ')
                    i += 1
                continue
            if c == '~':
                out.append(' ')
                i += 1
                continue
            if c == '&':
                out.append(' | ')
                i += 1
                continue
            if s.startswith('---', i):
                out.append('—')
                i += 3
                continue
            if s.startswith('--', i):
                out.append('–')
                i += 2
                continue
            if s.startswith('``', i):
                out.append('“')
                i += 2
                continue
            if s.startswith("''", i):
                out.append('”')
                i += 2
                continue
            if c == '`':
                out.append('‘')
                i += 1
                continue
            out.append(c)
            i += 1
        return ''.join(out)


PLAIN = Plain()


def words(text):
    t = re.sub(r'\$\$.*?\$\$|\$[^$]*\$', ' ', text or '', flags=re.S)
    return re.findall(r'[A-Za-z][A-Za-z\'’-]+', t)


def sentences(plain):
    """Split plain text into sentences, returning (start, end) pairs, math-aware enough."""
    out, start = [], 0
    spans = find_math_spans(plain)
    in_math = [False] * (len(plain) + 1)
    for a, b, _ in spans:
        for k in range(a, min(b, len(plain))):
            in_math[k] = True
    for m in re.finditer(r'(?<=[.!?:])\s+(?=[A-Z(“\\$0-9•▸])|\n', plain):
        if in_math[m.start()]:
            continue
        out.append((start, m.start()))
        start = m.end()
    out.append((start, len(plain)))
    return [(a, b) for a, b in out if plain[a:b].strip()]


def sentence_at(plain, pos, spans=None):
    for a, b in (spans or sentences(plain)):
        if a <= pos <= b:
            return plain[a:b].strip()
    return plain.strip()


def clean_term(t):
    t = re.sub(r'\s+', ' ', t).strip()
    return re.sub(r'[\s.:;,]+$', '', t)


# ============================================================================= list items
def list_items(latex):
    """[(label, item_latex_without_nested_lists, depth, env)] for every \\item in latex."""
    envs = parse_envs(latex)
    out = []

    def visit(env_list, depth):
        for e in env_list:
            if e.name in LIST_ENVS:
                inner_a, inner_b = e.a, e.e0
                nested = [c for c in walk_envs(e.children)]
                top_nested = e.children
                blocked = [(c.b0, c.e1) for c in top_nested]
                pos = []
                for m in re.finditer(r'\\item(?![A-Za-z])', latex[inner_a:inner_b]):
                    p = inner_a + m.start()
                    if any(a <= p < b for a, b in blocked):
                        continue
                    pos.append((p, inner_a + m.end()))
                for k, (p, q) in enumerate(pos):
                    end = pos[k + 1][0] if k + 1 < len(pos) else inner_b
                    label = None
                    j = q
                    while j < end and latex[j] in ' \t':
                        j += 1
                    if j < end and latex[j] == '[':
                        lab, j2 = bracketed(latex, j)
                        label, q = lab, j2
                    lists_inside = [(c.b0, c.e1) for c in top_nested
                                    if c.name in LIST_ENVS and p <= c.b0 < end]
                    txt = mask(latex[q:end], [(a - q, b - q) for a, b in lists_inside])
                    out.append((label, txt, depth, e.name, p))
                visit(e.children, depth + 1)
                del nested
            else:
                visit(e.children, depth)
    visit(envs, 1)
    out.sort(key=lambda x: x[4])
    return [(a, b, c, d) for a, b, c, d, _ in out]


# ============================================================================= tables
ROW_RULES = re.compile(r'^\s*(?:\\(?:toprule|midrule|bottomrule|hline|endhead|endfirsthead|endfoot|'
                       r'endlastfoot)\b(?:\[[^\]]*\])?|\\addlinespace(?:\[[^\]]*\])?|'
                       r'\\cmidrule(?:\([^)]*\))?\{[^}]*\}|\\arrayrulecolor(?:\[[^\]]*\])?\{[^}]*\}|'
                       r'\\noalign\{[^}]*\}|\\rowcolor(?:\[[^\]]*\])?\{[^}]*\}|\\renewcommand\{[^}]*\}\{[^}]*\}|'
                       r'\\tabfont\b|\\small\b|\\centering\b|\\footnotesize\b)\s*')
HEADER_MARK = re.compile(r'\\(thd|thead|hdr)\b|\\sffamily\s*\\bfseries|\\textbf\{\s*\\sffamily|'
                         r'\\bfseries\s*\\sffamily')
HEADER_ROWCOLOR = re.compile(r'\\rowcolor(?:\[[^\]]*\])?\{(navy|FRMNavy|FRMSoft)\}')


def split_top(text, sep):
    """Split text on the literal sep at brace depth 0, outside math and nested environments."""
    parts, depth, i, start, n = [], 0, 0, 0, len(text)
    env_depth = 0
    in_math = False
    while i < n:
        c = text[i]
        if c == '\\':
            if text.startswith('\\begin{', i):
                env_depth += 1
            elif text.startswith('\\end{', i):
                env_depth -= 1
            if sep == '\\\\' and text.startswith('\\\\', i) and depth == 0 and env_depth == 0 \
                    and not in_math:
                parts.append((start, i))
                j = i + 2
                k = j
                while k < n and text[k] in ' \t':
                    k += 1
                if k < n and text[k] == '[' and re.match(r'\[\s*-?[\d.]+\s*(pt|em|ex|mm|cm)\s*\]', text[k:]):
                    _, j = bracketed(text, k)
                start = i = j
                continue
            i += 2
            continue
        if c == '$':
            in_math = not in_math
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        elif sep == '&' and c == '&' and depth == 0 and env_depth == 0 and not in_math:
            parts.append((start, i))
            start = i + 1
        i += 1
    parts.append((start, n))
    return parts


def parse_table(body):
    """Parse a tabular body (after column spec) into title/header/data rows."""
    segs = body
    if '\\endfirsthead' in segs:
        first, rest = segs.split('\\endfirsthead', 1)
        if '\\endhead' in rest:
            rest = rest.split('\\endhead', 1)[1]
        segs = first + '\n\\midrule\n' + rest if '\\midrule' not in first else first + rest
    elif '\\endhead' in segs:
        segs = segs.replace('\\endhead', '')
    for tok in ('\\endfoot', '\\endlastfoot'):
        segs = segs.replace(tok, '')
    raw_rows = []
    seen_midrule = False
    for a, b in split_top(segs, '\\\\'):
        chunk = segs[a:b]
        pre_rules, rowcolor = [], None
        while True:
            m = ROW_RULES.match(chunk)
            if not m or m.end() == 0:
                break
            tok = m.group(0)
            if 'midrule' in tok:
                pre_rules.append('midrule')
            rc = HEADER_ROWCOLOR.match(tok.strip())
            if tok.strip().startswith('\\rowcolor'):
                rowcolor = re.search(r'\{([^}]*)\}', tok).group(1)
            chunk = chunk[m.end():]
        if 'midrule' in pre_rules and raw_rows:
            seen_midrule = True
            raw_rows[-1]['before_midrule'] = True
        cells_raw = [chunk[x:y] for x, y in split_top(chunk, '&')]
        if not ''.join(cells_raw).strip():
            continue
        raw_rows.append({'raw': chunk, 'cells_raw': cells_raw, 'rowcolor': rowcolor,
                         'after_midrule': seen_midrule})
    ncols = max([len(r['cells_raw']) for r in raw_rows] or [0])
    first_mid = next((k for k, r in enumerate(raw_rows) if r.get('before_midrule')), None)
    title, header_rows, data_rows = None, [], []

    def is_header(r):
        return bool(HEADER_MARK.search(r['raw'])) or bool(r['rowcolor'] and re.match(
            r'^(navy|FRMNavy|FRMSoft)$', r['rowcolor']))

    def single_multicol(r):
        nonempty = [c for c in r['cells_raw'] if c.strip()]
        return len(nonempty) == 1 and '\\multicolumn' in nonempty[0] and len(r['cells_raw']) == 1

    idx = 0
    if raw_rows and single_multicol(raw_rows[0]) and ncols > 1 and is_header(raw_rows[0]):
        title = PLAIN(raw_rows[0]['raw'], cell=True)
        idx = 1
        if idx < len(raw_rows) and re.search(r'\\tsub\b', raw_rows[idx]['raw']) and all(
                (not c.strip()) or '\\tsub' in c for c in raw_rows[idx]['cells_raw']):
            header_rows.append(raw_rows[idx])
            idx += 1
    if first_mid is not None and first_mid >= idx and first_mid - idx < 3:
        header_rows.extend(raw_rows[idx:first_mid + 1])
        idx = first_mid + 1
    else:
        while idx < len(raw_rows) and is_header(raw_rows[idx]) and not single_multicol(raw_rows[idx]):
            header_rows.append(raw_rows[idx])
            idx += 1
    group = None
    headers = [PLAIN(c, cell=True) for c in header_rows[-1]['cells_raw']] if header_rows else []
    current = headers
    for r in raw_rows[idx:]:
        if single_multicol(r) and ncols > 1:
            group = PLAIN(r['raw'], cell=True)
            continue
        cells = [PLAIN(c, cell=True) for c in r['cells_raw']]
        if data_rows and re.search(r'\\(thd|thead|hdr)\b', r['raw']) and len(cells) > 1:
            # a sub-header mid-table: new headers for the rows below, first cell names the group
            current = cells
            group = cells[0] or group
            continue
        data_rows.append({'cells': cells, 'cells_raw': r['cells_raw'], 'group': group, 'headers': current})
    return {'title': title, 'headers': headers,
            'header_rows': [[PLAIN(c, cell=True) for c in h['cells_raw']] for h in header_rows],
            'rows': data_rows, 'ncols': ncols}


# ============================================================================= variables
SYM_RE = re.compile(r'\$[^$]+\$|\\term\{(?:[^{}]|\{[^{}]*\})*\}|\\text\{[^{}]*\}|'
                    r'(?<![A-Za-z])[A-Z][A-Za-z]*[A-Z0-9][A-Za-z0-9]*(?![A-Za-z])')
SYM_GROUP_RE = re.compile(r'^\s*(?:(?:where|here|and|with|also)\s+)?((?:%s)(?:\s*(?:,|and|/|or)\s*(?:%s))*)'
                          % (SYM_RE.pattern, SYM_RE.pattern), re.I)
CONNECT_RE = re.compile(r'^\s*(?:=|:|—|---|\bis\b|\bare\b|\bdenotes\b|\brepresents\b|\bstands for\b)\s*', re.I)


def top_level_split(text, pattern):
    """Split text with regex pattern, only at matches outside $..$ and braces."""
    spans = [(a, b) for a, b, _ in find_math_spans(text)]
    depth = []
    d = 0
    for ch in text:
        depth.append(d)
        if ch == '{':
            d += 1
        elif ch == '}':
            d -= 1
    parts, start = [], 0
    for m in re.finditer(pattern, text):
        p = m.start()
        if any(a <= p < b for a, b in spans) or (p < len(depth) and depth[p] > 0):
            continue
        parts.append(text[start:p])
        start = m.end()
    parts.append(text[start:])
    return parts


def cut_first_sentence(latex):
    spans = [(a, b) for a, b, _ in find_math_spans(latex)]
    for m in re.finditer(r'\.\s+(?=[A-Z\\])', latex):
        if not any(a <= m.start() < b for a, b in spans):
            return latex[:m.start()], latex[m.end():]
    return latex, ''


def parse_vk(vk_latex):
    """Variables from a notation key. Handles '$X$ = meaning' and '$X$ is meaning, $Y$ the ...'."""
    text = re.sub(r'\\q?quad\b', ' ', vk_latex)
    text = re.sub(r'\\par\b|\\smallskip\b', ' ', text)
    out = []
    for seg in top_level_split(text, r';'):
        seg = seg.strip()
        if not seg:
            continue
        seg_first, _rest = cut_first_sentence(seg) if not re.search(r'=', seg.split('.')[0] if False else '') else (seg, '')
        clauses = top_level_split(seg, r',\s+(?:and\s+)?(?=\$|\\term\{)|\s+and\s+(?=\$[^$]+\$\s+(?:is|are|the|=))|'
                                       r'\.\s+(?=\$[^$]+\$\s+(?:is|are|=))')
        merged, buf = [], ''
        for cl in clauses:
            cand = (buf + ', ' + cl) if buf else cl
            m = SYM_GROUP_RE.match(cand)
            rest = cand[m.end():] if m else cand
            if m and not words(PLAIN(rest)) and not re.search(r'=', rest):
                buf = cand
                continue
            merged.append(cand)
            buf = ''
        if buf:
            merged.append(buf)
        had_connector = False
        for k, cl in enumerate(merged):
            m = SYM_GROUP_RE.match(cl)
            if not m:
                continue
            syms_latex = m.group(1)
            rest = cl[m.end():]
            cm = CONNECT_RE.match(rest)
            if cm:
                had_connector = True
                rest = rest[cm.end():]
            elif not had_connector or not re.match(r'\s*(the|its|a|an)\b', rest, re.I):
                continue
            definition, _ = cut_first_sentence(rest)
            dplain = PLAIN(definition).rstrip('. ')
            if len(words(dplain)) < 1:
                continue
            syms = SYM_RE.findall(syms_latex)
            syms = [x for x in syms if x.lower() not in ('and', 'or')]
            for sym in syms:
                sp = PLAIN(sym)
                if not sp or sp.lower() in ('where', 'here', 'the'):
                    continue
                out.append({'symbol': sp, 'definition': dplain, 'shared': len(syms) > 1})
    return out


def parse_where_math(latex):
    """ORR style: 'where \\[ X = def \\]' or an aligned block of 'X &= def' lines."""
    m = re.search(r'\bwhere\b', latex)
    if not m:
        return []
    rest = latex[m.end():]
    dm = re.search(r'\\\[(.*?)\\\]', rest, re.S)
    if not dm:
        return []
    body = dm.group(1)
    body = re.sub(r'\\begin\{aligned\}|\\end\{aligned\}', '', body)
    out = []
    for line in re.split(r'\\\\', body):
        if '=' not in line:
            continue
        sym, _, rhs = line.replace('&=', '=').partition('=')
        sym = sym.strip()
        rhs = rhs.strip()
        tm = re.match(r'^\\text\{([^{}]*)\}\s*(=?)(.*)$', rhs, re.S)
        if tm:
            d = tm.group(1) + ((' = $' + tm.group(3).strip() + '$') if tm.group(3).strip() else '')
        else:
            d = '$' + rhs + '$'
        out.append({'symbol': '$' + sym + '$', 'definition': re.sub(r'\s+', ' ', d).strip(), 'shared': False})
    return out


# ============================================================================= trap text splitting
def split_correct_corrupt(text):
    """Heuristic split of a trap statement into (correct, corrupted, rule). Returns (None, None, None)."""
    for sent in [text[a:b] for a, b in sentences(text)]:
        m = re.match(r'^(?P<y>.+?)\s+is wrong[:;,]\s*(?P<x>.+)$', sent)
        if m:
            return m.group('x').strip(), m.group('y').strip(), 'Y is wrong: X'
        m = re.search(r'(?P<x>.+?)(?:,| —| –| ---|;)\s+not\s+(?P<y>[^.;—–()]+)', sent)
        rule = 'X, not Y'
        if not m:
            m = re.search(r'(?P<x>.+?)\s+\(not\s+(?P<y>[^)]+)\)', sent)
            rule = 'X (not Y)'
        if not m:
            continue
        x, y = m.group('x').strip(), m.group('y').strip().rstrip('.')
        yw = y.split()
        if not yw or len(yw) > 12 or re.match(r'(necessarily|only|just|always|the same|even|merely|a|an)\b',
                                              y, re.I) and len(yw) > 1 and yw[0].lower() in (
                'necessarily', 'only', 'just', 'always', 'even', 'merely'):
            continue
        xw = x.split()
        if len(xw) < 2:
            continue
        k = None
        for idx in range(len(xw) - 1, -1, -1):
            if xw[idx].lower().strip('$*') == yw[0].lower().strip('$*') and idx > 0:
                k = idx
                break
        if k is None:
            if len(xw) <= len(yw):
                continue
            k = len(xw) - len(yw)
        corrupted = ' '.join(xw[:k] + yw)
        correct = x
        tail = sent[m.end():].strip()
        if rule == 'X (not Y)':
            correct = (x + ' ' + tail).strip()
            corrupted = (corrupted + ' ' + tail).strip()
        correct = correct.rstrip(' .,;') + '.'
        corrupted = corrupted.rstrip(' .,;') + '.'
        if correct == corrupted:
            continue
        return correct, corrupted, rule
    return None, None, None


# ============================================================================= master.tex context
def master_context():
    ctx = {}
    for vol in VOLS:
        path = os.path.join(NOTES, vol, 'master.tex')
        if not os.path.exists(path):
            continue
        s = strip_comments(open(path, encoding='utf-8').read())
        cur, rank = None, 0
        for m in re.finditer(r'\\setchapctx\{([^}]*)\}\{([^}]*)\}\{([^}]*)\}|\\input\{ch/([^}]+)\}', s):
            if m.group(1) is not None:
                cur = (m.group(1), m.group(2), m.group(3))
            else:
                rank += 1
                ctx[os.path.join(vol, 'ch', m.group(4) + '.tex')] = {
                    'tag': cur[0] if cur else None, 'book': cur[1] if cur else None,
                    'legacy_reading_no': cur[2] if cur else None, 'roi_rank': rank}
    return ctx


# ============================================================================= reading parser
FLOW_MACRO_RE = re.compile(r'\\(lohead|lo|basics|section|subsection|subsubsection|orsubb|orsub|figcap|'
                           r'orfigcap|figwrap|gapbadge|schweserbadge|gapnote|srcnote|vk|mrvk|'
                           r'includegraphics|reading|chapterhead|markboth)(?![A-Za-z@])')
FLOW_SPEC = {'lo': 'mm', 'lohead': 'ommm', 'basics': 'm', 'section': 'sm', 'subsection': 'sm',
             'subsubsection': 'sm', 'orsub': 'm', 'orsubb': 'm', 'figcap': 'm', 'orfigcap': 'm',
             'figwrap': 'mm', 'gapbadge': '', 'schweserbadge': '', 'gapnote': 'm', 'srcnote': 'm',
             'vk': 'm', 'mrvk': 'mm', 'includegraphics': 'om', 'reading': 'mmmm',
             'chapterhead': 'mmmmm', 'markboth': 'mm'}
CAPTION_LABEL_RE = re.compile(r'^\s*((?:Figure|Table)\s+[A-Z]{2,3}-\d+\.\d+)\.?\s*')
GREY_NOTE_RE = re.compile(r'^\s*\{\s*(?:\\(?:footnotesize|small|scriptsize|fontsize\{[^}]*\}\{[^}]*\}|'
                          r'selectfont|itshape)\s*)*\\color\{(FRMGrey|midgray|grey|gray|FRMGray)\}')


class ReadingParser(object):
    def __init__(self, relpath, meta_ctx, log):
        self.relpath = relpath                      # e.g. FRM_Consolidated_Vol2/ch/01_LR_LTR1.tex
        self.source_file = 'notes/' + relpath
        path = os.path.join(NOTES, relpath)
        self.raw = open(path, encoding='utf-8').read()
        self.s = strip_comments(self.raw)
        self.line_starts = [0] + [m.end() for m in re.finditer('\n', self.s)]
        self.log = log                               # shared inference / deviation log
        self.ctx = meta_ctx.get(relpath, {})
        base = os.path.basename(relpath)
        m = re.match(r'\d+_([A-Z]+)_([A-Z]+\d+)\.tex', base)
        self.area = AREA_OF[m.group(1)]
        self.anoms = []
        self.envs = parse_envs(self.s, self.anoms)
        self.reading = None
        self.objectives = []
        self.obj = None
        self.section = None
        self.para = None              # (start, end) of current paragraph text
        self.gap_active = False
        self.gap_pending_note = None  # text waiting for the first block of the gap span
        self.expect_gap_note = False
        self.gapnote_flag = None      # \gapnote without a badge -> next block
        self.pending_provenance = None
        self.last_visual = None       # block or ('image', path, line)
        self.last_block = None
        self.pending_orsubb = None
        self.pending_leadin = None
        self.pending_list_absorb = None
        self.source_notes = []
        self.corrections = []
        self.traps = []
        self.counters = Counter()
        self.sub_counters = {}
        self.dropped = []
        self.first_lo_seen = False

    # ------------------------------------------------------------------ utilities
    def line(self, pos):
        return bisect.bisect_right(self.line_starts, pos)

    def infer(self, kind, detail, pos=None):
        self.log['inferences'].append(OrderedDict([
            ('kind', kind), ('reading', self.reading['reading_id'] if self.reading else None),
            ('file', self.source_file), ('line', self.line(pos) if pos is not None else None),
            ('detail', detail)]))

    def deviate(self, detail):
        self.log['deviations'].append((self.reading['reading_id'] if self.reading else self.source_file,
                                       detail))

    def rid_low(self):
        return self.reading['reading_id'].lower().replace('-', '')

    def sub_id(self, block, key):
        c = self.sub_counters.setdefault(block['id'], Counter())
        c[key] += 1
        return '%s.%s.%d' % (block['id'], SUBITEM_TAG.get(key, key), c[key])

    # ------------------------------------------------------------------ driver
    def run(self):
        s = self.s
        rd = list(re.finditer(r'\\(reading|chapterhead)(?![A-Za-z])', s))
        if not rd:
            raise SystemExit('no reading opener in %s' % self.relpath)
        m = rd[0]
        if m.group(1) == 'reading':
            args, end = read_args(s, m.end(), 'mmmm')
            a = [x[0] for x in args]
            rid, title, src = a[0].strip(), a[1], a[3]
            legacy = OrderedDict([('macro', 'reading'), ('args', a), ('tag_arg', a[2])])
        else:
            args, end = read_args(s, m.end(), 'mmmmm')
            a = [x[0] for x in args]
            rid, title, src = a[1].strip(), a[2], a[4]
            legacy = OrderedDict([('macro', 'chapterhead'), ('args', a), ('reading_no', a[0]),
                                  ('category', a[3])])
        src_v = int(src) if src.strip().isdigit() else src.strip()
        self.reading = OrderedDict([
            ('reading_id', rid), ('title', PLAIN(title)), ('area', self.area),
            ('tag', self.ctx.get('tag') or (a[2] if m.group(1) == 'reading' else None)),
            ('src', src_v), ('source_citation', None), ('source_file', self.source_file),
            ('source_line', self.line(m.start())), ('book', self.ctx.get('book')),
            ('roi_rank', self.ctx.get('roi_rank')), ('legacy', legacy)])
        if m.group(1) == 'reading' and self.ctx.get('tag') and a[2] != self.ctx.get('tag'):
            self.infer('tag', 'tag taken from master.tex \\setchapctx (%s); \\reading arg #3 was %r'
                       % (self.ctx.get('tag'), a[2]), m.start())
        if not rid.startswith(self.area + '-'):
            self.deviate('reading id %s does not match area %s' % (rid, self.area))
        self.start_objective('intro', None, m.start(), {})
        self.scan(end, len(s), [e for e in self.envs if e.b0 >= end])
        self.flush_para()
        self.finish_objective()
        for kind, pos in self.anoms:
            self.deviate('%s at line %d' % (kind, self.line(pos)))
        return self.assemble()

    # ------------------------------------------------------------------ scanning
    def scan(self, a, b, children):
        s = self.s
        kids = sorted([c for c in children if c.b0 >= a and c.e1 is not None and c.e1 <= b],
                      key=lambda e: e.b0)
        i, k = a, 0
        while i < b:
            while k < len(kids) and kids[k].b0 < i:
                k += 1
            env_pos = kids[k].b0 if k < len(kids) else b
            m = FLOW_MACRO_RE.search(s, i, env_pos)
            if m:
                self.text(i, m.start())
                name = m.group(1)
                args, j = read_args(s, m.end(), FLOW_SPEC[name])
                self.macro(name, args, m.start(), j, kids)
                i = max(j, m.end())
            elif k < len(kids):
                self.text(i, env_pos)
                self.env(kids[k])
                i = kids[k].e1
                k += 1
            else:
                self.text(i, b)
                i = b

    def text(self, a, b):
        if a >= b:
            return
        s = self.s
        pos = a
        for m in LINE_BLANK.finditer(s, a, b):
            self.add_para(pos, m.start())
            self.flush_para()
            pos = m.end()
        self.add_para(pos, b)

    def add_para(self, a, b):
        if a >= b:
            return
        if self.para is None:
            if not self.s[a:b].strip():
                return
            self.para = [a, b]
        else:
            self.para[1] = b

    # ------------------------------------------------------------------ macros
    def macro(self, name, args, start, end, kids):
        s = self.s
        if name in ('reading', 'chapterhead'):
            return
        if name == 'markboth':
            self.reading['legacy']['running_head'] = PLAIN(args[0][0]) if args[0] else None
            return
        if name in ('lo', 'lohead', 'basics', 'section'):
            self.flush_para()
            if name == 'lo':
                label = args[0][0].strip()
                text = args[1][0] if args[1] else ''
                letter = label.split()[-1]
                prefix = label[:-len(letter)].strip()
                if prefix != self.reading['reading_id']:
                    self.deviate('\\lo label %r does not carry the reading id (line %d)'
                                 % (label, self.line(start)))
                legacy = {}
            elif name == 'lohead':
                letter = args[2][0].strip()
                text = args[3][0]
                legacy = OrderedDict([('lohead_no', args[1][0]), ('lohead_opt', args[0][0] if args[0] else None)])
            elif name == 'basics':
                letter, text, legacy = 'basics', args[0][0], {}
                self.infer('objective', '\\basics{} opens a non-LO section: objective letter "basics"', start)
            else:
                title = args[1][0] if args[1] else ''
                if not self.first_lo_seen or re.match(r'\s*Basics', title):
                    letter = 'basics'
                    self.infer('objective', '\\section{%s} before the first LO: objective letter "basics"'
                               % PLAIN(title), start)
                else:
                    letter = 'summary' if re.match(r'\s*Summary', title) else re.sub(r'\W+', '_', PLAIN(title).lower())[:20]
                    self.infer('objective', '\\section{%s} after the LOs: objective letter "%s"'
                               % (PLAIN(title), letter), start)
                text, legacy = title, {}
            if name in ('lo', 'lohead'):
                self.first_lo_seen = True
            self.finish_objective()
            self.start_objective(letter, text, start, legacy)
            return
        if name in ('subsection', 'subsubsection', 'orsub', 'orsubb'):
            self.flush_para()
            self.release_leadin()
            arg = args[-1]
            if arg is None:
                return
            text = PLAIN(arg[0])
            self.section = text
            lvl = {'subsection': 2, 'orsub': 2, 'subsubsection': 3, 'orsubb': 3}[name]
            n = len(self.obj['section_headings']) + 1
            hid = '%s.%s.section_heading.%d' % (self.rid_low(), self.obj['letter'], n)
            self.obj['section_headings'].append(OrderedDict([
                ('id', hid), ('text', text), ('level', lvl),
                ('macro', name + ('*' if args[0] and args[0][0] == '*' else '') if name in (
                    'subsection', 'subsubsection') else name),
                ('source_line', self.line(start)), ('hash', sha12(text))]))
            self.pending_orsubb = (text, start) if name == 'orsubb' else None
            self.last_visual = None
            return
        if name in ('figcap', 'orfigcap'):
            self.flush_para()
            self.caption(args[0][0] if args[0] else '', start, name)
            return
        if name == 'figwrap':
            self.flush_para()
            fig = args[0]
            inner = [c for c in kids if c.b0 >= fig[1] and c.e1 <= fig[2]]
            self.last_visual = None
            self.scan(fig[1], fig[2], inner)
            self.flush_para()
            self.caption(args[1][0] if args[1] else '', args[1][1] if args[1] else start, 'figwrap')
            return
        if name == 'includegraphics':
            self.flush_para()
            self.last_visual = ('image', args[1][0].strip() if args[1] else None, start)
            return
        if name == 'gapbadge':
            self.flush_para()
            self.gap_active = True
            self.expect_gap_note = True
            self.gap_badge_line = self.line(start)
            return
        if name == 'schweserbadge':
            self.pending_provenance = 'schweser'
            return
        if name == 'gapnote':
            self.flush_para()
            txt = PLAIN(args[0][0]) if args[0] else ''
            if self.expect_gap_note:
                self.gap_pending_note = txt
                self.expect_gap_note = False
            else:
                self.gapnote_flag = txt
                self.infer('gap', '\\gapnote without \\gapbadge flags the following block as gap-fill',
                           start)
            return
        if name == 'srcnote':
            self.flush_para()
            txt = PLAIN(args[0][0]) if args[0] else ''
            if self.expect_gap_note:
                self.gap_pending_note = txt
                self.expect_gap_note = False
            elif not self.first_lo_seen and self.reading['source_citation'] is None:
                self.reading['source_citation'] = txt
            else:
                self.add_source_note('srcnote', None, txt, start, None)
            return
        if name in ('vk', 'mrvk'):
            self.flush_para()
            lb = self.last_block
            vk = args[0][0] if args[0] else ''
            if lb is not None and lb['type'] == 'fmlbox':
                self.apply_vk(lb, vk, args[1][0] if name == 'mrvk' and args[1] else None)
                self.infer('variables', 'notation key outside the formula box attached to %s' % lb['id'], start)
            else:
                self.deviate('orphan \\%s at line %d' % (name, self.line(start)))
            return

    # ------------------------------------------------------------------ environments
    def env(self, e):
        name = e.name
        if name in CONTAINER_ENVS or name in ('document',):
            self.flush_para()
            self.scan(e.a, e.e0, e.children)
            self.flush_para()
            return
        if name in MATH_ENVS or name in TEXT_ENVS:
            self.add_para(e.b0, e.e1)
            return
        self.flush_para()
        if name in BOX_ENVS:
            self.box(e)
        elif name in LIST_ENVS:
            self.flow_list(e)
        elif name in TABLE_ENVS:
            self.flow_table(e)
        elif name == 'tikzpicture':
            self.flow_tikz(e)
        else:
            self.log['unresolved_envs'].append((self.source_file, self.line(e.b0), name))
            self.scan(e.a, e.e0, e.children)
            self.flush_para()

    # ------------------------------------------------------------------ objectives
    def start_objective(self, letter, text, pos, legacy):
        used = [o['letter'] for o in self.objectives]
        if letter in used:
            n = 2
            while '%s%d' % (letter, n) in used:
                n += 1
            self.deviate('duplicate objective letter %r (line %d); renamed %s%d'
                         % (letter, self.line(pos), letter, n))
            letter = '%s%d' % (letter, n)
        oid = '%s %s' % (self.reading['reading_id'], letter)
        self.obj = OrderedDict([('letter', letter), ('id', oid),
                                ('text', PLAIN(text) if text is not None else None),
                                ('source_line', self.line(pos))])
        if legacy:
            self.obj['legacy'] = legacy
        if letter == 'summary':
            self.obj['note'] = ('Post-LO summary section; in MR-15 it spans the term structure models of '
                                'MR-14 and MR-15.')
        self.obj['section_headings'] = []
        self.obj['blocks'] = []
        self.section = None
        self.gap_active = False
        self.expect_gap_note = False
        self.last_visual = None
        self.pending_orsubb = None
        self.objectives.append(self.obj)

    def finish_objective(self):
        if self.obj is None:
            return
        self.release_leadin()
        if self.gap_pending_note:
            self.obj.setdefault('gap_notes', []).append(self.gap_pending_note)
            self.gap_pending_note = None

    # ------------------------------------------------------------------ block emission
    def new_block(self, btype, env_name, pos, title=None):
        b = OrderedDict()
        b['id'] = None
        b['type'] = btype
        b['env'] = env_name
        b['title'] = title
        b['source_file'] = self.source_file
        b['source_line'] = self.line(pos)
        b['section'] = self.section
        b['is_gap_fill'] = False
        b['provenance'] = 'notes'
        return b

    def emit(self, b, pos):
        if b['type'] != 'prose_para':
            self.release_leadin()
        self.counters[(self.obj['letter'], b['type'])] += 1
        b['id'] = '%s.%s.%s.%d' % (self.rid_low(), self.obj['letter'], b['type'],
                                   self.counters[(self.obj['letter'], b['type'])])
        if self.gap_active:
            b['is_gap_fill'] = True
        if b['type'] == 'gapbox':
            b['is_gap_fill'] = True
        if self.gap_pending_note:
            b['gap_note'] = self.gap_pending_note
            self.gap_pending_note = None
        if self.gapnote_flag:
            b['is_gap_fill'] = True
            b['gap_note'] = self.gapnote_flag
            self.gapnote_flag = None
        self.expect_gap_note = False
        if self.pending_provenance:
            b['provenance'] = self.pending_provenance
            self.pending_provenance = None
        if b.get('provenance') == 'schweser':
            self.infer('provenance', '\\schweserbadge -> provenance "schweser" on %s' % b['id'], pos)
        self.obj['blocks'].append(b)
        self.last_block = b
        return b

    def finalize(self, b, fragments, where):
        """Compute hash and mine sub-items from latex fragments [(latex, kind)]."""
        for key in SUBITEM_KEYS:
            b.setdefault(key, [])
        b.setdefault('cases', [])
        for frag, kind in fragments:
            self.mine(b, frag, kind, where)
        b['cases'] = sorted(set(b['cases']))
        b['hash'] = sha12(b['type'] + '|' + (b.get('title') or '') + '|' + b.get('body_latex', ''))
        # keep hash right after provenance for readability
        return b

    # ------------------------------------------------------------------ mining
    def mine(self, b, latex, kind, where):
        """kind: 'text' (prose/box body), 'caption', 'table' (cells), 'nodes' (tikz node text, plain)."""
        if kind == 'nodes':
            plain = latex
        else:
            latex = mask_env_options(latex)
            plain = PLAIN(latex)
        math_spans = [(a, b_) for a, b_, _ in find_math_spans(latex)] if kind != 'nodes' else []
        if kind in ('text', 'caption', 'table'):
            for m in re.finditer(r'\\term\{', latex):
                t, _ = braced(latex, m.end() - 1)
                tp = clean_term(PLAIN(t))
                if tp:
                    b['terms'].append(OrderedDict([('id', self.sub_id(b, 'terms')), ('parent', b['id']),
                                                   ('text', tp), ('term_source', 'term'), ('hash', sha12(tp))]))
        if kind in ('text', 'caption'):
            for m in re.finditer(r'\\textbf\{', latex):
                if any(a <= m.start() < b_ for a, b_ in math_spans):
                    continue
                t, _ = braced(latex, m.end() - 1)
                tp = PLAIN(t).strip()
                key = clean_term(tp).lower()
                if not tp or len(tp) < 2 or key in CATMAP or re.match(r'^(step\s*\d|what this means)', key):
                    continue
                if key.split(',')[0].strip() in CATMAP:
                    continue
                role = 'label' if (len(words(tp)) <= 5 and re.search(r'[:.]$', tp)) else 'claim'
                ctx = sentence_at(plain, max(plain.find(tp), 0)) if tp in plain else None
                item = OrderedDict([('id', self.sub_id(b, 'bold_claims')), ('parent', b['id']), ('text', tp),
                                    ('where', where), ('role', role), ('context', ctx), ('hash', sha12(tp))])
                b['bold_claims'].append(item)
        if kind in ('text', 'table'):
            for label, item_latex, depth, env in list_items(latex):
                tp = PLAIN(item_latex)
                if not tp:
                    continue
                if self.area == 'ORR' and kind == 'text':
                    lm = re.match(r'\s*\\textbf\{', item_latex)
                    if lm:
                        lt, _ = braced(item_latex, lm.end() - 1)
                        ltp = PLAIN(lt)
                        if re.search(r'[.:]\s*$', ltp) or len(words(ltp)) <= 6:
                            self.add_term(b, ltp, 'bold_leadin')
                it = OrderedDict([('id', self.sub_id(b, 'bullets')), ('parent', b['id']), ('text', tp),
                                  ('depth', depth), ('list_env', env)])
                if label is not None:
                    it['label'] = PLAIN(label)
                it['hash'] = sha12(tp)
                b['bullets'].append(it)
        # numbers, cross refs, cases on plain text
        spans = sentences(plain)
        for m in NUM_RE.finditer(plain):
            txt = m.group(0).strip()
            item = OrderedDict([('id', self.sub_id(b, 'numeric_items')), ('parent', b['id']), ('text', txt)])
            item.update(numeric_parse(txt))
            item['context'] = sentence_at(plain, m.start(), spans)
            item['hash'] = sha12(txt + '|' + item['context'])
            b['numeric_items'].append(item)
        own = self.reading['reading_id']
        for m in XREF_RE.finditer(plain):
            target = '%s-%s' % (m.group(1), m.group(2))
            if target == own:
                continue
            item = OrderedDict([('id', self.sub_id(b, 'cross_refs')), ('parent', b['id']), ('target', target),
                                ('lo', m.group(3)), ('context', sentence_at(plain, m.start(), spans))])
            item['hash'] = sha12(target + '|' + item['context'])
            b['cross_refs'].append(item)
        for name, rx in CASE_RES:
            if rx.search(plain):
                b['cases'].append(name)

    def add_term(self, b, text, source):
        tp = clean_term(re.sub(r'^\s*\d+[.)]\s+', '', text))
        if not tp:
            return
        b['terms'].append(OrderedDict([('id', self.sub_id(b, 'terms')), ('parent', b['id']), ('text', tp),
                                       ('term_source', source), ('hash', sha12(tp))]))

    # ------------------------------------------------------------------ paragraphs
    def flush_para(self):
        if self.para is None:
            return
        a, b = self.para
        self.para = None
        raw = self.s[a:b]
        if not raw.strip():
            return
        lead = len(raw) - len(raw.lstrip())
        pos = a + lead
        raw = raw.strip()
        plain = PLAIN(raw)
        nwords = len(words(plain))
        has_math = bool(re.search(r'\\\[|\$|\\begin\{align', raw))
        if self.expect_gap_note and GREY_NOTE_RE.match(raw):
            self.gap_pending_note = plain
            self.expect_gap_note = False
            return
        if plain.endswith(':') and nwords >= 1 and not re.search(r'\\\[|\\begin\{align', raw):
            # a lead-in ("Steps involved:"); merged into the list that follows, else emitted as prose
            self.release_leadin()
            self.pending_leadin = (raw, plain, pos, nwords)
            return
        self.release_leadin()
        if nwords < 3 and not has_math:
            if plain and re.search(r'[A-Za-z0-9]', plain):
                self.dropped.append((self.line(pos), plain))
            return
        # loose display math right after a formula -> substitutions on the latest fmlbox of this objective
        display = re.search(r'\\\[|\\begin\{align', raw)
        if display:
            outside = re.sub(r'\\\[.*?\\\]|\\begin\{(align\*?)\}.*?\\end\{\1\}', ' ', raw, flags=re.S)
            fml = next((x for x in reversed(self.obj['blocks']) if x['type'] == 'fmlbox'), None)
            if len(words(PLAIN(outside))) <= 12 and fml is not None:
                fml.setdefault('substitutions', []).append(OrderedDict([
                    ('latex', raw), ('plain_text', plain), ('source_line', self.line(pos))]))
                self.mine(fml, raw, 'text', 'fmlbox')
                self.infer('substitution', 'loose display math attached to %s as a substitution' % fml['id'], pos)
                return
        self.emit_prose(raw, plain, pos, 'para' if nwords >= 3 else 'math')

    def emit_prose(self, raw, plain, pos, form, env_name=None, lead_in=None):
        b_ = self.new_block('prose_para', env_name, pos)
        b_['form'] = form
        if lead_in is not None:
            b_['lead_in'] = lead_in
        b_['body_latex'] = raw
        b_['plain_text'] = plain
        self.emit(b_, pos)
        self.finalize(b_, [(raw, 'text')], 'prose' if form != 'list' else 'list')
        if self.pending_orsubb:
            head, hpos = self.pending_orsubb
            if form == 'para' and len(sentences(plain)) == 1:
                self.add_term(b_, head, 'orsubb')
                self.infer('term', '\\orsubb{%s} followed by a one-sentence definition -> term on %s'
                           % (head, b_['id']), hpos)
        self.pending_orsubb = None
        self.last_visual = None
        return b_

    def release_leadin(self):
        if self.pending_leadin is None:
            return
        raw, plain, pos, nwords = self.pending_leadin
        self.pending_leadin = None
        if nwords < 3:
            self.dropped.append((self.line(pos), plain))
            return
        self.emit_prose(raw, plain, pos, 'para')

    # ------------------------------------------------------------------ flow lists
    def flow_list(self, e):
        s = self.s
        raw = s[e.b0:e.e1]
        lb = self.last_block
        # ORR: an itemize of symbol definitions right after a (retyped) formula box -> its notation key
        if lb is not None and lb['type'] == 'fmlbox' and lb.get('env') == 'orkeybox' and \
                self.obj['blocks'] and self.obj['blocks'][-1] is lb and lb.get('_end') is not None and \
                not s[lb['_end']:e.b0].strip():
            items = list_items(raw)
            if items and all('$' in it[1] for it in items):
                variables = []
                for _, it, _, _ in items:
                    m = re.match(r'\s*(.*?),\s*(\$[^$]+\$),\s*is\s+(.*)$', it, re.S)
                    if m:
                        d = PLAIN(m.group(1)) + ': ' + PLAIN(cut_first_sentence(m.group(3))[0]).rstrip('.')
                        variables.append({'symbol': PLAIN(m.group(2)), 'definition': d, 'shared': False})
                lb['notation_key'] = ((lb.get('notation_key') or '') + '\n' + PLAIN(raw)).strip()
                lb['body_latex'] = lb['body_latex'] + '\n% notation list after the box:\n' + raw
                for v in variables:
                    self.add_variable(lb, v)
                self.mine(lb, raw, 'text', 'fmlbox')
                lb['hash'] = sha12(lb['type'] + '|' + (lb.get('title') or '') + '|' + lb['body_latex'])
                self.infer('variables', 'itemize right after ORR formula box absorbed as its notation key (%s)'
                           % lb['id'], e.b0)
                return
        # merge with a pending lead-in paragraph ending in ':'
        if self.pending_leadin is not None:
            lraw, lplain, lpos, _ = self.pending_leadin
            self.pending_leadin = None
            self.emit_prose(lraw + '\n\n' + raw, lplain + '\n' + PLAIN(raw), lpos, 'list', e.name, lplain)
            return
        self.emit_prose(raw, PLAIN(raw), e.b0, 'list', e.name)

    # ------------------------------------------------------------------ tables
    def table_object(self, e, owner):
        """Parse table env e. Returns dict with rows (row items get ids under owner)."""
        s = self.s
        body = s[e.a:e.e0]
        t = parse_table(body)
        obj = OrderedDict()
        obj['env'] = e.name
        obj['title_row'] = t['title']
        obj['headers'] = t['headers']
        if len(t['header_rows']) > 1:
            obj['header_rows'] = t['header_rows']
        rows = []
        for r in t['rows']:
            rid = self.sub_id(owner, 'table_rows')
            hdr = r['headers']
            pairs = []
            for k, c in enumerate(r['cells']):
                h = hdr[k] if k < len(hdr) else ''
                if c:
                    pairs.append(('%s: %s' % (h, c)) if h else c)
            text = '; '.join(pairs)
            row = OrderedDict([('id', rid), ('parent', owner['id']), ('cells', r['cells']), ('headers', hdr)])
            if r['group']:
                row['group'] = r['group']
            row['text'] = text
            row['hash'] = sha12(text)
            rows.append(row)
            if self.area == 'ORR' and r['cells_raw']:
                c0 = r['cells_raw'][0].strip()
                c0s = re.sub(r'^\{\s*\\tabfont\s*', '{', c0)
                bm = re.match(r'^\{?\s*\\textbf\{', c0s)
                if bm:
                    inner, endp = braced(c0s, c0s.find('\\textbf{') + 7)
                    rest = c0s[endp:].strip().strip('}').strip()
                    if not PLAIN(rest):
                        owner.setdefault('_bold_cells', []).append(PLAIN(inner))
        obj['rows'] = rows
        return obj, t

    def flow_table(self, e):
        s = self.s
        raw = s[e.b0:e.e1]
        b = self.new_block('table', e.name, e.b0)
        b['body_latex'] = raw
        self.emit(b, e.b0)
        obj, t = self.table_object(e, b)
        b['plain_text'] = '\n'.join(r['text'] for r in obj['rows'])
        b['caption'] = None
        b['label'] = None
        for k in ('title_row', 'headers', 'header_rows'):
            if k in obj:
                b[k] = obj[k]
        b['rows'] = obj['rows']
        self.finalize(b, [(raw[len('\\begin{%s}' % e.name):], 'table')], 'table')
        for row in b['rows']:
            for m in NUM_RE.finditer(row['text']):
                pass
        for bc in b.pop('_bold_cells', []):
            self.add_term(b, bc, 'bold_cell')
        self.last_visual = b
        self.pending_orsubb = None

    # ------------------------------------------------------------------ tikz
    def node_text(self, raw):
        out = []
        s = raw
        for m in re.finditer(r'(?<![A-Za-z])\\?node\b|\\addlegendentry\b|\b(?:xlabel|ylabel|title)\s*=\s*(?=\{)', s):
            j = m.end()
            if m.group(0).startswith('\\addlegendentry') or '=' in m.group(0):
                while j < len(s) and s[j] in ' \t\n':
                    j += 1
                if j < len(s) and s[j] == '{':
                    c, _ = braced(s, j)
                    out.append(c)
                continue
            n = len(s)
            for _ in range(8):
                while j < n and s[j] in ' \t\n':
                    j += 1
                if j < n and s[j] == '[':
                    _, j = bracketed(s, j)
                elif j < n and s[j] == '(':
                    d = 0
                    while j < n:
                        if s[j] == '(':
                            d += 1
                        elif s[j] == ')':
                            d -= 1
                            if d == 0:
                                j += 1
                                break
                        j += 1
                elif s.startswith('at', j):
                    j += 2
                else:
                    break
            if j < n and s[j] == '{':
                c, _ = braced(s, j)
                out.append(c)
        texts, seen = [], set()
        for c in out:
            c2 = re.sub(r'\\(x|y|i|p|q|c|t|b|a|n|r|d|l|v|w|h|lab|col|sub|thr|st|det|row)(?![A-Za-z])', ' ', c)
            tp = PLAIN(c2)
            tp = re.sub(r'\s*\n\s*', ' ', tp).strip()
            if not tp or tp in seen or not re.search(r'[A-Za-z0-9]', tp):
                continue
            seen.add(tp)
            texts.append(tp)
        return texts

    def tikz_object(self, e):
        raw = self.s[e.b0:e.e1]
        saved = PLAIN.unknown.copy()
        nodes = self.node_text(raw)
        PLAIN.unknown = saved
        return raw, nodes

    def flow_tikz(self, e):
        raw, nodes = self.tikz_object(e)
        b = self.new_block('tikzpicture', 'tikzpicture', e.b0)
        b['body_latex'] = raw
        b['plain_text'] = '\n'.join(nodes)
        b['caption'] = None
        b['label'] = None
        b['node_text'] = nodes
        self.emit(b, e.b0)
        self.finalize(b, [('\n'.join(nodes), 'nodes')], 'tikzpicture')
        self.last_visual = b
        self.pending_orsubb = None

    # ------------------------------------------------------------------ captions
    def caption(self, cap_latex, pos, macro):
        self.release_leadin()
        cap_plain = PLAIN(cap_latex)
        label = None
        m = CAPTION_LABEL_RE.match(cap_plain)
        if m:
            label = m.group(1)
            cap_plain = cap_plain[m.end():].strip()
        lv = self.last_visual
        self.last_visual = None
        if isinstance(lv, dict) and lv['type'] in ('table', 'tikzpicture') and lv.get('caption') is None:
            lv['caption'] = cap_plain
            lv['caption_latex'] = cap_latex.strip()
            lv['label'] = label
            self.mine(lv, cap_latex, 'caption', lv['type'])
            lv['cases'] = sorted(set(lv['cases']))
            lv['hash'] = sha12(lv['type'] + '|' + (lv.get('title') or '') + '|' + lv['body_latex'] + '|' +
                               cap_latex)
            return
        b = self.new_block('figcap', macro, pos)
        b['body_latex'] = cap_latex.strip()
        b['plain_text'] = cap_plain
        b['caption'] = cap_plain
        b['label'] = label
        if isinstance(lv, tuple) and lv[0] == 'image':
            b['image'] = 'notes/%s/%s' % (self.relpath.split('/')[0], lv[1])
            b['source_line'] = self.line(lv[2])
        self.emit(b, pos)
        self.finalize(b, [(cap_latex, 'caption')], 'figcap')
        self.pending_orsubb = None

    # ------------------------------------------------------------------ boxes
    def box_title(self, e):
        name = e.name
        arg = e.args[0] if e.args else None
        if name in MANDATORY_TITLE:
            return (PLAIN(arg[0]) if arg else None), False
        if arg is None:
            if name in LR_DEFAULT_TITLE:
                return LR_DEFAULT_TITLE[name], True
            return None, False
        content = arg[0]
        if name.startswith(KEYLIST_PREFIX) or name == 'orkeybox':
            m = re.search(r'(?:^|,)\s*title\s*=\s*', content)
            if not m:
                return None, False
            j = m.end()
            if j < len(content) and content[j] == '{':
                t, _ = braced(content, j)
            else:
                t = content[j:].split(',')[0]
            return PLAIN(t), False
        return PLAIN(content), False

    def box(self, e):
        s = self.s
        name = e.name
        ctype = BOX_ENVS[name]
        title, title_default = self.box_title(e)
        body = s[e.a:e.e0]
        # ---- children: tables and tikz inside the box
        child_tables, child_tikz = [], []

        def collect(envs, in_table=False):
            for c in envs:
                if c.name == 'tikzpicture':
                    child_tikz.append(c)
                    continue
                if c.name in TABLE_ENVS:
                    if not in_table:
                        child_tables.append(c)
                    continue
                collect(c.children, in_table)
        collect(e.children)
        figcaps = []
        for m in re.finditer(r'\\(figcap|orfigcap)(?![A-Za-z])', s[e.a:e.e0]):
            p = e.a + m.start()
            if any(c.b0 <= p < c.e1 for c in child_tables + child_tikz):
                continue
            args, j = read_args(s, e.a + m.end(), 'm')
            figcaps.append((p, e.a + m.end(), j, args[0][0] if args[0] else ''))
        mask_spans = [(c.b0 - e.a, c.e1 - e.a) for c in child_tables + child_tikz]
        mask_spans += [(p - e.a, j - e.a) for p, _, j, _ in figcaps]
        mined = mask(body, mask_spans)
        plain = PLAIN(mined)
        pos = e.b0

        # ---- meta / source notes
        before_first_lo = not self.first_lo_seen
        is_summary = bool(title and re.search(r'consolidated trap summary', title, re.I))
        meta_reason = None
        if ctype == 'srcbox':
            meta_reason = 'cisrcbox'
        elif ctype == 'notebox' and title and re.match(r'^(source note|about this chapter)$', title, re.I):
            meta_reason = 'notebox:%s' % title
        elif ctype in ('trapbox', 'keybox', 'notebox') and not is_summary:
            if title and META_TITLE_RE.search(title):
                meta_reason = 'title'
            elif ctype == 'trapbox' and before_first_lo and self.area in ('IM', 'CR', 'LTR', 'MR'):
                meta_reason = 'pre-LO %s' % name
            elif META_BODY_RE.search(plain) and ctype in ('trapbox', 'keybox'):
                meta_reason = 'body mentions crash/lecture layer or the reconciliation record'
        if meta_reason:
            kind = 'correction' if (title and CORRECTION_TITLE_RE.search(title)) else 'meta'
            if kind == 'meta' and title and re.search(r'label collision', title, re.I):
                kind = 'label_collision'
            sn = self.add_source_note(kind, title, plain, pos, name, raw=body, reason=meta_reason)
            if kind == 'correction':
                self.add_correction(sn, body, plain)
            if 'schweser' in body and '\\schweserbadge' in body:
                sn['provenance'] = 'schweser'
            return

        # ---- retyping
        btype = ctype
        subtype = None
        hand_title = None
        example_note = None
        if name == 'orkeybox':
            hm = re.match(r'\s*\{\s*\\sffamily\s*\\bfseries\s*(?:\\fontsize\{[^}]*\}\{[^}]*\}\s*)?'
                          r'(?:\\selectfont\s*)?\\color\{navy\}', body)
            if hm:
                t, endp = braced(body, body.index('{'))
                hand_title = PLAIN(re.sub(r'^\s*\\sffamily\s*\\bfseries\s*(?:\\fontsize\{[^}]*\}\{[^}]*\}\s*)?'
                                          r'(?:\\selectfont\s*)?\\color\{navy\}', '', t))
                title = hand_title
                mined = mask(mined, [(body.index('{'), endp)])
            has_math = bool(re.search(r'\\\[|\\begin\{align', body))
            has_list = bool(re.search(r'\\item\b', body))
            egm = re.search(r'\\color\{rust\}\s*\\itshape\s*(E\.g\.)', body)
            eg = None
            if egm:
                eg_latex = re.sub(r'\}\s*$', '', body[egm.start(1):].rstrip())
                eg = eg_latex
                # the aside's opening brace: last '{' before the colour command
                ob = body.rfind('{', 0, egm.start())
                eg_span = (ob, len(body))
            if has_math:
                btype = 'fmlbox'
                self.infer('retype', 'orkeybox with display math -> fmlbox', pos)
            elif hand_title and not has_list and (eg or (self.reading['reading_id'], hand_title)
                                                  in ORKEY_DEFBOX_EXTRA):
                btype = 'defbox'
                if eg:
                    example_note = PLAIN(eg)
                    mined = mask(mined, [eg_span])
                self.infer('retype', 'orkeybox with hand-made title %r + short definition -> defbox'
                           % hand_title, pos)
        elif name == 'orexambox':
            if title and OREXAM_KEYBOX_RE.search(title):
                btype = 'keybox'
                self.infer('retype', 'orexambox %r is not a worked example -> keybox' % title, pos)
        elif name == 'cidefbox' and title and re.match(r'the point to hold on to', title, re.I):
            btype = 'keybox'
            self.infer('retype', 'cidefbox %r is a takeaway -> keybox' % title, pos)
        elif ctype == 'notebox':
            subtype = 'note'
            for rx, st in NOTEBOX_SUBTYPE:
                if title and rx.search(title):
                    subtype = st
                    break
            else:
                self.infer('notebox', 'notebox title %r has no mapped subtype; defaulted to "note"' % title, pos)

        plain = PLAIN(mined)
        b = self.new_block(btype, name, pos, title)
        if title_default:
            b['title_default'] = True
        if subtype:
            b['subtype'] = subtype
        if btype != ctype:
            b['retyped_from'] = ctype
        b['body_latex'] = body.strip()
        b['plain_text'] = plain
        if example_note:
            b['example_note'] = example_note
        if '\\schweserbadge' in body:
            b['provenance'] = 'schweser'
        # gap scope and the rest via emit
        self.emit(b, pos)
        b['_end'] = e.e1

        # ---- type specifics
        fragments = [(mined, 'text')]
        where = btype
        if btype == 'trapbox' and title and CONTENT_LIST_RE.search(title):
            b['content_list'] = True
            self.infer('trap', 'trapbox %r is a content list: content_list=true, bullets not emitted as traps'
                       % title, pos)
        if btype == 'fmlbox':
            vks = []
            for m in re.finditer(r'\\(vk|mrvk)(?![A-Za-z])', mined):
                args, j = read_args(mined, m.end(), 'm' if m.group(1) == 'vk' else 'mm')
                vks.append((args[0][0] if args[0] else '', args[1][0] if m.group(1) == 'mrvk' and args[1] else None))
            for vk, remark in vks:
                self.apply_vk(b, vk, remark)
            if name == 'orkeybox':
                for v in parse_where_math(mined):
                    self.add_variable(b, v)
                wm = re.search(r'\bwhere\b(.*)$', mined, re.S)
                if wm:
                    b['notation_key'] = PLAIN(wm.group(1))
            b.setdefault('notation_key', None)
        if btype == 'exbox':
            self.exbox_specifics(b, body, e, child_tables)
        # shared notation blocks
        if title and re.match(r'notation used', title, re.I):
            self.infer('variables', 'shared notation block %r: variables emitted from its rows/bullets' % title, pos)
            for _, it, _, _ in list_items(mined):
                for v in parse_vk(it):
                    self.add_variable(b, v)

        # ---- children
        mcq_tables = set(id(c) for c in b.pop('_mcq_tables', []))
        tables, figures = [], []
        caps = sorted(figcaps)
        visuals = sorted([('table', c) for c in child_tables if id(c) not in mcq_tables] +
                         [('tikz', c) for c in child_tikz], key=lambda x: x[1].b0)
        for kind, c in visuals:
            if kind == 'table':
                obj, t = self.table_object(c, b)
                obj['id'] = '%s.table.%d' % (b['id'], len(tables) + 1)
                obj['body_latex'] = s[c.b0:c.e1]
                obj['caption'] = None
                tables.append((c, obj))
                if title and re.match(r'notation used', title, re.I):
                    for row in obj['rows']:
                        if len(row['cells']) >= 2 and row['cells'][0]:
                            self.add_variable(b, {'symbol': row['cells'][0], 'definition': row['cells'][1],
                                                  'shared': False})
            else:
                raw, nodes = self.tikz_object(c)
                obj = OrderedDict([('id', '%s.tikzpicture.%d' % (b['id'], len(figures) + 1)),
                                   ('body_latex', raw), ('caption', None), ('node_text', nodes)])
                figures.append((c, obj))
        loose_caps = []
        for p, _, j, cap in caps:
            prev = [x for x in tables + figures if x[0].e1 <= p]
            prev.sort(key=lambda x: x[0].e1)
            if prev and prev[-1][1]['caption'] is None and not PLAIN(s[prev[-1][0].e1:p]).strip():
                o = prev[-1][1]
                cp = PLAIN(cap)
                lm = CAPTION_LABEL_RE.match(cp)
                o['caption'] = cp[lm.end():].strip() if lm else cp
                if lm:
                    o['label'] = lm.group(1)
                fragments.append((cap, 'caption'))
            else:
                loose_caps.append(PLAIN(cap))
                fragments.append((cap, 'caption'))
        if tables:
            b['tables'] = [o for _, o in tables]
            for c, o in tables:
                fragments.append((s[c.a:c.e0], 'table'))
        if figures:
            b['figures'] = [o for _, o in figures]
            for c, o in figures:
                fragments.append(('\n'.join(o['node_text']), 'nodes'))
        if loose_caps:
            b['figcaps'] = loose_caps
        self.finalize(b, fragments, where)
        for bc in b.pop('_bold_cells', []):
            self.add_term(b, bc, 'bold_cell')
        if btype == 'defbox' and title and not title_default and not re.match(
                r'^(definition|notation|key terms?)\b', title, re.I):
            self.add_term(b, title, 'deftitle')
        # traps
        if btype == 'trapbox' and not b.get('content_list'):
            self.box_traps(b, mined, title, is_summary, pos)
        self.last_visual = None
        self.pending_orsubb = None

    # ------------------------------------------------------------------ fml helpers
    def add_variable(self, b, v):
        b.setdefault('variables', [])
        vid = self.sub_id(b, 'variables')
        item = OrderedDict([('id', vid), ('parent', b['id']), ('symbol', v['symbol']),
                            ('definition', v['definition'])])
        if v.get('shared'):
            item['shared_definition'] = True
        item['hash'] = sha12(v['symbol'] + '=' + v['definition'])
        b['variables'].append(item)

    def apply_vk(self, b, vk, remark):
        vp = PLAIN(vk)
        b['notation_key'] = ((b.get('notation_key') or '') + ('\n' if b.get('notation_key') else '') + vp)
        vs = parse_vk(vk)
        for v in vs:
            self.add_variable(b, v)
        if not vs:
            b['note'] = ((b.get('note') or '') + ('\n' if b.get('note') else '') + vp)
        if remark and remark.strip():
            b['vk_remark'] = PLAIN(remark)

    # ------------------------------------------------------------------ exbox helpers
    def exbox_specifics(self, b, body, e, child_tables):
        parts = re.split(r'\\tcblower\b', body, 1)
        b['question_latex'] = parts[0].strip()
        b['solution_latex'] = parts[1].strip() if len(parts) > 1 else None
        steps = []
        bspans = [(a, b_) for a, b_, _ in find_math_spans(body)]
        marks = list(re.finditer(r'\\(?:textbf|term)\{\s*((?:Step\s*\d+|What this means)[^{}]*(?:\{[^{}]*\}[^{}]*)*)\}',
                                 body))
        marks = [m for m in marks if not any(a <= m.start() < b_ for a, b_ in bspans)]
        for k, m in enumerate(marks):
            end = marks[k + 1].start() if k + 1 < len(marks) else len(body)
            label = PLAIN(m.group(1)).strip()
            sm = re.match(r'Step\s*(\d+)', label)
            steps.append(OrderedDict([('n', int(sm.group(1)) if sm else None), ('label', label),
                                      ('text', PLAIN(body[m.end():end]))]))
        if steps:
            b['steps'] = steps
        # MCQ
        options, mcq_tables = [], []
        for c in child_tables:
            t = parse_table(self.s[c.a:c.e0])
            opts = []
            for r in t['rows']:
                if r['cells'] and re.match(r'^\(?([A-D])[.)]?\)?$', r['cells'][0].strip()):
                    opts.append(OrderedDict([('label', re.sub(r'\W', '', r['cells'][0])),
                                             ('text', ' '.join(x for x in r['cells'][1:] if x))]))
            if len(opts) >= 3:
                options = opts
                mcq_tables.append(c)
        if not options:
            for label, it, depth, env in list_items(body):
                pass
            lm = re.search(r'\\begin\{enumerate\}\[[^\]]*\\Alph\*', body)
            if lm:
                sub = body[lm.start():]
                end = sub.find('\\end{enumerate}')
                items = list_items(sub[:end + len('\\end{enumerate}')])
                letters = 'ABCDEFG'
                options = [OrderedDict([('label', letters[k]), ('text', PLAIN(it))])
                           for k, (_, it, _, _) in enumerate(items[:7])]
        if options:
            am = re.search(r'Answer:?\s*(?:\\(?:textbf|term)\{)?\s*(?:Answer:?\s*)?\(?([A-D])\b', body)
            b['mcq'] = OrderedDict([('options', options), ('answer', am.group(1) if am else None)])
            b['_mcq_tables'] = mcq_tables
        # grouping of continued examples
        title = b.get('title') or ''
        prev = next((x for x in reversed(self.obj['blocks'][:-1]) if x['type'] == 'exbox'), None)
        if re.match(r'^step\s*1\b', title, re.I):
            b['group'] = b['id']
        elif re.match(r'^(step\s*\d+|.*continued)', title, re.I) and prev is not None:
            prev.setdefault('group', prev['id'])
            b['group'] = prev['group']
            self.infer('exbox_group', '%s grouped with %s (title %r)' % (b['id'], prev['group'], title),
                       e.b0)

    # ------------------------------------------------------------------ traps
    def box_traps(self, b, mined, title, is_summary, pos):
        origin = 'summary' if is_summary else 'trapbox'
        items = [(lab, it) for lab, it, depth, env in list_items(mined) if depth == 1]
        entries = []
        if items:
            for lab, it in items:
                entries.append(it)
            form = 'bullet'
        else:
            paras = [p for p in re.split(r'\n\s*\n|\\smallskip|\\medskip|\\par\b', mined) if PLAIN(p)]
            runins = [p for p in paras if re.match(r'\s*\\(textbf|term)\{[^{}]{1,60}[.:]\}', p)]
            if len(runins) >= 2 and len(runins) == len([p for p in paras if len(words(PLAIN(p))) > 3]):
                entries = runins
                form = 'runin'
            else:
                entries = [mined]
                form = 'box'
        for raw in entries:
            category = raw_cat = lo_ref = None
            cat_source = None
            text_latex = raw
            m = re.match(r'\s*\\(textbf|term)\{', raw)
            if m:
                lead, endp = braced(raw, m.end() - 1)
                lp = PLAIN(lead).strip()
                core = lp
                lr = re.match(r'^(.*?),\s*((?:MR|LTR|IM|ORR|CR|CI)-\d+(?:\s*[a-q])?)\.?$', lp)
                if lr:
                    core, lo_ref = lr.group(1), lr.group(2)
                key = clean_term(core).lower()
                if key in CATMAP:
                    raw_cat = clean_term(core)
                    category = CATMAP[key]
                    cat_source = 'label'
                    text_latex = raw[endp:]
            if category is None and form == 'box' and title:
                tm = TITLE_CAT_RE.match(title)
                if tm:
                    raw_cat = tm.group(1)
                    category = CATMAP.get(raw_cat.lower())
                    cat_source = 'title'
                    self.infer('trap', 'box-level trap %s category %s read from the box title %r'
                               % (b['id'], category, title), pos)
            text = PLAIN(text_latex)
            if not text:
                continue
            if category == '#SOURCE':
                sn = self.add_source_note(raw_cat.lower(), title, text, pos, b['env'])
                sn['source_block'] = b['id']
                continue
            correct, corrupted, rule = split_correct_corrupt(text)
            self.traps.append(OrderedDict([
                ('category', category), ('raw_category', raw_cat), ('text', text),
                ('correct_text', correct), ('corrupted_text', corrupted), ('split_rule', rule),
                ('origin', origin), ('form', form), ('lo_ref', lo_ref), ('category_source', cat_source),
                ('source_block', b['id']), ('source_line', b['source_line']),
                ('category_inferred', False)]))

    # ------------------------------------------------------------------ source notes / corrections
    def add_source_note(self, kind, title, text, pos, env, raw=None, reason=None):
        n = len(self.source_notes) + 1
        sn = OrderedDict([('id', '%s.source_note.%d' % (self.rid_low(), n)), ('kind', kind),
                          ('title', title), ('text', text), ('env', env),
                          ('objective', self.obj['letter'] if self.obj else None),
                          ('source_line', self.line(pos))])
        if reason:
            sn['reason'] = reason
        sn['hash'] = sha12(text)
        self.source_notes.append(sn)
        return sn

    def add_correction(self, sn, body, plain):
        as_written = None
        qm = re.search(r'``(.+?)\'\'', body, re.S)
        if qm and re.search(r'print|instruct|as printed|state|recorded', body[:qm.start() + 200], re.I):
            as_written = PLAIN(qm.group(1))
        as_corrected = None
        for m in re.finditer(r'\\textbf\{', body):
            t, _ = braced(body, m.end() - 1)
            tp = PLAIN(t)
            if len(words(tp)) >= 5:
                as_corrected = tp
                break
        if as_corrected is None:
            m = re.search(r'(The correct[^.]*?:.*?\.(?=\s|$)|The GARP form[^.]*\.)', plain, re.S)
            if m:
                as_corrected = m.group(1).strip()
        self.corrections.append(OrderedDict([
            ('where', '%s %s' % (self.reading['reading_id'], sn['objective'])), ('source_note', sn['id']),
            ('title', sn['title']), ('as_written', as_written), ('as_corrected', as_corrected),
            ('determinable', as_written is not None and as_corrected is not None),
            ('source_file', self.source_file), ('source_line', sn['source_line'])]))

    # ------------------------------------------------------------------ assemble
    def assemble(self):
        r = self.reading
        # source citation from the intro keybox 'Source:' line
        if r['source_citation'] is None:
            intro = self.objectives[0]
            for blk in intro['blocks']:
                m = re.search(r'Source:\s*(.+)', blk.get('plain_text') or '')
                if m:
                    r['source_citation'] = m.group(1).strip()
                    break
        # traps: ids per category
        tc = Counter()
        traps = []
        for t in self.traps:
            cat = t['category']
            key = cat.lower().replace(' ', '_') if cat else 'uncategorized'
            tc[key] += 1
            tid = '%s.trap.%s.%d' % (self.rid_low(), key, tc[key])
            item = OrderedDict([('id', tid)])
            item.update(t)
            item['hash'] = sha12(t['text'])
            traps.append(item)
        for o in self.objectives:
            for blk in o['blocks']:
                blk.pop('_end', None)
        r['objectives'] = self.objectives
        r['traps'] = traps
        r['source_notes'] = self.source_notes
        r['corrections'] = self.corrections
        r['dropped_fragments'] = [OrderedDict([('line', ln), ('text', t)]) for ln, t in self.dropped]
        return r


def numeric_parse(txt):
    t = txt.replace('\\%', '%').replace('\\$', '$')
    m = re.search(r'-?\d[\d,]*(?:\.\d+)?', t)
    val = None
    if m:
        try:
            val = float(m.group(0).replace(',', ''))
            if val == int(val) and '.' not in m.group(0):
                val = int(val)
        except ValueError:
            val = None
    unit = None
    low = t.lower()
    if '%' in t or 'percent' in low or 'per cent' in low:
        unit = '%'
    elif re.search(r'\bbps?\b|basis point', low):
        unit = 'bp'
    elif re.search(r'\$|usd|eur|gbp|cad|chf|jpy|€|£', low):
        unit = 'currency'
    if re.search(r'trillion', low):
        scale = 'trillion'
    elif re.search(r'billion|\bbn\b', low):
        scale = 'billion'
    elif re.search(r'million|\d\s?m\b', low):
        scale = 'million'
    else:
        scale = None
    out = OrderedDict([('value', val), ('unit', unit)])
    if scale:
        out['scale'] = scale
    return out


# ============================================================================= derived structures
MECH_RULES = [
    ('table', 3, ['Bucket Drop', 'Severity Grid', 'Table Fill']),
    ('exbox', 2, ['Order Game', 'Stepwise Derivation']),
    ('fmlbox', 3, ['Parameter Playground', 'Formula Assembler']),
    ('trapbox', 2, ['Shatter', 'Trap Shape Trainer', 'Confusables Duel']),
    ('role_traps', 5, ['Party Line']),
    ('cross_refs', 3, ['Lineage Tree', 'Fingerprint']),
    ('cases', 2, ['Case Docket', 'Scenario Router']),
    ('numeric_items', 5, ['Threshold Slider']),
    ('tikzpicture', 3, ['Explorable']),
]


def iter_blocks(reading):
    for o in reading['objectives']:
        for b in o['blocks']:
            yield o, b


def all_rows(b):
    for r in b.get('rows', []):
        yield r
    for t in b.get('tables', []):
        for r in t.get('rows', []):
            yield r


def reading_stats(r):
    st = Counter()
    targets, cases = set(), set()
    for o, b in iter_blocks(r):
        st[b['type']] += 1
        st['numeric_items'] += len(b.get('numeric_items', []))
        for x in b.get('cross_refs', []):
            targets.add(x['target'])
        cases.update(b.get('cases', []))
    st['role_traps'] = sum(1 for t in r['traps'] if t['category'] == 'Role')
    st['cross_refs'] = len(targets)
    st['cases'] = len(cases)
    st['objectives'] = sum(1 for o in r['objectives'] if o['letter'] not in ('intro', 'basics', 'summary'))
    return st, sorted(targets), sorted(cases)


def derive(readings):
    for rid, r in readings.items():
        st, targets, cases = reading_stats(r)
        mech = []
        basis = OrderedDict()
        for key, th, names in MECH_RULES:
            basis[key] = st[key]
            if st[key] >= th:
                mech.extend(names)
        basis['objectives'] = st['objectives']
        if not mech and st['objectives'] >= 5:
            mech.append('Concept Inventory')
        r['mechanics_supported'] = mech
        r['mechanics_basis'] = basis
        r['cross_ref_targets'] = targets
        r['cases'] = cases
    trap_index = OrderedDict((c, []) for c in CATEGORIES + ['Uncategorized'])
    subidx = OrderedDict((k, []) for k in ['terms', 'bullets', 'numeric_items', 'variables', 'table_rows',
                                           'section_headings', 'bold_claims'])
    corrections = []
    for rid, r in readings.items():
        for t in r['traps']:
            trap_index[t['category'] or 'Uncategorized'].append(t['id'])
        for o in r['objectives']:
            subidx['section_headings'].extend(h['id'] for h in o['section_headings'])
            for b in o['blocks']:
                for k in ('terms', 'bullets', 'numeric_items', 'variables', 'bold_claims'):
                    subidx[k].extend(x['id'] for x in b.get(k, []))
                subidx['table_rows'].extend(x['id'] for x in all_rows(b))
        corrections.extend(r['corrections'])
    return trap_index, subidx, corrections


# ============================================================================= driver
def list_files():
    out = []
    for vol in VOLS:
        d = os.path.join(NOTES, vol, 'ch')
        for f in sorted(os.listdir(d)):
            if f.endswith('.tex'):
                out.append(os.path.join(vol, 'ch', f))
    return out


def area_key(rid):
    area, num = rid.split('-')
    return (AREA_ORDER.index(area), int(num))


def extract_all(log):
    ctx = master_context()
    files = list_files()
    parsed = []
    for rel in files:
        p = ReadingParser(rel, ctx, log)
        r = p.run()
        parsed.append((rel, r, p))
    parsed.sort(key=lambda x: area_key(x[1]['reading_id']))
    readings = OrderedDict()
    sources = OrderedDict()
    for rel, r, p in parsed:
        if r['reading_id'] in readings:
            log['deviations'].append((r['reading_id'], 'duplicate reading id in %s' % rel))
        readings[r['reading_id']] = r
    for rel in files:
        raw = open(os.path.join(NOTES, rel), encoding='utf-8').read()
        sources['notes/' + rel] = OrderedDict([('readings', 1), ('lines', raw.count('\n') + (0 if raw.endswith('\n') else 1)),
                                               ('sha1', hashlib.sha1(raw.encode('utf-8')).hexdigest()[:12])])
    return readings, sources, parsed


def build(generated, log):
    readings, sources, parsed = extract_all(log)
    trap_index, subidx, corrections = derive(readings)
    doc = OrderedDict()
    doc['version'] = VERSION
    doc['generated'] = generated
    doc['generator'] = 'tools/notes/extract.py'
    doc['block_types'] = BLOCK_TYPES
    doc['trap_categories'] = CATEGORIES
    doc['sources'] = sources
    doc['readings'] = readings
    doc['trap_index'] = trap_index
    doc['sub_item_index'] = subidx
    doc['corrections_index'] = corrections
    return doc, parsed


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1) + '\n'


def new_log():
    return {'inferences': [], 'deviations': [], 'unresolved_envs': []}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', help='print one reading (file name, path or reading id) to stdout')
    ap.add_argument('--generated', help='ISO 8601 timestamp to embed (default: now, UTC)')
    ap.add_argument('--stdout', action='store_true', help='print the full JSON to stdout, write nothing')
    ap.add_argument('--no-report', action='store_true', help='write the JSON only')
    ap.add_argument('--no-determinism-check', action='store_true', help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    generated = args.generated or datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0) \
        .isoformat().replace('+00:00', 'Z')
    log = new_log()
    if args.only:
        ctx = master_context()
        want = args.only
        rel = None
        for f in list_files():
            if want in (f, os.path.basename(f), 'notes/' + f) or f.endswith('/' + want):
                rel = f
        if rel is None:
            for f in list_files():
                m = re.match(r'\d+_[A-Z]+_([A-Z]+)(\d+)\.tex', os.path.basename(f))
                code = m.group(1)
                code = {'LTR': 'LTR'}.get(code, code)
                if want.upper().replace('-', '') == (m.group(1) + m.group(2)):
                    rel = f
        if rel is None:
            raise SystemExit('no such reading: %s' % want)
        # parse everything so derived per-reading fields match the full run
        readings, _, _ = extract_all(log)
        derive(readings)
        r = next(v for v in readings.values() if v['source_file'] == 'notes/' + rel)
        sys.stdout.write(dumps(r))
        return 0
    doc, parsed = build(generated, log)
    text = dumps(doc)
    if args.stdout:
        sys.stdout.write(text)
        return 0
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as fh:
        fh.write(text)
    if not args.no_report:
        det = None if args.no_determinism_check else determinism_check(generated, text)
        report = coverage_report(doc, parsed, log, len(text.encode('utf-8')), det)
        with open(OUT_MD, 'w', encoding='utf-8') as fh:
            fh.write(report)
    sys.stderr.write('wrote %s (%d bytes)\n' % (os.path.relpath(OUT_JSON, ROOT), len(text.encode('utf-8'))))
    return 0


# ============================================================================= determinism check
def determinism_check(generated, text):
    """Re-run the extractor in fresh interpreters with different hash seeds and compare bytes."""
    res = OrderedDict()
    me = os.path.abspath(__file__)
    env = dict(os.environ)
    outs = []
    for seed in ('1', '2'):
        env['PYTHONHASHSEED'] = seed
        p = subprocess.run([sys.executable, me, '--stdout', '--generated', generated], env=env,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        outs.append(p.stdout.decode('utf-8'))
    res['full_runs'] = 2
    res['full_identical_to_written'] = all(o == text for o in outs)
    one = []
    for seed in ('3', '4'):
        env['PYTHONHASHSEED'] = seed
        p = subprocess.run([sys.executable, me, '--only', '01_LR_LTR1.tex'], env=env,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        one.append(p.stdout)
    res['only_file'] = '01_LR_LTR1.tex'
    res['only_identical'] = one[0] == one[1] and len(one[0]) > 0
    res['only_bytes'] = len(one[0])
    alt = subprocess.run([sys.executable, me, '--stdout', '--generated', '1999-01-01T00:00:00Z'], env=env,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode('utf-8')
    a_lines = [l for l in text.split('\n')]
    b_lines = [l for l in alt.split('\n')]
    diff = [k for k in range(max(len(a_lines), len(b_lines)))
            if (a_lines[k] if k < len(a_lines) else None) != (b_lines[k] if k < len(b_lines) else None)]
    res['timestamp_only_diff_lines'] = len(diff)
    res['timestamp_only_diff_is_generated'] = all('"generated"' in a_lines[k] for k in diff)
    return res


# ============================================================================= coverage report
def load_census():
    spec = importlib.util.spec_from_file_location('census', os.path.join(HERE, 'census.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rows = {}
    for vol in VOLS:
        d = os.path.join(NOTES, vol, 'ch')
        for f in sorted(os.listdir(d)):
            if f.endswith('.tex'):
                rows['notes/%s/ch/%s' % (vol, f)] = mod.census_file(os.path.join(d, f))
    return rows


KNOWN_TEXT_MACROS = set('''
term textbf emph textit textsf texttt textsc textnormal text mbox underline textup textmd textrm thd thead
tsub hdr note greyline gapnote srcnote figcap orfigcap figwrap vk mrvk lo lohead basics reading chapterhead
section subsection subsubsection orsub orsubb gapbadge schweserbadge includegraphics markboth begin end item
par newline smallskip medskip bigskip vspace hspace noindent centering raggedright raggedleft small footnotesize
scriptsize tiny large Large LARGE normalsize sffamily bfseries itshape mdseries selectfont fontsize color
textcolor colorbox rowcolor cellcolor arrayrulecolor renewcommand setlength arraystretch tabcolsep toprule
midrule bottomrule hline cmidrule addlinespace endhead endfirsthead endfoot endlastfoot multicolumn tabfont
chip chiplow chipmod chiphigh chipvhigh quad qquad tcblower textbullet euro texteuro checkmark S ldots dots
textonehalf linewidth textwidth arraybackslash label needspace clearpage relax pgnum pgdash rule phantom
raisebox parbox makebox textsuperscript tagword tagpill srcpill boxed displaystyle textstyle hfill
blacktriangleright bullet alph Alph arabic roman Roman baselineskip dimexpr kill
'''.split())


def scan_unresolved(parsed):
    """Text-mode macros outside math and tikz that are neither standard nor defined in the preambles."""
    pre = set()
    for vol in VOLS:
        s = open(os.path.join(NOTES, vol, 'preamble.tex'), encoding='utf-8').read()
        pre.update(re.findall(r'\\(?:newcommand|renewcommand|DeclareRobustCommand)\{?\\([A-Za-z]+)', s))
        pre.update(re.findall(r'\\newenvironment\{([A-Za-z*]+)\}', s))
        pre.update(re.findall(r'\\newtcolorbox\{([A-Za-z*]+)\}', s))
        pre.update(re.findall(r'\\newlist\{([A-Za-z*]+)\}', s))
    known = KNOWN_TEXT_MACROS | pre
    out = []
    for rel, r, p in parsed:
        s = p.s
        spans = [(e.b0, e.e1) for e in walk_envs(p.envs) if e.name == 'tikzpicture']
        spans += [(a, b) for a, b, _ in find_math_spans(s)]
        spans.sort()
        for m in re.finditer(r'(?<!\\)\\([A-Za-z]+)', s):
            name = m.group(1)
            if name in known:
                continue
            pos = m.start()
            if any(a <= pos < b for a, b in spans):
                continue
            out.append((p.source_file, p.line(pos), name))
    return out


def coverage_report(doc, parsed, log, size, det):
    readings = doc['readings']
    census = load_census()
    L = []
    w = L.append
    w('# Extraction coverage report')
    w('')
    w('Generated by `tools/notes/extract.py` at %s. Output: `content/games/game-blocks.json` (%s bytes, %.2f MB).'
      % (doc['generated'], format(size, ','), size / 1e6))
    w('Sources: `notes/FRM_Consolidated_Vol1/ch/*.tex` (ORR, CR, CI) and `notes/FRM_Consolidated_Vol2/ch/*.tex` '
      '(MR, LTR, IM). Spec: `docs/notes-games-brief.md` Part A with the overrides in `PORTAL_PLAN.md` §3c and '
      'the Phase 1 audit rules (listed in 6.6).')
    w('')
    # headline counts
    nobj = sum(1 for r in readings.values() for o in r['objectives'] if o['letter'] not in ('intro', 'basics', 'summary'))
    nblocks = sum(len(o['blocks']) for r in readings.values() for o in r['objectives'])
    ntraps = sum(len(r['traps']) for r in readings.values())
    w('**Status:** %d readings, %d learning objectives, %d blocks, %d traps, %d source notes, %d corrections.'
      % (len(readings), nobj, nblocks, ntraps, sum(len(r['source_notes']) for r in readings.values()),
         len(doc['corrections_index'])))
    w('')
    # 6.1
    w('## 6.1 Readings parsed per area')
    w('')
    w('| Area | Expected | Parsed | Objectives (LO) | Census LOs | Match |')
    w('|---|---|---|---|---|---|')
    per_area = Counter(r['area'] for r in readings.values())
    for area, exp in EXPECTED.items():
        lo = sum(1 for r in readings.values() if r['area'] == area for o in r['objectives']
                 if o['letter'] not in ('intro', 'basics', 'summary'))
        clo = sum(c['n_objectives'] for f, c in census.items() if c['area'] == area)
        w('| %s | %d | %d | %d | %d | %s |' % (area, exp, per_area[area], lo, clo,
                                                'yes' if exp == per_area[area] and lo == clo else '**no**'))
    w('| **Total** | %d | %d | %d | %d | |' % (sum(EXPECTED.values()), len(readings), nobj,
                                               sum(c['n_objectives'] for c in census.values())))
    w('')
    mism = []
    for rid, r in readings.items():
        lo = sum(1 for o in r['objectives'] if o['letter'] not in ('intro', 'basics', 'summary'))
        c = census[r['source_file']]['n_objectives']
        if lo != c:
            mism.append('%s: extracted %d, census %d' % (rid, lo, c))
    w('Per-reading objective check against `census.py` n_objectives: %s.' % (
        'all %d readings match' % len(readings) if not mism else '; '.join(mism)))
    w('')
    # 6.2
    w('## 6.2 Unresolved macros')
    w('')
    unres = scan_unresolved(parsed)
    if log['unresolved_envs']:
        w('Environments not in the alias map: ' + ', '.join('`%s` (%s:%d)' % (n, f, l) for f, l, n in log['unresolved_envs']))
    else:
        w('Every environment resolved (alias map, containers, lists, tables, TikZ, math).')
    w('')
    if unres:
        by = OrderedDict()
        for f, l, n in unres:
            by.setdefault(n, []).append('%s:%d' % (f.replace('notes/', ''), l))
        w('Text-mode macros (outside math and TikZ) not defined in either preamble and not standard LaTeX:')
        w('')
        w('| Macro | Uses | Where | Handling |')
        w('|---|---|---|---|')
        handling = {'euro': 'mapped to €', 'texteuro': 'mapped to €'}
        for n, locs in sorted(by.items()):
            w('| `\\%s` | %d | %s | %s |' % (n, len(locs), ', '.join(locs[:6]) + (' …' if len(locs) > 6 else ''),
                                           handling.get(n, 'name dropped, content kept')))
    else:
        w('No unresolved text-mode macros.')
    w('')
    w('Inside math, macros are left for KaTeX (`\\euro`/`\\texteuro` rewritten to `\\text{€}`). Inside TikZ, pgf '
      '`\\foreach` loop variables (`\\x \\i \\p \\c \\t \\b …`) are not macros and are skipped; only node text is '
      'converted.')
    w('')
    if PLAIN.unknown:
        w('Macros the plain-text converter did not recognise (name dropped, arguments kept): ' +
          ', '.join('`\\%s` ×%d' % (k, v) for k, v in sorted(PLAIN.unknown.items())) + '.')
        w('')
    # 6.3
    w('## 6.3 Deviating readings')
    w('')
    devs = OrderedDict()
    for rid, d in log['deviations']:
        devs.setdefault(rid, []).append(d)
    for rid, r in readings.items():
        extra = []
        if r['source_citation'] is None:
            extra.append('no source citation in the notes (no intro "Source:" line, no top \\srcnote)')
        los = [o for o in r['objectives'] if o['letter'] not in ('intro', 'basics', 'summary')]
        empty = [o['letter'] for o in los if not o['blocks']]
        if empty:
            extra.append('objective(s) %s carry no blocks (heading only; content sits under the next LO)'
                         % ', '.join(empty))
        intro_items = sum(len(b.get('bullets', [])) for b in r['objectives'][0]['blocks']
                          if b['type'] == 'keybox' and 'objective' in (b.get('title') or '').lower())
        if r['area'] in ('LTR', 'IM') and not any(t['origin'] == 'summary' for t in r['traps']):
            extra.append('no Consolidated trap summary')
        if extra:
            devs.setdefault(rid, []).extend(extra)
    clean = [rid for rid in readings if rid not in devs]
    w('%d readings parsed with no deviation; %d carry a note below. None blocked extraction.' % (len(clean), len(devs)))
    w('')
    for rid in sorted(devs, key=area_key):
        w('- **%s**: %s' % (rid, '; '.join(devs[rid])))
    w('')
    # 6.4
    w('## 6.4 Block census by canonical type')
    w('')
    types = BLOCK_TYPES
    cnt = OrderedDict((a, Counter()) for a in EXPECTED)
    for r in readings.values():
        for o, b in iter_blocks(r):
            cnt[r['area']][b['type']] += 1
    ccnt = OrderedDict((a, Counter()) for a in EXPECTED)
    for f, c in census.items():
        for k, v in c['blocks'].items():
            ccnt[c['area']][k] += v
        for k, v in c['unmapped'].items():
            ccnt[c['area']][k] += v
    w('| Type | ' + ' | '.join(EXPECTED) + ' | Total | Census |')
    w('|---|' + '---|' * (len(EXPECTED) + 2))
    for t in types:
        tot = sum(cnt[a][t] for a in EXPECTED)
        ctot = sum(ccnt[a][t] for a in EXPECTED) if t != 'notebox' else sum(ccnt[a]['ornotebox'] for a in EXPECTED)
        w('| %s | %s | %d | %d |' % (t, ' | '.join(str(cnt[a][t]) for a in EXPECTED), tot, ctot))
    nested_t = sum(len(b.get('tables', [])) for r in readings.values() for o, b in iter_blocks(r))
    nested_f = sum(len(b.get('figures', [])) for r in readings.values() for o, b in iter_blocks(r))
    mcq = sum(1 for r in readings.values() for o, b in iter_blocks(r) if 'mcq' in b)
    retyped = Counter('%s→%s' % (b['retyped_from'], b['type']) for r in readings.values()
                      for o, b in iter_blocks(r) if 'retyped_from' in b)
    sn_by_env = Counter()
    for r in readings.values():
        for sn in r['source_notes']:
            if sn.get('env'):
                t = BOX_ENVS.get(sn['env'], sn['env'])
                sn_by_env[t] += 1
    capt = Counter()
    for r in readings.values():
        for o, b in iter_blocks(r):
            if b['type'] in ('table', 'tikzpicture') and b.get('caption') is not None:
                capt[b['type']] += 1
    prose_forms = Counter(b.get('form') for r in readings.values() for o, b in iter_blocks(r) if b['type'] == 'prose_para')
    w('')
    w('How the extracted counts reconcile with `tools/notes/census.py` (the census counts environments; the '
      'extractor counts playable blocks):')
    w('')
    w('- **Source/meta boxes removed from content** (to `source_notes`): %s.' % ', '.join(
        '%s %d' % (k, v) for k, v in sorted(sn_by_env.items())))
    w('- **Retyped by content** (env kept in `env`): %s.' % ', '.join('%s %d' % (k, v) for k, v in sorted(retyped.items())))
    w('- **Tables/figures nested in boxes** are children of the box (`tables` %d, `figures` %d), not top-level '
      'blocks; %d exbox MCQ option tables became `mcq` and are not tables.' % (nested_t, nested_f, mcq))
    w('- **Captions**: a `\\figcap`/`\\orfigcap` right after a table or TikZ figure is that block\'s `caption` '
      '(%d tables, %d figures), so `figcap` blocks are only standalone or image captions. The census counted '
      'every caption macro.' % (capt['table'], capt['tikzpicture']))
    w('- **prose_para**: %s. The census over-counted prose by leaking continuation lines of multi-line macro '
      'arguments (figcap, srcnote, gapnote, lohead titles); the extractor consumes full braced arguments. Top-level '
      'lists are prose_para with `form: "list"` (the census masked all lists). Gap-fill rationale notes are '
      '`gap_note` fields, loose display math after a formula is an fmlbox `substitutions` entry.'
      % ', '.join('%s %d' % (k, v) for k, v in sorted(prose_forms.items())))
    w('')
    # 6.5
    w('## 6.5 Sub-item census')
    w('')
    sub = OrderedDict((k, Counter()) for k in ['terms', 'bold_claims', 'numeric_items', 'bullets', 'variables',
                                                'table_rows', 'section_headings', 'cross_refs'])
    for r in readings.values():
        for o in r['objectives']:
            sub['section_headings'][r['area']] += len(o['section_headings'])
            for b in o['blocks']:
                for k in ['terms', 'bold_claims', 'numeric_items', 'bullets', 'variables', 'cross_refs']:
                    sub[k][r['area']] += len(b.get(k, []))
                sub['table_rows'][r['area']] += sum(1 for _ in all_rows(b))
    w('| Sub-item | ' + ' | '.join(EXPECTED) + ' | Total |')
    w('|---|' + '---|' * (len(EXPECTED) + 1))
    for k, c in sub.items():
        w('| %s | %s | %d |' % (k, ' | '.join(str(c[a]) for a in EXPECTED), sum(c.values())))
    tikz_nodes = sum(len(b.get('node_text', [])) for r in readings.values() for o, b in iter_blocks(r))
    w('')
    ts = Counter()
    for r in readings.values():
        for o, b in iter_blocks(r):
            for t in b.get('terms', []):
                ts[t['term_source']] += 1
    w('Terms by source: %s. TikZ node-text strings: %d. Named cases found: %s.' % (
        ', '.join('%s %d' % kv for kv in sorted(ts.items())), tikz_nodes,
        ', '.join('%s (%d readings)' % (k, v) for k, v in sorted(
            Counter(c for r in readings.values() for c in r['cases']).items()))))
    w('')
    tc = Counter()
    for r in readings.values():
        for t in r['traps']:
            tc[(t['category'] or 'Uncategorized', r['area'])] += 1
    w('Traps by category (explicit trap boxes only; `origin` summary/trapbox):')
    w('')
    w('| Category | ' + ' | '.join(EXPECTED) + ' | Total |')
    w('|---|' + '---|' * (len(EXPECTED) + 1))
    for cat in CATEGORIES + ['Uncategorized']:
        w('| %s | %s | %d |' % (cat, ' | '.join(str(tc[(cat, a)]) for a in EXPECTED),
                                sum(tc[(cat, a)] for a in EXPECTED)))
    split = sum(1 for r in readings.values() for t in r['traps'] if t['correct_text'])
    w('')
    w('%d of %d traps were split into `correct_text` / `corrupted_text` by rule (see 6.6).' % (split, ntraps))
    w('')
    mc = Counter(m for r in readings.values() for m in r['mechanics_supported'])
    w('Readings per mechanic (brief 4.1 thresholds): ' + ', '.join('%s %d' % (k, mc[k]) for k in
      [n for _, _, names in MECH_RULES for n in names] + ['Concept Inventory']) + '.')
    w('')
    # 6.6
    w('## 6.6 Inferences and decided rules')
    w('')
    w('Everything below was inferred rather than read verbatim. Rules marked *audit* come from the Phase 1 audit '
      'and the coordinator\'s decisions; the rest are the extractor\'s own.')
    w('')
    for rule in DECIDED_RULES:
        w('- ' + rule)
    w('')
    w('Per-instance inferences logged during the run:')
    w('')
    by_kind = OrderedDict()
    for inf in log['inferences']:
        by_kind.setdefault(inf['kind'], []).append(inf)
    for kind, items in by_kind.items():
        w('**%s** (%d)' % (kind, len(items)))
        w('')
        for inf in items:
            w('- %s:%s %s' % (inf['file'].replace('notes/', ''), inf['line'], inf['detail']))
        w('')
    drops = [(r['reading_id'], d) for r in readings.values() for d in r['dropped_fragments']]
    w('**Dropped fragments** (%d): text outside any block with fewer than three words and no math, e.g. stray '
      'labels. Listed so nothing disappears silently:' % len(drops))
    w('')
    for rid, d in drops:
        w('- %s line %d: "%s"' % (rid, d['line'], d['text'].replace('\n', ' ')[:80]))
    w('')
    cor = doc['corrections_index']
    w('**corrections_index**: the notes carry no "Corrections and coverage record" appendix (the consolidated '
      'volumes removed the per-volume coverage records; see `titlepage.tex`). The index is built from the inline '
      'correction boxes instead: %d rows, %d with both `as_written` and `as_corrected` determinable; the rest keep '
      'the full text in the linked source note.' % (len(cor), sum(1 for c in cor if c['determinable'])))
    w('')
    # 6.7
    w('## 6.7 Determinism check')
    w('')
    if det:
        w('- Full extraction re-run twice in fresh interpreters (`PYTHONHASHSEED` 1 and 2) with the same '
          '`--generated`: output byte-identical to the written file: **%s**.' % ('yes' if det['full_identical_to_written'] else 'NO'))
        w('- `--only %s` run twice (`PYTHONHASHSEED` 3 and 4): byte-identical: **%s** (%s bytes).'
          % (det['only_file'], 'yes' if det['only_identical'] else 'NO', format(det['only_bytes'], ',')))
        w('- Full run with a different `--generated`: %d differing line(s), all of them the `generated` field: **%s**.'
          % (det['timestamp_only_diff_lines'], 'yes' if det['timestamp_only_diff_is_generated'] else 'NO'))
    else:
        w('Not run (--no-determinism-check).')
    w('')
    w('Sort order is fixed everywhere (files by name, readings by area then number, blocks in source order, '
      'counters per objective and type); hashes are the first 12 hex digits of SHA-1 over whitespace-normalised '
      'text; no set or dict iteration order reaches the output.')
    w('')
    return '\n'.join(L)


DECIDED_RULES = [
    '*audit* Reading metadata: `\\reading{id}{title}{tag}{src}` and `\\chapterhead{no}{id}{title}{cat}{src}`; every '
    'argument kept under `legacy.args`, `src` is the last argument. `tag` comes from `master.tex` `\\setchapctx` '
    '(the macro ignores #3, and MR writes it in lowercase); `book` and `roi_rank` come from the same place.',
    '*audit* Objectives: `\\lo{ID letter}{text}`, `\\lohead[opt]{no}{letter}{text}`. Blocks before the first LO go '
    'to objective `intro`. `\\basics{}` and a pre-LO `\\section{Basics}` open objective `basics`; MR-15\'s post-LO '
    '`\\section{Summary of all the term structure models}` opens objective `summary` (it spans MR-14 and MR-15).',
    '*audit* Source citation: IM top-of-reading `\\srcnote{}`; otherwise the intro keybox "Source:" line (LTR '
    '`{\\footnotesize ...}`, CI `\\greyline`). MR, CR and ORR print no citation, so theirs is null.',
    '*audit* Multi-line macro arguments are always consumed whole before prose is split, so figcap/srcnote/gapnote/'
    'lohead continuation lines never leak into prose. `\\subsection*` and `\\subsubsection` are headings.',
    '*audit* Tables: header rows are the rows before the first `\\midrule`, else leading rows carrying `\\thd`, '
    '`\\thead`, `\\hdr`, `{\\sffamily\\bfseries ...}`, `\\textbf{\\sffamily ...}` or `\\rowcolor{navy|FRMNavy|FRMSoft}`. '
    'A leading single `\\multicolumn` header row is the table `title_row`. `\\tsub` is a row label (only a `\\tsub` row '
    'right under a title row is a header). Longtable `\\endfirsthead`/`\\endhead` repeats are counted once. A '
    'single-cell `\\multicolumn` row mid-table is a `group` label for the rows under it.',
    '*audit* Source/meta notes (to `reading.source_notes`, not content, not traps): trap/key/note boxes whose title '
    'matches label collision, ordering note/note on ordering, stale wording, numbering/renumbering, reconciliation '
    'record, correction, single-layer reading, notation warning, "objectives, not", off-syllabus, what the source '
    'notes carry, the source notes\' own guidance, labelling note, where this page came from, two layers/three '
    'copies, "in the source notes"/"source notes lost"; any trap/key box whose body mentions the Crash layer, '
    'Lecture layer or reconciliation record; trapboxes before the first LO (IM, MR, CR, LTR); `cisrcbox`; ornotebox '
    '"Source note" and "About this chapter". Trap bullets labelled Numbering or Source also go to source_notes.',
    '*audit* Corrections: boxes titled "Correction…" (and "A correction to the reconciliation record", "The '
    'correction, stated plainly") go to source_notes and to `corrections_index`. `as_written` is the first '
    '``quoted`` passage when the text says the notes print/state/instruct it; `as_corrected` is the first bold '
    'sentence of at least five words, else a sentence beginning "The correct…" or "The GARP form…"; otherwise null.',
    '*audit* Retyping (the original environment is kept in `env`, the alias type in `retyped_from`): orexambox titled '
    'Decision rule / New decision rule / Lesson(s) / The takeaway / Strengths / Reading the table… → keybox; '
    'orkeybox with display math → fmlbox (its "where \\[..\\]" or aligned key → variables; an itemize of symbols '
    'right after it → its notation key); orkeybox with a hand-made navy title and a short definition with a rust '
    '"E.g." aside → defbox (title = the hand-made heading, aside → `example_note`), plus the three audit-named cases '
    'without an aside (ORR-11 "Internal versus external fraud", ORR-13 "Motivations", ORR-16 "Model Risk Management '
    '(MRM) team"); cidefbox "The point to hold on to" → keybox.',
    '*audit* ornotebox → `notebox` with `subtype`: remember, note, outcome, list (Weaknesses/Limitations/Challenges/'
    'Shortcomings/Basel I limitations), fact (Equity and commodity derivatives, Backtesting requirement, Data '
    'requirement, Also worth knowing, Modeling revenues…); source notes as above.',
    '*audit* Trapboxes titled Limitation(s)…, Its drawbacks, Problems with…, Issues with…, Restrictions on…, '
    'Model n effectiveness are content lists: `content_list: true`, no trap items emitted from them.',
    '*audit* Terms: `\\term{}` (term), ORR bold item lead-ins `\\item \\textbf{X.}` (bold_leadin), ORR bold first-column '
    'table cells (bold_cell), `\\orsubb{Term}` followed by a one-sentence paragraph (orsubb), defbox titles other than '
    'generic ones such as "Definition" or "Notation…" (deftitle; the brief\'s LTR-1 example lists a defbox title as a '
    'term). Trailing punctuation is stripped.',
    '*audit* Variables: "$X$ = meaning" and sentence style "$X$ is meaning, $Y$ the meaning, and $Z$ the …", split on '
    '";" and on ", $" / ", and $", one variable per symbol (`shared_definition` when several symbols share one); '
    'definitions stop at the first sentence end (trailing commentary stays in `notation_key`). A notation key with '
    'no pairs becomes fmlbox `note`; `\\mrvk` #2 becomes `vk_remark`. Shared notation blocks ("Notation used …") '
    'emit variables from their table rows or bullets.',
    '*audit* Nesting: tables and TikZ inside boxes are children (`tables`, `figures`) of the box; their rows are '
    '`table_rows` with the box as parent. cifigblock/center/minipage are containers and are descended into. '
    '`tabbing` is text, not a table.',
    '*audit* Captions: a caption macro right after a table or TikZ figure (nothing but layout in between) becomes '
    'that block\'s `caption`; after `\\includegraphics` it is a figcap block carrying `image`; otherwise a standalone '
    'figcap block. "Figure CI-x.n." / "Table CI-x.n." prefixes go to `label`.',
    '*audit* Gap-fills: `\\gapbadge` scope runs from the badge to the next `\\lo`/`\\lohead`/`\\section` (subsections do '
    'not end it); every block in it has `is_gap_fill: true`; the grey rationale / `\\gapnote` / `\\srcnote` right after '
    'the badge is `gap_note` on the first block of the span (or `gap_notes` on the objective if no block follows). A '
    '`\\gapnote` without a badge flags the next block. gapbox blocks are always gap-fill.',
    '*audit* Worked examples: `\\tcblower` splits `question_latex`/`solution_latex`; bold "Step n …" and "What this '
    'means." markers become `steps`; exboxes titled "Step 1" start a `group` and later "Step n" / "…continued" '
    'exboxes join the previous exbox\'s group; A–D option tables or `\\Alph*` enumerates plus "Answer: X" become `mcq`.',
    '*audit* Loose display math outside any box whose non-math lead-in is at most 12 words is attached to the latest '
    'fmlbox of the same objective as a `substitutions` entry (it stays a prose_para when the objective has no fmlbox).',
    '*audit* TikZ: full source kept in `body_latex`; `node_text` holds the text of every `\\node{}`/`node{}`, '
    '`\\addlegendentry{}` and xlabel/ylabel/title key (deduplicated, pgf loop variables removed). Numbers with units in '
    'node text become numeric_items of the TikZ block; list items inside nodes are node text, not bullets.',
    '*audit* Symbols: `\\euro`/`\\texteuro` → €, `\\checkmark` → ✓, `$\\blacktriangleright$` → ▸; `\\rowcolor`, '
    '`\\cellcolor`, `\\arrayrulecolor` stripped.',
    '*audit* Named cases matched in plain text: Lehman, Bear Stearns, LTCM, Archegos, Madoff, Northern Rock, Ashanti, '
    'Metallgesellschaft, Barings, London Whale, Equifax, USAA, Capital One, Enron, Credit Suisse, Greece/Greek crisis, '
    'AIG, Amaranth, Berkshire/Buffett, Russia–Ukraine, King Bank, Gray Sky Bank (illustrative), the 2007–09 crisis, '
    'plus JPMorgan, Deutsche Bank and Société Générale found recurring in a scan of capitalised firm names. Barings '
    'and London Whale do not occur in these notes.',
    '*audit* Trap categories: the bold (`\\textbf`) or `\\term` lead of a bullet, normalised to the nine: '
    'Calculation/Number/Units/Magnitude/Approximation → Formula; Input twin/Confidence twin → Sibling; '
    'Ordering/Ranking → Sequence; Polarity / role and Direction → Polarity; Notation → Definition; Intermediate '
    'results → Intermediate result. IM\'s `\\term{Category, IM-x y.}` also yields `lo_ref`. Bullets with no category '
    'lead keep `category: null`, `raw_category: null` (bold leads that are not a category, e.g. "Day count.", are '
    'left in the text). `category_inferred` is false for every trap in this pass.',
    'Trap units: every depth-1 bullet of a trapbox is one trap. A trapbox without bullets is one trap, unless it holds '
    'two or more paragraphs that each open with a bold run-in label, in which case each paragraph is a trap '
    '(`form`: bullet / runin / box). A box-level trap takes a category from its title only when the title opens with '
    'a category word followed by ":" "." or a dash ("Polarity: which way…"); `category_source: "title"`.',
    'correct_text / corrupted_text: split only when a sentence has the shape "X, not Y" (also "X — not Y", "X; not Y", '
    '"X (not Y)") or "Y is wrong: X". `correct_text` is X; `corrupted_text` is X with its tail replaced by Y (from '
    'the last word of X equal to Y\'s first word, else the last |Y| words). This substitution is constructed, not '
    'read, so every split trap records `split_rule`. Y starting with "necessarily/only/just/always/even/merely" is not '
    'split.',
    'Top-level lists (outside any box) are prose_para blocks with `form: "list"`; paragraphs with fewer than three '
    'words and no math are dropped and listed below. Block ids use the canonical type name, so TikZ blocks are '
    '`….tikzpicture.n` (the brief\'s example wrote `tikz`).',
    'bold_claims come from prose and box bodies (`where` = prose / list / the box type), not from tables or TikZ; bold '
    'trap-category labels and "Step n"/"What this means" markers are excluded; `role: "label"` marks short bold '
    'lead-ins ending in ":" or "." (at most five words), `role: "claim"` the rest.',
    'numeric_items: numbers adjacent to %, bp/bps/basis points, million/billion/trillion/bn, or a currency sign/code '
    '(\\$, USD, EUR, GBP, CAD, CHF, JPY, €, £), matched on plain text of every block including table rows, captions '
    'and TikZ node text; `context` is the enclosing sentence; `value`/`unit`/`scale` are parsed from the match.',
    'cross_refs: reading ids (MR/LTR/IM/ORR/CR/CI-n, optional LO letter) in a block\'s plain text other than the '
    'reading\'s own id. Mechanic thresholds count distinct target readings for cross-refs and distinct named cases.',
    'Mechanics: brief 4.1 thresholds on extracted counts (tables = top-level table blocks; trapbox = content trapboxes '
    'after source-note removal; Role traps; distinct cross-ref targets; distinct cases; numeric items; TikZ blocks). '
    '"High LO count, no dominant structure" = at least five LOs and no other rule met.',
    'plain_text keeps inline math as `$…$`, display math as `$$…$$`, and escapes currency as `\\$` so a KaTeX '
    'auto-render pass will not confuse it with a math delimiter.',
]

if __name__ == '__main__':
    sys.exit(main())
