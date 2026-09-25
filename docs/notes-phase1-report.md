# Notes → Games — Phase 1 report: inventory, schema audit, content census

Source: `notes/FRM_Consolidated_Vol1` (CR, ORR, CI) and `notes/FRM_Consolidated_Vol2` (MR, LTR, IM). Counts come from `tools/notes/census.py` (deterministic) and were hand-checked by three audit agents on six sample files. **Known census over-counts** (fixed in the Phase 2–6 extractor, whose numbers supersede these): prose paragraphs are inflated ~40% by continuation lines of multi-line captions/notes/LO titles; `\subsection*` headings were missed in CR/CI; header rows are under-detected in IM, CI and LTR; tables nested inside boxes are counted twice; `\vk` variables are counted by `=` segments, which misses IM's sentence-style keys.

## 1.1 File list

107 reading files, one reading per file. No chapter file is a consolidated multi-area volume; the *volumes* are the two `master.tex` builds (Vol 1 = CR+ORR+CI, 55 readings; Vol 2 = MR+LTR+IM, 52 readings). The source zip for Vol 1 contained two identical copies (`FRM_Consolidated/` and `FRM_Consolidated_Vol1/`; chapters byte-identical, preamble differs only in font ligatures and title alignment) — only one copy is kept.

| File | Area | Reading | Bytes | Lines | Opener |
|---|---|---|---:|---:|---|
| `FRM_Consolidated_Vol2/ch/26_MR_MR1.tex` | MR | MR-1 | 22,517 | 485 | `\reading` |
| `FRM_Consolidated_Vol2/ch/27_MR_MR2.tex` | MR | MR-2 | 17,979 | 354 | `\reading` |
| `FRM_Consolidated_Vol2/ch/29_MR_MR3.tex` | MR | MR-3 | 17,458 | 347 | `\reading` |
| `FRM_Consolidated_Vol2/ch/35_MR_MR4.tex` | MR | MR-4 | 16,358 | 342 | `\reading` |
| `FRM_Consolidated_Vol2/ch/36_MR_MR5.tex` | MR | MR-5 | 21,283 | 440 | `\reading` |
| `FRM_Consolidated_Vol2/ch/34_MR_MR6.tex` | MR | MR-6 | 16,698 | 322 | `\reading` |
| `FRM_Consolidated_Vol2/ch/37_MR_MR7.tex` | MR | MR-7 | 32,064 | 605 | `\reading` |
| `FRM_Consolidated_Vol2/ch/20_MR_MR8.tex` | MR | MR-8 | 29,824 | 596 | `\reading` |
| `FRM_Consolidated_Vol2/ch/48_MR_MR9.tex` | MR | MR-9 | 15,857 | 331 | `\reading` |
| `FRM_Consolidated_Vol2/ch/49_MR_MR10.tex` | MR | MR-10 | 19,365 | 385 | `\reading` |
| `FRM_Consolidated_Vol2/ch/30_MR_MR11.tex` | MR | MR-11 | 21,568 | 426 | `\reading` |
| `FRM_Consolidated_Vol2/ch/44_MR_MR12.tex` | MR | MR-12 | 24,583 | 478 | `\reading` |
| `FRM_Consolidated_Vol2/ch/50_MR_MR13.tex` | MR | MR-13 | 18,839 | 389 | `\reading` |
| `FRM_Consolidated_Vol2/ch/21_MR_MR14.tex` | MR | MR-14 | 25,339 | 513 | `\reading` |
| `FRM_Consolidated_Vol2/ch/22_MR_MR15.tex` | MR | MR-15 | 19,740 | 403 | `\reading` |
| `FRM_Consolidated_Vol2/ch/51_MR_MR16.tex` | MR | MR-16 | 18,726 | 375 | `\reading` |
| `FRM_Consolidated_Vol2/ch/09_MR_MR17.tex` | MR | MR-17 | 26,782 | 538 | `\reading` |
| `FRM_Consolidated_Vol2/ch/11_MR_MR18.tex` | MR | MR-18 | 24,861 | 488 | `\reading` |
| `FRM_Consolidated_Vol1/ch/47_CR_CR1.tex` | CR | CR-1 | 14,636 | 282 | `\reading` |
| `FRM_Consolidated_Vol1/ch/48_CR_CR2.tex` | CR | CR-2 | 10,679 | 211 | `\reading` |
| `FRM_Consolidated_Vol1/ch/49_CR_CR3.tex` | CR | CR-3 | 23,243 | 454 | `\reading` |
| `FRM_Consolidated_Vol1/ch/06_CR_CR4.tex` | CR | CR-4 | 23,827 | 490 | `\reading` |
| `FRM_Consolidated_Vol1/ch/02_CR_CR5.tex` | CR | CR-5 | 30,866 | 603 | `\reading` |
| `FRM_Consolidated_Vol1/ch/14_CR_CR6.tex` | CR | CR-6 | 16,626 | 333 | `\reading` |
| `FRM_Consolidated_Vol1/ch/45_CR_CR7.tex` | CR | CR-7 | 14,182 | 293 | `\reading` |
| `FRM_Consolidated_Vol1/ch/50_CR_CR8.tex` | CR | CR-8 | 17,476 | 320 | `\reading` |
| `FRM_Consolidated_Vol1/ch/15_CR_CR9.tex` | CR | CR-9 | 35,507 | 743 | `\reading` |
| `FRM_Consolidated_Vol1/ch/26_CR_CR10.tex` | CR | CR-10 | 12,572 | 256 | `\reading` |
| `FRM_Consolidated_Vol1/ch/27_CR_CR11.tex` | CR | CR-11 | 15,430 | 319 | `\reading` |
| `FRM_Consolidated_Vol1/ch/16_CR_CR12.tex` | CR | CR-12 | 11,622 | 221 | `\reading` |
| `FRM_Consolidated_Vol1/ch/46_CR_CR13.tex` | CR | CR-13 | 18,154 | 402 | `\reading` |
| `FRM_Consolidated_Vol1/ch/51_CR_CR14.tex` | CR | CR-14 | 21,270 | 424 | `\reading` |
| `FRM_Consolidated_Vol1/ch/53_CR_CR15.tex` | CR | CR-15 | 15,912 | 314 | `\reading` |
| `FRM_Consolidated_Vol1/ch/37_CR_CR16.tex` | CR | CR-16 | 13,382 | 303 | `\reading` |
| `FRM_Consolidated_Vol1/ch/36_CR_CR17.tex` | CR | CR-17 | 17,540 | 366 | `\reading` |
| `FRM_Consolidated_Vol1/ch/52_CR_CR18.tex` | CR | CR-18 | 12,532 | 273 | `\reading` |
| `FRM_Consolidated_Vol1/ch/41_CR_CR19.tex` | CR | CR-19 | 22,956 | 481 | `\reading` |
| `FRM_Consolidated_Vol1/ch/17_CR_CR20.tex` | CR | CR-20 | 24,916 | 525 | `\reading` |
| `FRM_Consolidated_Vol1/ch/42_CR_CR21.tex` | CR | CR-21 | 10,524 | 207 | `\reading` |
| `FRM_Consolidated_Vol1/ch/22_CR_CR22.tex` | CR | CR-22 | 26,336 | 524 | `\reading` |
| `FRM_Consolidated_Vol1/ch/23_CR_CR23.tex` | CR | CR-23 | 23,531 | 475 | `\reading` |
| `FRM_Consolidated_Vol1/ch/13_OR_ORR1.tex` | ORR | ORR-1 | 9,388 | 191 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/07_OR_ORR2.tex` | ORR | ORR-2 | 10,011 | 209 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/28_OR_ORR3.tex` | ORR | ORR-3 | 14,878 | 303 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/32_OR_ORR4.tex` | ORR | ORR-4 | 22,246 | 510 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/29_OR_ORR5.tex` | ORR | ORR-5 | 14,278 | 334 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/30_OR_ORR6.tex` | ORR | ORR-6 | 11,570 | 213 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/54_OR_ORR7.tex` | ORR | ORR-7 | 10,043 | 225 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/08_OR_ORR8.tex` | ORR | ORR-8 | 11,319 | 270 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/09_OR_ORR9.tex` | ORR | ORR-9 | 6,005 | 146 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/33_OR_ORR10.tex` | ORR | ORR-10 | 6,893 | 163 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/34_OR_ORR11.tex` | ORR | ORR-11 | 5,283 | 120 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/18_OR_ORR12.tex` | ORR | ORR-12 | 6,743 | 140 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/19_OR_ORR13.tex` | ORR | ORR-13 | 4,696 | 105 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/35_OR_ORR14.tex` | ORR | ORR-14 | 3,802 | 87 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/20_OR_ORR15.tex` | ORR | ORR-15 | 6,356 | 151 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/21_OR_ORR16.tex` | ORR | ORR-16 | 4,446 | 103 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/43_OR_ORR17.tex` | ORR | ORR-17 | 7,296 | 151 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/01_OR_ORR18.tex` | ORR | ORR-18 | 11,358 | 283 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/44_OR_ORR19.tex` | ORR | ORR-19 | 22,480 | 466 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/31_OR_ORR20.tex` | ORR | ORR-20 | 8,544 | 164 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/10_OR_ORR21.tex` | ORR | ORR-21 | 23,414 | 550 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/55_OR_ORR22.tex` | ORR | ORR-22 | 15,176 | 335 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/11_OR_ORR23.tex` | ORR | ORR-23 | 5,434 | 119 | `\chapterhead` |
| `FRM_Consolidated_Vol1/ch/12_OR_ORR24.tex` | ORR | ORR-24 | 6,588 | 168 | `\chapterhead` |
| `FRM_Consolidated_Vol2/ch/01_LR_LTR1.tex` | LTR | LTR-1 | 19,699 | 295 | `\reading` |
| `FRM_Consolidated_Vol2/ch/39_LR_LTR2.tex` | LTR | LTR-2 | 28,123 | 350 | `\reading` |
| `FRM_Consolidated_Vol2/ch/12_LR_LTR3.tex` | LTR | LTR-3 | 16,079 | 200 | `\reading` |
| `FRM_Consolidated_Vol2/ch/38_LR_LTR4.tex` | LTR | LTR-4 | 16,688 | 273 | `\reading` |
| `FRM_Consolidated_Vol2/ch/40_LR_LTR5.tex` | LTR | LTR-5 | 16,989 | 246 | `\reading` |
| `FRM_Consolidated_Vol2/ch/41_LR_LTR6.tex` | LTR | LTR-6 | 9,565 | 138 | `\reading` |
| `FRM_Consolidated_Vol2/ch/13_LR_LTR7.tex` | LTR | LTR-7 | 28,027 | 388 | `\reading` |
| `FRM_Consolidated_Vol2/ch/42_LR_LTR8.tex` | LTR | LTR-8 | 14,229 | 177 | `\reading` |
| `FRM_Consolidated_Vol2/ch/14_LR_LTR9.tex` | LTR | LTR-9 | 19,958 | 236 | `\reading` |
| `FRM_Consolidated_Vol2/ch/15_LR_LTR10.tex` | LTR | LTR-10 | 14,361 | 201 | `\reading` |
| `FRM_Consolidated_Vol2/ch/43_LR_LTR11.tex` | LTR | LTR-11 | 15,234 | 184 | `\reading` |
| `FRM_Consolidated_Vol2/ch/16_LR_LTR12.tex` | LTR | LTR-12 | 19,913 | 265 | `\reading` |
| `FRM_Consolidated_Vol2/ch/17_LR_LTR13.tex` | LTR | LTR-13 | 25,328 | 288 | `\reading` |
| `FRM_Consolidated_Vol2/ch/18_LR_LTR14.tex` | LTR | LTR-14 | 13,533 | 154 | `\reading` |
| `FRM_Consolidated_Vol2/ch/52_LR_LTR15.tex` | LTR | LTR-15 | 12,721 | 155 | `\reading` |
| `FRM_Consolidated_Vol2/ch/19_LR_LTR16.tex` | LTR | LTR-16 | 12,427 | 164 | `\reading` |
| `FRM_Consolidated_Vol2/ch/03_LR_LTR17.tex` | LTR | LTR-17 | 28,212 | 383 | `\reading` |
| `FRM_Consolidated_Vol2/ch/05_IM_IM1.tex` | IM | IM-1 | 19,553 | 391 | `\reading` |
| `FRM_Consolidated_Vol2/ch/06_IM_IM2.tex` | IM | IM-2 | 18,031 | 361 | `\reading` |
| `FRM_Consolidated_Vol2/ch/07_IM_IM3.tex` | IM | IM-3 | 25,392 | 488 | `\reading` |
| `FRM_Consolidated_Vol2/ch/46_IM_IM4.tex` | IM | IM-4 | 18,371 | 353 | `\reading` |
| `FRM_Consolidated_Vol2/ch/04_IM_IM5.tex` | IM | IM-5 | 31,759 | 671 | `\reading` |
| `FRM_Consolidated_Vol2/ch/10_IM_IM6.tex` | IM | IM-6 | 19,168 | 385 | `\reading` |
| `FRM_Consolidated_Vol2/ch/08_IM_IM7.tex` | IM | IM-7 | 21,268 | 395 | `\reading` |
| `FRM_Consolidated_Vol2/ch/23_IM_IM8.tex` | IM | IM-8 | 23,708 | 448 | `\reading` |
| `FRM_Consolidated_Vol2/ch/47_IM_IM9.tex` | IM | IM-9 | 18,399 | 309 | `\reading` |
| `FRM_Consolidated_Vol2/ch/28_IM_IM10.tex` | IM | IM-10 | 14,701 | 195 | `\reading` |
| `FRM_Consolidated_Vol2/ch/31_IM_IM11.tex` | IM | IM-11 | 21,325 | 299 | `\reading` |
| `FRM_Consolidated_Vol2/ch/24_IM_IM12.tex` | IM | IM-12 | 16,111 | 259 | `\reading` |
| `FRM_Consolidated_Vol2/ch/32_IM_IM13.tex` | IM | IM-13 | 9,439 | 151 | `\reading` |
| `FRM_Consolidated_Vol2/ch/25_IM_IM14.tex` | IM | IM-14 | 5,823 | 87 | `\reading` |
| `FRM_Consolidated_Vol2/ch/45_IM_IM15.tex` | IM | IM-15 | 9,554 | 151 | `\reading` |
| `FRM_Consolidated_Vol2/ch/02_IM_IM16.tex` | IM | IM-16 | 14,464 | 251 | `\reading` |
| `FRM_Consolidated_Vol2/ch/33_IM_IM17.tex` | IM | IM-17 | 13,848 | 258 | `\reading` |
| `FRM_Consolidated_Vol1/ch/03_CI_CI1.tex` | CI | CI-1 | 25,832 | 493 | `\reading` |
| `FRM_Consolidated_Vol1/ch/04_CI_CI2.tex` | CI | CI-2 | 21,499 | 405 | `\reading` |
| `FRM_Consolidated_Vol1/ch/24_CI_CI3.tex` | CI | CI-3 | 17,136 | 328 | `\reading` |
| `FRM_Consolidated_Vol1/ch/05_CI_CI4.tex` | CI | CI-4 | 17,910 | 364 | `\reading` |
| `FRM_Consolidated_Vol1/ch/25_CI_CI5.tex` | CI | CI-5 | 19,000 | 361 | `\reading` |
| `FRM_Consolidated_Vol1/ch/38_CI_CI6.tex` | CI | CI-6 | 16,318 | 307 | `\reading` |
| `FRM_Consolidated_Vol1/ch/39_CI_CI7.tex` | CI | CI-7 | 23,095 | 448 | `\reading` |
| `FRM_Consolidated_Vol1/ch/40_CI_CI8.tex` | CI | CI-8 | 12,532 | 241 | `\reading` |

**Total:** 107 files, 1,837,129 bytes, 34,638 lines. Per area: MR 18, CR 23, ORR 24, LTR 17, IM 17, CI 8 (matches the expected MR 18, LTR 17, IM 17, ORR 24, CR 23, CI 8).

## 1.2 Structural macro survey

**Reading openers**
- `\reading{#1 id}{#2 title}{#3 tag}{#4 SRC}` — MR, CR, LTR, IM, CI (83 files). Example: `\reading{LTR-1}{Liquidity Risk}{STRIKE FIRST}{6}` → id LTR-1, title Liquidity Risk, tag STRIKE FIRST (legacy; the printed tag comes from `\setchapctx` in master.tex), SRC 6. MR writes the tag lowercase (strike/grind/defer), IM uppercase.
- `\chapterhead{#1 no}{#2 id}{#3 title}{#4 cat}{#5 SRC}` — ORR (24 files). Example: `\chapterhead{57}{ORR-18}{Risk Capital Attribution and Risk-Adjusted Performance Measurement}{1}{9}` → legacy reading no 57, id ORR-18, title, category 1, SRC 9 (last argument).

**Objective openers**
- `\lo{#1 "AREA-N letter"}{#2 verbatim LO text}` — all areas except ORR. Example: `\lo{LTR-1 a}{Explain and calculate liquidity trading risk via cost of liquidation and liquidity-adjusted VaR (LVaR).}`. In MR/IM the `\lo` count equals the LO-list `\item` count in every file.
- `\lohead[#0 alt]{#1 no}{#2 letter}{#3 text}` — ORR. Example: `\lohead{57}{a}{Define, compare, and contrast risk capital, economic capital, and regulatory capital, …}` → reading no 57, letter a.
- Pre-LO sections: `\section{Basics}` (MR1, MR2, MR6, MR16) and `\basics{…}` (IM5, IM2, IM12); one post-LO `\section{Summary of all the term structure models}` (MR15, spanning MR-14 and MR-15).

**Sub-structure:** `\subsection`/`\subsection*` (CR/CI use the starred form), `\subsubsection`, ORR `\orsub{}` (= subsection) and `\orsubb{}` (run-in heading, often a term followed by a one-line definition).

## 1.3 Alias table

| Canonical type | Environments / macros found |
|---|---|
| keybox | mrkeybox 84, lrkeybox 65, imkeybox 64, crkeybox 55, orkeybox 32, cikeybox 17 |
| trapbox | lrtrapbox 112, imtrapbox 72, crtrapbox 49, mrtrapbox 42, citrapbox 6, lrtrapboxnb 1 |
| defbox | crdefbox 34, mrdefbox 28, lrdefbox 22, imdefbox 21, ordefbox 12, cidefbox 8 |
| fmlbox | mrfmlbox 66, crfmlbox 55, imfmlbox 33, lrfmlbox 24 (ORR has none: its formulas sit in untitled `orkeybox`es — retyped to fmlbox by content) |
| exbox | mrexbox 49, crexbox 32, orexambox 22, imexbox 18, lrexbox 15 (10 ORR `orexambox` are takeaways/lessons, retyped to keybox) |
| gapbox | crgapbox 14, lrgapbox 12, imgapbox 7, mrgapbox 6, plus `\gapbadge` (45) and `\gapnote` (15) scopes |
| figcap | `\figcap` (CR, CI, MR, IM, LTR), `\orfigcap` (ORR, auto-numbered), `\figwrap{img}{caption}` (IM, Vol 2) |
| table | tabularx 170, tabular 111, longtable 10 (tabular inside tikz nodes excluded; tables nested in boxes become children of the box) |
| prose_para | narrative text outside all of the above (containers `center`, `minipage`, `cifigblock` are descended into) |
| **tikzpicture** (added) | tikzpicture 201 top-level (+ pgfplots `axis`, `scope` inside) |
| **notebox** (added, §3c) | ornotebox 18 (ORR; titles Remember ×4, Note, Outcome, Source note, About this chapter, list-type Weaknesses/Limitations/Challenges/…, fact-type) |

Other constructs: `cisrcbox` (2, CI editorial/provenance note → source_notes); `cifigblock` (28, a minipage wrapper holding one figure/table + caption → container); list environments `itemize`, `enumerate`, `lettered`, `checks` (bullets); `\schweserbadge` (1 use, CI3: provenance "sourced one rung below a GARP book"); `\srcnote`, `\greyline`, `\note` (source/meta text); notation keys `\vk{…}` (IM, LTR, CR) and `\mrvk{key}{remark}` (MR).

**Unresolved macros:** none that block extraction. Standard-but-not-in-preamble symbols are mapped: `\euro`/`\texteuro` → €, `\checkmark` → ✓, `\blacktriangleright` → ▸; `\rowcolor`/`\cellcolor`/`\arrayrulecolor` (colortbl) are stripped; single-letter "macros" (`\x \i \p \c \t \b …`) are pgf `\foreach` loop variables inside TikZ, not commands.

## 1.4 Content census by block type (per area)

| Area | Readings | defbox | fmlbox | exbox | trapbox | keybox | gapbox | table | figcap | prose_para | tikzpicture | notebox |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| MR | 18 | 28 | 66 | 49 | 42 | 84 | 6 | 57 | 92 | 230 | 81 | 0 |
| CR | 23 | 34 | 55 | 32 | 49 | 55 | 14 | 78 | 85 | 310 | 34 | 0 |
| ORR | 24 | 12 | 0 | 22 | 0 | 32 | 0 | 47 | 75 | 153 | 30 | 18 |
| LTR | 17 | 22 | 24 | 15 | 113 | 65 | 12 | 59 | 32 | 50 | 10 | 0 |
| IM | 17 | 21 | 33 | 18 | 72 | 64 | 7 | 34 | 51 | 198 | 22 | 0 |
| CI | 8 | 8 | 0 | 0 | 6 | 17 | 0 | 16 | 38 | 88 | 24 | 0 |
| **Total** | 107 | 125 | 178 | 136 | 282 | 317 | 39 | 291 | 373 | 1029 | 201 | 18 |

**Out-of-proportion signals, explained by the audit:**
- ORR: 0 fmlbox / trapbox / gapbox / `\term` / `\vk` — ORR writes formulas in untitled orkeyboxes, marks terms with bold item lead-ins (202), bold first-column table cells (146) and `\orsubb`, has no trap marker at all (traps must be mined from content), and marks gap-fills with `ornotebox{Source note}`. 11% of ORR's words sit inside TikZ node labels (risk weights, capital tiers, three pillars) and are extracted as figure text.
- Only LTR and IM end readings with a "Consolidated trap summary"; MR, CR and CI traps are free-text trap boxes without category words, and ~14 CR trap boxes plus ~31 LTR/IM ones are source/meta notes ("Single-layer reading", numbering, corrections) rather than exam traps.
- IM: 33 fmlbox but 2 `=`-style variables — IM notation keys are sentences ("$P$ is portfolio value, $P_i$ the nominal amount…"), parsed by pattern in the extractor. IM emphasis is `\term`/`\emph`, never `\textbf` in prose.
- LTR: 113 trap boxes vs ~50 prose paragraphs — genuinely box-built (by words: trapbox 24%, tables 19%, keybox 16%); numbers live in examples (147) and traps (100), not prose.
- CI: no formulas or worked examples (qualitative readings), as expected.

## 1.5 Content census within blocks (per reading)

Heuristics: numbers = a figure next to %/bp/million/billion/currency; comparisons = vs/versus/whereas/unlike/compared with/rather than/in contrast/as opposed to/instead of; directional = higher/lower/before/after/rise(s)/fall(s) and past forms; actors = a fixed list of institutional roles (bank, dealer, investor, counterparty, CCP, regulator, board, first/second/third line, …). "Prose" metrics are inflated where the census leaked caption continuation lines (see top).

| Reading | terms | bold | numbers | compar. | direct. | actors | vk vars | tbl rows | bullets | captions | headings |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| MR-1 | 13 | 2 | 4 | 1 | 2 | 0 | 19 | 17 | 28 | 3 | 14 |
| MR-2 | 21 | 1 | 4 | 1 | 4 | 0 | 7 | 9 | 24 | 5 | 10 |
| MR-3 | 10 | 0 | 0 | 0 | 1 | 0 | 11 | 7 | 32 | 5 | 13 |
| MR-4 | 28 | 0 | 0 | 0 | 1 | 0 | 14 | 9 | 34 | 3 | 10 |
| MR-5 | 23 | 0 | 2 | 2 | 0 | 0 | 3 | 32 | 28 | 7 | 13 |
| MR-6 | 34 | 1 | 0 | 0 | 2 | 3 | 7 | 7 | 54 | 0 | 19 |
| MR-7 | 16 | 1 | 7 | 4 | 1 | 0 | 14 | 12 | 26 | 9 | 15 |
| MR-8 | 24 | 0 | 4 | 0 | 3 | 3 | 17 | 30 | 39 | 6 | 20 |
| MR-9 | 21 | 0 | 7 | 0 | 2 | 0 | 7 | 8 | 10 | 8 | 9 |
| MR-10 | 5 | 0 | 0 | 0 | 0 | 0 | 11 | 20 | 11 | 5 | 11 |
| MR-11 | 28 | 0 | 4 | 1 | 1 | 5 | 10 | 14 | 25 | 5 | 10 |
| MR-12 | 35 | 0 | 7 | 0 | 4 | 1 | 1 | 8 | 26 | 4 | 19 |
| MR-13 | 12 | 0 | 10 | 0 | 0 | 0 | 5 | 4 | 12 | 4 | 8 |
| MR-14 | 28 | 0 | 3 | 1 | 2 | 0 | 12 | 11 | 37 | 6 | 14 |
| MR-15 | 24 | 0 | 2 | 1 | 2 | 0 | 10 | 12 | 22 | 4 | 15 |
| MR-16 | 23 | 0 | 0 | 1 | 3 | 1 | 5 | 19 | 19 | 5 | 9 |
| MR-17 | 27 | 3 | 0 | 4 | 9 | 2 | 6 | 7 | 17 | 6 | 12 |
| MR-18 | 23 | 2 | 3 | 0 | 3 | 1 | 5 | 24 | 7 | 7 | 13 |
| **MR total** | **395** | **10** | **57** | **16** | **40** | **16** | **164** | **250** | **451** | **92** | **234** |
| CR-1 | 32 | 0 | 0 | 0 | 2 | 2 | 0 | 14 | 36 | 2 | 5 |
| CR-2 | 24 | 3 | 1 | 2 | 0 | 1 | 0 | 3 | 29 | 1 | 5 |
| CR-3 | 40 | 0 | 1 | 0 | 1 | 8 | 3 | 6 | 62 | 5 | 10 |
| CR-4 | 21 | 0 | 1 | 0 | 5 | 4 | 10 | 5 | 19 | 2 | 9 |
| CR-5 | 35 | 0 | 5 | 0 | 2 | 13 | 20 | 20 | 38 | 5 | 7 |
| CR-6 | 29 | 0 | 0 | 1 | 3 | 9 | 1 | 9 | 38 | 3 | 4 |
| CR-7 | 27 | 0 | 0 | 0 | 2 | 8 | 2 | 9 | 33 | 3 | 8 |
| CR-8 | 41 | 0 | 0 | 0 | 2 | 1 | 0 | 7 | 43 | 3 | 7 |
| CR-9 | 31 | 3 | 5 | 1 | 5 | 8 | 10 | 22 | 36 | 7 | 14 |
| CR-10 | 17 | 1 | 1 | 0 | 0 | 0 | 5 | 14 | 12 | 4 | 6 |
| CR-11 | 9 | 0 | 2 | 1 | 0 | 0 | 6 | 4 | 15 | 2 | 8 |
| CR-12 | 11 | 1 | 0 | 0 | 0 | 7 | 7 | 4 | 12 | 2 | 7 |
| CR-13 | 21 | 2 | 3 | 0 | 2 | 5 | 7 | 15 | 26 | 2 | 8 |
| CR-14 | 34 | 0 | 0 | 0 | 4 | 16 | 0 | 21 | 35 | 5 | 10 |
| CR-15 | 45 | 1 | 0 | 0 | 1 | 6 | 0 | 17 | 33 | 5 | 8 |
| CR-16 | 18 | 2 | 1 | 0 | 2 | 10 | 0 | 18 | 21 | 2 | 6 |
| CR-17 | 30 | 1 | 0 | 0 | 1 | 3 | 0 | 18 | 32 | 2 | 11 |
| CR-18 | 19 | 1 | 0 | 0 | 0 | 10 | 0 | 19 | 29 | 4 | 10 |
| CR-19 | 26 | 0 | 2 | 0 | 8 | 3 | 5 | 24 | 33 | 8 | 9 |
| CR-20 | 31 | 0 | 4 | 2 | 1 | 9 | 0 | 24 | 27 | 7 | 17 |
| CR-21 | 19 | 2 | 0 | 0 | 0 | 1 | 0 | 7 | 19 | 2 | 8 |
| CR-22 | 40 | 0 | 0 | 0 | 10 | 3 | 4 | 20 | 27 | 6 | 13 |
| CR-23 | 38 | 0 | 1 | 0 | 3 | 3 | 2 | 24 | 23 | 3 | 8 |
| **CR total** | **638** | **17** | **27** | **7** | **54** | **130** | **82** | **324** | **678** | **85** | **198** |
| ORR-1 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 12 | 8 | 3 | 8 |
| ORR-2 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 11 | 11 | 4 | 8 |
| ORR-3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 7 | 22 | 5 | 15 |
| ORR-4 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 10 | 34 | 10 | 25 |
| ORR-5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 13 | 27 | 7 | 27 |
| ORR-6 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 9 | 28 | 3 | 10 |
| ORR-7 | 0 | 1 | 0 | 0 | 3 | 1 | 0 | 9 | 8 | 5 | 20 |
| ORR-8 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 4 | 43 | 2 | 29 |
| ORR-9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 19 | 2 | 12 |
| ORR-10 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 1 | 40 | 1 | 14 |
| ORR-11 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 16 | 1 | 8 |
| ORR-12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 23 | 10 | 2 | 10 |
| ORR-13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 2 | 6 |
| ORR-14 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 6 | 8 | 2 | 6 |
| ORR-15 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 28 | 1 | 13 |
| ORR-16 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | 5 | 1 | 10 |
| ORR-17 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 9 | 13 | 2 | 9 |
| ORR-18 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 5 | 33 | 2 | 20 |
| ORR-19 | 0 | 0 | 0 | 0 | 0 | 11 | 0 | 16 | 75 | 4 | 42 |
| ORR-20 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 10 | 20 | 2 | 11 |
| ORR-21 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 17 | 36 | 7 | 28 |
| ORR-22 | 0 | 0 | 4 | 0 | 0 | 7 | 0 | 8 | 36 | 2 | 19 |
| ORR-23 | 0 | 0 | 0 | 1 | 2 | 1 | 0 | 5 | 16 | 2 | 9 |
| ORR-24 | 0 | 0 | 0 | 0 | 2 | 6 | 0 | 3 | 9 | 3 | 11 |
| **ORR total** | **0** | **7** | **5** | **3** | **11** | **52** | **0** | **180** | **553** | **75** | **370** |
| LTR-1 | 11 | 0 | 0 | 0 | 0 | 0 | 7 | 9 | 32 | 3 | 10 |
| LTR-2 | 26 | 0 | 1 | 0 | 1 | 3 | 8 | 12 | 61 | 4 | 18 |
| LTR-3 | 8 | 0 | 0 | 0 | 0 | 3 | 0 | 10 | 59 | 2 | 5 |
| LTR-4 | 6 | 2 | 0 | 0 | 1 | 0 | 0 | 38 | 25 | 1 | 10 |
| LTR-5 | 3 | 5 | 0 | 0 | 0 | 0 | 3 | 14 | 41 | 2 | 9 |
| LTR-6 | 12 | 0 | 0 | 0 | 0 | 1 | 0 | 11 | 27 | 1 | 6 |
| LTR-7 | 9 | 0 | 0 | 0 | 1 | 1 | 7 | 26 | 57 | 3 | 17 |
| LTR-8 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 21 | 18 | 2 | 4 |
| LTR-9 | 5 | 18 | 0 | 0 | 0 | 0 | 0 | 23 | 23 | 2 | 9 |
| LTR-10 | 0 | 2 | 0 | 0 | 0 | 1 | 0 | 23 | 16 | 2 | 5 |
| LTR-11 | 2 | 5 | 0 | 0 | 0 | 0 | 0 | 17 | 24 | 1 | 8 |
| LTR-12 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 28 | 31 | 1 | 6 |
| LTR-13 | 2 | 2 | 0 | 0 | 2 | 4 | 4 | 17 | 32 | 1 | 11 |
| LTR-14 | 2 | 1 | 0 | 0 | 0 | 0 | 3 | 6 | 22 | 1 | 4 |
| LTR-15 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 12 | 31 | 1 | 8 |
| LTR-16 | 1 | 7 | 0 | 0 | 1 | 0 | 5 | 13 | 18 | 1 | 7 |
| LTR-17 | 2 | 8 | 0 | 0 | 0 | 2 | 11 | 33 | 25 | 4 | 8 |
| **LTR total** | **93** | **51** | **1** | **0** | **6** | **16** | **48** | **313** | **542** | **32** | **145** |
| IM-1 | 23 | 0 | 0 | 3 | 2 | 0 | 0 | 7 | 42 | 3 | 16 |
| IM-2 | 36 | 0 | 2 | 0 | 4 | 1 | 0 | 7 | 30 | 4 | 15 |
| IM-3 | 39 | 0 | 14 | 2 | 6 | 2 | 0 | 7 | 42 | 5 | 17 |
| IM-4 | 29 | 0 | 2 | 0 | 3 | 2 | 0 | 5 | 39 | 3 | 14 |
| IM-5 | 41 | 0 | 16 | 0 | 4 | 0 | 1 | 30 | 23 | 5 | 15 |
| IM-6 | 35 | 0 | 6 | 0 | 0 | 1 | 0 | 10 | 34 | 3 | 11 |
| IM-7 | 37 | 0 | 1 | 0 | 1 | 0 | 1 | 5 | 30 | 3 | 11 |
| IM-8 | 61 | 0 | 5 | 0 | 2 | 1 | 0 | 6 | 28 | 2 | 14 |
| IM-9 | 80 | 0 | 1 | 1 | 3 | 13 | 0 | 16 | 26 | 4 | 13 |
| IM-10 | 59 | 0 | 0 | 0 | 2 | 7 | 0 | 16 | 20 | 3 | 4 |
| IM-11 | 97 | 0 | 0 | 0 | 2 | 3 | 0 | 36 | 21 | 7 | 9 |
| IM-12 | 78 | 0 | 0 | 0 | 2 | 2 | 0 | 8 | 39 | 2 | 8 |
| IM-13 | 42 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 16 | 1 | 4 |
| IM-14 | 19 | 0 | 0 | 0 | 0 | 2 | 0 | 5 | 10 | 1 | 3 |
| IM-15 | 32 | 0 | 1 | 0 | 0 | 0 | 0 | 5 | 19 | 2 | 4 |
| IM-16 | 75 | 0 | 2 | 0 | 1 | 3 | 0 | 9 | 15 | 2 | 11 |
| IM-17 | 72 | 0 | 2 | 0 | 1 | 3 | 0 | 6 | 40 | 1 | 11 |
| **IM total** | **855** | **0** | **52** | **6** | **33** | **40** | **2** | **182** | **474** | **51** | **180** |
| CI-1 | 37 | 0 | 4 | 1 | 1 | 2 | 0 | 16 | 34 | 6 | 4 |
| CI-2 | 17 | 0 | 0 | 0 | 0 | 1 | 0 | 5 | 40 | 4 | 3 |
| CI-3 | 16 | 0 | 1 | 5 | 10 | 21 | 0 | 10 | 14 | 4 | 3 |
| CI-4 | 25 | 0 | 0 | 2 | 6 | 1 | 0 | 10 | 31 | 6 | 6 |
| CI-5 | 11 | 0 | 0 | 0 | 3 | 6 | 0 | 5 | 22 | 5 | 3 |
| CI-6 | 32 | 0 | 0 | 0 | 3 | 3 | 0 | 12 | 26 | 4 | 4 |
| CI-7 | 28 | 0 | 0 | 2 | 2 | 4 | 0 | 14 | 60 | 6 | 5 |
| CI-8 | 22 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 26 | 3 | 3 |
| **CI total** | **188** | **0** | **5** | **10** | **25** | **38** | **0** | **77** | **253** | **38** | **31** |
