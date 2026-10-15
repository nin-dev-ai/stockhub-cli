import { useEffect, useMemo, useState } from "react";
import { useCopilotContext } from "@/copilot/context";
import { Badge } from "@/components/quant/Badges";
import { cn } from "@/lib/cn";
import { buildReport } from "@/quant/report";
import { useLabEngine } from "@/quant/useLab";
import { findStrategy, useStrategies } from "@/store/strategyStore";
import { useLab } from "@/store/labStore";
import { useWorkspace } from "@/store/workspaceStore";
import type { StrategyDef } from "@/quant/strategy";
import { labStrategies } from "@/quant/lab";
import { InputsPane } from "./lab/InputsPane";
import { JobBar } from "./lab/JobBar";
import { BacktestView } from "./lab/BacktestView";
import { AllocationView } from "./lab/AllocationView";
import { ProjectionView } from "./lab/ProjectionView";
import { MethodologyDrawer } from "./lab/MethodologyDrawer";
import { SavePlanPanel } from "./lab/SavePlanPanel";

type Tab = "backtest" | "allocation" | "projection";
const TABS: { key: Tab; label: string }[] = [
  { key: "backtest", label: "Backtest" }, { key: "allocation", label: "Allocation" }, { key: "projection", label: "Projection" },
];

export function LAB() {
  const openTab = useWorkspace((s) => s.openTab);
  const { basket, drafts } = useStrategies();
  const { inputs, override, setInputs, setOverride, reset } = useLab();
  const basketDefs = useMemo(() => basket.map((id) => findStrategy(id, drafts)).filter((d): d is StrategyDef => !!d), [basket, drafts]);
  const defs = useMemo(() => labStrategies(basketDefs, inputs), [basketDefs, inputs.etf, inputs.alsoEtfs.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const eng = useLabEngine(defs, inputs, override);
  const [tab, setTab] = useState<Tab>("backtest");
  const [drawer, setDrawer] = useState<"report" | "save" | null>(null);

  const bundle = eng.bt?.result;
  const hasErrors = eng.errors.length > 0;
  const go = (t: Tab, fn: () => Promise<unknown> | unknown) => { setTab(t); void fn(); };

  const report = useMemo(() => buildReport({
    inputs, weights: eng.weights, weightsSource: eng.weightsSource as never,
    backtests: bundle?.results ?? [], optimization: eng.opt?.result ?? null, projection: eng.proj?.result ?? null,
  }), [inputs, eng.weights, eng.weightsSource, bundle, eng.opt?.result, eng.proj?.result]);

  const setCopilotLab = useCopilotContext((s) => s.setLab);
  useEffect(() => {
    setCopilotLab({
      inputs, weights: eng.weights, weightsSource: eng.weightsSource, backtests: bundle?.results ?? [],
      planMetrics: eng.plan?.metrics ?? null, optimization: eng.opt?.result ?? null, projection: eng.proj?.result ?? null,
    });
  }, [inputs, eng.weights, eng.weightsSource, bundle, eng.plan, eng.opt?.result, eng.proj?.result, setCopilotLab]);
  useEffect(() => () => setCopilotLab(null), [setCopilotLab]);

  if (defs.length === 0) {
    return (
      <div className="p-8 max-w-xl flex flex-col gap-3 text-[12px]">
        <div className="text-term-amber text-[11px] uppercase tracking-[0.3em] font-bold">SIMULATION LAB</div>
        <div className="text-term-heading text-[16px]">Pick up to three strategies first.</div>
        <div className="text-term-text leading-relaxed">The Lab backtests your basket with your own starting amount and contributions, proposes weights, and simulates a range of possible outcomes. Add strategies to the basket on the Strategies screen.</div>
        <button onClick={() => openTab("STRAT")} className="self-start px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle">Go to Strategies</button>
      </div>
    );
  }

  const btn = "px-3 py-1.5 border text-[11px] uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed";
  const proj = eng.proj?.result;
  const lastDate = bundle?.results[0]?.window.end ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="relative h-full flex min-h-0">
      <InputsPane inputs={inputs} set={setInputs} errors={eng.errors} onReset={reset}
        basketNames={defs.map((d) => ({ id: d.id, name: d.name }))}
        unchanged={defs.filter((d, k) => d === basketDefs[k] && (inputs.etf !== "SPY" || inputs.alsoEtfs.length > 0)).map((d) => d.name)} />

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-term-border flex flex-wrap items-center gap-2">
          <button disabled={hasErrors || eng.running} onClick={() => go("backtest", eng.runBacktest)} className={cn(btn, "border-term-amber text-term-amber hover:bg-term-amberSubtle")}>Run Backtest</button>
          <button disabled={hasErrors || eng.running || defs.length < 1} onClick={() => go("allocation", eng.runOptimize)} className={cn(btn, "border-term-amber text-term-amber hover:bg-term-amberSubtle")}>Optimize Allocation</button>
          <button disabled={hasErrors || eng.running} onClick={() => go("projection", eng.runProjection)} className={cn(btn, "border-term-amber text-term-amber hover:bg-term-amberSubtle")}>Run Projection</button>
          <button disabled={!proj?.fan || !bundle || !eng.weights || eng.running} onClick={() => setDrawer("save")}
            title={proj?.fan ? "Save inputs, weights and this projection as a snapshot in My Portfolio" : "Run a projection for the current inputs first"}
            className={cn(btn, "border-term-amber text-term-amber hover:bg-term-amberSubtle ml-auto")}>Save Plan</button>
          <button onClick={() => setDrawer("report")} className={cn(btn, "border-term-border text-term-muted hover:text-term-text")}>View Methodology</button>
        </div>
        <div className="px-4 py-2 border-b border-term-borderSoft"><JobBar jobs={[eng.bt, eng.opt, eng.proj]} onCancel={eng.cancel} />
          {!eng.bt && !eng.opt && !eng.proj && <div className="text-[11px] text-term-muted">Set your plan on the left, then run the backtest. Optimization and projection run the backtest first when needed.</div>}
        </div>
        <div className="flex border-b border-term-border">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cn("px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] border-r border-term-border",
              tab === t.key ? "text-term-amber bg-term-amberSubtle" : "text-term-muted hover:text-term-text")}>{t.label}</button>
          ))}
          <span className="ml-auto px-4 py-1.5 flex gap-2 items-center"><Badge>Informational · not advice</Badge></span>
        </div>

        <div className="flex-1 overflow-auto scroll-thin p-4">
          {tab === "backtest" && (bundle && eng.plan
            ? <BacktestView bundle={bundle} plan={eng.plan} inputs={inputs} />
            : <div className="text-term-muted text-[12px]">Run Backtest to see how this basket would have performed with your starting amount and contributions.</div>)}
          {tab === "allocation" && (bundle && eng.weights
            ? <AllocationView bundle={bundle} opt={eng.opt?.result ?? null} inputs={inputs} weights={eng.weights} weightsSource={eng.weightsSource}
                override={override} setOverride={setOverride} setObjective={(o) => setInputs({ objective: o })} />
            : <div className="text-term-muted text-[12px]">Run Optimize Allocation to see weight proposals, overlap and baselines.</div>)}
          {tab === "projection" && (proj
            ? <ProjectionView p={proj} start={lastDate} goal={inputs.goal} />
            : <div className="text-term-muted text-[12px]">Run Projection to simulate a range of outcomes for the current weights. Results can be re-run with different assumptions and are never overwritten.</div>)}
        </div>
      </div>

      {drawer && (
        <div className="absolute top-0 right-0 bottom-0 w-[min(640px,92%)] z-30 shadow-panel">
          {drawer === "report" && <MethodologyDrawer report={report} projection={proj ?? null} onClose={() => setDrawer(null)} />}
          {drawer === "save" && bundle && proj && eng.weights && (
            <SavePlanPanel bundle={bundle} projection={proj} inputs={inputs} weights={eng.weights} weightsSource={eng.weightsSource} onClose={() => setDrawer(null)} />
          )}
        </div>
      )}
    </div>
  );
}

