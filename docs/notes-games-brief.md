# FRM Part II — Notes → Games Ingestion and Play Task

The user's brief, kept verbatim as the spec for the Notes → Games work. Decisions made
since (trap mining beyond trap boxes, a ninth "Sequence" category, the `notebox` type,
publishing, integration with the portal, extra retention mechanics) are recorded in
`PORTAL_PLAN.md` §3c and take precedence where they differ. The user has asked for the
phases to run without pausing for confirmation, asking only when something is unclear.

---

You have a zip of .tex source files in project knowledge. These are the LaTeX sources for my FRM Part II study notes across six exam areas: Market Risk (MR), Credit Risk (CR), Operational Risk and Resilience (ORR), Liquidity and Treasury Risk (LTR), Investment Management (IM), Current Issues (CI).

The mission is in two parts. Part A extracts every playable unit of content into one deterministic JSON file. Part B is a game layer that reads that file at runtime and produces playable sessions. No LLM calls at runtime — everything is built once, played forever.

Work in the phases below, in order. Stop and report at the end of each phase; wait for my confirmation before proceeding. If a phase produces something ambiguous, stop and ask rather than guess.

---

## The governing philosophy

Two principles drive everything that follows.

First: the whole reading is playable, not just the boxes. Most study tools mine the definition boxes and the flashcards and call it done. We are not doing that. Every paragraph of prose, every table cell, every formula variable, every number, every figure caption, every worked-example step, every directional claim, every classification scheme, every process description — all of it is material for a game mechanic. The block types in the .tex structure are the easy extraction; the harder job is mining the prose, the tables, the numbers, and the diagrams for playable content. Both jobs matter.

Second: the games must be worth playing on their own terms. Not flashcards with a scoreboard. Not quizzes with a coat of paint. A session is a shape — a board, a grid, a tree, a slider, a mesh, a lattice — that teaches a concept through manipulation and tests it under pressure. The mechanics we use are borrowed from the well-known explorable-explanations tradition (Bret Victor, Nicky Case, Vi Hart) and the trap-detection tradition of concept inventories. Every session runs a five-phase teaching arc (§Part B, Phase 8). Nothing is one item at a time with a front/back reveal.

---

## Part A — Extraction

The extraction produces one file, game-blocks.json, that both encodes the notes and carries the playable payload. Every subsequent session reads from it. No parsing at runtime.

### Phase 1 — Inventory, schema audit, and content census

Walk the zip. Report five things, then stop.

1.1 — File list. Every .tex file, size, line count. Flag any file that looks like a consolidated volume (three areas merged) rather than a standalone.

1.2 — Structural macro survey. Every macro used to open a reading (\reading, \chapterhead, others) and every macro used to open an objective (\lo, \lohead, others). One example call each, arguments labelled.

1.3 — Alias table. Every environment name found, mapped to one of nine canonical block types:

| Canonical type | What it is | Typical macros |
|---|---|---|
| keybox | "Remember this" / LO lists / key facts | keybox, mrkeybox, imkeybox, crkeybox, lrkeybox, orkeybox, cikeybox |
| trapbox | An exam-trap warning | trapbox, trapboxnb, mrtrapbox, imtrapbox, crtrapbox, lrtrapbox |
| defbox | A definition | defbox, mrdefbox, imdefbox, crdefbox, ordefbox, lrdefbox |
| fmlbox | A formula, usually with \vk{...} notation key | fmlbox, mrfmlbox, imfmlbox, crfmlbox, orfmlbox, lrfmlbox |
| exbox | A worked example | exbox, mrexbox, imexbox, crexbox, orexambox, lrexbox |
| gapbox | Author gap-fill under \gapbadge | gapbox, mrgapbox, imgapbox, crgapbox, orgapbox, lrgapbox |
| figcap | A figure caption | \figcap{...} |
| table | Structured comparison | \begin{tabularx}, \begin{longtable} |
| prose_para | Narrative paragraph | Everything else in the reading body |

If a macro does not resolve, stop and list it. Do not guess.

1.4 — Content census by block type. Total counts per area of: defbox, fmlbox, exbox, trapbox, keybox, gapbox, table, figcap, prose_para, and tikzpicture. This is the volume of playable material available. Anything out of proportion (say, zero fmlbox in a market-risk volume) is a signal to check.

1.5 — Content census within blocks. For each reading, count:

- Inline \term{...} spans (the marked exam vocabulary)
- Inline \textbf{...} spans inside prose (likely load-bearing claims)
- Numbers with units or percentages in prose (potential threshold sliders)
- Comparisons in prose (potential sibling pairs)
- Directional words in prose (higher, lower, before, after, rises, falls)
- Actor names in prose (potential party-line items)
- Variables in every \vk{...} notation key (potential definition cards)
- Rows in every table (potential grid items)
- \item bullets across all lists (each bullet is a card)
- \figcap{...} captions
- \section/\subsection headings

Why this matters: the boxes are maybe a third of the playable content. The other two thirds is in the prose, the tables, the numbers, and the diagrams. Phase 1.5 measures how much of that material is there.

Phase 1 output: the five reports. Wait for confirmation.

### Phase 2 — Calibration on one file

Pick the cleanest file (likely LTR). Parse it fully and show me the result. Do not proceed to Phase 3 until I confirm the shape.

2.1 — Reading metadata. Readings open via \reading{...}{...}{...}{...} or \chapterhead{...}{...}{...}{...}{...}. Canonical fields: reading_id, title, tag, src, area, source_citation, source_file. For \chapterhead{57}{ORR-18}{...}{1}{9}, 9 is the SRC; the rest are legacy. Capture all, keep the last as src.

2.2 — Objectives. Open via \lo{LTR-1 a}{...}, \lohead{57}{a}{...}, or \lohead[alt]{...}{...}{...}. Canonical fields: letter, text, id.

2.3 — Block extraction, one rule per type.
- keybox, trapbox, defbox, fmlbox, exbox, gapbox — between \begin{X} and \end{X}. Extract optional [title={...}] as title. Convert \[ ... \] and align* bodies to body_latex. Attach any immediately-following \vk{...} or \mrvk{...} as notation_key.
- figcap — content is the macro argument.
- table — raw LaTeX environment plus a caption from the immediately following \figcap{...}. Also extract the parsed rows and columns, if determinable.
- prose_para — a narrative paragraph not inside any of the above. Skip section headings.

2.4 — Sub-block mining. This is the part most extractions skip. For each block, extract:
- Every \term{...} span as a term item. These are the marked exam vocabulary.
- Every \textbf{...} span inside prose as a bold_claim item. In these notes, bolded phrases are almost always load-bearing.
- Every number with unit or percentage — regex for \d+(\.\d+)?\%? adjacent to \%, basis points, bp, million, billion, or a currency symbol. Each becomes a numeric_item with the surrounding sentence as context.
- Every \item bullet across all list environments as a bullet item. Bullets inside keybox, trapbox, and prose are all candidate cards.
- Every table row as a table_row item, with its column headers as context.
- Every variable in a \vk{...} notation key as a variable_def item. Each is a definition-pair candidate.
- Every tikzpicture — do not attempt to parse TikZ. Capture the block as a tikzpicture type with its full source and the caption. The game layer can pre-render these separately.
- Every \section and \subsection heading as a section_heading item. Headings signal structure and are used by the Order Game and the Lineage Tree.

Every one of these sub-items carries a stable ID and the parent block's ID. They are the fuel for the game layer.

2.5 — IDs and hashes. Block IDs: {reading_lower}.{lo_letter}.{canonical_type}.{ordinal}. Sub-item IDs: {block_id}.{subtype}.{ordinal}. Every item carries a hash derived from content, so edits are detectable.

2.6 — Trap extraction. Every reading ends with a trapbox[Consolidated trap summary — ...]. Each bullet is a trap item:

```json
{
  "id": "ltr1.trap.polarity.1",
  "category": "Polarity",
  "text": "Negative feedback = buy on falls = stabilising.",
  "correct_text": null,
  "corrupted_text": null,
  "source_block": "ltr1.d.trapbox.1"
}
```

Category is the first bolded word, normalized to one of exactly eight: Polarity · Sibling · Role · Sign · Scope · Definition · Formula · Intermediate result. Where a bullet states both a correct and a corrupt version, split into correct_text and corrupted_text.

2.7 — Gap flags. Any block inside \gapbox, \gapbadge, or \gapnote carries is_gap_fill: true.

2.8 — Source-note metadata. trapbox or keybox titled with "Label collision", "Ordering note", "Stale wording", "Numbering warning", "Correction to the reconciliation record" goes into source_notes on the reading, not reading content.

Phase 2 output: full JSON for the chosen file, rendered readably. Wait for confirmation.

### Phase 3 — Full extraction

Walk every .tex file. For each reading: metadata → objectives → blocks → sub-items → traps → gap flags → source notes. Report progress every 10 readings. Stop and flag deviations rather than guess.

Phase 3 output: progress, then a summary of clean versus flagged readings.

### Phase 4 — Derived structures

4.1 — mechanics_supported per reading. Count constructs:

| Reading shape | Mechanics supported |
|---|---|
| ≥ 3 table blocks | Bucket Drop, Severity Grid, Table Fill |
| ≥ 2 exbox | Order Game, Stepwise Derivation |
| ≥ 3 fmlbox | Parameter Playground, Formula Assembler |
| ≥ 2 trapbox | Shatter, Trap Shape Trainer, Confusables Duel |
| ≥ 5 Role-category traps | Party Line |
| ≥ 3 cross-refs (see LTR-X, as in MR-Y) | Lineage Tree, Fingerprint |
| ≥ 2 named historical cases | Case Docket, Scenario Router |
| ≥ 5 numeric items | Threshold Slider |
| ≥ 3 tikzpictures | Explorable |
| High LO count, no dominant structure | Concept Inventory |

4.2 — trap_index. Top-level lookup by category, listing every trap ID.

4.3 — sub_item_index. Top-level lookups by subtype: terms, bullets, numeric_items, variables, table_rows, section_headings. Precomputed for game-layer access.

4.4 — corrections_index. Rows from any "Corrections and coverage record" appendix.

Phase 4 output: the four structures, with counts. Wait for confirmation.

### Phase 5 — Output

Emit game-blocks.json with this shape:

```json
{
  "version": "1.0.0",
  "generated": "<ISO 8601>",
  "sources": { "<file>": { "readings": N, "lines": N } },
  "readings": {
    "LTR-1": {
      "reading_id": "LTR-1",
      "title": "...", "area": "LTR", "tag": "STRIKE FIRST", "src": 6,
      "source_citation": "...", "source_file": "...",
      "objectives": [
        {
          "letter": "a", "text": "...", "id": "LTR-1 a",
          "blocks": [
            {
              "id": "ltr1.a.defbox.1",
              "type": "defbox",
              "title": "Liquidity trading risk",
              "body_latex": "...",
              "is_gap_fill": false,
              "source_line": 42,
              "hash": "abc123",
              "terms": ["liquidity trading risk"],
              "bold_claims": ["..."],
              "numeric_items": [],
              "cross_refs": []
            },
            {
              "id": "ltr1.a.fmlbox.1",
              "type": "fmlbox",
              "title": "Cost of liquidation",
              "body_latex": "...",
              "notation_key": "...",
              "variables": [
                { "symbol": "s_i", "definition": "proportional bid-offer spread..." }
              ]
            },
            {
              "id": "ltr1.a.table.1",
              "type": "table",
              "body_latex": "...",
              "caption": "...",
              "rows": [
                { "cells": ["...", "...", "..."], "headers": ["...", "...", "..."] }
              ]
            },
            { "id": "ltr1.a.tikz.1", "type": "tikzpicture", "body_latex": "...", "caption": "..." }
          ]
        }
      ],
      "traps": [ ],
      "source_notes": [ ],
      "mechanics_supported": [ ]
    }
  },
  "trap_index": { "Polarity": ["..."], "Sibling": ["..."], "Role": ["..."], "Sign": ["..."], "Scope": ["..."], "Definition": ["..."], "Formula": ["..."], "Intermediate result": ["..."] },
  "sub_item_index": {
    "terms": ["..."], "bullets": ["..."], "numeric_items": ["..."],
    "variables": ["..."], "table_rows": ["..."], "section_headings": ["..."]
  },
  "corrections_index": [ { "where": "...", "as_written": "...", "as_corrected": "..." } ]
}
```

Save to project knowledge.

Phase 5 output: confirmation, file size, top-level counts.

### Phase 6 — Coverage report

Emit extraction-coverage.md:

6.1 — Readings parsed per area against expected totals (MR 18, LTR 17, IM 17, ORR 24, CR 23, CI 8).
6.2 — Unresolved macros, with file and line.
6.3 — Deviating readings, one line each.
6.4 — Block census by canonical type.
6.5 — Sub-item census. How many terms, bullets, numeric items, variables, table rows, section headings captured. This tells us how much playable content the extraction found.
6.6 — Unresolved item list. Anything where you inferred rather than read.
6.7 — Determinism check. Re-run on one file; confirm byte-identical output apart from the timestamp.

Save to project knowledge.

Phase 6 output: the report plus a one-line status.

---

## Part B — Game Layer

This is the standing runtime. Everything below reads from game-blocks.json. No new parsing. No LLM calls at runtime. Every session is fast, offline-capable, and deterministic.

The bar for this layer: sessions should be worth playing on their own terms, not just because they teach. A session is a shape. It has a mechanic, an arc, a tactile feel, a visual world, and an ending that shows you something you didn't know about yourself. If a session would not survive being played by someone who didn't need to study, the mechanic is wrong.

### Phase 7 — The full mechanic catalogue

Implement each mechanic as a dispatchable renderer. Each takes items from game-blocks.json and produces a playable surface. Every mechanic is a shape, not a sequence. No front/back reveals. No one-item-at-a-time.

**7.1 — Detection mechanics.** The exam tests recognition of the shape of being fooled. These train that reflex.
- Shatter. A statement appears. Player classifies TRUE / FLIPPED / SWAPPED. If FLIPPED, they name the word. If SWAPPED, they name the sibling. On a miss, the corrupted version stays visible for a beat, then the correct version fades in underneath. Source: trap_index + trap.corrupted_text where present, else generated.
- Trap Shape Trainer. A statement appears. Player names the category (Polarity / Sibling / Role / Sign / Scope / Definition / Formula / Intermediate result). Feedback shows the category name plus the block ID. Source: trap_index.
- Polarity Reflex. Two words flash. Player hits Y or N for belong/don't-belong. Sub-second window. Source: trap_index.Polarity items, split into their two poles.
- Sibling Duel. Two short statements appear. Player picks same concept / opposite / unrelated. Source: trap_index.Sibling items, split into their two members.
- Confusables Duel. Two statements side by side, one true and one corrupt. Player picks the true one. Timer. Source: any trap with both correct_text and corrupted_text.
- Fingerprint. A sentence fragment appears. Player names the reading it came from. Trains navigational familiarity with the corpus. Source: sub_item_index.bullets and sub_item_index.bold_claims, sampled.
- Party Line. A one-line event appears. Player names the actor: who pays, who receives, who is exposed, which line of defence. Source: trap_index.Role items plus any bullet containing \term{...} referring to a party.

**7.2 — Structural mechanics.** The notes are full of taxonomies, classifications, thresholds, and processes. These turn each one into a puzzle.
- Bucket Drop. Items on screen; empty buckets below. Player drags each item to its correct bucket. Source: any table with a categorical first column, or keybox bullets that name categories.
- Severity Grid. A 2-axis grid appears (frequency × severity, likelihood × impact). Player places each item in its cell. Source: table blocks whose two columns are dimensional axes.
- Threshold Slider. A scenario appears with a slider from low to high. Player drags the slider to the exact point where a classification changes. Source: sub_item_index.numeric_items — every threshold in the notes becomes a slider.
- Table Fill. A table with cells blanked. Header row and column structure given. Player fills the values. Source: any table block.
- Order Game. Shuffled steps of a derivation or a process. Player drags to reorder. Source: exbox blocks with numbered steps, and any prose paragraph containing an enumerated sequence.
- Classification Ladder. A rung-based board. Player moves items up and down the ladder. Source: any reading with a graduated classification (the five-category credit ladder in CR-3, the operational risk Basel categories in ORR-1).

**7.3 — Relational mechanics.** The corpus is dense with cross-references. These make the connections visible.
- Lineage Tree. A concept dependency tree. Click a node to see what it depends on. Source: cross_refs fields, plus reading IDs mentioned in other readings.
- Sibling Map. Two concepts side by side. The map shows the flip that separates them. Player toggles between them, watching the property that inverts.
- Concept Atlas. A visual map of every concept across the corpus, clustered by area. Player zooms, clicks a cluster, plays a Shatter round restricted to that cluster.

**7.4 — Application mechanics.** The exam is mostly scenario vignettes. These turn the notes into scenarios.
- Scenario Router. A scenario with real numbers appears, with no reading label. Player names which framework applies and why. Source: exbox blocks with the reading label stripped.
- Decision Tree Walk. A walkable if-then tree. Player answers questions; wrong branches take the player down a wrong path and show what choice they incorrectly made. Source: any reading with an explicit decision grid (LTR-4's ladder / front-end / back-end / barbell / rate-expectations mapping, IM-5's risk-minimizing vs return-optimizing positions).
- Case Docket. A named historical case appears (Lehman, Bear Stearns, LTCM, Archegos, Madoff, Northern Rock, Ashanti, Metallgesellschaft, Barings, London Whale, Equifax, USAA, Capital One). Fact chips appear on screen — some real for this case, some drawn from other cases. Player sorts them. Then a compare mode shows the discriminating facts between any two cases. Source: case mentions across the corpus, trap_index.Role and trap_index.Sibling items that reference named firms.
- Stepwise Derivation. A worked example with steps blanked. Player chooses the next operation; each choice shows its consequence. Source: exbox blocks.
- Bridge Builder. A concept with two halves — a cause and an effect, a mechanism and its consequence — appears as two columns. Player draws the link. Source: any trapbox bullet with an explicit "A → B" structure.

**7.5 — Explorable mechanics.** Some concepts are relationships to feel, not facts to recall. These are the manipulable ones.
- Parameter Playground. 1–3 sliders control a formula. Live recomputation updates a graph. Source: fmlbox blocks with a notation key listing variables, plus a graph the notes already contain.
- Tree Explorer. Drag parameters (drift, volatility, mean-reversion speed k, θ) and watch a binomial or rate tree grow and re-price. Source: MR-14, MR-15, MR-16, MR-12, MR-13.
- Distribution Explorer. Change assumptions (fat tails, skew, jump) and watch a distribution change shape. Source: MR-17, MR-3, MR-9.
- The Duel. Two formulations of the same concept, with a slider between them. As the slider moves, one formulation morphs into the other. Source: any reading with a sibling pair (Sharpe vs Treynor, IS gap vs duration gap, CVA vs DVA, POT vs GEV).
- Timeline Walk. A historical narrative as a scrubbable timeline. Scrub forward, watch the mechanism unfold. Source: any reading with a temporal sequence (the LTR-1 three-case narrative, the CI-4 Russia/Ukraine vs US/China comparison, the CI-5 phases).

**7.6 — Assessment mechanics.** These are for periodic sessions (§Phase 10.4).
- Concept Inventory. A short test scored by misconception category, not by question. Output is a vulnerability profile: which trap categories are chronic. Source: trap_index, sampled by category.
- Trap Audit. A dashboard. How many of each trap category caught, how many missed, which specific traps missed, with the missed items re-shown.
- Formula Assembler. Drag variable names into a formula skeleton. Source: fmlbox.variables.
- Coverage View. A visual map of the whole corpus, reading by reading, showing which objectives have been closed by completed teaching arcs.

### Phase 8 — The teaching arc

Every session runs the same five-phase arc. A mechanic without the arc is a quiz, not a game. Session length: 4–6 minutes.

8.1 — Opening frame (20–30 s). One line naming the mechanic and the kind of concept it will reveal. Structural priming only — hand over an empty frame, never fill the slot.
"MR-14 · Tree Explorer. Four drift specifications, one tree. Watch what changes when I move this slider — you tell me which of the four models we're looking at."
Not: "remember, Vasicek mean-reverts, so…"

8.2 — Discovery (60–90 s). Player interacts with the mechanic before any terminology appears. The concept becomes visible through action. Player runs into the idea; the game does not present it.

8.3 — Just-in-time naming (30–45 s). After 3–5 interactions, name the concept the player has just been feeling. Short and precise: official term, source block ID, LO letter, one line on what it does in the reading.
"That gap between the two middle nodes — that's non-recombination, and it's why Vasicek needs node averaging. MR-14 f, block mr14.f.fmlbox.3."
Player has earned the name before hearing it.

8.4 — Pressure (60–90 s). The last 3–5 rounds apply the named concept under time pressure or complexity. Detection speeds up; items get novel. Shift from explore to decide.

8.5 — Close (20 s). One screen: reading ID, LOs covered, concept named, trap categories drawn on, score as a stability measurement. Prints a session-log line.

### Phase 9 — Session runner

Every session follows this sequence.

9.1 — Read the game log. Look up the last-played mechanic and reading. This session rotates away from the mechanic used in the last three sessions and away from the last three readings unless I named a reading explicitly.
9.2 — Pick a reading and mechanic. If I triggered with game mode [reading], use that reading. If surprise me, pick a reading whose mechanics_supported list fits an underused mechanic. If neither, pick the mechanic with the longest drought and the highest-src reading that supports it.
9.3 — State the choice in one line before building: "LTR-1 · Order Game · target concept: why outflows subtract before inflows. Last session was Shatter on CR-20, so this rotates."
9.4 — Tick-check. List the reading's objectives and mark which this session's arc will close. If not all, name which carry over.
9.5 — Build and render the session. The mechanic plus the teaching arc as a single interactive surface.
9.6 — During play. Teaching happens through feedback, not pre-amble. Every wrong answer shows the correct version and its source, one line each. Phase 8.3 is the only pause — once per session, kept short. Every round logs its block ID.
9.7 — Close and log. Print:

```
Game: LTR-1 · Order Game · 8 rounds · taught: cfaR subtraction order (LTR-1 a)
Caught 6/8 · misses on: Sign, Scope · block IDs: ltr1.a.fmlbox.3, ltr1.d.trapbox.1
GAME LOG: #3 · LTR-1 · Order Game · taught LTR-1 a · trap cats Sign, Scope · 6/8
```

### Phase 10 — UI, visual quality, and feel

This section is the whole reason the game layer exists. Poor visuals turn a good mechanic into a chore. The bar is: a session should feel like a well-made indie browser game, not like a study tool.

10.1 — Visual identity
- Palette. Use the FRM palette already defined in the .tex preamble: Navy #1B3A5C, Gold #9A6B10, Green #2E7D5B, Red #A63A2E, Paper #F7F5F0, Soft #EDEFF2, Rule #C9D2DB, and the Pale variants. Dark mode swaps Paper for a deep navy and inverts the soft greys.
- Typography. Sans-serif for UI, serif for reading content. Two weights maximum. Line-height generous. Nothing under 14 px anywhere in the UI.
- Spacing. Whitespace is not wasted space. Every surface should feel uncrowded.
- Shape language. Rounded corners on cards, straight edges on grids and axes, sharp corners only on the axes themselves. Consistent across every mechanic.

10.2 — Chart and diagram quality
- Every chart has a title, labelled axes, and a legend if more than one series. No unlabelled lines.
- Every chart has a caption that reads the shape — what the reader should notice, not just what it shows.
- Animation is used for teaching, not decoration. A parameter slider animates the curve smoothly. A tree grows node by node. A waterfall pours left to right.
- TikZ diagrams from the .tex are pre-rendered to SVG at build time and embedded as <img> with a matching caption.
- Hand-drawn curves are replaced with real curves. If the notes show a step function, plot the actual step function, not an idealised sketch.

10.3 — Interaction feel
- Drags snap. To grid cells, to buckets, to tree nodes. Never free-floating where a target exists.
- Correct answers shatter, click, or assemble. The satisfying moment is a small ritual that rewards the right reflex.
- Wrong answers hold for a beat — about 800 ms — with the correct version fading in underneath. Not a harsh buzz. Not a red X. A gentle correction.
- Every draggable has a slight lift on grab and a small shadow trail so the drag feels physical.
- Timing is short. Detection rounds are 3–8 seconds. Structural rounds 15–45 seconds. Explorable sessions 3–5 minutes.

10.4 — Narrative framing. Every session has a fresh presentation shape. Do not use the same frame twice.
- Museum tour — the player walks a gallery of concepts, examining each.
- Night court — the player is a magistrate passing judgment on statements.
- Autopsy room — the player dissects a failed trade or a false statement.
- Heist debrief — the player reconstructs a sequence of moves from the timeline.
- Swearing-in — the player takes an oath and answers on the record.
- Forecast desk — the player sits at a bank desk and calls the direction.
- Signal room — the player reads intercepts and identifies sources.
- Field guide — the player is a naturalist identifying species (concepts) in the wild.

The framing is light — a title screen, a line of context, a closing card. It costs ten minutes of design and turns a mechanic into a small story.

10.5 — Sound. No sound effects. The exam is a quiet room and the sessions should feel like one. However:
- Visual feedback replaces audio feedback entirely. A shatter animation substitutes for a chime.
- Silent gaps are intentional. The beat after a wrong answer is where the learning happens.

10.6 — What not to do
- No confetti. No emojis in the UI. No celebratory microanimations.
- No streaks, XP, levels, badges, points, or leaderboards. The only permissible numbers are stability measurements.
- No card reveals. Nothing one item at a time with a front/back flip.
- No stock illustrations. Every visual is derived from the notes or the session's own mechanic.
- No generic "well done". Say exactly what the player learned, in the notes' terminology.

### Phase 11 — Design discipline

Forbidden outright:
- Streaks, XP, levels, badges, points, leaderboards, confetti, sound effects, motivational nudges.
- Flashcards. Nothing one item at a time with a front/back reveal.
- Runtime LLM calls.
- Invented content. Every statement traces to a block ID.
- Naming before feeling. No terminology, formula, or official name before Phase 8.2.
- Generic visuals. Every diagram is either from the notes or generated as a real chart.

Required:
- A session is a shape — a board, a grid, a tree, a slider, a mesh — not a sequence.
- 4–6 minutes per session.
- Tactile feedback. Per Phase 10.3.
- Dark mode, generous whitespace, comfortable line length. Per Phase 10.1.
- Every session ends with a one-screen summary and a session-log line.
- The only permissible numbers are stability measurements — traps caught/missed by category, sessions played, objectives taught.

### Phase 12 — Rotation and long-term state

12.1 — Session log. Append one line per session, in the format from Phase 9.7, to game-log.md in project knowledge.
12.2 — Coverage tracking. Track which readings have been played and which objectives have been closed by a completed arc. Emit coverage.md on coverage check.
12.3 — Trap accuracy. Track per-category hit rate across sessions. A category missed more than twice in a row is surfaced as the priority for the next session's mechanic choice.
12.4 — Rotation rules.
- The last-played mechanic does not repeat in the next three sessions.
- The last-played reading does not repeat in the next three sessions unless I name it.
- Every fifth session: Concept Inventory — a short test scored by misconception category.
- Every tenth session: Case Docket — fact chips from cross-case pairs.
- Every twentieth session: Coverage View — a full-corpus map showing which objectives have been closed.

12.5 — Quality review every fifth session. Before running the session, briefly report: any mechanic that felt stale, any trap category the player is not improving on, any reading whose mechanics_supported list was wrong. Adjust the rotation accordingly.

### Phase 13 — First session

After Phase 6 completes and I confirm the coverage report, run the first session immediately. Pick the highest-src reading whose mechanics_supported list is longest, and the mechanic with the shortest history (on session one, all of them). State the choice in one line. Build. Run the full arc.
