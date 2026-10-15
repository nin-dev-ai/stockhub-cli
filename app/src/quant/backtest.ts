import { drawdownSeries, rollingVol, rsi, sma, trailingReturn } from "./indicators";
import { computeMetrics, yearsBetween } from "./metrics";
import type { Allocation, Schedule, StrategyDef } from "./strategy";
import type { Metrics, Panel, QualityFlag } from "./types";

export type ContributionFrequency = "none" | "weekly" | "monthly" | "quarterly";

export interface RunConfig {
  initial: number;
  contribution: { amount: number; frequency: ContributionFrequency };
  costs: { commissionBps: number; slippageBps: number; fixedFee: number };
  riskFreeRate: number;
  fractional: boolean;
  start?: string;
  end?: string;
}

export const DEFAULT_CONFIG: RunConfig = {
  initial: 10_000,
  contribution: { amount: 0, frequency: "none" },
  costs: { commissionBps: 0, slippageBps: 2, fixedFee: 0 },
  riskFreeRate: 0,
  fractional: true,
};

export interface Trade {
  decisionDate: string;
  date: string;               // fill date
  ticker: string;
  side: "buy" | "sell";
  shares: number;
  price: number;              // fill price after slippage
  notional: number;
  cost: number;               // commission + fixed fee + slippage
  reason: string;
}

export interface DecisionRecord { date: string; reason: string; targets: Record<string, number>; kind: "rebalance" | "invest_cash" }

export interface SimResult {
  dates: string[];
  equity: number[];
  invested: number[];                // cumulative money put in (initial + contributions)
  returns: number[];                 // time-weighted daily returns for dates[1..]
  metrics: Metrics;
  trades: Trade[];
  decisions: DecisionRecord[];
  tradeCount: number;
  turnover: number | null;           // annualized traded notional / average equity
  costsPaid: number;
  avgExposure: Record<string, number>;   // average weight by ticker, plus "CASH"
  finalValue: number;
  totalContributed: number;
  gain: number;
  moneyWeightedReturn: number | null;
  flags: QualityFlag[];
}

const EPS = 1e-9;

/** Period id for a date; a change between consecutive trading days marks a period boundary. */
export function periodKey(date: string, schedule: Schedule | ContributionFrequency): string {
  switch (schedule) {
    case "weekly": return String(Math.floor((Date.parse(date) / 864e5 + 3) / 7));
    case "monthly": return date.slice(0, 7);
    case "quarterly": return `${date.slice(0, 4)}Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3)}`;
    case "annual": return date.slice(0, 4);
    default: return "";
  }
}

type Weights = Record<string, number>;
interface Signal { weights: Weights; reason: string }

/** Builds the per-day signal function. Entry i of every indicator uses data through i only. */
function makeSignal(a: Allocation, panel: Panel): (t: number) => Signal {
  const c = panel.closes;
  const safeAll = (safe: string, reason: string): Signal => ({ weights: { [safe]: 1 }, reason });
  switch (a.type) {
    case "static":
      return () => ({ weights: a.weights, reason: "Target weights" });
    case "trend": {
      const avg = sma(c[a.risky], a.smaDays);
      let riskOn = false;
      return (t) => {
        const px = c[a.risky][t], m = avg[t];
        if (Number.isNaN(m)) return safeAll(a.safe, `Warm-up: ${a.smaDays}-day average not yet available, holding ${a.safe}`);
        if (px > m * (1 + a.bandPct)) riskOn = true;
        else if (px < m * (1 - a.bandPct)) riskOn = false;
        const diff = `${((px / m - 1) * 100).toFixed(1)}%`;
        const desc = `${a.risky} ${px.toFixed(2)} vs ${a.smaDays}d average ${m.toFixed(2)} (${diff})`;
        return riskOn
          ? { weights: { [a.risky]: 1 }, reason: `${desc}: risk-on, hold ${a.risky}` }
          : { weights: { [a.safe]: 1 }, reason: `${desc}: risk-off, hold ${a.safe}` };
      };
    }
    case "momentum": {
      const rets = Object.fromEntries(a.universe.map((u) => [u, trailingReturn(c[u], a.lookbackDays)]));
      return (t) => {
        const ranked = a.universe
          .map((u) => ({ u, r: rets[u][t] }))
          .filter((x) => Number.isFinite(x.r))
          .sort((x, y) => y.r - x.r || (x.u < y.u ? -1 : 1))
          .slice(0, a.topN);
        if (ranked.length === 0) return safeAll(a.safe, `Warm-up: ${a.lookbackDays}-day returns not yet available, holding ${a.safe}`);
        const w: Weights = {};
        const slot = 1 / a.topN;
        const notes: string[] = [];
        for (const { u, r } of ranked) {
          const key = a.absoluteFilter && r < 0 ? a.safe : u;
          w[key] = (w[key] ?? 0) + slot;
          notes.push(`${u} ${(r * 100).toFixed(1)}%${key !== u ? "→" + a.safe : ""}`);
        }
        const used = Object.values(w).reduce((x, y) => x + y, 0);
        if (used < 1 - EPS) w[a.safe] = (w[a.safe] ?? 0) + (1 - used);
        return { weights: w, reason: `Top ${a.topN} by ${a.lookbackDays}d return: ${notes.join(", ")}` };
      };
    }
    case "vol_target": {
      const vol = rollingVol(c[a.risky], a.lookbackDays);
      return (t) => {
        const v = vol[t];
        if (Number.isNaN(v) || v <= 0) return safeAll(a.safe, `Warm-up: volatility not yet available, holding ${a.safe}`);
        const wr = Math.min(1, a.targetVol / v);
        const w: Weights = { [a.risky]: wr };
        if (wr < 1) w[a.safe] = 1 - wr;
        return { weights: w, reason: `${a.risky} realized vol ${(v * 100).toFixed(1)}% vs target ${(a.targetVol * 100).toFixed(0)}%: risky weight ${(wr * 100).toFixed(0)}%` };
      };
    }
    case "seasonal":
      return (t) => {
        const m = Number(panel.dates[t].slice(5, 7));
        return a.riskyMonths.includes(m)
          ? { weights: { [a.risky]: 1 }, reason: `Month ${m} is a risk-on month: hold ${a.risky}` }
          : { weights: { [a.safe]: 1 }, reason: `Month ${m} is a risk-off month: hold ${a.safe}` };
      };
    case "tsmom": {
      const r = trailingReturn(c[a.risky], a.lookbackDays);
      return (t) => {
        if (Number.isNaN(r[t])) return safeAll(a.safe, `Warm-up: ${a.lookbackDays}-day return not yet available, holding ${a.safe}`);
        const txt = `${a.risky} ${a.lookbackDays}d return ${(r[t] * 100).toFixed(1)}%`;
        return r[t] > 0
          ? { weights: { [a.risky]: 1 }, reason: `${txt} is positive: hold ${a.risky}` }
          : { weights: { [a.safe]: 1 }, reason: `${txt} is not positive: hold ${a.safe}` };
      };
    }
    case "risk_parity": {
      const vols = Object.fromEntries(a.assets.map((u) => [u, rollingVol(c[u], a.lookbackDays)]));
      const equal = Object.fromEntries(a.assets.map((u) => [u, 1 / a.assets.length]));
      return (t) => {
        const inv = a.assets.map((u) => ({ u, v: vols[u][t] }));
        if (inv.some((x) => !(x.v > 0))) return { weights: equal, reason: `Warm-up: ${a.lookbackDays}-day volatility not yet available, equal weights` };
        const total = inv.reduce((s, x) => s + 1 / x.v, 0);
        const w: Weights = Object.fromEntries(inv.map((x) => [x.u, 1 / x.v / total]));
        return { weights: w, reason: `Inverse ${a.lookbackDays}d volatility: ${inv.map((x) => `${x.u} vol ${(x.v * 100).toFixed(1)}%→${(w[x.u] * 100).toFixed(0)}%`).join(", ")}` };
      };
    }
    case "multi_trend": {
      const avgs = Object.fromEntries(a.assets.map((u) => [u, sma(c[u], a.smaDays)]));
      const slot = 1 / a.assets.length;
      return (t) => {
        const w: Weights = {};
        const notes: string[] = [];
        for (const u of a.assets) {
          const m = avgs[u][t], on = Number.isFinite(m) && c[u][t] > m;
          const key = on ? u : a.safe;
          w[key] = (w[key] ?? 0) + slot;
          notes.push(Number.isFinite(m) ? `${u} ${on ? "above" : "below"}${on ? "" : `→${a.safe}`}` : `${u} warm-up→${a.safe}`);
        }
        return { weights: w, reason: `${a.smaDays}d average: ${notes.join(", ")}` };
      };
    }
    case "crossover": {
      const fast = sma(c[a.risky], a.fastDays), slow = sma(c[a.risky], a.slowDays);
      return (t) => {
        const f = fast[t], s = slow[t];
        if (Number.isNaN(s)) return safeAll(a.safe, `Warm-up: ${a.slowDays}-day average not yet available, holding ${a.safe}`);
        const desc = `${a.risky} ${a.fastDays}d avg ${f.toFixed(2)} vs ${a.slowDays}d avg ${s.toFixed(2)}`;
        return f > s
          ? { weights: { [a.risky]: 1 }, reason: `${desc}: fast above slow, hold ${a.risky}` }
          : { weights: { [a.safe]: 1 }, reason: `${desc}: fast not above slow, hold ${a.safe}` };
      };
    }
    case "mean_reversion": {
      const r = rsi(c[a.risky], a.rsiDays);
      const trend = a.trendDays > 0 ? sma(c[a.risky], a.trendDays) : null;
      let inPos = false;
      return (t) => {
        const v = r[t];
        if (Number.isNaN(v) || (trend && Number.isNaN(trend[t]))) return safeAll(a.safe, `Warm-up: indicators not yet available, holding ${a.safe}`);
        const above = !trend || c[a.risky][t] > trend[t];
        const desc = `${a.risky} RSI(${a.rsiDays}) ${v.toFixed(1)}${trend ? `, ${above ? "above" : "below"} ${a.trendDays}d average` : ""}`;
        if (!inPos && v < a.entryRsi && above) inPos = true;
        else if (inPos && v > a.exitRsi) inPos = false;
        return inPos
          ? { weights: { [a.risky]: 1 }, reason: `${desc}: pullback position, hold ${a.risky}` }
          : { weights: { [a.safe]: 1 }, reason: `${desc}: no pullback signal, hold ${a.safe}` };
      };
    }
  }
}

interface Pending {
  weights: Weights;
  full: boolean;
  releaseDca: number;
  releaseReserve: number;
  reason: string;
  decisionDate: string;
}

const maxAbsDiff = (a: Weights, b: Weights) => {
  let m = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) m = Math.max(m, Math.abs((a[k] ?? 0) - (b[k] ?? 0)));
  return m;
};

/**
 * Deterministic daily simulation.
 *  - Decisions at the close of day t use data through t only.
 *  - Orders fill at the close of day t+1 with slippage; costs are deducted from cash.
 *  - Contributions are credited at the close of the scheduled day and invested like any other cash.
 */
export function simulate(def: StrategyDef, panel: Panel, cfg: RunConfig): SimResult {
  const n = panel.dates.length;
  const dates = panel.dates;
  const flags: QualityFlag[] = [];
  const empty = (msg: string): SimResult => ({
    dates: [], equity: [], invested: [], returns: [], metrics: computeMetrics([], [dates[0] ?? ""]), trades: [], decisions: [],
    tradeCount: 0, turnover: null, costsPaid: 0, avgExposure: {}, finalValue: 0, totalContributed: 0, gain: 0,
    moneyWeightedReturn: null, flags: [{ code: "no_run", severity: "error", message: msg }],
  });
  if (n < 2) return empty("Not enough dates to run a backtest.");
  if (cfg.initial <= 0 && cfg.contribution.amount <= 0) return empty("Initial capital or a contribution must be positive.");

  const signal = makeSignal(def.allocation, panel);
  const px = (tk: string, t: number) => panel.closes[tk][t];
  const slip = cfg.costs.slippageBps / 1e4, comm = cfg.costs.commissionBps / 1e4, fixed = cfg.costs.fixedFee;
  const reserveDD = def.reserve ? drawdownSeries(panel.closes[def.reserve.riskyTicker]) : [];
  const deployN = def.entry?.deployMonths ?? 0;

  const shares: Record<string, number> = {};
  let cash = 0, lockedDca = 0, lockedReserve = 0, dcaReleased = 0;
  let lastTargets: Weights | null = null;
  let pending: Pending | null = null;

  const equity: number[] = [], invested: number[] = [], returns: number[] = [];
  const trades: Trade[] = [], decisions: DecisionRecord[] = [];
  const flows: { t: number; amount: number }[] = [];
  let costsPaid = 0, tradedNotional = 0, contributed = 0;
  const exposureSum: Record<string, number> = {};

  const tickers = Object.keys(panel.closes);
  const posValue = (t: number) => tickers.reduce((s, k) => s + (shares[k] ?? 0) * px(k, t), 0);
  const currentWeights = (t: number): Weights => {
    const inv = posValue(t) + cash - lockedDca - lockedReserve;
    if (inv <= EPS) return {};
    const w: Weights = {};
    for (const k of tickers) if ((shares[k] ?? 0) > 0) w[k] = ((shares[k] ?? 0) * px(k, t)) / inv;
    return w;
  };

  function execute(p: Pending, t: number) {
    lockedDca -= Math.min(lockedDca, p.releaseDca);
    lockedReserve -= Math.min(lockedReserve, p.releaseReserve);
    const locked = lockedDca + lockedReserve;
    const vPre = posValue(t) + cash;
    const investable = Math.max(0, vPre - locked);
    const cur: Record<string, number> = {};
    for (const k of tickers) cur[k] = (shares[k] ?? 0) * px(k, t);

    const desired: Record<string, number> = {};
    if (p.full) {
      for (const k of tickers) desired[k] = (p.weights[k] ?? 0) * investable;
    } else {
      const avail = Math.max(0, cash - locked);
      const short: Record<string, number> = {};
      let totalShort = 0;
      for (const k of tickers) {
        short[k] = Math.max(0, (p.weights[k] ?? 0) * investable - cur[k]);
        totalShort += short[k];
      }
      // fill shortfalls first (pro-rata if cash is short), then spread any excess by target weight
      const fillRatio = totalShort > EPS ? Math.min(1, avail / totalShort) : 0;
      const excess = Math.max(0, avail - totalShort);
      for (const k of tickers) {
        desired[k] = cur[k] + short[k] * fillRatio + (p.weights[k] ?? 0) * excess;
      }
    }

    // sells first
    for (const k of tickers) {
      const diff = desired[k] - cur[k];
      if (diff < -0.01) {
        let sh = Math.min(shares[k] ?? 0, -diff / px(k, t));
        if (!cfg.fractional) sh = Math.floor(sh);
        if (sh <= 0) continue;
        const gross = sh * px(k, t);
        const fill = px(k, t) * (1 - slip);
        const proceeds = sh * fill;
        const fee = comm * proceeds + fixed;
        const cost = gross - proceeds + fee;
        shares[k] = (shares[k] ?? 0) - sh;
        cash += proceeds - fee;
        costsPaid += cost; tradedNotional += gross;
        trades.push({ decisionDate: p.decisionDate, date: dates[t], ticker: k, side: "sell", shares: sh, price: fill, notional: gross, cost, reason: p.reason });
      }
    }
    // buys, scaled to the cash that is not locked
    const buyList = tickers.map((k) => ({ k, amt: desired[k] - cur[k] })).filter((b) => b.amt > 0.01);
    const totalBuy = buyList.reduce((s, b) => s + b.amt, 0);
    if (totalBuy > 0) {
      const avail = Math.max(0, cash - lockedDca - lockedReserve);
      const scale = Math.max(0, Math.min(1, (avail - fixed * buyList.length) / (totalBuy * (1 + comm))));
      for (const b of buyList) {
        const spend = b.amt * scale;
        const fill = px(b.k, t) * (1 + slip);
        let sh = spend / fill;
        if (!cfg.fractional) sh = Math.floor(sh);
        if (sh <= 0) continue;
        const paid = sh * fill;
        const fee = comm * paid + fixed;
        const cost = sh * (fill - px(b.k, t)) + fee;
        shares[b.k] = (shares[b.k] ?? 0) + sh;
        cash -= paid + fee;
        costsPaid += cost; tradedNotional += sh * px(b.k, t);
        trades.push({ decisionDate: p.decisionDate, date: dates[t], ticker: b.k, side: "buy", shares: sh, price: fill, notional: sh * px(b.k, t), cost, reason: p.reason });
      }
    }
  }

  function decide(t: number): Pending | null {
    const date = dates[t];
    const notes: string[] = [];
    let releaseDca = 0, releaseReserve = 0;

    if (deployN > 0 && dcaReleased < deployN && (t === 0 || periodKey(date, "monthly") !== periodKey(dates[t - 1], "monthly"))) {
      releaseDca = cfg.initial / deployN;
      dcaReleased++;
      notes.push(`release DCA tranche ${dcaReleased}/${deployN}`);
    }
    if (def.reserve && lockedReserve > EPS && reserveDD[t] <= def.reserve.releaseDrawdown) {
      releaseReserve = lockedReserve;
      notes.push(`${def.reserve.riskyTicker} drawdown ${(reserveDD[t] * 100).toFixed(1)}% is beyond ${(def.reserve.releaseDrawdown * 100).toFixed(0)}%: release reserve`);
    }

    const sig = signal(t);
    const { schedule, thresholdPct, minTradeWeight = 0 } = def.rebalance;
    const boundary = t > 0 && periodKey(date, schedule) !== periodKey(dates[t - 1], schedule);
    let full = false;
    let why = "";
    if (t === 0) { full = true; why = `Initial allocation: ${sig.reason}`; }
    else if (thresholdPct !== undefined) {
      const drift = maxAbsDiff(currentWeights(t), lastTargets ?? {});
      if (drift > thresholdPct) { full = true; why = `Drift ${(drift * 100).toFixed(1)}% exceeds ${(thresholdPct * 100).toFixed(0)}% threshold`; }
    } else if (schedule === "daily") {
      if (lastTargets && maxAbsDiff(sig.weights, lastTargets) > Math.max(minTradeWeight, EPS)) { full = true; why = sig.reason; }
    } else if (schedule !== "none" && boundary) {
      if (minTradeWeight <= 0 || !lastTargets || maxAbsDiff(sig.weights, currentWeights(t)) > minTradeWeight) { full = true; why = `${schedule[0].toUpperCase()}${schedule.slice(1)} rebalance: ${sig.reason}`; }
    }

    if (full) {
      lastTargets = sig.weights;
      const reason = [why, ...notes].join("; ");
      decisions.push({ date, reason, targets: sig.weights, kind: "rebalance" });
      return { weights: sig.weights, full: true, releaseDca, releaseReserve, reason, decisionDate: date };
    }

    const free = cash - lockedDca - lockedReserve + releaseDca + releaseReserve;
    if (lastTargets && free >= 1) {
      const reason = ["Invest new cash toward targets", ...notes].join("; ");
      decisions.push({ date, reason, targets: lastTargets, kind: "invest_cash" });
      return { weights: lastTargets, full: false, releaseDca, releaseReserve, reason, decisionDate: date };
    }
    if (releaseDca > 0 || releaseReserve > 0) {
      return { weights: lastTargets ?? sig.weights, full: false, releaseDca, releaseReserve, reason: notes.join("; "), decisionDate: date };
    }
    return null;
  }

  for (let t = 0; t < n; t++) {
    if (pending) { execute(pending, t); pending = null; }

    let flow = 0;
    if (t === 0) {
      flow = cfg.initial;
      if (deployN > 0) lockedDca = cfg.initial;
    } else if (cfg.contribution.frequency !== "none" && cfg.contribution.amount > 0
      && periodKey(dates[t], cfg.contribution.frequency) !== periodKey(dates[t - 1], cfg.contribution.frequency)) {
      flow = cfg.contribution.amount;
      if (def.reserve) lockedReserve += def.reserve.fraction * flow;
    }
    if (flow > 0) { cash += flow; contributed += flow; flows.push({ t, amount: flow }); }

    const v = posValue(t) + cash;
    equity.push(v);
    invested.push(contributed);
    if (t > 0) returns.push(equity[t - 1] > EPS ? (v - flow) / equity[t - 1] - 1 : 0);

    if (v > EPS) {
      for (const k of tickers) {
        const w = ((shares[k] ?? 0) * px(k, t)) / v;
        if (w > 0) exposureSum[k] = (exposureSum[k] ?? 0) + w;
      }
      exposureSum.CASH = (exposureSum.CASH ?? 0) + cash / v;
    }
    if (t < n - 1) pending = decide(t);
  }

  const years = yearsBetween(dates[0], dates[n - 1]);
  const avgEq = equity.reduce((a, b) => a + b, 0) / n;
  const avgExposure = Object.fromEntries(Object.entries(exposureSum).map(([k, s]) => [k, s / n]));
  const finalValue = equity[n - 1];

  if (cfg.initial > 0 && cfg.initial < 500 && (cfg.costs.fixedFee > 0 || !cfg.fractional)) {
    flags.push({ code: "small_balance", severity: "info", message: "With a small balance, fixed fees and whole-share constraints can dominate results." });
  }
  if ((avgExposure.CASH ?? 0) > 0.15) {
    flags.push({ code: "cash_drag", severity: "info", message: `Average cash holding was ${((avgExposure.CASH ?? 0) * 100).toFixed(0)}%; cash earns 0% in this model.` });
  }

  return {
    dates, equity, invested, returns,
    metrics: computeMetrics(returns, dates, { riskFreeRate: cfg.riskFreeRate }),
    trades, decisions, tradeCount: trades.length,
    turnover: years >= 1 && avgEq > 0 ? tradedNotional / avgEq / years : null,
    costsPaid, avgExposure, finalValue, totalContributed: contributed, gain: finalValue - contributed,
    moneyWeightedReturn: years >= 1 ? irr(flows, dates, finalValue) : null,
    flags,
  };
}

/** Annualized money-weighted return by bisection; null when no sign change brackets a solution. */
export function irr(flows: { t: number; amount: number }[], dates: string[], finalValue: number): number | null {
  const end = dates[dates.length - 1];
  const f = (r: number) => flows.reduce((s, x) => s + x.amount * (1 + r) ** yearsBetween(dates[x.t], end), 0) - finalValue;
  let lo = -0.95, hi = 5;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
