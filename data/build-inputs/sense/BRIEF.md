# Sense Check scenarios from calculation questions

Sense Check is a 3-minute drill for the FRM Part II exam. Each round shows a short setup and 3 or 4 buttons; the
student must call the direction, the rough size, or an intermediate result BEFORE computing anything exactly. It
trains the instinct that catches a wrong answer (wrong sign, wrong order of magnitude, a step left out).

You turn calculation questions from the question bank into such rounds: at most ONE scenario per question, and
none when the question does not lend itself to it. Read `data/build-inputs/sense/bank-MR1.json` first: it holds
35 finished scenarios in exactly the format and tone wanted.

## Input

A JSON array of questions: `id`, `area`, `lo`, `loText`, `reading`, `reading_id`, `question`, `options`
(`credited` marks the keyed answer) and `solution` (the bank's worked answer).

## Output

A JSON array of scenarios written to the output path you are given. The file name is `<slice>.json` and ids are
`SC-<slice>-01`, `SC-<slice>-02`, … Each scenario:

```json
{
  "id": "SC-bank-MRq01-01",
  "mode": "direction | magnitude | intermediate",
  "area": "<copy from the question>",
  "reading": "<copy from the question>",
  "reading_id": "<copy from the question>",
  "source": { "kind": "bank", "questionId": "<question id>" },
  "trap_category": "Polarity | Sibling | Role | Sign | Scope | Definition | Formula | Intermediate result | Sequence",
  "setup": "the facts, rewritten short (under 700 characters, inline $math$ only, no tables)",
  "ask": "the call to make",
  "options": [ { "label": "…", "correct": true }, { "label": "…", "correct": false, "why": "names the slip that leads here" } ],
  "working": [ { "label": "step name", "display": "$7.23 - 6.95 = +0.28$", "value": 0.28 } ],
  "takeaway": "one line worth remembering",
  "check": { "inputs": { "cM": 7.23, "cB": 6.95 }, "steps": [ { "name": "err", "expr": "cM-cB", "value": 0.28 } ] }
}
```

The three modes:
- **direction**: which way does it move, which is larger, above or below a level, does it rise or fall. 2 or 3
  options. The setup gives the full facts; the answer follows from understanding, with at most a line of arithmetic.
- **magnitude**: "closest to". Exactly 4 numeric options whose leading numbers are pairwise at least 2.5 times
  apart. The three wrong ones must each be a named, plausible slip (forgot the square root of time, daily instead
  of annual, variance instead of volatility, percent as decimal, one leg omitted), not random numbers. Do not
  reuse the bank's own answer options when they are closer than 2.5 times: the point is order of magnitude.
- **intermediate**: the sign or size of an intermediate or residual in a partly done chain ("is the discount
  factor above or below 0.9?", "which term dominates?"). 2 to 4 options.

Use the mode that suits the question; over a slice aim for a mix of the three.

Rules:
- Exactly one correct option. Every wrong option has a `why` that says which mistake produces it.
- Do not copy the bank's wording of the question: restate the facts compactly in your own words, keeping every
  number that matters and its unit. You may simplify the numbers only if the scenario then no longer claims to be
  the bank's.
- `working`: the solution path in 1 to 6 named steps; `display` is what the student sees (inline math), `value`
  the number or `null`.
- `check`: every magnitude and intermediate scenario, and every direction scenario whose working shows numbers,
  needs a chain that recomputes the answer from `inputs`. `expr` is plain arithmetic over the input names and
  earlier step names, with `sqrt`, `exp`, `log`/`ln`, `abs`, `min`, `max` and `^` or `**` for powers. Each
  `value` must match the expression within 0.5%. Recompute everything yourself: the bank's printed solution can
  contain slips, and if your number disagrees with the keyed answer, skip that question.
- The correct option must be right by your own computation, and no wrong option may be defensible.
- Magnitude rounds: the 2.5 times rule is measured on the numbers as shown in the labels (after rounding). When
  the realistic slips land too close to the truth, a labelled scale slip (10 times, 1/100) is acceptable for one
  or two of the wrong options. The correct value must be a positive number: if the answer is negative, or its sign
  is the point, write a direction or intermediate round instead.
- The bank repeats some calculations with different numbers. Within your slice, do not write the same kind of
  round twice on the same formula: change the mode (direction, then magnitude, then an intermediate step) or skip
  the repeat.
- Put the slips you name in `why` into the check chain as extra steps (e.g. `slip_no_sqrt`), so they are recomputed too.
- Skip a question that needs a table too long to restate, a normal-table lookup the student cannot do by eye, or
  whose answer you cannot reproduce.

## How to work

1. Read this brief and the examples, then the whole input file.
2. Write the scenarios to the output path (one valid JSON array).
3. Run the checker and fix until it reports 0 errors:
   `python3 tools/games/sense_slices.py check <input> <output>`
4. Re-read five scenarios as a student: is the setup readable in ten seconds, and is the answer unarguable?

Do not edit any other file. Reply with one line: how many scenarios from how many questions.
