# Cloze Chain — fact-check of real rounds (2026-09-25)

Mechanic: `web/src/games/mechanics/cloze-chain/` (build.ts = round building; match.ts = typed-answer check;
ClozeBoard.tsx = UI). Data: `content/games/game-blocks.json` (107 readings, 2,808 traps).

## What the player sees (and what was checked)

Each round shows one sentence from the notes with one word/phrase blanked. The player types the answer.
The cues are the answer's first letter, then **three options** (the answer plus two distractors). Feedback
is generic ("Held.", "Held. The notes have “X”.", "Picked from three…", or the struck-through wrong answer
followed by the filled sentence and `block <id>`). After discovery, a naming line says "The thread you
were rebuilding is <LO>: <objective text>. “<answer>” is the word it hangs on here." The only fact-bearing
text is the prompt, the answer, the options and the naming line, so those are what I checked against
the source block text.

## Coverage

| Pass | Seed | Readings | Rounds |
|---|---|---|---|
| A: every area, about 6 readings each (MR, CR, ORR, LTR, IM, CI) | 11 | 36 | 278 |
| B: MR-2,3,5,8,12,16 · CR-3,7,13,17,22 · ORR-3,7,15,19,22 · LTR-2,5,9,12,15 · IM-2,5,8,12,16 | 23 | 26 | 203 |
| C: MR-6,9,13,15,18 · CR-2,4,6,8,12,14,16,18,20,23 · ORR-5,10,21 · LTR-3,6,8,11,14,17 · IM-3,6,9,11,15 | 5 | 29 | 222 |
| **Hand-checked rounds** | | **91 readings** (no overlap between passes) | **703** |

I also listed every playable blank of the rarer kinds and checked each one: all 533 direction blanks,
45 number blanks, 32 contrast blanks and 48 definition blanks. I then ran automated scans over all 1,972
playable blanks, using 3 option seeds each. The scans looked for formatting residue, editorial text, repeated
number values or the same number at another precision, lowercased foils, strengthen/weaken used as a
third option, and paraphrase-overlap distractors.

After the fixes I rebuilt passes A, B and C (289 + 203 + 222 = 714 rounds) and the per-kind lists.
None of the flagged patterns remain. The dumps are in this folder: `cz-before-{a,b,c}.txt`,
`cz-after-{a,b,c}.txt` and `cz-after-kind-{direction,number,contrast,definition}.txt`.

The prompts themselves are faithful. Every prompt is the notes' own sentence, and the harness checks that
the text before and after the blank is a substring of the source block. In none of the 703 rounds was the
"correct" answer wrong according to the notes. The problems below are about ambiguity (a distractor that is
also right, or a blank that is not a fact), display residue, and editorial or meta text.

## Problems found (by kind), with root cause and fix

Counts are distinct playable blanks across the corpus, before the fix.

### 1. Formatting residue shown in the prompt — 7 blanks
- `mr8.e / mr11.g / mr12.b / mr13.d .prose_para.1`: the prompt begins "**7.69!55** This objective does not appear…".
- `orr19.a.prose_para.12`, `orr21.h.prose_para.2`: "**rust 1)** No netting across counterparties…".
- `mr3.b.prose_para.4`: "…always to choose the **Fr\'echet**."
- Root cause: the shared `latexTextToPlain` (text.ts) keeps macro arguments as text. So `\fontsize{7.6}{9}`
  displays as "7.69", `\color{black!55}` as "black!55", and `\textcolor{rust}{…}` as "rust …". Accents like
  `\'e` are not mapped. Also, `unitsOf` turned an `\item[\textcolor{rust}{1)}]` enumerator label into a
  bold lead-in.
- Fix (build.ts `unitsOf`): strip `\fontsize{}{}`, `\color{}`, `\textcolor{}` and `\colorbox{}` arguments,
  fold `\'e`-style accents into Unicode, and drop bare enumerator labels ("1)", "(b)", "iii.").
  Side effect: the 4 affected ORR units now resolve to their bullet sub-item IDs instead of the whole-block ID.

### 2. Editorial or meta sentences played as facts — 6 blanks
- The 4 "It is written [below] from the GARP curriculum so the objective is not left blank" sentences
  (the answer "below" is a text position about the notes). Also `im8.d.trapbox.2` and `im9.d.trapbox.1`:
  "Treat gap-fills as one rung [below] a GARP source."
- Root cause: no filter for sentences about the notes' own provenance.
- Fix: `EDITORIAL` sentence filter (source notes, either layer, GARP curriculum, GARP source, gap-fill,
  not left blank, this objective does not).

### 3. Direction blank inside a sentence about a distractor, where the answer is the wrong claim — 1 blank (+1 dropped)
- `ltr4.b.trapbox.2`: "A distractor pairing call risk with [rising] rates is the polarity build." The
  "correct" answer is the misconception. The true fact (falling rates) is marked wrong.
- Fix: no direction blanks in sentences that mention distractor, polarity build or wrong answer. This
  applies both in `directionTargets` and to bold words recast as directions. It also drops the harmless
  `im3.i.trapbox.1.bullet.7`.

### 4. "Direction" words that are not directions (idiom or text position) — 20 blanks
For each of these, the antonym option is nonsense or is equally right:
- Text position: "the decision tree [below] gives…" (mr13.b), "The $175 million swap [below] has…" (orr21.b),
  "The seven assumptions [above] are…" (im1.c).
- "no [longer]" (cr5.e "no longer worthwhile", orr21.f "no longer valid"). Here "no **more**" is also correct.
- "[More] precisely:" (cr17.d) and "To be [more] specific" (im2.basics).
- "two or [more]" / "one or [more]" / "and [more] —" (mr8.a.defbox, mr8.c, cr9.b, mr9.c.defbox).
- "This [raises] the obvious question" (cr8.c) and "normally [raises] two objections" (ltr15.c).
- "the instrument [reduces] to an ordinary swap" (ltr16.a) and "the same expression [reduces]." (cr4.f).
- "fall" meaning belong: "defaults would [fall] in the first 5%" (cr7.f), "[fall] here" / "[fall] into
  this category" (cr3.d ×2), "transactions [fall] into three families" (ltr7.e), "should [fall] within this
  interval" (mr6.c), "[falls] into the EV copula family" (mr3.f).
- Fix: idiom and position guards in `directionTargets`. The above/below check now also catches
  "above/below + is/are/has/gives/shows…" and "written below".

### 5. Direction under negation, where the antonym is also true — 5 blanks
- "The hedge does not simply [reduce] the size of the outcome." (im8.b): it does not simply *increase* it either.
- "The loan term takes a factor of 1.00, not a [reduced] one." (ltr5.c): not an *increased* one either.
- "correlate at 0.12, not at some large [positive] number." (im2.e): not a large *negative* one either.
- "illiquid assets do not deliver [higher] risk-adjusted returns." (im17.f) and "exceeded by no [more] than x" (mr3.c).
- Fix: skip a direction word within 3 words after not/never/no/nor/neither/n't.

### 6. Third direction option that is a synonym of the answer — 36 blanks
- Example: "Hedge fund sensitivity with traditional markets [increases] in times of a market crisis"
  with options {increases | decreases | **strengthens**}. Also "A shared ledger [reduces] search frictions"
  with {… | **weakens**}, and "[decreases] the effectiveness" with {… | strengthens}.
- Root cause: `strengthens`/`weakens` were on their own "strength" axis. The third option is drawn from a
  *different* axis, so they were offered as wrong options for size words.
- Fix: moved strengthens and weakens onto the size axis. They are never a wrong third option for a size
  word, and typing them counts as a near-synonym ("close").

### 7. Number options — 8 blanks
- The same value offered twice: mr1.b "Normal [99%] VaR" {99% | 1% | **1 percent**}, and mr1.c "interval
  mass (of [1%])" {1% | 99% | **99 percent**}. Two options were identical, so one wrong option was obvious.
- A complement that is also a correct way to name the same VaR: "Normal [99%] VaR" offered **1%**. A 1% VaR
  is the same 99% VaR named by its tail.
- The answer at another precision: mr9.c "a mean reversion rate of [78%]" offered **77.51%**, and
  "a mean reversion of [77.51%]" offered **78%**. These are the same quantity; the notes give it both ways.
  "the result was [22%]" offered **22.49%**.
- Fix (`distractorsFor`): number distractors must differ from the answer, and from each other, at the coarser
  of the two precisions. In a VaR/ES, confidence, tail, quantile or significance sentence, a percent
  distractor may not equal 100 − answer. Legitimate complements such as 78% vs 22% (mean reversion vs
  autocorrelation) are kept.

### 8. Contrast blanks — 2 blanks
- ltr7.d: "That is the [TSECF] figure, not the TSECCF figure": the foil showed as **"tseccf"**. The foil
  was lowercased. Fix: the foil keeps the notes' case.
- ci5.c: "prioritise long-term growth ([like infrastructure]), not short-term transfers": the blank was
  the parenthetical aside, not the side of the contrast. The phrase "like infrastructure" also leaked into
  other rounds' options. Fix: no contrast when ", not" follows a closing parenthesis.

### 9. Generic lead-in labels as the answer — 32 blanks (one thread lost)
- "[Example]. Hedge funds may short sell…" (CR-1 d), "[Advantages]/[Disadvantages]. …" (CR-5 d ×4),
  "[Purpose]/[Mechanism]/[Challenges]/[Requirements]/[Variations]: …" (ORR-8 d; the naming line even said
  "“Purpose” is the word it hangs on here"), "[Challenge]:" (ORR-19 a), "[Types]./[Mechanics]./[Responsibilities]."
  (CR-17), "[Features]:", "[Measures]:", "[Goal]:", "[Limitations].", "[Strategy]:", "[For guidelines]:",
  "[Other clauses/copulas/countries]", "[Method 1]/[Method 2]".
- These name the shape of the list, not a concept. Any synonym fits ("Benefits" for "Advantages"), and only
  the options give the answer away. In ORR-8 d, "Regulations", "Requirements" and "Variations" were
  interchangeable across two paragraphs.
- Fix: a `GENERIC_LABEL` filter on term and bold answers, and "Method/Approach/Case/Option N" added to the
  position-label filter. ORR-8 no longer supports Cloze Chain (supports() went from 93 to 92 of 107). Its only
  full thread was these labels.

### 10. Defbox titles that are not a term, blanked as the "defined term" — 6 blanks
- "[The same]: The momentum strategy…" and "[The difference]: Value is a negative feedback strategy…"
  (im2.e), "[Motivations]:" (orr13.a), "[What MDS does instead]:" (im15.a), "[Continuous versus
  discontinuous risk]:" (cr8.a), "[Internal versus external fraud]:" (orr11.a).
- Fix: definition titles that are comparisons, questions or generic labels are not blanked. The sentence
  falls back to its ordinary targets.

### 11. Distractor that paraphrases the answer — 1 blank
- ltr6.a: "Lines are often uncommitted and provided [without interest charges]", with option
  **"no interest charge"** from the same reading.
- Fix: a distractor with the same content words as the answer (ignoring stopwords, "without" and "non") is
  rejected. A scan of every option pair with over 34% content-word overlap then found only genuine siblings
  (Type I/II error, IS gap/duration gap, Level 1/2/3, and so on).

### 12. Sentences cut short by a dropped display equation — 3 blanks
- cr22.f "…excess spread turns negative once fewer than" (the equation and "loans survive" were dropped),
  cr12.b "…is", orr9.a "…through".
- Fix: skip a sentence whose display text ends in a dangling function word (is, than, through, of, to, the…).

**Total: 127 problem blanks across 12 kinds, all from systematic causes, all fixed in build.ts.**

## Files changed
- `web/src/games/mechanics/cloze-chain/build.ts` is the only mechanic file changed (+~120 lines). It contains
  the direction axis, `unitsOf` clean-up, `EDITORIAL` and dangling-end sentence filters, direction idiom,
  negation and distractor guards, contrast foil case and parenthesis guard, `GENERIC_LABEL`, definition-title
  guard, number-option distinctness, and the paraphrase-distractor check.
- Harness (scratch): `gamestest/cloze-chain.tsconfig.json` (new; rootDir web/src, out → out-cloze-chain),
  and `gamestest/cloze-chain.cjs`. The harness now points at the new output and folds accents in its
  faithfulness check. It also has regression assertions for residue, editorial sentences, generic labels,
  number-option distinctness and precision, strengthen/weaken options, distractor sentences, and contrast
  foil case. Against the original build.ts these assertions fail on all of the kinds above; against the
  fixed build they pass.
- Results: harness `all cloze-chain checks passed` (2,124 rounds built over 92 readings × 3 seeds, plus SRS,
  determinism and malformed-content checks). `tsc -p tscheck/tsconfig.json` reports 0 errors.

## Left open (not systematic, or outside this mechanic)
1. **Notes content, which content/ owners should fix:**
   - `mr8.a.trapbox.1`: "If correlation **increases** from +1 to −0.4, the CDS spread may decrease slightly".
     Going from +1 to −0.4 is a decrease, so the sentence contradicts itself. The round blanks "decrease"
     faithfully.
   - `orr19.a.prose_para.1`: "Translation invariance: risk depends on portfolio contents" and "Monotonicity:
     higher returns suggest lower risk" are loose statements of the coherence axioms. The standard ones:
     adding cash k reduces risk by k; a portfolio that always returns less has at least as much risk.
2. **Shared text.ts:** `latexTextToPlain` still leaks `\color`, `\textcolor`, `\fontsize` arguments and
   `\'e` accents for every other game. Cloze Chain now cleans them itself. The proper fix belongs in the
   shared file, which I did not edit.
3. **Case-specific distractors that are plausible but wrong according to the notes:**
   - CI-1 b "AI is reshaping capital markets by favouring [faster], more flexible players", option
     "smaller". Later sentences say larger firms gain, but a player could argue for it.
   - IM-7 a "Reach for the dollar-weighted figure when the question is about the [money], not the manager",
     option "investor" (arguably also true).
   - CR-18 d "typically [99%]" vs "99.5%".

   The build cannot catch these semantically. They would need per-item exclusions in content.
4. **Naming cosmetics:** when every discovery link is a direction word in an untitled block (e.g. CI-4 f),
   the concept "term" falls back to the full objective text, and the line calls “increase” the word the
   thread hangs on. This is not false, just weak.
5. **Typing leniency (match.ts, unchanged):** paraphrases such as "uncorrelated" for "not correlated" or
   "understate" for "underestimate" are graded wrong. The options cue still offers the notes' wording.
6. Lead-in labels that are real but hard to recall ("[Investment objectives]. Asset managers cater…",
   "[Role and responsibility].") are faithful and were kept. They are recognisable mainly from the options.

---

# Pass 2: fact-check after the trap merge (2026-09-25, evening)

Data: `content/games/game-blocks.json` as of commit 91bfa75 (107 readings, 2,808 traps). The build
starts from the pass-1 fixes (commit b60d1ca). Working files are in `scratchpad/cz2/`.

## Coverage

| Dump | Seeds | Readings | Rounds | Hand-read |
|---|---|---|---|---|
| `before-s77.txt`: every supported reading | 77 | 92 (MR 17, CR 20, ORR 14, LTR 17, IM 16, CI 8) | 708 | all 708 |
| `before-s303-919.txt`: every supported reading | 303, 919 | 92 | 1,414 | the 278 rounds not already seen in seed 77 or pass 1 (`new-s303-919.txt`) |
| `after-s77.txt`, `after-s303-919.txt` (after fixes) | 77, 303, 919 | 92 | 707 + 1,414 | the 50 rounds that are new after the fixes (`after-new.txt`) |

That is **1,036 distinct rounds read against their source sentence, across all 92 supported readings
and all six areas**. For each round I checked the prompt, the answer, both distractors, the reject
list (it drives the "wrong" feedback) and the naming line. When a round looked doubtful, I read the
source block's LaTeX (`blk.cjs <block id>`).

I then scanned every candidate blank in the corpus (1,894 playable, all targets from
`readingSentences`) for each problem pattern found by hand. `diffc.cjs` compares every target,
option set, reject list and plan naming between the pass-1 build (`build.pass2.orig.ts`, compiled to
`out-orig/`) and the fixed build. Its output is in `diff-pass2.txt`.

## What held up

In none of the 1,036 rounds was the "correct" answer wrong according to the notes, and no prompt was
unfaithful. The harness still checks that the text before and after every blank is a substring of
the source block. All the pass-1 problem kinds stayed fixed. The problems below are about ambiguity,
answers that are really vacuous, grading, and naming.

## Problems found, by kind (distinct blanks in the corpus before the fix)

### 1. "Both ways" direction pairs: 34 blanks (+1 idiom)
Examples: "the yield on a bond and the yield on a hedging instrument [rise] and fall by the same number
of basis points" (MR-11 a), "Emerging markets tend to show greater reactions in positive or [negative]
terms" (CR-8 a), "It can be [higher] or lower than the fixed coupon" (CR-9 g), "To compute it,
[increase] and decrease the default probability by 10 bps" (CR-22 j), "both [before] and after
mitigating actions" (LTR-10 c), "becoming [more] or less risky" (IM-7 g), "Whether the stock [rises] or
falls" (IM-8 b), "offsetting [positive] and negative cash flows" (netting, CR-12/15/16), and "order
return observations from [largest] to smallest" (MR-1 a).
- The pair means "either way". Neither side is a direction fact, and the only thing that decides the
  answer is avoiding "fall and fall". The antonym was offered as the wrong option, even though the
  sentence itself uses it.
- Also "credit spreads and [more] —" (MR-9 c). The existing "and more —" idiom guard missed it
  because the LaTeX dash is `---`, not `—`.
- Fix (`directionTargets`): skip a direction word joined by and/or/nor/to to a word on the same
  axis with the opposite sign. The "and more" guard now also accepts `--`/`---`.
  Scattered across MR-1, MR-9, MR-11, MR-17, CR-8, CR-9, CR-12, CR-15, CR-16, CR-17, CR-22, LTR-7,
  LTR-10, IM-7 and IM-8.

### 2. Missing antonym for stabilising / destabilising: 6 blanks
- "Momentum is a positive feedback strategy ([destabilising])" offered {destabilising | negative |
  positive}, and "Value is negative feedback and [stabilising]" the same (IM-2 e ×4, LTR-1 d ×2).
- Root cause: the antonym went through the same "one option contains the other" filter as ordinary
  distractors, and "destabilising" contains "stabilising". So the one contrast that matters was never
  offered, and two sign words were offered in its place.
- Fix (`distractorsFor`): the antonym is always the first wrong option.

### 3. Near-miss "spelling trap" rejects that grade a correct variant wrong: 14 blanks (5 harmful)
- `toPayload` added every word in the sentence within 2 edits of the answer to the reject list. That
  rule exists for "GARP writes Jegadeesh, not Jagadeesh", but it also caught the answer's own variants:
  - IM-3 c: **"tradable" graded wrong for "[Tradeable]"** ("Alpha must be measured against a tradable
    benchmark"). This is a correct spelling marked wrong.
  - CR-2 c: "independent" for "[Independence]".
  - ORR-5 f and ORR-19 d: "transparent"/"transparently" for "[Transparency]".
  - CR-2 c: "approve" for "[Approval]".
  - Harmless cases: "the"/"an"/"and"/"are"/"main"/"shape"/"buy"/"up"/"action"/"smile".
- Fix: only a word that follows "not" in the sentence (optionally quoted) counts as a spelling trap.
  Jegadeesh still rejects "Jagadeesh", and "tradable" is now accepted (harness asserts both).

### 4. Contrast foils that are true or misaligned: 8 blanks
- "X, not just Y" is additive, so Y is true as well: "MRM is an [ongoing process], not just periodic
  reviews" (ORR-16 b), "credit downgrades, spread widening, and [liquidity problems], not just
  defaults" (ORR-22 b), "compensation must reflect [liquidity risk], not just profit" (LTR-14 b), and
  "RAROC [measures risk-adjusted performance], not just raw numbers" (ORR-18 b). The foil
  "just defaults" was offered as an option.
- A number word or pronoun on the "not" side means the contrast is not between the nearest words:
  "the coupons run for two [years], not one" (IM-8 d, foil "one"), "they come after the [risk
  inventory], not before it" (LTR-3 c, foil "before it"), "sits inside [quantitative risk], not
  alongside it" (LTR-7 c) and "facilitate [deal closures], not block them" (CR-2 c).
- Fix (`contrastTargets`): skip ", not just/only/merely/simply/…" and foils containing
  one…ten/it/them/this/that/these/those. Those sentences keep their other targets. LTR-3 c now blanks
  "come [after] the risk inventory, not before it", which is the real contrast.

### 5. Definition titles that name two terms: 4 blanks
- "[DVA and BCVA]: The key assumption behind unilateral CVA is …" (CR-20 e). The two parts were also
  offered as options, "Debt value adjustment (DVA)" and "bilateral CVA (BCVA)", so the options
  overlapped the answer. Also "[Clearing and settlement]: Clearing is …" (CR-14 c), "[Pre-settlement
  and settlement risk]: Pre-settlement risk is …" (CR-15 a) and "[Recombining and non-recombining]"
  (MR-12 g).
- Fix: `and`/`&` added to the defbox-title "listy" guard. These sentences now blank their own \term
  ("[Clearing] is the process…", "[Pre-settlement risk] is…", "the tree is [recombining]").

### 6. Bolded word fragment as the blank: 1 blank, and it leaked into LTR-8 options
- "Economies of scope are in technology and marketing; [dis] economies are in risk management…"
  (LTR-8 c, `\textbf{dis}economies`). "dis" also appeared as a distractor in two other LTR-8 rounds
  ("line | dis").
- Fix (`macroTargets`): skip a `\term`/`\textbf` span glued to letters on either side.

### 7. Naming line that hangs the thread on a direction word or number: CI-4 (all seeds); MR-14, ORR-21, LTR-5 after a miss
- "The thread you were rebuilding is CI-4 f: … “increase” is the word it hangs on here." and, from
  `nameAfterDiscovery`, "“less”" (ORR-21), "“increasing”" (MR-14), "“increase”" (LTR-5).
- Fix (`namingFrom`): for a direction or number blank, the line names its block title ("It runs
  through “…” here."), or nothing beyond the objective. Concept terms are unchanged.

**Total: 68 problem blanks across 6 kinds (35 + 6 + 14 + 8 + 4 + 1), plus the naming line (kind 7), all from systematic causes, all
fixed in `web/src/games/mechanics/cloze-chain/build.ts`.** Net effect over the corpus: 48 targets
removed, 4 replacement targets added, and `supportsCloze` unchanged at 92/107. Other option sets
change only in shuffle order or third option, because the candidate pools shifted; I re-read the 50
rounds that are new after the fix.

## Files changed (pass 2)
- `web/src/games/mechanics/cloze-chain/build.ts` only (about 30 lines). The changes are the
  word-fragment guard, the both-ways pair guard with the `---` idiom, the "not just" and
  number/pronoun contrast guards, `and` in the definition-title guard, the antonym always offered,
  near-miss rejects limited to "not X", and the naming line for direction/number blanks. The
  orchestrator committed most of this mid-run (07fe562). The naming-line change is still uncommitted.
- Harness (scratch): `gamestest/cloze-chain.cjs` has new pass-2 regression assertions. They cover
  both-ways pairs, the stabilising antonym, blanks inside a word, near-miss rejects outside "not X",
  "not just" contrasts, number/pronoun foils, two-term definition titles, naming lines on bare
  direction words, Jegadeesh still rejected and "tradable" accepted. Run against the pass-1 build
  (`cz2/harness-on-orig.cjs` → `out-orig`), these assertions fail 43 times. Against the fixed build:
  `all cloze-chain checks passed`, with 2,119 rounds over 92 readings × 3 seeds plus the SRS,
  determinism, malformed-content and naming checks.
- `cd scratchpad/tscheck && npx --no-install tsc -p tsconfig.json` reports 0 errors.

## Left open (pass 2)
1. **Notes content, which content/ owners should fix:**
   - `ltr10.c.keybox.1`: "mitigating actions **extend** the survival period from 49 days to 27 days".
     Going from 49 to 27 days is a reduction, so the sentence contradicts itself. The round blanks
     "27 days" faithfully.
   - `im7.i.trapbox.1`: "Hedge fund sensitivity to traditional markets rises in a crisis and **falls in
     strength**". It reads as self-contradictory, and IM-7 f says sensitivity increases. Rounds blank
     "rises" or "falls" here, and with "rises" the second half is confusing.
   - `mr8.a.trapbox.1` (from pass 1): "If correlation increases from +1 to −0.4" is still in the data.
2. **One-off semantic ambiguities the build cannot detect:**
   - IM-7 i "Jensen's alpha is a [difference], not a ratio" offers "measure", which is also true.
     "measure" comes from the misaligned contrast "inapplicability of a static [measure], not
     manipulation".
   - MR-14 d "Each drift can take a [negative] value as well". The option "positive" also reads as true.
   - ORR-3 a / ORR-15 d "[after] major changes": "before" is arguable for revalidation.
3. **Weak but faithful blanks:** example-specific parameters ("Normal [99%] VaR as $5,000", "The one-year
   rate is [8%]") need the next sentence to recover. Some contrasts blank only the head noun ("a
   probability-weighted figure [across three scenarios], not the worst-case figure"). Some direction
   blanks have the antonym elsewhere in the sentence ("narrower after …, and [wider] before").
   None of these is wrong. They are low-value rounds.
4. **Shared text.ts** (unchanged from pass 1): `\color`/`\textcolor`/`\fontsize` arguments and `\'e`
   accents still leak for other games. Cloze Chain cleans them itself.
