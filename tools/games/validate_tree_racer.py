#!/usr/bin/env python3
"""Validator (and shared lattice engine) for the Tree Racer mechanic.

    python3 tools/games/validate_tree_racer.py [path/to/tree-racer.json]

Stdlib only. The engine below re-implements every node rule from the notes (MR-12, MR-13,
MR-14, MR-15) and every named mistake used to build the wrong candidates. The validator then
asserts, for every item:

  * structure: required fields, enums, id pattern, steps 2-4, source file / line / block exist
    and belong to the item's reading;
  * every node recomputed from `params` with the model's rule (|diff| <= 1e-9) and its display
    string re-rendered; forward normal/lognormal models are also checked against the closed
    form printed in the notes (r0 + sum(drift) + (2i - t) sigma sqrt(dt), or its exponential);
  * recombination: up-then-down == down-then-up within 1e-9 for recombining models; for Vasicek
    the two routes must differ and the stored middle node must be their average (notes' fix);
    backward trees must have t+1 nodes at level t and the given-rate tree must have that shape;
  * notes_check: every cited notes number equals the node's display AND literally appears on
    the cited line of the .tex source;
  * order: visits every non-given node exactly once, level by level in the item's direction;
  * candidates: exactly three per visited node, exactly one correct (value and display equal to
    the node), every wrong candidate recomputed from its mistake_code, all three values more
    than half a display unit apart with distinct display strings;
  * phantom: one entry per wrong candidate; forward entries carry exactly two children computed
    with the item's own rule from the wrong value, each of which differs from the real child
    and from every real node at the next date; backward entries carry the parent value(s)
    recomputed with the wrong value and each differs from the real parent.
"""
import json
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MECHANIC = 'tree-racer'
DEFAULT_JSON = os.path.join(ROOT, 'content', 'games', 'mechanics', MECHANIC + '.json')
BLOCKS_JSON = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')

FORWARD_MODELS = ('model1', 'model2', 'holee', 'vasicek', 'lognormal_sb')
BACKWARD_MODELS = ('zero_backward', 'option_backward', 'cmt_swap')
RECOMBINING = {'model1': True, 'model2': True, 'holee': True, 'vasicek': False,
               'lognormal_sb': True, 'zero_backward': True, 'option_backward': True,
               'cmt_swap': True}
TOL = 1e-9

MISTAKES = {
    # forward (rate building)
    'drift_omitted': 'Drift omitted',
    'drift_unscaled': 'Drift not multiplied by dt',
    'sigma_unscaled': 'Sigma not scaled by sqrt(dt)',
    'sigma_dt': 'Sigma scaled by dt instead of sqrt(dt)',
    'up_down_swapped': 'Up/down swapped',
    'constant_drift': 'First-period drift reused (constant drift, not time-dependent)',
    'stale_drift': "Drift not recomputed at the node's own rate (today's drift reused)",
    'route_up': 'Non-recombining path: kept the up-then-down rate (path-dependent drift)',
    'route_down': 'Non-recombining path: kept the down-then-up rate (path-dependent drift)',
    'proportional_step': 'Simple proportional step r(1 + a dt +/- sigma sqrt(dt)) instead of the exponential',
    # backward (valuation)
    'root_rate': "Discounted at today's rate instead of the node's own forward rate",
    'sibling_rate': "Discounted at the other node's rate (up/down swapped)",
    'child_rate': "Discounted at next period's rate instead of the node's own rate",
    'not_discounted': 'Forgot to discount (probability-weighted average only)',
    'flat_root_rate_all_periods': "Discounted at today's rate for every period (ignores the tree)",
    'probs_swapped': 'Up/down probabilities swapped',
    'coupon_omitted': 'Coupon not added to the child values before discounting',
    'premium_omitted': 'Risk premium omitted (unadjusted rates)',
    'premium_on_root': "Risk premium also added to today's rate",
    'option_coupon_added': 'Coupon added to option values (options carry no coupon)',
    'option_cum_coupon': 'Payoff computed on the cum-coupon bond price',
    'option_not_floored': 'Payoff not floored at zero (max dropped)',
    'option_sign_flipped': 'Payoff sign flipped (strike minus bond)',
    'payoff_omitted': "Node's own payoff not added to the discounted value",
    'annual_discount': 'Compounding slip: discounted at 1 + r instead of 1 + r/2 (semiannual)',
    'accrual_not_halved': 'Semiannual accrual (divide by 2) omitted',
    'payoff_sign_flipped': 'Payoff sign flipped (fixed minus floating)',
}


# ---------------------------------------------------------------------------------------------
# Forward engine (rates in percent)

def _shock(P):
    """sigma*sqrt(dt); a normal-model item may carry the notes' printed (rounded) step instead."""
    if 'sigma_sqrt_dt' in P:
        return P['sigma_sqrt_dt']
    return P['sigma'] * math.sqrt(P['dt'])


def fwd_step(model, P, r, t, move, variant=None):
    """Child of a node worth r at date t; move = +1 (up) / -1 (down); variant = mistake code."""
    dt = P['dt']
    sd = math.sqrt(dt)
    v = variant
    if v == 'up_down_swapped':
        move = -move
    if model == 'lognormal_sb':
        a = P['a'][0] if v == 'constant_drift' else P['a'][t]
        drift = a * dt
        shock = P['sigma'] * sd
        if v == 'drift_omitted':
            drift = 0.0
        elif v == 'drift_unscaled':
            drift = a
        if v == 'sigma_unscaled':
            shock = P['sigma']
        elif v == 'sigma_dt':
            shock = P['sigma'] * dt
        if v == 'proportional_step':
            return r * (1.0 + drift + move * shock)
        return r * math.exp(drift + move * shock)
    if model == 'model1':
        drift_rate = 0.0
    elif model == 'model2':
        drift_rate = P['lambda']
    elif model == 'holee':
        drift_rate = P['lambda_t'][0] if v == 'constant_drift' else P['lambda_t'][t]
    elif model == 'vasicek':
        level = P['r0'] if v == 'stale_drift' else r
        drift_rate = P['k'] * (P['theta'] - level)
    else:
        raise ValueError('not a forward model: %s' % model)
    drift = drift_rate * dt
    shock = _shock(P)
    if v == 'drift_omitted':
        drift = 0.0
    elif v == 'drift_unscaled':
        drift = drift_rate
    if v == 'sigma_unscaled':
        shock = P['sigma']
    elif v == 'sigma_dt':
        shock = P['sigma'] * dt
    return r + drift + move * shock


def forward_tree(model, P, steps):
    """levels[t][i] (i = number of up moves) and routes[t][i] = (via up-parent, via down-parent)."""
    levels = [[P['r0']]]
    routes = [[(None, None)]]
    for t in range(steps):
        nxt, rts = [], []
        for i in range(t + 2):
            up = fwd_step(model, P, levels[t][i - 1], t, +1) if i - 1 >= 0 else None
            dn = fwd_step(model, P, levels[t][i], t, -1) if i <= t else None
            if up is not None and dn is not None:
                val = (up + dn) / 2.0 if model == 'vasicek' else up
            else:
                val = up if up is not None else dn
            nxt.append(val)
            rts.append((up, dn))
        levels.append(nxt)
        routes.append(rts)
    return levels, routes


def forward_closed_form(model, P, t, i):
    """Closed form printed in the notes (MR-14 l.74-76, 165-169, 214-218; MR-15 l.307-311)."""
    sd = math.sqrt(P['dt'])
    n = 2 * i - t
    if model == 'model1':
        return P['r0'] + n * _shock(P)
    if model == 'model2':
        return P['r0'] + t * P['lambda'] * P['dt'] + n * _shock(P)
    if model == 'holee':
        return P['r0'] + sum(P['lambda_t'][:t]) * P['dt'] + n * _shock(P)
    if model == 'lognormal_sb':
        return P['r0'] * math.exp(sum(P['a'][:t]) * P['dt'] + n * P['sigma'] * sd)
    return None


def forward_wrong(model, P, levels, routes, t, i, code):
    """Wrong value at node (t, i), t >= 1, from its up-parent (or down-parent on the bottom edge)."""
    if code in ('route_up', 'route_down'):
        via_up_move, via_down_move = routes[t][i]
        if via_up_move is None or via_down_move is None:
            return None
        # up-then-down arrives by a down move from the upper parent; down-then-up by an up move
        return via_down_move if code == 'route_up' else via_up_move
    if i - 1 >= 0:
        return fwd_step(model, P, levels[t - 1][i - 1], t - 1, +1, code)
    return fwd_step(model, P, levels[t - 1][i], t - 1, -1, code)


# ---------------------------------------------------------------------------------------------
# Backward engine

def _rate(P, t, i, premium=True):
    r = P['rates'][t][i]
    if premium and t >= 1:
        r += P.get('premium', 0.0)
    return r


def _q(P, t, up, dn):
    q = P['q'][t]
    if q is None:
        if abs(up - dn) > 1e-12:
            raise AssertionError('q is null at date %d but children differ' % t)
        q = 0.5
    return q


def bond_node(P, V, t, i, variant=None):
    """Zero / coupon bond by backward induction (MR-12 l.42-46, 179-184, 236-247; MR-13 l.159, 356)."""
    v = variant
    if v == 'premium_omitted':
        if not P.get('premium'):
            return None
        P2 = dict(P)
        P2['premium'] = 0.0
        return bond_tree(P2)[t][i]
    if v == 'flat_root_rate_all_periods':
        if t != 0 or P.get('coupon', 0.0):
            return None
        m = P.get('accrual', 1.0)
        return P['face'] / (1.0 + m * P['rates'][0][0] / 100.0) ** P['maturity_steps']
    c = P.get('coupon', 0.0)
    cu = 0.0 if v == 'coupon_omitted' else c
    if v == 'coupon_omitted' and not c:
        return None
    up, dn = V[t + 1][i + 1], V[t + 1][i]
    q = _q(P, t, up, dn)
    if v == 'probs_swapped':
        q = 1.0 - q
    ev = q * (up + cu) + (1.0 - q) * (dn + cu)
    if v == 'not_discounted':
        return ev
    r = _rate(P, t, i)
    if v == 'root_rate':
        r = P['rates'][0][0]
    elif v == 'sibling_rate':
        r = _rate(P, t, t - i)
    elif v == 'child_rate':
        if t + 1 >= len(P['rates']):
            return None
        r = _rate(P, t + 1, i + 1)
    elif v == 'premium_on_root':
        if t != 0 or not P.get('premium'):
            return None
        r = P['rates'][0][0] + P['premium']
    elif v is not None and v not in ('probs_swapped', 'coupon_omitted'):
        return None
    m = P.get('accrual', 1.0)
    return ev / (1.0 + m * r / 100.0)


def bond_tree(P):
    T = P['maturity_steps']
    V = [None] * (T + 1)
    V[T] = [float(P['face'])] * (T + 1)
    for t in range(T - 1, -1, -1):
        V[t] = [None] * (t + 1)
        for i in range(t + 1):
            V[t][i] = bond_node(P, V, t, i)
    return V


def option_node(P, O, B, t, i, variant=None):
    """European call on the bond (MR-12 l.250-261): payoff at expiry, then discounted averages."""
    v = variant
    E, K, c = P['expiry_step'], P['strike'], P.get('coupon', 0.0)
    if t == E:
        b = B[E][i]
        if v is None:
            return max(b - K, 0.0)
        if v == 'option_cum_coupon':
            return max(b + c - K, 0.0)
        if v == 'option_not_floored':
            return b - K
        if v == 'option_sign_flipped':
            return max(K - b, 0.0)
        return None
    if v in ('option_cum_coupon', 'option_not_floored', 'option_sign_flipped'):
        return None
    add = c if v == 'option_coupon_added' else 0.0
    up, dn = O[t + 1][i + 1], O[t + 1][i]
    q = P['q'][t]
    if v == 'probs_swapped':
        q = 1.0 - q
    ev = q * (up + add) + (1.0 - q) * (dn + add)
    if v == 'not_discounted':
        return ev
    r = P['rates'][t][i]
    if v == 'root_rate':
        r = P['rates'][0][0]
    elif v == 'sibling_rate':
        r = P['rates'][t][t - i]
    elif v is not None and v not in ('probs_swapped', 'option_coupon_added'):
        return None
    return ev / (1.0 + r / 100.0)


def option_tree(P):
    B = bond_tree(P)
    E = P['expiry_step']
    O = [None] * (E + 1)
    O[E] = [option_node(P, None, B, E, i) for i in range(E + 1)]
    for t in range(E - 1, -1, -1):
        O[t] = [None] * (t + 1)
        for i in range(t + 1):
            O[t][i] = option_node(P, O, B, t, i)
    return O, B


def cmt_payoff(P, t, i, variant=None):
    """Payoff = (N/2)(y_CMT - fixed) at every date after today (MR-12 l.333, 366-370)."""
    if t == 0:
        return 0.0
    N, r, f = P['notional'], P['rates'][t][i], P['fixed_rate']
    if variant == 'accrual_not_halved':
        return N * (r - f) / 100.0
    if variant == 'payoff_sign_flipped':
        return N / 2.0 * (f - r) / 100.0
    return N / 2.0 * (r - f) / 100.0


def cmt_node(P, V, t, i, variant=None):
    """V = [q V_u + (1-q) V_d] / (1 + r/2) + payoff (MR-12 l.378-383). With round_nodes = n each
    node is carried at n decimals, as the notes carry $2,697.53 and -$2,217.35 into V_0."""
    val = _cmt_node(P, V, t, i, variant)
    if val is not None and P.get('round_nodes') is not None:
        val = round(val, P['round_nodes'])
    return val


def _cmt_node(P, V, t, i, variant=None):
    v = variant
    T = P['steps']
    if t == T:
        if v in (None, 'accrual_not_halved', 'payoff_sign_flipped'):
            return cmt_payoff(P, t, i, v)
        return None
    if v in ('accrual_not_halved', 'payoff_sign_flipped'):
        return None
    up, dn = V[t + 1][i + 1], V[t + 1][i]
    q = P['q'][t]
    if v == 'probs_swapped':
        q = 1.0 - q
    ev = q * up + (1.0 - q) * dn
    r = P['rates'][t][i]
    m = P['accrual']
    if v == 'annual_discount':
        m = 1.0
    elif v not in (None, 'probs_swapped', 'payoff_omitted', 'not_discounted'):
        return None
    disc = ev if v == 'not_discounted' else ev / (1.0 + m * r / 100.0)
    pay = 0.0 if v == 'payoff_omitted' else cmt_payoff(P, t, i)
    if v == 'payoff_omitted' and t == 0:
        return None
    return disc + pay


def cmt_tree(P):
    T = P['steps']
    V = [None] * (T + 1)
    V[T] = [cmt_node(P, None, T, i) for i in range(T + 1)]
    for t in range(T - 1, -1, -1):
        V[t] = [None] * (t + 1)
        for i in range(t + 1):
            V[t][i] = cmt_node(P, V, t, i)
    return V


def backward_levels(model, P):
    if model == 'zero_backward':
        return bond_tree(P)
    if model == 'option_backward':
        return option_tree(P)[0]
    if model == 'cmt_swap':
        return cmt_tree(P)
    raise ValueError(model)


def backward_node(model, P, levels, t, i, variant=None):
    if model == 'zero_backward':
        return bond_node(P, levels, t, i, variant)
    if model == 'option_backward':
        B = bond_tree(P)
        return option_node(P, levels, B, t, i, variant)
    if model == 'cmt_swap':
        return cmt_node(P, levels, t, i, variant)
    raise ValueError(model)


# ---------------------------------------------------------------------------------------------
# Shared helpers

def compute_levels(item):
    model, P = item['model_code'], item['params']
    if model in FORWARD_MODELS:
        return forward_tree(model, P, item['steps'])
    return backward_levels(model, P), None


def wrong_value(item, levels, routes, t, i, code):
    model, P = item['model_code'], item['params']
    if model in FORWARD_MODELS:
        if t == 0:
            return None
        return forward_wrong(model, P, levels, routes, t, i, code)
    return backward_node(model, P, levels, t, i, code)


def phantom_for(item, levels, t, i, w):
    """Forward: two children of the wrong value under the item's own rule, vs the real node's
    children. Backward: parent value(s) recomputed with the wrong value in place, vs real."""
    model, P = item['model_code'], item['params']
    if model in FORWARD_MODELS:
        at = [[t + 1, i + 1], [t + 1, i]]
        vals = [fwd_step(model, P, w, t, +1), fwd_step(model, P, w, t, -1)]
        real = [fwd_step(model, P, levels[t][i], t, +1), fwd_step(model, P, levels[t][i], t, -1)]
        return 'children', at, vals, real
    at, vals, real = [], [], []
    if t == 0:
        return 'parents', at, vals, real
    L = [list(row) for row in levels]
    L[t][i] = w
    for pt, pi in ((t - 1, i - 1), (t - 1, i)):
        if 0 <= pi <= pt:
            at.append([pt, pi])
            vals.append(backward_node(model, P, L, pt, pi))
            real.append(levels[pt][pi])
    return 'parents', at, vals, real


def half_unit(item):
    return 0.5 * 10.0 ** (-item['decimals'])


def fmt(item, v):
    d = item['decimals']
    if abs(round(v, d)) == 0:
        v = 0.0
    if item['unit'] == 'percent':
        return '%.*f%%' % (d, v)
    if item['unit'] == 'currency':
        s = '{:,.{d}f}'.format(abs(v), d=d)
        return ('-$' if v < 0 else '$') + s
    raise ValueError('unknown unit %r' % item['unit'])


def _num_token(display):
    return display.replace('$', '').replace('%', '').replace(',', '').lstrip('-')


def _tex_line(path, line, cache={}):
    if path not in cache:
        with open(os.path.join(ROOT, path), encoding='utf-8') as fh:
            cache[path] = fh.read().split('\n')
    lines = cache[path]
    if not (1 <= line <= len(lines)):
        return None
    return lines[line - 1]


def _norm_tex(s):
    return s.replace('{,}', '').replace(',', '').replace('\\', '')


def number_on_line(path, line, display):
    """True if the display's number is printed on that .tex line (to the display's precision;
    a printed "$2,500" matches "$2,500.00"). Sign is not compared (the notes typeset minus signs
    in several ways)."""
    txt = _tex_line(path, line)
    if txt is None:
        return False
    tok = _num_token(display)
    target = float(tok)
    d = len(tok.split('.')[1]) if '.' in tok else 0
    for m in re.finditer(r'\d+(?:\.\d+)?', _norm_tex(txt)):
        x = m.group(0)
        xd = len(x.split('.')[1]) if '.' in x else 0
        if xd == d and x == tok:
            return True
        if xd == 0 and d > 0 and abs(float(x) - target) < 1e-12:
            return True
    return False


# ---------------------------------------------------------------------------------------------
# Validation

class Fail(Exception):
    pass


def check(cond, msg):
    if not cond:
        raise Fail(msg)


READING_FILE = re.compile(r'_(MR|CR|OR|CI|LR|IM)_([A-Z]+?)(\d+)\.tex$')


def reading_of_file(path):
    m = READING_FILE.search(path)
    if not m:
        return None
    prefix = {'LTR': 'LTR', 'ORR': 'ORR'}.get(m.group(2), m.group(2))
    return '%s-%s' % (prefix, m.group(3))


def validate_item(item, blocks):
    iid = item.get('id', '?')
    for k in ('id', 'reading_id', 'source_block', 'source_file', 'source_line', 'title', 'model',
              'model_code', 'rule', 'params', 'steps', 'quantity', 'direction', 'unit', 'decimals',
              'nodes', 'order', 'candidates', 'phantom', 'notes_check', 'recombining'):
        check(k in item, '%s: missing field %s' % (iid, k))
    check(re.fullmatch(r'tr-[A-Z]+-\d+-\d{2}', iid), '%s: bad id' % iid)
    check(iid.startswith('tr-' + item['reading_id'] + '-'), '%s: id does not carry reading' % iid)
    model = item['model_code']
    check(model in FORWARD_MODELS + BACKWARD_MODELS, '%s: unknown model_code' % iid)
    fwd = model in FORWARD_MODELS
    check(item['direction'] == ('forward' if fwd else 'backward'), '%s: direction' % iid)
    check(item['quantity'] in ('rate', 'price', 'value'), '%s: quantity' % iid)
    check(fwd == (item['quantity'] == 'rate'), '%s: forward items build rates' % iid)
    check(2 <= item['steps'] <= 4, '%s: steps out of 2-4' % iid)
    check(item['recombining'] == RECOMBINING[model], '%s: recombining flag' % iid)
    check(isinstance(item['rule'], str) and '$' in item['rule'], '%s: rule needs $latex$' % iid)

    # sources
    sf = item['source_file']
    check(os.path.isfile(os.path.join(ROOT, sf)), '%s: source_file missing' % iid)
    check(reading_of_file(sf) == item['reading_id'], '%s: source_file is not %s' % (iid, item['reading_id']))
    check(_tex_line(sf, item['source_line']) is not None, '%s: source_line out of range' % iid)
    if item['source_block'] is not None:
        b = blocks.get(item['source_block'])
        check(b is not None, '%s: unknown source_block %s' % (iid, item['source_block']))
        check(b['reading'] == item['reading_id'] and b['source_file'] == sf,
              '%s: source_block belongs elsewhere' % iid)
    for c in item.get('citations', []):
        check(_tex_line(sf, c['line']) is not None, '%s: citation line out of range' % iid)

    # nodes
    levels, routes = compute_levels(item)
    nodes = item['nodes']
    n_levels = len(levels)
    check(len(nodes) == n_levels, '%s: expected %d levels, got %d' % (iid, n_levels, len(nodes)))
    if fwd:
        check(n_levels == item['steps'] + 1, '%s: forward tree needs steps+1 levels' % iid)
    given = set()
    for t, row in enumerate(nodes):
        check(len(row) == t + 1, '%s: level %d must have %d nodes' % (iid, t, t + 1))
        for i, nd in enumerate(row):
            check(nd['t'] == t and nd['i'] == i, '%s: node index (%d,%d)' % (iid, t, i))
            check(abs(nd['value'] - levels[t][i]) <= TOL,
                  '%s: node (%d,%d) = %r, recomputed %r' % (iid, t, i, nd['value'], levels[t][i]))
            check(nd['display'] == fmt(item, levels[t][i]), '%s: display (%d,%d)' % (iid, t, i))
            if nd.get('given'):
                given.add((t, i))
            if fwd:
                cf = forward_closed_form(model, item['params'], t, i)
                if cf is not None:
                    check(abs(cf - levels[t][i]) <= TOL, '%s: closed form (%d,%d)' % (iid, t, i))
    check((0, 0) in given if fwd else True, '%s: forward root must be given' % iid)

    # recombination
    if fwd:
        for t in range(1, n_levels):
            for i in range(1, t):
                up, dn = routes[t][i]
                if RECOMBINING[model]:
                    check(abs(up - dn) <= TOL, '%s: (%d,%d) does not recombine' % (iid, t, i))
                else:
                    check(abs(up - dn) > TOL, '%s: Vasicek routes unexpectedly equal' % iid)
                    check(abs(levels[t][i] - (up + dn) / 2) <= TOL, '%s: middle not averaged' % iid)
        P = item['params']
        if 'sigma_sqrt_dt' in P:
            check(model in ('model1', 'model2', 'holee'), '%s: printed step only for normal models' % iid)
            check(abs(P['sigma_sqrt_dt'] - P['sigma'] * math.sqrt(P['dt'])) < 0.0005,
                  '%s: printed sigma*sqrt(dt) is not a rounding of the exact step' % iid)
        if model == 'vasicek':
            if 'r1' in P and 'lambda' in P:
                check(abs(P['theta'] - (P['r1'] + P['lambda'] / P['k'])) <= 1e-9,
                      '%s: theta != r1 + lambda/k' % iid)
            check(item.get('recombine_fix') == 'average-middle', '%s: recombine_fix' % iid)
    else:
        rates = item['params']['rates']
        for t, row in enumerate(rates):
            check(len(row) == t + 1, '%s: rate tree level %d shape' % (iid, t))

    # notes_check
    for nc in item['notes_check']:
        t, i = nc['node']
        check(nc['display'] == nodes[t][i]['display'],
              '%s: notes say %s at (%d,%d), tree has %s' % (iid, nc['display'], t, i, nodes[t][i]['display']))
        check(number_on_line(sf, nc['source_line'], nc['display']),
              '%s: %s not found on line %d' % (iid, nc['display'], nc['source_line']))
    if item.get('params_source', '').startswith('notes'):
        check(len(item['notes_check']) >= 2, '%s: notes-sourced item must cite notes numbers' % iid)

    # order
    order = [tuple(x) for x in item['order']]
    expected = {(t, i) for t in range(n_levels) for i in range(t + 1)} - given
    check(len(order) == len(set(order)), '%s: order repeats a node' % iid)
    check(set(order) == expected, '%s: order must visit every non-given node' % iid)
    ts = [t for t, _ in order]
    check(ts == sorted(ts) if fwd else ts == sorted(ts, reverse=True), '%s: order direction' % iid)

    # candidates + phantom
    check(len(item['candidates']) == len(order), '%s: candidates misaligned' % iid)
    check(len(item['phantom']) == len(order), '%s: phantom misaligned' % iid)
    hu = half_unit(item)
    for (t, i), cands, phs in zip(order, item['candidates'], item['phantom']):
        tag = '%s (%d,%d)' % (iid, t, i)
        check(len(cands) == 3, '%s: need 3 candidates' % tag)
        correct = [c for c in cands if c['correct']]
        check(len(correct) == 1, '%s: exactly one correct' % tag)
        check(abs(correct[0]['value'] - levels[t][i]) <= TOL, '%s: correct != node' % tag)
        check(correct[0]['display'] == nodes[t][i]['display'], '%s: correct display' % tag)
        check(correct[0]['mistake'] is None, '%s: correct has a mistake' % tag)
        for a in range(3):
            check(cands[a]['display'] == fmt(item, cands[a]['value']), '%s: candidate display' % tag)
            for b in range(a + 1, 3):
                check(abs(cands[a]['value'] - cands[b]['value']) > hu,
                      '%s: candidates within rounding' % tag)
                check(cands[a]['display'] != cands[b]['display'], '%s: duplicate display' % tag)
        wrong = [c for c in cands if not c['correct']]
        for c in wrong:
            code = c['mistake_code']
            check(code in MISTAKES and c['mistake'] == MISTAKES[code], '%s: mistake label %s' % (tag, code))
            w = wrong_value(item, levels, routes, t, i, code)
            check(w is not None, '%s: mistake %s not applicable' % (tag, code))
            check(abs(w - c['value']) <= TOL, '%s: %s recomputes to %r not %r' % (tag, code, w, c['value']))
            if c.get('source_line'):
                check(number_on_line(sf, c['source_line'], c['display']),
                      '%s: wrong-path %s not on line %d' % (tag, c['display'], c['source_line']))
        check(len(phs) == 2 and {p['mistake_code'] for p in phs} == {c['mistake_code'] for c in wrong},
              '%s: one phantom per wrong candidate' % tag)
        nxt = levels[t + 1] if (fwd and t + 1 < n_levels) else []
        for p in phs:
            w = [c for c in wrong if c['mistake_code'] == p['mistake_code']][0]['value']
            check(abs(p['from_value'] - w) <= TOL, '%s: phantom from_value' % tag)
            kind, at, vals, real = phantom_for(item, levels, t, i, w)
            check(p['kind'] == kind and p['at'] == at, '%s: phantom positions' % tag)
            check(len(p['values']) == len(vals) and len(p['real']) == len(real), '%s: phantom size' % tag)
            for x, y in zip(p['values'], vals):
                check(abs(x - y) <= TOL, '%s: phantom value recompute' % tag)
            for x, y in zip(p['real'], real):
                check(abs(x - y) <= TOL, '%s: phantom real recompute' % tag)
            check(p['displays'] == [fmt(item, x) for x in vals], '%s: phantom displays' % tag)
            check(p.get('beyond_tree') is (kind == 'children' and t + 1 >= n_levels),
                  '%s: beyond_tree flag' % tag)
            if kind == 'children':
                check(len(vals) == 2, '%s: forward phantom needs two children' % tag)
                for x, y in zip(vals, real):
                    check(abs(x - y) > hu, '%s: phantom child meets the real child' % tag)
                for x in vals:
                    for y in nxt:
                        check(abs(x - y) > hu, '%s: phantom child lands on a real node' % tag)
            else:
                check(len(vals) >= (1 if t > 0 else 0), '%s: backward phantom needs a parent' % tag)
                for x, y in zip(vals, real):
                    check(abs(x - y) > hu, '%s: phantom parent equals the real parent' % tag)
    return len(order)


def load_blocks():
    with open(BLOCKS_JSON, encoding='utf-8') as fh:
        data = json.load(fh)
    out = {}
    for rid, r in data['readings'].items():
        for o in r['objectives']:
            for b in o['blocks']:
                out[b['id']] = {'reading': rid, 'source_file': b['source_file'],
                                'source_line': b['source_line']}
    return out


def main(argv):
    path = argv[1] if len(argv) > 1 else DEFAULT_JSON
    with open(path, encoding='utf-8') as fh:
        doc = json.load(fh)
    check(doc.get('version') == 1, 'version must be 1')
    check(doc.get('mechanic') == MECHANIC, 'mechanic must be %s' % MECHANIC)
    items = doc.get('items')
    check(isinstance(items, list) and items, 'items must be a non-empty list')
    ids = [it['id'] for it in items]
    check(len(ids) == len(set(ids)), 'duplicate item ids')
    blocks = load_blocks()
    visited = 0
    for it in items:
        visited += validate_item(it, blocks)
    readings = sorted({it['reading_id'] for it in items})
    print('OK %s: %d items, %d raced nodes, readings %s' % (MECHANIC, len(items), visited, ', '.join(readings)))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except Fail as e:
        print('FAIL:', e)
        sys.exit(1)
