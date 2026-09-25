# concepts from the ROI master ranking touching MR / LR / IM readings
C=[
("Liquidity-Adjusted VaR (LVaR) & Cost of Liquidation","LR",0.923,"STRIKE FIRST",[66,98]),
("Duration Gap, ALM & Interest-Sensitive Gap","LR",0.769,"STRIKE FIRST",[82]),
("Marginal, Incremental & Component VaR","IM",0.554,"STRIKE FIRST",[87]),
("Factor Theory, Fama-French & Style Analysis","IM",0.462,"STRIKE FIRST",[83,84,85]),
("Performance Measures: Sharpe, Treynor, Jensen, M2, Information Ratio","IM",0.462,"STRIKE FIRST",[89,85]),
("Volatility Smiles & Surfaces (Equity vs. FX)","MR",0.380,"STRIKE FIRST",[17]),
("Policy-Mix VaR & Risk Budgeting","IM",0.369,"STRIKE FIRST",[88]),
("Fundamental Review of the Trading Book (FRTB)","MR",0.338,"STRIKE FIRST",[18]),
("Repurchase Agreements & Financing","LR",0.308,"STRIKE FIRST",[78]),
("Early Warning Indicators & PIT vs. TTC","LR",0.308,"STRIKE FIRST",[68]),
("Liquidity Transfer Pricing & Pooled Cost of Funds","LR",0.308,"STRIKE FIRST",[79,77]),
("Liquidity Stress Testing, Reporting & Monitoring","LR",0.308,"STRIKE FIRST",[72,74,75]),
("US Dollar Shortage in Global Banking","LR",0.308,"QUICK WIN",[81]),
("Ho-Lee, Time-Dependent Volatility & Model 3","MR",0.296,"STRIKE FIRST",[14,15]),
("Correlation Swaps & Quanto Options","MR",0.296,"STRIKE FIRST",[8]),
("Hedge Funds, Survivorship Bias & Due Diligence","IM",0.277,"STRIKE FIRST",[90,94,96]),
("Expected Shortfall","MR",0.253,"STRIKE FIRST",[1,2,18]),
("Lognormal & Normal VaR","MR",0.253,"STRIKE FIRST",[1]),
("Private Credit","CI",0.229,"STRIKE FIRST",[92]),
("Regression Hedging, DV01 & PCA","MR",0.211,"STRIKE FIRST",[11]),
("EVT: GEV vs. POT","MR",0.211,"STRIKE FIRST",[3]),
("Illiquid Assets","IM",0.185,"QUICK WIN",[99]),
("Private Markets Investing, Due Diligence & Distress","IM",0.185,"QUICK WIN",[93,94,95]),
("Capital Planning at Large Bank Holding Companies","OR",0.183,"STRIKE FIRST",[6]),
("VaR Mapping: Principal, Duration & Cash-Flow","MR",0.169,"GRIND",[5]),
("Non-Parametric Approaches: Bootstrap, Volatility-Weighted & Filtered HS","MR",0.169,"GRIND",[2]),
("Backtesting VaR: Failure Rates, Kupiec & Conditional Coverage","MR",0.169,"GRIND",[4,7]),
("CIR & Lognormal Short-Rate Models","MR",0.169,"DEFER",[15]),
("The Investment Function in Financial-Services Management","LR",0.154,"DEFER",[69,70]),
("Intraday Liquidity & Dealer Bank Failure Mechanics","LR",0.154,"DEFER",[71,73]),
("Contingency Funding Planning","LR",0.154,"DEFER",[76]),
("Liquidity and Leverage","LR",0.154,"DEFER",[67]),
("CMT Swaps, OAS & Risk-Neutral Pricing","MR",0.127,"DEFER",[12]),
("Stress Testing: Counterparty, Bank & Scenario Construction","CR",0.113,"DEFER",[97]),
("Portfolio Construction & the No-Trade Region","IM",0.092,"DEFER",[86]),
("Risk, Regulation and Organizational Structure","IM",0.092,"DEFER",[91]),
("Vasicek & Gauss+ Models","MR",0.084,"DEFER",[16,14]),
("Expectations, Convexity & Jensen's Inequality","MR",0.084,"DEFER",[13]),
("Put-Call Parity","MR",0.084,"DEFER",[17]),
("Inflation & Market Stress on Bond Maturities","MR",0.084,"DEFER",[13]),
("Concentration Ratio & Systemic Correlation Risk","MR",0.084,"DEFER",[8]),
("Empirical Properties of Correlation: Mean Reversion & Autocorrelation","MR",0.084,"DEFER",[9]),
("Financial Correlation Modeling - Bottom-Up Approaches","MR",0.084,"DEFER",[10]),
]
MR_T=[("Estimating Market Risk Measures: An Introduction and Overview",6),("Non-Parametric Approaches",4),
("Parametric Approaches (II): Extreme Value",5),("Backtesting VaR",4),("VaR Mapping",4),
("Validating Bank Holding Companies' Value-at-Risk Models for Market Risk",0),
("Beyond Exceedance-Based Backtesting of VaR Models (Probability Integral Transform)",4),
("Correlation Basics: Definitions, Applications, and Terminology",7),
("Empirical Properties of Correlation: How Do Correlations Behave in the Real World?",2),
("Financial Correlation Modeling - Bottom-Up Approaches",2),
("Regression Hedging and Principal Component Analysis",5),("Arbitrage Pricing with Term Structure Models",3),
("Expectations, Risk Premium, Convexity, and the Shape of the Term Structure",2),
("The Art of Term Structure Models: Drift",7),("The Art of Term Structure Models: Volatility and Distribution",7),
("The Vasicek and Gauss+ Models",2),("Volatility Smiles and Volatility Surfaces",9),
("Fundamental Review of the Trading Book",8)]
LTR_T=[("Liquidity Risk",6),("Liquidity and Leverage",0),("Early Warning Indicators",2),
("The Investment Function in Financial-Services Management",1),
("Liquidity and Reserves Management: Strategies and Policies",0),("Intraday Liquidity Risk Management",0),
("Monitoring Liquidity",2),("The Failure Mechanics of Dealer Banks",0),("Liquidity Stress Testing",2),
("Liquidity Risk Reporting and Stress Testing",2),("Contingency Funding Planning",0),
("Managing Non-Deposit Liabilities",2),("Repurchase Agreements and Financing",2),
("Liquidity Transfer Pricing: A Guide to Better Practice",2),
("The US Dollar Shortage in Global Banking and the International Policy Response",0),
("Covered Interest Parity Lost: Understanding the Cross-Currency Basis",2),
("Risk Management for Changing Interest Rates: Asset-Liability Management and Duration Techniques",5)]
IM_T=[("Factor Theory",5),("Factors",5),("Alpha (and the Low-Risk Anomaly)",5),("Portfolio Construction",1),
("Portfolio Risk: Analytical Methods",6),("VaR and Risk Budgeting in Investment Management",4),
("Portfolio Performance Evaluation",5),("Hedge Fund Investment Strategies",3),
("Risk, Regulation and Organizational Structure",0),("The Rise and Risks of Private Credit",0),
("Private Markets Investing",2),("Performing Due Diligence on Specific Managers and Funds",3),
("Distress Symptoms and Remedies",2),("Madoff: A Riot of Red Flags",3),
("Market-Driven Scenarios: An Approach for Plausible Scenario Construction",0),
("Liquidity Risk Management",2),("Illiquid Assets",2)]
chapters=[]
for i,(t,s) in enumerate(MR_T,1):
    chapters.append(dict(book="MR",bookname="Market Risk",code=f"MR-{i}",mapR=i,title=t,src=s,src_file=f"MR{i}.tex"))
for i,(t,s) in enumerate(LTR_T,1):
    chapters.append(dict(book="LR",bookname="Liquidity & Treasury Risk",code=f"LTR-{i}",mapR=65+i,title=t,src=s,src_file=f"LTR{i:02d}.tex"))
for i,(t,s) in enumerate(IM_T,1):
    chapters.append(dict(book="IM",bookname="Investment Management",code=f"IM-{i}",mapR=82+i,title=t,src=s,src_file=f"IM{i}.tex"))
for ch in chapters:
    best=None
    for name,bk,roi,act,rds in C:
        if ch["mapR"] in rds and (best is None or roi>best[1]): best=(name,roi,act)
    ch["concept"],ch["roi"],ch["tag"]=best if best else ("(not claimed by any catalogued concept)",-1.0,"DEFER")
TAGR={"STRIKE FIRST":0,"QUICK WIN":1,"GRIND":2,"DEFER":3}
chapters.sort(key=lambda c:(-c["roi"],TAGR[c["tag"]],-c["src"],c["book"],c["mapR"]))
if __name__=="__main__":
    for i,c in enumerate(chapters,1):
        print(f"{i:>2} {c['roi']:>6.3f} {c['tag']:<12} {c['book']} {c['code']:<7} R{c['mapR']:<3} SRC{c['src']:<2} {c['title'][:54]}")
