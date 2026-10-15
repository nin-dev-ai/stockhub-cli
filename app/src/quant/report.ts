import type { OptimizationResult } from "./optimizer";
import type { LabInputs } from "./lab";
import type { ProjectionResult } from "./projection";
import type { BacktestResult } from "./service";
import type { Weights } from "./portfolio";
import { ENGINE_VERSION } from "./types";

export interface CalculationReport {
  generatedAt: string;
  engineVersion: string;
  label: "Informational simulation, not investment advice";
  inputs: LabInputs;
  weights: Weights | null;
  weightsSource: "optimizer" | "user override" | "equal weight" | null;
  data: { datasetId: string; provider: string; priceBasis: string; window: { start: string; end: string }; fetchedAt: string } | null;
  strategies: { id: string; name: string; version: number; definitionHash: string; backtestRunId: string }[];
  costs: { slippageBps: number; fixedFee: number; taxes: string; fractionalShares: boolean };
  optimization: { runId: string; method: string; objective: string; effectiveCap: number; binding: { id: string; kind: string }[] } | null;
  projection: {
    runId: string; method: string; paths: number; seed: number; blockMonths: number; observations: number; years: number;
    quality: string; assumptions: string[]; warnings: string[];
  } | null;
  warnings: string[];
}

export function buildReport(a: {
  inputs: LabInputs; weights: Weights | null; weightsSource: CalculationReport["weightsSource"];
  backtests: BacktestResult[]; optimization: OptimizationResult | null; projection: ProjectionResult | null;
}): CalculationReport {
  const first = a.backtests[0];
  const warnings: string[] = [
    "Results are model-based. The lower percentile is not a worst case and the upper is not a maximum.",
    "Past performance does not predict future returns. Taxes and currency conversion are not modeled.",
  ];
  for (const b of a.backtests) for (const f of b.flags) if (f.severity !== "info") warnings.push(`${b.strategy.name}: ${f.message}`);
  if (a.projection) warnings.push(...a.projection.reasons);
  return {
    generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION,
    label: "Informational simulation, not investment advice",
    inputs: a.inputs, weights: a.weights, weightsSource: a.weightsSource,
    data: first ? { datasetId: first.dataset.id, provider: first.dataset.provider, priceBasis: first.dataset.adjustedPriceBasis, window: { start: first.window.start, end: first.window.end }, fetchedAt: first.dataset.fetchedAt } : null,
    strategies: a.backtests.map((b) => ({ id: b.strategy.id, name: b.strategy.name, version: b.strategy.version, definitionHash: b.strategy.hash, backtestRunId: b.runId })),
    costs: { slippageBps: a.inputs.slippageBps, fixedFee: a.inputs.fixedFee, taxes: "excluded", fractionalShares: a.inputs.fractional },
    optimization: a.optimization ? {
      runId: a.optimization.runId, method: a.optimization.method, objective: a.inputs.objective, effectiveCap: a.optimization.effectiveCap,
      binding: a.optimization.proposals[a.inputs.objective].binding,
    } : null,
    projection: a.projection ? {
      runId: a.projection.runId, method: a.projection.input.method, paths: a.projection.input.paths, seed: a.projection.input.seed,
      blockMonths: a.projection.input.blockMonths, observations: a.projection.input.observations, years: a.projection.input.years,
      quality: a.projection.quality, assumptions: a.projection.assumptions, warnings: a.projection.reasons,
    } : null,
    warnings,
  };
}

/** Adds whole months to an ISO date, clamping to the end of shorter months. */
export function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export const futureDates = (start: string, months: number) => Array.from({ length: months + 1 }, (_, m) => addMonths(start, m));

export function projectionCsv(p: ProjectionResult): string {
  if (!p.fan) return "";
  const rows = ["month,contributed,p10,p50,p90"];
  for (let m = 0; m < p.fan.p50.length; m++) {
    rows.push([String(m), ...[p.fan.contributed[m], p.fan.p10[m], p.fan.p50[m], p.fan.p90[m]].map((x) => x.toFixed(2))].join(","));
  }
  return rows.join("\n");
}
