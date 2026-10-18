import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { planTodo, type TodoKind } from "@/quant/planTodo";
import type { PlanSnapshot, Portfolio } from "@/quant/tracking";
import type { useTracking } from "@/quant/useTracking";
import { usePlanAlerts } from "@/store/planAlertStore";
import { useWorkspace } from "@/store/workspaceStore";

const MARK: Record<TodoKind, string> = { switch: "⇄", drift: "↕", rebalance: "↻", contribution: "+" };

/** "What needs doing" for a saved plan, one row per item with one action. */
export function TodoPanel({ p, original, t, onRebalance, onContribute }: {
  p: Portfolio; original: PlanSnapshot; t: ReturnType<typeof useTracking>; onRebalance: () => void; onContribute: (amount: number) => void;
}) {
  const openTab = useWorkspace((s) => s.openTab);
  const { alerts, muted, toggleMute } = usePlanAlerts();
  const data = t.data;
  const items = useMemo(() => (data?.plan && data.holdings
    ? planTodo({ portfolio: p, original, results: data.plan.results, targets: data.plan.targets, panel: data.holdings.panel }) : []), [p, original, data]);
  if (!data?.plan) return null;
  const btn = "px-2 py-0.5 border border-term-amberDim text-term-amber hover:bg-term-amberSubtle text-[11px] shrink-0";
  return (
    <div className={cn("border p-3 flex flex-col gap-1.5 text-[11px]", items.length ? "border-term-amberDim" : "border-term-border")}>
      <div className="flex items-center gap-2">
        <span className="sub-header">What needs doing</span>
        <span className="text-term-muted">{items.length ? `${items.length} item${items.length > 1 ? "s" : ""}` : "Nothing: the plan is on track."}</span>
        {alerts && (
          <label className="ml-auto flex items-center gap-1 text-[10px] text-term-muted cursor-pointer">
            <input type="checkbox" checked={!muted.includes(p.id)} onChange={() => toggleMute(p.id)} className="accent-[#ff8c00]" /> Alerts for this plan
          </label>
        )}
      </div>
      {items.map((i) => (
        <div key={i.key} className="flex items-start gap-2 border-l-2 border-term-amberDim pl-2 py-0.5">
          <span className="w-3 text-term-amber">{MARK[i.kind]}</span>
          <div className="flex-1 min-w-0"><div className="text-term-text">{i.title}</div><div className="text-[10px] text-term-muted">{i.detail}</div></div>
          {p.mode === "paper"
            ? (i.kind === "contribution"
              ? <button className={btn} onClick={() => onContribute(original.inputs.monthly)}>Record contribution</button>
              : <button className={btn} onClick={onRebalance}>Rebalance on paper</button>)
            : i.kind !== "contribution" && <button className={btn} onClick={() => openTab("ORD")}>Open Paper Orders</button>}
        </div>
      ))}
    </div>
  );
}
