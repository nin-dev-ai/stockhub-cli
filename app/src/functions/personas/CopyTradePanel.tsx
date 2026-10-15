import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { SeriesChart } from "@/components/charts/SeriesChart";
import { Badge, FlagList } from "@/components/quant/Badges";
import { fmtMoney, fmtRate, fmtRatio } from "@/lib/format";
import { COPY_BENCHMARK, COPY_SAFE, copyEvents, runCopyTrade, type CopyTradeResult } from "@/quant/copyTrade";
import { loadDataset } from "@/quant/dataSource";
import { hashId } from "@/quant/hash";
import { twrIndex } from "@/quant/ranking";
import type { Persona, PersonaTrade } from "@/quant/personas";

const CFG = { initial: 10_000 };

/** Prices from a month before the first copied trade, so the window is not trimmed by the start date. */
const datasetStart = (trades: PersonaTrade[]) => {
  const first = copyEvents(trades).events.map((e) => e.traded).sort()[0];
  return first ? new Date(Date.parse(first) - 31 * 864e5).toISOString().slice(0, 10) : null;
};

export function CopyTradePanel({ persona, trades, onClose, onResult }: {
  persona: Persona; trades: PersonaTrade[]; onClose: () => void; onResult: (r: CopyTradeResult | null) => void;
}) {
  const key = hashId(trades.map((t) => [t.symbol, t.side, t.action, t.date, t.filed]));
  const q = useQuery({
    queryKey: ["copy-trade", persona.id, key],
    queryFn: async () => {
      const start = datasetStart(trades);
      if (!start) return null;
      const tickers = [...new Set(copyEvents(trades).events.map((e) => e.ticker))];
      const ds = await loadDataset([...tickers, COPY_BENCHMARK, COPY_SAFE], start);
      return runCopyTrade(persona.id, persona.name, trades, ds, CFG);
    },
    staleTime: 6 * 3600_000,
    retry: 0,
  });
  useEffect(() => { onResult(q.data ?? null); }, [q.data, onResult]);
  const r = q.data;

  const rows = r ? [
    { label: "Copy, acting when each report is filed", run: r.filed.run, strong: true },
    { label: "Copy, acting on the trade date (impossible in practice)", run: r.traded.run },
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
        Each purchase adds the stock to an equal-weight copy portfolio, a full sale removes it and a partial sale keeps it; option trades count as stock exposure. Starting with {fmtMoney(CFG.initial)}, with nothing held in {COPY_SAFE} until the first copied trade. Orders fill at the next close after the signal, with the usual costs.
      </div>
      {q.isLoading && <div className="text-[11px] text-term-muted uppercase tracking-widest">Loading prices and running both versions…</div>}
      {q.error && <div className="text-[11px] text-term-red">Could not run: {(q.error as Error).message}</div>}
      {q.data === null && <div className="text-[11px] text-term-muted">Nothing to copy: no purchase with a ticker and price history in the reports read.</div>}
      {r && (
        <>
          <div className="text-[12px] text-term-amberBright">
            Acting when the reports became public ended {fmtMoney(Math.abs(r.lagCost))} {r.lagCost >= 0 ? "below" : "above"} acting on the trade dates
            {r.medianLagDays != null && <> (the median report came {r.medianLagDays} days after the trade)</>}.{" "}
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
            { name: "Copy on filing date", color: "#ff8c00", values: twrIndex(r.filed.run.returns) },
            { name: "Copy on trade date", color: "#4fc3f7", values: twrIndex(r.traded.run.returns), dash: true },
            { name: `${COPY_BENCHMARK} buy & hold`, color: "#6e6e6e", values: twrIndex(r.filed.benchmark.run.returns), dash: true },
          ]} />
          <div className="sub-header">Growth of 100, {r.filed.window.start} → {r.filed.window.end}</div>
          <div className="text-[11px] text-term-text leading-snug">
            Copied {r.tickers.length} stock{r.tickers.length === 1 ? "" : "s"} from {r.events} reported purchases and sales: {r.tickers.join(", ")}.
            {r.unpriced.length > 0 && <> No price history, left out: {r.unpriced.join(", ")}.</>}
            {r.skipped.length > 0 && <> No ticker, left out: {r.skipped.join("; ")}.</>}
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
