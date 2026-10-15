import type { BacktestResult } from "./service";
import type { Verdict } from "./robustness";

export type SortKey = "evidence" | "sharpe" | "drawdown" | "cagr" | "name";

const VERDICT_RANK: Record<Verdict | "none", number> = {
  consistent: 3, baseline: 2, mixed: 2, inconsistent: 1, insufficient: 0, none: -1,
};

const num = (v: number | null | undefined, fallback: number) => (v == null || !Number.isFinite(v) ? fallback : v);

/**
 * Default ordering weighs evidence and risk, not return alone: robustness verdict first, then
 * risk-adjusted return (Sharpe), then shallower drawdown. Missing results always sort last.
 */
export function compareResults(a: { name: string; r?: BacktestResult }, b: { name: string; r?: BacktestResult }, key: SortKey): number {
  if (key === "name") return a.name.localeCompare(b.name);
  if (!a.r || !b.r) return a.r ? -1 : b.r ? 1 : a.name.localeCompare(b.name);
  const ma = a.r.run.metrics, mb = b.r.run.metrics;
  switch (key) {
    case "sharpe": return num(mb.sharpe, -9) - num(ma.sharpe, -9);
    case "drawdown": return num(mb.maxDrawdown, -9) - num(ma.maxDrawdown, -9);
    case "cagr": return num(mb.cagr, -9) - num(ma.cagr, -9);
    case "evidence": {
      const va = VERDICT_RANK[a.r.robustness?.verdict ?? "none"], vb = VERDICT_RANK[b.r.robustness?.verdict ?? "none"];
      return vb - va || num(mb.sharpe, -9) - num(ma.sharpe, -9) || num(mb.maxDrawdown, -9) - num(ma.maxDrawdown, -9);
    }
  }
}

/** Growth of 100 from time-weighted returns, length returns.length + 1. */
export function twrIndex(returns: number[], base = 100): number[] {
  const out = [base];
  for (const r of returns) out.push(out[out.length - 1] * (1 + r));
  return out;
}
