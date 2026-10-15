import { describe, it, expect } from "vitest";
import { gatewayState, isPaperAccount, normalizeAccounts, normalizePositions, normalizeSummary, syncDrafts, trackable, unpricedExits } from "./ibkr";
import { assertReadOnly, ibkrPositions, ibkrStatus, ReadOnlyViolation } from "@/lib/ibkr";
import { checkLedger, finalizeTx, ledgerAt, type Transaction } from "./tracking";

const pos = (o: Record<string, unknown>) => ({ acctId: "DU123", conid: 756733, contractDesc: "SPY", ticker: "SPY", position: 10, mktPrice: 500, mktValue: 5000, currency: "USD", avgCost: 450, avgPrice: 450, unrealizedPnl: 500, assetClass: "STK", ...o });

describe("IBKR shapes", () => {
  it("reads the gateway state", () => {
    expect(gatewayState({ authenticated: true, connected: true, competing: false })).toEqual({ kind: "connected", competing: false });
    expect(gatewayState({ authenticated: false, connected: true }).kind).toBe("login");
    expect(gatewayState(null).kind).toBe("login");
  });
  it("tells paper accounts from live ones", () => {
    expect(isPaperAccount("DU1234567")).toBe(true);
    expect(isPaperAccount("U1234567")).toBe(false);
    expect(normalizeAccounts([{ accountId: "DU1", accountTitle: "Paper", currency: "USD" }, { id: "U9" }, {}])).toEqual([
      { id: "DU1", title: "Paper", currency: "USD", paper: true }, { id: "U9", title: "U9", currency: "USD", paper: false },
    ]);
  });
  it("normalizes positions and the account summary", () => {
    const p = normalizePositions([pos({}), pos({ ticker: undefined, contractDesc: "QQQ  NASDAQ", position: 0 }), pos({ ticker: undefined, contractDesc: "VTI ARCA", position: "3" })]);
    expect(p.map((x) => [x.ticker, x.units, x.price, x.avgCost])).toEqual([["SPY", 10, 500, 450], ["VTI", 3, 500, 450]]);
    expect(normalizeSummary({ netliquidation: { amount: 12345.6, currency: "USD" }, totalcashvalue: { amount: "100" } })).toEqual({ netLiquidation: 12345.6, cash: 100, currency: "USD" });
  });
  it("tracks long USD stocks and ETFs only and says why others are left out", () => {
    const t = trackable(normalizePositions([pos({}), pos({ ticker: "AAPL  C150", assetClass: "OPT" }), pos({ ticker: "SAP", currency: "EUR" }), pos({ ticker: "TSLA", position: -5 })]));
    expect(t.ok.map((x) => x.ticker)).toEqual(["SPY"]);
    expect(t.skipped.map((x) => x.reason)).toEqual(["OPT positions are not tracked", "priced in EUR; only USD is supported", "short positions are not tracked"]);
  });
});

describe("syncing a broker-reported ledger", () => {
  const tx = (o: Partial<Transaction>): Transaction => finalizeTx({ date: "2026-01-02", kind: "transfer_in", fee: 0, ...o } as never, Math.random().toString(36), "2026-01-02T00:00:00Z");
  it("brings the ledger to the broker's units: sells first, then holdings brought in", () => {
    const ledger = [tx({ ticker: "SPY", units: 4, price: 400 }), tx({ ticker: "IWM", units: 2, price: 200 })];
    const state = ledgerAt(ledger, "2026-10-16");
    const broker = normalizePositions([pos({ position: 10 }), pos({ ticker: "QQQ", position: 1, mktPrice: 600 })]);
    const drafts = syncDrafts(state, broker, "2026-10-16", { IWM: 210 });
    expect(drafts.map((d) => [d.kind, d.ticker, d.units, d.price])).toEqual([["sell", "IWM", 2, 210], ["transfer_in", "SPY", 6, 500], ["transfer_in", "QQQ", 1, 600]]);
    const after = [...ledger, ...drafts.map((d) => finalizeTx(d, Math.random().toString(36), "2026-10-16T00:00:00Z"))];
    expect(checkLedger(after)).toEqual([]);
    expect(ledgerAt(after, "2026-10-16").units).toEqual({ SPY: 10, QQQ: 1 });
    expect(syncDrafts(ledgerAt(after, "2026-10-16"), broker, "2026-10-17")).toEqual([]);
    expect(unpricedExits(state, broker)).toEqual(["IWM"]);
  });
});

describe("read-only client", () => {
  it("allows only status, keep-alive and portfolio reads", () => {
    expect(() => assertReadOnly("GET", "/portfolio/DU1/positions/0")).not.toThrow();
    expect(() => assertReadOnly("POST", "/tickle")).not.toThrow();
    for (const [m, p] of [["POST", "/iserver/account/DU1/orders"], ["POST", "/iserver/reply/abc"], ["DELETE", "/iserver/account/DU1/order/1"], ["GET", "/iserver/account/DU1/orders/whatif"], ["POST", "/portfolio/accounts"]]) {
      expect(() => assertReadOnly(m, p), `${m} ${p}`).toThrow(ReadOnlyViolation);
    }
  });
  it("reports an offline gateway and pages through positions", async () => {
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect((await ibkrStatus(down)).kind).toBe("offline");
    const calls: string[] = [];
    const pages = (async (url: string) => {
      calls.push(url);
      const page = Number(url.split("/").pop());
      const rows = page === 0 ? Array.from({ length: 100 }, (_, i) => pos({ ticker: `T${i}`, contractDesc: `T${i}` })) : [pos({ ticker: "LAST" })];
      return new Response(JSON.stringify(rows), { status: 200 });
    }) as unknown as typeof fetch;
    const all = await ibkrPositions("DU1", pages);
    expect(all).toHaveLength(101);
    expect(calls).toEqual(["/ibkr/v1/api/portfolio/DU1/positions/0", "/ibkr/v1/api/portfolio/DU1/positions/1"]);
    const login = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    expect((await ibkrStatus(login)).kind).toBe("login");
  });
});
