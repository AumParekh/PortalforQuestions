import re,os,shutil
from order import chapters
SRC='../new/split'
REN={'MR':{'keybox':'mrkeybox','defbox':'mrdefbox','trapbox':'mrtrapbox','exbox':'mrexbox',
           'gapbox':'mrgapbox','fmlbox':'mrfmlbox'},
     'IM':{'keybox':'imkeybox','defbox':'imdefbox','trapbox':'imtrapbox','exbox':'imexbox',
           'gapbox':'imgapbox','fmlbox':'imfmlbox'},
     'LR':{'keybox':'lrkeybox','defbox':'lrdefbox','trapbox':'lrtrapbox','trapboxnb':'lrtrapboxnb',
           'exbox':'lrexbox','gapbox':'lrgapbox','fmlbox':'lrfmlbox'}}
os.makedirs('ch',exist_ok=True)
for i,c in enumerate(chapters,1):
    t=open(os.path.join(SRC,c['src_file']),encoding='utf8').read()
    for a,b in sorted(REN[c['book']].items(),key=lambda x:-len(x[0])):
        t=re.sub(r'\\begin\{'+a+r'\}',r'\\begin{'+b+'}',t)
        t=re.sub(r'\\end\{'+a+r'\}',r'\\end{'+b+'}',t)
    if c['book']=='MR':
        t=re.sub(r'\\vk\b',r'\\mrvk',t)
    open(f"ch/{i:02d}_{c['book']}_{c['code'].replace('-','')}.tex",'w',encoding='utf8').write(t)
BN={'MR':'Market Risk','LR':'Liquidity \\& Treasury Risk','IM':'Investment Management'}
L=[];A=L.append
A(r'\documentclass[11pt,a4paper,openany]{report}')
A(r'\input{preamble}')
A(r'\usepackage[hidelinks, bookmarksnumbered=false, bookmarksopen=true,')
A(r'            bookmarksopenlevel=1, pdfusetitle]{hyperref}')
A(r'\usepackage{bookmark}')
A(r'\hypersetup{pdftitle={FRM Part II 2026 - Consolidated ROI Volume: MR, LR, IM},')
A(r'  pdfauthor={Aum Parekh}, bookmarksdepth=3}')
A(r'\begin{document}')
A(r'\pagenumbering{roman}')
A(r'\input{titlepage}')
A(r'\clearpage\pdfbookmark[0]{Priority Index}{idx}')
A(r'\input{index}')
A(r'\clearpage\pdfbookmark[0]{Contents}{toc}')
A(r'\renewcommand{\contentsname}{\sffamily\bfseries\color{FRMNavy}Detailed Contents}')
A(r'\tableofcontents')
A(r'\clearpage')
A(r'\pagenumbering{arabic}')
A(r'\part{Ordered by Return on Learning Objective}')
for i,c in enumerate(chapters,1):
    A(r'\clearpage')
    A(r'\setchapctx{%s}{%s}{%s}'%(c['tag'],BN[c['book']],c['mapR']))
    A(r'\phantomsection\label{roi:%d}'%i)
    A(r'\input{ch/%02d_%s_%s}'%(i,c['book'],c['code'].replace('-','')))
A(r'\end{document}')
open('master.tex','w',encoding='utf8').write('\n'.join(L)+'\n')
print("chapters:",len(chapters))
