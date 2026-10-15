import { SeriesChart } from "@/components/charts/SeriesChart";
import { Badge } from "@/components/quant/Badges";
import { fmtMoney } from "@/lib/format";
import type { ProjectionResult } from "@/quant/projection";
import { futureDates } from "@/quant/report";

const PCT = (x: number | null) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);

export function ProjectionView({ p, start, goal }: { p: ProjectionResult; start: string; goal: number | null }) {
  const tone = p.quality === "adequate" ? "green" : p.quality === "limited" ? "amber" : "red";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone="cyan">Future simulation (model-based)</Badge>
        <Badge tone={tone}>Data quality: {p.quality}</Badge>
        <span className="text-[11px] text-term-muted">A range of possibilities conditional on the method and history, not a prediction.</span>
      </div>
      {p.reasons.length > 0 && <ul role="alert" className="text-term-amberBright text-[11px] list-disc pl-4 space-y-0.5">{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}

      {p.fan && p.ending && p.endingReal ? (
        <>
          <SeriesChart
            dates={futureDates(start, p.months)} height={260} format={(v) => fmtMoney(v)}
            bands={[{ name: "10th–90th percentile range", lower: p.fan.p10, upper: p.fan.p90, color: "#22ccee", opacity: 0.22 }]}
            series={[
              { name: "Median (50th percentile)", color: "#ff8c00", values: p.fan.p50, width: 2 },
              { name: "Lower (10th percentile)", color: "#22ccee", values: p.fan.p10, dash: true, width: 1 },
              { name: "Upper (90th percentile)", color: "#22ee22", values: p.fan.p90, dash: true, width: 1 },
              { name: "Money you put in", color: "#6e6e6e", values: p.fan.contributed, dash: true },
            ]}
            markerDate={start} markerLabel="today" />
          <div className="text-[10px] text-term-muted">
            The lower line is the 10th percentile: about 1 in 10 simulated paths ended below it. It is not a worst case. The upper line is not a maximum.
          </div>

          <table className="w-full grid-data text-[11px]">
            <thead><tr><th>After {p.input.years} years</th><th className="text-right">Lower (10th)</th><th className="text-right">Median</th><th className="text-right">Upper (90th)</th></tr></thead>
            <tbody>
              <tr><td>Ending balance</td>{[p.ending.p10, p.ending.p50, p.ending.p90].map((v, i) => <td key={i} className="num text-right">{fmtMoney(v)}</td>)}</tr>
              <tr><td className="text-term-muted">In today's money ({(p.input.inflation * 100).toFixed(1)}% inflation)</td>{[p.endingReal.p10, p.endingReal.p50, p.endingReal.p90].map((v, i) => <td key={i} className="num text-right">{fmtMoney(v)}</td>)}</tr>
              <tr><td className="text-term-muted">Total you contribute</td>{[0, 1, 2].map((i) => <td key={i} className="num text-right">{fmtMoney(p.totalContributed)}</td>)}</tr>
              <tr><td>Gain or loss</td>{[p.ending.p10, p.ending.p50, p.ending.p90].map((v, i) => <td key={i} className={`num text-right ${v - p.totalContributed >= 0 ? "up" : "down"}`}>{fmtMoney(v - p.totalContributed)}</td>)}</tr>
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="border border-term-border p-2">
              <div className="sub-header">Chance of ending below what you put in</div>
              <div className="num text-[16px] text-term-heading">{PCT(p.probLoss)}</div>
              <div className="text-[10px] text-term-muted">Share of simulated paths. Conditional on this model and history.</div>
            </div>
            <div className="border border-term-border p-2">
              <div className="sub-header">{goal ? `Chance of reaching ${fmtMoney(goal)}` : "Goal"}</div>
              <div className="num text-[16px] text-term-heading">{goal ? PCT(p.probGoal) : "not set"}</div>
              <div className="text-[10px] text-term-muted">{goal ? "Share of simulated paths at or above your goal." : "Set a goal under Advanced assumptions."}</div>
            </div>
          </div>

          <div>
            <div className="sub-header mb-1">Sensitivity and stress scenarios (ending balance)</div>
            <table className="w-full grid-data text-[11px]">
              <thead><tr><th>Scenario</th><th className="text-right">Lower (10th)</th><th className="text-right">Median</th><th className="text-right">Upper (90th)</th><th className="text-right">Below contributions</th></tr></thead>
              <tbody>{p.scenarios.map((s) => (
                <tr key={s.key} title={s.description}>
                  <td>{s.label}<div className="text-[10px] text-term-muted">{s.description}</div></td>
                  <td className="num text-right">{fmtMoney(s.ending.p10)}</td><td className="num text-right">{fmtMoney(s.ending.p50)}</td><td className="num text-right">{fmtMoney(s.ending.p90)}</td>
                  <td className="num text-right">{PCT(s.probLoss)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="border border-term-red/40 bg-term-red/5 p-3 text-[12px] text-term-text">No projection is shown because the history cannot support one. See the reasons above.</div>
      )}
      <ul className="text-[10px] text-term-muted list-disc pl-4 space-y-0.5">{p.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
    </div>
  );
}
