/**
 * ARK Invest (Cathie Wood) is the one fund manager with daily data: ARK publishes each ETF's holdings
 * every day and trade notifications for each day's buys and sells. The official holdings CSV is dated
 * the same day; a free third-party feed (arkfunds.io, unofficial) lists the trades, usually a day behind.
 * See docs/PRD_phase4.md.
 */
import type { PersonaTrade } from "./personas";

export const ARK_FUNDS = ["ARKK", "ARKQ", "ARKW", "ARKG", "ARKF", "ARKX"] as const;
export const ARK_FORM = "ARK daily";
export const ARK_NOTE = "ARK trades come from arkfunds.io, a free third-party feed of ARK's published trade notifications, typically a day behind; the official holdings file is dated the same day. They are daily trades, not SEC filings, and give shares and weight but no price.";

export interface ArkTradeRow { fund: string; date: string; ticker: string; company: string; direction: string; cusip?: string; shares: number; etf_percent: number }

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Rows of `/api/v2/etf/trades` as persona trades: signed shares, weight of the fund, no price or value. */
export function parseArkTrades(raw: unknown): PersonaTrade[] {
  const rows = (raw as { trades?: ArkTradeRow[] } | null)?.trades;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const buy = /^buy$/i.test(str(r.direction)), sell = /^sell$/i.test(str(r.direction));
    const date = str(r.date);
    if ((!buy && !sell) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(r.shares > 0)) return [];
    return [{
      date, filed: date, form: ARK_FORM, symbol: str(r.ticker).toUpperCase() || null, asset: str(r.company) || str(r.ticker),
      side: buy ? "buy" : "sell", action: `${buy ? "Bought" : "Sold"} (${str(r.fund)})`,
      shares: buy ? r.shares : -r.shares, price: null, value: null,
      detail: `${Number(r.etf_percent).toFixed(2)}% of ${str(r.fund)} · ARK trade notification`,
      url: `https://ark-funds.com/funds/${str(r.fund).toLowerCase()}/`,
    } satisfies PersonaTrade];
  });
}

/** The date of the official holdings file (first data row of the CSV, M/D/YYYY), as ISO. */
export function parseHoldingsDate(csv: string): string | null {
  const line = csv.split(/\r?\n/)[1] ?? "";
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(line);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

export interface ArkFeed { events: PersonaTrade[]; newestTrade: string | null; holdingsDate: string | null; checkedAt: string; failedFunds: string[] }

export function summarizeArk(events: PersonaTrade[], holdingsDate: string | null, failedFunds: string[], checkedAt: string): ArkFeed {
  const newest = events.map((e) => e.date!).sort().at(-1) ?? null;
  return { events, newestTrade: newest, holdingsDate, checkedAt, failedFunds };
}
