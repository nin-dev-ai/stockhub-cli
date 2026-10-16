import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCopilotContext } from "@/copilot/context";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetchForm13F, fetchInsiderTrades } from "@/lib/api";
import { fetchHouseMember, fetchRecentHouseFilings, type HouseMemberData } from "@/lib/house";
import { fetchLiveFeed, SEC_CONFIGURED, type LiveFeed } from "@/lib/edgar";
import { ageText } from "@/quant/edgar";
import { fetchArkFeed } from "@/lib/ark";
import { ARK_NOTE, type ArkFeed } from "@/quant/ark";
import { HOUSE_NOTE, houseMembers, searchMembers } from "@/quant/congress";
import { Badge } from "@/components/quant/Badges";
import {
  byRecency, customFund, isLiveRow, customHouse, customInsider, edgarCiks, FUND_NOTE, fundChanges, matchesInsider, normalizeInsider, summarize,
  type Persona, type PersonaTrade,
} from "@/quant/personas";
import { allPersonas, usePersonas } from "@/store/personaStore";
import { CopyTradePanel } from "./personas/CopyTradePanel";
import type { CopyTradeResult } from "@/quant/copyTrade";
import type { CopyContext } from "@/copilot/context";
import { useWorkspace } from "@/store/workspaceStore";

const SIDE_TONE: Record<PersonaTrade["side"], string> = { buy: "up", sell: "down", other: "text-term-muted" };
const STALE_DAYS = 270;

const sourceKey = (p: Persona) => (p.source.kind === "fund" ? `13f:${p.source.cik}` : p.source.kind === "house" ? `house:${p.source.key}` : `form4:${p.source.symbol}`);
const GROUPS: { kind: Persona["source"]["kind"]; label: string }[] = [
  { kind: "fund", label: "Fund managers · 13F" }, { kind: "insider", label: "Corporate insiders · Form 4" }, { kind: "house", label: "US House members · PTR" },
];
const money = (v: number | null) => (v == null ? "" : `$${Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.round(v).toLocaleString("en-US")}`);
const qtr = (d: string | null) => (d ? `Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1} ${d.slice(0, 4)}` : "n/a");

interface PersonaData {
  trades: PersonaTrade[]; latest: string | null; prior: string | null; holdings: number | null; error: string | null; loading: boolean;
  /** House members: reports found and the ones not read (scanned, failed or beyond the newest few). */
  reports?: number; unread?: HouseMemberData["unread"];
  /** Live SEC filings (Form 3/4/5, Schedule 13D/G) for personas with SEC identities. */
  live?: LiveFeed; liveError?: string | null;
  /** ARK's daily trade notifications (Cathie Wood). */
  ark?: ArkFeed; arkError?: string | null;
}

/** ARK's daily trades: how far they run and the official holdings file's date, with the third-party caveat. */
function ArkLine({ d }: { d: PersonaData }) {
  if (d.arkError) return <div className="mt-1 text-[10px] text-term-red leading-snug">ARK daily trades unavailable: {d.arkError}</div>;
  if (!d.ark) return <div className="mt-1 text-[10px] text-term-muted">Loading ARK's daily trades…</div>;
  const a = d.ark;
  return (
    <div className="mt-1 text-[10px] leading-snug flex flex-col gap-0.5">
      <div className="text-term-text">Daily trades: {a.events.length} in the last 30 days{a.newestTrade ? `, newest ${a.newestTrade}` : ""}{a.holdingsDate ? ` · official holdings dated ${a.holdingsDate}` : ""}</div>
      {a.failedFunds.length > 0 && <div className="text-term-amberBright">No data for {a.failedFunds.join(", ")}.</div>}
    </div>
  );
}

const utc = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** How fresh a persona's data is: the newest SEC filing to the minute, when it was checked, and what is new since the last look. */
function LiveLine({ d, kind, n, now }: { d: PersonaData; kind: Persona["source"]["kind"]; n: number; now: number }) {
  if (d.liveError) return <div className="mt-1 text-[10px] text-term-red leading-snug">Live SEC filings unavailable: {d.liveError}</div>;
  if (!d.live) return <div className="mt-1 text-[10px] text-term-muted">Checking the SEC for new filings…</div>;
  const f = d.live.fresh;
  return (
    <div className="mt-1 text-[10px] leading-snug flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-1">
        {n > 0 && <Badge tone="green" title="Filings accepted since you last looked at this screen">{n} new</Badge>}
        {f.newestAccepted
          ? <span className="text-term-text">Newest filing: Form {f.newestForm?.replace("SCHEDULE ", "") } · {utc(f.newestAccepted)} UTC · {ageText(f.newestAccepted, new Date(now).toISOString())}</span>
          : <span className="text-term-muted">No insider or large-holder filings in the last 120 days.</span>}
      </div>
      {kind === "fund" && !f.newestAccepted && d.live.last13F && <div className="text-term-muted">The newest public data is the 13F filed {d.live.last13F.filed}; it covers the quarter-end portfolio.</div>}
      {kind === "fund" && f.newestAccepted && d.live.last13F && <div className="text-term-muted">Portfolio table: the 13F filed {d.live.last13F.filed} (quarter end, up to 45 days late).</div>}
      {d.live.failed > 0 && <div className="text-term-amberBright">{d.live.failed} of {d.live.listed} filings could not be read.</div>}
      <div className="text-term-muted">Checked {new Date(d.live.checkedAt).toLocaleTimeString()} · rechecks every 5 minutes</div>
    </div>
  );
}

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

/** Search the Clerk's index for any House member with a trade report this year or last. */
function HouseSearch() {
  const addCustom = usePersonas((s) => s.addCustom);
  const [q, setQ] = useState("");
  const index = useQuery({ queryKey: ["house-index"], queryFn: () => fetchRecentHouseFilings(), staleTime: 6 * 3600_000, retry: 1 });
  const members = useMemo(() => houseMembers(index.data ?? []), [index.data]);
  const hits = searchMembers(members, q, 8);
  return (
    <div className="flex flex-col gap-1">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or district, e.g. CA11"
        className="bg-term-bg border border-term-border px-2 py-1 text-[11px] placeholder:text-term-muted focus:outline-none focus:border-term-amberDim" />
      {index.isLoading && <div className="text-[10px] text-term-muted">Loading the House Clerk's index…</div>}
      {index.error && <div className="text-[10px] text-term-red">Could not load the index: {(index.error as Error).message}</div>}
      {hits.map((m) => (
        <button key={m.key} onClick={() => { addCustom(customHouse(m)); setQ(""); }}
          className="text-left border border-term-border px-2 py-0.5 text-[11px] hover:border-term-amberDim">
          <span className="text-term-text">{m.first} {m.last}</span> <span className="text-term-muted">{m.stateDst} · {m.ptrs} report{m.ptrs === 1 ? "" : "s"}</span>
        </button>
      ))}
      {q.trim() && !index.isLoading && hits.length === 0 && <div className="text-[10px] text-term-muted">No member with a trade report this year or last matches.</div>}
      <div className="text-[10px] text-term-muted leading-snug">Members with a Periodic Transaction Report filed this year or last. Senators are not available yet.</div>
    </div>
  );
}

function AddForm() {
  const addCustom = usePersonas((s) => s.addCustom);
  const [kind, setKind] = useState<"insider" | "fund" | "house">("insider");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const p = kind === "fund" ? customFund(name, id) : kind === "insider" ? customInsider(name, id) : null;
  const input = "bg-term-bg border border-term-border px-2 py-1 text-[11px] placeholder:text-term-muted focus:outline-none focus:border-term-amberDim";
  return (
    <div className="border-t border-term-border pt-2 flex flex-col gap-1">
      <div className="sub-header">Add a persona</div>
      <div className="flex gap-1">
        {(["insider", "fund", "house"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cn("flex-1 border text-[10px] py-0.5 uppercase tracking-widest", kind === k ? "border-term-amber text-term-amber" : "border-term-border text-term-muted")}>
            {k === "insider" ? "Insider" : k === "fund" ? "Fund" : "House"}
          </button>
        ))}
      </div>
      {kind === "house" ? <HouseSearch /> : <>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "fund" ? "Display name, e.g. Seth Klarman" : "First and last name"} className={input} />
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder={kind === "fund" ? "SEC CIK of the firm" : "Company ticker, e.g. AAPL"} className={cn(input, "num")} />
      <button disabled={!p} onClick={() => { if (p) { addCustom(p); setName(""); setId(""); } }}
        className="px-2 py-1 border border-term-amber text-term-amber text-[11px] disabled:opacity-30">Add and follow</button>
      <div className="text-[10px] text-term-muted leading-snug">
        {kind === "fund" ? "Find a firm's CIK by searching its name on sec.gov/edgar." : "Matches Form 4 filings for that company on the person's first and last name."}
      </div>
      </>}
    </div>
  );
}

export function PERS() {
  const openTab = useWorkspace((s) => s.openTab);
  const { followed, custom, toggle, removeCustom } = usePersonas();
  const personas = useMemo(() => allPersonas(custom), [custom]);
  const active = personas.filter((p) => followed.includes(p.id));
  const hasLive = (p: Persona) => SEC_CONFIGURED && edgarCiks(p).length > 0;
  // insiders with SEC identities are read live (all history, to the second) instead of the provider's four-month window
  const baseActive = active.filter((p) => !(hasLive(p) && p.source.kind === "insider"));
  const sources = [...new Map(baseActive.map((p) => [sourceKey(p), p.source])).entries()];
  const liveActive = active.filter(hasLive);
  const liveQueries = useQueries({
    queries: liveActive.map((p) => ({
      queryKey: ["persona-live", p.id, edgarCiks(p).join(",")],
      queryFn: () => fetchLiveFeed(edgarCiks(p)),
      staleTime: 4 * 60_000, refetchInterval: 5 * 60_000, retry: 1,
    })),
  });
  const liveBy = Object.fromEntries(liveActive.map((p, i) => [p.id, liveQueries[i]]));
  const arkActive = active.filter((p) => p.daily === "ark");
  const arkQuery = useQuery({ queryKey: ["persona-ark"], queryFn: () => fetchArkFeed(), enabled: arkActive.length > 0, staleTime: 10 * 60_000, refetchInterval: 15 * 60_000, retry: 1 });
  const liveStamp = liveQueries.map((q) => `${q.dataUpdatedAt}${q.status}`).join("|");

  const queries = useQueries({
    queries: sources.map(([key, src]) => ({
      queryKey: ["persona-source", key],
      queryFn: (): Promise<Record<string, unknown>[] | HouseMemberData> => (src.kind === "fund" ? fetchForm13F(src.cik) : src.kind === "house" ? fetchHouseMember(src.key) : fetchInsiderTrades(src.symbol)),
      staleTime: 6 * 3600_000,
      retry: 1,
    })),
  });
  const bySource = Object.fromEntries(sources.map(([key], i) => [key, queries[i]]));
  const stamp = queries.map((q) => `${q.dataUpdatedAt}${q.status}`).join("|");

  const baseData: Record<string, PersonaData> = useMemo(() => Object.fromEntries(active.map((p) => {
    const q = bySource[sourceKey(p)];
    const base: PersonaData = { trades: [], latest: null, prior: null, holdings: null, error: q?.error ? (q.error as Error).message : null, loading: !!q?.isLoading };
    if (!q?.data) return [p.id, base];
    if (p.source.kind === "house") {
      const h = q.data as HouseMemberData;
      return [p.id, { ...base, trades: h.trades, latest: h.latestFiled, reports: h.reports, unread: h.unread }];
    }
    const rowsData = q.data as Record<string, unknown>[];
    if (p.source.kind === "fund") {
      const f = fundChanges(rowsData, p.source.cik);
      return [p.id, { ...base, trades: f.trades, latest: f.latest, prior: f.prior, holdings: f.holdings }];
    }
    const trades = rowsData.map(normalizeInsider).filter((t) => matchesInsider(t.owner, p));
    return [p.id, { ...base, trades }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [stamp, active.map((p) => p.id).join("|")]);

  const data: Record<string, PersonaData> = useMemo(() => Object.fromEntries(active.map((p) => {
    const b = baseData[p.id], lq = liveBy[p.id];
    if (!b) return [p.id, b];
    const live = lq?.data, ark = p.daily === "ark" ? arkQuery.data : undefined;
    const trades = [...b.trades, ...(live?.events ?? []), ...(ark?.events ?? [])];
    return [p.id, {
      ...b, trades, live, ark,
      liveError: lq?.error ? (lq.error as Error).message : null,
      arkError: p.daily === "ark" && arkQuery.error ? (arkQuery.error as Error).message : null,
      loading: b.loading || (!!lq?.isLoading && p.source.kind === "insider"),
    }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [baseData, liveStamp, arkQuery.dataUpdatedAt, arkQuery.status]);

  // filings accepted since the user last looked are marked new; the first look sets the baseline
  const { seen, markSeen } = usePersonas();
  const newestOf = (id: string) => data[id]?.live?.fresh.newestAccepted ?? "";
  const newCount = (id: string) => {
    const s = seen[id];
    return s == null ? 0 : new Set((data[id]?.live?.events ?? []).filter((e) => e.accepted && e.accepted > s).map((e) => e.url)).size;
  };
  useEffect(() => { for (const p of liveActive) if (liveBy[p.id]?.data && seen[p.id] === undefined) markSeen(p.id, newestOf(p.id) || liveBy[p.id].data!.checkedAt); }, [liveStamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const latestRef = useRef({ ids: [] as string[], newest: {} as Record<string, string> });
  latestRef.current = { ids: liveActive.map((p) => p.id), newest: Object.fromEntries(liveActive.map((p) => [p.id, newestOf(p.id)])) };
  useEffect(() => () => { for (const id of latestRef.current.ids) markSeen(id, latestRef.current.newest[id]); }, [markSeen]);

  const [copyFor, setCopyFor] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyContext | null>(null);
  const onCopyResult = useCallback((r: CopyTradeResult | null) => {
    const p = personas.find((x) => x.id === copyFor);
    if (!r || !p) { setCopy(null); return; }
    const m = (x: CopyTradeResult["filed"]["run"]) => ({ finalValue: x.finalValue, totalReturn: x.metrics.totalReturn, maxDrawdown: x.metrics.maxDrawdown });
    setCopy({
      personaId: p.id, name: p.name, start: r.filed.window.start, end: r.filed.window.end, years: r.filed.window.years,
      filed: m(r.filed.run), traded: m(r.traded.run), benchmark: { ticker: r.filed.benchmark.ticker, ...m(r.filed.benchmark.run) },
      initial: r.filed.config.initial, lagCost: r.lagCost, medianLagDays: r.medianLagDays, tickers: r.tickers, unpriced: r.unpriced, skipped: r.skipped,
    });
  }, [copyFor, personas]);
  useEffect(() => { if (!copyFor) setCopy(null); }, [copyFor]);

  // the loaded trades are what the Copilot may explain on this screen
  const setCopilotPersonas = useCopilotContext((s) => s.setPersonas);
  useEffect(() => {
    setCopilotPersonas({
      copy,
      personas: active.map((p) => {
        const d = data[p.id];
        return {
          id: p.id, name: p.name, role: p.role, kind: p.source.kind, latest: d?.latest ?? null, prior: d?.prior ?? null, holdings: d?.holdings ?? null,
          trades: (d?.trades ?? []).filter((t) => t.side !== "other"), error: d?.error ?? null, loading: d?.loading ?? true,
          newest: d?.live?.fresh.newestAccepted ?? null,
        };
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, copy, setCopilotPersonas]);
  useEffect(() => () => setCopilotPersonas(null), [setCopilotPersonas]);

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
      .filter(({ t }) => !tradesOnly || t.side !== "other" || t.category === "stake")
      .filter(({ t }) => side === "all" || t.side === side)
      .filter(({ t }) => !q || (t.symbol ?? "").includes(q) || t.asset.toUpperCase().includes(q))
      .sort((a, b) => byRecency(a.t, b.t));
  }, [active, data, only, side, tradesOnly, query]);

  const loading = queries.some((q) => q.isLoading) || liveQueries.some((q) => q.isLoading) || (arkActive.length > 0 && arkQuery.isLoading);
  const now = Date.now();
  const today = Date.now();

  return (
    <div className="h-full flex min-h-0">
      <aside className="w-60 shrink-0 border-r border-term-border p-3 flex flex-col gap-3 overflow-auto scroll-thin text-[12px]">
        <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold">PERSONAS</div>
        <div className="text-[10px] text-term-muted leading-snug">Tick the people to follow. Their trades from public filings are merged into one timeline.</div>
        {GROUPS.map(({ kind: k, label }) => (
          <div key={k} className="flex flex-col gap-1">
            <div className="sub-header">{label}</div>
            {personas.filter((p) => p.source.kind === k).map((p) => (
              <PersonaRow key={p.id} p={p} on={followed.includes(p.id)} onToggle={() => toggle(p.id)} onRemove={p.custom ? () => removeCustom(p.id) : undefined} />
            ))}
          </div>
        ))}
        <AddForm />
        <div className="text-[10px] text-term-muted leading-snug border-t border-term-border pt-2">
          Sources: SEC EDGAR through the local OpenBB API, and the Clerk of the House for House members. Free, official and keyless. Following a persona is for research and never places a trade.
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
          {loading && <span className="text-term-muted uppercase tracking-widest">Loading filings…</span>}
          <span className="ml-auto text-term-muted">Filed trades, not recommendations.</span>
        </div>

        <div className="flex-1 overflow-auto scroll-thin p-4 flex flex-col gap-4">
          {active.length === 0 && <div className="text-term-muted text-[12px]">Tick a persona on the left to see their trades.</div>}
          {!SEC_CONFIGURED && active.some((p) => edgarCiks(p).length > 0) && (
            <div className="border border-term-amberDim p-2 text-[11px] text-term-amberBright leading-snug">
              Showing quarterly filings only. Live SEC filings (insider trades within days, large-holder reports) need a contact in the SEC's User-Agent rule: restart StockHub with <span className="num">STOCKHUB_SEC_CONTACT=&quot;Your Name you@example.com&quot; ./start.sh</span>. It is sent only to sec.gov.
            </div>
          )}

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
                              <div><div className="sub-header">13F period</div><div className="num">{qtr(d.latest)}</div></div>
                              <div><div className="sub-header">Holdings</div><div className="num">{d.holdings ?? "n/a"}</div></div>
                              <div><div className="sub-header">Buy / sell</div><div className="num"><span className="up">{s.buys}</span> / <span className="down">{s.sells}</span></div></div>
                              <div className="col-span-3 text-term-muted">{d.prior ? `Changes ${qtr(d.prior)} → ${qtr(d.latest)}` : "Only one quarter filed; no changes to show."}</div>
                            </>
                          ) : p.source.kind === "house" ? (
                            <>
                              <div><div className="sub-header">Reports</div><div className="num">{d.reports ?? 0}</div></div>
                              <div><div className="sub-header">Buy / sell</div><div className="num"><span className="up">{s.buys}</span> / <span className="down">{s.sells}</span></div></div>
                              <div><div className="sub-header">Latest</div><div className="num">{s.latest ?? "n/a"}</div></div>
                              {d.reports === 0 && <div className="col-span-3 text-term-muted leading-snug">No trade reports filed this year or last.</div>}
                              {s.buys > 0 && (
                                <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setCopyFor(copyFor === p.id ? null : p.id); }}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setCopyFor(copyFor === p.id ? null : p.id); } }}
                                  className="col-span-3 mt-1 text-center border border-term-amberDim text-term-amber hover:bg-term-amberSubtle text-[10px] uppercase tracking-widest py-0.5">
                                  {copyFor === p.id ? "Hide copy backtest" : "Backtest copying"}
                                </span>
                              )}
                              {(d.unread?.length ?? 0) > 0 && (
                                <div className="col-span-3 text-term-muted leading-snug">
                                  {d.unread!.filter((u) => u.reason === "scanned").length > 0 && <>{d.unread!.filter((u) => u.reason === "scanned").length} scanned paper report(s), not read. </>}
                                  {d.unread!.filter((u) => u.reason === "failed").length > 0 && <>{d.unread!.filter((u) => u.reason === "failed").length} report(s) could not be read. </>}
                                  {d.unread!.filter((u) => u.reason === "older").length > 0 && <>{d.unread!.filter((u) => u.reason === "older").length} older report(s) not loaded. </>}
                                  {d.unread!.slice(0, 3).map((u) => <a key={u.docId} href={u.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-term-amber hover:underline mr-2">{u.filed}</a>)}
                                </div>
                              )}
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
                    {hasLive(p) && d && <LiveLine d={d} kind={p.source.kind} n={newCount(p.id)} now={now} />}
                    {p.daily === "ark" && d && <ArkLine d={d} />}
                    {p.note && <div className="text-[10px] text-term-muted mt-1 leading-snug">{p.note}</div>}
                  </button>
                );
              })}
            </div>
          )}

          {copyFor && active.some((p) => p.id === copyFor) && data[copyFor] && !data[copyFor].loading && (
            <CopyTradePanel key={copyFor} persona={active.find((p) => p.id === copyFor)!} trades={data[copyFor].trades}
              onClose={() => setCopyFor(null)} onResult={onCopyResult} />
          )}

          {active.some((p) => p.source.kind === "fund") && <div className="text-[10px] text-term-muted leading-snug">{FUND_NOTE}</div>}
          {arkActive.length > 0 && <div className="text-[10px] text-term-muted leading-snug">{ARK_NOTE}</div>}
          {active.some((p) => p.source.kind === "house") && <div className="text-[10px] text-term-muted leading-snug">{HOUSE_NOTE} The date is the trade date; hover it for the filing date.</div>}

          {rows.length > 0 && (
            <div>
              <table className="w-full grid-data text-[11px]">
                <thead><tr><th>Trade date</th><th title="When the filing became public: the SEC's acceptance time for EDGAR filings, the filing date for House reports">Public (UTC)</th><th>Persona</th><th>Action</th><th>Security</th><th className="text-right">Shares</th><th className="text-right">Price</th><th className="text-right">Value or range</th><th>Detail</th><th /></tr></thead>
                <tbody>
                  {rows.slice(0, limit).map(({ p, t }, i) => (
                    <tr key={i}>
                      <td className="num whitespace-nowrap" title={t.filed ? `Filed ${t.filed}` : "Quarter end; filed up to 45 days later"}>
                        {p.source.kind === "fund" && !isLiveRow(t) ? qtr(t.date) : t.date ?? "n/a"}
                      </td>
                      <td className="num whitespace-nowrap text-term-muted" title={t.accepted ? `${t.form ?? "Filing"} accepted by the SEC at ${t.accepted}` : t.filed ? `Filed ${t.filed}` : "Quarter-end snapshot, public up to 45 days later"}>
                        {t.accepted ? t.accepted.slice(5, 16).replace("T", " ") : t.filed ?? "–"}
                      </td>
                      <td className="text-term-text whitespace-nowrap">{p.name}</td>
                      <td className={cn("whitespace-nowrap", t.category === "stake" ? "text-term-cyan" : SIDE_TONE[t.side])}>{t.action}</td>
                      <td className="max-w-[260px] truncate" title={t.asset}>
                        {t.symbol
                          ? <button onClick={() => openTab("GP", t.symbol!)} title={`Open a ${t.symbol} chart`} className="text-term-amber hover:underline mr-1">{t.symbol}</button>
                          : null}
                        <span className="text-term-muted">{t.asset}</span>
                      </td>
                      <td className="num text-right">{t.shares == null ? "" : `${t.shares > 0 && p.source.kind === "fund" ? "+" : ""}${Math.round(t.shares).toLocaleString("en-US")}`}</td>
                      <td className="num text-right">{t.price == null ? "" : `$${t.price.toFixed(2)}`}</td>
                      <td className="num text-right whitespace-nowrap">{t.value != null ? money(t.value) : t.amount ?? ""}</td>
                      <td className="text-term-muted text-[10px] min-w-[200px] max-w-[380px]"><span className="line-clamp-2" title={t.detail}>{t.detail}</span></td>
                      <td>{t.url && <a href={t.url} target="_blank" rel="noreferrer" title="Original filing" className="text-term-muted hover:text-term-amber"><ExternalLink size={11} /></a>}</td>
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
