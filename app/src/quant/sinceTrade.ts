/**
 * "Was following them any good?" For each disclosed buy or sell, the stock's move from the first
 * market close a follower could have traded at, after the trade became public, to the latest close,
 * against SPY over the same days. Pure; prices are passed in.
 *
 * Entry rules: an SEC filing accepted before 20:00 UTC (US market close) enters at that day's close,
 * later at the next trading day's; a House report or an ARK daily trade enters at the next trading
 * day after its date, since the time of day is unknown. Quarterly 13F rows have no public date and
 * are skipped.
 */
import type { RawBar } from "./data";
import type { PersonaTrade } from "./personas";

export interface SinceRow {
  key: string;
  ticker: string;
  side: "buy" | "sell";
  entry: string;
  exit: string;
  ret: number;
  spyRet: number;
  /** Stock minus SPY over the same days. */
  excess: number;
  /** A buy that beat SPY, or a sale of a stock that then lagged SPY. */
  hit: boolean;
  days: number;
}
export interface SinceSummary { buys: number; sells: number; avgBuyExcess: number | null; avgSellExcess: number | null; hitRate: number | null; skipped: number }

export const tradeKey = (t: PersonaTrade) => [t.symbol, t.side, t.date, t.accepted ?? t.filed ?? "", t.action, t.shares].join("|");

/** The first date a follower could trade at the close, or null when the row has no public date. */
export function entryDay(t: PersonaTrade): { date: string; sameDay: boolean } | null {
  if (t.accepted) return { date: t.accepted.slice(0, 10), sameDay: Number(t.accepted.slice(11, 13)) < 20 };
  if (t.form === "ARK daily" && t.date) return { date: t.date, sameDay: false };
  if (t.filed) return { date: t.filed, sameDay: false };
  return null;
}

/** Index of the first bar on or after (sameDay) or strictly after the date. */
const at = (bars: RawBar[], date: string, sameDay: boolean) => bars.findIndex((b) => (sameDay ? b.date >= date : b.date > date));

export function sinceTrade(trades: PersonaTrade[], bars: Record<string, RawBar[]>, spy: RawBar[]): { rows: SinceRow[]; summary: SinceSummary } {
  const rows: SinceRow[] = [];
  let skipped = 0;
  for (const t of trades) {
    if ((t.side !== "buy" && t.side !== "sell") || !t.symbol) continue;
    const e = entryDay(t), b = bars[t.symbol.toUpperCase()];
    if (!e || !b?.length || spy.length < 2) { skipped++; continue; }
    const i = at(b, e.date, e.sameDay);
    if (i < 0 || i >= b.length - 1) { skipped++; continue; }
    const entry = b[i].date, exit = b[b.length - 1].date;
    const j0 = spy.findIndex((x) => x.date >= entry);
    const j1 = spy.length - 1;
    if (j0 < 0 || spy[j1].date < entry) { skipped++; continue; }
    const ret = b[b.length - 1].close / b[i].close - 1, spyRet = spy[j1].close / spy[j0].close - 1;
    const excess = ret - spyRet;
    rows.push({ key: tradeKey(t), ticker: t.symbol, side: t.side, entry, exit, ret, spyRet, excess, hit: t.side === "buy" ? excess > 0 : excess < 0, days: Math.round((Date.parse(exit) - Date.parse(entry)) / 864e5) });
  }
  const buys = rows.filter((r) => r.side === "buy"), sells = rows.filter((r) => r.side === "sell");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    rows,
    summary: { buys: buys.length, sells: sells.length, avgBuyExcess: avg(buys.map((r) => r.excess)), avgSellExcess: avg(sells.map((r) => r.excess)), hitRate: rows.length ? rows.filter((r) => r.hit).length / rows.length : null, skipped },
  };
}
