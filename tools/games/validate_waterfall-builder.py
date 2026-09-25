#!/usr/bin/env python3
"""Validator for the Waterfall Builder mechanic.

    python3 tools/games/validate_waterfall-builder.py [path/to/waterfall-builder.json]

Stdlib only. Asserts, for the whole file and for every item:

  * envelope: version == 1, mechanic == "waterfall-builder", a non-empty items list;
  * structure: exactly the allowed fields, correct types, kind in {stack, process, loop};
    id is "wb-<reading_id>-<nn>", unique, numbered 01, 02, ... within each reading;
  * provenance: source_file exists under notes/ and its file name maps to reading_id
    (e.g. 30_MR_MR11.tex -> MR-11, LR_LTR -> LTR, OR_ORR -> ORR); source_line and every
    citation line fall inside the file; source_block (if not null) exists in
    content/games/game-blocks.json under the same reading, points at the same file and
    sits within BLOCK_SLACK lines of source_line;
  * steps: 4-8 steps, unique ids (kebab-case) and unique texts (case/space-insensitive);
    every text is 1-12 words with no LaTeX residue; every detail is a single line of at most
    MAX_DETAIL_WORDS words;
  * loops: kind == "loop" <=> a non-empty loop_closure; the notes around the item
    (source_line window or any citation line) must use cyclical language
    (loop / cycle / spiral / circuit / closes / feedback), and no non-loop item may
    carry a loop_closure;
  * faithfulness smoke test: the .tex text within +/-WINDOW lines of source_line must contain
    keywords from at least two distinct steps, and from at least half of all steps;
    stack/process items must also show an ordering marker there (arrow, numbered list,
    "order", "first", "step", "stage", "phase", "increasing", ...).
Exit status 0 on success; 1 with a list of failures otherwise.
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MECHANIC = 'waterfall-builder'
DEFAULT_JSON = os.path.join(ROOT, 'content', 'games', 'mechanics', MECHANIC + '.json')
BLOCKS_JSON = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')

KINDS = ('stack', 'process', 'loop')
MIN_STEPS, MAX_STEPS = 4, 8
MAX_STEP_WORDS = 12
MAX_DETAIL_WORDS = 25
WINDOW = 40          # lines either side of source_line for the keyword smoke test
CITE_WINDOW = 3      # lines either side of a citation line for the loop-language test
BLOCK_SLACK = 60     # max distance between source_block's line and source_line

REQUIRED = ('id', 'reading_id', 'source_block', 'source_file', 'source_line', 'title', 'kind',
            'direction_label', 'steps', 'explanation', 'citations')
OPTIONAL = ('loop_closure',)
STEP_FIELDS = ('id', 'text', 'detail')

STOPWORDS = set('''
about after again also among and any are around back been before being both but can come comes
does down each every falls from goes have into its itself just less more most much must next
only onto other over same some such than that the their them then there these they this those
through under until upon very what when where which while with within without your risk risks
rise rises
'''.split())

LOOP_RE = re.compile(r'\b(loop|loops|cycle|cycles|cyclical|spiral|spirals|circuit|closes|feedback)\b', re.I)
ORDER_RE = re.compile(
    r'(\\draw|\\foreach|->|\\rightarrow|\\Rightarrow|\border\b|\bfirst\b|\bsecond\b|\bthen\b|'
    r'\bsteps?\b|\bstages?\b|\bphases?\b|\bincreasing\b|\bpriority\b|\bsequence\b|'
    r'\\item|\benumerate\b|\blettered\b|^\s*\d[\.\)]|\{\d[\.\)])', re.I | re.M)
ID_RE = re.compile(r'^wb-(?P<rid>[A-Z]+-\d+)-(?P<nn>\d{2})$')
TEX_RE = re.compile(r'\\|[{}]|\$(?!\d)')   # backslash, braces, or a $ that is not a currency amount
STEP_ID_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
FILE_RE = re.compile(r'^\d+_[A-Z]+_([A-Z]+)(\d+)\.tex$')

errors = []


def fail(where, msg):
    errors.append('%s: %s' % (where, msg))


def words(s):
    return re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-]*", s)


def keywords(text):
    out = set()
    for w in re.findall(r'[a-z0-9]+', text.lower()):
        if len(w) >= 4 and w not in STOPWORDS:
            out.add(w)
    return out


def norm_tex(s):
    s = s.lower().replace('\\&', ' and ').replace('--', ' ')
    s = re.sub(r'\\[a-z]+\*?', ' ', s)
    return s


def reading_from_file(path):
    m = FILE_RE.match(os.path.basename(path))
    if not m:
        return None
    return '%s-%s' % (m.group(1), int(m.group(2)))


def load_blocks():
    with open(BLOCKS_JSON) as f:
        data = json.load(f)
    index = {}
    for rid, r in data['readings'].items():
        for o in r.get('objectives', []):
            for b in o.get('blocks', []):
                index[b['id']] = (rid, b.get('source_file'), b.get('source_line'))
    return index


_file_cache = {}


def file_lines(rel):
    if rel not in _file_cache:
        with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
            _file_cache[rel] = f.read().split('\n')
    return _file_cache[rel]


def check_item(it, blocks, seen_ids, per_reading):
    where = it.get('id', '<no id>')
    keys = set(it)
    for k in REQUIRED:
        if k not in keys:
            fail(where, 'missing field %r' % k)
    extra = keys - set(REQUIRED) - set(OPTIONAL)
    if extra:
        fail(where, 'unexpected fields %s' % sorted(extra))
    if any(k not in keys for k in REQUIRED):
        return 0

    # ---- id / reading
    m = ID_RE.match(it['id'])
    if not m:
        fail(where, 'id does not match wb-<READING>-<nn>')
    elif m.group('rid') != it['reading_id']:
        fail(where, 'id reading %s != reading_id %s' % (m.group('rid'), it['reading_id']))
    if it['id'] in seen_ids:
        fail(where, 'duplicate id')
    seen_ids.add(it['id'])
    if m:
        per_reading.setdefault(it['reading_id'], []).append(int(m.group('nn')))

    # ---- provenance
    sf = it['source_file']
    if not isinstance(sf, str) or not sf.startswith('notes/') or not os.path.isfile(os.path.join(ROOT, sf)):
        fail(where, 'source_file missing: %r' % sf)
        return 0
    if reading_from_file(sf) != it['reading_id']:
        fail(where, 'source_file %s maps to %s, not %s' % (sf, reading_from_file(sf), it['reading_id']))
    lines = file_lines(sf)
    sl = it['source_line']
    if not isinstance(sl, int) or isinstance(sl, bool) or not 1 <= sl <= len(lines):
        fail(where, 'source_line %r outside 1..%d' % (sl, len(lines)))
        return 0
    sb = it['source_block']
    if sb is not None:
        if sb not in blocks:
            fail(where, 'source_block %r not in game-blocks.json' % sb)
        else:
            brid, bfile, bline = blocks[sb]
            if brid != it['reading_id']:
                fail(where, 'source_block belongs to %s' % brid)
            if bfile != sf:
                fail(where, 'source_block file %s != %s' % (bfile, sf))
            if not isinstance(bline, int) or abs(bline - sl) > BLOCK_SLACK:
                fail(where, 'source_block line %r is more than %d lines from source_line %d'
                     % (bline, BLOCK_SLACK, sl))
    cites = it['citations']
    if not isinstance(cites, list) or not cites:
        fail(where, 'citations must be a non-empty list')
        cites = []
    cite_lines = []
    for c in cites:
        if not isinstance(c, dict) or set(c) != {'line', 'note'}:
            fail(where, 'citation must be {line, note}: %r' % (c,))
            continue
        ln = c['line']
        if not isinstance(ln, int) or not 1 <= ln <= len(lines):
            fail(where, 'citation line %r outside file' % (ln,))
            continue
        if not lines[ln - 1].strip():
            fail(where, 'citation line %d is blank' % ln)
        if not isinstance(c['note'], str) or not c['note'].strip():
            fail(where, 'citation %d has empty note' % ln)
        cite_lines.append(ln)
    if len(cite_lines) != len(set(cite_lines)):
        fail(where, 'duplicate citation lines')

    # ---- scalar text fields
    for k in ('title', 'direction_label', 'explanation'):
        v = it[k]
        if not isinstance(v, str) or not v.strip() or '\n' in v:
            fail(where, '%s must be a non-empty single-line string' % k)
    if it['kind'] not in KINDS:
        fail(where, 'kind %r not in %s' % (it['kind'], KINDS))

    # ---- steps
    steps = it['steps']
    if not isinstance(steps, list) or not MIN_STEPS <= len(steps) <= MAX_STEPS:
        fail(where, 'needs %d-%d steps, has %s' % (MIN_STEPS, MAX_STEPS,
                                                     len(steps) if isinstance(steps, list) else steps))
        return 0
    sids, stexts = set(), set()
    for i, s in enumerate(steps, 1):
        sw = '%s step %d' % (where, i)
        if not isinstance(s, dict) or set(s) != set(STEP_FIELDS):
            fail(sw, 'step must have exactly %s' % (STEP_FIELDS,))
            continue
        if not isinstance(s['id'], str) or not STEP_ID_RE.match(s['id']):
            fail(sw, 'bad step id %r' % s['id'])
        if s['id'] in sids:
            fail(sw, 'duplicate step id %r' % s['id'])
        sids.add(s['id'])
        t = s['text']
        if not isinstance(t, str) or not t.strip() or '\n' in t:
            fail(sw, 'text must be a non-empty single line')
            continue
        nt = ' '.join(t.lower().split())
        if nt in stexts:
            fail(sw, 'duplicate step text %r' % t)
        stexts.add(nt)
        nw = len(words(t))
        if not 1 <= nw <= MAX_STEP_WORDS:
            fail(sw, 'text has %d words (max %d): %r' % (nw, MAX_STEP_WORDS, t))
        if TEX_RE.search(t):
            fail(sw, 'LaTeX residue in text %r' % t)
        d = s['detail']
        if not isinstance(d, str) or not d.strip() or '\n' in d:
            fail(sw, 'detail must be a non-empty single line')
        elif len(words(d)) > MAX_DETAIL_WORDS:
            fail(sw, 'detail has %d words (max %d)' % (len(words(d)), MAX_DETAIL_WORDS))
        elif TEX_RE.search(d):
            fail(sw, 'LaTeX residue in detail')

    # ---- loop consistency
    lo, hi = max(1, sl - WINDOW), min(len(lines), sl + WINDOW)
    window_raw = '\n'.join(lines[lo - 1:hi])
    if it['kind'] == 'loop':
        lc = it.get('loop_closure')
        if not isinstance(lc, str) or not lc.strip():
            fail(where, 'loop items need a non-empty loop_closure')
        near = [window_raw] + ['\n'.join(lines[max(0, c - 1 - CITE_WINDOW):c + CITE_WINDOW])
                               for c in cite_lines]
        if not any(LOOP_RE.search(chunk) for chunk in near):
            fail(where, 'kind is loop but the notes near the item never describe a loop/cycle/spiral')
    elif 'loop_closure' in it:
        fail(where, 'loop_closure present on a %s item' % it['kind'])
    else:
        if not ORDER_RE.search(window_raw):
            fail(where, 'no ordering marker in the notes within %d lines of source_line' % WINDOW)

    # ---- faithfulness smoke test
    window = norm_tex(window_raw)
    hit_steps, hit_words = 0, set()
    for s in steps:
        if not isinstance(s, dict) or not isinstance(s.get('text'), str):
            continue
        kws = keywords(s['text'])
        found = {k for k in kws if k in window}
        if found:
            hit_steps += 1
            hit_words |= found
    need = max(2, (len(steps) + 1) // 2)
    if hit_steps < need or len(hit_words) < 2:
        fail(where, 'faithfulness: only %d/%d steps (%d keywords) found within %d lines of line %d; need %d'
             % (hit_steps, len(steps), len(hit_words), WINDOW, sl, need))
    return hit_steps


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON
    with open(path) as f:
        doc = json.load(f)
    if doc.get('version') != 1:
        fail('file', 'version must be 1')
    if doc.get('mechanic') != MECHANIC:
        fail('file', 'mechanic must be %r' % MECHANIC)
    if set(doc) != {'version', 'mechanic', 'items'}:
        fail('file', 'unexpected top-level keys %s' % sorted(set(doc) - {'version', 'mechanic', 'items'}))
    items = doc.get('items')
    if not isinstance(items, list) or not items:
        fail('file', 'items must be a non-empty list')
        items = []
    blocks = load_blocks()
    seen, per_reading = set(), {}
    kinds = {}
    for it in items:
        if not isinstance(it, dict):
            fail('file', 'item is not an object')
            continue
        check_item(it, blocks, seen, per_reading)
        kinds[it.get('kind')] = kinds.get(it.get('kind'), 0) + 1
    for rid, nns in per_reading.items():
        if sorted(nns) != list(range(1, len(nns) + 1)):
            fail(rid, 'item numbers %s are not 01..%02d' % (sorted(nns), len(nns)))

    if errors:
        print('FAIL: %d problem(s)' % len(errors))
        for e in errors:
            print('  -', e)
        sys.exit(1)
    print('OK: %d items, %d readings (%s); kinds %s'
          % (len(items), len(per_reading), ', '.join(sorted(per_reading)),
             ', '.join('%s=%d' % kv for kv in sorted(kinds.items()))))


if __name__ == '__main__':
    main()
