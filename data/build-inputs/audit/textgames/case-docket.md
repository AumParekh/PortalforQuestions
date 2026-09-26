# Case Docket: fact-check of generated rounds

Mechanic: `web/src/games/mechanics/case-docket/` (build.ts, cases.ts). Data: `content/games/game-blocks.json`.
Harness: `gamestest/case-docket.cjs` (with regression checks added), plus the dump scripts `gamestest/cdx-dump.cjs`, `cdx-combos.cjs`, `cdx-overlap.cjs` and `cdx-concept.cjs`.

## What was checked

- **Supported readings.** 9 readings are supported: CR-14, ORR-13, ORR-14, ORR-16, LTR-1, LTR-8, LTR-13, IM-9 and CI-4. They are the only readings that name two cases with enough facts. No MR reading qualifies. MR still appears as a source of chips: MR-4 (the JPMorgan VaR exceptions) and MR-8 (AIG).
- **Seeded dump** (`cd-rounds.txt`, `cd-rounds-after.txt`): 8 seeds per reading, giving 72 plans and 608 rounds. That is 83–87 unique chips, drawn from 16 readings across all six areas: CI 40, CR 87, IM 76, LTR 222, MR 14, ORR 169.
- **Every fact in the case index** (106 before the fix, 105 after; `cd-index.txt`) was read against its source block or trap in the notes. For each one I checked:
  - that the text is faithful;
  - that the right case owns it;
  - that the name is redacted.
- **Every docket distractor** was judged against the notes' facts for the case on trial: is the "not this case" line also true of that case? There were 191 unique (case on trial ← chip) combinations across 1,350 plans (150 seeds × 9 readings, with random SRS state and priority categories).
- **Every compare chip**: does it fit both files on the bench? There were 97 unique (pair → chip) combinations.
- **Every naming (concept) line**: 27 unique combinations, checked against the trap or box text in the notes.
- **Feedback text** in CaseDocketBoard.tsx is "From the X file", the fact as the notes state it, and the block id. The naming line is the notes' own trap or box text. None of it adds any claim of its own.

## Problems found

| Kind | Count | Status |
|---|---|---|
| "Correct" answer wrong per notes | 0 | – |
| Docket distractor also true, or not rulable-out, for the case on trial | 8 chips | fixed (systematic) |
| Prompt not self-contained or misleading as shown | 2 (+2 side-fixed) | fixed |
| Compare chip that fits both files | 1 | left (content) |
| Faithful to notes but doubtful against the source reading | 1 | flagged (content) |
| Dangling anaphora, minor | 1 | left |
| Feedback states something wrong | 0 | – |

### 1. Docket distractors that fit the case on trial (8 chips, one root cause) — FIXED

| Case on trial ← lifted chip (owner) | Why it is ambiguous per the notes |
|---|---|
| Bear Stearns ← "Why the cash ran out: When lenders became wary after the 2007 crisis, it could not access cash and faced a bank run." (Northern Rock) | LTR-13: Bear "suffered a run resulting from an unwarranted loss of confidence by … lenders"; repo lenders refused to roll over. |
| Bear Stearns ← "What they did: Relied on short-term funding for long-term loans (mortgages)." (Northern Rock) | LTR-8: "Bear Stearns and Lehman Brothers relied heavily on overnight repos …" |
| Capital One ← "Unpatched vulnerabilities. An internal audit revealed a backlog of unpatched vulnerabilities, including the exploited one." (Equifax) | ORR-13: "Both Capital One and AWS were aware of the firewall vulnerability", which an attacker then exploited. |
| Capital One ← "Attackers stole information on 147 million customers: …" (Equifax) | ORR-13: "Data breach of millions of customers' information". Nothing in the notes rules this out. |
| Capital One ← "The breach remained undetected for three months." (Equifax) | Unanchored; the notes say nothing about Capital One's detection time. |
| Capital One ← "Weak monitoring. Expired SSL certificates hindered proper traffic monitoring." (Equifax) | Unanchored generic breach failure. |
| Capital One ← "Ineffective communication. Communication about vulnerabilities didn't reach relevant employees." (Equifax) | Unanchored generic breach failure. |
| Capital One ← "The bank inadequately monitored suspicious activities and failed to report them to regulators." (USAA) | "The bank" with no anchor. |

**Root cause.** `distractors()` in build.ts has three tiers. The same-area tier and the anywhere tier dealt *any* fact of a case the reading never names. That included table cells and case-study bullets that name no case. Such a line is tied to its case only by where it sits (a row or a section). Read alone as a chip, a generic line about a similar incident (a bank run, a data breach) can describe the case on trial just as well. The notes never set the two cases against each other, so the docket's "not this case" can't be backed up.

**Fix (build.ts).** Tiers 2 and 3 now take only chips that name their own case. In code: `f.masked.includes(MASK)`, meaning the case name is present and redacted. The rival's own facts and the other cases named in the reading are unchanged, because those lines appear in the notes' own comparison tables and boxes.

Side effect: unrelated-case chips that hang on context also stop being lifted as distractors. Examples are Barclays' "converted this spreadsheet …" and Bear's "it suffered a run …".

After the fix, all 8 are gone. Anchored chips remain, for example:
- "▬▬, a major credit bureau, suffered a huge data breach in 2017."
- "▬▬ used securitisation to back its growing share of the UK residential mortgage market …"

All readings still build under every seed and SRS state tested. More than 100 unrelated-case distractors are still dealt in 60 seeds.

### 2. Prompts not self-contained — FIXED

- **Berkshire dangling reference.** The chip read "In addition to this benchmark, ▬▬ is generating +0.65% alpha per month." (IM-3, `im3.e.defbox.1`). It was dealt as a distractor in the CI-4 docket (19 of 150 plans), and "this benchmark" points at a mimicking portfolio the player never sees.
  - **Root cause (cases.ts):** a section named as a worked case was already denied context ownership ("A worked example set on a real firm is arithmetic, not the firm's story"). Sentence-level naming still filed its lines anyway.
  - **Fix:** blocks in a `worked (case|example)` section are no longer filed as facts (shared `WORKED` constant). The only section affected in the corpus is IM-3's Berkshire worked case, and Berkshire had no other facts.
- **Mars Orbiter double redaction.** The chip read "In this case, the engineering team at ▬▬ used English units …, while ▬▬'s convention was to use the metric system." Before reveal it looks self-contradictory, because two different parties (Lockheed Martin and NASA) got the same redaction. It appeared in the ORR-16 compare (150 of 150 plans) and as a distractor.
  - **Root cause:** the registry listed 'Lockheed Martin' as an alias of the mars-orbiter case.
  - **Fix (cases.ts registry):** 'Lockheed Martin' removed. Now only NASA is redacted: "… the engineering team at Lockheed Martin used English units …, while ▬▬'s convention …".

### 3. Compare chip that fits both files — LEFT (content)

- **ORR-13, Capital One vs Morgan Stanley:** "Failures: Lacked proper vetting and monitoring of the third-party vendors involved." (Morgan Stanley, 24 of 150 plans).
  - The same notes table says Capital One "was fined \$80 million for inadequate vendor risk management" and "failed to properly assess and manage risks associated with using AWS".
  - cases.ts already flags this exact overlap for the lessons box. Here it sits in the table cell itself, which names no anchor such as decommissioning.
  - A mechanical filter can't tell it apart from well-anchored rival chips such as "Oil price fell.". Suggested content fix: "… of the third-party vendors involved in decommissioning".

### 4. Faithful to the notes, but worth checking against the source reading — FLAGGED

- **CR-14:** "Calls for central clearing emerged globally after Bear Stearns." (`notes/FRM_Consolidated_Vol1/ch/51_CR_CR14.tex:240`). It is dealt in the Bear vs Lehman compare in 116 of 150 plans.
  - The usual account ties the push that led to the G20 Pittsburgh 2009 mandate to Lehman and AIG, so a well-read player may route it to Lehman.
  - The game is faithful to the notes. The notes line should be checked against the GARP reading.

### 5. Minor, left as is

- **Amaranth:** "▬▬ (2006) raised the same concerns, but the Bank of England concluded …" (IM-9). "The same concerns" refers to the LTCM line before it. The chip is still true and can be routed by the date and the Bank of England verdict.
- **Borderline distractor still dealt:** "Patch management policy failure. ▬▬ failed to enforce its policies for timely security patches." (Equifax) against Capital One. The notes describe Capital One's failure as a known firewall vulnerability and poor AWS risk assessment, not patching. It is anchored by the redacted name, so I left it.
- **Chips faithful but thin:** "Gold price rose.", "Oil price fell.", "Fine: \$920 million.". Correct per the notes.

## Changes

- `web/src/games/mechanics/case-docket/build.ts`: in `distractors()`, the same-area and anywhere tiers take only self-named chips (`selfNamed`).
- `web/src/games/mechanics/case-docket/cases.ts`:
  - The `WORKED` section regex is shared.
  - Blocks in worked-case or worked-example sections are not filed.
  - The mars-orbiter aliases drop 'Lockheed Martin'.
- Harness `gamestest/case-docket.cjs`: regression checks added.
  - A distractor from a case the reading doesn't name must name its case.
  - There are no Berkshire worked-case facts.
  - Lockheed Martin is shown and NASA is redacted.

**Verification.**
- Harness: ALL OK. There are 22 cases with facts and 105 facts; the supported set is unchanged.
- `tsc -p scratchpad/tscheck/tsconfig.json`: 0 errors.
- Originals backed up as `textgames/case-docket-build.orig.ts` and `textgames/case-docket-cases.orig.ts`.
