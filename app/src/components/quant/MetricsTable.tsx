import { fmtMoney, fmtRate, fmtRatio } from "@/lib/format";
import type { SimResult } from "@/quant/backtest";
import type { Metrics } from "@/quant/types";

export interface MetricCol { label: string; run: SimResult }

type Row = { label: string; value: (r: SimResult) => string; reason?: (m: Metrics) => string | undefined; hint?: string };

const ROWS: Row[] = [
  { label: "Total return (time-weighted)", value: (r) => fmtRate(r.metrics.totalReturn), reason: (m) => m.unavailable.totalReturn },
  { label: "CAGR", value: (r) => fmtRate(r.metrics.cagr), reason: (m) => m.unavailable.cagr, hint: "Annualized time-weighted return; needs at least a year of data." },
  { label: "Volatility (annualized)", value: (r) => fmtRate(r.metrics.volatility), reason: (m) => m.unavailable.volatility },
  { label: "Sharpe ratio", value: (r) => fmtRatio(r.metrics.sharpe), reason: (m) => m.unavailable.sharpe, hint: "Excess return per unit of volatility, using the risk-free rate shown in the assumptions." },
  { label: "Sortino ratio", value: (r) => fmtRatio(r.metrics.sortino), reason: (m) => m.unavailable.sortino },
  { label: "Max drawdown", value: (r) => fmtRate(r.metrics.maxDrawdown), reason: (m) => m.unavailable.maxDrawdown, hint: "Largest peak-to-trough fall of the time-weighted return." },
  { label: "Longest time below peak (days)", value: (r) => (r.metrics.maxDrawdownDays == null ? "n/a" : String(r.metrics.maxDrawdownDays)) },
  { label: "Best / worst day", value: (r) => (r.metrics.bestDay == null ? "n/a" : `${fmtRate(r.metrics.bestDay)} / ${fmtRate(r.metrics.worstDay)}`) },
  { label: "Trades", value: (r) => String(r.tradeCount) },
  { label: "Turnover (per year)", value: (r) => (r.turnover == null ? "n/a" : `${(r.turnover * 100).toFixed(0)}%`), hint: "Traded notional divided by average portfolio value, annualized." },
  { label: "Costs paid", value: (r) => fmtMoney(r.costsPaid) },
  { label: "Money-weighted return", value: (r) => fmtRate(r.moneyWeightedReturn), hint: "Annualized IRR of the actual cash flows; reflects when money was added." },
  { label: "Total contributed", value: (r) => fmtMoney(r.totalContributed) },
  { label: "Final value", value: (r) => fmtMoney(r.finalValue) },
];

export function MetricsTable({ cols }: { cols: MetricCol[] }) {
  return (
    <table className="w-full grid-data text-[11px]">
      <thead>
        <tr>
          <th>Metric</th>
          {cols.map((c) => <th key={c.label} className="text-right">{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.label}>
            <td className="text-term-muted" title={row.hint}>{row.label}</td>
            {cols.map((c) => {
              const v = row.value(c.run);
              const why = row.reason?.(c.run.metrics);
              return <td key={c.label} className="num text-right" title={why}>{v}{v === "n/a" && why ? <span className="text-term-muted"> *</span> : null}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Explains any metric shown as n/a (hover text is not enough on touch screens). */
export function UnavailableNotes({ cols }: { cols: MetricCol[] }) {
  const notes = new Map<string, string>();
  for (const c of cols) for (const [k, v] of Object.entries(c.run.metrics.unavailable)) notes.set(`${c.label}: ${k}`, v);
  if (notes.size === 0) return null;
  return (
    <ul className="text-[10px] text-term-muted mt-2 space-y-0.5">
      {[...notes].map(([k, v]) => <li key={k}>* {k} — {v}</li>)}
    </ul>
  );
}
