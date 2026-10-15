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
  | { type: "mean_reversion"; risky: string; safe: string; rsiDays: number; entryRsi: number; exitRsi: number; trendDays: number }
  /**
   * Dated target weights (any US-listed ticker, stocks included), e.g. copying a persona's reported
   * trades from the day each report became public. Each step holds until the next; the unallocated
   * part, and everything before the first step, is held in `safe`.
   */
  | { type: "schedule"; safe: string; steps: { date: string; weights: Record<string, number>; note?: string }[] };

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
  /**
   * Run the rules once per ETF in `targets` (each run replaces `from` with that ETF) and add the
   * runs together. Each sleeve receives its weight's share of the initial capital and of every
   * contribution; sleeves are not rebalanced against each other.
   */
  spread?: { from: string; targets: { ticker: string; weight: number }[] };
}

export const MAX_SPREAD = 6;

const SCHEDULES: Schedule[] = ["daily", "weekly", "monthly", "quarterly", "annual", "none"];

export function allocationTickers(a: Allocation): string[] {
  switch (a.type) {
    case "static": return Object.keys(a.weights);
    case "trend": case "vol_target": case "seasonal": case "tsmom": case "crossover": case "mean_reversion": return [a.risky, a.safe];
    case "momentum": return [...a.universe, a.safe];
    case "risk_parity": return [...a.assets];
    case "multi_trend": return [...a.assets, a.safe];
    case "schedule": return [...new Set([...a.steps.flatMap((s) => Object.keys(s.weights)), a.safe])];
  }
}

/** Every ticker a strategy needs prices for, including the benchmark. */
export function requiredTickers(d: StrategyDef): string[] {
  const s = new Set<string>([...d.universe, d.benchmark, ...allocationTickers(d.allocation)]);
  if (d.reserve) s.add(d.reserve.riskyTicker);
  for (const t of d.spread?.targets ?? []) for (const k of requiredTickers(sleeveDef(d, t.ticker))) s.add(k);
  return [...s].sort();
}

/** The ETF a strategy's signal trades: its risky asset, or the largest equity weight of a fixed mix. */
export function primaryRisky(d: StrategyDef): string | null {
  const a = d.allocation;
  if ("risky" in a) return a.risky;
  if (d.reserve) return d.reserve.riskyTicker;
  if (a.type === "static") {
    const eq = Object.entries(a.weights).filter(([t]) => INSTRUMENT_BY_TICKER[t]?.type === "equity_etf").sort((x, y) => y[1] - x[1]);
    return eq[0]?.[0] ?? null;
  }
  return null;
}

/** One sleeve of a spread strategy: the same rules with `from` replaced by `ticker`. */
export function sleeveDef(d: StrategyDef, ticker: string): StrategyDef {
  const { spread, ...base } = d;
  if (!spread) return d;
  const one = applyTarget(base as StrategyDef, { [spread.from]: ticker });
  return { ...one, id: `${d.id}__${ticker.toLowerCase()}`.slice(0, 60) };
}

/**
 * Spread a strategy across several ETFs in place of the one it trades (equal weights by default).
 * Returns null when the strategy already spreads across many assets and has no single ETF to replace.
 */
export function withSpread(d: StrategyDef, tickers: string[], weights?: number[], from = primaryRisky(d)): StrategyDef | null {
  const uniq = [...new Set(tickers)];
  if (!from || uniq.length === 0 || d.spread) return null;
  if (uniq.length === 1) return applyTarget(d, { [from]: uniq[0] });
  const w = weights && weights.length === uniq.length ? weights : uniq.map(() => 1 / uniq.length);
  const list = uniq.join("+");
  const suffix = uniq.map((t) => t.toLowerCase()).join("_");
  return {
    ...structuredClone(d),
    id: `${d.id.slice(0, 50 - suffix.length)}_x_${suffix}`.slice(0, 60),
    name: `${d.name} [across ${list}]`,
    summary: `The same rules run separately on ${list} in place of ${from}, with money split ${w.map((x) => `${Math.round(x * 100)}%`).join("/")}. ${d.summary}`,
    spread: { from, targets: uniq.map((ticker, i) => ({ ticker, weight: w[i] })) },
    caveats: [`Rules and parameters were designed for ${from}; they have not been re-tuned for ${uniq.filter((t) => t !== from).join(", ") || from}. Sleeves are not rebalanced against each other.`, ...d.caveats],
    forkOf: d.forkOf ?? `${d.id}@${d.version}`,
  };
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
      case "schedule": {
        known(a.safe, "safe");
        const steps = Array.isArray(a.steps) ? a.steps : [];
        if (steps.length < 1 || steps.length > 1000) e("schedule needs 1 to 1000 steps.");
        let prev = "";
        for (const st of steps) {
          if (typeof st?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(st.date) || st.date <= prev) { e("schedule step dates must be ISO dates in increasing order."); break; }
          prev = st.date;
          const w = Object.entries(st.weights ?? {});
          if (w.some(([t]) => !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t))) { e(`schedule step ${st.date} names an invalid ticker.`); break; }
          if (w.some(([, v]) => !inRange(v, 0, 1)) || w.reduce((s, [, v]) => s + v, 0) > 1 + 1e-6) { e(`schedule step ${st.date} weights must be 0-100% each and at most 100% in total.`); break; }
        }
        break;
      }
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
  if (s.spread) {
    const sp = s.spread, list = Array.isArray(sp.targets) ? sp.targets : [];
    if (list.length < 1 || list.length > MAX_SPREAD) e(`spread needs 1 to ${MAX_SPREAD} ETFs.`);
    list.forEach((t) => known(t?.ticker, "spread ticker"));
    if (new Set(list.map((t) => t?.ticker)).size !== list.length) e("spread ETFs must not repeat.");
    if (list.some((t) => !inRange(t?.weight, 0.01, 1))) e("spread weights must be between 1% and 100%.");
    else if (Math.abs(list.reduce((x, t) => x + t.weight, 0) - 1) > 1e-6) e("spread weights must sum to 100%.");
    if (a && typeof a === "object" && !(allocationTickers(a) ?? []).includes(sp.from) && s.reserve?.riskyTicker !== sp.from) e(`spread replaces ${String(sp.from)}, which the strategy does not trade.`);
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
