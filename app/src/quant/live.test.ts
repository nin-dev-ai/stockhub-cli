// Opt-in check against the running local API: LIVE=1 npm test -- live
import { describe, it, expect, vi, beforeAll } from "vitest";
import { CATALOG } from "./catalog";
import { loadDataset } from "./dataSource";
import { requiredTickers } from "./strategy";
import { runBacktestOn, scorecardOf, SCORECARD_CONFIG } from "./service";
import { optimize } from "./optimizer";
import { analyzeOverlap } from "./overlap";
import { project } from "./projection";
import { backtestConfig, DEFAULT_LAB, projectionInput, sleeveOf } from "./lab";
import { CATALOG_BY_ID } from "./catalog";
import { attribute, externalFlows, finalizeTx, rebalanceTrades, replayPlan, snapshotFrom, valuationSeries, verifySnapshot, type Transaction, type TxDraft } from "./tracking";

const LIVE = process.env.LIVE === "1";
const pct = (x: number | null) => (x == null ? "  n/a" : `${(x * 100).toFixed(1).padStart(5)}%`);

describe.skipIf(!LIVE)("live data", () => {
  beforeAll(() => {
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (u: string, init?: RequestInit) => real(u.startsWith("/") ? `http://localhost:5173${u}` : u, init));
  });

  it("runs the whole catalog on real adjusted prices", async () => {
    const all = [...new Set(CATALOG.flatMap(requiredTickers))];
    const ds = await loadDataset(all);
    console.log(`DATASET ${ds.version.id} ${ds.version.start}..${ds.version.end} rows=${ds.version.rows}`);
    for (const f of ds.version.qualityFlags) console.log(`  [${f.severity}] ${f.message}`);
    expect(ds.version.rows).toBeGreaterThan(4000);
    const lines: string[] = [];
    for (const s of CATALOG) {
      const r = runBacktestOn(ds, s, SCORECARD_CONFIG, { robustness: true });
      const c = scorecardOf(r);
      lines.push(`${s.id.padEnd(26)} CAGR ${pct(c.cagr)} bench ${pct(c.benchmarkCagr)} MDD ${pct(c.maxDrawdown)} Sharpe ${c.sharpe?.toFixed(2) ?? "n/a"} trades ${String(c.tradeCount).padStart(4)} turn ${c.turnover?.toFixed(2) ?? "n/a"} ${c.verdict}`);
      expect(r.run.metrics.cagr).not.toBeNull();
    }
    console.log(lines.join("\n"));
  }, 120000);

  it("optimizes and projects the USD 200 / USD 50 / 5-year plan on real data", async () => {
    const ids = ["buy_hold_spy", "trend_200d_spy", "permanent_portfolio"];
    const defs = ids.map((i) => CATALOG_BY_ID[i]);
    const ds = await loadDataset([...new Set(defs.flatMap(requiredTickers))]);
    const rs = defs.map((d) => runBacktestOn(ds, d, backtestConfig(DEFAULT_LAB)));
    const sl = rs.map(sleeveOf);
    const ov = analyzeOverlap(rs.map((r) => ({ id: r.strategy.id, name: r.strategy.name, run: r.run })));
    console.log("OVERLAP", ov.pairs.map((p) => `${p.a}/${p.b} shared ${(p.sharedExposure * 100).toFixed(0)}% corr ${p.returnCorrelation?.toFixed(2)} ${p.level}`).join(" | "));
    const opt = optimize(sl, { maxWeight: 0.6 });
    for (const [k, p] of Object.entries(opt.proposals)) {
      console.log(`OPT ${k.padEnd(17)} ${Object.entries(p.weights).map(([i, w]) => `${i.slice(0, 8)} ${(w * 100).toFixed(0)}%`).join(" ")} vol ${(p.metrics.volatility! * 100).toFixed(1)}% cagr ${(p.metrics.cagr! * 100).toFixed(1)}% sharpe ${p.metrics.sharpe!.toFixed(2)} maxDD ${(p.metrics.maxDrawdown! * 100).toFixed(1)}% binding ${p.binding.map((b) => b.kind + ":" + b.id.slice(0, 6)).join(",")}`);
    }
    console.log("OOS", opt.outOfSample && `split ${opt.outOfSample.splitDate} fit ${Object.values(opt.outOfSample.fitWeights).map((w) => (w * 100).toFixed(0)).join("/")} testSharpe ${opt.outOfSample.test.sharpe?.toFixed(2)} vs equal ${opt.outOfSample.equalWeightTest.sharpe?.toFixed(2)}`);
    const t0 = Date.now();
    const pr = await project(projectionInput(sl, opt.proposals.balanced.weights, DEFAULT_LAB));
    console.log(`PROJ ${Date.now() - t0}ms quality ${pr.quality} contributed $${pr.totalContributed} end p10 $${pr.ending!.p10.toFixed(0)} p50 $${pr.ending!.p50.toFixed(0)} p90 $${pr.ending!.p90.toFixed(0)} real p50 $${pr.endingReal!.p50.toFixed(0)} P(loss) ${(pr.probLoss! * 100).toFixed(1)}%`);
    console.log("SCEN", pr.scenarios.map((s) => `${s.key} p50 $${s.ending.p50.toFixed(0)}`).join(" | "));
    expect(pr.totalContributed).toBe(200 + 50 * 59);
  }, 120000);

  it("saves a plan a year back, follows it on paper, and compares with real prices", async () => {
    const ids = ["buy_hold_spy", "permanent_portfolio"];
    const defs = ids.map((i) => CATALOG_BY_ID[i]);
    const ds = await loadDataset([...new Set(defs.flatMap(requiredTickers))]);
    const created = ds.panel.dates[ds.panel.dates.length - 253];
    const at = defs.map((d) => runBacktestOn(ds, d, { ...backtestConfig(DEFAULT_LAB), end: created }));
    const w = { [ids[0]]: 0.5, [ids[1]]: 0.5 };
    const snap = snapshotFrom({ kind: "original", portfolioId: "live", parentId: null, createdAt: "t", inputs: DEFAULT_LAB, weights: w, weightsSource: "equal weight", backtests: at,
      projection: await project(projectionInput(at.map(sleeveOf), w, DEFAULT_LAB)) });
    let n = 0;
    const mk = (d: TxDraft): Transaction => finalizeTx(d, `l${++n}`, String(n).padStart(4, "0"));
    const txs: Transaction[] = [mk({ date: snap.asOf, kind: "contribution", amount: 200, fee: 0 })];
    for (const d of rebalanceTrades(txs, ds.panel, snap.targets, snap.asOf)) txs.push(mk(d));
    const val = valuationSeries(txs, ds.panel, "paper");
    const now = defs.map((d) => runBacktestOn(ds, d, backtestConfig(DEFAULT_LAB)));
    const replay = replayPlan(now.map(sleeveOf), w, externalFlows(txs), snap.asOf);
    const last = val.dates.length - 1;
    const a = attribute(snap, { date: val.dates[last], value: val.value[last], contributed: val.contributed[last] }, replay.value[replay.value.length - 1])!;
    console.log(`TRACK from ${snap.asOf} value $${a.observed.toFixed(2)} plan p10/p50/p90 $${a.plan.p10.toFixed(0)}/$${a.plan.p50.toFixed(0)}/$${a.plan.p90.toFixed(0)} band ${a.band} contrib ${a.contributionDifference.toFixed(2)} projErr ${a.projectionError!.toFixed(2)} alloc ${a.allocationDifference!.toFixed(2)}`);
    expect(a.contributionDifference + a.projectionError! + a.allocationDifference!).toBeCloseTo(a.total, 6);
    expect(verifySnapshot(snap)).toBe(true);
  }, 120000);
});

