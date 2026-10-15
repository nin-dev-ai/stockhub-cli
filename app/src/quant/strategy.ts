import { INSTRUMENT_BY_TICKER } from "./instruments";

export const STRATEGY_SCHEMA = 1;

export type Schedule = "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "none";

export type Allocation =
  | { type: "static"; weights: Record<string, number> }
  | { type: "trend"; risky: string; safe: string; smaDays: number; bandPct: number }
  | { type: "momentum"; universe: string[]; lookbackDays: number; topN: number; safe: string; absoluteFilter: boolean }
  | { type: "vol_target"; risky: string; safe: string; targetVol: number; lookbackDays: number }
  | { type: "seasonal"; risky: string; safe: string; riskyMonths: number[] }
  | { type: "tsmom"; risky: string; safe: string; lookbackDays: number };

export interface StrategyDef {
  schema: 1;
  id: string;
  version: number;
  name: string;
  summary: string;
  intendedUse: string;
  tags: string[];
  region: "US";
  holdingPeriod: string;
  universe: string[];
  benchmark: string;
  allocation: Allocation;
  rebalance: { schedule: Schedule; thresholdPct?: number; minTradeWeight?: number };
  /** Initial capital is held back and released in equal monthly tranches (dollar-cost averaging). */
  entry?: { deployMonths: number };
  /** Part of each contribution is reserved as cash and released when the risky asset is in drawdown. */
  reserve?: { fraction: number; riskyTicker: string; releaseDrawdown: number };
  methodology: string;
  caveats: string[];
  evidence: "Backtested" | "Paper-tracked" | "Verified live";
  experimental?: boolean;
  /** Parameter paths varied for the sensitivity test. */
  sensitivity?: { path: string; values: number[] }[];
  /** Created from this curated strategy; set on user drafts. */
  forkOf?: string;
}

const SCHEDULES: Schedule[] = ["daily", "weekly", "monthly", "quarterly", "annual", "none"];

export function allocationTickers(a: Allocation): string[] {
  switch (a.type) {
    case "static": return Object.keys(a.weights);
    case "trend": case "vol_target": case "seasonal": case "tsmom": return [a.risky, a.safe];
    case "momentum": return [...a.universe, a.safe];
  }
}

/** Every ticker a strategy needs prices for, including the benchmark. */
export function requiredTickers(d: StrategyDef): string[] {
  const s = new Set<string>([...d.universe, d.benchmark, ...allocationTickers(d.allocation)]);
  if (d.reserve) s.add(d.reserve.riskyTicker);
  return [...s].sort();
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const inRange = (n: unknown, lo: number, hi: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;

export interface Validation { ok: boolean; errors: string[] }

export function validateStrategy(d: unknown): Validation {
  const errors: string[] = [];
  const e = (m: string) => errors.push(m);
  if (typeof d !== "object" || d === null) return { ok: false, errors: ["Strategy must be an object."] };
  const s = d as Partial<StrategyDef>;

  if (s.schema !== STRATEGY_SCHEMA) e(`schema must be ${STRATEGY_SCHEMA}.`);
  if (typeof s.id !== "string" || !/^[a-z0-9_]{3,60}$/.test(s.id)) e("id must be 3-60 chars of a-z, 0-9, _.");
  if (!isInt(s.version) || s.version < 1) e("version must be a positive integer.");
  if (typeof s.name !== "string" || s.name.trim().length < 3) e("name is required.");
  if (!Array.isArray(s.universe) || s.universe.length === 0) e("universe must list at least one ETF.");
  if (typeof s.benchmark !== "string") e("benchmark is required.");

  const known = (t: unknown, label: string) => {
    if (typeof t !== "string" || !INSTRUMENT_BY_TICKER[t]) e(`${label} "${String(t)}" is not a supported US-listed ETF.`);
  };
  (s.universe ?? []).forEach((t) => known(t, "universe ticker"));
  known(s.benchmark, "benchmark");

  const a = s.allocation;
  if (!a || typeof a !== "object") e("allocation is required.");
  else {
    switch (a.type) {
      case "static": {
        const w = a.weights ?? {};
        const vals = Object.values(w);
        if (vals.length === 0) e("static allocation needs weights.");
        Object.keys(w).forEach((t) => known(t, "weight ticker"));
        if (vals.some((v) => !inRange(v, 0, 1))) e("weights must be between 0 and 1 (long-only).");
        else if (Math.abs(vals.reduce((x, y) => x + y, 0) - 1) > 1e-6) e("weights must sum to 100% (no leverage, fully allocated).");
        break;
      }
      case "trend":
        known(a.risky, "risky"); known(a.safe, "safe");
        if (!isInt(a.smaDays) || !inRange(a.smaDays, 5, 400)) e("smaDays must be an integer from 5 to 400.");
        if (!inRange(a.bandPct, 0, 0.1)) e("bandPct must be between 0 and 0.10.");
        break;
      case "momentum":
        (a.universe ?? []).forEach((t) => known(t, "momentum ticker")); known(a.safe, "safe");
        if (!Array.isArray(a.universe) || a.universe.length < 2) e("momentum needs at least 2 assets.");
        if (!isInt(a.lookbackDays) || !inRange(a.lookbackDays, 20, 756)) e("lookbackDays must be an integer from 20 to 756.");
        if (!isInt(a.topN) || !inRange(a.topN, 1, Math.max(1, (a.universe ?? []).length))) e("topN must be between 1 and the number of assets.");
        break;
      case "vol_target":
        known(a.risky, "risky"); known(a.safe, "safe");
        if (!inRange(a.targetVol, 0.02, 0.5)) e("targetVol must be between 2% and 50% (leverage is not allowed, so weight is capped at 100%).");
        if (!isInt(a.lookbackDays) || !inRange(a.lookbackDays, 10, 252)) e("lookbackDays must be an integer from 10 to 252.");
        break;
      case "seasonal":
        known(a.risky, "risky"); known(a.safe, "safe");
        if (!Array.isArray(a.riskyMonths) || a.riskyMonths.length === 0 || a.riskyMonths.some((m) => !isInt(m) || m < 1 || m > 12)) e("riskyMonths must be integers from 1 to 12.");
        break;
      case "tsmom":
        known(a.risky, "risky"); known(a.safe, "safe");
        if (!isInt(a.lookbackDays) || !inRange(a.lookbackDays, 20, 756)) e("lookbackDays must be an integer from 20 to 756.");
        break;
      default: e(`unknown allocation type "${(a as { type?: string }).type}".`);
    }
  }

  const r = s.rebalance;
  if (!r || !SCHEDULES.includes(r.schedule)) e(`rebalance.schedule must be one of ${SCHEDULES.join(", ")}.`);
  else {
    if (r.thresholdPct !== undefined && !inRange(r.thresholdPct, 0.01, 0.5)) e("thresholdPct must be between 1% and 50%.");
    if (r.minTradeWeight !== undefined && !inRange(r.minTradeWeight, 0, 0.5)) e("minTradeWeight must be between 0 and 50%.");
  }
  if (s.entry && !(isInt(s.entry.deployMonths) && inRange(s.entry.deployMonths, 0, 36))) e("entry.deployMonths must be an integer from 0 to 36.");
  if (s.reserve) {
    if (!inRange(s.reserve.fraction, 0.05, 0.9)) e("reserve.fraction must be between 5% and 90%.");
    if (!inRange(s.reserve.releaseDrawdown, -0.5, -0.02)) e("reserve.releaseDrawdown must be between -50% and -2%.");
    known(s.reserve.riskyTicker, "reserve ticker");
  }
  if (!Array.isArray(s.caveats)) e("caveats must be a list.");
  return { ok: errors.length === 0, errors };
}

/** Deep-set a numeric parameter by dotted path on a clone (used by sensitivity tests and forks). */
export function withParam(d: StrategyDef, path: string, value: number): StrategyDef {
  const c = structuredClone(d) as unknown as Record<string, unknown>;
  const parts = path.split(".");
  let o = c;
  for (const p of parts.slice(0, -1)) o = o[p] as Record<string, unknown>;
  o[parts[parts.length - 1]] = value;
  return c as unknown as StrategyDef;
}

export const getParam = (d: StrategyDef, path: string): number =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], d) as number;

/** Copy a curated recipe into an editable draft without touching the original. */
export function forkStrategy(d: StrategyDef, newId: string, name?: string): StrategyDef {
  const c = structuredClone(d);
  return { ...c, id: newId, version: 1, name: name ?? `${d.name} (draft)`, forkOf: `${d.id}@${d.version}`, evidence: "Backtested" };
}
