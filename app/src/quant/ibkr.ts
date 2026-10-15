/**
 * Interactive Brokers, read-only (milestone E4). Shapes returned by the Client Portal Gateway's
 * REST API (`/v1/api`), normalized for StockHub, and the ledger entries that bring a
 * broker-reported portfolio in line with the broker's positions. Pure functions only; the HTTP
 * client lives in lib/ibkr.ts.
 */
import type { LedgerState, TxDraft } from "./tracking";

export type GatewayState =
  | { kind: "offline"; detail: string }          // nothing answering at the proxy target
  | { kind: "login"; detail: string }            // gateway running, brokerage session not authenticated
  | { kind: "connected"; competing: boolean };

/** `/iserver/auth/status` → state. */
export function gatewayState(raw: unknown): GatewayState {
  const r = (raw ?? {}) as { authenticated?: boolean; connected?: boolean; competing?: boolean; message?: string };
  if (r.authenticated && r.connected) return { kind: "connected", competing: !!r.competing };
  return { kind: "login", detail: r.message || (r.connected ? "Connected to IBKR but not logged in." : "The gateway is running but not logged in.") };
}

export interface BrokerAccount { id: string; title: string; currency: string; paper: boolean }

/** Paper (simulated) account ids start with "D" (e.g. DU1234567); live ids start with "U" or another letter. */
export const isPaperAccount = (id: string) => /^D[A-Z]?\d+$/i.test(id.trim());

export function normalizeAccounts(raw: unknown): BrokerAccount[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a: Record<string, unknown>) => {
    const id = String(a.accountId ?? a.id ?? "").trim();
    if (!id) return [];
    return [{ id, title: String(a.accountTitle ?? a.desc ?? id), currency: String(a.currency ?? "USD"), paper: isPaperAccount(id) }];
  });
}

export interface BrokerPosition {
  ticker: string;
  conid: number | null;
  units: number;
  price: number | null;
  value: number | null;
  avgCost: number | null;
  currency: string;
  /** IBKR asset class: STK (stocks and ETFs), OPT, FUT, CASH, BOND… */
  assetClass: string;
  unrealizedPnl: number | null;
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** `/portfolio/{id}/positions/{page}` rows; closed (zero) positions are dropped. */
export function normalizePositions(raw: unknown): BrokerPosition[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p: Record<string, unknown>) => {
    const units = n(p.position) ?? 0;
    if (Math.abs(units) < 1e-9) return [];
    const ticker = String(p.ticker ?? p.contractDesc ?? "").trim().toUpperCase().split(/\s+/)[0];
    return [{
      ticker, conid: n(p.conid), units, price: n(p.mktPrice), value: n(p.mktValue), avgCost: n(p.avgPrice ?? p.avgCost),
      currency: String(p.currency ?? "USD"), assetClass: String(p.assetClass ?? "STK"), unrealizedPnl: n(p.unrealizedPnl),
    }];
  });
}

export interface BrokerSummary { netLiquidation: number | null; cash: number | null; currency: string }

/** `/portfolio/{id}/summary`: each field is `{ amount, currency }`. */
export function normalizeSummary(raw: unknown): BrokerSummary {
  const r = (raw ?? {}) as Record<string, { amount?: unknown; currency?: unknown } | undefined>;
  return { netLiquidation: n(r.netliquidation?.amount), cash: n(r.totalcashvalue?.amount), currency: String(r.netliquidation?.currency ?? "USD") };
}

/** Positions StockHub can value and track: long US-dollar stocks and ETFs. Everything else is listed, not imported. */
export function trackable(positions: BrokerPosition[]): { ok: BrokerPosition[]; skipped: { ticker: string; reason: string }[] } {
  const ok: BrokerPosition[] = [], skipped: { ticker: string; reason: string }[] = [];
  for (const p of positions) {
    if (p.assetClass !== "STK") skipped.push({ ticker: p.ticker, reason: `${p.assetClass} positions are not tracked` });
    else if (p.currency !== "USD") skipped.push({ ticker: p.ticker, reason: `priced in ${p.currency}; only USD is supported` });
    else if (p.units < 0) skipped.push({ ticker: p.ticker, reason: "short positions are not tracked" });
    else if (!(p.price! > 0)) skipped.push({ ticker: p.ticker, reason: "no market price from the broker" });
    else if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(p.ticker)) skipped.push({ ticker: p.ticker, reason: "symbol not recognised" });
    else ok.push(p);
  }
  return { ok, skipped };
}

const NOTE = "Synced from IBKR (read-only)";

/**
 * Ledger entries that make a broker-reported portfolio hold what the broker reports, priced at the
 * broker's market prices on `date`. An increase is recorded as an existing holding brought in (it
 * counts as money in, since StockHub cannot see the deposit that paid for it); a decrease is a sale.
 * Sales come first so their cash is available.
 */
export function syncDrafts(ledger: LedgerState, positions: BrokerPosition[], date: string, lastPrice: Record<string, number> = {}): TxDraft[] {
  const target = new Map(trackable(positions).ok.map((p) => [p.ticker, p]));
  const sells: TxDraft[] = [], adds: TxDraft[] = [];
  // a holding the broker no longer reports has no broker price; the latest market close prices its sale
  const price = (t: string) => target.get(t)?.price ?? lastPrice[t] ?? null;
  for (const [t, held] of Object.entries(ledger.units)) {
    const want = target.get(t)?.units ?? 0;
    if (held - want > 1e-6) {
      const px = price(t);
      if (px) sells.push({ date, kind: "sell", ticker: t, units: +(held - want).toFixed(6), price: px, fee: 0, note: NOTE });
    }
  }
  for (const [t, p] of target) {
    const held = ledger.units[t] ?? 0;
    if (p.units - held > 1e-6) adds.push({ date, kind: "transfer_in", ticker: t, units: +(p.units - held).toFixed(6), price: p.price!, fee: 0, note: NOTE });
  }
  return [...sells, ...adds];
}

/** Tickers the ledger holds that the broker no longer reports and that have no price to sell them at. */
export const unpricedExits = (ledger: LedgerState, positions: BrokerPosition[], lastPrice: Record<string, number> = {}) =>
  Object.keys(ledger.units).filter((t) => !trackable(positions).ok.some((p) => p.ticker === t) && !(lastPrice[t] > 0));
