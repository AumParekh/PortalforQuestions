# Content audit (September 2026)

Every question in the bank (1,206) was re-solved against its source PDF by an auditor agent; each flag was re-derived by an independent verifier (130 accepted, 46 accepted with a different fix, 4 rejected, 27 more found by the verifiers); each subject's applied diff was then reviewed by a third agent. `tools/content/validate_bank.py` and `tools/content/katex_bank.mjs` now run in CI and before every deploy.

## Answer keys changed

| Question | Was | Now | Why |
|---|---|---|---|
| CR-T3-21 | c | d | The source mis-adds the haircut collateral (63.4m; it is 60.4m against a 62m requirement): a USD 1.6m shortfall. Options c/d now read USD 1,600,000. |
| LR-FT-32 | c | b | In the reading, *other cash transactions* is the measure that tracks settlement positions at every FMU; "settlement positions" is not a named measure. The PDF's erratum inverted a correct key. |
| LR-T3-16 | c | b | Same question as LR-FT-32. Its True/False card for option c is now false, with a corrected twin. |

## Keys kept, question corrected so the key is right

- **CR-T1-19**: σ_V = 19.74%, which is nearer 20% than the keyed 19%. Options rebuilt (18.75% / 30% / 19.7% / 50.5%).
- **CR-T2-08**: statement (b) said duration rises to 5.09 at a 7% yield; it falls to 4.95. Stem now fixes the cash flows; (b) rewritten.
- **MR-T4-22**: CIR σ was 0.08 in the stem but the solution uses 0.03; stem and option d corrected.

## All corrected questions

### Investment Risk

- **IR-FT-13**: question: Stem now says two long positions with correlation known to be non-negative, so (a) is uniquely best; solution: [verifier-added, re-checked] (b) is the wider bound, not 'stricter'; explains why rho=-1 is excluded by the stem; optionAnalysis: [verifier-added, re-checked] OA(b): rho=-1 unattainable under the non-negative-correlation stem; trap: Trap (b) sentence aligned with the new stem (negative correlation ruled out)
- **IR-FT-14**: solution: Last paragraph: sum of individual VaRs is always an upper bound; with shorts it is undiversified VaR (rho=+1) that falls below the sum
- **IR-FT-25**: optionAnalysis: OA(c) drops the ungiven 'USD 52 to USD 50' fact
- **IR-FT-26**: solution: Replaced unanchored USD 1.50 'worked example' with the source's 36/42/45 illustration (+3 vs -6)
- **IR-FT-34**: solution: Restored two dropped source sentences (credit and valuation rows); clarified 'three exit-slowing' remedies
- **IR-FT-68**: solution: Passive market holder beats the average active manager (not the market) by saving costs; optionAnalysis: [verifier-added, re-checked] OA(a) same correction
- **IR-FT-76**: optionAnalysis: OA(d) notes (1+phi)/(1-phi) is the exact AR(1) ratio; answer with the curriculum Eq. 19.3; key (b) kept; solution: Understatement is 1 - 9.0/11.62 = 22.5%, not 9.0/11.62
- **IR-NA-06**: optionAnalysis: OA(a) wording no longer reads as calling (a) the LEAST accurate item
- **IR-NA-48**: options: Option (a): lower EV pushes the fulcrum higher (more senior), not lower; key (a) kept
- **IR-NA-70**: solution/optionAnalysis: Ang names six imperfections (option (a) lists five, omitting price impact); OA(a) updated
- **IR-NA-72**: solution: GRZ multiplier sqrt((1+phi^2)/(1-phi^2)) -> sqrt((1+phi)/(1-phi)) with derivation; 9% -> 15.59% (not 11.62%); caution on the curriculum's printed form (IR-FT-76)
- **IR-NA-75**: optionAnalysis: [verifier-added, re-checked] OA(a): 210/790 is an inconsistent mix; a genuine 30% markdown gives 210/700 = 30.0%
- **IR-T1-12**: solution: Portfolio volatility row 15.62%/13.85% -> 5.21% (USD 156,205 on USD 3m)/4.62% (USD 138,462)
- **IR-T1-13**: solution: Removed bare \qquad outside math (rendered as literal text)
- **IR-T1-17**: solution: Jorion example row sigma_p 13.85%/13.98% -> 4.62%/4.66%
- **IR-T1-37**: optionAnalysis: OA(c) notes its T-squared clause is correct; (c) fails only on M-squared
- **IR-T1-38**: options/solution/optionAnalysis: Option (a) now says alpha and Treynor always agree in sign (not in ranking); solution table and OA(d) corrected with Q54 counterexample; key (a) kept
- **IR-T1-47**: optionAnalysis/trap: OA(c) drops the false Treynor route (Treynor also ranks 1,2,3); trap sentence replaced and 'wrong-input-twin' operator removed since the trap no longer claims one
- **IR-T1-48**: optionAnalysis: OA(a): 0.346 = 0.5196 x 2/3 ('falls by one third'), removing the false 0.173 objection
- **IR-T1-51**: optionAnalysis: OA(c): 8.0% = 11.0% - 3.0% (risk-free subtracted twice) replaces a false 'beta x var(m)' route
- **IR-T1-53**: question/solution/optionAnalysis: Residual SD 32.0% -> 24.0% (32% was systematic vol); IR -0.025 -> -0.033 in solution, table and OA(b); key (b) kept; trap: Removed literal backslash-quotes and misquoted stem phrase; now cites 40.0% vs 20.0%
- **IR-T2-04**: solution: Restored superscript B on policy weights in the policy-mix and active rows
- **IR-T2-05**: solution: Restored superscript B on policy weights: sum w_i^B R_i^B and (w_i R_i - w_i^B R_i^B)
- **IR-T2-11**: optionAnalysis/trap: OA(d): 128 = 0.16 x 800 (z omitted), 291 = 419.40 - 128; trap relabelled 'confidence deviate is omitted'; solution: Weighted-average volatility 12.1% -> 12.7%
- **IR-T2-20**: solution: Bull/bear row now 'None on its own'; convertible arbitrage struck by the two rejections
- **IR-T2-23**: solution: Asymmetry sentence corrected: short stock wins on a fall, convertible wins on a rise; note on Stowell's literal wording
- **IR-T3-14**: question: 'four different positions' -> 'three' (table has I-III)
- **IR-T3-32**: options/optionAnalysis/trap: Option (a) -0.20% to 0.40% -> -0.60% to 0.40% (the MCVA band its OA describes); 'approximately' dropped; trap structural check rewritten (width + centring); key (b) kept
- **IR-T3-33**: solution: Appended the source's Errata-rule conflict note (width vs bounds) that the trap refers to

### Market Risk

- **MR-FT-03**: solution: 99.9% standard error 0.938 -> 0.297; ratio to 95% roughly 14 -> roughly 4.4
- **MR-FT-06**: solution: lighter-tails row: reversed S, left end above / right end below the line; optionAnalysis: (b) reason: lighter tails bend inward (left end above, right end below), not "toward the line"
- **MR-T1-07**: question+solution: statement II reworded to the same-strike OTM put vs ITM call IV claim (false by parity); solution reasoning for II rewritten; key a unchanged
- **MR-T1-15**: solution: leverage illustration: equity vol 37%/74% -> 40%/80% with derivation 20% x 20/(20-I)
- **MR-T1-16**: optionAnalysis+solution: (c) rationale no longer assumes positive serial correlation; dropped "only one of the four candidates that can produce either slope"
- **MR-T1-29**: options: ES_3 scaling in options a/b changed from sqrt(40/10) to the increment sqrt((40-20)/10); key a unchanged
- **MR-T1-43**: question: implied vol 14.5% -> 23.8% in stem, solution and trap so the call price 0.0325 is GK-consistent; key c unchanged
- **MR-T1-47**: solution+options: exp(-1.9208)=0.146490, multiplier 2.3376, ES 10.688%; option d relabelled 10.68% -> 10.69%
- **MR-T2-31**: solution: 90% VaR is the 3rd worst (47) under (1-cl)n+1, not 61; ES 72.5 unchanged; optionAnalysis+trap: (a) is the VaR-instead-of-ES trap, (b) a single tail observation; trap text realigned (also covers verifier-added trap flag)
- **MR-T2-33**: reading: reading -> "Non-Parametric Approaches" (LO13 weighted/filtered HS)
- **MR-T2-34**: reading: reading -> "Non-Parametric Approaches" (LO13 weighted/filtered HS)
- **MR-T2-35**: reading: reading -> "Non-Parametric Approaches" (LO13 weighted/filtered HS)
- **MR-T2-36**: reading: reading -> "Non-Parametric Approaches" (LO13 weighted/filtered HS)
- **MR-T2-37**: reading: reading -> "Non-Parametric Approaches" (LO13 weighted/filtered HS)
- **MR-T2-40**: options+optionAnalysis: option d 95% VaR 55.236 -> 60.489 (= 14.1 + 46.389) so the sign-error distractor matches its rationale; key a unchanged
- **MR-T2-42**: optionAnalysis: distractor rationales a/c/d rewritten to what the values actually are (99% lognormal = 56.4, 65.8 = sigma z, 74.7 = exp(0.558)-1); KaTeX span in (a) closed before "USD 56.4 million" (formatting only)
- **MR-T2-44**: optionAnalysis: distractor rationales a/c/d rewritten (1.54 = half of 3.08, 4.87 = sum of SDs, 56 matches no standard error)
- **MR-T2-45**: optionAnalysis: (c) is the 99.5% deviate error (2.576); (d) 5,813,777 matches no clean combination (nearest 5,582,400)
- **MR-T2-49**: reading: reading -> "Non-Parametric Approaches" (LO13 weighted/filtered HS)
- **MR-T2-50**: reading: reading -> "Non-Parametric Approaches" (LO13 weighted/filtered HS)
- **MR-T3-02**: solution: closing sentence attributes the shift-shape drawback to MR-T3-01 instead of "this question" twice
- **MR-T3-05**: optionAnalysis: (d) reason: beta* = R^2/beta (differs from 1/beta by R^2), not "slopes differ by a factor of R^2"
- **MR-T3-06**: optionAnalysis: (b) reason: correlation equals beta only when the SDs are equal (dropped false "unit free" argument)
- **MR-T3-07**: solution: added data note: tabulated Y_p implies cov 0.41667 / beta 1.00, inconsistent with the given 0.273; key b unchanged
- **MR-T3-21**: solution: 0.20^-0.30 = 1.62066 (was 1.62057); VaR 2.2413%, ES 3.6304% exactly, no fudges; optionAnalysis: (a) and (c) rationales no longer attribute the values to unreproducible mechanisms; trap: (verifier-added, re-checked: sign flip gives ES 2.7733, 0.05-for-20 gives VaR 18.56) trap text no longer attributes (a)/(c) to those mechanisms
- **MR-T4-14**: solution: lower bound 0.684 > 0 binds: 0 exceptions rejected (z=-2.27); acceptance region 1 to 9; key a unchanged
- **MR-T4-22**: question: CIR sigma 0.08 -> 0.03 so options a/b/c and Step 3 are consistent; key c unchanged; options: option d 0.3000% -> 0.9667% (percent-rate sqrt trap with sigma 0.03); optionAnalysis: (d) rationale quotes 0.9667% with arithmetic; solution: Step 2 vol term 0.00090 (0.0900%), basis-point vol 0.006 (0.60%)
- **MR-T4-25**: optionAnalysis: (verifier-added, re-checked) (a) reason: max over resamples is bounded by the sample, drifts upward rather than growing without bound

### Credit Risk

- **CR-FT-04**: question: same defect as CR-T1-15/16/20/28, CR-T3-08/20, CR-FT-32: answer-revealing solution table removed from the stem (CAMEL assessment table answers the EXCEPT question); solution: table moved to its orphaned anchor in the solution
- **CR-FT-05**: question: same defect as CR-T1-15/16/20/28, CR-T3-08/20, CR-FT-32: answer-revealing solution table removed from the stem (duplicate of CR-T1-15 (same stem in Final tier)); solution: table moved to its orphaned anchor in the solution
- **CR-FT-06**: question: same defect as CR-T1-15/16/20/28, CR-T3-08/20, CR-FT-32: answer-revealing solution table removed from the stem (taxonomy table confirms all three speakers); solution: table moved to its orphaned anchor in the solution
- **CR-FT-14**: reading: -> Hull, Options, Futures, and Other Derivatives: Credit Derivatives (verifier-added, same fix as CR-FT-16)
- **CR-FT-16**: reading: -> Hull, Options, Futures, and Other Derivatives: Credit Derivatives
- **CR-FT-17**: reading: -> Hull, Options, Futures, and Other Derivatives: Credit Derivatives (verifier-added, same fix as CR-FT-16)
- **CR-FT-20**: solution: net positions A +120, B -70, C -50; compressed set A pays B 70 and C 50 (B is not flat); optionAnalysis: c: Bank B is a net receiver of 70; trap: option (c) sentence: B receives 250, pays 180
- **CR-FT-28**: options: a: parametric = simple function of hazard rate on exposure calibrated to history (not "a multiplier on CVA"); solution: parametric row and trade-off paragraph updated; reading: -> Reading 99: Gregory, Wrong-Way Risk
- **CR-FT-29**: options: stressed EL 22.0 / stress loss 17.2 (source 10x slip 220.0/215.2); key a kept; solution: 22.0, 17.2, PD-only 16.0 understating by 6.0; optionAnalysis: a figures updated
- **CR-FT-32**: options: excess spread 11.7 (source 13.7 arithmetic slip), omitted-loss distractor 17.7; key a kept; question: waterfall table removed from stem; solution: table moved into Step 1 and corrected to 11.7; 3.3 still needed to reach target; optionAnalysis: a/b/c figures updated
- **CR-FT-33**: options: a: approximately 160 PSA (was 80 PSA, not derivable); key a kept; solution: restored 6.40%/4.00% = 160 PSA step and table row; optionAnalysis: a mentions 160 PSA
- **CR-FT-43**: reading: -> Reading 102: Choudhry, An Introduction to Securitisation
- **CR-FT-44**: question: same defect as CR-T1-15/16/20/28, CR-T3-08/20, CR-FT-32: answer-revealing solution table removed from the stem (table computes Z = 5.46 (same item as CR-T2-34)); solution: table moved to its orphaned anchor in the solution
- **CR-T1-03**: solution: loan b and c term PD both 1.4888%; loan c EL USD 1.340m; "identical term PDs"; optionAnalysis: b: same term PD as c; c: USD 1.340 million
- **CR-T1-05**: optionAnalysis: a/c/d: removed false derivations of 2.25/5.49/7.81; give the real error values (2.40, 5.37, 2.44, 4.75, 8.28); trap: sqrt(0.0064+0.0256) = 0.1789 and USD 5.37m (was 0.1697 / 5.09m)
- **CR-T1-15**: question: removed answer-revealing solution table from the stem (verifier-added flag); solution: table moved into the solution at its orphaned anchor
- **CR-T1-16**: question: removed answer-revealing solution table from the stem (verifier-added flag); solution: table moved into the solution at its orphaned anchor
- **CR-T1-19**: options: Rebuilt options to a 18.75% / b 30% / c 19.7% / d 50.5% so the key c (19.74%) is exact and a/d are the named errors (source had a 20% nearer than keyed 19%); optionAnalysis: a/c/d rationales rewritten for the new options (45/240 = 18.75%; inverted leverage 50.5%)
- **CR-T1-20**: question: removed answer-revealing d1/d2/N(-d2) table from stem (verifier-added flag); solution: table restored under the orphan heading "The distinction that generates every distractor"
- **CR-T1-21**: optionAnalysis: a/d: 10.98% and 14.76% are fillers; real error values 18.75%, 7.41%, 11.08%, 31.0% stated
- **CR-T1-28**: question: removed answer-revealing solution table from the stem (verifier-added flag); solution: table moved into the solution at its orphaned anchor
- **CR-T1-34**: question: Recovery rate 50.0% -> 40.0% so the stated 6.7% hazard rate = 400bps/(1-R) is consistent (verifier-added flag, re-checked); optionAnalysis: b = 0.05 x 400/0.60 (EPE x hazard rate, LGD double-counted); c = 0.05 x 400/0.40 (divide by R); solution: added consistency check lambda = 0.04/0.60 = 6.67%; trap: distinguished the two routes: (b) double counting LGD, (c) dividing by the recovery rate
- **CR-T1-38**: solution: netting benefit = -0.930 - (-1.320) = 0.390 (was -1.320 - (-0.930), which is -0.390); optionAnalysis: a: same sign fix
- **CR-T1-43**: optionAnalysis: a: swapped-spread route gives +3.90 bps, 5.49 is a filler
- **CR-T1-45**: solution: ln(79/46) = 0.5408 (was 0.5413)
- **CR-T2-02**: question: same defect as CR-T1-15/16/20/28, CR-T3-08/20, CR-FT-32: answer-revealing solution table removed from the stem (structure table matches each issuer to its structure); solution: table moved to its orphaned anchor in the solution
- **CR-T2-03**: optionAnalysis: d: 10.7% = 130/1,210 (121+ bucket omitted)
- **CR-T2-06**: question: same defect as CR-T1-15/16/20/28, CR-T3-08/20, CR-FT-32: answer-revealing solution table removed from the stem (weighted-contribution table totals 579.2 (= WAC x 80)); solution: table moved to its orphaned anchor in the solution
- **CR-T2-07**: optionAnalysis: a: superstore pool is shorter, not "all other components longer"; question: same defect as CR-T1-15/16/20/28, CR-T3-08/20, CR-FT-32: answer-revealing solution table removed from the stem (weighted-contribution table totals 24,733 (= WAM x 132)); solution: table moved to its orphaned anchor in the solution
- **CR-T2-08**: question: added "The loan's scheduled cash flows are fixed."; options: b: Macaulay duration at 7% DEcreases to 4.95 years (5.09 unobtainable); key d unchanged; solution: direction-of-duration paragraph rewritten (4.95, payment size cancels); optionAnalysis: b rewritten to 4.95 years; trap: removed claim that duration lengthens for a repriced loan; question: same defect as CR-T1-15/16/20/28, CR-T3-08/20, CR-FT-32: answer-revealing solution table removed from the stem (table states WAL is not sensitive to yield, which answers (d)); solution: table moved to its orphaned anchor in the solution
- **CR-T2-15**: question: 95th percentile "is assumed to be 4"; solution: note: exact binomial 95th percentile is 6 (VaR USD 30,000); 4 is an assumption
- **CR-T2-16**: trap: binomial(30,3%) 99th percentile is 4 defaults, VaR about USD 103,000 (was 3 / 70,000); solution: verifier-added: independent-case contrast now 30 independent positions -> about USD 103,000 at 99% (was an unqualified USD 10,000); worded without a cross-question reference
- **CR-T2-21**: options: d replaced: "raising correlation leaves expected loss unchanged at USD 10 million" (old d was false at 95%); solution: statement (d) paragraph, USD 990m qualified to confidence above 99%, levers table row; optionAnalysis: c and d updated; trap: qualified USD 990m as the perfect-correlation figure at confidence above 99% (consistency with the decision)
- **CR-T2-26**: optionAnalysis: c: dropping (1-pi) gives 0.863, still not 0.812
- **CR-T2-27**: optionAnalysis: a: no-subtraction gives 0.0518; b/c: fillers, variance-product route gives ~12.4 (too large); trap: square-root omission makes the answer ~12, not an order of magnitude too small
- **CR-T2-28**: question: same defect as CR-T1-15/16/20/28, CR-T3-08/20, CR-FT-32: answer-revealing solution table removed from the stem (variance-share table interprets beta); solution: table moved to its orphaned anchor in the solution
- **CR-T2-29**: solution: joint PD 0.092% vs independence 0.04% (factor 2.3, not 250); default correlation 0.026
- **CR-T2-30**: optionAnalysis: a: beta^2 in numerator gives N(-1.42); d: filler, no-denominator 21.2%, wrong sign 0.09%
- **CR-T2-34**: question: same defect as CR-T1-15/16/20/28, CR-T3-08/20, CR-FT-32: answer-revealing solution table removed from the stem (table computes Z = 5.46); solution: table moved to its orphaned anchor in the solution
- **CR-T2-36**: optionAnalysis: a: "Incorrect as a complete answer. True, but only one of three"
- **CR-T3-02**: optionAnalysis: a/b: mis-scaled exponents, stated error routes (4.08%, 63.2%) do not give the distractors; trap: "time-conversion errors" -> "mis-scaled exponents"
- **CR-T3-04**: options: a 2.80%/1.80% (key a kept), c 1.80/2.80, d 2.80/2.80; source summed 0.009+0.009+0.01 to 2.05%; solution: path A->B->D 0.90%; cumulative 2.80%; marginal 1.80%; optionAnalysis: a/b/c updated to 2.80/1.80; trap: migration channel is about a third (0.90 of 2.80), not nearly half
- **CR-T3-07**: options: d 20.13% -> 20.15% (1 - e^-0.225); verifier-added, re-checked
- **CR-T3-08**: question: removed answer-revealing measure table from stem (moved to solution); options: b and c 10.14% -> 9.97% (1 - e^-0.105); optionAnalysis: d: 6.30% = 7 x 0.90% exactly; reason rewritten
- **CR-T3-13**: optionAnalysis: c: option wording signals wrong-way risk (does not say it)
- **CR-T3-20**: question: removed answer-revealing Step/Operation/Result table from stem; solution: table placed after "The sequence matters and must be followed in order."
- **CR-T3-21**: answer: c -> d; options: c "A surplus of USD 1,600,000", d "A shortfall of USD 1,600,000"; solution: total credit 60.4m, shortfall 1.6m > MTA, grossed-up alternative 69.6m / 7.6m; optionAnalysis: all four rewritten; d correct, c sign reversal; trap: sign-error option is now (c)
- **CR-T4-04**: solution: EE for symmetric distribution = P(V>0) x E[V|V>0] (half the positive-half mean for continuous), 0.399 sigma for normal
- **CR-T4-08**: solution: sqrt(3) reduction applies only if the whole MPoR shrinks 3->1 day; shortening remargining alone gives less
- **CR-T4-16**: solution: total capital ratio 15.52% -> 15.53%
- **CR-T4-18**: solution: IM received reduces CCR exposure, IM posted increases funding exposure; table split into received/posted rows; trap: which IM enters which measure; (b) sentence corrected (ignoring IM gives 5, not 7); optionAnalysis: b: own fix while applying - 15 - 10 = 5, so 7 has no derivation (old text claimed it came from ignoring IM)

### Liquidity Risk

- **LR-FT-07**: solution: four -> five CFP components (data and reporting added) with BAU-vs-component distinction; trap: (verifier-added, agreed) trap names the plan's data and reporting specification among contingency-only components
- **LR-FT-28**: solution: four governance characteristics per reading (three lines of defence; risk measurement and monitoring added); optionAnalysis: (verifier-added, agreed) b no longer claims the three are the complete set; c cites risk appetite under active risk management
- **LR-FT-30**: solution: family table per reading: both credit-line totals and time-sensitive obligations are flow measures; Tier 1 ratio added to risk family; no separate 'settlement positions' measure; optionAnalysis: consistency with LR-FT-32 fix: d reason says FMU settlement positions are tracked by the other cash transactions measure (verdict unchanged)
- **LR-FT-31**: solution: credit-line totals labelled flow-tracking; Tier 1 ratio row added; payment throughput per reading
- **LR-FT-32**: answer: key c -> b (Other cash transactions); solution, optionAnalysis and trap (verifier-added) replaced
- **LR-T1-01**: options: option c 0.1538 -> 0.1514 (7.00/46.25, half-mid); optionAnalysis.c reason updated to match
- **LR-T1-05**: optionAnalysis: c reason: 30.90 = mid + full spread (0.20), not mid + half-spread
- **LR-T1-09**: solution: exact-deviate total CNY 148,691 -> 148,700
- **LR-T1-10**: solution: exp(-0.2877)=0.74999; VaR 249,986 -> 250,013; LVaR 299,986 -> 300,013 in solution, optionAnalysis.b and trap.explanation
- **LR-T1-41**: options: (verifier-added, re-checked: 30 - 26.422 = 3.578) option a USD 3.59m -> USD 3.58m; optionAnalysis.a updated
- **LR-T2-03**: trap: last sentence: repayment below dirty value only because haircut 3.5% exceeds repo interest 1%
- **LR-T2-21**: solution: typo 'it charge' -> 'it charges'
- **LR-T2-44**: optionAnalysis: a-c reasons rewritten: 326/347 flagged as plausibility distractors, 423 = 330+358-265; key d 627 unchanged
- **LR-T2-46**: optionAnalysis: d reason: 29.32% = 1.06 x 1.22 - 1 (not an inversion; true inversion gives -2.03%); trap.explanation aligned
- **LR-T3-08**: optionAnalysis: b/d mechanisms corrected (moving loan repayments gives -259; +23 needs two opposite misclassifications); trap: (verifier-added, agreed) dropped false link between loan-repayment misclassification and an offered option; solution: (verifier-added, agreed) 'four pairings' -> the three pairings actually listed; last paragraph only
- **LR-T3-09**: optionAnalysis: d: sign error gives 64 not 11; refuted by reconstruction 122-(89+11)=22
- **LR-T3-13**: solution: fed funds purchased are overnight by convention (stem never says 'repaid the following morning'); solution Step 1, OA c/d, trap updated
- **LR-T3-15**: solution: duplicate of LR-FT-31: same solution fix (without FT concept line)
- **LR-T3-16**: answer: duplicate of LR-FT-32 (same stem/options): key c -> b; solution (without FT concept line), optionAnalysis, trap fixed the same way
- **LR-T3-26**: solution: duplicate of LR-FT-07: five components solution and trap.explanation fixed the same way (operators kept)
- **LR-T3-36**: optionAnalysis: c: 6.75% = 5% x 1.35 (multiplies by 1+t), not the correct formula

### Operational Risk

- **OR-FT-06**: reading: reading -> Operational Risk and Resilience, Ch. 11: Case Study: Financial Crime and Fraud
- **OR-FT-07**: reading: reading -> Operational Risk and Resilience, Ch. 11: Case Study: Financial Crime and Fraud
- **OR-FT-14**: solution: Capital One sentence corrected: former employee of the provider (not contractor), both firms knew of the vulnerability, USD 80m fine; reading: reading -> Operational Risk and Resilience, Ch. 13: Case Study: Third-Party Risk Management
- **OR-FT-15**: reading: reading -> Operational Risk and Resilience, Ch. 13: Case Study: Third-Party Risk Management
- **OR-FT-16**: solution: PPI sentence reattributed to Ch.1 and the actual Ch.14 cases (UBS 2008, JPMorgan 2020 USD 920m, Deutsche Bank 2022 USD 2m) added; reading: reading -> Operational Risk and Resilience, Ch. 14: Case Study: Investor Protection and Compliance Risks in Investment Activities
- **OR-FT-17**: reading: reading -> Operational Risk and Resilience, Ch. 14: Case Study: Investor Protection and Compliance Risks in Investment Activities
- **OR-FT-24**: reading: reading -> Operational Risk and Resilience, Ch. 16: Case Study: Model Risk and Model Validation
- **OR-FT-25**: reading: reading -> Operational Risk and Resilience, Ch. 16: Case Study: Model Risk and Model Validation
- **OR-FT-26**: reading: reading -> Operational Risk and Resilience, Ch. 16: Case Study: Model Risk and Model Validation
- **OR-FT-27**: reading: reading -> Operational Risk and Resilience, Ch. 16: Case Study: Model Risk and Model Validation
- **OR-FT-33**: solution: final parenthetical now states the finalised Dec 2017 ILM uses (LC/BIC)^0.8; plain ratio is the 2016 consultative form
- **OR-T1-13**: question: lead-in now carves out return on economic capital as a rate on EC (needed to reproduce 8.23% / -1.40%)
- **OR-T1-29**: question: 'negatively correlated' -> 'imperfectly (less than perfectly) correlated' (150 > zero-corr 142.1 implies rho=+0.116); OR-T1-24 has no numbers, left as is per verifier
- **OR-T2-09**: question: IIA Three Lines Model update year 2021 -> 2020; optionAnalysis.c.reason: '2021 IIA update' -> '2020 IIA update'; trap.explanation: 'The 2021 update' -> 'The 2020 update'
- **OR-T2-31**: solution: added note that BCBS 2017 text uses (LC/BIC)^0.8 in the ILM
- **OR-T2-34**: solution: added formula-version note: BCBS 2017 ILM uses (LC/BIC)^0.8 -> ILM 1.0353, ORC 2.76, still nearest (c); trap.explanation: uplift 'about 4.5%' now adds '(about 3.5% under the BCBS form with the 0.8 exponent)'
- **OR-T2-36**: solution: (verifier-added flag, re-checked and agreed) added parenthetical note on the (LC/BIC)^0.8 form after the formula line
- **OR-T3-11**: solution: first sentence rewritten: question modelled on Capital One; intruder a former AWS employee, both firms aware of firewall weakness, USD 80m fine
- **OR-T4-13**: solution: likelihood table replaced by the curriculum's four-point scale (Remote <1 in 20y/<5% ... Likely >=1/yr/>50%) + note it is Chapelle Ch.4 scale

### Current Issues

- **CI-I-63**: solution: '(a) general ban' -> 'A general ban' (article typeset as option label)
- **CI-I-67**: optionAnalysis: b.reason '(a) blanket ban' -> 'A blanket ban'; trap: verifier-added, re-checked: trap.explanation '(b) (a) blanket ban' -> '(b) A blanket ban'
- **CI-I-83**: optionAnalysis: a.reason '(a) circuit breaker' -> 'A circuit breaker'; trap: verifier-added, re-checked: trap.explanation '(a) (a) circuit breaker' -> '(a) A circuit breaker'
- **CI-VI-08**: solution: 'AI-as- portfolio' -> 'AI-as-portfolio'
- **CI-VI-09**: optionAnalysis: restored real (a) reason (one-sided 'always underrepresents'); orphan 'A true fact attached to the wrong concept.' moved to end of (d); solution: 'real- world' -> 'real-world'
- **CI-VI-101**: solution: 'non- native' -> 'non-native'
- **CI-VI-102**: optionAnalysis: b.reason '(a) live duplicate' -> 'A live duplicate'
- **CI-VI-104**: optionAnalysis: d.reason '(a) document attachment' -> 'A document attachment'
- **CI-VI-106**: optionAnalysis: b/d reasons '(a) non-native', '(a) registrar' -> 'A ...'; solution: 'consent- gated' -> 'consent-gated'
- **CI-VI-114**: options: option a 'stand- alone' -> 'stand-alone'
- **CI-VI-126**: solution: '(a) widely used ledger' -> 'A widely used ledger'
- **CI-VI-130**: solution: 'R&(d)' -> 'R&D'
- **CI-VI-132**: optionAnalysis: c.reason '(a) behavioral story' -> 'A behavioral story'
- **CI-VI-14**: solution: 'low- liquidity' -> 'low-liquidity'
- **CI-VI-142**: optionAnalysis: d.reason '(a) reference link' -> 'A reference link'
- **CI-VI-146**: solution: same line-break-hyphen defect found by own scan: 'out- computes' -> 'out-computes' (matches TF-CI-VI-146-a explanation)
- **CI-VI-148**: optionAnalysis: c.reason '(a) single operator' -> 'A single operator'
- **CI-VI-16**: optionAnalysis: d.reason '(a) null finding' -> 'A null finding'
- **CI-VI-20**: optionAnalysis: c.reason '(a) wrong fact' -> 'A wrong fact'
- **CI-VI-35**: question: 'normal- conditions' -> 'normal-conditions'
- **CI-VI-67**: solution: '(a) hallucination is' -> 'A hallucination is'
- **CI-VI-86**: solution: '(a) one-standard-deviation' -> 'A one-standard-deviation'
- **CI-VI-99**: optionAnalysis: d.reason '(a) true premise' -> 'A true premise'

## Errors in the notes (fix in the LaTeX source)

- CR-5 l.314: "less a short put" should be "less a put".
- MR-8 l.462: VaR ≈ 1.9m; the notes' own data give ≈ 1.84m.
- `mr8.a.trapbox.1`: a correlation move from +1 to −0.4 is called an "increase".
- ORR-19: non-standard wording of the coherence axioms.
- CI-4 l.288–293: contradicts itself on the energy premium.
- ORR-1: typo "risk or loss".
- `ltr10.c.keybox.1`: mitigating actions "extend the survival period from 49 days to 27 days".
- `im7.i.trapbox.1`: hedge fund sensitivity "rises in a crisis and falls in strength" (IM-7 f says it increases).

## Games and formula deck

- Formula twins: all 197 pairs re-checked; 16 explanations corrected, 3 pairs dropped (same formula in two notations), 194 remain.
- The 8 text-based notes games: about 13,000 rounds read against the notes. The checked rounds had no answer marked correct that was actually wrong; the builders now skip ambiguous distractors, multi-order sequences, worked-example numbers presented as facts and heading/fragment tiles.
