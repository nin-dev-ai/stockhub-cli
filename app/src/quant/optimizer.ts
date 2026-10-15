import { blendReturns, checkWeights, equalWeights, evaluateWeights, type Sleeve, type Weights } from "./portfolio";
import { hashId } from "./hash";
import { mean } from "./metrics";
import { ENGINE_VERSION, TRADING_DAYS, type Metrics } from "./types";

export type Objective = "lower_volatility" | "balanced" | "growth";

export const OBJECTIVES: { key: Objective; label: string; description: string }[] = [
  { key: "lower_volatility", label: "Lower volatility", description: "Minimizes annualized volatility of the blended sleeves (minimum variance)." },
  { key: "balanced", label: "Balanced risk", description: "Maximizes the Sharpe ratio: excess return per unit of volatility." },
  { key: "growth", label: "Growth-oriented", description: "Maximizes expected compound growth (mean return minus half the variance); accepts more volatility." },
];

export interface OptimizerConfig { maxWeight: number; riskFreeRate: number; stepPct: number }
export const DEFAULT_OPT: OptimizerConfig = { maxWeight: 0.6, riskFreeRate: 0, stepPct: 1 };

export interface Binding { id: string; kind: "cap" | "zero" }
export interface Proposal {
  objective: Objective;
  weights: Weights;
  metrics: Metrics;
  objectiveValue: number;
  binding: Binding[];
}
export interface BaselineStats { label: string; weights: Weights | null; metrics: Metrics }
export interface OutOfSample {
  splitDate: string;
  fitWeights: Weights;
  test: Metrics;
  equalWeightTest: Metrics;
}
export interface OptimizationResult {
  runId: string;
  engineVersion: string;
  method: string;
  config: OptimizerConfig;
  effectiveCap: number;
  window: { start: string; end: string };
  ids: string[];
  evaluated: number;
  proposals: Record<Objective, Proposal>;
  baselines: BaselineStats[];
  outOfSample: OutOfSample | null;
  notes: string[];
}

function compositions(n: number, total: number, cap: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (i: number, left: number) => {
    if (i === n - 1) { if (left <= cap) out.push([...cur, left]); return; }
    for (let v = 0; v <= Math.min(cap, left); v++) { cur.push(v); rec(i + 1, left - v); cur.pop(); }
  };
  rec(0, total);
  return out;
}

function moments(sleeves: Sleeve[], from: number, to: number) {
  const n = sleeves.length;
  const slices = sleeves.map((s) => s.returns.slice(from, to));
  const mu = slices.map((x) => mean(x) * TRADING_DAYS);
  const cov = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const len = slices[0].length;
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
    let s = 0;
    for (let k = 0; k < len; k++) s += (slices[i][k] - mu[i] / TRADING_DAYS) * (slices[j][k] - mu[j] / TRADING_DAYS);
    cov[i][j] = cov[j][i] = (s / (len - 1)) * TRADING_DAYS;
  }
  return { mu, cov };
}

function score(obj: Objective, w: number[], mu: number[], cov: number[][], rf: number): number {
  const m = w.reduce((s, x, i) => s + x * mu[i], 0);
  let v = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) v += w[i] * w[j] * cov[i][j];
  const sd = Math.sqrt(Math.max(v, 0));
  if (obj === "lower_volatility") return -sd;
  if (obj === "balanced") return sd > 1e-12 ? (m - rf) / sd : -Infinity;
  return m - v / 2;
}

/** Exhaustive search over long-only weights on a 1% grid; the grid is small (3 strategies: 5,151 points). */
function solve(obj: Objective, mu: number[], cov: number[][], capPct: number, step: number, rf: number): number[] {
  const n = mu.length;
  const total = Math.round(100 / step);
  const cap = Math.min(total, Math.round(capPct / step));
  let best: number[] | null = null, bestScore = -Infinity;
  for (const c of compositions(n, total, cap)) {
    const w = c.map((x) => x / total);
    const s = score(obj, w, mu, cov, rf);
    if (s > bestScore + 1e-12) { bestScore = s; best = w; }
  }
  return best ?? new Array(n).fill(1 / n);
}

export function optimize(sleeves: Sleeve[], partial: Partial<OptimizerConfig> = {}): OptimizationResult {
  const config = { ...DEFAULT_OPT, ...partial };
  const ids = sleeves.map((s) => s.id);
  const n = ids.length;
  if (n < 1) throw new Error("Optimization needs at least one strategy.");
  const len = sleeves[0].returns.length;
  if (len < 60) throw new Error(`Only ${len} daily observations are available; at least 60 are needed to estimate risk.`);

  const effectiveCap = Math.min(1, Math.max(config.maxWeight, 1 / n));
  const notes: string[] = [];
  if (effectiveCap > config.maxWeight + 1e-9) notes.push(`A ${(config.maxWeight * 100).toFixed(0)}% cap is infeasible for ${n} strategies; the cap was raised to ${(effectiveCap * 100).toFixed(0)}%.`);
  const capPct = Math.round(effectiveCap * 100);

  const { mu, cov } = moments(sleeves, 0, len);
  const mk = (objective: Objective, w: number[]): Proposal => {
    const weights = Object.fromEntries(ids.map((id, i) => [id, w[i]]));
    const { metrics } = evaluateWeights(sleeves, weights, config.riskFreeRate);
    const binding: Binding[] = [];
    ids.forEach((id, i) => {
      if (n > 1 && Math.abs(w[i] - effectiveCap) < 0.5 / 100) binding.push({ id, kind: "cap" });
      else if (n > 1 && w[i] < 0.5 / 100) binding.push({ id, kind: "zero" });
    });
    return { objective, weights, metrics, objectiveValue: score(objective, w, mu, cov, config.riskFreeRate), binding };
  };
  const proposals = Object.fromEntries(OBJECTIVES.map((o) => [o.key, mk(o.key, solve(o.key, mu, cov, capPct, config.stepPct, config.riskFreeRate))])) as Record<Objective, Proposal>;

  const eq = equalWeights(ids);
  const baselines: BaselineStats[] = [
    { label: "Equal weight", weights: eq, metrics: evaluateWeights(sleeves, eq, config.riskFreeRate).metrics },
    ...sleeves.map((s) => ({ label: `${s.name} alone`, weights: { [s.id]: 1 } as Weights, metrics: evaluateWeights(sleeves, { [s.id]: 1 }, config.riskFreeRate).metrics })),
  ];

  // Weights are estimated on the first 60% and judged on the rest, to show how much of the result is hindsight.
  let outOfSample: OutOfSample | null = null;
  const cut = Math.floor(len * 0.6);
  if (n > 1 && cut >= 120 && len - cut >= 60) {
    const m1 = moments(sleeves, 0, cut);
    const w = solve("balanced", m1.mu, m1.cov, capPct, config.stepPct, config.riskFreeRate);
    const fit = Object.fromEntries(ids.map((id, i) => [id, w[i]]));
    outOfSample = {
      splitDate: sleeves[0].dates[cut],
      fitWeights: fit,
      test: evaluateWeights(sleeves, fit, config.riskFreeRate, cut).metrics,
      equalWeightTest: evaluateWeights(sleeves, eq, config.riskFreeRate, cut).metrics,
    };
  }
  if (n > 1) notes.push("Weights are estimated from the same history they are judged on, so the in-sample result flatters the proposal. The out-of-sample check refits on the first 60% and tests on the rest.");
  notes.push("Strategy sleeves are blended as if their weights were restored every day, which is an approximation of rebalancing between them.");

  return {
    runId: hashId({ ids, ret: sleeves.map((s) => [s.dates[0], s.returns]), config, engine: ENGINE_VERSION }),
    engineVersion: ENGINE_VERSION,
    method: `Exhaustive search over long-only weights on a ${config.stepPct}% grid (sum 100%, each at most ${capPct}%).`,
    config, effectiveCap, window: { start: sleeves[0].dates[0], end: sleeves[0].dates[sleeves[0].dates.length - 1] },
    ids, evaluated: compositions(n, Math.round(100 / config.stepPct), Math.round(capPct / config.stepPct)).length,
    proposals, baselines, outOfSample, notes,
  };
}

export { blendReturns, checkWeights };
