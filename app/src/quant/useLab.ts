import { useCallback, useMemo, useSyncExternalStore } from "react";
import { loadDataset } from "./dataSource";
import { jobs, type Job } from "./jobs";
import { backtestConfig, planBacktest, projectionInput, sleeveOf, validateLab, type LabInputs, type PlanBacktest } from "./lab";
import { optimize, type OptimizationResult } from "./optimizer";
import { equalWeights, type Sleeve, type Weights } from "./portfolio";
import { project, type ProjectionResult } from "./projection";
import { runBacktestCached, type BacktestResult } from "./service";
import { requiredTickers, type StrategyDef } from "./strategy";
import type { Dataset } from "./data";

export interface BacktestBundle { dataset: Dataset; results: BacktestResult[]; sleeves: Sleeve[] }

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Drives the three Lab actions through the job queue. Each action reuses an identical earlier job,
 * runs prerequisites when needed, and can be cancelled.
 */
export function useLabEngine(defs: StrategyDef[], inputs: LabInputs, override: Weights | null) {
  useSyncExternalStore(jobs.subscribe, jobs.getVersion);

  const btInput = useMemo(() => ({ defs, cfg: backtestConfig(inputs), day: today() }), [defs, inputs]);
  const btId = jobs.idFor("lab-backtest", btInput);
  const bt = jobs.get<BacktestBundle>(btId);

  const ids = defs.map((d) => d.id).join("|");
  const optInput = useMemo(() => ({ ids, btId, maxWeight: inputs.maxWeight, rf: inputs.riskFreeRate }), [ids, btId, inputs.maxWeight, inputs.riskFreeRate]);
  const optId = jobs.idFor("lab-optimize", optInput);
  const opt = jobs.get<OptimizationResult>(optId);

  const weights: Weights | null = useMemo(() => {
    if (!bt?.result) return null;
    const ids2 = bt.result.sleeves.map((s) => s.id);
    if (override && ids2.every((i) => override[i] != null)) return override;
    return opt?.result?.proposals[inputs.objective].weights ?? equalWeights(ids2);
  }, [bt?.result, opt?.result, override, inputs.objective]);
  const weightsSource = !weights ? null : override ? "user override" : opt?.result ? "optimizer" : "equal weight";

  const projInput = useMemo(() => (bt?.result && weights ? projectionInput(bt.result.sleeves, weights, inputs) : null), [bt?.result, weights, inputs]);
  const projId = projInput ? jobs.idFor("lab-projection", projInput) : null;
  const proj = projId ? jobs.get<ProjectionResult>(projId) : undefined;

  const plan: PlanBacktest | null = useMemo(
    () => (bt?.result && weights ? planBacktest(bt.result.sleeves, weights, inputs) : null),
    [bt?.result, weights, inputs],
  );

  const errors = validateLab(inputs);

  const runBacktest = useCallback((): string => jobs.submit<BacktestBundle>("lab-backtest", btInput, async (ctx) => {
    const tickers = [...new Set(defs.flatMap(requiredTickers))];
    ctx.progress(0.05);
    const dataset = await loadDataset(tickers);
    const results: BacktestResult[] = [];
    for (let i = 0; i < defs.length; i++) {
      await ctx.tick();
      results.push(runBacktestCached(dataset, defs[i], btInput.cfg));
      ctx.progress(0.1 + (0.9 * (i + 1)) / defs.length);
    }
    return { dataset, results, sleeves: results.map(sleeveOf) };
  }), [btInput, defs]);

  const runOptimize = useCallback(async () => {
    const b = (await jobs.wait<BacktestBundle>(runBacktest())).result;
    if (!b) return;
    jobs.submit<OptimizationResult>("lab-optimize", optInput, async (ctx) => {
      ctx.progress(0.2); await ctx.tick();
      return optimize(b.sleeves, { maxWeight: inputs.maxWeight, riskFreeRate: inputs.riskFreeRate });
    });
  }, [runBacktest, optInput, inputs.maxWeight, inputs.riskFreeRate]);

  const runProjection = useCallback(async () => {
    const b = (await jobs.wait<BacktestBundle>(runBacktest())).result;
    if (!b) return;
    let w = weights;
    if (!w) {
      await runOptimize();
      const o = jobs.get<OptimizationResult>(optId)?.result;
      w = override ?? o?.proposals[inputs.objective].weights ?? equalWeights(b.sleeves.map((s) => s.id));
    }
    const pi = projectionInput(b.sleeves, w, inputs);
    jobs.submit<ProjectionResult>("lab-projection", pi, (ctx) => project(pi, ctx));
  }, [runBacktest, runOptimize, weights, override, optId, inputs]);

  const cancel = useCallback(() => {
    for (const id of [btId, optId, projId]) if (id) jobs.cancel(id);
  }, [btId, optId, projId]);

  const running = [bt, opt, proj].some((j) => j?.status === "running");
  return { bt, opt, proj, weights, weightsSource, plan, errors, running, runBacktest, runOptimize, runProjection, cancel };
}

export type LabJob<T> = Job<T> | undefined;
