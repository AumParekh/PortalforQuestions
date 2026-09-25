# FRM Part II 2026 - Consolidated ROI Volume II (MR + LR + IM)
Build: xelatex master.tex  (run 3 times, XeLaTeX only)
Fonts: TeX Gyre Termes / Heros / Cursor, Latin Modern Math.
Ligatures=NoCommon is load-bearing - do not remove (keeps "efficient",
"difficult", "official" searchable and copy-pasteable).

fig/ - all seven assets are the real figures:
  p34-005.png   MR-3   S&P 500 daily returns (POT)
  p87-004.png   MR-9   average correlation, Dow 30, 1972-2017
  p88-004.png   MR-9   correlation volatility, same period
  p93-004.png   MR-9   Johnson SB histogram, 464,580 correlations
  p111-004.png  MR-11  nominal vs real yield change scatter
  p14-004.png   IM-3   low-volatility strategy vs Russell 1000
  swaplines.png LTR-15 central bank swap line network

order.py / make.py / gen_front.py regenerate ch/, master.tex and the front matter.
