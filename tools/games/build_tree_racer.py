#!/usr/bin/env python3
"""Builds content/games/mechanics/tree-racer.json from the notes' lattice examples.

    python3 tools/games/build_tree_racer.py && python3 tools/games/validate_tree_racer.py

Every node value is computed with the lattice engine in validate_tree_racer.py from the params
below. Items marked params_source "notes..." reproduce a worked tree from the notes and list
the printed numbers in notes_check (the validator greps each one on its cited line). Items
marked "variant..." apply a rule the notes state (symbolically) to illustrative parameters.
"""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import validate_tree_racer as E  # noqa: E402

V2 = 'notes/FRM_Consolidated_Vol2/ch/'
MR12, MR13, MR14, MR15 = V2 + '44_MR_MR12.tex', V2 + '50_MR_MR13.tex', V2 + '21_MR_MR14.tex', V2 + '22_MR_MR15.tex'

FWD_MISTAKES = ['route_up', 'route_down', 'stale_drift', 'drift_omitted', 'sigma_unscaled',
                'drift_unscaled', 'sigma_dt', 'constant_drift', 'proportional_step', 'up_down_swapped']

SPECS = [
    # ------------------------------------------------------------------ MR-14 forward trees
    dict(
        id='tr-MR-14-01', reading_id='MR-14', source_block='mr14.b.tikzpicture.1', source_file=MR14,
        source_line=82,
        title='Model 1 tree: 6% today, 120 bp volatility, monthly steps',
        model='Model 1 (normal, no drift)', model_code='model1',
        rule=r'$dr = \sigma\,dw$; tree: up $r + \sigma\sqrt{dt}$, down $r - \sigma\sqrt{dt}$, probability 0.5 each',
        params=dict(r0=6.0, sigma=1.2, dt=1 / 12, sigma_sqrt_dt=0.346, p=0.5),
        param_units=dict(r0='% per year', sigma='% (basis-point volatility) per year', dt='years', sigma_sqrt_dt='% per step, as printed in the notes (1.20% x 0.2887 = 0.3464, rounded to 0.346 before the tree is built)', p='probability'),
        params_source='notes: r0 = 6%, sigma = 1.20%, one-month step (l.52); numeric tree l.82-87',
        steps=2, quantity='rate', unit='percent', decimals=3,
        citations=[dict(line=46, note='tree rule'), dict(line=52, note='r0 6%, sigma 1.20%, one month'),
                   dict(line=93, note='Model 1 recombines: up-then-down and down-then-up land on r0')],
        notes_check=[((1, 1), 83), ((1, 0), 84), ((2, 2), 85), ((2, 1), 86), ((2, 0), 87)],
        mistakes=['sigma_unscaled', 'sigma_dt', 'up_down_swapped'],
        teaches='With no drift the middle node returns exactly to r0; the tree only recombines because every step is the same +/- sigma sqrt(dt).',
    ),
    dict(
        id='tr-MR-14-02', reading_id='MR-14', source_block='mr14.b.exbox.1', source_file=MR14,
        source_line=98,
        title='Model 1 tree: 6.18% today, 113 bp volatility, three monthly steps',
        model='Model 1 (normal, no drift)', model_code='model1',
        rule=r'$\sigma\sqrt{dt} = 1.13\% \times \sqrt{1/12} = 0.326\%$; up $r + \sigma\sqrt{dt}$, down $r - \sigma\sqrt{dt}$',
        params=dict(r0=6.18, sigma=1.13, dt=1 / 12, sigma_sqrt_dt=0.326, p=0.5),
        param_units=dict(r0='% per year', sigma='% per year', dt='years', sigma_sqrt_dt='% per step, as printed in the notes (l.102-103)', p='probability'),
        params_source='notes: r0, sigma, dt and both date-1 nodes (l.98-105); dates 2-3 recomputed with the same rule',
        steps=3, quantity='rate', unit='percent', decimals=3,
        citations=[dict(line=102, note='sigma sqrt(dt) = 0.326%'), dict(line=46, note='tree rule')],
        notes_check=[((1, 1), 104), ((1, 0), 105)],
        mistakes=['sigma_unscaled', 'sigma_dt', 'up_down_swapped'],
        teaches='The one-month step is sigma times sqrt(1/12) = 0.2887, not sigma itself and not sigma/12.',
    ),
    dict(
        id='tr-MR-14-03', reading_id='MR-14', source_block='mr14.d.tikzpicture.1', source_file=MR14,
        source_line=165,
        title='Model 2 tree: constant drift shifts every node up by lambda dt',
        model='Model 2 (normal, constant drift)', model_code='model2',
        rule=r'$dr = \lambda\,dt + \sigma\,dw$; up $r + \lambda dt + \sigma\sqrt{dt}$, down $r + \lambda dt - \sigma\sqrt{dt}$; middle at date 2 is $r_0 + 2\lambda dt$',
        params=dict(r0=6.2, **{'lambda': 0.36}, sigma=1.5, dt=1 / 12, p=0.5),
        param_units=dict(r0='% per year', **{'lambda': '% per year'}, sigma='% per year', dt='years', p='probability'),
        params_source='variant: the notes give Model 2 symbolically (l.165-169); r0 6.2%, sigma 150 bp and annual drift 0.36% are borrowed from the MR-14 f example (l.284-285)',
        steps=3, quantity='rate', unit='percent', decimals=3,
        citations=[dict(line=155, note='process'), dict(line=174, note='tree shifts up by lambda dt each step; recombines'),
                   dict(line=284, note='parameter values borrowed from the Vasicek example')],
        notes_check=[],
        mistakes=['drift_omitted', 'sigma_unscaled', 'drift_unscaled'],
        teaches='Adding the same lambda dt on every branch moves the whole lattice up but keeps it recombining.',
    ),
    dict(
        id='tr-MR-14-04', reading_id='MR-14', source_block='mr14.d.tikzpicture.2', source_file=MR14,
        source_line=214,
        title='Ho-Lee tree: a different drift each quarter, one of them negative',
        model='Ho-Lee (time-dependent drift)', model_code='holee',
        rule=r'$dr = \lambda_t\,dt + \sigma\,dw$; step $t$ uses its own drift: $r + \lambda_t dt \pm \sigma\sqrt{dt}$; middle at date 2 is $r_0 + (\lambda_1+\lambda_2)dt$',
        params=dict(r0=5.0, lambda_t=[1.2, -0.8, 0.4, 0.4], sigma=1.2, dt=0.25, p=0.5),
        param_units=dict(r0='% per year', lambda_t='% per year, one per step (lambda_1..lambda_4)', sigma='% per year', dt='years', p='probability'),
        params_source='variant: the notes give the Ho-Lee tree symbolically (l.213-218) and allow negative drifts (l.229); values are illustrative. lambda_4 only places the phantom children beyond date 3',
        steps=3, quantity='rate', unit='percent', decimals=3,
        citations=[dict(line=204, note='process'), dict(line=226, note='lambda_1 = lambda_2 reduces to Model 2'),
                   dict(line=229, note='drift can be negative'), dict(line=498, note='Ho-Lee recombines')],
        notes_check=[],
        mistakes=['constant_drift', 'drift_omitted', 'sigma_unscaled', 'drift_unscaled'],
        teaches='Time-dependent drift still recombines: the drift depends on the date, not on where the rate is.',
    ),
    dict(
        id='tr-MR-14-05', reading_id='MR-14', source_block='mr14.f.exbox.2', source_file=MR14,
        source_line=303,
        title='Vasicek tree from 6.2%: the middle node needs averaging',
        model='Vasicek (mean reversion)', model_code='vasicek',
        rule=r'$dr = k(\theta - r)dt \pm \sigma\sqrt{dt}$ with the drift recomputed at each node; the two middle rates are averaged to force recombination',
        params=dict(r0=6.2, k=0.03, theta=18.0, r1=6.0, **{'lambda': 0.36}, sigma=1.5, dt=1 / 12, p=0.5),
        param_units=dict(r0='% per year', k='per year', theta='% (theta ~ r1 + lambda/k)', r1='% true long-run rate',
                         **{'lambda': '% annual drift'}, sigma='% per year', dt='years', p='probability'),
        params_source='notes: k 0.03, sigma 150 bp, r1 6%, r0 6.2%, drift 0.36% => theta 18% (l.284-288); tree l.303-351',
        recombine_fix='average-middle',
        steps=2, quantity='rate', unit='percent', decimals=3,
        citations=[dict(line=273, note='theta ~ r1 + lambda/k'), dict(line=296, note='add sigma for up, subtract for down'),
                   dict(line=313, note='drift recomputed at each date-1 rate'), dict(line=344, note='mean reversion breaks recombination'),
                   dict(line=350, note='average the two middle nodes')],
        notes_check=[((1, 1), 307), ((1, 0), 309), ((2, 2), 317), ((2, 1), 351), ((2, 0), 320)],
        candidate_lines={((2, 1), 'route_up'): 318, ((2, 1), 'route_down'): 320},
        mistakes=['route_up', 'route_down', 'drift_omitted', 'sigma_unscaled', 'stale_drift', 'drift_unscaled'],
        teaches='Because the drift depends on the rate, up-then-down (6.258%) and down-then-up (6.260%) disagree; the notes average them to 6.259%.',
    ),
    dict(
        id='tr-MR-14-06', reading_id='MR-14', source_block='mr14.f.keybox.1', source_file=MR14,
        source_line=350,
        title='Vasicek tree with fast reversion: a visible gap at the middle node',
        model='Vasicek (mean reversion)', model_code='vasicek',
        rule=r'$dr = k(\theta - r)dt \pm \sigma\sqrt{dt}$ with the drift recomputed at each node; the two middle rates are averaged to force recombination',
        params=dict(r0=4.0, k=0.5, theta=8.0, sigma=1.5, dt=0.25, p=0.5),
        param_units=dict(r0='% per year', k='per year', theta='% long-run level', sigma='% per year', dt='years', p='probability'),
        params_source='variant: same Vasicek tree procedure (l.303-351) with a high k (faster reversion, l.274) and quarterly steps so the two middle routes differ visibly; values are illustrative',
        recombine_fix='average-middle',
        steps=2, quantity='rate', unit='percent', decimals=3,
        citations=[dict(line=274, note='high k means faster mean reversion'), dict(line=344, note='mean reversion breaks recombination'),
                   dict(line=350, note='average the two middle nodes')],
        notes_check=[],
        mistakes=FWD_MISTAKES,
        teaches='The faster the reversion, the further apart the two routes to the middle node land before averaging.',
    ),
    # ------------------------------------------------------------------ MR-15 forward tree
    dict(
        id='tr-MR-15-01', reading_id='MR-15', source_block='mr15.f.tikzpicture.2', source_file=MR15,
        source_line=307,
        title='Salomon Brothers lognormal tree: multiplicative steps',
        model='Model 4, lognormal with deterministic drift (Salomon Brothers)', model_code='lognormal_sb',
        rule=r'$d[\ln(r)] = a(t)\,dt + \sigma\,dw$: up $r\,e^{(a_t dt + \sigma\sqrt{dt})}$, down $r\,e^{(a_t dt - \sigma\sqrt{dt})}$; middle at date 2 is $r_0\,e^{(a_1+a_2)dt}$',
        params=dict(r0=5.0, a=[0.10, 0.05, -0.05, 0.0], sigma=0.20, dt=0.25, p=0.5),
        param_units=dict(r0='% per year', a='drift of ln(r) per year, one per step (a_1..a_4)', sigma='yield volatility of ln(r) per sqrt(year)', dt='years', p='probability'),
        params_source='variant: the notes give the tree symbolically in ln(r) and in r (l.289-311); values are illustrative. a_4 only places the phantom children beyond date 3',
        steps=3, quantity='rate', unit='percent', decimals=3,
        citations=[dict(line=276, note='process on ln(r)'), dict(line=318, note='steps become multiplicative'),
                   dict(line=325, note='all rates stay positive')],
        notes_check=[],
        mistakes=['proportional_step', 'drift_omitted', 'sigma_unscaled', 'constant_drift', 'drift_unscaled'],
        teaches='In ln(r) space the steps add, so the rate lattice multiplies and still recombines: r0 e^{(a1+a2)dt} sits in the middle.',
    ),
    # ------------------------------------------------------------------ MR-12 backward trees
    dict(
        id='tr-MR-12-01', reading_id='MR-12', source_block='mr12.d.exbox.1', source_file=MR12,
        source_line=176,
        title='Two-year zero by backward induction (true probabilities)',
        model='Backward induction, zero-coupon bond', model_code='zero_backward',
        rule=r'At each node $V = \frac{q\,V_u + (1-q)\,V_d}{1 + r}$: the average of discounted future values, discounted at the forward rate of the current node',
        params=dict(rates=[[4.5749], [5.3210, 7.1826]], q=[0.5, 0.5], face=100.0, coupon=0.0, accrual=1.0, maturity_steps=2),
        param_units=dict(rates='% per year, rates[t][i] with i = up moves', q='up probability per date', face='$', coupon='$', accrual='year fraction per step', maturity_steps='years'),
        params_source='notes: rate tree and q = 0.5 (l.158-167), three-step induction l.179-184',
        steps=2, quantity='price', unit='currency', decimals=3,
        citations=[dict(line=44, note='average of discounted future values'), dict(line=46, note="discount at the node's forward rate"),
                   dict(line=190, note='q = 0.5 means true probabilities')],
        notes_check=[((1, 1), 180), ((1, 0), 182), ((0, 0), 184)],
        mistakes=['root_rate', 'sibling_rate', 'not_discounted', 'flat_root_rate_all_periods', 'probs_swapped'],
        teaches="Each node discounts at its own forward rate, not today's rate and not its sibling's.",
    ),
    dict(
        id='tr-MR-12-02', reading_id='MR-12', source_block='mr12.e.exbox.2', source_file=MR12,
        source_line=234,
        title='Three-year 7% coupon bond on a risk-neutral tree',
        model='Backward induction, coupon bond', model_code='zero_backward',
        rule=r'$V = \frac{q\,(V_u + C) + (1-q)\,(V_d + C)}{1 + r}$: add the \$7 coupon to each child price before discounting at the node rate',
        params=dict(rates=[[3.00], [4.44, 5.99], [4.70, 6.34, 8.56]], q=[0.76, 0.60, None], face=100.0, coupon=7.0, accrual=1.0, maturity_steps=3),
        param_units=dict(rates='% per year', q='risk-neutral up probability per date (null: both children are the $107 maturity payment)', face='$', coupon='$ per year', accrual='year fraction per step', maturity_steps='years'),
        params_source='notes: rate tree and probabilities (l.212-223), bond prices l.236-247',
        steps=3, quantity='price', unit='currency', decimals=2,
        citations=[dict(line=204, note='fill bond prices first by backward induction'), dict(line=259, note='add the coupon before discounting')],
        notes_check=[((2, 2), 215), ((2, 1), 237), ((2, 0), 238), ((1, 1), 242), ((1, 0), 243), ((0, 0), 247)],
        mistakes=['coupon_omitted', 'root_rate', 'probs_swapped', 'sibling_rate', 'not_discounted'],
        teaches='The middle year-2 price ($100.62) is shared by both year-1 nodes; forgetting the coupon breaks every node above it.',
    ),
    dict(
        id='tr-MR-12-03', reading_id='MR-12', source_block='mr12.e.exbox.3', source_file=MR12,
        source_line=251,
        title='European call (strike 100) on the 7% bond',
        model='Backward induction, option on a bond', model_code='option_backward',
        rule=r'At expiry $\max(B - K, 0)$ on the ex-coupon bond price; then $O = \frac{q\,O_u + (1-q)\,O_d}{1 + r}$. Option values carry no coupon',
        params=dict(rates=[[3.00], [4.44, 5.99], [4.70, 6.34, 8.56]], q=[0.76, 0.60, None], face=100.0, coupon=7.0, accrual=1.0, maturity_steps=3, strike=100.0, expiry_step=2),
        param_units=dict(rates='% per year', q='risk-neutral up probability per date', face='$', coupon='$ per year', accrual='year fraction per step', maturity_steps='bond maturity (years)', strike='$', expiry_step='option expiry (years)'),
        params_source='notes: same tree (l.212-223); option values l.212-217 and l.253-255',
        steps=2, quantity='value', unit='currency', decimals=2,
        citations=[dict(line=204, note='bond prices first, then option values'), dict(line=260, note='option values carry no coupon')],
        notes_check=[((2, 2), 215), ((2, 1), 216), ((2, 0), 217), ((1, 1), 253), ((1, 0), 214), ((0, 0), 255)],
        mistakes=['option_not_floored', 'option_cum_coupon', 'option_sign_flipped', 'option_coupon_added', 'probs_swapped', 'not_discounted'],
        teaches='The option rides on the same recombining lattice: the middle payoff $0.62 feeds both year-1 option values.',
    ),
    dict(
        id='tr-MR-12-04', reading_id='MR-12', source_block='mr12.h.exbox.2', source_file=MR12,
        source_line=375,
        title='Constant-maturity Treasury swap, semiannual tree',
        model='Backward induction, CMT swap', model_code='cmt_swap',
        rule=r'Payoff $= \frac{\$1{,}000{,}000}{2}(y_{CMT} - 7\%)$; $V = \frac{q\,V_u + (1-q)\,V_d}{1 + r/2} + \text{payoff}$',
        params=dict(rates=[[7.00], [6.75, 7.25], [6.50, 7.00, 7.50]], q=[0.76, 0.60], notional=1000000.0, fixed_rate=7.00, accrual=0.5, steps=2, round_nodes=2),
        param_units=dict(rates='% (semiannually compounded)', q='risk-neutral up probability per date', notional='$', fixed_rate='%', accrual='year fraction per step', steps='six-month steps', round_nodes='node values carried to the cent, as the notes do (unrounded V_0 would be $1,466.62)'),
        params_source='notes: rate tree and probabilities (l.344-355), payoffs l.366-370, values l.378-383',
        given_nodes=[(2, 1)],
        steps=2, quantity='value', unit='currency', decimals=2,
        citations=[dict(line=333, note='payoff formula'), dict(line=335, note='semiannual; fixed rate 7.00%'),
                   dict(line=388, note='carry the middle $0 and add the node payoff')],
        notes_check=[((2, 2), 347), ((2, 1), 348), ((2, 0), 349), ((1, 1), 379), ((1, 0), 381), ((0, 0), 383)],
        mistakes=['accrual_not_halved', 'payoff_sign_flipped', 'payoff_omitted', 'annual_discount', 'probs_swapped', 'not_discounted'],
        teaches='Each six-month node adds its own payoff after discounting at r/2; the $0 middle node is shared by both branches.',
    ),
    # ------------------------------------------------------------------ MR-13 backward trees
    dict(
        id='tr-MR-13-01', reading_id='MR-13', source_block='mr13.b.exbox.1', source_file=MR13,
        source_line=157,
        title='Two-year zero on the 8% / 10% / 6% tree (convexity)',
        model='Backward induction, zero-coupon bond', model_code='zero_backward',
        rule=r'$[0.5 \times (V_u / 1.08)] + [0.5 \times (V_d / 1.08)]$ with $V_u = \$1/1.10$, $V_d = \$1/1.06$',
        params=dict(rates=[[8.0], [6.0, 10.0], [4.0, 8.0, 12.0]], q=[0.5, 0.5], face=1.0, coupon=0.0, accrual=1.0, maturity_steps=2),
        param_units=dict(rates='% per year (date-2 rates are shown in the notes but not needed for a 2-year zero)', q='probability', face='$', coupon='$', accrual='year fraction', maturity_steps='years'),
        params_source='notes: rate tree 8% -> 10%/6% -> 12%/8%/4% at 50% (l.127-134), price tree l.139-160',
        steps=2, quantity='price', unit='currency', decimals=5,
        citations=[dict(line=153, note='upper and lower year-1 prices'), dict(line=170, note='convexity worth 1.84 bp')],
        notes_check=[((1, 1), 140), ((1, 0), 141), ((0, 0), 160)],
        node_mistakes={(0, 0): ['not_discounted', 'flat_root_rate_all_periods', 'child_rate']},
        candidate_lines={((0, 0), 'not_discounted'): 260, ((0, 0), 'flat_root_rate_all_periods'): 270},
        mistakes=['root_rate', 'child_rate', 'sibling_rate', 'not_discounted'],
        teaches="Averaging discounted values ($0.85763) beats discounting at the average rate ($0.85734): Jensen's inequality on the lattice.",
    ),
    dict(
        id='tr-MR-13-02', reading_id='MR-13', source_block='mr13.d.exbox.2', source_file=MR13,
        source_line=351,
        title='Two-year zero with a 20 bp risk premium at the next node',
        model='Backward induction, zero with risk premium', model_code='zero_backward',
        rule=r'Add 20 bp to each one-year rate at the next node: $P = \frac{[\$1/1.102 + \$1/1.062] \times 0.5}{1.08}$',
        params=dict(rates=[[8.0], [6.0, 10.0]], q=[0.5, 0.5], face=1.0, coupon=0.0, accrual=1.0, maturity_steps=2, premium=0.20),
        param_units=dict(rates='% per year', q='probability', face='$', coupon='$', accrual='year fraction', maturity_steps='years', premium='% added to every rate after today'),
        params_source='notes: tree and premium (l.352-353), prices l.356-358',
        steps=2, quantity='price', unit='currency', decimals=5,
        citations=[dict(line=352, note='add 20 bp to each one-year rate at the next node'), dict(line=371, note='expected return 8.2%')],
        notes_check=[((1, 1), 357), ((1, 0), 357), ((0, 0), 358)],
        node_mistakes={(0, 0): ['premium_omitted', 'premium_on_root', 'not_discounted']},
        candidate_lines={((1, 1), 'premium_omitted'): 363, ((0, 0), 'premium_omitted'): 160},
        mistakes=['premium_omitted', 'sibling_rate', 'root_rate', 'not_discounted'],
        teaches="The premium sits on next year's rates only; today's 8% is not adjusted.",
    ),
]


def node_order(item, levels, given):
    n = len(levels)
    ts = range(n) if item['direction'] == 'forward' else range(n - 1, -1, -1)
    return [[t, i] for t in ts for i in range(t, -1, -1) if (t, i) not in given]


def build_item(spec):
    spec = dict(spec)
    notes_check = spec.pop('notes_check')
    mistakes = spec.pop('mistakes')
    node_mistakes = spec.pop('node_mistakes', {})
    cand_lines = spec.pop('candidate_lines', {})
    given_extra = set(spec.pop('given_nodes', []))
    item = dict(spec)
    item['direction'] = 'forward' if item['model_code'] in E.FORWARD_MODELS else 'backward'
    item['recombining'] = E.RECOMBINING[item['model_code']]
    item.setdefault('recombine_fix', None)
    levels, routes = E.compute_levels(item)
    given = set(given_extra)
    if item['direction'] == 'forward':
        given.add((0, 0))
    elif item['model_code'] == 'zero_backward':
        T = len(levels) - 1
        given |= {(T, i) for i in range(T + 1)}
    item['nodes'] = [[dict(t=t, i=i, value=v, display=E.fmt(item, v), **({'given': True} if (t, i) in given else {}))
                      for i, v in enumerate(row)] for t, row in enumerate(levels)]
    if item['model_code'] == 'option_backward':
        B = E.bond_tree(item['params'])
        item['underlying'] = [[dict(t=t, i=i, value=v, display=E.fmt(item, v)) for i, v in enumerate(B[t])]
                              for t in range(item['params']['expiry_step'] + 1)]
    order = node_order(item, levels, given)
    item['order'] = order
    hu = E.half_unit(item)
    cands_all, ph_all = [], []
    for t, i in order:
        real = levels[t][i]
        nxt = levels[t + 1] if (item['direction'] == 'forward' and t + 1 < len(levels)) else []
        chosen = []
        for code in node_mistakes.get((t, i), mistakes):
            w = E.wrong_value(item, levels, routes, t, i, code)
            if w is None or abs(w - real) <= hu or E.fmt(item, w) == E.fmt(item, real):
                continue
            if any(abs(w - c[1]) <= hu or E.fmt(item, w) == E.fmt(item, c[1]) for c in chosen):
                continue
            kind, at, vals, rv = E.phantom_for(item, levels, t, i, w)
            if any(abs(x - y) <= hu for x, y in zip(vals, rv)):
                continue
            if any(abs(x - y) <= hu for x in vals for y in nxt):
                continue
            chosen.append((code, w, kind, at, vals, rv))
            if len(chosen) == 2:
                break
        if len(chosen) < 2:
            raise SystemExit('%s (%d,%d): only %d usable mistakes' % (item['id'], t, i, len(chosen)))
        cands = [dict(value=real, display=E.fmt(item, real), correct=True, mistake=None, mistake_code=None)]
        phs = []
        for code, w, kind, at, vals, rv in chosen:
            c = dict(value=w, display=E.fmt(item, w), correct=False, mistake=E.MISTAKES[code], mistake_code=code)
            if ((t, i), code) in cand_lines:
                c['source_line'] = cand_lines[((t, i), code)]
            cands.append(c)
            phs.append(dict(mistake_code=code, from_value=w, kind=kind, at=at, values=vals, real=rv,
                            displays=[E.fmt(item, x) for x in vals],
                            beyond_tree=(kind == 'children' and t + 1 >= len(levels))))
        random.Random('%s:%d:%d' % (item['id'], t, i)).shuffle(cands)
        cands_all.append(cands)
        ph_all.append(phs)
    item['candidates'] = cands_all
    item['phantom'] = ph_all
    item['notes_check'] = [dict(node=[t, i], display=item['nodes'][t][i]['display'], source_line=ln)
                           for (t, i), ln in notes_check]
    key_order = ['id', 'reading_id', 'source_block', 'source_file', 'source_line', 'title', 'model', 'model_code',
                 'rule', 'params', 'param_units', 'params_source', 'steps', 'quantity', 'direction', 'unit',
                 'decimals', 'recombining', 'recombine_fix', 'teaches', 'citations', 'nodes', 'underlying',
                 'order', 'candidates', 'phantom', 'notes_check']
    return {k: item[k] for k in key_order if k in item}


def main():
    items = [build_item(s) for s in SPECS]
    out = os.path.join(E.ROOT, 'content', 'games', 'mechanics', 'tree-racer.json')
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(dict(version=1, mechanic='tree-racer', items=items), fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print('wrote %s (%d items)' % (out, len(items)))


if __name__ == '__main__':
    main()
