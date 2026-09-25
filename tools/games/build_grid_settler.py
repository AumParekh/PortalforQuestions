#!/usr/bin/env python3
"""Builds content/games/mechanics/grid-settler.json (Grid Settler) from the notes' two-way
classifications.

    python3 tools/games/build_grid_settler.py && python3 tools/games/validate_grid-settler.py

Two kinds of source feed the grids:
  * genuine two-attribute classifications, where each tile is an object and both axes are
    attributes of it (Basel event types by frequency x severity, LTR-9's liquidity taxonomy by
    horizon x stress availability, LTR-7's transactions by TSAA x TSECF effect, IS/duration gap
    prescriptions by forecast x tool, performance measures by risk basis x form, backtest
    decision x true model state, geopolitical winners/losers by cut, add-on factor grids, ...);
  * comparison tables whose rows and columns are both categories (x = the things compared,
    y = the dimension of comparison) with the cell entries as tiles.

Every tile carries a verbatim `evidence` phrase from the notes; the builder locates the line it
sits on (`line`) by searching the reading's file from the item's source_line (then from 25 lines
before it), and the validator re-checks the phrase there. source_line is the line of the source
block (table / figure) and source_block is the nearest block of the reading at or before it.
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'content', 'games', 'mechanics', 'grid-settler.json')
BLOCKS = os.path.join(ROOT, 'content', 'games', 'game-blocks.json')


CHIPS = {'\\chipvhigh': ' very high ', '\\chiplow': ' low ', '\\chipmod': ' moderate ',
         '\\chiphigh': ' high '}   # preamble.tex: rating chips used in ORR-1's table


def norm(s):
    for k, v in CHIPS.items():
        s = s.replace(k, v)
    s = s.replace('\\%', ' ').replace('\\&', ' and ').replace('&', ' ')
    s = re.sub(r'\\[a-zA-Z]+\*?', ' ', s)
    s = s.lower()
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return ' ' + ' '.join(s.split()) + ' '


def norm_plain(s):
    return ' ' + ' '.join(re.sub(r'[^a-z0-9]+', ' ', s.lower()).split()) + ' '


def T(text, x, y, ev, why=None):
    return dict(text=text, cell=[x, y], ev=ev, why=why)


# ---------------------------------------------------------------------------------------------
# Specs. `block` is the game-blocks id of the table/figure the grid comes from; `pev` is a
# verbatim phrase supporting the pattern.
# ---------------------------------------------------------------------------------------------
SPECS = [
    # ===================================================== genuine two-attribute grids
    dict(
        rid='ORR-1', block='orr1.b.table.1',
        title='Basel event types by frequency and loss severity',
        x=dict(label='Frequency', values=['Low', 'Moderate', 'High']),
        y=dict(label='Loss severity', values=['Low', 'High', 'Very high']),
        tiles=[
            T('Internal fraud: employee defalcation, rogue trading', 0, 0,
              'Employee defalcation, rogue trading & Low & Low',
              'ORR-1 rates internal fraud Low frequency, Low loss severity.'),
            T('External fraud: credit card fraud, hacking losses', 2, 0,
              'Credit card fraud, losses from hacking & High & Low',
              'External fraud is High frequency but Low loss severity.'),
            T('Employment practices and workplace safety', 1, 0,
              'Employee termination, discrimination & Moderate & Low',
              'EPWS is the only Moderate-frequency category; its severity is Low.'),
            T('Clients, products, and business practices', 2, 2,
              'Client errors, regulatory fines & High & Very High',
              'CPBP (client errors, regulatory fines) is High frequency and Very High severity.'),
            T('Damage to physical assets: weather, negligence', 0, 0,
              'Weather-related events, negligence & Low & Low',
              'DPA is Low frequency, Low loss severity in the ORR-1 table.'),
            T('Business disruption and system failures', 0, 0,
              'IT problems, service interruptions & Low & Low',
              'BDSF (IT problems, service interruptions) is Low frequency, Low severity.'),
            T('Execution, delivery, and process management', 2, 1,
              'Clerical errors, insufficient documentation & High & High',
              'EDPM (clerical errors, documentation) is High frequency and High severity.'),
        ],
        cell_keys=dict(x=[['low'], ['moderate'], ['high']], y=[['low'], ['high'], ['very high']]),
        pattern=('Three of the seven categories (IF, DPA, BDSF) pile into the low-frequency, '
                 'low-severity corner, and the only high-severity categories, CPBP and EDPM, are '
                 'also high-frequency.'),
        pev='The seven Basel II Level 1 event-type categories',
        explanation=('ORR-1 b grades each Basel II Level 1 event type on frequency and loss '
                     'severity. Placing all seven shows that no category is rated rare but severe, '
                     'and that the two categories with high severity (CPBP very high, EDPM high) '
                     'are exactly the process- and client-driven ones rated high frequency.')),
    dict(
        rid='LTR-9', block='ltr9.a.table.1',
        title='Liquidity taxonomy: funding horizon and stress availability',
        x=dict(label='Funding horizon', values=['Short-term', 'Medium', 'Long-term']),
        y=dict(label='Available under stress?',
               values=['Not available / not intended', 'Partly (specific outflows)',
                       'Available for general obligations']),
        tiles=[
            T('Cash that clears payment transactions daily', 0, 0,
              'clear payment transactions on a daily basis',
              'Operational liquidity: short-term, not available for drawdown under stress.'),
            T('Funds typical day-to-day business operations', 0, 0,
              'Cash used to fund typical business operations',
              'That is operational liquidity: short-term and not available for drawdown.'),
            T('The liquid asset buffer', 0, 2, 'The liquid asset buffer',
              'Contingent liquidity is the liquid asset buffer: short-term and available under stress.'),
            T('Liquid investments, facilities, unrestricted deposits', 0, 2,
              'liquidity facility availability, and unrestricted deposits',
              'These make up the contingent buffer, available for general obligations under stress.'),
            T('Collateralization requirements', 1, 1, 'collateralization requirements',
              'Restricted liquidity (medium horizon, partly available) covers e.g. collateralization.'),
            T('Reserved for purposes arising within normal operations', 1, 1,
              'specifically defined purposes arising from normal operations',
              'Restricted: medium horizon, attributed to specific outflows, not general obligations.'),
            T('M&A and capital improvement projects', 2, 0, 'capital improvement projects',
              'Strategic liquidity: long-term, not intended to fund daily operations under stress.'),
            T('Strategic initiatives outside normal operations', 2, 0,
              'Reserved for strategic business initiatives',
              'Strategic: long-term, reserved for initiatives outside normal operations.'),
        ],
        pattern=('Only the short-term contingent buffer reaches the top row: availability under '
                 'stress does not rise with horizon, and operational and strategic liquidity sit at '
                 'opposite ends of the horizon axis yet both at the bottom of availability.'),
        pev='Only contingent liquidity is freely available',
        explanation=('LTR-9 lays the four uses of funding liquidity on two axes: short- to long-term '
                     'funding, and not available to available under a stress test. Contingent '
                     'liquidity is the only freely available one; restricted is attributed to specific '
                     'outflows; strategic is not meant for daily operations, although its '
                     'high-quality asset portion does contribute to contingent funding.')),
    dict(
        rid='LTR-7', block='ltr7.e.table.1',
        title='Treasury transactions: effect on TSAA and on TSECF',
        x=dict(label='TSAA (available assets)', values=['Up', 'Down']),
        y=dict(label='TSECF (cash flows)', values=['Up', 'Down', 'No change']),
        tiles=[
            T('Asset purchase', 0, 1, 'Asset purchase & Up & Down',
              'Buying an asset adds to TSAA and takes cash out (TSECF down).'),
            T('Asset sale', 1, 0, 'Asset sale & Down & Up',
              'Selling removes the asset from TSAA and brings cash in (TSECF up).'),
            T('Buy/sellback, at the start', 0, 1, 'Buy/sellback --- at the start & Up & Down',
              'The notes grid: buy/sellback at the start, TSAA Up, TSECF Down.'),
            T('Buy/sellback, at the end', 1, 0, 'Buy/sellback --- at the end & Down & Up',
              'At the end of a buy/sellback: TSAA Down, TSECF Up.'),
            T('Sell/buyback, at the start', 1, 2,
              'Sell/buyback --- at the start & Down & No change',
              'The notes grid: sell/buyback at the start, TSAA Down, TSECF No change.'),
            T('Sell/buyback, at the end', 0, 1,
              'Sell/buyback --- at the end & Up & Down by interest',
              'At the end of a sell/buyback: TSAA Up, TSECF Down by interest.'),
            T('Securities lending', 1, 0, 'Securities lending & Down & Up by fees',
              'Lending a security: TSAA Down, TSECF Up by fees.'),
            T('Securities borrowing', 0, 1, 'Securities borrowing & Up & Down by fees',
              'Borrowing a security: TSAA Up, TSECF Down by fees.'),
            T('Repo, asset leg (owned, transferred)', 1, 2,
              'asset leg (owned, transferred) & Down (NP) & No change',
              'Repo asset leg: TSAA Down (NP), TSECF No change.'),
            T('Repo, counterparty side', 0, 1,
              'counterparty side & Up (NP) & Down by interest',
              'Repo counterparty side: TSAA Up (NP), TSECF Down by interest.'),
            T('Reverse repo, own side', 0, 1, 'own side & Up (NP) & Down',
              'Reverse repo own side: TSAA Up (NP), TSECF Down (repo minus haircut).'),
            T('Reverse repo, counterparty side', 1, 0,
              'counterparty side & Down (NP) & Up by cash',
              'Reverse repo counterparty side: TSAA Down (NP), TSECF Up by cash plus interest.'),
        ],
        cell_keys=dict(x=[['up', 'up np'], ['down', 'down np']],
                       y=[['up'], ['down'], ['no change']]),
        pattern=('No transaction moves TSAA and TSECF the same way: every TSAA rise comes with cash '
                 'going out, and a TSAA fall comes with cash in or, for the sell/buyback start and '
                 'the repo asset leg, with no TSECF change at all.'),
        pev='TSAA tracks what the bank holds and can pledge',
        explanation=('LTR-7 e: TSAA tracks what the bank holds and can pledge, TSECF tracks cash '
                     'moving, LGC records only whether liquidity was generated. The two '
                     'no-TSECF-change transactions (sell/buyback start, repo asset leg) are both '
                     'marked as generating LGC in the same table.')),
    dict(
        rid='LTR-17', block='ltr17.b.table.3',
        title='Rate forecast versus gap tool: what aggressive management does',
        x=dict(label="Management's rate forecast", values=['Rates will rise', 'Rates will fall']),
        y=dict(label='Gap tool', values=['IS gap management', 'Duration gap management']),
        tiles=[
            T('Target a positive IS gap', 0, 0, 'market interest rates & Positive IS gap',
              'Rising forecast: best IS gap position is positive (assets reprice up faster).'),
            T('Increase interest-sensitive assets', 0, 0,
              'Increase interest-sensitive assets; decrease interest-sensitive liabilities',
              'The aggressive IS-gap action for a rising-rate forecast.'),
            T('Decrease interest-sensitive liabilities', 0, 0,
              'Increase interest-sensitive assets; decrease interest-sensitive liabilities',
              'Second half of the rising-rate IS-gap action.'),
            T('Target a negative IS gap', 1, 0, 'market interest rates & Negative IS gap',
              'Falling forecast: best IS gap position is negative.'),
            T('Decrease interest-sensitive assets', 1, 0,
              'Decrease interest-sensitive assets; increase interest-sensitive liabilities',
              'The aggressive IS-gap action for a falling-rate forecast.'),
            T('Increase interest-sensitive liabilities', 1, 0,
              'Decrease interest-sensitive assets; increase interest-sensitive liabilities',
              'Second half of the falling-rate IS-gap action.'),
            T('Reduce asset duration (D_A)', 0, 1, 'Reduce $D_A$ and increase $D_L$',
              'Rates will rise: reduce D_A and increase D_L.'),
            T('Increase liability duration (D_L)', 0, 1, 'Reduce $D_A$ and increase $D_L$',
              'Rates will rise: lengthening liabilities is the other half of the move.'),
            T('Move toward a negative duration gap', 0, 1,
              'moving closer to a negative duration gap',
              'For a rising forecast the duration action moves toward a negative gap.'),
            T('Increase asset duration (D_A)', 1, 1, 'Increase $D_A$ and reduce $D_L$',
              'Rates will fall: increase D_A and reduce D_L.'),
            T('Reduce liability duration (D_L)', 1, 1, 'Increase $D_A$ and reduce $D_L$',
              'Rates will fall: shortening liabilities is the other half of the move.'),
            T('Move toward a positive duration gap', 1, 1,
              'moving closer to a positive duration gap',
              'For a falling forecast the duration action moves toward a positive gap.'),
        ],
        pattern=('The same forecast calls for opposite gap signs on the two tools: rising rates '
                 'want a positive IS gap but a negative duration gap, because one protects a flow '
                 '(NII) and the other a value (net worth).'),
        pev='The two prescriptions have opposite signs for the same forecast',
        explanation=('LTR-17 gives the aggressive IS-gap and duration-gap prescriptions in two '
                     'separate tables; the trapbox flags that they carry opposite signs for the same '
                     'forecast. Both only pay off if the forecast is right: aggressive gap '
                     'management converts rate risk into forecast risk.')),
    dict(
        rid='LTR-17', block='ltr17.b.table.1',
        title='Positive versus negative IS gap: signature, risk, fix',
        x=dict(label='IS gap', values=['Positive (asset-sensitive)', 'Negative (liability-sensitive)']),
        y=dict(label='Aspect', values=['Interest sensitivity ratio', 'The risk', 'Response to close the gap']),
        tiles=[
            T('Interest sensitivity ratio above one', 0, 0,
              'Interest sensitivity ratio greater than one',
              'An asset-sensitive firm has ISA > ISL, so ISA/ISL > 1.'),
            T('Interest sensitivity ratio below one', 1, 0,
              'Interest sensitivity ratio less than one',
              'A liability-sensitive firm has ISA < ISL, so ISA/ISL < 1.'),
            T('Losses if interest rates fall', 0, 1, 'Losses if interest rates fall',
              'Positive gap: falling rates reduce the net interest margin.'),
            T('Losses if interest rates rise', 1, 1, 'Losses if interest rates rise',
              'Negative gap: rising rates reduce the net interest margin.'),
            T('Extend asset maturities', 0, 2,
              'Extend asset maturities or shorten liability maturities',
              'Closing a positive gap: longer assets are less rate-sensitive.'),
            T('Shorten liability maturities', 0, 2,
              'Extend asset maturities or shorten liability maturities',
              'Closing a positive gap: shorter liabilities are more rate-sensitive.'),
            T('Increase ISL or reduce ISA', 0, 2,
              'Increase interest-sensitive liabilities or reduce interest-sensitive assets',
              'Response 3 for a positive gap.'),
            T('Shorten asset maturities', 1, 2,
              'Shorten asset maturities or lengthen liability maturities',
              'Closing a negative gap: shorter assets reprice sooner.'),
            T('Lengthen liability maturities', 1, 2,
              'Shorten asset maturities or lengthen liability maturities',
              'Closing a negative gap: longer liabilities reprice later.'),
            T('Decrease ISL or increase ISA', 1, 2,
              'Decrease interest-sensitive liabilities or increase interest-sensitive assets',
              'Response 3 for a negative gap.'),
        ],
        pattern=('The two columns are mirror images, and the maturity fixes run opposite to the '
                 'gap sign: a positive gap is closed by extending assets and shortening '
                 'liabilities, a negative gap by the reverse.'),
        pev='Maturity adjustments run opposite to the gap sign',
        explanation=('LTR-17 b: an asset-sensitive firm (ISA > ISL) loses NIM when rates fall, a '
                     'liability-sensitive one when rates rise. Longer maturity means less '
                     'interest-sensitive, which is why the maturity responses look inverted. Both '
                     'rows also list "do nothing" as a legitimate response.')),
    dict(
        rid='IM-7', block='im7.b.table.1',
        title='Performance measures: risk basis and form',
        x=dict(label='Risk the measure is built on',
               values=['Total risk (sigma)', 'Systematic risk (beta)', 'Tracking error']),
        y=dict(label='Form', values=['Ratio', 'Difference']),
        tiles=[
            T('Sharpe ratio', 0, 0, 'Uses standard deviation --- total risk',
              'Sharpe divides excess return by sigma: a total-risk ratio.'),
            T('Treynor measure', 1, 0, 'Uses beta --- systematic risk',
              'Treynor divides excess return by beta: a systematic-risk ratio.'),
            T('Information ratio', 2, 0, 'the information ratio by tracking error',
              'The IR divides active return by tracking error.'),
            T("Jensen's alpha", 1, 1, "Jensen's alpha is a difference, not a ratio",
              'Alpha = actual return minus CAPM (beta-based) expected return: a difference.'),
            T('M²', 0, 1, 'M^2$ subtracts the market return',
              'M2 subtracts the market return from the Sharpe-levered return; built on total risk.'),
            T('Best for a portfolio held on its own', 0, 0,
              'The measure for a portfolio held on its own',
              'That is the Sharpe ratio: it uses total risk.'),
            T('Suits well-diversified portfolios', 1, 0, 'Useful for well-diversified portfolios',
              'That is Treynor: for diversified portfolios total and systematic risk are similar.'),
            T('Like Sharpe, but against a benchmark', 2, 0, 'Like Sharpe but against a benchmark',
              'That is the information ratio, whose denominator is tracking error.'),
            T('Gives the same rankings as Sharpe', 0, 1,
              'Sharpe and $M^2$ give the same rankings',
              'That is M2, a return gap versus the market that restates Sharpe (total risk).'),
            T('Actual return minus CAPM-expected return', 1, 1,
              'difference between actual return and the return expected',
              "That is Jensen's alpha, defined against beta."),
        ],
        pattern=('Each risk column is a ranking family: Sharpe and M2 (total risk) always rank '
                 'alike, Treynor and Jensen (beta) rank alike, and where the two families disagree '
                 'the disagreement is about diversification.'),
        pev='Jensen and Treynor rank alike; Sharpe and $M^2$ rank alike',
        explanation=('IM-7: Sharpe divides by sigma, Treynor by beta, the information ratio by '
                     "tracking error; Jensen's alpha and M2 are differences, not ratios. Pairing "
                     'Sharpe with Treynor, or Jensen with M2, is the offered corruption.')),
    dict(
        rid='MR-4', block='mr4.d.table.1',
        title='Backtesting decisions versus the true state of the model',
        x=dict(label='True state of the model', values=['Correct (accurate)', 'Incorrect (inaccurate)']),
        y=dict(label='Backtest decision', values=['Accept', 'Reject']),
        tiles=[
            T('Type I error', 0, 1, 'Type I error:} rejecting an accurate model',
              'Type I sits in the Reject row, Correct column.'),
            T('Type II error', 1, 0, 'Type II error:} accepting an inaccurate model',
              'Type II sits in the Accept row, Incorrect column.'),
            T('Rejecting an accurate model', 0, 1, 'rejecting an accurate model',
              'Definition of a Type I error.'),
            T('Accepting an inaccurate model', 1, 0, 'accepting an inaccurate model',
              'Definition of a Type II error.'),
            T('OK', 0, 0, 'Accept & OK',
              'Accepting a correct model is marked OK.'),
            T('Power of the test', 1, 1, 'Power of test',
              'Rejecting an incorrect model is the power of the test.'),
        ],
        pattern=('The two errors sit on one diagonal (reject-correct, accept-incorrect); the other '
                 'diagonal holds the right calls, with rejecting a bad model being the power of '
                 'the test.'),
        pev='The two diagonal cells are the two ways of being wrong',
        explanation=('MR-4 d: users must balance Type I against Type II errors. Ideally a low Type I '
                     'rate with a very low Type II rate, a powerful test, but that is very '
                     'difficult.')),
    dict(
        rid='CI-4', block='ci4.b.table.1',
        title='Geopolitical risk: who gains and who loses',
        x=dict(label='Direction', values=['Gainers / appreciate', 'Losers / decline']),
        y=dict(label='Cut', values=['Countries', 'Sectors', 'Asset classes']),
        tiles=[
            T('Commodity exporters', 0, 0, 'Commodity exporters benefit from higher prices',
              'Exporters benefit from higher commodity prices.'),
            T('Conflict countries', 1, 0, 'Conflict countries take the most severe damage',
              'Physical destruction, sanctions and trade disruption.'),
            T('Commodity importers', 1, 0, 'Commodity importers suffer currency depreciation',
              'Importers suffer currency depreciation and higher costs.'),
            T('Defence firms', 0, 1, 'Defence and energy, from increased military spending',
              'Defence gains from increased military spending.'),
            T('Energy firms', 0, 1, 'Defence and energy, from increased military spending',
              'Energy gains from higher commodity prices.'),
            T('Banking', 1, 1, 'Banking, retail and utilities',
              'Banking loses from weakened demand and tighter credit.'),
            T('Retail', 1, 1, 'Banking, retail and utilities',
              'Retail loses from weakened demand.'),
            T('Utilities', 1, 1, 'Banking, retail and utilities',
              'Utilities are listed with banking and retail among the losing sectors.'),
            T('Oil and gold', 0, 2, 'oil and gold usually appreciate',
              'Supply fears and safe-haven demand lift oil and gold.'),
            T('Safe-haven sovereign bonds', 0, 2, 'Safe-haven sovereign bonds appreciate',
              'They appreciate, so their yields fall.'),
            T('Equities', 1, 2, 'Equities generally decline',
              'About 3% for a standard event, up to 9% for a severe shock.'),
        ],
        pattern=('Commodity links show up in every row of the gainer column (exporters, energy, oil '
                 'and gold), and the same event that lifts a commodity exporter depreciates a commodity '
                 "importer's currency."),
        pev='the same event that lifts a commodity exporter',
        explanation=('CI-4 b: the impact of geopolitical risk is uneven and depends on economic '
                     'structure and exposure; reading across each row, rather than down a column, '
                     'is what the objective asks for.')),
    dict(
        rid='CI-1', block='ci1.b.table.1',
        title='AI in algorithmic trading: negative versus positive scenario',
        x=dict(label='Scenario', values=['Negative', 'Positive']),
        y=dict(label='Channel', values=['Market liquidity', 'Leverage', 'Interconnectedness']),
        tiles=[
            T('Sudden liquidity withdrawal under stress gets worse', 0, 0,
              'exacerbate risks related to sudden liquidity withdrawal',
              'Negative: AI spreads algo trading and worsens liquidity withdrawal under stress.'),
            T('Lower flash-crash risk', 1, 0, 'lower flash-crash risk',
              'Positive: AI algorithms operate across more conditions with lower flash-crash risk.'),
            T('Remaining arbitrage needs higher leverage for similar returns', 0, 1,
              'remaining opportunities might require higher leverage',
              'Negative: AI-driven strategies boost short-term leverage.'),
            T('Automated, more frequent management of leveraged positions', 1, 1,
              'more frequent and automated management of leveraged positions',
              'Positive: AI improves the management of leverage.'),
            T('Higher correlations across market segments spread stress', 0, 2,
              'higher correlations between capital market segments',
              'Negative consequence of increased interconnectedness.'),
            T('Better access and liquidity, including emerging markets', 1, 2,
              'including emerging markets',
              'Positive consequence of increased interconnectedness.'),
        ],
        pattern=('Every channel splits cleanly into a threat and a benefit, but in the '
                 'interconnectedness row both scenarios start from the same fact: '
                 'interconnectedness increases either way and only the consequence differs.'),
        pev='interconnectedness increases in both scenarios',
        explanation=('CI-1 b (IMF staff assessment): the notes keep the source\'s structural oddity '
                     'that interconnectedness rises in both scenarios, so no answer that turns on '
                     'whether it rises can be settled by the scenario alone.')),
    dict(
        rid='ORR-21', block='orr21.b.table.3',
        title='Current Exposure Method add-on factors',
        x=dict(label='Contract', values=['Interest rate swaps', 'Foreign exchange swaps']),
        y=dict(label='Remaining maturity',
               values=['Less than one year', 'Five years or less', 'More than five years']),
        tiles=[
            T('Zero', 0, 0, 'Less than one year & zero & 1.0\\%',
              'IRS add-on under one year is zero.'),
            T('0.5%', 0, 1, 'Five years or less & 0.5\\% & 5.0\\%',
              'IRS add-on for one to five years; the worked 3-year swap uses 0.005.'),
            T('1.5%', 0, 2, 'More than five years & 1.5\\% & 7.5\\%',
              'IRS add-on beyond five years.'),
            T('1.0%', 1, 0, 'Less than one year & zero & 1.0\\%',
              'FX swap add-on under one year.'),
            T('5.0%', 1, 1, 'Five years or less & 0.5\\% & 5.0\\%',
              'FX swap add-on for one to five years.'),
            T('7.5%', 1, 2, 'More than five years & 1.5\\% & 7.5\\%',
              'FX swap add-on beyond five years.'),
        ],
        pattern=('Add-ons rise with remaining maturity in both columns, and the FX swap add-on is '
                 'larger than the interest rate swap add-on at every maturity.'),
        pev='Add-on factor $D$ as a percentage of notional, Current Exposure Method',
        numeric=[dict(kind='increasing_y', x=0), dict(kind='increasing_y', x=1),
                 dict(kind='row_greater', y=0, hi=1, lo=0), dict(kind='row_greater', y=1, hi=1, lo=0),
                 dict(kind='row_greater', y=2, hi=1, lo=0)],
        explanation=('ORR-21 (Basel I): credit equivalent = max(V, 0) plus the add-on D times '
                     'notional, with D read from this table by contract type and remaining '
                     'maturity.')),
    dict(
        rid='ORR-21', block='orr21.b.table.4',
        title='Original Exposure Method add-on factors',
        x=dict(label='Contract', values=['Interest rate contracts', 'Foreign exchange contracts']),
        y=dict(label='Maturity', values=['Less than one year', 'Between one and two years',
                                         'Greater than two years']),
        tiles=[
            T('0.5%', 0, 0, 'Less than one year & 0.5\\% & 2\\%', 'IR contracts under one year.'),
            T('1%', 0, 1, 'Between one and two years & 1\\% & 5\\%', 'IR contracts, one to two years.'),
            T('1% + 1% x INT[M-1]', 0, 2, '1\\%+1\\%\\times \\mathrm{INT}[M-1]',
              'IR contracts beyond two years: 1% plus 1% per extra year.'),
            T('2%', 1, 0, 'Less than one year & 0.5\\% & 2\\%', 'FX contracts under one year.'),
            T('5%', 1, 1, 'Between one and two years & 1\\% & 5\\%', 'FX contracts, one to two years.'),
            T('5% + 3% x INT[M-1]', 1, 2, '5\\%+3\\%\\times \\mathrm{INT}[M-1]',
              'FX contracts beyond two years: 5% plus 3% per extra year.'),
        ],
        pattern=('The foreign exchange add-on is larger than the interest rate add-on at every '
                 'maturity, and past two years it adds 3% per year of maturity against 1% for '
                 'interest rate contracts.'),
        pev='Add-on factor $D$, Original Exposure Method',
        numeric=[dict(kind='increasing_y', x=0, ys=[0, 1]), dict(kind='increasing_y', x=1, ys=[0, 1]),
                 dict(kind='row_greater', y=0, hi=1, lo=0), dict(kind='row_greater', y=1, hi=1, lo=0),
                 dict(kind='row_greater', y=2, hi=1, lo=0)],
        explanation=('ORR-21: the Original Exposure Method is available only for interest rate and '
                     'FX contracts and ignores current market value; INT[X] returns the closest '
                     'integer to X.')),
    dict(
        rid='ORR-21', block='orr21.f.table.1',
        title='Foundation versus Advanced IRB, parameter by parameter',
        x=dict(label='Approach', values=['Foundation IRB', 'Advanced IRB']),
        y=dict(label='Parameter', values=['LGD', 'EAD', 'Maturity']),
        tiles=[
            T('Set by regulators: 45% senior, 75% subordinated', 0, 0,
              'Set by regulators (45\\% senior, 75\\% subordinated)', None),
            T('Bank-supplied, based on collateral and seniority', 1, 0,
              'Bank-supplied, based on collateral and seniority', None),
            T("Similar to Basel I's CEA with netting", 0, 1, "Similar to Basel I's CEA with netting", None),
            T('Own estimates with supervisory approval', 1, 1,
              'Bank uses own estimates with supervisory approval', None),
            T('Fixed at 2.5', 0, 2, 'Fixed at 2.5', None),
            T('Reflects actual maturity', 1, 2, 'Bank-supplied, reflects actual maturity', None),
        ],
        pattern=('Everything in the Advanced column is bank-supplied, while Foundation leaves LGD '
                 'to regulators and fixes maturity at 2.5.'),
        pev='Foundation versus Advanced IRB, parameter by parameter',
        explanation=('ORR-21 f: in both IRB approaches PD is bank-supplied with a 0.03% floor; the '
                     'two differ on who supplies LGD, EAD and maturity.')),
    dict(
        rid='MR-9', block='mr9.a.table.1',
        title='Correlation by state of the economy',
        x=dict(label='State of the economy', values=['Expansionary', 'Normal', 'Recession']),
        y=dict(label='Statistic', values=['Correlation level', 'Correlation volatility']),
        tiles=[
            T('27.46%', 0, 0, 'Expansionary period & 27.46', 'Correlation level in expansions.'),
            T('33.06%', 1, 0, 'Normal economic period & 33.06', 'Correlation level in normal periods.'),
            T('36.96%', 2, 0, 'Recession & 36.96', 'Correlation level in recessions: the highest.'),
            T('71.17%', 0, 1, '27.46\\% & 71.17', 'Correlation volatility in expansions: the lowest.'),
            T('83.06%', 1, 1, '33.06\\% & 83.06', 'Correlation volatility in normal periods: the highest.'),
            T('80.48%', 2, 1, '36.96\\% $\\leftarrow$ highest & 80.48', 'Correlation volatility in recessions.'),
        ],
        pattern=('Correlation level climbs steadily from expansion to recession, but correlation '
                 'volatility peaks in the normal period, not in recession.'),
        pev='highest',
        numeric=[dict(kind='increasing_x', y=0), dict(kind='argmax_x', y=0, x=2),
                 dict(kind='argmax_x', y=1, x=1), dict(kind='argmin_x', y=1, x=0)],
        explanation=('MR-9 a: Dow stock correlations, with expansions (GDP > 3.5%), normal periods '
                     'and recessions (two consecutive negative quarters).')),
    dict(
        rid='MR-9', block='mr9.b.table.1',
        title='Equity, bond and default correlations compared',
        x=dict(label='Correlation type', values=['Equity', 'Bond', 'Default probability']),
        y=dict(label='Statistic', values=['Average correlation', 'Correlation volatility']),
        tiles=[
            T('35%', 0, 0, 'Equity & 35\\% & 80\\%', 'Average equity correlation.'),
            T('42%', 1, 0, 'Bond & 42\\% & 64\\%', 'Average bond correlation: the highest.'),
            T('30%', 2, 0, 'Default probability & 30\\% & 88\\%',
              'Average default-probability correlation: the lowest.'),
            T('80%', 0, 1, 'Equity & 35\\% & 80\\%', 'Equity correlation volatility.'),
            T('64%', 1, 1, 'Bond & 42\\% & 64\\%', 'Bond correlation volatility: the lowest.'),
            T('88%', 2, 1, 'Default probability & 30\\% & 88\\%',
              'Default-probability correlation volatility: the highest.'),
        ],
        pattern=('The ranking flips between rows: bond correlations are the highest on average but '
                 'the least volatile, default-probability correlations the lowest on average but '
                 'the most volatile.'),
        pev='Bond correlations are the highest on average but the least volatile',
        numeric=[dict(kind='argmax_x', y=0, x=1), dict(kind='argmin_x', y=0, x=2),
                 dict(kind='argmin_x', y=1, x=1), dict(kind='argmax_x', y=1, x=2)],
        explanation=('MR-9 b summary table. Bond correlations are also the slowest to revert (26%) '
                     'and the only type whose best fit is the generalized extreme value '
                     'distribution.')),
    dict(
        rid='CR-20', block='cr20.k.table.1',
        title='Wrong-way versus right-way risk',
        x=dict(label='Risk', values=['Wrong-way risk (WWR)', 'Right-way risk (RWR)']),
        y=dict(label='Aspect', values=['What happens', 'Effect on CVA', 'Effect on DVA']),
        tiles=[
            T('Exposure rises as counterparty credit quality worsens', 0, 0,
              'Exposure increases as the counterparty\'s credit quality worsens', None),
            T('Exposure falls as counterparty credit quality improves', 1, 0,
              'Exposure decreases as the counterparty\'s credit quality improves', None),
            T('Increases CVA', 0, 1, 'Effect on CVA & Increases CVA', None),
            T('Reduces CVA', 1, 1, 'Increases CVA & Reduces CVA', None),
            T('Reduces DVA', 0, 2, 'Effect on DVA & Reduces DVA', None),
            T('Increases DVA', 1, 2, 'Reduces DVA & Increases DVA', None),
        ],
        pattern=('Three directions per column and all three flip together, because underneath '
                 'there is a single correlation between exposure and the counterparty\'s default '
                 'probability.'),
        pev='Three directions per column and all three flip together',
        explanation=('CR-20 k: wrong-way risk is positive correlation between your exposure and '
                     "the counterparty's default probability; right-way risk is the same trade with "
                     'the correlation reversed.')),
    dict(
        rid='CR-19', block='cr19.i.table.1',
        title='Collateral form: counterparty risk versus funding',
        x=dict(label='Effect on counterparty risk',
               values=['Reduced', 'Mitigated if haircuts suffice', 'Problematic']),
        y=dict(label='Effect on funding', values=['Reduced costs', 'No funding benefit']),
        tiles=[
            T('Cash, non-segregated', 0, 0, 'Cash, non-segregated & Reduced & Reduced costs',
              'Reduces counterparty risk and funding costs.'),
            T('Best case: reduces both', 0, 0, 'Best case: reduces both',
              "The notes' verdict on non-segregated cash."),
            T('Securities, rehypothecated', 1, 0,
              'Securities, rehypothecated & Mitigated if haircuts are sufficient',
              'Counterparty risk mitigated if haircuts suffice; funding costs reduced.'),
            T('Good option: mitigates both', 1, 0, 'Good option: mitigates both',
              "The notes' verdict on rehypothecated securities."),
            T('Segregated cash or securities', 0, 1,
              'Segregated cash or securities & Reduced & No funding benefit',
              'Counterparty risk reduced, but no funding benefit (limited reusability).'),
            T('Counterparty bonds, rehypothecated', 2, 0,
              'Counterparty bonds, rehypothecated & Problematic',
              'Worthless upon default, though funding costs are reduced.'),
        ],
        pattern=('The last two rows fail in opposite directions: segregation keeps the '
                 'counterparty protection but kills the funding benefit, while counterparty bonds '
                 'keep the funding benefit and are worthless exactly when default happens.'),
        pev='they fail in opposite directions',
        explanation=('CR-19 i: holding counterparty bonds as collateral is wrong-way risk inside '
                     'the collateral itself.')),
    # ===================================================== comparison tables
    dict(
        rid='CR-5', block='cr5.f.table.1',
        title='Merton, Moody\'s-KMV and CreditMetrics compared',
        x=dict(label='Model', values=['Merton', "Moody's-KMV EDF", 'CreditMetrics']),
        y=dict(label='Dimension', values=['Default point', 'Distribution used', 'Primary use']),
        tiles=[
            T('Short-term debt only', 0, 0, 'Short-term debt only', None),
            T('Short-term debt plus half of long-term debt', 1, 0,
              'Short-term debt $+$ half of long-term debt', None),
            T('No default point; uses a rating transition matrix', 2, 0,
              'Not a default-point model; uses a rating transition matrix', None),
            T('Standardized normal', 0, 1, 'Standardized normal', None),
            T('Empirical distribution of historical default frequencies', 1, 1,
              'Empirical distribution of historical default frequencies', None),
            T('Transition probabilities from the migration matrix', 2, 1,
              'Transition probabilities from the migration matrix', None),
            T('PD for a single firm from option pricing', 0, 2,
              'PD for a single firm from option pricing', None),
            T('PD for a single firm, calibrated to history', 1, 2,
              'PD for a single firm, calibrated to history', None),
            T('Market value of nonmarketable loans and portfolios', 2, 2,
              'Market value of nonmarketable loans and loan portfolios', None),
        ],
        pattern=('Merton and Moody\'s-KMV share the option-pricing skeleton and differ on exactly '
                 'two rows: what goes into the default point, and whether distance to default is '
                 'mapped through the normal distribution or through history.'),
        pev='differ on exactly two things',
        explanation='CR-5 f: CreditMetrics is the odd one out, a migration-matrix valuation model '
                    'for loans and portfolios rather than a single-firm PD model.'),
    dict(
        rid='CR-6', block='cr6.b.table.1',
        title='Through-the-cycle versus point-in-time ratings',
        x=dict(label='Rating philosophy', values=['Through-the-cycle (TTC)', 'Point-in-time (PIT)']),
        y=dict(label='Dimension', values=['Used by', 'Horizon', 'Behaviour', 'Better for']),
        tiles=[
            T('Major rating agencies', 0, 0, 'Major rating agencies', None),
            T('Banks, internally', 1, 0, 'Banks, internally', None),
            T('Long-term view over a full business cycle', 0, 1,
              'Takes a long-term view, over a full business cycle', None),
            T('Current situation, possibly including the next year', 1, 1,
              'Focuses on the current situation, possibly including the next year', None),
            T('Less sensitive to short-term bumps', 0, 2, 'less sensitive to short-term bumps', None),
            T('More volatile; reacts to short-term changes', 1, 2,
              'More volatile; reacts to short-term changes', None),
            T('Long-term loans', 0, 3, 'Better for & Long-term loans', None),
            T('Short-term loans', 1, 3, 'Long-term loans & Short-term loans', None),
        ],
        pattern=('The slower-moving system is the one the agencies use externally for long-term '
                 'loans; the fastest-reacting one is what banks run internally for short-term '
                 'loans.'),
        pev='the system that is slower to move is the one used',
        explanation='CR-6 b: TTC trades responsiveness for stability, PIT the reverse.'),
    dict(
        rid='CR-6', block='cr6.a.table.1',
        title='Credit scoring versus credit rating',
        x=dict(label='System', values=['Credit scoring', 'Credit rating']),
        y=dict(label='Dimension', values=['Who it covers', 'Scale', 'Who produces it',
                                          'Update frequency']),
        tiles=[
            T('Smaller businesses and individuals', 0, 0, 'Smaller businesses and individuals', None),
            T('Larger businesses and governments', 1, 0, 'Larger businesses and governments', None),
            T('Numerical, typically 300 to 850', 0, 1, 'Numerical, typically 300 to 850', None),
            T('Letter grades such as AAA, AA, BBB', 1, 1, 'Letter grades (e.g., AAA, AA, A, BBB', None),
            T('Developed by banks internally', 0, 2, 'Developed by banks internally', None),
            T("External agencies: S&P, Moody's, Fitch", 1, 2,
              'Developed by external credit rating agencies', None),
            T('Updated more frequently', 0, 3, 'Updated more frequently', None),
            T('Updated less frequently', 1, 3, 'Updated less frequently', None),
        ],
        pattern=('Three things move together down the scoring column: smaller borrowers, a '
                 'numerical scale, and an internally produced, frequently refreshed number.'),
        pev='Three things move together down the left column',
        explanation='CR-6 a: scoring and rating are the retail and wholesale faces of the same job.'),
    dict(
        rid='CR-7', block='cr7.b.table.1',
        title='Retail versus corporate credit risk',
        x=dict(label='Portfolio', values=['Retail credit risk', 'Corporate credit risk']),
        y=dict(label='Dimension', values=['Loans', 'Portfolio diversification',
                                          'Early warning signs', 'Impact of defaults']),
        tiles=[
            T('Small loans to individuals and retail customers', 0, 0,
              'Small loans, to individuals and retail customers', None),
            T('Large loans to businesses and corporations', 1, 0,
              'Large loans, to businesses and corporations', None),
            T('Very well diversified: many borrowers', 0, 1,
              'Very well diversified, due to the large number of borrowers', None),
            T('Concentrated: fewer borrowers', 1, 1, 'Poorly diversified and more concentrated', None),
            T('Missed payments can signal potential defaults', 0, 2,
              'can signal potential defaults', None),
            T('No clear signs until it is too late', 1, 2,
              'May not show clear signs until it is too late', None),
            T('A single default has little impact', 0, 3, 'a single default has little impact', None),
            T('Potentially severe, due to large losses', 1, 3,
              'Potentially severe, due to large losses', None),
        ],
        pattern=('Every row runs the same way: retail is easier because of the sheer number of '
                 'small, independent borrowers, corporate is harder because a few large exposures '
                 'carry the portfolio.'),
        pev='Every row runs the same way',
        explanation='CR-7 b: retail versus corporate credit risk.'),
    dict(
        rid='CR-10', block='cr10.a.table.1',
        title='Market VaR versus credit VaR',
        x=dict(label='Measure', values=['Market VaR', 'Credit VaR']),
        y=dict(label='Dimension', values=['Loss driver', 'Time horizon', 'Calculation tools']),
        tiles=[
            T('Market price movements', 0, 0, 'Market price movements', None),
            T('Defaults, downgrades, and credit spread changes', 1, 0,
              'Loan defaults, downgrades, and credit spread changes', None),
            T('One day', 0, 1, 'Time horizon & One day & One year', None),
            T('One year', 1, 1, 'Time horizon & One day & One year', None),
            T('Historical simulation is workable', 0, 2, 'Historical simulation is workable', None),
            T('Needs more complex models than historical simulation', 1, 2,
              'Requires more complex models than the historical simulation', None),
        ],
        pattern=('The horizon row drives the tools row: a one-day window has enough history for '
                 'simple simulation, and a one-year window (about 250 times longer) does not.'),
        pev='The horizon difference is a factor of roughly 250 trading days',
        explanation='CR-10 a: market versus credit VaR.'),
    dict(
        rid='CR-12', block='cr12.e.table.1',
        title='Reduced-form versus structural default-correlation models',
        x=dict(label='Model family', values=['Reduced form models', 'Structural models']),
        y=dict(label='Dimension', values=['Mechanism', 'Correlations produced', 'Practicality',
                                          'Economic cycle']),
        tiles=[
            T('Stochastic hazard rates tied to macroeconomic factors', 0, 0,
              'Assume stochastic hazard rates which are correlated with macroeconomic factors', None),
            T("Merton-based: links defaults to asset values", 1, 0,
              'link defaults to asset values', None),
            T('Low default correlations', 0, 1, 'Low default correlations', None),
            T('High default correlations', 1, 1, 'High default correlations', None),
            T('Easy to calculate', 0, 2, 'Easy to calculate', None),
            T('Time consuming', 1, 2, 'Time consuming', None),
            T("Reflects economic cycles' impact on default correlations", 0, 3,
              "Reflects economic cycles' impact on default correlations", None),
        ],
        pattern=('The trade-off runs one way down the table: the model that is easy to compute '
                 'produces correlations that are too low, the one with realistic correlations is '
                 'expensive to run.'),
        pev='the model that is easy to',
        explanation='CR-12 e: the notes give no economic-cycle entry for structural models.'),
    dict(
        rid='CR-14', block='cr14.b.table.1',
        title='Exchange-traded versus OTC derivatives',
        x=dict(label='Market', values=['Exchange-traded', 'Over-the-counter (OTC)']),
        y=dict(label='Dimension', values=['Contract', 'Liquidity', 'Flexibility', 'Exiting a position']),
        tiles=[
            T('Standardized contracts with fixed terms', 0, 0,
              'Standardized contracts with fixed terms', None),
            T('Privately negotiated and highly customizable', 1, 0,
              'Privately negotiated between two parties, highly customizable', None),
            T('Highly liquid and transparent', 0, 1, 'Highly liquid and transparent', None),
            T('Lower liquidity, though FX stays highly liquid', 1, 1,
              'Lower liquidity; most OTC markets are less liquid', None),
            T('Terms cannot be customized', 0, 2, 'Lacks flexibility, since terms cannot be customized', None),
            T('Allows precise risk management', 1, 2, 'Allows precise risk management', None),
            T('Straightforward exit', 0, 3, 'Exiting a position & Straightforward', None),
            T('May require novation and counterparty approval', 1, 3,
              'May require counterparty approval (novation)', None),
        ],
        pattern=('Every row is the same kind of trade-off: standardization buys liquidity and cheap '
                 'exit, customization buys precision and pays for it in both.'),
        pev='standardization buys liquidity',
        explanation='CR-14 b: exchange-traded versus OTC derivatives.'),
    dict(
        rid='CR-15', block='cr15.a.table.1',
        title='Counterparty risk versus lending risk',
        x=dict(label='Risk', values=['Counterparty risk', 'Lending risk']),
        y=dict(label='Dimension', values=['Where it exists', 'Amount at risk', 'Who bears it']),
        tiles=[
            T('OTC derivatives and securities financing transactions', 0, 0,
              'securities financing transactions', None),
            T('Loans, bonds, mortgages, credit cards', 1, 0, 'Loans, bonds, mortgages, credit cards', None),
            T('Exposure swings between positive and negative', 0, 1,
              'the exposure varies between positive and negative', None),
            T('Notional known with a degree of certainty', 1, 1,
              'The notional amount at risk is usually known', None),
            T('Bilateral: both parties take risk', 0, 2, 'Bilateral: both parties take risk', None),
            T('Unilateral: primarily affects the lender', 1, 2,
              'Unilateral: only one party takes risk', None),
        ],
        pattern=('The bottom two rows decide most questions: lending risk is one-directional with a '
                 'known principal, counterparty risk two-directional with an exposure that swings '
                 'with the underlying.'),
        pev='Lending risk is one-directional with a known principal',
        explanation='CR-15 a: counterparty versus lending risk.'),
    dict(
        rid='CR-17', block='cr17.h.table.1',
        title='One-way versus two-way CSA',
        x=dict(label='CSA', values=['One-way CSA', 'Two-way CSA']),
        y=dict(label='Dimension', values=['Who posts', 'Who benefits', 'When used']),
        tiles=[
            T('Only one party posts, e.g. upon downgrade', 0, 0,
              'Only one party posts collateral, upon a specific event such as a downgrade', None),
            T('Both parties post collateral', 1, 0, 'Both parties post collateral', None),
            T('Benefits the receiver; risk to the poster', 0, 1,
              'Benefits the receiving party; presents risk to the posting party', None),
            T('Benefits both parties', 1, 1, 'Benefits both parties', None),
            T('Counterparties with significantly different credit risks', 0, 2,
              'When counterparties have significantly different credit risks', None),
            T('Counterparties with similar credit risk', 1, 2,
              'When counterparties have similar credit risk', None),
        ],
        pattern=('Credit asymmetry decides the column: a one-way CSA is used when the parties\' '
                 'credit risks differ significantly and benefits only the receiver, a two-way CSA '
                 'when they are similar and benefits both.'),
        pev='When counterparties have significantly different credit risks',
        explanation=('CR-17 h: CSA terms are linked to credit quality; collateral required upon '
                     'downgrade adds protection when the counterparty\'s credit is weak.')),
    dict(
        rid='CR-18', block='cr18.i.table.1',
        title='Initial margin versus the default fund',
        x=dict(label='CCP resource', values=['Initial margin', 'Default fund']),
        y=dict(label='Dimension', values=['Loss coverage', 'Cost of clearing', 'Moral hazard']),
        tiles=[
            T('High-confidence (e.g. 99%) cover of member defaults', 0, 0,
              'Provides high confidence coverage, e.g. 99\\%', None),
            T('Mutualized: higher coverage than initial margin', 1, 0,
              'Being mutualized, offers higher coverage than initial margin', None),
            T('Costlier: each member funds its own', 0, 1, 'Higher: each member funds its own', None),
            T('Makes clearing cheaper and cost-effective', 1, 1,
              'Makes clearing cost-effective, and therefore cheaper', None),
            T('Incentivizes better behaviour', 0, 2, 'Incentivizes better behaviour', None),
            T('Increases moral hazard: losses are shared', 1, 2,
              'Increases moral hazard: losses are shared', None),
        ],
        pattern=('Every row runs the same direction: the default fund buys coverage and cheapness by '
                 'mutualising, and mutualising is exactly what weakens the incentive to behave.'),
        pev='every row runs the same direction',
        explanation='CR-18 i: initial margin versus the default fund.'),
    dict(
        rid='CR-19', block='cr19.b.table.1',
        title='VaR versus credit exposure',
        x=dict(label='Measure', values=['VaR', 'Credit exposure']),
        y=dict(label='Dimension', values=['Purpose', 'Horizon', 'Cash flows', 'Mitigants']),
        tiles=[
            T('Risk management only', 0, 0, 'Risk management only', None),
            T('Both pricing and risk management', 1, 0, 'Both pricing and risk management', None),
            T('Short-term risks', 0, 1, 'Short-term risks', None),
            T('Various longer timeframes', 1, 1, 'Various longer timeframes', None),
            T('Overlooks future cash flows and contractual changes', 0, 2,
              'Overlooks future cash flows and contractual changes', None),
            T('Includes future cash flows to assess future risks', 1, 2,
              'Includes these to assess future risks', None),
            T('Excludes netting and collateral', 0, 3, 'Does not include netting and collateral', None),
            T('Incorporates netting and collateral despite complexity', 1, 3,
              'Incorporates these, despite the complexity', None),
        ],
        pattern=('The purpose row drives the rest: because credit exposure is used for pricing as '
                 'well as risk management, it has to carry everything that affects value over the '
                 'life of the trade.'),
        pev='the first is the one that drives the rest',
        explanation='CR-19 b: VaR versus credit exposure.'),
    dict(
        rid='CR-20', block='cr20.i.table.1',
        title='Incremental versus marginal CVA',
        x=dict(label='Measure', values=['Incremental CVA', 'Marginal CVA']),
        y=dict(label='Dimension', values=['Question answered', 'Exposure used', 'When used']),
        tiles=[
            T('What does adding this trade do to CVA?', 0, 0,
              'What does adding this trade do to portfolio CVA', None),
            T('How is existing CVA attributed across trades?', 1, 0,
              'How is the existing portfolio CVA attributed across its trades', None),
            T('The change in EPE', 0, 1, 'the change in EPE', None),
            T('Marginal EPE', 1, 1, 'Exposure used & Incremental EPE, i.e. the change in EPE & Marginal EPE', None),
            T('At execution, to charge the new trade', 0, 2, 'At execution, to charge the new trade', None),
            T('After the fact, to analyse an existing book', 1, 2,
              'After the fact, to analyse an existing book', None),
        ],
        pattern=('What separates the columns is the question, not the mathematics: incremental is '
                 'forward-looking and trade-by-trade at execution, marginal decomposes a book that '
                 'already exists.'),
        pev='What separates them is the question, not the mathematics',
        explanation='CR-20 i: both are the standalone CVA formula with a different exposure measure.'),
    dict(
        rid='ORR-24', block='orr24.b.table.1',
        title='AMA versus SMA for operational risk capital',
        x=dict(label='Approach', values=['AMA', 'SMA']),
        y=dict(label='Dimension', values=['Methodology', 'Flexibility', 'Challenges', 'Objective']),
        tiles=[
            T("Internal models built on the bank's own data", 0, 0,
              "Allows use of internal models based on the bank's own data", None),
            T('Non-model-based: financial info plus internal loss data', 1, 0,
              'Non-model-based; combines financial info with internal loss data', None),
            T('High: tailored risk measurement models', 0, 1,
              'High; banks can develop tailored risk measurement models', None),
            T('Low: one standardised method for all banks', 1, 1,
              'Low; standardised calculation method for all banks', None),
            T('Lack of comparability, complex calculations', 0, 2,
              'Lack of comparability, complex calculations', None),
            T('Aims to simplify and standardise calculations', 1, 2,
              'Aims to simplify and standardise risk calculations', None),
            T('Tailor ORM to individual bank needs', 0, 3,
              'Tailor operational risk management to individual bank needs', None),
            T('Comparability and simplicity across the sector', 1, 3,
              'Enhance comparability and simplicity across the banking sector', None),
        ],
        pattern=("SMA was developed to address AMA's shortcomings, so each SMA entry answers the "
                 'AMA entry beside it: high flexibility and a lack of comparability on one side, '
                 'low flexibility and comparability on the other.'),
        pev="Developed to address AMA's shortcomings",
        explanation='ORR-24 b: AMA (Basel II, 2006) versus the standardised measurement approach.'),
    dict(
        rid='LTR-1', block='ltr1.d.table.1',
        title='Negative versus positive feedback traders',
        x=dict(label='Trader type', values=['Negative feedback traders', 'Positive feedback traders']),
        y=dict(label='Dimension', values=['Behaviour', 'Style label', 'Effect on the market',
                                          'When they dominate']),
        tiles=[
            T('Buy when prices fall, sell when they rise', 0, 0,
              'Buy when prices fall, sell when prices rise', None),
            T('Sell when prices fall, buy when they rise', 1, 0,
              'Sell when prices fall, buy when prices rise', None),
            T('Value investing', 0, 1, 'Value investing', None),
            T('Momentum investing', 1, 1, 'Momentum investing', None),
            T('Stabilising', 0, 2, 'Effect on the market & Stabilising', None),
            T('Destabilising', 1, 2, 'Destabilising', None),
            T('The market is liquid', 0, 3, 'The market is liquid', None),
            T('Market may become one-sided and illiquid', 1, 3,
              'the market may become one-sided and illiquid', None),
        ],
        pattern=('Each column is one polarity chain: buy on falls, value, stabilising, liquid market; '
                 'versus sell on falls, momentum, destabilising, a one-sided market, which is how a '
                 'liquidity black hole forms.'),
        pev='Negative feedback = buy on falls = stabilising',
        explanation=('LTR-1 d: trend trading, stop-loss rules and dynamic hedging cause positive '
                     'feedback trading; each mechanically requires selling as the price falls.')),
    dict(
        rid='LTR-13', block='ltr13.e.table.1',
        title='General versus special collateral repo',
        x=dict(label='Collateral', values=['General collateral (GC)', 'Special collateral']),
        y=dict(label='Feature', values=['Focus', 'Repo rate', 'Use case']),
        tiles=[
            T('Any acceptable high-quality security from broad categories', 0, 0,
              'any acceptable security from broad categories', None),
            T('A specific security requested by the lender', 1, 0,
              'A specific security requested by the lender', None),
            T('Highest: the GC rate', 0, 1, 'Highest --- the GC rate', None),
            T('Lower: the special rate', 1, 1, 'Lower --- the special rate', None),
            T('General investment', 0, 2, 'General investment', None),
            T('Targeted financing strategies', 1, 2, 'Targeted financing strategies', None),
        ],
        pattern=('The special column carries the lower repo rate because specific collateral '
                 'demands create scarcity, which lowers the repo rate.'),
        pev='specific collateral demands create scarcity',
        explanation='LTR-13 e: general versus special collateral.'),
    dict(
        rid='LTR-16', block='ltr16.a.table.1',
        title='FX swap versus cross-currency swap',
        x=dict(label='Instrument', values=['FX swap', 'Cross-currency swap']),
        y=dict(label='Feature', values=['Tenor', 'Exchange at maturity', 'Interim payments', 'Purpose']),
        tiles=[
            T('Short-term', 0, 0, 'Tenor & Short-term', None),
            T('Longer-term, typically above one year', 1, 0, 'Longer-term, typically above one year', None),
            T('Repaid at the pre-agreed forward rate', 0, 1,
              'repaid at the pre-agreed forward rate at maturity', None),
            T('Exchanged back at the initial spot rate', 1, 1,
              'Borrowed amounts are exchanged back at the initial spot rate', None),
            T('No interim payments', 0, 2, 'Interim payments & None', None),
            T('Periodic exchange of interest payments', 1, 2,
              'Counterparties periodically exchange interest payments', None),
            T('Fund a foreign-currency asset, paying domestic interest', 0, 3,
              'A way of funding an asset denominated in a foreign currency', None),
            T('Longer-horizon funding and hedging', 1, 3, 'Longer-horizon funding and hedging', None),
        ],
        pattern=('Two rows carry the distinction: tenor (short versus beyond a year) and the '
                 're-exchange rate (pre-agreed forward rate versus initial spot rate).'),
        pev='Two discriminators carry the objective',
        explanation='LTR-16 a: FX swap versus cross-currency swap.'),
    dict(
        rid='IM-6', block='im6.b.table.1',
        title='Sell-side versus buy-side use of VaR',
        x=dict(label='Industry', values=['Sell-side (banks)', 'Buy-side (pension funds, institutions)']),
        y=dict(label='Dimension', values=['Horizon', 'Turnover', 'Leverage', 'Consequence']),
        tiles=[
            T('Short horizon; positions change frequently', 0, 0, 'Short. Positions change frequently', None),
            T('Long-term holdings', 1, 0, 'Long-term holdings', None),
            T('High, rapid trading', 0, 1, 'High --- rapid trading', None),
            T('Low turnover', 1, 1, 'rapid trading. & Low.', None),
            T('High leverage', 0, 2, 'Leverage & High.', None),
            T('Lesser leverage', 1, 2, 'Lesser leverage', None),
            T('Needs a responsive, dynamic measure', 0, 3, 'Needs a responsive, dynamic measure', None),
            T('VaR must adapt to long horizons and complexity', 1, 3,
              'VaR must adapt to long horizons', None),
        ],
        pattern=('Horizon, turnover and leverage all point the same way for each side, which is why '
                 'the two industries ended up with different VaR practices from the same measure.'),
        pev='Horizon, turnover and leverage all point the same way for',
        explanation='IM-6 b: sell-side versus buy-side.'),
    dict(
        rid='CI-5', block='ci5.a.table.1',
        title='Monetary versus fiscal policy',
        x=dict(label='Policy', values=['Monetary policy', 'Fiscal policy']),
        y=dict(label='Dimension', values=['Managed by', 'How it reaches the economy', 'Tools', 'Impacts']),
        tiles=[
            T('Central banks', 0, 0, 'Managed by central banks', None),
            T('Governments', 1, 0, 'Managed by governments', None),
            T('Indirectly, via interest rates and money supply', 0, 1,
              'Influences the economy indirectly, via interest rates and money supply', None),
            T('Directly, via taxes, spending, and transfers', 1, 1,
              'Influences the economy directly, via taxes, spending, and transfer payments', None),
            T('Open market operations, policy interest rates', 0, 2,
              'Tools: open market operations, policy interest rates', None),
            T('Taxation, public spending, subsidies', 1, 2,
              'Tools: taxation, public spending, subsidies', None),
            T('Bond yields, borrowing costs, asset prices, FX', 0, 3,
              'Impacts: bond yields, borrowing costs, asset prices, exchange rates', None),
            T('Aggregate demand, employment, income distribution', 1, 3,
              'Impacts: aggregate demand, employment, income distribution', None),
        ],
        pattern=('Row two is the whole contrast: monetary policy works indirectly through the price '
                 'of money, fiscal directly through spending and taxing, which is why the impacts '
                 'row lists market prices on one side and real-economy quantities on the other.'),
        pev='Row two is the whole contrast in one word each',
        explanation='CI-5 a: channels of policy influence.'),
    dict(
        rid='CI-8', block='ci8.a.table.1',
        title='Cyber risk versus ICT risk',
        x=dict(label='Risk', values=['Cyber risks', 'ICT risks']),
        y=dict(label='Dimension', values=['Definition', 'Examples', 'Importance', 'Challenges']),
        tiles=[
            T('Loss of confidentiality, integrity, availability from cyberattacks', 0, 0,
              'resulting from cyberattacks', None),
            T('System disruptions that may not stem from cyberattacks', 1, 0,
              'may not stem from cyberattacks', None),
            T('Client data breaches, unauthorised access, DoS attacks', 0, 1,
              'Breaches of client information, unauthorised access', None),
            T('System breakdowns, communication failures, service outages', 1, 1,
              'System breakdowns, communication failures, service outages', None),
            T('Ranked as significant as market risk by some', 0, 2,
              'Ranked as significant as market risk', None),
            T('Essential for uninterrupted transaction services', 1, 2,
              'Essential for ensuring uninterrupted transaction services', None),
            T('Lack of reliable loss data hinders cyber insurance', 0, 3,
              'hindered the development of cyber insurance', None),
            T('Dependency on technology, vulnerability to system failures', 1, 3,
              'Dependency on technology, vulnerability to system failures', None),
        ],
        pattern=('The two are told apart by cause, not consequence: an outage looks the same to the '
                 'customer either way, but only one caused by an attack is cyber risk.'),
        pev='The two are told apart by',
        explanation='CI-8 a: cyber versus ICT risk.'),
    dict(
        rid='CI-7', block='ci7.e.table.1',
        title='Ledger models: where trust rests and how it fails',
        x=dict(label='Model', values=['Single-operator system', 'Permissionless DLT', 'Permissioned DLT']),
        y=dict(label='Dimension', values=['How trust is established', 'Key trust failure']),
        tiles=[
            T('One entity manages records and validates transactions', 0, 0,
              'one entity manages records and validates transactions', None),
            T('Anyone can validate; trust via consensus and incentives', 1, 0,
              'anyone can participate in validation', None),
            T('Only authorised participants validate transactions', 2, 0,
              'only authorised participants validate transactions', None),
            T('Whole system depends on one entity', 0, 1, 'Entire system depends on one entity', None),
            T('51% attack: majority control of the network', 1, 1,
              '51\\% attack (majority control of network)', None),
            T('Collusion among participants', 2, 1, 'Risk of collusion among participants', None),
        ],
        pattern=('Each failure is the failure of the thing that model rests trust on: the one '
                 'entity, the consensus, or the closed group colluding.'),
        pev='each failure mode in the right column is the failure of exactly that thing',
        explanation='CI-7 e: only the permissioned model has a mitigant attached in the notes '
                    '(reputation concerns and regulation).'),
    dict(
        rid='MR-5', block='mr5.c.table.1',
        title='Principal, duration and cash flow mapping',
        x=dict(label='Mapping', values=['Principal mapping', 'Duration mapping', 'Cash flow mapping']),
        y=dict(label='Dimension', values=['What it does', 'Accuracy', 'Catch']),
        tiles=[
            T('Only the risk of repaying principal', 0, 0,
              'Focuses solely on the risk associated with the repayment of principal amounts', None),
            T('Zero-coupon bonds with equivalent durations', 1, 0,
              'zero-coupon bonds with equivalent durations', None),
            T('Decomposes risk into each bond cash flow', 2, 0,
              'Decomposes bond risk into the risk associated with each', None),
            T('Simplest of the three', 0, 1, 'Simplest approach among the three methods', None),
            T('Considers the timing of cash flows', 1, 1,
              'More accurate than principal mapping as it considers the timing of cash flows', None),
            T('Most precise: timing and amount of cash flows', 2, 1,
              'Most precise method but also the most complex', None),
            T('Ignores coupon payments', 0, 2, 'ignores coupon payments', None),
            T('Hard to find a matching-duration zero', 1, 2,
              'difficult to find a zero-coupon bond with an exact duration', None),
            T('High complexity: incorporates correlations', 2, 2,
              'Complexity: high (incorporates correlations)', None),
        ],
        pattern=('Accuracy and complexity rise together from principal to duration to cash flow '
                 'mapping: the catch of the simplest method is oversimplification, the catch of '
                 'the most precise one is complexity.'),
        pev='Most precise method but also the most complex',
        explanation=('MR-5 c. The notes add the ordering to remember: VaR(principal) > '
                     'VaR(duration) > VaR(diversified).')),
    dict(
        rid='MR-7', block='mr7.d.table.1',
        title='KS, Anderson-Darling and Cramer-von Mises tests',
        x=dict(label='Test', values=['Kolmogorov-Smirnov (KS)', 'Anderson-Darling (AD)',
                                     'Cramer-von Mises (CvM)']),
        y=dict(label='Dimension', values=['What it measures', 'Strength', 'Limitation']),
        tiles=[
            T('Maximum distance between EDF and reference CDF', 0, 0,
              'The maximum distance between the EDF and the reference CDF', None),
            T('Same comparison, tail observations weighted more', 1, 0,
              'weighted so that tail observations count for more', None),
            T('Mean squared deviation across the whole distribution', 2, 0,
              'The mean squared deviation across the whole distribution', None),
            T('Detects deviations in the central portion', 0, 1,
              'Detects deviations in the central portion', None),
            T('More power for extreme quantiles', 1, 1,
              'giving more statistical power for extreme quantiles', None),
            T('Uses every observation; small misfits still register', 2, 1,
              'Uses every observation rather than only the worst one', None),
            T('Less sensitive to tail deviations', 0, 2,
              'Less sensitive to deviations in the tails', None),
            T('More computationally intensive than KS', 1, 2,
              'More computationally intensive compared to the KS test', None),
            T('Does not single out the tails', 2, 2, 'it does not single out the tails', None),
        ],
        pattern=('All three compare the same two curves and differ only in how they summarise the '
                 'gap: KS takes the largest gap, CvM averages the squared gaps, AD averages them '
                 'with the tails weighted up.'),
        pev='KS takes the largest gap, CvM averages the squared gaps',
        explanation='MR-7 d: goodness-of-fit tests for PIT backtesting.'),
    dict(
        rid='MR-16', block='mr16.b.table.1',
        title='Vasicek versus Gauss+',
        x=dict(label='Model', values=['Vasicek', 'Gauss+']),
        y=dict(label='Dimension', values=['Factors', 'Volatility term structure', 'Dynamics', 'Suited to']),
        tiles=[
            T('One: the short-term rate', 0, 0, 'One: the short-term rate', None),
            T('Three factors, only two sources of risk', 1, 0, 'but only two sources of risk', None),
            T('Declining, highest at the short end', 0, 1, 'Declining, highest at the short end', None),
            T('Hump-shaped, matching what is observed', 1, 1, 'Hump-shaped, matching what is observed', None),
            T('Single mean reversion to a constant theta', 0, 2, 'Single mean reversion to a constant', None),
            T('Cascade at three very different speeds', 1, 2, 'at three very different speeds', None),
            T('Pricing zero-coupon bonds, basic hedging', 0, 3,
              'Simple applications: pricing zero-coupon bonds, basic hedging', None),
            T('Yield curve modeling, derivative pricing, risk management', 1, 3,
              'Advanced applications: yield curve modeling, derivative pricing', None),
        ],
        pattern=('Every Gauss+ entry repairs a Vasicek limitation: more factors, a cascading '
                 'rather than single reversion, and a hump-shaped volatility structure that fits '
                 'the market for advanced uses.'),
        pev='The Gauss+ model addresses these deficiencies',
        explanation='MR-16 b: Vasicek is simpler; Gauss+ has more parameters to estimate.'),
]


def main():
    readings = json.load(open(BLOCKS, encoding='utf-8'))['readings']
    blocks = {}
    for rid, r in readings.items():
        for o in r['objectives']:
            for b in o['blocks']:
                blocks[b['id']] = (rid, b)
    files = {}

    def lines_of(rel):
        if rel not in files:
            files[rel] = open(os.path.join(ROOT, rel), encoding='utf-8').read().split('\n')
        return files[rel]

    def find(rel, ev, start):
        ls = lines_of(rel)
        target = norm(ev)
        for lo in (start, max(1, start - 25)):
            for ln in range(lo, len(ls) + 1):
                if target in norm(ls[ln - 1]):
                    return ln
                nxt = ls[ln] if ln < len(ls) else ''
                if target in norm(ls[ln - 1] + ' ' + nxt) and target not in norm(nxt):
                    return ln          # phrase straddles lines ln and ln+1
        raise SystemExit('evidence not found in %s from %d: %r' % (rel, start, ev))

    items, seq, problems = [], {}, []
    for s in SPECS:
        rid, blk = blocks[s['block']]
        assert rid == s['rid'], (s['block'], rid)
        rel, line = blk['source_file'], blk['source_line']
        # nearest block at/before line (validator convention)
        cands = [b for o in readings[rid]['objectives'] for b in o['blocks']
                 if b.get('source_file') == rel and b['source_line'] <= line]
        near = max(cands, key=lambda b: b['source_line'])
        if near['source_line'] != line:
            problems.append('%s: block %s not nearest' % (s['block'], near['id']))
        sb = s['block'] if near['source_line'] == line else near['id']
        seq[rid] = seq.get(rid, 0) + 1
        iid = 'gs-%s-%02d' % (rid, seq[rid])
        tiles = []
        for k, t in enumerate(s['tiles'], 1):
            ln = find(rel, t['ev'], line)
            why = t['why']
            if not why:
                xv = s['x']['values'][t['cell'][0]]
                yv = s['y']['values'][t['cell'][1]]
                why = '%s table: %s column, %s row.' % (rid, xv, yv)
            tiles.append(dict(id='%s-t%02d' % (iid, k), text=t['text'], cell=t['cell'], why=why,
                              evidence=t['ev'], line=ln))
        pln = find(rel, s['pev'], line)
        item = dict(id=iid, reading_id=rid, source_block=sb, source_file=rel, source_line=line,
                    title=s['title'], x=s['x'], y=s['y'], tiles=tiles, pattern=s['pattern'],
                    pattern_evidence=dict(text=s['pev'], line=pln), explanation=s['explanation'])
        if s.get('numeric'):
            item['numeric_claims'] = s['numeric']
        if s.get('cell_keys'):
            item['cell_keys'] = s['cell_keys']
        items.append(item)
    if problems:
        print('\n'.join(problems))
    doc = dict(version=1, mechanic='grid-settler',
               description=('Two-axis grids from the notes\' two-way classifications. Each tile '
                            'belongs in cell [xIndex, yIndex]; several tiles may share a cell and '
                            'not every cell is filled. `evidence`/`line` on each tile is the '
                            'verbatim notes phrase that places it.'),
               items=items)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print('wrote %s: %d items, %d readings, %d tiles' % (
        os.path.relpath(OUT, ROOT), len(items), len({i['reading_id'] for i in items}),
        sum(len(i['tiles']) for i in items)))


if __name__ == '__main__':
    sys.exit(main())
