import { describe, it, expect } from "vitest";
import { addMonths, futureDates, projectionCsv, buildReport } from "./report";
import { project } from "./projection";
import { DEFAULT_LAB } from "./lab";

describe("report helpers", () => {
  it("adds months with end-of-month clamping", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-11-15", 3)).toBe("2025-02-15");
    expect(futureDates("2026-10-14", 12)).toHaveLength(13);
    expect(futureDates("2026-10-14", 12)[12]).toBe("2027-10-14");
  });
  it("exports the projection fan as CSV with a header and one row per month", async () => {
    const p = await project({ monthlyReturns: new Array(120).fill(0.005), historyStart: "2010-01-01", historyEnd: "2019-12-31", initial: 200, contribution: { amount: 50, frequency: "monthly" }, years: 1, method: "bootstrap", paths: 300, blockMonths: 6, seed: 1, inflation: 0.02 });
    const lines = projectionCsv(p).split("\n");
    expect(lines[0]).toBe("month,contributed,p10,p50,p90");
    expect(lines).toHaveLength(14);
    expect(lines[1].split(",")[0]).toBe("0");
  });
  it("returns an empty CSV when no projection was produced", async () => {
    const p = await project({ monthlyReturns: [0.01], historyStart: "a", historyEnd: "b", initial: 1, contribution: { amount: 0, frequency: "none" }, years: 1, method: "bootstrap", paths: 300, blockMonths: 6, seed: 1, inflation: 0 });
    expect(projectionCsv(p)).toBe("");
  });
  it("builds a report that states the informational label, seed and exclusions", async () => {
    const p = await project({ monthlyReturns: new Array(120).fill(0.005), historyStart: "2010-01-01", historyEnd: "2019-12-31", initial: 200, contribution: { amount: 50, frequency: "monthly" }, years: 5, method: "bootstrap", paths: 300, blockMonths: 6, seed: 9, inflation: 0.02 });
    const r = buildReport({ inputs: DEFAULT_LAB, weights: null, weightsSource: null, backtests: [], optimization: null, projection: p });
    expect(r.label).toMatch(/not investment advice/);
    expect(r.projection!.seed).toBe(9);
    expect(r.costs.taxes).toBe("excluded");
    expect(r.warnings.join(" ")).toMatch(/not a worst case/);
  });
});
