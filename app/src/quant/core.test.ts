import { describe, it, expect } from "vitest";
import { hashId, stableStringify } from "./hash";
import { makeRng } from "./rng";
import { sma, trailingReturn, drawdownSeries, rollingVol } from "./indicators";
import { computeMetrics, percentile, correlation, growthOf } from "./metrics";

describe("hash", () => {
  it("is independent of key order and sensitive to values", () => {
    expect(hashId({ a: 1, b: [2, 3] })).toBe(hashId({ b: [2, 3], a: 1 }));
    expect(hashId({ a: 1 })).not.toBe(hashId({ a: 2 }));
    expect(hashId({ a: 1 })).toHaveLength(16);
  });
  it("ignores undefined fields", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("rng", () => {
  it("is reproducible per seed and differs across seeds", () => {
    const a = makeRng(42), b = makeRng(42), c = makeRng(43);
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(sa).toEqual(Array.from({ length: 5 }, () => b.next()));
    expect(sa).not.toEqual(Array.from({ length: 5 }, () => c.next()));
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });
  it("normal() has roughly zero mean and unit variance", () => {
    const r = makeRng(7);
    const xs = Array.from({ length: 20000 }, () => r.normal());
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    expect(Math.abs(m)).toBeLessThan(0.03);
    expect(Math.abs(v - 1)).toBeLessThan(0.05);
  });
});

describe("indicators (no look-ahead)", () => {
  it("sma has a NaN warm-up and uses only trailing data", () => {
    const x = [1, 2, 3, 4, 5];
    expect(sma(x, 3).map((v) => (Number.isNaN(v) ? null : v))).toEqual([null, null, 2, 3, 4]);
  });
  it("sma[i] is unchanged when future values change", () => {
    const a = [1, 2, 3, 4, 5, 6], b = [1, 2, 3, 4, 99, 99];
    expect(sma(a, 3)[3]).toBe(sma(b, 3)[3]);
  });
  it("trailingReturn matches the definition", () => {
    const r = trailingReturn([100, 110, 121], 1);
    expect(Number.isNaN(r[0])).toBe(true);
    expect(r[1]).toBeCloseTo(0.1); expect(r[2]).toBeCloseTo(0.1);
  });
  it("drawdownSeries tracks the running peak", () => {
    expect(drawdownSeries([100, 120, 90, 120, 130]).map((v) => +v.toFixed(4))).toEqual([0, 0, -0.25, 0, 0]);
  });
  it("rollingVol is zero for a constant-growth series", () => {
    const p = Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i);
    expect(rollingVol(p, 10)[20]).toBeCloseTo(0, 10);
  });
});

describe("computeMetrics", () => {
  const mkDates = (n: number, start = "2020-01-01") =>
    Array.from({ length: n + 1 }, (_, i) => new Date(Date.parse(start) + i * 864e5).toISOString().slice(0, 10));

  it("reports no observations as unavailable, not zero", () => {
    const m = computeMetrics([], ["2020-01-01"]);
    expect(m.totalReturn).toBeNull();
    expect(m.unavailable.cagr).toBeDefined();
  });
  it("computes total return and max drawdown", () => {
    const r = [0.1, -0.2, 0.05];
    const m = computeMetrics(r, mkDates(3));
    expect(m.totalReturn).toBeCloseTo(1.1 * 0.8 * 1.05 - 1);
    expect(m.maxDrawdown).toBeCloseTo(-0.2);
    expect(m.bestDay).toBe(0.1); expect(m.worstDay).toBe(-0.2);
  });
  it("marks risk metrics unavailable under 60 observations", () => {
    const m = computeMetrics(new Array(30).fill(0.001), mkDates(30));
    expect(m.volatility).toBeNull(); expect(m.sharpe).toBeNull(); expect(m.sortino).toBeNull();
    expect(m.unavailable.sharpe).toMatch(/60/);
  });
  it("marks CAGR unavailable under a year and available beyond", () => {
    expect(computeMetrics(new Array(100).fill(0.001), mkDates(100)).cagr).toBeNull();
    const m = computeMetrics(new Array(400).fill(0.0004), mkDates(400));
    expect(m.cagr).not.toBeNull();
    expect(m.cagr!).toBeCloseTo(growthOf(new Array(400).fill(0.0004)) ** (1 / m.years) - 1, 6);
  });
  it("zero-volatility series has no Sharpe rather than Infinity", () => {
    const m = computeMetrics(new Array(100).fill(0.001), mkDates(100));
    expect(m.sharpe).toBeNull(); expect(m.unavailable.sharpe).toMatch(/zero volatility/);
  });
  it("Sharpe falls as the risk-free rate rises", () => {
    const r = Array.from({ length: 200 }, (_, i) => (i % 2 ? 0.004 : -0.001));
    const lo = computeMetrics(r, mkDates(200), { riskFreeRate: 0 }).sharpe!;
    const hi = computeMetrics(r, mkDates(200), { riskFreeRate: 0.05 }).sharpe!;
    expect(hi).toBeLessThan(lo);
  });
});

describe("helpers", () => {
  it("percentile interpolates", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.25)).toBe(2.5);
  });
  it("correlation of identical and inverse series", () => {
    const a = [1, 2, 3, 4, 5];
    expect(correlation(a, a)).toBeCloseTo(1);
    expect(correlation(a, a.map((v) => -v))).toBeCloseTo(-1);
    expect(Number.isNaN(correlation([1, 1, 1], [1, 2, 3]))).toBe(true);
  });
});
