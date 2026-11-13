#!/usr/bin/env python3
"""Builds data/build-inputs/lo-map/lo-map.json from the Master LO Map PDF (data/build-inputs/lo-map/).

The map is the reference for chapter (reading) names, learning-objective wording and the P1-P4 priority band of
every LO: 107 readings and 591 LOs in syllabus order, wording verbatim from the GARP 2026 learning objectives.

Each LO also gets a `kind` read off that wording (the map prints no such label): Numerical when it only asks for a
calculation ("Calculate", "Estimate", "Construct", "Apply"), Conceptual when it only asks to describe or explain, Both
when it asks for the two ("Define and calculate"). build_question_bank.py later moves a Conceptual LO to Both when the
bank's own questions on it are often calculations.

Usage: build_lo_map.py            (needs pdftotext from poppler)
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PDF = os.path.join(ROOT, 'data', 'build-inputs', 'lo-map', 'FRM_P2_Master_LO_Map_v3.pdf')
OUT = os.path.join(ROOT, 'data', 'build-inputs', 'lo-map', 'lo-map.json')

AREAS = [
    ('MR', 'Market Risk Measurement and Management'),
    ('CR', 'Credit Risk Measurement and Management'),
    ('ORR', 'Operational Risk and Resilience'),
    ('LTR', 'Liquidity and Treasury Risk Measurement and Management'),
    ('IM', 'Risk Management and Investment Management'),
    ('CI', 'Current Issues in Financial Markets'),
]
EXPECTED = {'readings': 107, 'los': 591, 'P1': 143, 'P2': 112, 'P3': 130, 'P4': 206}

# LOs the map's index lists but its LO-by-LO pages leave out (CR-9 n falls off the end of a page there). Band from
# the index; wording from the GARP 2026 learning objectives as printed in the CR question bank and workbook.
SUPPLEMENT = {
    'CR-9': [
        {
            'letter': 'n',
            'band': 'P2',
            'text': 'Assess the quality of the default probabilities produced by the Merton model, the Moody’s KMV model, and the Kamakura model.',
        }
    ],
}

# Command verbs of the GARP wording. "Determine" and "evaluate" ask for a judgement far more often than a number.
NUMERICAL_VERBS = {'calculate', 'compute', 'estimate', 'construct', 'apply'}
CONCEPTUAL_VERBS = {
    'describe', 'explain', 'identify', 'compare', 'contrast', 'define', 'discuss', 'evaluate', 'assess', 'differentiate',
    'summarize', 'provide', 'analyze', 'interpret', 'distinguish', 'examine', 'classify', 'determine', 'give',
}
# A command verb opens the LO or follows a comma, a dash or "and"; "used to calculate" and "how to estimate" are not commands.
COMMAND = re.compile(r'(?:^|[,;:] (?:and )?| and |- )([A-Za-z]+)\b')
# Where the verb alone misleads: "apply" a taxonomy or a strategy is not a calculation; a t-statistic is.
KIND_OVERRIDES = {
    'ORR-3 c': 'Conceptual',
    'ORR-3 d': 'Conceptual',
    'LTR-4 c': 'Both',
    'IM-5 c': 'Both',
    'IM-7 d': 'Numerical',
}
KINDS = ('Numerical', 'Conceptual', 'Both')


def wording_kind(lo_id, text):
    if lo_id in KIND_OVERRIDES:
        return KIND_OVERRIDES[lo_id]
    verbs = [m.group(1).lower() for m in COMMAND.finditer(text)]
    numerical = any(v in NUMERICAL_VERBS for v in verbs)
    conceptual = any(v in CONCEPTUAL_VERBS for v in verbs)
    return 'Both' if numerical and conceptual else 'Numerical' if numerical else 'Conceptual'


READING = re.compile(r'^ {1,6}((?:MR|CR|ORR|LTR|IM|CI)-\d+) +([A-Z“"(\d].*?)\s*$')
LO = re.compile(r'^ {1,6}P([1-4]) +([a-z]) +(\S.*?)\s*$')
SUMMARY = re.compile(r'^ {1,6}P[1-4] ×\d')
# Lines under an LO that are notes about it, not its wording.
NOTE = re.compile(r'^(WORKBOOK\b|VARDEEZ\b|▶|×|[A-D]\d+·S\d+|[A-D]\d+ )')
PAGE_FURNITURE = re.compile(r'^(FRM PART II • NOV 2026|\s*\d+\s*$)')
LIGATURES = {'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl'}


def clean(text):
    for k, v in LIGATURES.items():
        text = text.replace(k, v)
    # Words hyphenated at a line end by the typesetter: "fil-" + "tered".
    text = re.sub(r'(\w)- (?=[a-z])', lambda m: m.group(1) if m.group(1).islower() else m.group(0), text)
    return re.sub(r'\s+', ' ', text).strip()


def parse(lines):
    readings = []
    reading = lo = None
    title_open = False
    started = False
    for raw in lines:
        line = raw.rstrip('\n').replace('\f', '')
        # The LO-by-LO section follows the index tables; it opens with the first area heading in title case.
        if not started:
            started = bool(re.match(r'^Market Risk Measurement and Management\s', line))
            continue
        if PAGE_FURNITURE.match(line.strip()) and (line.startswith('FRM PART II') or line.strip().isdigit()):
            continue
        m = READING.match(line)
        if m:
            reading = {'id': m.group(1), 'title': m.group(2), 'los': []}
            readings.append(reading)
            lo, title_open = None, True
            continue
        if reading is None:
            continue
        if SUMMARY.match(line):
            title_open = False
            lo = None
            continue
        m = LO.match(line)
        if m:
            lo = {'letter': m.group(2), 'band': 'P' + m.group(1), 'text': m.group(3), 'open': True}
            reading['los'].append(lo)
            title_open = False
            continue
        body = line.strip()
        if title_open and body:
            reading['title'] += ' ' + body
            continue
        if lo is not None and lo['open']:
            if not body or NOTE.match(body) or len(line) - len(line.lstrip()) < 10:
                lo['open'] = False
            else:
                lo['text'] += ' ' + body
    return readings


def main():
    text = subprocess.run(['pdftotext', '-layout', PDF, '-'], capture_output=True, text=True, check=True).stdout
    readings = parse(text.split('\n'))
    for r in readings:
        have = {lo['letter'] for lo in r['los']}
        r['los'] += [lo for lo in SUPPLEMENT.get(r['id'], []) if lo['letter'] not in have]
    areas, n_los, bands, kinds = [], 0, {}, {}
    for code, name in AREAS:
        rs = []
        for r in readings:
            if r['id'].split('-')[0] != code:
                continue
            los = []
            for lo in r['los']:
                lo_id, text = f"{r['id']} {lo['letter']}", clean(lo['text'])
                los.append({'id': lo_id, 'letter': lo['letter'], 'band': lo['band'], 'kind': wording_kind(lo_id, text), 'text': text})
                bands[lo['band']] = bands.get(lo['band'], 0) + 1
                kinds[los[-1]['kind']] = kinds.get(los[-1]['kind'], 0) + 1
            n_los += len(los)
            rs.append({'id': r['id'], 'number': int(r['id'].split('-')[1]), 'title': clean(r['title']), 'los': los})
        areas.append({'code': code, 'name': name, 'readings': rs})
    got = {'readings': sum(len(a['readings']) for a in areas), 'los': n_los, **bands}
    problems = [f'{k}: expected {v}, got {got.get(k, 0)}' for k, v in EXPECTED.items() if got.get(k, 0) != v]
    ids = {f"{r['id']} {lo['letter']}" for r in readings for lo in r['los']}
    problems += [f'kind override for an unknown LO: {k}' for k in KIND_OVERRIDES if k not in ids]
    for a in areas:
        for r in a['readings']:
            letters = [lo['letter'] for lo in r['los']]
            want = [chr(ord('a') + i) for i in range(len(letters))]
            if letters != want:
                problems.append(f"{r['id']}: LO letters {''.join(letters)} are not a..{want[-1] if want else '?'}")
            for lo in r['los']:
                if not re.search(r'[.)\w]$', lo['text']) or len(lo['text']) < 15:
                    problems.append(f"{lo['id']}: suspicious wording {lo['text']!r}")
        nums = [r['number'] for r in a['readings']]
        if nums != list(range(1, len(nums) + 1)):
            problems.append(f"{a['code']}: reading numbers {nums}")
    out = {
        'source': 'FRM Part II Master LO Map v3 (chapter names and LO wording verbatim from the GARP 2026 learning objectives)',
        'bands': {
            'P1': 'Most important',
            'P2': 'Important',
            'P3': 'Worth covering',
            'P4': 'Not flagged; still examinable',
        },
        'kinds': 'By the wording of the LO: Numerical (calculate), Conceptual (describe, explain) or Both.',
        'areas': areas,
    }
    with open(OUT, 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(got)
    print('by wording:', {k: kinds.get(k, 0) for k in KINDS})
    for p in problems:
        print('PROBLEM', p)
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
