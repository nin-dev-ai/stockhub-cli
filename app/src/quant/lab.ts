import type { ContributionFrequency, RunConfig } from "./backtest";
import { DEFAULT_CONFIG } from "./backtest";
import { INSTRUMENT_BY_TICKER } from "./instruments";
import { applyTarget, MAX_SPREAD, primaryRisky, withSpread, type StrategyDef } from "./strategy";
import type { Objective } from "./optimizer";
import { blendPath, blendReturns, evaluateWeights, monthlyReturns, type Sleeve, type Weights } from "./portfolio";
import type { ProjectionInput, ProjectionMethod } from "./projection";
import type { BacktestResult } from "./service";

export interface LabInputs {
  /** ETF that replaces SPY in every basket strategy that trades it (and becomes the benchmark). */
  etf: string;
  /** More ETFs to spread SPY-trading strategies across together with `etf` (money split equally); empty runs on `etf` alone. */
  alsoEtfs: string[];
  /** How many years of history to test, counting back from the latest data; null uses everything available (about 22 years). */
  lookbackYears: number | null;
  initial: number;
  /** Value already held in ETFs; treated as extra starting capital invested per the plan from day one. */
  existing: number;
  monthly: number;
  years: number;
  objective: Objective;
  maxWeight: number;
  /** The worst peak-to-trough fall the user will accept, as a positive fraction (0.3 = 30%). */
  fallLimit: number;
  riskFreeRate: number;
  slippageBps: number;
  fixedFee: number;
  fractional: boolean;
  inflation: number;
  goal: number | null;
  method: ProjectionMethod;
  paths: number;
  seed: number;
  blockMonths: number;
}

export const DEFAULT_LAB: LabInputs = {
  etf: "SPY", alsoEtfs: [], lookbackYears: null, initial: 200, existing: 0, monthly: 50, years: 5, objective: "balanced", maxWeight: 0.6, fallLimit: 0.3, riskFreeRate: 0,
  slippageBps: 2, fixedFee: 0, fractional: true, inflation: 0.025, goal: null,
  method: "bootstrap", paths: 2000, seed: 42, blockMonths: 6,
};

export const LAB_LIMITS = { years: [1, 30], lookback: [1, 30], initial: [0, 10_000_000], existing: [0, 10_000_000], monthly: [0, 1_000_000], paths: [200, 10_000] } as const;

export function validateLab(i: LabInputs): string[] {
  const e: string[] = [];
  const bad = (v: number, [lo, hi]: readonly [number, number] | readonly number[]) => !Number.isFinite(v) || v < lo || v > hi;
  if (bad(i.initial, LAB_LIMITS.initial)) e.push("Initial capital must be between 0 and 10,000,000.");
  if (bad(i.monthly, LAB_LIMITS.monthly)) e.push("Monthly contribution must be between 0 and 1,000,000.");
  if (bad(i.existing, LAB_LIMITS.existing)) e.push("Existing holdings must be between 0 and 10,000,000.");
  if (i.initial + i.existing <= 0 && i.monthly <= 0) e.push("Enter an initial amount or a monthly contribution.");
  if (bad(i.years, LAB_LIMITS.years)) e.push("Horizon must be 1 to 30 years.");
  if (i.lookbackYears != null && bad(i.lookbackYears, LAB_LIMITS.lookback)) e.push("History to test must be 1 to 30 years, or all available.");
  if (bad(i.paths, LAB_LIMITS.paths)) e.push("Simulated paths must be between 200 and 10,000.");
  if (bad(i.maxWeight, [0.2, 1])) e.push("Maximum weight per strategy must be between 20% and 100%.");
  if (bad(i.fallLimit, [0.05, 0.9])) e.push("The fall limit must be between 5% and 90%.");
  if (bad(i.riskFreeRate, [0, 0.2])) e.push("Risk-free rate must be between 0% and 20%.");
  if (bad(i.inflation, [0, 0.2])) e.push("Inflation must be between 0% and 20%.");
  if (bad(i.slippageBps, [0, 200])) e.push("Slippage must be between 0 and 200 bps.");
  if (bad(i.fixedFee, [0, 100])) e.push("Fixed fee must be between $0 and $100.");
  if (!INSTRUMENT_BY_TICKER[i.etf]) e.push(`${i.etf} is not a supported ETF.`);
  const also = i.alsoEtfs ?? [];
  for (const t of also) if (!INSTRUMENT_BY_TICKER[t]) e.push(`${t} is not a supported ETF.`);
  if (also.includes(i.etf) || new Set(also).size !== also.length) e.push("Each ETF can be picked only once.");
  if (also.length + 1 > MAX_SPREAD) e.push(`Spread across at most ${MAX_SPREAD} ETFs.`);
  if (i.goal != null && (!Number.isFinite(i.goal) || i.goal <= 0)) e.push("Goal must be a positive amount.");
  return e;
}

/** The ETFs the Lab runs SPY-trading strategies on: one, or several with the money split equally. */
export const labEtfs = (i: LabInputs): string[] => [i.etf, ...(i.alsoEtfs ?? []).filter((t) => t !== i.etf)];

/**
 * The basket as the Lab runs it: SPY swapped for the chosen ETF wherever a strategy trades it, or,
 * with several ETFs chosen, strategies whose main ETF is SPY spread across all of them (rotations
 * across many ETFs only get the swap).
 */
export const labStrategies = (defs: StrategyDef[], i: LabInputs): StrategyDef[] => {
  const etfs = labEtfs(i);
  return defs.map((d) => (etfs.length > 1 && primaryRisky(d) === "SPY" && !d.spread ? withSpread(d, etfs, undefined, "SPY") : null) ?? applyTarget(d, { SPY: i.etf }));
};

export const startingCapital = (i: LabInputs) => i.initial + i.existing;

/** First date of a window that looks back `years` from `latest` (ISO dates); null means everything available. */
export function lookbackStart(years: number | null | undefined, latest: Date): string | undefined {
  if (years == null) return undefined;
  const d = new Date(latest);
  d.setUTCFullYear(d.getUTCFullYear() - Math.round(years));
  return d.toISOString().slice(0, 10);
}

/** The projection samples monthly returns from the tested history; fewer than this many months and none is shown. */
export const MIN_PROJECTION_YEARS = 5;

export function backtestConfig(i: LabInputs, now: Date = new Date()): Partial<RunConfig> {
  return {
    start: lookbackStart(i.lookbackYears, now),
    initial: startingCapital(i),
    contribution: { amount: i.monthly, frequency: i.monthly > 0 ? "monthly" : "none" },
    costs: { commissionBps: 0, slippageBps: i.slippageBps, fixedFee: i.fixedFee },
    riskFreeRate: i.riskFreeRate,
    fractional: i.fractional,
  };
}

export const sleeveOf = (r: BacktestResult): Sleeve => ({ id: r.strategy.id, name: r.strategy.name, dates: r.run.dates, returns: r.run.returns });

export interface PlanBacktest {
  weights: Weights;
  dates: string[];
  returns: number[];
  equity: number[];
  invested: number[];
  metrics: ReturnType<typeof evaluateWeights>["metrics"];
}

/** The blended plan over history with the user's own cash flows. */
export function planBacktest(sleeves: Sleeve[], weights: Weights, i: LabInputs): PlanBacktest {
  const returns = blendReturns(sleeves, weights);
  const dates = sleeves[0].dates;
  const freq: ContributionFrequency = i.monthly > 0 ? "monthly" : "none";
  const path = blendPath(returns, dates, { initial: startingCapital(i), contribution: { amount: i.monthly, frequency: freq } });
  return { weights, dates, returns, ...path, metrics: evaluateWeights(sleeves, weights, i.riskFreeRate).metrics };
}

export function projectionInput(sleeves: Sleeve[], weights: Weights, i: LabInputs): ProjectionInput {
  const returns = blendReturns(sleeves, weights);
  const m = monthlyReturns(returns, sleeves[0].dates);
  return {
    monthlyReturns: m.returns,
    historyStart: sleeves[0].dates[0], historyEnd: sleeves[0].dates[sleeves[0].dates.length - 1],
    initial: startingCapital(i), contribution: { amount: i.monthly, frequency: i.monthly > 0 ? "monthly" : "none" },
    years: i.years, method: i.method, paths: i.paths, blockMonths: i.blockMonths, seed: i.seed, inflation: i.inflation,
    goal: i.goal ?? undefined,
  };
}

export { DEFAULT_CONFIG };
