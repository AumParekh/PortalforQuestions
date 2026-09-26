# Stepwise Derivation: fact-check of generated rounds

Mechanic: `web/src/games/mechanics/stepwise-derivation/` (build.ts, parse.ts). Data: `content/games/game-blocks.json`.
Harness: `scratchpad/gamestest/stepwise-derivation.cjs` (plus the dump and audit scripts `sd-dump.cjs`, `sd-compact.cjs`, `sd-uns.cjs`, `sd-audit.cjs`, `sd-audit2.cjs`, `sd-naming.cjs`).

## What was checked

- **Player-visible rounds:** 197 unique rounds, deduplicated by gap and option set. They come from `buildStepwise` over every supported reading, with 4 seeds each and alternating `priorityCategory` null/'Sequence'. The game supports only 13 readings: MR-1, MR-8, MR-12, MR-14, CR-4, CR-9, CR-11, CR-22, ORR-21, LTR-1, LTR-12, LTR-17 and IM-5. For each round I checked the prompt (heading, context, givens), the working so far, the gap lead, all three options with kind, needs and foreign, where each option leads, and the feedback line from `choiceNote`. I also checked the naming line from `namingFor` for all 48 examples in those readings.
- **Candidate rounds from unsupported readings:** 65 rounds from 27 readings, built with `readingCandidates` and `pickDistractors`, seed 7. These readings are MR-4/5/7/9/10/13/15/16, CR-5/10/12/13/16/20/23, ORR-18/22/24, LTR-4/7/13/14 and IM-3/4/6/7/8. The game does not play these readings today because they fail `supportsStepwise`, so these rounds are not visible to players. I checked them anyway so the coverage reaches ≥20 readings.
- **Total:** 262 rounds over 40 readings. Every area is covered except CI: no CI reading has a single blankable worked-example step, so the mechanic cannot produce CI rounds.
- **Automated audits over every candidate pool, not only the drawn options:**
  - (a) "other" distractors whose only foreign number sits in the LHS label.
  - (b) "other" distractors that produce a number this example uses.
  - "ahead" needs that are actually given in a scaled form (%, bp, million).

Dumps: `sd-rounds-before.txt`, `sd-rounds-after.txt` and `sd-unsupported-candidates.txt` in this folder.

Correct answers: every "true" option is the notes' own line, and the harness checks it verbatim against the block. I found no round where the keyed answer is wrong per the notes.

## Problems found

### 1. A distractor that is also a correct move (it is part of this derivation). 6 visible rounds, plus pool-level cases. **Fixed.**

- **#149 and #157, ORR-21 `orr21.b.exbox.3`, "Required capital":** the answer is (\$175m + \$3.375m) × 0.08. Two "wrong" moves were offered: the RWA line (0.0×\$20)+…+(1.0×\$150) = \$175m from `orr21.b.exbox.1`, and the credit equivalent amount \$2.5 + 0.005×\$175 = \$3.375m from `orr21.b.exbox.2`. The box says "Using the information from the previous examples" and never shows 175 or 3.375. Both are therefore prerequisite steps of this very derivation, not wrong moves.
- **#158 and #160, LTR-1 `ltr1.a.exbox.2`, stressed market:** "dollar value of each position, α_i" was offered as a wrong move at steps 1 and 3. Step 4 uses 900 and 752.5, and this box never shows or computes them.
  - Pool only: "mid-market prices" (15.05) and "proportional spreads, s_i" (0.006645) were also candidates at step 1. The box's own step 1 is that same division.
- **#163 and #164, LTR-1 `ltr1.a.exbox.1`, normal market:** "convert the spread moments to proportional terms" was offered as wrong.
  - At step 3 (#164) it is a straight synonym of the keyed "proportional spreads, s_i": 0.1/15.05 = 0.006645 in both.
- **Pool only, MR-14 `mr14.f.exbox.3`:** θ ≈ 6% + 0.36%/0.03 = 18% was a candidate at step 1, whose line uses the unshown 18%.
- **Root cause:** `distractorPool` tested "other" moves only for foreign numbers (equations), or for quantity-name and word overlap (labels). It never asked whether the move *produces a number this example goes on to use without having shown it*.
- **Fix:** see Fixes below. The pool drops such moves ("A step elsewhere that produces one of them is part of this derivation").

### 2. False statement in the naming and feedback line. 16 of 20 examples; 5 more say "one line". **Fixed.**

- `namingFor` said "each line feeds the next" for every example with ≥2 results, and "one line takes the givens to X" for any example with one blankable line.
- **"each line feeds the next" was false for:**
  - independent lines: VaR 95% vs 99% in MR-1 (×3), the payoffs in `mr12.h.exbox.1`, up and down nodes in `mr14.f.exbox.2/.3`, X1–X5 of the Altman Z-score (`cr9.b.exbox.1`), the λ̄(3), λ̄(5) and λ̄(10) hazard rates;
  - V1U and V1L in `mr12.d`, `mr12.e`, `mr12.h.exbox.2`;
  - `cr9.e.exbox.1`, `cr11.c.exbox.1`, `cr11.c.exbox.2` (the 20,000 in WCL = 3 × \$20,000 is the given per-credit value, not the EL), `cr22.e.exbox.2`, `im5.a.exbox.3` and `im5.a.exbox.5`.
- **"One line takes the givens to X" was wrong** when other lines of the working compute. Example: `mr14.f.exbox.1` said "one line takes the givens to 18%", but 18% is θ, and the notes' answer is dr = 0.0295% on the next line. The same applies to `mr14.b`, `cr4.f.exbox.2`, `cr9.l` and `im5.a.exbox.1`.
- **Fix:** "each line feeds the next" is now said only when every blanked line uses a result of the line before that the givens do not already hold. Otherwise the line reads "the notes' results, in order, run …". When other lines compute, it reads "the notes' working reaches X". It still says "each line feeds the next" for the 3 true chains: `mr8.d`, `cr9.g.exbox.2` and `orr21.f.exbox.3`.

### 3. Number parsing misses. Systematic; changes dependencies and feedback. **Fixed** in parse.ts.

- **Numbers glued to a macro were not read.** `numbersIn` skipped the number in `1.5\times0.247` and `\times1.59` because its look-behind saw the macro's letters. The notes write this form 200+ times.
  - Effect: missed "ahead" dependencies. In `orr21.f.exbox.3`, MA needs 0.247 and RWA needs 1.59, and neither was found.
  - Effect: the wrong chain verdict above for `orr21.f.exbox.3`, which really is a chain.
  - Effect: incomplete "available numbers" sets, which the foreign-number test relies on.
- **"60 per cent" was not read as a percentage.**
  - Effect (LTR-14 `ltr14.d.exbox.1`, not currently playable): the "ahead" feedback said the step "needs 0.60, which the working has not produced yet" while the prompt gives 60 per cent.

### 4. Cosmetic

- The naming line printed "0.326% , or 32.6 basis points" and "0.0229 , or 2.29%". Fixed: the space before the comma is gone.

### Reviewed and judged acceptable (no change)

- **An LHS label is the only foreign number:**
  - In MR-1 `mr1.b.exbox.3` (lognormal), the arithmetic VaR(95%) = (−0.10 + 0.20×1.645)×100 is offered as wrong. It uses this box's numbers, but it is the wrong formula for lognormal VaR. This is an honest Formula trap.
  - In CR-11 `cr11.c.exbox.2` (ρ = 0), CVaR(99%) = \$1,000,000 − \$20,000 is the ρ = 1 case and the wrong confidence level. It is wrong here.
- **"ahead" needs:** every needs value was verified to be produced by an intermediate step and absent from the givens. The only scaled-form hits left are coincidences: 150 PSA vs 0.015, 66 bp vs 660,000, and 20 credits vs \$20,000.
- **Parallel steps:** steps that could be done in either order (asset leg vs liability leg, uses vs sources of funds, 95% vs 99%) are never offered as "ahead". That is correct, because the "ahead" test requires an unproduced input.

## Fixes made (files)

- `web/src/games/mechanics/stepwise-derivation/build.ts`
  - `distractorPool`: builds `wanted`, the non-common inputs of the gap line and the later lines that are not yet available. It skips any "other" move whose outputs hit `wanted`.
  - `namingFor`: truthful chain test (outputs of the previous line used, and not already among the givens), plus the "one line" guard, using `computes` from parse.ts.
  - `landing`: space before a comma removed.
- `web/src/games/mechanics/stepwise-derivation/parse.ts`
  - `numbersIn`: splits a macro from a following digit, and reads "per cent" / "percent" as %.

## Verification

- `stepwise-derivation.cjs` passes: ALL OK, 390 plans, 13/107 readings supported (unchanged), 0 KaTeX failures.
  - Option kinds: ahead 1146 → 1206, other 4584 → 4524.
- The re-dumped rounds contain none of the problem pairs above.
- `sd-audit.cjs` (b) hits left: only distractors whose number is already available (a redundant move, correctly wrong) or coincidental round numbers (0.01, 0.1, 1.2, 40, 50).
- Full `tsc -p tsconfig.json` in scratchpad/tscheck: 0 errors.

## Left as is (not systematic in this mechanic, or content-level)

- **Label distractors that name a quantity or side, not an operation:** "Left-hand side", "Right-hand side", "Difference", "Decay", "Expanding", "Shortening", "Short/Medium/Long-term factor", "Expected rate". They are never correct, but out of context they are near-meaningless and too easy to reject. A quality issue, not a correctness one.
- **Givens that live outside the box.**
  - `ltr12.d.exbox.1` relies on `ltr12.d.table.1` for the 65 and 1,000.
  - `mr12.e.exbox.2` omits the Top year-2 node, which is in the tikz figure.
  - Several boxes say "previous example" but have their own prompt, so no context is carried over: `cr4.f.exbox.2` (325,333 and 90,000 never shown), `orr21.b.exbox.3` and `ltr1.a.exbox.2`.
  - The player then sees setups using numbers never shown. Answerable by reasoning, but not self-contained.
- **Prompts that give the answer away.**
  - `im5.d.exbox.1` prints the result table (MVaR 0.0762) before the one gap.
  - `im5.a.exbox.5` prints the A–D answer choices.
- **Concept term:** for `mr8.d` the term is the section title "To calculate the payoff (for the buyer)". It is faithful to the notes, but awkward as a concept name.
- **Coverage:** only 13 of 107 readings, and no CI, support a full arc.
