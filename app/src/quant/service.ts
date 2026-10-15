import { benchmarkDef, assessRobustness, type Robustness } from "./robustness";
import { DEFAULT_CONFIG, simulate, type RunConfig, type SimResult } from "./backtest";
import { hasErrors, slicePanel, subPanel, type Dataset, type DatasetVersion } from "./data";
import { loadDataset } from "./dataSource";
import { hashId } from "./hash";
import { requiredTickers, validateStrategy, type StrategyDef } from "./strategy";
import { ENGINE_VERSION, type QualityFlag } from "./types";

/** Standard configuration used for catalog scorecards so strategies are comparable. */
export const SCORECARD_CONFIG: RunConfig = {
  ...DEFAULT_CONFIG, initial: 10_000, contribution: { amount: 500, frequency: "monthly" },
};

export class ValidationError extends Error {
  constructor(public errors: string[]) { super(errors.join(" ")); }
}
export class DataError extends Error {
  constructor(message: string, public flags: QualityFlag[]) { super(message); }
}

export function mergeConfig(partial?: Partial<RunConfig>): RunConfig {
  return {
    ...DEFAULT_CONFIG, ...partial,
    contribution: { ...DEFAULT_CONFIG.contribution, ...partial?.contribution },
    costs: { ...DEFAULT_CONFIG.costs, ...partial?.costs },
  };
}

export interface BacktestResult {
  runId: string;
  engineVersion: string;
  strategy: { id: string; version: number; name: string; hash: string; definition: StrategyDef };
  dataset: DatasetVersion;
  config: RunConfig;
  window: { start: string; end: string; years: number };
  run: SimResult;
  benchmark: { ticker: string; run: SimResult };
  excess: { totalReturn: number | null; cagr: number | null; maxDrawdown: number | null; finalValue: number };
  conventions: string[];
  flags: QualityFlag[];
  caveats: string[];
  robustness: Robustness | null;
}

export function conventionsFor(cfg: RunConfig, years: number): string[] {
  const c = cfg.costs;
  return [
    "Price basis: dividend-adjusted closes (total return); dividends are reinvested implicitly.",
    "Timing: each decision uses data through the close of day t. Orders fill at the next trading day's close after slippage, so no future price is used.",
    `Costs: ${c.slippageBps} bps slippage, ${c.commissionBps} bps commission, $${c.fixedFee} fixed fee per trade. ETF expense ratios are already in adjusted prices. Taxes are excluded.`,
    `Cash earns 0%. Risk-free rate for Sharpe and Sortino: ${(cfg.riskFreeRate * 100).toFixed(1)}%.`,
    cfg.fractional ? "Fractional shares are assumed." : "Whole shares only; unspent cash stays in the portfolio.",
    "Currency: USD only; no currency conversion.",
    `Returns are time-weighted (contributions do not count as performance). The benchmark is a buy-and-hold with the same cash flows and costs.${years < 1 ? " Fewer than 12 months of data: annualized metrics are unavailable." : ""}`,
  ];
}

/** Pure, synchronous backtest over an already-loaded dataset. */
export function runBacktestOn(
  dataset: Dataset, strategy: StrategyDef, partial?: Partial<RunConfig>, opts: { robustness?: boolean } = {},
): BacktestResult {
  const v = validateStrategy(strategy);
  if (!v.ok) throw new ValidationError(v.errors);
  const cfg = mergeConfig(partial);
  const need = requiredTickers(strategy);
  const missing = need.filter((t) => !dataset.panel.closes[t]);
  if (missing.length > 0) throw new DataError(`Missing price data for ${missing.join(", ")}.`, dataset.version.qualityFlags);
  if (hasErrors(dataset.version.qualityFlags)) throw new DataError("The dataset has errors and cannot be used.", dataset.version.qualityFlags);

  const full = subPanel(dataset.panel, need);
  const panel = slicePanel(full, cfg.start, cfg.end);
  const run = simulate(strategy, panel, cfg);
  if (run.flags.some((f) => f.severity === "error")) throw new DataError(run.flags[0].message, run.flags);
  const bench = simulate(benchmarkDef(strategy.benchmark), panel, cfg);

  const diff = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null);
  const years = run.metrics.years;
  const flags: QualityFlag[] = [...dataset.version.qualityFlags.filter((f) => need.some((t) => f.message.startsWith(`${t}:`)) || !/^[A-Z]+:/.test(f.message)), ...run.flags];
  if (years < 1) flags.push({ code: "short_window", severity: "warn", message: `Only ${years.toFixed(2)} years of data: annualized metrics are unavailable.` });
  if (strategy.experimental) flags.push({ code: "experimental", severity: "warn", message: "Experimental strategy: a good backtest is weak evidence." });
  const warm = run.decisions.slice(0, 3).some((d) => /Warm-up/.test(d.reason));
  if (warm) flags.push({ code: "warmup", severity: "info", message: "The first months held the safe asset while the indicator warmed up." });

  const stratHash = hashId(strategy);
  const runId = hashId({ stratHash, dataset: dataset.version.id, cfg, tickers: need, engine: ENGINE_VERSION });
  return {
    runId, engineVersion: ENGINE_VERSION,
    strategy: { id: strategy.id, version: strategy.version, name: strategy.name, hash: stratHash, definition: strategy },
    dataset: dataset.version, config: cfg,
    window: { start: panel.dates[0], end: panel.dates[panel.dates.length - 1], years },
    run, benchmark: { ticker: strategy.benchmark, run: bench },
    excess: {
      totalReturn: diff(run.metrics.totalReturn, bench.metrics.totalReturn),
      cagr: diff(run.metrics.cagr, bench.metrics.cagr),
      maxDrawdown: diff(run.metrics.maxDrawdown, bench.metrics.maxDrawdown),
      finalValue: run.finalValue - bench.finalValue,
    },
    conventions: conventionsFor(cfg, years), flags, caveats: strategy.caveats,
    robustness: opts.robustness ? assessRobustness(strategy, panel, cfg) : null,
  };
}

const runCache = new Map<string, BacktestResult>();

/** Synchronous run over a loaded dataset, memoized by strategy, config, data version and options. */
export function runBacktestCached(
  dataset: Dataset, strategy: StrategyDef, partial?: Partial<RunConfig>, opts: { robustness?: boolean } = {},
): BacktestResult {
  const key = `${hashId({ s: strategy, c: mergeConfig(partial), d: dataset.version.id })}|${opts.robustness ? 1 : 0}`;
  const hit = runCache.get(key);
  if (hit) return hit;
  const res = runBacktestOn(dataset, strategy, partial, opts);
  runCache.set(key, res);
  return res;
}

/** Load data and run. Identical inputs and data return the cached result (idempotent by runId). */
export async function runBacktest(strategy: StrategyDef, partial?: Partial<RunConfig>, opts: { robustness?: boolean } = {}): Promise<BacktestResult> {
  const v = validateStrategy(strategy);
  if (!v.ok) throw new ValidationError(v.errors);
  const dataset = await loadDataset(requiredTickers(strategy));
  return runBacktestCached(dataset, strategy, partial, opts);
}

export { validateStrategy };

export interface Scorecard {
  strategyId: string; start: string; end: string; years: number;
  cagr: number | null; maxDrawdown: number | null; sharpe: number | null; volatility: number | null;
  benchmarkCagr: number | null; excessCagr: number | null; excessMaxDrawdown: number | null;
  tradeCount: number; turnover: number | null; verdict: string; datasetId: string; runId: string;
}

export function scorecardOf(r: BacktestResult): Scorecard {
  return {
    strategyId: r.strategy.id, start: r.window.start, end: r.window.end, years: r.window.years,
    cagr: r.run.metrics.cagr, maxDrawdown: r.run.metrics.maxDrawdown, sharpe: r.run.metrics.sharpe, volatility: r.run.metrics.volatility,
    benchmarkCagr: r.benchmark.run.metrics.cagr, excessCagr: r.excess.cagr, excessMaxDrawdown: r.excess.maxDrawdown,
    tradeCount: r.run.tradeCount, turnover: r.run.turnover, verdict: r.robustness?.verdict ?? "not run",
    datasetId: r.dataset.id, runId: r.runId,
  };
}

export { computeMetrics } from "./metrics";
