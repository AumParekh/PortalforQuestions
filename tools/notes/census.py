"""Phase 1 census over the FRM LaTeX notes. Deterministic: same input -> same output."""
import glob
import json
import os
import re
import sys
from collections import Counter, OrderedDict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'notes')
VOLS = ['FRM_Consolidated_Vol1', 'FRM_Consolidated_Vol2']

ALIAS = {
    'keybox': ['keybox', 'mrkeybox', 'imkeybox', 'crkeybox', 'lrkeybox', 'orkeybox', 'cikeybox'],
    'trapbox': ['trapbox', 'trapboxnb', 'mrtrapbox', 'imtrapbox', 'crtrapbox', 'lrtrapbox', 'lrtrapboxnb', 'citrapbox'],
    'defbox': ['defbox', 'mrdefbox', 'imdefbox', 'crdefbox', 'ordefbox', 'lrdefbox', 'cidefbox'],
    'fmlbox': ['fmlbox', 'mrfmlbox', 'imfmlbox', 'crfmlbox', 'orfmlbox', 'lrfmlbox'],
    'exbox': ['exbox', 'mrexbox', 'imexbox', 'crexbox', 'orexambox', 'lrexbox'],
    'gapbox': ['gapbox', 'mrgapbox', 'imgapbox', 'crgapbox', 'orgapbox', 'lrgapbox'],
}
ENV_TO_TYPE = {env: t for t, envs in ALIAS.items() for env in envs}
UNMAPPED_BOXES = {'ornotebox', 'cisrcbox'}
TABLE_ENVS = {'tabularx', 'longtable', 'tabular'}
LIST_ENVS = {'itemize', 'enumerate', 'lettered', 'checks'}
STRUCTURAL_ENVS = {'center', 'minipage', 'cifigblock', 'scope', 'axis'}
MATH_ENVS = {'align*', 'aligned', 'bmatrix', 'pmatrix', 'array', 'cases'}

AREA_OF = {'LR': 'LTR', 'MR': 'MR', 'IM': 'IM', 'OR': 'ORR', 'CR': 'CR', 'CI': 'CI'}

NUM_UNIT = re.compile(
    r'(?:(?:\\\$|\$|USD|EUR|GBP|€|£)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|trillion|bn|m|k)\b)?'
    r'|\d[\d,]*(?:\.\d+)?\s?(?:\\%|%|percent\b|per cent\b|bp\b|bps\b|basis points?\b|million\b|billion\b|trillion\b|bn\b))'
)
COMPARISON = re.compile(r'\b(?:vs\.?|versus|whereas|unlike|compared (?:with|to)|rather than|in contrast|as opposed to|instead of)\b', re.I)
DIRECTIONAL = re.compile(r'\b(?:higher|lower|before|after|rises?|rising|rose|falls?|falling|fell)\b', re.I)
ACTORS = re.compile(
    r'\b(?:banks?|dealers?|investors?|counterpart(?:y|ies)|CCPs?|clearing members?|lenders?|borrowers?|regulators?|'
    r'supervisors?|central banks?|board(?: of directors)?|senior management|(?:first|second|third)[- ]line|internal audit|'
    r'traders?|issuers?|originators?|SPVs?|SPEs?|rating agenc(?:y|ies)|protection (?:buyer|seller)s?|hedge funds?|'
    r'fund managers?|depositors?|the Fed|Federal Reserve|ECB|BCBS|FSB|Treasury|insurers?|asset managers?|'
    r'arrangers?|servicers?|trustees?|sponsors?|guarantors?)\b'
)


def strip_comments(s: str) -> str:
    return re.sub(r'(?<!\\)%.*', '', s)


def env_spans(s: str):
    """Yield (name, start, end, depth) for every \\begin{name}...\\end{name}, matched with a stack."""
    stack, out = [], []
    for m in re.finditer(r'\\(begin|end)\{([A-Za-z*]+)\}', s):
        kind, name = m.group(1), m.group(2)
        if kind == 'begin':
            stack.append((name, m.start()))
        else:
            for i in range(len(stack) - 1, -1, -1):
                if stack[i][0] == name:
                    nm, st = stack.pop(i)
                    del stack[i:]
                    out.append((nm, st, m.end(), i))
                    break
    return out


def braced(s: str, i: int):
    """Return (content, end_index) of the {...} group starting at s[i] == '{'."""
    depth, j = 0, i
    while j < len(s):
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
    return s[i + 1:], len(s)


def macro_args(s: str, name: str, nargs: int, optional: bool = False):
    """All calls of \\name with nargs braced args (optional [..] skipped). Returns list of (args, line)."""
    out = []
    for m in re.finditer(r'\\' + name + r'(?![A-Za-z])', s):
        j = m.end()
        if optional and j < len(s) and s[j] == '[':
            j = s.index(']', j) + 1
        args = []
        for _ in range(nargs):
            while j < len(s) and s[j] in ' \t\n':
                j += 1
            if j >= len(s) or s[j] != '{':
                break
            a, j = braced(s, j)
            args.append(a)
        if len(args) == nargs:
            out.append((args, s.count('\n', 0, m.start()) + 1))
    return out


def plain_words(t: str) -> int:
    t = re.sub(r'\$[^$]*\$', ' ', t)
    t = re.sub(r'\\[A-Za-z]+\*?(\[[^\]]*\])?', ' ', t)
    t = re.sub(r'[{}\\]', ' ', t)
    return len(re.findall(r'[A-Za-z]{2,}', t))


def table_rows(body: str):
    rows = [r for r in re.split(r'\\\\', body) if '&' in r]
    header = [r for r in rows if re.search(r'\\(thd|thead|hdr|tsub)\{|\\rowcolor\{navy\}', r)]
    return len(rows), len(header)


def census_file(path: str):
    raw = open(path, encoding='utf-8').read()
    s = strip_comments(raw)
    base = os.path.basename(path)
    m = re.match(r'\d+_([A-Z]+)_([A-Z]+\d+)\.tex', base)
    area = AREA_OF[m.group(1)]
    spans = env_spans(s)

    blocks = Counter()
    unmapped = Counter()
    env_counts = Counter(n for n, *_ in spans)
    for name, st, en, depth in spans:
        if name in ENV_TO_TYPE:
            blocks[ENV_TO_TYPE[name]] += 1
        elif name in UNMAPPED_BOXES:
            unmapped[name] += 1

    tikz = [(st, en) for n, st, en, _ in spans if n == 'tikzpicture']
    tikz_top = [t for t in tikz if not any(o[0] < t[0] and t[1] <= o[1] for o in tikz if o != t)]

    def inside(pos, ranges):
        return any(a <= pos < b for a, b in ranges)

    tables = [(n, st, en) for n, st, en, _ in spans if n in TABLE_ENVS and not inside(st, tikz)]
    tables_top = [t for t in tables if not any(o[1] < t[1] and t[2] <= o[2] for o in tables if o != t)]
    data_rows = header_rows = 0
    for n, st, en in tables_top:
        r, h = table_rows(s[st:en])
        data_rows += r - h
        header_rows += h
    blocks['table'] = len(tables_top)
    blocks['tikzpicture'] = len(tikz_top)

    figcaps = macro_args(s, 'figcap', 1) + macro_args(s, 'orfigcap', 1)
    figwraps = macro_args(s, 'figwrap', 2)
    blocks['figcap'] = len(figcaps) + len(figwraps)

    # Prose: mask every environment and display math, then split on blank lines.
    masked = list(s)
    for name, st, en, _ in spans:
        if name == 'document':
            continue
        for k in range(st, en):
            masked[k] = ' '
    masked = ''.join(masked)
    masked = re.sub(r'\\\[.*?\\\]', ' ', masked, flags=re.S)
    heading_re = re.compile(r'^\s*\\(reading|chapterhead|lo|lohead|subsection|section|orsub|orsubb|basics|figcap|orfigcap|figwrap|srcnote|gapnote|greyline|markboth|vk|mrvk)\b')
    prose = []
    for para in re.split(r'\n\s*\n', masked):
        lines = [ln for ln in para.split('\n') if ln.strip() and not heading_re.match(ln)]
        text = '\n'.join(lines)
        if plain_words(text) >= 8:
            prose.append(text)
    blocks['prose_para'] = len(prose)
    prose_all = '\n'.join(prose)

    vk_vars = 0
    for args, _ in macro_args(s, 'vk', 1) + [(['; '.join(a)], ln) for a, ln in macro_args(s, 'mrvk', 2)]:
        segs = [x for x in re.split(r';', args[0]) if '=' in x]
        vk_vars += len(segs)

    headings = (len(macro_args(s, 'lo', 2)) + len(macro_args(s, 'lohead', 3, optional=True))
                + len(macro_args(s, 'subsection', 1)) + len(macro_args(s, 'orsub', 1))
                + len(macro_args(s, 'orsubb', 1)) + len(macro_args(s, 'basics', 1))
                + len(re.findall(r'\\section\*?\{', s)))

    within = OrderedDict(
        term=len(re.findall(r'\\term\{', s)),
        textbf_in_prose=len(re.findall(r'\\textbf\{', prose_all)),
        numbers_in_prose=len(NUM_UNIT.findall(prose_all)),
        comparisons_in_prose=len(COMPARISON.findall(prose_all)),
        directional_in_prose=len(DIRECTIONAL.findall(prose_all)),
        actors_in_prose=len(ACTORS.findall(prose_all)),
        vk_variables=vk_vars,
        table_rows=data_rows,
        items=len(re.findall(r'\\item\b', s)),
        figcaps=blocks['figcap'],
        headings=headings,
    )

    reading = macro_args(s, 'reading', 4)
    chapterhead = macro_args(s, 'chapterhead', 5)
    rid = reading[0][0][0] if reading else (chapterhead[0][0][1] if chapterhead else None)
    return dict(
        file=os.path.relpath(path, ROOT),
        area=area,
        reading_id=rid,
        bytes=len(raw.encode('utf-8')),
        lines=raw.count('\n') + (0 if raw.endswith('\n') else 1),
        opener='reading' if reading else ('chapterhead' if chapterhead else None),
        n_objectives=len(macro_args(s, 'lo', 2)) + len(macro_args(s, 'lohead', 3, optional=True)),
        blocks={k: blocks.get(k, 0) for k in ['defbox', 'fmlbox', 'exbox', 'trapbox', 'keybox', 'gapbox', 'table', 'figcap', 'prose_para', 'tikzpicture']},
        unmapped=dict(unmapped),
        within=within,
        header_rows=header_rows,
        gapbadges=len(re.findall(r'\\gapbadge\b', s)),
        gapnotes=len(re.findall(r'\\gapnote\b', s)),
        schweserbadges=len(re.findall(r'\\schweserbadge\b', s)),
        srcnotes=len(re.findall(r'\\srcnote\b', s)),
        includegraphics=len(re.findall(r'\\includegraphics', s)),
    )


def main():
    files = sorted(f for v in VOLS for f in glob.glob(os.path.join(ROOT, v, 'ch', '*.tex')))
    rows = [census_file(f) for f in files]
    json.dump(rows, sys.stdout, indent=1, ensure_ascii=False, sort_keys=False)


if __name__ == '__main__':
    main()
