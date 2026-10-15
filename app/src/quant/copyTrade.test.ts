import { describe, it, expect } from "vitest";
import { copyEvents, copySteps, copyTradeDef, runCopyTrade } from "./copyTrade";
import { validateStrategy } from "./strategy";
import { describeRules } from "./rules";
import { syntheticDataset } from "./testData";
import type { PersonaTrade } from "./personas";

const t = (o: Partial<PersonaTrade>): PersonaTrade => ({ date: null, filed: null, symbol: null, asset: "x", side: "buy", action: "Purchase", shares: null, price: null, value: null, detail: "", url: null, ...o });
// synthetic prices start 2004-01-02; ETF tickers stand in for stocks
const trades: PersonaTrade[] = [
  t({ symbol: "QQQ", date: "2005-01-10", filed: "2005-02-20", action: "Purchase" }),
  t({ symbol: "IWM", date: "2005-03-01", filed: "2005-03-30", action: "Purchase (options)" }),
  t({ symbol: "QQQ", date: "2005-06-01", filed: "2005-06-20", side: "sell", action: "Partial sale" }),
  t({ symbol: "IWM", date: "2005-09-01", filed: "2005-10-10", side: "sell", action: "Sale" }),
  t({ symbol: "ZZZZ", date: "2005-04-01", filed: "2005-04-20", action: "Purchase" }),
  t({ symbol: null, asset: "REOF XXV, LLC", date: "2005-04-01", filed: "2005-04-20" }),
  t({ symbol: "EEM", date: "2005-05-01", filed: "2005-05-02", side: "other", action: "Exchange" }),
];

describe("copy-trade events and schedule", () => {
  it("keeps purchases and sales with a ticker and tells full from partial sales", () => {
    const { events, skipped } = copyEvents(trades);
    expect(events.map((e) => [e.ticker, e.side, e.full])).toEqual([
      ["QQQ", "buy", false], ["IWM", "buy", false], ["ZZZZ", "buy", false], ["QQQ", "sell", false], ["IWM", "sell", true],
    ]);
    expect(skipped).toEqual(["REOF XXV, LLC"]);
  });
  it("adds on purchases, keeps on partial sales, removes on full sales, equal weights", () => {
    const { events } = copyEvents(trades);
    const a = copySteps(events, "filed", new Set(["QQQ", "IWM"]));
    expect(a.steps.map((s) => [s.date, s.weights])).toEqual([
      ["2005-02-20", { QQQ: 1 }], ["2005-03-30", { IWM: 0.5, QQQ: 0.5 }], ["2005-06-20", { IWM: 0.5, QQQ: 0.5 }], ["2005-10-10", { QQQ: 1 }],
    ]);
    expect(a.steps[3].note).toMatch(/sold all IWM/);
    expect(copySteps(events, "traded", new Set(["QQQ", "IWM"])).steps[0].date).toBe("2005-01-10");
    const def = copyTradeDef("pelosi", "Nancy Pelosi", a, "filed");
    expect(validateStrategy(def)).toEqual({ ok: true, errors: [] });
    expect(describeRules(def)[0]).toMatch(/Follows 4 dated changes of holdings from 2005-02-20 to 2005-10-10/);
  });
  it("rejects malformed schedules", () => {
    const bad = copyTradeDef("p", "P", { type: "schedule", safe: "SHY", steps: [{ date: "2005-02-01", weights: { QQQ: 0.8, IWM: 0.8 } }] }, "filed");
    expect(validateStrategy(bad).errors.join()).toMatch(/at most 100%/);
    const order = copyTradeDef("p", "P", { type: "schedule", safe: "SHY", steps: [{ date: "2005-02-01", weights: {} }, { date: "2005-01-01", weights: {} }] }, "filed");
    expect(validateStrategy(order).errors.join()).toMatch(/increasing order/);
  });
});

describe("copy-trade backtest", () => {
  const ds = syntheticDataset(3, 5, ["SPY", "SHY", "QQQ", "IWM"]);
  const r = runCopyTrade("pelosi", "Nancy Pelosi", trades, ds, { initial: 10_000 })!;
  it("never holds a stock before its report was filed", () => {
    const firstFiled: Record<string, string> = { QQQ: "2005-02-20", IWM: "2005-03-30" };
    for (const tr of r.filed.run.trades.filter((x) => x.side === "buy" && firstFiled[x.ticker])) {
      expect(tr.decisionDate >= firstFiled[tr.ticker], `${tr.ticker} ${tr.decisionDate}`).toBe(true);
      expect(tr.date > tr.decisionDate).toBe(true);
    }
    expect(r.traded.run.trades.find((x) => x.ticker === "QQQ" && x.side === "buy")!.decisionDate < "2005-02-20").toBe(true);
  });
  it("runs both versions over the same window from the first trade and reports the lag cost", () => {
    expect(r.filed.window.start).toBe(r.traded.window.start);
    expect(r.filed.window.start >= "2005-01-10").toBe(true);
    expect(r.lagCost).toBeCloseTo(r.traded.run.finalValue - r.filed.run.finalValue, 6);
    expect(r.medianLagDays).toBe(29);
    expect(r.filed.benchmark.ticker).toBe("SPY");
  });
  it("lists stocks with no prices and assets with no ticker instead of guessing", () => {
    expect(r.tickers).toEqual(["IWM", "QQQ"]);
    expect(r.unpriced).toEqual(["ZZZZ"]);
    expect(r.skipped).toEqual(["REOF XXV, LLC"]);
    expect(runCopyTrade("x", "X", [t({ symbol: "ZZZZ", date: "2005-01-10", filed: "2005-02-01" })], ds, {})).toBeNull();
  });
});
