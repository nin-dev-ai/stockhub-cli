import { SeriesChart } from "@/components/charts/SeriesChart";
import { Badge, FlagList } from "@/components/quant/Badges";
import { fmtMoney, fmtRate, fmtRatio } from "@/lib/format";
import { blendPath, equalWeights, evaluateWeights, REBALANCE_LABEL } from "@/quant/portfolio";
import type { PlanBacktest } from "@/quant/lab";
import { blendOf, startingCapital, type LabInputs } from "@/quant/lab";
import type { BacktestBundle } from "@/quant/useLab";
import { blendReturns } from "@/quant/portfolio";
import type { Metrics } from "@/quant/types";

const COLORS = ["#22ccee", "#22ee22", "#c084fc"];

interface Row { label: string; final: number; contributed: number; metrics: Metrics; bold?: boolean }

export function BacktestView({ bundle, plan, inputs }: { bundle: BacktestBundle; plan: PlanBacktest; inputs: LabInputs }) {
  const { results, sleeves, dataset } = bundle;
  const dates = plan.dates;
  const ids = sleeves.map((s) => s.id);
  const eqW = equalWeights(ids);
  const eq = blendPath(blendReturns(sleeves, eqW, blendOf(inputs)), dates, { initial: startingCapital(inputs), contribution: { amount: inputs.monthly, frequency: inputs.monthly > 0 ? "monthly" : "none" } });
  const bench = results[0].benchmark.run;

  const rows: Row[] = [
    { label: "Your plan (selected weights)", final: plan.equity[plan.equity.length - 1], contributed: plan.invested[plan.invested.length - 1], metrics: plan.metrics, bold: true },
    { label: "Equal weight", final: eq.equity[eq.equity.length - 1], contributed: eq.invested[eq.invested.length - 1], metrics: evaluateWeights(sleeves, eqW, inputs.riskFreeRate, 0, undefined, blendOf(inputs)).metrics },
    { label: `${results[0].benchmark.ticker} buy and hold`, final: bench.finalValue, contributed: bench.totalContributed, metrics: bench.metrics },
    ...results.map((r) => ({ label: r.strategy.name, final: r.run.finalValue, contributed: r.run.totalContributed, metrics: r.run.metrics })),
  ];
  const first = results[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge tone="amber">Historical backtest</Badge>
        <span className="text-[11px] text-term-muted">What this plan would have done with your cash flows over <span className="num text-term-text">{first.window.start} → {first.window.end}</span>. Not a forecast.</span>
      </div>
      <SeriesChart dates={dates} height={240} log format={(v) => fmtMoney(v)}
        series={[
          { name: "Your plan", color: "#ff8c00", values: plan.equity, width: 2 },
          { name: "Equal weight", color: "#22ccee", values: eq.equity, dash: true },
          { name: `${first.benchmark.ticker} buy and hold`, color: "#6e6e6e", values: bench.equity, dash: true },
          ...results.map((r, i) => ({ name: r.strategy.name, color: COLORS[i % COLORS.length], values: r.run.equity, width: 1 })),
          { name: "Money put in", color: "#444", values: plan.invested, dash: true },
        ]} />
      <div className="sub-header">Portfolio value with your contributions (log scale)</div>
      <table className="w-full grid-data text-[11px]">
        <thead><tr><th>Portfolio</th><th className="text-right">Final value</th><th className="text-right">Contributed</th><th className="text-right">Gain</th><th className="text-right">CAGR</th><th className="text-right">Volatility</th><th className="text-right">Sharpe</th><th className="text-right">Max DD</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.bold ? "text-term-amber" : ""}>
              <td>{r.label}</td><td className="num text-right">{fmtMoney(r.final)}</td><td className="num text-right">{fmtMoney(r.contributed)}</td>
              <td className={`num text-right ${r.final - r.contributed >= 0 ? "up" : "down"}`}>{fmtMoney(r.final - r.contributed)}</td>
              <td className="num text-right">{fmtRate(r.metrics.cagr)}</td><td className="num text-right">{fmtRate(r.metrics.volatility)}</td>
              <td className="num text-right">{fmtRatio(r.metrics.sharpe)}</td><td className="num text-right">{fmtRate(r.metrics.maxDrawdown)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-term-muted leading-snug">
        CAGR, volatility, Sharpe and drawdown are time-weighted, so contributions do not count as performance. Your plan and the equal-weight mix move money between strategies by the plan's rule ({REBALANCE_LABEL[inputs.rebalance ?? "quarterly"].toLowerCase()}), charged at the slippage below. Dataset {dataset.version.id.slice(0, 8)} · dividend-adjusted · costs {inputs.slippageBps} bps slippage{inputs.fixedFee > 0 ? ` + $${inputs.fixedFee}/trade` : ""} · taxes excluded.
      </div>
      <FlagList flags={[...new Map(results.flatMap((r) => r.flags).map((f) => [f.message, f])).values()]} />
    </div>
  );
}
