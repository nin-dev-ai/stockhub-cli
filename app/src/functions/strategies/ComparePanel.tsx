import { SeriesChart } from "@/components/charts/SeriesChart";
import { FlagList } from "@/components/quant/Badges";
import { MetricsTable, UnavailableNotes } from "@/components/quant/MetricsTable";
import { twrIndex } from "@/quant/ranking";
import type { BacktestResult } from "@/quant/service";
import { CRISES, crisisFalls } from "@/quant/cardFacts";
import { fmtRate } from "@/lib/format";

const COLORS = ["#ff8c00", "#22ccee", "#22ee22", "#c084fc"];

export function ComparePanel({ results }: { results: BacktestResult[] }) {
  if (results.length < 2) return <div className="text-term-muted text-[12px]">Add at least two strategies to the basket to compare them.</div>;
  const base = results[0];
  const windows = new Set(results.map((r) => `${r.window.start}|${r.window.end}`));
  const cols = [
    ...results.map((r) => ({ label: r.strategy.name.length > 26 ? r.strategy.name.slice(0, 25) + "…" : r.strategy.name, run: r.run })),
    { label: `${base.benchmark.ticker} buy & hold`, run: base.benchmark.run },
  ];
  const series = [
    ...results.map((r, i) => ({ name: r.strategy.name, color: COLORS[i % COLORS.length], values: twrIndex(r.run.returns) })),
    { name: `${base.benchmark.ticker} buy & hold`, color: "#6e6e6e", values: twrIndex(base.benchmark.run.returns), dash: true },
  ];
  const flags = results.flatMap((r) => r.flags).filter((f, i, a) => a.findIndex((x) => x.message === f.message) === i);
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-term-text">
        Common window <span className="num text-term-amber">{base.window.start} → {base.window.end}</span> ({base.window.years.toFixed(1)} years)
        {windows.size > 1 ? <span className="text-term-red"> — windows differ; comparison is not like-for-like.</span> : " · same dates, price basis, costs and cash flows for every column."}
      </div>
      <SeriesChart dates={base.run.dates} series={series} height={240} log format={(v) => v.toFixed(0)} />
      <div className="sub-header">Growth of 100, time-weighted, log scale</div>
      <MetricsTable cols={cols} />
      <UnavailableNotes cols={cols} />
      <div className="sub-header">Falls in named crises (time-weighted, peak to trough inside each window)</div>
      <table className="w-full grid-data text-[11px]">
        <thead><tr><th>Crisis</th>{cols.map((c) => <th key={c.label} className="text-right">{c.label}</th>)}</tr></thead>
        <tbody>{CRISES.map((cr, i) => (
          <tr key={cr.id}><td>{cr.label}</td>{cols.map((c) => { const f = crisisFalls(c.run)[i].fall; return <td key={c.label} className="num text-right">{f == null ? "—" : fmtRate(f)}</td>; })}</tr>
        ))}</tbody>
      </table>
      <FlagList flags={flags} />
    </div>
  );
}
