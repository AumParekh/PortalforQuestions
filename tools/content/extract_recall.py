#!/usr/bin/env python3
"""Extracts the questions of a "Recall + Priority Map Workbook" volume (Tier A, or Tiers B to D), word for word.

    extract_recall.py <volume.pdf> <out.json> [--pages A-B] [--dump]

A volume is a run of sections (A1, A2, ...). A question is framed, headed "Question A1.2" with the LOs it tests and
its tags ("CR-4 d, e, f · S1, S2, S5 · [Aug-2026] [Map #1]"), and is followed by its framed solution ("Solution
Answer: B", worked steps, why each other option is wrong, LO and reference). Text is the portal's content format;
see pdf_layout.py.
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

X = 'CMEX10'
#: These volumes set math in the classic TeX fonts, whose slots report the letter of their position rather than the
#: symbol drawn there. Identified from the font encodings and checked against the rendered pages.
GLYPHS = {
    (X, 'P'): '∑', (X, 'X'): '∑', (X, 'Q'): '∏', (X, 'Y'): '∏', (X, 'R'): '∫', (X, 'Z'): '∫',
    (X, 'p'): '√', (X, 'q'): '√', (X, 'r'): '√', (X, 's'): '√',
    (X, 0): '(', (X, 1): ')', (X, 2): '[', (X, 3): ']', (X, 8): '{', (X, 9): '}', (X, 12): '|',
    (X, 16): '(', (X, 17): ')', (X, 18): '(', (X, 19): ')', (X, 20): '[', (X, 21): ']',
    (X, ' '): '(', (X, '!'): ')', (X, '"'): '[', (X, '#'): ']', (X, 'h'): '[', (X, 'i'): ']',
    (X, '('): '{', (X, ')'): '}', (X, 'n'): '{', (X, 'o'): '}',
    # Pieces of horizontal braces, wide accents and built-up radicals: no text; the line is flagged for a human.
    (X, 'z'): '', (X, '{'): '', (X, '|'): '', (X, '}'): '', (X, 'c'): '', (X, 't'): '', (X, 'u'): '', (X, 'v'): '',
}
MATH_RULE = (0.35, 0.45)
LEFT, RIGHT = 71.7, 523.6

_QUESTION = re.compile(r'^Question ([A-D]\d+)\.(\d+)$')
_SOLUTION = re.compile(r'^Solution\s+Answer:\s*([A-E])\b(.*)$')
_OPT = re.compile(r'^([A-E])\.$')
_WRONG = re.compile(r'^([A-E](?:(?:, | and |, and )[A-E])*) (?:is|are) incorrect\.$')
_OTHERS_HEAD = re.compile(r'^Why (the )?other(s| options| option| choices) (is|are) wrong', re.I)
_LO_GROUP = re.compile(r'((?:MR|CR|ORR|LTR|IM|CI)-\d+)((?:,? [a-z](?![a-z]))+)')


def box_kind(frame: dict) -> str:
    c = frame['fill']
    if not c or not isinstance(c, (tuple, list)) or len(c) < 3:
        return ''
    r, g, b = (round(float(x), 2) for x in c[:3])
    if (r, g, b) == (0.08, 0.16, 0.29):
        return 'question'
    if (r, g, b) in ((0.18, 0.49, 0.31), (0.97, 0.98, 0.97)):
        return 'solution'
    return 'other'


def parse(lines: list) -> tuple:
    questions = []
    problems = []
    q = None
    section = None
    for ln in lines:
        text = ln.text.strip()
        bp = ln.bold_prefix
        if ln.kind == 'text' and bp:
            m = _QUESTION.match(bp)
            if m:
                tags = L._unescape(ln.rest).strip()
                parts = [p.strip() for p in tags.split('·')]
                los = [f'{g.group(1)} {letter}' for g in _LO_GROUP.finditer(parts[0] if parts else '') for letter in re.findall(r'[a-z]', g.group(2))]
                q = {
                    'id': f'{m.group(1)}.{m.group(2)}', 'section': m.group(1), 'k': int(m.group(2)), 'page': ln.page,
                    'tags': tags, 'los': los, 'shapes': re.findall(r'S\d+', ' '.join(parts[1:2])),
                    'stem': [], 'options': {}, 'answer': None, 'body': [], 'others': {}, 'ref': [], 'flags': [],
                }
                if not los:
                    q['flags'].append('no-lo-in-header')
                questions.append(q)
                section = 'stem'
                continue
            m = _SOLUTION.match(bp)
            if m and q is not None and ln.box == 'solution':
                if q['answer']:
                    problems.append(f"p{ln.page}: a second solution follows {q['id']}")
                q['answer'] = m.group(1)
                if (m.group(2) + ln.rest).strip():
                    q['flags'].append('answer-extra')
                section = 'body'
                continue
        if q is None or section is None:
            continue
        if section in ('stem',) or section.startswith('opt:'):
            if ln.box != 'question':
                if text and ln.box != 'solution':
                    section = None
                continue
            om = _OPT.match(bp) if ln.kind == 'text' else None
            if om:
                section = 'opt:' + om.group(1)
                q['options'][om.group(1)] = [B._Rest(ln)]
            elif section == 'stem':
                q['stem'].append(ln)
            else:
                q['options'][section[4:]].append(ln)
            continue
        # Inside the solution.
        if ln.box not in ('solution', 'other'):
            if text:
                section = None
            continue
        if ln.kind == 'text' and bp:
            if bp.startswith('LO:'):
                section = 'ref'
                q['ref'].append(ln)
                continue
            if _OTHERS_HEAD.match(bp) and bp == B._unbold(text):
                section = 'others'
                continue
            wm = _WRONG.match(bp)
            if wm and section in ('others', 'body'):
                letters = re.findall(r'[A-E]', wm.group(1))
                section = 'others'
                q['_last'] = letters
                for k in letters:
                    q['others'].setdefault(k, []).append(B._Rest(ln))
                continue
        if section == 'ref':
            # The LO / Reference note closes a solution: it is set smaller than everything that can follow.
            if ln.kind != 'text' or ln.size > 8.6 or (bp and not bp.startswith(('LO:', 'Reference:'))):
                section = None
                continue
            q['ref'].append(ln)
        elif section == 'others' and q.get('_last'):
            for k in q['_last']:
                q['others'][k].append(ln)
        elif section == 'others':
            q['flags'].append('text-before-first-wrong-option')
            q['body'].append(ln)
        else:
            q['body'].append(ln)
    return questions, problems


def finish(q: dict, vocab: Counter) -> dict:
    flags = q['flags']

    def md(lines):
        return B.to_markdown(B.paragraphs(lines, vocab, flags, LEFT, RIGHT))

    out = {
        'id': q['id'], 'section': q['section'], 'k': q['k'], 'page': q['page'], 'tags': q['tags'], 'los': q['los'], 'shapes': q['shapes'],
        'stem': md(q['stem']),
        'options': {k: md(v) for k, v in q['options'].items()},
        'answer': q['answer'],
        'solution': md(q['body']),
        'others': {k: md(v) for k, v in q['others'].items()},
        'reference': md(q['ref']),
        'flags': flags,
    }
    text_all = ' '.join([out['stem'], out['solution'], out['reference'], *out['options'].values(), *out['others'].values()])
    keys = sorted(out['options'])
    if not out['stem']:
        flags.append('no-stem')
    if keys not in (['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D', 'E']) or any(not v for v in out['options'].values()):
        flags.append(f'options-{"".join(keys) or "none"}')
    if out['answer'] not in keys:
        flags.append('no-answer')
    if sorted(out['others']) != [k for k in keys if k != out['answer']]:
        flags.append('others-' + (''.join(sorted(out['others'])) or 'none'))
    if not out['solution']:
        flags.append('no-solution')
    if '�' in text_all or re.search('[-]', text_all):
        flags.append('unknown-glyph')
    if r'\surd' in text_all:
        flags.append('bare-radical')
    out['flags'] = sorted(set(flags))
    return out


def extract(pdf_path: str, first: int = 1, last: int | None = None) -> dict:
    L.MATH_RULE = MATH_RULE
    L.MATH_FONT = lambda font: 'math' in font.lower() or font.startswith('CM')
    L.MATH_ITALIC_FONT = lambda font: font.startswith('CMMI')
    shared = B.build_vocab([])
    L.JOIN = lambda a, b: B.join_pair(a, b, shared)
    pdf = pdfplumber.open(pdf_path)
    unknown = {}
    lines = []
    for page in pdf.pages[first - 1:last]:
        lines += L.page_lines(page, GLYPHS, unknown, box_kind, clip=(40.0, 795.0))
        page.flush_cache()
    vocab = B.build_vocab(lines)
    raw, problems = parse(lines)
    questions = [finish(q, vocab) for q in raw]
    for key, pages in sorted(unknown.items()):
        problems.append(f'unmapped glyph {key}: {len(pages)} uses, first on p{pages[0]}')
    return {'file': os.path.basename(pdf_path), 'pages': len(pdf.pages), 'questions': questions, 'problems': problems, 'lines': lines}


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
            print(f"p{ln.page} {ln.box[:1] or '-'} x{ln.x0:5.1f}-{ln.x1:5.1f} s{ln.size:4.1f} [{ln.bold_prefix}] {ln.text} {ln.flags or ''}")
    del res['lines']
    with open(args[1], 'w', encoding='utf8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    qs = res['questions']
    flags = Counter(f for q in qs for f in q['flags'])
    print(f"{res['file']}: {len(qs)} questions, {sum(1 for q in qs if q['flags'])} flagged, {len(res['problems'])} problems")
    for k, v in flags.most_common():
        print(f'  {v:5d} {k}')
    for p in res['problems'][:25]:
        print('  PROBLEM', p)


if __name__ == '__main__':
    main()
