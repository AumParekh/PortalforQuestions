from order import chapters
BOOK={'OR':'Operational Risk','CR':'Credit Risk','CI':'Current Issues'}
def esc(s): return s.replace('&',r'\&').replace('%',r'\%').replace('#',r'\#')
L=[];A=L.append
A(r'{\sffamily\Huge\bfseries\color{FRMNavy}Priority Index}\par\vspace{2pt}')
A(r'{\color{FRMGold}\rule{\textwidth}{1.4pt}}\par\vspace{6pt}')
A(r'{\small\color{FRMGrey}All 55 readings from Operational Risk, Credit Risk and Current Issues,')
A(r'ordered by return on learning objective -- highest yield first. Every row is clickable.\par}')
A(r'\vspace{10pt}')
A(r'\footnotesize')
A(r'\setlength{\LTpre}{0pt}\setlength{\LTpost}{0pt}')
A(r'\begin{longtable}{@{}r@{\hskip 7pt}L{6.35cm}@{\hskip 5pt}l@{\hskip 10pt}l@{\hskip 3pt}r@{\hskip 7pt}r@{}}')
hdr=(r'\thead{\#} & \thead{Reading} & \thead{Book} & \thead{Priority} & '
     r'\thead{SRC} & \thead{Page} \\ \midrule')
A(r'\toprule'); A(hdr); A(r'\endfirsthead')
A(r'\toprule'); A(hdr); A(r'\endhead')
A(r'\bottomrule\endfoot')
prev=None
for i,c in enumerate(chapters,1):
    if c['tag']!=prev:
        A(r'\multicolumn{6}{@{}l@{}}{\vspace{3pt}}\\[-6pt]')
        A(r'\multicolumn{6}{@{}l@{}}{\tagpill{%s}}\\[3pt]'%c['tag'])
        prev=c['tag']
    A(r'\hyperref[roi:%d]{{\sffamily\bfseries\color{FRMGold}%d}} & '
      r'\hyperref[roi:%d]{{\color{black}%s}} & {\color{FRMGrey}%s} & '
      r'{\color{FRMGrey}%s} & {\color{FRMGrey}%d} & '
      r'\hyperref[roi:%d]{{\sffamily\bfseries\color{FRMNavy}\pageref{roi:%d}}} \\'
      %(i,i,i,esc(c['title']),BOOK[c['book']],c['code'],c['src'],i,i))
A(r'\end{longtable}')
open('index.tex','w',encoding='utf8').write('\n'.join(L)+'\n')

T=[];A=T.append
A(r'\thispagestyle{empty}')
A(r'\vspace*{2.2cm}')
A(r'{\sffamily')
A(r'{\color{FRMGold}\rule{\textwidth}{2.4pt}}\\[10pt]')
A(r'{\Huge\bfseries\color{FRMNavy} FRM Part II \textbar{} 2026}\\[10pt]')
A(r'{\Huge\bfseries\color{FRMNavy} Consolidated Volume}\\[6pt]')
A(r'{\Large\bfseries\color{FRMNavy} Operational Risk \textbullet\ Credit Risk \textbullet\ Current Issues}\\[12pt]')
A(r'{\color{FRMGold}\rule{\textwidth}{1.2pt}}\\[16pt]')
A(r'{\large\color{FRMGrey} Three books merged and resequenced by}\\[4pt]')
A(r'{\large\color{FRMGrey} return on learning objective}\\[28pt]')
A(r'\begin{tabular}{@{}ll@{}}')
A(r'{\bfseries\color{FRMNavy}Readings} & 55 \textbullet\ 24 Operational Risk, 23 Credit Risk, 8 Current Issues\\[4pt]')
A(r'{\bfseries\color{FRMNavy}Order} & Highest yield per learning objective first\\[4pt]')
A(r'{\bfseries\color{FRMNavy}Tags} & \tagword{STRIKE FIRST} \textbullet\ \tagword{QUICK WIN} \textbullet\ \tagword{GRIND} \textbullet\ \tagword{DEFER}\\[4pt]')
A(r'{\bfseries\color{FRMNavy}Body} & Carried across verbatim from the three source volumes\\')
A(r'\end{tabular}')
A(r'\vfill')
A(r'{\color{FRMRule}\rule{\textwidth}{0.8pt}}\\[6pt]')
A(r'{\small\color{FRMGrey} Chapter bodies are unchanged. Only the sequence, the styling and the')
A(r'front matter are new. Per-volume contents pages and coverage records have been removed')
A(r'and replaced by the single Priority Index overleaf.}')
A(r'}')
A(r'\clearpage')
open('titlepage.tex','w',encoding='utf8').write('\n'.join(T)+'\n')
print("front matter written")
