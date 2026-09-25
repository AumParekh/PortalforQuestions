# reading key = (BOOK, map_reading_number)
# concepts from ROI master ranking: name, book, roi, action, [map readings]
C=[
("RAROC, Adjusted RAROC & Hurdle Rate","OR",0.823,"STRIKE FIRST",[59,23]),
("Artificial Intelligence & Generative AI","CI",0.686,"STRIKE FIRST",[100,101]),
("Climate Risk / Geopolitical Risk","CI",0.571,"STRIKE FIRST",[103]),
("Unexpected Loss, UL Contribution & Economic Capital","CR",0.376,"STRIKE FIRST",[22]),
("Three Lines of Defence & Operational Risk Governance","OR",0.366,"STRIKE FIRST",[43]),
("Cyber Risk & Operational Resilience","OR",0.366,"STRIKE FIRST",[49,50,42]),
("Basel III Post-Crisis Reforms & Capital Regulation","OR",0.366,"STRIKE FIRST",[65,64,62]),
("Merton Model, Distance to Default & Risk-Neutral PD","CR",0.300,"STRIKE FIRST",[23,27]),
("CVA, DVA, BCVA & UCVA-as-a-Spread","CR",0.300,"STRIKE FIRST",[38,30]),
("Model Risk Management (SR 11-7) & Model Validation","OR",0.274,"STRIKE FIRST",[56,57]),
("Outsourcing & Third-Party Risk Management","OR",0.274,"STRIKE FIRST",[53,54]),
("Securitisation: Tranches, Waterfall, CPR / SMM / PSA","CR",0.263,"STRIKE FIRST",[41,40]),
("Private Credit","CI",0.229,"STRIKE FIRST",[102]),
("Monetary & Fiscal Policy","CI",0.229,"STRIKE FIRST",[104]),
("2023 Bank Failures, Credit Suisse & Global Financial Stability","CI",0.229,"STRIKE FIRST",[103]),
("Credit VaR","CR",0.225,"STRIKE FIRST",[28,29,30]),
("Default Correlation & Joint Default Probability","CR",0.225,"STRIKE FIRST",[29,30]),
("Altman Z-Score","CR",0.225,"QUICK WIN",[27]),
("Hazard Rates, Survival & Conditional vs. Unconditional PD","CR",0.188,"STRIKE FIRST",[27]),
("Capital Planning at Large Bank Holding Companies","OR",0.183,"STRIKE FIRST",[61]),
("Money Laundering, Financing of Terrorism & Financial Crime","OR",0.183,"QUICK WIN",[51,52]),
("Investor Protection, MiFID & the Volcker Rule","OR",0.183,"QUICK WIN",[55]),
("LDA Approach & Operational Risk Measurement","OR",0.183,"QUICK WIN",[45]),
("Risk Identification, Assessment, Mitigation & Reporting","OR",0.183,"STRIKE FIRST",[44,45,46,47]),
("Wrong-Way & Right-Way Risk","CR",0.150,"GRIND",[38]),
("Collateral, Margin, Netting & CSA Terms","CR",0.150,"GRIND",[34,35]),
("Stressed Market VaR & Market Risk Capital Charge","MR",0.127,"DEFER",[62]),
("Crypto, Tokenization & Digital Resilience","CI",0.114,"DEFER",[105,106,107]),
("Coco Bonds","CI",0.114,"DEFER",[103]),
("Counterparty Exposure Profiles: EE, PFE, EPE","CR",0.113,"DEFER",[37]),
("Stress Testing: Counterparty, Bank & Scenario Construction","CR",0.113,"DEFER",[39,58]),
("Capital Structure in Banks: Regulatory vs. Economic Capital","CR",0.113,"DEFER",[22,23]),
("Range of Practices and Issues in Economic Capital Frameworks","OR",0.091,"DEFER",[60]),
("Early Warning Indicators & PIT vs. TTC","LR",0.308,"STRIKE FIRST",[24]),
("Credit Model Comparison: Vasicek, CreditRisk+, CreditMetrics, KMV","CR",0.075,"DEFER",[28,23]),
("Credit Spread & Credit Spread Risk","CR",0.075,"DEFER",[28,30]),
("Retail Credit Risk & Credit Scoring","CR",0.075,"DEFER",[25,24]),
("Credit Derivatives & Credit-Linked Notes","CR",0.075,"DEFER",[31]),
("Structured Credit Risk & Implied Correlation","CR",0.075,"DEFER",[40]),
("Country & Sovereign Default Risk","CR",0.038,"DEFER",[26]),
("Central Clearing & the CCP Loss Waterfall","CR",0.038,"DEFER",[36]),
("Fundamentals of Credit Risk","CR",0.038,"DEFER",[19]),
("Credit Risk Governance","CR",0.038,"DEFER",[20]),
("Credit Risk Management","CR",0.038,"DEFER",[21]),
("Derivatives (Counterparty Risk Intermediaries)","CR",0.038,"DEFER",[32]),
]

# chapter inventory: (book, file, code, map_reading, title, src)
OR_T={40:("ORR-1","Introduction to Operational Risk and Resilience",0),
41:("ORR-2","Risk Governance",4),42:("ORR-3","Risk Identification",2),
43:("ORR-4","Risk Measurement and Assessment",2),44:("ORR-5","Risk Mitigation",2),
45:("ORR-6","Risk Reporting",2),46:("ORR-7","Integrated Risk Management",0),
47:("ORR-8","Cyber-resilience: Range of Practices",4),
48:("ORR-9","Case Study: Cybersecurity and Information Security Risks",4),
49:("ORR-10","Sound Management of Risks Related to Money Laundering and Financing of Terrorism",2),
50:("ORR-11","Case Study: Financial Crime and Fraud",2),
51:("ORR-12","Guidance on Managing Outsourcing Risk",3),
52:("ORR-13","Case Study: Third-Party Risk Management",3),
53:("ORR-14","Case Study: Investor Protection and Compliance Risks",2),
54:("ORR-15","Supervisory Guidance on Model Risk Management",3),
55:("ORR-16","Case Study: Model Risk and Model Validation",3),
56:("ORR-17","Stress Testing Banks",0),
57:("ORR-18","Risk Capital Attribution and Risk-Adjusted Performance Measurement",9),
58:("ORR-19","Range of Practices and Issues in Economic Capital Frameworks",1),
59:("ORR-20","Capital Planning at Large Bank Holding Companies",2),
60:("ORR-21","Capital Regulation Before the Global Financial Crisis",2),
61:("ORR-22","Solvency, Liquidity, and Other Regulation After the GFC",0),
62:("ORR-23","High-Level Summary of Basel III Reforms",2),
63:("ORR-24","Basel III: Finalising Post-Crisis Reforms",2)}

CR_T=[("Fundamentals of Credit Risk",1),("Governance",1),("Credit Risk Management",1),
("Capital Structure in Banks",10),("Introduction to Credit Risk Modeling and Assessment",8),
("Credit Scoring and Rating",2),("Credit Scoring and Retail Credit Risk Management",2),
("Country Risk: Determinants, Measures, and Implications",1),("Estimating Default Probabilities",8),
("Credit Value at Risk",6),("Portfolio Credit Risk",6),("Credit Risk (Hull Ch.24)",8),
("Credit Derivatives",2),("Derivatives (Gregory Ch.2)",1),("Counterparty Risk and Beyond",0),
("Netting, Close-out and Related Aspects",0),("Margin (Collateral) and Settlement",4),
("Central Clearing",1),("Future Value and Exposure",3),("CVA",8),
("The Evolution of Stress Testing Counterparty Exposures",3),("Structured Credit Risk",7),
("An Introduction to Securitisation",7)]

CI_T=[("Advances in Artificial Intelligence: Implications for Capital Markets Activities",6),
("The Financial Stability Implications of Artificial Intelligence",6),
("The Global Drivers of Private Credit",2),
("Global Financial Stability Report, Chapter 2: Geopolitical Risk",2),
("Monetary and Fiscal Policy: Safeguarding Stability and Trust",2),
("Regulating the Crypto Ecosystem: The Case of Unbacked Crypto Assets",0),
("Tokenization and Financial Market Inefficiencies",0),
("Digital Resilience and Financial Stability: The Quest for Policy Tools in the Financial Sector",0)]

chapters=[]
for gr,(code,title,src) in OR_T.items():
    chapters.append(dict(book="OR",bookname="Operational Risk",src_file=f"ch/R{gr}.tex",
        code=code,mapR=gr+2,title=title,src=src))
for i,(title,src) in enumerate(CR_T,start=1):
    chapters.append(dict(book="CR",bookname="Credit Risk",src_file=f"cr{i:02d}.tex",
        code=f"CR-{i}",mapR=18+i,title=title,src=src))
for i,(title,src) in enumerate(CI_T,start=1):
    chapters.append(dict(book="CI",bookname="Current Issues",src_file=f"ci{i}.tex",
        code=f"CI-{i}",mapR=99+i,title=title,src=src))

# best claim per reading
for ch in chapters:
    best=None
    for name,bk,roi,act,rds in C:
        if ch["mapR"] in rds:
            if best is None or roi>best[1]: best=(name,roi,act)
    if best: ch["concept"],ch["roi"],ch["tag"]=best
    else: ch["concept"],ch["roi"],ch["tag"]=("(not claimed by any catalogued concept)",-1.0,"DEFER")

TAGR={"STRIKE FIRST":0,"QUICK WIN":1,"GRIND":2,"DEFER":3}
chapters.sort(key=lambda c:(-c["roi"],TAGR[c["tag"]],-c["src"],c["book"],c["mapR"]))
if __name__=="__main__":
    for i,c in enumerate(chapters,1):
        print(f"{i:>2} {c['roi']:>6.3f} {c['tag']:<12} {c['book']} {c['code']:<7} R{c['mapR']:<3} SRC{c['src']:<2} {c['title'][:58]}")
