import { describe, expect, it } from "vitest";
import { CATALOG_BY_ID } from "./catalog";
import { currentTargets } from "./backtest";
import { crisisFalls, holdingToday, isYardstick, nextCheckDate, todayLine, tradeOff } from "./cardFacts";
import { runBacktestOn, SCORECARD_CONFIG } from "./service";
import { syntheticDataset } from "./testData";

const def = CATALOG_BY_ID["trend_200d_spy"];
const fake = (cagrGap: number, dd: number, bdd: number) => ({
  excess: { cagr: cagrGap, totalReturn: null, maxDrawdown: null, finalValue: 0 },
  run: { metrics: { maxDrawdown: dd } }, benchmark: { ticker: "SPY", run: { metrics: { maxDrawdown: bdd } } },
}) as never;

describe("trade-off line", () => {
  it("states what was given up for a shallower fall", () => {
    expect(tradeOff(def, fake(-0.025, -0.227, -0.552))).toBe("Gives up 2.5 points a year against SPY to cut its worst fall from −55% to −23%.");
  });
  it("covers beating, trailing and matching the benchmark", () => {
    expect(tradeOff(def, fake(0.01, -0.3, -0.55))).toMatch(/^Beat SPY by 1\.0 point a year with a shallower worst fall/);
    expect(tradeOff(def, fake(0.01, -0.6, -0.55))).toMatch(/^Beat SPY by 1\.0 point a year but fell further \(−60% against −55%\)/);
    expect(tradeOff(def, fake(-0.02, -0.6, -0.55))).toMatch(/^Trailed SPY by 2\.0 points a year and fell further/);
    expect(tradeOff(def, fake(0.0004, -0.55, -0.552))).toBe("Grew and fell about like SPY.");
  });
  it("calls the benchmark buy-and-hold the yardstick", () => {
    const bh = CATALOG_BY_ID["buy_hold_spy"];
    expect(isYardstick(bh)).toBe(true);
    expect(isYardstick(def)).toBe(false);
    expect(isYardstick(CATALOG_BY_ID["dca_spy_12m"])).toBe(false);
    expect(isYardstick(CATALOG_BY_ID["drawdown_reserve_spy"])).toBe(false);
    expect(tradeOff(bh, fake(0, -0.5, -0.5))).toMatch(/^The yardstick/);
  });
});

describe("crisis falls", () => {
  it("measures the worst peak-to-trough fall inside each window and skips windows the data misses", () => {
    const dates = ["2020-02-18", "2020-02-19", "2020-02-20", "2020-03-02", "2020-03-23", "2020-03-24"];
    // returns[k] lands on dates[k+1]: +10%, -20%, +5% inside the window, so the worst point is the -20% before the bounce; the 50% before it and the -10% after it are ignored
    const returns = [0.5, 0.1, -0.2, 0.05, -0.1];
    const f = crisisFalls({ dates, returns });
    expect(f.find((c) => c.id === "covid")!.fall).toBeCloseTo(-0.2, 12);
    expect(f.find((c) => c.id === "gfc")!.fall).toBeNull();
  });
});

describe("what it holds today", () => {
  const ds = syntheticDataset(15, 11);
  it("matches the last targets and dates the last switch for a signal strategy", () => {
    const r = runBacktestOn(ds, def, SCORECARD_CONFIG);
    const h = holdingToday(def, r);
    const now = currentTargets(r.run);
    expect(h.holds.map((x) => x.ticker).sort()).toEqual(Object.keys(now).filter((k) => k !== "CASH" && now[k] > 0.005).sort());
    expect(h.fixed).toBe(false);
    if (h.before) {
      expect(h.since).not.toBeNull();
      const firstSame = r.run.decisions.find((d) => d.kind === "rebalance" && d.date === h.since)!;
      expect(firstSame).toBeTruthy();
    }
    expect(todayLine(h)).toMatch(/^(In|Holds) /);
  });
  it("calls a fixed mix a fixed mix", () => {
    const sixty = CATALOG_BY_ID["rebalance_quarterly_6040"];
    const h = holdingToday(sixty, runBacktestOn(ds, sixty, SCORECARD_CONFIG));
    expect(h.fixed).toBe(true);
    expect(todayLine(h)).toMatch(/\(fixed mix\)/);
  });
  it("finds the next scheduled check on a weekday", () => {
    expect(nextCheckDate("monthly", "2026-10-16")).toBe("2026-11-02");
    expect(nextCheckDate("quarterly", "2026-10-16")).toBe("2027-01-01");
    expect(nextCheckDate("annual", "2026-10-16")).toBe("2027-01-01");
    expect(nextCheckDate("weekly", "2026-10-16")).toBe("2026-10-19");
    expect(nextCheckDate("none", "2026-10-16")).toBeNull();
  });
});
