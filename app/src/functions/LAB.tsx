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
import { equalWeights, type Weights } from "@/quant/portfolio";
import { defaultPlanName, setWeight } from "@/quant/plan";
import { usePortfolios } from "@/store/portfolioStore";
import { PlanView, type PlanActions } from "./lab/PlanView";
import { BuildPlan } from "./lab/BuildPlan";
import { InputsPane } from "./lab/InputsPane";
import { JobBar } from "./lab/JobBar";
import { BacktestView } from "./lab/BacktestView";
import { AllocationView } from "./lab/AllocationView";
import { ProjectionView } from "./lab/ProjectionView";
import { MethodologyDrawer } from "./lab/MethodologyDrawer";
import { SavePlanPanel } from "./lab/SavePlanPanel";

type Tab = "plan" | "backtest" | "allocation" | "projection";
const TABS: { key: Tab; label: string }[] = [
  { key: "plan", label: "Plan" }, { key: "backtest", label: "Backtest" }, { key: "allocation", label: "Allocation" }, { key: "projection", label: "Projection" },
];

export function LAB() {
  const openTab = useWorkspace((s) => s.openTab);
  const { basket, drafts, setBasket } = useStrategies();
  const { inputs, override, setInputs, setOverride, reset } = useLab();
  const basketDefs = useMemo(() => basket.map((id) => findStrategy(id, drafts)).filter((d): d is StrategyDef => !!d), [basket, drafts]);
  const defs = useMemo(() => labStrategies(basketDefs, inputs), [basketDefs, inputs.etf, inputs.alsoEtfs.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const eng = useLabEngine(defs, inputs, override);
  const [tab, setTab] = useState<Tab>("plan");
  const [building, setBuilding] = useState(false);
  const [drawer, setDrawer] = useState<"report" | "save" | null>(null);
  // Save asks for a projection; when none exists yet, Save runs one and opens the panel when it is ready
  const [wantSave, setWantSave] = useState(false);
  const portfolios = usePortfolios((s) => s.portfolios);

  const bundle = eng.bt?.result;
  const hasErrors = eng.errors.length > 0;
  // each tab runs what it shows the first time it is opened
  const openLabTab = (t: Tab) => {
    setTab(t);
    if (hasErrors) return;
    if (t === "allocation" && !eng.opt) void eng.runOptimize();
    if (t === "projection" && !eng.proj) void eng.runProjection();
  };

  // the Plan tab is always live: run the backtest for any change of strategies or inputs
  useEffect(() => { if (defs.length > 0 && !hasErrors && !eng.bt) void eng.runBacktest(); }, [defs.length, hasErrors, eng.bt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!wantSave) return;
    if (eng.proj?.result?.fan) { setWantSave(false); setDrawer("save"); }
    else if (eng.proj && eng.proj.status !== "running" && eng.proj.status !== "done") setWantSave(false);
  }, [wantSave, eng.proj, eng.proj?.status, eng.proj?.result]); // jobs update in place, so watch their fields

  const origOf = (mappedId: string) => basketDefs[defs.findIndex((d) => d.id === mappedId)]?.id;
  const act: PlanActions = {
    setWeight: (id, v) => eng.weights && setOverride(setWeight(eng.weights, id, v)),
    equal: () => bundle && setOverride(equalWeights(bundle.sleeves.map((s) => s.id))),
    optimizer: () => { setOverride(null); void eng.runOptimize(); },
    remove: (mappedId) => {
      const orig = origOf(mappedId);
      if (!orig || !eng.weights) return;
      const rest: Weights = Object.fromEntries(Object.entries(eng.weights).filter(([k]) => k !== mappedId));
      const sum = Object.values(rest).reduce((a, b) => a + b, 0);
      setBasket(basket.filter((b) => b !== orig));
      setOverride(sum > 1e-9 ? Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v / sum])) : null);
    },
    add: (origId, mappedId) => {
      if (!eng.weights) return;
      setBasket([...basket, origId]);
      setOverride({ ...Object.fromEntries(Object.entries(eng.weights).map(([k, v]) => [k, v * 0.75])), [mappedId]: 0.25 });
    },
    apply: (origIds, weights) => { setBasket(origIds); setOverride(weights); },
  };

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
        <div className="text-term-heading text-[16px]">Build a plan from up to five strategies.</div>
        <div className="text-term-text leading-relaxed">A plan pairs strategies that do different jobs: a core that grows the money, something tactical that sidesteps big falls, and a diversifier that spreads the risk. The Lab shows what the plan holds, checks that it makes sense, then backtests it with your own amounts and simulates a range of outcomes.</div>
        <label className="flex items-center gap-2 text-[11px]">Worst fall I'd accept
          <input type="number" min={5} max={90} value={Math.round(inputs.fallLimit * 100)} onChange={(e) => setInputs({ fallLimit: Number(e.target.value) / 100 })} className="w-14 bg-term-bg border border-term-border px-1 py-0.5 num text-right" />%
        </label>
        <div className="flex gap-2">
          <button onClick={() => setBuilding(true)} className="px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle">Build me a plan</button>
          <button onClick={() => openTab("STRAT")} className="px-3 py-1 border border-term-border text-term-muted hover:text-term-amber">Pick strategies myself</button>
        </div>
        {building && <BuildPlan inputs={inputs} fallLimit={inputs.fallLimit} onApply={(ids, w) => { act.apply(ids, w); setBuilding(false); }} onClose={() => setBuilding(false)} />}
      </div>
    );
  }

  const btn = "px-3 py-1.5 border text-[11px] uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed";
  const proj = eng.proj?.result;
  const startSave = () => {
    if (proj?.fan) { setDrawer("save"); return; }
    setWantSave(true);
    void eng.runProjection();
  };
  const lastDate = bundle?.results[0]?.window.end ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="relative h-full flex min-h-0">
      <InputsPane inputs={inputs} set={setInputs} errors={eng.errors} onReset={reset}
        basketNames={defs.map((d) => ({ id: d.id, name: d.name }))}
        unchanged={defs.filter((d, k) => d === basketDefs[k] && (inputs.etf !== "SPY" || inputs.alsoEtfs.length > 0)).map((d) => d.name)} />

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-term-border flex flex-wrap items-center gap-2">
          <Steps steps={[
            { label: `Strategies (${defs.length})`, done: true, onClick: () => openTab("STRAT") },
            { label: "Check the plan", done: !!bundle, onClick: () => setTab("plan") },
            { label: "Save", done: false, onClick: startSave },
            { label: "Follow in My Portfolio", done: false, onClick: () => openTab("PORT") },
          ]} />
          <button disabled={hasErrors || !bundle || !eng.weights || wantSave} onClick={startSave}
            title="Save inputs, weights and a projection as a snapshot in My Portfolio; runs the projection first if needed"
            className={cn(btn, "border-term-amber text-term-amber hover:bg-term-amberSubtle ml-auto")}>{wantSave ? "Preparing…" : "Save Plan"}</button>
          <button onClick={() => setDrawer("report")} className={cn(btn, "border-term-border text-term-muted hover:text-term-text")}>View Methodology</button>
        </div>
        <div className="px-4 py-2 border-b border-term-borderSoft"><JobBar jobs={[eng.bt, eng.opt, eng.proj]} onCancel={eng.cancel} />
          {!eng.bt && !eng.opt && !eng.proj && <div className="text-[11px] text-term-muted">Testing your plan on history. The other tabs run their part when you open them.</div>}
        </div>
        <div className="flex border-b border-term-border">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => openLabTab(t.key)} className={cn("px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] border-r border-term-border",
              tab === t.key ? "text-term-amber bg-term-amberSubtle" : "text-term-muted hover:text-term-text")}>{t.label}</button>
          ))}
          <span className="ml-auto px-4 py-1.5 flex gap-2 items-center"><Badge>Informational · not advice</Badge></span>
        </div>

        <div className="flex-1 overflow-auto scroll-thin p-4">
          {tab === "plan" && (bundle && eng.plan && eng.weights
            ? <PlanView bundle={bundle} plan={eng.plan} inputs={inputs} set={setInputs} weights={eng.weights} source={eng.weightsSource} act={act} />
            : <div className="text-term-muted text-[12px]">{hasErrors ? "Fix the plan inputs on the left." : "Testing your plan on history…"}</div>)}
          {tab === "backtest" && (bundle && eng.plan
            ? <BacktestView bundle={bundle} plan={eng.plan} inputs={inputs} />
            : <div className="text-term-muted text-[12px]">{hasErrors ? "Fix the plan inputs on the left." : "Testing your plan on history…"}</div>)}
          {tab === "allocation" && (bundle && eng.weights
            ? <AllocationView bundle={bundle} opt={eng.opt?.result ?? null} inputs={inputs} weights={eng.weights} weightsSource={eng.weightsSource}
                override={override} setOverride={setOverride} setObjective={(o) => setInputs({ objective: o })} />
            : <div className="text-term-muted text-[12px]">{hasErrors ? "Fix the plan inputs on the left." : "Comparing weightings…"}</div>)}
          {tab === "projection" && (proj
            ? <ProjectionView p={proj} start={lastDate} goal={inputs.goal} />
            : <div className="text-term-muted text-[12px]">{hasErrors ? "Fix the plan inputs on the left." : "Simulating a range of outcomes for the current weights…"}</div>)}
        </div>
      </div>

      {drawer && (
        <div className="absolute top-0 right-0 bottom-0 w-[min(640px,92%)] z-30 shadow-panel">
          {drawer === "report" && <MethodologyDrawer report={report} projection={proj ?? null} onClose={() => setDrawer(null)} />}
          {drawer === "save" && bundle && proj && eng.weights && (
            <SavePlanPanel bundle={bundle} projection={proj} inputs={inputs} weights={eng.weights} weightsSource={eng.weightsSource} defaultName={defaultPlanName(inputs.fallLimit, portfolios.map((p) => p.name))} onClose={() => setDrawer(null)} />
          )}
        </div>
      )}
    </div>
  );
}


/** The Lab's path from strategies to a followed plan; each step is a button. */
function Steps({ steps }: { steps: { label: string; done: boolean; onClick: () => void }[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1">
          {i > 0 && <span className="text-term-muted">→</span>}
          <button onClick={s.onClick} className={cn("px-2 py-1 border", s.done ? "border-term-greenDim text-term-green" : "border-term-border text-term-text hover:border-term-amberDim hover:text-term-amber")}>
            <span className="num mr-1">{s.done ? "✓" : i + 1}</span>{s.label}
          </button>
        </li>
      ))}
    </ol>
  );
}
