#!/usr/bin/env python3
"""Extracts the questions of a "Gold-source question bank" PDF, word for word, into JSON.

    extract_bank.py <bank.pdf> <out.json> [--pages A-B] [--dump]

Each question keeps its number, reading and LO (as printed), source tag, editor's note, stem, options, answer,
key correction, worked steps, the reason the answer is right and the reason each other option is wrong. Text is
the portal's content format (markdown + $KaTeX$ + pipe tables); see pdf_layout.py for how layout is rebuilt.
Anything the parser is unsure about is listed under "flags" on the question, and under "problems" for the file.
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

M = 'CambriaMath'
#: Glyphs these PDFs carry without a Unicode value, identified from the rendered pages.
CID_TEXT = {
    ('Cambria', 976): 'f', ('Cambria-Bold', 976): 'f',
    # Accents typeset over a letter (they only occur in text the source had garbled; fix_text repairs it).
    ('Cambria', 441): '̂', ('Cambria', 450): '̃', ('Cambria', 454): '̈',
    ('Cambria-Bold', 441): '̂', ('Cambria-Bold', 450): '̃', ('Cambria-Bold', 454): '̈',
    (M, 3493): '√', (M, 3495): '√',
    (M, 3427): '[', (M, 3431): ']', (M, 3428): '[', (M, 3432): ']', (M, 3429): '[', (M, 3433): ']',
    (M, 3435): '(', (M, 3439): ')', (M, 3436): '(', (M, 3440): ')', (M, 3437): '(', (M, 3441): ')',
    (M, 4672): '(', (M, 4673): ')', (M, 4674): '[', (M, 4675): ']', (M, 4678): '(', (M, 4679): ')',
    (M, 4680): '[', (M, 4681): ']', (M, 4682): '{', (M, 4683): '}',
    # Pieces of an underbrace: no text.
    (M, 3606): '', (M, 4579): '', (M, 4580): '', (M, 4581): '', (M, 4583): '',
}

#: Brackets that only occur around stacked rows (a matrix): the line model flattens those, so they are flagged.
FLAG_CIDS = {(M, 4678): 'matrix', (M, 4679): 'matrix'}

RIGHT_MARGIN = 537.7
LEFT_MARGIN = 57.5


def box_kind(frame: dict) -> str:
    c = frame['fill']
    if not c or not isinstance(c, (tuple, list)) or len(c) < 3:
        return ''
    r, g, b = c[:3]
    if g > r + 0.15 and g > b + 0.1 and g < 0.6:
        return 'answer'
    if abs(r - 0.47) < 0.08 and abs(g - 0.50) < 0.08 and abs(b - 0.56) < 0.08:
        return 'question'
    return ''


# ---------------------------------------------------------------------------------------------------------------
# Lines -> paragraphs.

_HYPHENS = ('‑', '-')
_WORD = re.compile(r"[A-Za-z]+")
_ENUM = re.compile(r'^(\d{1,2})\. ')
_ROMAN = re.compile(r'^(?:\(?(?:[IVX]{1,4}|[ivx]{1,4})[.)]|Statement [0-9IVX]+\b|\([a-e]\)|[1-9]\))\s')
_DISPLAY = re.compile(r'^\$([^$]+)\$([.,;]?)$')


VOCAB_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'data', 'build-inputs', 'question-banks', 'vocab.txt')


def build_vocab(all_lines: list) -> Counter:
    """Words seen whole inside lines (this document, plus the shared list from all the source PDFs); decides whether
    "pro-" + "duces" at a line break is one word."""
    vocab = Counter()
    if os.path.exists(VOCAB_FILE):
        with open(VOCAB_FILE, encoding='utf8') as f:
            vocab.update({w.strip(): 3 for w in f if w.strip()})
    for ln in all_lines:
        if ln.kind != 'text':
            continue
        words = _WORD.findall(ln.text)
        if ln.text.rstrip().endswith(_HYPHENS) and words:
            words = words[:-1]
        vocab.update(w.lower() for w in words[1:] if len(w) > 1)
    return vocab


def join_pair(a: str, b: str, vocab: Counter) -> str:
    """Joins two consecutive lines of a paragraph, undoing a typesetter's hyphenation but keeping real hyphens."""
    a = a.rstrip()
    b = b.lstrip()
    if a.endswith(_HYPHENS) and b[:1].isalpha():
        m1 = re.search(r"([A-Za-z]+)[‑-]$", a)
        m2 = re.match(r"[A-Za-z]+", b)
        if m1 and m2:
            w1, w2 = m1.group(1), m2.group(0)
            proper = w2[:1].isupper() and not w1.isupper()
            whole = vocab.get((w1 + w2).lower(), 0) > 0
            # A compound of two words keeps its hyphen ("longer‑horizon"); a broken word loses it ("pro‑duces").
            compound = vocab.get(w1.lower(), 0) > 0 and vocab.get(w2.lower(), 0) > 0
            if not proper and (whole or not compound):
                return a[:-1] + b
        return a + b
    if a.endswith(_HYPHENS) and b[:1].isdigit():
        return a + b
    return a + ' ' + b


def _is_heading(ln) -> bool:
    bp = getattr(ln, 'bold_prefix', '')
    return bool(bp) and (bp == _unbold(ln.text.strip()) or bool(re.match(r'^Step \d+ [–-] ', bp)))


class Para:
    def __init__(self, kind: str, text: str, marker: str = ''):
        self.kind = kind  # 'p' | 'bullet' | 'enum' | 'table' | 'display'
        self.text = text
        self.marker = marker


def paragraphs(lines: list, vocab: Counter, flags: list, left: float | None = None, right: float | None = None) -> list:
    """Groups the lines of one field into paragraphs, list items, tables and display formulas. `left` and `right`
    are the text margins of the frame the lines sit in (defaults: this document family's)."""
    LEFT_MARGIN = globals()['LEFT_MARGIN'] if left is None else left
    RIGHT_MARGIN = globals()['RIGHT_MARGIN'] if right is None else right
    out = []
    prev = None
    for ln in lines:
        if ln.flags:
            flags.extend(f for f in ln.flags if f not in flags)
        if ln.kind == 'table':
            out.append(Para('table', ln.text))
            prev = None
            continue
        text = ln.text.strip()
        if not text:
            continue
        centre = (ln.x0 + ln.x1) / 2
        m = _DISPLAY.match(text)
        if m and ln.x0 > LEFT_MARGIN + 28 and abs(centre - (LEFT_MARGIN + RIGHT_MARGIN) / 2) < 14:
            out.append(Para('display', '$$' + m.group(1).strip() + '$$'))
            prev = None
            continue
        bullet = text.startswith('• ') or text == '•'
        enum = _ENUM.match(text)
        # A line set wholly in bold is a heading: its own paragraph, whatever the lines around it look like.
        # (A "Step 2 – EPE × marginal PD" heading has its math signs in another font, so go by its opening too.)
        heading = _is_heading(ln)
        after_heading = prev is not None and _is_heading(prev)
        starts_new = (
            prev is None
            or bullet
            or heading
            or after_heading
            or text.startswith('⇒')
            or (enum and ln.x0 < prev.x0 + 4 and (out and out[-1].kind == 'enum' or enum.group(1) == '1' or ln.x0 > LEFT_MARGIN + 2.5))
            or bool(_ROMAN.match(text))
            or prev.x1 < RIGHT_MARGIN - 7
            or (ln.page == prev.page and (ln.top - prev.bottom) > 0.85 * max(ln.size, prev.size))
        )
        # A wrapped list item continues on a hanging indent: never a new paragraph.
        if not bullet and not enum and prev is not None and out and out[-1].kind in ('bullet', 'enum') and ln.x0 > prev.x0 + 4 and prev.x1 >= RIGHT_MARGIN - 7:
            starts_new = False
        if starts_new:
            if bullet:
                out.append(Para('bullet', text[1:].strip()))
            elif enum and (ln.x0 > LEFT_MARGIN + 2.5 or (out and out[-1].kind == 'enum') or enum.group(1) == '1'):
                out.append(Para('enum', text[enum.end():].strip(), enum.group(1)))
            elif out and out[-1].kind in ('bullet', 'enum') and prev is not None and ln.x0 > LEFT_MARGIN + 9 and abs(ln.x0 - prev.x0) < 1.5 and not _ROMAN.match(text):
                # A short continuation line of a list item.
                out[-1].text = join_pair(out[-1].text, text, vocab)
            else:
                out.append(Para('p', text))
        else:
            out[-1].text = join_pair(out[-1].text, text, vocab)
        prev = ln
    return out


def to_markdown(paras: list) -> str:
    blocks = []
    for p in paras:
        if p.kind == 'bullet':
            line = '- ' + p.text
        elif p.kind == 'enum':
            line = p.marker + '. ' + p.text
        else:
            line = _guard(p.text) if p.kind == 'p' else p.text
        if blocks and p.kind in ('bullet', 'enum') and blocks[-1][0] == p.kind:
            blocks[-1][1].append(line)
        else:
            blocks.append([p.kind, [line]])
    return '\n\n'.join('\n'.join(b[1]) for b in blocks).strip()


def _guard(text: str) -> str:
    """Stops a paragraph that happens to start like markdown structure from becoming a list, heading or quote."""
    if re.match(r'^(\d+)\. ', text):
        return re.sub(r'^(\d+)\. ', r'\1\\. ', text)
    if re.match(r'^[-+#>] ', text) or re.match(r'^#', text):
        return '\\' + text
    return text


# ---------------------------------------------------------------------------------------------------------------
# Line stream -> questions.

_Q = re.compile(r'^Q(\d+)$')
_OPT = re.compile(r'^([A-E])\.$')
_ANSWER = re.compile(r'^Answer:\s*([A-E])\b(.*)$')
_WHY = re.compile(r'^Why ([A-E]) is correct:?$')
_OTHER = re.compile(r'^•\s*\*\*([A-E]):\*\*\s*(.*)$')
_READING = re.compile(r'^Reading (\d+)\.\s*(.*)$')
_LO = re.compile(r'^LO (\d+)\.([a-z])$')


def strip_bold_prefix(ln) -> str:
    """Line text without its leading bold label."""
    return ln.rest


def parse(lines: list, vocab: Counter) -> tuple:
    questions = []
    problems = []
    reading = None
    lo = None
    q = None
    section = None  # where lines of the current question go
    lo_lines = []

    def close_lo():
        nonlocal lo_lines
        if lo is not None and lo_lines and not lo.get('text'):
            lo['text'] = to_markdown(paragraphs(lo_lines, vocab, []))
        lo_lines = []

    def close_q():
        nonlocal q, section
        if q is not None:
            questions.append(q)
        q, section = None, None

    for ln in lines:
        text = ln.text.strip()
        bp = ln.bold_prefix
        if not ln.box:
            # Headings and LO wording sit outside the frames.
            if ln.kind == 'text' and ln.size >= 13 and bp:
                m = _READING.match(bp)
                if m:
                    close_q()
                    close_lo()
                    reading = {'number': int(m.group(1)), 'title': m.group(2).strip()}
                    lo = None
                    continue
                if reading is not None and lo is None and bp == _unbold(text):
                    reading['title'] = (reading['title'] + ' ' + bp).strip()
                    continue
            m = _LO.match(bp) if ln.kind == 'text' else None
            if m and bp == _unbold(text):
                close_q()
                close_lo()
                lo = {'reading': int(m.group(1)), 'letter': m.group(2), 'text': ''}
                continue
            if q is None and lo is not None and ln.kind == 'text' and ln.size >= 9.5:
                lo_lines.append(ln)
                continue
            if q is None:
                continue
            # Unframed text while a question is open: frames always enclose question and answer.
            if text:
                q['flags'].append('text-outside-frame')
            continue

        if ln.box == 'question':
            m = _Q.match(bp.split()[0]) if bp else None
            if m and ln.kind == 'text':
                close_q()
                close_lo()
                q = {
                    'n': int(m.group(1)), 'page': ln.page,
                    'reading': dict(reading) if reading else None, 'lo': dict(lo) if lo else None,
                    'source': strip_bold_prefix(ln).strip(), 'note': [], 'stem': [], 'options': {},
                    'answer': None, 'answer_extra': '', 'key': [], 'steps': [], 'why': [], 'why_letter': None,
                    'others': {}, 'flags': [],
                }
                if lo is None or reading is None:
                    q['flags'].append('no-lo-heading')
                section = 'stem'
                continue
            if q is None:
                problems.append(f'p{ln.page}: question-frame text before any question: {text[:60]!r}')
                continue
            if section in ('answer', 'key', 'steps', 'why', 'others'):
                q['flags'].append('question-frame-after-answer')
                continue
            om = _OPT.match(bp) if ln.kind == 'text' else None
            if om:
                section = 'opt:' + om.group(1)
                q['options'][om.group(1)] = [_Rest(ln)]
                continue
            # The editor's note ("REBUILT — ...", "NEW — ...") is set small, above the stem.
            if section == 'stem' and ln.kind == 'text' and not q['stem'] and ln.size < 8.5 and (bp.startswith(('REBUILT', 'NEW')) or q['note']):
                q['note'].append(ln)
                continue
            if section == 'stem':
                q['stem'].append(ln)
            elif section and section.startswith('opt:'):
                q['options'][section[4:]].append(ln)
            continue

        # Answer frame.
        if q is None:
            problems.append(f'p{ln.page}: answer-frame text before any question: {text[:60]!r}')
            continue
        if ln.kind == 'text' and bp:
            am = _ANSWER.match(bp)
            if am:
                q['answer'] = am.group(1)
                q['answer_extra'] = (am.group(2) + ' ' + strip_bold_prefix(ln)).strip()
                section = 'answer'
                continue
            if bp.startswith('Key correction'):
                section = 'key'
                q['key'].append(_Rest(ln))
                continue
            if bp == 'Step by step':
                section = 'steps'
                continue
            wm = _WHY.match(bp)
            if wm:
                section = 'why'
                q['why_letter'] = wm.group(1)
                q['why'].append(_Rest(ln))
                continue
            if bp == 'Why the others are wrong':
                section = 'others'
                continue
        if section == 'others' and ln.kind == 'text':
            om = _OTHER.match(text)
            if om:
                q['others'][om.group(1)] = [_Rest(ln, om.group(2))]
                q['_last_other'] = om.group(1)
                continue
            if q.get('_last_other'):
                q['others'][q['_last_other']].append(ln)
                continue
        if section == 'others' and q.get('_last_other'):
            q['others'][q['_last_other']].append(ln)
        elif section == 'key':
            q['key'].append(ln)
        elif section == 'steps':
            q['steps'].append(ln)
        elif section == 'why':
            q['why'].append(ln)
        elif section == 'answer':
            q['flags'].append('text-after-answer-line')
            q['steps'].append(ln)
        else:
            q['flags'].append('answer-frame-before-answer')
    close_q()
    close_lo()
    return questions, problems


def _unbold(text: str) -> str:
    return L._unescape(text.replace('**', '')).strip()


class _Rest:
    """A line seen without its leading label (keeps the geometry the paragraph builder needs)."""

    def __init__(self, ln, text=None):
        self.kind = ln.kind
        self.text = ln.rest if text is None else text
        self.x0, self.x1, self.top, self.bottom, self.size, self.page, self.flags = ln.x0, ln.x1, ln.top, ln.bottom, ln.size, ln.page, ln.flags


def finish(q: dict, vocab: Counter) -> dict:
    flags = q['flags']
    md = lambda lines: to_markdown(paragraphs(lines, vocab, flags))  # noqa: E731
    out = {
        'n': q['n'],
        'page': q['page'],
        'reading': q['reading'],
        'lo': q['lo'],
        'source': re.sub(r'\s+', ' ', L._unescape(q['source'])).strip(),
        'note': md(q['note']),
        'stem': md(q['stem']),
        'options': {k: md(v) for k, v in q['options'].items()},
        'answer': q['answer'],
        'answer_extra': q['answer_extra'],
        'key': md(q['key']),
        'steps': md(q['steps']),
        'why': md(q['why']),
        'others': {k: md(v) for k, v in q['others'].items()},
        'flags': flags,
    }
    text_all = ' '.join([out['stem'], out['steps'], out['why'], out['key'], out['note'], *out['options'].values(), *out['others'].values()])
    keys = sorted(out['options'])
    if not out['stem']:
        flags.append('no-stem')
    if keys not in (['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D', 'E']) or any(not v for v in out['options'].values()):
        flags.append(f'options-{"".join(keys) or "none"}')
    if out['answer'] not in keys:
        flags.append('no-answer')
    if q['why_letter'] and q['why_letter'] != out['answer']:
        flags.append('why-letter-differs')
    if not out['why']:
        flags.append('no-why')
    want = [k for k in keys if k != out['answer']]
    if sorted(out['others']) != want:
        flags.append('others-' + (''.join(sorted(out['others'])) or 'none'))
    if not out['steps']:
        flags.append('no-steps')
    if '�' in text_all:
        flags.append('unknown-glyph')
    if r'\surd' in text_all:
        flags.append('bare-radical')
    if out['answer_extra']:
        flags.append('answer-extra')
    out['flags'] = sorted(set(flags))
    return out


def extract(pdf_path: str, first: int = 1, last: int | None = None) -> dict:
    pdf = pdfplumber.open(pdf_path)
    unknown = {}
    lines = []
    shared = build_vocab([])
    L.MATH_RULE = (0.55, 0.75)
    L.JOIN = lambda a, b: join_pair(a, b, shared)
    for page in pdf.pages[first - 1:last]:
        lines += L.page_lines(page, CID_TEXT, unknown, box_kind, clip=(40.0, 800.0), flag_cids=FLAG_CIDS)
        page.flush_cache()
    vocab = build_vocab(lines)
    raw, problems = parse(lines, vocab)
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
    flags = Counter(f for q in res['questions'] for f in q['flags'])
    print(f"{res['file']}: {len(res['questions'])} questions, {sum(1 for q in res['questions'] if q['flags'])} flagged, {len(res['problems'])} problems")
    for k, v in flags.most_common():
        print(f'  {v:5d} {k}')
    for p in res['problems'][:25]:
        print('  PROBLEM', p)


if __name__ == '__main__':
    main()
