#!/usr/bin/env python3
"""Validator for content/games/mechanics/curve-sculptor.json (Curve Sculptor).

Pure Python 3 standard library. Usage:

    python3 tools/games/validate_curve-sculptor.py [path/to/curve-sculptor.json]

Exit status 0 when every check passes, 1 otherwise (all failures are listed).

What is checked, per item:
  * structure: required fields and types, stable id pattern, exactly three params, unique
    param names, target/start/tolerance present and consistent, wrong_param is a param.
  * provenance: reading_id exists in game-blocks.json, source_file exists and maps to that
    reading (file-name convention), source_line is inside the file, source_block (when not null)
    is a block of that reading, from that file, starting at or before source_line, and the
    optional source_anchor text occurs within +-2 lines of source_line.
  * expr: only x, the item's three param names, numbers, + - * / ** ( ) , and the whitelisted
    Math functions; no unary minus directly before a ** base (a SyntaxError in JavaScript).
  * numerics: expr evaluated on a 241-point grid over [x.min, x.max] is finite and inside
    [y.min, y.max] for the TARGET and for the START parameter sets; it stays finite for every
    slider position of the wrong parameter (others at target).
  * sliders: min <= target <= max, min <= start <= max, target and start on the step grid,
    START differs from TARGET only in wrong_param, tolerance > 0 and
    tolerance < |start - target| / 3, and the snap window [target - tol, target + tol] never
    reaches the start value.
  * shape: every shape word maps to a predicate below; the TARGET satisfies all of them, the
    START fails at least one, and every wrong-param value inside the snap window (target +-
    tolerance, sampled) also satisfies all of them, so the snap never accepts a wrong shape.
  * description: carries no digits (so it cannot give away a parameter value).
  * cross-check: when `node` is on PATH, the expr is also evaluated in real JavaScript at a few
    points and compared with the Python evaluation.

Shape predicates (y is sampled on the grid, Y = y.max - y.min is the canvas height,
slopes are measured in canvas units):
  increasing / upward-sloping / rising   no step down (beyond 1e-6 Y); total rise >= 8% Y
  decreasing / downward-sloping / inverted / declining   mirror image
  flat              max - min <= 3% Y
  humped / hump-shaped / peaked / frown   interior maximum (not in the outer 5% of x) that sits
                    >= 5% Y above both ends
  smile / U-shaped  interior minimum that sits >= 3% Y below both ends
  shallow           max - min <= 12% Y
  convex            no second difference below -1e-9 Y and total slope gain >= 0.2 (canvas units)
  concave           mirror image
  linear            max distance from the end-to-end chord <= 0.5% Y
  mean-reverting    monotone, moves >= 8% Y, |slope| never increases, and the slope over the
                    last 10% of x is <= 35% of the slope over the first 10%
  levels-off        monotone, moves >= 8% Y, and the slope over the last 10% of x is <= 35% of
                    the average slope over the whole range
  capped            y is within 1% Y of its maximum on >= 10% of the grid (a flat top)
  floored           y is within 1% Y of its minimum on >= 10% of the grid (a flat bottom)
  right-skewed      y >= 0 read as a density: standardised third moment >= +0.5
  left-skewed / negatively-skewed   standardised third moment <= -0.5
  symmetric         |standardised third moment| <= 0.1
  fat-tailed        y >= 0 read as a density: excess kurtosis >= 1.0
  heavy-tailed      over the last 40% of x: y > 0 throughout, y at x.max >= 1e-4 of the peak,
                    and ln y is convex (decays no faster than exponentially)
  bounded           y falls to (numerically) zero at some x in the first 90% of the range and
                    stays there: a finite upper end-point
  through-origin    x.min == 0 and |y(0)| <= 1% Y
  changes-sign-once  exactly one sign change, negative at x.min and positive at x.max
  changes-sign-twice exactly two sign changes
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
DEFAULT_JSON = os.path.join(ROOT, 'content', 'games', 'mechanics', 'curve-sculptor.json')
BLOCKS_JSON = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')

MECHANIC = 'curve-sculptor'
ID_PREFIX = 'cs'
N_GRID = 241
MATH_FUNCS = ('exp', 'log', 'sqrt', 'pow', 'abs', 'min', 'max')

# ---------------------------------------------------------------- expression handling

TOKEN_RE = re.compile(r'\s*(?:(?P<num>\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?|(?P<math>Math\.[a-z]+)'
                      r'|(?P<name>[A-Za-z_][A-Za-z0-9_]*)|(?P<op>\*\*|[-+*/(),]))')


def tokenize(expr):
    pos, out = 0, []
    expr = expr.rstrip()
    while pos < len(expr):
        m = TOKEN_RE.match(expr, pos)
        if not m or m.end() == pos:
            raise ValueError('illegal character at %d: %r' % (pos, expr[pos:pos + 10]))
        if m.group('num') is not None:
            out.append(('num', m.group(0).strip()))
        elif m.group('math'):
            out.append(('math', m.group('math')))
        elif m.group('name'):
            out.append(('name', m.group('name')))
        else:
            out.append(('op', m.group('op')))
        pos = m.end()
    return out


def check_expr(expr, param_names):
    """Return a list of problems with the expression's vocabulary."""
    problems = []
    try:
        toks = tokenize(expr)
    except ValueError as e:
        return [str(e)]
    allowed_names = set(['x']) | set(param_names)
    depth = 0
    for i, (kind, val) in enumerate(toks):
        if kind == 'math':
            if val[5:] not in MATH_FUNCS:
                problems.append('Math function not allowed: %s' % val)
            if i + 1 >= len(toks) or toks[i + 1] != ('op', '('):
                problems.append('%s must be called' % val)
        elif kind == 'name':
            if val not in allowed_names:
                problems.append('unknown identifier: %s' % val)
        elif kind == 'op':
            if val == '(':
                depth += 1
            elif val == ')':
                depth -= 1
                if depth < 0:
                    problems.append('unbalanced parentheses')
        # unary minus directly before a ** base: -a ** b is a JS SyntaxError
        if kind == 'op' and val in '+-' and (i == 0 or toks[i - 1][0] == 'op' and toks[i - 1][1] in ('(', ',', '+', '-', '*', '/', '**')):
            # find the operand that follows and see whether ** comes right after it
            j = i + 1
            if j < len(toks) and toks[j][0] in ('num', 'name'):
                if j + 1 < len(toks) and toks[j + 1] == ('op', '**'):
                    problems.append('unary %s directly before a ** base (JS SyntaxError)' % val)
    if depth != 0:
        problems.append('unbalanced parentheses')
    return problems


def _pow(a, b):
    try:
        r = math.pow(a, b)
    except (OverflowError,):
        return math.inf
    except (ValueError, ZeroDivisionError):
        # JS: 0 ** negative = Infinity, negative ** fractional = NaN
        if a == 0 and b < 0:
            return math.inf
        return math.nan
    return r


def _log(a):
    if a == 0:
        return -math.inf
    if a < 0 or math.isnan(a):
        return math.nan
    return math.log(a)


def _exp(a):
    try:
        return math.exp(a)
    except OverflowError:
        return math.inf


def _sqrt(a):
    if a < 0 or math.isnan(a):
        return math.nan
    return math.sqrt(a)


def _div(a, b):
    if b == 0:
        if a == 0 or math.isnan(a):
            return math.nan
        return math.copysign(math.inf, a) * (1 if math.copysign(1, b) > 0 else -1)
    return a / b


def _min(*a):
    return math.nan if any(math.isnan(v) for v in a) else min(a)


def _max(*a):
    return math.nan if any(math.isnan(v) for v in a) else max(a)


class _Parser:
    """Recursive-descent evaluator with JavaScript semantics for the whitelisted grammar."""

    def __init__(self, toks, env):
        self.t, self.i, self.env = toks, 0, env

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def eat(self, kind=None, val=None):
        tok = self.peek()
        if (kind and tok[0] != kind) or (val and tok[1] != val):
            raise ValueError('parse error near token %d %r' % (self.i, tok))
        self.i += 1
        return tok

    def parse(self):
        v = self.additive()
        if self.i != len(self.t):
            raise ValueError('trailing tokens at %d' % self.i)
        return v

    def additive(self):
        v = self.multiplicative()
        while self.peek() in (('op', '+'), ('op', '-')):
            op = self.eat()[1]
            r = self.multiplicative()
            v = v + r if op == '+' else v - r
        return v

    def multiplicative(self):
        v = self.unary()
        while self.peek() in (('op', '*'), ('op', '/')):
            op = self.eat()[1]
            r = self.unary()
            if op == '*':
                v = math.nan if (math.isinf(v) and r == 0) or (math.isinf(r) and v == 0) else v * r
            else:
                v = _div(v, r)
        return v

    def unary(self):
        if self.peek() in (('op', '-'), ('op', '+')):
            op = self.eat()[1]
            v = self.unary()
            return -v if op == '-' else v
        return self.power()

    def power(self):
        base = self.primary()
        if self.peek() == ('op', '**'):
            self.eat()
            exp = self.unary()  # right-associative
            return _pow(base, exp)
        return base

    def primary(self):
        kind, val = self.peek()
        if kind == 'num':
            self.eat()
            return float(val)
        if kind == 'name':
            self.eat()
            return float(self.env[val])
        if kind == 'math':
            self.eat()
            self.eat('op', '(')
            args = [self.additive()]
            while self.peek() == ('op', ','):
                self.eat()
                args.append(self.additive())
            self.eat('op', ')')
            fn = val[5:]
            if fn == 'exp':
                return _exp(args[0])
            if fn == 'log':
                return _log(args[0])
            if fn == 'sqrt':
                return _sqrt(args[0])
            if fn == 'pow':
                return _pow(args[0], args[1])
            if fn == 'abs':
                return abs(args[0])
            if fn == 'min':
                return _min(*args)
            if fn == 'max':
                return _max(*args)
            raise ValueError('bad function %s' % fn)
        if (kind, val) == ('op', '('):
            self.eat()
            v = self.additive()
            self.eat('op', ')')
            return v
        raise ValueError('unexpected token %r' % ((kind, val),))


def make_fn(expr):
    toks = tokenize(expr)

    def f(x, params):
        env = dict(params)
        env['x'] = x
        try:
            return _Parser(toks, env).parse()
        except (OverflowError, ZeroDivisionError):
            return math.nan
    return f


def grid(item):
    lo, hi = float(item['x']['min']), float(item['x']['max'])
    return [lo + (hi - lo) * i / (N_GRID - 1) for i in range(N_GRID)]


def evaluate(item, params):
    f = make_fn(item['expr'])
    return [f(x, params) for x in grid(item)]


# ---------------------------------------------------------------- shape predicates

def _span(item):
    return float(item['y']['max']) - float(item['y']['min'])


def _diffs(ys):
    return [b - a for a, b in zip(ys, ys[1:])]


def p_increasing(xs, ys, Y):
    d = _diffs(ys)
    return min(d) >= -1e-6 * Y and ys[-1] - ys[0] >= 0.08 * Y


def p_decreasing(xs, ys, Y):
    return p_increasing(xs, [-v for v in ys], Y)


def p_flat(xs, ys, Y):
    return max(ys) - min(ys) <= 0.03 * Y


def p_shallow(xs, ys, Y):
    return max(ys) - min(ys) <= 0.12 * Y


def p_humped(xs, ys, Y):
    n = len(ys)
    i = max(range(n), key=lambda k: ys[k])
    if i < 0.05 * (n - 1) or i > 0.95 * (n - 1):
        return False
    return ys[i] - ys[0] >= 0.05 * Y and ys[i] - ys[-1] >= 0.05 * Y


def p_smile(xs, ys, Y):
    n = len(ys)
    i = min(range(n), key=lambda k: ys[k])
    if i < 0.05 * (n - 1) or i > 0.95 * (n - 1):
        return False
    return ys[0] - ys[i] >= 0.03 * Y and ys[-1] - ys[i] >= 0.03 * Y


def _slopes(ys, Y):
    """Slopes in canvas units: rise as a share of Y per run as a share of the x span."""
    n = len(ys)
    return [d / Y * (n - 1) for d in _diffs(ys)]


def p_convex(xs, ys, Y):
    d2 = _diffs(_diffs(ys))
    s = _slopes(ys, Y)
    return min(d2) >= -1e-9 * Y and s[-1] - s[0] >= 0.2


def p_concave(xs, ys, Y):
    return p_convex(xs, [-v for v in ys], Y)


def p_linear(xs, ys, Y):
    n = len(ys)
    dev = max(abs(ys[i] - (ys[0] + (ys[-1] - ys[0]) * i / (n - 1))) for i in range(n))
    return dev <= 0.005 * Y


def _monotone_move(ys, Y):
    return p_increasing(None, ys, Y) or p_decreasing(None, ys, Y)


def _seg_slope(ys, a, b):
    n = len(ys) - 1
    i, j = int(round(a * n)), int(round(b * n))
    return (ys[j] - ys[i]) / max(j - i, 1)


def p_mean_reverting(xs, ys, Y):
    if not _monotone_move(ys, Y):
        return False
    d = [abs(v) for v in _diffs(ys)]
    if any(b > a + 1e-9 * Y for a, b in zip(d, d[1:])):
        return False
    first, last = abs(_seg_slope(ys, 0.0, 0.1)), abs(_seg_slope(ys, 0.9, 1.0))
    return first > 0 and last <= 0.35 * first


def p_levels_off(xs, ys, Y):
    if not _monotone_move(ys, Y):
        return False
    avg, last = abs(_seg_slope(ys, 0.0, 1.0)), abs(_seg_slope(ys, 0.9, 1.0))
    return last <= 0.35 * avg


def p_capped(xs, ys, Y):
    m = max(ys)
    return sum(1 for v in ys if v >= m - 0.01 * Y) >= 0.10 * len(ys)


def p_floored(xs, ys, Y):
    m = min(ys)
    return sum(1 for v in ys if v <= m + 0.01 * Y) >= 0.10 * len(ys)


def _moments(xs, ys):
    if min(ys) < 0:
        return None
    w = sum(ys)
    if w <= 0:
        return None
    mu = sum(x * y for x, y in zip(xs, ys)) / w
    m2 = sum((x - mu) ** 2 * y for x, y in zip(xs, ys)) / w
    m3 = sum((x - mu) ** 3 * y for x, y in zip(xs, ys)) / w
    m4 = sum((x - mu) ** 4 * y for x, y in zip(xs, ys)) / w
    if m2 <= 0:
        return None
    return m3 / m2 ** 1.5, m4 / m2 ** 2 - 3.0


def p_right_skewed(xs, ys, Y):
    m = _moments(xs, ys)
    return m is not None and m[0] >= 0.5


def p_left_skewed(xs, ys, Y):
    m = _moments(xs, ys)
    return m is not None and m[0] <= -0.5


def p_symmetric(xs, ys, Y):
    m = _moments(xs, ys)
    return m is not None and abs(m[0]) <= 0.1


def p_fat_tailed(xs, ys, Y):
    m = _moments(xs, ys)
    return m is not None and m[1] >= 1.0


def p_heavy_tailed(xs, ys, Y):
    n = len(ys)
    tail = ys[int(0.6 * (n - 1)):]
    if min(tail) <= 0 or tail[-1] < 1e-4 * max(ys):
        return False
    ly = [math.log(v) for v in tail]
    return min(_diffs(_diffs(ly))) >= -1e-9


def p_bounded(xs, ys, Y):
    n = len(ys)
    zero = [abs(v) <= 1e-9 * Y for v in ys]
    for i in range(int(0.9 * (n - 1)) + 1):
        if all(zero[i:]) and not zero[0]:
            return True
    return False


def p_through_origin(xs, ys, Y):
    return xs[0] == 0 and abs(ys[0]) <= 0.01 * Y


def _sign_changes(ys, Y):
    signs = [1 if v > 1e-9 * Y else -1 if v < -1e-9 * Y else 0 for v in ys]
    signs = [s for s in signs if s != 0]
    return sum(1 for a, b in zip(signs, signs[1:]) if a != b), signs


def p_sign_once(xs, ys, Y):
    k, s = _sign_changes(ys, Y)
    return k == 1 and s[0] < 0 and s[-1] > 0


def p_sign_twice(xs, ys, Y):
    k, _ = _sign_changes(ys, Y)
    return k == 2


SHAPES = {
    'increasing': p_increasing, 'upward-sloping': p_increasing, 'rising': p_increasing,
    'decreasing': p_decreasing, 'downward-sloping': p_decreasing, 'inverted': p_decreasing,
    'declining': p_decreasing,
    'flat': p_flat, 'shallow': p_shallow,
    'humped': p_humped, 'hump-shaped': p_humped, 'peaked': p_humped, 'frown': p_humped,
    'smile': p_smile, 'U-shaped': p_smile,
    'convex': p_convex, 'concave': p_concave, 'linear': p_linear,
    'mean-reverting': p_mean_reverting, 'levels-off': p_levels_off,
    'capped': p_capped, 'floored': p_floored,
    'right-skewed': p_right_skewed, 'left-skewed': p_left_skewed,
    'negatively-skewed': p_left_skewed, 'symmetric': p_symmetric,
    'fat-tailed': p_fat_tailed, 'heavy-tailed': p_heavy_tailed, 'bounded': p_bounded,
    'through-origin': p_through_origin,
    'changes-sign-once': p_sign_once, 'changes-sign-twice': p_sign_twice,
}


def shape_report(item, params):
    xs, ys = grid(item), evaluate(item, params)
    Y = _span(item)
    if not all(math.isfinite(v) for v in ys):
        return {w: False for w in item['shape_words']}
    return {w: bool(SHAPES[w](xs, ys, Y)) for w in item['shape_words']}


# ---------------------------------------------------------------- provenance helpers

AREA_MAP = {'MR': 'MR', 'CR': 'CR', 'IM': 'IM', 'LR': 'LTR', 'OR': 'ORR', 'CI': 'CI'}
FILE_RE = re.compile(r'^notes/FRM_Consolidated_Vol[12]/ch/\d+_([A-Z]{2})_([A-Z]+)(\d+)\.tex$')


def reading_of_file(path):
    m = FILE_RE.match(path)
    if not m:
        return None
    return '%s-%d' % (AREA_MAP.get(m.group(1), m.group(1)), int(m.group(3)))


def on_grid(v, lo, step):
    k = (v - lo) / step
    return abs(k - round(k)) <= 1e-6


# ---------------------------------------------------------------- main validation

def validate(path):
    errors = []
    data = json.load(open(path))
    blocks = json.load(open(BLOCKS_JSON))['readings']
    block_index = {}
    for rid, r in blocks.items():
        for o in r['objectives']:
            for b in o['blocks']:
                block_index[b['id']] = (rid, b)

    def err(item_id, msg):
        errors.append('%s: %s' % (item_id, msg))

    if data.get('version') != 1:
        errors.append('top level: version must be 1')
    if data.get('mechanic') != MECHANIC:
        errors.append('top level: mechanic must be %r' % MECHANIC)
    items = data.get('items')
    if not isinstance(items, list) or not items:
        errors.append('top level: items must be a non-empty list')
        return errors, {}

    seen = set()
    file_cache = {}
    js_jobs = []
    for item in items:
        iid = item.get('id', '<no id>')
        required = ['id', 'reading_id', 'source_block', 'source_file', 'source_line', 'description',
                    'shape_words', 'x', 'y', 'expr', 'params', 'target', 'wrong_param',
                    'start_value', 'tolerance', 'explanation']
        missing = [k for k in required if k not in item]
        if missing:
            err(iid, 'missing fields %s' % missing)
            continue
        # ids
        if iid in seen:
            err(iid, 'duplicate id')
        seen.add(iid)
        rid = item['reading_id']
        m = re.match(r'^%s-([A-Z]+-\d+)-(\d{2})$' % ID_PREFIX, iid)
        if not m or m.group(1) != rid:
            err(iid, 'id must look like %s-<reading>-<nn> with the item reading' % ID_PREFIX)
        # provenance
        if rid not in blocks:
            err(iid, 'unknown reading_id %s' % rid)
        sf = item['source_file']
        if reading_of_file(sf) != rid:
            err(iid, 'source_file %s does not map to %s' % (sf, rid))
        full = os.path.join(ROOT, sf)
        if not os.path.exists(full):
            err(iid, 'source_file missing: %s' % sf)
            continue
        if sf not in file_cache:
            file_cache[sf] = open(full, encoding='utf-8').read().split('\n')
        lines = file_cache[sf]
        sl = item['source_line']
        if not isinstance(sl, int) or not 1 <= sl <= len(lines):
            err(iid, 'source_line out of range')
            continue
        anchor = item.get('source_anchor')
        if anchor is not None:
            window = '\n'.join(lines[max(0, sl - 3):sl + 2])
            if anchor not in window:
                err(iid, 'source_anchor %r not within 2 lines of %s:%d' % (anchor, sf, sl))
        sb = item['source_block']
        if sb is not None:
            if sb not in block_index:
                err(iid, 'source_block %s not in game-blocks.json' % sb)
            else:
                brid, b = block_index[sb]
                if brid != rid:
                    err(iid, 'source_block %s belongs to %s' % (sb, brid))
                if b['source_file'] != sf:
                    err(iid, 'source_block file %s != %s' % (b['source_file'], sf))
                if b['source_line'] > sl:
                    err(iid, 'source_block starts after source_line')
        # text fields
        if not isinstance(item['description'], str) or not item['description'].strip():
            err(iid, 'empty description')
        elif re.search(r'\d', item['description']):
            err(iid, 'description contains digits (could give away a parameter)')
        if not isinstance(item['explanation'], str) or len(item['explanation']) < 40:
            err(iid, 'explanation too short')
        sw = item['shape_words']
        if not isinstance(sw, list) or not sw:
            err(iid, 'shape_words must be a non-empty list')
            continue
        unknown = [w for w in sw if w not in SHAPES]
        if unknown:
            err(iid, 'shape words without a predicate: %s' % unknown)
            continue
        # axes
        ok_axes = True
        for ax in ('x', 'y'):
            a = item[ax]
            if not all(k in a for k in ('label', 'min', 'max', 'unit')):
                err(iid, '%s axis needs label, min, max, unit' % ax)
                ok_axes = False
            elif not (isinstance(a['min'], (int, float)) and isinstance(a['max'], (int, float)) and a['min'] < a['max']):
                err(iid, '%s axis min must be < max' % ax)
                ok_axes = False
        if not ok_axes:
            continue
        # params
        params = item['params']
        if not isinstance(params, list) or len(params) != 3:
            err(iid, 'params must have exactly 3 entries')
            continue
        names = [p.get('name') for p in params]
        if len(set(names)) != 3 or 'x' in names or any(not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', n or '') for n in names):
            err(iid, 'param names must be 3 distinct identifiers other than x')
            continue
        bad_param = False
        for p in params:
            for k in ('name', 'label', 'min', 'max', 'step'):
                if k not in p:
                    err(iid, 'param %s missing %s' % (p.get('name'), k))
                    bad_param = True
            if not bad_param and not (p['min'] < p['max'] and p['step'] > 0):
                err(iid, 'param %s needs min < max and step > 0' % p['name'])
                bad_param = True
        if bad_param:
            continue
        pmap = {p['name']: p for p in params}
        target = item['target']
        if set(target) != set(names):
            err(iid, 'target must give exactly the three params')
            continue
        wp = item['wrong_param']
        if wp not in pmap:
            err(iid, 'wrong_param %s is not a param' % wp)
            continue
        for n in names:
            p = pmap[n]
            if not p['min'] <= target[n] <= p['max']:
                err(iid, 'target %s=%s outside slider [%s, %s]' % (n, target[n], p['min'], p['max']))
            if n == wp and not on_grid(target[n], p['min'], p['step']):
                err(iid, 'target %s=%s not on the slider step grid' % (n, target[n]))
        sv = item['start_value']
        p = pmap[wp]
        if not p['min'] <= sv <= p['max']:
            err(iid, 'start_value outside slider range')
        if not on_grid(sv, p['min'], p['step']):
            err(iid, 'start_value not on the slider step grid')
        start = dict(target)
        start[wp] = sv
        diff_keys = [k for k in names if start[k] != target[k]]
        if diff_keys != [wp]:
            err(iid, 'start must differ from target in wrong_param only (differs in %s)' % diff_keys)
        tol = item['tolerance']
        gap = abs(sv - target[wp])
        if not (isinstance(tol, (int, float)) and tol > 0):
            err(iid, 'tolerance must be positive')
            continue
        if not tol < gap / 3.0:
            err(iid, 'tolerance %s must be < |start - target|/3 = %.6g' % (tol, gap / 3.0))
        # expression
        probs = check_expr(item['expr'], names)
        if probs:
            err(iid, 'expr: %s' % '; '.join(probs))
            continue
        try:
            make_fn(item['expr'])(float(item['x']['min']), target)
        except Exception as e:  # parse errors
            err(iid, 'expr does not parse: %s' % e)
            continue
        ylo, yhi = float(item['y']['min']), float(item['y']['max'])
        for label, ps in (('target', target), ('start', start)):
            ys = evaluate(item, ps)
            if not all(math.isfinite(v) for v in ys):
                err(iid, '%s curve has non-finite values' % label)
            elif min(ys) < ylo - 1e-9 or max(ys) > yhi + 1e-9:
                err(iid, '%s curve leaves the y range: [%.4g, %.4g] vs [%s, %s]' % (label, min(ys), max(ys), ylo, yhi))
        # finiteness along the whole slider for the wrong parameter
        k_max = int(round((p['max'] - p['min']) / p['step']))
        stride = max(1, k_max // 200)
        for k in range(0, k_max + 1, stride):
            v = p['min'] + k * p['step']
            ps = dict(target)
            ps[wp] = v
            ys = evaluate(item, ps)
            if not all(math.isfinite(y) for y in ys):
                err(iid, 'curve non-finite at slider %s=%.6g' % (wp, v))
                break
        # shapes
        rep_t = shape_report(item, target)
        if not all(rep_t.values()):
            err(iid, 'TARGET fails shape words %s' % [w for w, ok in rep_t.items() if not ok])
        rep_s = shape_report(item, start)
        if all(rep_s.values()):
            err(iid, 'START satisfies every shape word %s; it must fail at least one' % sw)
        for frac in (-1.0, -0.5, 0.5, 1.0):
            v = target[wp] + frac * tol
            if not p['min'] <= v <= p['max']:
                continue
            ps = dict(target)
            ps[wp] = v
            rep = shape_report(item, ps)
            if not all(rep.values()):
                err(iid, 'inside the snap window (%s=%.6g) the shape fails %s' % (wp, v, [w for w, ok in rep.items() if not ok]))
        js_jobs.append((iid, item, target, start))

    # optional cross-check against real JavaScript
    node = shutil.which('node')
    if node and js_jobs:
        payload = []
        for iid, item, target, start in js_jobs:
            xs = grid(item)
            pts = [xs[0], xs[len(xs) // 3], xs[len(xs) // 2], xs[2 * len(xs) // 3], xs[-1]]
            for ps in (target, start):
                payload.append({'id': iid, 'expr': item['expr'], 'names': list(ps.keys()),
                                'vals': [ps[k] for k in ps], 'xs': pts})
        script = (
            "const jobs=JSON.parse(require('fs').readFileSync(0,'utf8'));"
            "const out=jobs.map(j=>{const f=new Function('x',...j.names,'return ('+j.expr+');');"
            "return j.xs.map(x=>{const v=f(x,...j.vals);return Number.isFinite(v)?v:String(v);});});"
            "process.stdout.write(JSON.stringify(out));")
        try:
            res = subprocess.run([node, '-e', script], input=json.dumps(payload), capture_output=True,
                                 text=True, timeout=60)
            if res.returncode != 0:
                errors.append('node cross-check failed: %s' % res.stderr.strip()[:400])
            else:
                js_vals = json.loads(res.stdout)
                for job, vals in zip(payload, js_vals):
                    f = make_fn(job['expr'])
                    ps = dict(zip(job['names'], job['vals']))
                    for x, jv in zip(job['xs'], vals):
                        pv = f(x, ps)
                        if isinstance(jv, str) or not math.isfinite(pv):
                            if not (isinstance(jv, str) and not math.isfinite(pv)):
                                errors.append('%s: JS/Python disagree at x=%g (%r vs %r)' % (job['id'], x, jv, pv))
                        elif abs(jv - pv) > 1e-9 * max(1.0, abs(jv)):
                            errors.append('%s: JS/Python disagree at x=%g (%r vs %r)' % (job['id'], x, jv, pv))
        except (OSError, subprocess.SubprocessError) as e:
            errors.append('node cross-check could not run: %s' % e)

    stats = {
        'items': len(items),
        'readings': sorted(set(i.get('reading_id') for i in items)),
        'node_cross_check': bool(node),
    }
    return errors, stats


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON
    errors, stats = validate(path)
    if errors:
        print('FAIL: %d problem(s)' % len(errors))
        for e in errors:
            print('  - ' + e)
        sys.exit(1)
    print('OK: %d items across %d readings (%s); node cross-check: %s' % (
        stats['items'], len(stats['readings']), ', '.join(stats['readings']),
        'yes' if stats['node_cross_check'] else 'skipped (node not found)'))


if __name__ == '__main__':
    main()
