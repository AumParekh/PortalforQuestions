# Table Fill: fact-check of player-visible content

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
