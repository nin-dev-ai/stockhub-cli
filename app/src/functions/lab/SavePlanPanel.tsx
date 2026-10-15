import { useState } from "react";
import { X } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import type { LabInputs } from "@/quant/lab";
import type { Weights } from "@/quant/portfolio";
import type { ProjectionResult } from "@/quant/projection";
import { MODE_LABEL, rebalanceTrades, snapshotFrom, type PortfolioMode, type TxDraft } from "@/quant/tracking";
import type { BacktestBundle } from "@/quant/useLab";
import { usePortfolios } from "@/store/portfolioStore";
import { useWorkspace } from "@/store/workspaceStore";

interface Props {
  bundle: BacktestBundle;
  projection: ProjectionResult;
  inputs: LabInputs;
  weights: Weights;
  weightsSource: string | null;
  onClose: () => void;
}

/** Saves the plan with an immutable projection snapshot as a paper or manually reported portfolio (POR-01, POR-04). */
export function SavePlanPanel({ bundle, projection, inputs, weights, weightsSource, onClose }: Props) {
  const create = usePortfolios((s) => s.createPortfolio);
  const openTab = useWorkspace((s) => s.openTab);
  const [name, setName] = useState(`Plan ${new Date().toISOString().slice(0, 10)}`);
  const [mode, setMode] = useState<PortfolioMode>("paper");
  const [fund, setFund] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const asOf = bundle.results[0].window.end;
  const start = inputs.initial + inputs.existing;

  const save = () => {
    try {
      const snapshot = (portfolioId: string) => snapshotFrom({
        kind: "original", portfolioId, parentId: null, createdAt: new Date().toISOString(),
        inputs, weights, weightsSource, backtests: bundle.results, projection,
      });
      let opening: TxDraft[] = [];
      if (mode === "paper" && fund && start > 0) {
        // fund at the snapshot's start and buy the plan's current targets at that close
        const probe = snapshot("probe");
        const contribution: TxDraft = { date: asOf, kind: "contribution", amount: start, fee: 0, note: "Plan starting amount" };
        const asTx = [{ ...contribution, id: "c", createdAt: "0", amount: start }];
        opening = [contribution, ...rebalanceTrades(asTx, bundle.dataset.panel, probe.targets, asOf, inputs.fixedFee)];
      }
      const r = create({ name, mode, snapshot, opening });
      if ("error" in r) { setError(r.error); return; }
      onClose();
      openTab("PORT");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="h-full overflow-auto scroll-thin bg-term-panel border-l border-term-amberDim">
      <div className="sticky top-0 bg-term-panel2 border-b border-term-border px-4 py-2 flex items-center justify-between">
        <span className="text-term-amber text-[11px] tracking-[0.22em] font-bold">SAVE PLAN</span>
        <button onClick={onClose} aria-label="Close"><X size={16} className="text-term-muted hover:text-term-red" /></button>
      </div>
      <div className="p-4 flex flex-col gap-3 text-[12px]">
        <div className="text-term-text leading-relaxed">
          Saves these inputs, weights, strategy versions and the current projection as a snapshot that never changes. My Portfolio then compares what happens next against it.
        </div>
        <label className="flex flex-col gap-0.5"><span className="sub-header">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="bg-term-bg border border-term-border px-2 py-1 focus:outline-none focus:border-term-amberDim" /></label>
        <div className="flex flex-col gap-1">
          <span className="sub-header">Track as</span>
          {(["paper", "manual", "broker"] as PortfolioMode[]).map((m) => (
            <label key={m} className="flex items-start gap-2 text-[11px] cursor-pointer">
              <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="accent-[#ff8c00] mt-0.5" />
              <span><span className="text-term-text">{MODE_LABEL[m]}</span><br /><span className="text-term-muted">
                {m === "paper" ? "Hypothetical trades at market closes. Follow the plan without real money."
                  : m === "manual" ? "You enter the real contributions and trades you make. StockHub cannot verify them."
                  : "Sync your Interactive Brokers positions into it from My Portfolio (read-only). Deposits are not visible, so new holdings count as money in."}
              </span></span>
            </label>
          ))}
        </div>
        {mode === "paper" && start > 0 && (
          <label className="flex items-start gap-2 text-[11px] cursor-pointer">
            <input type="checkbox" checked={fund} onChange={(e) => setFund(e.target.checked)} className="accent-[#ff8c00] mt-0.5" />
            <span>Fund with {fmtMoney(start)} and buy the plan's current targets at the {asOf} close.</span>
          </label>
        )}
        <div className="text-[11px] text-term-muted">
          Projection: {projection.input.years} years, {projection.input.method}, {projection.input.paths.toLocaleString()} paths, seed {projection.input.seed}. Starts from data through {asOf}.
        </div>
        {error && <div role="alert" className="text-term-red text-[11px]">{error}</div>}
        <div className="flex gap-2">
          <button onClick={save} className="px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle">Save plan</button>
          <button onClick={onClose} className="px-3 py-1 border border-term-border text-term-muted">Cancel</button>
        </div>
      </div>
    </div>
  );
}
