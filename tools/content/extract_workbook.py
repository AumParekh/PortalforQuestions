#!/usr/bin/env python3
"""Extracts the practice questions of a "Notes + Question Workbook" PDF, word for word, into JSON.

    extract_workbook.py <workbook.pdf> <out.json> [--pages A-B] [--dump]

Each LO block of a workbook ends with "Practice questions" (framed questions) followed by "Solutions" (framed
solutions). A question carries its LO in its number ("MR-2 a.4") and a source tag: "Bank Q84 ..." marks a repeat of
a question-bank question, anything else ("Workbook A19.5 ...", "New ...", "Adapted from ...") exists only here.
Text is the portal's content format; see pdf_layout.py.
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

#: Private-use code points the heading font uses for ordinary punctuation.
CHAR_TEXT = {('char', ''): '-', ('char', ''): '(', ('char', ''): ')', ('char', ''): ':', ('char', ''): '+', ('char', ''): '−'}
#: Bars drawn by the math font (fractions, roots); every other rule belongs to a table, a frame or a figure.
MATH_RULE = (0.44, 0.51)
LEFT, RIGHT = 68.0, 527.3

_QUESTION = re.compile(r'^Question ([A-Z]+)-(\d+) ([a-z])\.(\d+)$')
_SOLUTION = re.compile(r'^Solution ([A-Z]+)-(\d+) ([a-z])\.(\d+)\s+Answer:\s*([A-E])\b(.*)$')
_OPT = re.compile(r'^([A-E])\.$')
_WRONG = re.compile(r'^([A-E](?:(?:, | and |, and )[A-E])*) (?:is|are) incorrect\.$')
_OTHERS_HEAD = re.compile(r'^Why (the )?other(s| options| option| choices) (is|are) wrong', re.I)


def box_kind(frame: dict) -> str:
    c = frame['fill']
    if not c or not isinstance(c, (tuple, list)) or len(c) < 3:
        return ''
    r, g, b = (round(float(x), 2) for x in c[:3])
    if (r, g, b) == (0.96, 0.96, 0.97):
        return 'question'
    if (r, g, b) in ((0.79, 0.83, 0.87), (0.98, 0.98, 0.98)):
        return 'solution'
    return 'other'


def parse(lines: list) -> tuple:
    questions = {}
    order = []
    problems = []
    q = None       # question being read
    sol = None     # solution being read
    section = None
    for ln in lines:
        text = ln.text.strip()
        bp = ln.bold_prefix
        if ln.kind == 'text' and bp:
            m = _QUESTION.match(bp)
            if m:
                qid = f'{m.group(1)}-{m.group(2)} {m.group(3)}.{m.group(4)}'
                q = {
                    'id': qid, 'area': m.group(1), 'reading': int(m.group(2)), 'letter': m.group(3), 'k': int(m.group(4)),
                    'page': ln.page, 'source': ln.rest.strip(), 'stem': [], 'options': {}, 'answer': None,
                    'body': [], 'others': {}, 'ref': [], 'solution_source': '', 'flags': [],
                }
                if qid in questions:
                    problems.append(f'p{ln.page}: question {qid} appears twice')
                questions[qid] = q
                order.append(qid)
                sol, section = None, 'stem'
                continue
            m = _SOLUTION.match(bp)
            if m:
                qid = f'{m.group(1)}-{m.group(2)} {m.group(3)}.{m.group(4)}'
                sol = questions.get(qid)
                q = None
                if sol is None:
                    problems.append(f'p{ln.page}: solution {qid} has no question')
                    section = None
                    continue
                if sol['answer']:
                    problems.append(f'p{ln.page}: solution {qid} appears twice')
                sol['answer'] = m.group(5)
                extra = (m.group(6) + ' ' + ln.rest).strip()
                if extra:
                    sol['flags'].append('answer-extra')
                    sol['answer_extra'] = extra
                section = 'head'
                continue
            if re.match(r'^(Practice questions|Solutions\b)', bp):
                q, sol, section = None, None, None
                continue
        if q is not None:
            if ln.box != 'question':
                # The frame has ended: notes or the next block.
                q = None
                continue
            om = _OPT.match(bp) if ln.kind == 'text' else None
            if om:
                section = 'opt:' + om.group(1)
                q['options'][om.group(1)] = [B._Rest(ln)]
            elif section == 'stem':
                q['stem'].append(ln)
            elif section and section.startswith('opt:'):
                q['options'][section[4:]].append(ln)
            continue
        if sol is not None:
            if ln.box not in ('solution', 'other'):
                if text:
                    sol = None
                continue
            if section == 'head' and ln.kind == 'text' and ln.size < 9.0 and not bp:
                sol['solution_source'] = text
                section = 'body'
                continue
            if section == 'head':
                section = 'body'
            if ln.kind == 'text' and bp:
                if bp.startswith('LO:'):
                    section = 'ref'
                    sol['ref'].append(ln)
                    continue
                if _OTHERS_HEAD.match(bp) and bp == B._unbold(text):
                    section = 'others'
                    continue
                wm = _WRONG.match(bp)
                if wm and section in ('others', 'body'):
                    letters = re.findall(r'[A-E]', wm.group(1))
                    section = 'others'
                    sol['_last'] = letters
                    for k in letters:
                        sol['others'].setdefault(k, []).append(B._Rest(ln))
                    if len(letters) > 1:
                        sol['flags'].append('shared-reason')
                    continue
            if section == 'ref':
                # The LO / Reference note closes a solution: it is set smaller than everything that can follow.
                if ln.kind != 'text' or ln.size > 9.4 or (bp and not bp.startswith(('LO:', 'Reference:', 'erence:'))):
                    sol = None
                    continue
                sol['ref'].append(ln)
            elif section == 'others' and sol.get('_last'):
                for k in sol['_last']:
                    sol['others'][k].append(ln)
            elif section == 'others':
                sol['flags'].append('text-before-first-wrong-option')
                sol['body'].append(ln)
            else:
                sol['body'].append(ln)
    return [questions[k] for k in order], problems


def finish(q: dict, vocab: Counter) -> dict:
    flags = q['flags']

    def md(lines):
        return B.to_markdown(B.paragraphs(lines, vocab, flags, LEFT, RIGHT))

    out = {
        'id': q['id'], 'area': q['area'], 'reading': q['reading'], 'letter': q['letter'], 'k': q['k'], 'page': q['page'],
        'source': re.sub(r'\s+', ' ', L._unescape(q['source'])).strip(),
        'stem': md(q['stem']),
        'options': {k: md(v) for k, v in q['options'].items()},
        'answer': q['answer'],
        'answer_extra': q.get('answer_extra', ''),
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
    want = [k for k in keys if k != out['answer']]
    if sorted(out['others']) != want:
        flags.append('others-' + (''.join(sorted(out['others'])) or 'none'))
    if not out['solution']:
        flags.append('no-solution')
    if '�' in text_all or re.search('[-]', text_all):
        flags.append('unknown-glyph')
    if r'\surd' in text_all:
        flags.append('bare-radical')
    if re.search('[⏟⏞⎧⎨⎩⎛⎝⎞⎠]', text_all):
        # Braces and brackets built from pieces (labelled braces, cases, matrices): the line model flattens them.
        flags.append('brace')
    if re.search(r'\b(Figure|figure|chart|diagram|graph) (below|above|\d)', out['stem'] + ' '.join(out['options'].values())):
        flags.append('refers-to-figure')
    out['flags'] = sorted(set(flags))
    return out


def extract(pdf_path: str, first: int = 1, last: int | None = None) -> dict:
    L.MATH_RULE = MATH_RULE
    shared = B.build_vocab([])
    L.JOIN = lambda a, b: B.join_pair(a, b, shared)
    pdf = pdfplumber.open(pdf_path)
    unknown = {}
    lines = []
    for page in pdf.pages[first - 1:last]:
        lines += L.page_lines(page, CHAR_TEXT, unknown, box_kind, clip=(40.0, 795.0))
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
    own = [q for q in qs if not q['source'].startswith('Bank')]
    flags = Counter(f for q in own for f in q['flags'])
    print(f"{res['file']}: {len(qs)} questions ({len(own)} not from the bank), {sum(1 for q in own if q['flags'])} of those flagged, {len(res['problems'])} problems")
    for k, v in flags.most_common():
        print(f'  {v:5d} {k}')
    for p in res['problems'][:25]:
        print('  PROBLEM', p)


if __name__ == '__main__':
    main()
