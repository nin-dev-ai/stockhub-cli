/**
 * Investable universe for the MVP: US-listed ETFs, USD. Indices are not investable, so each
 * benchmark index maps to an ETF proxy. Exposure vectors are static approximations of broad
 * asset-class makeup used only for overlap warnings; they are not live fund holdings.
 */
export type Bucket =
  | "us_large" | "us_growth" | "us_value" | "us_mid" | "us_small" | "intl_developed" | "emerging"
  | "us_agg_bond" | "treasury_long" | "treasury_mid" | "tips" | "corp_bond" | "high_yield" | "em_bond"
  | "gold" | "commodity" | "real_estate" | "cash";

export interface Instrument {
  ticker: string;
  name: string;
  type: "equity_etf" | "bond_etf" | "commodity_etf" | "reit_etf" | "cash_etf";
  exchange: string;
  currency: "USD";
  inception: string;
  exposure: Partial<Record<Bucket, number>>;  // sums to 1
  note?: string;
}

export const INSTRUMENTS: Instrument[] = [
  { ticker: "SPY", name: "SPDR S&P 500 ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1993-01-29", exposure: { us_large: 1 }, note: "Investable proxy for the S&P 500 index." },
  { ticker: "QQQ", name: "Invesco QQQ (Nasdaq-100)", type: "equity_etf", exchange: "Nasdaq", currency: "USD", inception: "1999-03-10", exposure: { us_growth: 0.7, us_large: 0.3 }, note: "Large overlap with the S&P 500: top holdings are shared." },
  { ticker: "IWM", name: "iShares Russell 2000 ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2000-05-22", exposure: { us_small: 1 } },
  { ticker: "EFA", name: "iShares MSCI EAFE ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2001-08-14", exposure: { intl_developed: 1 }, note: "Non-US developed equities, priced in USD; carries currency risk." },
  { ticker: "EEM", name: "iShares MSCI Emerging Markets ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2003-04-07", exposure: { emerging: 1 } },
  { ticker: "AGG", name: "iShares Core US Aggregate Bond ETF", type: "bond_etf", exchange: "NYSE Arca", currency: "USD", inception: "2003-09-22", exposure: { us_agg_bond: 1 } },
  { ticker: "TLT", name: "iShares 20+ Year Treasury Bond ETF", type: "bond_etf", exchange: "Nasdaq", currency: "USD", inception: "2002-07-22", exposure: { treasury_long: 1 } },
  { ticker: "IEF", name: "iShares 7-10 Year Treasury Bond ETF", type: "bond_etf", exchange: "Nasdaq", currency: "USD", inception: "2002-07-22", exposure: { treasury_mid: 1 } },
  { ticker: "GLD", name: "SPDR Gold Shares", type: "commodity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2004-11-18", exposure: { gold: 1 } },
  { ticker: "VNQ", name: "Vanguard Real Estate ETF", type: "reit_etf", exchange: "NYSE Arca", currency: "USD", inception: "2004-09-23", exposure: { real_estate: 1 } },
  { ticker: "SHY", name: "iShares 1-3 Year Treasury Bond ETF", type: "cash_etf", exchange: "Nasdaq", currency: "USD", inception: "2002-07-22", exposure: { cash: 1 }, note: "Short Treasuries used as the cash-like sleeve." },
  // broad US equity and factors
  { ticker: "VTI", name: "Vanguard Total Stock Market ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2001-05-24", exposure: { us_large: 0.8, us_mid: 0.12, us_small: 0.08 } },
  { ticker: "DIA", name: "SPDR Dow Jones Industrial Average ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1998-01-14", exposure: { us_large: 1 } },
  { ticker: "RSP", name: "Invesco S&P 500 Equal Weight ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2003-04-24", exposure: { us_large: 0.7, us_mid: 0.3 }, note: "Same stocks as the S&P 500, equally weighted." },
  { ticker: "MDY", name: "SPDR S&P MidCap 400 ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1995-05-04", exposure: { us_mid: 1 } },
  { ticker: "IWF", name: "iShares Russell 1000 Growth ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2000-05-22", exposure: { us_growth: 0.7, us_large: 0.3 } },
  { ticker: "IWD", name: "iShares Russell 1000 Value ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2000-05-22", exposure: { us_value: 0.7, us_large: 0.3 } },
  { ticker: "SCHD", name: "Schwab US Dividend Equity ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2011-10-20", exposure: { us_value: 0.6, us_large: 0.4 }, note: "History starts in 2011; selecting it shortens the common test window." },
  { ticker: "USMV", name: "iShares MSCI USA Min Vol Factor ETF", type: "equity_etf", exchange: "Cboe", currency: "USD", inception: "2011-10-18", exposure: { us_large: 1 }, note: "History starts in 2011; selecting it shortens the common test window." },
  { ticker: "MTUM", name: "iShares MSCI USA Momentum Factor ETF", type: "equity_etf", exchange: "Cboe", currency: "USD", inception: "2013-04-16", exposure: { us_growth: 0.5, us_large: 0.5 }, note: "History starts in 2013; selecting it shortens the common test window." },
  // US sectors (Select Sector SPDRs, all S&P 500 constituents)
  { ticker: "XLK", name: "Technology Select Sector SPDR", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1998-12-16", exposure: { us_growth: 0.7, us_large: 0.3 }, note: "A single sector of the S&P 500; concentrated." },
  { ticker: "XLF", name: "Financial Select Sector SPDR", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1998-12-16", exposure: { us_value: 0.7, us_large: 0.3 }, note: "A single sector of the S&P 500; concentrated." },
  { ticker: "XLE", name: "Energy Select Sector SPDR", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1998-12-16", exposure: { us_value: 0.7, us_large: 0.3 }, note: "A single sector of the S&P 500; concentrated." },
  { ticker: "XLV", name: "Health Care Select Sector SPDR", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1998-12-16", exposure: { us_large: 1 }, note: "A single sector of the S&P 500; concentrated." },
  { ticker: "XLY", name: "Consumer Discretionary Select Sector SPDR", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1998-12-16", exposure: { us_growth: 0.5, us_large: 0.5 }, note: "A single sector of the S&P 500; concentrated." },
  { ticker: "XLP", name: "Consumer Staples Select Sector SPDR", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1998-12-16", exposure: { us_value: 0.5, us_large: 0.5 }, note: "A single sector of the S&P 500; concentrated." },
  { ticker: "XLI", name: "Industrial Select Sector SPDR", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1998-12-16", exposure: { us_value: 0.5, us_large: 0.5 }, note: "A single sector of the S&P 500; concentrated." },
  { ticker: "XLU", name: "Utilities Select Sector SPDR", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1998-12-16", exposure: { us_value: 0.7, us_large: 0.3 }, note: "A single sector of the S&P 500; concentrated." },
  { ticker: "XLB", name: "Materials Select Sector SPDR", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1998-12-16", exposure: { us_value: 0.7, us_large: 0.3 }, note: "A single sector of the S&P 500; concentrated." },
  // international equity
  { ticker: "VEA", name: "Vanguard FTSE Developed Markets ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2007-07-20", exposure: { intl_developed: 1 }, note: "History starts in 2007; selecting it shortens the common test window." },
  { ticker: "VWO", name: "Vanguard FTSE Emerging Markets ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2005-03-04", exposure: { emerging: 1 } },
  { ticker: "VGK", name: "Vanguard FTSE Europe ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2005-03-04", exposure: { intl_developed: 1 } },
  { ticker: "EWJ", name: "iShares MSCI Japan ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "1996-03-12", exposure: { intl_developed: 1 } },
  { ticker: "FXI", name: "iShares China Large-Cap ETF", type: "equity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2004-10-05", exposure: { emerging: 1 } },
  { ticker: "INDA", name: "iShares MSCI India ETF", type: "equity_etf", exchange: "Cboe", currency: "USD", inception: "2012-02-02", exposure: { emerging: 1 }, note: "US-listed, priced in USD; tracks MSCI India, not the Nifty 50, and carries rupee currency risk. History starts in 2012." },
  // bonds
  { ticker: "BND", name: "Vanguard Total Bond Market ETF", type: "bond_etf", exchange: "Nasdaq", currency: "USD", inception: "2007-04-03", exposure: { us_agg_bond: 1 }, note: "History starts in 2007; AGG is the longer-history equivalent." },
  { ticker: "TIP", name: "iShares TIPS Bond ETF", type: "bond_etf", exchange: "NYSE Arca", currency: "USD", inception: "2003-12-04", exposure: { tips: 1 } },
  { ticker: "LQD", name: "iShares iBoxx $ Investment Grade Corporate Bond ETF", type: "bond_etf", exchange: "NYSE Arca", currency: "USD", inception: "2002-07-22", exposure: { corp_bond: 1 } },
  { ticker: "HYG", name: "iShares iBoxx $ High Yield Corporate Bond ETF", type: "bond_etf", exchange: "NYSE Arca", currency: "USD", inception: "2007-04-04", exposure: { high_yield: 1 }, note: "High-yield bonds tend to fall with stocks." },
  { ticker: "EMB", name: "iShares J.P. Morgan USD Emerging Markets Bond ETF", type: "bond_etf", exchange: "Nasdaq", currency: "USD", inception: "2007-12-17", exposure: { em_bond: 1 } },
  { ticker: "BIL", name: "SPDR Bloomberg 1-3 Month T-Bill ETF", type: "cash_etf", exchange: "NYSE Arca", currency: "USD", inception: "2007-05-25", exposure: { cash: 1 }, note: "Treasury bills; closest to cash. History starts in 2007." },
  // commodities
  { ticker: "SLV", name: "iShares Silver Trust", type: "commodity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2006-04-21", exposure: { commodity: 1 } },
  { ticker: "DBC", name: "Invesco DB Commodity Index Tracking Fund", type: "commodity_etf", exchange: "NYSE Arca", currency: "USD", inception: "2006-02-03", exposure: { commodity: 1 }, note: "Holds futures; returns include roll costs." },
];

export const INSTRUMENT_GROUPS: { label: string; types: Instrument["type"][] }[] = [
  { label: "Equity", types: ["equity_etf"] },
  { label: "Bonds", types: ["bond_etf"] },
  { label: "Cash-like", types: ["cash_etf"] },
  { label: "Commodities", types: ["commodity_etf"] },
  { label: "Real estate", types: ["reit_etf"] },
];

export const INSTRUMENT_BY_TICKER: Record<string, Instrument> =
  Object.fromEntries(INSTRUMENTS.map((i) => [i.ticker, i]));

/** Index levels are not investable; map the common ones to the ETF the engine trades. */
export const INDEX_PROXY: Record<string, string> = {
  "^GSPC": "SPY", "^NDX": "QQQ", "^RUT": "IWM", "^N225": "", "^NSEI": "",
};

export const UNSUPPORTED_NOTE =
  "Indian-listed instruments (e.g. the Nifty 50) are not published: no validated corporate-action or currency data is available. Only US-listed ETFs in USD are supported; INDA (MSCI India, US-listed) is the closest available exposure.";

export const instrumentFor = (symbol: string): Instrument | undefined =>
  INSTRUMENT_BY_TICKER[symbol.toUpperCase()] ?? INSTRUMENT_BY_TICKER[INDEX_PROXY[symbol.toUpperCase()] ?? ""];
