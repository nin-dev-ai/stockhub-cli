import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/quant/Badges";
import { cn } from "@/lib/cn";
import { fmtMoney } from "@/lib/format";
import { ibkrAccounts, ibkrPositions, ibkrStatus, ibkrSummary, ibkrTickle } from "@/lib/ibkr";
import { answerQuestion, cancelAll, openOrders, previewOrder, resolveConid, submitOrder, type WhatIf } from "@/lib/ibkrOrders";
import { checkOrder, proposeRebalance, spentOn, type ProposedOrder } from "@/quant/orders";
import { useOrders } from "@/store/orderStore";
import { snapshotsOf, usePortfolios } from "@/store/portfolioStore";
import { useWorkspace } from "@/store/workspaceStore";

type RowState =
  | { step: "idle" }
  | { step: "busy"; what: string }
  | { step: "previewed"; whatIf: WhatIf }
  | { step: "confirm"; whatIf: WhatIf }
  | { step: "question"; replyId: string; messages: string[] }
  | { step: "placed"; orderId: string; status: string }
  | { step: "declined" }
  | { step: "error"; message: string };

const today = () => new Date().toISOString().slice(0, 10);
const describe = (o: ProposedOrder) => `${o.side === "BUY" ? "Buy" : "Sell"} ${o.quantity} ${o.ticker} at market`;

/**
 * Paper-account orders (permission policy 6.6.1): proposals from a saved plan, IBKR's preview,
 * one explicit confirmation per order, IBKR's own questions shown verbatim, hard limits enforced
 * in code, a kill switch and an append-only audit log. Live accounts are refused.
 */
export function ORD() {
  const openTab = useWorkspace((s) => s.openTab);
  const qc = useQueryClient();
  const { audit, killSwitch, limits, log, setKillSwitch, setLimits } = useOrders();
  const status = useQuery({ queryKey: ["ibkr-status"], queryFn: () => ibkrStatus(), refetchInterval: (q) => (q.state.data?.kind === "connected" ? 60_000 : 10_000), retry: 0 });
  const connected = status.data?.kind === "connected";
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => { void ibkrTickle().catch(() => status.refetch()); }, 60_000);
    return () => clearInterval(id);
  }, [connected, status]);

  const accounts = useQuery({ queryKey: ["ibkr-accounts"], queryFn: () => ibkrAccounts(), enabled: connected, retry: 0 });
  const [accountId, setAccountId] = useState<string | null>(null);
  const account = accounts.data?.find((a) => a.id === accountId) ?? accounts.data?.find((a) => a.paper) ?? accounts.data?.[0] ?? null;
  const live = !!account && !account.paper;
  const positions = useQuery({ queryKey: ["ibkr-positions", account?.id], queryFn: () => ibkrPositions(account!.id), enabled: connected && !!account, retry: 0 });
  const summary = useQuery({ queryKey: ["ibkr-summary", account?.id], queryFn: () => ibkrSummary(account!.id), enabled: connected && !!account, retry: 0 });
  const open = useQuery({ queryKey: ["ibkr-open-orders"], queryFn: () => openOrders(), enabled: connected && !!account && !live, retry: 0, refetchInterval: 30_000 });

  // a saved plan's latest snapshot supplies the target weights
  const { portfolios, snapshots } = usePortfolios();
  const plans = portfolios.filter((p) => p.snapshotIds.length > 0);
  const [planId, setPlanId] = useState<string | null>(null);
  const plan = plans.find((p) => p.id === planId) ?? plans[0] ?? null;
  const snap = plan ? snapshotsOf(plan, snapshots).at(-1) ?? null : null;

  const proposal = useMemo(() => (snap && positions.data && summary.data ? proposeRebalance(snap.targets, positions.data, summary.data.cash ?? 0) : null), [snap, positions.data, summary.data]);
  const [orders, setOrders] = useState<ProposedOrder[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  useEffect(() => { setOrders(proposal?.orders ?? []); setRows({}); }, [proposal]);
  useEffect(() => { if (proposal && account) log("proposed", account.id, `${proposal.orders.length} order(s) proposed from “${plan?.name}” (${snap?.kind} snapshot ${snap?.id.slice(0, 8)}).`); }, [proposal]); // eslint-disable-line react-hooks/exhaustive-deps

  const held = (t: string) => positions.data?.find((p) => p.ticker === t)?.units ?? 0;
  const ctxFor = (o: ProposedOrder) => ({ account, heldUnits: held(o.ticker), spentToday: spentOn(audit, today()), killSwitch, limits });
  const setRow = (id: string, s: RowState) => setRows((r) => ({ ...r, [id]: s }));
  const accId = account?.id ?? null;

  const preview = async (o: ProposedOrder) => {
    if (!account) return;
    setRow(o.id, { step: "busy", what: "Asking IBKR for a preview…" });
    try {
      let ord = o;
      if (ord.conid == null) {
        const conid = await resolveConid(o.ticker);
        ord = { ...o, conid };
        setOrders((xs) => xs.map((x) => (x.id === o.id ? ord : x)));
      }
      const w = await previewOrder(account.id, ord);
      log("previewed", account.id, `Commission ${w.commission ?? "n/a"}; equity change ${w.equityChange ?? "n/a"}${w.warning ? `; warning: ${w.warning}` : ""}${w.error ? `; error: ${w.error}` : ""}`, ord);
      setRow(o.id, { step: "previewed", whatIf: w });
    } catch (e) {
      log("error", account.id, `Preview failed: ${(e as Error).message}`, o);
      setRow(o.id, { step: "error", message: (e as Error).message });
    }
  };

  const send = async (o: ProposedOrder) => {
    if (!account) return;
    // blocked orders are never logged as sent, so they do not count toward the daily cap
    const problems = checkOrder(o, ctxFor(o));
    if (problems.length) { log("rejected", account.id, problems.join(" "), o); setRow(o.id, { step: "error", message: problems.join(" ") }); return; }
    setRow(o.id, { step: "busy", what: "Sending to IBKR…" });
    try {
      log("submitted", account.id, `${describe(o)} sent to ${account.id}.`, o);
      const r = await submitOrder(account.id, o, ctxFor(o));
      if (r.kind === "question") { log("broker_question", account.id, r.messages.join(" | "), o); setRow(o.id, { step: "question", replyId: r.replyId, messages: r.messages }); }
      else { log("placed", account.id, `Order ${r.orderId}: ${r.status}.`, o); setRow(o.id, { step: "placed", orderId: r.orderId, status: r.status }); }
      void qc.invalidateQueries({ queryKey: ["ibkr-open-orders"] });
    } catch (e) {
      log("rejected", account.id, (e as Error).message, o);
      setRow(o.id, { step: "error", message: (e as Error).message });
    }
  };

  const answer = async (o: ProposedOrder, replyId: string, yes: boolean) => {
    if (!account) return;
    if (!yes) { log("rejected", account.id, "You declined IBKR's question; the order was not sent.", o); setRow(o.id, { step: "declined" }); return; }
    setRow(o.id, { step: "busy", what: "Sending your answer…" });
    try {
      log("answered", account.id, "You answered yes to IBKR's question.", o);
      const r = await answerQuestion(account.id, replyId);
      if (r.kind === "question") { log("broker_question", account.id, r.messages.join(" | "), o); setRow(o.id, { step: "question", replyId: r.replyId, messages: r.messages }); }
      else { log("placed", account.id, `Order ${r.orderId}: ${r.status}.`, o); setRow(o.id, { step: "placed", orderId: r.orderId, status: r.status }); }
      void qc.invalidateQueries({ queryKey: ["ibkr-open-orders"] });
    } catch (e) {
      log("error", account.id, (e as Error).message, o);
      setRow(o.id, { step: "error", message: (e as Error).message });
    }
  };

  const [killMsg, setKillMsg] = useState<string | null>(null);
  const kill = async () => {
    let detail = "Trading switched off.";
    if (account?.paper && connected) {
      try { const r = await cancelAll(account.id); detail = `Trading switched off; cancelled ${r.cancelled.length} open order(s)${r.failed.length ? `, could not cancel ${r.failed.join(", ")}` : ""}.`; }
      catch (e) { detail = `Trading switched off; cancelling open orders failed: ${(e as Error).message}. Cancel them in IBKR.`; }
    }
    setKillSwitch(true, accId, detail);
    setKillMsg(detail);
    void qc.invalidateQueries({ queryKey: ["ibkr-open-orders"] });
  };
  const [understood, setUnderstood] = useState(false);
  const [draftLimits, setDraftLimits] = useState(limits);
  const [limitErr, setLimitErr] = useState<string[]>([]);

  const exportAudit = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `stockhub-order-audit-${today()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const btn = "px-2 py-0.5 border text-[11px] disabled:opacity-30 disabled:cursor-not-allowed";
  const amber = `${btn} border-term-amber text-term-amber hover:bg-term-amberSubtle`;
  return (
    <div className="h-full overflow-auto scroll-thin p-4 flex flex-col gap-4 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-term-amber text-[11px] uppercase tracking-[0.3em] font-bold">PAPER ORDERS</span>
        <Badge tone="cyan">Paper accounts only</Badge>
        <Badge>Each order needs your confirmation</Badge>
        {killSwitch ? <Badge tone="red">Trading switched off</Badge> : <Badge tone="green">Trading on</Badge>}
        <button onClick={kill} disabled={killSwitch} className={cn(btn, "ml-auto border-term-red text-term-red hover:bg-term-redDim/30 uppercase tracking-widest")}>Kill switch: cancel open orders and stop</button>
      </div>
      <div className="text-[11px] text-term-muted leading-snug max-w-4xl">
        Orders go to an Interactive Brokers <b>paper</b> account through the local gateway, one at a time, after IBKR's own preview and your confirmation. Live accounts are refused in code. Hard limits apply to every order: only StockHub's supported ETFs, whole shares, long only (no short sales), market or limit orders, a per-order cap and a daily cap. The Copilot can open this screen but cannot send, confirm or cancel orders. Not investment advice.
      </div>
      {killMsg && <div role="status" className="text-term-amberBright text-[11px]">{killMsg}</div>}
      {killSwitch && (
        <div className="panel shrink-0 p-3 flex flex-wrap items-center gap-3 border-term-redDim">
          <span className="text-term-red">Trading is switched off. Nothing can be sent until you turn it back on.</span>
          <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="accent-[#ff8c00]" /> I want to send paper orders again</label>
          <button disabled={!understood} onClick={() => { setKillSwitch(false, accId, "Trading turned back on by the user."); setUnderstood(false); setKillMsg(null); }} className={amber}>Turn trading back on</button>
        </div>
      )}

      {status.isLoading && <div className="text-term-muted uppercase tracking-widest text-[11px]">Checking the IBKR gateway…</div>}
      {status.data && status.data.kind !== "connected" && (
        <div className="text-[11px] text-term-text">
          {status.data.kind === "offline" ? "The IBKR gateway is not running." : "The IBKR gateway needs a login."} Set it up from My Portfolio → Interactive Brokers.{" "}
          <button onClick={() => openTab("PORT")} className="text-term-amber hover:underline">Open My Portfolio</button>
        </div>
      )}

      {connected && account && (
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <label className="flex items-center gap-2">Account
            <select value={account.id} onChange={(e) => setAccountId(e.target.value)} className="bg-term-bg border border-term-border text-[11px] py-0.5">
              {accounts.data!.map((a) => <option key={a.id} value={a.id}>{a.id}{a.paper ? " (paper)" : " (live: orders refused)"}</option>)}
            </select>
          </label>
          <Badge tone={account.paper ? "cyan" : "red"}>{account.paper ? "Paper account" : "Live account · orders refused"}</Badge>
          {summary.data && <span className="text-term-muted">Net liquidation <span className="num text-term-text">{fmtMoney(summary.data.netLiquidation)}</span> · cash <span className="num text-term-text">{fmtMoney(summary.data.cash)}</span></span>}
          <span className="text-term-muted">Sent today (UTC) <span className="num text-term-text">{fmtMoney(spentOn(audit, today()))}</span> of {fmtMoney(limits.maxDailyNotional)}</span>
        </div>
      )}
      {live && <div className="text-term-red text-[11px]">This is a live, real-money account. StockHub only sends orders to paper accounts; switch to your paper account in the gateway login.</div>}

      {connected && account && !live && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="sub-header">Rebalance to plan</span>
            {plans.length === 0
              ? <span className="text-[11px] text-term-muted">No saved plan yet. Save one from the Simulation Lab. <button onClick={() => openTab("LAB")} className="text-term-amber hover:underline">Open the Lab</button></span>
              : (
                <select value={plan?.id ?? ""} onChange={(e) => setPlanId(e.target.value)} className="bg-term-bg border border-term-border text-[11px] py-0.5">
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            {snap && <span className="text-[10px] text-term-muted">Targets from the {snap.kind} snapshot of {snap.createdAt.slice(0, 10)}: {Object.entries(snap.targets).filter(([, w]) => w > 0).map(([t, w]) => `${t} ${(w * 100).toFixed(0)}%`).join(", ")}</span>}
          </div>
          {proposal && proposal.notes.length > 0 && <ul className="list-disc pl-4 text-[11px] text-term-muted">{proposal.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          {orders.some((o) => o.side === "SELL") && orders.some((o) => o.side === "BUY") && <div className="text-[11px] text-term-amberBright">Send the sales first and let them fill: the purchases are sized with the cash they raise.</div>}
          {proposal && orders.length === 0 && <div className="text-[11px] text-term-muted">Already close to the plan; no whole-share order is needed.</div>}
          {orders.length > 0 && (
            <table className="w-full grid-data text-[11px]">
              <thead><tr><th>Order</th><th className="text-right">Est. price</th><th className="text-right">Est. amount</th><th>Why</th><th>Limits</th><th>Steps</th></tr></thead>
              <tbody>{orders.map((o) => {
                const s = rows[o.id] ?? { step: "idle" };
                const problems = checkOrder(o, ctxFor(o)).filter((p) => !(o.conid == null && /not resolved/.test(p)));
                return (
                  <tr key={o.id} className="align-top">
                    <td className={o.side === "BUY" ? "up" : "down"}>{describe(o)}</td>
                    <td className="num text-right">{fmtMoney(o.estPrice, 2)}</td><td className="num text-right">{fmtMoney(o.notional)}</td>
                    <td className="text-term-muted">{o.reason}</td>
                    <td className={problems.length ? "text-term-red" : "text-term-green"}>{problems.length ? problems.join(" ") : "Within limits"}</td>
                    <td className="min-w-[280px]">
                      {s.step === "idle" && <button disabled={problems.length > 0} onClick={() => preview(o)} className={amber}>Preview with IBKR</button>}
                      {s.step === "busy" && <span className="text-term-muted">{s.what}</span>}
                      {(s.step === "previewed" || s.step === "confirm") && (
                        <div className="flex flex-col gap-1">
                          <span className="text-term-muted">Commission {s.whatIf.commission ?? "n/a"} · equity change {s.whatIf.equityChange ?? "n/a"}{s.whatIf.warning ? ` · ${s.whatIf.warning}` : ""}</span>
                          {s.whatIf.error && <span className="text-term-red">IBKR: {s.whatIf.error}</span>}
                          {s.step === "previewed"
                            ? <button disabled={!!s.whatIf.error || problems.length > 0} onClick={() => setRow(o.id, { step: "confirm", whatIf: s.whatIf })} className={amber}>Send…</button>
                            : (
                              <span className="flex flex-wrap items-center gap-1">
                                <span className="text-term-amberBright">{describe(o)} in paper account {account.id}?</span>
                                <button onClick={() => send(o)} className={amber}>Confirm and send</button>
                                <button onClick={() => setRow(o.id, { step: "previewed", whatIf: s.whatIf })} className={`${btn} border-term-border text-term-muted`}>Cancel</button>
                              </span>
                            )}
                        </div>
                      )}
                      {s.step === "question" && (
                        <div className="flex flex-col gap-1">
                          <span className="sub-header">IBKR asks</span>
                          {s.messages.map((m) => <span key={m} className="text-term-amberBright">{m}</span>)}
                          <span className="flex gap-1">
                            <button onClick={() => answer(o, s.replyId, true)} className={amber}>Yes, send it</button>
                            <button onClick={() => answer(o, s.replyId, false)} className={`${btn} border-term-border text-term-muted`}>No, don't send</button>
                          </span>
                        </div>
                      )}
                      {s.step === "placed" && <span className="text-term-green">Placed: order {s.orderId}, {s.status}.</span>}
                      {s.step === "declined" && <span className="text-term-muted">Not sent.</span>}
                      {s.step === "error" && <span className="text-term-red">{s.message} <button onClick={() => setRow(o.id, { step: "idle" })} className="text-term-muted hover:text-term-amber">Reset</button></span>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </section>
      )}

      {connected && account && !live && (
        <section className="flex flex-col gap-1">
          <div className="sub-header">Open orders</div>
          {open.error && <div className="text-term-red text-[11px]">Could not load open orders: {(open.error as Error).message}</div>}
          {open.data && open.data.length === 0 && <div className="text-[11px] text-term-muted">None.</div>}
          {open.data && open.data.length > 0 && (
            <table className="grid-data text-[11px]">
              <thead><tr><th>Order</th><th>Account</th><th>Symbol</th><th>Side</th><th className="text-right">Qty</th><th>Status</th></tr></thead>
              <tbody>{open.data.map((x) => <tr key={x.orderId}><td className="num">{x.orderId}</td><td>{x.account}</td><td className="text-term-amber">{x.ticker}</td><td>{x.side}</td><td className="num text-right">{x.quantity ?? ""}</td><td>{x.status}</td></tr>)}</tbody>
            </table>
          )}
        </section>
      )}

      <section className="flex flex-col gap-1 max-w-xl">
        <div className="sub-header">Limits</div>
        <div className="flex flex-wrap items-end gap-2 text-[11px]">
          <label className="flex flex-col">Per-order cap ($)<input type="number" value={draftLimits.maxOrderNotional} onChange={(e) => setDraftLimits({ ...draftLimits, maxOrderNotional: Number(e.target.value) })} className="w-28 bg-term-bg border border-term-border px-1 py-0.5 num" /></label>
          <label className="flex flex-col">Daily cap ($)<input type="number" value={draftLimits.maxDailyNotional} onChange={(e) => setDraftLimits({ ...draftLimits, maxDailyNotional: Number(e.target.value) })} className="w-28 bg-term-bg border border-term-border px-1 py-0.5 num" /></label>
          <button onClick={() => setLimitErr(setLimits(draftLimits, accId))} className={amber}>Save limits</button>
        </div>
        {limitErr.length > 0 && <ul className="text-term-red text-[11px]">{limitErr.map((e) => <li key={e}>{e}</li>)}</ul>}
      </section>

      <section className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="sub-header">Audit log ({audit.length})</span>
          <button onClick={exportAudit} disabled={audit.length === 0} className={`${btn} border-term-border text-term-muted hover:text-term-amber`}>Export JSON</button>
          <span className="text-[10px] text-term-muted">Every proposal, preview, confirmation, broker answer and switch, kept in this browser and never edited.</span>
        </div>
        {audit.length > 0 && (
          <table className="w-full grid-data text-[11px]">
            <thead><tr><th>When (UTC)</th><th>Event</th><th>Account</th><th>Order</th><th>Detail</th></tr></thead>
            <tbody>{[...audit].reverse().slice(0, 100).map((x, i) => (
              <tr key={i}><td className="num whitespace-nowrap">{x.at.slice(0, 19).replace("T", " ")}</td><td>{x.kind.replace("_", " ")}</td><td>{x.accountId ?? ""}</td>
                <td className="whitespace-nowrap">{x.order ? `${x.order.side} ${x.order.quantity} ${x.order.ticker}` : ""}</td><td className="text-term-muted">{x.detail}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
