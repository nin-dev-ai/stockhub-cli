import { describe, it, expect } from "vitest";
import { simulate, DEFAULT_CONFIG, type RunConfig } from "./backtest";
import { CATALOG, CATALOG_BY_ID } from "./catalog";
import { rsi } from "./indicators";
import { INSTRUMENT_BY_TICKER, INSTRUMENTS } from "./instruments";
import { describeRules } from "./rules";
import { runBacktestOn, SCORECARD_CONFIG } from "./service";
import { requiredTickers, retarget, validateStrategy, type StrategyDef } from "./strategy";
import { bdays, syntheticDataset } from "./testData";
import type { Panel } from "./types";

const NOCOST: RunConfig = { ...DEFAULT_CONFIG, initial: 1000, costs: { commissionBps: 0, slippageBps: 0, fixedFee: 0 } };
const def = (over: Partial<StrategyDef>): StrategyDef => ({
  schema: 1, id: "test_strategy", version: 1, name: "Test strategy", summary: "", intendedUse: "", tags: [],
  region: "US", holdingPeriod: "", universe: ["SPY"], benchmark: "SPY",
  allocation: { type: "static", weights: { SPY: 1 } }, rebalance: { schedule: "daily" },
  methodology: "", caveats: [], evidence: "Backtested", ...over,
});
const panel = (closes: Record<string, number[]>): Panel => ({ dates: bdays("2024-01-02", Object.values(closes)[0].length), closes });
const lastTargets = (r: ReturnType<typeof simulate>) => r.decisions[r.decisions.length - 1].targets;

describe("rsi", () => {
  it("is 100 after only gains, 0 after only losses, NaN during warm-up", () => {
    expect(rsi([1, 2, 3, 4], 2)).toEqual([NaN, NaN, 100, 100]);
    expect(rsi([4, 3, 2, 1], 2).slice(2)).toEqual([0, 0]);
  });
  it("uses only past data", () => {
    const x = [10, 11, 10.5, 10.2, 11, 11.5, 11.2];
    expect(rsi(x, 2).slice(0, 5)).toEqual(rsi(x.slice(0, 5), 2));
  });
});

describe("risk_parity", () => {
  it("weights the calmer asset more, in proportion to inverse volatility", () => {
    const n = 40;
    const calm = Array.from({ length: n }, (_, i) => 100 * (1 + 0.005 * (i % 2 ? 1 : -1)));
    const wild = Array.from({ length: n }, (_, i) => 100 * (1 + 0.02 * (i % 2 ? 1 : -1)));
    const d = def({ universe: ["SPY", "TLT"], allocation: { type: "risk_parity", assets: ["SPY", "TLT"], lookbackDays: 10 } });
    const t = lastTargets(simulate(d, panel({ SPY: wild, TLT: calm }), NOCOST));
    expect(t.TLT).toBeCloseTo(0.8, 1);
    expect(t.SPY + t.TLT).toBeCloseTo(1);
  });
});

describe("multi_trend", () => {
  it("moves only the slot of the asset below its average to the safe asset", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 130 - i);
    const flat = Array(30).fill(100);
    const d = def({ universe: ["SPY", "EFA", "SHY"], allocation: { type: "multi_trend", assets: ["SPY", "EFA"], smaDays: 10, safe: "SHY" } });
    const t = lastTargets(simulate(d, panel({ SPY: up, EFA: down, SHY: flat }), NOCOST));
    expect(t).toEqual({ SPY: 0.5, SHY: 0.5 });
  });
});

describe("crossover", () => {
  it("holds the safe asset until the fast average crosses above the slow one", () => {
    const px = [...Array(20).fill(100), ...Array.from({ length: 20 }, (_, i) => 101 + i)];
    const d = def({ universe: ["SPY", "SHY"], allocation: { type: "crossover", risky: "SPY", safe: "SHY", fastDays: 3, slowDays: 10 } });
    const r = simulate(d, panel({ SPY: px, SHY: Array(40).fill(100) }), NOCOST);
    expect(r.decisions[0].targets).toEqual({ SHY: 1 });
    expect(lastTargets(r)).toEqual({ SPY: 1 });
    expect(r.trades.find((t) => t.ticker === "SPY")!.decisionDate >= r.dates[20]).toBe(true);
  });
  it("rejects a fast average that is not shorter than the slow one", () => {
    const d = def({ allocation: { type: "crossover", risky: "SPY", safe: "SHY", fastDays: 50, slowDays: 50 } });
    expect(validateStrategy(d).errors.join(" ")).toMatch(/fastDays must be shorter/);
  });
});

describe("mean_reversion", () => {
  it("buys after a sharp dip and sells after the bounce", () => {
    const px = [100, 101, 102, 103, 104, 98, 95, 99, 104, 106, 107, 108];
    const d = def({ universe: ["SPY", "SHY"], allocation: { type: "mean_reversion", risky: "SPY", safe: "SHY", rsiDays: 2, entryRsi: 10, exitRsi: 70, trendDays: 0 } });
    const r = simulate(d, panel({ SPY: px, SHY: Array(px.length).fill(100) }), NOCOST);
    const buys = r.trades.filter((t) => t.ticker === "SPY" && t.side === "buy");
    const sells = r.trades.filter((t) => t.ticker === "SPY" && t.side === "sell");
    expect(buys).toHaveLength(1);
    expect(buys[0].decisionDate).toBe(r.dates[6]); // RSI(2) 14.3 after the first drop, 7.7 after the second
    expect(sells).toHaveLength(1);
    expect(sells[0].decisionDate > buys[0].decisionDate).toBe(true);
    expect(buys[0].reason).toMatch(/RSI\(2\)/);
  });
  it("skips dips below the trend filter", () => {
    const px = [...Array.from({ length: 25 }, (_, i) => 200 - 2 * i), 140, 130];
    const d = def({ universe: ["SPY", "SHY"], allocation: { type: "mean_reversion", risky: "SPY", safe: "SHY", rsiDays: 2, entryRsi: 10, exitRsi: 70, trendDays: 20 } });
    const r = simulate(d, panel({ SPY: px, SHY: Array(px.length).fill(100) }), NOCOST);
    expect(r.trades.some((t) => t.ticker === "SPY")).toBe(false);
  });
});

describe("expanded catalog", () => {
  it("new rule types have plain-English rules", () => {
    for (const id of ["risk_parity_4", "gtaa_trend_5", "golden_cross_spy", "rsi2_pullback_spy"]) {
      expect(describeRules(CATALOG_BY_ID[id]).join(" ").length, id).toBeGreaterThan(80);
    }
  });
  it("catalog ETFs all have history from before 2005, so the shared window is not shortened", () => {
    for (const s of CATALOG) for (const t of requiredTickers(s)) expect(INSTRUMENT_BY_TICKER[t].inception < "2005-01-01", `${s.id} ${t}`).toBe(true);
  });
  it("every instrument has a unique ticker", () => {
    expect(new Set(INSTRUMENTS.map((i) => i.ticker)).size).toBe(INSTRUMENTS.length);
  });
});

describe("retarget", () => {
  const ds = syntheticDataset(12, 3);

  it("runs a single-ETF rule on another ETF and benchmarks against that ETF", () => {
    const r = retarget(CATALOG_BY_ID.trend_200d_spy, { SPY: "QQQ" });
    expect(r.id).toBe("trend_200d_spy_on_qqq");
    expect(r.allocation).toMatchObject({ risky: "QQQ", safe: "SHY" });
    expect(r.benchmark).toBe("QQQ");
    expect(r.name).toMatch(/SPY→QQQ/);
    expect(r.caveats[0]).toMatch(/not been re-tuned for QQQ/);
    expect(r.forkOf).toBe("trend_200d_spy@1");
    expect(validateStrategy(r).ok).toBe(true);
    const res = runBacktestOn(ds, r, SCORECARD_CONFIG);
    expect(res.benchmark.ticker).toBe("QQQ");
    expect(res.run.trades.some((t) => t.ticker === "QQQ")).toBe(true);
  });

  it("leaves the original untouched and is a no-op for an identity map", () => {
    const orig = structuredClone(CATALOG_BY_ID.rebalance_quarterly_6040);
    retarget(CATALOG_BY_ID.rebalance_quarterly_6040, { SPY: "VTI", AGG: "BND" });
    expect(CATALOG_BY_ID.rebalance_quarterly_6040).toEqual(orig);
    expect(retarget(orig, { SPY: "SPY" })).toBe(orig);
  });

  it("swaps the defensive asset and follows ticker-named sensitivity paths", () => {
    const r = retarget(CATALOG_BY_ID.cash_buffer_703020, { SHY: "BIL" });
    expect(r.allocation).toEqual({ type: "static", weights: { SPY: 0.7, AGG: 0.2, BIL: 0.1 } });
    expect(r.sensitivity?.[0].path).toBe("allocation.weights.BIL");
    expect(r.benchmark).toBe("SPY");
  });

  it("merges weights and collapses repeated assets that land on the same ETF", () => {
    const r = retarget(CATALOG_BY_ID.momentum_rotation, { SPY: "QQQ" });
    expect(r.allocation.type === "momentum" && r.allocation.universe).toEqual(["QQQ", "IWM", "EFA", "EEM"]);
    const s = retarget(CATALOG_BY_ID.rebalance_quarterly_6040, { AGG: "SPY" });
    expect(s.allocation).toEqual({ type: "static", weights: { SPY: 1 } });
    expect(s.sensitivity).toEqual([{ path: "allocation.weights.SPY", values: [0.5, 0.6, 0.7] }]);
  });

  it("is refused by validation when risky and safe become the same ETF", () => {
    const r = retarget(CATALOG_BY_ID.trend_200d_spy, { SPY: "SHY" });
    expect(validateStrategy(r).errors.join(" ")).toMatch(/must be different/);
  });
});
