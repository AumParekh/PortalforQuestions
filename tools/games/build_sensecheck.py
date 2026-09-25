#!/usr/bin/env python3
"""Merge the per-slice Sense Check scenarios into content/games/sensecheck.json.

Usage: build_sensecheck.py <slice-dir>

Hard checks (a failing scenario is dropped and reported): required fields, known mode and area,
2–4 options with unique labels and exactly one correct, every wrong option has a why, and every
check step evaluates (arithmetic whitelist) to its stated value within 0.5%. Magnitude rounds must
also have 4 options whose leading numbers are pairwise at least 2.5x apart.
Magnitude rounds are rebalanced so the correct option's rank among the sorted values is spread
evenly (a fixed rank would give the answer away); the resulting distribution is reported.
"""
import collections
import glob
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'content', 'games', 'sensecheck.json')
MODES = {'direction', 'magnitude', 'intermediate'}
AREAS = {'MR', 'CR', 'IM', 'LTR', 'ORR', 'CI'}
AREA_ALIAS = {'IR': 'IM', 'LR': 'LTR', 'OR': 'ORR'}
FUNCS = {'sqrt': math.sqrt, 'log': math.log, 'ln': math.log, 'exp': math.exp, 'abs': abs, 'min': min, 'max': max}
SAFE = re.compile(r'^[\sA-Za-z0-9_.+\-*/(),]*$')
NUM = re.compile(r'-?\d[\d,]*\.?\d*(?:[eE][-+]?\d+)?')


def evaluate(expr, env):
    expr = expr.replace('^', '**').replace('math.', '')
    if not SAFE.match(expr.replace('**', '')):
        raise ValueError('unsafe characters')
    for name in re.findall(r'[A-Za-z_][A-Za-z0-9_]*', expr):
        if name not in env and name not in FUNCS and not re.fullmatch(r'e\d*', name):
            raise ValueError(f'unknown name {name}')
    return eval(expr, {'__builtins__': {}}, {**FUNCS, **env})  # noqa: S307 — character and name whitelist above


def lead_number(label):
    m = NUM.search(label.replace('−', '-'))
    return abs(float(m.group().replace(',', ''))) if m else None


def check(s):
    for k in ('id', 'mode', 'area', 'setup', 'ask', 'options', 'working', 'takeaway'):
        if not s.get(k):
            return f'missing {k}'
    if s['mode'] not in MODES:
        return f'mode {s["mode"]}'
    s['area'] = AREA_ALIAS.get(s['area'], s['area'])
    if s['area'] not in AREAS:
        return f'area {s["area"]}'
    opts = s['options']
    if not 2 <= len(opts) <= 4 or len({o['label'] for o in opts}) != len(opts):
        return 'options: need 2-4 unique labels'
    if sum(1 for o in opts if o.get('correct')) != 1:
        return 'options: need exactly one correct'
    if any(not o.get('correct') and not o.get('why') for o in opts):
        return 'wrong option without why'
    if s['mode'] == 'magnitude':
        vals = [lead_number(o['label']) for o in opts]
        if len(opts) != 4 or None in vals or 0 in vals:
            return 'magnitude: need 4 numeric options'
        for i in range(4):
            for j in range(i + 1, 4):
                if max(vals[i], vals[j]) / min(vals[i], vals[j]) < 2.45:
                    return f'magnitude options too close: {vals[i]} vs {vals[j]}'
    chk = s.get('check')
    if chk:
        env = dict(chk.get('inputs') or {})
        for step in chk.get('steps') or []:
            try:
                got = evaluate(step['expr'], env)
            except Exception as e:  # noqa: BLE001 — any failure is reported as this scenario's problem
                return f'check step {step.get("name")}: {e}'
            want = step.get('value')
            if want is not None and abs(got - want) > max(0.005 * abs(want), 1e-9):
                return f'check step {step["name"]}: {got:.6g} != {want}'
            env[step['name']] = got
    elif s['mode'] != 'direction':
        return 'numeric round without check'
    return None


def fmt2(x):
    """Two significant figures, with thousands separators, like the rest of the labels."""
    if x == 0:
        return '0'
    digits = max(0, 1 - int(math.floor(math.log10(abs(x)))))
    v = round(x, digits)
    return f'{v:,.{digits}f}' if digits else f'{int(round(v)):,}'


def relabel(correct_label, value):
    """The correct option's label with its leading number replaced, so units and style match."""
    m = NUM.search(correct_label.replace('−', '-'))
    return correct_label[: m.start()] + fmt2(value) + correct_label[m.end():]


def rebalance(s):
    """Moves the correct option to a target rank among the value-sorted options.

    Picked by hashing the id, so it's spread evenly and stable across rebuilds. Distractors on the
    wrong side are replaced by labelled scale slips on the other side, pairwise >= 2.5x apart.
    Returns True if the scenario changed.
    """
    opts = s['options']
    truth_opt = next(o for o in opts if o.get('correct'))
    truth = lead_number(truth_opt['label'])
    target = sum(map(ord, s['id'])) % 4  # 0 = smallest
    below = sorted([o for o in opts if not o.get('correct') and lead_number(o['label']) < truth], key=lambda o: lead_number(o['label']))
    above = sorted([o for o in opts if not o.get('correct') and lead_number(o['label']) > truth], key=lambda o: lead_number(o['label']))
    if len(below) == target:
        return False
    keep_below, keep_above = below, above
    if len(below) > target:
        # Too many below: drop the ones furthest below, add slips above.
        keep_below = below[len(below) - target:] if target else []
        need, side = len(below) - target, 'above'
    else:
        keep_above = above[: len(above) - (target - len(below))]
        need, side = target - len(below), 'below'
    kept_vals = [truth] + [lead_number(o['label']) for o in keep_below + keep_above]
    factors = [3, 10, 30, 100, 300] if side == 'above' else [1 / 3, 1 / 10, 1 / 30, 1 / 100, 1 / 300]
    new = []
    for f in factors:
        if len(new) == need:
            break
        v = truth * f
        shown = lead_number(fmt2(v))
        if shown and all(max(shown, k) / min(shown, k) >= 2.5 for k in kept_vals):
            kept_vals.append(shown)
            times = f'{f:g}×' if f >= 1 else f'1/{1 / f:g}'
            new.append({'label': relabel(truth_opt['label'], v), 'correct': False,
                        'why': f'Scale slip: {times} the right size, the kind of error a unit, percent or decimal-place mix-up produces.'})
    if len(new) < need:
        return False
    s['options'] = sorted(keep_below + [truth_opt] + keep_above + new, key=lambda o: lead_number(o['label']))
    return True


def place_correct(s):
    """Direction/intermediate: move the correct option to a stable, evenly spread slot.

    Authors tend to list the right answer first; the screen shows options in stored order, so
    that would give it away. The other options keep their relative order.
    """
    opts = s['options']
    correct = next(o for o in opts if o.get('correct'))
    rest = [o for o in opts if o is not correct]
    target = sum(map(ord, s['id'] + '#slot')) % len(opts)
    s['options'] = rest[:target] + [correct] + rest[target:]


def main():
    slice_dir = sys.argv[1]
    out, dropped, seen, rebalanced = [], [], set(), []
    for f in sorted(glob.glob(os.path.join(slice_dir, '*.json'))):
        base = os.path.basename(f)
        if not re.fullmatch(r'(bank|notes)-[A-Za-z0-9]+\.json', base):
            continue
        for s in json.load(open(f)):
            problem = 'duplicate id' if s.get('id') in seen else check(s)
            if problem:
                dropped.append((s.get('id'), problem))
                continue
            seen.add(s['id'])
            if s['mode'] == 'magnitude':
                if rebalance(s):
                    problem = check(s)
                    if problem:
                        dropped.append((s['id'], f'after rebalance: {problem}'))
                        continue
                    rebalanced.append(s['id'])
                # Sizing calls read naturally smallest to largest.
                s['options'].sort(key=lambda o: lead_number(o['label']))
            else:
                place_correct(s)
            out.append(s)
    json.dump({'version': 1, 'scenarios': out}, open(OUT, 'w'), ensure_ascii=False, indent=1)
    modes = collections.Counter(s['mode'] for s in out)
    areas = collections.Counter(s['area'] for s in out)
    pos = collections.Counter()
    for s in out:
        if s['mode'] == 'magnitude':
            ranked = sorted(s['options'], key=lambda o: lead_number(o['label']))
            pos[next(i for i, o in enumerate(ranked) if o.get('correct')) + 1] += 1
    print(f'{len(out)} scenarios -> {OUT}')
    print('modes', dict(modes), 'areas', dict(areas))
    print('magnitude: correct option position among sorted values', dict(sorted(pos.items())))
    print(f'rebalanced {len(rebalanced)} magnitude rounds')
    slots = collections.Counter((s['mode'], len(s['options']), next(i for i, o in enumerate(s['options']) if o.get('correct'))) for s in out if s['mode'] != 'magnitude')
    print('direction/intermediate correct slot', dict(sorted(slots.items())))
    for d in dropped:
        print('dropped', *d)
    if len(dropped) > 0.05 * (len(out) + len(dropped)):
        sys.exit('too many scenarios dropped')


if __name__ == '__main__':
    main()
