#!/usr/bin/env python3
"""Extracts the questions of the "All valid practice questions" compilation (past papers), word for word.

    extract_pastyear.py <compilation.pdf> <out.json> [--pages A-B] [--dump]

The PDF has three parts. Part 1 holds the questions: each is framed, headed "Question 12  MR-2c · P1", opens with
its source ("Source: 2026 PE1 Q33"), may carry a note, and closes with the wording of the LOs it tests. Part 3 holds
the solutions in the same order: "Solution 12 · correct answer B", then Concept, Working (calculations only),
Option by option, an Exam trap where there is one and sometimes an answer-key note. Text is the portal's content
format; see pdf_layout.py.
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

#: Ticks, crosses and the arrows of the link buttons.
GLYPHS = {('Dingbats', '3'): '✓', ('Dingbats', '7'): '✗', ('Dingbats', 228): '➤', ('Dingbats', 'ä'): '➤'}
#: Fraction and radical bars; table rules are thicker (0.70 and up) or thinner (0.45).
MATH_RULE = (0.46, 0.6)
LEFT, RIGHT = 66.1, 529.2
CLIP = (48.0, 795.0)

_QUESTION = re.compile(r'^Question (\d+)\s+((?:MR|CR|ORR|LTR|IM|CI)-\d+[a-z])\s*·\s*(P\d)(?:\s+(?:MR|CR|ORR|LTR|IM|CI)-\d+[a-z]\s*·\s*P\d)*$')
_SOLUTION = re.compile(r'^Solution (\d+)\s*·\s*correct answer ([A-E])\b')
_LO = re.compile(r'^((?:MR|CR|ORR|LTR|IM|CI)-\d+[a-z])$')
_OPTION = re.compile(r'^([A-E])\s+(\S.*)$', re.S)
_VERDICT = re.compile(r'^\s*[✓✗]\s*')
_BUTTON = re.compile(r'\s*(?:➤\s*)?\**(Go to solution|Back to question) \d+\**\s*(?:➤\s*)?')
HEADS = {'CONCEPT': 'concept', 'WORKING': 'working', 'OPTION BY OPTION': 'options'}


def _source(text: str) -> str:
    return _BUTTON.sub('', L._unescape(text)).replace('Source:', '').strip()


def parse(lines: list) -> tuple:
    questions, solutions, problems = {}, {}, []
    part = 0
    cur = None
    section = None
    for ln in lines:
        text = ln.text.strip()
        bp = ln.bold_prefix
        if ln.kind == 'text' and ln.size > 14 and bp.startswith('Part '):
            part = int(bp[5])
            cur = None
            continue
        if ln.kind == 'text' and ln.size > 14:
            part, cur = 9, None  # the lists at the back
            continue
        if part not in (1, 3):
            continue
        if ln.kind == 'text' and bp:
            m = _QUESTION.match(bp) if part == 1 else None
            if m:
                cur = {'n': int(m.group(1)), 'lo': m.group(2), 'band': m.group(3), 'page': ln.page, 'source': '', 'note': [], 'body': [], 'los': [], 'flags': []}
                if cur['n'] in questions:
                    problems.append(f'p{ln.page}: question {cur["n"]} appears twice')
                questions[cur['n']] = cur
                section = 'body'
                continue
            m = _SOLUTION.match(bp) if part == 3 else None
            if m:
                cur = {'n': int(m.group(1)), 'answer': m.group(2), 'page': ln.page, 'source': '', 'concept': [], 'working': [], 'options': {}, 'trap': [], 'keynote': [], 'flags': []}
                if cur['n'] in solutions:
                    problems.append(f'p{ln.page}: solution {cur["n"]} appears twice')
                solutions[cur['n']] = cur
                section = 'head'
                continue
        if cur is None:
            continue
        if ln.kind == 'text' and _BUTTON.fullmatch(L._unescape(text)):
            continue
        if ln.kind == 'text' and text.startswith('Source:') and ln.size < 8:
            cur['source'] = _source(text)
            continue
        # The LO wording that closes a question or solution, and a note on the question, are set smaller than
        # everything else.
        if ln.kind == 'text' and ln.size < 6.9 and (_LO.match(bp) or text.startswith('Note:') or section in ('foot', 'footnote')):
            if _LO.match(bp):
                cur.setdefault('los', []).append(bp)
                section = 'foot'
            elif text.startswith('Note:') or section == 'footnote':
                cur.setdefault('note', []).append(ln)
                section = 'footnote'
            continue
        if section in ('foot', 'footnote'):
            # Only a chapter heading may stand between two questions.
            if text and not (ln.kind == 'text' and bp and bp == B._unbold(text)):
                problems.append(f'p{ln.page}: text after the LO note of {cur["n"]}: {text[:60]}')
            continue
        if part == 1:
            cur['body'].append(ln)
            continue
        # Inside a solution.
        if ln.kind == 'text' and bp in HEADS and bp == B._unbold(text):
            section = HEADS[bp]
            continue
        if ln.kind == 'text' and bp == 'EXAM TRAP':
            section = 'trap'
            cur['trap'].append(B._Rest(ln))
            continue
        if ln.kind == 'text' and bp.startswith('ANSWER-KEY NOTE'):
            section = 'keynote'
            cur['keynote'].append(B._Rest(ln, (bp[len('ANSWER-KEY NOTE'):] + ' ' + ln.rest).strip() if bp != 'ANSWER-KEY NOTE' else None))
            continue
        if section == 'options':
            if ln.kind == 'text' and re.fullmatch(r'[A-E]', bp) and _VERDICT.match(ln.rest):
                tick = '✓' in ln.rest[:4]
                if tick != (bp == cur['answer']):
                    cur['flags'].append('tick-disagrees')
                cur['_last'] = bp
                rest = B._Rest(ln, _VERDICT.sub('', ln.rest, count=1))
                cur['options'].setdefault(bp, []).append(rest)
            elif cur.get('_last'):
                cur['options'][cur['_last']].append(ln)
            else:
                cur['flags'].append('text-before-first-option')
                cur['working'].append(ln)
            continue
        if section in ('concept', 'working', 'trap', 'keynote'):
            cur[section].append(ln)
        elif text:
            cur['flags'].append('text-before-concept')
            cur['concept'].append(ln)
    return questions, solutions, problems


def split_options(body: list) -> tuple:
    """The stem and the options of a question: the options are its last lines, lettered at the left edge."""
    marks = {}
    want = None
    for i in range(len(body) - 1, -1, -1):
        ln = body[i]
        if ln.kind != 'text' or ln.x0 > LEFT + 6:
            continue
        m = _OPTION.match(ln.text.strip())
        if not m:
            continue
        k = m.group(1)
        # The letter stands alone, a gap before its text.
        first = ln.items[0] if ln.items else None
        alone = first is None or len(getattr(first, 'text', k).strip()) == 1 or True
        if want is None and k in 'DE':
            want = k
        if k == want and alone:
            marks[k] = i
            if k == 'A':
                break
            want = chr(ord(k) - 1)
    if 'A' not in marks:
        return body, {}
    keys = sorted(marks)
    options = {}
    for j, k in enumerate(keys):
        end = marks[keys[j + 1]] if j + 1 < len(keys) else len(body)
        head = body[marks[k]]
        options[k] = [B._Rest(head, _OPTION.match(head.text.strip()).group(2))] + body[marks[k] + 1:end]
    return body[:marks['A']], options


def finish(q: dict, s: dict | None, vocab: Counter) -> dict:
    flags = list(q['flags']) + (list(s['flags']) if s else ['no-solution'])

    def md(lines):
        # Frames differ a little in width (the trap box is narrower): go by how far this block's full lines reach.
        reach = max((ln.x1 for ln in lines if ln.kind == 'text'), default=0)
        return B.to_markdown(B.paragraphs(lines, vocab, flags, LEFT, reach if reach > 500 else RIGHT))

    stem, options = split_options(q['body'])
    s = s or {'answer': None, 'source': '', 'concept': [], 'working': [], 'options': {}, 'trap': [], 'keynote': []}
    out = {
        'n': q['n'], 'page': q['page'], 'lo': q['lo'], 'los': q['los'] or [q['lo']], 'band': q['band'], 'source': q['source'],
        'note': re.sub(r'^Note:\s*', '', md(q['note'])),
        'stem': md(stem),
        'options': {k: md(v) for k, v in options.items()},
        'answer': s['answer'],
        'concept': md(s['concept']),
        'working': md(s['working']),
        'others': {k: md(v) for k, v in s['options'].items()},
        'trap': md(s['trap']),
        'keynote': md(s['keynote']),
    }
    keys = sorted(out['options'])
    if not out['stem']:
        flags.append('no-stem')
    if keys not in (['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D', 'E']) or any(not v for v in out['options'].values()):
        flags.append(f'options-{"".join(keys) or "none"}')
    if out['answer'] not in keys:
        flags.append('no-answer')
    if sorted(out['others']) != keys:
        flags.append('others-' + (''.join(sorted(out['others'])) or 'none'))
    if not out['concept']:
        flags.append('no-concept')
    if s['source'] and s['source'] != q['source']:
        flags.append('source-differs')
    if out['lo'] not in out['los']:
        flags.append('lo-not-in-note')
    text_all = ' '.join([out['stem'], out['concept'], out['working'], out['trap'], out['keynote'], out['note'], *out['options'].values(), *out['others'].values()])
    if '�' in text_all or re.search('[\ue000-\uf8ff]', text_all) or '(cid:' in text_all:
        flags.append('unknown-glyph')
    if r'\surd' in text_all:
        flags.append('bare-radical')
    out['flags'] = sorted(set(flags))
    return out


def extract(pdf_path: str, first: int = 1, last: int | None = None) -> dict:
    L.MATH_RULE = MATH_RULE
    L.MATH_FONT = lambda font: 'math' in font.lower() or font.startswith('CM')
    L.MATH_ITALIC_FONT = lambda font: False
    shared = B.build_vocab([])
    L.JOIN = lambda a, b: B.join_pair(a, b, shared)
    pdf = pdfplumber.open(pdf_path)
    unknown = {}
    lines = []
    for page in pdf.pages[first - 1:last]:
        lines += L.page_lines(page, GLYPHS, unknown, lambda frame: '', clip=CLIP)
        page.flush_cache()
    vocab = B.build_vocab(lines)
    questions, solutions, problems = parse(lines)
    out = [finish(q, solutions.get(n), vocab) for n, q in sorted(questions.items())]
    for n in sorted(set(solutions) - set(questions)):
        problems.append(f'solution {n} has no question')
    for key, pages in sorted(unknown.items(), key=str):
        problems.append(f'unmapped glyph {key}: {len(pages)} uses, first on p{pages[0]}')
    return {'file': os.path.basename(pdf_path), 'pages': len(pdf.pages), 'questions': out, 'problems': problems, 'lines': lines}


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
    print(f"{res['file']}: {len(qs)} questions, {sum(1 for q in qs if q['flags'])} flagged, {len(res['problems'])} problems")
    for k, v in flags.most_common():
        print(f'  {v:5d} {k}')
    for p in res['problems'][:25]:
        print('  PROBLEM', p)


if __name__ == '__main__':
    main()
