import type { ContributionFrequency, RunConfig } from "./backtest";
import { DEFAULT_CONFIG } from "./backtest";
import { INSTRUMENT_BY_TICKER } from "./instruments";
import { applyTarget, type StrategyDef } from "./strategy";
import type { Objective } from "./optimizer";
import { blendPath, blendReturns, evaluateWeights, monthlyReturns, type Sleeve, type Weights } from "./portfolio";
import type { ProjectionInput, ProjectionMethod } from "./projection";
import type { BacktestResult } from "./service";

export interface LabInputs {
  /** ETF that replaces SPY in every basket strategy that trades it (and becomes the benchmark). */
  etf: string;
  initial: number;
  /** Value already held in ETFs; treated as extra starting capital invested per the plan from day one. */
  existing: number;
  monthly: number;
  years: number;
  objective: Objective;
  maxWeight: number;
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
  etf: "SPY", initial: 200, existing: 0, monthly: 50, years: 5, objective: "balanced", maxWeight: 0.6, riskFreeRate: 0,
  slippageBps: 2, fixedFee: 0, fractional: true, inflation: 0.025, goal: null,
  method: "bootstrap", paths: 2000, seed: 42, blockMonths: 6,
};

export const LAB_LIMITS = { years: [1, 30], initial: [0, 10_000_000], existing: [0, 10_000_000], monthly: [0, 1_000_000], paths: [200, 10_000] } as const;

export function validateLab(i: LabInputs): string[] {
  const e: string[] = [];
  const bad = (v: number, [lo, hi]: readonly [number, number] | readonly number[]) => !Number.isFinite(v) || v < lo || v > hi;
  if (bad(i.initial, LAB_LIMITS.initial)) e.push("Initial capital must be between 0 and 10,000,000.");
  if (bad(i.monthly, LAB_LIMITS.monthly)) e.push("Monthly contribution must be between 0 and 1,000,000.");
  if (bad(i.existing, LAB_LIMITS.existing)) e.push("Existing holdings must be between 0 and 10,000,000.");
  if (i.initial + i.existing <= 0 && i.monthly <= 0) e.push("Enter an initial amount or a monthly contribution.");
  if (bad(i.years, LAB_LIMITS.years)) e.push("Horizon must be 1 to 30 years.");
  if (bad(i.paths, LAB_LIMITS.paths)) e.push("Simulated paths must be between 200 and 10,000.");
  if (bad(i.maxWeight, [0.2, 1])) e.push("Maximum weight per strategy must be between 20% and 100%.");
  if (bad(i.riskFreeRate, [0, 0.2])) e.push("Risk-free rate must be between 0% and 20%.");
  if (bad(i.inflation, [0, 0.2])) e.push("Inflation must be between 0% and 20%.");
  if (bad(i.slippageBps, [0, 200])) e.push("Slippage must be between 0 and 200 bps.");
  if (bad(i.fixedFee, [0, 100])) e.push("Fixed fee must be between $0 and $100.");
  if (!INSTRUMENT_BY_TICKER[i.etf]) e.push(`${i.etf} is not a supported ETF.`);
  if (i.goal != null && (!Number.isFinite(i.goal) || i.goal <= 0)) e.push("Goal must be a positive amount.");
  return e;
}

/** The basket as the Lab runs it: SPY swapped for the chosen ETF wherever a strategy trades it. */
export const labStrategies = (defs: StrategyDef[], i: LabInputs): StrategyDef[] => defs.map((d) => applyTarget(d, { SPY: i.etf }));

export const startingCapital = (i: LabInputs) => i.initial + i.existing;

export function backtestConfig(i: LabInputs): Partial<RunConfig> {
  return {
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
