import { useMemo, useState } from "react";
import { Badge } from "@/components/quant/Badges";
import { fmtRate, fmtRatio } from "@/lib/format";
import { blendOf, type LabInputs } from "@/quant/lab";
import { ROLES, suggestPlan } from "@/quant/plan";
import type { Weights } from "@/quant/portfolio";
import { useCandidates } from "@/quant/useCandidates";

/**
 * "Build me a plan": tests the catalog on the user's ETF choice, picks a core plus sleeves that do
 * different jobs, and sets weights to the highest growth that keeps the worst fall inside the limit.
 * Shows the proposal first; nothing changes until the user applies it.
 */
export function BuildPlan({ inputs, fallLimit, onApply, onClose }: {
  inputs: LabInputs; fallLimit: number; onApply: (origIds: string[], weights: Weights) => void; onClose: () => void;
}) {
  const [on] = useState(true);
  const c = useCandidates(inputs, on);
  const s = useMemo(() => (c.ready ? suggestPlan(c.list, fallLimit, inputs.riskFreeRate, blendOf(inputs)) : null), [c.ready, c.list, fallLimit, inputs.riskFreeRate, inputs.rebalance, inputs.slippageBps]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = s ? s.ids.map((id) => ({ cand: c.list.find((x) => x.id === id)!, weight: s.weights[id] })) : [];
  return (
    <div className="panel shrink-0 p-3 flex flex-col gap-2 border-term-amberDim text-[12px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-term-heading font-semibold">A plan for a {(fallLimit * 100).toFixed(0)}% fall limit</span>
        <Badge tone="amber" title="Nothing changes until you click Use this plan">Proposal</Badge>
        <button onClick={onClose} className="ml-auto text-[10px] text-term-muted hover:text-term-red uppercase tracking-widest">Close</button>
      </div>
      {c.loading && <div className="text-term-muted uppercase tracking-widest text-[11px]">Testing the catalog on {inputs.etf}…</div>}
      {c.error && <div className="text-term-red text-[11px]">Could not load prices: {c.error}</div>}
      {c.ready && !s && <div className="text-term-muted text-[11px]">No core strategy with enough evidence was found, so no plan was proposed.</div>}
      {s && (
        <>
          <div className="overflow-x-auto scroll-thin">
          <table className="w-full grid-data text-[11px]">
            <thead><tr><th>Job</th><th>Strategy</th><th className="text-right">Weight</th><th className="text-right">CAGR</th><th className="text-right">Worst fall</th><th className="text-right">Sharpe</th></tr></thead>
            <tbody>{rows.map(({ cand, weight }) => (
              <tr key={cand.id}>
                <td><Badge tone={cand.role === "core" ? "green" : cand.role === "tactical" ? "cyan" : "amber"} title={ROLES[cand.role].blurb}>{ROLES[cand.role].label}</Badge></td>
                <td>{cand.name}</td><td className="num text-right">{(weight * 100).toFixed(0)}%</td>
                <td className="num text-right">{fmtRate(cand.metrics.cagr)}</td><td className="num text-right">{fmtRate(cand.metrics.maxDrawdown)}</td><td className="num text-right">{fmtRatio(cand.metrics.sharpe)}</td>
              </tr>
            ))}</tbody>
          </table>
          </div>
          <div className="text-[11px] text-term-text">
            Together: CAGR <span className="num text-term-amber">{fmtRate(s.metrics.cagr)}</span>, worst fall <span className="num text-term-amber">{fmtRate(s.metrics.maxDrawdown)}</span>, Sharpe <span className="num text-term-amber">{fmtRatio(s.metrics.sharpe)}</span>
            {s.withinLimit ? <span className="text-term-green"> · within your limit</span> : <span className="text-term-red"> · not within your limit</span>}.
          </div>
          {s.notes.map((n) => <div key={n} className="text-[11px] text-term-amberBright">{n}</div>)}
          <div className="text-[10px] text-term-muted">Chosen from history on the same data it is judged on, so treat it as a starting point, not a forecast. Edit the weights or swap sleeves afterwards.</div>
          <div className="flex gap-2">
            <button onClick={() => onApply(rows.map((r) => r.cand.origId), s.weights)} className="px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle text-[11px]">Use this plan</button>
            <button onClick={onClose} className="px-2 py-1 border border-term-border text-term-muted text-[11px]">Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
