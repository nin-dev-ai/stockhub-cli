import { simulate, type RunConfig } from "./backtest";
import { slicePanel } from "./data";
import { computeMetrics } from "./metrics";
import { getParam, requiredTickers, withParam, type StrategyDef } from "./strategy";
import type { Metrics, Panel } from "./types";

export const MIN_YEARS_ROBUSTNESS = 8;
const WINDOW_YEARS = 3, STEP_YEARS = 1, TRAIN_FRACTION = 0.6;
const CAGR_RANGE_LIMIT = 0.03, SHARPE_RANGE_LIMIT = 0.25;

export const benchmarkDef = (ticker: string): StrategyDef => ({
  schema: 1, id: `benchmark_${ticker.toLowerCase()}`, version: 1, name: `${ticker} buy and hold`, summary: "", intendedUse: "",
  tags: [], region: "US", holdingPeriod: "", universe: [ticker], benchmark: ticker,
  allocation: { type: "static", weights: { [ticker]: 1 } }, rebalance: { schedule: "none" },
  methodology: "", caveats: [], evidence: "Backtested",
});

export interface Segment { start: string; end: string; strategy: Metrics; benchmark: Metrics }
export interface RollingWindow { start: string; end: string; strategySharpe: number | null; benchmarkSharpe: number | null; strategyMaxDD: number | null; benchmarkMaxDD: number | null; notWorse: boolean }
export interface SensitivityRow { value: number; cagr: number | null; sharpe: number | null; maxDrawdown: number | null }
export interface Sensitivity { path: string; informational: boolean; base: number; rows: SensitivityRow[]; cagrRange: number | null; sharpeRange: number | null; stable: boolean | null }
export type Verdict = "consistent" | "mixed" | "inconsistent" | "insufficient" | "baseline";

export interface Robustness {
  verdict: Verdict;
  reasons: string[];
  split: { date: string; train: Segment; test: Segment } | null;
  rolling: { windowYears: number; windows: RollingWindow[]; pctNotWorse: number | null };
  sensitivity: Sensitivity[];
  rules: string[];
}

export const ROBUSTNESS_RULES = [
  `Needs at least ${MIN_YEARS_ROBUSTNESS} years of common history, otherwise the verdict is "insufficient".`,
  `Train/test: the first ${TRAIN_FRACTION * 100}% of dates is "train", the rest "test". Consistent if the strategy's Sharpe is on the same side of the benchmark's in both.`,
  `Rolling windows: ${WINDOW_YEARS}-year windows start every ${STEP_YEARS} year. A window is "not worse" if the strategy's Sharpe is at least the benchmark's or its max drawdown is at least 2 points shallower.`,
  `Sensitivity: each tuned parameter is varied; stable if CAGR moves by at most ${CAGR_RANGE_LIMIT * 100} points and Sharpe by at most ${SHARPE_RANGE_LIMIT}. Parameters that are an investor's choice (such as how long to take to deploy cash) are shown but not judged.`,
  `"consistent" = every applicable check passes; "inconsistent" = parameters unstable or two checks fail; otherwise "mixed". The verdict describes consistency in this sample, not a prediction.`,
];

const flat = (cfg: RunConfig): RunConfig => ({ ...cfg, contribution: { amount: 0, frequency: "none" }, initial: 10_000, start: undefined, end: undefined });

function pair(def: StrategyDef, p: Panel, cfg: RunConfig, start: string, end: string): Segment {
  const sub = slicePanel(p, start, end);
  const s = simulate(def, sub, cfg), b = simulate(benchmarkDef(def.benchmark), sub, cfg);
  return { start: sub.dates[0] ?? start, end: sub.dates[sub.dates.length - 1] ?? end, strategy: s.metrics, benchmark: b.metrics };
}

export function assessRobustness(def: StrategyDef, panel: Panel, config: RunConfig): Robustness {
  const cfg = flat(config);
  const n = panel.dates.length;
  const years = n > 1 ? (Date.parse(panel.dates[n - 1]) - Date.parse(panel.dates[0])) / (365.25 * 864e5) : 0;
  const base: Robustness = { verdict: "insufficient", reasons: [], split: null, rolling: { windowYears: WINDOW_YEARS, windows: [], pctNotWorse: null }, sensitivity: [], rules: ROBUSTNESS_RULES };

  const a = def.allocation;
  if (a.type === "static" && Object.keys(a.weights).length === 1 && a.weights[def.benchmark] === 1 && !def.entry && !def.reserve) {
    base.verdict = "baseline";
    base.reasons.push("This strategy is the benchmark itself, so there is nothing to compare it against.");
    return base;
  }

  if (years < MIN_YEARS_ROBUSTNESS) {
    base.reasons.push(`Only ${years.toFixed(1)} years of common history; at least ${MIN_YEARS_ROBUSTNESS} are needed for a robustness verdict.`);
    return base;
  }

  // chronological train / test
  const cut = Math.floor(n * TRAIN_FRACTION);
  const train = pair(def, panel, cfg, panel.dates[0], panel.dates[cut - 1]);
  const test = pair(def, panel, cfg, panel.dates[cut], panel.dates[n - 1]);
  base.split = { date: panel.dates[cut], train, test };
  const sd = (s: Segment) => (s.strategy.sharpe != null && s.benchmark.sharpe != null ? s.strategy.sharpe - s.benchmark.sharpe : null);
  const dTrain = sd(train), dTest = sd(test);
  const consistent = dTrain != null && dTest != null ? Math.sign(dTrain) === Math.sign(dTest) : null;

  // rolling windows
  const windows: RollingWindow[] = [];
  const startYear = Number(panel.dates[0].slice(0, 4));
  const endDate = panel.dates[n - 1];
  for (let y = startYear; ; y += STEP_YEARS) {
    const ws = panel.dates.find((d) => d >= `${y}-01-01`);
    const we = `${y + WINDOW_YEARS - 1}-12-31`;
    if (!ws || we > endDate) break;
    const seg = pair(def, panel, cfg, ws, we);
    const ss = seg.strategy.sharpe, bs = seg.benchmark.sharpe, sm = seg.strategy.maxDrawdown, bm = seg.benchmark.maxDrawdown;
    const notWorse = (ss != null && bs != null && ss >= bs) || (sm != null && bm != null && sm >= bm + 0.02);
    windows.push({ start: seg.start, end: seg.end, strategySharpe: ss, benchmarkSharpe: bs, strategyMaxDD: sm, benchmarkMaxDD: bm, notWorse });
  }
  const pctNotWorse = windows.length >= 5 ? windows.filter((w) => w.notWorse).length / windows.length : null;
  base.rolling = { windowYears: WINDOW_YEARS, windows, pctNotWorse };

  // parameter sensitivity
  for (const sp of def.sensitivity ?? []) {
    const rows: SensitivityRow[] = sp.values.map((value) => {
      const v = withParam(def, sp.path, value);
      const m = simulate(v, panel, cfg).metrics;
      return { value, cagr: m.cagr, sharpe: m.sharpe, maxDrawdown: m.maxDrawdown };
    });
    const range = (k: "cagr" | "sharpe") => {
      const xs = rows.map((r) => r[k]).filter((x): x is number => x != null);
      return xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : null;
    };
    const cr = range("cagr"), sr = range("sharpe");
    base.sensitivity.push({
      path: sp.path, informational: !!sp.informational, base: getParam(def, sp.path), rows, cagrRange: cr, sharpeRange: sr,
      stable: cr != null && sr != null ? cr <= CAGR_RANGE_LIMIT && sr <= SHARPE_RANGE_LIMIT : null,
    });
  }

  // verdict
  const fails: string[] = [];
  let checks = 0;
  if (consistent != null) {
    checks++;
    if (!consistent) fails.push("Risk-adjusted performance versus the benchmark changed direction between the train and test periods.");
  }
  if (pctNotWorse != null) {
    checks++;
    if (pctNotWorse < 0.5) fails.push(`Only ${(pctNotWorse * 100).toFixed(0)}% of rolling ${WINDOW_YEARS}-year windows were not worse than the benchmark.`);
  }
  const judged = base.sensitivity.filter((s) => !s.informational);
  const unstable = judged.filter((s) => s.stable === false);
  for (const s of judged) if (s.stable !== null) checks++;
  for (const s of unstable) fails.push(`Results move materially when ${s.path} changes (CAGR range ${((s.cagrRange ?? 0) * 100).toFixed(1)} points).`);

  base.reasons = fails;
  if (checks < 2) { base.verdict = "insufficient"; base.reasons.push("Too few checks could be computed for a verdict."); }
  else if (unstable.length > 0 || fails.length >= 2) base.verdict = "inconsistent";
  else if (fails.length === 1) base.verdict = "mixed";
  else base.verdict = "consistent";
  return base;
}

export { requiredTickers };
