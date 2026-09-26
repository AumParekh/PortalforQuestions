# Threshold Slider — fact-check of real rounds

Code: `web/src/games/mechanics/threshold-slider/build.ts` (original saved as `textgames/threshold-slider-build.orig.ts`).
Dumps: `textgames/ts/plans-before.txt`, `plans-after.txt` (played rounds, 30 seeds per reading, deduped per item+phase),
`pool-before.txt`, `pool-after.txt` (every candidate round of all 107 readings with a built payload). Dump script:
`gamestest/ts-dump.cjs`.

## Coverage

- The mechanic only builds for readings with at least 6 distinct playable numbers. Before the fixes: 7/107 readings
  (MR-18, CR-5, CR-8, ORR-21, ORR-22, LTR-13, IM-9). No CI reading qualifies. So the "at least 20 readings" target
  cannot be met with played rounds.
- **Played rounds checked:** 158 distinct rounds (the prompt, the pressure lead and cue, the answer readout, the scale,
  the tolerance and the naming line) from 210 plans (7 readings × 30 seeds).
- **Latent rounds checked:** 312 candidate payloads (prompt, answer and cue) across 55 readings in all six areas
  (MR, CR, ORR, LTR, IM and CI). These are what a reading would show if it became supported. This check was used to
  find systematic causes.
- Every played prompt is the notes' own sentence or table row. I spot-checked it against the LaTeX: CR-5 and ORR-21
  risk-weight tables, CR-8 `50_CR_CR8.tex`, LTR-13 `17_LR_LTR13.tex`, IM-9 `47_IM_IM9.tex` and ORR-22 `55_OR_ORR22.tex`.
  The blanked value is the value the notes write. The answers also agree with the curriculum: FRTB horizons
  10/20/60/120/250, IDR at 99.9% over 1 year, Basel I credit conversion factors and add-ons, F-IRB PD floor 0.03% and
  LGD 45%/75%, BIA 15%, TSA 12%/15%, SCR 99.5%, CCyB 0–2.5%, G-SIB 1–3.5%, leverage ratio 3%, LCR 30 days, SVaR
  250-day, the 8% → 10.5% capital ratio, and the others.

## Problems found in played rounds (by kind)

| # | Kind | Round(s) | Detail | Root cause | Status |
|---|------|----------|--------|------------|--------|
| 1 | The answer is not a fact (a worked-example input), so the prompt cannot be answered | LTR-13 `ltr13.a.trapbox.1.numeric_item.1/.2`: "The contract price is ___ market value, not $10m face." → $11m. Also the reverse → $10m, and the pressure cue "The contract price is ___ market value …" | The trap box restates the repo-settlement exbox (face $10m, market $11m). No fact in the notes pins $11m. | `candidates()` skips `exbox` blocks, but a trap box or table cell that repeats an example's currency inputs was treated as a fact. | **Fixed** |
| 2 | Same kind (an arbitrary illustrative amount) | LTR-13 `ltr13.b.table.1.numeric_item.1`: "A firm buying a ___ bond intending to sell at a profit can finance…" → $10 million | Any amount fits. $10 million is the exbox's face value. | Same as #1 | **Fixed** |
| 3 | Ambiguous prompt (a shorthand line too thin to answer in discovery, where no lead is shown) | LTR-13 `ltr13.f.trapbox.1.numeric_item.2`: "Zero rates → the full ___ ." → 3% | The fact is kept by "…the penalty reaches its maximum of 3%". | `MIN_WORDS` counted "→" as a word. | **Fixed** |
| 4 | Wrong feedback text ("Close, at X, but not where the notes draw the line") | Every year round (52 of 516 harness rounds) and high percentages | `judge()` counted a guess as close within 5% of the answer. For 1995 that is ±100 years, so every mark on the 40-year scale read "Close" and earned CLOSE_GRADE. For 99.9% it made 95% "close" (two different regulatory levels). | The near-miss band scaled with the answer, not with the scale. | **Fixed**: the band is now ≤ 5% of the scale width (2 years for years; 1 pt on the 80–100% scale) |
| 5 | Ambiguous prompt (weak) | ORR-21 `orr21.c.prose_para.1`: "By ___ , the 1987 crash and the popularity of VaR highlighted market risk gaps in Basel I." → 1995 | Any year after 1987 reads fine. Under pressure the lead is hidden because it writes 1995. | "By YEAR," is a loose time marker, not an event date. This is the only case in the corpus. | Left (the notes' fact; a one-off) |
| 6 | Context-dependent prompt (weak) | MR-18 `mr18.c.table.2.numeric_item.3`: "…the lower confidence level carries the higher exception allowance, because a ___ model is expected to be breached more often." → 97.5% | The prompt is answerable only by recalling the 99%/97.5% pair from the same table. | The notes' own sentence | Left |
| 7 | Cue loses its subject (weak) | CR-8 pressure: "… while emerging markets experienced drops of ___ or greater." → 50% | "2008 subprime crisis … equity markets" is cut off and there is no lead. | shortCue clause cut | Left |

Played-round problem count: 5 rounds wrong or unanswerable (#1–#3: $11m, $10m, $10 million and 3%, including both
phases of $11m). One systematic feedback error covers all year and high-percentage rounds (#4). Three weak prompts
remain (#5–#7).

Two dates that are the notes' own claims and would be content notes, not game faults: Basel 2.5 "Introduced in 2011"
(published in 2009, in force at end-2011) and AIFMD "2010" (the directive is 2011/61/EU). The game reproduces the notes
faithfully in both.

## Latent problems (unsupported readings, not currently played)

- Worked-example inputs in trap boxes or tables. Fix #1 also removes 27 latent candidates: CR-4 $1,800,000/$2,000,000,
  IM-5 $2m/$10m, IM-6 $500m/$1,000m, IM-8 $35/$100/$350/$1,000, LTR-7 $100m/$75m, LTR-12 $200m/$300m, LTR-17 $50bn,
  MR-12 $7/$0, and CR-13 "An example is … $100 million … plus 25 basis points".
- Illustration sentences the cues still miss: MR-1 "So, if we have 1,000 loss observations … ___ confidence level" (97%),
  MR-1 defbox "$5,000", CR-2 "such as $75 million", ORR-3 "$30 billion" (an Example column).
- CI-3: "$0.2T". The extractor's numeric item text is "$0.2" and the "T" sits outside it, so the readout would show
  "$0.2" and the blank "___ T". This is an extractor or content issue.
- Fix #3 also drops LTR-9 "Structural ≈ a 12-month survival horizon." (5 words). That is a genuine fact lost with a
  shorthand line.

## Fixes (all in `web/src/games/mechanics/threshold-slider/build.ts`)

1. `exampleAmounts(reading)` and `currencyAmount()`: currency figures written in the reading's `exbox` blocks are
   normalised to absolute amounts ($11m = $11 million). `candidates()` drops any currency candidate (not a year) whose
   amount is one of them.
2. `EXAMPLE_START` also matches "for instance" and "an example is/would be" at the start of a sentence (−3 score, as
   "for example" already had).
3. The `MIN_WORDS` count only counts tokens with a letter or digit, so arrows and dashes no longer count.
4. `judge()`: the near-miss ("close") band is `max(3·tol, 5%·min(|answer|, scale width), fine)`.

Effect: LTR-13 drops below 6 distinct numbers and is no longer supported (6/107 readings: MR-18, CR-5, CR-8, ORR-21,
ORR-22, IM-9; there is now no LTR reading). Rounds in the other six readings are unchanged. The harness
(`gamestest/threshold-slider.cjs`, with new assertions for fixes 1 and 4) reports ALL OK: 72 plans, 516 rounds.
`tscheck` tsc: 0 errors.
