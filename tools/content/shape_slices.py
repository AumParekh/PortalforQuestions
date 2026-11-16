#!/usr/bin/env python3
"""Candidate questions for a tier topic, in slices for the shape judges, and the checks on what the judges return.

    shape_slices.py slice <TOPIC>              writes data/build-inputs/shapes/slices/<TOPIC>-<nn>.json
    shape_slices.py check <result.json>        validates a judge's file against its slice
    shape_slices.py reconcile <TOPIC>          joins the two independent judgements of each slice

A topic's candidates are the questions of its learning objectives plus, from the rest of the library, those its
`widerSearch` finds (marked `outside`). The recall workbook's own questions for the topic are not judged: the
workbook prints the shapes each one drills. See data/build-inputs/shapes/BRIEF.md for the rule the judges apply.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHAPES = os.path.join(ROOT, 'data', 'build-inputs', 'shapes')
CONTENT = os.path.join(ROOT, 'content')
FILES = ('IR', 'MR', 'CR', 'LR', 'OR', 'CI')
SIZE = 30
SOLUTION_CHARS = 1800
FORMS = {'calculation', 'concept', 'trap'}


def load(path):
    with open(path, encoding='utf8') as f:
        return json.load(f)


def library():
    return [q for code in FILES for q in load(os.path.join(CONTENT, f'{code}.json'))['questions']]


def candidates(topic: dict) -> list:
    own = {lo['id'] for lo in topic['los']}
    wider = re.compile(topic['widerSearch'], re.I) if topic.get('widerSearch') else None
    out = []
    for q in library():
        if (q.get('recall') or '').split('.')[0] == topic['id']:
            continue
        text = ' '.join([q['question'], q['solution']] + [o['text'] for o in q['options']])
        inside = q['lo'] in own
        if not inside and not (wider and wider.search(text)):
            continue
        solution = re.sub(r'\n*\*\*Source:\*\* [^\n]*\s*$', '', q['solution'])
        out.append({
            'id': q['id'], 'lo': q['lo'], 'loText': q['loText'], 'outside': not inside,
            'question': q['question'], 'options': {o['key'].upper(): o['text'] for o in q['options']},
            'answer': q['answer'].upper(),
            'solution': solution if len(solution) <= SOLUTION_CHARS else solution[:SOLUTION_CHARS] + ' […]',
        })
    return out


def slice_topic(topic_id: str):
    topic = load(os.path.join(SHAPES, 'topics', f'{topic_id}.json'))
    rows = candidates(topic)
    for old in os.listdir(os.path.join(SHAPES, 'slices')):
        if old.startswith(topic_id + '-'):
            os.remove(os.path.join(SHAPES, 'slices', old))
    n = max(1, -(-len(rows) // SIZE))
    per = -(-len(rows) // n)
    for k in range(n):
        with open(os.path.join(SHAPES, 'slices', f'{topic_id}-{k + 1:02d}.json'), 'w', encoding='utf8') as f:
            json.dump(rows[k * per:(k + 1) * per], f, ensure_ascii=False, indent=1)
    print(f'{topic_id}: {len(rows)} candidates ({sum(r["outside"] for r in rows)} from outside its LOs) in {n} slices')


def problems(result_path: str) -> list:
    name = os.path.basename(result_path).split('.')[0]
    topic = load(os.path.join(SHAPES, 'topics', f'{name.split("-")[0]}.json'))
    ids = [q['id'] for q in load(os.path.join(SHAPES, 'slices', f'{name}.json'))]
    selectors = {s['id'] for s in topic['selectors']}
    try:
        rows = load(result_path)
    except (OSError, ValueError) as e:
        return [f'unreadable: {e}']
    out = []
    if [r.get('id') for r in rows] != ids:
        out.append('ids do not match the slice, in order')
    for r in rows:
        if not isinstance(r.get('matches'), list) or not str(r.get('reason', '')).strip():
            out.append(f"{r.get('id')}: needs matches (a list) and a reason")
            continue
        for m in r['matches']:
            if m.get('selector') not in selectors or m.get('form') not in FORMS:
                out.append(f"{r.get('id')}: unknown selector or form {m}")
    return out


def reconcile(topic_id: str):
    """Agreement of the two judges, per question: both keep (selectors in common), both drop, or split."""
    res = os.path.join(SHAPES, 'results')
    out = []
    for name in sorted(f[:-5] for f in os.listdir(os.path.join(SHAPES, 'slices')) if f.startswith(topic_id + '-')):
        a, b = (load(os.path.join(res, f'{name}.{who}.json')) for who in ('a', 'b'))
        for q, x, y in zip(load(os.path.join(SHAPES, 'slices', f'{name}.json')), a, b):
            sx, sy = ({m['selector'] for m in r['matches']} for r in (x, y))
            state = 'drop' if not sx and not sy else 'keep' if sx & sy else 'split'
            forms = {m['selector']: m['form'] for r in (y, x) for m in r['matches']}
            out.append({
                'id': q['id'], 'lo': q['lo'], 'outside': q['outside'], 'state': state,
                'selectors': sorted(sx & sy) if state == 'keep' else sorted(sx | sy),
                'forms': forms, 'a': {'selectors': sorted(sx), 'reason': x['reason']}, 'b': {'selectors': sorted(sy), 'reason': y['reason']},
            })
    with open(os.path.join(res, f'{topic_id}.reconciled.json'), 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    tally = {s: sum(1 for r in out if r['state'] == s) for s in ('keep', 'drop', 'split')}
    print(f'{topic_id}: {len(out)} judged twice: {tally}')


def main():
    cmd, arg = sys.argv[1], sys.argv[2]
    if cmd == 'slice':
        slice_topic(arg)
    elif cmd == 'check':
        bad = problems(arg)
        print('\n'.join(bad) if bad else 'ok')
        sys.exit(1 if bad else 0)
    elif cmd == 'reconcile':
        reconcile(arg)


if __name__ == '__main__':
    main()
