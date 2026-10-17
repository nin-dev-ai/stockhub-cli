import { computeMetrics } from "./metrics";
import type { ContributionFrequency } from "./backtest";
import { periodKey } from "./backtest";
import type { Metrics } from "./types";

/** One strategy's standalone return stream: returns[i] is the return for dates[i+1]. */
export interface Sleeve { id: string; name: string; dates: string[]; returns: number[] }

export type Weights = Record<string, number>;

export const equalWeights = (ids: string[]): Weights => Object.fromEntries(ids.map((id) => [id, 1 / ids.length]));

export interface WeightCheck { ok: boolean; errors: string[] }

/** Long-only, fully invested, no leverage; optional per-strategy cap. */
export function checkWeights(w: Weights, ids: string[], cap = 1): WeightCheck {
  const errors: string[] = [];
  for (const id of ids) {
    const v = w[id];
    if (v == null || !Number.isFinite(v)) errors.push(`Missing weight for ${id}.`);
    else if (v < -1e-9) errors.push(`${id} has a negative weight; shorting is not allowed.`);
    else if (v > cap + 1e-9) errors.push(`${id} exceeds the ${(cap * 100).toFixed(0)}% cap.`);
  }
  for (const k of Object.keys(w)) if (!ids.includes(k)) errors.push(`Unknown strategy ${k}.`);
  const sum = ids.reduce((s, id) => s + (w[id] ?? 0), 0);
  if (Math.abs(sum - 1) > 1e-3) errors.push(`Weights sum to ${(sum * 100).toFixed(1)}%; they must sum to 100% (no leverage, fully allocated).`);
  return { ok: errors.length === 0, errors };
}

/** How money is moved between a plan's strategies. "daily" is the old idealised assumption. */
export type Rebalance = "daily" | "monthly" | "quarterly" | "annual" | "none" | "drift5";
export const REBALANCE_LABEL: Record<Rebalance, string> = {
  quarterly: "Quarterly", annual: "Once a year", monthly: "Monthly", drift5: "When a strategy drifts 5 points", none: "Never (let it drift)", daily: "Every day (idealised)",
};
export const REBALANCE_ORDER: Rebalance[] = ["quarterly", "annual", "monthly", "drift5", "none", "daily"];
export interface BlendOptions { rule?: Rebalance; /** Cost of each rebalance, in basis points of the money moved. */ costBps?: number }

const periodOf = (d: string, rule: Rebalance) => (rule === "monthly" ? d.slice(0, 7) : rule === "quarterly" ? `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3)}` : d.slice(0, 4));

/**
 * The plan's daily return when each strategy's money grows on its own and is moved back to the
 * target weights only by the rule: on the first trading day of each month, quarter or year, when any
 * strategy is more than 5 points off its target, or never. Each rebalance costs `costBps` of the
 * money moved. "daily" restores the weights every day (no drift, no cost).
 */
export function blendReturns(sleeves: Sleeve[], w: Weights, opt: BlendOptions = {}): number[] {
  const rule = opt.rule ?? "daily";
  if (rule !== "daily") return blendDrifting(sleeves, w, rule, (opt.costBps ?? 0) / 1e4);
  const n = sleeves[0]?.returns.length ?? 0;
  const out = new Array<number>(n).fill(0);
  for (const s of sleeves) {
    const wi = w[s.id] ?? 0;
    if (wi === 0) continue;
    for (let i = 0; i < n; i++) out[i] += wi * s.returns[i];
  }
  return out;
}

function blendDrifting(sleeves: Sleeve[], w: Weights, rule: Rebalance, cost: number): number[] {
  const n = sleeves[0]?.returns.length ?? 0;
  const dates = sleeves[0]?.dates ?? [];
  const ids = sleeves.map((s) => s.id);
  const target = ids.map((id) => w[id] ?? 0);
  let v = [...target];
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const before = v.reduce((a, b) => a + b, 0);
    v = v.map((x, k) => x * (1 + sleeves[k].returns[i]));
    let after = v.reduce((a, b) => a + b, 0);
    const d = dates[i + 1], prev = dates[i];
    const due = rule === "drift5"
      ? after > 0 && v.some((x, k) => Math.abs(x / after - target[k]) > 0.05)
      : rule !== "none" && periodOf(d, rule) !== periodOf(prev, rule);
    if (due && after > 0) {
      // both the sales and the purchases pay the cost
      const moved = v.reduce((s, x, k) => s + Math.abs(target[k] * after - x), 0);
      after -= moved * cost;
      v = target.map((t) => t * after);
    }
    out[i] = before > 0 ? after / before - 1 : 0;
  }
  return out;
}

export function evaluateWeights(sleeves: Sleeve[], w: Weights, riskFreeRate: number, from = 0, to?: number, opt: BlendOptions = {}): { returns: number[]; metrics: Metrics } {
  const dates = sleeves[0].dates.slice(from, to === undefined ? undefined : to + 1);
  const full = blendReturns(sleeves, w, opt);
  const returns = full.slice(from, to === undefined ? undefined : to);
  return { returns, metrics: computeMetrics(returns, dates, { riskFreeRate }) };
}

export interface PathConfig { initial: number; contribution: { amount: number; frequency: ContributionFrequency } }

/** Portfolio value with cash flows: V_t = V_{t-1}(1+r_t) + flow_t, flows credited at the close like the engine. */
export function blendPath(returns: number[], dates: string[], cfg: PathConfig): { equity: number[]; invested: number[] } {
  const equity = [cfg.initial], invested = [cfg.initial];
  let put = cfg.initial;
  for (let i = 0; i < returns.length; i++) {
    const t = i + 1;
    let flow = 0;
    if (cfg.contribution.frequency !== "none" && cfg.contribution.amount > 0
      && periodKey(dates[t], cfg.contribution.frequency) !== periodKey(dates[t - 1], cfg.contribution.frequency)) flow = cfg.contribution.amount;
    put += flow;
    equity.push(equity[i] * (1 + returns[i]) + flow);
    invested.push(put);
  }
  return { equity, invested };
}

/** Compound daily returns into calendar-month returns, keyed by the month of the return date. */
export function monthlyReturns(returns: number[], dates: string[]): { months: string[]; returns: number[] } {
  const months: string[] = [], out: number[] = [];
  let cur = "", g = 1;
  for (let i = 0; i < returns.length; i++) {
    const m = dates[i + 1].slice(0, 7);
    if (m !== cur) {
      if (cur) { months.push(cur); out.push(g - 1); }
      cur = m; g = 1;
    }
    g *= 1 + returns[i];
  }
  if (cur) { months.push(cur); out.push(g - 1); }
  return { months, returns: out };
}
