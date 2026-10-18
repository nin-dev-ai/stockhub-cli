/**
 * Plain facts for a strategy card and its detail: the trade-off against its benchmark, how far it
 * fell in named crises, and what it holds today. Pure functions over a finished backtest.
 * See docs/PRD_phase6.md (S-1, S-2).
 */
import { currentTargets, type SimResult } from "./backtest";
import type { BacktestResult } from "./service";
import type { Schedule, StrategyDef } from "./strategy";

const pct = (x: number) => `${x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(0)}%`;
const pts = (x: number) => `${Math.abs(x * 100).toFixed(1)} point${Math.abs(x * 100).toFixed(1) === "1.0" ? "" : "s"}`;

/** A buy-and-hold of the benchmark itself: the yardstick every other card is compared with. */
export function isYardstick(def: StrategyDef): boolean {
  const a = def.allocation;
  // contribution-timing strategies (DCA, a drawdown reserve) also hold only the benchmark but change when money goes in
  return !def.spread && !def.entry && !def.reserve && a.type === "static" && Object.keys(a.weights).length === 1 && (a.weights[def.benchmark] ?? 0) >= 0.999;
}

/**
 * One sentence on what the strategy gave up or gained against its benchmark, in yearly growth and
 * worst fall. Falls within 1 point and growth within 0.1 point count as the same.
 */
export function tradeOff(def: StrategyDef, r: Pick<BacktestResult, "run" | "benchmark" | "excess">): string | null {
  if (isYardstick(def)) return `The yardstick: every strategy is compared with buying and holding ${def.benchmark}.`;
  const gap = r.excess.cagr, dd = r.run.metrics.maxDrawdown, bdd = r.benchmark.run.metrics.maxDrawdown;
  if (gap == null || dd == null || bdd == null) return null;
  const b = r.benchmark.ticker;
  const shallower = dd > bdd + 0.01, deeper = dd < bdd - 0.01;
  const falls = `${pct(dd)} against ${pct(bdd)}`;
  if (Math.abs(gap) < 0.001) {
    return shallower ? `Grew about as fast as ${b} with a shallower worst fall (${falls}).` : deeper ? `Grew about as fast as ${b} but fell further (${falls}).` : `Grew and fell about like ${b}.`;
  }
  if (gap < 0) {
    if (shallower) return `Gives up ${pts(gap)} a year against ${b} to cut its worst fall from ${pct(bdd)} to ${pct(dd)}.`;
    return `Trailed ${b} by ${pts(gap)} a year and fell ${deeper ? "further" : "as far"} (${falls}).`;
  }
  if (deeper) return `Beat ${b} by ${pts(gap)} a year but fell further (${falls}).`;
  return `Beat ${b} by ${pts(gap)} a year with ${shallower ? "a shallower" : "about the same"} worst fall (${falls}).`;
}

/** Named market crises, from the S&P 500's peak to its trough. */
export const CRISES = [
  { id: "gfc", label: "2008 financial crisis", start: "2007-10-09", end: "2009-03-09" },
  { id: "covid", label: "March 2020 crash", start: "2020-02-19", end: "2020-03-23" },
  { id: "rates", label: "2022 rate rises", start: "2022-01-03", end: "2022-10-12" },
] as const;

export interface CrisisFall { id: string; label: string; start: string; end: string; fall: number | null }

/**
 * The worst peak-to-trough fall inside each crisis window, time-weighted (contributions excluded).
 * Null when the backtest does not cover the whole window.
 */
export function crisisFalls(run: Pick<SimResult, "dates" | "returns">): CrisisFall[] {
  return CRISES.map((c) => {
    const i0 = run.dates.findIndex((d) => d >= c.start);
    let i1 = -1;
    for (let i = run.dates.length - 1; i >= 0; i--) if (run.dates[i] <= c.end) { i1 = i; break; }
    if (i0 < 0 || i1 <= i0 || run.dates[0] > c.start) return { ...c, fall: null };
    let g = 1, peak = 1, worst = 0;
    for (let i = i0 + 1; i <= i1; i++) {
      g *= 1 + run.returns[i - 1];
      peak = Math.max(peak, g);
      worst = Math.min(worst, g / peak - 1);
    }
    return { ...c, fall: worst };
  });
}

export interface HoldingToday {
  /** Current targets, largest first; cash left out. */
  holds: { ticker: string; weight: number }[];
  /** The decision date from which the targets have been what they are now. */
  since: string | null;
  /** What it held just before, when the targets have changed at least once. */
  before: { ticker: string; weight: number }[] | null;
  /** The first trading-calendar day of the next scheduled check after `asOf`, or a phrase for daily rules. */
  nextCheck: string | null;
  /** The targets never changed in the backtest (a fixed mix). */
  fixed: boolean;
}

const sorted = (t: Record<string, number>) =>
  Object.entries(t).filter(([k, w]) => k !== "CASH" && w > 0.005).map(([ticker, weight]) => ({ ticker, weight })).sort((a, b) => b.weight - a.weight);
// two target sets are the same holding when every weight agrees to within 2 points
const same = (a: Record<string, number>, b: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.02);

const weekday = (t: number) => { let d = new Date(t); while (d.getUTCDay() % 6 === 0) d = new Date(d.getTime() + 864e5); return d.toISOString().slice(0, 10); };

/** The first weekday of the next month, quarter or year after `asOf`; weekly rules check the next Monday. */
export function nextCheckDate(schedule: Schedule, asOf: string): string | null {
  const d = new Date(`${asOf}T00:00:00Z`);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  switch (schedule) {
    case "monthly": return weekday(Date.UTC(y, m + 1, 1));
    case "quarterly": return weekday(Date.UTC(y, Math.floor(m / 3) * 3 + 3, 1));
    case "annual": return weekday(Date.UTC(y + 1, 0, 1));
    case "weekly": return weekday(d.getTime() + ((8 - d.getUTCDay()) % 7 || 7) * 864e5);
    default: return null;
  }
}

/** What the strategy holds at the end of its backtest, since when, and when its rules next look again. */
export function holdingToday(def: StrategyDef, r: Pick<BacktestResult, "run" | "window">): HoldingToday {
  const now = currentTargets(r.run);
  const rebalances = r.run.decisions.filter((d) => d.kind === "rebalance");
  let since: string | null = null, before: Record<string, number> | null = null;
  // spread strategies keep per-sleeve decisions, so only single-sleeve runs date their switches
  if (!r.run.sleeves?.length) {
    for (let i = rebalances.length - 1; i >= 0; i--) {
      if (!same(rebalances[i].targets, now)) { before = rebalances[i].targets; break; }
      since = rebalances[i].date;
    }
  }
  const sched = def.rebalance.schedule;
  return {
    holds: sorted(now), since, before: before ? sorted(before) : null,
    nextCheck: sched === "daily" ? "every trading day" : sched === "none" ? null : nextCheckDate(sched, r.window.end),
    fixed: !r.run.sleeves?.length && before == null && def.allocation.type === "static",
  };
}

/** "SPY 60%, AGG 40%"; one holding reads as just its ticker. */
export const holdingText = (h: { ticker: string; weight: number }[]) =>
  h.length === 0 ? "cash" : h.length === 1 && h[0].weight > 0.98 ? h[0].ticker : h.map((x) => `${x.ticker} ${Math.round(x.weight * 100)}%`).join(", ");

/** One line for a card: "In SPY since 2026-05-12 · before that SHY · next check 2026-11-02". */
export function todayLine(h: HoldingToday): string {
  const parts = [h.fixed ? `Holds ${holdingText(h.holds)} (fixed mix)` : h.since ? `In ${holdingText(h.holds)} since ${h.since}` : `Holds ${holdingText(h.holds)}`];
  if (h.before) parts.push(`before that ${holdingText(h.before)}`);
  if (h.nextCheck) parts.push(h.nextCheck === "every trading day" ? "checks every trading day" : `next check ${h.nextCheck}`);
  return parts.join(" · ");
}
