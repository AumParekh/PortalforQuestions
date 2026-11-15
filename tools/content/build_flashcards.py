#!/usr/bin/env python3
"""True/False deck (content/flashcards/<CODE>.json) from the question bank.

    build_flashcards.py slice <dir>        input slices of the imported conceptual questions, most important LOs first
    build_flashcards.py check <in> <out>   validate one slice of cards written from an input slice
    build_flashcards.py vcheck <out> <verify>   validate a verifier's report on a slice
    build_flashcards.py merge              rebuild the decks: existing cards re-tagged with their question's official
                                           chapter and LO, plus the verified new cards

New cards are written slice by slice to data/build-inputs/flashcards/new/<CODE>-<nn>.json following
data/build-inputs/flashcards/BRIEF.md, and each slice is checked by an independent verifier whose disputes
(<CODE>-<nn>.verify.json) are dropped at merge.
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONTENT = os.path.join(ROOT, 'content')
NEW = os.path.join(ROOT, 'data', 'build-inputs', 'flashcards', 'new')
CODES = ['MR', 'CR', 'OR', 'LR', 'IR', 'CI']
SLICE = 60
BANDS = {'P1': 0, 'P2': 1, 'P3': 2, 'P4': 3}
# A stem that asks for the wrong statement. Only a hint for the checker's CHECK lines: "not" inside a definition is
# not a negative stem, so the lower-case forms are matched as phrases.
NEGATIVE = re.compile(
    r'\b(LEAST|EXCEPT|NOT|FALSE|INCORRECT|INACCURATE)\b'
    r'|\b([Ll]east (likely|accurate|appropriate|correct|consistent)|[Ii]ncorrect|[Ii]naccurate|[Uu]ntrue|[Ee]xcept\b|false statement|'
    r'not (true|correct|accurate|consistent|likely|appropriate|valid|one of|a |an |among))'
)
# A statement must stand on its own: nothing that points back at the question it came from.
BANNED = re.compile(
    r'\b(the question|this question|the scenario|the passage|the vignette|the table|the exhibit|the above|as stated|the following|'
    r'option [A-E]\b|this option|the correct answer|correct answer is|none of the|all of the above|both [A-E] and [A-E])\b',
    re.I,
)
SOLUTION_CHARS = 1400


def load(path):
    with open(path, encoding='utf8') as f:
        return json.load(f)


def imported(q):
    return '-QB-' in q['id'] or '-WB-' in q['id']


def slices():
    """Imported conceptual questions per subject, P1 LOs first, in batches of SLICE."""
    out = []
    for code in CODES:
        qs = [q for q in load(os.path.join(CONTENT, f'{code}.json'))['questions'] if imported(q) and q['notes']['loType'] != 'Numerical']
        qs.sort(key=lambda q: BANDS.get(q.get('band'), 9))  # stable: bank order within a band
        for i in range(0, len(qs), SLICE):
            out.append((f'{code}-{i // SLICE + 1:02d}', qs[i:i + SLICE]))
    return out


def brief(q):
    solution = q['solution']
    return {
        'id': q['id'],
        'lo': q['lo'],
        'loText': q['loText'],
        'chapter': q['reading'],
        'negativeStem': bool(NEGATIVE.search(q['question'])),
        'question': q['question'],
        'options': [
            {'key': o['key'], 'text': o['text'], 'credited': o['key'] == q['answer'], 'reason': q['optionAnalysis'].get(o['key'], {}).get('reason', '')}
            for o in q['options']
        ],
        'solution': solution if len(solution) <= SOLUTION_CHARS else solution[:SOLUTION_CHARS] + ' …',
    }


def cmd_slice(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    for name, qs in slices():
        with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf8') as f:
            json.dump([brief(q) for q in qs], f, ensure_ascii=False, indent=1)
        manifest.append({'name': name, 'questions': len(qs), 'bands': sorted({q.get('band') for q in qs})})
    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf8') as f:
        json.dump(manifest, f, indent=1)
    print(len(manifest), 'slices,', sum(m['questions'] for m in manifest), 'questions')


def problems(cards, questions):
    """(errors, warnings) for a slice of new cards against its input questions."""
    errors, warnings, seen = [], [], set()
    by_id = {q['id']: q for q in questions}
    if not isinstance(cards, list):
        return ['the file must hold a JSON array of cards'], []
    for i, c in enumerate(cards):
        tag = f"#{i} {c.get('sourceId')}/{c.get('optionKey')}"
        q = by_id.get(c.get('sourceId'))
        if q is None:
            errors.append(f'{tag}: sourceId is not a question of this slice')
            continue
        opt = next((o for o in q['options'] if o['key'] == c.get('optionKey')), None)
        if opt is None:
            errors.append(f'{tag}: optionKey is not an option of the question')
            continue
        if (c['sourceId'], c['optionKey']) in seen:
            errors.append(f'{tag}: a second card for the same option')
        seen.add((c['sourceId'], c['optionKey']))
        extra = set(c) - {'sourceId', 'optionKey', 'statement', 'isTrue', 'explanation', 'originalText', 'correction', 'changes'}
        if extra:
            errors.append(f'{tag}: unknown fields {sorted(extra)}')
        st, ex = c.get('statement'), c.get('explanation')
        if not isinstance(c.get('isTrue'), bool):
            errors.append(f'{tag}: isTrue must be true or false')
            continue
        if not isinstance(st, str) or not 30 <= len(st) <= 420:
            errors.append(f'{tag}: statement must be 30 to 420 characters')
            continue
        if not isinstance(ex, str) or not 40 <= len(ex) <= 700:
            errors.append(f'{tag}: explanation must be 40 to 700 characters')
            continue
        if not st[0].isupper() and not st[0].isdigit() and st[0] not in '$"“(':
            errors.append(f'{tag}: statement must start with a capital letter')
        if not st.rstrip().endswith(('.', '."', '.”', ')')):
            errors.append(f'{tag}: statement must end with a full stop')
        for name, text in (('statement', st), ('explanation', ex), ('correction', c.get('correction') or '')):
            if len(re.findall(r'(?<!\\)\$', text)) % 2:
                errors.append(f'{tag}: unbalanced $ in the {name}')
            if '$$' in text or '\n' in text or '|' in text:
                errors.append(f'{tag}: the {name} must be one line with no display math or table')
            hit = BANNED.search(text) if name != 'explanation' else re.search(r'\boption [A-E]\b|\bthe question\b|\bthis question\b', text, re.I)
            if hit:
                errors.append(f'{tag}: the {name} refers to the source question ("{hit.group(0)}")')
        if re.match(r'(It|They|This|These|That|Those|He|She)\b', st):
            errors.append(f'{tag}: statement opens with a pronoun; name the subject')
        original = c.get('originalText')
        if original is not None and original.strip() != opt['text'].strip():
            errors.append(f'{tag}: originalText must be the option exactly as printed, or null when the statement is the option unchanged')
        if original is None and st.strip() != opt['text'].strip():
            errors.append(f'{tag}: the statement differs from the option, so originalText must carry the option as printed')
        corr, changes = c.get('correction'), c.get('changes')
        if c['isTrue'] and (corr or changes):
            errors.append(f'{tag}: only a false card has a correction')
        if corr:
            if corr.strip() == st.strip():
                errors.append(f'{tag}: correction equals the statement')
            if not isinstance(changes, list) or not changes:
                errors.append(f'{tag}: a correction needs its changes')
            else:
                for ch in changes:
                    if not isinstance(ch, dict) or ch.get('from') not in st or ch.get('to') not in corr:
                        errors.append(f'{tag}: each change needs "from" (a phrase of the statement) and "to" (a phrase of the correction)')
                        break
        expected = opt['credited'] != q['negativeStem']
        if c['isTrue'] != expected:
            warnings.append(f"{tag}: marked {c['isTrue']} but the option is {'credited' if opt['credited'] else 'not credited'} on a {'negatively' if q['negativeStem'] else 'normally'} worded question")
    return errors, warnings


def cmd_check(in_path, out_path):
    try:
        cards = load(out_path)
    except (OSError, ValueError) as e:
        sys.exit(f'cannot read {out_path}: {e}')
    questions = load(in_path)
    errors, warnings = problems(cards, questions)
    covered = len({c.get('sourceId') for c in cards if isinstance(c, dict)}) if isinstance(cards, list) else 0
    print(f'{len(cards) if isinstance(cards, list) else 0} cards from {covered} of {len(questions)} questions; {len(errors)} errors, {len(warnings)} truth warnings')
    for e in errors:
        print('ERROR', e)
    for w in warnings:
        print('CHECK', w)
    sys.exit(1 if errors else 0)


def cmd_vcheck(out_path, verify_path):
    """A verifier's report must cover the whole slice and name cards that exist."""
    cards = load(out_path)
    try:
        v = load(verify_path)
    except (OSError, ValueError) as e:
        sys.exit(f'cannot read {verify_path}: {e}')
    errors = []
    if not isinstance(v, dict) or not isinstance(v.get('disputes'), list):
        sys.exit('ERROR the report must be {"checked": N, "disputes": [...]}')
    if v.get('checked') != len(cards):
        errors.append(f"checked is {v.get('checked')} but the slice has {len(cards)} cards: examine every card")
    keys = {(c['sourceId'], c['optionKey']) for c in cards}
    for d in v['disputes']:
        if not isinstance(d, dict) or (d.get('sourceId'), d.get('optionKey')) not in keys or not str(d.get('reason', '')).strip():
            errors.append(f'dispute {d!r} must name a card of the slice (sourceId, optionKey) and give a reason')
    print(f"{len(cards)} cards, {len(v['disputes'])} disputed, {len(errors)} errors")
    for e in errors:
        print('ERROR', e)
    sys.exit(1 if errors else 0)


def norm(text):
    return re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()


def cmd_merge():
    new_slices = {name: qs for name, qs in slices()}
    report = {'retagged': 0, 'orphans': [], 'slices': 0, 'pending': [], 'unverified': [], 'invalid': [], 'disputed': 0, 'duplicates': 0, 'added': 0}
    totals = {}
    for code in sorted(CODES, key=['IR', 'MR', 'CR', 'LR', 'OR', 'CI'].index):
        deck_path = os.path.join(CONTENT, 'flashcards', f'{code}.json')
        deck = load(deck_path)
        by_id = {q['id']: q for q in load(os.path.join(CONTENT, f'{code}.json'))['questions']}
        cards, seen = [], set()
        # Cards made before the import: keep them, named after the official chapter and LO of their question.
        for c in deck['cards']:
            q = by_id.get(c['sourceId'])
            if q is not None and imported(q):
                continue  # rebuilt below from the slices
            if q is None:
                report['orphans'].append(c['id'])
            else:
                c['lo'], c['loText'], c['reading'], c['topic'] = q['lo'], q['loText'], q['reading'], q['reading']
                report['retagged'] += 1
            cards.append(c)
            seen.add(norm(c['statement']))
        kept = len(cards)
        for name in sorted(n for n in new_slices if n.startswith(code + '-')):
            out_path = os.path.join(NEW, f'{name}.json')
            verify_path = os.path.join(NEW, f'{name}.verify.json')
            if not os.path.exists(out_path):
                report['pending'].append(name)
                continue
            new = load(out_path)
            questions = [brief(q) for q in new_slices[name]]
            errors, _ = problems(new, questions)
            if errors:
                report['invalid'].append((name, len(errors), errors[0]))
                continue
            verify = load(verify_path) if os.path.exists(verify_path) else None
            if not isinstance(verify, dict) or verify.get('checked') != len(new) or not isinstance(verify.get('disputes'), list):
                report['unverified'].append(name)
                continue
            disputed = {(d.get('sourceId'), d.get('optionKey')) for d in verify['disputes'] if isinstance(d, dict)}
            report['slices'] += 1
            for c in new:
                if (c['sourceId'], c['optionKey']) in disputed:
                    report['disputed'] += 1
                    continue
                key = norm(c['statement'])
                if key in seen:
                    report['duplicates'] += 1
                    continue
                seen.add(key)
                q = by_id[c['sourceId']]
                card = {
                    'id': f"TF-{c['sourceId']}-{c['optionKey']}",
                    'sourceId': c['sourceId'],
                    'optionKey': c['optionKey'],
                    'subject': q['subject'],
                    'tier': q['tier'],
                    'topic': q['reading'],
                    'lo': q['lo'],
                    'loText': q['loText'],
                    'reading': q['reading'],
                    'statement': c['statement'].strip(),
                    'isTrue': c['isTrue'],
                    'explanation': c['explanation'].strip(),
                    'edited': c.get('originalText') is not None,
                }
                if c.get('originalText') is not None:
                    card['originalText'] = c['originalText']
                if not c['isTrue'] and c.get('correction'):
                    card['correction'] = c['correction'].strip()
                    card['changes'] = c['changes']
                cards.append(card)
                report['added'] += 1
        deck['cards'] = cards
        with open(deck_path, 'w', encoding='utf8') as f:
            json.dump(deck, f, ensure_ascii=False, indent=1)
            f.write('\n')
        totals[code] = (kept, len(cards) - kept)
    print('deck   before-import  new  total')
    for code, (a, b) in totals.items():
        print(f'{code:5s} {a:13d} {b:5d} {a + b:6d}')
    print('all  ', sum(a for a, _ in totals.values()), sum(b for _, b in totals.values()), sum(a + b for a, b in totals.values()))
    print(f"existing cards re-tagged: {report['retagged']}; new slices merged: {report['slices']}; cards added: {report['added']}; "
          f"dropped as disputed: {report['disputed']}; dropped as duplicates: {report['duplicates']}")
    for k in ('orphans', 'pending', 'unverified', 'invalid'):
        if report[k]:
            print(f'{k}: {len(report[k])}', report[k][:12])


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == 'merge':
        cmd_merge()
    elif len(sys.argv) == 3 and sys.argv[1] == 'slice':
        cmd_slice(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == 'check':
        cmd_check(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'vcheck':
        cmd_vcheck(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
