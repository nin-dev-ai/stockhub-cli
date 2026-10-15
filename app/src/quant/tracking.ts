import { hashId } from "./hash";
import type { LabInputs } from "./lab";
import type { Sleeve, Weights } from "./portfolio";
import type { Distribution, ProjectionResult } from "./projection";
import { addMonths } from "./report";
import type { SimResult } from "./backtest";
import type { StrategyDef } from "./strategy";
import { ENGINE_VERSION, type Panel } from "./types";

/**
 * Milestone C: paper and manually reported portfolios, an append-only transaction ledger,
 * immutable projection snapshots, and the comparison of observations against a snapshot.
 * Pure functions only; persistence lives in store/portfolioStore.ts.
 */

export type PortfolioMode = "paper" | "manual" | "broker";
export const MODE_LABEL: Record<PortfolioMode, string> = {
  paper: "Paper (hypothetical)",
  manual: "Manually reported · not broker-verified",
  broker: "Broker-reported · IBKR, read-only",
};

export type TxKind = "contribution" | "withdrawal" | "buy" | "sell" | "fee" | "dividend" | "transfer_in";
export const TX_LABEL: Record<TxKind, string> = {
  contribution: "Contribution", withdrawal: "Withdrawal", buy: "Buy", sell: "Sell",
  fee: "Fee", dividend: "Dividend (cash)", transfer_in: "Existing holding",
};
const TRADE_KINDS: TxKind[] = ["buy", "sell", "transfer_in"];
export const isTrade = (k: TxKind) => TRADE_KINDS.includes(k);

export interface Transaction {
  id: string;
  date: string;              // ISO trade/value date
  kind: TxKind;
  ticker?: string;           // trades only
  units?: number;            // trades only, > 0
  price?: number;            // trades only, per unit in USD
  amount: number;            // cash amount for non-trades; units * price for trades
  fee: number;               // paid from cash
  note?: string;
  createdAt: string;
}

export interface Portfolio {
  id: string;
  name: string;
  mode: PortfolioMode;
  baseCurrency: "USD";
  createdAt: string;
  /** Snapshot ids in creation order; the first is the original plan. Empty for a holdings-only record. */
  snapshotIds: string[];
  transactions: Transaction[];
}

export interface LedgerState {
  cash: number;
  units: Record<string, number>;
  /** Contributions + transferred-in holdings - withdrawals: the external money in. */
  netContributed: number;
  fees: number;
  dividends: number;
}

const EPS = 1e-9;
const byDate = (a: Transaction, b: Transaction) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1);
export const sortTx = (txs: Transaction[]) => [...txs].sort(byDate);

/** Applies a transaction to a state, returning a new state. `scale` converts recorded units to valuation units. */
export function applyTx(s: LedgerState, tx: Transaction, scale = 1): LedgerState {
  const n: LedgerState = { ...s, units: { ...s.units } };
  n.cash -= tx.fee; n.fees += tx.fee;
  const add = (t: string, u: number) => {
    const v = (n.units[t] ?? 0) + u;
    if (Math.abs(v) < EPS) delete n.units[t]; else n.units[t] = v;
  };
  switch (tx.kind) {
    case "contribution": n.cash += tx.amount; n.netContributed += tx.amount; break;
    case "withdrawal": n.cash -= tx.amount; n.netContributed -= tx.amount; break;
    case "fee": n.cash -= tx.amount; n.fees += tx.amount; break;
    case "dividend": n.cash += tx.amount; n.dividends += tx.amount; break;
    case "buy": n.cash -= tx.amount; add(tx.ticker!, tx.units! * scale); break;
    case "sell": n.cash += tx.amount; add(tx.ticker!, -tx.units! * scale); break;
    case "transfer_in": n.netContributed += tx.amount; add(tx.ticker!, tx.units! * scale); break;
  }
  return n;
}

export const EMPTY_LEDGER: LedgerState = { cash: 0, units: {}, netContributed: 0, fees: 0, dividends: 0 };

export function ledgerAt(txs: Transaction[], upTo?: string, scale?: (tx: Transaction) => number): LedgerState {
  let s = EMPTY_LEDGER;
  for (const tx of sortTx(txs)) {
    if (upTo && tx.date > upTo) break;
    s = applyTx(s, tx, scale ? scale(tx) : 1);
  }
  return s;
}

export type TxDraft = Omit<Transaction, "id" | "createdAt" | "amount"> & { amount?: number };

/** Validates a new transaction against the ledger; no leverage, no short sales, no future dates. */
export function validateTx(existing: Transaction[], d: TxDraft, today: string): string[] {
  const e: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) e.push("Enter a date as YYYY-MM-DD.");
  else if (d.date > today) e.push("The date cannot be in the future.");
  if (!Number.isFinite(d.fee) || d.fee < 0) e.push("Fee must be zero or more.");
  if (isTrade(d.kind)) {
    if (!d.ticker || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(d.ticker.toUpperCase())) e.push("Enter a ticker symbol.");
    if (!(d.units! > 0) || !Number.isFinite(d.units!)) e.push("Units must be more than zero.");
    if (!(d.price! > 0) || !Number.isFinite(d.price!)) e.push("Price must be more than zero.");
  } else if (!(d.amount! > 0) || !Number.isFinite(d.amount!)) e.push("Amount must be more than zero.");
  if (e.length > 0) return e;

  return checkLedger([...existing, finalizeTx(d, "draft", "9999")]);
}

/** Replays a ledger and reports the first state that is overdrawn or short. */
export function checkLedger(txs: Transaction[]): string[] {
  let s = EMPTY_LEDGER;
  for (const t of sortTx(txs)) {
    s = applyTx(s, t);
    if (s.cash < -0.005) return [`Cash would fall to ${s.cash.toFixed(2)} on ${t.date}. Record a contribution first; leverage is not supported.`];
    const neg = Object.entries(s.units).find(([, u]) => u < -EPS);
    if (neg) return [`Units of ${neg[0]} would go negative on ${t.date}; short sales are not supported.`];
  }
  return [];
}

export function finalizeTx(d: TxDraft, id: string, createdAt: string): Transaction {
  const trade = isTrade(d.kind);
  return {
    ...d, id, createdAt,
    ticker: trade ? d.ticker!.toUpperCase() : undefined,
    amount: trade ? d.units! * d.price! : d.amount!,
  };
}

// ---------------------------------------------------------------------------------------------
// Prices and valuation

/** Index of the last date on or before `date`, or -1. */
export function indexOnOrBefore(dates: string[], date: string): number {
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function closeOn(panel: Panel, ticker: string, date: string): number | null {
  const i = indexOnOrBefore(panel.dates, date);
  const c = panel.closes[ticker];
  return i >= 0 && c ? c[i] : null;
}

/**
 * Paper trades are priced at the adjusted close. Adjusted histories are rescaled backwards after
 * each later dividend, so a paper lot is re-expressed in today's adjusted units; this reinvests
 * distributions implicitly, the same convention the backtester uses.
 */
export function paperScale(panel: Panel): (tx: Transaction) => number {
  return (tx) => {
    if (!tx.ticker || !tx.price) return 1;
    const c = closeOn(panel, tx.ticker, tx.date);
    return c ? tx.price / c : 1;
  };
}

export interface Valuation {
  dates: string[];
  value: number[];
  contributed: number[];
  cash: number[];
  /** Tickers held with no price data; their value is excluded and flagged. */
  unpriced: string[];
}

export function valuationSeries(txs: Transaction[], panel: Panel, mode: PortfolioMode): Valuation {
  const sorted = sortTx(txs);
  const out: Valuation = { dates: [], value: [], contributed: [], cash: [], unpriced: [] };
  if (sorted.length === 0) return out;
  const scale = mode === "paper" ? paperScale(panel) : undefined;
  const start = panel.dates.findIndex((d) => d >= sorted[0].date);
  if (start < 0) return out;
  const unpriced = new Set<string>();
  let s = EMPTY_LEDGER, k = 0;
  for (let i = start; i < panel.dates.length; i++) {
    const d = panel.dates[i];
    while (k < sorted.length && sorted[k].date <= d) { s = applyTx(s, sorted[k], scale ? scale(sorted[k]) : 1); k++; }
    let v = s.cash;
    for (const [t, u] of Object.entries(s.units)) {
      const c = panel.closes[t];
      if (!c) { unpriced.add(t); continue; }
      v += u * c[i];
    }
    out.dates.push(d); out.value.push(v); out.contributed.push(s.netContributed); out.cash.push(s.cash);
  }
  out.unpriced = [...unpriced];
  return out;
}

export interface HoldingRow { ticker: string; units: number; price: number | null; value: number | null; weight: number | null; target: number | null }

export function holdingsTable(txs: Transaction[], panel: Panel, mode: PortfolioMode, targets: Record<string, number> = {}): { rows: HoldingRow[]; cash: number; total: number } {
  const last = panel.dates[panel.dates.length - 1];
  const scale = mode === "paper" ? paperScale(panel) : undefined;
  const recorded = ledgerAt(txs);
  const valued = ledgerAt(txs, undefined, scale);
  const tickers = [...new Set([...Object.keys(recorded.units), ...Object.keys(targets)])].sort();
  const rows: HoldingRow[] = tickers.map((t) => {
    const price = last ? closeOn(panel, t, last) : null;
    const u = valued.units[t] ?? 0;
    return { ticker: t, units: recorded.units[t] ?? 0, price, value: price == null ? null : u * price, weight: null, target: targets[t] ?? null };
  });
  const total = valued.cash + rows.reduce((a, r) => a + (r.value ?? 0), 0);
  for (const r of rows) r.weight = total > 0 && r.value != null ? r.value / total : null;
  return { rows, cash: valued.cash, total };
}

// ---------------------------------------------------------------------------------------------
// Plan targets and paper rebalancing

/** Current ticker weights implied by the plan: each strategy's latest target, scaled by its sleeve weight. */
export function planTargets(runs: { id: string; run: Pick<SimResult, "decisions"> }[], weights: Weights): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { id, run } of runs) {
    const w = weights[id] ?? 0;
    const last = run.decisions[run.decisions.length - 1];
    if (!last || w === 0) continue;
    for (const [t, x] of Object.entries(last.targets)) out[t] = (out[t] ?? 0) + w * x;
  }
  for (const t of Object.keys(out)) if (out[t] < 1e-6) delete out[t];
  return out;
}

/**
 * Paper trades that move holdings toward the plan's targets at the given date's closes.
 * Sells come first; buys are scaled down so cash never goes negative after fees.
 */
export function rebalanceTrades(txs: Transaction[], panel: Panel, targets: Record<string, number>, date: string, feePerTrade = 0, minTrade = 1): TxDraft[] {
  const scale = paperScale(panel);
  const valued = ledgerAt(txs, date, scale);
  const recorded = ledgerAt(txs, date);
  const price = (t: string) => closeOn(panel, t, date);
  const tickers = [...new Set([...Object.keys(valued.units), ...Object.keys(targets)])];
  let total = valued.cash;
  for (const t of tickers) { const p = price(t); if (p) total += (valued.units[t] ?? 0) * p; }
  if (total <= 0) return [];

  const sells: TxDraft[] = [], buys: { t: string; notional: number; p: number }[] = [];
  for (const t of tickers.sort()) {
    const p = price(t);
    if (!p) continue;
    const cur = (valued.units[t] ?? 0) * p;
    const diff = (targets[t] ?? 0) * total - cur;
    if (diff < -minTrade) {
      // sell in recorded units so the ledger never sells more than it holds
      const ratio = Math.min(1, -diff / cur);
      const units = (recorded.units[t] ?? 0) * ratio;
      sells.push({ date, kind: "sell", ticker: t, units, price: p, fee: feePerTrade, note: "Rebalance to plan" });
    } else if (diff > minTrade) buys.push({ t, notional: diff, p });
  }
  let cash = valued.cash + sells.reduce((a, s) => a + s.units! * s.price! - s.fee, 0);
  cash -= feePerTrade * buys.length;
  const want = buys.reduce((a, b) => a + b.notional, 0);
  const f = want > 0 ? Math.min(1, Math.max(0, cash) / want) : 0;
  const buyDrafts: TxDraft[] = buys
    .map((b) => ({ date, kind: "buy" as const, ticker: b.t, units: (b.notional * f) / b.p, price: b.p, fee: feePerTrade, note: "Rebalance to plan" }))
    .filter((b) => b.units * b.price > minTrade);
  return [...sells, ...buyDrafts];
}

// ---------------------------------------------------------------------------------------------
// Immutable projection snapshots (POR-04, POR-07)

export const SNAPSHOT_SCHEMA = 1;

export interface SnapshotBody {
  schema: typeof SNAPSHOT_SCHEMA;
  kind: "original" | "reforecast";
  portfolioId: string;
  parentId: string | null;
  createdAt: string;
  /** Last data date; the projection's month 0. */
  asOf: string;
  engineVersion: string;
  inputs: LabInputs;
  weights: Weights;
  weightsSource: string | null;
  strategies: { id: string; name: string; version: number; hash: string; definition: StrategyDef }[];
  datasetId: string;
  dataWindow: { start: string; end: string };
  targets: Record<string, number>;
  projection: {
    runId: string; method: string; paths: number; seed: number; years: number; months: number;
    quality: ProjectionResult["quality"]; reasons: string[]; assumptions: string[];
    startValue: number; monthly: number;
    fan: NonNullable<ProjectionResult["fan"]>;
    ending: Distribution; probLoss: number | null;
  };
}
export type PlanSnapshot = Readonly<SnapshotBody & { id: string }>;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

/** Content-addressed and frozen: the id is a hash of the body, so any later edit is detectable. */
export function makeSnapshot(body: SnapshotBody): PlanSnapshot {
  const copy = JSON.parse(JSON.stringify(body)) as SnapshotBody;
  return deepFreeze({ ...copy, id: hashId(copy) });
}

export function verifySnapshot(s: PlanSnapshot): boolean {
  const { id, ...body } = s;
  return hashId(body) === id;
}

export function snapshotFrom(a: {
  kind: SnapshotBody["kind"]; portfolioId: string; parentId: string | null; createdAt: string;
  inputs: LabInputs; weights: Weights; weightsSource: string | null;
  backtests: { strategy: { id: string; name: string; version: number; hash: string; definition: StrategyDef }; dataset: { id: string }; window: { start: string; end: string }; run: Pick<SimResult, "decisions"> }[];
  projection: ProjectionResult;
}): PlanSnapshot {
  const p = a.projection;
  if (!p.fan || !p.ending) throw new Error("This projection has no distribution to save: the history was insufficient.");
  const first = a.backtests[0];
  return makeSnapshot({
    schema: SNAPSHOT_SCHEMA, kind: a.kind, portfolioId: a.portfolioId, parentId: a.parentId, createdAt: a.createdAt,
    asOf: first.window.end, engineVersion: ENGINE_VERSION,
    inputs: a.inputs, weights: a.weights, weightsSource: a.weightsSource,
    strategies: a.backtests.map((b) => b.strategy),
    datasetId: first.dataset.id, dataWindow: { start: first.window.start, end: first.window.end },
    targets: planTargets(a.backtests.map((b) => ({ id: b.strategy.id, run: b.run })), a.weights),
    projection: {
      runId: p.runId, method: p.input.method, paths: p.input.paths, seed: p.input.seed, years: p.input.years, months: p.months,
      quality: p.quality, reasons: p.reasons, assumptions: p.assumptions,
      startValue: p.input.initial, monthly: p.input.contribution.frequency === "none" ? 0 : p.input.contribution.amount,
      fan: p.fan, ending: p.ending, probLoss: p.probLoss,
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Replay of the plan on realized data, and comparison against a snapshot (POR-05, POR-06)

export interface Flow { date: string; amount: number }

export const externalFlows = (txs: Transaction[]): Flow[] => sortTx(txs).flatMap((t) =>
  t.kind === "contribution" || t.kind === "transfer_in" ? [{ date: t.date, amount: t.amount }]
    : t.kind === "withdrawal" ? [{ date: t.date, amount: -t.amount }] : []);

/**
 * Value of the plan's sleeve weights applied to realized returns with the portfolio's actual cash
 * flows: what following the plan exactly would have produced. Flows are credited at the close.
 */
export function replayPlan(sleeves: Sleeve[], weights: Weights, flows: Flow[], from: string): { dates: string[]; value: number[] } {
  const dates = sleeves[0]?.dates ?? [];
  const start = indexOnOrBefore(dates, from);
  const out = { dates: [] as string[], value: [] as number[] };
  if (start < 0) return out;
  const fl = [...flows].sort((a, b) => (a.date < b.date ? -1 : 1));
  let v = 0, k = 0;
  for (let i = start; i < dates.length; i++) {
    if (i > start) {
      let r = 0;
      for (const s of sleeves) r += (weights[s.id] ?? 0) * s.returns[i - 1];
      v *= 1 + r;
    }
    while (k < fl.length && fl[k].date <= dates[i]) v += fl[k++].amount;
    out.dates.push(dates[i]); out.value.push(v);
  }
  return out;
}

const DAYS_PER_MONTH = 365.25 / 12;
export const monthsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5 / DAYS_PER_MONTH;

/** Linear interpolation of a monthly series at a fractional month; null beyond the horizon. */
export function atMonth(series: number[], m: number): number | null {
  if (m < 0 || m > series.length - 1) return null;
  const i = Math.floor(m), f = m - i;
  return i + 1 < series.length ? series[i] * (1 - f) + series[i + 1] * f : series[i];
}

export interface PlanAt { p10: number; p50: number; p90: number; contributed: number }
export function planAt(s: PlanSnapshot, date: string): PlanAt | null {
  const m = monthsBetween(s.asOf, date);
  const f = s.projection.fan;
  const p10 = atMonth(f.p10, m), p50 = atMonth(f.p50, m), p90 = atMonth(f.p90, m), c = atMonth(f.contributed, m);
  return p10 == null || p50 == null || p90 == null || c == null ? null : { p10, p50, p90, contributed: c };
}

export interface Attribution {
  date: string;
  monthsElapsed: number;
  observed: number;
  plan: PlanAt;
  band: "below" | "within" | "above";
  actualContributed: number;
  /** Replay of the exact plan with the actual cash flows; null if no replay was possible. */
  planFollowing: number | null;
  contributionDifference: number;
  projectionError: number | null;
  allocationDifference: number | null;
  fx: null;
  total: number;
  notes: string[];
}

/**
 * Splits observed minus planned median into: contribution difference (money in versus plan),
 * projection error (the plan's realized return versus the median path), and allocation or
 * implementation difference (actual holdings versus following the plan exactly). FX is not
 * applicable in a USD-only product. The three parts sum to the total by construction.
 */
export function attribute(s: PlanSnapshot, observed: { date: string; value: number; contributed: number }, planFollowing: number | null): Attribution | null {
  const plan = planAt(s, observed.date);
  if (!plan) return null;
  const notes: string[] = [];
  const contributionDifference = observed.contributed - plan.contributed;
  const total = observed.value - plan.p50;
  let projectionError: number | null = null, allocationDifference: number | null = null;
  if (planFollowing != null) {
    projectionError = (planFollowing - observed.contributed) - (plan.p50 - plan.contributed);
    allocationDifference = observed.value - planFollowing;
  } else notes.push("Plan replay unavailable, so projection error and allocation difference cannot be separated.");
  const m = monthsBetween(s.asOf, observed.date);
  if (m < 3) notes.push("Less than three months have passed; differences mostly reflect timing and short-term noise.");
  notes.push("FX: not applicable. Only USD instruments are supported, so no currency effect is modeled.");
  return {
    date: observed.date, monthsElapsed: m, observed: observed.value, plan,
    band: observed.value < plan.p10 ? "below" : observed.value > plan.p90 ? "above" : "within",
    actualContributed: observed.contributed, planFollowing,
    contributionDifference, projectionError, allocationDifference, fx: null, total, notes,
  };
}

export interface TimelineSeries {
  dates: string[];
  original: { p10: (number | null)[]; p50: (number | null)[]; p90: (number | null)[]; contributed: (number | null)[] };
  latest: { p10: (number | null)[]; p50: (number | null)[]; p90: (number | null)[] } | null;
  observed: (number | null)[];
  contributed: (number | null)[];
}

/**
 * Monthly axis from the original snapshot's start to the later of its horizon and the latest
 * reforecast's horizon. Observations are sampled at the last close on or before each month mark.
 */
export function timeline(original: PlanSnapshot, latest: PlanSnapshot | null, val: Valuation): TimelineSeries {
  const endOf = (s: PlanSnapshot) => addMonths(s.asOf, s.projection.months);
  const end = latest && endOf(latest) > endOf(original) ? endOf(latest) : endOf(original);
  const total = Math.max(1, Math.ceil(monthsBetween(original.asOf, end) - 1e-6));
  const dates = Array.from({ length: total + 1 }, (_, m) => addMonths(original.asOf, m));
  const sample = (s: PlanSnapshot, key: "p10" | "p50" | "p90" | "contributed") =>
    dates.map((d) => (d < s.asOf ? null : atMonth(s.projection.fan[key], monthsBetween(s.asOf, d))));
  const lastVal = val.dates[val.dates.length - 1];
  const observed: (number | null)[] = [], contributed: (number | null)[] = [];
  for (const d of dates) {
    const i = lastVal && d <= lastVal ? indexOnOrBefore(val.dates, d) : -1;
    observed.push(i >= 0 ? val.value[i] : null);
    contributed.push(i >= 0 ? val.contributed[i] : null);
  }
  return {
    dates,
    original: { p10: sample(original, "p10"), p50: sample(original, "p50"), p90: sample(original, "p90"), contributed: sample(original, "contributed") },
    latest: latest && latest.id !== original.id ? { p10: sample(latest, "p10"), p50: sample(latest, "p50"), p90: sample(latest, "p90") } : null,
    observed, contributed,
  };
}

export function ledgerCsv(p: Portfolio): string {
  const rows = ["date,kind,ticker,units,price,amount,fee,note"];
  for (const t of sortTx(p.transactions)) {
    const esc = (s?: string) => (s ? `"${s.replace(/"/g, '""')}"` : "");
    rows.push([t.date, t.kind, t.ticker ?? "", t.units ?? "", t.price ?? "", t.amount.toFixed(2), t.fee.toFixed(2), esc(t.note)].join(","));
  }
  return rows.join("\n");
}
