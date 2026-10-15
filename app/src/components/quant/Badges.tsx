import { cn } from "@/lib/cn";
import type { Verdict } from "@/quant/robustness";

export function Badge({ children, tone = "muted", title }: { children: React.ReactNode; tone?: "muted" | "amber" | "green" | "red" | "cyan"; title?: string }) {
  return (
    <span title={title} className={cn(
      "inline-flex items-center px-1.5 py-[1px] border text-[9px] uppercase tracking-[0.14em] whitespace-nowrap",
      tone === "muted" && "border-term-border text-term-muted",
      tone === "amber" && "border-term-amberDim text-term-amber",
      tone === "green" && "border-term-greenDim text-term-green",
      tone === "red" && "border-term-redDim text-term-red",
      tone === "cyan" && "border-cyan-800 text-term-cyan",
    )}>{children}</span>
  );
}

export function EvidenceBadge({ status }: { status: "Backtested" | "Paper-tracked" | "Verified live" }) {
  const tone = status === "Verified live" ? "green" : status === "Paper-tracked" ? "cyan" : "amber";
  const tip = status === "Backtested" ? "Tested on historical data only. Past results do not predict future returns." : status === "Paper-tracked" ? "Followed forward on paper." : "Verified with live results.";
  return <Badge tone={tone} title={tip}>{status}</Badge>;
}

const VERDICT_TIP: Record<Verdict | "none", string> = {
  consistent: "Held up across the train/test split, rolling windows and parameter changes in this sample.",
  mixed: "One robustness check failed.",
  inconsistent: "Results changed materially across periods or parameters.",
  insufficient: "Not enough history or checks for a verdict.",
  baseline: "This is the benchmark itself.",
  none: "Robustness not run.",
};

export function VerdictBadge({ verdict }: { verdict?: Verdict | null }) {
  const v = verdict ?? "none";
  const tone = v === "consistent" ? "green" : v === "inconsistent" ? "red" : v === "mixed" ? "amber" : "muted";
  return <Badge tone={tone} title={VERDICT_TIP[v]}>{v === "none" ? "not run" : v}</Badge>;
}

export function FlagList({ flags }: { flags: { code: string; severity: string; message: string }[] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-[11px]">
      {flags.map((f, i) => (
        <li key={i} className={cn("flex gap-2", f.severity === "error" ? "text-term-red" : f.severity === "warn" ? "text-term-amberBright" : "text-term-muted")}>
          <span className="uppercase text-[9px] tracking-widest pt-[2px] w-8 shrink-0">{f.severity}</span>
          <span>{f.message}</span>
        </li>
      ))}
    </ul>
  );
}
