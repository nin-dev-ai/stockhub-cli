// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_LAB } from "@/quant/lab";
import { makeSnapshot, verifySnapshot, type SnapshotBody } from "@/quant/tracking";
import { snapshotsOf, usePortfolios } from "./portfolioStore";

beforeEach(() => usePortfolios.setState({ portfolios: [], snapshots: [], selectedId: null }));

const body = (portfolioId: string, kind: SnapshotBody["kind"] = "original", seed = 1): SnapshotBody => ({
  schema: 1, kind, portfolioId, parentId: null, createdAt: "2024-01-02T00:00:00Z", asOf: "2024-01-02", engineVersion: "1.0.0",
  inputs: { ...DEFAULT_LAB, seed }, weights: { a: 1 }, weightsSource: "equal weight", strategies: [], datasetId: "d",
  dataWindow: { start: "2010-01-01", end: "2024-01-02" }, targets: { SPY: 1 },
  projection: {
    runId: "r", method: "bootstrap", paths: 200, seed, years: 1, months: 1, quality: "adequate", reasons: [], assumptions: [],
    startValue: 100, monthly: 0, fan: { p10: [100, 90], p50: [100, 101], p90: [100, 110], contributed: [100, 100] },
    ending: { p10: 90, p50: 101, p90: 110, mean: 101 }, probLoss: 0.3,
  },
});

describe("portfolio store", () => {
  it("creates a paper plan with its original snapshot and opening entries", () => {
    const r = usePortfolios.getState().createPortfolio({
      name: "Plan A", mode: "paper", snapshot: (id) => makeSnapshot(body(id)),
      opening: [{ date: "2024-01-02", kind: "contribution", amount: 100, fee: 0 }, { date: "2024-01-02", kind: "buy", ticker: "SPY", units: 1, price: 90, fee: 0 }],
    });
    expect("id" in r).toBe(true);
    const s = usePortfolios.getState();
    const p = s.portfolios[0];
    expect(p.transactions).toHaveLength(2);
    expect(snapshotsOf(p, s.snapshots)[0].kind).toBe("original");
    expect(s.selectedId).toBe(p.id);
  });

  it("refuses duplicate names and invalid opening entries without saving anything", () => {
    const st = usePortfolios.getState();
    st.createPortfolio({ name: "Mine", mode: "manual" });
    expect(usePortfolios.getState().createPortfolio({ name: "mine", mode: "manual" })).toEqual({ error: expect.stringMatching(/already exists/) });
    const bad = usePortfolios.getState().createPortfolio({ name: "X", mode: "paper", opening: [{ date: "2024-01-02", kind: "buy", ticker: "SPY", units: 1, price: 90, fee: 0 }] });
    expect("error" in bad && bad.error).toMatch(/leverage/);
    expect(usePortfolios.getState().portfolios).toHaveLength(1);
  });

  it("appends reforecasts without touching the original snapshot (POR-07)", () => {
    const r = usePortfolios.getState().createPortfolio({ name: "P", mode: "paper", snapshot: (id) => makeSnapshot(body(id)) }) as { id: string };
    const orig = usePortfolios.getState().snapshots[0];
    const before = JSON.stringify(orig);
    expect(usePortfolios.getState().addSnapshot(r.id, makeSnapshot({ ...body(r.id, "reforecast", 2), parentId: orig.id }))).toBeNull();
    expect(usePortfolios.getState().addSnapshot(r.id, makeSnapshot(body("other")))).toMatch(/another portfolio/);
    const s = usePortfolios.getState();
    expect(snapshotsOf(s.portfolios[0], s.snapshots).map((x) => x.kind)).toEqual(["original", "reforecast"]);
    expect(JSON.stringify(s.snapshots[0])).toBe(before);
    expect(verifySnapshot(s.snapshots[0])).toBe(true);
  });

  it("validates ledger edits, including deletions that would break later entries", () => {
    const { id } = usePortfolios.getState().createPortfolio({ name: "M", mode: "manual" }) as { id: string };
    expect(usePortfolios.getState().addTransactions(id, [{ date: "2024-01-02", kind: "sell", ticker: "SPY", units: 1, price: 1, fee: 0 }]).join()).toMatch(/short/);
    expect(usePortfolios.getState().addTransactions(id, [
      { date: "2024-01-02", kind: "contribution", amount: 100, fee: 0 },
      { date: "2024-01-03", kind: "buy", ticker: "spy", units: 1, price: 90, fee: 0 },
    ])).toEqual([]);
    const p = usePortfolios.getState().portfolios[0];
    expect(p.transactions[1].ticker).toBe("SPY");
    const contribution = p.transactions.find((t) => t.kind === "contribution")!;
    expect(usePortfolios.getState().deleteTransaction(id, contribution.id).join()).toMatch(/break a later one/);
    const buy = p.transactions.find((t) => t.kind === "buy")!;
    expect(usePortfolios.getState().deleteTransaction(id, buy.id)).toEqual([]);
  });

  it("deleting a portfolio removes its snapshots only", () => {
    const a = usePortfolios.getState().createPortfolio({ name: "A", mode: "paper", snapshot: (id) => makeSnapshot(body(id)) }) as { id: string };
    usePortfolios.getState().createPortfolio({ name: "B", mode: "paper", snapshot: (id) => makeSnapshot(body(id, "original", 3)) });
    usePortfolios.getState().deletePortfolio(a.id);
    const s = usePortfolios.getState();
    expect(s.portfolios.map((p) => p.name)).toEqual(["B"]);
    expect(s.snapshots).toHaveLength(1);
  });
});
