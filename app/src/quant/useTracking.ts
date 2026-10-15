import { useCallback, useMemo, useSyncExternalStore } from "react";
import { loadDataset } from "./dataSource";
import type { Dataset } from "./data";
import { jobs } from "./jobs";
import { backtestConfig, projectionInput, sleeveOf } from "./lab";
import { project } from "./projection";
import { runBacktestCached, type BacktestResult } from "./service";
import { requiredTickers } from "./strategy";
import {
  attribute, externalFlows, holdingsTable, indexOnOrBefore, ledgerAt, planTargets, replayPlan, snapshotFrom, timeline, valuationSeries,
  type PlanSnapshot, type Portfolio,
} from "./tracking";

export interface TrackingData {
  /** Prices for holdings and plan targets. */
  holdings: Dataset | null;
  unpriced: string[];
  /** The snapshot's strategies re-run on current data; null without a plan. */
  plan: { results: BacktestResult[]; targets: Record<string, number>; replay: { dates: string[]; value: number[] } } | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Loads tickers one by one so a single bad manual symbol does not block the rest. */
async function loadHoldings(tickers: string[]): Promise<{ ds: Dataset | null; unpriced: string[] }> {
  const ok: string[] = [], unpriced: string[] = [];
  await Promise.all(tickers.map(async (t) => {
    try { await loadDataset([t]); ok.push(t); } catch { unpriced.push(t); }
  }));
  if (ok.length === 0) return { ds: null, unpriced };
  return { ds: await loadDataset(ok), unpriced: unpriced.sort() };
}

export function useTracking(p: Portfolio | null, snaps: PlanSnapshot[]) {
  useSyncExternalStore(jobs.subscribe, jobs.getVersion);
  const original = snaps[0] ?? null;
  const latest = snaps[snaps.length - 1] ?? null;

  const input = useMemo(() => p && ({
    id: p.id, mode: p.mode, txs: p.transactions.map((t) => t.id), snap: original?.id ?? null, day: today(),
  }), [p, original]);
  const id = input ? jobs.idFor("port-refresh", input) : null;
  const job = id ? jobs.get<TrackingData>(id) : undefined;

  const refresh = useCallback(() => {
    if (!p || !input) return null;
    return jobs.submit<TrackingData>("port-refresh", input, async (ctx) => {
      const held = Object.keys(ledgerAt(p.transactions).units);
      const targetTickers = original ? Object.keys(original.targets) : [];
      // SPY doubles as the trading calendar for a cash-only record
      const tickers = [...new Set([...held, ...targetTickers, ...(held.length + targetTickers.length === 0 ? ["SPY"] : [])])].sort();
      ctx.progress(0.1);
      const { ds, unpriced } = await loadHoldings(tickers);
      ctx.progress(0.5); await ctx.tick();
      let plan: TrackingData["plan"] = null;
      if (original) {
        const defs = original.strategies.map((s) => s.definition);
        const sds = await loadDataset([...new Set(defs.flatMap(requiredTickers))]);
        const results: BacktestResult[] = [];
        for (const d of defs) { await ctx.tick(); results.push(runBacktestCached(sds, d, backtestConfig(original.inputs))); }
        const targets = planTargets(results.map((r) => ({ id: r.strategy.id, run: r.run })), original.weights);
        const replay = replayPlan(results.map(sleeveOf), original.weights, externalFlows(p.transactions), original.asOf);
        plan = { results, targets, replay };
      }
      ctx.progress(1);
      return { holdings: ds, unpriced, plan };
    });
  }, [p, input, original]);

  const data = job?.result;
  const view = useMemo(() => {
    if (!p || !data?.holdings) return null;
    const panel = data.holdings.panel;
    const val = valuationSeries(p.transactions, panel, p.mode);
    const targets = data.plan?.targets ?? {};
    const holdings = holdingsTable(p.transactions, panel, p.mode, targets);
    const n = val.dates.length;
    const lastObs = n ? { date: val.dates[n - 1], value: val.value[n - 1], contributed: val.contributed[n - 1] } : null;
    let attribution = null, attributionLatest = null;
    if (original && lastObs) {
      const r = data.plan?.replay;
      const ri = r ? indexOnOrBefore(r.dates, lastObs.date) : -1;
      const follow = r && ri >= 0 ? r.value[ri] : null;
      attribution = attribute(original, lastObs, follow);
      if (latest && latest.id !== original.id) attributionLatest = attribute(latest, lastObs, null);
    }
    return {
      val, holdings, lastObs, attribution, attributionLatest,
      timeline: original ? timeline(original, latest, val) : null,
      lastDate: panel.dates[panel.dates.length - 1] ?? null,
      unpriced: [...new Set([...data.unpriced, ...val.unpriced])],
    };
  }, [p, data, original, latest]);

  /** Re-runs the plan's projection from the current value, saving a new snapshot; earlier ones are untouched. */
  const reforecast = useCallback(async (years: number): Promise<PlanSnapshot | string> => {
    if (!p || !original) return "This portfolio has no saved plan to reforecast.";
    if (!data?.plan || !view?.lastObs) return "Refresh the portfolio first.";
    const results = data.plan.results;
    const inputs = { ...original.inputs, initial: Math.max(0, view.lastObs.value), existing: 0, years };
    const pi = projectionInput(results.map(sleeveOf), original.weights, inputs);
    const jid = jobs.submit("port-reforecast", { p: p.id, pi }, (ctx) => project(pi, ctx));
    const j = await jobs.wait<Awaited<ReturnType<typeof project>>>(jid);
    if (!j.result) return j.error ?? "The reforecast was cancelled.";
    if (!j.result.fan) return j.result.reasons.join(" ") || "The history cannot support a projection.";
    return snapshotFrom({
      kind: "reforecast", portfolioId: p.id, parentId: original.id, createdAt: new Date().toISOString(),
      inputs, weights: original.weights, weightsSource: original.weightsSource, backtests: results, projection: j.result,
    });
  }, [p, original, data, view]);

  return { job, data, view, refresh, reforecast, original, latest };
}
