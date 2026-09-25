#!/usr/bin/env python3
"""Validator for content/games/mechanics/grid-settler.json (Grid Settler).

    python3 tools/games/validate_grid-settler.py [path/to/grid-settler.json]

Stdlib only. Exit status 0 when every check passes, 1 otherwise (all failures are listed).

Checks
  * top level: version 1, mechanic "grid-settler", non-empty items list.
  * item structure: required fields and types; id pattern gs-<reading>-<nn>, unique, numbered
    01, 02, ... within each reading; title <= 80 chars; x / y each {label, values} with 2-4
    distinct non-empty values; explanation non-empty; pattern non-empty, at most two sentences.
  * tiles: 6-12 per item; tile ids unique across the file and numbered <item id>-t01, -t02, ...;
    texts non-empty, <= 10 words, unique within the item (case- and punctuation-insensitive;
    short values such as "0.5%" may recur in different items); cell = [xIndex, yIndex] of ints in range; `why` a single line
    (<= 200 chars); `evidence` string and `line` int present.
  * grid shape: at least 3 distinct cells used; every x value and every y value used by at
    least one tile (so no axis category is decorative); at least one cell is shared or at least
    one cell is empty is NOT required (both are allowed).
  * provenance: reading_id is a reading of game-blocks.json; source_file exists, lives under
    notes/FRM_Consolidated_Vol{1,2}/ch/ and maps to reading_id by the file-name convention
    (OR_ORRn -> ORR-n, LR_LTRn -> LTR-n, MR_MRn -> MR-n, CR/CI/IM likewise); source_line is
    inside the file; source_block (when not null) is a block of that reading, from that file,
    at or before source_line, and the nearest such block.
  * faithfulness smoke test (text normalised to lowercase alphanumeric tokens, LaTeX commands
    stripped):
      - ORR-1's rating chips (\chiplow, \chipmod, \chiphigh, \chipvhigh) are expanded to their
        printed words before normalising, so the Low/High ratings are checkable;
      - every tile's `evidence` phrase occurs in the notes within line-1 .. line+1 of its `line`,
        and `line` lies within source_line-25 .. source_line+300;
      - pattern_evidence.text occurs within +-1 line of pattern_evidence.line, same bounds;
      - tile lexical overlap: of the tile text's content words (5-letter stems, stop words
        excluded) at least half, or at least 2, occur within +-8 lines of the tile's line;
      - numeric tiles: every number in the tile text occurs in its evidence phrase;
      - cell anchoring: a word of the tile's x value or y value occurs within +-6 lines of the
        tile's line (catches a tile whose evidence was found somewhere unrelated to its cell);
      - axis values: each x / y value shares a word with the notes span the item covers
        (source_line-25 .. last cited line+10);
      - pattern overlap: at least half of the pattern's content stems occur in that span.
  * cell keys (optional `cell_keys` {x: [[keys..] per x value], y: [...]}, used where the notes
    print both classifications on the tile's own table row, e.g. ORR-1's Low/High chips or
    LTR-7's Up/Down columns): each tile's evidence must contain "<x key> <y key>" for its own
    cell and for no other cell.
  * numeric claims (optional `numeric_claims`): tile numbers ("zero" = 0, else the first number
    in the text) must satisfy each claim: increasing_y (down a column, optionally over `ys`),
    increasing_x (along a row), row_greater (cell hi > cell lo in row y), argmax_x / argmin_x
    (cell x is the strict max / min of row y). Referenced cells must hold exactly one tile.
  * balance: >= 25 items, >= 20 readings, at most 3 items per reading.
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MECHANIC = 'grid-settler'
DEFAULT_JSON = os.path.join(ROOT, 'content', 'games', 'mechanics', MECHANIC + '.json')
BLOCKS_JSON = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')

MIN_TILES, MAX_TILES = 6, 12
MIN_ITEMS, MIN_READINGS, MAX_PER_READING = 25, 20, 3
MAX_WORDS = 10
SPAN_BEFORE, SPAN_AFTER = 25, 300

STOP = set('''about above across after again against along also among another before being
below between both could during each every either their there these those through under until
where which while whose within without would other others upon since still than that this with
from into onto over such what when will shall should must have having does done make made
itself them they then very more most less least just only same same your'''.split())

AREA_OF = {'OR_ORR': 'ORR', 'LR_LTR': 'LTR', 'MR_MR': 'MR', 'CR_CR': 'CR', 'CI_CI': 'CI',
           'IM_IM': 'IM'}

errors = []


def err(where, msg):
    errors.append('%s: %s' % (where, msg))


CHIPS = {'\\chipvhigh': ' very high ', '\\chiplow': ' low ', '\\chipmod': ' moderate ',
         '\\chiphigh': ' high '}   # rating chips defined in Vol1 preamble.tex (ORR-1 table)


def norm(s):
    for k, v in CHIPS.items():
        s = s.replace(k, v)
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


def stems(text, minlen=5):
    out = []
    for w in re.findall(r'[a-z]+', text.lower()):
        if len(w) >= minlen and w not in STOP:
            out.append(w[:5])
    return list(dict.fromkeys(out))


def ctx_stems(text):
    return set(t[:5] for t in text.split() if len(t) >= 3)


def words(text):
    return [w for w in re.findall(r'[a-z]+', text.lower()) if len(w) >= 3 and w not in STOP]


def number_of(text):
    if text.strip().lower() == 'zero':
        return 0.0
    m = re.search(r'\d+(?:\.\d+)?', text)
    return float(m.group(0)) if m else None


def check_axis(w, name, ax):
    if not isinstance(ax, dict):
        err(w, '%s must be an object' % name)
        return None
    if not isinstance(ax.get('label'), str) or not ax['label'].strip():
        err(w, '%s.label missing' % name)
    vals = ax.get('values')
    if not isinstance(vals, list) or not (2 <= len(vals) <= 4):
        err(w, '%s.values must be a list of 2-4' % name)
        return None
    if any(not isinstance(v, str) or not v.strip() for v in vals):
        err(w, '%s.values must be non-empty strings' % name)
        return None
    if len({norm_plain(v) for v in vals}) != len(vals):
        err(w, '%s.values not distinct' % name)
    return vals


def check_numeric(w, it, xs, ys):
    claims = it.get('numeric_claims')
    if claims is None:
        return
    if not isinstance(claims, list) or not claims:
        err(w, 'numeric_claims must be a non-empty list')
        return
    grid = {}
    for t in it['tiles']:
        grid.setdefault(tuple(t['cell']), []).append(t)

    def val(x, y):
        ts = grid.get((x, y), [])
        if len(ts) != 1:
            err(w, 'numeric claim references cell [%d,%d] holding %d tiles' % (x, y, len(ts)))
            return None
        v = number_of(ts[0]['text'])
        if v is None:
            err(w, 'tile %s has no number' % ts[0]['id'])
        return v

    for c in claims:
        k = c.get('kind')
        if k == 'increasing_y':
            rows = c.get('ys', list(range(len(ys))))
            vs = [val(c['x'], y) for y in rows]
            if None not in vs and any(a >= b for a, b in zip(vs, vs[1:])):
                err(w, 'claim increasing_y x=%d fails: %s' % (c['x'], vs))
        elif k == 'increasing_x':
            cols = c.get('xs', list(range(len(xs))))
            vs = [val(x, c['y']) for x in cols]
            if None not in vs and any(a >= b for a, b in zip(vs, vs[1:])):
                err(w, 'claim increasing_x y=%d fails: %s' % (c['y'], vs))
        elif k == 'row_greater':
            hi, lo = val(c['hi'], c['y']), val(c['lo'], c['y'])
            if None not in (hi, lo) and not hi > lo:
                err(w, 'claim row_greater y=%d fails: %s <= %s' % (c['y'], hi, lo))
        elif k in ('argmax_x', 'argmin_x'):
            vs = {x: val(x, c['y']) for x in range(len(xs))}
            if None not in vs.values():
                target = vs[c['x']]
                others = [v for x, v in vs.items() if x != c['x']]
                ok = all(target > o for o in others) if k == 'argmax_x' else all(target < o for o in others)
                if not ok:
                    err(w, 'claim %s y=%d x=%d fails: %s' % (k, c['y'], c['x'], vs))
        else:
            err(w, 'unknown numeric claim %r' % k)


def check_cell_keys(w, it, xs, ys, tiles):
    ck = it.get('cell_keys')
    if ck is None:
        return
    kx, ky = ck.get('x'), ck.get('y')
    if not (isinstance(kx, list) and isinstance(ky, list) and len(kx) == len(xs) and len(ky) == len(ys)):
        err(w, 'cell_keys must give one key list per x value and per y value')
        return

    def pairs(i, j):
        return [norm_plain('%s %s' % (a, b)) for a in kx[i] for b in ky[j]]

    for t in tiles:
        ev = norm(t['evidence'])
        own = t['cell']
        if not any(p in ev for p in pairs(own[0], own[1])):
            err('%s/%s' % (w, t['id']), 'evidence %r does not state its own cell %s' % (t['evidence'], own))
        for i in range(len(xs)):
            for j in range(len(ys)):
                if [i, j] != own and any(p in ev for p in pairs(i, j)) and not any(
                        p in q for p in pairs(i, j) for q in pairs(own[0], own[1])):
                    err('%s/%s' % (w, t['id']), 'evidence %r also states cell [%d,%d]' % (t['evidence'], i, j))


def check_item(it, readings, blocks_by_reading, seen_tile_ids, seen_texts):
    w = it.get('id', '<no id>')
    req = {'id': str, 'reading_id': str, 'source_file': str, 'source_line': int, 'title': str,
           'x': dict, 'y': dict, 'tiles': list, 'pattern': str, 'pattern_evidence': dict,
           'explanation': str}
    for k, t in req.items():
        if not isinstance(it.get(k), t) or (t is str and not it[k].strip()):
            err(w, 'field %s missing or not %s' % (k, t.__name__))
            return
    if 'source_block' not in it or not (it['source_block'] is None or isinstance(it['source_block'], str)):
        err(w, 'source_block must be a string or null')
    rid = it['reading_id']
    if not re.match(r'^gs-%s-\d{2}$' % re.escape(rid), w):
        err(w, 'id must be gs-<reading>-<nn>')
    if len(it['title']) > 80:
        err(w, 'title longer than 80 chars')
    xs = check_axis(w, 'x', it['x'])
    ys = check_axis(w, 'y', it['y'])
    pat = it['pattern'].strip()
    nsent = len(re.findall(r'[.!?](?:\s|$)', pat))
    if nsent < 1 or nsent > 2:
        err(w, 'pattern must be one or two sentences (found %d)' % nsent)

    tiles = it['tiles']
    if not (MIN_TILES <= len(tiles) <= MAX_TILES):
        err(w, '%d tiles (must be %d-%d)' % (len(tiles), MIN_TILES, MAX_TILES))
    texts = set()
    cells = set()
    ok_tiles = []
    for n, t in enumerate(tiles, 1):
        tw = '%s/%s' % (w, t.get('id') if isinstance(t, dict) else n)
        if not isinstance(t, dict):
            err(tw, 'tile is not an object')
            continue
        if t.get('id') != '%s-t%02d' % (w, n):
            err(tw, 'tile id must be %s-t%02d' % (w, n))
        if t.get('id') in seen_tile_ids:
            err(tw, 'duplicate tile id')
        seen_tile_ids.add(t.get('id'))
        tx = t.get('text')
        if not isinstance(tx, str) or not tx.strip():
            err(tw, 'text missing')
            continue
        if len(tx.split()) > MAX_WORDS:
            err(tw, 'text has %d words (> %d): %s' % (len(tx.split()), MAX_WORDS, tx))
        key = norm_plain(tx)
        if key in texts:
            err(tw, 'duplicate tile text within item: %s' % tx)
        texts.add(key)
        c = t.get('cell')
        if not (isinstance(c, list) and len(c) == 2 and all(isinstance(v, int) and not isinstance(v, bool) for v in c)):
            err(tw, 'cell must be [int, int]')
            continue
        if xs is not None and ys is not None:
            if not (0 <= c[0] < len(xs) and 0 <= c[1] < len(ys)):
                err(tw, 'cell %s out of range' % c)
                continue
        cells.add(tuple(c))
        why = t.get('why')
        if not isinstance(why, str) or not why.strip() or '\n' in why or len(why) > 200:
            err(tw, 'why must be one non-empty line <= 200 chars')
        if not isinstance(t.get('evidence'), str) or not t['evidence'].strip() or not isinstance(t.get('line'), int):
            err(tw, 'evidence (str) and line (int) required')
            continue
        ok_tiles.append(t)
    if len(cells) < 3:
        err(w, 'only %d distinct cells used (< 3)' % len(cells))
    if xs is not None and ys is not None:
        for i, v in enumerate(xs):
            if not any(c[0] == i for c in cells):
                err(w, 'x value %r has no tile' % v)
        for j, v in enumerate(ys):
            if not any(c[1] == j for c in cells):
                err(w, 'y value %r has no tile' % v)

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
    lo_b, hi_b = line - SPAN_BEFORE, line + SPAN_AFTER
    cited = [line]
    for t in ok_tiles:
        tw = '%s/%s' % (w, t['id'])
        tl = t['line']
        if not (lo_b <= tl <= hi_b) or not (1 <= tl <= len(ls)):
            err(tw, 'line %d outside %d..%d' % (tl, lo_b, hi_b))
            continue
        cited.append(tl)
        if norm(t['evidence']) not in window(rel, tl - 1, tl + 1):
            err(tw, 'evidence %r not found near %s:%d' % (t['evidence'], rel, tl))
        ctx = ctx_stems(window(rel, tl - 8, tl + 8))
        sts = stems(t['text'])
        hits = [s for s in sts if s in ctx]
        if sts and not (len(hits) >= 2 or len(hits) * 2 >= len(sts)):
            err(tw, 'text shares too few content words with notes near l.%d (%s of %s)' % (tl, hits, sts))
        nums = re.findall(r'\d+(?:\.\d+)?', t['text'])
        ev_n = norm(t['evidence'])
        for num in nums:
            if norm_plain(num) not in ev_n:
                err(tw, 'number %s of the tile text is not in its evidence' % num)
        if xs is not None and ys is not None:
            near = ctx_stems(window(rel, tl - 6, tl + 6))
            cell_words = words(xs[t['cell'][0]]) + words(ys[t['cell'][1]])
            if cell_words and not any(cw[:5] in near for cw in cell_words):
                err(tw, 'neither its x value nor its y value is named within 6 lines of l.%d' % tl)
    pe = it['pattern_evidence']
    pt, pl = pe.get('text'), pe.get('line')
    if not (isinstance(pt, str) and pt.strip() and isinstance(pl, int)):
        err(w, 'pattern_evidence needs text and line')
    elif not (lo_b <= pl <= hi_b) or not (1 <= pl <= len(ls)):
        err(w, 'pattern_evidence line %d outside %d..%d' % (pl, lo_b, hi_b))
    else:
        cited.append(pl)
        if norm(pt) not in window(rel, pl - 1, pl + 1):
            err(w, 'pattern_evidence %r not found near %s:%d' % (pt, rel, pl))
    span = ctx_stems(window(rel, line - SPAN_BEFORE, max(cited) + 10))
    for name, vals in (('x', xs), ('y', ys)):
        for v in vals or []:
            ws = words(v)
            if ws and not any(x[:5] in span for x in ws):
                err(w, '%s value %r not named anywhere in the cited span' % (name, v))
    psts = stems(it['pattern'])
    phits = [s for s in psts if s in span]
    if psts and len(phits) * 2 < len(psts):
        err(w, 'pattern shares too few content words with the cited span (%d of %d): %s' % (
            len(phits), len(psts), sorted(set(psts) - set(phits))))
    if xs is not None and ys is not None:
        check_numeric(w, it, xs, ys)
        check_cell_keys(w, it, xs, ys, ok_tiles)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON
    doc = json.load(open(path, encoding='utf-8'))
    readings = json.load(open(BLOCKS_JSON, encoding='utf-8'))['readings']
    blocks_by_reading = {rid: [b for o in r['objectives'] for b in o['blocks']] for rid, r in readings.items()}

    if doc.get('version') != 1:
        err('top', 'version must be 1')
    if doc.get('mechanic') != MECHANIC:
        err('top', 'mechanic must be %r' % MECHANIC)
    items = doc.get('items')
    if not isinstance(items, list) or not items:
        err('top', 'items must be a non-empty list')
        items = []

    seen_ids, seq, seen_tile_ids, seen_texts = set(), {}, set(), {}
    for it in items:
        if not isinstance(it, dict):
            err('items', 'item is not an object')
            continue
        check_item(it, readings, blocks_by_reading, seen_tile_ids, seen_texts)
        iid = it.get('id')
        if iid in seen_ids:
            err(iid, 'duplicate id')
        seen_ids.add(iid)
        m = re.match(r'^gs-(.+)-(\d{2})$', str(iid))
        if m:
            seq.setdefault(m.group(1), []).append(int(m.group(2)))
    for rid, ns in seq.items():
        if ns != list(range(1, len(ns) + 1)):
            err('gs-%s' % rid, 'item numbers must run 01..%02d in order, got %s' % (len(ns), ns))
        if len(ns) > MAX_PER_READING:
            err('balance', 'reading %s has %d items (> %d)' % (rid, len(ns), MAX_PER_READING))

    if len(items) < MIN_ITEMS:
        err('balance', '%d items (< %d)' % (len(items), MIN_ITEMS))
    rids = sorted({i.get('reading_id') for i in items if isinstance(i, dict)})
    if len(rids) < MIN_READINGS:
        err('balance', 'only %d readings covered (< %d)' % (len(rids), MIN_READINGS))

    if errors:
        print('FAIL: %d problem(s)' % len(errors))
        for e in errors:
            print('  - ' + e)
        return 1
    ntiles = sum(len(i['tiles']) for i in items)
    ncells = sum(len({tuple(t['cell']) for t in i['tiles']}) for i in items)
    print('OK: %d items, %d tiles, %d filled cells, %d readings' % (len(items), ntiles, ncells, len(rids)))
    print('   readings: ' + ', '.join(rids))
    return 0


if __name__ == '__main__':
    sys.exit(main())
