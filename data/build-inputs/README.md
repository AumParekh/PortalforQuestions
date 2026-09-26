# Build inputs

The agent-written sources the committed content files are built from, kept here so any file can
be rebuilt or corrected without regenerating it.

| Input | Builds | Command |
|---|---|---|
| `formulas/s*.json`, `formula-twins.json`, `enrich/e*.json` | `content/games/formulas.json` | `python3 tools/games/build_formulas.py data/build-inputs/formulas data/build-inputs/formula-twins.json data/build-inputs/enrich` |
| `sense/{bank,notes}-*.json` | `content/games/sensecheck.json` | `python3 tools/games/build_sensecheck.py data/build-inputs/sense` |
| `traps/t*.json` | traps in `content/games/game-blocks.json` | `python3 tools/notes/extract.py` then `python3 tools/notes/merge_traps.py data/build-inputs/traps` |

`audit/` is the record of the September 2026 content audit (see `docs/content-audit.md`):
`qbank/<slice>.json` (auditor flags), `<slice>.verified.json` (independent verifier decisions),
`applied-<subject>.json` (what was applied, with the reviewer's check); `twins/` (formula twin
verdicts); `textgames/` (fact-check reports for the eight text-based notes games).
