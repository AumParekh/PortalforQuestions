#!/usr/bin/env python3
"""Builds data/build-inputs/lo-map/tiers.json from the two Recall + Priority Map workbooks.

Volume 1 holds Tier A (sections A1-A32), Volume 2 Tiers B to D. Each volume has a "Syllabus map (2026 LOs)" that
lists, per section, the official readings and LO letters the section covers. From it every official LO gets the
sections that cover it and its tier: the highest tier among them (A before B before C before D). Sections the
volumes mark as outside the 2026 LOs (notes only) are left out, as the Master LO Map does.

Usage: build_tiers.py            (needs pdftotext from poppler)
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PDF_DIR = os.path.join(ROOT, 'data', 'build-inputs', 'question-banks', 'pdf')
VOLUMES = [('FRM_Workbook_Vol1_TierA.pdf', 1), ('FRM_Workbook_Vol2_TiersB-D.pdf', 2)]
LO_MAP = os.path.join(ROOT, 'data', 'build-inputs', 'lo-map', 'lo-map.json')
OUT = os.path.join(ROOT, 'data', 'build-inputs', 'lo-map', 'tiers.json')

LIGATURES = {'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl'}
TIER_HEAD = re.compile(r'^Tier ([A-D]): (.+?)\s{2,}\d+\s*$')
CONTENTS_ROW = re.compile(r'^([A-D]\d+) (.+?)\s{2,}(\d+)\s*$')
PRIORITY_ROW = re.compile(r'^\s+([A-D]\d+)\s{2,}(\S.*?)\s{2,}.*?\s(\d+)\s+(\d+)\s*$')
READING = r'(?:MR|CR|ORR|LTR|IM|CI)-\d+'
LETTERS = r'[a-z](?: to [a-z])?(?:, [a-z](?: to [a-z])?)*'
MAP_ROW = re.compile(rf'^(?:([A-D]\d+)\s)?.*?\b({READING})\s{{2,}}.*?\s{{2,}}({LETTERS}|cross-reference)\s*$')
NOT_IN_LOS = re.compile(r'not in (the )?2026 LOs', re.I)


def text_of(pdf):
    out = subprocess.run(['pdftotext', '-layout', os.path.join(PDF_DIR, pdf), '-'], capture_output=True, text=True, check=True).stdout
    for k, v in LIGATURES.items():
        out = out.replace(k, v)
    return out


def expand(letters: str) -> list:
    out = []
    for part in letters.split(', '):
        if ' to ' in part:
            a, b = part.split(' to ')
            out += [chr(c) for c in range(ord(a), ord(b) + 1)]
        else:
            out.append(part)
    return out


def parse_volume(text: str, volume: int) -> tuple:
    lines = text.split('\n')
    tiers, sections = [], {}
    tier = None
    # Contents: tier headings and the sections under each.
    for line in lines[: next(i for i, l in enumerate(lines) if l.startswith('Priority table') and i > 40) if any(l.startswith('Priority table') for l in lines[41:]) else 400]:
        m = TIER_HEAD.match(line)
        if m:
            tier = m.group(1)
            tiers.append({'id': tier, 'name': f'Tier {tier}', 'description': m.group(2).strip()})
            continue
        m = CONTENTS_ROW.match(line)
        if m and tier and m.group(1)[0] == tier:
            sections[m.group(1)] = {'id': m.group(1), 'tier': tier, 'title': m.group(2).strip(), 'volume': volume, 'page': int(m.group(3)), 'questions': 0, 'readings': []}
    # Priority table: number of questions per section.
    for line in lines:
        m = PRIORITY_ROW.match(line)
        if m and m.group(1) in sections and not sections[m.group(1)]['questions']:
            sections[m.group(1)]['questions'] = int(m.group(3))
    # Syllabus map: the second heading (the first is the contents entry) up to "Chapters by book".
    heads = [i for i, l in enumerate(lines) if l.startswith('Syllabus map (2026 LOs)')]
    ends = [i for i, l in enumerate(lines) if l.startswith('Chapters by book')]
    current = None
    for line in lines[heads[1]: ends[1]]:
        m = MAP_ROW.match(line)
        if not m:
            continue
        if m.group(1):
            current = m.group(1)
        if current is None or current not in sections:
            continue
        letters = [] if m.group(3) == 'cross-reference' else expand(m.group(3))
        sections[current]['readings'].append({'reading': m.group(2), 'letters': letters})
    return tiers, sections


def main():
    lo_map = json.load(open(LO_MAP, encoding='utf8'))
    official = {lo['id'] for a in lo_map['areas'] for r in a['readings'] for lo in r['los']}
    tiers, sections, problems = [], {}, []
    for pdf, volume in VOLUMES:
        t, s = parse_volume(text_of(pdf), volume)
        tiers += t
        sections.update(s)
    los = {}
    for sec in sections.values():
        sec['notesOnly'] = bool(NOT_IN_LOS.search(sec['title']))
        ids = []
        for r in sec['readings']:
            for letter in r['letters']:
                lo = f"{r['reading']} {letter}"
                if lo not in official:
                    problems.append(f"{sec['id']}: {lo} is not an official LO")
                elif lo not in ids:
                    ids.append(lo)
        sec['los'] = [] if sec['notesOnly'] else ids
        if not sec['readings']:
            problems.append(f"{sec['id']}: no syllabus-map row")
        for lo in sec['los']:
            los.setdefault(lo, []).append(sec['id'])
    order = {'A': 0, 'B': 1, 'C': 2, 'D': 3}

    def sort_key(sid):
        return (order[sid[0]], int(sid[1:]))

    lo_out = {lo: {'tier': min((s[0] for s in secs), key=order.get), 'sections': sorted(secs, key=sort_key)} for lo, secs in los.items()}
    out = {
        'source': 'FRM Part II Recall + Priority Map Workbook, Volume 1 (Tier A) and Volume 2 (Tiers B to D): contents and "Syllabus map (2026 LOs)"',
        'tiers': tiers,
        'sections': [sections[k] for k in sorted(sections, key=sort_key)],
        'los': dict(sorted(lo_out.items(), key=lambda kv: (kv[0].split('-')[0], int(re.search(r'-(\d+)', kv[0]).group(1)), kv[0][-1]))),
    }
    with open(OUT, 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    by_tier = {t: sum(1 for v in lo_out.values() if v['tier'] == t) for t in 'ABCD'}
    print(f"{len(sections)} sections; LOs by tier: {by_tier}; in no tier: {len(official) - len(lo_out)} of {len(official)}")
    print('sections per tier:', {t: sum(1 for s in sections.values() if s['tier'] == t) for t in 'ABCD'}, '| questions:', sum(s['questions'] for s in sections.values()))
    print('notes-only sections left out:', [s['id'] for s in sections.values() if s['notesOnly']])
    for p in problems:
        print('PROBLEM', p)
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
