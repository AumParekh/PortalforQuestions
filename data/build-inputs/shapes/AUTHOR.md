# Writing a topic file

`topics/<ID>.source.txt` holds everything the sources say about one tier topic. From it you write
`topics/<ID>.json`: the list of **selectors** against which every candidate question will later be judged, plus
the notes a student sees on the topic. `topics/A1.json` and `topics/A2.json` are finished examples; follow their
shape exactly.

## The sources, in the order of the file

1. **Workbook section**: "Specifics reported" (the student's own August 2026 exam recall, where there is one, and
   the Priority Map's quote), "Shapes covered here" (S1, S2, ...), revision notes, formulas, traps.
2. **Workbook index of shapes**: the same shapes with the workbook questions that drill each.
3. **Master LO Map** rows of the topic's readings: each learning objective's band (P1 to P4) and, under it, a line
   such as `WORKBOOK A2 + VARDEEZ FOCUS`, Vardeez's pointer (`▶ Vardeez: ...`), and the shapes pinned to that
   learning objective (`A2·S1 ...`). A reading opens with Vardeez's rating and sometimes a note (`Vardeez: ...`).
   These blocks also list other topics' shapes: ignore pins that do not start with this topic's id.
4. **Cross-Source Priority Map** entries: "what is tested", "specifics reported", sources.
5. **Return on Learning Objective**: rank and action of those entries.

## The file you write

```json
{
 "id": "A2", "tier": "A", "title": "...",
 "returnOnLO": {"rank": 2, "action": "Strike first"},
 "august": "RAROC - 1; Hurdle rate - 1.",
 "maps": [{"number": 3, "sources": "9 of 16", "rating": "Very Important", "tested": "...", "specifics": "..."}],
 "vardeezReading": "...",
 "los": [{"id": "ORR-18 c", "vardeez": "RAROC calculations", "pins": ["S1", "S3"]}, {"id": "ORR-18 d"}],
 "selectors": [{"id": "S1", "name": "...", "source": "...", "seenInAugust": true, "what": "...", "theory": "..."}],
 "notSelected": "...",
 "widerSearch": "RAROC|hurdle rate"
}
```

- `title`, `tier`: from the first line of the source file. `returnOnLO`: the best (lowest) rank in part 5 with its
  action, or `null` if the topic is not ranked. `august`: the text after "Your August 2026 recall:", or `null`.
- `maps`: one entry per Priority Map entry in part 4 (an empty list if none). `tested` and `specifics` are the
  entry's own words, tidied: line breaks and end-of-line hyphens removed, formulas written out in plain text.
- `vardeezReading`: Vardeez's rating and note for each reading, one sentence per reading.
- `los`: every learning objective the workbook section lists on its "Readings:" line, plus any other learning
  objective in part 3 to which one of **this topic's** shapes is pinned. Give `vardeez` where a `▶ Vardeez:` line
  sits under it (the pointer's words), and `pins` with this topic's selector ids pinned there. Ids are written as
  in the Master LO Map: `CR-4 f`.
- `selectors`: see below. `notSelected`: one sentence naming the learning objectives of the topic, or the parts of
  them, that no selector covers; the judges use it to know what is deliberately left out.
- `widerSearch`: a Python regular expression (it is used case-insensitively) of distinctive terms that would find
  questions filed under **other** chapters which are squarely about these selectors (`RAROC|hurdle rate`). Use only
  terms specific to this topic: a model's or a measure's name, never a general word (`capital`, `risk`, `VaR`
  alone). Give `""` when the topic's own learning objectives are its natural and only home.

## Selectors

A selector is one precise thing a question can test. There are three kinds, and nothing else may be added.

**S: the workbook's reported shapes.** One selector per shape in part 2, with the **same number**: the workbook's
questions and the Master LO Map refer to them by that number, so never merge, split, drop or renumber them.
- `name`: at most seven words, plain and recognisable to a student ("UL contribution, identical loans"; "Find the
  hurdle rate"). Start a trap shape's name with "Trap: ".
- `what`: one or two sentences saying what such a question asks or computes, with the formula in plain text where
  there is one. Use the revision notes and formulas to state it correctly.
- `theory` (calculation shapes only): the logic of that same calculation that a question in words could test.
- `seenInAugust`: `true` when the shape or the August recall says it was seen in August 2026; otherwise omit.
- `source`: "workbook shape".

**M: reported in the Priority Map or the August recall, but in no shape.** Add `M1`, `M2`, ... only for a specific
item (a question form, a named calculation, a named comparison) that "what is tested", "specifics reported" or the
August recall states and that none of the S selectors covers. A general remark ("tested numerically more often
than conceptually", "two questions per sitting") is not a selector. `source`: where it is said, quoted briefly.

**V: Vardeez's own pointers, in no shape and no M.** Add `V1`, ... only where a `▶ Vardeez:` pointer or a reading
note names something specific that no S or M selector covers. Two things are **not** selectors:
- a bare `VARDEEZ FOCUS` flag with no pointer under it;
- "complete chapter", "whole chapter", "full chapter important": that says nothing specific. What matters in such
  a chapter is whatever the shapes, the Map and the August recall name.
`source`: Vardeez's words, quoted briefly.

Most topics need no M or V selector: the workbook's shapes were built from the same sources. Do not invent.

## Writing

Plain text everywhere. No LaTeX and no markdown: write formulas with ordinary characters and symbols (`UL x
sqrt(rho)`, `sigma`, `x`, `>=`). The source text was read off a PDF, so formulas in it may be broken across lines or
missing a root or a fraction bar: restore them from the notes and your own knowledge of the formula, and leave out
any formula you cannot restore with confidence.

When you have written the file, run `python3 tools/content/shape_slices.py topiccheck <ID>` and fix whatever it
reports. Write only `topics/<ID>.json`.
