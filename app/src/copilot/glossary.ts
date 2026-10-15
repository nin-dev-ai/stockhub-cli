/**
 * Curated, static definitions. These are vetted product text, so they are a permitted source for
 * the Copilot. Illustrations use round example numbers and say so; they are never results.
 */
export interface GlossaryEntry { id: string; term: string; aliases: string[]; text: string; seeAlso?: string[] }

export const GLOSSARY: GlossaryEntry[] = [
  { id: "etf", term: "ETF (exchange-traded fund)", aliases: ["etf", "etfs", "exchange traded fund", "exchange-traded fund", "index fund"],
    text: "A fund that holds a basket of securities and trades on an exchange like a share. An S&P 500 ETF such as SPY holds the companies in that index, so one purchase spreads money across all of them. Funds charge an annual expense ratio, which StockHub's adjusted prices already reflect.", seeAlso: ["expense_ratio", "diversification"] },
  { id: "dca", term: "Dollar-cost averaging (DCA)", aliases: ["dca", "dollar cost averaging", "dollar-cost averaging", "dollar cost average"],
    text: "Investing a fixed amount on a schedule, or splitting a lump sum into equal steps, instead of investing all at once. It lowers the regret of buying just before a fall. Because markets have risen more often than they have fallen, holding cash back has usually trailed investing a lump sum immediately, so DCA is a risk preference, not a way to raise returns." },
  { id: "cagr", term: "CAGR (compound annual growth rate)", aliases: ["cagr", "compound annual growth rate", "annualized return", "annualised return"],
    text: "The constant yearly growth rate that would turn the starting value into the ending value over the period. It smooths out the path, so two strategies with the same CAGR can have very different drawdowns. StockHub computes it from time-weighted returns, so contributions do not count as growth, and shows it only with at least one year of data.", seeAlso: ["twr", "drawdown"] },
  { id: "moving_average", term: "Moving average", aliases: ["moving average", "sma", "simple moving average", "200-day", "200 day", "moving-average"],
    text: "The average closing price over the last N trading days, recalculated each day. A trend rule compares today's close with it: above suggests an uptrend, below a downtrend. StockHub uses only closes up to the decision day and trades at the next close, so the rule never sees future prices. Short averages react faster but give more false signals.", seeAlso: ["whipsaw"] },
  { id: "sharpe", term: "Sharpe ratio", aliases: ["sharpe", "sharpe ratio"],
    text: "Annualized return above the risk-free rate divided by annualized volatility: return earned per unit of total risk. Higher is better, but it treats upside and downside swings alike and depends on the sample period. StockHub shows it only with at least 60 daily observations.", seeAlso: ["sortino", "volatility"] },
  { id: "sortino", term: "Sortino ratio", aliases: ["sortino", "sortino ratio"],
    text: "Like the Sharpe ratio, but divides by downside deviation only, so it does not penalize upside swings." },
  { id: "volatility", term: "Volatility", aliases: ["volatility", "vol", "standard deviation"],
    text: "How widely returns swing, measured as the annualized standard deviation of daily returns. It is a measure of variability, not of permanent loss." },
  { id: "drawdown", term: "Drawdown and maximum drawdown", aliases: ["drawdown", "max drawdown", "maximum drawdown", "mdd", "peak to trough"],
    text: "A drawdown is the fall from a previous peak to a later low. The maximum drawdown is the largest such fall in the sample, a practical gauge of how much pain a strategy put a holder through. A short sample may not contain a severe crash, so a small maximum drawdown can be luck." },
  { id: "correlation", term: "Correlation", aliases: ["correlation", "correlated", "correlations"],
    text: "A number from −1 to +1 describing how two return series move together. Near +1 they rise and fall together and offer little diversification; near 0 they move independently. Correlations change over time and tend to rise in crises." },
  { id: "confidence_interval", term: "Confidence interval and ranges", aliases: ["confidence interval", "confidence intervals", "range of outcomes", "uncertainty"],
    text: "A range meant to describe uncertainty around an estimate. StockHub's projections show percentile ranges of simulated outcomes instead: they describe the spread of a model's paths, conditional on its method and history. They are not statistical guarantees about the future." },
  { id: "percentile", term: "Percentile outcomes (10th, 50th, 90th)", aliases: ["percentile", "percentiles", "p10", "p50", "p90", "10th percentile", "90th percentile", "fan chart", "lower median upper"],
    text: "Sort all simulated ending values from lowest to highest. The 10th percentile is the value that one in ten paths ended below; the 50th (median) is the middle; the 90th is the value that one in ten paths ended above. The 10th percentile is not a worst case and the 90th is not a maximum.", seeAlso: ["bootstrap"] },
  { id: "median", term: "Median", aliases: ["median"],
    text: "The middle value when outcomes are sorted. Half of the simulated paths end above it and half below. It is less pulled by extreme paths than the average." },
  { id: "bootstrap", term: "Block bootstrap", aliases: ["bootstrap", "block bootstrap", "resampling"],
    text: "A simulation that builds future paths by drawing blocks of consecutive historical monthly returns at random. Using blocks keeps some of the history's streaks and seasonality. It assumes the future resembles the sampled history.", seeAlso: ["monte_carlo"] },
  { id: "monte_carlo", term: "Monte Carlo simulation", aliases: ["monte carlo", "parametric", "simulated paths"],
    text: "Running a model many times with random inputs to see the spread of outcomes. StockHub's parametric method draws monthly returns from a normal distribution fitted to the history's mean and standard deviation, which understates extreme months." },
  { id: "rebalancing", term: "Rebalancing", aliases: ["rebalance", "rebalancing", "drift"],
    text: "Trading back to target weights after market moves let them drift. It can be done on a calendar schedule or when drift passes a threshold. It controls risk but costs trades and, outside tax-sheltered accounts, taxes." },
  { id: "benchmark", term: "Benchmark", aliases: ["benchmark", "baseline"],
    text: "The reference a strategy is judged against. StockHub uses buy-and-hold of an ETF with the same cash flows and costs, so differences come from the rules, not from timing of deposits." },
  { id: "total_return", term: "Total return and adjusted prices", aliases: ["total return", "adjusted price", "adjusted close", "dividend adjusted", "dividends"],
    text: "Total return includes dividends as well as price changes. StockHub uses prices adjusted for splits and dividends, which treats distributions as reinvested." },
  { id: "twr", term: "Time-weighted versus money-weighted return", aliases: ["time weighted", "time-weighted", "money weighted", "money-weighted", "irr"],
    text: "Time-weighted return measures the strategy itself and ignores when money was added. Money-weighted return (IRR) reflects your actual deposits, so adding money just before a rise or fall changes it." },
  { id: "slippage", term: "Slippage and trading costs", aliases: ["slippage", "trading costs", "fees", "commission", "costs"],
    text: "Slippage is the gap between the price a rule sees and the price actually paid. StockHub deducts a slippage allowance and any fixed fee on every simulated trade; taxes are not modeled." },
  { id: "expense_ratio", term: "Expense ratio", aliases: ["expense ratio", "ter", "fund fee"],
    text: "The yearly fee a fund charges as a share of assets. It is taken inside the fund, so it is already reflected in adjusted ETF prices." },
  { id: "momentum", term: "Momentum", aliases: ["momentum", "relative strength", "rotation"],
    text: "The tendency of assets that rose recently to keep rising for a while. Momentum rules rank assets by past return and hold the leaders. The effect is well documented but can reverse sharply at turning points and requires more trading." },
  { id: "whipsaw", term: "Whipsaw", aliases: ["whipsaw", "false signal", "false signals"],
    text: "Repeated buy and sell signals when prices hover near a threshold, each costing a little. Bands around the threshold reduce it at the price of reacting later." },
  { id: "overfitting", term: "Overfitting", aliases: ["overfitting", "overfit", "data mining", "curve fitting"],
    text: "Tuning rules until they fit past noise. An overfit strategy looks excellent in its backtest and disappoints afterwards. StockHub's robustness checks (train/test split, rolling windows and parameter sensitivity) look for this.", seeAlso: ["out_of_sample"] },
  { id: "out_of_sample", term: "Out-of-sample test", aliases: ["out of sample", "out-of-sample", "walk forward", "train test", "holdout"],
    text: "Choosing parameters or weights on one part of history and judging them on a later part they never saw. It is a fairer test than evaluating on the same data used for fitting." },
  { id: "diversification", term: "Diversification and overlap", aliases: ["diversification", "diversify", "overlap", "concentration"],
    text: "Holding assets that do not all fall together. Three strategies built on the same S&P 500 ETF overlap heavily, so combining them is not meaningful diversification; the Lab's overlap view flags this." },
  { id: "leverage", term: "Leverage and long-only", aliases: ["leverage", "long only", "long-only", "shorting", "short selling", "margin"],
    text: "Leverage means investing more than you have, for example with borrowed money; shorting means profiting from a fall. StockHub strategies and allocations are long-only and fully invested with no leverage." },
  { id: "inflation", term: "Inflation and real values", aliases: ["inflation", "real value", "today's money", "purchasing power"],
    text: "Inflation reduces what money can buy. Real values divide future amounts by assumed cumulative inflation to express them in today's money." },
  { id: "sequence_risk", term: "Sequence-of-returns risk", aliases: ["sequence risk", "sequence of returns", "bad start"],
    text: "The same average return can produce different results depending on the order of good and bad years, especially when money is being added or withdrawn. The projection's Bad first year scenario tests this." },
  { id: "paper_portfolio", term: "Paper portfolio", aliases: ["paper portfolio", "paper trading", "hypothetical portfolio"],
    text: "A portfolio that records hypothetical trades at market prices without real money. It shows how a plan would have behaved going forward, which is stronger evidence than a backtest but still not real execution." },
  { id: "nifty", term: "Nifty 50", aliases: ["nifty", "nifty 50", "nifty50", "indian market", "india"],
    text: "India's benchmark index of 50 large companies listed on the National Stock Exchange. StockHub does not offer Nifty strategies yet: validated ETF, corporate-action and currency data is not available, and only US-listed ETFs in USD are supported." },
];

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9%&' -]+/g, " ").replace(/\s+/g, " ").trim();

/** Finds glossary entries named in a message, longest alias first, without double-counting. */
export function findTerms(message: string): GlossaryEntry[] {
  const text = ` ${norm(message)} `;
  const hits: { e: GlossaryEntry; at: number; len: number }[] = [];
  for (const e of GLOSSARY) {
    for (const a of e.aliases) {
      const at = text.indexOf(` ${norm(a)} `);
      if (at >= 0) { hits.push({ e, at, len: a.length }); break; }
    }
  }
  hits.sort((a, b) => b.len - a.len);
  const taken: [number, number][] = [];
  const out: GlossaryEntry[] = [];
  for (const h of hits) {
    if (taken.some(([s, e]) => h.at < e && s < h.at + h.len + 1)) continue;
    taken.push([h.at, h.at + h.len + 1]);
    out.push(h.e);
  }
  return out;
}

export const GLOSSARY_BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(GLOSSARY.map((g) => [g.id, g]));
