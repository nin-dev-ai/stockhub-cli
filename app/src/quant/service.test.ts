import { describe, it, expect } from "vitest";
import { CATALOG, CATALOG_BY_ID } from "./catalog";
import { validateStrategy, requiredTickers, forkStrategy } from "./strategy";
import { describeRules } from "./rules";
import { runBacktestOn, ValidationError, DataError, SCORECARD_CONFIG, scorecardOf } from "./service";
import { buildDataset, type RawBar } from "./data";
import { INSTRUMENT_BY_TICKER } from "./instruments";
import { syntheticDataset, bdays } from "./testData";

const ds = syntheticDataset(15, 7);

describe("catalog", () => {
  it("has 8-24 strategies with unique ids that all validate", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(8);
    expect(CATALOG.length).toBeLessThanOrEqual(24);
    expect(new Set(CATALOG.map((s) => s.id)).size).toBe(CATALOG.length);
    for (const s of CATALOG) expect(validateStrategy(s), s.id).toEqual({ ok: true, errors: [] });
  });
  it("only uses supported US ETFs and states caveats and methodology", () => {
    for (const s of CATALOG) {
      for (const t of requiredTickers(s)) expect(INSTRUMENT_BY_TICKER[t], `${s.id} ${t}`).toBeDefined();
      expect(s.caveats.length).toBeGreaterThan(0);
      expect(s.methodology.length).toBeGreaterThan(20);
      expect(describeRules(s).length).toBeGreaterThan(1);
    }
  });
  it("marks the seasonal rule experimental and never claims live verification", () => {
    expect(CATALOG_BY_ID.seasonal_halloween.experimental).toBe(true);
    expect(CATALOG.every((s) => s.evidence === "Backtested")).toBe(true);
  });
  it("contains no leverage: every static weight set sums to 1", () => {
    for (const s of CATALOG) if (s.allocation.type === "static") {
      expect(Object.values(s.allocation.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
  });
});

describe("running every catalog strategy", () => {
  for (const s of CATALOG) {
    it(`${s.id} runs and reports consistent accounting`, () => {
      const r = runBacktestOn(ds, s, SCORECARD_CONFIG);
      expect(r.run.equity.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      expect(r.run.tradeCount).toBeGreaterThan(0);
      expect(r.run.finalValue).toBeCloseTo(r.run.equity[r.run.equity.length - 1]);
      expect(r.run.totalContributed).toBeGreaterThan(SCORECARD_CONFIG.initial);
      expect(r.run.gain).toBeCloseTo(r.run.finalValue - r.run.totalContributed);
      expect(r.run.metrics.cagr).not.toBeNull();
      expect(r.conventions.join(" ")).toMatch(/next trading day's close/);
      for (const t of r.run.trades) {
        expect(t.reason.length).toBeGreaterThan(0);
        expect(t.date > t.decisionDate).toBe(true);
      }
    });
  }
});

describe("reproducibility and run ids", () => {
  const s = CATALOG_BY_ID.trend_200d_spy;
  it("identical inputs give an identical run id and identical results", () => {
    const a = runBacktestOn(ds, s, SCORECARD_CONFIG), b = runBacktestOn(ds, s, SCORECARD_CONFIG);
    expect(a.runId).toBe(b.runId);
    expect(a.run).toEqual(b.run);
    expect(a.dataset.id).toBe(ds.version.id);
  });
  it("any change to strategy, config or data changes the id", () => {
    const base = runBacktestOn(ds, s, SCORECARD_CONFIG).runId;
    expect(runBacktestOn(ds, s, { ...SCORECARD_CONFIG, initial: 5000 }).runId).not.toBe(base);
    expect(runBacktestOn(ds, { ...s, allocation: { type: "trend", risky: "SPY", safe: "SHY", smaDays: 150, bandPct: 0.01 } }, SCORECARD_CONFIG).runId).not.toBe(base);
    expect(runBacktestOn(syntheticDataset(15, 8), s, SCORECARD_CONFIG).runId).not.toBe(base);
  });
  it("records dataset, window, benchmark and costs (AC-05)", () => {
    const r = runBacktestOn(ds, s, SCORECARD_CONFIG);
    expect(r.window.start).toBe(ds.panel.dates[0]);
    expect(r.benchmark.ticker).toBe("SPY");
    expect(r.config.costs.slippageBps).toBe(2);
    expect(r.dataset.adjustedPriceBasis).toMatch(/dividends/);
  });
  it("a date range restricts the window", () => {
    const r = runBacktestOn(ds, s, { ...SCORECARD_CONFIG, start: "2012-01-01", end: "2014-12-31" });
    expect(r.window.start >= "2012-01-01").toBe(true);
    expect(r.window.end <= "2014-12-31").toBe(true);
  });
});

describe("strategy behaviour", () => {
  it("a trend filter limits drawdown in a crash that buy-and-hold suffers", () => {
    const n = 1200;
    const spy = Array.from({ length: n }, (_, i) => (i < 500 ? 100 * 1.0006 ** i : i < 620 ? 100 * 1.0006 ** 500 * 0.995 ** (i - 500) : 100 * 1.0006 ** 500 * 0.995 ** 120 * 1.0008 ** (i - 620)));
    const dates = bdays("2010-01-04", n);
    const raw: Record<string, RawBar[]> = {
      SPY: dates.map((date, i) => ({ date, close: spy[i] })),
      SHY: dates.map((date, i) => ({ date, close: 100 * 1.00005 ** i })),
    };
    const crash = buildDataset(raw, { provider: "t", fetchedAt: `${dates[n - 1]}T00:00:00Z` });
    const r = runBacktestOn(crash, CATALOG_BY_ID.trend_200d_spy, { initial: 10000 });
    expect(r.benchmark.run.metrics.maxDrawdown!).toBeLessThan(-0.4);
    expect(r.run.metrics.maxDrawdown!).toBeGreaterThan(r.benchmark.run.metrics.maxDrawdown! + 0.1);
    expect(r.excess.maxDrawdown!).toBeGreaterThan(0.1);
  });
  it("lump-sum and DCA differ only through the initial capital", () => {
    const lump = runBacktestOn(ds, CATALOG_BY_ID.buy_hold_spy, { initial: 10000 });
    const dca = runBacktestOn(ds, CATALOG_BY_ID.dca_spy_12m, { initial: 10000 });
    expect(dca.run.totalContributed).toBe(lump.run.totalContributed);
    expect(dca.run.equity[100]).not.toBeCloseTo(lump.run.equity[100], 0);
  });
});

describe("errors and data quality", () => {
  it("rejects an invalid definition with specific messages", () => {
    const bad = { ...CATALOG_BY_ID.buy_hold_spy, allocation: { type: "static" as const, weights: { SPY: 0.8, AGG: 0.8 } } };
    try { runBacktestOn(ds, bad); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).errors.join()).toMatch(/sum to 100%/);
    }
  });
  it("refuses to run when a required instrument has no data", () => {
    const only = syntheticDataset(5, 1, ["SPY"]);
    expect(() => runBacktestOn(only, CATALOG_BY_ID.trend_200d_spy)).toThrow(DataError);
  });
  it("surfaces data-quality flags and short-window warnings", () => {
    const short = syntheticDataset(0.5, 1);
    const r = runBacktestOn(short, CATALOG_BY_ID.buy_hold_spy, { initial: 1000 });
    expect(r.flags.map((f) => f.code)).toContain("short_window");
    expect(r.run.metrics.cagr).toBeNull();
    expect(r.run.metrics.unavailable.cagr).toBeDefined();
  });
  it("forking creates an independent draft", () => {
    const f = forkStrategy(CATALOG_BY_ID.trend_200d_spy, "my_trend_150");
    (f.allocation as { smaDays: number }).smaDays = 150;
    expect((CATALOG_BY_ID.trend_200d_spy.allocation as { smaDays: number }).smaDays).toBe(200);
    expect(f.forkOf).toBe("trend_200d_spy@1");
    expect(validateStrategy(f).ok).toBe(true);
  });
});

describe("robustness", () => {
  it("is insufficient on a short history and explains why", () => {
    const r = runBacktestOn(syntheticDataset(4, 3), CATALOG_BY_ID.trend_200d_spy, SCORECARD_CONFIG, { robustness: true });
    expect(r.robustness!.verdict).toBe("insufficient");
    expect(r.robustness!.reasons[0]).toMatch(/years/);
  });
  it("on a long history reports a split, rolling windows and sensitivity rows deterministically", () => {
    const r1 = runBacktestOn(ds, CATALOG_BY_ID.trend_200d_spy, SCORECARD_CONFIG, { robustness: true });
    const r2 = runBacktestOn(ds, CATALOG_BY_ID.trend_200d_spy, SCORECARD_CONFIG, { robustness: true });
    const rb = r1.robustness!;
    expect(rb.split!.train.end < rb.split!.date).toBe(true);
    expect(rb.split!.test.start >= rb.split!.date).toBe(true);
    expect(rb.rolling.windows.length).toBeGreaterThanOrEqual(5);
    expect(rb.sensitivity.length).toBe(2);
    expect(rb.sensitivity[0].rows.map((x) => x.value)).toEqual([100, 150, 200, 250]);
    expect(["consistent", "mixed", "inconsistent"]).toContain(rb.verdict);
    expect(rb.rules.length).toBeGreaterThan(3);
    expect(r1.robustness).toEqual(r2.robustness);
  });
  it("labels the benchmark strategy a baseline and does not judge informational parameters", () => {
    expect(runBacktestOn(ds, CATALOG_BY_ID.buy_hold_spy, SCORECARD_CONFIG, { robustness: true }).robustness!.verdict).toBe("baseline");
    const dca = runBacktestOn(ds, CATALOG_BY_ID.dca_spy_12m, SCORECARD_CONFIG, { robustness: true }).robustness!;
    expect(dca.sensitivity[0].informational).toBe(true);
    expect(dca.verdict).not.toBe("inconsistent");
  });
  it("flags an unstable parameter as inconsistent", () => {
    const wobbly = { ...CATALOG_BY_ID.momentum_rotation, sensitivity: [{ path: "allocation.topN", values: [1, 5] }] };
    const rb = runBacktestOn(ds, wobbly, SCORECARD_CONFIG, { robustness: true }).robustness!;
    const s = rb.sensitivity[0];
    expect(s.stable === false ? rb.verdict : "inconsistent").toBe("inconsistent");
  });
});

describe("scorecard", () => {
  it("summarizes a run with provenance", () => {
    const r = runBacktestOn(ds, CATALOG_BY_ID.rebalance_quarterly_6040, SCORECARD_CONFIG, { robustness: true });
    const sc = scorecardOf(r);
    expect(sc.runId).toBe(r.runId);
    expect(sc.datasetId).toBe(ds.version.id);
    expect(sc.excessCagr).toBeCloseTo(r.run.metrics.cagr! - r.benchmark.run.metrics.cagr!);
  });
});
