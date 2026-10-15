// Opt-in check against the running local API: LIVE=1 npm test -- live
import { describe, it, expect, vi, beforeAll } from "vitest";
import { CATALOG } from "./catalog";
import { loadDataset } from "./dataSource";
import { requiredTickers } from "./strategy";
import { runBacktestOn, scorecardOf, SCORECARD_CONFIG } from "./service";

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
});
