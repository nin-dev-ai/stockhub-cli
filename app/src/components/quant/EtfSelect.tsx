import { CORE_ETFS, INSTRUMENT_BY_TICKER, INSTRUMENT_GROUPS, INSTRUMENTS } from "@/quant/instruments";

const CORE = new Set(CORE_ETFS.map((c) => c.ticker));

interface Props {
  value: string;
  onChange: (ticker: string) => void;
  /** Shown first, e.g. "Original (SPY)"; selecting it passes `originalValue`. */
  originalLabel?: string;
  originalValue?: string;
  ariaLabel: string;
  className?: string;
}

/** Dropdown of every supported US-listed ETF: the core long-term ETFs first, then the rest by asset class. */
export function EtfSelect({ value, onChange, originalLabel, originalValue, ariaLabel, className }: Props) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}
      className={className ?? "w-full bg-term-bg border border-term-border text-[11px] py-1 text-term-text"}>
      {originalLabel && <option value={originalValue}>{originalLabel}</option>}
      <optgroup label="Core long-term">
        {CORE_ETFS.filter((c) => c.ticker !== originalValue).map((c) => (
          <option key={c.ticker} value={c.ticker} title={c.blurb}>{c.ticker} — {c.label} ({INSTRUMENT_BY_TICKER[c.ticker].name})</option>
        ))}
      </optgroup>
      {INSTRUMENT_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {INSTRUMENTS.filter((i) => g.types.includes(i.type) && i.ticker !== originalValue && !CORE.has(i.ticker)).map((i) => (
            <option key={i.ticker} value={i.ticker} title={i.note}>{i.ticker} — {i.name}{i.inception > "2005" ? ` (from ${i.inception.slice(0, 4)})` : ""}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
