#!/usr/bin/env python3
"""Merge the per-slice formula cards and twin pairs into content/games/formulas.json.

Usage: build_formulas.py <slice-dir> <twins.json>

Cards that fail a hard check are dropped and reported; the build fails if more than 5% drop.
Hard checks: required fields, unique ids, skeleton + slots rebuilds latex, no decoy equals a slot,
at least one corruption differs from latex, calc.expr uses only whitelisted tokens and evaluates
finitely over its input ranges, and a calc example (when present) reproduces within 0.5%.
"""
import glob
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'content', 'games', 'formulas.json')

TOKEN = re.compile(r'\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|(Math\.(?:sqrt|log|exp|abs|max|min|pow))|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/(),]))')
MATH = {'Math.sqrt': math.sqrt, 'Math.log': math.log, 'Math.exp': math.exp, 'Math.abs': abs,
        'Math.max': max, 'Math.min': min, 'Math.pow': math.pow}


def norm(s):
    return re.sub(r'\s+', '', s or '')


def to_python(expr, names):
    """Same whitelist as the app's evaluator: numbers, input names, Math.*, operators, parentheses."""
    out, pos = [], 0
    while pos < len(expr):
        if expr[pos:].strip() == '':
            break
        m = TOKEN.match(expr, pos)
        if not m or m.end() == pos:
            raise ValueError(f'bad token at {pos}: {expr[pos:pos + 12]!r}')
        num, fn, name, op = m.groups()
        if name is not None and name not in names:
            raise ValueError(f'unknown name {name!r}')
        out.append(num or (f'MATH[{fn!r}]' if fn else None) or name or op)
        pos = m.end()
    return ' '.join(out)


def evaluate(expr, values):
    code = to_python(expr, set(values))
    return eval(code, {'__builtins__': {}, 'MATH': MATH}, dict(values))  # noqa: S307 — whitelisted above


def check_card(c):
    for k in ('id', 'reading_id', 'name', 'prompt', 'latex', 'variables'):
        if not c.get(k):
            return f'missing {k}'
    sk, slots = c.get('skeleton'), c.get('slots') or []
    if sk:
        rebuilt = sk
        for i, s in enumerate(slots, 1):
            rebuilt = rebuilt.replace('{{%d}}' % i, s)
        if '{{' in rebuilt or norm(rebuilt) != norm(c['latex']):
            return 'skeleton+slots does not rebuild latex'
        if any(norm(d) in {norm(s) for s in slots} for d in c.get('decoys') or []):
            return 'a decoy equals a slot'
    cors = c.get('corruptions') or []
    if cors and all(norm(x.get('latex')) == norm(c['latex']) for x in cors):
        return 'corruptions identical to latex'
    calc = c.get('calc')
    if calc:
        inputs = calc.get('inputs') or []
        names = [i['name'] for i in inputs]
        try:
            to_python(calc['expr'], set(names))
            for pick in ('min', 'max'):
                v = evaluate(calc['expr'], {i['name']: i[pick] for i in inputs})
                if not (isinstance(v, (int, float)) and math.isfinite(v)):
                    return f'calc not finite at {pick}'
        except (ValueError, ZeroDivisionError, OverflowError, KeyError, TypeError, SyntaxError) as e:
            return f'calc: {e}'
        ex = calc.get('example')
        if ex:
            try:
                got = evaluate(calc['expr'], ex['inputs'])
            except Exception as e:  # noqa: BLE001 — any failure drops the example, reported below
                return f'example does not evaluate: {e}'
            want = ex['output']
            if abs(got - want) > max(0.005 * abs(want), 0.51 * 10 ** -(calc.get('output', {}).get('decimals', 2))):
                return f'example {got:.6g} != {want}'
    return None


def main():
    slice_dir, twins_path = sys.argv[1], sys.argv[2]
    cards, dropped, seen = [], [], set()
    for f in sorted(glob.glob(os.path.join(slice_dir, 's[0-9][0-9].json'))):
        for c in json.load(open(f)):
            problem = 'duplicate id' if c.get('id') in seen else check_card(c)
            if problem:
                dropped.append((c.get('id'), problem))
                continue
            seen.add(c['id'])
            cards.append(c)
    twins = []
    for t in json.load(open(twins_path)):
        if t['a'] in seen and t['b'] in seen and t['a'] != t['b']:
            key = tuple(sorted((t['a'], t['b'])))
            if key not in {tuple(sorted((x['a'], x['b']))) for x in twins}:
                twins.append({'a': t['a'], 'b': t['b'], 'why': t['why']})
    area_order = {'MR': 0, 'CR': 1, 'ORR': 2, 'LTR': 3, 'IM': 4, 'CI': 5}

    def sort_key(c):
        area, num = c['reading_id'].rsplit('-', 1)
        return (area_order.get(area, 9), int(num) if num.isdigit() else 0, c['id'])

    cards.sort(key=sort_key)
    json.dump({'version': 1, 'formulas': cards, 'twins': twins}, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print(f'{len(cards)} formulas, {len(twins)} twin pairs -> {OUT}')
    for d in dropped:
        print('dropped', *d)
    if len(dropped) > 0.05 * (len(cards) + len(dropped)):
        sys.exit('too many cards dropped')


if __name__ == '__main__':
    main()
