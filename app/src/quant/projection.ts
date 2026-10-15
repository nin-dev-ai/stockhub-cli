import { hashId } from "./hash";
import { percentile } from "./metrics";
import { makeRng } from "./rng";
import type { JobContext } from "./jobs";
import { ENGINE_VERSION } from "./types";
import type { ContributionFrequency } from "./backtest";

export type ProjectionMethod = "bootstrap" | "parametric";
export type ScenarioKey = "base" | "lower_returns" | "higher_volatility" | "bad_start";

export const MIN_MONTHS = 60;        // below this, no projection is produced
export const ADEQUATE_MONTHS = 120;  // below this, the history is flagged as limited
export const PERCENTILES = [0.1, 0.5, 0.9] as const;

export interface ProjectionInput {
  monthlyReturns: number[];
  historyStart: string;
  historyEnd: string;
  initial: number;
  contribution: { amount: number; frequency: ContributionFrequency };
  years: number;
  method: ProjectionMethod;
  paths: number;
  blockMonths: number;
  seed: number;
  inflation: number;
  goal?: number;
}

export interface Distribution { p10: number; p50: number; p90: number; mean: number }
export interface ScenarioResult { key: ScenarioKey; label: string; description: string; ending: Distribution; probLoss: number }

export interface ProjectionResult {
  runId: string;
  engineVersion: string;
  quality: "adequate" | "limited" | "insufficient";
  reasons: string[];
  months: number;
  input: Omit<ProjectionInput, "monthlyReturns"> & { observations: number };
  fan: { p10: number[]; p50: number[]; p90: number[]; contributed: number[] } | null;
  ending: Distribution | null;
  endingReal: Distribution | null;
  totalContributed: number;
  probLoss: number | null;
  probGoal: number | null;
  scenarios: ScenarioResult[];
  assumptions: string[];
}

export const SCENARIOS: { key: ScenarioKey; label: string; description: string }[] = [
  { key: "base", label: "Base", description: "Historical monthly returns as observed." },
  { key: "lower_returns", label: "Lower returns", description: "Every month's return reduced by 2 percentage points per year." },
  { key: "higher_volatility", label: "Higher volatility", description: "Deviations from the average monthly return widened by 25%." },
  { key: "bad_start", label: "Bad first year", description: "The worst 12-month stretch in the history is placed first, then returns are resampled." },
];

const FLOOR = -0.95;

/** Contribution added at the start of month m (1-based); the first month holds only the initial capital. */
export function contributionAt(m: number, c: { amount: number; frequency: ContributionFrequency }): number {
  if (m <= 1 || c.amount <= 0) return 0;
  switch (c.frequency) {
    case "monthly": return c.amount;
    case "weekly": return (c.amount * 52) / 12;
    case "quarterly": return (m - 1) % 3 === 0 ? c.amount : 0;
    default: return 0;
  }
}

export function totalContributed(initial: number, months: number, c: { amount: number; frequency: ContributionFrequency }): number {
  let t = initial;
  for (let m = 1; m <= months; m++) t += contributionAt(m, c);
  return t;
}

const meanOf = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;

function worstBlock(r: number[], len: number): number[] {
  let worst = Infinity, at = 0;
  for (let i = 0; i + len <= r.length; i++) {
    let g = 1;
    for (let j = i; j < i + len; j++) g *= 1 + r[j];
    if (g < worst) { worst = g; at = i; }
  }
  return r.slice(at, at + len);
}

function transform(r: number[], key: ScenarioKey): number[] {
  if (key === "lower_returns") return r.map((x) => Math.max(FLOOR, x - 0.02 / 12));
  if (key === "higher_volatility") { const m = meanOf(r); return r.map((x) => Math.max(FLOOR, m + (x - m) * 1.25)); }
  return r;
}

function dist(sorted: number[]): Distribution {
  return { p10: percentile(sorted, 0.1), p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), mean: meanOf(sorted) };
}

interface PathSet { ends: Float64Array; byMonth?: Float64Array[] }

async function simulatePaths(inp: ProjectionInput, pool: number[], key: ScenarioKey, months: number, rngSeed: number, keepMonths: boolean, ctx?: JobContext, progressBase = 0, progressSpan = 1): Promise<PathSet> {
  const rng = makeRng(rngSeed);
  const n = pool.length;
  const mu = meanOf(pool);
  const sd = Math.sqrt(pool.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1));
  const lead = key === "bad_start" ? worstBlock(pool, 12) : [];
  const ends = new Float64Array(inp.paths);
  const byMonth = keepMonths ? Array.from({ length: months + 1 }, () => new Float64Array(inp.paths)) : undefined;
  const block = Math.max(1, Math.min(inp.blockMonths, n));

  for (let p = 0; p < inp.paths; p++) {
    let v = inp.initial;
    if (byMonth) byMonth[0][p] = v;
    let blockStart = 0, inBlock = block;
    for (let m = 1; m <= months; m++) {
      let r: number;
      if (m <= lead.length) r = lead[m - 1];
      else if (inp.method === "bootstrap") {
        if (inBlock >= block) { blockStart = rng.int(n); inBlock = 0; }
        r = pool[(blockStart + inBlock) % n];
        inBlock++;
      } else r = Math.max(FLOOR, mu + sd * rng.normal());
      v = (v + contributionAt(m, inp.contribution)) * (1 + r);
      if (byMonth) byMonth[m][p] = v;
    }
    ends[p] = v;
    if (ctx && p % 200 === 199) { ctx.progress(progressBase + (progressSpan * (p + 1)) / inp.paths); await ctx.tick(); }
  }
  return { ends, byMonth };
}

/**
 * Forward simulation of terminal wealth by resampling historical monthly returns (block bootstrap)
 * or drawing from a normal distribution fitted to them (parametric). A distribution conditional
 * on the model, not a forecast: the 10th and 90th percentiles are not a worst or best case.
 */
export async function project(inp: ProjectionInput, ctx?: JobContext): Promise<ProjectionResult> {
  const months = Math.round(inp.years * 12);
  const obs = inp.monthlyReturns.length;
  const { monthlyReturns: _drop, ...rest } = inp;
  void _drop;
  const base = {
    runId: hashId({ inp, engine: ENGINE_VERSION }), engineVersion: ENGINE_VERSION, months,
    input: { ...rest, observations: obs }, fan: null, ending: null, endingReal: null,
    totalContributed: totalContributed(inp.initial, months, inp.contribution), probLoss: null, probGoal: null, scenarios: [] as ScenarioResult[],
  };
  const reasons: string[] = [];
  const histYears = obs / 12;
  const assumptions = [
    `Method: ${inp.method === "bootstrap" ? `block bootstrap of ${obs} historical monthly returns in blocks of ${inp.blockMonths} months` : "normal distribution fitted to the historical monthly mean and standard deviation"}.`,
    `${inp.paths.toLocaleString()} simulated paths, random seed ${inp.seed}, horizon ${inp.years} years (${months} months).`,
    `History used: ${inp.historyStart} to ${inp.historyEnd} (${histYears.toFixed(1)} years). The future is assumed to resemble this sample.`,
    `Contributions: ${inp.contribution.amount > 0 && inp.contribution.frequency !== "none" ? `$${inp.contribution.amount} ${inp.contribution.frequency}, added at the start of each month after the first` : "none"}; initial capital $${inp.initial}.`,
    "Fees and slippage are inside the backtested returns. Taxes are excluded. Cash earns 0% inside strategies that hold it.",
    `Inflation assumption for real values: ${(inp.inflation * 100).toFixed(1)}% per year.`,
    "Percentiles are model-conditioned: the 10th is not a worst case and the 90th is not a maximum.",
  ];

  if (obs < MIN_MONTHS) {
    reasons.push(`Only ${obs} months of history; at least ${MIN_MONTHS} are needed. No projection is shown rather than a misleading one.`);
    return { ...base, quality: "insufficient", reasons, assumptions };
  }
  if (inp.paths < 200) reasons.push("Fewer than 200 paths: percentiles will be noisy.");
  if (!(inp.years >= 1 && inp.years <= 30)) {
    reasons.push("Horizon must be between 1 and 30 years.");
    return { ...base, quality: "insufficient", reasons, assumptions };
  }
  let quality: ProjectionResult["quality"] = "adequate";
  if (obs < ADEQUATE_MONTHS) { quality = "limited"; reasons.push(`Only ${histYears.toFixed(1)} years of history; treat the range as indicative and wide.`); }
  if (inp.years > histYears) reasons.push(`The ${inp.years}-year horizon is longer than the ${histYears.toFixed(1)} years of history behind it.`);

  const ctxProg = (a: number, b: number) => ({ base: a, span: b - a });
  const main = ctxProg(0, 0.5);
  const set = await simulatePaths(inp, inp.monthlyReturns, "base", months, inp.seed, true, ctx, main.base, main.span);
  const fan = { p10: [] as number[], p50: [] as number[], p90: [] as number[], contributed: [] as number[] };
  for (let m = 0; m <= months; m++) {
    const col = Array.from(set.byMonth![m]).sort((a, b) => a - b);
    fan.p10.push(percentile(col, 0.1)); fan.p50.push(percentile(col, 0.5)); fan.p90.push(percentile(col, 0.9));
    fan.contributed.push(totalContributed(inp.initial, m, inp.contribution));
  }
  const endSorted = Array.from(set.ends).sort((a, b) => a - b);
  const ending = dist(endSorted);
  const deflator = (1 + inp.inflation) ** (months / 12);
  const endingReal = { p10: ending.p10 / deflator, p50: ending.p50 / deflator, p90: ending.p90 / deflator, mean: ending.mean / deflator };
  const contributed = base.totalContributed;
  const probLoss = endSorted.filter((v) => v < contributed).length / endSorted.length;
  const probGoal = inp.goal != null && inp.goal > 0 ? endSorted.filter((v) => v >= inp.goal!).length / endSorted.length : null;

  const scenarios: ScenarioResult[] = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    if (sc.key === "base") { scenarios.push({ ...sc, ending, probLoss }); continue; }
    const pool = transform(inp.monthlyReturns, sc.key);
    const s = await simulatePaths(inp, pool, sc.key, months, inp.seed + i, false, ctx, 0.5 + (0.5 * (i - 1)) / 3, 0.5 / 3);
    const sorted = Array.from(s.ends).sort((a, b) => a - b);
    scenarios.push({ ...sc, ending: dist(sorted), probLoss: sorted.filter((v) => v < contributed).length / sorted.length });
  }
  ctx?.progress(1);
  return { ...base, quality, reasons, fan, ending, endingReal, probLoss, probGoal, scenarios, assumptions };
}
