#!/usr/bin/env python3
"""Adds the question-bank, workbook and high-quality paper questions to content/*.json and tags every question with
its official chapter, learning objective, priority band and LO type (Numerical, Conceptual or Both).

    build_question_bank.py [--extract]

Inputs (data/build-inputs/):
  lo-map/lo-map.json                 official readings, LO wording, P1-P4 band and LO type by wording (build_lo_map.py)
  lo-map/existing-lo-map.json        official LO of each question that was in the portal before this import
  lo-map/tiers.json                  recall-workbook sections and the tier (A-D) of each LO (build_tiers.py)
  question-banks/pdf/*.pdf           the source PDFs
  question-banks/extracted/*.json    extract_bank.py / extract_workbook.py / extract_papers.py output (rebuilt
                                     with --extract)
  question-banks/overrides.json      hand transcriptions for layouts the extractor cannot express

What goes in: every multiple-choice question of the five question banks, and every workbook question that is not
marked as a repeat of a bank question ("Bank Q..."). Wording is kept as printed. Open-ended bank questions (no
options) cannot be multiple choice and are left out; so is anything still carrying a blocking flag.

High-quality papers (PAPERS below) are sets of one paper per learning objective, each question with a worked
solution. All of their questions go in, tagged highQuality (the portal's "High quality questions" filter); a paper
question that repeats one already in the bank is not added twice: the one in the bank gets the tag. To add a set,
put its PDF in question-banks/pdf/, name it in PAPERS and run with --extract.

Re-running is safe: imported questions (ids with -QB-, -WB- or -HQ-) are replaced, the others only re-tagged.
"""
from __future__ import annotations

import csv
import difflib
import json
import os
import re
import subprocess
import sys
from collections import Counter, OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INPUTS = os.path.join(ROOT, 'data', 'build-inputs')
QB = os.path.join(INPUTS, 'question-banks')
EXTRACTED = os.path.join(QB, 'extracted')
CONTENT = os.path.join(ROOT, 'content')

# Portal file code -> (official area code, bank PDF, bank's first reading number minus one, workbook PDF, workbook label).
SUBJECTS = OrderedDict([
    ('IR', ('IM', 'RMIM_Question_Bank.pdf', 82, 'FRM_P2_RMIM_P1-P3_Workbook.pdf', 'Risk Management and Investment Management')),
    ('MR', ('MR', 'MR_Question_Bank.pdf', 0, 'FRM_P2_Market_Risk_P1-P3_Workbook.pdf', 'Market Risk')),
    ('CR', ('CR', 'CR_Question_Bank.pdf', 18, 'FRM_P2_CR_P1-P3_Workbook.pdf', 'Credit Risk')),
    ('LR', ('LTR', 'LR_Question_Bank.pdf', 65, 'FRM_P2_Liquidity_P1-P3_Workbook.pdf', 'Liquidity and Treasury Risk')),
    ('OR', ('ORR', 'OR_Question_Bank.pdf', 41, 'FRM_P2_ORR_P1-P3_Workbook.pdf', 'Operational Risk and Resilience')),
    ('CI', ('CI', None, 0, 'FRM_P2_CI_Workbook.pdf', 'Current Issues')),
])
#: High-quality question papers by portal file code. Their reading numbers are the bank's (SUBJECTS gives the offset).
PAPERS = OrderedDict([
    ('IR', ['HQ_FRM2_RMIM_Linked.pdf']),
    ('MR', ['HQ_FRM2_Market_Risk_Linked.pdf']),
    ('OR', ['HQ_FRM2_ORR_Linked.pdf']),
    ('LR', ['HQ_FRM2_LTR_Linked.pdf']),
])
#: The compilation of past papers (practice exams and the 10-year book): one PDF for every subject.
PAST_PAPERS = 'PY_All_Valid_Questions_2026.pdf'
PAST_TIER = 'Past Papers'
RECALL_SOURCE = re.compile(r'^Workbook ([A-D]\d+\.\d+)\b')
BANK_TIER = 'Question Bank'
WORKBOOK_TIER = 'Workbook'
HQ_TIER = 'High Quality'
IMPORTED = ('-QB-', '-WB-', '-HQ-', '-PY-')
#: What every paper's instructions say; anything else in them is notation its questions rely on.
PAPER_BOILERPLATE = re.compile(r'^Instructions:\s*|choose the single best answer for each question\.\s*|Answers and solutions begin after the blank page\.\s*', re.I)
#: Flags that mean the text may be wrong; a question keeps them only until an override clears them.
BLOCKING = {
    'no-stem', 'no-answer', 'unknown-glyph', 'bare-radical', 'matrix', 'brace', 'unused-rule', 'text-outside-frame',
    'question-frame-after-answer', 'answer-frame-before-answer', 'text-after-answer-line', 'empty-table',
    'text-before-first-wrong-option', 'no-solution', 'why-letter-differs', 'answer-extra',
}


SOURCE_LINE = re.compile(r'\n*\*\*Source:\*\* [^\n]*\s*$')
# The banks and workbooks abbreviate their providers; a source line spells them out.
SPELL_OUT = [
    (re.compile(r'\bBT answers\b'), 'Bionic Turtle answers'),
    (re.compile(r'\bBT notes\b'), 'Bionic Turtle notes'),
    (re.compile(r'\bBT Mock\b'), 'Bionic Turtle mock'),
    (re.compile(r'\bAP Mock\b'), 'AnalystPrep mock'),
    (re.compile(r'\bGARP PE(\d+)\b'), r'GARP practice exam \1'),
    # "Mock AP Mock 3 Q31" and "Mock Mock 1 Q39" double the word as printed.
    (re.compile(r'\bMock (?=AnalystPrep mock|Mock )'), ''),
    (re.compile(r'\bCI QB VI\b'), 'the Current Issues question bank (Very Important set)'),
    (re.compile(r'\bCI QB Imp\b'), 'the Current Issues question bank (Important set)'),
]


def spell_out(text: str) -> str:
    for pattern, full in SPELL_OUT:
        text = pattern.sub(full, text)
    return text.strip().rstrip('.')


def workbook_name(label: str, workbook: str) -> str:
    return f"{label} {'P1–P3 workbook' if 'P1-P3' in workbook else 'workbook'}"


def bank_source(raw: str, label: str, n: int) -> str:
    """The closing line of a question-bank solution: who the question is from, then where it was printed."""
    where = f'Printed in the {label} question bank as Q{n}.'
    new = re.match(r'New question written for this bank\s*(?:\((.*)\))?$', raw.strip())
    if new:
        style = f' ({new.group(1)})' if new.group(1) else ''
        return f'**Source:** Written new for the {label} question bank{style}, where it is Q{n}.'
    return f'**Source:** {spell_out(raw)}. {where}'


def workbook_source(raw: str, name: str, qid: str, sections: dict) -> str:
    """The closing line of a workbook solution. `sections` maps a tier-workbook section id to its title."""
    where = f'Printed in the {name} as question {qid}.'
    parts = [x.strip() for x in re.split(r'\s[•·]\s', raw.strip()) if x.strip()]
    recall = RECALL_SOURCE.match(raw.strip())
    if recall:
        section = recall.group(1).split('.')[0]
        title = f', {sections[section]}' if section in sections else ''
        august = ' It is one of the questions recalled from the August 2026 exam.' if 'Aug-2026' in parts else ''
        return f'**Source:** Tier workbook, Tier {section[0]}, section {section}{title} (question {recall.group(1)}).{august} {where}'
    # "New • built from GARP Ch.5 • S3": the trailing "S3" tags are exam-shape numbers, not a source.
    detail = [x for x in parts[1:] if not re.fullmatch(r'(S\d+(, ?S\d+)*|Map #\d+|Aug-\d{4}|shape [A-D]\d+·S\d+)', x)]
    if parts and re.fullmatch(r'New|self-gen(erated)?', parts[0]):
        built = f", {spell_out(' • '.join(detail))}" if detail else ''
        return f'**Source:** Written new for the {name} (question {qid}){built}.'
    return f'**Source:** {spell_out(raw)}. {where}'


def earlier_source(q: dict, code: str) -> str:
    """Questions that were in the portal before the import carry no printed source."""
    if code == 'CI':
        return f"**Source:** Current Issues question bank ({q['tier']} set)."
    return f"**Source:** The portal's first question set ({q['tier']}). No outside source was recorded for it."


def load(path):
    with open(path, encoding='utf8') as f:
        return json.load(f)


def norm(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()


# ---------------------------------------------------------------------------------------------------------------


def official_index(lo_map: dict) -> dict:
    """LO id -> {id, text, band, kind, reading (label), readingTitle, area}."""
    out = {}
    for area in lo_map['areas']:
        for r in area['readings']:
            for lo in r['los']:
                out[lo['id']] = {
                    'id': lo['id'], 'text': lo['text'], 'band': lo['band'], 'kind': lo['kind'], 'reading': f"{r['id']}: {r['title']}",
                    'readingTitle': r['title'], 'area': area['code'],
                }
    return out


def run_extraction():
    os.makedirs(EXTRACTED, exist_ok=True)
    jobs = []
    here = os.path.dirname(os.path.abspath(__file__))
    for code, (_, bank, _, workbook, _) in SUBJECTS.items():
        if bank:
            jobs.append(subprocess.Popen([sys.executable, os.path.join(here, 'extract_bank.py'), os.path.join(QB, 'pdf', bank), os.path.join(EXTRACTED, f'{code}-bank.json')]))
        jobs.append(subprocess.Popen([sys.executable, os.path.join(here, 'extract_workbook.py'), os.path.join(QB, 'pdf', workbook), os.path.join(EXTRACTED, f'{code}-workbook.json')]))
    for volume, pdf in ((1, 'FRM_Workbook_Vol1_TierA.pdf'), (2, 'FRM_Workbook_Vol2_TiersB-D.pdf')):
        # Read only to confirm that each of their questions is already in the bank (see the report).
        jobs.append(subprocess.Popen([sys.executable, os.path.join(here, 'extract_recall.py'), os.path.join(QB, 'pdf', pdf), os.path.join(EXTRACTED, f'recall-{volume}.json')]))
    for pdfs in PAPERS.values():
        for pdf in pdfs:
            jobs.append(subprocess.Popen([sys.executable, os.path.join(here, 'extract_papers.py'), os.path.join(QB, 'pdf', pdf), os.path.join(EXTRACTED, pdf[:-4] + '.json')]))
    jobs.append(subprocess.Popen([sys.executable, os.path.join(here, 'extract_pastyear.py'), os.path.join(QB, 'pdf', PAST_PAPERS), os.path.join(EXTRACTED, PAST_PAPERS[:-4] + '.json')]))
    if any(j.wait() != 0 for j in jobs):
        sys.exit('extraction failed')


def apply_override(q: dict, ov: dict, key: str) -> tuple:
    """The question with its hand corrections applied, and the flags that remain."""
    q = {**q, **{k: v for k, v in ov.items() if k not in ('clear', 'replace')}}
    for r in ov.get('replace', []):
        if r['old'] not in q[r['field']]:
            sys.exit(f"override {key}: the passage to replace is not in {r['field']} (the extraction changed)")
        q[r['field']] = q[r['field']].replace(r['old'], r['new'])
    return q, [f for f in q['flags'] if f not in ov.get('clear', [])]


# A conceptually worded LO counts as Both once this many of its questions, and this share of them, are calculations.
KIND_MIN_NUMERICAL = 3
KIND_MIN_SHARE = 0.3


def lo_type(options: list) -> str:
    numeric = sum(1 for o in options if re.search(r'\d', o) and len(re.sub(r'[\d\s.,%$\\A-Z()−\-+/×=]', '', o)) <= 12)
    return 'Numerical' if numeric >= len(options) - 1 else 'Qualitative'


def question(qid, subject, tier, lo, text, options, answer, solution, reasons, source):
    keys = sorted(options)
    return {
        'id': qid,
        'subject': subject,
        'tier': tier,
        'lo': lo['id'],
        'loText': lo['text'],
        'reading': lo['reading'],
        'topic': lo['readingTitle'],
        'band': lo['band'],
        'source': source,
        'question': text,
        'options': [{'key': k.lower(), 'text': options[k]} for k in keys],
        'answer': answer.lower(),
        'solution': solution,
        'optionAnalysis': {
            k.lower(): {'verdict': 'correct' if k == answer else 'incorrect', 'reason': reasons.get(k, '')} for k in keys
        },
        'trap': {'operators': [], 'explanation': ''},
        'notes': {'added': True, 'typeMismatch': False, 'loType': lo_type([options[k] for k in keys])},
    }


def from_bank(code: str, area: str, offset: int, label: str, subject: str, data: dict, lo_index: dict, overrides: dict, report: dict) -> list:
    out = []
    for q in data['questions']:
        key = f'{code}-QB-{q["n"]}'
        ov = overrides.get(key, {})
        q, flags = apply_override(q, ov, key)
        if not q['options'] and not q['answer']:
            report['open-ended'].append(key)
            continue
        blocking = sorted(set(flags) & BLOCKING) + [f for f in flags if f.startswith('options-')]
        if blocking:
            report['blocked'].append((key, blocking))
            continue
        number = q['lo']['reading'] - offset
        lo = lo_index.get(f"{area}-{number} {q['lo']['letter']}")
        if lo is None:
            report['blocked'].append((key, [f"no official LO {area}-{number} {q['lo']['letter']}"]))
            continue
        # The bank prints each LO with Schweser's wording: a low match with the official wording means a misaligned LO.
        sim = difflib.SequenceMatcher(None, norm(q['lo']['text']), norm(lo['text'])).ratio()
        if sim < 0.55:
            report['lo-wording'].append((key, lo['id'], round(sim, 2), q['lo']['text'][:70], lo['text'][:70]))
        title = difflib.SequenceMatcher(None, norm(q['reading']['title'])[:40], norm(lo['readingTitle'])[:40]).ratio()
        if title < 0.6:
            report['reading-title'].add((code, q['reading']['number'], q['reading']['title'], lo['reading']))
        parts = []
        if q['key']:
            parts.append('**Key correction:** ' + q['key'])
        if q['steps']:
            parts.append('**Step by step**\n\n' + q['steps'])
        if q['note']:
            parts.append(q['note'])
        parts.append(bank_source(q['source'], label, q['n']))
        reasons = dict(q['others'])
        # Where the bank gives a note on the right option too ("this is the false statement"), it follows the reason.
        reasons[q['answer']] = ' '.join(x for x in (q['why'], q['others'].get(q['answer'], '')) if x)
        out.append(question(f'{code}-QB-{q["n"]:04d}', subject, BANK_TIER, lo, q['stem'], q['options'], q['answer'], '\n\n'.join(parts), reasons, q['source']))
    return out


def from_workbook(code: str, area: str, name: str, sections: dict, subject: str, data: dict, lo_index: dict, overrides: dict, report: dict) -> list:
    out = []
    for q in data['questions']:
        if q['source'].startswith('Bank'):
            report['bank-repeat'] += 1
            continue
        key = f"{code}-WB-{q['reading']}{q['letter']}-{q['k']}"
        ov = overrides.get(key, {})
        q, flags = apply_override(q, ov, key)
        blocking = sorted(set(flags) & BLOCKING) + [f for f in flags if f.startswith('options-')]
        if blocking:
            report['blocked'].append((key, blocking))
            continue
        lo = lo_index.get(f"{q['area']}-{q['reading']} {q['letter']}")
        if lo is None or q['area'] != area:
            report['blocked'].append((key, [f"no official LO {q['area']}-{q['reading']} {q['letter']}"]))
            continue
        parts = [q['solution']]
        if q['reference']:
            parts.append(q['reference'])
        parts.append(workbook_source(q['source'], name, q['id'], sections))
        item = question(key, subject, WORKBOOK_TIER, lo, q['stem'], q['options'], q['answer'], '\n\n'.join(p for p in parts if p), dict(q['others']), q['source'])
        # A question the workbook took from the Recall + Priority Map volumes keeps its number there ("A13.2").
        recall = RECALL_SOURCE.match(q['source'])
        if recall:
            item['recall'] = recall.group(1)
            report['recall'].add(recall.group(1))
        out.append(item)
    return out


_SCRIPT_BASE = re.compile(r'(?<![\w$\\}.,/()∆−-])([A-Za-z0-9.,/()∆−-]+)$')


def _attach_scripts(text: str) -> str:
    """Moves a base set in the text font into the formula that holds its script: "K$_{p}$" and "bp$^{2}$" become
    "$\\text{K}_{p}$" and "$\\text{bp}^{2}$", so a phone cannot break the line between the two."""
    parts = re.split(r'(?<!\\)\$', text)
    if len(parts) % 2 == 0:
        return text
    for i in range(1, len(parts), 2):
        if not parts[i].startswith(('_{', '^{')) or '\n' in parts[i - 1][-1:]:
            continue
        m = _SCRIPT_BASE.search(parts[i - 1])
        if not m or (i >= 2 and m.start() == 0):
            continue
        base = m.group(1)
        parts[i - 1] = parts[i - 1][:m.start()]
        parts[i] = (r'\Delta ' if base == '∆' else r'\text{' + base.replace('∆', r'}\Delta \text{') + '}') + parts[i]
    return '$'.join(parts)


_ACCENT = {'ˆ': 'hat', '¯': 'bar', '˜': 'tilde'}
_ACCENT_BASE = re.compile(r'(\\[A-Za-z]+|\\text\{[A-Za-z]\}|[A-Za-z])$')


def _accents(text: str) -> str:
    """A symbol under a hat, bar or tilde is read as the symbol's formula and then the accent, "$\\beta$ˆ": put the
    accent on the symbol, and join a subscript that follows ("$\\epsilon$ˆ$_{t}$")."""
    if not any(a in text for a in _ACCENT):
        return text
    parts = re.split(r'(?<!\\)\$', text)
    if len(parts) % 2 == 0:
        return text
    i = 1
    while i < len(parts):
        nxt = parts[i + 1] if i + 1 < len(parts) else ''
        m = _ACCENT_BASE.search(parts[i])
        if nxt[:1] in _ACCENT and m:
            parts[i] = parts[i][:m.start()] + '\\' + _ACCENT[nxt[0]] + '{' + m.group(1) + '}'
            parts[i + 1] = nxt[1:]
            if parts[i + 1] == '' and i + 2 < len(parts):
                parts[i:i + 3] = [parts[i] + parts[i + 2]]
                continue
        i += 2
    return '$'.join(parts)


def _bars(text: str) -> str:
    """A letter under a bar is read as the letter and a macron, "s¯": set it as a formula so the bar sits on top."""
    if '¯' not in text:
        return text
    parts = re.split(r'(?<!\\)\$', text)
    if len(parts) % 2 == 0:
        return text
    bar = re.compile(r'([A-Za-z])¯')
    for i in range(0, len(parts), 2):
        # Next to a formula the letter joins it (two formulas side by side would read as "$$").
        m = bar.match(parts[i])
        if m and i > 0:
            parts[i - 1] += r'\bar{\text{' + m.group(1) + '}}'
            parts[i] = parts[i][m.end():]
        m = re.search(r'([A-Za-z])¯$', parts[i])
        if m and i + 1 < len(parts) and not re.search(r'[A-Za-z]$', parts[i][:m.start()]):
            parts[i + 1] = r'\bar{\text{' + m.group(1) + '}}' + parts[i + 1]
            parts[i] = parts[i][:m.start()]
        parts[i] = bar.sub(lambda m: r'$\bar{\text{' + m.group(1) + '}}$', parts[i])
    for i in range(1, len(parts), 2):
        parts[i] = bar.sub(lambda m: r'\bar{\text{' + m.group(1) + '}}', parts[i])
    return '$'.join(parts)


_TEXT_GROUP = re.compile(r'\\text\{([^{}]*)\}')


def _math_glyphs(text: str) -> str:
    """A capital delta or sigma inside a formula is read as a text glyph; KaTeX has them only as math symbols."""
    if '∆' not in text and 'Σ' not in text:
        return text
    parts = re.split(r'(?<!\\)\$', text)
    if len(parts) % 2 == 0:
        return text

    def group(m):
        pieces = re.split('([∆Σ])', m.group(1))
        return ''.join(('\\Delta ' if x == '∆' else '\\Sigma ' if x == 'Σ' else '\\text{' + x + '}') for x in pieces if x)

    for i in range(1, len(parts), 2):
        parts[i] = _TEXT_GROUP.sub(group, parts[i]).replace('∆', '\\Delta ').replace('Σ', '\\Sigma ')
    return '$'.join(parts)


def _delta(value):
    if isinstance(value, str):
        # A delta inside a formula is read as a text glyph; KaTeX has it only as a math symbol.
        # (A long implication arrow is drawn as "=" and "⇒" side by side: one arrow is meant.)
        return _attach_scripts(_math_glyphs(_bars(_accents(value))).replace(r'\text{∆}', r'\Delta ').replace(r'=$\Rightarrow', r'$\Rightarrow'))
    if isinstance(value, dict):
        return {k: _delta(v) for k, v in value.items()}
    return value


def _option_label(reason: str) -> str:
    """A wrong option's note opens by repeating its value in bold, "A (+22.08 bp; 1.6708%). Error type: ...". The
    figures are set in the math font, so the bold run arrives in pieces and without its bracket: put it back."""
    m = re.match(r'^(.{1,90}?)\)\.\*\*\s+(?=Error type)', reason)
    if not m:
        return reason
    label = m.group(1).replace('**', '').strip()
    # Only the tail of a label that ended in a formula: nothing worth repeating.
    head = '' if re.match(r'^\$[\^_]\{[^$]*\$$', label) else f'**({label}).** '
    return head + reason[m.end():]


def from_papers(code: str, area: str, offset: int, label: str, subject: str, data: dict, lo_index: dict, overrides: dict, report: dict) -> list:
    out = []
    for q in data['questions']:
        number = q['reading'] - offset
        key = f"{code}-HQ-{number}{q['letter']}-{q['n']:02d}"
        q, flags = apply_override(q, overrides.get(key, {}), key)
        q = {k: _delta(v) for k, v in q.items()}
        blocking = sorted(set(flags) & BLOCKING) + [f for f in flags if f.startswith(('options-', 'others-'))]
        if blocking:
            report['blocked'].append((key, blocking))
            continue
        lo = lo_index.get(f"{area}-{number} {q['letter']}")
        if lo is None:
            report['blocked'].append((key, [f"no official LO {area}-{number} {q['letter']}"]))
            continue
        # Each paper prints its LO: a low match with the official wording means the reading numbers are misaligned.
        sim = difflib.SequenceMatcher(None, norm(q['wording']), norm(lo['text'])).ratio()
        if sim < 0.55 and q['n'] == 1:
            report['lo-wording'].append((key, lo['id'], round(sim, 2), q['wording'][:70], lo['text'][:70]))
        # The notation a paper sets out once, above its first question, travels with each of its questions.
        conventions = PAPER_BOILERPLATE.sub('', q.get('instructions') or '').strip()
        text = q['stem'] + (f'\n\n*Conventions for this paper:* {conventions}' if conventions else '')
        parts = []
        if q['title']:
            parts.append(f"**{q['title']}**")
        if q['summary']:
            parts.append(q['summary'])
        for heading, body in (('Concept and theory', q['concept']), ('Applying it to this question', q['applying'])):
            if body:
                parts.append(f'**{heading}**\n\n{body}')
        if q['others_intro']:
            parts.append(q['others_intro'])
        if q['fragile']:
            parts.append('**Fragile fact.** ' + re.sub(r'^\*\*Fragile fact\.\*\*\s*', '', q['fragile']))
        if q['reference']:
            parts.append('**Reference**\n\n' + q['reference'])
        parts.append(f"**Source:** High quality question set, {label}: the paper for {lo['id']}, where it is Q{q['n']} of {q['of']}.")
        reasons = {k: _option_label(v) for k, v in q['others'].items()}
        reasons[q['answer']] = re.sub(r'^\*\*Option [A-E] is correct\.\*\*\s*', '', q['why'])
        item = question(key, subject, HQ_TIER, lo, text, q['options'], q['answer'], '\n\n'.join(parts), reasons, f"High quality paper {lo['id']} Q{q['n']}")
        item['highQuality'] = True
        out.append(item)
    return out


def from_pastyear(code: str, area: str, subject: str, data: dict, lo_index: dict, overrides: dict, report: dict) -> list:
    """The past-paper questions of one subject. A question that tests several LOs is filed under the first."""
    out = []
    for q in data['questions']:
        m = re.match(r'^([A-Z]+)-(\d+)([a-z])$', q['lo'])
        if not m or m.group(1) != area:
            continue
        key = f"{code}-PY-{q['n']:03d}"
        q, flags = apply_override(q, overrides.get(key, {}), key)
        q = {k: _delta(v) for k, v in q.items()}
        blocking = sorted(set(flags) & BLOCKING) + [f for f in flags if f.startswith(('options-', 'others-', 'no-'))]
        if blocking:
            report['blocked'].append((key, blocking))
            continue
        lo = lo_index.get(f'{area}-{m.group(2)} {m.group(3)}')
        if lo is None:
            report['blocked'].append((key, [f"no official LO {q['lo']}"]))
            continue
        parts = [f"**Concept**\n\n{q['concept']}"]
        if q['working']:
            parts.append(f"**Working**\n\n{q['working']}")
        if q['trap']:
            parts.append('**Exam trap.** ' + q['trap'])
        if q['keynote']:
            parts.append('**Answer-key note.** ' + q['keynote'])
        if q['note']:
            parts.append('**Note.** ' + q['note'])
        if len(q['los']) > 1:
            parts.append('**Learning objectives tested:** ' + ', '.join(q['los']) + '.')
        parts.append(f"**Source:** {q['source']} (All past year questions, Question {q['n']}).")
        item = question(key, subject, PAST_TIER, lo, q['stem'], q['options'], q['answer'], '\n\n'.join(parts), dict(q['others']), q['source'])
        item['pastYear'] = True
        out.append(item)
    return out


def tag_tier(q: dict, lo_tiers: dict):
    """Sets the question's recall tier (A-D) and the workbook sections that cover its LO; clears them if none do."""
    hit = lo_tiers.get(q['lo'])
    for k in ('recallTier', 'sections'):
        q.pop(k, None)
    if hit:
        q['recallTier'] = hit['tier']
        q['sections'] = hit['sections']


def tag_kinds(questions: list, lo_index: dict, kinds: dict, numerical: Counter):
    """Sets each question's loKind: the type of its LO (Numerical, Conceptual or Both).

    The LO's wording decides (build_lo_map.py), with one correction from the bank itself: an LO worded as conceptual
    ("Describe CDS spreads and explain how they can be used to estimate hazard rates") whose questions are often
    calculations is examined both ways, so it counts as Both.
    """
    # The high-quality papers are left out of the count: a set written to cover an LO evenly says nothing about how
    # often the LO is examined as a calculation, and adding one must not change the type of an LO.
    counted = [q for q in questions if '-HQ-' not in q['id'] and '-PY-' not in q['id']]
    total = Counter(q['lo'] for q in counted)
    for q in counted:
        if q['notes']['loType'] == 'Numerical':
            numerical[q['lo']] += 1
    for q in questions:
        q.pop('loKind', None)
        lo = lo_index.get(q['lo'])
        if lo is None:
            continue
        kind = lo['kind']
        if kind == 'Conceptual' and numerical[q['lo']] >= KIND_MIN_NUMERICAL and numerical[q['lo']] >= KIND_MIN_SHARE * total[q['lo']]:
            kind = 'Both'
        kinds[q['lo']] = q['loKind'] = kind


def write_tiers_module(tiers: dict):
    """web/src/lib/recallTiers.ts: tier and section names for the portal (generated; do not edit by hand)."""
    lines = [
        '// Generated by tools/content/build_question_bank.py from data/build-inputs/lo-map/tiers.json. Do not edit.',
        "import type { RecallTier } from '../types';",
        '',
        'export interface RecallTierInfo {',
        '  id: RecallTier;',
        '  name: string;',
        '  description: string;',
        '}',
        '',
        'export interface RecallSection {',
        '  /** "A13" */',
        '  id: string;',
        '  tier: RecallTier;',
        '  title: string;',
        '}',
        '',
        'export const RECALL_TIERS: RecallTierInfo[] = [',
    ]
    for t in tiers['tiers']:
        lines.append(f"  {{ id: {json.dumps(t['id'])}, name: {json.dumps(t['name'])}, description: {json.dumps(t['description'], ensure_ascii=False)} }},")
    lines += ['];', '', '/** Workbook sections that cover at least one official LO, in workbook order. */', 'export const RECALL_SECTIONS: RecallSection[] = [']
    for sec in tiers['sections']:
        if sec['los']:
            lines.append(f"  {{ id: {json.dumps(sec['id'])}, tier: {json.dumps(sec['tier'])}, title: {json.dumps(sec['title'], ensure_ascii=False)} }},")
    lines += ['];', '']
    with open(os.path.join(ROOT, 'web', 'src', 'lib', 'recallTiers.ts'), 'w', encoding='utf8') as f:
        f.write('\n'.join(lines))


def check(q: dict) -> list:
    out = []
    keys = [o['key'] for o in q['options']]
    if keys not in (list('abcd'), list('abcde')):
        out.append('option keys')
    if q['answer'] not in keys:
        out.append('answer')
    texts = [q['question'], q['solution']] + [o['text'] for o in q['options']] + [v['reason'] for v in q['optionAnalysis'].values()]
    if any(len(re.findall(r'(?<!\\)\$', t)) % 2 for t in texts):
        out.append('unbalanced $')
    if any(not o['text'].strip() for o in q['options']) or not q['question'].strip():
        out.append('empty text')
    if any(v['verdict'] == 'incorrect' and not v['reason'] for v in q['optionAnalysis'].values()):
        out.append('wrong option without a reason')
    if any('�' in t or re.search('[-]', t) for t in texts):
        out.append('unknown glyph')
    return out


def main():
    if '--extract' in sys.argv:
        run_extraction()
    lo_map = load(os.path.join(INPUTS, 'lo-map', 'lo-map.json'))
    lo_index = official_index(lo_map)
    existing_lo = load(os.path.join(INPUTS, 'lo-map', 'existing-lo-map.json'))['questions']
    overrides = load(os.path.join(QB, 'overrides.json'))
    tiers = load(os.path.join(INPUTS, 'lo-map', 'tiers.json'))
    write_tiers_module(tiers)
    section_titles = {sec['id']: sec['title'] for sec in tiers['sections']}
    report = {'open-ended': [], 'blocked': [], 'lo-wording': [], 'reading-title': set(), 'bank-repeat': 0, 'duplicates': [], 'hq-repeats': [], 'py-repeats': [], 'invalid': [], 'unmapped-existing': [], 'recall': set()}
    coverage = Counter()
    kinds, numerical = {}, Counter()
    totals, hq = OrderedDict(), {}
    seen_text = {}
    past_data = load(os.path.join(EXTRACTED, PAST_PAPERS[:-4] + '.json'))
    py = {}
    for code, (area, bank, offset, workbook, label) in SUBJECTS.items():
        path = os.path.join(CONTENT, f'{code}.json')
        content = load(path)
        subject = content['name']
        kept = []
        for q in content['questions']:
            if any(tag in q['id'] for tag in IMPORTED):
                continue
            q.pop('highQuality', None)
            q.pop('pastYear', None)
            new_lo = lo_index.get(existing_lo.get(q['id'], {}).get('lo'))
            if new_lo is None or new_lo['area'] != area:
                report['unmapped-existing'].append(q['id'])
            else:
                q['lo'], q['loText'], q['reading'], q['band'] = new_lo['id'], new_lo['text'], new_lo['reading'], new_lo['band']
            # Every solution closes with where the question is from; re-running replaces the line rather than adding one.
            q['solution'] = SOURCE_LINE.sub('', q['solution']) + '\n\n' + earlier_source(q, code)
            kept.append(q)
        added = []
        if bank:
            added += from_bank(code, area, offset, label, subject, load(os.path.join(EXTRACTED, f'{code}-bank.json')), lo_index, overrides, report)
        added += from_workbook(code, area, workbook_name(label, workbook), section_titles, subject, load(os.path.join(EXTRACTED, f'{code}-workbook.json')), lo_index, overrides, report)
        final = []
        for q in added:
            bad = check(q)
            if bad:
                report['invalid'].append((q['id'], bad))
                continue
            # The same question printed twice (a bank lists a few under two source tags): keep the first.
            sig = norm(q['question'] + ' ' + ' '.join(sorted(o['text'] for o in q['options'])))
            if sig in seen_text:
                report['duplicates'].append((q['id'], seen_text[sig]))
                continue
            seen_text[sig] = q['id']
            final.append(q)
        # High-quality papers: a question the bank already holds is tagged where it is, the rest are added.
        own = {norm(q['question'] + ' ' + ' '.join(sorted(o['text'] for o in q['options']))): q for q in kept + final}
        papers = []
        for pdf in PAPERS.get(code, []):
            for q in from_papers(code, area, offset, label, subject, load(os.path.join(EXTRACTED, pdf[:-4] + '.json')), lo_index, overrides, report):
                bad = check(q)
                if bad:
                    report['invalid'].append((q['id'], bad))
                    continue
                sig = norm(q['question'] + ' ' + ' '.join(sorted(o['text'] for o in q['options'])))
                if sig in own:
                    own[sig]['highQuality'] = True
                    report['hq-repeats'].append((q['id'], own[sig]['id']))
                    continue
                own[sig] = q
                papers.append(q)
        final += papers
        # Past papers: the same rule. A paper question already in the bank is tagged where it is.
        past = []
        for q in from_pastyear(code, area, subject, past_data, lo_index, overrides, report):
            bad = check(q)
            if bad:
                report['invalid'].append((q['id'], bad))
                continue
            sig = norm(q['question'] + ' ' + ' '.join(sorted(o['text'] for o in q['options'])))
            if sig in own:
                own[sig]['pastYear'] = True
                report['py-repeats'].append((q['id'], own[sig]['id']))
                continue
            own[sig] = q
            past.append(q)
        final += past
        content['questions'] = kept + final
        for q in content['questions']:
            tag_tier(q, tiers['los'])
        tag_kinds(content['questions'], lo_index, kinds, numerical)
        content['tiers'] = [t for t in content.get('tiers', []) if t not in (BANK_TIER, WORKBOOK_TIER, HQ_TIER, PAST_TIER)] + sorted({q['tier'] for q in final})
        with open(path, 'w', encoding='utf8') as f:
            json.dump(content, f, ensure_ascii=False, indent=1)
            f.write('\n')
        for q in content['questions']:
            coverage[q['lo']] += 1
        totals[code] = (len(kept), sum(1 for q in final if q['tier'] == BANK_TIER), sum(1 for q in final if q['tier'] == WORKBOOK_TIER), len(papers) + len(past))
        hq[code] = sum(1 for q in content['questions'] if q.get('highQuality'))
        py[code] = (len(past), sum(1 for q in content['questions'] if q.get('pastYear')))

    with open(os.path.join(QB, 'lo-coverage.csv'), 'w', newline='', encoding='utf8') as f:
        w = csv.writer(f)
        w.writerow(['lo', 'band', 'type', 'type by wording', 'reading', 'learning objective', 'questions', 'numerical questions'])
        for lo in lo_index.values():
            w.writerow([lo['id'], lo['band'], kinds.get(lo['id'], lo['kind']), lo['kind'], lo['reading'], lo['text'], coverage.get(lo['id'], 0), numerical.get(lo['id'], 0)])

    print('file   already-there  bank  workbook  papers  total  high-quality')
    for code, (a, b, c, d) in totals.items():
        print(f'{code:5s} {a:13d} {b:5d} {c:9d} {d:7d} {a + b + c + d:6d} {hq[code]:13d}')
    print('all  ', *(sum(t[i] for t in totals.values()) for i in range(4)), sum(sum(t) for t in totals.values()), sum(hq.values()))
    print('past papers (added, tagged in all):', py, sum(v[1] for v in py.values()))
    bands = Counter()
    for lo_id, n in coverage.items():
        if lo_id in lo_index:
            bands[lo_index[lo_id]['band']] += n
    print('questions by band:', dict(sorted(bands.items())))
    by_kind, lo_kinds = Counter(), Counter(kinds.get(lo['id'], lo['kind']) for lo in lo_index.values())
    for lo_id, n in coverage.items():
        if lo_id in kinds:
            by_kind[kinds[lo_id]] += n
    print('LOs by type:', dict(sorted(lo_kinds.items())), '| questions by LO type:', dict(sorted(by_kind.items())))
    print('official LOs with no question:', sum(1 for lo in lo_index if not coverage.get(lo)), 'of', len(lo_index))
    print(f"open-ended bank questions left out: {len(report['open-ended'])}; workbook repeats of bank questions skipped: {report['bank-repeat']}")
    # Every question of the two recall volumes reaches the bank through the subject workbooks; say so if one does not.
    recall_ids = set()
    for volume in (1, 2):
        path = os.path.join(EXTRACTED, f'recall-{volume}.json')
        if os.path.exists(path):
            recall_ids |= {q['id'] for q in load(path)['questions']}
    in_bank = {q.get('recall') for code in SUBJECTS for q in load(os.path.join(CONTENT, f'{code}.json'))['questions']} - {None}
    report['recall-missing'] = sorted(recall_ids - in_bank)
    print(f"recall-volume questions: {len(recall_ids)} in the two volumes, {len(recall_ids & in_bank)} of them in the bank")
    for name in ('blocked', 'invalid', 'duplicates', 'hq-repeats', 'py-repeats', 'lo-wording', 'unmapped-existing', 'recall-missing'):
        print(f'{name}: {len(report[name])}')
        for item in report[name][:12]:
            print('   ', item)
    for item in sorted(report['reading-title']):
        print('reading title differs:', item)
    with open(os.path.join(QB, 'import-report.json'), 'w', encoding='utf8') as f:
        json.dump({k: (sorted(v) if isinstance(v, set) else v) for k, v in report.items()}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    if report['invalid'] or report['unmapped-existing']:
        sys.exit(1)


if __name__ == '__main__':
    main()
