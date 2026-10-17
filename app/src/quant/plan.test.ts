import { describe, it, expect } from "vitest";
import { CATALOG, CATALOG_BY_ID } from "./catalog";
import { runBacktestOn, SCORECARD_CONFIG } from "./service";
import { sleeveOf } from "./lab";
import { syntheticDataset } from "./testData";
import { analyzeOverlap, bucketExposure } from "./overlap";
import { currentTargets } from "./backtest";
import { planTargets } from "./tracking";
import { withSpread } from "./strategy";
import { evaluateWeights } from "./portfolio";
import { alignSleeves, assetClasses, checkPlan, fitCandidate, isRedundant, oosVerdict, planHoldings, planRole, setWeight, suggestPlan, type Candidate, type PlanSleeve } from "./plan";

const ds = syntheticDataset(15, 11);
const run = (id: string) => runBacktestOn(ds, CATALOG_BY_ID[id], SCORECARD_CONFIG);
const sleeveInfo = (id: string, weight: number): PlanSleeve => ({ id, name: CATALOG_BY_ID[id].name, role: planRole(CATALOG_BY_ID[id]), weight, metrics: run(id).run.metrics });

describe("roles", () => {
  it("classify the catalog by what each strategy does", () => {
    const role = (id: string) => planRole(CATALOG_BY_ID[id]);
    expect(["buy_hold_spy", "dca_spy_12m", "rebalance_quarterly_6040", "three_fund", "cash_buffer_703020"].map(role)).toEqual(Array(5).fill("core"));
    expect(["trend_200d_spy", "golden_cross_spy", "momentum_rotation", "tsmom_12m_bond_regime", "vol_target_spy", "rsi2_pullback_spy", "seasonal_halloween"].map(role)).toEqual(Array(7).fill("tactical"));
    expect(["permanent_portfolio", "all_weather_style", "gtaa_trend_5", "risk_parity_4", "golden_butterfly"].map(role)).toEqual(Array(5).fill("diversifier"));
    expect(planRole(withSpread(CATALOG_BY_ID.golden_cross_spy, ["SPY", "QQQ"])!)).toBe("tactical");
  });
});

describe("what the plan holds today", () => {
  it("adds each strategy's current targets times its weight, and by asset class", () => {
    const held = planHoldings([{ weight: 0.6, targets: { SPY: 0.6, AGG: 0.4 } }, { weight: 0.4, targets: { SPY: 1 } }]);
    expect(held.map((h) => [h.ticker, +h.weight.toFixed(2)])).toEqual([["SPY", 0.76], ["AGG", 0.24]]);
    const ac = assetClasses(held);
    expect(ac[0]).toMatchObject({ bucket: "us_large", label: "US large companies" });
    expect(ac.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 9);
  });
  it("reads every ETF sleeve of a spread strategy, not only the last decision", () => {
    const d = withSpread(CATALOG_BY_ID.buy_hold_spy, ["SPY", "QQQ", "IWM"])!;
    const r = runBacktestOn(ds, d, SCORECARD_CONFIG);
    const t = currentTargets(r.run);
    expect(Object.keys(t).sort()).toEqual(["IWM", "QQQ", "SPY"]);
    expect(Object.values(t).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(planTargets([{ id: d.id, run: r.run }], { [d.id]: 0.5 }).QQQ).toBeCloseTo(0.5 / 3, 6);
  });
});

describe("does the plan make sense", () => {
  it("flags three strategies on the same ETF as redundant and says what to remove", () => {
    const ids = ["buy_hold_spy", "trend_200d_spy", "golden_cross_spy"];
    const runs = ids.map((id) => ({ id, name: id, run: run(id).run }));
    const overlap = analyzeOverlap(runs, { buy_hold_spy: 0.3, trend_200d_spy: 0.4, golden_cross_spy: 0.3 });
    const checks = checkPlan({ sleeves: ids.map((id, i) => sleeveInfo(id, [0.3, 0.4, 0.3][i])), overlap, plan: run("buy_hold_spy").run.metrics, fallLimit: null });
    const overlapChecks = checks.filter((c) => c.id.startsWith("overlap"));
    expect(overlapChecks.length).toBeGreaterThan(0);
    expect(overlapChecks.every((c) => c.level === "issue" && c.fix?.action.kind === "remove")).toBe(true);
    expect(checks[0].level).toBe("issue");
  });
  it("treats a core with a trend overlay on the same market as normal, but not near-copies", () => {
    expect(isRedundant(0.6, 0.59)).toBe(false);
    expect(isRedundant(0.78, 0.6)).toBe(true);
    expect(isRedundant(0.4, 0.93)).toBe(true);
    const ids = ["rebalance_quarterly_6040", "trend_200d_spy"];
    const runs = ids.map((id) => ({ id, name: id, run: run(id).run }));
    const checks = checkPlan({ sleeves: ids.map((id) => sleeveInfo(id, 0.5)), overlap: analyzeOverlap(runs, { [ids[0]]: 0.5, [ids[1]]: 0.5 }), plan: null, fallLimit: null });
    expect(checks.some((c) => c.id.startsWith("overlap"))).toBe(false);
  });
  it("checks the worst fall against the user's limit", () => {
    const m = { ...run("buy_hold_spy").run.metrics, maxDrawdown: -0.4 };
    const over = checkPlan({ sleeves: [sleeveInfo("buy_hold_spy", 1)], overlap: null, plan: m, fallLimit: 0.25 });
    expect(over.find((c) => c.id === "fall")).toMatchObject({ level: "issue", title: expect.stringMatching(/-40\.0%, is past your 25% limit/) });
    expect(checkPlan({ sleeves: [sleeveInfo("buy_hold_spy", 1)], overlap: null, plan: { ...m, maxDrawdown: -0.1 }, fallLimit: 0.25 }).find((c) => c.id === "fall")?.level).toBe("good");
  });
  it("asks for a core, a second job, and drops sleeves too small to matter", () => {
    const noCore = checkPlan({ sleeves: [sleeveInfo("trend_200d_spy", 0.5), sleeveInfo("permanent_portfolio", 0.5)], overlap: null, plan: null, fallLimit: null });
    expect(noCore.find((c) => c.id === "core")?.fix?.action).toEqual({ kind: "add", role: "core" });
    const good = checkPlan({ sleeves: [sleeveInfo("three_fund", 0.5), sleeveInfo("permanent_portfolio", 0.5)], overlap: null, plan: null, fallLimit: null });
    expect(good.find((c) => c.id === "roles")?.level).toBe("good");
    const tiny = checkPlan({ sleeves: [sleeveInfo("three_fund", 0.97), sleeveInfo("permanent_portfolio", 0.03)], overlap: null, plan: null, fallLimit: null });
    expect(tiny.find((c) => c.id.startsWith("tiny"))?.fix?.action).toEqual({ kind: "remove", id: "permanent_portfolio" });
    expect(checkPlan({ sleeves: [sleeveInfo("three_fund", 1)], overlap: null, plan: null, fallLimit: null })[0].id).toBe("one");
  });
});

describe("weights", () => {
  it("setting one weight rescales the others to keep 100%", () => {
    const w = setWeight({ a: 0.5, b: 0.3, c: 0.2 }, "a", 0.8);
    expect(w.a).toBeCloseTo(0.8, 9);
    expect(w.b / w.c).toBeCloseTo(1.5, 9);
    expect(Object.values(w).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect(setWeight({ a: 1, b: 0 }, "a", 0.4)).toEqual({ a: 0.4, b: 0.6 });
  });
  it("aligns sleeves with different starts onto their common dates", () => {
    const base = sleeveOf(run("buy_hold_spy"));
    const late = { ...base, id: "late", dates: base.dates.slice(100), returns: base.returns.slice(100) };
    const [a, b] = alignSleeves([base, late]);
    expect(a.dates).toEqual(b.dates);
    expect(a.dates[0]).toBe(late.dates[0]);
    expect(a.returns.length).toBe(a.dates.length - 1);
    expect(a.returns[10]).toBeCloseTo(base.returns[110], 12);
  });
});

describe("candidates and suggestions", () => {
  const cands: Candidate[] = CATALOG.map((d) => {
    const r = runBacktestOn(ds, d, SCORECARD_CONFIG, { robustness: true });
    return { id: d.id, name: d.name, role: planRole(d), sleeve: sleeveOf(r), verdict: r.robustness?.verdict, experimental: d.experimental, metrics: r.run.metrics, exposure: bucketExposure(r.run) };
  });
  it("ranks a candidate that fills a missing role and behaves differently above one that duplicates the plan", () => {
    const core = cands.find((c) => c.id === "buy_hold_spy")!;
    const plan = { sleeves: [core.sleeve], weights: { buy_hold_spy: 1 }, roles: ["core" as const] };
    const dup = fitCandidate(cands.find((c) => c.id === "dca_spy_12m")!, plan);
    const div = fitCandidate(cands.find((c) => c.id === "permanent_portfolio")!, plan);
    expect(dup.fillsRole).toBe(false);
    expect(div.fillsRole).toBe(true);
    expect(div.correlation!).toBeLessThan(dup.correlation!);
    expect(div.score).toBeGreaterThan(dup.score);
    expect(div.fallAfter!).toBeGreaterThan(div.fallBefore!);
  });
  it("proposes a core plus other roles with weights summing to 100% inside the fall limit", () => {
    const s = suggestPlan(cands, 0.35)!;
    expect(s.ids.length).toBeGreaterThanOrEqual(2);
    expect(Object.values(s.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(Object.values(s.weights).every((w) => w >= 0.1 - 1e-9 && w <= 0.7 + 1e-9)).toBe(true);
    const roles = s.ids.map((id) => cands.find((c) => c.id === id)!.role);
    expect(roles).toContain("core");
    expect(new Set(roles).size).toBeGreaterThanOrEqual(2);
    if (s.withinLimit) expect(s.metrics.maxDrawdown!).toBeGreaterThanOrEqual(-0.35 - 1e-9);
    expect(evaluateWeights(alignSleeves(s.ids.map((id) => cands.find((c) => c.id === id)!.sleeve)), s.weights, 0).metrics.cagr).toBeCloseTo(s.metrics.cagr!, 8);
  });
  it("never proposes two sleeves that its own checks call redundant", () => {
    for (const limit of [0.15, 0.25, 0.35, 0.5]) {
      const s = suggestPlan(cands, limit)!;
      const picked = s.ids.map((id) => cands.find((c) => c.id === id)!);
      const runs = picked.map((c) => ({ id: c.id, name: c.name, run: run(c.id).run }));
      const checks = checkPlan({ sleeves: picked.map((c) => ({ id: c.id, name: c.name, role: c.role, weight: s.weights[c.id], metrics: c.metrics })), overlap: analyzeOverlap(runs, s.weights), plan: s.metrics, fallLimit: null });
      expect(checks.filter((c) => c.id.startsWith("overlap")), `limit ${limit}`).toEqual([]);
    }
  });
  it("re-makes the proposal on early history and judges it on the later years it never saw", () => {
    const s = suggestPlan(cands, 0.35)!;
    const o = s.outOfSample!;
    expect(o).not.toBeNull();
    const dates = alignSleeves(s.ids.map((id) => cands.find((c) => c.id === id)!.sleeve))[0].dates;
    expect(o.split > dates[0] && o.split < dates[dates.length - 1]).toBe(true);
    expect(Object.values(o.fitWeights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(s.ids).toContain(o.bestSingle.id);
    expect(o.test.cagr).not.toBeNull();
    expect(o.summary).toMatch(/^Picked again using only the years before \d{4}-\d{2}-\d{2}, the weights /);
    if (o.clearlyWorse) expect(s.notes.join()).toMatch(/out-of-sample check is weak/);
  });
  it("calls an out-of-sample result clearly worse only for a real gap or a broken limit", () => {
    const m = (sharpe: number, dd: number) => ({ ...cands[0].metrics, sharpe, maxDrawdown: dd });
    expect(oosVerdict(m(0.8, -0.2), m(0.8, -0.2), 0.3).clearlyWorse).toBe(false);
    expect(oosVerdict(m(0.7, -0.2), m(0.8, -0.2), 0.3)).toMatchObject({ clearlyWorse: false, reason: expect.stringMatching(/a little worse/) });
    expect(oosVerdict(m(0.9, -0.2), m(0.8, -0.2), 0.3).reason).toMatch(/as well as or better/);
    expect(oosVerdict(m(0.5, -0.2), m(0.8, -0.2), 0.3)).toMatchObject({ clearlyWorse: true, reason: expect.stringMatching(/Sharpe 0\.50 against 0\.80/) });
    expect(oosVerdict(m(0.9, -0.4), m(0.8, -0.25), 0.3)).toMatchObject({ clearlyWorse: true, reason: expect.stringMatching(/broke your fall limit/) });
    expect(oosVerdict(m(0.9, -0.4), m(0.8, -0.45), 0.3).clearlyWorse).toBe(false);
  });
  it("says so when no mix fits the limit, and returns the shallowest", () => {
    const s = suggestPlan(cands, 0.001)!;
    expect(s.withinLimit).toBe(false);
    expect(s.notes.join()).toMatch(/shallowest/);
  });
  it("returns nothing without a core", () => {
    expect(suggestPlan(cands.filter((c) => c.role !== "core"), 0.3)).toBeNull();
  });
});
