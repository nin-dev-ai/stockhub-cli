/**
 * Paper orders (milestone E5): rebalance proposals and the hard limits every order must pass before
 * it can be sent to an Interactive Brokers paper account. These limits live here, outside the
 * Copilot and the UI, and are checked again by the order client at submission.
 */
import { INSTRUMENT_BY_TICKER } from "./instruments";
import type { BrokerAccount, BrokerPosition } from "./ibkr";

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MKT" | "LMT";

export interface ProposedOrder {
  id: string;
  ticker: string;
  conid: number | null;
  side: OrderSide;
  /** Whole shares. */
  quantity: number;
  orderType: OrderType;
  limitPrice: number | null;
  /** The broker's last price, used for estimates and caps. */
  estPrice: number;
  notional: number;
  reason: string;
}

export interface OrderLimits { maxOrderNotional: number; maxDailyNotional: number }
export const DEFAULT_LIMITS: OrderLimits = { maxOrderNotional: 5_000, maxDailyNotional: 20_000 };
export const LIMIT_BOUNDS = { maxOrderNotional: [100, 100_000], maxDailyNotional: [100, 500_000] } as const;

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Whole-share orders that move the plan's tickers toward their target weights. Only tickers in the
 * plan are traded; other holdings are left alone and excluded from the total, so the plan is applied
 * to the plan's own holdings plus cash. Sales come first; purchases are scaled to the cash available.
 */
export function proposeRebalance(
  targets: Record<string, number>, positions: BrokerPosition[], cash: number, minNotional = 50,
): { orders: ProposedOrder[]; total: number; notes: string[] } {
  const notes: string[] = [];
  const byTicker = new Map(positions.filter((p) => p.assetClass === "STK" && p.currency === "USD").map((p) => [p.ticker, p]));
  const plan = Object.entries(targets).filter(([, w]) => w > 1e-9);
  const missingPrice = plan.filter(([t]) => !(byTicker.get(t)?.price! > 0)).map(([t]) => t);
  if (missingPrice.length) notes.push(`No broker price yet for ${missingPrice.join(", ")}; hold one share or look the price up before proposing a purchase.`);
  const priced = plan.filter(([t]) => byTicker.get(t)?.price! > 0);
  const value = (t: string) => (byTicker.get(t)?.units ?? 0) * (byTicker.get(t)?.price ?? 0);
  const total = Math.max(0, cash) + priced.reduce((s, [t]) => s + value(t), 0);
  const others = [...byTicker.keys()].filter((t) => !targets[t]);
  if (others.length) notes.push(`Not in the plan and left alone: ${others.join(", ")}.`);
  if (total <= 0) return { orders: [], total: 0, notes };

  const sells: ProposedOrder[] = [], wants: { t: string; px: number; diff: number; conid: number | null }[] = [];
  for (const [t, w] of priced.sort(([a], [b]) => a.localeCompare(b))) {
    const p = byTicker.get(t)!;
    const diff = w * total - value(t);
    if (diff < -minNotional) {
      const q = Math.min(Math.floor(-diff / p.price!), Math.floor(p.units));
      if (q > 0) sells.push({ id: `sell-${t}`, ticker: t, conid: p.conid, side: "SELL", quantity: q, orderType: "MKT", limitPrice: null, estPrice: p.price!, notional: r2(q * p.price!), reason: `Above its ${(w * 100).toFixed(0)}% target` });
    } else if (diff > minNotional) wants.push({ t, px: p.price!, diff, conid: p.conid });
  }
  let budget = Math.max(0, cash) + sells.reduce((s, o) => s + o.notional, 0);
  const need = wants.reduce((s, x) => s + x.diff, 0);
  const f = need > 0 ? Math.min(1, budget / need) : 0;
  const buys: ProposedOrder[] = [];
  for (const x of wants) {
    const q = Math.floor((x.diff * f) / x.px);
    if (q <= 0 || q * x.px > budget + 1e-9) continue;
    budget -= q * x.px;
    buys.push({ id: `buy-${x.t}`, ticker: x.t, conid: x.conid, side: "BUY", quantity: q, orderType: "MKT", limitPrice: null, estPrice: x.px, notional: r2(q * x.px), reason: `Below its ${((targets[x.t] ?? 0) * 100).toFixed(0)}% target` });
  }
  if (f < 1 && wants.length) notes.push("Purchases were scaled down to the cash available after sales.");
  return { orders: [...sells, ...buys], total: r2(total), notes };
}

export interface OrderContext {
  account: BrokerAccount | null;
  /** Units held of the order's ticker. */
  heldUnits: number;
  /** Notional already submitted today. */
  spentToday: number;
  killSwitch: boolean;
  limits: OrderLimits;
}

/** Every reason the order may not be sent; empty means it passes the hard limits. */
export function checkOrder(o: ProposedOrder, ctx: OrderContext): string[] {
  const e: string[] = [];
  if (ctx.killSwitch) e.push("Trading is switched off (kill switch). Turn it back on first.");
  if (!ctx.account) e.push("No account is selected.");
  else if (!ctx.account.paper) e.push(`${ctx.account.id} is a live account. Orders can only go to paper accounts in this version.`);
  if (!INSTRUMENT_BY_TICKER[o.ticker]) e.push(`${o.ticker} is not on the allow-list (StockHub's supported US-listed ETFs).`);
  if (!Number.isInteger(o.quantity) || o.quantity <= 0) e.push("Quantity must be a whole number of shares above zero.");
  if (o.side !== "BUY" && o.side !== "SELL") e.push("Side must be buy or sell.");
  if (o.side === "SELL" && o.quantity > Math.floor(ctx.heldUnits + 1e-9)) e.push(`Selling ${o.quantity} would exceed the ${ctx.heldUnits} held; short sales are not allowed.`);
  if (o.orderType !== "MKT" && o.orderType !== "LMT") e.push("Only market and limit orders are allowed.");
  if (o.orderType === "LMT" && !(o.limitPrice! > 0)) e.push("A limit order needs a limit price above zero.");
  if (o.conid == null) e.push(`The contract for ${o.ticker} is not resolved yet.`);
  const notional = o.quantity * (o.orderType === "LMT" && o.limitPrice ? o.limitPrice : o.estPrice);
  if (notional > ctx.limits.maxOrderNotional) e.push(`$${notional.toFixed(0)} is above the per-order cap of $${ctx.limits.maxOrderNotional.toFixed(0)}.`);
  if (ctx.spentToday + notional > ctx.limits.maxDailyNotional) e.push(`This would bring today's orders to $${(ctx.spentToday + notional).toFixed(0)}, above the daily cap of $${ctx.limits.maxDailyNotional.toFixed(0)}.`);
  return e;
}

export function validateLimits(l: OrderLimits): string[] {
  const e: string[] = [];
  const bad = (v: number, [lo, hi]: readonly [number, number]) => !Number.isFinite(v) || v < lo || v > hi;
  if (bad(l.maxOrderNotional, LIMIT_BOUNDS.maxOrderNotional)) e.push("The per-order cap must be between $100 and $100,000.");
  if (bad(l.maxDailyNotional, LIMIT_BOUNDS.maxDailyNotional)) e.push("The daily cap must be between $100 and $500,000.");
  if (l.maxOrderNotional > l.maxDailyNotional) e.push("The per-order cap cannot exceed the daily cap.");
  return e;
}

// ---------------------------------------------------------------------------------------------
// Audit log (append-only)

export type AuditKind = "proposed" | "previewed" | "submitted" | "broker_question" | "answered" | "placed" | "rejected" | "cancelled" | "kill_switch" | "trading_enabled" | "limits_changed" | "error";
export interface AuditEntry { at: string; kind: AuditKind; accountId: string | null; order?: Pick<ProposedOrder, "ticker" | "side" | "quantity" | "orderType" | "limitPrice" | "estPrice" | "notional">; detail: string }

const orderPart = (o: ProposedOrder): AuditEntry["order"] =>
  ({ ticker: o.ticker, side: o.side, quantity: o.quantity, orderType: o.orderType, limitPrice: o.limitPrice, estPrice: o.estPrice, notional: o.notional });
export const auditEntry = (kind: AuditKind, accountId: string | null, detail: string, o?: ProposedOrder, at = new Date().toISOString()): AuditEntry =>
  ({ at, kind, accountId, detail, ...(o ? { order: orderPart(o) } : {}) });

/** Notional submitted on the given UTC day. */
export const spentOn = (log: AuditEntry[], day: string) =>
  log.filter((x) => x.kind === "submitted" && x.at.slice(0, 10) === day).reduce((s, x) => s + (x.order?.notional ?? 0), 0);
