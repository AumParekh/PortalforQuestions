#!/usr/bin/env python3
"""Validator for the Framework Navigator mechanic.

    python3 tools/games/validate_framework-navigator.py [path/to/framework-navigator.json]

Stdlib only. Asserts:

  * shape: version 1, mechanic id, lineages / nodes / changes / pairs with required fields,
    unique ids, id patterns (changes fn-<reading>-NN, pairs fnp-<reading>-NN);
  * graph: every lineage, parent, decoy, pair and related reference exists; no self-parents;
    parent_links mirror parents exactly with a known kind; the parents graph is acyclic
    (Kahn); years (int, 'YYYY-YYYY' range, or null with a year_note) are non-decreasing along
    every parent edge where both ends are dated; a dated node cites a line that shows its year;
  * content: every node has >= 1 of introduced / restricted / responding_to, items <= 12 words,
    no duplicates, short <= 14 chars, one-line summary; every node has >= 1 change;
  * changes: text <= 20 words, one-line why, reading_id in the node's reading_ids and equal to
    the reading of the cited file, 2-3 distinct decoys that exclude the correct node, are not
    a parent the node is a component of, and are plausible (same lineage, graph neighbour,
    sibling, or declared related); no giveaway: the text names neither the node nor any decoy
    (name, short or alias, word-boundary, case-insensitive);
  * pairs: a != b, no duplicate pair, reading_id belongs to a or b, >= 2 differences of
    <= 15 words, one source per difference;
  * faithfulness smoke test: every cited notes line exists and every keyword attached to it
    (node source, year, parent link, each node item, each change, each pair difference) appears
    within +/-5 lines of it in the .tex source (LaTeX markup stripped); every evidence file
    belongs to one of the node's readings; source_block ids exist in game-blocks.json and
    come from the same file.
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MECHANIC = 'framework-navigator'
DEFAULT_JSON = os.path.join(ROOT, 'content', 'games', 'mechanics', MECHANIC + '.json')
BLOCKS_JSON = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')
WINDOW = 5
PARENT_KINDS = ('explicit', 'component', 'sequence')
RID_RE = re.compile(r'^(MR|CR|ORR|LTR|IM|CI)-\d{1,2}$')
SLUG_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
RANGE_RE = re.compile(r'^(\d{4})[\u2013-](\d{4})$')

ERRORS = []


def err(msg):
    ERRORS.append(msg)


def check(cond, msg):
    if not cond:
        err(msg)
    return cond


def words(s):
    return len(s.split())


def rid_of(path):
    m = re.search(r'\d+_([A-Z]+)_([A-Z]+?)(\d+)\.tex$', path or '')
    return '%s-%s' % (m.group(2), m.group(3)) if m else None


_FILES = {}


def tex_lines(rel):
    if rel not in _FILES:
        p = os.path.join(ROOT, rel)
        _FILES[rel] = open(p, encoding='utf-8').read().split('\n') if os.path.isfile(p) else None
    return _FILES[rel]


def norm(s):
    s = s.replace('\\%', '%').replace('\\$', '$').replace('~', ' ')
    s = re.sub(r'\\[a-zA-Z]+\*?', ' ', s)
    s = s.replace('{', '').replace('}', '').replace('$', '').replace('\\', ' ')
    s = s.replace('---', '-').replace('--', '-').replace('\u2014', '-').replace('\u2013', '-')
    s = s.replace('\u2019', "'")
    return re.sub(r'\s+', ' ', s).lower()


def check_evidence(where, sf, line, keywords, allowed_readings=None):
    if not check(isinstance(sf, str) and sf.startswith('notes/') and sf.endswith('.tex'),
                 '%s: bad source_file %r' % (where, sf)):
        return
    lines = tex_lines(sf)
    if not check(lines is not None, '%s: source_file missing: %s' % (where, sf)):
        return
    if not check(isinstance(line, int) and 1 <= line <= len(lines),
                 '%s: source_line %r out of range for %s' % (where, line, sf)):
        return
    if allowed_readings is not None:
        check(rid_of(sf) in allowed_readings,
              '%s: cited file %s (%s) not among readings %s' % (where, sf, rid_of(sf),
                                                                allowed_readings))
    check(isinstance(keywords, list) and len(keywords) >= 1,
          '%s: needs at least one keyword' % where)
    lo, hi = max(0, line - 1 - WINDOW), min(len(lines), line + WINDOW)
    window = norm(' '.join(lines[lo:hi]))
    for kw in keywords or []:
        check(norm(kw) in window,
              '%s: keyword %r not found near %s:%d' % (where, kw, sf, line))


def year_span(y):
    if y is None:
        return None
    if isinstance(y, int):
        return (y, y)
    m = RANGE_RE.match(y) if isinstance(y, str) else None
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return 'bad'


def names_of(n):
    out = [n['name'], n['short']] + list(n.get('aliases', []))
    return [x for x in out if x]


def contains_name(text, name):
    pat = r'(?<![A-Za-z0-9])' + re.escape(name) + r'(?![A-Za-z0-9])'
    return re.search(pat, text, re.IGNORECASE) is not None


def main(path):
    doc = json.load(open(path, encoding='utf-8'))
    blocks = json.load(open(BLOCKS_JSON, encoding='utf-8'))
    known_readings = set(blocks['readings'])
    block_file = {}
    for r in blocks['readings'].values():
        for o in r.get('objectives', []):
            for b in o.get('blocks', []):
                block_file[b['id']] = b.get('source_file')

    check(doc.get('version') == 1, 'version must be 1')
    check(doc.get('mechanic') == MECHANIC, 'mechanic must be %s' % MECHANIC)
    for k in ('lineages', 'nodes', 'changes', 'pairs'):
        check(isinstance(doc.get(k), list) and doc[k], 'top-level %r must be a non-empty list' % k)

    # ---- lineages -------------------------------------------------------------------------
    lineages = {}
    for l in doc['lineages']:
        check(SLUG_RE.match(l.get('id', '')), 'lineage id %r not a slug' % l.get('id'))
        check(l.get('id') not in lineages, 'duplicate lineage %r' % l.get('id'))
        check(isinstance(l.get('label'), str) and l['label'], 'lineage %r needs label' % l.get('id'))
        lineages[l['id']] = l

    # ---- nodes ----------------------------------------------------------------------------
    nodes = {}
    for n in doc['nodes']:
        nid = n.get('id')
        check(isinstance(nid, str) and SLUG_RE.match(nid), 'node id %r not a slug' % nid)
        check(nid not in nodes, 'duplicate node %r' % nid)
        nodes[nid] = n
    used_lineages = set()
    for nid, n in nodes.items():
        w = 'node %s' % nid
        for k in ('name', 'short', 'lineage', 'summary', 'source_file'):
            check(isinstance(n.get(k), str) and n[k].strip(), '%s: missing %s' % (w, k))
        check(len(n.get('short', '')) <= 14, '%s: short %r > 14 chars' % (w, n.get('short')))
        check(n.get('lineage') in lineages, '%s: unknown lineage %r' % (w, n.get('lineage')))
        used_lineages.add(n.get('lineage'))
        check('\n' not in n.get('summary', '') and len(n.get('summary', '')) <= 120,
              '%s: summary must be one line <= 120 chars' % w)
        rids = n.get('reading_ids') or []
        check(rids and len(set(rids)) == len(rids), '%s: reading_ids empty or duplicated' % w)
        for r in rids:
            check(RID_RE.match(r) and r in known_readings, '%s: unknown reading %r' % (w, r))
        check(rid_of(n.get('source_file')) in rids,
              '%s: primary source_file reading %s not in reading_ids' % (w, rid_of(n.get('source_file'))))
        check_evidence(w + ' source', n.get('source_file'), n.get('source_line'),
                       n.get('source_keywords'), rids)
        sb = n.get('source_block')
        if sb is not None:
            check(block_file.get(sb) == n.get('source_file'),
                  '%s: source_block %r unknown or from another file' % (w, sb))
        # year
        span = year_span(n.get('year'))
        check(span != 'bad', '%s: year %r must be int, "YYYY-YYYY" or null' % (w, n.get('year')))
        if span is None:
            check(n.get('year_source') is None and n.get('year_note'),
                  '%s: undated node needs year_note and no year_source' % w)
        elif span != 'bad':
            check(1900 <= span[0] <= span[1] <= 2030, '%s: implausible year %r' % (w, n['year']))
            ys = n.get('year_source') or {}
            check(ys, '%s: dated node needs year_source' % w)
            if ys:
                check(str(span[0]) in ys.get('keywords', []),
                      '%s: year_source keywords must include %d' % (w, span[0]))
                check_evidence(w + ' year', ys.get('source_file'), ys.get('source_line'),
                               ys.get('keywords'), rids + [rid_of(ys.get('source_file'))])
        # items
        total = 0
        ev_seen = set()
        ev_by = {(e.get('field'), e.get('index')): e for e in n.get('evidence', [])}
        check(len(ev_by) == len(n.get('evidence', [])), '%s: duplicate evidence entries' % w)
        for field in ('introduced', 'restricted', 'responding_to'):
            items = n.get(field)
            if not check(isinstance(items, list), '%s: %s must be a list' % (w, field)):
                continue
            total += len(items)
            check(len(set(items)) == len(items), '%s: duplicate %s items' % (w, field))
            for i, t in enumerate(items):
                check(isinstance(t, str) and t.strip(), '%s: empty %s[%d]' % (w, field, i))
                check(words(t) <= 12, '%s: %s[%d] has %d words (> 12): %r' % (w, field, i, words(t), t))
                e = ev_by.get((field, i))
                if check(e is not None, '%s: no evidence for %s[%d]' % (w, field, i)):
                    ev_seen.add((field, i))
                    check_evidence('%s %s[%d]' % (w, field, i), e.get('source_file'),
                                   e.get('source_line'), e.get('keywords'), rids)
        check(total >= 1, '%s: needs >= 1 of introduced/restricted/responding_to' % w)
        check(ev_seen == set(ev_by), '%s: evidence entries without matching items' % w)
        for r in n.get('related', []):
            check(r in nodes and r != nid, '%s: bad related %r' % (w, r))

    check(used_lineages <= set(lineages), 'nodes use unknown lineages')
    for l in lineages:
        check(l in used_lineages, 'lineage %r has no nodes' % l)

    # ---- parents graph --------------------------------------------------------------------
    children = {nid: [] for nid in nodes}
    for nid, n in nodes.items():
        w = 'node %s' % nid
        parents = n.get('parents')
        if not check(isinstance(parents, list), '%s: parents must be a list' % w):
            continue
        check(len(set(parents)) == len(parents), '%s: duplicate parents' % w)
        links = n.get('parent_links', [])
        check([l.get('parent') for l in links] == parents,
              '%s: parent_links must mirror parents in order' % w)
        for p in parents:
            if not check(p in nodes, '%s: unknown parent %r' % (w, p)):
                continue
            check(p != nid, '%s: self-parent' % w)
            children[p].append(nid)
        for l in links:
            check(l.get('kind') in PARENT_KINDS, '%s: bad parent kind %r' % (w, l.get('kind')))
            check(isinstance(l.get('basis'), str) and l['basis'], '%s: parent link needs basis' % w)
            if l.get('kind') in ('explicit', 'component'):
                check('source_file' in l, '%s: %s link to %s needs evidence' % (w, l.get('kind'), l.get('parent')))
            if 'source_file' in l:
                pr = nodes.get(l.get('parent'), {}).get('reading_ids', [])
                check_evidence('%s parent %s' % (w, l.get('parent')), l['source_file'],
                               l.get('source_line'), l.get('keywords'), n.get('reading_ids', []) + pr)
            # year order along the edge
            ps, cs = year_span(nodes.get(l.get('parent'), {}).get('year')), year_span(n.get('year'))
            if ps not in (None, 'bad') and cs not in (None, 'bad'):
                check(cs[0] >= ps[0], '%s: year %r earlier than parent %s (%r)' % (
                    w, n['year'], l.get('parent'), nodes[l['parent']]['year']))
    # Kahn's algorithm
    indeg = {nid: len([p for p in nodes[nid].get('parents', []) if p in nodes]) for nid in nodes}
    queue = [nid for nid, d in indeg.items() if d == 0]
    seen = 0
    while queue:
        cur = queue.pop()
        seen += 1
        for c in children[cur]:
            indeg[c] -= 1
            if indeg[c] == 0:
                queue.append(c)
    check(seen == len(nodes), 'parents graph has a cycle (%d of %d nodes sorted)' % (seen, len(nodes)))

    def component_parents(nid):
        return {l['parent'] for l in nodes[nid].get('parent_links', []) if l.get('kind') == 'component'}

    def plausible(nid, d):
        a, b = nodes[nid], nodes[d]
        if a['lineage'] == b['lineage']:
            return True
        if d in a.get('parents', []) or nid in b.get('parents', []):
            return True
        if set(a.get('parents', [])) & set(b.get('parents', [])):
            return True
        return d in a.get('related', []) or nid in b.get('related', [])

    # ---- changes --------------------------------------------------------------------------
    ids = set()
    per_node = {nid: 0 for nid in nodes}
    per_reading = {}
    for c in doc['changes']:
        cid = c.get('id')
        w = 'change %s' % cid
        check(cid not in ids, 'duplicate change id %r' % cid)
        ids.add(cid)
        rid = c.get('reading_id')
        check(isinstance(cid, str) and re.match(r'^fn-%s-\d{2}$' % re.escape(rid or ''), cid or ''),
              '%s: id must be fn-<reading>-NN' % w)
        nid = c.get('node')
        if not check(nid in nodes, '%s: unknown node %r' % (w, nid)):
            continue
        per_node[nid] += 1
        per_reading[rid] = per_reading.get(rid, 0) + 1
        n = nodes[nid]
        check(rid in n['reading_ids'], '%s: reading %s not in node %s readings' % (w, rid, nid))
        check(rid_of(c.get('source_file')) == rid,
              '%s: source_file reading %s != reading_id %s' % (w, rid_of(c.get('source_file')), rid))
        text = c.get('text', '')
        check(text.strip() and words(text) <= 20, '%s: text must be 1-20 words (%d)' % (w, words(text)))
        why = c.get('why', '')
        check(isinstance(why, str) and why.strip() and '\n' not in why, '%s: why must be one line' % w)
        dec = c.get('decoys') or []
        check(2 <= len(dec) <= 3 and len(set(dec)) == len(dec), '%s: needs 2-3 distinct decoys' % w)
        check(nid not in dec, '%s: decoys include the correct node' % w)
        for d in dec:
            if not check(d in nodes, '%s: unknown decoy %r' % (w, d)):
                continue
            check(d not in component_parents(nid),
                  '%s: decoy %s introduced %s (would also be correct)' % (w, d, nid))
            check(plausible(nid, d), '%s: decoy %s is not a neighbour/sibling/related of %s' % (w, d, nid))
        for target in [nid] + [d for d in dec if d in nodes]:
            for nm in names_of(nodes[target]):
                check(not contains_name(text, nm),
                      '%s: text names %s (%r) - giveaway' % (w, target, nm))
        check_evidence(w, c.get('source_file'), c.get('source_line'), c.get('keywords'),
                       n['reading_ids'])
        sb = c.get('source_block')
        if sb is not None:
            check(block_file.get(sb) == c.get('source_file'),
                  '%s: source_block %r unknown or from another file' % (w, sb))
    for nid, k in per_node.items():
        check(k >= 1, 'node %s has no changes' % nid)

    # ---- pairs ----------------------------------------------------------------------------
    pids, seen_pairs = set(), set()
    for p in doc['pairs']:
        pid = p.get('id')
        w = 'pair %s' % pid
        check(pid not in pids, 'duplicate pair id %r' % pid)
        pids.add(pid)
        a, b, rid = p.get('a'), p.get('b'), p.get('reading_id')
        check(re.match(r'^fnp-%s-\d{2}$' % re.escape(rid or ''), pid or ''),
              '%s: id must be fnp-<reading>-NN' % w)
        if not (check(a in nodes and b in nodes and a != b, '%s: a/b must be two known nodes' % w)):
            continue
        key = frozenset((a, b))
        check(key not in seen_pairs, '%s: duplicate pair %s/%s' % (w, a, b))
        seen_pairs.add(key)
        allowed = set(nodes[a]['reading_ids']) | set(nodes[b]['reading_ids'])
        check(rid in allowed, '%s: reading %s belongs to neither node' % (w, rid))
        diffs = p.get('differences') or []
        check(len(diffs) >= 2, '%s: needs >= 2 differences' % w)
        for i, t in enumerate(diffs):
            check(isinstance(t, str) and t.strip() and words(t) <= 15,
                  '%s: difference[%d] must be 1-15 words (%d)' % (w, i, words(t or '')))
        srcs = p.get('difference_sources') or []
        check([s.get('index') for s in srcs] == list(range(len(diffs))),
              '%s: one difference_source per difference, in order' % w)
        for s in srcs:
            check_evidence('%s diff[%s]' % (w, s.get('index')), s.get('source_file'),
                           s.get('source_line'), s.get('keywords'), sorted(allowed))

    # ---- report ---------------------------------------------------------------------------
    readings = sorted({r for n in nodes.values() for r in n['reading_ids']})
    print('%s: %d lineages, %d nodes (%d undated), %d changes, %d pairs' % (
        os.path.relpath(path, ROOT), len(lineages), len(nodes),
        sum(1 for n in nodes.values() if n.get('year') is None), len(doc['changes']),
        len(doc['pairs'])))
    print('readings on nodes (%d): %s' % (len(readings), ', '.join(readings)))
    print('readings with changes (%d): %s' % (len(per_reading), ', '.join(
        '%s:%d' % kv for kv in sorted(per_reading.items()))))
    thin = sorted('%s:%d' % (k, v) for k, v in per_node.items() if v < 3)
    print('nodes with < 3 changes (notes too thin for more): %s' % ', '.join(thin))
    if ERRORS:
        print('\n%d ERROR(S):' % len(ERRORS))
        for e in ERRORS:
            print('  - ' + e)
        return 1
    print('OK')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON))
