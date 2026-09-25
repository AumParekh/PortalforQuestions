#!/usr/bin/env python3
"""Merge verified trap-mining output into content/games/game-blocks.json.

Usage: merge_traps.py <traps-dir>

<traps-dir>/tNN.json files map reading_id -> [trap], each trap with id, category, correct_text,
corrupted_text (may be null), changes [{from, to}], source_block, source_line, objective, origin,
raw_category. Existing traps (same id) are updated in place; mined traps are appended. A trap is
rejected (and reported) if its category is unknown or, when it has a corrupted version, applying
all `changes` simultaneously to correct_text doesn't give corrupted_text. trap_index is rebuilt.
Run after tools/notes/extract.py so re-extraction never loses the verified traps.
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLOCKS = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')
CATEGORIES = ['Polarity', 'Sibling', 'Role', 'Sign', 'Scope', 'Definition', 'Formula', 'Intermediate result', 'Sequence']


def apply_changes(text, changes):
    """All changes at once, each at its first non-overlapping occurrence (swaps must not undo each other)."""
    spans = []
    for ch in changes:
        start = 0
        while True:
            i = text.find(ch['from'], start)
            if i < 0:
                return None
            j = i + len(ch['from'])
            if all(j <= a or i >= b for a, b, _ in spans):
                break
            start = i + 1
        spans.append((i, j, ch['to']))
    out, pos = [], 0
    for i, j, to in sorted(spans):
        out += [text[pos:i], to]
        pos = j
    return ''.join(out + [text[pos:]])


def problem(t):
    if not t.get('id') or not t.get('correct_text'):
        return 'missing id or correct_text'
    if t.get('category') not in CATEGORIES:
        return f'category {t.get("category")!r}'
    if t.get('corrupted_text'):
        changes = t.get('changes') or []
        if not changes or apply_changes(t['correct_text'], changes) != t['corrupted_text']:
            return 'changes do not turn correct_text into corrupted_text'
    return None


def main():
    traps_dir = sys.argv[1]
    data = json.load(open(BLOCKS))
    readings = data['readings']
    incoming = {}
    for f in sorted(glob.glob(os.path.join(traps_dir, 't[0-9][0-9].json'))):
        for rid, traps in json.load(open(f)).items():
            incoming.setdefault(rid, []).extend(traps)
    rejected, updated, added, seen = [], 0, 0, set()
    for rid, traps in incoming.items():
        r = readings.get(rid)
        if r is None:
            rejected += [(t.get('id'), f'unknown reading {rid}') for t in traps]
            continue
        by_id = {t['id']: t for t in r.get('traps') or []}
        for t in traps:
            why = 'duplicate id' if t.get('id') in seen else problem(t)
            if why:
                rejected.append((t.get('id'), why))
                continue
            seen.add(t['id'])
            fields = {k: t.get(k) for k in ('category', 'correct_text', 'corrupted_text', 'changes', 'source_block', 'source_line', 'objective', 'origin', 'raw_category')}
            if t['id'] in by_id:
                by_id[t['id']].update({k: v for k, v in fields.items() if v is not None or k == 'corrupted_text'})
                by_id[t['id']]['category_inferred'] = False
                updated += 1
            else:
                new = {'id': t['id'], 'text': t['correct_text'], 'plain_text': t['correct_text'], 'category_inferred': False, **fields}
                r.setdefault('traps', []).append(new)
                by_id[t['id']] = new
                added += 1
    index = {c: [] for c in CATEGORIES}
    for r in readings.values():
        for t in r.get('traps') or []:
            if t.get('category') in index:
                index[t['category']].append(t['id'])
    data['trap_index'] = index
    json.dump(data, open(BLOCKS, 'w'), ensure_ascii=False, separators=(',', ':'))
    total = sum(len(r.get('traps') or []) for r in readings.values())
    uncategorised = sum(1 for r in readings.values() for t in r.get('traps') or [] if t.get('category') not in CATEGORIES)
    with_corrupt = sum(1 for r in readings.values() for t in r.get('traps') or [] if t.get('corrupted_text'))
    print(f'updated {updated}, added {added}, rejected {len(rejected)}; traps now {total} '
          f'({with_corrupt} with a corrupted version, {uncategorised} uncategorised)')
    print('by category', {c: len(v) for c, v in index.items()})
    for r in rejected[:30]:
        print('rejected', *r)


if __name__ == '__main__':
    main()
