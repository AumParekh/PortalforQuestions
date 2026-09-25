# FRM Part II 2026 - Consolidated ROI Volume (OR + CR + CI)

Build:  xelatex master.tex   (run 3 times)
Engine must be XeLaTeX. Fonts: TeX Gyre Termes/Heros/Cursor, Latin Modern Math.

- order.py      ROI ranking + reading->concept map. Edit here to reorder.
- make.py       regenerates ch/ and master.tex from the three source volumes
- gen_front.py  regenerates index.tex and titlepage.tex
- preamble.tex  single unified A4 house style
- ch/NN_BOOK_CODE.tex  chapter bodies, byte-identical to source except box-macro renames

After editing order.py:
  python3 make.py && python3 gen_front.py && xelatex master.tex   (x3)
