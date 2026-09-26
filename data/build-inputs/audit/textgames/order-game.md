# Order Game — fact-check against the notes

Mechanic: `web/src/games/mechanics/order-game/build.ts` (only file changed).
Harness: `gamestest/order-game.cjs` (fact-check assertions added at the end), dumps: `gamestest/og-fc-rounds.cjs`, `og-fc-seqs.cjs`, `og-fc-src.cjs`.

## What was checked

- **Before fixes:** 92 rounds (63 plan rounds: CR-22, LTR-1, CI-5 × seeds 1–3; 29 single-sequence rounds for every other reading), 30 readings, all areas MR/CR/ORR/LTR/IM/CI. That covers **all 42 sequences** the game could produce. Dumps: `og-r1.txt`, `og-seqs-now.txt`.
- **After fixes:** 98 rounds (75 plan rounds: CR-22, CI-5 × seeds 1–5; 23 single-sequence rounds), 24 readings, all six areas, covering all 34 remaining sequences. Dumps: `og-rounds-after.txt`, `og-seqs-after.txt`.
- For each round I checked the player-visible text against the block's LaTeX, caption, lead-in and the exbox step working (`og-src-now.txt`, `og-exsteps.txt`). That covers the prompt, the context, every card (the steps arrive shuffled, and in restore mode one is displaced), the answer order, the feedback originals and markers, the concept line, the note, the naming line and the opening.
- In this mechanic there are no distractors. The equivalent of "a distractor that is also correct" is **a second arrangement that is also correct**, and I checked for that on every set.

## Problems found (26 across 20 sequences + 1 opening)

| Kind | Count | Rounds / blocks | Root cause | Status |
|---|---|---|---|---|
| **More than one correct order.** Steps are independent, so the notes' order is one of several valid ones, but any other order is graded wrong. The naming line "each step of the calculation needs the result of the one before it" is false here. | 8 | cr4.f.exbox.1 (EL/UL steps can swap), cr13.b.exbox.1 (the three PV legs can swap), ltr1.a.exbox.1 (α and s both come from mid prices), ltr1.a.exbox.2 (moments and λ are independent), ltr4.b.exbox.1 (raw spread and deduction are independent), ltr12.b.exbox.1 (total uses and total sources can swap), ltr12.d.exbox.1 (step 1's 6.5% is not used later), ltr17.c.exbox.1 (asset leg and liability leg can swap) | Every exbox with Step 1…n labels was treated as a forced derivation | **Fixed:** `exboxOrderForced` keeps a worked example only if each step's working uses a value the previous step arrived at (the right-hand sides of "=" with no arithmetic; % also read as a decimal). Kept: mr8.e, cr23.h, ltr13.g, ltr14.d. Side effect: **LTR-1 no longer builds an arc** (both of its sets were ambiguous). |
| **A loop played as an open chain.** It was not anchored, so where the loop starts was ambiguous, and it got the "process" feedback. | 1 | ltr2.g.tikzpicture.1 | The closing arrow `(f.north) -- ($(a.south)$)` uses a calc coordinate that the arrow parser skipped | **Fixed:** the arrow parser accepts `($(node.anchor)$)` ends. The set is now an anchored cycle. |
| **Prompt is about the page, not the content** | 6 | ltr2.g ("…the whole content of this objective"), ci5.a × 4 ("redrawn from the notes' hand-written working"), ci5.c ("The loop on the left…") | The caption's first sentence was always used as the prompt | **Fixed:** `META_CAPTION` makes the prompt fall back to the title, then the section, then the LO (now "Interactions between different types of liquidity risk", "Channels of policy influence", "Countercyclical effects") |
| **Wrong kind, so a wrong naming line** | 3 | mr18.a (Basel I → II.5 → FRTB, which is a chronology, called "each one takes what the one before it produced"); im13.b (the remedy "ladder" of distress stages called a process); ltr14.d.trapbox.2 (ranked siblings called a process) | Chain kind looked only at the caption; stage tables were always 'process'; chains were always 'process' | **Fixed:** the section and "evolved" now count for timeline; stage tables use `kindFromContext(prompt)` (ladder gives hierarchy); a chain labelled "Sibling."/"Ordering." gives ranking |
| **Wrong subject in prompt and concept** | 1 | ltr14.d.trapbox.2: the liquidity-transfer-pricing approaches (zero cost → pooled → separate → matched-maturity; LO c) were shown as "The contingent liquidity risk pricing process" (LO d) | The reading's consolidated trap summary sits under the last LO, so the LO fallback named the wrong topic | **Fixed:** a chain in a trapbox with no title or section takes the notes' own gloss that follows it ("One axis, increasing granularity"), or is skipped |
| **Prompt with no subject** ("The key steps are:") | 5 | mr5.f, mr16.d, cr22.l, orr11.a ("It involves four control steps:"), ltr5.c | The lead-in only makes sense next to its heading | **Fixed:** `genericPrompt` puts the concept in front, e.g. "Implied correlation. The process involves three steps:" or "AML risk management. It involves four control steps:" |
| **Raw table in context** ("tabularl r r & Asset A & …") | 1 | cr4.f.exbox.1 | The question's `tabular` was passed through as context | **Fixed** for future cases (the table is removed from the context; the question sentence stays). cr4.f itself is now filtered out by the first row. |
| **Note run together** ("…fiscal policy High fiscal spending → …") | 1 | ci5.a.prose_para.1 | Joined with a space | **Fixed:** `joinSentences` |
| **Opening promises one-piece-out rounds that never come** | 1 reading (every CI-5 plan) | CI-5 has 9 sets, so every round is an arrange round | Fixed opening text | **Fixed:** the opening text depends on whether the plan has restore rounds |

All other sets matched the notes, with the order correct and unique and the feedback faithful: FHS, EVT, customer relationship cycle, AML, LRM framework, sources and uses, clearing, waterfall, implied correlation, exposure measures, Basel taxonomy levels, reporting-cake tiers, portfolio construction techniques, CI-2 loop, CI-4 transmission, the CI-5 chains, phases and loop, and the four kept worked examples.

## Left as is (minor, or not a build-logic issue)

- **ltr13.g and ltr14.d:** the later steps are successive multiplications or divisions (×1.019 then ÷DV01; ×drawdown then ×cost), so swapping steps 2 and 3 gives the same number. I kept them because the notes' working passes each result on and the labels read as a chain ("apply … to"). This is a judgment call.
- **mr18.a prompt** "Two changes happen at the FRTB step, and they are easy to conflate." is a remark, not a description of what to order. The cards name their regime, so the order is still unambiguous.
- **mr16.d:** steps 3 and 5 say "seen in Step 2" and "from Step 4" in the notes' own words, which partly gives the order away.
- **im13.b labels** read "Underperformance liquidity still adequate": the extractor joined `\newline` without a separator. That is a content/extractor issue.
- **ci5.a.prose_para.1** keeps the fallback prompt "A sequence from the notes", because its section name counts as naming two steps.
- **CR-22:** the 3-step implied-correlation set gets a restore round in discovery two rounds after it was arranged. This is a design issue (easy round), not a factual one.
- **Coverage:** only CR-22 and CI-5 build a full arc (the file claims 32 readings). This was already the case before the fixes, and now LTR-1 has dropped out as well.

## Verification

- `order-game.cjs`: ALL OK (34 sequences, 80 plans; new assertions cover the forced-order check, rejected and kept exboxes, generic and meta prompts, no raw table in context, the LTR-2 loop, the trap-summary chain, and the opening text).
- `tscheck`, `tsc -p tsconfig.json`: 0 errors.
