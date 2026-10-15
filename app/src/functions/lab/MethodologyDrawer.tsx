import { X } from "lucide-react";
import { projectionCsv, type CalculationReport } from "@/quant/report";
import type { ProjectionResult } from "@/quant/projection";
import { download } from "@/lib/download";

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-3 py-1 border-b border-term-borderSoft text-[11px]"><span className="sub-header w-40 shrink-0">{k}</span><span className="text-term-text break-all">{v}</span></div>
);

export function MethodologyDrawer({ report, projection, onClose }: { report: CalculationReport; projection: ProjectionResult | null; onClose: () => void }) {
  const d = report.data, pr = report.projection, i = report.inputs;
  return (
    <div className="h-full overflow-auto scroll-thin bg-term-panel border-l border-term-amberDim">
      <div className="sticky top-0 bg-term-panel2 border-b border-term-border px-4 py-2 flex items-center justify-between">
        <span className="text-term-amber text-[11px] tracking-[0.22em] font-bold">CALCULATION REPORT</span>
        <button onClick={onClose} aria-label="Close"><X size={16} className="text-term-muted hover:text-term-red" /></button>
      </div>
      <div className="p-4 flex flex-col gap-4 text-[12px]">
        <div className="text-term-muted text-[11px]">{report.label}. Generated {report.generatedAt.slice(0, 16).replace("T", " ")} · engine {report.engineVersion}.</div>
        <div className="flex gap-2">
          <button onClick={() => download("stockhub-report.json", JSON.stringify(report, null, 2), "application/json")} className="px-2 py-1 border border-term-amberDim text-term-amber text-[11px]">Download JSON</button>
          <button disabled={!projection?.fan} onClick={() => projection && download("stockhub-projection.csv", projectionCsv(projection), "text/csv")} className="px-2 py-1 border border-term-border text-term-muted hover:text-term-amber disabled:opacity-30 text-[11px]">Download projection CSV</button>
        </div>
        <section>
          <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold mb-1">INPUTS</div>
          <Row k="Starting amount" v={`$${i.initial}${i.existing ? ` + $${i.existing} existing` : ""}`} />
          <Row k="Monthly contribution" v={`$${i.monthly}`} /><Row k="Horizon" v={`${i.years} years`} />
          <Row k="Objective" v={i.objective.replace("_", " ")} /><Row k="Max weight" v={`${(i.maxWeight * 100).toFixed(0)}%`} />
          <Row k="Weights" v={report.weights ? `${Object.entries(report.weights).map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`).join(", ")} (${report.weightsSource})` : "not yet chosen"} />
        </section>
        <section>
          <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold mb-1">DATA</div>
          {d ? <>
            <Row k="Dataset id" v={d.datasetId} /><Row k="Provider" v={d.provider} /><Row k="Price basis" v={d.priceBasis} />
            <Row k="Window" v={`${d.window.start} → ${d.window.end}`} /><Row k="Fetched" v={d.fetchedAt} />
          </> : <div className="text-term-muted text-[11px]">Run a backtest first.</div>}
        </section>
        <section>
          <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold mb-1">STRATEGIES</div>
          {report.strategies.map((s) => <Row key={s.id} k={`${s.id} v${s.version}`} v={<>definition {s.definitionHash} · backtest run {s.backtestRunId}</>} />)}
        </section>
        <section>
          <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold mb-1">COSTS AND EXCLUSIONS</div>
          <Row k="Slippage" v={`${report.costs.slippageBps} bps`} /><Row k="Fixed fee" v={`$${report.costs.fixedFee} per trade`} />
          <Row k="Shares" v={report.costs.fractionalShares ? "fractional" : "whole only"} /><Row k="Taxes" v={report.costs.taxes} />
          <Row k="Inflation" v={`${(i.inflation * 100).toFixed(1)}% per year (for real values)`} />
        </section>
        {report.optimization && <section>
          <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold mb-1">OPTIMIZATION</div>
          <Row k="Method" v={report.optimization.method} /><Row k="Run id" v={report.optimization.runId} />
          <Row k="Binding constraints" v={report.optimization.binding.length ? report.optimization.binding.map((b) => `${b.id} (${b.kind})`).join(", ") : "none"} />
        </section>}
        {pr && <section>
          <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold mb-1">PROJECTION</div>
          <Row k="Method" v={pr.method} /><Row k="Simulated paths" v={pr.paths} /><Row k="Random seed" v={pr.seed} />
          <Row k="Block length" v={`${pr.blockMonths} months`} /><Row k="Monthly observations" v={pr.observations} /><Row k="Run id" v={pr.runId} /><Row k="Data quality" v={pr.quality} />
          <ul className="list-disc pl-4 mt-2 text-[11px] text-term-muted space-y-0.5">{pr.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </section>}
        <section>
          <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold mb-1">WARNINGS</div>
          <ul className="list-disc pl-4 text-[11px] text-term-amberBright space-y-1">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}
