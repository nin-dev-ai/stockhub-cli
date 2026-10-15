import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { SeriesChart } from "@/components/charts/SeriesChart";
import { Badge, EvidenceBadge, FlagList, VerdictBadge } from "@/components/quant/Badges";
import { MetricsTable, UnavailableNotes } from "@/components/quant/MetricsTable";
import { fmtMoney, fmtPts, fmtRate, fmtRatio } from "@/lib/format";
import { drawdownSeries } from "@/quant/indicators";
import { twrIndex } from "@/quant/ranking";
import { describeRuleParts } from "@/quant/rules";
import { primaryRisky, requiredTickers, retarget, validateStrategy, withSpread, type StrategyDef } from "@/quant/strategy";
import { EtfSelect } from "@/components/quant/EtfSelect";
import { EtfMultiPick } from "@/components/quant/EtfMultiPick";
import type { BacktestResult } from "@/quant/service";
import { INSTRUMENT_BY_TICKER } from "@/quant/instruments";

interface Props {
  def: StrategyDef;
  result?: BacktestResult;
  draft: boolean;
  /** Shown on the screen-wide ETF switch but not saved yet. */
  unsavedVariant?: boolean;
  onSaveVariant?: () => void;
  /** Saves a copy of this strategy that runs on other ETFs, and opens it. */
  onRetarget: (variant: StrategyDef) => void;
  onClose: () => void;
  onFork: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const Section = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <section className="border-t border-term-border pt-3">
    <div className="flex items-center justify-between mb-2">
      <div className="text-term-amber text-[10px] tracking-[0.22em] font-bold uppercase">{title}</div>
      {right}
    </div>
    {children}
  </section>
);

function Flow({ def }: { def: StrategyDef }) {
  const p = describeRuleParts(def);
  const steps = [
    { n: "1", t: "Data", d: `Adjusted closes through day t for ${requiredTickers(def).join(", ")}.` },
    { n: "2", t: "Signal", d: p.signal.join(" ") },
    { n: "3", t: "Schedule", d: p.schedule.join(" ") },
    { n: "4", t: "Orders", d: "Fill at the next close (t+1) after slippage and fees." },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
      {steps.map((s, i) => (
        <div key={s.n} className="relative border border-term-border bg-term-panel2 p-2 text-[11px]">
          <div className="flex items-center gap-2 mb-1"><span className="text-term-amber font-bold">{s.n}</span><span className="sub-header">{s.t}</span></div>
          <div className="text-term-text leading-snug">{s.d}</div>
          {i < steps.length - 1 && <span className="hidden sm:block absolute -right-2 top-1/2 -translate-y-1/2 text-term-amber z-10">›</span>}
        </div>
      ))}
    </div>
  );
}

/** Pick a replacement for each ETF the strategy uses; the variant is validated before it can be saved. */
function EtfMapper({ def, onRetarget }: { def: StrategyDef; onRetarget: (v: StrategyDef) => void }) {
  const tickers = requiredTickers(def);
  const [map, setMap] = useState<Record<string, string>>({});
  const variant = useMemo(() => retarget(def, map), [def, map]);
  const changed = variant !== def;
  const v = changed ? validateStrategy(variant) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-term-muted">Keep the rules, swap the ETFs. The benchmark follows whatever replaces {def.benchmark}.</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {tickers.map((t) => (
          <label key={t} className="flex items-center gap-2 text-[11px]">
            <span className="w-12 text-term-amber shrink-0">{t}{t === def.benchmark ? "*" : ""}</span>
            <span className="text-term-muted">→</span>
            <EtfSelect ariaLabel={`Replace ${t}`} value={map[t] ?? t} originalLabel={`${t} (keep)`} originalValue={t}
              onChange={(x) => setMap((m) => ({ ...m, [t]: x }))}
              className="flex-1 min-w-0 bg-term-bg border border-term-border text-[11px] py-0.5 text-term-text" />
          </label>
        ))}
      </div>
      {v && !v.ok && <ul className="text-term-red text-[11px] list-disc pl-4">{v.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex items-center gap-2">
        <button disabled={!changed || !v?.ok} onClick={() => onRetarget(variant)}
          className="px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle text-[11px] disabled:opacity-30 disabled:cursor-not-allowed">
          Backtest on these ETFs
        </button>
        {changed && <span className="text-[10px] text-term-muted">Saves “{variant.name}” as a draft in this browser.</span>}
        {changed && <button onClick={() => setMap({})} className="text-[10px] text-term-muted hover:text-term-amber uppercase tracking-widest ml-auto">Reset</button>}
      </div>
    </div>
  );
}

/** Run the same rules on several ETFs at once, money split equally; saved as a draft before it runs. */
function EtfSpreader({ def, from, onRetarget }: { def: StrategyDef; from: string; onRetarget: (v: StrategyDef) => void }) {
  const [picked, setPicked] = useState<string[]>([from]);
  const variant = useMemo(() => (picked.length >= 2 ? withSpread(def, picked) : null), [def, picked]);
  const v = variant ? validateStrategy(variant) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-term-muted">Run these rules separately on each ETF you pick in place of {from}, with the money split equally, and add the results. The report shows whether spreading made the worst drawdown shallower.</div>
      <EtfMultiPick value={picked} onChange={setPicked} ariaLabel="ETFs to spread across" />
      {v && !v.ok && <ul className="text-term-red text-[11px] list-disc pl-4">{v.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex items-center gap-2">
        <button disabled={!variant || !v?.ok} onClick={() => variant && onRetarget(variant)}
          className="px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle text-[11px] disabled:opacity-30 disabled:cursor-not-allowed">
          Backtest across these ETFs
        </button>
        <span className="text-[10px] text-term-muted">{variant ? `Saves “${variant.name}” as a draft in this browser.` : "Pick at least two ETFs."}</span>
      </div>
    </div>
  );
}

function SpreadResults({ r }: { r: BacktestResult }) {
  const sp = r.spread!;
  const rows: { label: string; cagr: number | null; dd: number | null; sharpe: number | null; final: number; extra?: string; strong?: boolean }[] = [
    { label: "Combined", cagr: r.run.metrics.cagr, dd: r.run.metrics.maxDrawdown, sharpe: r.run.metrics.sharpe, final: r.run.finalValue, strong: true },
    ...sp.sleeves.map((s) => ({ label: `${s.ticker} sleeve (${Math.round(s.weight * 100)}%)`, cagr: s.cagr, dd: s.maxDrawdown, sharpe: s.sharpe, final: s.finalValue, extra: s.gainShare == null ? "–" : `${(s.gainShare * 100).toFixed(0)}% of gain` })),
    { label: `Same rules on ${sp.single.ticker} only`, cagr: sp.single.metrics.cagr, dd: sp.single.metrics.maxDrawdown, sharpe: sp.single.metrics.sharpe, final: sp.single.finalValue },
    { label: "Buy & hold of the same ETFs", cagr: sp.buyHold.metrics.cagr, dd: sp.buyHold.metrics.maxDrawdown, sharpe: sp.buyHold.metrics.sharpe, final: sp.buyHold.finalValue },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="text-term-amberBright text-[11px]">{sp.summary}</div>
      <table className="w-full grid-data text-[11px]">
        <thead><tr><th>Run</th><th className="text-right">CAGR</th><th className="text-right">Max DD</th><th className="text-right">Sharpe</th><th className="text-right">Final value</th><th className="text-right">Contribution</th></tr></thead>
        <tbody>{rows.map((x) => (
          <tr key={x.label} className={x.strong ? "text-term-amber" : ""}>
            <td>{x.label}</td><td className="num text-right">{fmtRate(x.cagr)}</td><td className="num text-right">{fmtRate(x.dd)}</td>
            <td className="num text-right">{fmtRatio(x.sharpe)}</td><td className="num text-right">{fmtMoney(x.final)}</td><td className="num text-right text-term-muted">{x.extra ?? ""}</td>
          </tr>
        ))}</tbody>
      </table>
      <div>
        <div className="sub-header mb-1">Correlation of daily returns between sleeves</div>
        <table className="grid-data text-[11px]">
          <thead><tr><th></th>{sp.sleeves.map((s) => <th key={s.ticker} className="text-right">{s.ticker}</th>)}</tr></thead>
          <tbody>{sp.sleeves.map((a, i) => (
            <tr key={a.ticker}><td className="text-term-amber">{a.ticker}</td>{sp.correlation[i].map((c, j) => <td key={j} className="num text-right">{c.toFixed(2)}</td>)}</tr>
          ))}</tbody>
        </table>
        <div className="text-[10px] text-term-muted mt-1">Close to 1 means the sleeves move together and spreading adds little diversification.</div>
      </div>
    </div>
  );
}

export function StrategyDetail({ def, result, draft, unsavedVariant, onSaveVariant, onRetarget, onClose, onFork, onEdit, onDelete }: Props) {
  const [showAllTrades, setShowAllTrades] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);
  const p = describeRuleParts(def);
  const json = JSON.stringify(def, null, 2);
  const r = result;
  const rb = r?.robustness;

  const growth = r ? twrIndex(r.run.returns) : [];
  const benchGrowth = r ? twrIndex(r.benchmark.run.returns) : [];
  const cols = r ? [{ label: "Strategy", run: r.run }, { label: `${r.benchmark.ticker} buy & hold`, run: r.benchmark.run }] : [];

  return (
    <div className="h-full overflow-auto scroll-thin bg-term-panel border-l border-term-amberDim">
      <div className="sticky top-0 z-20 bg-term-panel2 border-b border-term-border px-4 py-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-term-heading text-[15px] font-semibold">{def.name}</div>
          <div className="mt-1 flex flex-wrap gap-1 items-center">
            <EvidenceBadge status={def.evidence} />
            {def.experimental && <Badge tone="red">Experimental</Badge>}
            {draft && <Badge tone="cyan">My draft</Badge>}
            {r && <VerdictBadge verdict={rb?.verdict} />}
            <span className="sub-header">{def.id} · v{def.version}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-term-muted hover:text-term-red shrink-0" aria-label="Close"><X size={16} /></button>
      </div>

      <div className="p-4 flex flex-col gap-4 text-[12px]">
        <div className="flex flex-wrap gap-2">
          {unsavedVariant && onSaveVariant && <button onClick={onSaveVariant} className="px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle text-[11px]">Save ETF variant as draft</button>}
          <button onClick={onFork} className="px-2 py-1 border border-term-border text-term-muted hover:text-term-amber hover:border-term-amberDim text-[11px]">Fork to editable draft</button>
          {draft && <button onClick={onEdit} className="px-2 py-1 border border-term-amberDim text-term-amber text-[11px]">Edit definition</button>}
          {draft && <button onClick={onDelete} className="px-2 py-1 border border-term-redDim text-term-red text-[11px]">Delete draft</button>}
        </div>

        <div className="text-term-text leading-relaxed">{def.summary}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <div><span className="sub-header">Intended use </span><span className="text-term-text">{def.intendedUse}</span></div>
          <div><span className="sub-header">Holding period </span><span className="text-term-text">{def.holdingPeriod}</span></div>
          <div><span className="sub-header">Region </span><span className="text-term-text">{def.region} · USD</span></div>
          <div><span className="sub-header">Benchmark </span><span className="text-term-text">{def.benchmark} buy and hold</span></div>
          <div className="col-span-2"><span className="sub-header">Universe </span>
            {requiredTickers(def).map((t) => <span key={t} className="mr-3 text-term-text" title={INSTRUMENT_BY_TICKER[t]?.name}><span className="text-term-amber">{t}</span> {INSTRUMENT_BY_TICKER[t]?.name}</span>)}
          </div>
        </div>

        <Section title="How it works"><Flow def={def} /></Section>

        <Section title="Run on other ETFs"><EtfMapper key={def.id} def={def} onRetarget={onRetarget} /></Section>

        {!def.spread && primaryRisky(def) && (
          <Section title="Spread across several ETFs"><EtfSpreader key={def.id} def={def} from={primaryRisky(def)!} onRetarget={onRetarget} /></Section>
        )}

        <Section title="Exact rules" right={
          <button onClick={() => setShowJson((s) => !s)} className="text-[10px] text-term-muted hover:text-term-amber uppercase tracking-widest">{showJson ? "Hide" : "Show"} machine-readable definition</button>
        }>
          <ul className="list-disc pl-4 space-y-1 text-term-text leading-snug">
            {[...p.signal, ...p.schedule, p.execution].map((x) => <li key={x}>{x}</li>)}
          </ul>
          {showJson && (
            <div className="mt-2 relative">
              <button onClick={() => { void navigator.clipboard?.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
                className="absolute top-1 right-1 text-[10px] text-term-muted hover:text-term-amber">{copied ? "copied" : "copy"}</button>
              <pre className="bg-term-bg border border-term-border p-2 text-[10px] overflow-auto max-h-64 scroll-thin">{json}</pre>
            </div>
          )}
          <div className="mt-2 text-term-muted text-[11px]"><span className="sub-header">Methodology </span>{def.methodology}</div>
        </Section>

        {!r ? (
          <div className="text-term-muted uppercase text-[11px] tracking-widest">Running backtest…</div>
        ) : (
          <>
            <Section title="Evidence — historical backtest, not a forecast">
              <div className="text-[11px] text-term-text mb-2">
                <span className="num text-term-amber">{r.window.start} → {r.window.end}</span> ({r.window.years.toFixed(1)} years) · benchmark {r.benchmark.ticker} ·
                scorecard assumes {fmtMoney(r.config.initial)} start + {fmtMoney(r.config.contribution.amount)}/{r.config.contribution.frequency === "monthly" ? "month" : r.config.contribution.frequency}.
              </div>
              <div className="grid grid-cols-4 gap-3 mb-3">
                {[
                  ["CAGR", fmtRate(r.run.metrics.cagr)], [`vs ${r.benchmark.ticker}`, fmtPts(r.excess.cagr)],
                  ["Max drawdown", fmtRate(r.run.metrics.maxDrawdown)], ["Sharpe", fmtRatio(r.run.metrics.sharpe)],
                ].map(([k, v]) => <div key={k}><div className="sub-header">{k}</div><div className="num text-[15px] text-term-heading">{v}</div></div>)}
              </div>
              <SeriesChart dates={r.run.dates} height={200} log format={(v) => v.toFixed(0)}
                series={[{ name: "Strategy", color: "#ff8c00", values: growth }, { name: `${r.benchmark.ticker} buy & hold`, color: "#6e6e6e", values: benchGrowth, dash: true }]} />
              <div className="sub-header mb-2">Growth of 100 (time-weighted, log scale)</div>
              <SeriesChart dates={r.run.dates} height={120} zeroLine format={(v) => `${(v * 100).toFixed(0)}%`}
                series={[{ name: "Strategy drawdown", color: "#ff3b3b", values: drawdownSeries(growth) }, { name: `${r.benchmark.ticker} drawdown`, color: "#6e6e6e", values: drawdownSeries(benchGrowth), dash: true }]} />
              <div className="sub-header mb-3">Drawdown from prior peak</div>
              <MetricsTable cols={cols} />
              <UnavailableNotes cols={cols} />
            </Section>

            {r.spread && <Section title="Spread across ETFs — per-ETF results"><SpreadResults r={r} /></Section>}

            <Section title="Robustness" right={<VerdictBadge verdict={rb?.verdict} />}>
              {rb && (
                <div className="flex flex-col gap-3">
                  {rb.reasons.length > 0 && <ul className="list-disc pl-4 text-term-amberBright text-[11px] space-y-0.5">{rb.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
                  {rb.split && (
                    <div>
                      <div className="sub-header mb-1">Train / test split at {rb.split.date}</div>
                      <table className="w-full grid-data text-[11px]">
                        <thead><tr><th>Period</th><th className="text-right">Strategy Sharpe</th><th className="text-right">{r.benchmark.ticker} Sharpe</th><th className="text-right">Strategy max DD</th><th className="text-right">{r.benchmark.ticker} max DD</th></tr></thead>
                        <tbody>
                          {[["Train", rb.split.train], ["Test", rb.split.test]].map(([name, s]) => {
                            const seg = s as typeof rb.split.train;
                            return <tr key={name as string}><td>{name as string} <span className="text-term-muted num">{seg.start.slice(0, 7)} → {seg.end.slice(0, 7)}</span></td>
                              <td className="num text-right">{fmtRatio(seg.strategy.sharpe)}</td><td className="num text-right">{fmtRatio(seg.benchmark.sharpe)}</td>
                              <td className="num text-right">{fmtRate(seg.strategy.maxDrawdown)}</td><td className="num text-right">{fmtRate(seg.benchmark.maxDrawdown)}</td></tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {rb.rolling.windows.length > 0 && (
                    <div>
                      <div className="sub-header mb-1">Rolling {rb.rolling.windowYears}-year windows — {rb.rolling.pctNotWorse == null ? "too few windows" : `${(rb.rolling.pctNotWorse * 100).toFixed(0)}% not worse than ${r.benchmark.ticker}`}</div>
                      <div className="flex gap-[2px] items-end h-6">
                        {rb.rolling.windows.map((w) => (
                          <div key={w.start} title={`${w.start} → ${w.end}: Sharpe ${fmtRatio(w.strategySharpe)} vs ${fmtRatio(w.benchmarkSharpe)}`}
                            className={w.notWorse ? "flex-1 h-full bg-term-greenDim" : "flex-1 h-3 bg-term-redDim"} />
                        ))}
                      </div>
                    </div>
                  )}
                  {rb.sensitivity.map((s) => (
                    <div key={s.path}>
                      <div className="sub-header mb-1">Sensitivity: {s.path} (base {s.base}){s.informational ? " · shown, not judged" : s.stable == null ? "" : s.stable ? " · stable" : " · unstable"}</div>
                      <table className="w-full grid-data text-[11px]">
                        <thead><tr><th>Value</th><th className="text-right">CAGR</th><th className="text-right">Sharpe</th><th className="text-right">Max DD</th></tr></thead>
                        <tbody>{s.rows.map((row) => (
                          <tr key={row.value} className={row.value === s.base ? "text-term-amber" : ""}>
                            <td className="num">{row.value}</td><td className="num text-right">{fmtRate(row.cagr)}</td>
                            <td className="num text-right">{fmtRatio(row.sharpe)}</td><td className="num text-right">{fmtRate(row.maxDrawdown)}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ))}
                  <details className="text-[10px] text-term-muted"><summary className="cursor-pointer uppercase tracking-widest">How the verdict is decided</summary>
                    <ul className="list-disc pl-4 mt-1 space-y-0.5">{rb.rules.map((x) => <li key={x}>{x}</li>)}</ul>
                  </details>
                </div>
              )}
            </Section>

            <Section title="Why it traded" right={<span className="sub-header">{r.run.decisions.length} decisions · {r.run.tradeCount} trades</span>}>
              <table className="w-full grid-data text-[11px]">
                <thead><tr><th>Decided</th><th>Filled</th><th>Trade</th><th className="text-right">Amount</th><th>Reason</th></tr></thead>
                <tbody>
                  {(showAllTrades ? r.run.trades : r.run.trades.slice(0, 25)).map((t, i) => (
                    <tr key={i}>
                      <td className="num text-term-muted">{t.decisionDate}</td><td className="num">{t.date}</td>
                      <td><span className={t.side === "buy" ? "up" : "down"}>{t.side.toUpperCase()}</span> <span className="text-term-amber">{t.ticker}</span></td>
                      <td className="num text-right">{fmtMoney(t.notional)}</td><td className="text-term-muted">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.run.trades.length > 25 && (
                <button onClick={() => setShowAllTrades((s) => !s)} className="mt-2 text-[10px] text-term-muted hover:text-term-amber uppercase tracking-widest">
                  {showAllTrades ? "Show first 25" : `Show all ${r.run.trades.length} trades`}
                </button>
              )}
            </Section>

            <Section title="Assumptions and data">
              <ul className="list-disc pl-4 space-y-1 text-term-text text-[11px]">{r.conventions.map((c) => <li key={c}>{c}</li>)}</ul>
              <div className="mt-2 text-[11px] text-term-muted num">
                Dataset {r.dataset.id} · {r.dataset.provider} · {r.dataset.rows} trading days · fetched {r.dataset.fetchedAt.slice(0, 16).replace("T", " ")} · engine {r.engineVersion} · run {r.runId}
              </div>
              <div className="mt-2"><FlagList flags={r.flags} /></div>
            </Section>
          </>
        )}

        <Section title="Warnings">
          <ul className="list-disc pl-4 space-y-1 text-term-amberBright text-[11px]">{def.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="mt-2 text-term-muted text-[10px]">Rule-based historical test, not investment advice. Past results do not predict future returns.</div>
        </Section>
      </div>
    </div>
  );
}
