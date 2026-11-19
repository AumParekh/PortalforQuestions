#!/usr/bin/env python3
"""Builds content/shapes/shapes.json: for each tier topic, the questions that practise each reported shape.

    build_shapes.py

Inputs (data/build-inputs/shapes/): topics/<ID>.json (the selectors, AUTHOR.md), results/<slice>.<judge>.json (two
independent judgements of every candidate, a third where those two split: BRIEF.md), results/decisions.json
(rulings made by hand), recall-shapes.json (the shapes each recall-workbook question drills, as the workbook prints
them). A question sits under a selector when at least two judges put it there, or a ruling does. A topic with no
judgements yet is left out, so the file can be built while the run is still going.
"""
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INPUTS = os.path.join(ROOT, 'data', 'build-inputs')
SHAPES = os.path.join(INPUTS, 'shapes')
RESULTS = os.path.join(SHAPES, 'results')
CONTENT = os.path.join(ROOT, 'content')
FILES = ('IR', 'MR', 'CR', 'LR', 'OR', 'CI')
FORM = {'calculation': 'c', 'concept': 't', 'trap': 'x'}
KIND = {'S': 'shape', 'M': 'map', 'V': 'vardeez'}


def load(path):
    with open(path, encoding='utf8') as f:
        return json.load(f)


def judgements(topic_id: str) -> dict:
    """Question id -> the list of judgements (each a list of {selector, form}), in slice order."""
    out = {}
    for name in sorted(os.listdir(RESULTS)):
        m = re.fullmatch(rf'{topic_id}-(\d+|tb\d+)\.([a-c])\.json', name)
        if not m:
            continue
        for row in load(os.path.join(RESULTS, name)):
            out.setdefault(row['id'], []).append(row['matches'])
    return out


def main():
    tiers = load(os.path.join(INPUTS, 'lo-map', 'tiers.json'))
    library = {q['id']: q for code in FILES for q in load(os.path.join(CONTENT, f'{code}.json'))['questions']}
    recall = load(os.path.join(SHAPES, 'recall-shapes.json'))
    rulings = load(os.path.join(RESULTS, 'decisions.json'))
    order = {q: n for n, q in enumerate(library)}
    topics, problems, tally, waiting = [], [], Counter(), []
    for sec in tiers['sections']:
        tid = sec['id']
        path = os.path.join(SHAPES, 'topics', f'{tid}.json')
        votes = judgements(tid) if os.path.exists(path) else {}
        if not votes:
            continue
        # A topic goes in only once every one of its slices has been judged twice.
        slices = [f[:-5] for f in os.listdir(os.path.join(SHAPES, 'slices')) if re.fullmatch(rf'{tid}-\d+\.json', f)]
        if not all(os.path.exists(os.path.join(RESULTS, f'{n}.{j}.json')) for n in slices for j in 'ab'):
            waiting.append(tid)
            continue
        t = load(path)
        ids = [s['id'] for s in t['selectors']]
        placed = {s: {} for s in ids}
        for qid, rounds in votes.items():
            if qid not in library:
                problems.append(f'{tid}: {qid} is not in the bank')
                continue
            ruled = rulings.get(tid, {}).get(qid)
            if ruled is not None:
                chosen = {s: FORM.get(ruled.get('form', 'concept'), 't') for s in ruled['selectors']}
            else:
                count = Counter(m['selector'] for r in rounds for m in {m['selector']: m for m in r}.values())
                forms = {m['selector']: FORM[m['form']] for r in reversed(rounds) for m in r}
                chosen = {s: forms[s] for s, n in count.items() if n >= 2}
            for s, form in chosen.items():
                if s not in placed:
                    problems.append(f'{tid}: {qid} placed under unknown selector {s}')
                    continue
                placed[s][qid] = form
        for q in library.values():
            number = q.get('recall')
            if number and number.split('.')[0] == tid:
                for s in recall.get(number, {}).get('shapes', []):
                    if s in placed:
                        placed[s][q['id']] = 'r'
                    else:
                        problems.append(f'{tid}: recall question {number} cites {s}, which the topic does not have')
        selectors = []
        for s in sorted(t['selectors'], key=lambda s: ('SMV'.index(s['id'][0]), not s.get('seenInAugust'), int(s['id'][1:]))):
            rows = sorted(placed[s['id']].items(), key=lambda kv: (kv[1] != 'r', order[kv[0]]))
            item = {'id': s['id'], 'kind': KIND[s['id'][0]], 'name': s['name'], 'what': s['what'], 'questions': [[q, f] for q, f in rows]}
            if s.get('seenInAugust'):
                item['august'] = True
            if s['id'][0] != 'S':
                item['source'] = s['source']
            selectors.append(item)
        topic = {'id': tid, 'tier': sec['tier'], 'title': t['title'], 'readings': [r['reading'] for r in sec['readings']], 'selectors': selectors}
        if t.get('returnOnLO'):
            topic['rank'], topic['action'] = t['returnOnLO']['rank'], t['returnOnLO']['action']
        if t.get('august'):
            topic['august'] = t['august']
        topic['maps'] = [{k: m[k] for k in ('number', 'sources', 'rating', 'tested', 'specifics') if m.get(k)} for m in t.get('maps', [])]
        if t.get('vardeezReading'):
            topic['vardeez'] = t['vardeezReading']
        topics.append(topic)
        kept = {q for s in selectors for q, _ in s['questions']}
        tally[sec['tier']] += len(kept)
        print(f"{tid:4s} {len(votes):4d} judged  {len(kept):4d} kept  " + ' '.join(f"{s['id']}:{len(s['questions'])}" for s in selectors))
    os.makedirs(os.path.join(CONTENT, 'shapes'), exist_ok=True)
    with open(os.path.join(CONTENT, 'shapes', 'shapes.json'), 'w', encoding='utf8') as f:
        json.dump({'topics': topics}, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'{len(topics)} topics; questions kept by tier (a question can sit in several topics): {dict(tally)}')
    if waiting:
        print('not yet fully judged, left out:', ' '.join(waiting))
    for p in problems:
        print('PROBLEM', p)
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
