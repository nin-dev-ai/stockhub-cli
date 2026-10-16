import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ARK_FORM, parseArkTrades, parseHoldingsDate, summarizeArk } from "./ark";
import { isLiveRow } from "./personas";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

describe("ARK daily trades (real ARKK feed, September to October 2026)", () => {
  const rows = parseArkTrades(JSON.parse(fx("ark-trades-arkk.json")));
  it("turns each trade notification into a buy or sell with signed shares and the fund's weight", () => {
    expect(rows.length).toBe(20);
    const buy = rows.find((r) => r.symbol === "CRWV" && r.date === "2026-09-17")!;
    expect(buy).toMatchObject({ side: "buy", action: "Bought (ARKK)", shares: 191868, price: null, value: null, form: ARK_FORM, filed: "2026-09-17" });
    expect(buy.detail).toBe("0.24% of ARKK · ARK trade notification");
    const sell = rows.find((r) => r.symbol === "SLMT")!;
    expect(sell).toMatchObject({ side: "sell", action: "Sold (ARKK)", shares: -2805 });
    expect(rows.every(isLiveRow)).toBe(true);
  });
  it("skips malformed rows", () => {
    expect(parseArkTrades({ trades: [{ fund: "ARKK", date: "bad", ticker: "X", company: "X", direction: "Buy", shares: 5, etf_percent: 1 }, { fund: "ARKK", date: "2026-10-15", ticker: "Y", company: "Y", direction: "Hold", shares: 5, etf_percent: 1 }, { fund: "ARKK", date: "2026-10-15", ticker: "Z", company: "Z", direction: "Buy", shares: 0, etf_percent: 1 }] })).toEqual([]);
    expect(parseArkTrades(null)).toEqual([]);
  });
  it("reads the date of the official holdings file and summarizes the feed", () => {
    expect(parseHoldingsDate(fx("ark-holdings-arkk.csv"))).toBe("2026-10-16");
    expect(parseHoldingsDate("date,fund\n")).toBeNull();
    const feed = summarizeArk(rows, "2026-10-16", ["ARKX"], "2026-10-16T12:00:00Z");
    expect(feed).toMatchObject({ newestTrade: "2026-10-15", holdingsDate: "2026-10-16", failedFunds: ["ARKX"] });
  });
});
