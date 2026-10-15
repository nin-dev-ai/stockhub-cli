import { INSTRUMENT_BY_TICKER } from "./instruments";

export const STRATEGY_SCHEMA = 1;

export type Schedule = "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "none";

export type Allocation =
  | { type: "static"; weights: Record<string, number> }
  | { type: "trend"; risky: string; safe: string; smaDays: number; bandPct: number }
  | { type: "momentum"; universe: string[]; lookbackDays: number; topN: number; safe: string; absoluteFilter: boolean }
  | { type: "vol_target"; risky: string; safe: string; targetVol: number; lookbackDays: number }
  | { type: "seasonal"; risky: string; safe: string; riskyMonths: number[] }
  | { type: "tsmom"; risky: string; safe: string; lookbackDays: number }
  /** Inverse-volatility weights: each asset's weight is proportional to 1 / its trailing volatility. */
  | { type: "risk_parity"; assets: string[]; lookbackDays: number }
  /** Equal slots per asset; a slot moves to the safe asset while its asset is below its moving average. */
  | { type: "multi_trend"; assets: string[]; smaDays: number; safe: string }
  /** Hold risky while the fast moving average is above the slow one. */
  | { type: "crossover"; risky: string; safe: string; fastDays: number; slowDays: number }
  /** Buy short pullbacks: enter when RSI drops below entryRsi (optionally only above a long average), exit above exitRsi. */
  | { type: "mean_reversion"; risky: string; safe: string; rsiDays: number; entryRsi: number; exitRsi: number; trendDays: number };

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
  riskLevel?: "Lower" | "Moderate" | "Higher";
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
  sensitivity?: { path: string; values: number[]; informational?: boolean }[];
  /** Created from this curated strategy; set on user drafts. */
  forkOf?: string;
}

const SCHEDULES: Schedule[] = ["daily", "weekly", "monthly", "quarterly", "annual", "none"];

export function allocationTickers(a: Allocation): string[] {
  switch (a.type) {
    case "static": return Object.keys(a.weights);
    case "trend": case "vol_target": case "seasonal": case "tsmom": case "crossover": case "mean_reversion": return [a.risky, a.safe];
    case "momentum": return [...a.universe, a.safe];
    case "risk_parity": return [...a.assets];
    case "multi_trend": return [...a.assets, a.safe];
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
      case "risk_parity":
        (a.assets ?? []).forEach((t) => known(t, "asset"));
        if (!Array.isArray(a.assets) || a.assets.length < 2) e("risk_parity needs at least 2 assets.");
        else if (new Set(a.assets).size !== a.assets.length) e("risk_parity assets must not repeat.");
        if (!isInt(a.lookbackDays) || !inRange(a.lookbackDays, 10, 252)) e("lookbackDays must be an integer from 10 to 252.");
        break;
      case "multi_trend":
        (a.assets ?? []).forEach((t) => known(t, "asset")); known(a.safe, "safe");
        if (!Array.isArray(a.assets) || a.assets.length < 1) e("multi_trend needs at least 1 asset.");
        else if (new Set(a.assets).size !== a.assets.length) e("multi_trend assets must not repeat.");
        if (!isInt(a.smaDays) || !inRange(a.smaDays, 5, 400)) e("smaDays must be an integer from 5 to 400.");
        break;
      case "crossover":
        known(a.risky, "risky"); known(a.safe, "safe");
        if (!isInt(a.fastDays) || !inRange(a.fastDays, 2, 200)) e("fastDays must be an integer from 2 to 200.");
        if (!isInt(a.slowDays) || !inRange(a.slowDays, 10, 400)) e("slowDays must be an integer from 10 to 400.");
        if (isInt(a.fastDays) && isInt(a.slowDays) && a.fastDays >= a.slowDays) e("fastDays must be shorter than slowDays.");
        break;
      case "mean_reversion":
        known(a.risky, "risky"); known(a.safe, "safe");
        if (!isInt(a.rsiDays) || !inRange(a.rsiDays, 2, 30)) e("rsiDays must be an integer from 2 to 30.");
        if (!inRange(a.entryRsi, 1, 50)) e("entryRsi must be between 1 and 50.");
        if (!inRange(a.exitRsi, 50, 99)) e("exitRsi must be between 50 and 99.");
        if (!isInt(a.trendDays) || !(a.trendDays === 0 || inRange(a.trendDays, 20, 400))) e("trendDays must be 0 (no filter) or an integer from 20 to 400.");
        break;
      default: e(`unknown allocation type "${(a as { type?: string }).type}".`);
    }
  }

  if (a && typeof a === "object" && "risky" in a && "safe" in a && a.risky === a.safe) e("the risky and safe assets must be different ETFs.");

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

const TICKER_KEYS = ["risky", "safe"] as const;
const dedupe = (xs: string[]) => [...new Set(xs)];

/**
 * Run the same rules on different ETFs: every ticker in `map` is replaced wherever it appears
 * (universe, benchmark, signal assets, static weights and the cash reserve); tickers the strategy does
 * not use are ignored, so one map can be applied to a whole list. Weights that land on
 * the same ETF are merged and repeated assets collapse to one. The result gets a new id and a
 * caveat saying the parameters were tuned on the original ETFs.
 */
export function retarget(d: StrategyDef, map: Record<string, string>): StrategyDef {
  const used = requiredTickers(d);
  const pairs = Object.entries(map).filter(([from, to]) => from !== to && to && used.includes(from));
  if (pairs.length === 0) return d;
  const swap = Object.fromEntries(pairs);
  const sub = (t: string) => swap[t] ?? t;
  const c = structuredClone(d);
  const a = c.allocation as Record<string, unknown> & Allocation;
  for (const k of TICKER_KEYS) if (typeof a[k] === "string") (a as Record<string, unknown>)[k] = sub(a[k] as string);
  if (a.type === "static") {
    const w: Record<string, number> = {};
    for (const [t, v] of Object.entries(a.weights)) w[sub(t)] = (w[sub(t)] ?? 0) + v;
    a.weights = w;
  }
  if (a.type === "momentum") { a.universe = dedupe(a.universe.map(sub)); a.topN = Math.min(a.topN, a.universe.length); }
  if (a.type === "risk_parity" || a.type === "multi_trend") a.assets = dedupe(a.assets.map(sub));
  if (c.reserve) c.reserve.riskyTicker = sub(c.reserve.riskyTicker);
  c.universe = dedupe(c.universe.map(sub));
  c.benchmark = sub(c.benchmark);
  // sensitivity paths that name a ticker (allocation.weights.SPY) follow the rename
  c.sensitivity = c.sensitivity?.map((x) => ({ ...x, path: x.path.replace(/^allocation\.weights\.([A-Z]+)$/, (_m, t: string) => `allocation.weights.${sub(t)}`) }))
    .filter((x) => !x.path.startsWith("allocation.weights.") || Object.keys((c.allocation as { weights?: object }).weights ?? {}).includes(x.path.split(".")[2]));
  const label = pairs.map(([from, to]) => `${from}→${to}`).join(", ");
  const suffix = pairs.map(([, to]) => to.toLowerCase()).join("_");
  return {
    ...c,
    id: `${d.id.slice(0, 50 - suffix.length)}_on_${suffix}`.slice(0, 60),
    name: `${d.name} [${label}]`,
    summary: `Same rules applied with ${label}. ${d.summary}`,
    caveats: [`Rules and parameters were designed for ${pairs.map(([f]) => f).join(", ")}; they have not been re-tuned for ${pairs.map(([, t]) => t).join(", ")}.`, ...d.caveats],
    forkOf: d.forkOf ?? `${d.id}@${d.version}`,
  };
}

/**
 * Retarget only the ETFs the strategy trades, so one map can be applied to a whole list:
 * a strategy that merely benchmarks against SPY is returned unchanged.
 */
export function applyTarget(d: StrategyDef, map: Record<string, string>): StrategyDef {
  const traded = new Set([...allocationTickers(d.allocation), ...(d.reserve ? [d.reserve.riskyTicker] : [])]);
  return retarget(d, Object.fromEntries(Object.entries(map).filter(([k]) => traded.has(k))));
}

/** True when the strategy trades or benchmarks against the ticker. */
export const usesTicker = (d: StrategyDef, t: string) => requiredTickers(d).includes(t);
