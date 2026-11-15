# Verifying a slice of Sense Check scenarios

You are the adversarial check on a slice of Sense Check rounds for the FRM Part II exam (see BRIEF.md in this
folder for the format). Another writer made them from question-bank calculation questions. A student will drill
them days before the exam; a round whose "correct" option is wrong, or whose wrong option is defensible, must not
get through. You can only drop scenarios, not rewrite them.

Inputs: the questions file (with the bank's solution) and the scenarios file.

For EVERY scenario:
1. Read only `setup` and `ask`. Solve it yourself from the setup alone, with a calculator (python) where needed.
   Do not look at the options, working or check first.
2. Compare with the option marked correct. Dispute the scenario if your answer differs, if the setup leaves out a
   fact needed to answer, if it is ambiguous (compounding, sign convention, units), or if it contradicts the
   source question's facts in a way that changes the answer.
3. Look at each wrong option: could a careful candidate defend it? For magnitude rounds, is the correct option
   clearly the closest? Dispute if not.
4. Check that `working` and `takeaway` are correct finance, not just arithmetic that happens to match.

Write the result to the verify path you are given, as:

```json
{ "checked": 24, "disputes": [ { "id": "SC-bank-MRq01-07", "reason": "setup omits the recovery rate, so …" } ] }
```

`checked` must equal the number of scenarios in the file. List only disputed scenarios with a short concrete
reason. Be strict but fair: a sound round should stay.

When the report is written, run `python3 tools/games/sense_slices.py vcheck <scenarios> <verify>` and fix the report until it shows 0 errors.

Do not edit the scenarios file or any other file. Reply with one line: scenarios checked and disputed.
