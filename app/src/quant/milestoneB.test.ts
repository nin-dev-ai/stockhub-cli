import { describe, it, expect } from "vitest";
import { CATALOG_BY_ID } from "./catalog";
import { runBacktestOn, SCORECARD_CONFIG } from "./service";
import { syntheticDataset } from "./testData";
import { analyzeOverlap } from "./overlap";
import { optimize, OBJECTIVES } from "./optimizer";
import { blendReturns, blendPath, checkWeights, equalWeights, monthlyReturns, evaluateWeights } from "./portfolio";
import { project, contributionAt, totalContributed, MIN_MONTHS } from "./projection";
import { JobManager } from "./jobs";
import { backtestConfig, DEFAULT_LAB, planBacktest, projectionInput, sleeveOf, validateLab } from "./lab";

const ds = syntheticDataset(18, 11);
const run = (id: string, cfg = SCORECARD_CONFIG) => runBacktestOn(ds, CATALOG_BY_ID[id], cfg);
const trio = ["buy_hold_spy", "trend_200d_spy", "permanent_portfolio"].map((id) => run(id));
const sleeves = trio.map(sleeveOf);

describe("overlap", () => {
  it("flags three S&P 500 based strategies as overlapping, not diversified (SIM-03)", () => {
    const spyish = ["buy_hold_spy", "dca_spy_12m", "vol_target_spy"].map((id) => run(id));
    const rep = analyzeOverlap(spyish.map((r) => ({ id: r.strategy.id, name: r.strategy.name, run: r.run })));
    expect(rep.pairs.some((p) => p.level === "high")).toBe(true);
    expect(rep.concentrated).toBe(true);
    expect(rep.warnings.join(" ")).toMatch(/not meaningful diversification/);
    expect(rep.topBucket!.bucket).toBe("us_large");
  });
  it("rates a genuinely different mix as lower overlap", () => {
    const rep = analyzeOverlap([trio[0], trio[2]].map((r) => ({ id: r.strategy.id, name: r.strategy.name, run: r.run })));
    expect(rep.pairs[0].sharedExposure).toBeLessThan(0.6);
    expect(rep.pairs[0].level).not.toBe("high");
  });
  it("exposure shares sum to about 1 per strategy", () => {
    const rep = analyzeOverlap(trio.map((r) => ({ id: r.strategy.id, name: r.strategy.name, run: r.run })));
    for (const e of Object.values(rep.exposure)) expect(Object.values(e).reduce((a, b) => a + (b ?? 0), 0)).toBeCloseTo(1, 1);
  });
});

describe("portfolio helpers", () => {
  it("validates long-only, caps, and sum-to-100%", () => {
    const ids = ["a", "b"];
    expect(checkWeights({ a: 0.5, b: 0.5 }, ids).ok).toBe(true);
    expect(checkWeights({ a: 0.7, b: 0.5 }, ids).errors.join()).toMatch(/sum to 120/);
    expect(checkWeights({ a: 1.2, b: -0.2 }, ids).errors.join()).toMatch(/negative/);
    expect(checkWeights({ a: 0.8, b: 0.2 }, ids, 0.6).errors.join()).toMatch(/cap/);
    expect(checkWeights({ a: 0.5, b: 0.5, c: 0 }, ids).errors.join()).toMatch(/Unknown/);
  });
  it("blending a single sleeve at 100% reproduces it", () => {
    expect(blendReturns(sleeves, { [sleeves[0].id]: 1 })).toEqual(sleeves[0].returns);
  });
  it("blendPath keeps contributions out of returns and matches the invested total", () => {
    const flat = new Array(300).fill(0);
    const dates = sleeves[0].dates.slice(0, 301);
    const p = blendPath(flat, dates, { initial: 1000, contribution: { amount: 100, frequency: "monthly" } });
    p.equity.forEach((v, i) => expect(v).toBeCloseTo(p.invested[i]));
  });
  it("converts daily to monthly returns by compounding", () => {
    const dates = ["2024-01-30", "2024-01-31", "2024-02-01", "2024-02-02", "2024-03-01"];
    const m = monthlyReturns([0.01, 0.02, 0.03, 0.04], dates);
    expect(m.months).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(m.returns[0]).toBeCloseTo(0.01);
    expect(m.returns[1]).toBeCloseTo(1.02 * 1.03 - 1);
  });
});

describe("optimizer (SIM-04, SIM-05)", () => {
  const res = optimize(sleeves, { maxWeight: 0.6 });
  it("returns long-only weights that sum to 100% and respect the cap for every objective", () => {
    for (const o of OBJECTIVES) {
      const w = res.proposals[o.key].weights;
      expect(checkWeights(w, res.ids, 0.6).ok, o.key).toBe(true);
      for (const v of Object.values(w)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(0.6 + 1e-9); }
    }
  });
  it("shows an equal-weight baseline and each strategy alone", () => {
    expect(res.baselines[0].label).toBe("Equal weight");
    expect(res.baselines).toHaveLength(1 + sleeves.length);
    expect(res.baselines[0].weights).toEqual(equalWeights(res.ids));
  });
  it("lower-volatility mode does not have more volatility than the others, and growth targets more return", () => {
    const v = (k: "lower_volatility" | "balanced" | "growth") => res.proposals[k].metrics.volatility!;
    expect(v("lower_volatility")).toBeLessThanOrEqual(v("balanced") + 1e-9);
    expect(v("lower_volatility")).toBeLessThanOrEqual(v("growth") + 1e-9);
    expect(res.proposals.lower_volatility.metrics.volatility!).toBeLessThanOrEqual(res.baselines[0].metrics.volatility! + 1e-9);
  });
  it("the minimum-variance weights beat random weight sets on volatility", () => {
    const best = res.proposals.lower_volatility.metrics.volatility!;
    for (const w of [[0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6], [0.4, 0.3, 0.3]]) {
      const weights = Object.fromEntries(res.ids.map((id, i) => [id, w[i]]));
      expect(evaluateWeights(sleeves, weights, 0).metrics.volatility!).toBeGreaterThanOrEqual(best - 1e-6);
    }
  });
  it("reports binding constraints and the out-of-sample check", () => {
    const capped = optimize(sleeves, { maxWeight: 0.4 });
    const anyBinding = Object.values(capped.proposals).some((p) => p.binding.length > 0);
    expect(anyBinding).toBe(true);
    expect(res.outOfSample).not.toBeNull();
    expect(res.outOfSample!.splitDate > res.window.start).toBe(true);
    expect(res.notes.join(" ")).toMatch(/hindsight|same history/);
  });
  it("raises an infeasible cap instead of returning nothing, and is deterministic", () => {
    const r = optimize(sleeves, { maxWeight: 0.2 });
    expect(r.effectiveCap).toBeCloseTo(1 / 3, 2);
    expect(r.notes.join(" ")).toMatch(/infeasible/);
    expect(optimize(sleeves, { maxWeight: 0.6 })).toEqual(res);
  });
  it("handles a single strategy and refuses too-short histories", () => {
    const one = optimize([sleeves[0]]);
    expect(one.proposals.balanced.weights[sleeves[0].id]).toBe(1);
    expect(() => optimize([{ ...sleeves[0], returns: sleeves[0].returns.slice(0, 30), dates: sleeves[0].dates.slice(0, 31) }])).toThrow(/at least 60/);
  });
});

describe("projection (SIM-06 to SIM-11)", () => {
  const monthly = monthlyReturns(blendReturns(sleeves, equalWeights(sleeves.map((s) => s.id))), sleeves[0].dates).returns;
  const base = { monthlyReturns: monthly, historyStart: "2004-01-02", historyEnd: "2021-12-31", initial: 200, contribution: { amount: 50, frequency: "monthly" as const }, years: 5, method: "bootstrap" as const, paths: 1000, blockMonths: 6, seed: 5, inflation: 0.025 };

  it("USD 200 start, USD 50 monthly, 5 years: contributions are exactly what the user puts in (AC-06)", async () => {
    const r = await project(base);
    expect(r.months).toBe(60);
    expect(r.totalContributed).toBe(200 + 50 * 59);
    expect(r.fan!.contributed[0]).toBe(200);
    expect(r.fan!.contributed[60]).toBe(200 + 50 * 59);
    expect(r.fan!.p50.length).toBe(61);
  });
  it("percentiles are ordered and the fan widens over time", async () => {
    const r = await project(base);
    for (let m = 0; m <= 60; m++) { expect(r.fan!.p10[m]).toBeLessThanOrEqual(r.fan!.p50[m] + 1e-9); expect(r.fan!.p50[m]).toBeLessThanOrEqual(r.fan!.p90[m] + 1e-9); }
    expect(r.fan!.p90[60] - r.fan!.p10[60]).toBeGreaterThan(r.fan!.p90[12] - r.fan!.p10[12]);
    expect(r.ending!.p10).toBeLessThanOrEqual(r.ending!.p90);
    expect(r.endingReal!.p50).toBeLessThan(r.ending!.p50);
  });
  it("is reproducible for a seed and changes with another seed", async () => {
    const a = await project(base), b = await project(base), c = await project({ ...base, seed: 6 });
    expect(a).toEqual(b);
    expect(c.ending!.p50).not.toBe(a.ending!.p50);
    expect(c.runId).not.toBe(a.runId);
  });
  it("with zero-volatility returns every path is the same (deterministic check)", async () => {
    const r = await project({ ...base, monthlyReturns: new Array(120).fill(0.01), initial: 1000, contribution: { amount: 0, frequency: "none" } });
    expect(r.ending!.p10).toBeCloseTo(1000 * 1.01 ** 60, 6);
    expect(r.ending!.p90).toBeCloseTo(1000 * 1.01 ** 60, 6);
    expect(r.probLoss).toBe(0);
  });
  it("suppresses a projection on a short history instead of inventing one (SIM-11)", async () => {
    const r = await project({ ...base, monthlyReturns: monthly.slice(0, MIN_MONTHS - 1) });
    expect(r.quality).toBe("insufficient");
    expect(r.fan).toBeNull(); expect(r.ending).toBeNull();
    expect(r.reasons[0]).toMatch(/No projection is shown/);
  });
  it("flags limited history and a horizon longer than the history", async () => {
    const r = await project({ ...base, monthlyReturns: monthly.slice(0, 90), years: 20 });
    expect(r.quality).toBe("limited");
    expect(r.reasons.join(" ")).toMatch(/longer than/);
  });
  it("scenarios are ordered sensibly and a goal gets a probability", async () => {
    const r = await project({ ...base, goal: 5000 });
    const by = Object.fromEntries(r.scenarios.map((s) => [s.key, s]));
    expect(by.lower_returns.ending.p50).toBeLessThan(by.base.ending.p50);
    expect(by.bad_start.ending.p50).toBeLessThan(by.base.ending.p50);
    expect(r.probGoal).toBeGreaterThanOrEqual(0); expect(r.probGoal).toBeLessThanOrEqual(1);
    expect(r.assumptions.join(" ")).toMatch(/not a worst case/);
  });
  it("supports the parametric method and rejects an out-of-range horizon", async () => {
    const p = await project({ ...base, method: "parametric" });
    expect(p.fan).not.toBeNull();
    expect((await project({ ...base, years: 40 })).quality).toBe("insufficient");
  });
  it("contribution timing: first month has none; weekly converts to a monthly equivalent", () => {
    expect(contributionAt(1, { amount: 50, frequency: "monthly" })).toBe(0);
    expect(contributionAt(2, { amount: 50, frequency: "monthly" })).toBe(50);
    expect(contributionAt(2, { amount: 12, frequency: "weekly" })).toBeCloseTo(52);
    expect(totalContributed(100, 7, { amount: 10, frequency: "quarterly" })).toBe(100 + 20);
  });
  it("reports progress and honours cancellation through the job manager", async () => {
    const jm = new JobManager();
    const progress: number[] = [];
    const id = jm.submit("projection", base, (ctx) => { const orig = ctx.progress; ctx.progress = (p) => { progress.push(p); orig(p); }; return project({ ...base, paths: 2000 }, ctx); });
    const job = await jm.wait(id);
    expect(job.status).toBe("done");
    expect(progress.length).toBeGreaterThan(2);
    expect(Math.max(...progress)).toBe(1);

    const id2 = jm.submit("projection", { ...base, seed: 99 }, (ctx) => project({ ...base, seed: 99, paths: 6000 }, ctx));
    jm.cancel(id2);
    expect((await jm.wait(id2)).status).toBe("cancelled");
  });
});

describe("jobs", () => {
  it("is idempotent: identical input reuses the job and its result", async () => {
    const jm = new JobManager();
    let runs = 0;
    const work = async () => { runs++; return 42; };
    const a = jm.submit("k", { x: 1 }, work), b = jm.submit("k", { x: 1 }, work), c = jm.submit("k", { x: 2 }, work);
    expect(a).toBe(b); expect(a).not.toBe(c);
    expect((await jm.wait<number>(a)).result).toBe(42);
    await jm.wait(c);
    expect(runs).toBe(2);
  });
  it("captures failures and allows a retry", async () => {
    const jm = new JobManager();
    const id = jm.submit("bad", {}, async () => { throw new Error("boom"); });
    const j = await jm.wait(id);
    expect(j.status).toBe("failed"); expect(j.error).toBe("boom");
    const again = jm.submit("bad", {}, async () => 1);
    expect((await jm.wait<number>(again)).result).toBe(1);
  });
});

describe("lab composition", () => {
  it("validates inputs and maps them to a backtest config", () => {
    expect(validateLab(DEFAULT_LAB)).toEqual([]);
    expect(validateLab({ ...DEFAULT_LAB, initial: 0, monthly: 0 }).join()).toMatch(/initial amount or a monthly/);
    expect(backtestConfig({ ...DEFAULT_LAB, existing: 300 }).initial).toBe(500);
    expect(validateLab({ ...DEFAULT_LAB, years: 40 }).join()).toMatch(/1 to 30/);
    expect(backtestConfig(DEFAULT_LAB).contribution).toEqual({ amount: 50, frequency: "monthly" });
  });
  it("runs the USD 200 / USD 50 / 5-year plan end to end without assuming extra capital (AC-06)", async () => {
    const cfg = backtestConfig(DEFAULT_LAB);
    const rs = ["buy_hold_spy", "trend_200d_spy", "permanent_portfolio"].map((id) => runBacktestOn(ds, CATALOG_BY_ID[id], cfg));
    const sl = rs.map(sleeveOf);
    const opt = optimize(sl, { maxWeight: 0.6 });
    const plan = planBacktest(sl, opt.proposals.balanced.weights, DEFAULT_LAB);
    for (let i = 0; i < plan.equity.length; i++) expect(plan.equity[i]).toBeLessThan(plan.invested[i] * 20);
    expect(plan.invested[0]).toBe(200);
    const proj = await project(projectionInput(sl, opt.proposals.balanced.weights, DEFAULT_LAB));
    expect(proj.totalContributed).toBe(200 + 50 * 59);
    expect(proj.fan!.p10[0]).toBe(200);
  });
});
