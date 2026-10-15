import { useState } from "react";
import { Badge } from "@/components/quant/Badges";
import { fmtRate, fmtRatio } from "@/lib/format";
import { analyzeOverlap } from "@/quant/overlap";
import { OBJECTIVES, type OptimizationResult } from "@/quant/optimizer";
import { checkWeights, evaluateWeights, type Weights } from "@/quant/portfolio";
import type { LabInputs } from "@/quant/lab";
import type { BacktestBundle } from "@/quant/useLab";
import { cn } from "@/lib/cn";

function Bars({ weights, names }: { weights: Weights; names: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-1">
      {Object.entries(weights).map(([id, w]) => (
        <div key={id} className="flex items-center gap-2 text-[11px]">
          <span className="w-40 truncate text-term-text" title={names[id]}>{names[id]}</span>
          <div className="flex-1 h-2 bg-term-border"><div className="h-full bg-term-amber" style={{ width: `${w * 100}%` }} /></div>
          <span className="num w-10 text-right">{(w * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  bundle: BacktestBundle;
  opt: OptimizationResult | null;
  inputs: LabInputs;
  weights: Weights;
  weightsSource: string | null;
  override: Weights | null;
  setOverride: (w: Weights | null) => void;
  setObjective: (o: LabInputs["objective"]) => void;
}

export function AllocationView({ bundle, opt, inputs, weights, weightsSource, override, setOverride, setObjective }: Props) {
  const names = Object.fromEntries(bundle.sleeves.map((s) => [s.id, s.name]));
  const ids = bundle.sleeves.map((s) => s.id);
  // null until the user edits a box, so untouched fields always mirror the weights in use exactly
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const shown: Record<string, string> = draft ?? Object.fromEntries(ids.map((i) => [i, ((weights[i] ?? 0) * 100).toFixed(1)]));
  const parsed: Weights = draft ? Object.fromEntries(ids.map((i) => [i, Number(draft[i] ?? 0) / 100])) : weights;
  const edit = (id: string, v: string) => setDraft({ ...shown, [id]: v });
  const normalize = () => {
    const sum = ids.reduce((t, i) => t + (parsed[i] || 0), 0);
    if (sum > 0) setDraft(Object.fromEntries(ids.map((i) => [i, (((parsed[i] || 0) / sum) * 100).toFixed(2)])));
  };
  const check = checkWeights(parsed, ids, 1);
  const preview = check.ok ? evaluateWeights(bundle.sleeves, parsed, inputs.riskFreeRate).metrics : null;
  const overCap = ids.filter((i) => parsed[i] > inputs.maxWeight + 1e-9);

  const overlap = analyzeOverlap(bundle.results.map((r) => ({ id: r.strategy.id, name: r.strategy.name, run: r.run })), weights);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone="amber">Historical weights</Badge>
        <span className="text-[11px] text-term-muted">Current weights come from: <span className="text-term-amber">{weightsSource}</span>. Long-only, fully invested, no leverage.</span>
      </div>

      {opt ? (
        <>
          <div className="text-[11px] text-term-muted">{opt.method} Each objective trades off risk and return differently; none is the single best.</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {OBJECTIVES.map((o) => {
              const p = opt.proposals[o.key];
              const active = inputs.objective === o.key && !override;
              return (
                <div key={o.key} className={cn("panel p-3 flex flex-col gap-2", active && "border-term-amber")}>
                  <div className="flex items-center justify-between">
                    <span className="text-term-heading font-semibold">{o.label}</span>
                    <button onClick={() => { setOverride(null); setObjective(o.key); }} className="text-[10px] uppercase tracking-widest text-term-amber hover:underline">{active ? "In use" : "Use this"}</button>
                  </div>
                  <div className="text-[10px] text-term-muted leading-snug">{o.description}</div>
                  <Bars weights={p.weights} names={names} />
                  <div className="grid grid-cols-4 gap-1 text-[10px] border-t border-term-borderSoft pt-2">
                    {[["CAGR", fmtRate(p.metrics.cagr)], ["Vol", fmtRate(p.metrics.volatility)], ["Sharpe", fmtRatio(p.metrics.sharpe)], ["Max DD", fmtRate(p.metrics.maxDrawdown)]].map(([k, v]) => (
                      <div key={k}><div className="sub-header">{k}</div><div className="num text-term-text text-[12px]">{v}</div></div>
                    ))}
                  </div>
                  {p.binding.length > 0 && (
                    <div className="text-[10px] text-term-amberBright">
                      Constraints binding: {p.binding.map((b) => `${names[b.id]} ${b.kind === "cap" ? `at the ${(opt.effectiveCap * 100).toFixed(0)}% cap` : "at 0%"}`).join("; ")}.
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <table className="w-full grid-data text-[11px]">
            <thead><tr><th>Baseline</th><th className="text-right">CAGR</th><th className="text-right">Volatility</th><th className="text-right">Sharpe</th><th className="text-right">Max DD</th></tr></thead>
            <tbody>
              {opt.baselines.map((b) => (
                <tr key={b.label}><td>{b.label}</td><td className="num text-right">{fmtRate(b.metrics.cagr)}</td><td className="num text-right">{fmtRate(b.metrics.volatility)}</td><td className="num text-right">{fmtRatio(b.metrics.sharpe)}</td><td className="num text-right">{fmtRate(b.metrics.maxDrawdown)}</td></tr>
              ))}
            </tbody>
          </table>

          {opt.outOfSample && (
            <div className="border border-term-border p-3 text-[11px]">
              <div className="sub-header mb-1">Out-of-sample check</div>
              Weights refit on data before {opt.outOfSample.splitDate} ({Object.entries(opt.outOfSample.fitWeights).map(([i, w]) => `${(w * 100).toFixed(0)}%`).join(" / ")}) scored a Sharpe of{" "}
              <span className="num text-term-amber">{fmtRatio(opt.outOfSample.test.sharpe)}</span> afterwards, versus <span className="num">{fmtRatio(opt.outOfSample.equalWeightTest.sharpe)}</span> for equal weight.
              A large gap from the in-sample numbers means part of the result is hindsight.
            </div>
          )}
          <ul className="text-[10px] text-term-muted list-disc pl-4 space-y-0.5">{opt.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      ) : (
        <div className="text-term-muted text-[12px]">Run “Optimize Allocation” to see proposals for each objective next to equal-weight and single-strategy baselines.</div>
      )}

      <div className="border-t border-term-border pt-3">
        <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold mb-2">UNDERLYING OVERLAP</div>
        {overlap.warnings.length > 0 && <ul role="alert" className="text-term-amberBright text-[11px] list-disc pl-4 space-y-1 mb-2">{overlap.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        {overlap.pairs.length === 0 ? <div className="text-term-muted text-[11px]">One strategy in the basket, so there is nothing to overlap.</div> : (
          <table className="w-full grid-data text-[11px]">
            <thead><tr><th>Pair</th><th className="text-right">Shared exposure</th><th className="text-right">Return correlation</th><th className="text-right">Overlap</th></tr></thead>
            <tbody>{overlap.pairs.map((p) => (
              <tr key={p.a + p.b}><td>{names[p.a]} / {names[p.b]}</td><td className="num text-right">{(p.sharedExposure * 100).toFixed(0)}%</td><td className="num text-right">{p.returnCorrelation == null ? "n/a" : p.returnCorrelation.toFixed(2)}</td>
                <td className={cn("text-right uppercase text-[10px] tracking-widest", p.level === "high" ? "text-term-red" : p.level === "moderate" ? "text-term-amber" : "text-term-green")}>{p.level}</td></tr>
            ))}</tbody>
          </table>
        )}
        <div className="text-[10px] text-term-muted mt-1">
          Basket by asset class: {Object.entries(overlap.combined).filter(([, v]) => (v ?? 0) > 0.005).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, v]) => `${k.replace(/_/g, " ")} ${((v ?? 0) * 100).toFixed(0)}%`).join(" · ")}. {overlap.note}
        </div>
      </div>

      <div className="border-t border-term-border pt-3">
        <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold mb-2">OVERRIDE WEIGHTS</div>
        <div className="flex flex-wrap items-end gap-3">
          {ids.map((i) => (
            <label key={i} className="flex flex-col gap-0.5 text-[11px]">
              <span className="sub-header truncate max-w-[180px]">{names[i]}</span>
              <span className="flex items-center border border-term-border bg-term-bg">
                <input type="number" min={0} max={100} value={shown[i] ?? ""} onChange={(e) => edit(i, e.target.value)} className="w-16 bg-transparent px-2 py-1 num focus:outline-none" />
                <span className="pr-2 text-term-muted">%</span>
              </span>
            </label>
          ))}
          <button disabled={!check.ok} onClick={() => { setOverride(parsed); setDraft(null); }} className="px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle disabled:opacity-30 disabled:cursor-not-allowed">Apply weights</button>
          <button onClick={normalize} className="px-3 py-1 border border-term-border text-term-muted hover:text-term-text">Scale to 100%</button>
          {override && <button onClick={() => { setOverride(null); setDraft(null); }} className="px-3 py-1 border border-term-border text-term-muted hover:text-term-text">Use proposal</button>}
        </div>
        {!check.ok && <ul role="alert" className="text-term-red text-[11px] list-disc pl-4 mt-2">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {check.ok && overCap.length > 0 && <div className="text-term-amberBright text-[11px] mt-2">{overCap.map((i) => names[i]).join(", ")} above your {(inputs.maxWeight * 100).toFixed(0)}% cap. Allowed because overrides are yours to set.</div>}
        {preview && <div className="text-[11px] text-term-muted mt-2">Preview: CAGR <span className="num text-term-text">{fmtRate(preview.cagr)}</span> · volatility <span className="num text-term-text">{fmtRate(preview.volatility)}</span> · Sharpe <span className="num text-term-text">{fmtRatio(preview.sharpe)}</span> · max drawdown <span className="num text-term-text">{fmtRate(preview.maxDrawdown)}</span></div>}
      </div>
    </div>
  );
}
