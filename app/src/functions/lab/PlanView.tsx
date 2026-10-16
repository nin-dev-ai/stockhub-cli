import { useMemo, useState } from "react";
import { Badge } from "@/components/quant/Badges";
import { cn } from "@/lib/cn";
import { fmtRate, fmtRatio } from "@/lib/format";
import { currentTargets } from "@/quant/backtest";
import type { LabInputs, PlanBacktest } from "@/quant/lab";
import { analyzeOverlap } from "@/quant/overlap";
import { assetClasses, checkPlan, planHoldings, planRole, ROLE_ORDER, ROLES, type FixAction, type PlanSleeve, type Role } from "@/quant/plan";
import type { Weights } from "@/quant/portfolio";
import type { BacktestBundle } from "@/quant/useLab";
import { AddStrategy } from "./AddStrategy";
import { BuildPlan } from "./BuildPlan";
import { MAX_BASKET } from "@/store/strategyStore";

const tone = (r: Role) => (r === "core" ? "green" : r === "tactical" ? "cyan" : "amber") as "green" | "cyan" | "amber";
const LEVEL = { issue: "border-term-red text-term-red", warn: "border-term-amberDim text-term-amberBright", good: "border-term-greenDim text-term-green" } as const;
const MARK = { issue: "✕", warn: "!", good: "✓" } as const;

export interface PlanActions {
  setWeight: (id: string, v: number) => void;
  equal: () => void;
  optimizer: () => void;
  remove: (mappedId: string) => void;
  add: (origId: string, mappedId: string) => void;
  apply: (origIds: string[], weights: Weights) => void;
}

/** The plan as a whole: what each strategy is for, what the mix holds today, and whether it makes sense. */
export function PlanView({ bundle, plan, inputs, set, weights, source, act }: {
  bundle: BacktestBundle; plan: PlanBacktest; inputs: LabInputs; set: (p: Partial<LabInputs>) => void;
  weights: Weights; source: string | null; act: PlanActions;
}) {
  const [panel, setPanel] = useState<"add" | "build" | null>(null);
  const results = bundle.results;
  const sleeves: PlanSleeve[] = results.map((r) => ({ id: r.strategy.id, name: r.strategy.name, role: planRole(r.strategy.definition), weight: weights[r.strategy.id] ?? 0, metrics: r.run.metrics }));
  const overlap = useMemo(() => analyzeOverlap(results.map((r) => ({ id: r.strategy.id, name: r.strategy.name, run: r.run })), weights), [results, weights]);
  const held = useMemo(() => planHoldings(results.map((r) => ({ weight: weights[r.strategy.id] ?? 0, targets: currentTargets(r.run) }))), [results, weights]);
  const classes = useMemo(() => assetClasses(held), [held]);
  const checks = useMemo(() => checkPlan({ sleeves, overlap, plan: plan.metrics, fallLimit: inputs.fallLimit }), [sleeves, overlap, plan.metrics, inputs.fallLimit]);
  const byRole = ROLE_ORDER.map((r) => ({ r, w: sleeves.filter((s) => s.role === r).reduce((t, s) => t + s.weight, 0) })).filter((x) => x.w > 0);
  const full = results.length >= MAX_BASKET;

  const fix = (a: FixAction) => (a.kind === "remove" ? act.remove(a.id) : setPanel("add"));
  const btn = "px-2 py-1 border text-[11px] disabled:opacity-30 disabled:cursor-not-allowed";
  const amber = `${btn} border-term-amber text-term-amber hover:bg-term-amberSubtle`;
  const muted = `${btn} border-term-border text-term-muted hover:text-term-amber`;

  return (
    <div className="flex flex-col gap-4 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-term-heading text-[14px] font-semibold">Your plan</span>
        <span className="text-term-muted">{results.length} {results.length === 1 ? "strategy" : "strategies"}</span>
        {byRole.map(({ r, w }) => <Badge key={r} tone={tone(r)} title={ROLES[r].blurb}>{ROLES[r].label} {(w * 100).toFixed(0)}%</Badge>)}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[11px]" title="The worst peak-to-trough fall you would accept. The plan is checked against it and Build me a plan stays inside it.">
            Worst fall I'd accept
            <input type="number" min={5} max={90} value={Math.round(inputs.fallLimit * 100)} onChange={(e) => set({ fallLimit: Number(e.target.value) / 100 })}
              className="w-14 bg-term-bg border border-term-border px-1 py-0.5 num text-right" />%
          </label>
          <button onClick={() => setPanel(panel === "build" ? null : "build")} className={amber}>Build me a plan</button>
          <button onClick={() => setPanel(panel === "add" ? null : "add")} disabled={full} title={full ? `A plan holds at most ${MAX_BASKET} strategies` : undefined} className={amber}>Add a strategy</button>
        </span>
      </div>

      {panel === "build" && <BuildPlan inputs={inputs} fallLimit={inputs.fallLimit} onApply={(ids, w) => { act.apply(ids, w); setPanel(null); }} onClose={() => setPanel(null)} />}
      {panel === "add" && (
        <AddStrategy inputs={inputs} sleeves={bundle.sleeves} weights={weights} roles={sleeves.filter((s) => s.weight >= 0.05).map((s) => s.role)} inPlan={sleeves.map((s) => s.id)} full={full}
          onAdd={(o, m) => { act.add(o, m); setPanel(null); }} onClose={() => setPanel(null)} />
      )}

      <table className="w-full grid-data text-[11px]">
        <thead><tr><th>Job</th><th>Strategy</th><th>Holds today</th><th className="text-right">Weight</th><th className="text-right">CAGR</th><th className="text-right">Worst fall</th><th className="text-right">Sharpe</th><th /></tr></thead>
        <tbody>
          {results.map((r) => {
            const id = r.strategy.id, s = sleeves.find((x) => x.id === id)!;
            const now = Object.entries(currentTargets(r.run)).sort((a, b) => b[1] - a[1]);
            return (
              <tr key={id} className="align-top">
                <td><Badge tone={tone(s.role)} title={ROLES[s.role].blurb}>{ROLES[s.role].label}</Badge></td>
                <td className="text-term-text">{r.strategy.name}</td>
                <td className="text-term-muted">{now.length ? now.map(([t, w]) => `${t} ${(w * 100).toFixed(0)}%`).join(", ") : "n/a"}</td>
                <td className="text-right whitespace-nowrap">
                  <input type="number" min={0} max={100} step={5} value={Math.round(s.weight * 100)} onChange={(e) => act.setWeight(id, Number(e.target.value) / 100)}
                    aria-label={`Weight of ${r.strategy.name}`} className="w-14 bg-term-bg border border-term-border px-1 py-0.5 num text-right" />%
                </td>
                <td className="num text-right">{fmtRate(r.run.metrics.cagr)}</td><td className="num text-right">{fmtRate(r.run.metrics.maxDrawdown)}</td><td className="num text-right">{fmtRatio(r.run.metrics.sharpe)}</td>
                <td><button onClick={() => act.remove(id)} aria-label={`Remove ${r.strategy.name}`} className="text-term-muted hover:text-term-red">×</button></td>
              </tr>
            );
          })}
          <tr className="text-term-amber">
            <td /><td>The plan together</td><td className="text-term-muted">{held.map((h) => `${h.ticker} ${(h.weight * 100).toFixed(0)}%`).join(", ")}</td>
            <td className="num text-right">100%</td><td className="num text-right">{fmtRate(plan.metrics.cagr)}</td>
            <td className={cn("num text-right", plan.metrics.maxDrawdown != null && plan.metrics.maxDrawdown < -inputs.fallLimit && "down")}>{fmtRate(plan.metrics.maxDrawdown)}</td><td className="num text-right">{fmtRatio(plan.metrics.sharpe)}</td><td />
          </tr>
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-term-muted">
        <span>Weights come from: {source ?? "n/a"}. Changing one rescales the others to keep 100%.</span>
        <button onClick={act.equal} className={muted}>Equal weights</button>
        <button onClick={act.optimizer} className={muted}>Optimizer weights</button>
      </div>

      <section className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <div>
          <div className="sub-header mb-1">What the plan holds today</div>
          {held.map((h) => (
            <div key={h.ticker} className="flex items-center gap-2 text-[11px] py-0.5">
              <span className="w-12 text-term-amber">{h.ticker}</span>
              <div className="flex-1 h-2 bg-term-bg border border-term-border"><div className="h-full bg-term-amber" style={{ width: `${Math.min(100, h.weight * 100)}%` }} /></div>
              <span className="num w-10 text-right">{(h.weight * 100).toFixed(0)}%</span>
            </div>
          ))}
          <div className="text-[10px] text-term-muted mt-1">Each strategy's current holdings times its weight. This is what Paper Orders rebalances to.</div>
        </div>
        <div>
          <div className="sub-header mb-1">By asset class</div>
          {classes.map((c) => (
            <div key={c.bucket} className="flex items-center gap-2 text-[11px] py-0.5">
              <span className="w-44 text-term-text truncate" title={c.label}>{c.label}</span>
              <div className="flex-1 h-2 bg-term-bg border border-term-border"><div className="h-full bg-term-cyan" style={{ width: `${Math.min(100, c.weight * 100)}%` }} /></div>
              <span className="num w-10 text-right">{(c.weight * 100).toFixed(0)}%</span>
            </div>
          ))}
          <div className="text-[10px] text-term-muted mt-1">From each ETF's broad asset-class makeup, not live fund holdings.</div>
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="sub-header">Does this plan make sense?</div>
        {checks.map((c) => (
          <div key={c.id} className={cn("border-l-2 pl-2 py-0.5 flex flex-wrap items-start gap-2", LEVEL[c.level])}>
            <span className="font-bold w-3">{MARK[c.level]}</span>
            <div className="flex-1 min-w-[260px]"><div className="text-term-text">{c.title}</div><div className="text-[11px] text-term-muted leading-snug">{c.detail}</div></div>
            {c.fix && <button onClick={() => fix(c.fix!.action)} className={amber}>{c.fix.label}</button>}
          </div>
        ))}
        {checks.length === 0 && <div className="text-term-muted text-[11px]">Nothing to report.</div>}
      </section>
      <div className="text-[10px] text-term-muted">Historical tests on the same data they are judged on; not a forecast and not advice.</div>
    </div>
  );
}
