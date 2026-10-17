/**
 * "What if I had copied them?": turn a House member's reported trades into a dated holdings
 * schedule and backtest it twice, once acting on the day each report became public (what a copier
 * could actually do) and once on the trade date itself (impossible in practice). The gap is the
 * cost of the reporting lag.
 *
 * Holding rule, chosen because PTR amounts are ranges: a purchase adds the stock to the copied
 * portfolio, a full sale removes it, a partial sale keeps it, and the portfolio is held in equal
 * weights. Option trades count as exposure to the underlying stock. Assets without a ticker or
 * without price history are left out and listed.
 */
import { runBacktestOn, type BacktestResult } from "./service";
import type { Dataset } from "./data";
import type { RunConfig } from "./backtest";
import type { PersonaTrade } from "./personas";
import { STRATEGY_SCHEMA, type StrategyDef } from "./strategy";

export type CopyTiming = "filed" | "traded";

export interface CopyEvent { ticker: string; side: "buy" | "sell"; full: boolean; traded: string; filed: string; asset: string }

export const COPY_SAFE = "SHY";
export const COPY_BENCHMARK = "SPY";

const nextDay = (d: string) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10);

/**
 * The first day a follower could act on, at its close: an SEC filing accepted before 20:00 UTC (the US
 * close) that day, a later one the next day; a report known only by its filing date, that date.
 */
export const actDay = (t: PersonaTrade): string | null => (t.accepted ? (Number(t.accepted.slice(11, 13)) < 20 ? t.accepted.slice(0, 10) : nextDay(t.accepted.slice(0, 10))) : t.filed);

/** Purchases and sales with a ticker and both dates; exchanges and untickered assets are skipped and listed. */
export function copyEvents(trades: PersonaTrade[]): { events: CopyEvent[]; skipped: string[] } {
  const events: CopyEvent[] = [], skipped: string[] = [];
  for (const t of trades) {
    if (t.side !== "buy" && t.side !== "sell") continue;
    const filed = actDay(t);
    if (!t.symbol || !t.date || !filed) { skipped.push(t.asset); continue; }
    events.push({ ticker: t.symbol, side: t.side, full: t.side === "sell" && !/partial/i.test(t.action), traded: t.date, filed, asset: t.asset });
  }
  events.sort((a, b) => a.filed.localeCompare(b.filed) || a.traded.localeCompare(b.traded));
  return { events, skipped: [...new Set(skipped)] };
}

/** Equal-weight holdings after each date on which something changed, acting on `timing`'s date. */
export function copySteps(events: CopyEvent[], timing: CopyTiming, priced: Set<string>): StrategyDef["allocation"] & { type: "schedule" } {
  const when = (e: CopyEvent) => (timing === "filed" ? e.filed : e.traded);
  const ordered = events.filter((e) => priced.has(e.ticker)).sort((a, b) => when(a).localeCompare(when(b)));
  const held = new Set<string>();
  const steps: { date: string; weights: Record<string, number>; note: string }[] = [];
  for (let i = 0; i < ordered.length;) {
    const date = when(ordered[i]);
    const notes: string[] = [];
    for (; i < ordered.length && when(ordered[i]) === date; i++) {
      const e = ordered[i];
      if (e.side === "buy") { held.add(e.ticker); notes.push(`bought ${e.ticker}`); }
      else if (e.full) { held.delete(e.ticker); notes.push(`sold all ${e.ticker}`); }
      else notes.push(`partly sold ${e.ticker} (kept)`);
    }
    const list = [...held].sort();
    const weights = Object.fromEntries(list.map((t) => [t, 1 / list.length]));
    const label = timing === "filed" ? "Report filed" : "Traded";
    steps.push({ date, weights, note: `${label} ${date}: ${notes.join(", ")}; holding ${list.length ? list.join(", ") + " in equal weights" : COPY_SAFE}` });
  }
  return { type: "schedule", safe: COPY_SAFE, steps };
}

export function copyTradeDef(personaId: string, personaName: string, allocation: StrategyDef["allocation"], timing: CopyTiming, kind: "events" | "fund" = "events"): StrategyDef {
  return {
    schema: STRATEGY_SCHEMA, id: `copy_${personaId}_${timing}`.replace(/[^a-z0-9_]/g, "_").slice(0, 60), version: 1,
    name: kind === "fund"
      ? (timing === "filed" ? `Copy ${personaName}: hold each 13F from its filing deadline` : `Copy ${personaName}: hold each 13F from quarter end (hypothetical)`)
      : (timing === "filed" ? `Copy ${personaName}: act when each report is filed` : `Copy ${personaName}: act on the trade date (hypothetical)`),
    summary: kind === "fund" ? "The fund's largest reported holdings by value, changing when each quarterly report becomes public." : "Equal weights in the stocks the persona bought and has not fully sold, changing on each report.",
    intendedUse: "Research on following disclosed trades; not a recommendation.",
    tags: ["persona", "copy-trade"], region: "US", holdingPeriod: "Months", riskLevel: "Higher",
    universe: [COPY_BENCHMARK, COPY_SAFE], benchmark: COPY_BENCHMARK, allocation,
    rebalance: { schedule: "daily" },
    methodology: "Signals use the date each report became public (or the trade date, for the hypothetical version); orders fill at the next close like every StockHub backtest.",
    caveats: kind === "fund" ? [
      "13F shows only US long stock holdings at quarter end; trades inside the quarter, shorts, cash and most foreign holdings are invisible.",
      "The copy holds the largest holdings by value up to 25 names, renormalised, so its weights differ from the fund's.",
      "Each quarter is acted on at its 45-day filing deadline, the latest a fund may file; many file earlier.",
    ] : [
      "Report amounts are ranges, so the copy uses equal weights rather than the persona's real sizes.",
      "Option trades are copied as stock exposure; the persona's options can move far more than the stock.",
      "Only reports from this year and last are read, so earlier holdings are unknown.",
    ],
    evidence: "Backtested", experimental: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Fund managers: copy the quarterly 13F portfolio

export const FUND_TOP_N = 25;
export const FILING_DEADLINE_DAYS = 45;

export interface FundQuarter { period: string; holdings: { cusip: string; issuer: string; value: number }[] }

/**
 * A schedule holding each quarter's largest priced holdings by value (CUSIPs mapped to tickers,
 * share classes of one ticker added, top `topN`, renormalised). "filed" acts at the 45-day filing
 * deadline after the quarter end; "traded" at the quarter end itself, which no copier could do.
 */
export function fundSteps(quarters: FundQuarter[], tickerOf: Record<string, string | null>, priced: Set<string>, timing: CopyTiming, topN = FUND_TOP_N) {
  const steps: { date: string; weights: Record<string, number>; note: string }[] = [];
  const coverage: number[] = [];
  const unmapped = new Set<string>();
  for (const q of [...quarters].sort((a, b) => a.period.localeCompare(b.period))) {
    const total = q.holdings.reduce((s, h) => s + Math.max(0, h.value), 0);
    const byTicker = new Map<string, number>();
    for (const h of q.holdings) {
      const t = tickerOf[h.cusip];
      if (!t) { unmapped.add(h.issuer); continue; }
      if (!priced.has(t)) continue;
      byTicker.set(t, (byTicker.get(t) ?? 0) + Math.max(0, h.value));
    }
    const top = [...byTicker.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
    const sum = top.reduce((s, [, v]) => s + v, 0);
    if (sum <= 0) continue;
    coverage.push(total > 0 ? sum / total : 0);
    const date = timing === "filed" ? new Date(Date.parse(q.period) + FILING_DEADLINE_DAYS * 864e5).toISOString().slice(0, 10) : q.period;
    steps.push({ date, weights: Object.fromEntries(top.map(([t, v]) => [t, v / sum])), note: `13F for the quarter to ${q.period}: ${top.length} holdings, ${Math.round((total > 0 ? sum / total : 0) * 100)}% of its reported value` });
  }
  const clean = steps.filter((s, i) => i === 0 || s.date > steps[i - 1].date);
  return { allocation: { type: "schedule" as const, safe: COPY_SAFE, steps: clean }, coverage, unmapped: [...unmapped] };
}

export interface CopyTradeResult {
  filed: BacktestResult;
  traded: BacktestResult;
  /** Final value of acting on the trade date minus acting on the filing date. */
  lagCost: number;
  /** Median days between a trade and its report. */
  medianLagDays: number | null;
  tickers: string[];
  /** Tickers with no usable price history. */
  unpriced: string[];
  skipped: string[];
  events: number;
  kind: "events" | "fund";
  /** Funds: the average share of the reported 13F value the copy held. */
  coverage?: number;
}

/** Fund copy: both timings over the same window, from the first quarter end, on a dataset holding the tickers plus SPY and SHY. */
export function runFundCopy(personaId: string, personaName: string, quarters: FundQuarter[], tickerOf: Record<string, string | null>, ds: Dataset, cfg: Partial<RunConfig>): CopyTradeResult | null {
  const tickers = [...new Set(Object.values(tickerOf).filter((t): t is string => !!t))].sort();
  const priced = new Set(tickers.filter((t) => (ds.panel.closes[t]?.length ?? 0) > 0));
  const filed = fundSteps(quarters, tickerOf, priced, "filed"), traded = fundSteps(quarters, tickerOf, priced, "traded");
  if (!filed.allocation.steps.length) return null;
  const start = traded.allocation.steps[0].date;
  const run = (alloc: typeof filed.allocation, timing: CopyTiming) => runBacktestOn(ds, copyTradeDef(personaId, personaName, alloc, timing, "fund"), { ...cfg, start });
  const f = run(filed.allocation, "filed"), t = run(traded.allocation, "traded");
  const used = new Set(filed.allocation.steps.flatMap((s) => Object.keys(s.weights)));
  // only holdings that would have made a quarter's top list count as left out; smaller ones were never needed
  const wanted = new Set(fundSteps(quarters, tickerOf, new Set(tickers), "traded").allocation.steps.flatMap((s) => Object.keys(s.weights)));
  return {
    filed: f, traded: t, lagCost: t.run.finalValue - f.run.finalValue, medianLagDays: FILING_DEADLINE_DAYS,
    tickers: [...used].sort(), unpriced: [...wanted].filter((x) => !priced.has(x)).sort(),
    skipped: filed.unmapped, events: quarters.length, kind: "fund",
    coverage: filed.coverage.length ? filed.coverage.reduce((a, b) => a + b, 0) / filed.coverage.length : 0,
  };
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/**
 * Run both versions over the same window (from the first trade date) on a dataset that holds the
 * persona's tickers plus SPY and SHY. Returns null when no ticker could be priced.
 */
export function runCopyTrade(personaId: string, personaName: string, trades: PersonaTrade[], ds: Dataset, cfg: Partial<RunConfig>): CopyTradeResult | null {
  const { events, skipped } = copyEvents(trades);
  const tickers = [...new Set(events.map((e) => e.ticker))].sort();
  const priced = new Set(tickers.filter((t) => (ds.panel.closes[t]?.length ?? 0) > 0));
  if (priced.size === 0 || !events.some((e) => e.side === "buy" && priced.has(e.ticker))) return null;
  const start = events.filter((e) => priced.has(e.ticker)).map((e) => e.traded).sort()[0];
  const run = (timing: CopyTiming) => {
    const def = copyTradeDef(personaId, personaName, copySteps(events, timing, priced), timing);
    // only the tickers this run needs, so an unpriced stock does not block it
    return runBacktestOn(ds, def, { ...cfg, start });
  };
  const filed = run("filed"), traded = run("traded");
  const lags = events.map((e) => days(e.traded, e.filed)).sort((a, b) => a - b);
  return {
    filed, traded, lagCost: traded.run.finalValue - filed.run.finalValue,
    medianLagDays: lags.length ? lags[Math.floor(lags.length / 2)] : null,
    tickers: [...priced], unpriced: tickers.filter((t) => !priced.has(t)), skipped, events: events.length, kind: "events",
  };
}
