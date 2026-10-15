import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtPts, fmtRate, fmtRatio } from "@/lib/format";
import type { StrategyDef } from "@/quant/strategy";
import type { BacktestResult } from "@/quant/service";
import { Badge, EvidenceBadge, VerdictBadge } from "@/components/quant/Badges";

interface Props {
  def: StrategyDef;
  result?: BacktestResult;
  error?: string;
  draft: boolean;
  /** Retargeted onto other ETFs by the screen-wide switch and not yet saved. */
  variant?: boolean;
  inBasket: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleBasket: () => void;
}

function Stat({ k, v, tone, title }: { k: string; v: string; tone?: "up" | "down"; title?: string }) {
  return (
    <div title={title}>
      <div className="sub-header">{k}</div>
      <div className={cn("num text-[13px] text-term-heading", tone === "up" && "up", tone === "down" && "down")}>{v}</div>
    </div>
  );
}

export function StrategyCard({ def, result, error, draft, variant, inBasket, selected, onOpen, onToggleBasket }: Props) {
  const m = result?.run.metrics;
  const ex = result?.excess;
  return (
    <div className={cn("panel cursor-pointer hover:border-term-amberDim transition-colors", selected && "border-term-amber")} onClick={onOpen}>
      <div className="px-3 pt-2 pb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-term-heading font-semibold leading-snug">{def.name}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <EvidenceBadge status={def.evidence} />
            {def.experimental && <Badge tone="red" title="Research example; weak evidence even if the backtest looks good.">Experimental</Badge>}
            {draft && <Badge tone="cyan">My draft</Badge>}
            {variant && <Badge tone="cyan" title="The same rules on the ETFs chosen in the sidebar; saved as a draft when added to the basket.">ETF variant</Badge>}
            {result && <VerdictBadge verdict={result.robustness?.verdict} />}
            {def.riskLevel && <Badge title="Qualitative risk level">{def.riskLevel} risk</Badge>}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleBasket(); }}
          title={inBasket ? "Remove from basket" : "Add to basket"}
          className={cn("shrink-0 w-7 h-7 flex items-center justify-center border",
            inBasket ? "border-term-amber text-term-amber bg-term-amberSubtle" : "border-term-border text-term-muted hover:text-term-amber hover:border-term-amberDim")}
        >
          {inBasket ? <Check size={13} /> : <Plus size={13} />}
        </button>
      </div>
      <div className="px-3 pb-2 text-[11px] text-term-text leading-snug line-clamp-2">{def.summary}</div>
      {error ? (
        <div className="px-3 pb-3 text-[11px] text-term-red">Could not run: {error}</div>
      ) : !result ? (
        <div className="px-3 pb-3 text-[11px] text-term-muted uppercase tracking-widest">Running backtest…</div>
      ) : (
        <div className="px-3 pb-2 grid grid-cols-4 gap-2 border-t border-term-borderSoft pt-2">
          <Stat k="CAGR" v={fmtRate(m!.cagr)} title={`Benchmark ${def.benchmark}: ${fmtRate(result.benchmark.run.metrics.cagr)}`} />
          <Stat k={`vs ${def.benchmark}`} v={fmtPts(ex!.cagr)} tone={ex!.cagr == null ? undefined : ex!.cagr >= 0 ? "up" : "down"} title="CAGR minus the benchmark's CAGR" />
          <Stat k="Max DD" v={fmtRate(m!.maxDrawdown)} tone="down" />
          <Stat k="Sharpe" v={fmtRatio(m!.sharpe)} />
        </div>
      )}
      {result && (
        <div className="px-3 pb-2 flex items-center justify-between text-[10px] text-term-muted">
          <span className="num">{result.window.start} → {result.window.end} · {result.run.tradeCount} trades</span>
          <span title={`Dataset ${result.dataset.id} · engine ${result.engineVersion} · run ${result.runId}`}>method {result.runId.slice(0, 6)}</span>
        </div>
      )}
    </div>
  );
}
