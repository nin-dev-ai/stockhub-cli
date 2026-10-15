import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetchForm13F, fetchInsiderTrades } from "@/lib/api";
import { Badge } from "@/components/quant/Badges";
import {
  byRecency, customFund, customInsider, FUND_NOTE, fundChanges, matchesInsider, normalizeInsider, summarize,
  type Persona, type PersonaTrade,
} from "@/quant/personas";
import { allPersonas, usePersonas } from "@/store/personaStore";
import { useWorkspace } from "@/store/workspaceStore";

const SIDE_TONE: Record<PersonaTrade["side"], string> = { buy: "up", sell: "down", other: "text-term-muted" };
const STALE_DAYS = 270;

const sourceKey = (p: Persona) => (p.source.kind === "fund" ? `13f:${p.source.cik}` : `form4:${p.source.symbol}`);
const money = (v: number | null) => (v == null ? "" : `$${Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.round(v).toLocaleString("en-US")}`);
const qtr = (d: string | null) => (d ? `Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1} ${d.slice(0, 4)}` : "n/a");

interface PersonaData { trades: PersonaTrade[]; latest: string | null; prior: string | null; holdings: number | null; error: string | null; loading: boolean }

function PersonaRow({ p, on, onToggle, onRemove }: { p: Persona; on: boolean; onToggle: () => void; onRemove?: () => void }) {
  return (
    <div className={cn("border px-2 py-1.5 text-[11px]", on ? "border-term-amber bg-term-amberSubtle" : "border-term-border")}>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={on} onChange={onToggle} className="accent-[#ff8c00] mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className={cn("block font-semibold", on ? "text-term-amber" : "text-term-text")}>{p.name}</span>
          <span className="block text-term-muted text-[10px]">{p.role}</span>
        </span>
        {onRemove && <button onClick={(e) => { e.preventDefault(); onRemove(); }} className="text-term-muted hover:text-term-red" aria-label={`Remove ${p.name}`}>×</button>}
      </label>
    </div>
  );
}

function AddForm() {
  const addCustom = usePersonas((s) => s.addCustom);
  const [kind, setKind] = useState<"insider" | "fund">("insider");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const p = kind === "fund" ? customFund(name, id) : customInsider(name, id);
  const input = "bg-term-bg border border-term-border px-2 py-1 text-[11px] placeholder:text-term-muted focus:outline-none focus:border-term-amberDim";
  return (
    <div className="border-t border-term-border pt-2 flex flex-col gap-1">
      <div className="sub-header">Add a persona</div>
      <div className="flex gap-1">
        {(["insider", "fund"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cn("flex-1 border text-[10px] py-0.5 uppercase tracking-widest", kind === k ? "border-term-amber text-term-amber" : "border-term-border text-term-muted")}>
            {k === "insider" ? "Insider" : "Fund"}
          </button>
        ))}
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "fund" ? "Display name, e.g. Seth Klarman" : "First and last name"} className={input} />
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder={kind === "fund" ? "SEC CIK of the firm" : "Company ticker, e.g. AAPL"} className={cn(input, "num")} />
      <button disabled={!p} onClick={() => { if (p) { addCustom(p); setName(""); setId(""); } }}
        className="px-2 py-1 border border-term-amber text-term-amber text-[11px] disabled:opacity-30">Add and follow</button>
      <div className="text-[10px] text-term-muted leading-snug">
        {kind === "fund" ? "Find a firm's CIK by searching its name on sec.gov/edgar." : "Matches Form 4 filings for that company on the person's first and last name."}
      </div>
    </div>
  );
}

export function PERS() {
  const openTab = useWorkspace((s) => s.openTab);
  const { followed, custom, toggle, removeCustom } = usePersonas();
  const personas = useMemo(() => allPersonas(custom), [custom]);
  const active = personas.filter((p) => followed.includes(p.id));
  const sources = [...new Map(active.map((p) => [sourceKey(p), p.source])).entries()];

  const queries = useQueries({
    queries: sources.map(([key, src]) => ({
      queryKey: ["persona-source", key],
      queryFn: () => (src.kind === "fund" ? fetchForm13F(src.cik) : fetchInsiderTrades(src.symbol)),
      staleTime: 6 * 3600_000,
      retry: 1,
    })),
  });
  const bySource = Object.fromEntries(sources.map(([key], i) => [key, queries[i]]));
  const stamp = queries.map((q) => `${q.dataUpdatedAt}${q.status}`).join("|");

  const data: Record<string, PersonaData> = useMemo(() => Object.fromEntries(active.map((p) => {
    const q = bySource[sourceKey(p)];
    const base: PersonaData = { trades: [], latest: null, prior: null, holdings: null, error: q?.error ? (q.error as Error).message : null, loading: !!q?.isLoading };
    if (!q?.data) return [p.id, base];
    if (p.source.kind === "fund") {
      const f = fundChanges(q.data, p.source.cik);
      return [p.id, { ...base, trades: f.trades, latest: f.latest, prior: f.prior, holdings: f.holdings }];
    }
    const trades = q.data.map(normalizeInsider).filter((t) => matchesInsider(t.owner, p));
    return [p.id, { ...base, trades }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [stamp, active.map((p) => p.id).join("|")]);

  const [query, setQuery] = useState("");
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const [tradesOnly, setTradesOnly] = useState(true);
  const [only, setOnly] = useState<string | null>(null);
  const [limit, setLimit] = useState(150);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return active
      .filter((p) => !only || p.id === only)
      .flatMap((p) => (data[p.id]?.trades ?? []).map((t) => ({ p, t })))
      .filter(({ t }) => !tradesOnly || t.side !== "other")
      .filter(({ t }) => side === "all" || t.side === side)
      .filter(({ t }) => !q || (t.symbol ?? "").includes(q) || t.asset.toUpperCase().includes(q))
      .sort((a, b) => byRecency(a.t, b.t));
  }, [active, data, only, side, tradesOnly, query]);

  const loading = queries.some((q) => q.isLoading);
  const today = Date.now();

  return (
    <div className="h-full flex min-h-0">
      <aside className="w-60 shrink-0 border-r border-term-border p-3 flex flex-col gap-3 overflow-auto scroll-thin text-[12px]">
        <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold">PERSONAS</div>
        <div className="text-[10px] text-term-muted leading-snug">Tick the people to follow. Their trades from public SEC filings are merged into one timeline.</div>
        {(["fund", "insider"] as const).map((k) => (
          <div key={k} className="flex flex-col gap-1">
            <div className="sub-header">{k === "fund" ? "Fund managers · 13F" : "Corporate insiders · Form 4"}</div>
            {personas.filter((p) => p.source.kind === k).map((p) => (
              <PersonaRow key={p.id} p={p} on={followed.includes(p.id)} onToggle={() => toggle(p.id)} onRemove={p.custom ? () => removeCustom(p.id) : undefined} />
            ))}
          </div>
        ))}
        <AddForm />
        <div className="text-[10px] text-term-muted leading-snug border-t border-term-border pt-2">
          Source: SEC EDGAR through the local OpenBB API. Free, official and keyless. Following a persona is for research; StockHub places no trades.
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-term-border flex flex-wrap items-center gap-3 text-[11px]">
          <span className="text-term-amber font-bold tracking-widest">{rows.length} TRADES</span>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1.5 text-term-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ticker or company"
              className="w-40 bg-term-bg border border-term-border pl-7 pr-2 py-0.5 text-[11px] placeholder:text-term-muted focus:outline-none focus:border-term-amberDim" />
          </div>
          {(["all", "buy", "sell"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)} className={cn("px-2 py-0.5 border uppercase tracking-widest text-[10px]",
              side === s ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-text")}>{s === "all" ? "All" : s === "buy" ? "Buys" : "Sells"}</button>
          ))}
          <label className="flex items-center gap-1.5 text-term-text cursor-pointer" title="Hide grants, option exercises, tax withholding and gifts">
            <input type="checkbox" checked={tradesOnly} onChange={() => setTradesOnly((v) => !v)} className="accent-[#ff8c00]" /> Buys and sells only
          </label>
          {loading && <span className="text-term-muted uppercase tracking-widest">Loading SEC filings…</span>}
          <span className="ml-auto text-term-muted">Filed trades, not recommendations.</span>
        </div>

        <div className="flex-1 overflow-auto scroll-thin p-4 flex flex-col gap-4">
          {active.length === 0 && <div className="text-term-muted text-[12px]">Tick a persona on the left to see their trades.</div>}

          {active.length > 0 && (
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
              {active.map((p) => {
                const d = data[p.id];
                const s = summarize((d?.trades ?? []).filter((t) => t.side !== "other"));
                const stale = d?.latest ? (today - Date.parse(d.latest)) / 864e5 > STALE_DAYS : false;
                return (
                  <button key={p.id} onClick={() => setOnly(only === p.id ? null : p.id)}
                    className={cn("panel text-left px-3 py-2 hover:border-term-amberDim", only === p.id && "border-term-amber")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-term-heading font-semibold">{p.name}</span>
                      <span className="flex gap-1">
                        {stale && <Badge tone="red" title="The latest filing is more than nine months old.">Stale</Badge>}
                        {only === p.id && <Badge tone="amber">Filtered</Badge>}
                      </span>
                    </div>
                    <div className="text-[10px] text-term-muted">{p.role}</div>
                    {d?.error ? <div className="text-[11px] text-term-red mt-1">Could not load: {d.error}</div>
                      : !d || d.loading ? <div className="text-[11px] text-term-muted mt-1">Loading…</div>
                      : (
                        <div className="mt-1 text-[11px] grid grid-cols-3 gap-1">
                          {p.source.kind === "fund" ? (
                            <>
                              <div><div className="sub-header">Period</div><div className="num">{qtr(d.latest)}</div></div>
                              <div><div className="sub-header">Holdings</div><div className="num">{d.holdings ?? "n/a"}</div></div>
                              <div><div className="sub-header">Buy / sell</div><div className="num"><span className="up">{s.buys}</span> / <span className="down">{s.sells}</span></div></div>
                              <div className="col-span-3 text-term-muted">{d.prior ? `Changes ${qtr(d.prior)} → ${qtr(d.latest)}` : "Only one quarter filed; no changes to show."}</div>
                            </>
                          ) : (
                            <>
                              <div><div className="sub-header">Trades</div><div className="num">{s.trades}</div></div>
                              <div><div className="sub-header">Buy / sell</div><div className="num"><span className="up">{s.buys}</span> / <span className="down">{s.sells}</span></div></div>
                              <div><div className="sub-header">Latest</div><div className="num">{s.latest ?? "n/a"}</div></div>
                              {s.trades === 0 && <div className="col-span-3 text-term-muted leading-snug">No buys or sells by this name in the filings loaded (about the last four months).</div>}
                            </>
                          )}
                        </div>
                      )}
                    {p.note && <div className="text-[10px] text-term-muted mt-1 leading-snug">{p.note}</div>}
                  </button>
                );
              })}
            </div>
          )}

          {active.some((p) => p.source.kind === "fund") && <div className="text-[10px] text-term-muted leading-snug">{FUND_NOTE}</div>}

          {rows.length > 0 && (
            <div>
              <table className="w-full grid-data text-[11px]">
                <thead><tr><th>Date</th><th>Persona</th><th>Action</th><th>Security</th><th className="text-right">Shares</th><th className="text-right">Price</th><th className="text-right">Value</th><th>Detail</th><th /></tr></thead>
                <tbody>
                  {rows.slice(0, limit).map(({ p, t }, i) => (
                    <tr key={i}>
                      <td className="num whitespace-nowrap" title={t.filed ? `Filed ${t.filed}` : "Quarter end; filed up to 45 days later"}>
                        {p.source.kind === "fund" ? qtr(t.date) : t.date ?? "n/a"}
                      </td>
                      <td className="text-term-text whitespace-nowrap">{p.name}</td>
                      <td className={cn("whitespace-nowrap", SIDE_TONE[t.side])}>{t.action}</td>
                      <td className="max-w-[260px] truncate" title={t.asset}>
                        {t.symbol
                          ? <button onClick={() => openTab("GP", t.symbol!)} title={`Open a ${t.symbol} chart`} className="text-term-amber hover:underline mr-1">{t.symbol}</button>
                          : null}
                        <span className="text-term-muted">{t.asset}</span>
                      </td>
                      <td className="num text-right">{t.shares == null ? "" : `${t.shares > 0 && p.source.kind === "fund" ? "+" : ""}${Math.round(t.shares).toLocaleString("en-US")}`}</td>
                      <td className="num text-right">{t.price == null ? "" : `$${t.price.toFixed(2)}`}</td>
                      <td className="num text-right">{money(t.value)}</td>
                      <td className="text-term-muted text-[10px]">{t.detail}</td>
                      <td>{t.url && <a href={t.url} target="_blank" rel="noreferrer" title="SEC filing" className="text-term-muted hover:text-term-amber"><ExternalLink size={11} /></a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > limit && (
                <button onClick={() => setLimit((n) => n + 300)} className="mt-2 text-[10px] text-term-muted hover:text-term-amber uppercase tracking-widest">Show more ({rows.length - limit} hidden)</button>
              )}
            </div>
          )}
          {!loading && active.length > 0 && rows.length === 0 && <div className="text-term-muted text-[12px]">No trades match these filters.</div>}
        </div>
      </div>
    </div>
  );
}
