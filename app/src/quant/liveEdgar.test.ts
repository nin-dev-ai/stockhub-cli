// Opt-in check of live SEC filings through a dev server started with STOCKHUB_SEC_CONTACT:
//   STOCKHUB_SEC_CONTACT="Your Name you@example.com" npm run dev   (then, in app/)
//   LIVE=1 LIVE_BASE=http://localhost:5173 npx vitest run src/quant/liveEdgar.test.ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import { fetchLiveFeed } from "@/lib/edgar";
import { fetchArkFeed } from "@/lib/ark";
import { EDGAR_CIKS } from "./personas";

const LIVE = process.env.LIVE === "1";
const BASE = process.env.LIVE_BASE ?? "http://localhost:5173";

describe.skipIf(!LIVE)("live SEC filings", () => {
  beforeAll(() => {
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (u: string, init?: RequestInit) => real(u.startsWith("/") ? `${BASE}${u}` : u, init));
  });

  it("reads Berkshire's and Buffett's recent filings to the second", async () => {
    const f = await fetchLiveFeed(EDGAR_CIKS.buffett);
    console.log(`BUFFETT listed ${f.listed} failed ${f.failed} newest ${f.fresh.newestForm} ${f.fresh.newestAccepted} (${f.fresh.age}) last13F ${f.last13F?.filed}`);
    expect(f.failed).toBe(0);
    expect(f.listed).toBeGreaterThan(0);
    expect(f.events.every((e) => e.accepted && e.form && e.url)).toBe(true);
    expect(f.last13F?.filed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 120000);

  it("reads an insider's recent trades and marks them as filed after they happened", async () => {
    const f = await fetchLiveFeed(EDGAR_CIKS.zuckerberg);
    const trades = f.events.filter((e) => e.side === "sell" || e.side === "buy");
    console.log(`ZUCKERBERG listed ${f.listed} trades ${trades.length} newest ${f.fresh.newestAccepted}`);
    expect(f.failed).toBe(0);
    for (const t of trades) expect(t.accepted!.slice(0, 10) >= t.date!, `${t.date} accepted ${t.accepted}`).toBe(true);
  }, 120000);

  it("reads ARK's daily trades from the feed and the official holdings date", async () => {
    const f = await fetchArkFeed(30);
    console.log(`ARK trades ${f.events.length} newest ${f.newestTrade} holdings ${f.holdingsDate} failed ${f.failedFunds.join(",") || "none"}`);
    expect(f.events.length).toBeGreaterThan(20);
    expect(f.failedFunds).toEqual([]);
    expect(f.holdingsDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.events.every((e) => e.form === "ARK daily" && (e.side === "buy" || e.side === "sell"))).toBe(true);
  }, 60000);
});
