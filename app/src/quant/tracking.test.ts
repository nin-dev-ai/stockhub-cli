import { describe, it, expect } from "vitest";
import { CATALOG_BY_ID } from "./catalog";
import { backtestConfig, DEFAULT_LAB, projectionInput, sleeveOf } from "./lab";
import { equalWeights } from "./portfolio";
import { project } from "./projection";
import { runBacktestOn } from "./service";
import { syntheticDataset } from "./testData";
import {
  attribute, closeOn, externalFlows, finalizeTx, holdingsTable, ledgerAt, makeSnapshot, planAt, planTargets,
  rebalanceTrades, replayPlan, snapshotFrom, timeline, validateTx, valuationSeries, verifySnapshot,
  type PlanSnapshot, type Transaction, type TxDraft,
} from "./tracking";
import type { Panel } from "./types";

let seq = 0;
const tx = (d: TxDraft): Transaction => finalizeTx(d, `t${++seq}`, `2020-01-01T00:00:${String(seq).padStart(2, "0")}`);
const panel: Panel = {
  dates: ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"],
  closes: { AAA: [100, 110, 99, 120], BBB: [50, 50, 55, 60] },
};

describe("ledger", () => {
  it("tracks cash, units, contributions, fees and dividends", () => {
    const txs = [
      tx({ date: "2024-01-02", kind: "contribution", amount: 1000, fee: 0 }),
      tx({ date: "2024-01-02", kind: "buy", ticker: "AAA", units: 5, price: 100, fee: 1 }),
      tx({ date: "2024-01-03", kind: "sell", ticker: "AAA", units: 2, price: 110, fee: 1 }),
      tx({ date: "2024-01-04", kind: "dividend", amount: 3, fee: 0 }),
      tx({ date: "2024-01-04", kind: "withdrawal", amount: 100, fee: 0 }),
      tx({ date: "2024-01-04", kind: "transfer_in", ticker: "BBB", units: 4, price: 55, fee: 0 }),
    ];
    const s = ledgerAt(txs);
    expect(s.cash).toBeCloseTo(1000 - 500 - 1 + 220 - 1 + 3 - 100, 9);
    expect(s.units).toEqual({ AAA: 3, BBB: 4 });
    expect(s.netContributed).toBeCloseTo(1000 - 100 + 220, 9);
    expect(s.fees).toBe(2);
    expect(s.dividends).toBe(3);
    expect(ledgerAt(txs, "2024-01-02").units).toEqual({ AAA: 5 });
  });

  it("rejects leverage, short sales, future dates and incomplete trades", () => {
    const base = [tx({ date: "2024-01-02", kind: "contribution", amount: 100, fee: 0 })];
    const today = "2024-01-05";
    expect(validateTx(base, { date: "2024-01-03", kind: "buy", ticker: "AAA", units: 2, price: 60, fee: 0 }, today).join()).toMatch(/leverage/);
    expect(validateTx(base, { date: "2024-01-03", kind: "sell", ticker: "AAA", units: 1, price: 60, fee: 0 }, today).join()).toMatch(/short/);
    expect(validateTx(base, { date: "2024-02-01", kind: "contribution", amount: 5, fee: 0 }, today).join()).toMatch(/future/);
    expect(validateTx(base, { date: "2024-01-03", kind: "buy", ticker: "", units: 0, price: 1, fee: 0 }, today).length).toBe(2);
    expect(validateTx(base, { date: "2024-01-03", kind: "buy", ticker: "AAA", units: 1, price: 60, fee: 0 }, today)).toEqual([]);
  });

  it("checks states after a back-dated entry, not just the entry itself", () => {
    const txs = [
      tx({ date: "2024-01-02", kind: "contribution", amount: 100, fee: 0 }),
      tx({ date: "2024-01-04", kind: "buy", ticker: "AAA", units: 1, price: 99, fee: 0 }),
    ];
    expect(validateTx(txs, { date: "2024-01-03", kind: "withdrawal", amount: 50, fee: 0 }, "2024-01-05").join()).toMatch(/2024-01-04/);
  });
});

describe("valuation", () => {
  it("values cash plus units at each close, from the first transaction", () => {
    const txs = [
      tx({ date: "2024-01-03", kind: "contribution", amount: 1000, fee: 0 }),
      tx({ date: "2024-01-03", kind: "buy", ticker: "AAA", units: 5, price: 110, fee: 0 }),
    ];
    const v = valuationSeries(txs, panel, "manual");
    expect(v.dates).toEqual(["2024-01-03", "2024-01-04", "2024-01-05"]);
    expect(v.value).toEqual([1000, 450 + 5 * 99, 450 + 5 * 120]);
    expect(v.contributed).toEqual([1000, 1000, 1000]);
  });

  it("a weekend entry starts valuation at the next close", () => {
    const v = valuationSeries([tx({ date: "2024-01-03", kind: "contribution", amount: 10, fee: 0 })], { ...panel, dates: ["2024-01-02", "2024-01-04"], closes: {} }, "manual");
    expect(v.dates).toEqual(["2024-01-04"]);
  });

  it("paper lots follow the adjusted series after a later dividend rescales history", () => {
    // Recorded at the then-adjusted close of 100; a later dividend rescaled that close to 98.
    const rescaled: Panel = { dates: panel.dates, closes: { AAA: [98, 108, 97, 118] } };
    const txs = [
      tx({ date: "2024-01-02", kind: "contribution", amount: 100, fee: 0 }),
      tx({ date: "2024-01-02", kind: "buy", ticker: "AAA", units: 1, price: 100, fee: 0 }),
    ];
    const paper = valuationSeries(txs, rescaled, "paper");
    const manual = valuationSeries(txs, rescaled, "manual");
    expect(paper.value[3]).toBeCloseTo(100 * (118 / 98), 9);   // total return is preserved
    expect(manual.value[3]).toBe(118);                          // a manual record only knows its units
  });

  it("builds a holdings table with weights and plan targets", () => {
    const txs = [
      tx({ date: "2024-01-02", kind: "contribution", amount: 1000, fee: 0 }),
      tx({ date: "2024-01-02", kind: "buy", ticker: "AAA", units: 5, price: 100, fee: 0 }),
    ];
    const h = holdingsTable(txs, panel, "paper", { AAA: 0.6, BBB: 0.4 });
    expect(h.total).toBe(500 + 600);
    expect(h.rows.find((r) => r.ticker === "AAA")!.weight).toBeCloseTo(600 / 1100, 9);
    expect(h.rows.find((r) => r.ticker === "BBB")!.units).toBe(0);
  });
});

describe("plan targets and paper rebalancing", () => {
  const runs = [
    { id: "s1", run: { decisions: [{ date: "x", reason: "", kind: "rebalance" as const, targets: { AAA: 1 } }] } },
    { id: "s2", run: { decisions: [{ date: "x", reason: "", kind: "rebalance" as const, targets: { AAA: 0.5, BBB: 0.5 } }] } },
  ];
  it("combines each strategy's latest targets by sleeve weight", () => {
    expect(planTargets(runs, { s1: 0.4, s2: 0.6 })).toEqual({ AAA: 0.7, BBB: 0.3 });
  });

  it("moves holdings to the targets without overdrawing cash, fees included", () => {
    const targets = { AAA: 0.7, BBB: 0.3 };
    let txs = [tx({ date: "2024-01-02", kind: "contribution", amount: 1000, fee: 0 })];
    const first = rebalanceTrades(txs, panel, targets, "2024-01-02", 1);
    for (const d of first) { expect(validateTx(txs, d, "2024-01-05")).toEqual([]); txs = [...txs, tx(d)]; }
    const h = holdingsTable(txs, slicePanel(panel, 1), "paper", targets);
    expect(ledgerAt(txs).cash).toBeGreaterThanOrEqual(0);
    expect(h.rows.find((r) => r.ticker === "AAA")!.weight).toBeCloseTo(0.7, 2);

    // later drift: sells come first and the result is valid
    const later = rebalanceTrades(txs, panel, { AAA: 0.2, BBB: 0.8 }, "2024-01-05", 1);
    expect(later[0].kind).toBe("sell");
    for (const d of later) { expect(validateTx(txs, d, "2024-01-05")).toEqual([]); txs = [...txs, tx(d)]; }
    expect(ledgerAt(txs).cash).toBeGreaterThanOrEqual(-1e-6);
  });

  it("trades whole shares only when asked, like Paper Orders", () => {
    const targets = { AAA: 0.7, BBB: 0.3 };
    let txs = [tx({ date: "2024-01-02", kind: "contribution", amount: 1000, fee: 0 })];
    const first = rebalanceTrades(txs, panel, targets, "2024-01-02", 0, 1, true);
    // $700 / $100 = 7 AAA, $300 / $50 = 6 BBB
    expect(first.map((d) => [d.ticker, d.units])).toEqual([["AAA", 7], ["BBB", 6]]);
    for (const d of first) txs = [...txs, tx(d)];
    const later = rebalanceTrades(txs, panel, { AAA: 0.2, BBB: 0.8 }, "2024-01-05", 0, 1, true);
    for (const d of later) { expect(Number.isInteger(d.units)).toBe(true); expect(validateTx(txs, d, "2024-01-05")).toEqual([]); txs = [...txs, tx(d)]; }
    expect(ledgerAt(txs).cash).toBeGreaterThanOrEqual(-1e-6);
  });
});

const slicePanel = (p: Panel, n: number): Panel => ({ dates: p.dates.slice(0, n), closes: Object.fromEntries(Object.entries(p.closes).map(([k, v]) => [k, v.slice(0, n)])) });

describe("snapshots", () => {
  const body = {
    schema: 1 as const, kind: "original" as const, portfolioId: "p", parentId: null, createdAt: "2024-01-02T00:00:00Z", asOf: "2024-01-02",
    engineVersion: "1.0.0", inputs: DEFAULT_LAB, weights: { a: 1 }, weightsSource: "equal weight", strategies: [], datasetId: "d",
    dataWindow: { start: "2010-01-01", end: "2024-01-02" }, targets: { SPY: 1 },
    projection: {
      runId: "r", method: "bootstrap", paths: 200, seed: 1, years: 1, months: 12, quality: "adequate" as const, reasons: [], assumptions: [],
      startValue: 100, monthly: 10,
      fan: { p10: Array.from({ length: 13 }, (_, m) => 90 + m * 5), p50: Array.from({ length: 13 }, (_, m) => 100 + m * 11), p90: Array.from({ length: 13 }, (_, m) => 110 + m * 20), contributed: Array.from({ length: 13 }, (_, m) => 100 + Math.max(0, m - 1) * 10) },
      ending: { p10: 150, p50: 232, p90: 350, mean: 240 }, probLoss: 0.1,
    },
  };

  it("is content-addressed, frozen and detects tampering (AC-10)", () => {
    const s = makeSnapshot(body);
    expect(verifySnapshot(s)).toBe(true);
    expect(Object.isFrozen(s.projection.fan.p50)).toBe(true);
    expect(() => { (s.projection.fan.p50 as number[])[3] = 0; }).toThrow();
    const stored = JSON.parse(JSON.stringify(s)) as PlanSnapshot;
    expect(verifySnapshot(stored)).toBe(true);
    (stored.projection.fan.p50 as number[])[3] = 1;
    expect(verifySnapshot(stored)).toBe(false);
  });

  it("does not share memory with its source, so later results cannot alter it", () => {
    const src = JSON.parse(JSON.stringify(body));
    const s = makeSnapshot(src);
    src.projection.fan.p50[5] = -1;
    src.inputs.monthly = 9999;
    expect(s.projection.fan.p50[5]).toBe(155);
    expect(s.inputs.monthly).toBe(DEFAULT_LAB.monthly);
  });

  it("interpolates the plan between month marks and returns null past the horizon", () => {
    const s = makeSnapshot(body);
    const half = planAt(s, "2024-01-17")!;
    expect(half.p50).toBeGreaterThan(100);
    expect(half.p50).toBeLessThan(111);
    expect(planAt(s, "2026-01-01")).toBeNull();
  });

  it("attribution parts sum to observed minus planned median", () => {
    const s = makeSnapshot(body);
    const a = attribute(s, { date: "2024-07-02", value: 140, contributed: 140 }, 150)!;
    expect(a.contributionDifference + a.projectionError! + a.allocationDifference!).toBeCloseTo(a.total, 9);
    expect(a.band).toBe("within");
    expect(attribute(s, { date: "2024-07-02", value: 10, contributed: 140 }, null)!.band).toBe("below");
    expect(attribute(s, { date: "2024-07-02", value: 10, contributed: 140 }, null)!.projectionError).toBeNull();
  });
});

describe("plan replay", () => {
  it("compounds sleeve returns and credits flows at the close", () => {
    const sleeves = [{ id: "a", name: "A", dates: ["d0", "d1", "d2"].map((_, i) => `2024-01-0${i + 2}`), returns: [0.1, -0.5] }];
    const r = replayPlan(sleeves, { a: 1 }, [{ date: "2024-01-02", amount: 100 }, { date: "2024-01-03", amount: 50 }], "2024-01-02");
    expect(r.value).toEqual([100, 160, 80]);
  });

  it("external flows include transfers and withdrawals but not trades or dividends", () => {
    const f = externalFlows([
      tx({ date: "2024-01-02", kind: "contribution", amount: 100, fee: 0 }),
      tx({ date: "2024-01-03", kind: "transfer_in", ticker: "AAA", units: 1, price: 50, fee: 0 }),
      tx({ date: "2024-01-03", kind: "dividend", amount: 1, fee: 0 }),
      tx({ date: "2024-01-04", kind: "withdrawal", amount: 20, fee: 0 }),
    ]);
    expect(f.map((x) => x.amount)).toEqual([100, 50, -20]);
  });
});

describe("end to end: save a plan, follow it on paper, compare later (Milestone C exit criterion)", () => {
  const setup = (async () => {
  const ds = syntheticDataset(16, 5);
  const ids = ["buy_hold_spy", "permanent_portfolio"];
  const created = "2016-12-30";
  const inputs = { ...DEFAULT_LAB, initial: 1000, monthly: 100, years: 5, paths: 400 };
  const cfg = { ...backtestConfig(inputs), end: created };
  const runAt = (end?: string) => ids.map((id) => runBacktestOn(ds, CATALOG_BY_ID[id], { ...cfg, end }));
  const atCreation = runAt(created);
  const weights = equalWeights(ids);
  const proj = await project(projectionInput(atCreation.map(sleeveOf), weights, inputs));
  const snap = snapshotFrom({ kind: "original", portfolioId: "p1", parentId: null, createdAt: "t", inputs, weights, weightsSource: "equal weight", backtests: atCreation, projection: proj });

  // follow it on paper: fund, rebalance to plan targets at the creation close, contribute monthly
  const panel = ds.panel;
  let txs: Transaction[] = [tx({ date: snap.asOf, kind: "contribution", amount: 1000, fee: 0 })];
  for (const d of rebalanceTrades(txs, panel, snap.targets, snap.asOf)) txs.push(tx(d));
  const later = runAt(undefined);
  const monthStarts = panel.dates.filter((d, i) => i > 0 && d > snap.asOf && d.slice(0, 7) !== panel.dates[i - 1].slice(0, 7)).slice(0, 24);
  for (const d of monthStarts) {
    txs.push(tx({ date: d, kind: "contribution", amount: 100, fee: 0 }));
    const targets = planTargets(later.map((r) => ({ id: r.strategy.id, run: { decisions: r.run.decisions.filter((x) => x.date <= d) } })), weights);
    for (const t of rebalanceTrades(txs, panel, targets, d)) txs.push(tx(t));
  }
  return { panel, snap, txs, later, weights, inputs, monthStarts };
  })();

  it("keeps the original snapshot intact after later data and reforecasts", async () => {
    const { snap, later, weights, inputs } = await setup;
    const before = JSON.stringify(snap);
    const re = await project(projectionInput(later.map(sleeveOf), weights, { ...inputs, initial: 5000, seed: 7 }));
    snapshotFrom({ kind: "reforecast", portfolioId: "p1", parentId: snap.id, createdAt: "t2", inputs, weights, weightsSource: null, backtests: later, projection: re });
    expect(JSON.stringify(snap)).toBe(before);
    expect(verifySnapshot(snap)).toBe(true);
  });

  it("reconciles contributions and compares observations with the original plan", async () => {
    const { panel, snap, txs, later, weights, monthStarts } = await setup;
    const val = valuationSeries(txs, panel, "paper");
    const lastDate = monthStarts[monthStarts.length - 1];
    const i = val.dates.indexOf(lastDate);
    expect(val.contributed[i]).toBeCloseTo(1000 + 100 * monthStarts.length, 6);
    const replay = replayPlan(later.map(sleeveOf), weights, externalFlows(txs), snap.asOf);
    const rv = replay.value[replay.dates.indexOf(lastDate)];
    const a = attribute(snap, { date: lastDate, value: val.value[i], contributed: val.contributed[i] }, rv)!;
    expect(a.contributionDifference + a.projectionError! + a.allocationDifference!).toBeCloseTo(a.total, 6);
    // following the plan closely on paper keeps the implementation gap small relative to the balance
    expect(Math.abs(a.allocationDifference!) / val.value[i]).toBeLessThan(0.05);
    expect(closeOn(panel, "SPY", lastDate)).not.toBeNull();

    const tl = timeline(snap, null, val);
    expect(tl.dates[0]).toBe(snap.asOf);
    expect(tl.dates.length).toBe(snap.projection.months + 1);
    expect(tl.observed[0]).not.toBeNull();
    expect(tl.original.p50[0]).toBeCloseTo(snap.projection.fan.p50[0], 6);
  });
});
