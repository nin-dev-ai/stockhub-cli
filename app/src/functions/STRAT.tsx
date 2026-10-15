import { useEffect, useMemo, useState } from "react";
import { useCopilotContext } from "@/copilot/context";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { CATALOG } from "@/quant/catalog";
import { compareResults, type SortKey } from "@/quant/ranking";
import { SCORECARD_CONFIG } from "@/quant/service";
import { forkStrategy, type StrategyDef } from "@/quant/strategy";
import { useBacktests } from "@/quant/useBacktests";
import { allStrategies, isDraft, MAX_BASKET, useStrategies } from "@/store/strategyStore";
import { useWorkspace } from "@/store/workspaceStore";
import { FlagList } from "@/components/quant/Badges";
import { StrategyCard } from "./strategies/StrategyCard";
import { StrategyDetail } from "./strategies/StrategyDetail";
import { ComparePanel } from "./strategies/ComparePanel";
import { DraftEditor } from "./strategies/DraftEditor";

type Panel = { kind: "detail"; id: string } | { kind: "compare" } | { kind: "editor"; def: StrategyDef; forkOf?: string } | null;

const SORTS: { key: SortKey; label: string }[] = [
  { key: "evidence", label: "Evidence & risk (default)" },
  { key: "sharpe", label: "Sharpe ratio" },
  { key: "drawdown", label: "Shallowest drawdown" },
  { key: "cagr", label: "CAGR" },
  { key: "name", label: "Name" },
];
const VERDICTS = ["consistent", "mixed", "inconsistent", "insufficient", "baseline"];
const RISKS = ["Lower", "Moderate", "Higher"];

function FilterGroup({ title, options, selected, toggle }: { title: string; options: string[]; selected: Set<string>; toggle: (v: string) => void }) {
  return (
    <div>
      <div className="sub-header mb-1">{title}</div>
      <div className="flex flex-col gap-0.5">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2 text-[11px] text-term-text cursor-pointer hover:text-term-amber">
            <input type="checkbox" checked={selected.has(o)} onChange={() => toggle(o)} className="accent-[#ff8c00]" />
            <span className="capitalize">{o}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function STRAT() {
  const openTab = useWorkspace((s) => s.openTab);
  const { basket, drafts, addToBasket, removeFromBasket, clearBasket, saveDraft, deleteDraft } = useStrategies();
  const defs = useMemo(() => allStrategies(drafts), [drafts]);
  const { dataset, results, errors, running } = useBacktests(defs, SCORECARD_CONFIG, { robustness: true });

  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [risks, setRisks] = useState<Set<string>>(new Set());
  const [verdicts, setVerdicts] = useState<Set<string>>(new Set());
  const [draftsOnly, setDraftsOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("evidence");
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void) => (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setter(next);
  };
  const allTags = useMemo(() => [...new Set(defs.flatMap((d) => d.tags))].sort((a, b) => a.localeCompare(b)), [defs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return defs
      .filter((d) => !draftsOnly || isDraft(d.id))
      .filter((d) => !q || `${d.name} ${d.summary} ${d.tags.join(" ")} ${d.universe.join(" ")}`.toLowerCase().includes(q))
      .filter((d) => tags.size === 0 || [...tags].every((t) => d.tags.includes(t)))
      .filter((d) => risks.size === 0 || (d.riskLevel != null && risks.has(d.riskLevel)))
      .filter((d) => verdicts.size === 0 || verdicts.has(results[d.id]?.robustness?.verdict ?? "none"))
      .map((d) => ({ d, r: results[d.id] }))
      .sort((a, b) => compareResults({ name: a.d.name, r: a.r }, { name: b.d.name, r: b.r }, sort));
  }, [defs, query, tags, risks, verdicts, draftsOnly, sort, results]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 3500); };
  const toggleBasket = (id: string) => {
    if (basket.includes(id)) { removeFromBasket(id); return; }
    const err = addToBasket(id);
    if (err) flash(err);
  };

  const fork = (d: StrategyDef) => {
    const root = d.id.replace(/_d\d+$/, "").slice(0, 50);
    let n = 1;
    while (defs.some((x) => x.id === `${root}_d${n}`)) n++;
    setPanel({ kind: "editor", def: forkStrategy(d, `${root}_d${n}`), forkOf: `${d.id} v${d.version}` });
  };

  const done = defs.filter((d) => results[d.id] || errors[d.id]).length;
  const basketDefs = basket.map((id) => defs.find((d) => d.id === id)).filter((d): d is StrategyDef => !!d);
  const basketResults = basketDefs.map((d) => results[d.id]).filter(Boolean);
  const ds = dataset.data?.version;
  const detailDef = panel?.kind === "detail" ? defs.find((d) => d.id === panel.id) : undefined;

  // the open strategy and its result are what the Copilot may explain
  const setCopilotStrategy = useCopilotContext((s) => s.setStrategy);
  const detailResult = detailDef ? results[detailDef.id] ?? null : null;
  useEffect(() => {
    setCopilotStrategy(detailDef ? { def: detailDef, result: detailResult, draft: isDraft(detailDef.id) } : null);
  }, [detailDef, detailResult, setCopilotStrategy]);
  useEffect(() => () => setCopilotStrategy(null), [setCopilotStrategy]);

  if (dataset.isError) {
    return (
      <div role="alert" className="p-8 max-w-xl flex flex-col gap-3">
        <div className="text-term-red text-[11px] uppercase tracking-[0.3em] font-bold">PRICE HISTORY UNAVAILABLE</div>
        <div className="text-term-text text-[12px]">Strategies need dividend-adjusted daily history from the data API: {(dataset.error as Error).message}</div>
        <button onClick={() => void dataset.refetch()} className="self-start px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle">Retry</button>
      </div>
    );
  }

  return (
    <div className="relative h-full flex min-h-0">
      <aside className="w-52 shrink-0 border-r border-term-border p-3 flex flex-col gap-4 overflow-auto scroll-thin text-[12px]">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-2 text-term-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search strategies"
            className="w-full bg-term-bg border border-term-border pl-7 pr-2 py-1 text-[12px] placeholder:text-term-muted focus:outline-none focus:border-term-amberDim" />
        </div>
        <div>
          <div className="sub-header mb-1">Sort by</div>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-full bg-term-bg border border-term-border text-[11px] py-1 text-term-text">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <div className="text-[10px] text-term-muted mt-1 leading-snug">Ranks robustness and risk first, not return alone.</div>
        </div>
        <FilterGroup title="Type" options={allTags} selected={tags} toggle={toggle(tags, setTags)} />
        <FilterGroup title="Risk level" options={RISKS} selected={risks} toggle={toggle(risks, setRisks)} />
        <FilterGroup title="Robustness" options={VERDICTS} selected={verdicts} toggle={toggle(verdicts, setVerdicts)} />
        <div>
          <div className="sub-header mb-1">Evidence status</div>
          <div className="text-[11px] text-term-text">Backtested</div>
          <div className="text-[10px] text-term-muted leading-snug">Paper-tracked and live-verified statuses need forward results; none exist yet.</div>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-term-text cursor-pointer">
          <input type="checkbox" checked={draftsOnly} onChange={() => setDraftsOnly((v) => !v)} className="accent-[#ff8c00]" /> My drafts only
        </label>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-term-border text-[11px] flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-term-amber font-bold tracking-widest">{visible.length} OF {defs.length} STRATEGIES</span>
          {dataset.isLoading && <span className="text-term-muted uppercase tracking-widest">Loading price history…</span>}
          {ds && (
            <span className="text-term-muted num">
              {running ? `Backtesting ${done}/${defs.length} · ` : ""}shared dataset {ds.id.slice(0, 8)} · {ds.start} → {ds.end} · {ds.tickers.length} ETFs · dividend-adjusted
            </span>
          )}
          <span className="text-term-muted">Historical tests, not forecasts. Rule-based, not advice.</span>
        </div>
        {ds && ds.qualityFlags.length > 0 && <div className="px-4 py-2 border-b border-term-borderSoft"><FlagList flags={ds.qualityFlags} /></div>}

        <div className="flex-1 overflow-auto scroll-thin p-3">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {visible.map(({ d, r }) => (
              <StrategyCard key={d.id} def={d} result={r} error={errors[d.id]} draft={isDraft(d.id)}
                inBasket={basket.includes(d.id)} selected={panel?.kind === "detail" && panel.id === d.id}
                onOpen={() => setPanel({ kind: "detail", id: d.id })} onToggleBasket={() => toggleBasket(d.id)} />
            ))}
          </div>
          {visible.length === 0 && <div className="text-term-muted p-6">No strategies match these filters.</div>}
          <div className="text-[10px] text-term-muted mt-4 max-w-3xl leading-relaxed">
            {CATALOG.length} curated strategies are tested on the same dates with identical cash flows and costs. Universe: US-listed ETFs in USD only.
            Indian instruments such as Nifty 50 are not offered because validated ETF, corporate-action and currency data is not available.
          </div>
        </div>

        <div className={cn("border-t border-term-border bg-term-panel2 px-4 py-2 flex flex-wrap items-center gap-3 text-[11px]", basket.length > 0 && "border-t-term-amberDim")}>
          <span className="sub-header">Basket {basket.length}/{MAX_BASKET}</span>
          {basketDefs.map((d) => (
            <span key={d.id} className="flex items-center gap-1 border border-term-amberDim px-2 py-0.5 text-term-amber">
              {d.name}
              <button onClick={() => removeFromBasket(d.id)} className="text-term-muted hover:text-term-red ml-1" aria-label={`Remove ${d.name}`}>×</button>
            </span>
          ))}
          {basket.length === 0 && <span className="text-term-muted">Add up to {MAX_BASKET} strategies with + to compare them.</span>}
          {notice && <span role="alert" className="text-term-red">{notice}</span>}
          <span className="ml-auto flex gap-2">
            <button disabled={basket.length < 2} onClick={() => setPanel({ kind: "compare" })}
              className="px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle disabled:opacity-30 disabled:cursor-not-allowed">Compare</button>
            <button disabled={basket.length < 1} onClick={() => openTab("LAB")}
              className="px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle disabled:opacity-30 disabled:cursor-not-allowed">Open in Lab</button>
            {basket.length > 0 && <button onClick={clearBasket} className="px-3 py-1 border border-term-border text-term-muted hover:text-term-text">Clear</button>}
          </span>
        </div>
      </div>

      {panel && (
        <div className="absolute top-0 right-0 bottom-0 w-[min(720px,92%)] z-30 shadow-panel">
          {panel.kind === "detail" && detailDef && (
            <StrategyDetail def={detailDef} result={results[detailDef.id]} draft={isDraft(detailDef.id)}
              onClose={() => setPanel(null)} onFork={() => fork(detailDef)}
              onEdit={() => setPanel({ kind: "editor", def: detailDef })}
              onDelete={() => { deleteDraft(detailDef.id); setPanel(null); }} />
          )}
          {panel.kind === "compare" && (
            <div className="h-full overflow-auto scroll-thin bg-term-panel border-l border-term-amberDim p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-term-amber text-[11px] tracking-[0.22em] font-bold">COMPARE BASKET</div>
                <button onClick={() => setPanel(null)} className="text-term-muted hover:text-term-red">×</button>
              </div>
              <ComparePanel results={basketResults} />
            </div>
          )}
          {panel.kind === "editor" && (
            <div className="h-full overflow-auto scroll-thin bg-term-panel border-l border-term-amberDim p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-term-amber text-[11px] tracking-[0.22em] font-bold">STRATEGY DRAFT</div>
                <button onClick={() => setPanel(null)} className="text-term-muted hover:text-term-red">×</button>
              </div>
              <DraftEditor initial={panel.def} forkOf={panel.forkOf}
                onSave={(d) => { saveDraft(d); setPanel({ kind: "detail", id: d.id }); }} onCancel={() => setPanel(null)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
