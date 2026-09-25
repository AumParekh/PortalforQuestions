#!/usr/bin/env python3
"""Structural checks on the question bank (content/{IR,MR,CR,LR,OR,CI}.json).

Usage: validate_bank.py [--diff <git-ref>]

Fails (exit 1) on: missing/empty fields, duplicate ids, answer not among the option keys,
optionAnalysis keys not matching the options, optionAnalysis marking anything but the answer
as correct, or unbalanced $ math delimiters. With --diff, also lists every question whose
answer key, options, question or solution differ from <git-ref> (the audit's change report).
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SUBJECTS = ['IR', 'MR', 'CR', 'LR', 'OR', 'CI']
REQUIRED = ['id', 'subject', 'tier', 'reading', 'question', 'options', 'answer', 'solution', 'optionAnalysis']


def math_balanced(text):
    """Unescaped $ count must be even ($$ counts as two)."""
    return len(re.findall(r'(?<!\\)\$', text)) % 2 == 0


def problems(q):
    out = []
    for k in REQUIRED:
        if not q.get(k):
            out.append(f'missing {k}')
    if out:
        return out
    keys = [o.get('key') for o in q['options']]
    if len(set(keys)) != len(keys) or any(not o.get('text') for o in q['options']):
        out.append('options: duplicate keys or empty text')
    if q['answer'] not in keys:
        out.append(f'answer {q["answer"]!r} not in options {keys}')
    oa = q['optionAnalysis']
    if not isinstance(oa, dict) or sorted(oa) != sorted(keys):
        out.append('optionAnalysis keys do not match options')
    else:
        correct = [k for k, v in oa.items() if isinstance(v, dict) and v.get('verdict') == 'correct']
        if correct != [q['answer']]:
            out.append(f'optionAnalysis marks {correct} correct, answer is {q["answer"]}')
        # The correct option may leave its reason empty (the solution explains it); wrong ones may not.
        if any(not isinstance(v, dict) or (not v.get('reason') and v.get('verdict') != 'correct') for v in oa.values()):
            out.append('optionAnalysis: wrong option without reason')
    texts = [q['question'], q['solution']] + [o['text'] for o in q['options']]
    texts += [v.get('reason', '') for v in oa.values() if isinstance(v, dict)] if isinstance(oa, dict) else []
    if any(not math_balanced(t) for t in texts if isinstance(t, str)):
        out.append('unbalanced $ math delimiters')
    return out


def load(subject, ref=None):
    path = f'content/{subject}.json'
    if ref:
        raw = subprocess.run(['git', 'show', f'{ref}:{path}'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        return json.loads(raw)['questions']
    return json.load(open(os.path.join(ROOT, path)))['questions']


def main():
    ref = sys.argv[sys.argv.index('--diff') + 1] if '--diff' in sys.argv else None
    bad, seen, total = [], set(), 0
    for s in SUBJECTS:
        for q in load(s):
            total += 1
            p = problems(q)
            if q.get('id') in seen:
                p.append('duplicate id')
            seen.add(q.get('id'))
            bad += [(q.get('id'), x) for x in p]
    print(f'{total} questions checked, {len(bad)} problems')
    for b in bad:
        print('PROBLEM', *b)
    if ref:
        for s in SUBJECTS:
            old = {q['id']: q for q in load(s, ref)}
            for q in load(s):
                o = old.get(q['id'])
                if o is None:
                    print('ADDED', q['id'])
                    continue
                if o['answer'] != q['answer']:
                    print(f'KEY {q["id"]}: {o["answer"]} -> {q["answer"]}')
                changed = [k for k in ('question', 'options', 'solution', 'optionAnalysis', 'trap', 'reading', 'topic') if o.get(k) != q.get(k)]
                if changed:
                    print(f'EDIT {q["id"]}: {", ".join(changed)}')
            for i in set(old) - {q['id'] for q in load(s)}:
                print('REMOVED', i)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
