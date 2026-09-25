#!/usr/bin/env python3
"""Validator for content/games/mechanics/attribution-grid.json (Attribution Grid).

    python3 tools/games/validate_attribution-grid.py [path/to/attribution-grid.json]

Stdlib only. Exit status 0 when every check passes, 1 otherwise (all failures are listed).

Checks
  * top level: version 1, mechanic "attribution-grid", roles and items lists.
  * roles: exactly the four ids first / second / third / board (in that order), non-empty label,
    responsibility of 2-3 lines' worth (80-420 chars), 3-5 short examples (<= 90 chars), and every
    role `sources` entry points at an existing line of an existing notes file.
  * items, structure: required fields and types; id pattern ag-<reading>-<nn> and unique; nn
    runs 01, 02, ... within each reading; role and confusable_with in the four role ids;
    confusable_with != role; why / why_not non-empty single lines (<= 220 chars).
  * statement: <= 25 words, unique case-insensitively (and after stripping punctuation), and
    free of role giveaway words: board, committee, first/second/third line, line 1/2/3,
    1st/2nd/3rd line, lines of defen(c|s)e, internal audit, audit(or), director, ALCO,
    business line, risk management function, compliance function.
  * provenance: reading_id is a reading of game-blocks.json; source_file exists, lives under
    notes/FRM_Consolidated_Vol{1,2}/ch/ and maps to reading_id by the file-name convention
    (OR_ORRn -> ORR-n, LR_LTRn -> LTR-n, MR_MRn -> MR-n, CR/CI/IM likewise); source_line is
    inside the file; source_block (when not null) is a block of that reading, from that file,
    starting at or before source_line, and is the nearest such block.
  * faithfulness smoke test (text normalised to lowercase alphanumeric tokens, LaTeX commands
    stripped):
      - `evidence` (a verbatim phrase of the duty) occurs in the notes between source_line - 2
        and source_line + 3;
      - `role_evidence.text` occurs within +-1 line of role_evidence.line in role_evidence.file,
        and matches the cue vocabulary of the item's role (e.g. treasury / business unit for
        first; risk management / compliance / AML-CFT officer / CRO / ORM for second; internal
        audit / auditor for third; board / committee / ALCO for board) and, when it names one
        line explicitly (first line, 2nd line, Line 3 ...), names the item's own line;
      - lexical overlap: at least 2 content words of the statement (5-letter stems, stop words
        excluded) occur within +-6 lines of source_line, or at least half of them do.
  * balance: >= 15 items per role, >= 80 items overall, >= 8 readings covered, and every
    confusable_with value used at least once.
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MECHANIC = 'attribution-grid'
DEFAULT_JSON = os.path.join(ROOT, 'content', 'games', 'mechanics', MECHANIC + '.json')
BLOCKS_JSON = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')

ROLE_IDS = ['first', 'second', 'third', 'board']
MIN_PER_ROLE = 15
MIN_ITEMS = 80
MIN_READINGS = 8
MAX_WORDS = 25

GIVEAWAY = [
    r'\bboards?\b', r'\bcommittees?\b', r'\bfirst[- ]line\b', r'\bsecond[- ]line\b',
    r'\bthird[- ]line\b', r'\bline [123]\b', r'\b[123](st|nd|rd) line\b', r'\blines? of defen[cs]e\b',
    r'\binternal audit', r'\baudit', r'\bdirectors?\b', r'\balco\b', r'\bbusiness[- ]lines?\b',
    r'\brisk management function\b', r'\bcompliance function\b',
]

ROLE_CUES = {
    'first': r'line 1|first line|1st line|business unit|business owner|business line|risk owner|'
             r'treasury|risk champion|originator|lending officer',
    'second': r'line 2|second line|2nd line|risk management|compliance|aml cft officer|\bcro\b|'
              r'\borm\b|risk function|risk manager',
    'third': r'line 3|third line|3rd line|internal audit|auditor',
    'board': r'board|committee|alco|directors',
}
EXPLICIT_LINE = {
    'first': r'\b(first line|1st line|line 1)\b',
    'second': r'\b(second line|2nd line|line 2)\b',
    'third': r'\b(third line|3rd line|line 3)\b',
}

STOP = set('''about above across after again against along also among another before being
below between both could during each every either their there these those through under until
where which while whose within without would other others under upon since still than that
this with from into onto over such what when will shall should must have has having does done
make made itself its own them they then very more most less least just only same'''.split())

AREA_OF = {'OR_ORR': 'ORR', 'LR_LTR': 'LTR', 'MR_MR': 'MR', 'CR_CR': 'CR', 'CI_CI': 'CI',
           'IM_IM': 'IM'}

errors = []


def err(where, msg):
    errors.append('%s: %s' % (where, msg))


def norm(s):
    s = s.replace('\\%', ' ').replace('\\&', ' and ').replace('&', ' ')
    s = re.sub(r'\\[a-zA-Z]+\*?', ' ', s)          # LaTeX command names
    s = s.lower()
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return ' ' + ' '.join(s.split()) + ' '


def norm_plain(s):
    return ' ' + ' '.join(re.sub(r'[^a-z0-9]+', ' ', s.lower()).split()) + ' '


_files = {}


def lines_of(rel):
    if rel not in _files:
        p = os.path.join(ROOT, rel)
        _files[rel] = open(p, encoding='utf-8').read().split('\n') if os.path.isfile(p) else None
    return _files[rel]


def window(rel, lo, hi):
    ls = lines_of(rel)
    lo = max(1, lo)
    hi = min(len(ls), hi)
    return norm(' '.join(ls[lo - 1:hi]))


def reading_of_file(rel):
    m = re.match(r'^notes/FRM_Consolidated_Vol[12]/ch/\d+_([A-Z]+_[A-Z]+?)(\d+)\.tex$', rel)
    if not m:
        return None
    area = AREA_OF.get(m.group(1))
    return '%s-%s' % (area, m.group(2)) if area else None


def stems(text):
    out = []
    for w in re.findall(r'[a-z]+', text.lower()):
        if len(w) >= 5 and w not in STOP:
            out.append(w[:5])
    return list(dict.fromkeys(out))


def check_roles(roles):
    if not isinstance(roles, list):
        err('roles', 'must be a list')
        return
    ids = [r.get('id') for r in roles]
    if ids != ROLE_IDS:
        err('roles', 'ids must be %s in order, got %s' % (ROLE_IDS, ids))
    for r in roles:
        w = 'role %s' % r.get('id')
        if not isinstance(r.get('label'), str) or not r['label'].strip():
            err(w, 'label missing')
        resp = r.get('responsibility')
        if not isinstance(resp, str) or not (80 <= len(resp) <= 420):
            err(w, 'responsibility must be a 2-3 line string (80-420 chars)')
        ex = r.get('examples')
        if not isinstance(ex, list) or not (3 <= len(ex) <= 5):
            err(w, 'examples must be a list of 3-5')
        else:
            for e in ex:
                if not isinstance(e, str) or not e.strip() or len(e) > 90:
                    err(w, 'example too long or empty: %r' % e)
        src = r.get('sources')
        if not isinstance(src, list) or not src:
            err(w, 'sources missing')
        else:
            for s in src:
                ls = lines_of(s.get('file', ''))
                if ls is None or not (1 <= s.get('line', 0) <= len(ls)):
                    err(w, 'bad source %r' % s)
                elif not re.search(ROLE_CUES[r['id']], window(s['file'], s['line'] - 1, s['line'] + 1)):
                    err(w, 'source %s:%d does not name the role holder' % (s['file'], s['line']))


def check_item(it, readings, blocks_by_reading):
    w = it.get('id', '<no id>')
    req = {'id': str, 'reading_id': str, 'source_file': str, 'source_line': int, 'statement': str,
           'role': str, 'why': str, 'why_not': str, 'evidence': str, 'role_evidence': dict}
    for k, t in req.items():
        if not isinstance(it.get(k), t) or (t is str and not it[k].strip()):
            err(w, 'field %s missing or not %s' % (k, t.__name__))
            return
    if 'source_block' not in it or not (it['source_block'] is None or isinstance(it['source_block'], str)):
        err(w, 'source_block must be a string or null')
    if 'confusable_with' not in it:
        err(w, 'confusable_with missing')
    rid = it['reading_id']
    if not re.match(r'^ag-%s-\d{2}$' % re.escape(rid), w):
        err(w, 'id must be ag-<reading>-<nn>')
    if it['role'] not in ROLE_IDS:
        err(w, 'bad role %r' % it['role'])
    cw = it['confusable_with']
    if cw is not None and cw not in ROLE_IDS:
        err(w, 'bad confusable_with %r' % cw)
    if cw == it['role']:
        err(w, 'confusable_with equals role')
    for k in ('why', 'why_not'):
        if '\n' in it[k] or len(it[k]) > 220:
            err(w, '%s must be one line <= 220 chars' % k)

    st = it['statement']
    nwords = len(st.split())
    if nwords > MAX_WORDS:
        err(w, 'statement has %d words (> %d)' % (nwords, MAX_WORDS))
    for pat in GIVEAWAY:
        if re.search(pat, st, re.I):
            err(w, 'statement contains giveaway %r: %s' % (pat, st))

    # provenance
    if rid not in readings:
        err(w, 'reading %s not in game-blocks.json' % rid)
        return
    rel = it['source_file']
    ls = lines_of(rel)
    if ls is None:
        err(w, 'source_file %s missing' % rel)
        return
    if reading_of_file(rel) != rid:
        err(w, 'source_file %s does not belong to %s' % (rel, rid))
    line = it['source_line']
    if not (1 <= line <= len(ls)):
        err(w, 'source_line %d outside file' % line)
        return
    sb = it['source_block']
    cands = [b for b in blocks_by_reading[rid] if b.get('source_file') == rel and b['source_line'] <= line]
    if sb is not None:
        blk = next((b for b in blocks_by_reading[rid] if b['id'] == sb), None)
        if blk is None:
            err(w, 'source_block %s not in reading %s' % (sb, rid))
        elif blk.get('source_file') != rel or blk['source_line'] > line:
            err(w, 'source_block %s not from %s at/before line %d' % (sb, rel, line))
        elif cands and blk['source_line'] != max(b['source_line'] for b in cands):
            err(w, 'source_block %s is not the nearest block before line %d' % (sb, line))
    elif cands:
        err(w, 'source_block is null although a block precedes line %d' % line)

    # faithfulness smoke test
    ev = norm_plain(it['evidence'])
    if ev not in window(rel, line - 2, line + 3):
        err(w, 'evidence %r not found near %s:%d' % (it['evidence'], rel, line))
    re_ = it['role_evidence']
    rf, rl, rt = re_.get('file'), re_.get('line'), re_.get('text')
    if not (isinstance(rf, str) and isinstance(rl, int) and isinstance(rt, str) and rt.strip()):
        err(w, 'role_evidence must have file, line, text')
    elif lines_of(rf) is None or reading_of_file(rf) is None:
        err(w, 'role_evidence file %s missing or not a notes chapter' % rf)
    else:
        rtn = norm_plain(rt)
        if rtn not in window(rf, rl - 1, rl + 1):
            err(w, 'role_evidence %r not found near %s:%d' % (rt, rf, rl))
        if not re.search(ROLE_CUES[it['role']], rtn):
            err(w, 'role_evidence %r does not name a %s-role holder' % (rt, it['role']))
        for other, pat in EXPLICIT_LINE.items():
            if other != it['role'] and re.search(pat, rtn) and not (
                    it['role'] in EXPLICIT_LINE and re.search(EXPLICIT_LINE[it['role']], rtn)):
                err(w, 'role_evidence %r names %s, not %s' % (rt, other, it['role']))
    sts = stems(st)
    ctx = window(rel, line - 6, line + 6)
    ctx_stems = set(t[:5] for t in ctx.split() if len(t) >= 5)
    hits = [s for s in sts if s in ctx_stems]
    if sts and not (len(hits) >= 2 or len(hits) * 2 >= len(sts)):
        err(w, 'statement shares too few content words with notes near l.%d (%s of %s)' % (line, hits, sts))


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON
    doc = json.load(open(path, encoding='utf-8'))
    readings = json.load(open(BLOCKS_JSON, encoding='utf-8'))['readings']
    blocks_by_reading = {rid: [b for o in r['objectives'] for b in o['blocks']] for rid, r in readings.items()}

    if doc.get('version') != 1:
        err('top', 'version must be 1')
    if doc.get('mechanic') != MECHANIC:
        err('top', 'mechanic must be %r' % MECHANIC)
    check_roles(doc.get('roles'))
    items = doc.get('items')
    if not isinstance(items, list):
        err('top', 'items must be a list')
        items = []

    seen_ids, seen_st, seq = set(), {}, {}
    for it in items:
        if not isinstance(it, dict):
            err('items', 'item is not an object')
            continue
        check_item(it, readings, blocks_by_reading)
        iid = it.get('id')
        if iid in seen_ids:
            err(iid, 'duplicate id')
        seen_ids.add(iid)
        m = re.match(r'^ag-(.+)-(\d{2})$', str(iid))
        if m:
            seq.setdefault(m.group(1), []).append(int(m.group(2)))
        key = norm_plain(str(it.get('statement', '')))
        if key in seen_st:
            err(iid, 'statement duplicates %s (case-insensitive)' % seen_st[key])
        seen_st[key] = iid
    for rid, ns in seq.items():
        if ns != list(range(1, len(ns) + 1)):
            err('ag-%s' % rid, 'item numbers must run 01..%02d in order, got %s' % (len(ns), ns))

    per_role = {r: sum(1 for i in items if isinstance(i, dict) and i.get('role') == r) for r in ROLE_IDS}
    for r, n in per_role.items():
        if n < MIN_PER_ROLE:
            err('balance', 'role %s has %d items (< %d)' % (r, n, MIN_PER_ROLE))
    if len(items) < MIN_ITEMS:
        err('balance', '%d items (< %d)' % (len(items), MIN_ITEMS))
    rids = sorted({i.get('reading_id') for i in items if isinstance(i, dict)})
    if len(rids) < MIN_READINGS:
        err('balance', 'only %d readings covered' % len(rids))
    used_conf = {i.get('confusable_with') for i in items if isinstance(i, dict)}
    for r in ROLE_IDS:
        if r not in used_conf:
            err('balance', 'role %s never used as confusable_with' % r)

    if errors:
        print('FAIL: %d problem(s)' % len(errors))
        for e in errors:
            print('  - ' + e)
        return 1
    per_reading = {}
    for i in items:
        per_reading[i['reading_id']] = per_reading.get(i['reading_id'], 0) + 1
    print('OK: %d items, %d readings, per role %s' % (len(items), len(rids), per_role))
    print('   per reading: ' + ', '.join('%s=%d' % kv for kv in sorted(per_reading.items())))
    return 0


if __name__ == '__main__':
    sys.exit(main())
