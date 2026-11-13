#!/usr/bin/env python3
"""Adds the question-bank and workbook questions to content/*.json and tags every question with its official
chapter, learning objective and priority band.

    build_question_bank.py [--extract]

Inputs (data/build-inputs/):
  lo-map/lo-map.json                 official readings, LO wording and P1-P4 band (build_lo_map.py)
  lo-map/existing-lo-map.json        official LO of each question that was in the portal before this import
  lo-map/tiers.json                  recall-workbook sections and the tier (A-D) of each LO (build_tiers.py)
  question-banks/pdf/*.pdf           the source PDFs
  question-banks/extracted/*.json    extract_bank.py / extract_workbook.py output (rebuilt with --extract)
  question-banks/overrides.json      hand transcriptions for layouts the extractor cannot express

What goes in: every multiple-choice question of the five question banks, and every workbook question that is not
marked as a repeat of a bank question ("Bank Q..."). Wording is kept as printed. Open-ended bank questions (no
options) cannot be multiple choice and are left out; so is anything still carrying a blocking flag.

Re-running is safe: imported questions (ids with -QB- or -WB-) are replaced, the others only re-tagged.
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
RECALL_SOURCE = re.compile(r'^Workbook ([A-D]\d+\.\d+)\b')
BANK_TIER = 'Question Bank'
WORKBOOK_TIER = 'Workbook'
#: Flags that mean the text may be wrong; a question keeps them only until an override clears them.
BLOCKING = {
    'no-stem', 'no-answer', 'unknown-glyph', 'bare-radical', 'matrix', 'brace', 'unused-rule', 'text-outside-frame',
    'question-frame-after-answer', 'answer-frame-before-answer', 'text-after-answer-line', 'empty-table',
    'text-before-first-wrong-option', 'no-solution', 'why-letter-differs', 'answer-extra',
}


def load(path):
    with open(path, encoding='utf8') as f:
        return json.load(f)


def norm(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()


# ---------------------------------------------------------------------------------------------------------------


def official_index(lo_map: dict) -> dict:
    """LO id -> {id, text, band, reading (label), readingTitle, area}."""
    out = {}
    for area in lo_map['areas']:
        for r in area['readings']:
            for lo in r['los']:
                out[lo['id']] = {
                    'id': lo['id'], 'text': lo['text'], 'band': lo['band'], 'reading': f"{r['id']}: {r['title']}",
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
        parts.append(f"**Source:** {q['source']} ({label} Question Bank, Q{q['n']})")
        if q['note']:
            parts.append(q['note'])
        reasons = dict(q['others'])
        # Where the bank gives a note on the right option too ("this is the false statement"), it follows the reason.
        reasons[q['answer']] = ' '.join(x for x in (q['why'], q['others'].get(q['answer'], '')) if x)
        out.append(question(f'{code}-QB-{q["n"]:04d}', subject, BANK_TIER, lo, q['stem'], q['options'], q['answer'], '\n\n'.join(parts), reasons, q['source']))
    return out


def from_workbook(code: str, area: str, label: str, subject: str, data: dict, lo_index: dict, overrides: dict, report: dict) -> list:
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
        parts.append(f"**Source:** {q['source']} ({label} Workbook, Question {q['id']})")
        item = question(key, subject, WORKBOOK_TIER, lo, q['stem'], q['options'], q['answer'], '\n\n'.join(p for p in parts if p), dict(q['others']), q['source'])
        # A question the workbook took from the Recall + Priority Map volumes keeps its number there ("A13.2").
        recall = RECALL_SOURCE.match(q['source'])
        if recall:
            item['recall'] = recall.group(1)
            report['recall'].add(recall.group(1))
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
    report = {'open-ended': [], 'blocked': [], 'lo-wording': [], 'reading-title': set(), 'bank-repeat': 0, 'duplicates': [], 'invalid': [], 'unmapped-existing': [], 'recall': set()}
    coverage = Counter()
    totals = OrderedDict()
    seen_text = {}
    for code, (area, bank, offset, workbook, label) in SUBJECTS.items():
        path = os.path.join(CONTENT, f'{code}.json')
        content = load(path)
        subject = content['name']
        kept = []
        for q in content['questions']:
            if '-QB-' in q['id'] or '-WB-' in q['id']:
                continue
            new_lo = lo_index.get(existing_lo.get(q['id'], {}).get('lo'))
            if new_lo is None or new_lo['area'] != area:
                report['unmapped-existing'].append(q['id'])
            else:
                q['lo'], q['loText'], q['reading'], q['band'] = new_lo['id'], new_lo['text'], new_lo['reading'], new_lo['band']
            kept.append(q)
        added = []
        if bank:
            added += from_bank(code, area, offset, label, subject, load(os.path.join(EXTRACTED, f'{code}-bank.json')), lo_index, overrides, report)
        added += from_workbook(code, area, label, subject, load(os.path.join(EXTRACTED, f'{code}-workbook.json')), lo_index, overrides, report)
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
        content['questions'] = kept + final
        for q in content['questions']:
            tag_tier(q, tiers['los'])
        content['tiers'] = [t for t in content.get('tiers', []) if t not in (BANK_TIER, WORKBOOK_TIER)] + sorted({q['tier'] for q in final})
        with open(path, 'w', encoding='utf8') as f:
            json.dump(content, f, ensure_ascii=False, indent=1)
            f.write('\n')
        for q in content['questions']:
            coverage[q['lo']] += 1
        totals[code] = (len(kept), sum(1 for q in final if q['tier'] == BANK_TIER), sum(1 for q in final if q['tier'] == WORKBOOK_TIER))

    with open(os.path.join(QB, 'lo-coverage.csv'), 'w', newline='', encoding='utf8') as f:
        w = csv.writer(f)
        w.writerow(['lo', 'band', 'reading', 'learning objective', 'questions'])
        for lo in lo_index.values():
            w.writerow([lo['id'], lo['band'], lo['reading'], lo['text'], coverage.get(lo['id'], 0)])

    print('file   already-there  bank  workbook  total')
    for code, (a, b, c) in totals.items():
        print(f'{code:5s} {a:13d} {b:5d} {c:9d} {a + b + c:6d}')
    print('all  ', sum(a for a, _, _ in totals.values()), sum(b for _, b, _ in totals.values()), sum(c for _, _, c in totals.values()), sum(sum(t) for t in totals.values()))
    bands = Counter()
    for lo_id, n in coverage.items():
        if lo_id in lo_index:
            bands[lo_index[lo_id]['band']] += n
    print('questions by band:', dict(sorted(bands.items())))
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
    for name in ('blocked', 'invalid', 'duplicates', 'lo-wording', 'unmapped-existing', 'recall-missing'):
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
