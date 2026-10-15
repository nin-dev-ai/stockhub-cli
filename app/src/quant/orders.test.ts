import { describe, it, expect } from "vitest";
import { auditEntry, checkOrder, DEFAULT_LIMITS, proposeRebalance, spentOn, validateLimits, type OrderContext, type ProposedOrder } from "./orders";
import { normalizePositions } from "./ibkr";
import { answerQuestion, cancelAll, OrderBlocked, previewOrder, submitOrder } from "@/lib/ibkrOrders";

const pos = (ticker: string, position: number, mktPrice: number, extra: Record<string, unknown> = {}) => ({ conid: ticker.length * 100 + position, ticker, contractDesc: ticker, position, mktPrice, currency: "USD", assetClass: "STK", ...extra });
const positions = normalizePositions([pos("SPY", 10, 500), pos("SHY", 10, 80), pos("AAPL", 3, 200)]);
const paper = { id: "DU123", title: "Paper", currency: "USD", paper: true };
const ctx = (o: Partial<OrderContext> = {}): OrderContext => ({ account: paper, heldUnits: 10, spentToday: 0, killSwitch: false, limits: DEFAULT_LIMITS, ...o });
const order = (o: Partial<ProposedOrder> = {}): ProposedOrder => ({ id: "buy-SPY", ticker: "SPY", conid: 756733, side: "BUY", quantity: 2, orderType: "MKT", limitPrice: null, estPrice: 500, notional: 1000, reason: "", ...o });

describe("rebalance proposals", () => {
  it("trades only plan tickers, sells first, whole shares, within cash", () => {
    // plan value: 5000 SPY + 800 SHY + 200 cash = 6000 → 60/40 = 3600 / 2400; selling 2 SPY leaves $1,200 for 15 SHY
    const r = proposeRebalance({ SPY: 0.6, SHY: 0.4 }, positions, 200);
    expect(r.total).toBe(6000);
    expect(r.orders.map((o) => [o.side, o.ticker, o.quantity])).toEqual([["SELL", "SPY", 2], ["BUY", "SHY", 15]]);
    expect(r.orders.every((o) => Number.isInteger(o.quantity))).toBe(true);
    const spend = r.orders.filter((o) => o.side === "BUY").reduce((s, o) => s + o.notional, 0) - r.orders.filter((o) => o.side === "SELL").reduce((s, o) => s + o.notional, 0);
    expect(spend).toBeLessThanOrEqual(200 + 1e-9);
    expect(r.notes.join()).toMatch(/left alone: AAPL/);
  });
  it("needs a broker price before proposing a purchase", () => {
    const r = proposeRebalance({ SPY: 0.5, QQQ: 0.5 }, positions, 1000);
    expect(r.orders.some((o) => o.ticker === "QQQ")).toBe(false);
    expect(r.notes.join()).toMatch(/No broker price yet for QQQ/);
  });
});

describe("hard limits", () => {
  it("pass a normal paper order", () => expect(checkOrder(order(), ctx())).toEqual([]));
  it("reject live accounts, unlisted tickers, shorts, odd quantities, other order types and missing contracts", () => {
    expect(checkOrder(order(), ctx({ account: { ...paper, id: "U999", paper: false } })).join()).toMatch(/live account/);
    expect(checkOrder(order({ ticker: "AAPL" }), ctx()).join()).toMatch(/not on the allow-list/);
    expect(checkOrder(order({ side: "SELL", quantity: 11 }), ctx()).join()).toMatch(/short sales are not allowed/);
    expect(checkOrder(order({ quantity: 1.5 }), ctx()).join()).toMatch(/whole number/);
    expect(checkOrder(order({ orderType: "STP" as never }), ctx()).join()).toMatch(/market and limit/);
    expect(checkOrder(order({ orderType: "LMT", limitPrice: null }), ctx()).join()).toMatch(/limit price/);
    expect(checkOrder(order({ conid: null }), ctx()).join()).toMatch(/not resolved/);
    expect(checkOrder(order(), ctx({ account: null })).join()).toMatch(/No account/);
  });
  it("enforce the per-order and daily caps and the kill switch", () => {
    expect(checkOrder(order({ quantity: 11 }), ctx()).join()).toMatch(/per-order cap/);
    expect(checkOrder(order(), ctx({ spentToday: 19_500 })).join()).toMatch(/daily cap/);
    expect(checkOrder(order(), ctx({ killSwitch: true })).join()).toMatch(/kill switch/);
    expect(validateLimits({ maxOrderNotional: 50, maxDailyNotional: 100 })).not.toEqual([]);
    expect(validateLimits({ maxOrderNotional: 6000, maxDailyNotional: 5000 }).join()).toMatch(/cannot exceed/);
  });
  it("sum today's submitted notional from the audit log", () => {
    const log = [auditEntry("submitted", "DU123", "", order(), "2026-10-16T10:00:00Z"), auditEntry("previewed", "DU123", "", order(), "2026-10-16T10:00:00Z"), auditEntry("submitted", "DU123", "", order(), "2026-10-15T10:00:00Z")];
    expect(spentOn(log, "2026-10-16")).toBe(1000);
  });
});

describe("order client", () => {
  const calls: string[] = [];
  const gw = (replies: Record<string, unknown>) => (async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.replace("/ibkr/v1/api", "")}`;
    calls.push(key);
    const hit = Object.entries(replies).find(([k]) => key.startsWith(k));
    return new Response(JSON.stringify(hit ? hit[1] : {}), { status: hit ? 200 : 404 });
  }) as unknown as typeof fetch;

  it("refuses live accounts before any request", async () => {
    calls.length = 0;
    const f = gw({});
    await expect(previewOrder("U999", order(), f)).rejects.toBeInstanceOf(OrderBlocked);
    await expect(submitOrder("U999", order(), ctx(), f)).rejects.toBeInstanceOf(OrderBlocked);
    await expect(answerQuestion("U999", "r1", f)).rejects.toBeInstanceOf(OrderBlocked);
    await expect(cancelAll("U999", f)).rejects.toBeInstanceOf(OrderBlocked);
    expect(calls).toEqual([]);
  });
  it("re-checks the limits at submission and sends nothing when they fail", async () => {
    calls.length = 0;
    await expect(submitOrder("DU123", order({ ticker: "AAPL" }), ctx(), gw({}))).rejects.toThrow(/allow-list/);
    expect(calls).toEqual([]);
  });
  it("returns IBKR's questions instead of answering them, and reads a placed order", async () => {
    calls.length = 0;
    const q = await submitOrder("DU123", order(), ctx(), gw({ "GET /iserver/accounts": {}, "POST /iserver/account/DU123/orders": [{ id: "r1", message: ["Are you sure you want to submit this order?"] }] }));
    expect(q).toEqual({ kind: "question", replyId: "r1", messages: ["Are you sure you want to submit this order?"] });
    expect(calls).toEqual(["GET /iserver/accounts", "POST /iserver/account/DU123/orders"]);
    const placed = await answerQuestion("DU123", "r1", gw({ "POST /iserver/reply/r1": [{ order_id: "987", order_status: "PreSubmitted" }] }));
    expect(placed).toEqual({ kind: "placed", orderId: "987", status: "PreSubmitted" });
  });
  it("cancels only this account's open orders on the kill switch", async () => {
    calls.length = 0;
    const r = await cancelAll("DU123", gw({
      "GET /iserver/account/orders": { orders: [{ orderId: 1, acct: "DU123", status: "Submitted" }, { orderId: 2, acct: "DU123", status: "Filled" }, { orderId: 3, acct: "DU999", status: "Submitted" }] },
      "DELETE /iserver/account/DU123/order/1": { msg: "Request was submitted" },
    }));
    expect(r).toEqual({ cancelled: ["1"], failed: [] });
    expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual(["DELETE /iserver/account/DU123/order/1"]);
  });
});
