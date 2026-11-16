# Shape matching: which questions belong under a tier topic

A tier topic (for example A1, Unexpected Loss) used to list every question of its learning objectives. It should list
only the questions that practise what was actually reported as examined. You are given one topic and a slice of
candidate questions. For each question decide which of the topic's **selectors** it matches, if any.

## What you read

- `topics/<ID>.json`: the topic. Its `selectors` are the only things a question can match:
  - `S1`, `S2`, ...: reported exam shapes from the Recall + Priority Map workbook.
  - `M1`, ...: points the Cross-Source Priority Map reports for the topic that no numbered shape covers.
  - `V1`, ...: Vardeez's focus points that no numbered shape covers.
  The file also gives the candidate's own August 2026 recall, the Map's notes, the learning objectives with Vardeez's
  pointers, and which selectors the Master LO Map pins to which learning objective.
- `topics/<ID>.notes.txt`: the workbook's revision notes, formulas and traps for the topic (plain text; some formulas
  are broken across lines). Read it first: it tells you what each selector means in the source's own terms.
- `slices/<slice>.json`: the candidates. Each has `id`, `lo`, `loText`, `outside`, `question`, `options`, `answer`,
  `solution` (may be cut short). Read the question, the options, the correct answer and the solution.

## The rule

A question matches a selector when what it tests **is** that selector: the answer turns on that specific calculation,
that specific idea, or that specific trap. Coming from the same chapter, or mentioning the term, is not a match.

1. **Calculation shapes also take their theory.** A question in words that tests the logic of the same specific
   calculation (what goes into it, what moves it and in which direction, what the result means, when it applies)
   matches, with `form: "concept"`.
2. **Variants match.** Different numbers, a different currency or setting, an extra step, a reverse-solve for one of
   the inputs, or the same calculation inside a longer vignette all match (`form: "calculation"`).
3. **Trap shapes match only if the question is built around that trap**: the stem or the options set it (`form:
   "trap"`). A question can match a calculation shape and a trap shape together.
4. **A question may match several selectors.** List each one.
5. **Borderline is no match.** If you have to argue for it, it is out. The questions left out are not lost: they stay
   in the general question library.
6. **`outside: true`** marks a question whose learning objective is not one of the topic's. Hold it to a stricter
   standard: keep it only if it is squarely one of the selectors, as good a drill for it as a question from the
   topic's own chapter.
7. Judge the question, not its label: `lo` can be wrong or broad. A question filed under one of the topic's learning
   objectives that tests something no selector covers is not a match.

## What you write

One JSON file, at the path you are given, holding a list with one entry per question of the slice, in slice order:

```json
[
  {"id": "CR-QB-0123", "matches": [{"selector": "S2", "form": "calculation"}], "reason": "ULC of one loan among identical loans, UL times root rho."},
  {"id": "CR-QB-0124", "matches": [], "reason": "Why the credit loss distribution is skewed: no selector covers it."}
]
```

- `selector`: an id from the topic file. `form`: `calculation`, `concept` or `trap`.
- `reason`: one plain sentence, at most 25 words, saying what the question tests and why it does or does not match.
- Every question of the slice appears exactly once. Write nothing else, and change no other file.

Work through the slice in order and decide each question on its own. Do not aim for any particular share of matches.
