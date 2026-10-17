import { describe, it, expect } from "vitest";
import { CATALOG_BY_ID } from "./catalog";
import { runBacktestOn } from "./service";
import { syntheticDataset } from "./testData";

const ds = syntheticDataset(15, 9);
const dates = ds.panel.dates;
const threeYearsBack = dates[dates.length - 1 - 3 * 252];
const cfg = { initial: 10_000 };

describe("strategies warm up on history before the look-back window", () => {
  it("a 3-year window of the 200-day filter starts with a real signal, not a warm-up in safety", () => {
    const r = runBacktestOn(ds, CATALOG_BY_ID.trend_200d_spy, { ...cfg, start: threeYearsBack });
    expect(r.run.dates[0]).toBe(threeYearsBack);
    expect(r.window.start).toBe(threeYearsBack);
    expect(r.run.decisions[0].reason).not.toMatch(/Warm-up/);
    expect(r.flags.some((f) => f.code === "warmup")).toBe(false);
    expect(r.window.years).toBeGreaterThan(2.8);
  });
  it("its first position is what the full-history run held on that date", () => {
    const full = runBacktestOn(ds, CATALOG_BY_ID.trend_200d_spy, cfg);
    const windowed = runBacktestOn(ds, CATALOG_BY_ID.trend_200d_spy, { ...cfg, start: threeYearsBack });
    const held = [...full.run.decisions].reverse().find((d) => d.date <= threeYearsBack && d.kind === "rebalance")!;
    expect(windowed.run.decisions[0].targets).toEqual(held.targets);
  });
  it("keeps the warm-up, and its flag, when no earlier history exists", () => {
    const r = runBacktestOn(ds, CATALOG_BY_ID.trend_200d_spy, { ...cfg, start: "1990-01-01" });
    expect(r.run.decisions[0].reason).toMatch(/Warm-up/);
    expect(r.flags.some((f) => f.code === "warmup")).toBe(true);
  });
  it("leaves runs without a window unchanged, and money only enters at the window start", () => {
    const a = runBacktestOn(ds, CATALOG_BY_ID.buy_hold_spy, cfg), b = runBacktestOn(ds, CATALOG_BY_ID.buy_hold_spy, { ...cfg, start: dates[0] });
    expect(b.run.equity).toEqual(a.run.equity);
    const w = runBacktestOn(ds, CATALOG_BY_ID.buy_hold_spy, { ...cfg, start: threeYearsBack, contribution: { amount: 100, frequency: "monthly" } });
    expect(w.run.invested[0]).toBe(10_000);
    expect(w.run.trades.every((t) => t.date > threeYearsBack)).toBe(true);
    expect(w.run.returns.length).toBe(w.run.dates.length - 1);
  });
  it("refuses a window with no dates after its start", () => {
    expect(() => runBacktestOn(ds, CATALOG_BY_ID.buy_hold_spy, { ...cfg, start: "2100-01-01" })).toThrow(/after the start of the window/);
  });
});
