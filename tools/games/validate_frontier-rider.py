#!/usr/bin/env python3
"""Validator (and shared frontier engine) for the Frontier Rider mechanic.

    python3 tools/games/validate_frontier-rider.py [path/to/frontier-rider.json]

Stdlib only (math, json, os, re, sys). The engine is the unconstrained Markowitz maths stated in
the JSON's top-level "conventions" string (short sales and borrowing allowed):

    inputs      mu_i, sigma_i, rf in percent per year  ->  m_i = mu_i/100, s_i = sigma_i/100, r = rf/100
    covariance  S_ij = corr_ij * s_i * s_j
    min-variance     w  = S^-1 1 / (1' S^-1 1)
    tangency         w  = S^-1 (m - r 1) / (1' S^-1 (m - r 1))
    portfolio        E = w'm,  sd = sqrt(w' S w)
    complete         y* = (E_T - r) / (A sd_T^2);  E_C = r + y*(E_T - r),  sd_C = y* sd_T
    plotted point    (sigma, mu) = (100 sd, 100 E) in percent

What is asserted, for every item:

  * structure: id pattern and uniqueness, reading_id, source_file exists and matches the reading,
    source_line in range, source_block exists in game-blocks.json under the same reading,
    2-4 assets, square symmetric corr with unit diagonal and |rho| < 1, point / slider enums,
    A present (> 0) exactly when point == "complete", slider from != to, step divides the range;
  * covariance positive definite (Cholesky) at the base inputs AND at every slider step;
  * the point is well defined at every slider step: 1'S^-1 1 > 0; for tangency / complete the
    global-minimum-variance mean exceeds rf (so the tangency sits on the efficient upper branch
    and 1'S^-1(m - r1) > 0); for complete, y* > 0;
  * the movement: the point is recomputed at slider.from and slider.to; the sign of d(sigma) and
    d(mu) (|d| < 1e-6 counts as zero) gives a move code; the stored answer.move equals it, the
    stored from/to coordinates match to 1e-3, and the path is monotone (every step's signed
    change agrees with the overall sign, so the animation never doubles back);
  * options: 3-4, exactly one correct, labels distinct, every option's "move" in the
    vocabulary, the correct option's move == computed move, every distractor's move != computed
    move (special "jump" distractors are checked to be far from the named destination);
  * optional path claims on the correct option: "along-cal" means the CAL slope (Sharpe of the
    point vs rf) is unchanged within 1e-9 and the point stays on it; "cal_slope" (steeper /
    flatter / same) is recomputed from the tangency Sharpe ratio;
  * notes_checks: every numeric check recomputes within its tolerance, and its literal string
    appears on the cited line of source_file; every citation line exists and every literal
    in citations appears on its line.
"""
import json
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MECHANIC = 'frontier-rider'
PREFIX = 'fr'
DEFAULT_JSON = os.path.join(ROOT, 'content', 'games', 'mechanics', MECHANIC + '.json')
BLOCKS_JSON = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')

ZERO = 1e-6
POINTS = ('tangency', 'complete', 'min-variance')
MOVES = ('up-right', 'up-left', 'down-right', 'down-left', 'up', 'down', 'right', 'left', 'stays')
JUMPS = ('to-min-variance', 'to-tangency', 'to-rf')
SLIDER_RE = re.compile(r'^(rf|A|mu\[(\d)\]|sigma\[(\d)\]|corr\[(\d)\]\[(\d)\])$')
READING_RE = re.compile(r'^(MR|CR|ORR|LTR|IM|CI)-\d+$')

# --------------------------------------------------------------------------- linear algebra

def mat_inv(M):
    """Gauss-Jordan inverse with partial pivoting."""
    n = len(M)
    A = [list(map(float, row)) + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(M)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(A[r][c]))
        if abs(A[p][c]) < 1e-18:
            raise ValueError('singular matrix')
        A[c], A[p] = A[p], A[c]
        pv = A[c][c]
        A[c] = [x / pv for x in A[c]]
        for r in range(n):
            if r != c and A[r][c] != 0.0:
                f = A[r][c]
                A[r] = [a - f * b for a, b in zip(A[r], A[c])]
    return [row[n:] for row in A]


def is_pos_def(M):
    """Cholesky test."""
    n = len(M)
    L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s = M[i][j] - sum(L[i][k] * L[j][k] for k in range(j))
            if i == j:
                if s <= 1e-14:
                    return False
                L[i][i] = math.sqrt(s)
            else:
                L[i][j] = s / L[j][j]
    return True


def matvec(M, v):
    return [sum(a * b for a, b in zip(row, v)) for row in M]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))

# --------------------------------------------------------------------------- engine

def cov_matrix(sigma_pct, corr):
    s = [x / 100.0 for x in sigma_pct]
    n = len(s)
    return [[corr[i][j] * s[i] * s[j] for j in range(n)] for i in range(n)]


def solve(inputs, point):
    """Return dict(w, y, mu, sigma, sharpe_T, mu_mv) for the item's point (mu, sigma in percent)."""
    mu = inputs['mu']
    n = len(mu)
    m = [x / 100.0 for x in mu]
    r = inputs['rf'] / 100.0
    S = cov_matrix(inputs['sigma'], inputs['corr'])
    Si = mat_inv(S)
    ones = [1.0] * n
    Si1 = matvec(Si, ones)
    C = sum(Si1)
    if C <= 0:
        raise ValueError("1'S^-1 1 <= 0")
    w_mv = [x / C for x in Si1]
    mu_mv = dot(w_mv, m)

    def stats(w):
        E = dot(w, m)
        return E, math.sqrt(dot(w, matvec(S, w)))

    out = {'mu_mv': mu_mv * 100}
    if point == 'min-variance':
        E, sd = stats(w_mv)
        out.update(w=w_mv, y=1.0, mu=E * 100, sigma=sd * 100,
                   sharpe_T=None, sharpe=(E - r) / sd)
        return out
    if mu_mv <= r:
        raise ValueError('rf >= global-minimum-variance mean: no efficient tangency portfolio')
    ex = [x - r for x in m]
    v = matvec(Si, ex)
    t = sum(v)
    if t <= 0:
        raise ValueError("1'S^-1(m - r1) <= 0")
    w = [x / t for x in v]
    E, sd = stats(w)
    sharpe_T = (E - r) / sd
    if point == 'tangency':
        out.update(w=w, y=1.0, mu=E * 100, sigma=sd * 100, sharpe_T=sharpe_T, sharpe=sharpe_T)
        return out
    A = inputs['A']
    y = (E - r) / (A * sd * sd)
    if y <= 0:
        raise ValueError('y* <= 0')
    out.update(w=w, y=y, mu=(r + y * (E - r)) * 100, sigma=y * sd * 100,
               sharpe_T=sharpe_T, sharpe=sharpe_T)
    return out


def base_inputs(item):
    return {'mu': [a['mu'] for a in item['assets']],
            'sigma': [a['sigma'] for a in item['assets']],
            'corr': [list(row) for row in item['corr']],
            'rf': item['rf'], 'A': item.get('A')}


def apply_slider(inputs, param, value):
    x = {'mu': list(inputs['mu']), 'sigma': list(inputs['sigma']),
         'corr': [list(r) for r in inputs['corr']], 'rf': inputs['rf'], 'A': inputs['A']}
    m = SLIDER_RE.match(param)
    if param == 'rf':
        x['rf'] = value
    elif param == 'A':
        x['A'] = value
    elif m.group(2) is not None:
        x['mu'][int(m.group(2))] = value
    elif m.group(3) is not None:
        x['sigma'][int(m.group(3))] = value
    else:
        i, j = int(m.group(4)), int(m.group(5))
        x['corr'][i][j] = x['corr'][j][i] = value
    return x


def slider_values(sl):
    n = int(round((sl['to'] - sl['from']) / sl['step']))
    return [sl['from'] + k * (sl['to'] - sl['from']) / n for k in range(n + 1)], n


def sgn(d):
    return 0 if abs(d) < ZERO else (1 if d > 0 else -1)


def move_code(dsig, dmu):
    a, b = sgn(dsig), sgn(dmu)
    table = {(1, 1): 'up-right', (-1, 1): 'up-left', (1, -1): 'down-right', (-1, -1): 'down-left',
             (0, 1): 'up', (0, -1): 'down', (1, 0): 'right', (-1, 0): 'left', (0, 0): 'stays'}
    return table[(a, b)]


def run_item(item):
    """Recompute the point at slider.from and slider.to. Returns (p_from, p_to, move)."""
    base = base_inputs(item)
    sl = item['slider']
    p0 = solve(apply_slider(base, sl['param'], sl['from']), item['point'])
    p1 = solve(apply_slider(base, sl['param'], sl['to']), item['point'])
    return p0, p1, move_code(p1['sigma'] - p0['sigma'], p1['mu'] - p0['mu'])


def quantity(p, name):
    """Named quantity of a solved point; names: mu, sigma, y, sharpe, sharpe_T, mu_mv,
    w[i] (risky-portfolio weight), yw[i] (complete-portfolio weight = y * w[i])."""
    m = re.match(r'^(y?w)\[(\d)\]$', name)
    if m:
        w = p['w'][int(m.group(2))]
        return w * p['y'] if m.group(1) == 'yw' else w
    return p[name]

# --------------------------------------------------------------------------- validation


def validate(path=DEFAULT_JSON):
    errors = []

    def err(where, msg):
        errors.append('%s: %s' % (where, msg))

    data = json.load(open(path))
    blocks = json.load(open(BLOCKS_JSON))
    readings = blocks['readings']
    block_ids = {}
    for rid, rd in readings.items():
        for o in rd['objectives']:
            for b in o['blocks']:
                block_ids[b['id']] = (rid, b['source_file'])

    if data.get('version') != 1:
        err('top', 'version must be 1')
    if data.get('mechanic') != MECHANIC:
        err('top', 'mechanic must be %r' % MECHANIC)
    conv = data.get('conventions', '')
    for needle in ('S^-1', 'rf', 'A', 'y*', 'short', 'percent', 'min-variance', 'tangency', 'complete'):
        if needle not in conv:
            err('top', 'conventions string must mention %r' % needle)
    items = data.get('items')
    if not isinstance(items, list) or not items:
        err('top', 'items must be a non-empty list')
        return errors, []

    line_cache = {}

    def lines_of(f):
        if f not in line_cache:
            fp = os.path.join(ROOT, f)
            line_cache[f] = open(fp, encoding='utf-8').read().split('\n') if os.path.exists(fp) else None
        return line_cache[f]

    seen = set()
    report = []
    for k, it in enumerate(items):
        where = it.get('id', 'item[%d]' % k)
        # ---------------- structure
        for f in ('id', 'reading_id', 'source_block', 'source_file', 'source_line', 'title', 'assets',
                  'corr', 'rf', 'point', 'slider', 'question', 'options', 'explanation', 'answer',
                  'citations', 'inputs_source'):
            if f not in it:
                err(where, 'missing field %s' % f)
        if any(f not in it for f in ('id', 'reading_id', 'assets', 'corr', 'rf', 'point', 'slider', 'options')):
            continue
        rid = it['reading_id']
        if not READING_RE.match(rid) or rid not in readings:
            err(where, 'unknown reading_id %s' % rid)
            continue
        m = re.match(r'^%s-(.+)-(\d\d)$' % PREFIX, it['id'])
        if not m or m.group(1) != rid:
            err(where, 'id must be %s-<reading>-<nn>' % PREFIX)
        if it['id'] in seen:
            err(where, 'duplicate id')
        seen.add(it['id'])
        sf = it['source_file']
        if sf != readings[rid]['source_file']:
            err(where, 'source_file %s is not the file of %s' % (sf, rid))
        src = lines_of(sf)
        if src is None:
            err(where, 'source_file missing')
            continue
        if not (1 <= it['source_line'] <= len(src)):
            err(where, 'source_line out of range')
        sb = it['source_block']
        if sb is not None:
            if sb not in block_ids:
                err(where, 'source_block %s not in game-blocks.json' % sb)
            elif block_ids[sb][0] != rid:
                err(where, 'source_block %s belongs to %s' % (sb, block_ids[sb][0]))
        for c in it['citations']:
            ln = c.get('line')
            if not isinstance(ln, int) or not (1 <= ln <= len(src)):
                err(where, 'citation line %r out of range' % ln)
                continue
            if c.get('literal') and c['literal'] not in src[ln - 1]:
                err(where, 'citation literal %r not on line %d' % (c['literal'], ln))
        if not it['citations']:
            err(where, 'needs at least one citation')

        assets = it['assets']
        n = len(assets)
        if not (2 <= n <= 4):
            err(where, 'needs 2-4 assets')
        for a in assets:
            if set(a) - {'name', 'mu', 'sigma'} or not {'name', 'mu', 'sigma'} <= set(a):
                err(where, 'asset fields must be name, mu, sigma')
            elif not (a['sigma'] > 0 and -50 < a['mu'] < 100 and a['sigma'] < 100):
                err(where, 'asset %s has implausible mu/sigma (percent units)' % a['name'])
        corr = it['corr']
        if len(corr) != n or any(len(r) != n for r in corr):
            err(where, 'corr must be %dx%d' % (n, n))
            continue
        for i in range(n):
            if corr[i][i] != 1:
                err(where, 'corr diagonal must be 1')
            for j in range(n):
                if corr[i][j] != corr[j][i]:
                    err(where, 'corr not symmetric')
                if i != j and not (-1 < corr[i][j] < 1):
                    err(where, 'corr off-diagonal must be in (-1, 1)')
        if it['point'] not in POINTS:
            err(where, 'point must be one of %s' % (POINTS,))
            continue
        if it['point'] == 'complete':
            if not (isinstance(it.get('A'), (int, float)) and it['A'] > 0):
                err(where, 'complete point needs A > 0')
        elif it.get('A') is not None:
            err(where, 'A only allowed when point == complete')
        if not (-5 <= it['rf'] < 20):
            err(where, 'rf implausible')

        sl = it['slider']
        for f in ('param', 'label', 'from', 'to', 'step'):
            if f not in sl:
                err(where, 'slider missing %s' % f)
        sm = SLIDER_RE.match(str(sl.get('param', '')))
        if not sm:
            err(where, 'bad slider param %r' % sl.get('param'))
            continue
        for g in (2, 3, 4, 5):
            if sm.group(g) is not None and int(sm.group(g)) >= n:
                err(where, 'slider index out of range')
        if sm.group(4) is not None and sm.group(4) == sm.group(5):
            err(where, 'corr slider must be off-diagonal')
        if sl['param'] == 'A' and it['point'] != 'complete':
            err(where, 'A slider only meaningful for complete point')
        if sl['from'] == sl['to'] or sl['step'] <= 0:
            err(where, 'slider from/to/step invalid')
            continue
        nsteps = (sl['to'] - sl['from']) / sl['step']
        if abs(abs(nsteps) - round(abs(nsteps))) > 1e-6 or round(abs(nsteps)) < 2:
            err(where, 'step must divide the slider range into >= 2 steps (got %.6f)' % nsteps)
            continue
        # base value of the slidered parameter must equal slider.from
        base = base_inputs(it)
        p = sl['param']
        if p == 'rf':
            bv = base['rf']
        elif p == 'A':
            bv = base['A']
        elif sm.group(2) is not None:
            bv = base['mu'][int(sm.group(2))]
        elif sm.group(3) is not None:
            bv = base['sigma'][int(sm.group(3))]
        else:
            bv = base['corr'][int(sm.group(4))][int(sm.group(5))]
        if bv is None or abs(bv - sl['from']) > 1e-12:
            err(where, 'item base value of %s (%r) must equal slider.from (%r)' % (p, bv, sl['from']))

        # ---------------- positive definiteness + well-defined point along the whole slider
        n_int = int(round(abs(nsteps)))
        vals = [sl['from'] + kk * (sl['to'] - sl['from']) / n_int for kk in range(n_int + 1)]
        path = []
        ok = True
        for v in vals:
            x = apply_slider(base, p, v)
            if not is_pos_def(cov_matrix(x['sigma'], x['corr'])):
                err(where, 'covariance not positive definite at %s = %r' % (p, v))
                ok = False
                break
            try:
                path.append(solve(x, it['point']))
            except ValueError as e:
                err(where, 'point undefined at %s = %r: %s' % (p, v, e))
                ok = False
                break
        if not ok:
            continue
        p0, p1 = path[0], path[-1]
        dsig, dmu = p1['sigma'] - p0['sigma'], p1['mu'] - p0['mu']
        move = move_code(dsig, dmu)
        # monotone path
        s_sig, s_mu = sgn(dsig), sgn(dmu)
        for a, b in zip(path, path[1:]):
            for d, s, nm in ((b['sigma'] - a['sigma'], s_sig, 'sigma'), (b['mu'] - a['mu'], s_mu, 'mu')):
                if s == 0 and abs(d) > ZERO:
                    err(where, '%s moves mid-slider although net change is zero' % nm)
                if s != 0 and d * s < -1e-12:
                    err(where, '%s path not monotone (doubles back)' % nm)

        ans = it['answer']
        if ans.get('move') != move:
            err(where, 'answer.move %r but computed %r (dsigma=%.3g, dmu=%.3g)' % (ans.get('move'), move, dsig, dmu))
        for tag, pp in (('from', p0), ('to', p1)):
            st = ans.get(tag, {})
            for q in ('sigma', 'mu'):
                if q not in st or abs(st[q] - pp[q]) > 1e-3:
                    err(where, 'answer.%s.%s %r != computed %.4f' % (tag, q, st.get(q), pp[q]))

        # ---------------- options
        opts = it['options']
        if not (3 <= len(opts) <= 4):
            err(where, 'needs 3-4 options')
        if len({o.get('label') for o in opts}) != len(opts):
            err(where, 'option labels must be distinct')
        if len({o.get('move') for o in opts}) != len(opts):
            err(where, 'option moves must be distinct')
        corrects = [o for o in opts if o.get('correct') is True]
        if len(corrects) != 1:
            err(where, 'exactly one option must be correct (got %d)' % len(corrects))
        for o in opts:
            for f in ('label', 'correct', 'why', 'move'):
                if f not in o:
                    err(where, 'option missing %s' % f)
            mv = o.get('move')
            if mv not in MOVES and mv not in JUMPS:
                err(where, 'option move %r not in vocabulary' % mv)
                continue
            if o.get('correct') is True:
                if mv != move:
                    err(where, 'correct option move %r != computed %r' % (mv, move))
            else:
                if mv == move:
                    err(where, 'distractor %r has the computed move %r' % (o.get('label'), move))
                if mv in JUMPS:
                    x1 = apply_slider(base, p, sl['to'])
                    if mv == 'to-min-variance':
                        dest = solve(x1, 'min-variance')
                    elif mv == 'to-tangency':
                        dest = solve(x1, 'tangency')
                    else:
                        dest = {'sigma': 0.0, 'mu': x1['rf']}
                    if math.hypot(dest['sigma'] - p1['sigma'], dest['mu'] - p1['mu']) < 0.05:
                        err(where, 'jump distractor %r actually lands on the computed point' % mv)
        # path claims on the correct option
        for o in corrects:
            if o.get('path') == 'along-cal':
                if it['point'] != 'complete':
                    err(where, 'along-cal only for complete points')
                elif abs(p0['sharpe'] - p1['sharpe']) > 1e-9:
                    err(where, 'along-cal claimed but CAL slope changes')
                else:
                    r0, r1 = apply_slider(base, p, sl['from'])['rf'], apply_slider(base, p, sl['to'])['rf']
                    if abs(r0 - r1) > 1e-12:
                        err(where, 'along-cal claimed but rf moves')
        cs = it.get('cal_slope')
        if cs is not None:
            if it['point'] == 'min-variance':
                err(where, 'cal_slope not defined for min-variance point')
            else:
                d = p1['sharpe_T'] - p0['sharpe_T']
                want = 'same' if abs(d) < 1e-9 else ('steeper' if d > 0 else 'flatter')
                if cs != want:
                    err(where, 'cal_slope %r but computed %r (dSharpe=%.3g)' % (cs, want, d))

        # ---------------- notes checks
        for c in it.get('notes_checks', []):
            pt = p0 if c.get('at', 'from') == 'from' else p1
            try:
                got = quantity(pt, c['quantity']) * c.get('multiplier', 1.0)
            except (KeyError, IndexError, TypeError):
                err(where, 'notes_check quantity %r unknown' % c.get('quantity'))
                continue
            if abs(got - c['expected']) > c['tol']:
                err(where, 'notes_check %s at %s: computed %.5f, notes %.5f (tol %g)'
                    % (c['quantity'], c.get('at', 'from'), got, c['expected'], c['tol']))
            ln = c.get('line')
            if not isinstance(ln, int) or not (1 <= ln <= len(src)):
                err(where, 'notes_check line out of range')
            elif c.get('literal') not in src[ln - 1]:
                err(where, 'notes_check literal %r not on line %d' % (c.get('literal'), ln))

        report.append((it['id'], it['point'], p, move, p0, p1))
    return errors, report


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON
    errors, report = validate(path)
    for rid, point, param, move, p0, p1 in report:
        print('%-14s %-12s %-10s %-10s (%.3f, %.3f) -> (%.3f, %.3f)'
              % (rid, point, param, move, p0['sigma'], p0['mu'], p1['sigma'], p1['mu']))
    if errors:
        print('\n%d error(s):' % len(errors))
        for e in errors:
            print('  ' + e)
        sys.exit(1)
    print('\nOK: %d items valid' % len(report))


if __name__ == '__main__':
    main()
