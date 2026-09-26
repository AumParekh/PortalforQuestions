# Blurt Board: fact-check of real rounds

Game: `web/src/games/mechanics/blurt-board/` (build.ts builds the rounds, match.ts is the free-recall matcher, BlurtBoard.tsx renders the board).
Data: `content/games/game-blocks.json` (107 readings).

**How a round works.** The player sees the objective statement and a blank board. They write whatever they remember. When they press Check, each target tile lights up if the board mentions it, or fades in unlit if it does not. There are no distractors. The "correct answer" is the target tile itself: a term, a bullet point, a number with the sentence around it, or a variable with its definition. The feedback is made of three things: whether the tile lit up, the "closest line" or "turns the direction around" note, and the naming line after the discovery board ("A marked term under X in 'title': sentence").

For each round I checked:
- whether the tile states something true and self-contained per the notes;
- whether it belongs to the objective;
- whether it duplicates another tile on the same board;
- whether a wrong line would light it up, or a right line would light up a different tile;
- whether the naming line says anything wrong or irrelevant.

## What was checked

- **Before the fixes: 814 rounds, read in full.** Seed 1, all 99 supported readings, all six areas (MR, CR, ORR, LTR, IM, CI). Dump: `blurt-all-s1.txt`.
- **Across the corpus: every candidate item.** All 4,282 items in all objectives were run through filter probes: every number item, and every item from a trap box.
- **After the fixes: 352 rounds re-read.**
  - Seed 1: IM-13 to CI-8 (105 rounds), plus MR-4, MR-12, MR-13, CR-1, CR-12, LTR-14 and MR-18 (53 rounds).
  - Seed 2: 23 readings across all areas (194 rounds): MR-2/5/10/17, CR-3/9/15/22, ORR-2/6/19/21, LTR-2/4/7/16, IM-3/7/10/16, CI-2/6/8.
  - Dumps: `blurt-after-s1.txt`, `blurt-after-s23.txt` (seeds 2 and 3, 1,583 rounds), `blurt-sample-s2.txt`.
- **Automated checks.** The harness `gamestest/blurt-board.cjs` has new regression checks. It builds plans for seeds 1 to 4 on every supported reading and checks that no two targets on a board overlap.
- **Before/after comparison.** I compiled the HEAD version (`gamestest/out-blurt-head`, `blurt-board-head.cjs`) so the same checks can run against both versions. Every item the fixes removed is listed in `blurt-dropped.txt`.

## Problems found (before the fixes), by kind

| # | Kind | Size | Examples (round, and what the player saw) |
|---|------|------|--------------------------|
| 1 | **Duplicate targets on one board.** Two tiles say the same thing, so one line scores both. | 55 overlapping pairs on 47 boards (seeds 1 to 4) | CR-10 b: term "Rating transitions" plus the point "Rating transitions. Transition matrices show…". MR-7 c: number "10%" plus the point with the same sentence. MR-12 g: "recombining", "non-recombining" and "Recombining and non-recombining". CR-12 a, CR-20 o, CR-23 f, ORR-7 c, ORR-12 a, ORR-20 a, IM-2 b, MR-1 f, MR-17 i. |
| 2 | **Worked-example numbers shown as "a number the notes pin down".** They are one example's inputs or results, not facts. One context was cut off mid-sentence. | 22 number items (7 in the seed-1 rounds) | MR-13 d "8.2%" and "8%" (keybox "Read the result"). MR-9 c "77.51%" and "22.49%", "78%" ("implies"). MR-11 d "$82.55 million" ("we should buy"). MR-12 b "2.50%", "$990". MR-1 b "I am 99 percent confident … $5,000" (×6). CR-7 f and CR-15 d (hypotheticals). CR-22 f "With 100 loans at $1 million paying 8.5%, excess spread turns negative once fewer than" (truncated). |
| 3 | **Trap boxes about one worked calculation shown as "a point the notes make".** These bullets carry that example's deliberately wrong answers and step numbers, e.g. "Using 365 gives $11,002,802.74" or "0.40 × 0.60 × 0.0018 = 4.32 bp — the exact complement". On a lit tile they read as facts. | 9 trap boxes, 27 bullets and 1 term; 11 seed-1 rounds | LTR-12 d (×3), LTR-13 a (×3), LTR-13 g (×2), LTR-14 d (×3); also LTR-2 f, LTR-7 d, LTR-12 b, LTR-17 c. MR-18 a term "VaR reports $0 while the portfolio can lose $380 million" (trap box "A precision point on this example"). |
| 4 | **Box headings extracted as "a term".** Nothing to recall; also ambiguous. | 26 title-terms and 5 bold questions | CR-1 b "The three states", CR-17 c "The two quantities", CR-21 d "The distinction the objective turns on", LTR-9 a "The structure of the taxonomy", IM-5 e "The difference in one line", MR-10 a "What a copula is", LTR-17 c "Duration, in this reading's terms", CI-5 c "Why cutting fiscal spending is difficult", CR-8 e "What the ratings measure". |
| 5 | **Marked phrases shown bare on the tile.** The phrase states nothing on its own and can read as a wrong claim out of context. The slot label also called them "a term". | 662 of 1,801 term items start mid-sentence; seen in about 60 seed-1 rounds | MR-2 c "far away from 1", MR-12 j "not suitable", IM-3 d "and to play well", MR-18 a "nearly identical", CR-18 b "extinguished", MR-17 h "remains the same", CI-5 b "smaller", IM-12 c "has the fund ever been shut down". |
| 6 | **Matcher gave false hits across "non-".** Writing the opposite case lit up the tile. | Systematic | CR-12 a: "positive to the non-defaulting party" lit up the separate tile "positive to the defaulting party" (whose scenario is the opposite). MR-12 g: "non-recombining" lit up "recombining". |
| 7 | **Long terms had no direction check.** A flipped line could light them. | Systematic | "Higher credit quality members may have higher WWR" (CR-20 o) was not checked for flips. Points were checked; terms never were. |
| 8 | **The naming line quoted a sentence that uses the term instead of the one that defines it.** | Systematic | CR-1 b "Bankruptcy" → "While insolvency and bankruptcy are related, insolvent entities are not necessarily bankrupt." The notes' definition is "Bankruptcy is a legal procedure…". LTR-14 d "likelihood of drawdown": the line dumped a whole formula box with `\begin{aligned}` as plain text. |
| 9 | **Worked-arithmetic prose shown as points or terms.** | 2 points and 3 terms | MR-12 b "the option is worth $992.556 - 990 = \mathbf{\$2.556}$" (raw TeX on screen). MR-12 b terms "buying", "shorting" and "worthless" (the sentence is the example's replication, "$521.4375 face"). |
| 10 | **A bare lead-in to a sub-list shown as a point.** | 5 | CI-8 c "European Union (EU):"; MR-15 c "Volatility term structure:"; MR-6 c "Non-parametric approaches:". |
| 11 | **The same symbol keyed twice on one board.** | 3 | MR-4 c: "T — number of samples (observations in the backtest window)" and "T — number of observations". |
| 12 | **Number tiles showed the list bullet ("• This means …").** | 33 items | MR-7 c, MR-9 a, ORR-21 c. |

No tile misquoted the notes. Every tile is verbatim notes text, so every "correct answer" was true per the notes. The problems were about what gets shown as recall material: examples, headings, trap-calculation text, bare fragments and duplicates. The other problems were matcher false hits and naming-line choices.

## Root causes and fixes (all in `web/src/games/mechanics/blurt-board/`)

**`build.ts`**
- **#1 Duplicate targets.** `pickTargets` used to top up an undersized board with overlapping items. It no longer does. `eligibleObjectives` now needs 3 items that don't repeat each other (new `distinctItems`), with a fallback to reading order if the shuffled order strands the board. `flat()` is now cached.
- **#2 Worked-example numbers.**
  - `EXERCISE_CUE` gained: construct, "if on/the", "I am", "we should", "for every", "implies", "means a".
  - New `RESULT_TITLE`: drop numbers in "Read the result" / example boxes.
  - `exampleValues`: a value used in an illustration is dropped wherever the same block repeats it.
  - Contexts that don't end in sentence punctuation are dropped.
- **#3 Worked-calculation trap boxes.** New `WORKED_TRAP_TITLE` skips trap boxes about one worked calculation ("this example/calculation", "corrupted", "ways to get it wrong", "failure modes", "chain"). It matches exactly the 9 worked-calculation trap boxes.
- **#4 Heading terms.** New `isHeadingTerm` drops a box title that was extracted as a term when all of these hold:
  - the body never uses it;
  - it is heading-shaped ("The two/three…", "What/How/Why…", has a comma, "in one line") or it only combines the box's other terms.

  Bold questions ("What…", "How…", "Why…") are dropped too. Real title-terms are kept: "Failure rate", "Co-investing", "Heterogeneous", "Volatility smile".
- **#5 Bare phrases (build side).** Every term now carries `context`: the notes' sentence or bullet that carries it, preferring the one that opens with the term. A defining box whose title is the term falls back to the box's first sentence. Sentences that need KaTeX are skipped.
- **#7 Direction check.** Terms with 3 or more keywords now get flip detection like points. Shorter terms already have to contain their direction word to hit.
- **#8 Naming line.** `termSentence` now prefers the sentence that defines the term. `namingFor` uses the same context and never puts a KaTeX sentence into the plain-text line.
- **#9 Worked arithmetic.** New `isWorking` drops points whose text is worked arithmetic ("a − b = c", or a computed figure with 5 or more significant digits after a decimal point). It also drops terms whose sentence is worked arithmetic.
- **#10 Lead-in bullets.** A bullet that is only a short lead-in ending in ":" is dropped. Bullets with content before the colon are kept (CR-6 c, ORR-10 b).
- **#11 Same symbol twice.** A variable is dropped when the same symbol is already on the board and its definition adds nothing new.
- **#12 Bullet mark.** The leading "•" is stripped from number displays.

**`match.ts`**
- **#5 Bare phrases (type).** `BlurtTarget.context` added.
- **#6 "non-" false hits.**
  - A keyword written straight after "non" (e.g. "non-defaulting") no longer counts toward an item that doesn't itself say "non". This applies to stem matching and to exact phrases.
  - If the player writes both forms ("recombining and non-recombining"), both still light up.

**`BlurtBoard.tsx`**
- **#5 Bare phrases (display).** A term tile shows its notes sentence under the term.
- The empty slot now reads "a marked term or phrase" instead of "a term".

## Checks

- **Harness.** `gamestest/blurt-board.cjs` has new regression checks: "non-" matching, `isWorking` true and false cases, 19 items that must now be filtered out, 7 items that must be kept, defining-sentence context, plain-text contexts, no bullet marks, and no overlapping targets for seeds 1 to 4. The existing self-recall, off-topic, SRS and timing checks all pass.
  - The HEAD build fails these checks: 55 overlapping pairs, 19 items not filtered out, the 2 "non-" cases, 33 bullet marks and 2 context checks.
  - Cross-objective false-hit rate is unchanged (27/403 before, 28/382 after).
- **Types.** `tscheck` `tsc -p tsconfig.json` reports 0 errors.
- **Coverage.**
  - Items: 4,282 → 4,191. Dropped: 29 points, 22 numbers, 37 terms, 3 variables.
  - Supported readings: 99 → 95. ORR-12, ORR-20, LTR-12 and LTR-13 lost their second board, which had consisted only of duplicates (ORR-12 a, ORR-20 a) or worked-calculation trap text (LTR-12 d, LTR-13 a).

## Left open (not in my files)

1. **Shared `text.ts` superscript bug.** In `mathToPlain`, `\^\{?([0-9n+-]{1,3})\}?` takes up to 3 characters after an *unbraced* `^`. So `$(n^2-n)/2$` renders as "(n²⁻ⁿ)/2", which reads as n^(2−n). It is visible on the MR-8 d variable tile "(n²⁻ⁿ)/2 — the number of distinct pairs, which is why the factor is 2/(n²⁻ⁿ)", and there are 8 occurrences in the JSON. The fix is to take one character when there is no brace. This affects every game.
2. **Content: MR-12 b bullet.** It has `\$` inside math (`$\$992.556 - 990 = \mathbf{\$2.556}$`), which renders as raw TeX. It is now filtered out of this game but may show elsewhere.
3. **Naming line is plain text.** `SessionShell.tsx` shows `naming.line` as plain text, so a point or variable whose notes text has `$…$` math (e.g. "Adjust $LR_{independence}$…") shows raw TeX in the naming line. This was already the case before my changes. Rendering the line with `NoteText` would fix it (shared file).
4. **Content: CI-3 a numeric-item labels.** The labels "$0.2" and "$2.5" drop the "T" (trillion) scale. The context sentence shows it.
5. **Kept on purpose.**
   - Trap-box bullets that state a true fact followed by an exam-strategy tail ("A distractor claiming municipals are fully tax-exempt is the obvious build").
   - Prose bullets split from a sentence that start with a pronoun ("It approves high-risk loans…").

   Both are true per the notes and readable under their objective.

---

# Round 2: fresh seeds after the traps merge (seeds 5, 9 and 13)

## What was checked

- **792 rounds read, covering all 95 supported readings in all six areas.** Each reading was played with one new seed:
  - seed 5: 35 readings, 292 rounds (MR-3/6/8/11/14/16, CR-2/5/8/11/14/17/19/21, ORR-1/5/9/13/15/18/22/24, LTR-1/3/5/9/17, IM-1/5/9/12/15, CI-1/4/7);
  - seed 9: 26 readings, 218 rounds (MR-1/4/7/9/13/15, CR-4/6/13/16/20/23, ORR-4/8/11/17/23, LTR-2/7/14, IM-4/8/11/17, CI-3/5);
  - seed 13: 34 readings, 282 rounds (all the remaining readings).
- **When each seed was read.**
  - Seeds 5 and 9 were read in full before any fix. Dumps: `blurt-r2-s5.txt`, `blurt-r2-s9.txt`.
  - Seed 13 was read in full after the first fixes. Dump: `blurt-r2-s13-after.txt`.
  - All three seeds were dumped again after the final fixes, and every changed tile was re-read: `blurt-r2-s{5,9,13}-after.txt`.
- **The whole corpus was probed for each kind of problem found.** This covers all 4,191 items, including every term context (1,799) and every point that now has a lead-in (379). Probe output: `blurt-r2-probe3/4/5.txt`.
- **Item-by-item diff against the pre-round-2 build.** The baseline is commit c002ffc, compiled to `gamestest/out-blurt-head`; the diff script is `gamestest/blurt-diff2.cjs`. Every dropped item, changed tile and changed context was reviewed: `blurt-r2-diff.txt`, `blurt-r2-termctx-changes.txt`.

No tile misquoted the notes. Two kinds of problem did put something untrue in front of the player: #1 and #8 below. The rest were about tiles that were ambiguous, missing context, or not recall material.

## Problems found, by kind

| # | Kind | Size (corpus) | Examples |
|---|------|---------------|----------|
| 1 | **Variable tile stated a false identity.** One notation-key definition that covers several symbols (`shared_definition`) was shown under the first symbol only. | 22 tiles | MR-16 a (s5): "$\sigma_m$ — volatilities of the medium- and long-term factors". Also "$r_t$ — the short-, medium- and long-term factors" (MR-16 a), "$c$ — call and put prices" (MR-17 b), "μ — mean and standard deviation of the distribution" (MR-1 c) and "$DV01^N$ — the DV01s of the nominal and real bonds" (MR-11 b). |
| 2 | **A worked-example answer marked as a term.** | 2 | MR-11 d (s5): the term "$82.55 million", with context "for every $100 million sold in T-bonds, we should buy $82.55 million in TIPS". Also IM-16 e: "99th-percentile, five-day scenario" ("for example"). |
| 3 | **Worked arithmetic slipped past `isWorking`.** The notes write "\%", which blocked the check, and so did a closing ")" before the operator. | 2 | MR-14 f: the point "Take an average of the two middle nodes: (6.258% + 6.260%) / 2 = 6.259%", and the term "average". |
| 4 | **List fragments shown without the sentence they complete.** In the worst case this misleads. | 68 lowercase fragments, plus sub-bullets under a lead-in | CR-11 g (s5): "defining the copula function;". CR-19 c (s5): "options and exercise decisions; and". MR-6 b (s5): "the change in the position's share of the portfolio;". IM-5 d: "lowering the position with the highest marginal VaR". ORR-10 b: "Large balances and frequent cross-border transfers" sits under "Enhanced due diligence for high-risk customers:", but the parent's first sentence is about *simplified* procedures for *low-risk* customers. |
| 5 | **List joining punctuation left on tiles and naming lines** ("…; and", "…,", "…;"). | 57 point tiles, 14 term contexts | CR-19 c, CR-7 g ("Managing accounts, including pricing and credit line management; and"), CI-2 a ("portfolio management, trading, and"). |
| 6 | **A heading over its own sub-list shown as a point.** It says nothing on its own. | 9 | CI-7 b (s5): "Asset servicing and redemption." Also ORR-10 a "Banks need policies for", ORR-9 a "Technical controls: address technical aspects of risk through" (cut off), ORR-22 b "Specific Risk Charge (SRC).", LTR-6 a "The impact of market forces." |
| 7 | **Terms with no explanation on the tile.** Round 1's fix could not find the sentence for these. | 80 terms | MR-17 h (s13): "The second effect dominates the first" (sentence-terms). CR-17 c (s5): "Credit support amount" and "Credit support balance" (label, then definition). IM-11 c: "Did the manager beat the market", with the answer (PME) missing. CR-21 d (s5) "Stressed expected loss" and MR-14 d "calibrated" (the sentence has inline math). ORR-7 a (s13): "Risk governance", a label whose definition is the block text. IM-4 b: "Scale the alphas" (a list item). CR-12 b: "credit-adjusted value", whose sentence runs into a display formula. |
| 8 | **Term context matched by substring.** The context could quote the misstatement that the notes flag as wrong. | 9 changed | IM-3 h: "Sharpe ratio" got "The source notes say that 'as standard deviation increased, both average returns and Sharpe ratios decreased.' The data do not say that." The notes' actual fact is "The quantity that declines monotonically is the Sharpe ratio". IM-1 b ("frictionless" misquote). LTR-1 a: "liquid" matched "liquidated". |
| 9 | **Raw TeX in the naming step** (SessionShell shows it as plain text). | 15 items could produce it | MR-13 a (s9): the naming title "$\hat{r}(2)$ — the implied 2-year spot rate". CR-20 c (s9): "$\mathrm{EPE}(t_i)$ — …". MR-11 f and MR-14 d points. |
| 10 | Minor | 3 | Term "1. Unconditional coverage" (the list number was part of the term), IM-1 c "$\bar{\gamma}$ — … —" (trailing dash), MR-2 c point "To see the principles involved, suppose for the sake of argument that …" (an argument's set-up). |

## Root causes and fixes (all in `web/src/games/mechanics/blurt-board/`)

**`build.ts`**
- **#1 `variableTargets`.** Symbols that share one definition (`shared_definition`) now become one tile that names all of them, e.g. "$c$, $p$ — call and put prices". The tile keeps the first symbol's ID. A trailing dash on a definition is stripped.
- **#2 `termTargets`.** A term that is a number is dropped when its sentence carries an exercise cue (`EXERCISE_CUE`). A leading list number ("1. ") is stripped from terms.
- **#3 `isWorking`.** It now removes the escape before `%` and `$`, and allows `%)` around the operator.
- **#4 `bulletTargets`: lead-ins on points (new `context`).**
  - A sub-bullet shows its parent's lead-in (`parentLead`). If the parent ends in a colon, that is the parent's last sentence, after a short label: "Profit scoring. Two types:", "Enhanced due diligence for high-risk customers:". Otherwise it is the parent's lead.
  - A top-level bullet shows the sentence that opens its list (`listIntro`), when that sentence ends in ":". The bullet is located by \item order and the lookup walks nested lists.
  - 379 points now carry a lead-in.
- **#5 Joining punctuation.** It is stripped from point displays and term contexts.
- **#6 Headings over sub-lists.** A bullet directly followed by deeper bullets is dropped when it is 6 words or fewer, or has no end punctuation. Its sub-bullets now show it as their lead-in.
- **#7 and #8 `termSentence`, rewritten.**
  - It returns the LaTeX sentence, so math and escaped `$` render correctly.
  - The term is matched as a whole phrase.
  - A sentence that opens with the term is preferred, including "A/An …" and plural openings ("Synthetic CDOs use …").
  - "Longer" means at least one real word more than the term, so "2) Internal model-based approach." or "A payer … swap …" alone do not count.
  - A term that is a whole list item gets its first sub-item, or else its list intro ("The three methods are:").
  - A term that is its own sentence gets the next sentence, or else the previous one, from the same item or paragraph. That sentence must have 5 or more words, so a sibling heading is never used ("Collateral pledging. Asset purchases and funding.").
  - A label whose definition is the block's text, or a titled definition box, gets the opening sentence, unless that sentence sets up an example ("Assume a risk manager calculates …").
  - A sentence that runs into a display formula and has no end punctuation is discarded.
  - Terms without a context: 80 → 9 (all 9 are genuinely bare headings, e.g. "Collateral pledging", "LCR", "U.S. Treasuries").
- **#9 `namingFor`, `plainName`, `buildBlurt` and `nameAfterDiscovery`.**
  - The naming line is built only from plain text. A context or statement that needs KaTeX is left out of the line.
  - A variable whose symbol needs KaTeX is named by its definition ("the implied 2-year spot rate").
  - The plan's concept and the discovery naming prefer an item whose name is plain text.
- **#10.** A bullet containing "suppose" or "for the sake of argument" is dropped.

**`BlurtBoard.tsx`**
- Term contexts are now rendered through `NoteText`, because they are LaTeX.
- Points with a lead-in show it, small and muted, above the point.

**`match.ts`**
- Only the doc comment on `BlurtTarget.context` changed. Matching is unchanged.

## Checks

- **Harness.** `gamestest/blurt-board.cjs` has new round-2 regression checks:
  - grouped variables;
  - the 9 filtered items;
  - point lead-ins, including the ORR-10 b sub-list;
  - sentence-terms, label terms and question terms;
  - whole-word context (IM-3 h);
  - no borrowing from a sibling item;
  - heading terms take their sub-item, and list-item terms take their intro;
  - no list joiners on points;
  - escaped-% working;
  - every context renders (no display math);
  - every naming line is plain text, and every plan's concept for seeds 1 to 4 is plain text.

  All checks pass, including round 1's checks. The cross-objective false-hit rate is unchanged at 28/382.
- **Types.** `tscheck` `tsc -p tsconfig.json` reports 0 errors.
- **Coverage.**
  - Items: 4,191 → 4,177 (14 dropped: 9 heading bullets, 2 example terms, 2 worked-arithmetic items, 1 argument set-up).
  - Supported readings stay at 95.
  - Term contexts: 1,721 → 1,789. Point lead-ins: 0 → 379.
- **Scratch files.** A copy of the pre-round-2 sources is in `scratchpad/bb-head` (c002ffc).

## Left open

1. **Shared `text.ts` superscript bug (from round 1, still present).** `$(n^2-n)/2$` renders as "(n²⁻ⁿ)/2". It was seen again on MR-8 d (seed 5).
2. **Content: IM-2 c bullet "In option markets, but traders can also use …".** The sentence is broken in the notes. It now shows under its lead-in "There are many ways to buy volatility protection:", which makes it readable.
3. **Content: CI-3 a numeric labels "$0.2" and "$2.5".** The "T" is missing (from round 1).
4. **Borderline items, kept.**
   - IM-3 e number "0.65%" (Buffett's alpha per month): a case-study figure, not an exercise cue.
   - ORR-9 a term "Technical controls": its context "Technical controls: address technical aspects of risk through" is the notes' own lead-in, which is cut off.
   - Nine heading terms have no context.
5. **Naming line and KaTeX.** The naming line still leaves out any statement that needs KaTeX, because `SessionShell` shows it as plain text. Rendering it with `NoteText` is a shared-file change.
