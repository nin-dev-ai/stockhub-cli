import { useState } from "react";
import { Badge } from "@/components/quant/Badges";
import { download } from "@/lib/download";
import { fmtMoney, fmtRate } from "@/lib/format";
import { verifySnapshot, type PlanSnapshot, type Portfolio } from "@/quant/tracking";
import type { useTracking } from "@/quant/useTracking";
import { usePortfolios } from "@/store/portfolioStore";

const HORIZONS = [1, 3, 5, 10, 20];

function SnapshotCard({ s, n }: { s: PlanSnapshot; n: number }) {
  const ok = verifySnapshot(s);
  const pr = s.projection;
  return (
    <div className="border border-term-border p-3 flex flex-col gap-2 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-term-heading text-[12px]">#{n} {s.kind === "original" ? "Original plan" : "Reforecast"}</span>
        <Badge tone="cyan">Future simulation (model-based)</Badge>
        {ok ? <Badge tone="green" title={`Fingerprint ${s.id}`}>Unchanged since saved</Badge> : <Badge tone="red">Altered after saving</Badge>}
        <Badge tone={pr.quality === "adequate" ? "green" : pr.quality === "limited" ? "amber" : "red"}>Data quality: {pr.quality}</Badge>
        <button onClick={() => download(`stockhub-snapshot-${s.id}.json`, JSON.stringify(s, null, 2), "application/json")} className="ml-auto px-2 py-0.5 border border-term-border text-term-muted hover:text-term-amber">JSON</button>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
        <div><span className="text-term-muted">Saved</span> {s.createdAt.slice(0, 16).replace("T", " ")}</div>
        <div><span className="text-term-muted">Starts from data through</span> {s.asOf}</div>
        <div><span className="text-term-muted">Starting value</span> {fmtMoney(pr.startValue)} · <span className="text-term-muted">monthly</span> {fmtMoney(pr.monthly)}</div>
        <div><span className="text-term-muted">Horizon</span> {pr.years} years · {pr.method} · {pr.paths.toLocaleString()} paths · seed {pr.seed}</div>
        <div><span className="text-term-muted">Weights</span> {Object.entries(s.weights).map(([k, v]) => `${s.strategies.find((x) => x.id === k)?.name ?? k} ${fmtRate(v, 0)}`).join(" · ")}</div>
        <div><span className="text-term-muted">Engine</span> {s.engineVersion} · <span className="text-term-muted">dataset</span> {s.datasetId.slice(0, 8)} ({s.dataWindow.start} → {s.dataWindow.end})</div>
        <div className="col-span-2"><span className="text-term-muted">Strategy versions</span> {s.strategies.map((x) => `${x.name} v${x.version} (${x.hash.slice(0, 8)})`).join(" · ")}</div>
      </div>
      <table className="w-full grid-data">
        <thead><tr><th>After {pr.years} years</th><th className="text-right">Lower (10th)</th><th className="text-right">Median</th><th className="text-right">Upper (90th)</th><th className="text-right">Below contributions</th></tr></thead>
        <tbody><tr><td>Ending balance</td><td className="num text-right">{fmtMoney(pr.ending.p10)}</td><td className="num text-right">{fmtMoney(pr.ending.p50)}</td><td className="num text-right">{fmtMoney(pr.ending.p90)}</td><td className="num text-right">{fmtRate(pr.probLoss)}</td></tr></tbody>
      </table>
      {pr.reasons.length > 0 && <ul className="text-term-amberBright list-disc pl-4">{pr.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      <details><summary className="sub-header cursor-pointer">Assumptions</summary>
        <ul className="text-[10px] text-term-muted list-disc pl-4 mt-1 space-y-0.5">{pr.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></details>
    </div>
  );
}

export function SnapshotsView({ p, snaps, t }: { p: Portfolio; snaps: PlanSnapshot[]; t: ReturnType<typeof useTracking> }) {
  const addSnapshot = usePortfolios((s) => s.addSnapshot);
  const [years, setYears] = useState(5);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setMsg(null);
    const r = await t.reforecast(years);
    setBusy(false);
    if (typeof r === "string") { setMsg(r); return; }
    const e = addSnapshot(p.id, r);
    setMsg(e ?? `Saved a ${years}-year reforecast from ${fmtMoney(r.projection.startValue)} on ${r.asOf}. Earlier snapshots are unchanged.`);
  };

  if (snaps.length === 0) return <div className="text-[12px] text-term-muted">This record has no saved plan. Snapshots are created when you save a plan from the Simulation Lab.</div>;
  return (
    <div className="flex flex-col gap-4">
      <div className="border border-term-border p-3 flex flex-col gap-2 text-[11px]">
        <div className="sub-header">Reforecast on current data</div>
        <div className="text-term-muted">Re-runs the original plan's strategies and weights on today's data, starting from the current value with the plan's monthly contribution. A new snapshot is added; earlier ones are never overwritten.</div>
        <div className="flex items-center gap-2">
          <span className="sub-header">Horizon</span>
          {HORIZONS.map((h) => (
            <button key={h} onClick={() => setYears(h)} className={`px-2 py-0.5 border ${years === h ? "border-term-amber text-term-amber bg-term-amberSubtle" : "border-term-border text-term-muted"}`}>{h}y</button>
          ))}
          <button disabled={busy || !t.view?.lastObs} onClick={() => void run()} className="ml-2 px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle disabled:opacity-30">
            {busy ? "Running…" : "Run reforecast"}
          </button>
        </div>
        {years > 5 && <div className="text-term-amberBright">Longer horizons compound uncertainty: the range widens and depends more heavily on the history sample.</div>}
        {msg && <div role="status" className="text-term-text">{msg}</div>}
      </div>
      {[...snaps].reverse().map((s) => <SnapshotCard key={s.id} s={s} n={snaps.indexOf(s) + 1} />)}
    </div>
  );
}
