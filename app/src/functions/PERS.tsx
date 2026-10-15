import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError, fetchGovernmentTrades } from "@/lib/api";
import { Badge } from "@/components/quant/Badges";
import { byRecency, customPersona, matchesPersona, normalizeTrade, summarize, type Chamber, type Persona, type PersonaTrade } from "@/quant/personas";
import { allPersonas, usePersonas } from "@/store/personaStore";
import { useWorkspace } from "@/store/workspaceStore";

const CHAMBERS: Chamber[] = ["house", "senate"];
const SIDE_TONE: Record<PersonaTrade["side"], string> = { buy: "up", sell: "down", exchange: "text-term-cyan", other: "text-term-muted" };

function KeySetup({ message }: { message: string }) {
  return (
    <div role="alert" className="max-w-2xl border border-term-amberDim bg-term-panel2 p-4 flex flex-col gap-2 text-[12px]">
      <div className="text-term-amber text-[11px] uppercase tracking-[0.25em] font-bold">Connect the disclosure feed</div>
      <div className="text-term-text leading-relaxed">
        Congressional trades come from Financial Modeling Prep through the local OpenBB API, which needs an FMP API key.
        No trades are shown without it, and none are ever made up.
      </div>
      <ol className="list-decimal pl-5 text-term-text space-y-1 text-[11px]">
        <li>Get a key at financialmodelingprep.com. Congressional trading data may need a paid FMP plan.</li>
        <li>Add it to <span className="num text-term-amber">~/.openbb_platform/user_settings.json</span> under <span className="num">credentials</span> as <span className="num text-term-amber">"fmp_api_key": "…"</span>.</li>
        <li>Restart the API with <span className="num">./stop.sh</span> and <span className="num">./start.sh</span>, then reopen this screen.</li>
      </ol>
      <div className="text-[10px] text-term-muted">Provider message: {message}</div>
    </div>
  );
}

function PersonaRow({ p, on, count, onToggle, onRemove }: { p: Persona; on: boolean; count: number | null; onToggle: () => void; onRemove?: () => void }) {
  return (
    <div className={cn("border px-2 py-1.5 text-[11px]", on ? "border-term-amber bg-term-amberSubtle" : "border-term-border")}>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={on} onChange={onToggle} className="accent-[#ff8c00] mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className={cn("block font-semibold", on ? "text-term-amber" : "text-term-text")}>{p.name}</span>
          <span className="block text-term-muted text-[10px]">{p.role}{count != null ? ` · ${count} trades loaded` : ""}{!p.chamber ? " · no feed" : ""}</span>
        </span>
        {onRemove && <button onClick={(e) => { e.preventDefault(); onRemove(); }} className="text-term-muted hover:text-term-red" aria-label={`Remove ${p.name}`}>×</button>}
      </label>
    </div>
  );
}

export function PERS() {
  const openTab = useWorkspace((s) => s.openTab);
  const { followed, custom, toggle, addCustom, removeCustom } = usePersonas();
  const personas = useMemo(() => allPersonas(custom), [custom]);
  const active = personas.filter((p) => followed.includes(p.id));
  const needed = CHAMBERS.filter((c) => active.some((p) => p.chamber === c));

  const queries = useQueries({
    queries: needed.map((c) => ({
      queryKey: ["government-trades", c],
      queryFn: () => fetchGovernmentTrades(c),
      staleTime: 3600_000,
      retry: (n: number, e: unknown) => !(e instanceof ApiError && e.needsKey) && n < 1,
    })),
  });
  const loading = queries.some((q) => q.isLoading);
  const keyError = queries.map((q) => q.error).find((e): e is ApiError => e instanceof ApiError && !!e.needsKey);
  const otherError = queries.map((q) => q.error).find((e) => e && !(e instanceof ApiError && e.needsKey)) as Error | undefined;

  const all = useMemo(() => queries.flatMap((q) => (q.data ?? []).map(normalizeTrade)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries.map((q) => q.dataUpdatedAt).join("|")]);
  const byPersona = useMemo(() => Object.fromEntries(personas.map((p) => [p.id, p.chamber ? all.filter((t) => matchesPersona(t, p)) : []])), [all, personas]);

  const [query, setQuery] = useState("");
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const [only, setOnly] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newChamber, setNewChamber] = useState<Chamber>("house");
  const [limit, setLimit] = useState(100);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return active
      .filter((p) => !only || p.id === only)
      .flatMap((p) => byPersona[p.id].map((t) => ({ p, t })))
      .filter(({ t }) => side === "all" || t.side === side)
      .filter(({ t }) => !q || (t.symbol ?? "").includes(q) || t.asset.toUpperCase().includes(q))
      .sort((a, b) => byRecency(a.t, b.t));
  }, [active, byPersona, only, side, query]);

  const loaded = queries.length > 0 && queries.every((q) => q.isSuccess);
  const add = () => {
    const p = customPersona(newName, newChamber);
    if (p) { addCustom(p); setNewName(""); }
  };

  return (
    <div className="h-full flex min-h-0">
      <aside className="w-60 shrink-0 border-r border-term-border p-3 flex flex-col gap-3 overflow-auto scroll-thin text-[12px]">
        <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold">PERSONAS</div>
        <div className="text-[10px] text-term-muted leading-snug">Tick the people to follow. Their disclosed trades are merged into one timeline.</div>
        <div className="flex flex-col gap-1">
          {personas.map((p) => (
            <PersonaRow key={p.id} p={p} on={followed.includes(p.id)} count={loaded && p.chamber ? byPersona[p.id].length : null}
              onToggle={() => toggle(p.id)} onRemove={p.custom ? () => removeCustom(p.id) : undefined} />
          ))}
        </div>
        <div className="border-t border-term-border pt-2 flex flex-col gap-1">
          <div className="sub-header">Add a member of Congress</div>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="First and last name"
            className="bg-term-bg border border-term-border px-2 py-1 text-[11px] placeholder:text-term-muted focus:outline-none focus:border-term-amberDim" />
          <div className="flex gap-1">
            <select value={newChamber} onChange={(e) => setNewChamber(e.target.value as Chamber)} className="flex-1 bg-term-bg border border-term-border text-[11px] py-1 text-term-text">
              <option value="house">House</option><option value="senate">Senate</option>
            </select>
            <button onClick={add} disabled={!customPersona(newName, newChamber)} className="px-2 border border-term-amber text-term-amber text-[11px] disabled:opacity-30">Add</button>
          </div>
        </div>
        <div className="text-[10px] text-term-muted leading-snug border-t border-term-border pt-2">
          Source: STOCK Act periodic transaction reports, as published by Financial Modeling Prep. Filings give value ranges, not exact amounts,
          and can arrive up to 45 days after the trade. Following a persona is for research; StockHub places no trades.
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-term-border flex flex-wrap items-center gap-3 text-[11px]">
          <span className="text-term-amber font-bold tracking-widest">{rows.length} DISCLOSED TRADES</span>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1.5 text-term-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ticker or asset"
              className="w-40 bg-term-bg border border-term-border pl-7 pr-2 py-0.5 text-[11px] placeholder:text-term-muted focus:outline-none focus:border-term-amberDim" />
          </div>
          {(["all", "buy", "sell"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)} className={cn("px-2 py-0.5 border uppercase tracking-widest text-[10px]",
              side === s ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-text")}>{s === "all" ? "All" : s === "buy" ? "Purchases" : "Sales"}</button>
          ))}
          {loading && <span className="text-term-muted uppercase tracking-widest">Loading disclosures…</span>}
          <span className="ml-auto text-term-muted">Disclosed trades, not recommendations.</span>
        </div>

        <div className="flex-1 overflow-auto scroll-thin p-4 flex flex-col gap-4">
          {keyError && <KeySetup message={keyError.message} />}
          {otherError && <div role="alert" className="text-term-red text-[12px]">Could not load disclosures: {otherError.message}</div>}
          {active.length === 0 && <div className="text-term-muted text-[12px]">Tick a persona on the left to see their disclosed trades.</div>}

          {active.length > 0 && !keyError && (
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
              {active.map((p) => {
                const s = summarize(byPersona[p.id]);
                return (
                  <button key={p.id} onClick={() => setOnly(only === p.id ? null : p.id)}
                    className={cn("panel text-left px-3 py-2 hover:border-term-amberDim", only === p.id && "border-term-amber")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-term-heading font-semibold">{p.name}</span>
                      {only === p.id && <Badge tone="amber">Filtered</Badge>}
                    </div>
                    <div className="text-[10px] text-term-muted">{p.role}</div>
                    {!p.chamber ? (
                      <div className="text-[11px] text-term-amberBright mt-1 leading-snug">{p.note}</div>
                    ) : !loaded ? (
                      <div className="text-[11px] text-term-muted mt-1">—</div>
                    ) : s.trades === 0 ? (
                      <div className="text-[11px] text-term-muted mt-1 leading-snug">No trades for this name in the latest {p.chamber} filings loaded.</div>
                    ) : (
                      <div className="mt-1 text-[11px] grid grid-cols-3 gap-1">
                        <div><div className="sub-header">Trades</div><div className="num">{s.trades}</div></div>
                        <div><div className="sub-header">Buy / sell</div><div className="num"><span className="up">{s.buys}</span> / <span className="down">{s.sells}</span></div></div>
                        <div><div className="sub-header">Median lag</div><div className="num">{s.medianLagDays == null ? "n/a" : `${s.medianLagDays}d`}</div></div>
                        <div className="col-span-3 text-term-muted truncate">Most traded: {s.topSymbols.map((x) => `${x.symbol} ×${x.count}`).join(", ") || "n/a"}</div>
                      </div>
                    )}
                    {p.chamber && p.note && <div className="text-[10px] text-term-muted mt-1 leading-snug">{p.note}</div>}
                  </button>
                );
              })}
            </div>
          )}

          {rows.length > 0 && (
            <div>
              <table className="w-full grid-data text-[11px]">
                <thead><tr><th>Disclosed</th><th>Traded</th><th className="text-right">Lag</th><th>Persona</th><th>Trade</th><th>Asset</th><th>Amount (range)</th><th>Owner</th><th /></tr></thead>
                <tbody>
                  {rows.slice(0, limit).map(({ p, t }, i) => (
                    <tr key={i}>
                      <td className="num">{t.disclosureDate ?? "n/a"}</td>
                      <td className="num text-term-muted">{t.tradeDate ?? "n/a"}</td>
                      <td className="num text-right text-term-muted">{t.lagDays == null ? "" : `${t.lagDays}d`}</td>
                      <td className="text-term-text whitespace-nowrap">{p.name}</td>
                      <td>
                        <span className={SIDE_TONE[t.side]}>{t.side.toUpperCase()}</span>{" "}
                        {t.symbol
                          ? <button onClick={() => openTab("GP", t.symbol!)} title={`Open a ${t.symbol} chart`} className="text-term-amber hover:underline">{t.symbol}</button>
                          : <span className="text-term-muted">—</span>}
                      </td>
                      <td className="text-term-muted max-w-[260px] truncate" title={t.asset}>{t.asset}</td>
                      <td className="num whitespace-nowrap">{t.amount}</td>
                      <td className="text-term-muted">{t.owner}</td>
                      <td>{t.url && <a href={t.url} target="_blank" rel="noreferrer" title="Original filing" className="text-term-muted hover:text-term-amber"><ExternalLink size={11} /></a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > limit && (
                <button onClick={() => setLimit((n) => n + 200)} className="mt-2 text-[10px] text-term-muted hover:text-term-amber uppercase tracking-widest">Show more ({rows.length - limit} hidden)</button>
              )}
            </div>
          )}
          {loaded && active.some((p) => p.chamber) && rows.length === 0 && (
            <div className="text-term-muted text-[12px]">No disclosed trades match. The feed returns the most recent filings for each chamber, so older trades may not be loaded.</div>
          )}
        </div>
      </div>
    </div>
  );
}
