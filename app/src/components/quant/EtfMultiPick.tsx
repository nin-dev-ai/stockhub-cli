import { CORE_ETFS, INSTRUMENT_BY_TICKER } from "@/quant/instruments";
import { MAX_SPREAD } from "@/quant/strategy";
import { cn } from "@/lib/cn";
import { EtfSelect } from "./EtfSelect";

interface Props {
  value: string[];
  onChange: (tickers: string[]) => void;
  ariaLabel: string;
  /** Not offered (already chosen elsewhere). */
  exclude?: string[];
  max?: number;
  note?: string;
}

/** Pick several ETFs: the core long-term ETFs as toggles, any other supported ETF from a dropdown. */
export function EtfMultiPick({ value, onChange, ariaLabel, exclude = [], max = MAX_SPREAD, note }: Props) {
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : value.length >= max ? value : [...value, t]);
  const extra = value.filter((t) => !CORE_ETFS.some((c) => c.ticker === t));
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={ariaLabel}>
      <div className="flex flex-wrap gap-1">
        {[...CORE_ETFS.map((c) => c.ticker), ...extra].filter((t) => !exclude.includes(t)).map((t) => (
          <button key={t} type="button" onClick={() => toggle(t)} aria-pressed={value.includes(t)} title={INSTRUMENT_BY_TICKER[t]?.name}
            className={cn("px-2 py-0.5 border text-[11px]", value.includes(t) ? "border-term-amber text-term-amber bg-term-amberSubtle" : "border-term-border text-term-muted hover:text-term-amber")}>
            {t}
          </button>
        ))}
      </div>
      <EtfSelect ariaLabel={`${ariaLabel}: add another ETF`} value="" originalLabel="+ Add another ETF…" originalValue=""
        onChange={(t) => t && !value.includes(t) && !exclude.includes(t) && value.length < max && onChange([...value, t])}
        className="bg-term-bg border border-term-border text-[11px] py-0.5 text-term-text" />
      <div className="text-[10px] text-term-muted">{note ?? `${value.length} of up to ${max} selected · money is split equally.`}</div>
    </div>
  );
}
