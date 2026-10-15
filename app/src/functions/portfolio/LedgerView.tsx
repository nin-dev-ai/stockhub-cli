import { useMemo, useState } from "react";
import { Badge } from "@/components/quant/Badges";
import { cn } from "@/lib/cn";
import { download } from "@/lib/download";
import { fmtMoney } from "@/lib/format";
import { closeOn, isTrade, ledgerAt, ledgerCsv, sortTx, TX_LABEL, type Portfolio, type TxKind } from "@/quant/tracking";
import type { Panel } from "@/quant/types";
import { usePortfolios } from "@/store/portfolioStore";

const KINDS: TxKind[] = ["contribution", "buy", "sell", "dividend", "fee", "withdrawal", "transfer_in"];
const today = () => new Date().toISOString().slice(0, 10);

const input = "bg-term-bg border border-term-border px-2 py-1 text-[11px] focus:outline-none focus:border-term-amberDim";

export function LedgerView({ p, lastDate, panel }: { p: Portfolio; lastDate: string | null; panel: Panel | null }) {
  const { addTransactions, deleteTransaction, deletePortfolio, renamePortfolio } = usePortfolios();
  const [kind, setKind] = useState<TxKind>("contribution");
  const [date, setDate] = useState(lastDate ?? today());
  const [ticker, setTicker] = useState("");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("0");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [filter, setFilter] = useState<TxKind | "all">("all");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const trade = isTrade(kind);
  const paper = p.mode === "paper";

  // paper trades are always priced at the close, so the price field is filled and locked
  const paperPrice = paper && trade && panel && ticker ? closeOn(panel, ticker.toUpperCase(), date) : null;

  const submit = () => {
    const d = {
      date, kind, fee: Number(fee || 0), note: note.trim() || undefined,
      ...(trade ? { ticker: ticker.toUpperCase(), units: Number(units), price: paper ? paperPrice ?? NaN : Number(price) } : { amount: Number(amount) }),
    };
    if (paper && trade && paperPrice == null) { setErrors([`No close for ${ticker.toUpperCase() || "this ticker"} on or before ${date}. Paper trades need a market price; refresh prices or pick a plan ticker.`]); return; }
    const e = addTransactions(p.id, [d]);
    setErrors(e);
    if (e.length === 0) { setUnits(""); setPrice(""); setAmount(""); setNote(""); }
  };

  const rows = useMemo(() => sortTx(p.transactions).reverse().filter((t) => filter === "all" || t.kind === filter), [p.transactions, filter]);
  const state = ledgerAt(p.transactions);

  return (
    <div className="flex flex-col gap-4 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        {paper ? <Badge tone="cyan">Paper ledger · hypothetical</Badge> : <Badge tone="amber">Manually reported · not broker-verified</Badge>}
        <span className="text-term-muted">Cash {fmtMoney(state.cash, 2)} · net contributed {fmtMoney(state.netContributed, 2)} · fees {fmtMoney(state.fees, 2)} · dividends {fmtMoney(state.dividends, 2)}</span>
      </div>

      <div className="border border-term-border p-3 flex flex-col gap-2">
        <div className="sub-header">Add entry</div>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col gap-0.5"><span className="sub-header">Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as TxKind)} className={input}>
              {KINDS.filter((k) => !(paper && k === "transfer_in")).map((k) => <option key={k} value={k}>{TX_LABEL[k]}</option>)}
            </select></label>
          <label className="flex flex-col gap-0.5"><span className="sub-header">Date</span>
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={input} /></label>
          {trade ? <>
            <label className="flex flex-col gap-0.5"><span className="sub-header">Ticker</span>
              <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="SPY" className={cn(input, "w-20 uppercase")} /></label>
            <label className="flex flex-col gap-0.5"><span className="sub-header">Units</span>
              <input type="number" min={0} value={units} onChange={(e) => setUnits(e.target.value)} className={cn(input, "w-24 num")} /></label>
            <label className="flex flex-col gap-0.5"><span className="sub-header">Price per unit</span>
              {paper
                ? <span className={cn(input, "w-28 num text-term-muted")} title="Paper trades use the adjusted close on the trade date.">{paperPrice == null ? "close n/a" : fmtMoney(paperPrice, 2)}</span>
                : <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className={cn(input, "w-28 num")} />}
            </label>
          </> : (
            <label className="flex flex-col gap-0.5"><span className="sub-header">Amount</span>
              <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(input, "w-28 num")} /></label>
          )}
          <label className="flex flex-col gap-0.5"><span className="sub-header">Fee</span>
            <input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} className={cn(input, "w-20 num")} /></label>
          <label className="flex flex-col gap-0.5 flex-1 min-w-[120px]"><span className="sub-header">Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={input} /></label>
          <button onClick={submit} className="px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle">Add</button>
        </div>
        {kind === "transfer_in" && <div className="text-term-muted">Use Existing holding for units you already owned. Its value at the stated price counts as money put in.</div>}
        {errors.length > 0 && <ul role="alert" className="text-term-red list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </div>

      <div className="flex items-center gap-2">
        <span className="sub-header">Filter</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value as TxKind | "all")} className={input}>
          <option value="all">All entries</option>
          {KINDS.map((k) => <option key={k} value={k}>{TX_LABEL[k]}</option>)}
        </select>
        <button onClick={() => download(`${p.name.replace(/\W+/g, "-")}-ledger.csv`, ledgerCsv(p), "text/csv")} className="ml-auto px-2 py-1 border border-term-border text-term-muted hover:text-term-amber">Download CSV</button>
      </div>
      <table className="w-full grid-data">
        <thead><tr><th>Date</th><th>Type</th><th>Ticker</th><th className="text-right">Units</th><th className="text-right">Price</th><th className="text-right">Amount</th><th className="text-right">Fee</th><th>Note</th><th /></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="num">{t.date}</td><td>{TX_LABEL[t.kind]}</td><td>{t.ticker ?? ""}</td>
              <td className="num text-right">{t.units?.toFixed(4) ?? ""}</td><td className="num text-right">{t.price != null ? fmtMoney(t.price, 2) : ""}</td>
              <td className={cn("num text-right", t.kind === "withdrawal" || t.kind === "buy" || t.kind === "fee" ? "down" : "up")}>{fmtMoney(t.amount, 2)}</td>
              <td className="num text-right">{t.fee ? fmtMoney(t.fee, 2) : ""}</td><td className="text-term-muted">{t.note ?? ""}</td>
              <td><button onClick={() => { const e = deleteTransaction(p.id, t.id); setErrors(e); }} className="text-term-muted hover:text-term-red" aria-label="Delete entry">×</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="text-term-muted">No entries.</td></tr>}
        </tbody>
      </table>
      <div className="text-[10px] text-term-muted">Editing the ledger never changes a saved snapshot; it only changes what is observed.</div>

      <div className="border-t border-term-border pt-3 flex flex-wrap gap-2 items-center">
        <span className="sub-header">Record</span>
        <input defaultValue={p.name} onBlur={(e) => renamePortfolio(p.id, e.target.value)} className={cn(input, "w-56")} aria-label="Portfolio name" />
        {confirmDelete ? <>
          <span className="text-term-red">Delete this portfolio, its ledger and its snapshots?</span>
          <button onClick={() => deletePortfolio(p.id)} className="px-2 py-1 border border-term-red text-term-red">Delete</button>
          <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 border border-term-border text-term-muted">Keep</button>
        </> : <button onClick={() => setConfirmDelete(true)} className="ml-auto px-2 py-1 border border-term-border text-term-muted hover:text-term-red">Delete portfolio…</button>}
      </div>
    </div>
  );
}
