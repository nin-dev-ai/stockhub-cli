import { useState } from "react";
import { SeriesChart } from "@/components/charts/SeriesChart";
import { Badge } from "@/components/quant/Badges";
import { fmtMoney, fmtRate } from "@/lib/format";
import { rebalanceTrades, TX_LABEL, type PlanSnapshot, type Portfolio, type TxDraft, type Attribution } from "@/quant/tracking";
import type { useTracking } from "@/quant/useTracking";
import { usePortfolios } from "@/store/portfolioStore";

export const signed = (v: number | null) => (v == null ? "n/a" : `${v < 0 ? "−" : "+"}${fmtMoney(Math.abs(v))}`);

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-term-border p-2">
      <div className="sub-header">{label}</div>
      <div className="num text-[16px] text-term-heading">{value}</div>
      {note && <div className="text-[10px] text-term-muted">{note}</div>}
    </div>
  );
}

function AttributionTable({ a }: { a: Attribution }) {
  const rows: [string, number | null, string][] = [
    ["Original plan median", a.plan.p50, `Median of the saved projection at ${a.monthsElapsed.toFixed(1)} months.`],
    ["Contribution difference", a.contributionDifference, `You put in ${fmtMoney(a.actualContributed)}; the plan assumed ${fmtMoney(a.plan.contributed)} by now.`],
    ["Projection error", a.projectionError, "The plan's realized return on your actual cash flows, versus the median path."],
    ["Allocation and implementation", a.allocationDifference, "Your actual holdings and trades versus following the plan's weights exactly."],
    ["FX movement", null, "Not applicable: USD instruments only."],
  ];
  return (
    <table className="w-full grid-data text-[11px]">
      <thead><tr><th>Why the observed value differs from the original plan</th><th className="text-right">Amount</th></tr></thead>
      <tbody>
        {rows.map(([k, v, tip], i) => (
          <tr key={k}><td>{k}<div className="text-[10px] text-term-muted">{tip}</div></td>
            <td className={`num text-right ${i === 0 || v == null ? "" : v >= 0 ? "up" : "down"}`}>{i === 0 ? fmtMoney(v) : signed(v)}</td></tr>
        ))}
        <tr><td className="text-term-heading">Observed value</td><td className="num text-right text-term-heading">{fmtMoney(a.observed)}</td></tr>
      </tbody>
    </table>
  );
}

function PaperActions({ p, original, t }: { p: Portfolio; original: PlanSnapshot; t: ReturnType<typeof useTracking> }) {
  const addTransactions = usePortfolios((s) => s.addTransactions);
  const panel = t.data?.holdings?.panel;
  const date = t.view?.lastDate;
  const [amount, setAmount] = useState(String(original.inputs.monthly || 100));
  const [preview, setPreview] = useState<TxDraft[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!panel || !date || !t.data?.plan) return null;
  const targets = t.data.plan.targets;
  const fee = original.inputs.fixedFee;

  const contribute = () => {
    const v = Number(amount);
    const e = addTransactions(p.id, [{ date, kind: "contribution", amount: v, fee: 0, note: "Paper contribution" }]);
    setMsg(e.length ? e.join(" ") : `Recorded a ${fmtMoney(v)} contribution on ${date}. Rebalance to invest it.`);
  };
  const plan = () => { setPreview(rebalanceTrades(p.transactions, panel, targets, date, fee)); setMsg(null); };
  const confirm = () => {
    const e = addTransactions(p.id, preview ?? []);
    setMsg(e.length ? e.join(" ") : `Recorded ${preview!.length} paper trade(s) at the ${date} close.`);
    setPreview(null);
  };

  return (
    <div className="border border-term-border p-3 flex flex-col gap-2 text-[11px]">
      <div className="flex items-center gap-2"><span className="sub-header">Paper actions</span><Badge tone="cyan">Hypothetical</Badge>
        <span className="text-term-muted">Priced at the {date} adjusted close. Nothing is sent to a broker.</span></div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center border border-term-border"><span className="pl-2 text-term-muted">$</span>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24 bg-transparent px-2 py-1 num focus:outline-none" /></span>
        <button onClick={contribute} className="px-2 py-1 border border-term-amberDim text-term-amber">Record contribution</button>
        <button onClick={plan} className="px-2 py-1 border border-term-amberDim text-term-amber">Rebalance to plan…</button>
      </div>
      {preview && (
        <div className="border-t border-term-borderSoft pt-2 flex flex-col gap-2">
          {preview.length === 0 ? <div className="text-term-muted">Holdings already match the plan's targets within $1. No trades needed.</div> : (
            <table className="w-full grid-data">
              <thead><tr><th>Trade</th><th>Ticker</th><th className="text-right">Units</th><th className="text-right">Price</th><th className="text-right">Amount</th><th className="text-right">Fee</th></tr></thead>
              <tbody>{preview.map((d, i) => (
                <tr key={i}><td>{TX_LABEL[d.kind]}</td><td>{d.ticker}</td><td className="num text-right">{d.units!.toFixed(4)}</td>
                  <td className="num text-right">{fmtMoney(d.price, 2)}</td><td className="num text-right">{fmtMoney(d.units! * d.price!, 2)}</td><td className="num text-right">{fmtMoney(d.fee, 2)}</td></tr>
              ))}</tbody>
            </table>
          )}
          <div className="flex gap-2">
            {preview.length > 0 && <button onClick={confirm} className="px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle">Confirm paper trades</button>}
            <button onClick={() => setPreview(null)} className="px-2 py-1 border border-term-border text-term-muted">Cancel</button>
          </div>
        </div>
      )}
      {msg && <div role="status" className="text-term-text">{msg}</div>}
    </div>
  );
}

export function OverviewView({ p, snaps, t }: { p: Portfolio; snaps: PlanSnapshot[]; t: ReturnType<typeof useTracking> }) {
  const v = t.view;
  const original = snaps[0];
  if (t.job?.status === "failed") return <div role="alert" className="text-term-red text-[12px]">Prices could not be loaded: {t.job.error}. Use Retry above; the ledger and snapshots are still available.</div>;
  if (!v) return <div className="text-term-muted text-[12px]">{p.transactions.length === 0 && !original ? "Add entries on the Ledger tab to start tracking." : "Loading prices…"}</div>;

  const last = v.lastObs;
  const gain = last ? last.value - last.contributed : null;
  const tl = v.timeline;
  const latest = snaps.length > 1 ? snaps[snaps.length - 1] : null;

  return (
    <div className="flex flex-col gap-4">
      {v.unpriced.length > 0 && <div role="alert" className="text-term-amberBright text-[11px]">No price data for {v.unpriced.join(", ")}; their value is left out of the totals.</div>}
      <div className="grid grid-cols-4 gap-3 text-[11px]">
        <Tile label="Current value" value={fmtMoney(v.holdings.total)} note={p.mode === "paper" ? "Paper valuation" : "Manually reported holdings at market closes"} />
        <Tile label="Net contributed" value={fmtMoney(last?.contributed ?? 0)} note="Contributions and transfers in, less withdrawals" />
        <Tile label="Gain or loss" value={signed(gain)} note="Value minus net contributed" />
        <Tile label="Cash" value={fmtMoney(v.holdings.cash)} note="Earns 0% in this model" />
      </div>

      {tl && original ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="cyan">Original plan (saved {original.createdAt.slice(0, 10)})</Badge>
            <Badge tone={p.mode === "paper" ? "cyan" : "amber"}>{p.mode === "paper" ? "Paper observation" : "Manually reported observation"}</Badge>
            {latest && <Badge tone="green">Reforecast {latest.asOf}</Badge>}
            <span className="text-[11px] text-term-muted">Bands are model-based ranges from the saved projections, not predictions.</span>
          </div>
          <SeriesChart dates={tl.dates} height={260} format={(x) => fmtMoney(x)} markerDate={v.lastDate ?? undefined} markerLabel="latest"
            bands={[
              { name: "Original plan 10th–90th percentile", lower: tl.original.p10, upper: tl.original.p90, color: "#22ccee", opacity: 0.18 },
              ...(tl.latest ? [{ name: "Reforecast 10th–90th percentile", lower: tl.latest.p10, upper: tl.latest.p90, color: "#22ee22", opacity: 0.12 }] : []),
            ]}
            series={[
              { name: "Original plan median", color: "#22ccee", values: tl.original.p50, dash: true, width: 1 },
              { name: "Planned contributions", color: "#6e6e6e", values: tl.original.contributed, dash: true },
              ...(tl.latest ? [{ name: "Reforecast median", color: "#22ee22", values: tl.latest.p50, dash: true, width: 1 }] : []),
              { name: "Observed value", color: "#ff8c00", values: tl.observed, width: 2 },
              { name: "Your contributions", color: "#c8c8c8", values: tl.contributed, width: 1 },
            ]} />
          <div className="text-[10px] text-term-muted">Observed values are sampled at the last close on or before each monthly mark from the plan's start ({original.asOf}).</div>
        </div>
      ) : (
        <div className="text-[11px] text-term-muted">This record has no saved plan, so there is nothing to compare against. Save a plan from the Lab to track against a projection.</div>
      )}

      {v.attribution && (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <AttributionTable a={v.attribution} />
            <ul className="text-[10px] text-term-muted list-disc pl-4 space-y-0.5">{v.attribution.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
          <div className="flex flex-col gap-2 text-[11px]">
            <div className="border border-term-border p-2">
              <div className="sub-header">Position in the original range on {v.attribution.date}</div>
              <div className="num text-[14px] text-term-heading">
                {v.attribution.band === "within" ? "Inside the 10th–90th percentile range" : v.attribution.band === "below" ? "Below the 10th percentile" : "Above the 90th percentile"}
              </div>
              <div className="text-[10px] text-term-muted">Range {fmtMoney(v.attribution.plan.p10)} – {fmtMoney(v.attribution.plan.p90)}. At any date about 1 in 5 simulated paths lie outside it, so being outside is not by itself a failure.</div>
            </div>
            {v.attribution.planFollowing != null && (
              <Tile label="If the plan had been followed exactly" value={fmtMoney(v.attribution.planFollowing)} note="The saved weights replayed on realized prices with your actual cash flows." />
            )}
            {v.attributionLatest && (
              <Tile label="Latest reforecast median today" value={fmtMoney(v.attributionLatest.plan.p50)} note={`From the ${latest!.asOf} reforecast; range ${fmtMoney(v.attributionLatest.plan.p10)} – ${fmtMoney(v.attributionLatest.plan.p90)}.`} />
            )}
          </div>
        </div>
      )}

      <div>
        <div className="sub-header mb-1">Holdings and deviation from plan targets</div>
        <table className="w-full grid-data text-[11px]">
          <thead><tr><th>Ticker</th><th className="text-right">Units</th><th className="text-right">Last price</th><th className="text-right">Value</th><th className="text-right">Weight</th><th className="text-right">Plan target</th><th className="text-right">Deviation</th></tr></thead>
          <tbody>
            {v.holdings.rows.map((r) => (
              <tr key={r.ticker}>
                <td>{r.ticker}</td><td className="num text-right">{r.units.toFixed(4)}</td><td className="num text-right">{fmtMoney(r.price, 2)}</td>
                <td className="num text-right">{fmtMoney(r.value, 2)}</td><td className="num text-right">{fmtRate(r.weight)}</td>
                <td className="num text-right">{r.target == null ? "—" : fmtRate(r.target)}</td>
                <td className="num text-right">{r.target == null || r.weight == null ? "—" : `${((r.weight - r.target) * 100).toFixed(1)} pts`}</td>
              </tr>
            ))}
            <tr><td>Cash</td><td /><td /><td className="num text-right">{fmtMoney(v.holdings.cash, 2)}</td><td className="num text-right">{fmtRate(v.holdings.total > 0 ? v.holdings.cash / v.holdings.total : null)}</td><td /><td /></tr>
          </tbody>
        </table>
        <div className="text-[10px] text-term-muted mt-1">
          Plan targets are each strategy's current rule output on the latest data, scaled by the saved weights.
          {p.mode === "manual" ? " Values use the latest market close; earlier points in the chart use dividend-adjusted closes, so record cash dividends as Dividend entries." : " Paper lots reinvest distributions implicitly, like the backtests."}
        </div>
      </div>

      {p.mode === "paper" && original && <PaperActions p={p} original={original} t={t} />}
    </div>
  );
}
