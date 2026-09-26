# Table Fill: fact-check of player-visible content

This file covers two passes. Pass 2 (below) was run on the current `game-blocks.json`, which includes the 2,808 merged traps. Table Fill doesn't read traps, and every table sheet it builds is byte-identical to the pass 1 data: the seed 1 dump is unchanged. Pass 1 is kept further down for reference.

# Pass 2

## What was checked

| Check | Scope |
|---|---|
| Manual read of every sheet at seed 7 (fresh; pass 1 read seeds 1–3) | 444 rounds, 136 sheets, all 59 supported readings. By area: MR 7 readings, CR 16, ORR 13, LTR 14, IM 5, CI 4 |
| Manual read of every table that first appears under seeds 4–12 | 12 tables: `cr9.a`, `cr9.g`, `cr19.h`, `cr22.i`, `ltr4.a.1`, `ltr4.b`, `ltr9.a`, `ltr9.c.2`, `ltr17.c.1`, `mr18.b.1`, `mr18.c.1`, `orr5.d.2` |
| Spot-check against the `.tex` | ORR-1 frequency/severity grid; MR-18 liquidity horizons; LTR-4 money-market table; IM-10 `Inter-\\ connected`; ORR-7; IM-9; MR-6; CR-20 |
| Automated scans over seeds 1–12 (`gamestest/tf2-scan.cjs`, `tf2-anchor.cjs`, `tf2-count.cjs`) | 5,312 rounds, 1,613 sheets (892 distinct). They flag: tiles in one sheet that are equivalent once punctuation and brackets are dropped; tiles that are prefixes of each other; a tile whose words are printed in its own row; label fragments; rows whose visible cells don't name them |
| Row alignment against each block's `body_latex` (`gamestest/tf2-fidelity.cjs`, seeds 1–12) | 5,312 rounds, 6,729 blanks |

In the alignment check, every played row's cells must appear, in column order, in one source row of the notes' LaTeX. It flagged 23 distinct rows in 6 tables (`orr1.b`, `ltr4.a.1`, `ltr4.a.2`, `ltr4.c`, `mr15.summary`, `cr19.f`). All 23 are the known tokeniser false positives: `\chiplow` and `\chiphigh` macros, `$\star$` ratings, and math. ORR-1 and LTR-4 were then confirmed by hand against the `.tex`.

### Result on correctness
- **Correct answers:** none was wrong relative to the notes. Every answer is the notes' own cell, confirmed by the alignment check.
- **Equivalent tiles:** the scan found none. Pairs such as ξ = 0 / ξ < 0, 3(c)(1) / 3(c)(7), "Positive (0.46 to 0.67)" / "Positive (0.001)", and "Down" / "Down (NP)" are distinct facts. Identical cells (for example "Lower is better" three times, or "Low" / "Low") are graded by normalised text, so they are interchangeable by design.
- **Prefix pairs:** these are also distinct. Examples: in CR-1, "Face amount" against "Face amount; time value of money"; in CR-7, the three key-variable lists, where each extends the one before; in ORR-21, "1%" against "1% + 1% × INT[M−1]". The notes assign each to exactly one row.
- **Where the problems were:** in which cells can be lifted and which cells can name a row.

## Problems found in pass 2, with root cause

### H. A value shared by every row counted as the row's anchor (3 tables; 12 round placements over seeds 1–12)
- **`cr22.i.table.1`** (seeds 1 and 7). Discovery and pressure showed "[Mezzanine tranche] | ↓ | [↑ then ↓]". The only cell left was "↓", which is the Mean value of every tranche, so the row could be filled only by elimination.
- **`ltr17.c.table.1`.** "[Negative (D_A < D_L×L/A)] | Rise Fall | [Increase Decrease]" and "[Zero …] | Rise Fall | [No change No change]". "Rise Fall" is in every row.
- **`ltr17.c.table.2`.** "[Rates will rise] | [Reduce D_A and increase D_L …] | Net worth increases, if management's rate forecast is correct." Both rows share that last cell word for word.
- **Root cause:** pass 1 (fix F) made constant columns non-blankable. However, `keepsAnchor` and `nonEmptyCount` still accepted a constant-column cell as the anchor that names the row. This is the same defect as pass 1 problem E (the lone dash), in a second form.
- **Fix:**
  - `EligibleRow.anchors` holds the columns whose cell can name the row: substantive and not constant.
  - Row eligibility (at least 2 anchors), `rowCapacity` and `keepsAnchor` all use it.
- **Feedback text had the same weakness.** A miss is announced as "<row anchor> · <header>: the notes have …". `anchorOf` in `TableFillBoard.tsx` named the row by its first visible cell, which could be the "Rise Fall" or "↓" cell that every row has. It now prefers a visible cell that differs from the other rows in that column, and falls back to the first one.
- **Effect:**
  - Rounds with no naming anchor went from 12 to 0 (`tf2-count.cjs`).
  - `ltr17.c.table.2` now has only 2 blanks, so it leaves Table Fill. LTR-17 still plays from its other tables.
  - `cr22.i` and `ltr17.c.table.1` play one blank per row.

### I. The fragment label "connected" traveled as a tile (IM-10; 2 tables; 19 round placements over seeds 1–12)
- **Tables:** `im10.c.table.1` and `im10.d.table.1`.
- **What happened:**
  - The notes write `Inter-\\ connected`, and the `\\` ends the tabular row. This is pass 1 item G3, a content bug that is still in the `.tex` and in `game-blocks.json`.
  - The result is an unplayable one-cell row "Inter-" and a played row labelled "connected".
  - Pressure shows only the target rows, so there the tile "connected" appeared with no "Inter-" anywhere on screen.
- **Root cause:** the mechanic took the extractor's rows at face value.
- **Fix:** a new `joinBrokenLabels` step in `eligibleTables`. When a row has only a first cell, is not aligned, and that cell ends in "letter + hyphen", it is joined to the next aligned row when that row's label starts in lower case. The join keeps the notes' own characters, giving "Inter-connected". The fragment row is dropped.
- **Effect:** the label now reads "Inter-connected" in 21 placements, and "connected" never appears as a tile. The content bug itself should still be fixed in `28_IM_IM10.tex:125` and `:151`, for example `Inter\-connected` or `\makecell{Inter-\\connected}`.

### J. A lifted cell whose words are printed in its own row (60 distinct sheet cells over seeds 1–12; 51 after the fix)
- **Examples:**
  - "[Singapore] | …register with the Monetary Authority of Singapore…" (IM-9);
  - "[Modified LDA] | …A modified LDA can incorporate…" (ORR-7);
  - "[Market risk] | Allows the institution to hedge market risk losses…" (CR-21);
  - "[Revolving] | …keeping the pool revolving…" (CR-23);
  - "[Control effectiveness] | … | Control effectiveness — how well controls work" (ORR-4 KCI, pass 1 item G6);
  - "[Stabilising] | Destabilising" (LTR-1).
- **Why it matters:** nothing is incorrect, but the blank tests word-matching rather than recall of the notes.
- **Root cause:** `chooseBlanks` ranked a row's cells only by row-label column and bare number.
- **Fix:** a new `echoed(row, col)` check. A cell is "echoed" when its whole-word text (4 or more characters) occurs in another cell of the same row. `chooseBlanks` ranks echoed cells last in the one-per-row pass and in the second-cell pass, so they are lifted only when the row has nothing else to offer.
- **What remains:** the 51 cases left are all of two kinds. Some are rows whose only liftable cell is an echoed label, because the description is longer than 120 characters: IM-10 c, IM-2, IM-11, LTR-3 a, LTR-7 d, LTR-13 b, ORR-7 d, CR-23 c. The others are pressure sheets that blank the whole label column. Removing echoed cells outright would drop those tables, so they were left as they are.

### K. Content and notes issues the game reproduces (not fixable in the mechanic; `content/` and `notes/` not edited)
Pass 1 items G1, G2, G4, G5 and G6 are still present. They were re-verified in the `.tex` in this pass:
- **G1: CR-20 IRS row** (`17_CR_CR20.tex:420`). "You receive fixed and pay floating. If rates rise (good for you)" is the wrong direction for a fixed receiver. This cell is a tile.
- **G2: MR-4 caption** (`35_MR_MR4.tex:161`). "The two diagonal cells are the two ways of being wrong": Type I and Type II are off-diagonal.
- **G4:** `\newline` fusions such as "Decrease Increase" and "First-loss piece Equity piece". **G5:** CR-19 ρ̄ = −1 is played without its "two exposures" caveat. **G6:** ORR-4 KCI (see J).

New in pass 2:
1. **LTR-4, `ltr4.a.table.1` row 1** (`38_LR_LTR4.tex:32`). The notes' label is `Treasury bills \newline notes rate ★★★`. The label is garbled: stray "notes rate" is fused into the instrument name. It shows on the sheet as "Treasury bills notes rate ⋆⋆⋆".
2. **MR-18, `mr18.b.table.1`** (`11_MR_MR18.tex:157`, `:186–191`, and the plot at `:177`).
   - The notes give the FRTB liquidity horizons as 10 / 20 / 60 / 120 / 250 days, with "Category 3 | 60 days".
   - Those are the 2013 consultative-paper values. The final standard (and current Hull) uses 10 / 20 / 40 / 60 / 120.
   - This should be checked against the edition GARP assigns. The table, the caption ("twenty-five times as long") and line 157 all depend on it.
3. **IM-9.** `im9.c.table.1` says the private adviser exemption covered "fewer than 15 clients", while `im9.d.table.1` says "fewer than 15 funds". This is an inconsistency inside the notes, and "clients" is the statutory term.
4. **Heading taken from the enclosing subsection.** In MR-6, `mr6.b.table.1` (Benefits | Challenges of sensitivity analysis) is named "Analyze results" on the naming screen, because it sits under `\subsection{3) Analyze results}`. Similarly, `cr20.i.table.1` compares incremental against marginal CVA under the heading "Marginal CVA". The heading is faithful to the notes' layout but only loosely names the table. There is no structural signal to tell these cases apart, so this was left.
5. **Pass 1 item B remains: `cr9.a.table.1`.** It is two lists (Agencies' ratings | Internal systems) whose last row does not pair: "Avoiding reversals" is beside "Factors: profitability…". It plays as a pressure sheet that blanks the whole left column. Three of its four rows do pair, and the caption relies on the third, so it was left.

## Counts (pass 2)
| Kind | Tables | Instances (seeds 1–12) | Status |
|---|---|---|---|
| H. Constant-column cell used as the only anchor | 3 | 12 round placements | Fixed (0 left) |
| I. Fragment label tile "connected" | 2 | 19 round placements | Fixed (shown as "Inter-connected") |
| J. Lifted cell echoed in its own row | about 25 | 60 distinct sheet cells | Reduced to 51, where no alternative exists |
| K. Notes or content errors reproduced | 5 carried over from pass 1, plus 4 new | CR-20 IRS (wrong fact), MR-4 caption (wrong), MR-18 horizons (likely outdated), LTR-4 label (garbled), IM-9 (inconsistent) | Content; needs a `notes/` edit and re-extraction |
| Wrong "correct" answers | 0 | n/a | n/a |
| Distractors also correct | 0 (beyond identical cells, which are graded as interchangeable) | n/a | n/a |

## Fixes (pass 2; `web/src/games/mechanics/table-fill/build.ts`, plus `anchorOf` in `TableFillBoard.tsx`)
- **`EligibleRow.anchors`:** substantive cells in non-constant columns. It replaces `nonEmptyCount`, and is used for row eligibility, `rowCapacity` and `keepsAnchor`.
- **`joinBrokenLabels(grid)`:** runs at the start of `eligibleTables` and rejoins a hyphenated row label that a stray `\\` split across two rows.
- **`echoed(row, col)` with a `words` helper:** `chooseBlanks` ranks echoed cells last.
- **`TableFillBoard.tsx` `anchorOf`:** the row named in feedback and screen-reader text is a visible cell that tells the row apart, when one exists.
- **Harness (`gamestest/table-fill.cjs`):**
  - every played row keeps a naming anchor;
  - "Inter-connected" is joined and "connected" is never a tile;
  - no constant-column anchors in `cr22.i` and `ltr17.c.1`;
  - the source-cell check accepts the joined label.
- **Result:** harness ALL OK over 1,770 plans. There are 59 supported readings, the same as before. `tscheck/tsconfig.json` reports 0 errors.

# Pass 1 (earlier; for reference)

Mechanic: `web/src/games/mechanics/table-fill/` (build.ts). A table from the notes is shown with some cells lifted out. The loose cells ("tiles") go back into the blanks. For this game:
- the **correct answer** is the cell the notes wrote in that position;
- the **distractors** are the other lifted cells on the same sheet;
- the **prompt** is the heading, the column headers and the cells left standing;
- the **feedback** is the notes' cell, shown on a miss, plus the table caption once the sheet is done.

A tile is graded by normalised text, so two identical cells (for example "No" / "No") can go in either blank.

## What was checked

| Check | Scope |
|---|---|
| Manual read of every sheet, seed 1 (before the fix) | 485 rounds, 148 sheets, all 64 supported readings, all areas (MR, CR, ORR, LTR, IM, CI) |
| Manual read of tables that only appeared under seeds 2–3 | 19 more tables, about 60 rounds |
| Spot-check against the `.tex` notes | MR-4, CR-20, ORR-4, ORR-1, CR-19, IM-10, LTR-5, CR-8 |
| Automated audit over seeds 1–8 (`gamestest/tf-audit.cjs`) | 3,885 rounds before the fix, 3,541 after. It flags: rows left with no real anchor or only a numeric or ordinal anchor; precise-figure tiles; tiles that start mid-list; fragment tiles; blanks in a constant column |
| Row-alignment check against each block's `body_latex` (`gamestest/tf-fidelity.cjs`, seeds 1–5, after the fix) | 2,209 rounds |

In the alignment check, every cell's words must sit in one source row, in column order. It found no real misalignment. It flagged 21 rows, and all of them were tokeniser false positives (math, `\star`, `\chiplow` macros). ORR-1 and CR-19 f were checked by hand against the `.tex`.

Because the answers are copied from the notes verbatim, a "correct" answer was never wrong relative to the table. The problems were in which cells get lifted, in tables whose rows don't actually pair, and in notes errors that the game reproduces.

## Problems found (before the fix), with root cause

### A. Worked-calculation and regression figures lifted as recall (7 tables; 24 tiles; 18 row placements)
- **Tables:**
  - `mr5.g.table.1`, `mr5.g.table.2`, `mr5.g.table.4`: VaR mapping workings.
  - `mr11.b.table.1`: TIPS/T-bond DV01 example.
  - `mr11.e.table.1`: regression printout.
  - `mr16.d.table.2`: "The estimated parameters, for reference".
  - `im3.e.table.1`: Berkshire regression output.
- **Tiles lifted:** figures such as 0.172, 0.0034 against 0.0037 against 0.0040, 0.38 against 0.36 (the HML loading, Fama-French against the momentum model), 0.084 against 0.068, and 0.212.
- **Rows the player had to name from computed figures alone:** for example "[EUR spot] | 122.911 | 5.578 | 31.116", or "[σ_m] | 109.2 bp" against "[σ_l] | 96.4 bp".
- **Why it is wrong:** nothing in the notes can be recalled to place these. Only the page layout decides them.
- **Root cause:** `isBlankable` only rejected numbers with 4 or more significant digits. `isExhibit` only caught numeric grids with numeric headers or a numeric first column.
- **Fix:**
  - A new `isPreciseFigure` covers any bare number with 2 or more decimals, or 4 or more significant digits after a decimal point. Such a figure is never a tile.
  - A row whose other cells are all bare numbers, including a precise non-percentage figure, can't have its label lifted.
  - A table where at least half of the played rows are like that is skipped as a worked exhibit.
  - Percentages stay nameable, so MR-9 "The study" still plays: 27.46% against 33.06% is the comparison the reading makes.

### B. Side-by-side lists whose rows don't pair (5 tables; 4 fixed)
In these tables the cross-row pairing is an accident of layout, so the "correct" row is not in the notes.
- `ltr6.c.table.1`: flow measures and risk measures.
- `ci6.b.table.1`: exchange functions and risks. The caption itself says custody risk belongs with custody services, yet the table places custody risk beside direct retail access.
- `cr14.e.table.1`: 4 risk-mitigating features and 8 default events.
- `ci1.a.table.2`: three lists of different lengths.

Pressure sheets blanked a whole column, so the player had to reproduce an arbitrary pairing.
- **Root cause:** only `LIST_HEADER` words (Advantages, Disadvantages and similar) and all-enumerated columns were treated as lists.
- **Fix:** a new `unevenLists` check skips a table with no stub header when any of these holds:
  - its first column runs out before the others;
  - two columns run out at different rows;
  - a column runs out beside a first column of sentences (over 40 characters on average) rather than labels.
- Tables with real row labels that end early are still played, for example `mr18.c.table.2` (Scope row) and `ltr12.d` (Total row).
- **Not fixed:** `cr9.a.table.1` (Agencies' ratings against internal systems). It is two unpaired lists of equal length, and nothing in its structure tells it apart from genuinely paired two-column tables such as `orr17.a` (Pre/Post-SCAP), `ci5.a`, `cr9.k` and `ltr17.b`.

### C. Header row that is really a group title (1 table)
- **Table:** `mr14.e.table.1`.
- **What happened:** the headers were "1. Arbitrage-free models | model price = market price", and the later rows were grouped "2. Equilibrium models". The Equilibrium "Assumption" row was therefore shown under a column headed "1. Arbitrage-free models".
- **Root cause:** the extractor put the first group's title row in `headers`.
- **Fix:** skip a table whose first header is enumerated while its row groups are enumerated too.

### D. List-marker stripping broke inline lists (2 cells)
- **Where:** `orr5.g.table.1`, Disadvantages column.
- **What happened:** "a) May not fully cover losses. b) Delays …" was shown as "May not fully cover losses. b) Delays …".
- **Root cause:** `stripEnumerator` removed the leading "a)" from cells that are themselves inline lists.
- **Fix:** keep the marker when a later marker of the same style (b), c) …) follows inside the cell.

### E. A lone dash counted as a row's anchor (3 tables)
- **Rows affected:**
  - `cr22.d` Underwriter, Originator and Custodians: "[Underwriter] | [Structures…] | —".
  - `cr19.h` Rounding: "[Rounding] | —".
  - `cr20.f` BCVA: "[BCVA] | [Both parties'…] | —".
- **Why it is wrong:** the row could only be filled by elimination.
- **Root cause:** `keepsAnchor` and `nonEmptyCount` accepted any non-empty cell.
- **Fix:** an anchor must be `substantive`, meaning more than dashes and punctuation. Arrows such as ↓ and ↑ still count: `cr22.i` is a legitimate direction table.

### F. Blanks in a column that is the same in every row (2 tables)
- **Tables:**
  - `ltr17.c.table.1`: "Rise Fall" in every row.
  - `ltr17.c.table.2`: "Net worth increases, if …" in both rows.
- **Why it is wrong:** these are free placements that test nothing. It is not a correctness error.
- **Fix:** columns that are constant across the table are not blankable.

### G. Notes and content errors the game reproduces verbatim (not fixable in the mechanic; content was not edited)
1. **CR-20, `cr20.l.table.1`, IRS row** (`notes/FRM_Consolidated_Vol1/ch/17_CR_CR20.tex:420`).
   - The notes say: "You receive fixed and pay floating. If rates rise (good for you), their creditworthiness might also decline".
   - A fixed receiver loses when rates rise, so the direction is wrong. The fix is either "…If rates fall (good for you)…" or "pay fixed".
   - This cell is a tile, so the game teaches the error.
2. **MR-4, `mr4.d.table.1` caption** (`35_MR_MR4.tex:160`).
   - The caption says: "The two diagonal cells are the two ways of being wrong."
   - Type II sits at Accept/Incorrect and Type I at Reject/Correct, which is the off-diagonal. The caption is shown as feedback.
3. **IM-10, "Inter-\\ connected"** (`28_IM_IM10.tex:125` and `:151`).
   - A `\\` inside the label ends the tabular row, so the label is split across two rows: an "Inter-" row and a "connected" row.
   - The tile reads "connected". This affects `im10.c.table.1` and `im10.d.table.1`.
4. **The extractor flattens `\newline` inside cells to a space**, which fuses a label with its gloss. The tiles read oddly but stay correct. Examples:
   - "“Hot money” liabilities deposits and other borrowed funds" (`ltr5.c.table.1`);
   - "Sovereign default spread the yield difference…" and "CDS spreads similar to buying insurance…" (`cr8.g.table.1`);
   - "Treasury unit first line of defence" (`ltr9.c.table.3`);
   - "First-loss piece Equity piece" (`cr23.b.table.1`);
   - "Decrease Increase" (`ltr17.c.table.1`).
5. **CR-19, `cr19.f.table.1`.**
   - The row "ρ̄ = −1 | Maximum netting benefit | 0%" is followed in the notes (line 316) by the correction "holds only for two exposures".
   - The game plays the row without that correction, and the table has no caption to carry it.
6. **ORR-4, `orr4.c.table.1`.**
   - KCI "Focus = Control effectiveness" repeats its own "What it measures" cell, which gives the blank away.
   - It also doesn't fit the caption "three indicators, three time horizons".
7. **Game-blocks `mechanics_supported` claims Table Fill for MR-5, MR-7, MR-8, MR-11, MR-14, MR-17, CR-16, ORR-2 and CI-1.** The plugin does not support these. This is a metadata mismatch.

### Minor, left as is
- **IM-1 pressure:** rows are anchored only by "Lesson 1/3/4". The notes number the lessons, and the caption refers to them by number, so this was kept.
- **LTR-4:** tiles keep the notes' ★ ratings. This is cosmetic.

## Counts (before the fix)
| Kind | Tables | Tiles / rows |
|---|---|---|
| A. Worked-figure tiles and rows named only by figures | 7 | 24 tiles, 18 rows |
| B. Unpaired side-by-side lists | 5 | 4 fixed, 1 left (`cr9.a`) |
| C. Group title used as the header row | 1 | 5 rows |
| D. Stripped "a)" on inline lists | 1 | 2 cells |
| E. Dash-only anchor | 3 | 5 rows |
| F. Constant-column blanks | 2 | 5 rows |
| G. Notes or content errors reproduced | 6 blocks + metadata | wrong fact: 1 (CR-20 IRS); wrong caption: 1 (MR-4) |

In total, 19 tables were affected by mechanic causes, and 18 of them are fixed.

## Fix summary (`web/src/games/mechanics/table-fill/build.ts` only)
- `isPreciseFigure` (new, exported) is used in `isBlankable`.
- `substantive` is used for anchors (`keepsAnchor`, `nonEmptyCount`).
- `stripEnumerator` keeps the marker on inline lists.
- In `eligibleTables`, these are skipped or blocked:
  - uneven side-by-side lists (`unevenLists`);
  - an enumerated group-title header;
  - worked-exhibit tables;
  - labels of rows known only by computed figures;
  - constant columns.

## Effect
- **Supported readings:** 59 of 107, down from 64. MR-5, MR-11, MR-14, LTR-6, CI-1 and IM-3 dropped, because their only playable rows came from the tables fixed above. MR-9 and MR-16 still play.
- **Harness:** `table-fill.cjs` gives ALL OK over 1,770 plans. New assertions were added for each fix.
- **tsc:** `tscheck/tsconfig.json` reports 0 errors.
- **Audit after the fix** (seeds 1–8): 0 precise-figure tiles, 0 tiles starting mid-list, 0 dash-only anchors, and 0 true constant-column blanks. The 3 remaining flags are pressure sheets where the visible rows happen to share a value. The fragment tiles left are IM-10 "connected", which is content item G3.
