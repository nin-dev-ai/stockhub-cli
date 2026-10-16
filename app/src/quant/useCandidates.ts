import { useMemo } from "react";
import { CATALOG } from "./catalog";
import { labStrategies, sleeveOf, type LabInputs } from "./lab";
import { bucketExposure } from "./overlap";
import { planRole, type Candidate } from "./plan";
import { SCORECARD_CONFIG } from "./service";
import { useBacktests } from "./useBacktests";

export type LabCandidate = Candidate & { origId: string };

/**
 * The curated catalog as plan candidates, run on the Lab's ETF choice with the standard scorecard
 * settings and robustness checks. Runs only while `enabled`; results are shared with the
 * Strategies screen through the backtest cache, so a second use is quick.
 */
export function useCandidates(inputs: LabInputs, enabled: boolean) {
  const pairs = useMemo(() => CATALOG.map((orig) => ({ orig, mapped: labStrategies([orig], inputs)[0] })),
    [inputs.etf, inputs.alsoEtfs.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const defs = useMemo(() => (enabled ? pairs.map((p) => p.mapped) : []), [enabled, pairs]);
  const bt = useBacktests(defs, SCORECARD_CONFIG, { robustness: true });
  const settled = Object.keys(bt.results).length + Object.keys(bt.errors).length;
  const ready = enabled && !!bt.dataset.data && !bt.running && settled >= defs.length;
  const list: LabCandidate[] = useMemo(() => pairs.flatMap(({ orig, mapped }) => {
    const r = bt.results[mapped.id];
    return enabled && r ? [{ id: mapped.id, origId: orig.id, name: orig.name, role: planRole(mapped), sleeve: sleeveOf(r), verdict: r.robustness?.verdict ?? null, experimental: !!orig.experimental, metrics: r.run.metrics, exposure: bucketExposure(r.run) }] : [];
  }), [enabled, pairs, bt.results]);
  return { list, ready, loading: enabled && !ready, error: bt.dataset.error ? (bt.dataset.error as Error).message : null };
}
