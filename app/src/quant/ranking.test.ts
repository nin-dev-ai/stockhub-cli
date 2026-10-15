import { describe, it, expect } from "vitest";
import { compareResults, twrIndex } from "./ranking";
import { CATALOG_BY_ID } from "./catalog";
import { runBacktestOn, SCORECARD_CONFIG } from "./service";
import { syntheticDataset } from "./testData";
import { fmtRate, fmtPts, fmtMoney, fmtRatio } from "@/lib/format";

const ds = syntheticDataset(15, 7);
const mk = (id: string) => ({ name: id, r: runBacktestOn(ds, CATALOG_BY_ID[id], SCORECARD_CONFIG, { robustness: true }) });

describe("ranking", () => {
  const items = ["buy_hold_spy", "trend_200d_spy", "permanent_portfolio", "momentum_rotation"].map(mk);
  it("sorts by the requested key", () => {
    const byDD = [...items].sort((a, b) => compareResults(a, b, "drawdown"));
    for (let i = 1; i < byDD.length; i++) expect(byDD[i - 1].r!.run.metrics.maxDrawdown!).toBeGreaterThanOrEqual(byDD[i].r!.run.metrics.maxDrawdown!);
    const bySharpe = [...items].sort((a, b) => compareResults(a, b, "sharpe"));
    for (let i = 1; i < bySharpe.length; i++) expect(bySharpe[i - 1].r!.run.metrics.sharpe!).toBeGreaterThanOrEqual(bySharpe[i].r!.run.metrics.sharpe!);
  });
  it("the default ordering ranks the robustness verdict ahead of return", () => {
    const rank = { consistent: 3, baseline: 2, mixed: 2, inconsistent: 1, insufficient: 0 } as Record<string, number>;
    const ev = [...items].sort((a, b) => compareResults(a, b, "evidence"));
    for (let i = 1; i < ev.length; i++) expect(rank[ev[i - 1].r!.robustness!.verdict]).toBeGreaterThanOrEqual(rank[ev[i].r!.robustness!.verdict]);
  });
  it("puts strategies without a result last", () => {
    const sorted = [{ name: "a" }, items[0]].sort((a, b) => compareResults(a, b, "evidence"));
    expect(sorted[1].name).toBe("a");
  });
});

describe("twrIndex and formatters", () => {
  it("compounds returns from a base", () => {
    expect(twrIndex([0.1, -0.1]).map((v) => +v.toFixed(2))).toEqual([100, 110, 99]);
  });
  it("shows n/a for missing values rather than zero", () => {
    expect(fmtRate(null)).toBe("n/a"); expect(fmtRate(0)).toBe("0.0%"); expect(fmtRate(0.123)).toBe("12.3%");
    expect(fmtPts(0.012)).toBe("+1.2 pts"); expect(fmtPts(undefined)).toBe("n/a");
    expect(fmtMoney(1234.5)).toBe("$1,235"); expect(fmtRatio(null)).toBe("n/a");
  });
});
