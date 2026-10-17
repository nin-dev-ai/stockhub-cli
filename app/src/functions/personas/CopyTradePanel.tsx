import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { SeriesChart } from "@/components/charts/SeriesChart";
import { Badge, FlagList } from "@/components/quant/Badges";
import { fmtMoney, fmtRate, fmtRatio } from "@/lib/format";
import { COPY_BENCHMARK, COPY_SAFE, copyEvents, FUND_TOP_N, fundSteps, runCopyTrade, runFundCopy, type CopyTradeResult, type FundQuarter } from "@/quant/copyTrade";
import { loadDatasetFrom } from "@/quant/dataSource";
import { fetchForm13F } from "@/lib/api";
import { mapCusips } from "@/lib/figi";
import { holdingsByPeriod } from "@/quant/personas";
import { hashId } from "@/quant/hash";
import { twrIndex } from "@/quant/ranking";
import type { Persona, PersonaTrade } from "@/quant/personas";

const CFG = { initial: 10_000 };

const KEEP = [COPY_BENCHMARK, COPY_SAFE];

/** Insider and House trades: the window starts at the first trade; later listings are left out, not allowed to cut the window. */
async function copyEventsRun(persona: Persona, trades: PersonaTrade[]) {
  const first = copyEvents(trades).events.map((e) => e.traded).sort()[0];
  if (!first) return null;
  const tickers = [...new Set(copyEvents(trades).events.map((e) => e.ticker))];
  const { dataset, late } = await loadDatasetFrom([...tickers, ...KEEP], first, KEEP);
  const r = runCopyTrade(persona.id, persona.name, trades, dataset, CFG);
  return r && { ...r, unpriced: [...new Set([...r.unpriced, ...late])] };
}

/** Fund managers: about two years of 13F portfolios, CUSIPs mapped to tickers, the largest holdings priced. */
async function copyFundRun(persona: Persona & { source: { kind: "fund"; cik: string } }) {
  const rows = await fetchForm13F(persona.source.cik, 8);
  const byPeriod = holdingsByPeriod(rows);
  const quarters: FundQuarter[] = [...byPeriod.entries()].map(([period, m]) => ({ period, holdings: [...m.values()].filter((h) => !/\(/.test(h.issuer)).map((h) => ({ cusip: h.cusip, issuer: h.issuer, value: h.value })) }));
  if (quarters.length === 0) return null;
  const tickerOf = await mapCusips([...new Set(quarters.flatMap((q) => q.holdings.map((h) => h.cusip)))]);
  // only the tickers that can make a quarter's top holdings need prices
  const mapped = new Set(Object.values(tickerOf).filter((t): t is string => !!t));
  const wanted = [...new Set(fundSteps(quarters, tickerOf, mapped, "traded").allocation.steps.flatMap((s) => Object.keys(s.weights)))];
  const first = [...quarters].map((q) => q.period).sort()[0];
  const { dataset, late } = await loadDatasetFrom([...wanted, ...KEEP], first, KEEP);
  const r = runFundCopy(persona.id, persona.name, quarters, tickerOf, dataset, CFG);
  return r && { ...r, unpriced: [...new Set([...r.unpriced, ...late])] };
}

export function CopyTradePanel({ persona, trades, onClose, onResult }: {
  persona: Persona; trades: PersonaTrade[]; onClose: () => void; onResult: (r: CopyTradeResult | null) => void;
}) {
  const fund = persona.source.kind === "fund";
  const key = fund ? "13f" : hashId(trades.map((t) => [t.symbol, t.side, t.action, t.date, t.filed, t.accepted]));
  const q = useQuery({
    queryKey: ["copy-trade", persona.id, key],
    queryFn: () => (persona.source.kind === "fund" ? copyFundRun(persona as Persona & { source: { kind: "fund"; cik: string } }) : copyEventsRun(persona, trades)),
    staleTime: 6 * 3600_000,
    retry: 0,
  });
  useEffect(() => { onResult(q.data ?? null); }, [q.data, onResult]);
  const r = q.data;

  const rows = r ? [
    { label: fund ? "Copy, holding each 13F from its filing deadline" : "Copy, acting when each report is public", run: r.filed.run, strong: true },
    { label: fund ? "Copy, holding each 13F from quarter end (impossible in practice)" : "Copy, acting on the trade date (impossible in practice)", run: r.traded.run },
    { label: `${COPY_BENCHMARK} buy and hold`, run: r.filed.benchmark.run },
  ] : [];

  return (
    <div className="panel shrink-0 p-3 flex flex-col gap-3 border-term-amberDim">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-term-heading font-semibold">What if you had copied {persona.name}?</div>
          <div className="mt-1 flex gap-1"><Badge tone="amber">Historical backtest</Badge><Badge tone="red">Experimental</Badge><Badge>Not a recommendation</Badge></div>
        </div>
        <button onClick={onClose} aria-label="Close copy-trade backtest" className="text-term-muted hover:text-term-red"><X size={14} /></button>
      </div>
      <div className="text-[11px] text-term-muted leading-snug">
        {fund
          ? <>Holds the fund's {FUND_TOP_N} largest reported holdings by value (CUSIPs mapped to tickers with OpenFIGI), re-weighted to 100%, from each quarter's 45-day filing deadline, over about two years of 13F reports.</>
          : <>Each purchase adds the stock to an equal-weight copy portfolio, a full sale removes it and a partial sale keeps it; option trades count as stock exposure. SEC filings are acted on at the first close after they were accepted.</>}
        {" "}Starting with {fmtMoney(CFG.initial)}, with nothing held in {COPY_SAFE} until the first copy. Orders fill at the next close after the signal, with the usual costs.
      </div>
      {q.isLoading && <div className="text-[11px] text-term-muted uppercase tracking-widest">{fund ? "Loading two years of 13F reports, mapping tickers and prices…" : "Loading prices and running both versions…"}</div>}
      {q.error && <div className="text-[11px] text-term-red">Could not run: {(q.error as Error).message}</div>}
      {q.data === null && <div className="text-[11px] text-term-muted">Nothing to copy: no purchase with a ticker and price history in the reports read.</div>}
      {r && (
        <>
          <div className="text-[12px] text-term-amberBright">
            {fund
              ? <>Waiting for each 13F's filing deadline ended {fmtMoney(Math.abs(r.lagCost))} {r.lagCost >= 0 ? "below" : "above"} holding each portfolio from its quarter end{r.coverage != null && <>; the copy held on average {Math.round(r.coverage * 100)}% of the fund's reported value</>}.{" "}</>
              : <>Acting when the reports became public ended {fmtMoney(Math.abs(r.lagCost))} {r.lagCost >= 0 ? "below" : "above"} acting on the trade dates
                {r.medianLagDays != null && <> (the median report came {r.medianLagDays} days after the trade)</>}.{" "}</>}
            {r.lagCost >= 0 ? "That gap is the cost of the reporting delay a copier cannot avoid." : "Here the delay happened to help; it can as easily hurt."}
          </div>
          <table className="w-full grid-data text-[11px]">
            <thead><tr><th>Version</th><th className="text-right">Total return</th><th className="text-right">CAGR</th><th className="text-right">Max DD</th><th className="text-right">Sharpe</th><th className="text-right">Final value</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.label} className={x.strong ? "text-term-amber" : ""}>
                <td>{x.label}</td><td className="num text-right">{fmtRate(x.run.metrics.totalReturn)}</td><td className="num text-right">{fmtRate(x.run.metrics.cagr)}</td>
                <td className="num text-right">{fmtRate(x.run.metrics.maxDrawdown)}</td><td className="num text-right">{fmtRatio(x.run.metrics.sharpe)}</td><td className="num text-right">{fmtMoney(x.run.finalValue)}</td>
              </tr>
            ))}</tbody>
          </table>
          <SeriesChart dates={r.filed.run.dates} height={180} format={(v) => v.toFixed(0)} series={[
            { name: fund ? "Copy from filing deadline" : "Copy when public", color: "#ff8c00", values: twrIndex(r.filed.run.returns) },
            { name: fund ? "Copy from quarter end" : "Copy on trade date", color: "#4fc3f7", values: twrIndex(r.traded.run.returns), dash: true },
            { name: `${COPY_BENCHMARK} buy & hold`, color: "#6e6e6e", values: twrIndex(r.filed.benchmark.run.returns), dash: true },
          ]} />
          <div className="sub-header">Growth of 100, {r.filed.window.start} → {r.filed.window.end}</div>
          <div className="text-[11px] text-term-text leading-snug">
            Copied {r.tickers.length} stock{r.tickers.length === 1 ? "" : "s"} from {r.events} {fund ? "quarterly 13F reports" : "reported purchases and sales"}: {r.tickers.join(", ")}.
            {r.unpriced.length > 0 && <> No price history for the whole window (often a later listing), left out: {r.unpriced.join(", ")}.</>}
            {r.skipped.length > 0 && <> No ticker found, left out: {r.skipped.slice(0, 12).join("; ")}{r.skipped.length > 12 ? ` and ${r.skipped.length - 12} more` : ""}.</>}
          </div>
          {r.filed.window.years < 1 && <div className="text-[11px] text-term-muted">Under a year of data: CAGR and other annualized figures are unavailable.</div>}
          <FlagList flags={r.filed.flags} />
          <ul className="list-disc pl-4 text-[10px] text-term-amberBright space-y-0.5">{r.filed.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="text-[10px] text-term-muted">Engine {r.filed.engineVersion} · dataset {r.filed.dataset.id} · runs {r.filed.runId.slice(0, 8)} / {r.traded.runId.slice(0, 8)}</div>
        </>
      )}
    </div>
  );
}
