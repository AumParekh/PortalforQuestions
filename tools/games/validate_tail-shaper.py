#!/usr/bin/env python3
"""Validator (and shared density engine) for the Tail Shaper mechanic.

    python3 tools/games/validate_tail-shaper.py [path/to/tail-shaper.json]

Stdlib only (math, json, re, os, sys). The game uses ONE parametric family, a split
(two-piece) Student-t with a common scale:

    z      = (x - mu) / s
    k_nu(z)= (1 + z^2/nu)^(-(nu+1)/2)                      (kernel, k_nu(0) = 1)
    C_nu   = Gamma((nu+1)/2) / (sqrt(nu*pi) * Gamma(nu/2))  (Student-t constant)
    A      = 2*C_L*C_R / (s*(C_L + C_R))
    f(x)   = A*k_{nuL}(z)  for x <  mu
             A*k_{nuR}(z)  for x >= mu

What is asserted:

  * top level: version 1, mechanic id, family name / params / ranges / steps exactly as specified,
    family_spec present, the classification thresholds equal the ones used here, and every
    reference value published for the builder (C_nu, peak, mean, sd) recomputes;
  * structure per item: required fields, id pattern tsh-<reading>-<nn> (unique, reading matches),
    source_file exists and its file name maps to reading_id, source_line inside the file,
    source_block exists in game-blocks.json under that reading and file and starts at or before
    source_line, every citation's quote literally appears on its cited line;
  * numerics: the density integrates to 1 +/- 1e-3 by composite Simpson over a wide log-spaced range
    (|z| up to 1e6) at the target, the start and every corner of the tolerance box; it is
    continuous at mu; the closed-form mean and sd agree with Simpson moments; left mass matches
    C_R/(C_L+C_R);
  * sliders: target and start inside ranges and on the slider grid; the tolerance box contains at
    least one grid point per parameter; params not in "matters" accept the whole range; params in
    "matters" have a tolerance narrower than half the range; the start is outside the box;
  * smile: label in the enum, >= 7 points, moneyness strictly increasing through 1.0 and spanning
    at least [0.8, 1.2], vols positive; 'volatility skew' strictly decreasing with >= 2 vol pts
    drop; 'volatility smile' U-shaped with the interior minimum at moneyness in [0.95, 1.05] and
    both ends >= 0.5 vol pts above it; 'flat' within 0.5 vol pts; the stored points equal the
    stored formula, and when a formula_source is given the formula literally appears on that line;
    smile_note says the curve is illustrative;
  * consistency (distribution <-> curve): at the target and every box corner, the tail masses
    beyond 2.5 s on each side are compared with the normal's; 'volatility skew' needs a heavy left
    tail, a near-lognormal right tail and nuR - nuL >= 20; 'volatility smile' needs both tails
    fatter than lognormal and roughly symmetric; 'flat' needs both tails near lognormal;
  * contrasts: 'thinner_tails_than' (box nu strictly above the other item's box, shallower smile)
    and 'curve_shifts_down_narrower' (points below before_points everywhere, s box below start).
"""
import json
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MECHANIC = 'tail-shaper'
PREFIX = 'tsh'
DEFAULT_JSON = os.path.join(ROOT, 'content', 'games', 'mechanics', MECHANIC + '.json')
BLOCKS_JSON = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')

PARAMS = {  # name: (min, max, step)
    'nuL': (2.5, 60.0, 0.5),
    'nuR': (2.5, 60.0, 0.5),
    'mu': (-2.0, 2.0, 0.05),
    's': (0.5, 3.0, 0.05),
}
PARAM_ORDER = ['nuL', 'nuR', 'mu', 's']
LABELS = ('volatility skew', 'volatility smile', 'flat')

# Tail classification: R = P(side beyond 2.5 s) / P(normal beyond 2.5 sd)
TAIL_Z = 2.5
HEAVY_R = 3.0        # heavy tail (skew's left tail)
FATTER_R = 1.8       # fatter than lognormal (smile needs both sides)
LIGHT_R = 1.6        # at or near lognormal
SYM_MAX = 2.5        # smile: max(R_L, R_R) / min(R_L, R_R)
SKEW_RATIO = 2.0     # skew: R_L / R_R
SKEW_NU_MARGIN = 20.0

REQUIRED_ITEM = ['id', 'reading_id', 'source_block', 'source_file', 'source_line', 'title',
                 'description', 'target', 'tolerance', 'matters', 'start', 'smile',
                 'explanation', 'citations']

# ----------------------------------------------------------------------------- density engine
def c_nu(nu):
    return math.exp(math.lgamma((nu + 1) / 2.0) - math.lgamma(nu / 2.0)) / math.sqrt(nu * math.pi)


def kernel(z, nu):
    return (1.0 + z * z / nu) ** (-(nu + 1) / 2.0)


def peak(p):
    cl, cr = c_nu(p['nuL']), c_nu(p['nuR'])
    return 2.0 * cl * cr / (p['s'] * (cl + cr))


def density(x, p):
    z = (x - p['mu']) / p['s']
    return peak(p) * kernel(z, p['nuL'] if x < p['mu'] else p['nuR'])


def left_mass(p):
    cl, cr = c_nu(p['nuL']), c_nu(p['nuR'])
    return cr / (cl + cr)


def mean_closed(p):
    cl, cr = c_nu(p['nuL']), c_nu(p['nuR'])
    return p['mu'] + p['s'] * 2 * cl * cr / (cl + cr) * (
        p['nuR'] / (p['nuR'] - 1) - p['nuL'] / (p['nuL'] - 1))


def sd_closed(p):
    cl, cr = c_nu(p['nuL']), c_nu(p['nuR'])
    wl, wr = cr / (cl + cr), cl / (cl + cr)
    ez = 2 * cl * cr / (cl + cr) * (p['nuR'] / (p['nuR'] - 1) - p['nuL'] / (p['nuL'] - 1))
    ez2 = wl * p['nuL'] / (p['nuL'] - 2) + wr * p['nuR'] / (p['nuR'] - 2)
    return p['s'] * math.sqrt(ez2 - ez * ez)


def simpson(f, a, b, n=400):
    if n % 2:
        n += 1
    h = (b - a) / n
    tot = f(a) + f(b)
    for i in range(1, n):
        tot += (4 if i % 2 else 2) * f(a + i * h)
    return tot * h / 3.0


Z_EDGES = [0.0, 0.5, 1.0, 2.0, 2.5, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0, 512.0, 2048.0,
           1e4, 1e5, 1e6]


def integrate_side(g, side, z_from=0.0):
    """Integral over x of g(x) for x on one side of mu, from |z| = z_from out to |z| = 1e6."""
    edges = [z for z in Z_EDGES if z > z_from]
    edges = [z_from] + edges
    total = 0.0
    for a, b in zip(edges[:-1], edges[1:]):
        total += simpson(lambda z: g(z * side), a, b)
    return total


def moments(p):
    """(mass, mean, sd) of f by Simpson over z in [-1e6, 1e6] (x = mu + s z)."""
    mu, s = p['mu'], p['s']
    m0 = m1 = m2 = 0.0
    for side in (-1, 1):
        m0 += s * integrate_side(lambda z: density(mu + s * z, p), side)
        m1 += s * integrate_side(lambda z: (mu + s * z) * density(mu + s * z, p), side)
        m2 += s * integrate_side(lambda z: (s * z) ** 2 * density(mu + s * z, p), side)
    mean = m1 / m0
    var = m2 / m0 - (mean - mu) ** 2
    return m0, mean, math.sqrt(max(var, 0.0))


def tail_ratios(p):
    """Side masses beyond 2.5 s over the normal's one-sided mass beyond 2.5 sd."""
    mu, s = p['mu'], p['s']
    ref = 0.5 * math.erfc(TAIL_Z / math.sqrt(2.0))
    left = s * integrate_side(lambda z: density(mu + s * z, p), -1, TAIL_Z)
    right = s * integrate_side(lambda z: density(mu + s * z, p), 1, TAIL_Z)
    return left / ref, right / ref


def classify(p):
    rl, rr = tail_ratios(p)
    if (rl >= HEAVY_R and rr <= LIGHT_R and rl / rr >= SKEW_RATIO
            and p['nuR'] - p['nuL'] >= SKEW_NU_MARGIN):
        return 'volatility skew', rl, rr
    if rl >= FATTER_R and rr >= FATTER_R and max(rl, rr) / min(rl, rr) <= SYM_MAX:
        return 'volatility smile', rl, rr
    if rl <= LIGHT_R and rr <= LIGHT_R:
        return 'flat', rl, rr
    return 'none', rl, rr


# ----------------------------------------------------------------------------- helpers
ERRORS = []


def check(cond, msg):
    if not cond:
        ERRORS.append(msg)
    return cond


def on_grid(v, lo, step):
    k = (v - lo) / step
    return abs(k - round(k)) < 1e-6


def box(item, name):
    lo, hi, _ = PARAMS[name]
    t, tol = item['target'][name], item['tolerance'][name]
    return max(lo, t - tol), min(hi, t + tol)


def corners(item):
    out = []
    for m in range(16):
        p = {}
        for i, name in enumerate(PARAM_ORDER):
            a, b = box(item, name)
            p[name] = b if (m >> i) & 1 else a
        out.append(p)
    return out


def reading_from_file(path):
    """30_MR_MR11.tex -> MR-11, 01_LR_LTR1.tex -> LTR-1, 07_OR_ORR2.tex -> ORR-2, IM_IM5 -> IM-5."""
    m = re.match(r'^\d+_[A-Z]+_([A-Z]+)(\d+)\.tex$', os.path.basename(path))
    return (m.group(1) + '-' + m.group(2)) if m else None


_LINES = {}


def tex_lines(rel):
    if rel not in _LINES:
        with open(os.path.join(ROOT, rel), encoding='utf-8') as fh:
            _LINES[rel] = fh.read().split('\n')
    return _LINES[rel]


def norm_ws(t):
    return re.sub(r'\s+', ' ', t).strip()


def eval_formula(expr, x):
    py = expr.replace('^', '**')
    return eval(py, {'__builtins__': {}}, {'exp': math.exp, 'x': x})


# ----------------------------------------------------------------------------- validation
def validate(path):
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)
    with open(BLOCKS_JSON, encoding='utf-8') as fh:
        blocks_doc = json.load(fh)
    block_index = {}
    for rid, rd in blocks_doc['readings'].items():
        for obj in rd['objectives']:
            for b in obj['blocks']:
                block_index[b['id']] = (rid, b['source_file'], int(b['source_line']))
    starts_by_file = {}
    for _, bfile, bline in block_index.values():
        starts_by_file.setdefault(bfile, set()).add(bline)

    # ---- top level
    check(data.get('version') == 1, 'version must be 1')
    check(data.get('mechanic') == MECHANIC, 'mechanic must be %r' % MECHANIC)
    check(isinstance(data.get('family_spec'), str) and 'C_nu' in data['family_spec'],
          'family_spec must state the normalisation (C_nu)')
    fam = data.get('family', {})
    check(fam.get('name') == 'split Student-t (two-piece, common scale)', 'family.name')
    check(isinstance(fam.get('spec'), dict), 'family.spec must be an object of formulas')
    fparams = fam.get('params', [])
    check([q.get('name') for q in fparams] == PARAM_ORDER, 'family.params order/names')
    for q in fparams:
        lo, hi, st = PARAMS.get(q.get('name'), (None, None, None))
        check((q.get('min'), q.get('max'), q.get('step')) == (lo, hi, st),
              'family param %s range/step' % q.get('name'))
        for key in ('label', 'low_label', 'high_label'):
            check(isinstance(q.get(key), str) and q[key], 'family param %s %s' % (q.get('name'), key))
    cls = data.get('classification', {})
    check(cls.get('tail_z') == TAIL_Z and cls.get('heavy_ratio') == HEAVY_R
          and cls.get('fatter_ratio') == FATTER_R and cls.get('light_ratio') == LIGHT_R
          and cls.get('smile_symmetry_max') == SYM_MAX and cls.get('skew_ratio_min') == SKEW_RATIO
          and cls.get('skew_nu_margin') == SKEW_NU_MARGIN,
          'classification thresholds must match the validator')
    for ref in fam.get('reference_values', {}).get('C_nu', []):
        check(abs(c_nu(ref['nu']) - ref['C_nu']) < 1e-9, 'reference C_nu at nu=%s' % ref['nu'])

    # ---- items
    items = data.get('items', [])
    check(len(items) >= 6, 'expected at least 6 items')
    ids = set()
    by_id = {}
    for it in items:
        iid = it.get('id', '?')
        missing = [k for k in REQUIRED_ITEM if k not in it]
        if not check(not missing, '%s missing %s' % (iid, missing)):
            continue
        by_id[iid] = it
        rid = it['reading_id']
        check(iid not in ids, 'duplicate id %s' % iid)
        ids.add(iid)
        check(re.fullmatch(r'%s-%s-\d{2}' % (PREFIX, re.escape(rid)), iid) is not None,
              '%s id pattern' % iid)
        # sources
        sf = it['source_file']
        check(os.path.isfile(os.path.join(ROOT, sf)), '%s source_file missing' % iid)
        check(reading_from_file(sf) == rid, '%s source_file %s does not map to %s' % (iid, sf, rid))
        n_lines = len(tex_lines(sf))
        check(isinstance(it['source_line'], int) and 1 <= it['source_line'] <= n_lines,
              '%s source_line out of file' % iid)
        sb = it['source_block']
        if sb is not None:
            if check(sb in block_index, '%s unknown block %s' % (iid, sb)):
                brid, bfile, bline = block_index[sb]
                check(brid == rid and bfile == sf, '%s block %s belongs to %s' % (iid, sb, brid))
                later = [x for x in starts_by_file.get(bfile, ()) if x > bline]
                bend = min(later) - 1 if later else len(tex_lines(bfile))
                check(bline <= it['source_line'] <= bend,
                      '%s source_line %s not inside block %s (lines %s-%s)'
                      % (iid, it['source_line'], sb, bline, bend))
        check(len(it['citations']) >= 2, '%s needs >= 2 citations' % iid)
        for c in it['citations']:
            lines = tex_lines(c['file'])
            ln = c['line']
            ok = 1 <= ln <= len(lines)
            check(ok, '%s citation line %s out of %s' % (iid, ln, c['file']))
            if ok:
                check(norm_ws(c['quote']) in norm_ws(lines[ln - 1]),
                      '%s citation quote %r not on %s:%s' % (iid, c['quote'], c['file'], ln))
        for key in ('title', 'description', 'explanation'):
            check(isinstance(it[key], str) and len(it[key]) > 20, '%s %s too short' % (iid, key))

        # sliders
        tgt, tol, start = it['target'], it['tolerance'], it['start']
        matters = it['matters']
        check(set(matters) <= set(PARAMS) and len(matters) >= 1, '%s matters' % iid)
        for name in PARAM_ORDER:
            lo, hi, st = PARAMS[name]
            t, d, s0 = tgt[name], tol[name], start[name]
            check(lo <= t <= hi and on_grid(t, lo, st), '%s target %s=%s off range/grid' % (iid, name, t))
            check(lo <= s0 <= hi and on_grid(s0, lo, st), '%s start %s=%s off range/grid' % (iid, name, s0))
            check(d >= st / 2.0, '%s tolerance %s below half a step' % (iid, name))
            a, b = box(it, name)
            first = math.ceil((a - lo) / st - 1e-9)
            check(lo + first * st <= b + 1e-9, '%s box %s holds no grid point' % (iid, name))
            if name in matters:
                check(d < (hi - lo) / 2.0, '%s %s matters but tolerance is not binding' % (iid, name))
            else:
                check(t - d <= lo and t + d >= hi,
                      '%s %s not in matters so its tolerance must admit the whole range' % (iid, name))
        outside = [n for n in matters if abs(start[n] - tgt[n]) > tol[n] + 1e-9]
        check(outside, '%s start already inside the tolerance box' % iid)

        # numerics at target, start and all 16 box corners
        for label, p in [('target', tgt), ('start', start)] + [('corner', q) for q in corners(it)]:
            mass, mean, sd = moments(p)
            check(abs(mass - 1.0) <= 1e-3, '%s %s integrates to %.6f' % (iid, label, mass))
            check(abs(mean - mean_closed(p)) <= 1e-3 * max(1.0, p['s']),
                  '%s %s mean %.5f vs closed %.5f' % (iid, label, mean, mean_closed(p)))
            lm = p['s'] * integrate_side(lambda z: density(p['mu'] + p['s'] * z, p), -1)
            check(abs(lm - left_mass(p)) <= 1e-3, '%s %s left mass' % (iid, label))
            eps = 1e-9
            check(abs(density(p['mu'] - eps, p) - density(p['mu'], p)) < 1e-6,
                  '%s %s discontinuous at mu' % (iid, label))
            if label == 'target':
                # sd check only where the closed form is well conditioned
                check(abs(sd - sd_closed(p)) <= 2e-2 * sd_closed(p),
                      '%s target sd %.4f vs closed %.4f' % (iid, sd, sd_closed(p)))
        chk = it.get('check')
        if chk:
            check(abs(chk['peak_density'] - peak(tgt)) < 1e-6, '%s check.peak_density' % iid)
            check(abs(chk['mean'] - mean_closed(tgt)) < 1e-6, '%s check.mean' % iid)
            check(abs(chk['sd'] - sd_closed(tgt)) < 1e-6, '%s check.sd' % iid)
            check(abs(chk['left_mass'] - left_mass(tgt)) < 1e-6, '%s check.left_mass' % iid)

        # smile
        sm = it['smile']
        lab = sm.get('label')
        check(lab in LABELS, '%s smile label %r' % (iid, lab))
        pts = sm.get('points', [])
        check(len(pts) >= 7, '%s needs >= 7 smile points' % iid)
        xs = [q[0] for q in pts]
        vs = [q[1] for q in pts]
        check(all(b > a for a, b in zip(xs, xs[1:])), '%s moneyness not increasing' % iid)
        check(any(abs(x - 1.0) < 1e-12 for x in xs), '%s moneyness must include 1.0' % iid)
        check(xs[0] <= 0.8 and xs[-1] >= 1.2, '%s moneyness must span [0.8, 1.2]' % iid)
        check(all(v > 0 for v in vs), '%s vols must be positive' % iid)
        check('illustrative' in sm.get('smile_note', '').lower(), '%s smile_note must say illustrative' % iid)
        if lab == 'volatility skew':
            check(all(b < a for a, b in zip(vs, vs[1:])), '%s skew must be strictly decreasing' % iid)
            check(vs[0] - vs[-1] >= 2.0, '%s skew drop < 2 vol pts' % iid)
        elif lab == 'volatility smile':
            k = vs.index(min(vs))
            check(0 < k < len(vs) - 1 and 0.95 <= xs[k] <= 1.05,
                  '%s smile minimum not interior near 1.0 (at %s)' % (iid, xs[k]))
            check(all(b < a for a, b in zip(vs[:k + 1], vs[1:k + 1])), '%s smile left arm not falling' % iid)
            check(all(b > a for a, b in zip(vs[k:], vs[k + 1:])), '%s smile right arm not rising' % iid)
            check(vs[0] - vs[k] >= 0.5 and vs[-1] - vs[k] >= 0.5, '%s smile ends not raised' % iid)
        elif lab == 'flat':
            check(max(vs) - min(vs) <= 0.5, '%s flat curve varies > 0.5 vol pts' % iid)
        formula = sm.get('formula')
        if check(isinstance(formula, str), '%s smile.formula missing' % iid):
            for x, v in pts:
                check(abs(round(eval_formula(formula, x), 2) - v) < 1e-9,
                      '%s point (%s, %s) != formula' % (iid, x, v))
            fs = sm.get('formula_source')
            if fs is not None:
                line = tex_lines(fs['file'])[fs['line'] - 1]
                check(norm_ws(formula) in norm_ws(line),
                      '%s formula %r not on %s:%s' % (iid, formula, fs['file'], fs['line']))
        if 'before_points' in sm:
            bf = sm['before_formula']
            for (x, v), (xb, vb) in zip(pts, sm['before_points']):
                check(x == xb and abs(round(eval_formula(bf, x), 2) - vb) < 1e-9,
                      '%s before point mismatch at %s' % (iid, x))
            bfs = sm['before_formula_source']
            check(norm_ws(bf) in norm_ws(tex_lines(bfs['file'])[bfs['line'] - 1]),
                  '%s before_formula not on cited line' % iid)

        # consistency: distribution class <-> curve label, over the whole acceptance box
        for label, p in [('target', tgt)] + [('corner', q) for q in corners(it)]:
            got, rl, rr = classify(p)
            check(got == lab, '%s %s nuL=%s nuR=%s classifies as %s (R_L=%.2f R_R=%.2f), label %s'
                  % (iid, label, p['nuL'], p['nuR'], got, rl, rr, lab))

    # ---- contrasts
    for it in items:
        for c in it.get('contrasts', []):
            iid = it['id']
            rel = c['relation']
            if rel == 'thinner_tails_than':
                other = by_id.get(c['item'])
                if not check(other is not None, '%s contrast item %s missing' % (iid, c.get('item'))):
                    continue
                for n in ('nuL', 'nuR'):
                    check(box(it, n)[0] > box(other, n)[1],
                          '%s %s box must lie above %s' % (iid, n, other['id']))
                depth = lambda q: max(q[0][1], q[-1][1]) - min(v for _, v in q)
                check(depth(it['smile']['points']) < depth(other['smile']['points']),
                      '%s smile must be shallower than %s' % (iid, other['id']))
            elif rel == 'curve_shifts_down_narrower':
                pts, bpts = it['smile']['points'], it['smile']['before_points']
                check(all(v < vb - 1.0 for (_, v), (_, vb) in zip(pts, bpts)),
                      '%s curve must sit below before_points' % iid)
                check(box(it, 's')[1] < it['start']['s'], '%s s box must lie below start s' % iid)
                check('s' in it['matters'], '%s s must matter' % iid)
            else:
                check(False, '%s unknown contrast %s' % (iid, rel))

    return data


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON
    data = validate(path)
    if ERRORS:
        for e in ERRORS:
            print('FAIL:', e)
        print('%d error(s)' % len(ERRORS))
        sys.exit(1)
    readings = sorted({it['reading_id'] for it in data['items']})
    print('OK: %d items, readings %s' % (len(data['items']), ', '.join(readings)))


if __name__ == '__main__':
    main()
