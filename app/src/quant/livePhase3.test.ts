// Opt-in Phase 3 checks against the running dev server (for /clerk and /api): LIVE=1 npm test -- livePhase3
import { describe, it, expect, vi, beforeAll } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { fetchHouseIndex } from "@/lib/house";
import { houseMembers, isElectronic, memberPtrs, parsePtr, ptrTrades, searchMembers } from "./congress";
import { pdfTextItems } from "./pdfText";
import { copyEvents, runCopyTrade } from "./copyTrade";
import { loadDataset } from "./dataSource";
import { CATALOG_BY_ID } from "./catalog";
import { requiredTickers, withSpread } from "./strategy";
import { runBacktestOn } from "./service";
import type { PersonaTrade } from "./personas";

const LIVE = process.env.LIVE === "1";
const BASE = "http://localhost:5173";

describe.skipIf(!LIVE)("live Phase 3 data", () => {
  beforeAll(() => {
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (u: string, init?: RequestInit) => real(u.startsWith("/") ? `${BASE}${u}` : u, init));
  });

  let pelosi: PersonaTrade[] = [];

  it("reads the House Clerk index and Nancy Pelosi's reports", async () => {
    const y = new Date().getFullYear();
    const filings = [...(await fetchHouseIndex(y)), ...(await fetchHouseIndex(y - 1))];
    expect(filings.length).toBeGreaterThan(300);
    const m = searchMembers(houseMembers(filings), "nancy pelosi")[0];
    expect(m?.stateDst).toBe("CA11");
    const ptrs = memberPtrs(filings, m.key).filter((f) => isElectronic(f.docId));
    expect(ptrs.length).toBeGreaterThan(0);
    for (const f of ptrs) {
      const res = await fetch(`/clerk/public_disc/ptr-pdfs/${f.year}/${f.docId}.pdf`);
      const rows = parsePtr(await pdfTextItems(new Uint8Array(await res.arrayBuffer()), pdfjs as never));
      expect(rows.length, f.docId).toBeGreaterThan(0);
      expect(rows.every((r) => r.date && r.band !== undefined), f.docId).toBe(true);
      pelosi.push(...ptrTrades(rows, f));
    }
    console.log(`PELOSI ${ptrs.length} reports, ${pelosi.length} transactions, ${pelosi.filter((t) => t.side === "buy").length} buys`);
  }, 120000);

  it("backtests copying those trades without look-ahead", async () => {
    const tickers = [...new Set(copyEvents(pelosi).events.map((e) => e.ticker))];
    const first = copyEvents(pelosi).events.map((e) => e.traded).sort()[0];
    const ds = await loadDataset([...tickers, "SPY", "SHY"], new Date(Date.parse(first) - 31 * 864e5).toISOString().slice(0, 10));
    const r = runCopyTrade("pelosi", "Nancy Pelosi", pelosi, ds, { initial: 10_000 })!;
    expect(r).not.toBeNull();
    const firstFiled = new Map<string, string>();
    for (const e of copyEvents(pelosi).events) if (e.side === "buy" && (!firstFiled.has(e.ticker) || e.filed < firstFiled.get(e.ticker)!)) firstFiled.set(e.ticker, e.filed);
    for (const t of r.filed.run.trades.filter((x) => x.side === "buy" && firstFiled.has(x.ticker))) expect(t.decisionDate >= firstFiled.get(t.ticker)!, t.ticker).toBe(true);
    console.log(`COPY filed ${r.filed.run.finalValue.toFixed(0)} traded ${r.traded.run.finalValue.toFixed(0)} SPY ${r.filed.benchmark.run.finalValue.toFixed(0)} lag ${r.lagCost.toFixed(0)} median ${r.medianLagDays}d unpriced ${r.unpriced.join(",")}`);
  }, 120000);

  it("spreads the golden cross across SPY, QQQ and DIA on real prices", async () => {
    const d = withSpread(CATALOG_BY_ID.golden_cross_spy, ["SPY", "QQQ", "DIA"])!;
    const ds = await loadDataset(requiredTickers(d));
    const r = runBacktestOn(ds, d, { initial: 10_000 });
    expect(r.spread?.sleeves).toHaveLength(3);
    console.log(`SPREAD ${r.spread!.summary}`);
  }, 120000);
});
