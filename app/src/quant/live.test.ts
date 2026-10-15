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
});
