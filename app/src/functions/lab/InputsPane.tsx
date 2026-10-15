import { OBJECTIVES } from "@/quant/optimizer";
import type { LabInputs } from "@/quant/lab";
import { cn } from "@/lib/cn";
import { CORE_ETFS } from "@/quant/instruments";
import { EtfSelect } from "@/components/quant/EtfSelect";

function Num({ label, value, onChange, prefix, suffix, step = 1, min = 0, hint, scale = 1 }: {
  label: string; value: number | null; onChange: (v: number) => void; prefix?: string; suffix?: string; step?: number; min?: number; hint?: string; scale?: number;
}) {
  return (
    <label className="flex flex-col gap-0.5" title={hint}>
      <span className="sub-header">{label}</span>
      <span className="flex items-center border border-term-border bg-term-bg focus-within:border-term-amberDim">
        {prefix && <span className="pl-2 text-term-muted">{prefix}</span>}
        <input
          type="number" step={step} min={min} value={value == null ? "" : +(value * scale).toFixed(4)}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value) / scale)}
          className="w-full bg-transparent px-2 py-1 num text-term-text focus:outline-none"
        />
        {suffix && <span className="pr-2 text-term-muted">{suffix}</span>}
      </span>
    </label>
  );
}

interface Props {
  inputs: LabInputs;
  set: (p: Partial<LabInputs>) => void;
  basketNames: { id: string; name: string }[];
  /** Basket strategies that do not trade SPY, so the ETF choice leaves them as they are. */
  unchanged: string[];
  errors: string[];
  onReset: () => void;
}

export function InputsPane({ inputs: i, set, basketNames, unchanged, errors, onReset }: Props) {
  const isCore = CORE_ETFS.some((c) => c.ticker === i.etf);
  return (
    <aside className="w-64 shrink-0 border-r border-term-border p-3 flex flex-col gap-3 overflow-auto scroll-thin text-[12px]">
      <div className="flex items-center justify-between">
        <span className="text-term-amber text-[10px] tracking-[0.22em] font-bold">PLAN INPUTS</span>
        <button onClick={onReset} className="text-[10px] text-term-muted hover:text-term-amber uppercase tracking-widest">Reset</button>
      </div>

      <Num label="Starting amount" prefix="$" value={i.initial} onChange={(v) => set({ initial: v })} step={50} />
      <Num label="Existing holdings" prefix="$" value={i.existing} onChange={(v) => set({ existing: v })} step={50}
        hint="Value already held in ETFs. Treated as extra starting capital invested according to the plan from day one, not tracked lot by lot." />
      <Num label="Monthly contribution" prefix="$" value={i.monthly} onChange={(v) => set({ monthly: v })} step={10} />
      <Num label="Horizon" suffix="years" value={i.years} onChange={(v) => set({ years: v })} step={1} min={1} hint="1 to 30 years" />
      <div className="text-[10px] text-term-muted -mt-1">Currency: USD only. Other currencies are not supported.</div>

      <div>
        <div className="sub-header mb-1">Run on ETF</div>
        <div className="flex flex-col gap-1">
          {CORE_ETFS.map((c) => (
            <label key={c.ticker} title={c.blurb} className={cn("flex items-center gap-2 px-2 py-1 border cursor-pointer text-[11px]",
              i.etf === c.ticker ? "border-term-amber text-term-amber bg-term-amberSubtle" : "border-term-border text-term-text hover:border-term-amberDim")}>
              <input type="radio" name="lab-etf" checked={i.etf === c.ticker} onChange={() => set({ etf: c.ticker })} className="accent-[#ff8c00]" />
              <span className="w-9 font-bold">{c.ticker}</span><span className="text-term-muted">{c.label}</span>
            </label>
          ))}
          <label className="text-[10px] text-term-muted">Other ETF
            <EtfSelect ariaLabel="Other ETF" value={isCore ? "" : i.etf} onChange={(v) => v && set({ etf: v })} originalLabel="—" originalValue="" />
          </label>
        </div>
        <div className="text-[10px] text-term-muted mt-1 leading-snug">
          Replaces SPY in every basket strategy that trades it, and becomes the benchmark. Parameters were tuned on SPY.
          {unchanged.length > 0 && <> Not affected (they do not trade SPY): {unchanged.join(", ")}.</>}
        </div>
      </div>

      <div>
        <div className="sub-header mb-1">Strategies in basket ({basketNames.length}/3)</div>
        {basketNames.length === 0
          ? <div className="text-term-muted text-[11px]">None yet. Add strategies on the Strategies screen.</div>
          : <ul className="text-[11px] text-term-amber space-y-0.5">{basketNames.map((b) => <li key={b.id}>{b.name}</li>)}</ul>}
      </div>

      <div>
        <div className="sub-header mb-1">Risk objective</div>
        <div className="flex flex-col gap-1">
          {OBJECTIVES.map((o) => (
            <label key={o.key} title={o.description} className={cn("flex items-center gap-2 px-2 py-1 border cursor-pointer text-[11px]",
              i.objective === o.key ? "border-term-amber text-term-amber bg-term-amberSubtle" : "border-term-border text-term-text hover:border-term-amberDim")}>
              <input type="radio" name="objective" checked={i.objective === o.key} onChange={() => set({ objective: o.key })} className="accent-[#ff8c00]" />
              {o.label}
            </label>
          ))}
        </div>
      </div>

      <Num label="Max weight per strategy" suffix="%" scale={100} value={i.maxWeight} onChange={(v) => set({ maxWeight: v })} step={5} min={20}
        hint="Long-only, no leverage. A cap below 1/n is raised automatically." />

      <details className="border-t border-term-border pt-2">
        <summary className="sub-header cursor-pointer">Advanced assumptions</summary>
        <div className="flex flex-col gap-2 mt-2">
          <Num label="Slippage" suffix="bps" value={i.slippageBps} onChange={(v) => set({ slippageBps: v })} />
          <Num label="Fixed fee per trade" prefix="$" value={i.fixedFee} onChange={(v) => set({ fixedFee: v })} step={0.5} hint="Matters for small balances." />
          <label className="flex items-center gap-2 text-[11px] text-term-text">
            <input type="checkbox" checked={i.fractional} onChange={(e) => set({ fractional: e.target.checked })} className="accent-[#ff8c00]" />
            Fractional shares available
          </label>
          <Num label="Risk-free rate" suffix="%" scale={100} value={i.riskFreeRate} onChange={(v) => set({ riskFreeRate: v })} step={0.25} />
          <Num label="Inflation" suffix="%" scale={100} value={i.inflation} onChange={(v) => set({ inflation: v })} step={0.25} />
          <Num label="Goal (optional)" prefix="$" value={i.goal} onChange={(v) => set({ goal: Number.isNaN(v) ? null : v })} step={500} />
          <div>
            <div className="sub-header mb-1">Projection method</div>
            <select value={i.method} onChange={(e) => set({ method: e.target.value as LabInputs["method"] })} className="w-full bg-term-bg border border-term-border text-[11px] py-1 text-term-text">
              <option value="bootstrap">Block bootstrap (historical)</option>
              <option value="parametric">Parametric (normal)</option>
            </select>
          </div>
          <Num label="Simulated paths" value={i.paths} onChange={(v) => set({ paths: v })} step={500} min={200} />
          <Num label="Bootstrap block" suffix="months" value={i.blockMonths} onChange={(v) => set({ blockMonths: v })} min={1} />
          <Num label="Random seed" value={i.seed} onChange={(v) => set({ seed: v })} />
        </div>
      </details>

      {errors.length > 0 && <ul role="alert" className="text-term-red text-[11px] list-disc pl-4 space-y-0.5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </aside>
  );
}
