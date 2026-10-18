import { describe, expect, it } from "vitest";
import { buyList, buyListSummary } from "./buyList";
import { proposeRebalance } from "./orders";

const px: Record<string, number> = { SPY: 763.25, AGG: 95.38, TLT: 80.05, GLD: 382.01, SHY: 81.36 };
const targets = { SPY: 0.69, AGG: 0.16, TLT: 0.05, GLD: 0.05, SHY: 0.05 };

describe("buy list", () => {
  it("says $200 buys no SPY and names the minimum that holds every ETF", () => {
    const b = buyList(targets, (t) => px[t], 200);
    expect(b.rows.find((r) => r.ticker === "SPY")!.shares).toBe(0);
    expect(b.zero).toContain("SPY");
    // GLD at 5% needs $382.01 / 0.05 = $7,640.20
    expect(b.minimum).toBe(7641);
    expect(buyListSummary(b)).toBe("$200 is too little for a whole share of any ETF in the plan: at least $7,641 is needed to hold every ETF at its target.");
    expect(buyListSummary(buyList(targets, (t) => px[t], 2000))).toMatch(/^\$2,000 buys no GLD in whole shares/);
  });
  it("rounds down each target notional and keeps the rest in cash", () => {
    const b = buyList(targets, (t) => px[t], 10_000);
    expect(b.rows.map((r) => [r.ticker, r.shares])).toEqual([["SPY", 9], ["AGG", 16], ["TLT", 6], ["GLD", 1], ["SHY", 6]]);
    expect(b.spent + b.leftover).toBeCloseTo(10_000, 6);
    for (const r of b.rows) expect(r.cost).toBeLessThanOrEqual(r.target * 10_000 + 1e-9);
    expect(buyListSummary(b)).toMatch(/^\$10,000 buys every ETF in whole shares, leaving/);
  });
  it("buys the same whole shares as a Paper Orders proposal from cash", () => {
    const b = buyList(targets, (t) => px[t], 10_000);
    const positions = Object.keys(px).map((t, i) => ({ ticker: t, conid: i + 1, units: 0, price: px[t], value: 0, currency: "USD", assetClass: "STK" }));
    const p = proposeRebalance(targets, positions as never, 10_000, 0);
    const fromOrders = Object.fromEntries(p.orders.map((o) => [o.ticker, o.quantity]));
    for (const r of b.rows) expect(fromOrders[r.ticker] ?? 0).toBe(r.shares);
  });
  it("leaves out unpriced ETFs", () => {
    const b = buyList({ SPY: 0.5, XYZ: 0.5 }, (t) => px[t] ?? null, 2000);
    expect(b.unpriced).toEqual(["XYZ"]);
  });
});
