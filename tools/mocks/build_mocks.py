#!/usr/bin/env python3
"""Merge the per-bank mock JSON into one content/mocks/<slug>.json per mock.

Usage: build_mocks.py <bank-dir>

<bank-dir>/<Set>_Solution_Bank_<n>.json are arrays of questions (subject-bank schema plus
`number`). Banks are grouped by their question-id prefix (MOCK1-, PE1-, ...), sorted by number,
and written with the time limit the real exam uses: 4 hours for 80 questions, pro rata for a
partial set. Fails on duplicate ids or a question that breaks the bank rules (see
tools/content/validate_bank.py); missing question numbers are reported.
"""
import glob
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'content'))
from validate_bank import problems  # noqa: E402

OUT = os.path.join(ROOT, 'content', 'mocks')
SETS = {
    'MOCK1': ('mock-1', 'Mock 1'),
    'MOCK2': ('mock-2', 'Mock 2'),
    'MOCK3': ('mock-3', 'Mock 3'),
    'MOCK4': ('mock-4', 'Mock 4'),
    'PE1': ('garp-practice-exam-1', 'GARP Practice Exam 1'),
    'PE2': ('garp-practice-exam-2', 'GARP Practice Exam 2'),
}
FULL_EXAM = 80
MINUTES_PER_QUESTION = 240 / FULL_EXAM


def main():
    bank_dir = sys.argv[1]
    by_set, failed = {}, []
    for f in sorted(glob.glob(os.path.join(bank_dir, '*_Solution_Bank_[0-9].json'))):
        for q in json.load(open(f)):
            prefix = q.get('id', '').split('-')[0]
            if prefix not in SETS:
                failed.append((q.get('id'), f'unknown set in {os.path.basename(f)}'))
                continue
            by_set.setdefault(prefix, []).append(q)
    os.makedirs(OUT, exist_ok=True)
    for prefix, qs in sorted(by_set.items()):
        slug, name = SETS[prefix]
        seen = set()
        for q in qs:
            p = problems(q)
            if q['id'] in seen:
                p.append('duplicate id')
            seen.add(q['id'])
            failed += [(q['id'], x) for x in p]
        qs.sort(key=lambda q: q['number'])
        numbers = [q['number'] for q in qs]
        missing = sorted(set(range(1, max(numbers) + 1)) - set(numbers))
        partial = len(qs) < FULL_EXAM * 0.9
        data = {
            'type': 'mock',
            'name': name + (' (partial)' if partial else ''),
            'timeLimitMinutes': int(math.ceil(len(qs) * MINUTES_PER_QUESTION / 5) * 5),
            'questions': qs,
        }
        json.dump(data, open(os.path.join(OUT, f'{slug}.json'), 'w'), ensure_ascii=False, indent=1)
        areas = {}
        for q in qs:
            areas[q['subject']] = areas.get(q['subject'], 0) + 1
        print(f'{slug}: {len(qs)} questions, {data["timeLimitMinutes"]} min, numbers {numbers[0]}-{numbers[-1]}'
              f'{", missing " + str(missing) if missing else ""}; {areas}')
    for f in failed:
        print('PROBLEM', *f)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
