#!/usr/bin/env python3
"""Builds content/games/mechanics/frontier-rider.json.

    python3 tools/games/build_frontier_rider.py && python3 tools/games/validate_frontier-rider.py

Every stored coordinate (answer.from / answer.to / answer.move) is computed with the engine in
validate_frontier-rider.py, so the builder and the validator cannot disagree about the maths.
Inputs come from two worked examples in the notes:

  * U5  IM-5 two-currency portfolio (CAD / EUR): excess returns 8% / 5% (IM-5 l.546); volatilities
        5% / 12% and zero correlation backed out of the notes' own VaR curve (l.424) and confirmed
        by reproducing the notes' 85.21% minimum-risk and 90.21% optimal CAD weights.
  * U6  IM-6 two active managers: IR 0.60 / 0.40, TEV 6% each, independent (l.280, l.313);
        expected active returns IR x TEV = 3.6% / 2.4% (l.305); the benchmark (zero active return,
        zero TEV) plays the risk-free asset, and A is chosen so the complete portfolio sits at the
        notes' 4% TEV target (l.279), which reproduces the 55.5% / 37.0% / 8% allocation (l.304).
"""
import importlib.util
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('frv', os.path.join(HERE, 'validate_frontier-rider.py'))
E = importlib.util.module_from_spec(spec)
spec.loader.exec_module(E)

V2 = 'notes/FRM_Consolidated_Vol2/ch/'
IM1, IM4, IM5, IM6 = V2 + '05_IM_IM1.tex', V2 + '46_IM_IM4.tex', V2 + '04_IM_IM5.tex', V2 + '10_IM_IM6.tex'

CONVENTIONS = (
    "Unconstrained Markowitz mean-standard deviation maths; short sales and borrowing/lending at rf "
    "are allowed; no other constraints. Units: every mu, sigma and rf in the item is a percent per "
    "year (8 means 8%); convert to decimals before computing (m_i = mu_i/100, s_i = sigma_i/100, "
    "r = rf/100). Covariance S_ij = corr_ij * s_i * s_j. Portfolio mean E = w'm, sd = sqrt(w'Sw). "
    "Frontier: for a target mean, the minimum-sd portfolio from m and S (closed form with "
    "A0 = 1'S^-1 1, B0 = 1'S^-1 m, C0 = m'S^-1 m: var(E) = (A0 E^2 - 2 B0 E + C0)/(A0 C0 - B0^2)); "
    "draw the upper (efficient) branch solid and the lower branch faint. "
    "min-variance point: w = S^-1 1 / (1'S^-1 1) (does not depend on m or rf). "
    "tangency point: w = S^-1 (m - r 1) / (1'S^-1 (m - r 1)) (w proportional to S^-1(mu - rf 1)); the "
    "CAL is the ray from (0, rf) through the tangency point, slope = Sharpe ratio (E_T - r)/sd_T. "
    "complete point: weight in the tangency portfolio y* = (E_T - r)/(A sd_T^2) with A applied to "
    "DECIMAL returns (utility E - (A/2) var); the point is (y* sd_T, r + y*(E_T - r)), on the CAL; "
    "1 - y* is held in the risk-free asset (y* > 1 means borrowing). Plot (sigma, mu) in percent. "
    "The slider changes exactly one input (rf, A, mu[i], sigma[i] or corr[i][j] with corr[j][i] kept "
    "equal) and everything is recomputed live; the player predicts the move of the point from "
    "slider.from to slider.to. Move codes: sign of d(sigma) (right/left) and d(mu) (up/down), "
    "|d| < 1e-6 counts as zero; 'stays' = both zero. Where an item says the risk-free asset is the "
    "benchmark (active space), read mu as expected active return, sigma as tracking-error volatility "
    "(TEV), the Sharpe ratio as the information ratio, and the risk-free asset as the benchmark itself."
)

U5_ASSETS = [dict(name='CAD position', mu=8.0, sigma=5.0), dict(name='EUR position', mu=5.0, sigma=12.0)]
U5_CORR = [[1.0, 0.0], [0.0, 1.0]]
U5_SOURCE = (
    "IM-5 two-currency portfolio. Expected excess returns 8% (CAD) and 5% (EUR) are stated at l.546. "
    "The notes do not print the volatilities; they are backed out of the notes' own reconstructed VaR "
    "curve for $2m CAD + x $m EUR, sqrt(27225 + 3.9x + 39200x^2) in $000 (l.424, 95% VaR, z = 1.65 as "
    "used at l.190): (1.65 x 5% x 2000)^2 = 27225 and (1.65 x 12% x 1000)^2 = 39204 ~ 39200, and the "
    "3.9 cross term implies rho ~ 0.00006, taken as 0. With these inputs the engine reproduces the "
    "notes' 85.21% minimum-risk CAD weight (l.501) and 90.21% optimal CAD weight (l.555) exactly. "
    "rf = 0 because the notes work in expected EXCESS returns (figure y-axis, l.589)."
)
U5_UNITS = (
    "Scale note: the notes' 'volatility' row (15.62%, 13.85%, 13.98%) is the dollar standard deviation "
    "of the $3m book per $1m, i.e. exactly 3 x the per-dollar sigma plotted here (4.62%, 4.66%); the "
    "notes' Sharpe 0.551 is therefore 1/3 of the per-dollar Sharpe ratio. Rankings and directions are "
    "unaffected."
)
U5_PLANE = dict(x_label='volatility (% per year)', y_label='expected excess return (%)',
                rf_label='risk-free asset (0 excess return)')

U6_ASSETS = [dict(name='Manager 1 (IR 0.60)', mu=3.6, sigma=6.0), dict(name='Manager 2 (IR 0.40)', mu=2.4, sigma=6.0)]
U6_CORR = [[1.0, 0.0], [0.0, 1.0]]
U6_A = 18.03  # IR_p / 0.04 = 0.72111 / 0.04 -> complete point at the 4% TEV target
U6_SOURCE = (
    "IM-6 two-manager risk budget. Each manager's TEV is 6% and IRs are 0.60 and 0.40 (l.280); expected "
    "active return mu_i = IR_i x TEV_i = 3.6% and 2.4% (l.304-305); the managers' deviations are "
    "independent (l.313, l.381), so corr = 0. The benchmark has zero TEV and zero active return and "
    "plays the risk-free asset (l.281), so rf = 0 in this active-return plane. A = 18.03 puts the "
    "complete portfolio at the notes' 4% overall TEV (l.279): sd_C = IR_T / A = 0.7211 / 18.03 = 4.00%, "
    "which reproduces the notes' 55.5% / 37.0% / ~8% benchmark split (l.297-300, l.304)."
)
U6_PLANE = dict(x_label='tracking-error volatility, TEV (% per year)', y_label='expected active return (%)',
                rf_label='benchmark (0 active return, 0 TEV)')

GAMMA_BAR = 35.47  # (E_T - rf) / sd_T^2 for U5: 0.077063 / 0.0021725


def mk(**kw):
    return kw


SPECS = [
    # ------------------------------------------------------------------ IM-5
    mk(id='fr-IM-5-01', reading_id='IM-5', source_block='im5.d.exbox.2', source_file=IM5, source_line=545,
       title='CAD looks better: raise its expected excess return',
       assets=U5_ASSETS, corr=U5_CORR, rf=0.0, point='tangency',
       slider=dict(param='mu[0]', label='CAD expected excess return (%)', frm=8.0, to=10.0, step=0.25),
       question='The CAD forecast rises from 8% to 10% (excess). Where does the optimal (maximum-Sharpe) portfolio go?',
       options=[
           dict(label='Up and slightly right: more CAD, higher expected return', move='up-right', correct=True,
                why='The CAD now has the higher excess-return-to-marginal-risk ratio, so the optimiser adds to it (IM-5 l.533). The book already holds more CAD than the minimum-risk 85%, so each extra CAD dollar adds a little risk as well as return.'),
           dict(label='Up and to the left: more return and less risk', move='up-left', correct=False,
                why='Less risk would need a move back toward the 85.21% minimum-risk mix; the optimiser moves further away from it, toward more CAD.'),
           dict(label='Down and to the left, toward the minimum-risk portfolio', move='down-left', correct=False,
                why='Treats a better forecast as a reason to cut risk. The optimal portfolio uses return AND risk; only the minimum-risk portfolio ignores returns (IM-5 l.474, l.520).'),
           dict(label='Stays put: the covariance matrix did not change', move='stays', correct=False,
                why='That is true of the minimum-variance portfolio, not of the tangency portfolio, whose weights are proportional to S^-1 times excess returns.'),
       ],
       explanation='At the optimum the ratios E_i / beta_i (equivalently E_i / MVaR_i) are equal across assets (IM-5 l.523-526). Raising the CAD\'s E_i breaks the equality in the CAD\'s favour, so the rule "add to the position with the highest excess expected return to marginal VaR" (l.533) moves weight into CAD (90.2% -> 92.0%) until the ratios re-equalise. Because the original optimum already sits to the right of the minimum-risk mix (13.98 vs 13.85 in the notes\' units, l.559 / l.506), more CAD means a little more risk: the point climbs up and slightly right.',
       notes_checks=[
           dict(quantity='w[0]', at='from', expected=0.9021, tol=5e-5, line=555, literal='90.21'),
           dict(quantity='mu', at='from', expected=7.71, tol=0.005, line=560, literal='7.71'),
           dict(quantity='sigma', at='from', multiplier=3.0, expected=13.98, tol=0.005, line=559, literal='13.98'),
       ],
       citations=[dict(line=546, note='CAD 8%, EUR 5% excess returns', literal='8\\% for CAD'),
                  dict(line=523, note='optimality: excess return / MVaR equal across assets'),
                  dict(line=533, note='add to the highest excess-return-to-MVaR position', literal='Add'),
                  dict(line=555, note='optimal CAD weight 90.21%', literal='90.21')],
       cal_slope='steeper'),

    mk(id='fr-IM-5-02', reading_id='IM-5', source_block='im5.d.fmlbox.1', source_file=IM5, source_line=523,
       title='EUR looks better: raise its expected excess return',
       assets=U5_ASSETS, corr=U5_CORR, rf=0.0, point='tangency',
       slider=dict(param='mu[1]', label='EUR expected excess return (%)', frm=5.0, to=7.0, step=0.25),
       question='The EUR forecast rises from 5% to 7% (excess). The EUR is the riskier currency (12% vs 5%). Where does the optimal portfolio go?',
       options=[
           dict(label='Up and to the left: more EUR, yet less risk', move='up-left', correct=True,
                why='More weight goes to the EUR (its return-to-marginal-VaR ratio rose), and because the book held less EUR than the minimum-risk 14.8%, adding EUR diversifies: risk falls while return rises.'),
           dict(label='Up and to the right: more of the risky currency means more risk', move='up-right', correct=False,
                why='Standalone volatility does not decide portfolio risk; the contribution does (IM-6 makes the same point). With zero correlation a small EUR slice lowers total risk.'),
           dict(label='Down and to the right', move='down-right', correct=False,
                why='A better forecast for one asset cannot lower the maximum Sharpe ratio or the optimal expected return here.'),
           dict(label='Stays put', move='stays', correct=False,
                why='Only the minimum-variance portfolio ignores expected returns.'),
       ],
       explanation='The optimality condition (IM-5 l.523-526) says excess return per unit of marginal VaR must be equal across positions. A higher EUR excess return lifts the EUR\'s ratio, so the manager "adds to the position with the highest excess expected return to marginal VaR" (l.533): EUR rises from 9.8% to 13.2%. The notes\' minimum-risk mix holds 14.79% EUR (l.502), so moving from 9.8% toward it REDUCES risk. The point moves up and to the left, and the CAL steepens.',
       notes_checks=[
           dict(quantity='w[1]', at='from', expected=0.0979, tol=5e-5, line=556, literal='9.79'),
       ],
       citations=[dict(line=523, note='optimality condition'),
                  dict(line=533, note='add to the highest ratio', literal='Add'),
                  dict(line=502, note='minimum-risk EUR weight 14.79%', literal='14.79')],
       cal_slope='steeper'),

    mk(id='fr-IM-5-03', reading_id='IM-5', source_block='im5.d.prose_para.1', source_file=IM5, source_line=474,
       title='Minimum risk ignores the forecast',
       assets=U5_ASSETS, corr=U5_CORR, rf=0.0, point='min-variance',
       slider=dict(param='mu[0]', label='CAD expected excess return (%)', frm=8.0, to=10.0, step=0.25),
       question='The CAD forecast rises from 8% to 10%. Where does the risk-minimising (global minimum) portfolio go?',
       options=[
           dict(label='Straight up: same weights, same risk, higher expected return', move='up', correct=True,
                why='The global minimum is found from risk alone, so the 85.21% / 14.79% mix is unchanged; only the return on that fixed mix rises.'),
           dict(label='Up and to the right, toward more CAD', move='up-right', correct=False,
                why='That is what the OPTIMAL portfolio does. The minimum-risk mix does not look at expected returns.'),
           dict(label='Stays exactly where it was', move='stays', correct=False,
                why='The weights stay, but the point is plotted in mean-sd space: the same weights now earn 0.8521 x 10% + 0.1479 x 5% = 9.26%.'),
           dict(label='Jumps to the optimal (tangency) portfolio', move='to-tangency', correct=False,
                why='Minimising risk is not the same as optimising (IM-5 l.621); the two destinations stay different places.'),
       ],
       explanation='"Taking only risk into consideration leads to the global minimum" (IM-5 l.474): the condition is equal marginal VaRs (l.483), which involves the covariance matrix only. The weights therefore stay at 85.21% CAD / 14.79% EUR (l.501-502), sigma is unchanged, and only the expected return of that fixed mix moves, from 7.56% (l.619) to 9.26%. The point rises vertically.',
       notes_checks=[
           dict(quantity='w[0]', at='from', expected=0.8521, tol=5e-5, line=501, literal='85.21'),
           dict(quantity='w[0]', at='to', expected=0.8521, tol=5e-5, line=501, literal='85.21'),
           dict(quantity='mu', at='from', expected=7.56, tol=0.005, line=619, literal='7.56'),
           dict(quantity='sigma', at='from', multiplier=3.0, expected=13.85, tol=0.005, line=506, literal='13.85'),
       ],
       citations=[dict(line=474, note='only risk -> global minimum', literal='only risk'),
                  dict(line=483, note='all marginal VaRs equal at the minimum', literal='All marginal VaRs'),
                  dict(line=621, note='minimising risk is not optimising', literal='Minimising risk')],
       cal_slope=None),

    mk(id='fr-IM-5-04', reading_id='IM-5', source_block='im5.d.prose_para.1', source_file=IM5, source_line=477,
       title='EUR gets more volatile: where is the minimum now?',
       assets=U5_ASSETS, corr=U5_CORR, rf=0.0, point='min-variance',
       slider=dict(param='sigma[1]', label='EUR volatility (%)', frm=12.0, to=15.0, step=0.25),
       question='EUR volatility rises from 12% to 15%. Where does the minimum-risk portfolio go?',
       options=[
           dict(label='Up and to the right: less EUR, more CAD, and a higher risk floor', move='up-right', correct=True,
                why='The EUR\'s marginal VaR rises, so the minimum cuts EUR (14.8% -> 10%) and adds CAD; the best achievable risk is still higher, and the heavier CAD tilt earns more.'),
           dict(label='Down and to the right: more risk and less return', move='down-right', correct=False,
                why='Return would fall only if the mix moved toward the lower-return EUR; it moves away from it.'),
           dict(label='Left: rebalancing restores the old risk level', move='left', correct=False,
                why='With one ingredient riskier and nothing else better, the minimum achievable risk cannot fall.'),
       ],
       explanation='To lower VaR, "lower the position with the highest marginal VaR" and "add to the position with the lowest" (IM-5 l.478-479); the minimum is reached when all marginal VaRs are equal (l.483). A more volatile EUR has a higher marginal VaR at the old mix, so weight flows to the CAD until they equalise again (CAD 85.2% -> 90.0%). Portfolio risk at the new minimum is still higher (4.62% -> 4.74% per dollar), and because CAD earns 8% against 5%, the expected return also rises.',
       notes_checks=[dict(quantity='w[1]', at='from', expected=0.1479, tol=5e-5, line=502, literal='14.79')],
       citations=[dict(line=478, note='cut the highest marginal VaR', literal='highest'),
                  dict(line=479, note='add to the lowest marginal VaR', literal='lowest'),
                  dict(line=483, note='all marginal VaRs equal at the minimum')],
       cal_slope=None),

    mk(id='fr-IM-5-05', reading_id='IM-5', source_block='im5.b.prose_para.1', source_file=IM5, source_line=329,
       title='Correlation turns negative: the frontier bends left',
       assets=U5_ASSETS, corr=U5_CORR, rf=0.0, point='min-variance',
       slider=dict(param='corr[0][1]', label='CAD-EUR correlation', frm=0.0, to=-0.4, step=-0.05),
       question='The CAD-EUR correlation falls from 0 to -0.4. Where does the minimum-risk portfolio go?',
       options=[
           dict(label='Left (and a little down): lower risk, with a larger EUR hedge', move='down-left', correct=True,
                why='Lower correlation means more diversification, so the whole frontier bends left; the minimum holds more EUR (14.8% -> 22.6%), which costs a little expected return.'),
           dict(label='Straight left: risk falls, weights unchanged', move='left', correct=False,
                why='The minimum-variance weights depend on the correlation; with a negative correlation the EUR becomes a better hedge and gets more weight, which moves the mean too.'),
           dict(label='Right: negative correlation adds risk', move='right', correct=False,
                why='Reversed polarity. Correlation below 1 is what makes diversified VaR smaller than the sum of the parts (IM-5 l.92-93).'),
           dict(label='Stays: correlation does not change individual volatilities', move='stays', correct=False,
                why='Individual risks are unchanged, but portfolio risk depends on the cross term 2 w1 w2 rho sigma1 sigma2 (l.87).'),
       ],
       explanation='Correlation sets where portfolio risk sits (IM-5 l.329): diversified VaR is below undiversified VaR whenever correlation is below 1 (l.92-93), and the cross term 2 w1 w2 rho sigma1 sigma2 (l.87) turns negative when rho < 0. The minimum-variance mix shifts toward more EUR (22.6%) to exploit the hedge; per-dollar risk falls from 4.62% to 3.73% and, since EUR earns less than CAD, expected return slips from 7.56% to 7.32%.',
       notes_checks=[],
       citations=[dict(line=329, note='correlation sets portfolio risk between bounds', literal='Correlation sets'),
                  dict(line=87, note='two-asset variance formula with the rho cross term'),
                  dict(line=93, note='diversified VaR < undiversified when rho < 1', literal='diversified VaR is less')],
       cal_slope=None),

    mk(id='fr-IM-5-06', reading_id='IM-5', source_block='im5.d.prose_para.3', source_file=IM5, source_line=531,
       title='CAD gets riskier: the optimum retreats',
       assets=U5_ASSETS, corr=U5_CORR, rf=0.0, point='tangency',
       slider=dict(param='sigma[0]', label='CAD volatility (%)', frm=5.0, to=7.0, step=0.25),
       question='CAD volatility rises from 5% to 7%, forecasts unchanged. Where does the optimal portfolio go?',
       options=[
           dict(label='Down and to the right: less CAD, lower return, more risk, flatter CAL', move='down-right', correct=True,
                why='The CAD\'s ratio of excess return to marginal VaR falls, so CAD is cut (90.2% -> 82.5%); the book loses return and, with a riskier main holding, still carries more risk.'),
           dict(label='Down and to the left: the optimiser simply de-risks', move='down-left', correct=False,
                why='The optimiser cuts CAD, but CAD itself got riskier; the new optimum is riskier than the old one (6.14% vs 4.66% per dollar).'),
           dict(label='Up and to the right: more risk is paid with more return', move='up-right', correct=False,
                why='Nothing about the forecasts changed; extra volatility without extra return can only lower the Sharpe ratio.'),
           dict(label='Jumps to the minimum-risk portfolio', move='to-min-variance', correct=False,
                why='The optimum still uses expected returns; it does not collapse onto the minimum-risk mix.'),
       ],
       explanation='Optimality requires equal excess return per unit of marginal VaR (IM-5 l.523-526). A more volatile CAD has a higher marginal VaR, so its ratio drops below the EUR\'s and the rule is to "lower the allocation to the position with the lowest excess expected return to marginal VaR" (l.531). CAD falls from 90.2% to 82.5%, expected return falls (7.71% -> 7.47%) and risk still rises (4.66% -> 6.14%) because the dominant holding became riskier. The maximum Sharpe ratio falls: the CAL flattens.',
       notes_checks=[dict(quantity='w[0]', at='from', expected=0.9021, tol=5e-5, line=555, literal='90.21')],
       citations=[dict(line=523, note='optimality condition'),
                  dict(line=531, note='lower the lowest ratio', literal='Lower')],
       cal_slope='flatter'),

    mk(id='fr-IM-5-07', reading_id='IM-5', source_block='im5.e.defbox.1', source_file=IM5, source_line=628,
       title='Risk-free rate rises: does the global minimum care?',
       assets=U5_ASSETS, corr=U5_CORR, rf=0.0, point='min-variance',
       slider=dict(param='rf', label='risk-free rate (%)', frm=0.0, to=2.0, step=0.25),
       question='Holding the plotted expected returns fixed, the risk-free rate rises from 0% to 2%. Where does the minimum-risk portfolio go?',
       options=[
           dict(label='Nowhere: it stays exactly where it is', move='stays', correct=True,
                why='The global minimum depends only on the covariance matrix; neither expected returns nor the risk-free rate enter it.'),
           dict(label='Up and to the right, following the CAL', move='up-right', correct=False,
                why='The CAL pivots (its intercept rises) and the tangency portfolio moves, but the minimum-risk portfolio is not on the CAL\'s calculation path.'),
           dict(label='Down and to the left', move='down-left', correct=False,
                why='A risk-free rate cannot change the risk or return of a portfolio that holds no risk-free asset.'),
       ],
       explanation='Risk management "asks only how to make the portfolio less risky, and its answer is the global minimum where all marginal VaRs are equal" (IM-5 l.628-633). Marginal VaR depends on covariances and weights only, so the global minimum ignores the risk-free rate as completely as it ignores the forecasts. In the game the CAL visibly pivots up while the minimum-risk dot does not move: portfolio management (which divides by excess return, l.637-638) reacts; risk management does not.',
       notes_checks=[dict(quantity='w[0]', at='to', expected=0.8521, tol=5e-5, line=501, literal='85.21')],
       citations=[dict(line=629, note='risk management -> global minimum', literal='Risk management'),
                  dict(line=636, note='marginal VaR is the instrument in both cases')],
       cal_slope=None),

    # ------------------------------------------------------------------ IM-6
    mk(id='fr-IM-6-01', reading_id='IM-6', source_block='im6.h.keybox.1', source_file=IM6, source_line=310,
       title='Managers stop being independent',
       assets=U6_ASSETS, corr=U6_CORR, rf=0.0, point='tangency',
       slider=dict(param='corr[0][1]', label='correlation of the two managers\' active returns', frm=0.0, to=0.5, step=0.05),
       question='The two managers\' deviations become correlated (0 -> 0.5). Where does the best manager mix (maximum-IR portfolio) go?',
       options=[
           dict(label='Up and to the right, and the line from the benchmark gets flatter', move='up-right', correct=True,
                why='Correlation kills part of the diversification benefit, so the mix tilts to the better manager (60/40 -> 80/20): more active return, much more TEV, and a lower combined IR (0.72 -> 0.61).'),
           dict(label='Down and to the left: the fund de-risks', move='down-left', correct=False,
                why='Nothing lowers the managers\' own TEVs; losing the diversification benefit makes the combined TEV higher, not lower.'),
           dict(label='Stays: the managers\' IRs did not change', move='stays', correct=False,
                why='Individual IRs are unchanged, but the combined IR above either manager\'s came only from independence (IM-6 l.313).'),
       ],
       explanation='The combined IR of 0.72 beats both managers only because "the managers\' deviations [are] independent of each other" (IM-6 l.311-314; l.381). Correlating them removes part of that diversification benefit: the maximum-IR mix tilts from 60/40 toward the better manager (80/20), its TEV rises from 4.33% to 5.50%, its expected active return rises from 3.12% to 3.36%, and its IR falls to 0.61. The point moves up-right while the line from the benchmark flattens. (The 60/40 starting mix is the notes\' "risk budgets proportional to information ratios", l.285, which holds for independent managers with equal TEV.)',
       notes_checks=[dict(quantity='sharpe_T', at='from', expected=0.72, tol=0.005, line=307, literal='0.72'),
                     dict(quantity='w[0]', at='from', expected=0.60, tol=1e-9, line=280, literal='0.60')],
       citations=[dict(line=280, note='TEV 6% each, IR 0.60 / 0.40', literal='0.60 and 0.40'),
                  dict(line=313, note='benefit from independence', literal='independent'),
                  dict(line=381, note='trap: combined IR exceeds each only if independent', literal='independent')],
       cal_slope='flatter'),

    mk(id='fr-IM-6-02', reading_id='IM-6', source_block='im6.h.exbox.2', source_file=IM6, source_line=285,
       title='Manager 1 gets more skilful',
       assets=U6_ASSETS, corr=U6_CORR, rf=0.0, point='tangency',
       slider=dict(param='mu[0]', label='Manager 1 expected active return (%) [IR = value / 6]', frm=3.6, to=4.8, step=0.1),
       question='Manager 1\'s IR improves from 0.60 to 0.80 (expected active return 3.6% -> 4.8%, TEV still 6%). Where does the best manager mix go?',
       options=[
           dict(label='Up and slightly right: more risk budget to Manager 1', move='up-right', correct=True,
                why='Risk budgets are proportional to IRs, so Manager 1\'s share rises from 60% to 67%; the mix earns more and, being less balanced, diversifies slightly less.'),
           dict(label='Up and to the left: better skill means less risk', move='up-left', correct=False,
                why='A more lopsided mix of two equal-TEV managers is less diversified, so TEV edges up (4.33% -> 4.47%), not down.'),
           dict(label='Stays: allocation follows assets under management, not skill', move='stays', correct=False,
                why='Risk budgets are proportional to information ratios, not to AUM or expected return (IM-6 l.378-379).'),
       ],
       explanation='"Risk budgets are proportional to information ratios" (IM-6 l.285, l.378). With equal 6% TEVs, the maximum-IR weights are proportional to IR_i: 0.6:0.4 becomes 0.8:0.4, i.e. 67/33. Expected active return of the mix rises from 3.12% to 4.00% and its TEV edges up from 4.33% to 4.47% because the mix is less balanced. The combined IR rises from 0.72 to 0.89 = sqrt(0.8^2 + 0.4^2).',
       notes_checks=[dict(quantity='sharpe_T', at='from', expected=0.72, tol=0.005, line=307, literal='0.72')],
       citations=[dict(line=285, note='risk budgets proportional to IR', literal='proportional to information ratios'),
                  dict(line=378, note='trap: proportional to IR, not AUM or expected return', literal='Risk budgets are proportional')],
       cal_slope='steeper'),

    mk(id='fr-IM-6-03', reading_id='IM-6', source_block='im6.h.tikzpicture.1', source_file=IM6, source_line=319,
       title='Manager 2 catches up',
       assets=U6_ASSETS, corr=U6_CORR, rf=0.0, point='tangency',
       slider=dict(param='mu[1]', label='Manager 2 expected active return (%) [IR = value / 6]', frm=2.4, to=3.6, step=0.1),
       question='Manager 2\'s IR improves from 0.40 to 0.60 (expected active return 2.4% -> 3.6%). Where does the best manager mix go?',
       options=[
           dict(label='Up and to the left: a 50/50 mix earns more with less TEV', move='up-left', correct=True,
                why='Equal IRs mean equal risk budgets; the balanced mix of two independent managers diversifies best, so TEV falls while return rises.'),
           dict(label='Up and to the right', move='up-right', correct=False,
                why='Moving toward a balanced mix of independent managers reduces TEV (4.33% -> 4.24%).'),
           dict(label='Down and to the left: money moves to the weaker manager', move='down-left', correct=False,
                why='Manager 2 is no longer weaker; and the mix\'s expected active return rises (3.12% -> 3.60%).'),
       ],
       explanation='Relative risk budgets follow relative IRs (IM-6 figure caption l.345-351: IR ratio 1.50 gives risk-budget ratio 1.50). When both IRs are 0.60 the ratio is 1.00 and the mix is 50/50. For two independent managers with equal TEV, 50/50 is also the minimum-TEV mix, so the point moves up (3.12% -> 3.60%) and to the left (4.33% -> 4.24%). The combined IR rises to 0.85 = 0.6 x sqrt(2).',
       notes_checks=[dict(quantity='w[0]', at='from', expected=0.60, tol=1e-9, line=280, literal='0.60')],
       citations=[dict(line=346, note='IR ratio 1.50 = risk-budget ratio 1.50', literal='a ratio of $1.50$'),
                  dict(line=285, note='risk budgets proportional to IR')],
       cal_slope='steeper'),

    # ------------------------------------------------------------------ IM-4 (active risk aversion)
    mk(id='fr-IM-4-01', reading_id='IM-4', source_block='im4.e.fmlbox.1', source_file=IM4, source_line=155,
       title='Active risk aversion doubles',
       assets=U6_ASSETS, corr=U6_CORR, rf=0.0, point='complete', A=U6_A,
       slider=dict(param='A', label='risk aversion A (= 2 x active risk aversion lambda_A, decimal units)', frm=U6_A, to=2 * U6_A, step=U6_A / 20),
       question='The fund\'s active risk aversion doubles. Where does its chosen point (manager mix + benchmark) go?',
       options=[
           dict(label='Down-left along the same line, toward the benchmark: active risk halves to 2%', move='down-left', path='along-cal', correct=True,
                why='The IR of the manager mix is unchanged, so the line from the benchmark keeps its slope; the fund simply holds more benchmark. Desired active risk = IR / (2 lambda_A) halves.'),
           dict(label='Jumps to the pure manager mix (no benchmark)', move='to-tangency', correct=False,
                why='That is lower risk aversion, not higher: holding only the managers means MORE active risk (4.33%).'),
           dict(label='Up-right along the line', move='up-right', correct=False,
                why='Reversed: higher aversion buys less active risk.'),
           dict(label='Stays: risk aversion does not change the managers\' IRs', move='stays', correct=False,
                why='True about the IRs (the mix is unchanged), but the SIZE of the active bet is set by risk aversion.'),
       ],
       explanation='IM-4 backs risk aversion out of the IR and the desired active risk: lambda_A = IR / (2 sigma_A) (l.155-156), i.e. sigma_A = IR / (2 lambda_A). In the game\'s convention A = 2 lambda_A, so the complete point sits at sd = IR_T / A. Start: IR 0.7211, A = 18.03, TEV 4.00% (the IM-6 target, IM-6 l.279). Doubling lambda_A halves the active risk to 2.00% and the expected active return to 1.44%; the manager mix is untouched, so the point slides down the same line toward the benchmark (more of the fund in the benchmark, as in IM-6 l.281). Note IM-4\'s own units warning (l.158): the notes\' lambda_A = 0.05 is in percent units; in decimal units it is 5.',
       notes_checks=[dict(quantity='sigma', at='from', expected=4.0, tol=0.001, line=279, literal='TEV of 4'),
                     dict(quantity='yw[0]', at='from', expected=0.555, tol=0.001, line=304, literal='0.555'),
                     dict(quantity='yw[1]', at='from', expected=0.370, tol=0.001, line=304, literal='0.370'),
                     dict(quantity='mu', at='from', expected=2.9, tol=0.02, line=304, literal='2.9')],
       citations=[dict(line=155, note='lambda_A = IR / (2 sigma_A)', literal='\\lambda_A = \\frac{\\text{IR}}{2\\,\\sigma_A}'),
                  dict(line=158, note='percentages, not decimals', literal='Percentages, not decimals'),
                  dict(line=164, note='worked example lambda_A = 0.05')],
       cal_slope='same',
       extra_sources=[dict(reading_id='IM-6', source_file=IM6, lines=[279, 280, 281, 304, 307],
                           note='manager inputs and the 4% TEV target are the IM-6 worked example')]),

    # ------------------------------------------------------------------ IM-1 (CAPM equilibrium)
    mk(id='fr-IM-1-01', reading_id='IM-1', source_block='im1.c.prose_para.1', source_file=IM1, source_line=128,
       title='A more risk-averse investor than average',
       assets=U5_ASSETS, corr=U5_CORR, rf=0.0, point='complete', A=GAMMA_BAR,
       slider=dict(param='A', label='investor risk aversion A (start = gamma-bar of the average investor)', frm=GAMMA_BAR, to=2 * GAMMA_BAR, step=GAMMA_BAR / 20),
       question='Treat the tangency portfolio as "the market". At A = gamma-bar the investor holds exactly the market. Now her risk aversion doubles. Where does her optimal point go?',
       options=[
           dict(label='Down-left along the capital market line, toward the risk-free asset', move='down-left', path='along-cal', correct=True,
                why='She keeps the same risky portfolio (the market) and only changes how much of it she holds: y* halves from 1 to 0.5.'),
           dict(label='Jumps to the minimum-variance portfolio', move='to-min-variance', correct=False,
                why='In the CAPM nobody switches risky portfolios; everyone holds the market and differs only in the amount of factor exposure (lesson 2).'),
           dict(label='Up-right: she needs more return to compensate', move='up-right', correct=False,
                why='Confuses the individual with the equilibrium premium. A MORE risk-averse individual takes less market exposure.'),
           dict(label='Stays: everyone holds the market', move='stays', correct=False,
                why='Everyone holds the same RISKY portfolio, but "each investor has his own optimal exposure" to it (IM-1 l.128).'),
       ],
       explanation='CAPM lessons: "each investor has his own optimal exposure of factor risk" and "the average investor holds the market" (IM-1 l.128-129; table l.196-197). With E(R_m) - R_f = gamma-bar sigma_m^2 (l.137), an investor whose A equals gamma-bar has y* = (E_m - R_f)/(gamma-bar sigma_m^2) = 1: she holds exactly the market. Doubling A halves y*, so the point slides halfway down the same line toward the risk-free asset; the risky mix (90.2% CAD / 9.8% EUR here) is unchanged. Inputs are the IM-5 two-currency universe standing in for the market (the IM-1 notes give no numbers).',
       notes_checks=[dict(quantity='y', at='from', expected=1.0, tol=1e-3, line=129, literal='holds the market')],
       citations=[dict(line=128, note='own optimal exposure', literal='own optimal exposure'),
                  dict(line=129, note='average investor holds the market', literal='holds the market'),
                  dict(line=137, note='E(Rm) - Rf = gamma-bar sigma_m^2', literal='\\bar{\\gamma}\\,\\sigma_m^{2}')],
       cal_slope='same',
       extra_sources=[dict(reading_id='IM-5', source_file=IM5, lines=[424, 501, 546, 555],
                           note='asset inputs reused from the IM-5 two-currency example')]),

    mk(id='fr-IM-1-02', reading_id='IM-1', source_block='im1.c.fmlbox.1', source_file=IM1, source_line=137,
       title='The market gets more volatile, the premium does not move',
       assets=U5_ASSETS, corr=U5_CORR, rf=0.0, point='complete', A=GAMMA_BAR,
       slider=dict(param='sigma[0]', label='CAD volatility (%) - the market\'s main holding', frm=5.0, to=6.0, step=0.1),
       question='The average investor (A = gamma-bar) holds the market. Market variance rises (CAD vol 5% -> 6%) but expected returns are left unchanged. Where does her optimal point go?',
       options=[
           dict(label='Down and to the left: she now wants less than 100% of the market', move='down-left', correct=True,
                why='Equilibrium breaks: at the old premium the average investor is no longer willing to hold the whole market (y* falls to 0.72). The premium would have to rise for her to hold it again.'),
           dict(label='Up and to the right: riskier market, higher expected return', move='up-right', correct=False,
                why='That is where equilibrium must END UP (the premium rises), but the slider held expected returns fixed; the investor\'s point itself moves down.'),
           dict(label='Straight right: same return, more risk', move='right', correct=False,
                why='She does not passively absorb the extra variance; she cuts her exposure, which lowers both risk and return.'),
           dict(label='Stays: the average investor always holds the market', move='stays', correct=False,
                why='Only at the equilibrium premium. With the premium frozen, the identity E(R_m) - R_f = gamma-bar sigma_m^2 no longer holds.'),
       ],
       explanation='E(R_m) - R_f = gamma-bar sigma_m^2 (IM-1 l.137): the premium "rises when the market becomes more volatile" (l.150-151). Freeze the premium and raise the market\'s variance, and the average investor\'s optimal holding y* = (E_m - R_f)/(gamma-bar sigma_m^2) falls below 1 (here to 0.72): the visual breaks, with her point sliding down-left off the old CAL onto a flatter one. It re-forms only when the market premium rises by gamma-bar times the change in variance. Inputs are the IM-5 two-currency universe standing in for the market.',
       notes_checks=[dict(quantity='y', at='from', expected=1.0, tol=1e-3, line=129, literal='holds the market')],
       citations=[dict(line=137, note='E(Rm) - Rf = gamma-bar sigma_m^2'),
                  dict(line=150, note='premium rises with market volatility', literal='rises when the average investor'),
                  dict(line=372, note='trap: both terms push the premium the same way', literal='Higher risk aversion')],
       cal_slope='flatter',
       extra_sources=[dict(reading_id='IM-5', source_file=IM5, lines=[424, 546, 555],
                           note='asset inputs reused from the IM-5 two-currency example')]),
]


def build():
    items = []
    for s in SPECS:
        s = dict(s)
        sl = s.pop('slider')
        slider = dict(param=sl['param'], label=sl['label'], **{'from': sl['frm']}, to=sl['to'], step=sl['step'])
        u5 = s['assets'] is U5_ASSETS
        item = dict(id=s['id'], reading_id=s['reading_id'], source_block=s['source_block'],
                    source_file=s['source_file'], source_line=s['source_line'], title=s['title'],
                    plane=U5_PLANE if u5 else U6_PLANE,
                    assets=[dict(a) for a in s['assets']], corr=[list(r) for r in s['corr']], rf=s['rf'])
        if s['point'] == 'complete':
            item['A'] = s['A']
        item.update(point=s['point'], slider=slider, question=s['question'], options=s['options'],
                    explanation=s['explanation'], cal_slope=s['cal_slope'],
                    inputs_source=(U5_SOURCE + ' ' + U5_UNITS) if u5 else U6_SOURCE,
                    citations=s['citations'], notes_checks=s['notes_checks'])
        if s.get('extra_sources'):
            item['extra_sources'] = s['extra_sources']
        p0, p1, move = E.run_item(item)
        item['answer'] = {'move': move,
                          'from': {'sigma': round(p0['sigma'], 4), 'mu': round(p0['mu'], 4),
                                   'weights': [round(x, 4) for x in p0['w']], 'y': round(p0['y'], 4)},
                          'to': {'sigma': round(p1['sigma'], 4), 'mu': round(p1['mu'], 4),
                                 'weights': [round(x, 4) for x in p1['w']], 'y': round(p1['y'], 4)}}
        items.append(item)
    return {
        'version': 1,
        'mechanic': 'frontier-rider',
        'conventions': CONVENTIONS,
        'move_codes': list(E.MOVES) + list(E.JUMPS),
        'omitted': [
            dict(reading_id='IM-17', reason='States that optimal holdings of illiquid assets are lower (l.210-211) and that unsmoothing raises risk estimates but not means (l.101-104), but gives no volatilities or correlations; any frontier would need invented inputs.'),
            dict(reading_id='IM-3', reason='Beta/volatility anomaly quintiles give means and Sharpe ratios (l.386-409) but no correlations; leverage-constraint story is a constrained problem outside this unconstrained engine.'),
            dict(reading_id='IM-7', reason='The M^2 figure (l.131-160) draws a CAL, but its plotted line (slope 0.4333) is inconsistent with its own points (R_F 3%, P at 24% / 12.5%), so it cannot seed a numeric item.'),
            dict(reading_id='(any)', reason='No reading in the notes states the comparative static for a change in rf on the TANGENCY portfolio, so no rf-slider tangency item was made; the only rf item is the min-variance invariance (IM-5).'),
        ],
        'items': items,
    }


if __name__ == '__main__':
    out = os.path.join(HERE, '..', '..', 'content', 'games', 'mechanics', 'frontier-rider.json')
    with open(out, 'w') as f:
        json.dump(build(), f, indent=1, ensure_ascii=False)
        f.write('\n')
    print('wrote', os.path.normpath(out))
