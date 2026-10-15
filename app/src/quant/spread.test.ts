import { describe, it, expect } from "vitest";
import { CATALOG_BY_ID } from "./catalog";
import { applyTarget, primaryRisky, requiredTickers, sleeveDef, validateStrategy, withSpread } from "./strategy";
import { runBacktestOn } from "./service";
import { syntheticDataset } from "./testData";

const ds = syntheticDataset(12, 3);
const cfg = { initial: 1000, contribution: { amount: 100, frequency: "monthly" as const } };
const gc = CATALOG_BY_ID.golden_cross_spy;

describe("spreading a strategy across ETFs", () => {
  it("finds the ETF a strategy trades", () => {
    expect(primaryRisky(gc)).toBe("SPY");
    expect(primaryRisky(CATALOG_BY_ID.rebalance_quarterly_6040)).toBe("SPY");
    expect(primaryRisky(CATALOG_BY_ID.momentum_rotation)).toBeNull();
    expect(withSpread(CATALOG_BY_ID.momentum_rotation, ["SPY", "QQQ"])).toBeNull();
  });

  it("builds a valid definition whose sleeves trade each ETF", () => {
    const d = withSpread(gc, ["SPY", "QQQ", "IWM"])!;
    expect(validateStrategy(d)).toEqual({ ok: true, errors: [] });
    expect(d.spread!.targets.map((t) => t.weight).reduce((a, b) => a + b)).toBeCloseTo(1, 9);
    expect(d.name).toMatch(/across SPY\+QQQ\+IWM/);
    expect(requiredTickers(d)).toEqual(expect.arrayContaining(["SPY", "QQQ", "IWM", "SHY"]));
    expect((sleeveDef(d, "QQQ").allocation as { risky: string }).risky).toBe("QQQ");
  });

  it("rejects bad spreads", () => {
    const d = withSpread(gc, ["SPY", "QQQ"])!;
    expect(validateStrategy({ ...d, spread: { ...d.spread!, targets: [{ ticker: "SPY", weight: 0.7 }, { ticker: "QQQ", weight: 0.7 }] } }).errors.join()).toMatch(/sum to 100%/);
    expect(validateStrategy({ ...d, spread: { ...d.spread!, targets: [{ ticker: "SPY", weight: 0.5 }, { ticker: "SPY", weight: 0.5 }] } }).errors.join()).toMatch(/must not repeat/);
    expect(validateStrategy({ ...d, spread: { ...d.spread!, from: "GLD" } }).errors.join()).toMatch(/does not trade/);
    expect(validateStrategy({ ...d, spread: { ...d.spread!, targets: [{ ticker: "ZZZZ", weight: 1 }] } }).ok).toBe(false);
  });

  it("with one ETF reproduces the single-ETF run exactly", () => {
    const one = { ...gc, id: "gc_one", spread: { from: "SPY", targets: [{ ticker: "QQQ", weight: 1 }] } };
    expect(validateStrategy(one).ok).toBe(true);
    const a = runBacktestOn(ds, one, cfg), b = runBacktestOn(ds, applyTarget(gc, { SPY: "QQQ" }), cfg);
    expect(a.run.equity.length).toBe(b.run.equity.length);
    a.run.equity.forEach((v, i) => expect(v).toBeCloseTo(b.run.equity[i], 6));
    expect(a.run.metrics.cagr).toBeCloseTo(b.run.metrics.cagr!, 10);
  });

  it("adds the sleeves: values and contributions are the sums of each ETF's run", () => {
    const d = withSpread(gc, ["SPY", "QQQ", "IWM"])!;
    const r = runBacktestOn(ds, d, cfg);
    const sleeves = r.run.sleeves!;
    expect(sleeves.map((s) => s.ticker)).toEqual(["SPY", "QQQ", "IWM"]);
    const last = r.run.equity.length - 1;
    expect(r.run.equity[last]).toBeCloseTo(sleeves.reduce((s, x) => s + x.equity[last], 0), 6);
    expect(r.run.totalContributed).toBeCloseTo(sleeves.reduce((s, x) => s + x.totalContributed, 0), 6);
    expect(r.run.trades.every((t) => /^\[(SPY|QQQ|IWM)\] /.test(t.reason))).toBe(true);
    const exposure = Object.values(r.run.avgExposure).reduce((a, b) => a + b, 0);
    expect(exposure).toBeCloseTo(1, 2);
  });

  it("reports per-ETF results, correlation and both baselines", () => {
    const d = withSpread(gc, ["SPY", "QQQ"])!;
    const r = runBacktestOn(ds, d, cfg);
    const sp = r.spread!;
    expect(sp.sleeves.map((s) => s.ticker)).toEqual(["SPY", "QQQ"]);
    expect(sp.correlation[0][0]).toBe(1);
    expect(sp.correlation[0][1]).toBeCloseTo(sp.correlation[1][0], 12);
    expect(Math.abs(sp.correlation[0][1])).toBeLessThan(1);
    expect(sp.single.ticker).toBe("SPY");
    expect(sp.single.finalValue).toBeCloseTo(runBacktestOn(ds, gc, cfg).run.finalValue, 6);
    expect(sp.buyHold.finalValue).toBeGreaterThan(0);
    expect(sp.summary).toMatch(/Spreading across SPY, QQQ/);
    expect(sp.sleeves.reduce((s, x) => s + (x.gainShare ?? 0), 0)).toBeCloseTo(1, 6);
  });

  it("keeps runs reproducible and leaves non-spread results without a spread section", () => {
    const d = withSpread(gc, ["SPY", "QQQ"])!;
    expect(runBacktestOn(ds, d, cfg).runId).toBe(runBacktestOn(ds, d, cfg).runId);
    expect(runBacktestOn(ds, gc, cfg).spread).toBeNull();
  });
});
