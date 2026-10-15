import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hashId } from "./hash";
import { loadDataset } from "./dataSource";
import { requiredTickers, type StrategyDef } from "./strategy";
import { runBacktestCached, type BacktestResult } from "./service";
import type { RunConfig } from "./backtest";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export function useDataset(tickers: string[]) {
  const key = [...new Set(tickers)].sort();
  return useQuery({
    queryKey: ["quant-dataset", ...key],
    queryFn: () => loadDataset(key),
    enabled: key.length > 0,
    staleTime: 6 * 3600_000,
    retry: 1,
  });
}

/**
 * Runs strategies one at a time over a single shared dataset so every result uses the same
 * dates, yielding to the browser between runs so the screen fills in progressively.
 */
export function useBacktests(defs: StrategyDef[], cfg: Partial<RunConfig>, opts: { robustness?: boolean } = {}) {
  const tickers = useMemo(() => [...new Set(defs.flatMap(requiredTickers))], [defs]);
  const dataset = useDataset(tickers);
  const [results, setResults] = useState<Record<string, BacktestResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const key = hashId({ defs, cfg, r: !!opts.robustness, d: dataset.data?.version.id });

  useEffect(() => {
    const ds = dataset.data;
    if (!ds) return;
    let cancelled = false;
    setRunning(true);
    (async () => {
      for (const d of defs) {
        if (cancelled) return;
        await tick();
        try {
          const r = runBacktestCached(ds, d, cfg, opts);
          if (!cancelled) {
            setResults((p) => ({ ...p, [d.id]: r }));
            setErrors((p) => { const { [d.id]: _gone, ...rest } = p; return rest; });
          }
        } catch (e) {
          if (!cancelled) setErrors((p) => ({ ...p, [d.id]: (e as Error).message }));
        }
      }
      if (!cancelled) setRunning(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { dataset, results, errors, running };
}
