# Bucket Drop: fact-check of real rounds against the notes

Mechanic: `web/src/games/mechanics/bucket-drop/` (build.ts). Harness: `gamestest/bucket-drop.cjs` (+ `bucket-drop.tsconfig.json`).
Pass 1 scripts: `scratchpad/bdcheck/`. Pass 2 scripts and dumps: `scratchpad/bd2/` (all.cjs, scan.cjs, titled.cjs, nest.cjs, ctx.py).

## Pass 2 (second, independent review; same game-blocks.json as pass 1, byte-identical)

### What was checked

- **Seeded plans, read in full.** Seed 4 over every reading: **826 rounds, 96 readings, all six areas**
  (MR 14, CR 22, ORR 23, LTR 16, IM 13, CI 8 readings), `bd2/s4.txt`. Every card was read with its prompt, buckets,
  context tag and answer. Every doubtful one was checked against the block JSON and the LaTeX (`notes/*/ch/*.tex`).
- **Seeds 6 and 8** (1,650 rounds, `bd2/s68.txt`): I read the 40 boards (170 rounds) whose scheme seed 4 never dealt (`bd2/new68.txt`).
  **Total read: 996 rounds over 96 readings.**
- **Whole-corpus scans** over all 411 schemes and 2,585 cards:
  - cards with the same text as displayed (after masking) under two buckets (0);
  - near-twin cards in different buckets, 75%+ word overlap (22, all discriminating contrasts);
  - cards that mention another bucket's name mid-text (58, read one by one);
  - titled boxes filed under a section heading (27 boxes, each checked against the LaTeX);
  - a bucket name nested inside another's (parent/child headings);
  - table columns that read the same on every row;
  - cross-reference cells.
- **Feedback** ("Not X. It belongs under Y. Block id", BucketBoard.tsx) is right whenever the answer bucket is right. Its errors are the answer errors below.
  **Prompts** are neutral and faithful. The **concept line** of headings boards stated a heading count that was wrong (#5).

### Problems found (pass 2)

| # | Kind | Count | Example (round → answer) | Root cause |
|---|------|-------|--------------------------|------------|
| 1 | **Wrong or undeducible answer** (a titled box filed under the section above it) | 20 cards, 6 schemes | LTR-5 a: "There is a trade-off between liquidity and profitability", "Longer-term liquidity **demands** arise from seasonal, cyclical, and trend factors" → *Supplies of liquidity*. The boxes "Liquidity has a critical time dimension" and "The essence of liquidity management" close the objective after the Supplies list. LTR-2 e: "Hedge funds manage liquidity via cash, unpledged assets…" → *Three characteristics used to measure market liquidity* (the box is "Managing funding liquidity: the hedge fund case"). MR-8 a: "Standard deviation and variance calculations help determine the risk of a portfolio" → *Two categories of financial correlation* (box "Points just to consider"). LTR-11 c: "Business units → clients, counterparties" → *Governance and oversight* (box "Communication and coordination"). | The extractor gives every block the last `\subsection`/`\orsub` above it. The headings scheme took that section as the heading for titled key/def/note boxes too, even when the box's title names a different topic. |
| 1b | **Distractor also correct**, same cause | 6 of the 20 | MR-7 a: "Unconditional coverage — ensures that the model correctly estimates the expected probability of exceedances" → *The exceedance-based approach*, while *VaR model validation using Kupiec unconditional coverage* is on the board. LTR-7 d: "TSECF — the term structure of expected cash flows…" → *Two classes of factor produce cash flows*, while *How the term structures are built* is on the board. | Same as #1. |
| 2 | **Garbled cards on a non-classification board** | 1 scheme, 7 cards | LTR-17 c: "Rise Fall" → *And if interest rates*; "Decrease Increase", "No change No change" → *The institution's net worth will* | The cells are two lines (`Rise \newline Fall`) and the JSON keeps no line break. The table is a grid read across as if-then statements: its column headers are sentence clauses, and one column reads "Rise Fall" in every row. |
| 3 | **Card with nothing to sort** (a ditto cell) | 1 card | LTR-10 a: "As FSA047." [Frequency] → *FSA048 Enhanced mismatch report*, with *FSA047 Daily Flows* on the board | A cross-reference cell whose only content word is another bucket's name. |
| 4 | Cosmetic: meaningless context tag | 7 cards | MR-4 f table 2: "Intraday trading" [ctx: III], "Bad luck" [ctx: IV] | The row label is a bare Roman numeral. |
| 5 | **Concept line states a false count** | every headings scheme whose objective has headings without bullets | "Under MR-7 a, the notes list their points under 4 headings: …" (the notes have 7 there); LTR-11 c said 4 (the notes number 5) | The line counted the board's buckets, not the notes' headings. |

In total: **28 faulty cards** (20 wrong, undeducible or double-answer cards in #1/#1b, 7 garbled in #2, 1 ditto in #3), plus 7 cosmetic context tags (#4)
and the concept-line wording (#5). In seed 4's 826 dealt rounds, 12 were faulty (LTR-5 a ×2, LTR-2 e ×2, LTR-11 c ×2, LTR-7 d ×2, LTR-17 c ×3, LTR-10 a ×1),
3 carried a numeral tag, and every headings board carried the counted concept line.

### Fixes (all in `web/src/games/mechanics/bucket-drop/build.ts`)

1. `headingScheme` → `underSection`: in section mode, a **titled box** counts as listed under its section only if one of these holds:
   (a) the box opens the section, with no block of any type before it under that heading (LTR-13 f "Floor, cap…" under *Limits of special spreads*);
   (b) its title shares a topic word with the section that the other headings don't share (`topicWords`: hyphens split, plurals folded, e.g. "Why use pseudo returns?" under *Pseudo history and pseudo returns*);
   (c) its title is an aspect word ("Strengths", "Weaknesses", "Limitations", "Challenges"…).
   This removes all 20 cards in #1/#1b. It also drops 9 defensible cards (MR-2 c "Remember — the decay parameter" ×3, LTR-7 d "What the Treasury Department is monitoring" ×4,
   LTR-15 b "Funding patterns differed by region" ×2). The MR-8 a and LTR-2 e headings schemes lose a bucket and are no longer dealt. The 16 titled boxes still kept were each re-checked; all are about their section.
2. `tableSchemes`: a table (column mode) with a column that reads the same, as displayed, on every row (≥3 rows) gives no scheme. Only LTR-17 c is affected.
   The comparison uses the displayed text, because `normKey` strips "=", ">" and "<" and made CR-9 g's "Spread = / > / < fixed coupon" look constant.
3. `finaliseItems` → `namesOtherBucket`: a card is dropped when every content word in it is in another bucket's name. Only LTR-10 a "As FSA047." is affected.
4. `tableSchemes`: a row label that is a bare numeral or letter ("II", "IV", "3") is not shown as the card's context tag (`BARE_NUMERAL`).
5. `headingScheme`: the concept line no longer states a count. It now reads "Under X, the notes list these points under the headings A, B and C."

After the fix: harness `bucket-drop.cjs` **ALL OK**: 408 schemes (was 411), 2,542 cards, **96 supported readings (unchanged)**, 384 plans.
`tsc -p tsconfig.json` in `scratchpad/tscheck`: **0 errors**. Scheme diff before and after (`bd2/now.txt` vs `bd2/after.txt`): only the intended cards changed.
Seeds 4, 6 and 8 after the fix: 2,473 rounds over 96 readings (`bd2/after-s468.txt`). I spot-read MR-2, MR-8, LTR-2, LTR-5, LTR-7, LTR-11 and LTR-13.

### Left as is (faithful to the notes, but a player could defend another bucket; content-level)

- **ORR-5 c** (structural; fix belongs in the extractor): *Control testing* is an `\orsub` and *Four main categories of control testing* is its `\orsubb` child.
  So "Self-assessment: suitable for low-risk situations…" is under both buckets. game-blocks.json keeps no heading level, and the same name-containment
  pattern also fits siblings (MR-3 a *Challenges* / *Approaches to address the challenges*). The builder can't tell them apart.
  Fix: have `tools/notes/extract.py` record the section level (it already maps `orsub` 2 / `orsubb` 3), then skip mixed-level headings.
- MR-7 a: "Does the model correctly predict the expected exceedance rate?" → *Conditional coverage*. The notes list it as one of the two things conditional
  coverage checks, but *VaR model validation using Kupiec unconditional coverage* is on the same board.
- CR-14 e: "Default events and termination" → *Risk-mitigating features* (an ISDA feature), beside the *Default events covered* bucket.
- CR-2 c: "Strong qualifications. Risk managers need…" → *Oversight* (the notes' own grouping), with *Skills: competence in execution* on the board.
- ORR-8 b: "Background checks and nondisclosure agreements…" → *Awareness*, with *Workforce* on the board.
- ORR-23 b: "Simplified the approach to a single Standardized Approach (SA) for all banks" → *Operational risk framework*, with *Standardized Approach (SA) for credit risk* on the board.
- CR-1 d (labels): "Banks face significant credit risk from … borrowers and through derivatives activities" → *Daily operations*, with *Derivatives activities* a bucket.
- ORR-10 b: "Establish a system for customer identification and verification" → *Customer verification*, with *Customer identification* a bucket.
  (That heading in the notes holds monitoring and STR points, not identification.)
- ORR-13 a: "Significant data breach rates through third parties highlight the need for effective TPRM" → *Why third-party use has accelerated* (the notes' grouping).
- Pass 1's CR-15 f (*Managing* vs *Mitigating counterparty risk*) still stands.
- A blanket rule "drop any card that mentions another bucket" was considered and rejected. Most of the 58 such cards are the reading's key contrasts
  ("Combines both unconditional coverage and independence" → *Conditional coverage*; "One minus the recovery rate" → *LGD*), and the rule would remove them too.
- Cosmetic, from the extraction: label continuations ("And transactions cost estimates are noisy" → *Covariances*, IM-4 a; CI-6 d "And coordination…") and
  lowercase sub-list fragments ("lowering the position with the highest marginal VaR;", IM-5 d). These are correct but read as fragments.

---

## Pass 1



### What was checked

- **Every card the game can deal.** All 411 classification schemes across the 107 readings, 2,585 cards, were dumped
  with bucket labels, prompt, card text, context tag and the correct bucket (`bdcheck/rows.txt`, `cols.txt`, `heads.txt`, `labels.txt`).
  I read all of them. Every suspicious card was checked against the block JSON, and against the LaTeX source when the JSON was in doubt.
- **Real seeded plans.** Before the fix: seeds 1 and 5 gave 1,648 dealt rounds over 96 readings in all six areas (`bdcheck/dump-s1s5.txt`).
  After the fix: seeds 1, 2 and 3 gave 2,477 rounds over 96 readings (`bdcheck/dump-after.txt`). I spot-read boards from MR-1/2/3,
  CR-15, ORR-10, LTR-9, IM-11 and CI-2/6 after the fix.
- **Player-visible text:** board prompt, bucket labels, card and context tag, the concept-naming line, and the opening. Feedback is
  "Not X. It belongs under Y. Block id" from BucketBoard.tsx. It is right whenever the answer bucket is right, so its errors are the ones below.

### Problems found (before the fix)

| # | Kind | Cards / schemes | Example | Root cause |
|---|------|-----------------|---------|-----------|
| 1 | **Wrong answer** | 3 cards, 1 scheme | ORR-20 b: "Design stress scenarios specific to the BHC…" → *Risk identification*; "Clearly define capital goals…" and "Use a mix of quantitative and qualitative methods…" → *Internal controls* | The LaTeX is a 2×3 grid of numbered panels. The extractor kept only the first `\thd` header row ("1) Risk identification \| 2) Internal controls"), so the panels 3 to 6 were filed under columns 1 and 2. |
| 2 | **Wrong / half-right answer** (a `\multicolumn` cell given to one column) | 4 cards, 3 schemes | MR-3 d "Both are rooted in extreme value theory and both use ξ" [Shared] → *GEV* only; CR-19 i "Best case: reduces both", "Good option: mitigates both" → *Counterparty risk* only (they span Funding too); CI-1 b "AI increases interconnectedness…" → *Negative scenario* only (it spans both scenarios) | A row with fewer cells than headers has a last cell that spans the remaining columns. The build gave that cell to the column where it starts. |
| 3 | **Distractor also correct** (the card is a subset of another bucket's card) | 9 cards, 6 schemes | CR-10 e "The probability distribution of losses" → *Vasicek* (CreditMetrics' cell reads "The probability distribution of losses, using a ratings transition matrix"); CR-7 d "Payment history; credit utilization ratio; length of credit history" → *Credit bureau scores* (both other models list the same three plus more); CR-1 c "Face amount" ×3; ORR-7 c "Quantitative, measurable"; LTR-11 c "→ regulators and supervisors"; IM-1 d Lesson 6 | The existing rule removed only exact duplicates across buckets. A card whose words all appear, in order, in another bucket's card (same column) was kept. |
| 4 | **Distractor also correct** (the card opens with another bucket's name) | 2 cards | MR-7 a "Conditional coverage — combines both…" filed under *The exceedance-based approach* while *Conditional coverage* is also a bucket; ORR-19 d "Senior management commitment. Economic capital is effective…" filed under *Key concerns…* while *Senior management commitment* is a bucket | Heading schemes mix a sub-list's bold names with sibling headings of the same name. Only the card's own bucket name was masked. |
| 5 | **Meaningless "which row" question** (side-by-side lists read as records) | 14 cards, 3 schemes | CI-1 a table 2: "AI supports decisions, it does not replace them" → row *Efficiency goes up*; ORR-2 b: "Integrates risk tolerance" → row *Approves and updates the ORMF*; CR-9 k: "Obtained from historical data" → row *Derived from financial market prices* | These tables are two or three independent lists set in columns. They have ragged column ends, lockstep a)/b)/c) enumerators, or peer headers ("Risk-neutral estimates" \| "Real-world estimates"). A short first column made the build treat them as keyed records, so the row pairing it asked about is arbitrary. |
| 6 | **Card with nothing to sort** (a lead-in fragment) | 6 cards, 5 schemes | MR-6 b "Sensitivity depends on:"; MR-6 c "Alternatives to normality:"; ORR-10 a "Banks need policies for", "Understanding of ML/FT risks should consider"; ORR-9 a "Technical controls: address technical aspects of risk through"; ORR-19 a "Liability side: … two embedded options:" | A bullet that only introduces its sub-list was dealt as a card without its children. |
| 7 | **Broken bucket labels** | 2 schemes (4 junk buckets) | IM-10 c and IM-10 d offer buckets "Inter-" and "connected", and the concept line reads "…Valuation, Inter-, connected and Underwriting" | The LaTeX `Inter-\\ connected` became two table rows. |
| 8 | Cosmetic labels | 21 labels | "Kolmogorov- Smirnov (KS)", "Anderson- Darling (AD)"; LTR-4 buckets carrying star grades ("Certificates of deposit ★★"); "2a) Mistakes — rule-based" | `tidy()` rejoined line-break hyphens only when a lowercase letter followed; `cleanLabel` kept the star grades; the enumerator regex missed "2a)". |

Total: **38 faulty cards** (7 wrong or half-right answers, 11 where a distractor was also correct, 14 in meaningless row schemes,
6 unsortable), plus 2 schemes with broken buckets and 21 cosmetic labels. No prompt misstated the task, and no feedback text was wrong on its own.

### Fixes (all in `web/src/games/mechanics/bucket-drop/build.ts`)

1. `tableSchemes`: a table whose headers are **numbered panels** (≥2 headers starting "1)", "2)") gives no scheme. This fixes #1.
2. `tableSchemes`: a **spanning last cell** (the row has fewer cells than the header) is not a column's card, and in row schemes it gets no column tag. This fixes #2.
3. `finaliseItems` → `containedElsewhere`: a card is dropped when its content words (and numbers) all appear, in order, in another bucket's card
   in the same column. Formulas (`$`/`=`) are skipped so that π₁−π₁₂ is not read as "contained". This fixes #3.
4. `finaliseItems` → `opensWithOtherBucket`: a card is dropped when it opens with another bucket's name. This fixes #4.
5. `sideBySideLists`: a table is read as **columns only** when its cells are enumerated in lockstep in at least 2 columns, a column
   runs out while the first column goes on, or 2 headers share a content word. This fixes #5: CR-9 k becomes Risk-neutral \| Real-world,
   ORR-2 b becomes Operational Risk \| Operational Resilience, and CI-1 a table 2 becomes its three column lists. It also adds one valid
   board, CR-18 j (Advantages \| Disadvantages of central clearing).
6. `leadIn`: in heading and nested schemes, a bullet of 8 words or fewer that heads a sub-list and ends in ":" or without
   final punctuation is not dealt. This fixes #6.
7. `joinBrokenRows`: a row that is only "Xxx-" is joined onto the next row's label, giving "Inter-connected". This fixes #7.
8. `tidy` rejoins before an uppercase letter too; `cleanLabel` strips `$\star…$` and ★ grades; `stripEnumerator` accepts "2a)". This fixes #8.

After the fix I re-ran the checks for each rule (subseq, otherlabel LEAD, leadin, spanning, panel tables). Only the 2 intentional
formula exceptions remain. Harness `bucket-drop.cjs` passes (ALL OK): 411 schemes, 96 supported readings (unchanged), 384 plans.
`tsc -p tsconfig.json` in `scratchpad/tscheck` gives 0 errors.

### Left as is (content-level or minor)

- **CR-15 f** headings *Managing counterparty risk* and *Mitigating counterparty risk* (about 11 cards) are two overlapping lists from the notes.
  "Collateralization" and "Cross-product netting" sit under one heading, "Collateral" and "Netting" under the other. The answer is faithful to
  where the notes put each card but can't be reasoned out. The fix belongs in content, by merging or retitling, or in a per-scheme exclusion.
- A label continuation fragment is thin: CR-8 d "For the future. These negative effects lessen over time." → *Lower credit ratings and higher borrowing costs*.
  The label runs into the sentence in the notes.
- Garbled but still correctly bucketed cells: LTR-17 c "Rise Fall" and "Decrease Increase" (2-line cells); ORR-4 c "Customer complaints b) IT system downtime";
  LTR-14 c "— Advantages: …" tagged [Problem]; label "First-loss piece Equity piece" (CR-23 b); heading label "First, Model 2 — constant drift" (MR-14 d).
  These come from the extraction.
- Some cards mention another bucket in passing ("More accurate than principal mapping…" → Duration mapping). That is a comparison, not an ambiguity, so they were kept.
