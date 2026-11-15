#!/usr/bin/env python3
"""Sense Check scenarios from the imported calculation questions.

    sense_slices.py slice <dir>         input slices (the imported numerical questions, most important LOs first)
    sense_slices.py check <in> <out>    validate one slice of scenarios written from an input slice
    sense_slices.py vcheck <out> <verify>   validate a verifier's report on a slice

Scenarios are written to data/build-inputs/sense/bank-<CODE>q<nn>.json following data/build-inputs/sense/BRIEF.md and
merged by build_sensecheck.py, which applies the same hard checks (and recomputes every check chain).
"""
import copy
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_sensecheck as B  # noqa: E402

ROOT = B.ROOT
CODES = ['MR', 'CR', 'OR', 'LR', 'IR']
AREA = {'MR': 'MR', 'CR': 'CR', 'OR': 'ORR', 'LR': 'LTR', 'IR': 'IM', 'CI': 'CI'}
SLICE = 30
BANDS = {'P1': 0, 'P2': 1, 'P3': 2, 'P4': 3}
TRAPS = {'Polarity', 'Sibling', 'Role', 'Sign', 'Scope', 'Definition', 'Formula', 'Intermediate result', 'Sequence'}
SOLUTION_CHARS = 3500


def load(path):
    with open(path, encoding='utf8') as f:
        return json.load(f)


def slices():
    out = []
    for code in CODES:
        qs = [q for q in load(os.path.join(ROOT, 'content', f'{code}.json'))['questions'] if ('-QB-' in q['id'] or '-WB-' in q['id']) and q['notes']['loType'] == 'Numerical']
        qs.sort(key=lambda q: BANDS.get(q.get('band'), 9))  # stable: bank order within a band
        for i in range(0, len(qs), SLICE):
            out.append((f'bank-{code}q{i // SLICE + 1:02d}', code, qs[i:i + SLICE]))
    return out


def brief(q, code):
    solution = q['solution']
    return {
        'id': q['id'],
        'area': AREA[code],
        'lo': q['lo'],
        'loText': q['loText'],
        'reading': q['reading'],
        'reading_id': q['reading'].split(':')[0],
        'question': q['question'],
        'options': [{'key': o['key'], 'text': o['text'], 'credited': o['key'] == q['answer']} for o in q['options']],
        'solution': solution if len(solution) <= SOLUTION_CHARS else solution[:SOLUTION_CHARS] + ' …',
    }


def cmd_slice(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    for name, code, qs in slices():
        with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf8') as f:
            json.dump([brief(q, code) for q in qs], f, ensure_ascii=False, indent=1)
        manifest.append({'name': name, 'questions': len(qs)})
    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf8') as f:
        json.dump(manifest, f, indent=1)
    print(len(manifest), 'slices,', sum(m['questions'] for m in manifest), 'questions')


def texts(s):
    yield s.get('setup', '')
    yield s.get('ask', '')
    yield s.get('takeaway', '')
    for o in s.get('options') or []:
        yield str(o.get('label', ''))
        yield str(o.get('why', ''))
    for w in s.get('working') or []:
        yield str(w.get('label', ''))
        yield str(w.get('display', ''))


def problems(scenarios, questions, name):
    errors, seen_q, seen_id = [], set(), set()
    by_id = {q['id']: q for q in questions}
    if not isinstance(scenarios, list):
        return ['the file must hold a JSON array of scenarios']
    for i, s in enumerate(scenarios):
        tag = f"#{i} {s.get('id')}"
        if not re.fullmatch(re.escape(f'SC-{name}-') + r'\d{2}', str(s.get('id'))):
            errors.append(f'{tag}: id must be SC-{name}-NN')
        if s.get('id') in seen_id:
            errors.append(f'{tag}: duplicate id')
        seen_id.add(s.get('id'))
        src = s.get('source') or {}
        q = by_id.get(src.get('questionId'))
        if src.get('kind') != 'bank' or q is None:
            errors.append(f'{tag}: source must be {{"kind": "bank", "questionId": <a question of this slice>}}')
            continue
        if q['id'] in seen_q:
            errors.append(f'{tag}: a second scenario for {q["id"]} (one per question)')
        seen_q.add(q['id'])
        for k in ('area', 'reading', 'reading_id'):
            if s.get(k) != q[k]:
                errors.append(f'{tag}: {k} must be copied from the question ({q[k]!r})')
        if s.get('trap_category') not in TRAPS:
            errors.append(f'{tag}: trap_category must be one of {sorted(TRAPS)}')
        hard = B.check(copy.deepcopy(s))
        if hard:
            errors.append(f'{tag}: {hard}')
            continue
        working = s.get('working')
        if not isinstance(working, list) or not working or any(not w.get('label') or not w.get('display') for w in working):
            errors.append(f'{tag}: working needs at least one step with a label and a display')
        if s['mode'] == 'direction' and not s.get('check') and any(re.search(r'\d', str(w.get('display', ''))) for w in working or []):
            errors.append(f'{tag}: the working shows numbers, so give a check chain that recomputes them')
        for t in texts(s):
            if len(re.findall(r'(?<!\\)\$', t)) % 2:
                errors.append(f'{tag}: unbalanced $ in "{t[:50]}"')
            if '$$' in t or '\n|' in t:
                errors.append(f'{tag}: no display math or tables ("{t[:50]}")')
        if len(s['setup']) > 700:
            errors.append(f'{tag}: setup is over 700 characters; a round is read in seconds')
    return errors


def cmd_check(in_path, out_path):
    name = os.path.basename(out_path)[: -len('.json')]
    try:
        scenarios = load(out_path)
    except (OSError, ValueError) as e:
        sys.exit(f'cannot read {out_path}: {e}')
    questions = load(in_path)
    errors = problems(scenarios, questions, name)
    n = len(scenarios) if isinstance(scenarios, list) else 0
    modes = {}
    for s in scenarios if isinstance(scenarios, list) else []:
        modes[s.get('mode')] = modes.get(s.get('mode'), 0) + 1
    print(f'{n} scenarios from {len(questions)} questions; modes {modes}; {len(errors)} errors')
    for e in errors:
        print('ERROR', e)
    sys.exit(1 if errors else 0)


def cmd_vcheck(out_path, verify_path):
    """A verifier's report must cover the whole slice and name scenarios that exist."""
    scenarios = load(out_path)
    try:
        v = load(verify_path)
    except (OSError, ValueError) as e:
        sys.exit(f'cannot read {verify_path}: {e}')
    if not isinstance(v, dict) or not isinstance(v.get('disputes'), list):
        sys.exit('ERROR the report must be {"checked": N, "disputes": [...]}')
    errors = []
    if v.get('checked') != len(scenarios):
        errors.append(f"checked is {v.get('checked')} but the slice has {len(scenarios)} scenarios: examine every one")
    ids = {s['id'] for s in scenarios}
    for d in v['disputes']:
        if not isinstance(d, dict) or d.get('id') not in ids or not str(d.get('reason', '')).strip():
            errors.append(f'dispute {d!r} must name a scenario id of the slice and give a reason')
    print(f"{len(scenarios)} scenarios, {len(v['disputes'])} disputed, {len(errors)} errors")
    for e in errors:
        print('ERROR', e)
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'slice':
        cmd_slice(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == 'check':
        cmd_check(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'vcheck':
        cmd_vcheck(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
