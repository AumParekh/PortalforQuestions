# Build inputs

The agent-written sources the committed content files are built from, kept here so any file can
be rebuilt or corrected without regenerating it.

| Input | Builds | Command |
|---|---|---|
| `formulas/s*.json`, `formula-twins.json`, `enrich/e*.json` | `content/games/formulas.json` | `python3 tools/games/build_formulas.py data/build-inputs/formulas data/build-inputs/formula-twins.json data/build-inputs/enrich` |
| `sense/{bank,notes}-*.json` | `content/games/sensecheck.json` | `python3 tools/games/build_sensecheck.py data/build-inputs/sense` |
| `traps/t*.json` | traps in `content/games/game-blocks.json` | `python3 tools/notes/extract.py` then `python3 tools/notes/merge_traps.py data/build-inputs/traps` |
| `lo-map/FRM_P2_Master_LO_Map_v3.pdf` | `lo-map/lo-map.json` (107 readings, 591 LOs, P1–P4 bands, LO type by wording) | `python3 tools/content/build_lo_map.py` |
| `question-banks/pdf/FRM_Workbook_Vol1_TierA.pdf`, `FRM_Workbook_Vol2_TiersB-D.pdf` | `lo-map/tiers.json` (76 recall-workbook sections, the tier A–D of each LO) | `python3 tools/content/build_tiers.py` |
| `question-banks/pdf/*.pdf`, `question-banks/overrides.json`, `lo-map/lo-map.json`, `lo-map/existing-lo-map.json` | the question-bank and workbook questions in `content/{IR,MR,CR,LR,OR,CI}.json`, and the official LO tags of every question | `python3 tools/content/build_question_bank.py --extract` |

`audit/` is the record of the September 2026 content audit (see `docs/content-audit.md`):
`qbank/<slice>.json` (auditor flags), `<slice>.verified.json` (independent verifier decisions),
`applied-<subject>.json` (what was applied, with the reviewer's check); `twins/` (formula twin
verdicts); `textgames/` (fact-check reports for the eight text-based notes games).

## Question banks and workbooks (November 2026)

`question-banks/pdf/` holds the source PDFs: five question banks (MR, CR, LR, OR, RMIM), six
"Notes + Question" workbooks and the two Current Issues question banks the CI file was first
built from. `tools/content/extract_bank.py` and `extract_workbook.py` read them with
`pdf_layout.py`, which rebuilds what plain text extraction loses (sub- and superscripts,
fractions, roots, tables, glyphs without a Unicode value) and keeps the wording as printed.
Extractor output goes to `question-banks/extracted/` (not committed; `--extract` rebuilds it,
needs `pdfplumber` and poppler's `pdftotext`).

- Every multiple-choice bank question is imported; open-ended ones (no options) are not.
- A workbook question tagged "Bank Q…" repeats a bank question and is skipped; the rest are imported.
- `question-banks/overrides.json`: hand transcriptions for the layouts the extractor cannot express.
- `question-banks/vocab.txt`: words seen in the PDFs, used to tell a hyphenated compound from a
  word broken at a line end.
- LO type (`loKind` on each question: Numerical, Conceptual or Both). The map prints no such label, so
  `build_lo_map.py` reads it off the official wording ("Calculate" / "Describe" / "Define and calculate") and
  `build_question_bank.py` moves a conceptually worded LO to Both when at least 3 and 30% of its questions are
  calculations. `lo-coverage.csv` lists both the final type and the type by wording.
- `question-banks/import-report.json` and `lo-coverage.csv` (questions per official LO) are
  written by the build.
- `lo-map/existing-lo-map.json`: the official LO chosen for each question that was already in
  the portal, with the old label and the reason where the wording did not match exactly.

## Recall tiers (November 2026)

The two Recall + Priority Map volumes (Tier A; Tiers B to D) each carry a "Syllabus map (2026 LOs)"
that lists the official readings and LO letters every section covers. `build_tiers.py` turns it into
`lo-map/tiers.json`; the question-bank build then gives each question its `sections` (the sections
covering its LO) and `recallTier` (the highest of their tiers), and writes the names the portal shows
to `web/src/lib/recallTiers.ts`. Sections the volumes mark as outside the 2026 LOs (B5, D17) are left out.

All 199 questions printed in the two volumes are also printed in the subject workbooks, under their
LO, and reach the bank from there; they carry `recall` (their number in the volumes, e.g. "A13.2").
`extract_recall.py` reads the volumes only so the build can confirm that none is missing.
