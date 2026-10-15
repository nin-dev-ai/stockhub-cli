import { checkOrder, type OrderContext, type ProposedOrder } from "@/quant/orders";
import { isPaperAccount } from "@/quant/ibkr";
import { IBKR_BASE } from "./ibkr";

/**
 * The only module that can send orders to Interactive Brokers, and only to paper accounts. Every
 * call checks the account id is a paper account; submission re-runs the hard limits in
 * quant/orders.ts. IBKR's follow-up questions ("reply" prompts) are returned to the caller to show
 * the user verbatim; this module never answers them on its own.
 */
const TIMEOUT_MS = 15_000;

export class OrderBlocked extends Error {}

export function assertPaper(accountId: string) {
  if (!isPaperAccount(accountId)) throw new OrderBlocked(`${accountId} is not a paper account; StockHub only sends orders to paper accounts.`);
}

async function call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, fetcher: typeof fetch = fetch): Promise<unknown> {
  const res = await fetcher(`${IBKR_BASE}${path}`, {
    method, signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `IBKR returned ${res.status} for ${path}.`);
  return data;
}

/** Resolves a US-listed ETF's contract id. */
export async function resolveConid(ticker: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  const raw = await call("GET", `/iserver/secdef/search?symbol=${encodeURIComponent(ticker)}&secType=STK`, undefined, fetcher);
  const rows = Array.isArray(raw) ? raw as { conid?: unknown; symbol?: string; description?: string }[] : [];
  const us = rows.find((r) => r.symbol === ticker && /ARCA|NASDAQ|NYSE|BATS|AMEX/i.test(r.description ?? "")) ?? rows.find((r) => r.symbol === ticker);
  const id = Number(us?.conid);
  return Number.isFinite(id) && id > 0 ? id : null;
}

const body = (accountId: string, o: ProposedOrder) => ({
  orders: [{
    acctId: accountId, conid: o.conid, orderType: o.orderType, side: o.side, quantity: o.quantity, tif: "DAY",
    ...(o.orderType === "LMT" ? { price: o.limitPrice } : {}),
    cOID: `stockhub-${o.id}-${Date.now()}`,
  }],
});

export interface WhatIf { commission: string | null; equityChange: string | null; initialMargin: string | null; warning: string | null; error: string | null }

/** IBKR's preview of the order: commission and margin impact. Places nothing. */
export async function previewOrder(accountId: string, o: ProposedOrder, fetcher: typeof fetch = fetch): Promise<WhatIf> {
  assertPaper(accountId);
  const r = (await call("POST", `/iserver/account/${encodeURIComponent(accountId)}/orders/whatif`, body(accountId, o), fetcher)) as Record<string, Record<string, unknown> | string | undefined> | null;
  const part = (k: string, f: string) => { const v = (r?.[k] as Record<string, unknown> | undefined)?.[f]; return v == null ? null : String(v); };
  return { commission: part("amount", "commission"), equityChange: part("equity", "change"), initialMargin: part("initial", "after"), warning: (r?.warn as string) || null, error: (r?.error as string) || null };
}

export type SubmitResult =
  | { kind: "placed"; orderId: string; status: string }
  | { kind: "question"; replyId: string; messages: string[] };

function readSubmit(raw: unknown): SubmitResult {
  const first = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  if (first?.id && Array.isArray(first.message)) return { kind: "question", replyId: String(first.id), messages: (first.message as unknown[]).map(String) };
  if (first?.order_id != null) return { kind: "placed", orderId: String(first.order_id), status: String(first.order_status ?? "submitted") };
  throw new Error(`Unexpected response from IBKR: ${JSON.stringify(raw).slice(0, 200)}`);
}

/** Sends one order after re-checking the hard limits. */
export async function submitOrder(accountId: string, o: ProposedOrder, ctx: OrderContext, fetcher: typeof fetch = fetch): Promise<SubmitResult> {
  assertPaper(accountId);
  const problems = checkOrder(o, ctx);
  if (problems.length) throw new OrderBlocked(problems.join(" "));
  // the gateway needs the account list requested before it accepts orders
  await call("GET", "/iserver/accounts", undefined, fetcher);
  return readSubmit(await call("POST", `/iserver/account/${encodeURIComponent(accountId)}/orders`, body(accountId, o), fetcher));
}

/** Answers one IBKR question with yes; only called from the user's own click on that question. */
export async function answerQuestion(accountId: string, replyId: string, fetcher: typeof fetch = fetch): Promise<SubmitResult> {
  assertPaper(accountId);
  return readSubmit(await call("POST", `/iserver/reply/${encodeURIComponent(replyId)}`, { confirmed: true }, fetcher));
}

export interface OpenOrder { orderId: string; ticker: string; side: string; quantity: number | null; status: string; account: string }

export async function openOrders(fetcher: typeof fetch = fetch): Promise<OpenOrder[]> {
  const raw = (await call("GET", "/iserver/account/orders", undefined, fetcher)) as { orders?: Record<string, unknown>[] } | null;
  return (raw?.orders ?? []).map((x) => ({
    orderId: String(x.orderId ?? ""), ticker: String(x.ticker ?? x.symbol ?? ""), side: String(x.side ?? ""),
    quantity: x.totalSize != null ? Number(x.totalSize) : null, status: String(x.status ?? ""), account: String(x.acct ?? x.account ?? ""),
  }));
}

const DONE = /^(filled|cancelled|inactive)$/i;

/** Kill switch: cancels every open order on the paper account. Returns what was cancelled and what failed. */
export async function cancelAll(accountId: string, fetcher: typeof fetch = fetch): Promise<{ cancelled: string[]; failed: string[] }> {
  assertPaper(accountId);
  const open = (await openOrders(fetcher)).filter((o) => o.account === accountId && !DONE.test(o.status));
  const cancelled: string[] = [], failed: string[] = [];
  for (const o of open) {
    try { await call("DELETE", `/iserver/account/${encodeURIComponent(accountId)}/order/${encodeURIComponent(o.orderId)}`, undefined, fetcher); cancelled.push(o.orderId); }
    catch { failed.push(o.orderId); }
  }
  return { cancelled, failed };
}
