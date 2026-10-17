import { describe, it, expect } from "vitest";
import { figiBatches, figiBody, parseFigi } from "./figi";
import { actDay, copyEvents, fundSteps, runFundCopy, type FundQuarter } from "./copyTrade";
import { syntheticDataset } from "./testData";
import type { PersonaTrade } from "./personas";

describe("CUSIP to ticker (OpenFIGI)", () => {
  it("sends foreign (CINS) codes as CINS and asks for US listings only", () => {
    expect(figiBody(["H1467J104", "23331A109"])).toEqual([{ idType: "ID_CINS", idValue: "H1467J104", exchCode: "US" }, { idType: "ID_CUSIP", idValue: "23331A109", exchCode: "US" }]);
  });
  it("batches ten valid CUSIPs at a time and prefers the US equity listing", () => {
    expect(figiBatches([...Array(23)].map((_, i) => `0378331${String(i).padStart(2, "0")}`)).map((b) => b.length)).toEqual([10, 10, 3]);
    expect(figiBatches(["bad", "037833100", "037833100"])).toEqual([["037833100"]]);
    const resp = [
      { data: [{ ticker: "AAPL", exchCode: "UA", marketSector: "Equity" }, { ticker: "AAPL", exchCode: "US", marketSector: "Equity" }] },
      { data: [{ ticker: "BRK B", exchCode: "US", marketSector: "Equity" }] },
      { warning: "No identifier found." },
    ];
    expect(parseFigi(resp, ["037833100", "084670702", "000000000"])).toEqual({ "037833100": "AAPL", "084670702": "BRK-B", "000000000": null });
    expect(parseFigi([{ data: [{ ticker: "HEI/A", exchCode: "US", marketSector: "Equity" }] }], ["422806208"])).toEqual({ "422806208": "HEI-A" });
  });
});

describe("copying a fund's 13F", () => {
  const quarters: FundQuarter[] = [
    { period: "2005-03-31", holdings: [{ cusip: "A", issuer: "Alpha", value: 600 }, { cusip: "B", issuer: "Beta", value: 300 }, { cusip: "X", issuer: "No Ticker Co", value: 100 }] },
    { period: "2005-06-30", holdings: [{ cusip: "A", issuer: "Alpha", value: 200 }, { cusip: "C", issuer: "Gamma", value: 800 }] },
  ];
  const tickerOf = { A: "QQQ", B: "IWM", C: "EFA", X: null };
  const priced = new Set(["QQQ", "IWM", "EFA"]);
  it("holds the largest priced holdings by value, from each quarter's 45-day deadline", () => {
    const f = fundSteps(quarters, tickerOf, priced, "filed");
    expect(f.allocation.steps.map((s) => s.date)).toEqual(["2005-05-15", "2005-08-14"]);
    expect(f.allocation.steps[0].weights).toEqual({ QQQ: 600 / 900, IWM: 300 / 900 });
    expect(f.allocation.steps[1].weights).toEqual({ EFA: 0.8, QQQ: 0.2 });
    expect(f.coverage[0]).toBeCloseTo(0.9, 12);
    expect(f.unmapped).toEqual(["No Ticker Co"]);
    expect(fundSteps(quarters, tickerOf, priced, "traded").allocation.steps[0].date).toBe("2005-03-31");
    expect(fundSteps(quarters, tickerOf, priced, "filed", 1).allocation.steps[1].weights).toEqual({ EFA: 1 });
  });
  it("never holds a quarter's portfolio before its filing deadline, and runs both versions over one window", () => {
    const ds = syntheticDataset(3, 2, ["SPY", "SHY", "QQQ", "IWM", "EFA"]);
    const r = runFundCopy("buffett", "Warren Buffett", quarters, tickerOf, ds, { initial: 10_000 })!;
    expect(r.kind).toBe("fund");
    expect(r.filed.window.start).toBe(r.traded.window.start);
    const firstBuy = r.filed.run.trades.filter((t) => t.side === "buy" && t.ticker !== "SHY").map((t) => t.decisionDate).sort()[0];
    expect(firstBuy >= "2005-05-15").toBe(true);
    const efa = r.filed.run.trades.filter((t) => t.ticker === "EFA" && t.side === "buy").map((t) => t.decisionDate).sort()[0];
    expect(efa >= "2005-08-14").toBe(true);
    expect(r.coverage).toBeCloseTo((0.9 + 1) / 2, 12);
    expect(r.skipped).toEqual(["No Ticker Co"]);
    expect(r.unpriced).toEqual([]);
    // a holding below the top-N cut is not reported as missing, but a wanted one without prices is
    const small = runFundCopy("x", "X", quarters, { ...tickerOf, B: "ZZZZ" }, ds, { initial: 10_000 })!;
    expect(small.unpriced).toEqual(["ZZZZ"]);
    expect(r.filed.strategy.name).toMatch(/filing deadline/);
  });
});

describe("acting on SEC filings at the first close after they are public", () => {
  const t = (o: Partial<PersonaTrade>): PersonaTrade => ({ date: "2026-10-01", filed: "2026-10-05", symbol: "LEN", asset: "Lennar", side: "buy", action: "Open-market purchase", shares: 1, price: 1, value: 1, detail: "", url: null, ...o });
  it("uses that day before the 20:00 UTC close, the next day after it, the filing date otherwise", () => {
    expect(actDay(t({ accepted: "2026-10-06T05:02:56Z" }))).toBe("2026-10-06");
    expect(actDay(t({ accepted: "2026-10-05T21:15:00Z" }))).toBe("2026-10-06");
    expect(actDay(t({}))).toBe("2026-10-05");
    expect(copyEvents([t({ accepted: "2026-10-05T21:15:00Z" })]).events[0].filed).toBe("2026-10-06");
  });
});
