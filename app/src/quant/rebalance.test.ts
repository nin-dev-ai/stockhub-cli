import { describe, it, expect } from "vitest";
import { blendReturns, evaluateWeights, type Sleeve } from "./portfolio";
import { bdays } from "./testData";

// two sleeves: A rises 1% a day, B falls 0.5% a day, over two calendar quarters
const dates = bdays("2026-01-02", 130);
const sleeve = (id: string, r: number): Sleeve => ({ id, name: id, dates, returns: dates.slice(1).map(() => r) });
const A = sleeve("A", 0.01), B = sleeve("B", -0.005);
const growth = (rs: number[]) => rs.reduce((g, r) => g * (1 + r), 1);

describe("rebalancing between a plan's strategies", () => {
  it("is the same for every rule with a single strategy", () => {
    for (const rule of ["daily", "monthly", "quarterly", "annual", "none", "drift5"] as const) {
      expect(growth(blendReturns([A], { A: 1 }, { rule, costBps: 10 }))).toBeCloseTo(growth(A.returns), 10);
    }
  });
  it("'never' equals buy-and-hold of the starting split", () => {
    const g = growth(blendReturns([A, B], { A: 0.5, B: 0.5 }, { rule: "none" }));
    expect(g).toBeCloseTo(0.5 * growth(A.returns) + 0.5 * growth(B.returns), 10);
  });
  it("'daily' is the old idealised blend: the same weighted return every day", () => {
    const r = blendReturns([A, B], { A: 0.5, B: 0.5 }, { rule: "daily" });
    for (const x of r) expect(x).toBeCloseTo(0.0025, 12);
    expect(blendReturns([A, B], { A: 0.5, B: 0.5 })).toEqual(r);
  });
  it("quarterly lets weights drift inside the quarter and resets them at its first day", () => {
    const q = blendReturns([A, B], { A: 0.5, B: 0.5 }, { rule: "quarterly" });
    const none = blendReturns([A, B], { A: 0.5, B: 0.5 }, { rule: "none" });
    const firstQ2 = dates.findIndex((d) => d >= "2026-04-01") - 1;
    // identical until the quarter turns, then different
    for (let i = 0; i < firstQ2; i++) expect(q[i]).toBeCloseTo(none[i], 12);
    expect(Math.abs(q[firstQ2 + 1] - none[firstQ2 + 1])).toBeGreaterThan(1e-6);
    // drifting toward the winner beats restoring daily here, so the assumption matters
    expect(growth(q)).not.toBeCloseTo(growth(blendReturns([A, B], { A: 0.5, B: 0.5 })), 3);
  });
  it("rebalances on drift only once a strategy is 5 points off, and charges the cost", () => {
    const d = blendReturns([A, B], { A: 0.5, B: 0.5 }, { rule: "drift5" });
    const free = growth(d), costly = growth(blendReturns([A, B], { A: 0.5, B: 0.5 }, { rule: "drift5", costBps: 50 }));
    expect(costly).toBeLessThan(free);
    // with 1.5% a day of relative drift, a 5-point gap takes several days, so not every day rebalances
    const none = blendReturns([A, B], { A: 0.5, B: 0.5 }, { rule: "none" });
    expect(d[0]).toBeCloseTo(none[0], 12);
  });
  it("feeds the metrics through evaluateWeights", () => {
    const m1 = evaluateWeights([A, B], { A: 0.5, B: 0.5 }, 0, 0, undefined, { rule: "none" }).metrics;
    const m2 = evaluateWeights([A, B], { A: 0.5, B: 0.5 }, 0).metrics;
    expect(m1.totalReturn).not.toBeCloseTo(m2.totalReturn!, 4);
  });
});
