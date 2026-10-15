/**
 * Investable universe for the MVP: US-listed ETFs, USD. Indices are not investable, so each
 * benchmark index maps to an ETF proxy. Exposure vectors are static approximations of broad
 * asset-class makeup used only for overlap warnings; they are not live fund holdings.
 */
export type Bucket =
  | "us_large" | "us_growth" | "us_small" | "intl_developed" | "emerging"
  | "us_agg_bond" | "treasury_long" | "treasury_mid" | "gold" | "real_estate" | "cash";

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
];

export const INSTRUMENT_BY_TICKER: Record<string, Instrument> =
  Object.fromEntries(INSTRUMENTS.map((i) => [i.ticker, i]));

/** Index levels are not investable; map the common ones to the ETF the engine trades. */
export const INDEX_PROXY: Record<string, string> = {
  "^GSPC": "SPY", "^NDX": "QQQ", "^RUT": "IWM", "^N225": "", "^NSEI": "",
};

export const UNSUPPORTED_NOTE =
  "Indian instruments (e.g. Nifty 50) are not published: no validated ETF, corporate-action or currency data is available. Only US-listed ETFs in USD are supported.";

export const instrumentFor = (symbol: string): Instrument | undefined =>
  INSTRUMENT_BY_TICKER[symbol.toUpperCase()] ?? INSTRUMENT_BY_TICKER[INDEX_PROXY[symbol.toUpperCase()] ?? ""];
