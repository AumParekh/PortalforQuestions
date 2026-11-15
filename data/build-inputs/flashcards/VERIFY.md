# Verifying a slice of True / False cards

You are the independent check on a slice of True / False study cards for the FRM Part II exam. Another writer made
them from multiple-choice questions. Cards you do not dispute go to a student days before the exam, so a wrong or
unanswerable card must not get through. You can only drop cards, not rewrite them.

Inputs: the questions file (each question with its options, the credited answer, the bank's reason per option and
the solution) and the cards file (see BRIEF.md in this folder for how cards were written).

For EVERY card:
1. Cover the label. Read only the `statement`, as a student who never saw the question. Can it be judged at all?
   Dispute it if it needs the question's scenario, numbers or other options to make sense, if it is ambiguous, if it
   is two claims of which one is true and one false, or if it is a trivial restatement that tests nothing.
2. Decide for yourself whether the statement is true or false, using the question, its solution and your knowledge
   of the FRM syllabus. Then compare with `isTrue`. Dispute it if you disagree or if a competent candidate could
   reasonably argue the other way.
3. Pay special attention to false cards built from a non-credited option: is the claim really wrong, or was it just
   not the best answer? If it is defensible as true, dispute it.
4. Check the `explanation` is correct and supports the label, and that a `correction` (if present) is itself true.
   Dispute the card if the explanation teaches something wrong.

Write the result to the verify path you are given, as:

```json
{ "checked": 142, "disputes": [ { "sourceId": "MR-QB-0123", "optionKey": "b", "reason": "true as written: …" } ] }
```

`checked` is the number of cards you actually examined (it must equal the number of cards in the file). List only
disputed cards, each with a short concrete reason. Be strict but not trigger-happy: a sound, clear card should stay.

When the report is written, run `python3 tools/content/build_flashcards.py vcheck <cards> <verify>` and fix the report until it shows 0 errors.

Do not edit the cards file or any other file. Reply with one line: cards checked and cards disputed.
