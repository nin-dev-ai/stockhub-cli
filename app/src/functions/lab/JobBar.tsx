import type { Job } from "@/quant/jobs";

const LABELS: Record<string, string> = { "lab-backtest": "Backtest", "lab-optimize": "Optimization", "lab-projection": "Projection" };

export function JobBar({ jobs, onCancel }: { jobs: (Job | undefined)[]; onCancel: () => void }) {
  const active = jobs.filter((j): j is Job => !!j && (j.status === "running" || j.status === "failed" || j.status === "cancelled"));
  if (active.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {active.map((j) => (
        <div key={j.id} className="flex items-center gap-3 text-[11px]">
          <span className="w-24 text-term-muted uppercase tracking-widest">{LABELS[j.kind] ?? j.kind}</span>
          {j.status === "running" && (
            <>
              <div className="flex-1 h-1.5 bg-term-border"><div className="h-full bg-term-amber transition-all" style={{ width: `${Math.round(j.progress * 100)}%` }} /></div>
              <span className="num w-10 text-right">{Math.round(j.progress * 100)}%</span>
              <button onClick={onCancel} className="text-term-muted hover:text-term-red uppercase tracking-widest text-[10px]">Cancel</button>
            </>
          )}
          {j.status === "failed" && <span role="alert" className="text-term-red">Failed: {j.error}</span>}
          {j.status === "cancelled" && <span className="text-term-muted">Cancelled</span>}
        </div>
      ))}
    </div>
  );
}
