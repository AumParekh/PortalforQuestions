#!/usr/bin/env python3
"""Extracts the questions of a set of "LO question papers", word for word, into JSON.

    extract_papers.py <papers.pdf> <out.json> [--pages A-B] [--dump]

The PDF is a run of papers, one per learning objective. A paper names its LO in the running head ("LO 14.a") and
has two parts: the questions ("Q1." … with options "A." to "D."), then the solutions, which open with an answer
key (Q, Answer, Target tested) and give each question a solution in six lettered sections:

    a  Concept and theory          d  Why each wrong option is wrong (one entry per option, with its error type)
    b  Applying it to this question e  Fragile fact
    c  Why <X> is correct          f  Reference

Three templates share this structure and differ only in fonts and in how a solution is headed ("Q1. <title>",
"Solution Q1 (Answer: B)", "Solution Q1  Answer: B"). Text is the portal's content format; see pdf_layout.py.
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter

import pdfplumber

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_layout as L  # noqa: E402
import extract_bank as B  # noqa: E402

#: The extension fonts report the letter of a slot rather than the symbol drawn there (as in extract_recall.py).
_EX = {
    'P': '∑', 'X': '∑', 'Q': '∏', 'Y': '∏', 'R': '∫', 'Z': '∫',
    'p': '√', 'q': '√', 'r': '√', 's': '√',
    0: '(', 1: ')', 2: '[', 3: ']', 8: '{', 9: '}', 12: '|',
    16: '(', 17: ')', 18: '(', 19: ')', 20: '[', 21: ']', 32: '(', 33: ')', 34: '[', 35: ']',
    40: '{', 41: '}', 26: '{', 27: '}', 122: '', 123: '', 124: '', 125: '',
    ' ': '(', '!': ')', '"': '[', '#': ']', 'h': '[', 'i': ']', '(': '{', ')': '}', 'n': '{', 'o': '}',
    # Pieces of braces, tall brackets and built-up radicals: no text; the line is flagged for a human.
    'z': '', '{': '', '|': '', '}': '', 'c': '', 't': '', 'u': '', 'v': '',
    '': '', '': '', '': '', '': '', '': '', '': '',
    '': '', '': '', '': '', '': '', '': '', '': '',
}
GLYPHS = {(font, k): v for font in ('LMMathExtension10-Regular', 'CMEX10') for k, v in _EX.items()}
#: Heights (ems) of the tall brackets: \\big, \\Big, \\bigg and \\Bigg, by slot number or by the letter reported for it.
_TALL = {**dict.fromkeys((0, 1, 2, 3, 8, 9), 1.2), **dict.fromkeys((16, 17, 'h', 'i', 'n', 'o'), 1.8),
         **dict.fromkeys((18, 19, 20, 21, 26, 27), 2.4), **dict.fromkeys((32, 33, 34, 35, 40, 41, ' ', '!', '"', '#', '(', ')'), 3.0)}
TALL = {(font, k): v for font in ('LMMathExtension10-Regular', 'CMEX10') for k, v in _TALL.items()}
#: Fraction bars and radical bars; every other rule is a table rule or the running head's.
MATH_RULE = (0.33, 0.47)
CLIP = (58.0, 790.0)

_HEAD_LO = re.compile(r'LO\s*(\d+)\.([a-z])(?![a-z])')
_Q = re.compile(r'^Q(\d+)\.$')
_SOL_TITLED = re.compile(r'^Q(\d+)\.\s+\S')
_SOL = re.compile(r'^Solution Q(\d+)\s*\(?\s*Answer:\s*([A-E])\s*\)?$')
_SEC = re.compile(r'^\(?([a-f])[.)]\s+(\S.*)$')
_OPT = re.compile(r'^([A-E])\.$')
_WRONG = re.compile(r'^(?:Options? )?([A-E](?:(?:, | and |, and )[A-E])*)(?=$|[\s.(:,])')
_SOLUTIONS = re.compile(r'^(Answer [Kk]ey|Solutions|Part \d+: Solutions|Solutions follow)$')
_WHY = re.compile(r'^Why ([A-E]) is\b')
_CORRECT = re.compile(r'^Option ([A-E]) is correct')
_KEY_ROW = re.compile(r'^\|\s*(\d+)\s*\|\s*([A-E])\s*\|\s*(.*?)\s*\|$')


def running_lo(page) -> tuple | None:
    """(reading, letter) from the running head of a page."""
    head = ''.join(c['text'] for c in sorted((c for c in page.chars if c['bottom'] < CLIP[0]), key=lambda c: (round(c['top']), c['x0'])))
    # Glyphs carry no spaces: "…RMIMLO90.a". The LO is the last thing in the head.
    found = _HEAD_LO.findall(head)
    m = found[-1] if found else None
    return (int(m[0]), m[1]) if m else None


def parse(pages: list) -> tuple:
    """`pages` is [(page number, running LO, lines)]. Returns (papers, problems)."""
    papers, problems = [], []
    paper = q = sol = None
    phase = section = None
    last_wrong = None
    for number, lo, lines in pages:
        if lo is None:
            lo = paper['lo'] if paper else None
        if paper is None or lo != paper['lo']:
            paper = {'lo': lo, 'page': number, 'instructions': [], 'header': [], 'questions': {}, 'order': [], 'key': {}, 'declared': None}
            papers.append(paper)
            phase, q, sol, section = 'q', None, None, None
        for ln in lines:
            text = ln.text.strip()
            bp = ln.bold_prefix if ln.kind == 'text' else ''
            plain = B._unbold(text) if ln.kind == 'text' else ''
            if ln.kind == 'text' and _SOLUTIONS.match(plain):
                phase, q, sol, section = 's', None, None, None
                continue
            if phase == 'q':
                m = _Q.match(bp)
                if m:
                    n = int(m.group(1))
                    if n in paper['questions']:
                        problems.append(f'p{number}: Q{n} of LO {lo} appears twice')
                    q = {'n': n, 'page': number, 'stem': [B._Rest(ln)], 'options': {}, 'answer': None, 'title': '', 'summary': [], 'sections': {}, 'others': {}, 'labels': {}, 'flags': []}
                    paper['questions'][n] = q
                    paper['order'].append(n)
                    section = 'stem'
                    continue
                if q is None:
                    # The paper's cover: its facts table, and for some papers the conventions the questions rely on.
                    if ln.kind == 'table' or bp in ('Subject', 'Reading', 'Learning objective', 'LO wording', 'Questions', 'Date', 'Pace'):
                        paper['header'].append(ln)
                    elif plain.startswith('Instructions:') or paper['instructions']:
                        paper['instructions'].append(ln)
                    elif section == 'header-more':
                        paper['header'].append(ln)
                    section = 'header-more' if bp in ('Reading', 'LO wording') else section if ln.kind != 'text' or not bp else None
                    continue
                om = _OPT.match(bp)
                if om:
                    section = 'opt:' + om.group(1)
                    q['options'][om.group(1)] = [B._Rest(ln)]
                elif section == 'stem':
                    q['stem'].append(ln)
                elif section and section.startswith('opt:'):
                    q['options'][section[4:]].append(ln)
                continue
            # ---- solutions
            if ln.kind == 'table' and re.search(r'\|\s*Q\s*\|\s*Answer\s*\|', ln.text.split('\n')[0]):
                for row in ln.text.split('\n')[2:]:
                    m = _KEY_ROW.match(row.strip())
                    if m:
                        paper['key'][int(m.group(1))] = (m.group(2), m.group(3))
                continue
            head = None
            m = _SOL.match(bp) if bp and bp == plain else None
            if m:
                head = (int(m.group(1)), m.group(2), '')
            elif bp and ln.size > 11.4:
                # "Q7. Inferring σ from a Model 1 tree": set large; a symbol in the title is not in the bold font.
                m = _SOL_TITLED.match(bp)
                if m:
                    head = (int(m.group(1)), None, plain[m.end() - 1:].strip())
            if head:
                sol = paper['questions'].get(head[0])
                section, last_wrong = 'summary', None
                if sol is None:
                    problems.append(f'p{number}: solution Q{head[0]} of LO {lo} has no question')
                    continue
                if sol['sections'] or sol['summary']:
                    problems.append(f'p{number}: solution Q{head[0]} of LO {lo} appears twice')
                sol['answer'], sol['title'] = head[1], head[2]
                continue
            if sol is None:
                continue
            m = _SEC.match(bp) if bp and bp == plain else None
            if m:
                section, last_wrong = m.group(1), None
                sol['sections'].setdefault(section, [])
                w = _WHY.match(m.group(2))
                if section == 'c' and w:
                    if sol['answer'] and sol['answer'] != w.group(1):
                        sol['flags'].append('answer-conflict')
                    sol['answer'] = sol['answer'] or w.group(1)
                continue
            if section == 'summary':
                sol['summary'].append(ln)
            elif section == 'd':
                wm = _WRONG.match(bp) if bp else None
                if wm:
                    letters = re.findall(r'[A-E]', wm.group(1))
                    last_wrong = letters
                    label = bp[wm.end():].strip()
                    for k in letters:
                        if k in sol['others']:
                            sol['flags'].append('wrong-option-twice')
                        sol['others'][k] = [B._Rest(ln)]
                        sol['labels'][k] = label
                    if len(letters) > 1:
                        sol['flags'].append('shared-reason')
                elif last_wrong:
                    for k in last_wrong:
                        sol['others'][k].append(ln)
                else:
                    sol['sections']['d'].append(ln)
            elif section in sol['sections']:
                if section == 'c' and bp:
                    cm = _CORRECT.match(bp)
                    if cm:
                        if sol['answer'] and sol['answer'] != cm.group(1):
                            sol['flags'].append('answer-conflict')
                        sol['answer'] = sol['answer'] or cm.group(1)
                sol['sections'][section].append(ln)
    return papers, problems


def _label(text: str) -> str:
    """The error type a wrong option's entry opens with: "(Absolute claim)." gives "Absolute claim"."""
    t = L._unescape(text).strip().rstrip('.').strip()
    m = re.fullmatch(r'\((.*)\)', t)
    return m.group(1).strip() if m else ''


_ITEM = re.compile(r'\((?:[ivx]+|\d+)\) ')


def _inset_run(run: list, inset: list, j: int) -> list:
    k = j
    while k < len(run) and inset[k]:
        k += 1
    return run[j:k]


def table_options(stem: str) -> tuple:
    """A question whose options are the rows of a table ("Option | Portugal | France | Germany"): each row becomes
    an option that names its columns ("Portugal: …; France: …; Germany: …"), and the table leaves the stem."""
    blocks = stem.split('\n\n')
    for i, block in enumerate(blocks):
        rows = [[c.strip() for c in r.strip().strip('|').split('|')] for r in block.split('\n')]
        if len(rows) < 4 or not block.startswith('|') or rows[0][0] not in ('Option', ''):
            continue
        heads, options, key = rows[0][1:], {}, None
        for row in rows[2:]:
            m = re.fullmatch(r'\*\*([A-E])\.\*\*', row[0])
            if m:
                key = m.group(1)
                options[key] = list(row[1:])
            elif key and not row[0]:
                # A wrapped row continues the cells above it.
                options[key] = [B.join_pair(a, b, Counter()) if b else a for a, b in zip(options[key], row[1:])]
            else:
                return stem, {}
        if sorted(options) != ['A', 'B', 'C', 'D']:
            return stem, {}
        text = {k: '; '.join(f'{h}: {c}' for h, c in zip(heads, cells)) for k, cells in options.items()}
        return '\n\n'.join(blocks[:i] + blocks[i + 1:]).strip(), text
    return stem, {}


def finish(paper: dict, q: dict, vocab: Counter, left: float, right: float) -> dict:
    flags = list(q['flags'])

    def framed(seg, boxed):
        # A box or a quoted passage: justified lines set in from both margins, which wrap at the frame's own edge.
        # Two lines alone are a frame only if the first does not end its sentence (two steps of a working do).
        x0, x1 = min(ln.x0 for ln in seg), max(ln.x1 for ln in seg)
        return (
            len(seg) >= 2
            and x1 - x0 >= 0.8 * (right - left)
            and all(abs(ln.x0 - x0) < 1.5 for ln in seg)
            and all(abs(ln.x1 - x1) < 4 for ln in seg[:-1])
            and (boxed or len(seg) >= 3 or not re.search(r'[.:;?!]$', seg[0].text.strip()))
        )

    def prose(run, boxed):
        out, i = [], 0
        inset = [ln.kind == 'text' and ln.x0 >= left + 6 and ln.x1 <= right - 6 for ln in run]
        while i < len(run):
            j = i
            while j < len(run) and inset[j] == inset[i]:
                j += 1
            seg = run[i:j]
            if inset[i] and framed(seg, boxed):
                out.append(B.to_markdown(B.paragraphs(seg, vocab, flags, min(ln.x0 for ln in seg), max(ln.x1 for ln in seg))))
            elif inset[i] and j < len(run):
                # Inset lines that are no frame of their own (a short list, a centred line) read on with what follows.
                inset[i:j] = [False] * (j - i)
                continue
            else:
                while j < len(run):
                    nxt = _inset_run(run, inset, j)
                    if nxt and framed(nxt, boxed):
                        break
                    j += len(nxt) or 1
                out.append(B.to_markdown(B.paragraphs(run[i:j], vocab, flags, left, right)))
            i = j
        return out

    def md(lines, boxed=False):
        # A displayed equation row (set well in from the margin) stays a line of its own: the rows of an aligned
        # block are leaded like running text, and a numbered row reaches the right margin like a full line.
        blocks, run = [], []
        for ln in lines:
            if ln.kind == 'text' and ln.x0 > left + 45 and re.search(r'[=$≈<>≤≥]', ln.text):
                blocks.extend(prose(run, boxed))
                run = []
                flags.extend(f for f in ln.flags if f not in flags)
                blocks.append(ln.text.strip())
            else:
                run.append(ln)
        blocks.extend(prose(run, boxed))
        # A wrapped line that happens to open with "(ii)" is not a new list item: the sentence above has not ended.
        paras = []
        for para in '\n\n'.join(b for b in blocks if b).strip().split('\n\n'):
            if paras and _ITEM.match(para) and re.search(r'[a-z,]$', paras[-1]) and not _ITEM.match(paras[-1]) and not paras[-1].startswith(('|', '- ')):
                paras[-1] += ' ' + para
            else:
                paras.append(para)
        return '\n\n'.join(paras)

    reading, letter = paper['lo']
    key = paper['key'].get(q['n'])
    answer = q['answer'] or (key[0] if key else None)
    if key and q['answer'] and key[0] != q['answer']:
        flags.append('answer-key-differs')
    others, error_types = {}, {}
    for k, lines in q['others'].items():
        label = _label(q['labels'].get(k, ''))
        body = md(lines)
        m = re.match(r'^Error type:\s*([^.]*?)[.,:;]\s', body)
        # Templates name the error either in the entry's bold label or in an "Error type:" opening.
        error_types[k] = label if label and not re.search(r'\d', label) else (m.group(1).strip() if m else '')
        others[k] = f'**{label[0].upper() + label[1:]}.** {body}' if error_types[k] == label and label else body
    out = {
        'lo': f'{reading}.{letter}', 'reading': reading, 'letter': letter, 'n': q['n'], 'page': q['page'],
        'stem': md(q['stem']),
        'options': {k: md(v) for k, v in q['options'].items()},
        'answer': answer,
        'target': key[1] if key else '',
        'title': re.sub(r'\s+', ' ', L._unescape(q['title'])).strip(),
        'summary': md(q['summary'], boxed=True),
        'concept': md(q['sections'].get('a', [])),
        'applying': md(q['sections'].get('b', [])),
        'why': md(q['sections'].get('c', [])),
        'others_intro': md(q['sections'].get('d', [])),
        'others': others,
        'error_types': error_types,
        'fragile': md(q['sections'].get('e', []), boxed=True),
        'reference': md(q['sections'].get('f', [])),
        'flags': flags,
    }
    if not out['options']:
        out['stem'], out['options'] = table_options(out['stem'])
    keys = sorted(out['options'])
    text_all = ' '.join([out['stem'], out['summary'], out['concept'], out['applying'], out['why'], out['fragile'], out['reference'], *out['options'].values(), *others.values()])
    if not out['stem']:
        flags.append('no-stem')
    if keys != ['A', 'B', 'C', 'D'] or any(not v for v in out['options'].values()):
        flags.append(f'options-{"".join(keys) or "none"}')
    if out['answer'] not in keys:
        flags.append('no-answer')
    if sorted(others) != [k for k in keys if k != out['answer']]:
        flags.append('others-' + (''.join(sorted(others)) or 'none'))
    for name in ('concept', 'applying', 'why', 'fragile', 'reference'):
        if not out[name]:
            flags.append('no-' + name)
    if '�' in text_all or re.search('[-]', text_all):
        flags.append('unknown-glyph')
    if r'\surd' in text_all:
        flags.append('bare-radical')
    if re.search('[⏟⏞⎧⎨⎩⎛⎝⎞⎠]', text_all):
        flags.append('brace')
    if re.search(r'\b(Figure|figure|chart|diagram|graph) (below|above|\d)', out['stem'] + ' '.join(out['options'].values())):
        flags.append('refers-to-figure')
    out['flags'] = sorted(set(flags))
    return out


def header_facts(paper: dict, vocab: Counter, left: float, right: float) -> dict:
    """The LO wording and the number of questions the paper's cover states."""
    text = '\n'.join(ln.text for ln in paper['header'])
    flat = re.sub(r'\s+', ' ', L._unescape(text.replace('**', '').replace('|', ' ')))
    declared = re.search(r'\bQuestions (\d+)\b', flat)
    wording = re.search(r'LO wording (.*?) Questions \d', flat) or re.search(r'Learning objective LO \d+\.[a-z]:? (.*?) Questions \d', flat)
    instructions = B.to_markdown(B.paragraphs(paper['instructions'], vocab, [], left, right))
    return {'declared': int(declared.group(1)) if declared else None, 'wording': wording.group(1).strip() if wording else '', 'instructions': instructions}


def extract(pdf_path: str, first: int = 1, last: int | None = None) -> dict:
    L.MATH_RULE = MATH_RULE
    L.OWN_BAR_RADICALS = True
    L.WRAPPED_ROWS = True
    L.SUP_SHIFT = 0.04
    L.TALL = TALL
    L.MATH_FONT = lambda font: 'math' in font.lower() or font.startswith('CM')
    L.MATH_ITALIC_FONT = lambda font: font.startswith('CMMI') or font.startswith('LMMathItalic')
    shared = B.build_vocab([])
    L.JOIN = lambda a, b: B.join_pair(a, b, shared)
    pdf = pdfplumber.open(pdf_path)
    unknown = {}
    pages, all_lines = [], []
    for page in pdf.pages[first - 1:last]:
        lines = L.page_lines(page, GLYPHS, unknown, None, clip=CLIP)
        pages.append((page.page_number, running_lo(page), lines))
        all_lines += lines
        page.flush_cache()
    vocab = B.build_vocab(all_lines)
    # Text margins of this template: where question lines start, and how far full lines reach.
    starts = Counter(round(ln.x0, 1) for ln in all_lines if ln.kind == 'text' and _Q.match(ln.bold_prefix or ''))
    left = starts.most_common(1)[0][0] if starts else 62.4
    ends = Counter(round(ln.x1) for ln in all_lines if ln.kind == 'text' and ln.x1 > 500)
    right = float(ends.most_common(1)[0][0]) if ends else 532.9
    papers, problems = parse(pages)
    questions, summary = [], []
    for p in papers:
        if p['lo'] is None:
            problems.append(f"p{p['page']}: pages with no LO in the running head")
            continue
        facts = header_facts(p, vocab, left, right)
        done = [finish(p, p['questions'][n], vocab, left, right) for n in p['order']]
        for d in done:
            d['wording'], d['of'], d['instructions'] = facts['wording'], len(done), facts['instructions']
        questions += done
        lo = f"{p['lo'][0]}.{p['lo'][1]}"
        if facts['declared'] != len(done):
            problems.append(f"LO {lo} (p{p['page']}): the cover says {facts['declared']} questions, {len(done)} read")
        if p['order'] != list(range(1, len(done) + 1)):
            problems.append(f"LO {lo} (p{p['page']}): question numbers {p['order']}")
        if sorted(p['key']) != sorted(p['order']):
            problems.append(f"LO {lo} (p{p['page']}): answer key covers {sorted(p['key'])}")
        summary.append({'lo': lo, 'page': p['page'], 'questions': len(done), 'wording': facts['wording'], 'instructions': bool(facts['instructions'])})
    for key, where in sorted(unknown.items(), key=str):
        problems.append(f'unmapped glyph {key}: {len(where)} uses, first on p{where[0]}')
    return {'file': os.path.basename(pdf_path), 'pages': len(pdf.pages), 'margins': [left, right], 'papers': summary, 'questions': questions, 'problems': problems, 'lines': all_lines}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    first, last = 1, None
    if '--pages' in sys.argv:
        a, b = sys.argv[sys.argv.index('--pages') + 1].split('-')
        first, last = int(a), int(b)
        args = [x for x in args if x != f'{a}-{b}']
    res = extract(args[0], first, last)
    if '--dump' in sys.argv:
        for ln in res['lines']:
            print(f"p{ln.page} x{ln.x0:5.1f}-{ln.x1:5.1f} s{ln.size:4.1f} [{ln.bold_prefix}] {ln.text} {ln.flags or ''}")
    del res['lines']
    with open(args[1], 'w', encoding='utf8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    qs = res['questions']
    flags = Counter(f for q in qs for f in q['flags'])
    print(f"{res['file']}: {len(res['papers'])} papers, {len(qs)} questions, {sum(1 for q in qs if q['flags'])} flagged, {len(res['problems'])} problems; margins {res['margins']}")
    for k, v in flags.most_common():
        print(f'  {v:5d} {k}')
    for p in res['problems'][:30]:
        print('  PROBLEM', p)


if __name__ == '__main__':
    main()
