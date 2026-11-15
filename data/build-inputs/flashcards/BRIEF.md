# True / False cards from question-bank options

You turn answer options of FRM Part II multiple-choice questions into True / False statements for a study deck.
A student sees ONE statement at a time, with no question, no other options and no scenario, and must judge it
True or False. The exam is days away: a card that teaches something wrong does real harm. When in doubt, leave
the option out.

## Input

A JSON array of questions. Each has `id`, `lo`, `loText` (the learning objective), `chapter`, `question`,
`options` (`key`, `text`, `credited` = the keyed answer, `reason` = the bank's note on that option), `solution`,
and `negativeStem` (a rough guess that the stem asks for the LEAST / NOT / EXCEPT / incorrect choice: read the stem
yourself).

## Output

A JSON array of cards, written to the output path you are given:

```json
{
  "sourceId": "MR-QB-0123",
  "optionKey": "b",
  "statement": "Filtered historical simulation rescales past returns by current volatility before resampling them.",
  "isTrue": true,
  "explanation": "Filtered historical simulation fits a volatility model such as GARCH, standardises past returns by their fitted volatility and rescales them by today's volatility, so the resampled returns reflect current conditions.",
  "originalText": "It fits a time-varying volatility model (e.g., GARCH) and then adjusts historical returns before resampling.",
  "correction": null,
  "changes": null
}
```

- `statement`: one complete sentence that is true or false as a general fact of the syllabus.
- `isTrue`: your own judgement of the statement as you wrote it.
- `explanation`: one to three sentences that teach the point. For a false card say what is actually true. Never
  mention "the option", "the question" or a letter.
- `originalText`: the option exactly as printed, or `null` when the statement is the option unchanged.
- `correction` and `changes` (false cards only, when a small edit makes the statement true): the same sentence with
  the few words changed, and the changed phrases as `[{"from": "would rise", "to": "would fall"}]`. Every `from`
  must appear in the statement and every `to` in the correction. Otherwise `null`.

## Which options become cards

Make a card only when the option, once written as a full sentence, is a standalone claim whose truth does not
depend on the question's scenario.

Skip the option when:
- it is a number, a formula result, a ranking of the scenario's items, or a combination such as "I and II only";
- it is only right or wrong for the particular firm, portfolio, trade or data of the question;
- it is "all of the above", "none of the above", "both A and B";
- it is not credited but is nevertheless a true statement (it was merely not the best answer), or you cannot tell
  whether it is true. Do NOT turn such an option into a false card;
- you would have to guess what the bank meant.

Truth:
- On a normal stem the credited option gives a true card. A non-credited option gives a false card only if the
  claim itself is wrong (the bank's `reason` usually says why).
- On a LEAST / NOT / EXCEPT / incorrect stem it is the other way round: the credited option is the false statement,
  and the others are normally true.
- Judge every statement yourself against the solution and the syllabus. Do not copy the pattern blindly.

Rewording (allowed, and usually needed):
- Fold the stem into the option so the sentence names its subject: stem "Which best describes filtered historical
  simulation?" + option "It rescales past returns…" becomes "Filtered historical simulation rescales past returns…".
- Replace pronouns and "the bank / the analyst / the portfolio above" with the general subject.
- Keep the claim the option makes. Do not add a second claim, do not strengthen or soften it ("always", "never",
  "may") and do not slip the answer into a false statement.
- Keep technical terms, figures and thresholds exactly (e.g. "99.9%", "10-day", "Tier 1").
- An option that opens with It / They / This must be reworded to name its subject, with `originalText` set to
  the option as printed.
- You may drop a side clause of an option that you doubt or that depends on the scenario, as long as what remains
  is a claim the option makes and is clearly true or clearly false.
- Inline math only, as `$...$`. One line, no tables, no bullet lists. Write money as "USD 20 million", never with
  a dollar sign (a `$` starts math).
- 30 to 420 characters. A statement must start with a capital letter and end with a full stop, and must not open
  with It / They / This / These.

Aim for the cards a tutor would actually use: usually one to three per question, none for a pure calculation
question. Quality over count.

## How to work

1. Read this brief, then the whole input file (read it in parts if it is long).
2. Work through the questions in order. Write the output array to the output path. You may write it in several
   passes, but the final file must be one valid JSON array.
3. Run the checker and fix until it reports 0 errors:
   `python3 tools/content/build_flashcards.py check <input> <output>`
   Each `CHECK` line is a card whose truth value disagrees with the credited answer. Re-read that question: keep
   the card only if the stem really is worded the other way round from what the checker assumed; otherwise fix the
   truth value if you mislabelled it, or delete the card.
4. Re-read ten of your cards at random as a student who has never seen the questions. Delete any that cannot be
   judged without the question.

Do not edit any other file. Reply with one line: how many cards from how many questions.
