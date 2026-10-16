import { useMemo } from "react";
import { Badge } from "@/components/quant/Badges";
import { fmtRate } from "@/lib/format";
import type { LabInputs } from "@/quant/lab";
import { fitCandidate, ROLES, type Role } from "@/quant/plan";
import type { Sleeve, Weights } from "@/quant/portfolio";
import { useCandidates } from "@/quant/useCandidates";

/** The catalog ranked by how well each strategy fits the current plan, with its effect on the worst fall at a 25% share. */
export function AddStrategy({ inputs, sleeves, weights, roles, inPlan, full, onAdd, onClose }: {
  inputs: LabInputs; sleeves: Sleeve[]; weights: Weights; roles: Role[]; inPlan: string[]; full: boolean;
  onAdd: (origId: string, mappedId: string) => void; onClose: () => void;
}) {
  const c = useCandidates(inputs, true);
  const ranked = useMemo(() => (c.ready
    ? c.list.filter((x) => !inPlan.includes(x.id)).map((cand) => ({ cand, fit: fitCandidate(cand, { sleeves, weights, roles }, inputs.riskFreeRate) })).sort((a, b) => b.fit.score - a.fit.score)
    : []), [c.ready, c.list, inPlan, sleeves, weights, roles, inputs.riskFreeRate]);
  return (
    <div className="panel shrink-0 p-3 flex flex-col gap-2 border-term-amberDim text-[12px]">
      <div className="flex items-center gap-2">
        <span className="text-term-heading font-semibold">Add a strategy</span>
        <span className="text-[10px] text-term-muted">Best fit first: fills a missing job, behaves differently from the plan, held up across periods. The fall columns show the plan's worst fall now and with this strategy at 25%.</span>
        <button onClick={onClose} className="ml-auto text-[10px] text-term-muted hover:text-term-red uppercase tracking-widest">Close</button>
      </div>
      {full && <div className="text-term-amberBright text-[11px]">The plan is full. Remove a strategy first.</div>}
      {c.loading && <div className="text-term-muted uppercase tracking-widest text-[11px]">Testing the catalog on {inputs.etf}…</div>}
      {ranked.length > 0 && (
        <table className="w-full grid-data text-[11px]">
          <thead><tr><th>Job</th><th>Strategy</th><th>Why</th><th className="text-right">Fall now</th><th className="text-right">With it</th><th /></tr></thead>
          <tbody>{ranked.map(({ cand, fit }) => (
            <tr key={cand.id} className="align-top">
              <td><Badge tone={cand.role === "core" ? "green" : cand.role === "tactical" ? "cyan" : "amber"} title={ROLES[cand.role].blurb}>{ROLES[cand.role].label}</Badge></td>
              <td>{cand.name}</td>
              <td className="text-term-muted">{fit.reasons.join(" · ")}</td>
              <td className="num text-right">{fmtRate(fit.fallBefore)}</td>
              <td className={`num text-right ${fit.fallAfter != null && fit.fallBefore != null && fit.fallAfter > fit.fallBefore ? "up" : ""}`}>{fmtRate(fit.fallAfter)}</td>
              <td><button disabled={full} onClick={() => onAdd(cand.origId, cand.id)} className="px-2 py-0.5 border border-term-amber text-term-amber hover:bg-term-amberSubtle text-[11px] disabled:opacity-30">Add</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
