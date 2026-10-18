/**
 * What an amount of money actually buys in whole shares, the way Paper Orders sizes purchases:
 * each ETF gets the whole number of shares that fits inside its target share of the money
 * (rounded down), and the rest stays in cash. See docs/PRD_phase6.md (P-3).
 */

export interface BuyRow { ticker: string; target: number; price: number; shares: number; cost: number; weight: number; gap: number }
export interface BuyList {
  amount: number;
  rows: BuyRow[];
  spent: number;
  leftover: number;
  /** The smallest amount at which every ETF gets at least one share at its target weight. */
  minimum: number;
  /** ETFs with no price, left out. */
  unpriced: string[];
  /** ETFs the amount cannot buy a single share of. */
  zero: string[];
}

export function buyList(targets: Record<string, number>, price: (ticker: string) => number | null, amount: number): BuyList {
  const rows: BuyRow[] = [];
  const unpriced: string[] = [];
  let minimum = 0;
  for (const [ticker, target] of Object.entries(targets).filter(([t, w]) => t !== "CASH" && w > 1e-9).sort((a, b) => b[1] - a[1])) {
    const p = price(ticker);
    if (!p || p <= 0) { unpriced.push(ticker); continue; }
    // same rounding as Paper Orders: floor of the target notional over the price
    const shares = Math.max(0, Math.floor((target * amount) / p + 1e-9));
    rows.push({ ticker, target, price: p, shares, cost: shares * p, weight: 0, gap: 0 });
    minimum = Math.max(minimum, p / target);
  }
  const spent = rows.reduce((s, r) => s + r.cost, 0);
  for (const r of rows) { r.weight = amount > 0 ? r.cost / amount : 0; r.gap = r.weight - r.target; }
  return { amount, rows, spent, leftover: Math.max(0, amount - spent), minimum: Math.ceil(minimum), unpriced, zero: rows.filter((r) => r.shares === 0).map((r) => r.ticker) };
}

/** One sentence on whether whole shares work for this amount. */
export function buyListSummary(b: BuyList): string {
  const money = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
  if (b.rows.length === 0) return "No priced holdings to buy.";
  if (b.zero.length === b.rows.length) return `${money(b.amount)} is too little for a whole share of any ETF in the plan: at least ${money(b.minimum)} is needed to hold every ETF at its target.`;
  if (b.zero.length) return `${money(b.amount)} buys no ${b.zero.join(", ")} in whole shares: at least ${money(b.minimum)} is needed to hold every ETF at its target.`;
  return `${money(b.amount)} buys every ETF in whole shares, leaving ${money(b.leftover)} (${((b.leftover / b.amount) * 100).toFixed(1)}%) in cash.`;
}
