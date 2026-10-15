import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Badge } from "@/components/quant/Badges";
import { fmtMoney } from "@/lib/format";
import { ibkrAccounts, ibkrPositions, ibkrStatus, ibkrSummary, ibkrTickle } from "@/lib/ibkr";
import { syncDrafts, trackable, unpricedExits } from "@/quant/ibkr";
import { ledgerAt } from "@/quant/tracking";
import { usePortfolios } from "@/store/portfolioStore";

// the gateway's own login page; the proxy target is configured in vite.config.ts
const GATEWAY_LOGIN = import.meta.env.VITE_IBKR_LOGIN_URL ?? "https://localhost:5000";
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Read-only view of an Interactive Brokers account through the local Client Portal Gateway, and
 * the only way broker data enters StockHub: a sync the user clicks, appended to a broker-reported
 * portfolio's ledger. No credentials are stored; the session lives in the gateway.
 */
export function BrokerPanel({ onClose }: { onClose: () => void }) {
  const status = useQuery({ queryKey: ["ibkr-status"], queryFn: () => ibkrStatus(), refetchInterval: (q) => (q.state.data?.kind === "connected" ? 60_000 : 10_000), retry: 0 });
  const connected = status.data?.kind === "connected";

  // the gateway drops a session after about six minutes without a request
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => { void ibkrTickle().catch(() => status.refetch()); }, 60_000);
    return () => clearInterval(id);
  }, [connected, status]);

  const accounts = useQuery({ queryKey: ["ibkr-accounts"], queryFn: () => ibkrAccounts(), enabled: connected, retry: 0 });
  const [accountId, setAccountId] = useState<string | null>(null);
  const account = accounts.data?.find((a) => a.id === accountId) ?? accounts.data?.[0] ?? null;
  const positions = useQuery({ queryKey: ["ibkr-positions", account?.id], queryFn: () => ibkrPositions(account!.id), enabled: connected && !!account, retry: 0 });
  const summary = useQuery({ queryKey: ["ibkr-summary", account?.id], queryFn: () => ibkrSummary(account!.id), enabled: connected && !!account, retry: 0 });
  const split = useMemo(() => trackable(positions.data ?? []), [positions.data]);

  const { portfolios, createPortfolio, addTransactions, select } = usePortfolios();
  const brokerPfs = portfolios.filter((p) => p.mode === "broker");
  const [target, setTarget] = useState<string>("new");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sync = () => {
    if (!account || !positions.data) return;
    const date = today();
    if (target === "new") {
      const drafts = syncDrafts(ledgerAt([]), positions.data, date);
      const r = createPortfolio({ name: `IBKR ${account.id}`, mode: "broker", opening: drafts });
      if ("error" in r) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: `Created “IBKR ${account.id}” with ${drafts.length} holding${drafts.length === 1 ? "" : "s"}.` });
      select(r.id);
      return;
    }
    const p = brokerPfs.find((x) => x.id === target);
    if (!p) return;
    const state = ledgerAt(p.transactions);
    const missing = unpricedExits(state, positions.data);
    const drafts = syncDrafts(state, positions.data, date);
    if (drafts.length === 0) return setMsg({ ok: true, text: missing.length ? `Nothing to change, but ${missing.join(", ")} is no longer reported and has no broker price; record its sale on the Ledger tab.` : "Already in line with the broker; nothing to change." });
    const errs = addTransactions(p.id, drafts);
    setMsg(errs.length ? { ok: false, text: errs.join(" ") } : { ok: true, text: `Added ${drafts.length} entr${drafts.length === 1 ? "y" : "ies"} to “${p.name}”.${missing.length ? ` ${missing.join(", ")} is no longer reported and has no broker price; record its sale on the Ledger tab.` : ""}` });
  };

  const btn = "px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle text-[11px] disabled:opacity-30";
  return (
    <div className="panel shrink-0 p-4 flex flex-col gap-3 text-[12px] max-w-4xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-term-heading text-[14px] font-semibold">Interactive Brokers</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone="green">Read-only</Badge>
            {status.data?.kind === "connected" && <Badge tone="green">Gateway connected</Badge>}
            {status.data?.kind === "login" && <Badge tone="amber">Needs login</Badge>}
            {status.data?.kind === "offline" && <Badge tone="red">Gateway not running</Badge>}
            {account && <Badge tone={account.paper ? "cyan" : "amber"} title={account.paper ? "A simulated account." : "A real-money account, read only."}>{account.paper ? "Paper account" : "Live account · read only"}</Badge>}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close broker panel" className="text-term-muted hover:text-term-red"><X size={14} /></button>
      </div>
      <div className="text-[11px] text-term-muted leading-snug">
        StockHub reads positions and balances through IBKR's Client Portal Gateway, which runs on this computer and holds the login. It cannot place, change or cancel orders: the connection only allows status, keep-alive and portfolio reads, and anything else is blocked before it is sent. Nothing is saved until you sync.
      </div>

      {status.isLoading && <div className="text-term-muted uppercase tracking-widest text-[11px]">Checking the gateway…</div>}
      {status.data?.kind === "offline" && (
        <div className="flex flex-col gap-1 text-[11px] text-term-text">
          <div>{status.data.detail} To connect:</div>
          <ol className="list-decimal pl-5 space-y-0.5">
            <li>Download the Client Portal Gateway from Interactive Brokers and start it (<span className="num">bin/run.sh root/conf.yaml</span>). It listens on <span className="num">{GATEWAY_LOGIN}</span> by default.</li>
            <li>On a Mac, port 5000 belongs to AirPlay Receiver: set <span className="num">listenPort: 5001</span> in the gateway's <span className="num">root/conf.yaml</span> and start StockHub with <span className="num">IBKR_GATEWAY_URL=https://localhost:5001</span> (or turn off AirPlay Receiver in System Settings).</li>
            <li>Open the gateway page and log in, preferably with your paper-trading username.</li>
            <li>Come back here; this panel checks every ten seconds.</li>
          </ol>
        </div>
      )}
      {status.data?.kind === "login" && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-term-text">{status.data.detail}</span>
          <a href={GATEWAY_LOGIN} target="_blank" rel="noreferrer" className={btn}>Open the gateway login</a>
          <button onClick={() => status.refetch()} className="text-term-muted hover:text-term-amber uppercase tracking-widest text-[10px]">Check again</button>
        </div>
      )}

      {connected && (
        <>
          {accounts.error && <div className="text-term-red text-[11px]">Could not list accounts: {(accounts.error as Error).message}</div>}
          {(accounts.data?.length ?? 0) > 1 && (
            <label className="text-[11px] flex items-center gap-2">Account
              <select value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)} className="bg-term-bg border border-term-border text-[11px] py-0.5">
                {accounts.data!.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.title}{a.paper ? " (paper)" : ""}</option>)}
              </select>
            </label>
          )}
          {summary.data && (
            <div className="grid grid-cols-3 gap-3 max-w-md">
              <div><div className="sub-header">Net liquidation</div><div className="num text-[14px] text-term-heading">{fmtMoney(summary.data.netLiquidation)}</div></div>
              <div><div className="sub-header">Cash</div><div className="num text-[14px] text-term-heading">{fmtMoney(summary.data.cash)}</div></div>
              <div><div className="sub-header">Currency</div><div className="num text-[14px] text-term-heading">{summary.data.currency}</div></div>
            </div>
          )}
          {positions.isLoading && <div className="text-term-muted uppercase tracking-widest text-[11px]">Loading positions…</div>}
          {positions.error && <div className="text-term-red text-[11px]">Could not load positions: {(positions.error as Error).message}</div>}
          {positions.data && (
            <table className="w-full grid-data text-[11px]">
              <thead><tr><th>Symbol</th><th>Class</th><th className="text-right">Units</th><th className="text-right">Price</th><th className="text-right">Value</th><th className="text-right">Avg cost</th><th className="text-right">Unrealized</th><th>Tracked</th></tr></thead>
              <tbody>{positions.data.map((x) => {
                const skip = split.skipped.find((s) => s.ticker === x.ticker);
                return (
                  <tr key={`${x.conid}-${x.ticker}`}>
                    <td className="text-term-amber">{x.ticker}</td><td className="text-term-muted">{x.assetClass}</td>
                    <td className="num text-right">{x.units.toLocaleString("en-US")}</td><td className="num text-right">{fmtMoney(x.price, 2)}</td>
                    <td className="num text-right">{fmtMoney(x.value)}</td><td className="num text-right">{fmtMoney(x.avgCost, 2)}</td>
                    <td className={`num text-right ${(x.unrealizedPnl ?? 0) >= 0 ? "up" : "down"}`}>{fmtMoney(x.unrealizedPnl)}</td>
                    <td className="text-term-muted">{skip ? skip.reason : "yes"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
          {positions.data && positions.data.length === 0 && <div className="text-term-muted text-[11px]">No open positions.</div>}
          {positions.data && (
            <div className="flex flex-wrap items-center gap-2 border-t border-term-border pt-2 text-[11px]">
              <span className="sub-header">Sync into</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="bg-term-bg border border-term-border text-[11px] py-0.5">
                <option value="new">A new broker-reported portfolio</option>
                {brokerPfs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button disabled={split.ok.length === 0 && target === "new"} onClick={sync} className={btn}>Sync {split.ok.length} position{split.ok.length === 1 ? "" : "s"}</button>
              <span className="text-[10px] text-term-muted">Adds dated ledger entries at the broker's prices; earlier entries are never changed. New holdings count as money in, since deposits are not visible.</span>
            </div>
          )}
          {msg && <div role="status" className={msg.ok ? "text-term-green text-[11px]" : "text-term-red text-[11px]"}>{msg.text}</div>}
        </>
      )}
    </div>
  );
}
