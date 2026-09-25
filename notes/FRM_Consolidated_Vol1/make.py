import re,os,shutil
from order import chapters
SRC={'OR':'../OR_src/ORR_Field_Guide','CR':'../CR_src','CI':'../CI_src/tex'}
REN={'OR':{'keybox':'orkeybox','defbox':'ordefbox','notebox':'ornotebox','exambox':'orexambox'},
     'CR':{'keybox':'crkeybox','defbox':'crdefbox','trapbox':'crtrapbox','exbox':'crexbox',
           'gapbox':'crgapbox','fmlbox':'crfmlbox'},
     'CI':{'keybox':'cikeybox','defbox':'cidefbox','trapbox':'citrapbox','srcbox':'cisrcbox',
           'figblock':'cifigblock'}}
os.makedirs('ch',exist_ok=True)
BOOKNAME={'OR':'Operational Risk','CR':'Credit Risk','CI':'Current Issues'}
for i,c in enumerate(chapters,1):
    t=open(os.path.join(SRC[c['book']],c['src_file']),encoding='utf8').read()
    for a,b in REN[c['book']].items():
        t=re.sub(r'\\begin\{'+a+r'\}',r'\\begin{'+b+'}',t)
        t=re.sub(r'\\end\{'+a+r'\}',r'\\end{'+b+'}',t)
    if c['book']=='OR':
        t=re.sub(r'\\figcap\b',r'\\orfigcap',t)
    out=f"ch/{i:02d}_{c['book']}_{c['code'].replace('-','')}.tex"
    open(out,'w',encoding='utf8').write(t)
    c['out']=out
    c['rd']=str(c['mapR'] if c['book']!='OR' else c['mapR']-2)
# ---- master
L=[]
A=L.append
A(r'\documentclass[11pt,a4paper,openany]{report}')
A(r'\input{preamble}')
A(r'\usepackage[hidelinks, bookmarksnumbered=false, bookmarksopen=true,')
A(r'            bookmarksopenlevel=1, pdfusetitle]{hyperref}')
A(r'\usepackage{bookmark}')
A(r'\hypersetup{pdftitle={FRM Part II 2026 - Consolidated ROI Volume: OR, CR, CI},')
A(r'  pdfauthor={Aum Parekh}, bookmarksdepth=3}')
A(r'\begin{document}')
A(r'\pagenumbering{roman}')
A(r'\input{titlepage}')
A(r'\clearpage')
A(r'\pdfbookmark[0]{Priority Index}{idx}')
A(r'\input{index}')
A(r'\clearpage')
A(r'\pdfbookmark[0]{Contents}{toc}')
A(r'\renewcommand{\contentsname}{\sffamily\bfseries\color{FRMNavy}Detailed Contents}')
A(r'\tableofcontents')
A(r'\clearpage')
A(r'\pagenumbering{arabic}')
A(r'\part{Ordered by Return on Learning Objective}')
for i,c in enumerate(chapters,1):
    A(r'\clearpage')
    A(r'\setchapctx{%s}{%s}{%s}'%(c['tag'],BOOKNAME[c['book']],c['rd']))
    A(r'\phantomsection\label{roi:%d}'%i)
    A(r'\input{%s}'%c['out'][:-4])
A(r'\end{document}')
open('master.tex','w',encoding='utf8').write('\n'.join(L)+'\n')
print("chapters written:",len(chapters))
