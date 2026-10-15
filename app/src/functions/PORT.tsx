import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/quant/Badges";
import { cn } from "@/lib/cn";
import { jobs } from "@/quant/jobs";
import { useCopilotContext } from "@/copilot/context";
import { MODE_LABEL, verifySnapshot, type PortfolioMode } from "@/quant/tracking";
import { useTracking } from "@/quant/useTracking";
import { snapshotsOf, usePortfolios } from "@/store/portfolioStore";
import { useWorkspace } from "@/store/workspaceStore";
import { JobBar } from "./lab/JobBar";
import { PortfolioList } from "./portfolio/PortfolioList";
import { OverviewView } from "./portfolio/OverviewView";
import { LedgerView } from "./portfolio/LedgerView";
import { SnapshotsView } from "./portfolio/SnapshotsView";

type Tab = "overview" | "ledger" | "snapshots";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Plan vs Observed" }, { key: "ledger", label: "Ledger" }, { key: "snapshots", label: "Snapshots" },
];

export const ModeBadge = ({ mode }: { mode: PortfolioMode }) =>
  <Badge tone={mode === "paper" ? "cyan" : "amber"} title={mode === "paper" ? "Hypothetical trades priced at market closes." : "Entered by you. StockHub has no broker connection and cannot verify these records."}>{MODE_LABEL[mode]}</Badge>;

export function PORT() {
  const openTab = useWorkspace((s) => s.openTab);
  const { portfolios, snapshots, selectedId, select } = usePortfolios();
  const p = portfolios.find((x) => x.id === selectedId) ?? portfolios[0] ?? null;
  const snaps = useMemo(() => (p ? snapshotsOf(p, snapshots) : []), [p, snapshots]);
  const t = useTracking(p, snaps);
  const [tab, setTab] = useState<Tab>("overview");
  // prices load on open and after each ledger change; identical requests reuse the cached job
  const { job, refresh } = t;
  useEffect(() => { if (p && !job) refresh(); }, [p, job, refresh]);

  const setCopilotPortfolio = useCopilotContext((s) => s.setPortfolio);
  const view = t.view;
  useEffect(() => {
    setCopilotPortfolio(p ? {
      name: p.name, mode: p.mode, snapshots: snaps.length, total: view?.holdings.total ?? null,
      contributed: view?.lastObs?.contributed ?? null, attribution: view?.attribution ?? null,
    } : null);
  }, [p, snaps.length, view, setCopilotPortfolio]);
  useEffect(() => () => setCopilotPortfolio(null), [setCopilotPortfolio]);

  if (portfolios.length === 0) {
    return (
      <div className="h-full flex min-h-0">
        <PortfolioList portfolios={[]} selected={null} onSelect={select} />
        <div className="p-8 max-w-xl flex flex-col gap-3 text-[12px]">
          <div className="text-term-amber text-[11px] uppercase tracking-[0.3em] font-bold">MY PORTFOLIO</div>
          <div className="text-term-heading text-[16px]">No saved plans yet.</div>
          <div className="text-term-text leading-relaxed">
            Run a projection in the Simulation Lab and choose Save Plan. StockHub stores the plan and its projection as a snapshot that never changes,
            then compares what happens next against it. You can also record holdings you already own on the left.
          </div>
          <div className="text-term-muted text-[11px]">Everything is stored in this browser only. There is no broker connection and no order execution.</div>
          <button onClick={() => openTab("LAB")} className="self-start px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle">Go to Simulation Lab</button>
        </div>
      </div>
    );
  }

  const intact = snaps.every(verifySnapshot);
  return (
    <div className="h-full flex min-h-0">
      <PortfolioList portfolios={portfolios} selected={p?.id ?? null} onSelect={select} />
      {p && (
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="px-4 py-2 border-b border-term-border flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-term-heading text-[13px]">{p.name}</span>
            <ModeBadge mode={p.mode} />
            {snaps.length > 0 && (intact
              ? <Badge tone="green" title="Each snapshot's content still matches the fingerprint taken when it was saved.">Snapshots intact</Badge>
              : <Badge tone="red" title="A stored snapshot no longer matches its fingerprint; it was altered outside the app.">Snapshot altered</Badge>)}
            {snaps.length === 0 && <Badge>Holdings only · no plan</Badge>}
            {t.view?.lastDate && <span className="ml-auto text-term-muted num">Prices through {t.view.lastDate}</span>}
            {(t.job?.status === "failed" || t.job?.status === "cancelled") && (
              <button onClick={() => t.refresh()} className={cn("px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle uppercase tracking-widest", !t.view?.lastDate && "ml-auto")}>Retry</button>
            )}
          </div>
          <div className="px-4 py-1 border-b border-term-borderSoft">
            <JobBar jobs={[t.job]} onCancel={() => t.job && jobs.cancel(t.job.id)} />
          </div>
          <div className="flex border-b border-term-border">
            {TABS.map((x) => (
              <button key={x.key} onClick={() => setTab(x.key)} className={cn("px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] border-r border-term-border",
                tab === x.key ? "text-term-amber bg-term-amberSubtle" : "text-term-muted hover:text-term-text")}>{x.label}</button>
            ))}
            <span className="ml-auto px-4 py-1.5 flex gap-2 items-center"><Badge>Informational · not advice</Badge></span>
          </div>
          <div className="flex-1 overflow-auto scroll-thin p-4">
            {tab === "overview" && <OverviewView p={p} snaps={snaps} t={t} />}
            {tab === "ledger" && <LedgerView p={p} lastDate={t.view?.lastDate ?? null} panel={t.data?.holdings?.panel ?? null} />}
            {tab === "snapshots" && <SnapshotsView p={p} snaps={snaps} t={t} />}
          </div>
        </div>
      )}
    </div>
  );
}
