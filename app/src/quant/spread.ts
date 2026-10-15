import { simulate, type RunConfig, type SimResult } from "./backtest";
import { correlation } from "./metrics";
import { benchmarkDef } from "./robustness";
import { sleeveDef, type StrategyDef } from "./strategy";
import type { Metrics, Panel } from "./types";

export interface SpreadSleeveRow { ticker: string; weight: number; cagr: number | null; maxDrawdown: number | null; sharpe: number | null; finalValue: number; gain: number; gainShare: number | null }
export interface SpreadReport {
  from: string;
  sleeves: SpreadSleeveRow[];
  /** Pairwise correlation of the sleeves' daily returns, in sleeve order. */
  correlation: number[][];
  /** The same rules on the original ETF only. */
  single: { ticker: string; metrics: Metrics; finalValue: number };
  /** Buy-and-hold of the same ETFs with the same split, no trading rules. */
  buyHold: { metrics: Metrics; finalValue: number };
  /** The shallowest worst drawdown among the sleeves on their own. */
  bestSleeveMaxDD: number | null;
  /** Combined worst drawdown minus the best sleeve's (positive: spreading reduced the drawdown). */
  drawdownChange: number | null;
  summary: string;
}

const pts = (x: number) => `${Math.abs(x * 100).toFixed(1)} points`;

/** Per-ETF contribution, sleeve correlation and the two baselines a spread result is judged against. */
export function spreadReport(def: StrategyDef, run: SimResult, panel: Panel, cfg: RunConfig): SpreadReport | null {
  if (!def.spread || !run.sleeves?.length) return null;
  const totalGain = run.gain;
  const sleeves: SpreadSleeveRow[] = run.sleeves.map((s) => ({
    ticker: s.ticker, weight: s.weight, cagr: s.metrics.cagr, maxDrawdown: s.metrics.maxDrawdown, sharpe: s.metrics.sharpe,
    finalValue: s.finalValue, gain: s.finalValue - s.totalContributed,
    gainShare: Math.abs(totalGain) > 1e-9 ? (s.finalValue - s.totalContributed) / totalGain : null,
  }));
  const corr = run.sleeves.map((a) => run.sleeves!.map((b) => (a === b ? 1 : correlation(a.returns, b.returns))));
  const from = def.spread.from;
  const one = simulate(sleeveDef(def, from), panel, cfg);
  const weights = Object.fromEntries(def.spread.targets.map((t) => [t.ticker, t.weight]));
  const mixDef: StrategyDef = { ...benchmarkDef(from), id: "spread_buy_hold", universe: Object.keys(weights), allocation: { type: "static", weights } };
  const bh = simulate(mixDef, panel, cfg);
  const dds = sleeves.map((s) => s.maxDrawdown).filter((x): x is number => x != null);
  const bestSleeveMaxDD = dds.length ? Math.max(...dds) : null;
  const combined = run.metrics.maxDrawdown;
  const drawdownChange = combined != null && bestSleeveMaxDD != null ? combined - bestSleeveMaxDD : null;
  const list = sleeves.map((s) => s.ticker).join(", ");
  const summary = drawdownChange == null
    ? `Drawdowns are unavailable for this window, so the effect of spreading across ${list} cannot be judged.`
    : drawdownChange > 0.0005
      ? `Spreading across ${list} made the worst drawdown ${pts(drawdownChange)} shallower than the best single ETF's.`
      : `Spreading across ${list} did not make the worst drawdown shallower than the best single ETF's (${drawdownChange < -0.0005 ? `${pts(drawdownChange)} deeper` : "about the same"}): the sleeves fell together.`;
  return {
    from, sleeves, correlation: corr,
    single: { ticker: from, metrics: one.metrics, finalValue: one.finalValue },
    buyHold: { metrics: bh.metrics, finalValue: bh.finalValue },
    bestSleeveMaxDD, drawdownChange, summary,
  };
}
