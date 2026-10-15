import { useState } from "react";
import { cn } from "@/lib/cn";
import type { Portfolio } from "@/quant/tracking";
import { usePortfolios } from "@/store/portfolioStore";
import { useWorkspace } from "@/store/workspaceStore";

function Group({ title, note, items, selected, onSelect }: { title: string; note: string; items: Portfolio[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div>
      <div className="sub-header mb-1">{title}</div>
      {items.length === 0 && <div className="text-[10px] text-term-muted">{note}</div>}
      <ul className="flex flex-col gap-1">
        {items.map((p) => (
          <li key={p.id}>
            <button onClick={() => onSelect(p.id)} className={cn("w-full text-left px-2 py-1 border text-[11px]",
              selected === p.id ? "border-term-amber text-term-amber bg-term-amberSubtle" : "border-term-border text-term-text hover:border-term-amberDim")}>
              <div className="truncate">{p.name}</div>
              <div className="text-[10px] text-term-muted">{p.snapshotIds.length ? `${p.snapshotIds.length} snapshot${p.snapshotIds.length > 1 ? "s" : ""}` : "no plan"} · {p.transactions.length} entries</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Paper, manually reported and broker-reported records are listed apart so they are never confused (AC-12). */
export function PortfolioList({ portfolios, selected, onSelect, onBroker, brokerOpen }: {
  portfolios: Portfolio[]; selected: string | null; onSelect: (id: string) => void; onBroker: () => void; brokerOpen: boolean;
}) {
  const create = usePortfolios((s) => s.createPortfolio);
  const openTab = useWorkspace((s) => s.openTab);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const submit = () => {
    const r = create({ name, mode: "manual" });
    if ("error" in r) setErr(r.error);
    else { setName(""); setErr(null); setOpen(false); }
  };

  return (
    <aside className="w-56 shrink-0 border-r border-term-border p-3 flex flex-col gap-4 overflow-auto scroll-thin text-[12px]">
      <span className="text-term-amber text-[10px] tracking-[0.22em] font-bold">MY PORTFOLIO</span>
      <Group title="Paper plans" note="Save a plan from the Simulation Lab to follow it on paper." items={portfolios.filter((p) => p.mode === "paper")} selected={selected} onSelect={onSelect} />
      <Group title="Manually reported" note="Real holdings you enter yourself. Not broker-verified." items={portfolios.filter((p) => p.mode === "manual")} selected={selected} onSelect={onSelect} />
      <Group title="Broker-reported" note="Positions read from Interactive Brokers through its local gateway." items={portfolios.filter((p) => p.mode === "broker")} selected={selected} onSelect={onSelect} />
      <button onClick={onBroker} className={cn("self-start text-left text-[11px] hover:text-term-amber", brokerOpen ? "text-term-amber" : "text-term-muted")}>⇄ Interactive Brokers (read-only)</button>
      <button onClick={() => openTab("ORD")} className="self-start text-left text-[11px] text-term-muted hover:text-term-amber">→ Paper orders (IBKR paper account)</button>
      {open ? (
        <div className="flex flex-col gap-1 border-t border-term-border pt-2">
          <span className="sub-header">New manual holdings record</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Name"
            className="bg-term-bg border border-term-border px-2 py-1 text-[11px] focus:outline-none focus:border-term-amberDim" />
          <div className="text-[10px] text-term-muted">For holdings you already own, without a saved plan. To track against a plan, save it from the Lab as manually reported.</div>
          {err && <div role="alert" className="text-term-red text-[11px]">{err}</div>}
          <div className="flex gap-2">
            <button onClick={submit} className="px-2 py-0.5 border border-term-amber text-term-amber text-[11px]">Create</button>
            <button onClick={() => { setOpen(false); setErr(null); }} className="px-2 py-0.5 border border-term-border text-term-muted text-[11px]">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="self-start text-[11px] text-term-muted hover:text-term-amber">+ Record existing holdings</button>
      )}
      <div className="mt-auto text-[10px] text-term-muted leading-snug">Stored in this browser only. Reading IBKR is read-only; paper orders are sent only from Paper Orders, after your confirmation.</div>
    </aside>
  );
}
