#!/usr/bin/env python3
"""Builds content/games/mechanics/tail-shaper.json (Tail Shaper mechanic).

    python3 tools/games/build_tail_shaper.py && python3 tools/games/validate_tail-shaper.py

Every item is hand-curated from the notes (MR-17, MR-1, MR-3); this script only assembles the
JSON, evaluates the notes' own illustrative curves on a fixed moneyness grid, and attaches
reference numbers (peak, mean, sd, left mass) computed with the validator's density engine.
"""
import importlib.util
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'content', 'games', 'mechanics', 'tail-shaper.json')

_spec = importlib.util.spec_from_file_location('vts', os.path.join(HERE, 'validate_tail-shaper.py'))
V = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(V)

MR17 = 'notes/FRM_Consolidated_Vol2/ch/09_MR_MR17.tex'
MR1 = 'notes/FRM_Consolidated_Vol2/ch/26_MR_MR1.tex'
MR3 = 'notes/FRM_Consolidated_Vol2/ch/29_MR_MR3.tex'

MONEYNESS = [0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20, 1.25]

# The notes' own illustrative curves (pgfplots expressions, x = X/S0).
FX_SMILE = ('16 + 62*(x-1)^2', MR17, 58)
EQ_SKEW = ('14.5 + 9.5*exp(-4.2*(x-0.72))', MR17, 72)
SMILE_1M = ('17 + 150*(x-1)^2', MR17, 382)
SMILE_2Y = ('19.6 + 16*(x-1)^2', MR17, 391)
SKEW_ORIG = ('16 + 11*exp(-4.2*(x-0.74))', MR17, 441)
SKEW_DOWN = ('13.2 + 11*exp(-4.2*(x-0.74))', MR17, 444)
FLAT = ('18', None, None)

NOTE_NOTES = ('Illustrative: the curve plotted in the notes at {file}:{line} (pgfplots expression '
              '{formula}), sampled at X/S0 = 0.75..1.25. Only its shape is examinable; the notes '
              'give no market levels.')
NOTE_FLAT = ('Illustrative: a flat line at an arbitrary 18% level. The notes give no flat curve; '
             'the level is a placeholder and only the flatness is the point (one BSM volatility '
             'prices every strike when the implied distribution is lognormal).')

FREE_MU = (0.0, 4.0)      # target, tolerance admitting the whole [-2, 2] range
FREE_S = (1.0, 2.0)       # target, tolerance admitting the whole [0.5, 3] range


def curve(spec, extra=None):
    formula, f, line = spec
    pts = [[x, round(V.eval_formula(formula, x), 2)] for x in MONEYNESS]
    out = {'formula': formula,
           'formula_source': {'file': f, 'line': line} if f else None,
           'points': pts,
           'smile_note': NOTE_NOTES.format(file=f, line=line, formula=formula) if f else NOTE_FLAT}
    if extra:
        out.update(extra)
    return out


def params(nuL, nuR, mu, s):
    return {'nuL': nuL, 'nuR': nuR, 'mu': mu, 's': s}


def tails(kind):
    """(target, tolerance) for nuL and nuR by tail shape."""
    return {
        'both_heavy': ((4.0, 1.5), (4.0, 1.5)),          # [2.5, 5.5] each
        'both_very_heavy': ((3.5, 1.0), (3.5, 1.0)),     # [2.5, 4.5]
        'both_moderate': ((12.0, 4.0), (12.0, 4.0)),     # [8, 16]
        'left_heavy': ((4.0, 1.5), (50.0, 15.0)),        # nuL [2.5, 5.5], nuR [35, 60]
        'both_light': ((45.0, 15.0), (45.0, 15.0)),      # [30, 60]
    }[kind]


def make(iid, rid, block, sfile, sline, title, description, kind, label, smile_spec, start,
         explanation, citations, s_rule=None, extra_smile=None, contrasts=None):
    (tl, dl), (tr, dr) = tails(kind)
    s_t, s_d = s_rule if s_rule else FREE_S
    target = params(tl, tr, FREE_MU[0], s_t)
    tol = params(dl, dr, FREE_MU[1], s_d)
    matters = ['nuL', 'nuR'] + (['s'] if s_rule else [])
    sm = {'label': label}
    sm.update(curve(smile_spec, extra_smile))
    item = {
        'id': iid, 'reading_id': rid, 'source_block': block, 'source_file': sfile,
        'source_line': sline, 'title': title, 'description': description,
        'target': target, 'tolerance': tol, 'matters': matters, 'start': start,
        'smile': sm, 'explanation': explanation,
        'citations': [{'file': f, 'line': l, 'quote': q, 'note': n} for f, l, q, n in citations],
        'check': {'peak_density': round(V.peak(target), 10), 'mean': round(V.mean_closed(target), 10),
                  'sd': round(V.sd_closed(target), 10), 'left_mass': round(V.left_mass(target), 10)},
    }
    if contrasts:
        item['contrasts'] = contrasts
    return item


C_MECH = [
    (MR17, 136, 'The shape of the smile is a direct consequence of how the',
     'smile shape comes from implied vs lognormal distribution'),
    (MR17, 138, 'more probability mass than lognormal, options struck in that region are worth more than BSM',
     'extra mass in a region -> options there dearer'),
    (MR17, 139, 'says, and implied volatility there is higher.', '-> implied volatility higher there'),
]

ITEMS = [
    make('tsh-MR-17-01', 'MR-17', 'mr17.c.table.1', MR17, 236,
         'Foreign currency: both tails heavier than lognormal',
         'Foreign currency. The implied distribution has a heavier left tail and a heavier right '
         'tail than the lognormal distribution BSM assumes. Shape the density to match.',
         'both_heavy', 'volatility smile', FX_SMILE, params(60.0, 60.0, 0.0, 1.0),
         'Both tails are fat (low nu on both sides), so options struck well below and well above '
         'the money are dearer than BSM says. Implied volatility rises at both ends: a smile, '
         'roughly symmetric about the money. Location and spread are not what the notes pin down '
         '-- only the two tails are.',
         [(MR17, 236, 'heavier right tail', 'FX: heavier left and right tail'),
          (MR17, 237, 'Rises at both ends', '-> smile'),
          (MR17, 79, 'The currency smile is roughly symmetric about the money.', 'symmetric')] + C_MECH),

    make('tsh-MR-17-02', 'MR-17', 'mr17.c.table.1', MR17, 239,
         'Equity: heavier left tail, thinner right tail',
         'Equity. The implied distribution has a heavier left tail and a thinner right tail than '
         'lognormal. You start from the currency shape (both tails fat); fix it.',
         'left_heavy', 'volatility skew', EQ_SKEW, params(4.0, 4.0, 0.0, 1.0),
         'Only the left tail carries extra mass, so only low-strike options are dear and implied '
         'volatility falls monotonically as the strike rises: a skew (smirk). The family cannot '
         'make a tail thinner than the normal, so the right tail is set at the lognormal end of '
         'its slider (nu_R high); the left tail must be clearly fat.',
         [(MR17, 239, 'Heavier left tail, thinner right tail', 'equity row'),
          (MR17, 240, 'Falls across the range', '-> skew'),
          (MR17, 80, 'monotonically: low-strike options carry the highest implied volatility',
           'skew falls monotonically')] + C_MECH),

    make('tsh-MR-17-03', 'MR-17', 'mr17.e.table.1', MR17, 290,
         'Crashophobia: a premium on precipitous falls',
         'Crashophobia. Market participants are afraid of another market crash and place a premium '
         'on the probability of stock prices falling precipitously; equity traders believe large '
         'down movements are more likely than large up movements, compared with lognormal. The '
         'start has the fat tail on the wrong side.',
         'left_heavy', 'volatility skew', EQ_SKEW, params(60.0, 4.0, 0.0, 1.0),
         'Fear of a crash is extra probability of a large fall: a fat LEFT tail with no matching '
         'right tail. Deep out-of-the-money puts (low strikes) carry high premiums, so implied '
         'volatility is highest at low strikes and falls as X/S0 rises -- the equity skew. A fat '
         'right tail instead would make high strikes dear, the opposite of what the notes describe.',
         [(MR17, 290, 'Market participants are simply afraid of another market crash, so',
           'crashophobia'),
          (MR17, 291, 'they place a premium on the probability of stock prices falling precipitously.',
           'premium on falls'),
          (MR17, 292, 'exhibit high premiums since they provide protection against a',
           'deep OTM puts expensive'),
          (MR17, 278, 'Equity traders believe the probability of', 'large down moves more likely'),
          (MR17, 279, 'large up movements, as compared with a lognormal distribution.', 'vs lognormal'),
          (MR17, 274, 'or skew, showing a higher implied volatility for', 'higher IV at low strikes')]),

    make('tsh-MR-17-04', 'MR-17', 'mr17.e.trapbox.1', MR17, 255,
         'The BSM benchmark: a lognormal price',
         'The benchmark BSM assumes: the asset price is lognormal -- its volatility is constant and '
         'it changes smoothly, with no jumps. Remove the fat tails you start with.',
         'both_light', 'flat', FLAT, params(4.0, 4.0, 0.0, 1.0),
         'On a return axis a lognormal price is a normal log-return, which this family reaches as '
         'nu -> 60 on both sides. If the implied distribution equals the lognormal there is no '
         'region with extra mass, so no strike is dearer than BSM says: one volatility prices every '
         'strike and the curve is flat. Every smile or skew is a measured departure from this.',
         [(MR17, 255, 'Two of the conditions for an asset price to have a', 'lognormal conditions'),
          (MR17, 257, 'The volatility of the asset is', 'constant volatility'),
          (MR17, 258, 'The price of the asset changes', 'smooth, no jumps'),
          (MR1, 159, 'itself is lognormally distributed', 'normal log-return <-> lognormal price')]
         + C_MECH),

    make('tsh-MR-17-05', 'MR-17', 'mr17.e.trapbox.1', MR17, 261,
         'Why currencies smile: jumps and non-constant volatility',
         'Exchange-rate volatility is far from constant and exchange rates frequently jump, '
         'sometimes on central-bank actions, so currency traders see a greater chance of extreme '
         'price movement than a lognormal distribution predicts.',
         'both_heavy', 'volatility smile', FX_SMILE, params(50.0, 50.0, 0.0, 2.0),
         'Both lognormal conditions fail, and a jump can go either way, so extreme moves in BOTH '
         'directions are more likely than lognormal: both tails fat. Deep in-the-money and deep '
         'out-of-the-money options become dearer than at-the-money ones -- the currency smile. '
         'Making the distribution wider (s) does not do it: that raises every strike alike; only '
         'the tail shape bends the curve.',
         [(MR17, 261, 'The volatility of an exchange rate is far from constant, and exchange rates frequently exhibit',
           'non-constant volatility, jumps'),
          (MR17, 263, 'therefore think there is a greater chance of extreme price movement than a lognormal',
           'extreme moves more likely'),
          (MR17, 527, 'Caused by fat tails in both directions.', 'smile <- fat tails both ways'),
          (MR17, 526, 'at-the-money implied volatility is the', 'ATM lowest')]),

    make('tsh-MR-17-06', 'MR-17', 'mr17.g.tikzpicture.2', MR17, 382,
         'Short-dated currency options: the deepest smile',
         'Short-dated (1-month) options: the most curved smile on the volatility surface. Long-dated '
         'options show less of a smile than shorter-dated ones -- so give this one the most extreme '
         'tails. You start from a mildly fat-tailed shape.',
         'both_very_heavy', 'volatility smile', SMILE_1M, params(12.0, 12.0, 0.0, 1.0),
         'The deepest smile needs the most extra mass in both tails relative to lognormal, so both '
         'nu values go to the bottom of the slider. Compare the 2-year item: the same mechanism with '
         'milder tails gives a flatter curve.',
         [(MR17, 268, 'options tend to exhibit', 'long-dated: less smile'),
          (MR17, 269, 'shorter-dated options.', 'than short-dated'),
          (MR17, 398, 'Note how the curvature flattens as maturity lengthens', 'surface figure'),
          (MR17, 527, 'Caused by fat tails in both directions.', 'smile <- fat tails')] + C_MECH),

    make('tsh-MR-17-07', 'MR-17', 'mr17.e.keybox.1', MR17, 268,
         'Long-dated currency options: less of a smile',
         'Long-dated (2-year) options exhibit less of a volatility smile than shorter-dated ones: '
         'the tails are still fatter than lognormal, but only mildly. You start from the extreme '
         '1-month shape.',
         'both_moderate', 'volatility smile', SMILE_2Y, params(3.5, 3.5, 0.0, 1.0),
         'A shallower smile means less extra mass in the tails relative to lognormal: move both nu '
         'up into the middle of the range, not all the way to 60 (that would be flat). The curvature '
         'of the smile tracks how far the tails are from lognormal.',
         [(MR17, 268, 'options tend to exhibit', 'long-dated: less smile'),
          (MR17, 399, 'the same fact as', 'long-dated less smile, surface'),
          (MR17, 398, 'Note how the curvature flattens as maturity lengthens', 'curvature flattens')]
         + C_MECH,
         contrasts=[{'relation': 'thinner_tails_than', 'item': 'tsh-MR-17-06'}]),

    make('tsh-MR-17-08', 'MR-17', 'mr17.h.keybox.1', MR17, 419,
         'Equity price rises: the whole skew shifts down',
         'The equity price rises. Because equity prices and their volatilities are negatively '
         'correlated, the entire skew curve moves down -- and this dominates the slide along the '
         'curve. Keep the equity shape; reduce the volatility.',
         'left_heavy', 'volatility skew', SKEW_DOWN, params(4.0, 50.0, 0.0, 2.0),
         'The shape (fat left tail, lognormal-like right tail) is unchanged, so the curve is still a '
         'skew; what changes is the level. Lower implied volatility means a narrower implied '
         'distribution, so the spread s must come down. Effect 1 (moving left along the skew as K/S0 '
         'falls) would raise volatility, but effect 2 dominates.',
         [(MR17, 419, 'between equity prices and their volatilities. As', 'negative correlation'),
          (MR17, 420, 'moves \\textbf{down} when equity prices increase', 'whole curve down'),
          (MR17, 424, 'The second effect dominates the first.', 'effect 2 dominates'),
          (MR17, 425, 'when the equity price moves', 'IV down when price up')],
         s_rule=(0.8, 0.3),
         extra_smile={'before_formula': SKEW_ORIG[0],
                      'before_formula_source': {'file': SKEW_ORIG[1], 'line': SKEW_ORIG[2]},
                      'before_points': [[x, round(V.eval_formula(SKEW_ORIG[0], x), 2)]
                                        for x in MONEYNESS]},
         contrasts=[{'relation': 'curve_shifts_down_narrower'}]),

    make('tsh-MR-1-01', 'MR-1', 'mr1.f.tikzpicture.1', MR1, 481,
         'QQ plot bends at both ends: fatter tails',
         'A QQ plot of the data against the normal bends at both ends: the empirical quantiles are '
         'more extreme than the reference at both ends. Build the density that plot describes; the '
         'overlay shows the curve an option market pricing it would draw.',
         'both_heavy', 'volatility smile', FX_SMILE, params(60.0, 60.0, 0.0, 1.0),
         'Quantiles more extreme at both ends is a fatter-tailed density on both sides (MR-1). Read '
         'as an implied distribution, extra mass in both tails makes both deep strikes dear, which '
         'MR-17 calls a smile (fat tails in both directions). The smile curve is borrowed from '
         'MR-17; MR-1 itself says nothing about options.',
         [(MR1, 481, 'That bend means the empirical quantiles are more', 'QQ bend'),
          (MR1, 482, 'extreme than the reference at both ends, which is exactly what a fatter-tailed density looks',
           'fatter tails both ends'),
          (MR17, 527, 'Caused by fat tails in both directions.', 'smile <- fat tails both ways')]
         + C_MECH),

    make('tsh-MR-1-02', 'MR-1', 'mr1.b.prose_para.3', MR1, 157,
         'Normal geometric returns, lognormal price',
         'Geometric returns are normally distributed, so the price itself is lognormally '
         'distributed. You start from an equity-style shape; make it the lognormal benchmark.',
         'both_light', 'flat', FLAT, params(4.0, 50.0, 0.0, 1.0),
         'This family lives on a return axis, so a normal geometric (log) return is nu -> 60 on both '
         'sides -- the lognormal price BSM assumes. With no tail carrying more mass than lognormal, '
         'no strike is dearer than BSM says and the curve is flat (MR-17 mechanism). The '
         '"right-skewed" lognormal of MR-1 is skew in PRICE; on the log-return axis it is '
         'symmetric.',
         [(MR1, 157, 'Assume that geometric returns are normally distributed with mean',
           'normal geometric returns'),
          (MR1, 159, 'itself is lognormally distributed', 'price lognormal')] + C_MECH),

    make('tsh-MR-3-01', 'MR-3', 'mr3.b.table.1', MR3, 112,
         'Gumbel, not Frechet: light tails',
         'The parent is normal / lognormal: tail index xi = 0, the Gumbel case, "light" tails that '
         'decay exponentially. You start from a t-distribution parent (xi > 0, Frechet, "heavy" '
         'power-law tails).',
         'both_light', 'flat', FLAT, params(4.0, 4.0, 0.0, 1.0),
         'The slider nu IS the t-distribution\'s degrees of freedom: low nu gives power-law (Frechet, '
         'heavy) tails, high nu approaches the normal (Gumbel, light). Pushing both tails to the '
         'normal end gives the lognormal price BSM assumes, so the overlay is flat.',
         [(MR3, 112, 'Normal and lognormal distributions', 'Gumbel: light'),
          (MR3, 110, 't$-distribution and Pareto distributions', 'Frechet: heavy'),
          (MR3, 153, 'the tail decays exponentially', 'xi = 0 exponential'),
          (MR3, 154, 'power, so extreme values remain possible far out.', 'xi > 0 power')]
         + C_MECH),
]

FAMILY_SPEC = (
    'Split (two-piece) Student-t with a common scale. z = (x - mu)/s; '
    'k_nu(z) = (1 + z^2/nu)^(-(nu+1)/2); '
    'C_nu = Gamma((nu+1)/2) / (sqrt(nu*pi) * Gamma(nu/2)) [so t_nu(z) = C_nu * k_nu(z)]; '
    'A = 2*C_L*C_R / (s*(C_L + C_R)) with C_L = C_{nuL}, C_R = C_{nuR}; '
    'f(x) = A * k_{nuL}(z) for x < mu, f(x) = A * k_{nuR}(z) for x >= mu. '
    'Equivalently f = [2*C_R/(C_L+C_R)] * t_{nuL}(z)/s on the left and [2*C_L/(C_L+C_R)] * t_{nuR}(z)/s '
    'on the right: each half-t integrates to 1/2, the weights make the density continuous at mu '
    '(both sides equal A there) and the total mass 1. Mass left of mu = C_R/(C_L+C_R).')

FAMILY = {
    'name': 'split Student-t (two-piece, common scale)',
    'x_axis': 'log return over the option life, percent; nu -> 60 on both sides is ~normal, i.e. a '
              'lognormal price (the BSM benchmark)',
    'spec': {
        'z': '(x - mu) / s',
        'kernel': 'k_nu(z) = (1 + z^2/nu)^(-(nu+1)/2)',
        'C_nu': 'Gamma((nu+1)/2) / (sqrt(nu*pi) * Gamma(nu/2))',
        'peak_A': '2*C_L*C_R / (s*(C_L + C_R))',
        'density': 'f(x) = A*k_{nuL}(z) if x < mu else A*k_{nuR}(z)',
        'left_mass': 'C_R / (C_L + C_R)',
        'mean': 'mu + s * 2*C_L*C_R/(C_L+C_R) * (nuR/(nuR-1) - nuL/(nuL-1))',
        'variance': 's^2 * (w_L*nuL/(nuL-2) + w_R*nuR/(nuR-2) - m^2), w_L = C_R/(C_L+C_R), '
                    'w_R = C_L/(C_L+C_R), m = 2*C_L*C_R/(C_L+C_R)*(nuR/(nuR-1) - nuL/(nuL-1))',
        'notes': 'mu is the location (mode and junction), equal to the mean only when nuL = nuR; '
                 's is a scale, not the standard deviation (sd = s*sqrt(nu/(nu-2)) when nuL = nuR). '
                 'nu >= 2.5 keeps the mean and variance finite. JavaScript has no lgamma: use a '
                 'Lanczos log-gamma and check it against reference_values.',
    },
    'params': [
        {'name': 'nuL', 'label': 'Left-tail heaviness (nu_L)', 'min': 2.5, 'max': 60.0, 'step': 0.5,
         'low_label': 'fat left tail (big falls likely)', 'high_label': '~normal left tail (lognormal)'},
        {'name': 'nuR', 'label': 'Right-tail heaviness (nu_R)', 'min': 2.5, 'max': 60.0, 'step': 0.5,
         'low_label': 'fat right tail (big rises likely)', 'high_label': '~normal right tail (lognormal)'},
        {'name': 'mu', 'label': 'Mean shift (location mu, % return)', 'min': -2.0, 'max': 2.0, 'step': 0.05,
         'low_label': 'shift left', 'high_label': 'shift right'},
        {'name': 's', 'label': 'Variance (scale s, % return)', 'min': 0.5, 'max': 3.0, 'step': 0.05,
         'low_label': 'narrow (low volatility)', 'high_label': 'wide (high volatility)'},
    ],
    'reference_values': {
        'C_nu': [{'nu': nu, 'C_nu': round(V.c_nu(nu), 12)} for nu in (2.5, 3.0, 4.0, 5.5, 12.0, 30.0, 60.0)],
    },
    'tail_heaviness_basis': [
        {'file': MR3, 'line': 110, 'quote': 't$-distribution and Pareto distributions',
         'note': 't-distribution tails are "heavy" (Frechet)'},
        {'file': MR3, 'line': 112, 'quote': 'Normal and lognormal distributions',
         'note': 'normal / lognormal tails are "light" (Gumbel)'},
    ],
}

CLASSIFICATION = {
    'rule': 'R_side = P(side beyond 2.5 s) / P(normal beyond 2.5 sd). skew: R_L >= heavy_ratio, '
            'R_R <= light_ratio, R_L/R_R >= skew_ratio_min and nuR - nuL >= skew_nu_margin. '
            'smile: R_L, R_R >= fatter_ratio and max/min <= smile_symmetry_max. flat: R_L, R_R <= '
            'light_ratio. The validator enforces the item label at the target and at every corner '
            'of the tolerance box, so any accepted slider state produces the overlaid curve shape.',
    'tail_z': V.TAIL_Z, 'heavy_ratio': V.HEAVY_R, 'fatter_ratio': V.FATTER_R,
    'light_ratio': V.LIGHT_R, 'smile_symmetry_max': V.SYM_MAX, 'skew_ratio_min': V.SKEW_RATIO,
    'skew_nu_margin': V.SKEW_NU_MARGIN,
}


def main():
    doc = {
        'version': 1,
        'mechanic': 'tail-shaper',
        'family_spec': FAMILY_SPEC,
        'family': FAMILY,
        'match_rule': 'Success when |slider - target| <= tolerance for all four params. A param not '
                      'in "matters" has a tolerance that admits its whole range.',
        'classification': CLASSIFICATION,
        'omitted': [
            'MR-17 i volatility frown (bimodal distribution from an anticipated jump): a split-t is '
            'unimodal and cannot produce it.',
            'MR-15 right-skewed CIR/lognormal short-rate distributions: the notes give no implied-vol '
            'curve for them and the game has no upward-sloping label.',
            'IM-3 negative skewness of nonlinear strategies and MR-18 fat-tailed loss distributions: '
            'the notes do not tie them to an option smile.',
        ],
        'items': ITEMS,
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print('wrote %s (%d items)' % (os.path.relpath(OUT, ROOT), len(ITEMS)))


if __name__ == '__main__':
    main()
