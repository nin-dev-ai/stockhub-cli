/**
 * Plans made of several strategies. Pure functions: what each strategy is for (its role), what the
 * plan holds today, whether the mix makes sense, how well a candidate fits, and a proposed plan
 * within the user's fall limit. See docs/PRD_phase4.md.
 */
import { INSTRUMENT_BY_TICKER, type Bucket } from "./instruments";
import { sharedOf, type OverlapReport } from "./overlap";
import { blendReturns, evaluateWeights, type BlendOptions, type Sleeve, type Weights } from "./portfolio";
import { sleeveDef, type StrategyDef } from "./strategy";
import { computeMetrics, correlation } from "./metrics";
import type { Metrics } from "./types";

export type Role = "core" | "tactical" | "diversifier";
export const ROLES: Record<Role, { label: string; blurb: string }> = {
  core: { label: "Core", blurb: "Mostly stocks, held through thick and thin; gives the plan its long-term growth." },
  tactical: { label: "Tactical", blurb: "Follows a signal and moves between the market and safety to cut big falls." },
  diversifier: { label: "Diversifier", blurb: "Spreads across stocks, bonds and gold so one market cannot sink the plan." },
};
export const ROLE_ORDER: Role[] = ["core", "tactical", "diversifier"];

const EQUITY_TYPES = new Set(["equity_etf", "reit_etf"]);
export const equityShare = (w: Record<string, number>) =>
  Object.entries(w).reduce((s, [t, x]) => s + (EQUITY_TYPES.has(INSTRUMENT_BY_TICKER[t]?.type ?? "") ? x : 0), 0);

/** What a strategy is for, from its rules: a mostly-stock fixed mix is core; a signal that switches is tactical; the rest diversify. */
export function planRole(d: StrategyDef): Role {
  const base = d.spread ? sleeveDef(d, d.spread.targets[0].ticker) : d;
  const a = base.allocation;
  switch (a.type) {
    case "static": return equityShare(a.weights) >= 0.5 ? "core" : "diversifier";
    case "risk_parity": case "multi_trend": return "diversifier";
    default: return "tactical";
  }
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  us_large: "US large companies", us_growth: "US growth stocks", us_value: "US value stocks", us_mid: "US mid-size companies", us_small: "US small companies",
  intl_developed: "International developed stocks", emerging: "Emerging-market stocks", us_agg_bond: "US bonds", treasury_long: "Long Treasuries",
  treasury_mid: "Medium Treasuries", tips: "Inflation-protected bonds", corp_bond: "Corporate bonds", high_yield: "High-yield bonds", em_bond: "Emerging-market bonds",
  gold: "Gold", commodity: "Commodities", real_estate: "Real estate", cash: "Cash and T-bills",
};

export interface Held { ticker: string; weight: number }
/** The plan's holdings today: each strategy's current targets times its plan weight. */
export function planHoldings(targets: { weight: number; targets: Record<string, number> }[]): Held[] {
  const out: Record<string, number> = {};
  for (const s of targets) for (const [t, x] of Object.entries(s.targets)) out[t] = (out[t] ?? 0) + s.weight * x;
  return Object.entries(out).filter(([, w]) => w > 1e-6).map(([ticker, weight]) => ({ ticker, weight })).sort((a, b) => b.weight - a.weight);
}

/** Holdings by asset class, through each ETF's static exposure table. */
export function assetClasses(held: Held[]): { bucket: Bucket; label: string; weight: number }[] {
  const out: Partial<Record<Bucket, number>> = {};
  for (const h of held) for (const [b, share] of Object.entries(INSTRUMENT_BY_TICKER[h.ticker]?.exposure ?? {})) out[b as Bucket] = (out[b as Bucket] ?? 0) + h.weight * (share ?? 0);
  return Object.entries(out).map(([b, weight]) => ({ bucket: b as Bucket, label: BUCKET_LABEL[b as Bucket], weight: weight ?? 0 })).sort((a, b) => b.weight - a.weight);
}

// ---------------------------------------------------------------------------------------------
// Does the plan make sense?

export interface PlanSleeve { id: string; name: string; role: Role; weight: number; metrics: Metrics }
export type FixAction = { kind: "remove"; id: string } | { kind: "add"; role: Role };
export interface PlanCheck { id: string; level: "good" | "warn" | "issue"; title: string; detail: string; fix?: { label: string; action: FixAction } }

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const MIN_SLEEVE = 0.05;

/**
 * Two strategies are redundant when they hold nearly the same things or their returns move almost as
 * one. A core paired with a trend overlay on the same market (about 60% shared) is a normal plan.
 */
export const REDUNDANT_SHARED = 0.75, REDUNDANT_CORRELATION = 0.9;
export const isRedundant = (shared: number, corr: number | null) => shared >= REDUNDANT_SHARED || (corr != null && corr >= REDUNDANT_CORRELATION);

export function checkPlan(a: { sleeves: PlanSleeve[]; overlap: OverlapReport | null; plan: Metrics | null; fallLimit: number | null }): PlanCheck[] {
  const out: PlanCheck[] = [];
  const { sleeves } = a;
  const name = (id: string) => sleeves.find((s) => s.id === id)?.name ?? id;

  if (a.fallLimit != null && a.plan?.maxDrawdown != null) {
    const worst = a.plan.maxDrawdown;
    out.push(worst < -a.fallLimit
      ? { id: "fall", level: "issue", title: `The worst fall, ${pct(worst, 1)}, is past your ${pct(a.fallLimit)} limit`, detail: "In the worst stretch of the test, this mix would have lost more than you said you could stomach. Add a diversifier or tactical sleeve, or shift weight toward the one that fell least.", fix: sleeves.some((s) => s.role === "diversifier") ? undefined : { label: "Add a diversifier", action: { kind: "add", role: "diversifier" } } }
      : { id: "fall", level: "good", title: `The worst fall, ${pct(worst, 1)}, is within your ${pct(a.fallLimit)} limit`, detail: "Historical, not a promise: a different crisis can fall further." });
  }

  const roles = new Set(sleeves.filter((s) => s.weight >= MIN_SLEEVE).map((s) => s.role));
  if (sleeves.length === 1) {
    out.push({ id: "one", level: "warn", title: "A plan of one strategy is just that strategy", detail: "Add a strategy that behaves differently, such as a diversifier next to a core.", fix: { label: sleeves[0].role === "core" ? "Add a diversifier" : "Add a core", action: { kind: "add", role: sleeves[0].role === "core" ? "diversifier" : "core" } } });
  } else if (sleeves.length > 1) {
    if (!roles.has("core")) out.push({ id: "core", level: "warn", title: "Nothing anchors long-term growth", detail: "Every sleeve moves in and out or holds mostly bonds and gold. A core sleeve (mostly stocks, held for the long term) is what grows the money over decades.", fix: { label: "Add a core", action: { kind: "add", role: "core" } } });
    else if (roles.size === 1) out.push({ id: "roles", level: "warn", title: `All sleeves do the same job (${ROLES[[...roles][0]].label.toLowerCase()})`, detail: "A plan holds up better when a core is paired with something that behaves differently in a downturn.", fix: { label: "Add a diversifier", action: { kind: "add", role: "diversifier" } } });
    else out.push({ id: "roles", level: "good", title: `The sleeves cover ${roles.size} different jobs`, detail: [...roles].map((r) => ROLES[r].label).join(", ") + "." });
  }

  for (const p of a.overlap?.pairs ?? []) {
    if (!isRedundant(p.sharedExposure, p.returnCorrelation)) continue;
    const [x, y] = [sleeves.find((s) => s.id === p.a), sleeves.find((s) => s.id === p.b)];
    if (!x || !y) continue;
    const drop = (x.metrics.sharpe ?? 0) >= (y.metrics.sharpe ?? 0) ? y : x;
    out.push({ id: `overlap-${p.a}-${p.b}`, level: "issue", title: `${name(p.a)} and ${name(p.b)} do almost the same thing`,
      detail: `They share ${pct(p.sharedExposure)} of what they own${p.returnCorrelation != null ? ` and their returns move together (correlation ${p.returnCorrelation.toFixed(2)})` : ""}, so splitting money between them adds little.`,
      fix: { label: `Remove ${drop.name}`, action: { kind: "remove", id: drop.id } } });
  }

  const top = a.overlap?.topBucket;
  if (top && top.share >= 0.6 && sleeves.length > 1) out.push({ id: "concentration", level: "warn", title: `${pct(top.share)} of the plan is in one asset class`, detail: `${BUCKET_LABEL[top.bucket as Bucket] ?? top.bucket}: a fall there would hit most of the plan at once.` });

  const tiny = sleeves.filter((s) => s.weight < MIN_SLEEVE);
  for (const s of tiny) out.push({ id: `tiny-${s.id}`, level: "warn", title: `${s.name} is only ${pct(s.weight)} of the plan`, detail: "Too small to change the result; give it a real share or drop it.", fix: { label: `Remove ${s.name}`, action: { kind: "remove", id: s.id } } });

  if (sleeves.length > 1 && a.plan?.volatility != null) {
    const avg = sleeves.reduce((t, s) => t + s.weight * (s.metrics.volatility ?? 0), 0);
    const gain = avg - a.plan.volatility;
    if (gain >= 0.01) out.push({ id: "mix", level: "good", title: `Mixing them smoothed the ride by ${(gain * 100).toFixed(1)} points`, detail: `The plan's volatility, ${pct(a.plan.volatility, 1)}, is below the weighted average of its sleeves, ${pct(avg, 1)}.` });
    else out.push({ id: "mix", level: "warn", title: "Mixing them barely smoothed the ride", detail: `The plan's volatility, ${pct(a.plan.volatility, 1)}, is about the same as the weighted average of its sleeves, ${pct(avg, 1)}; the sleeves move together.` });
  }

  const rank = { issue: 0, warn: 1, good: 2 } as const;
  return out.sort((x, y) => rank[x.level] - rank[y.level]);
}

// ---------------------------------------------------------------------------------------------
// Candidates and suggestions

/** Aligns sleeves to their common dates, compounding over any dates only some of them have. */
export function alignSleeves(sleeves: Sleeve[]): Sleeve[] {
  if (sleeves.length === 0) return [];
  const sets = sleeves.map((s) => new Set(s.dates));
  const start = sleeves.map((s) => s.dates[0]).sort().at(-1)!;
  const common = sleeves[0].dates.filter((d) => d >= start && sets.every((x) => x.has(d)));
  return sleeves.map((s) => {
    const growth = new Map<string, number>();
    let g = 1;
    growth.set(s.dates[0], g);
    for (let i = 0; i < s.returns.length; i++) { g *= 1 + s.returns[i]; growth.set(s.dates[i + 1], g); }
    const returns: number[] = [];
    for (let k = 1; k < common.length; k++) returns.push(growth.get(common[k])! / growth.get(common[k - 1])! - 1);
    return { ...s, dates: common, returns };
  });
}

export interface Candidate { id: string; name: string; role: Role; sleeve: Sleeve; verdict?: string | null; experimental?: boolean; metrics: Metrics; /** Average exposure by asset class, from its backtest. */ exposure: Partial<Record<string, number>> }

const redundantWith = (c: Candidate, others: Candidate[]) => others.some((o) => {
  const [a, b] = alignSleeves([o.sleeve, c.sleeve]);
  const corr = correlation(a.returns, b.returns);
  return isRedundant(sharedOf(o.exposure, c.exposure), Number.isFinite(corr) ? corr : null);
});
export interface Fit { score: number; correlation: number | null; fillsRole: boolean; reasons: string[]; fallBefore: number | null; fallAfter: number | null }

const ADD_SHARE = 0.25;

/** How well a candidate would sit in the plan: fills a missing role, low overlap, sound evidence, and the effect on the worst fall at a 25% share. */
export function fitCandidate(c: Candidate, plan: { sleeves: Sleeve[]; weights: Weights; roles: Role[] }, rf = 0, mix: BlendOptions = {}): Fit {
  const reasons: string[] = [];
  const blend = plan.sleeves.length ? (() => {
    const [aligned] = [alignSleeves([...plan.sleeves, c.sleeve])];
    const w = Object.fromEntries(plan.sleeves.map((s) => [s.id, plan.weights[s.id] ?? 0]));
    const planR = blendReturns(aligned.slice(0, -1), w, mix);
    return { aligned, planR };
  })() : null;
  const corr = blend ? correlation(blend.planR, blend.aligned[blend.aligned.length - 1].returns) : null;
  const fillsRole = !plan.roles.includes(c.role);
  let fallBefore: number | null = null, fallAfter: number | null = null;
  if (blend) {
    const dates = blend.aligned[0].dates;
    fallBefore = computeMetrics(blend.planR, dates, { riskFreeRate: rf }).maxDrawdown;
    const mixed = blend.planR.map((r, i) => (1 - ADD_SHARE) * r + ADD_SHARE * blend.aligned[blend.aligned.length - 1].returns[i]);
    fallAfter = computeMetrics(mixed, dates, { riskFreeRate: rf }).maxDrawdown;
  }
  let score = (c.metrics.sharpe ?? 0) * 0.5;
  if (fillsRole) { score += 1; reasons.push(`Fills the missing ${ROLES[c.role].label.toLowerCase()} role`); }
  if (corr != null) {
    score += (1 - Math.max(0, corr)) * 1.5;
    reasons.push(corr >= 0.85 ? `Moves almost with the plan (correlation ${corr.toFixed(2)})` : corr >= 0.6 ? `Overlaps the plan (correlation ${corr.toFixed(2)})` : `Behaves differently from the plan (correlation ${corr.toFixed(2)})`);
  }
  if (c.verdict === "consistent") { score += 0.5; reasons.push("Held up across periods"); }
  if (c.verdict === "inconsistent" || c.verdict === "insufficient") { score -= 1; reasons.push("Weak evidence across periods"); }
  if (c.experimental) { score -= 1; reasons.push("Experimental"); }
  return { score, correlation: corr, fillsRole, reasons, fallBefore, fallAfter };
}

/** The proposal re-made on early history only and judged on the later years it never saw. */
export interface OutOfSample {
  /** First date of the test period. */
  split: string;
  fitWeights: Weights;
  /** The early-fit weights, then equal weights and the best single sleeve, over the test period. */
  test: Metrics;
  equal: Metrics;
  bestSingle: { id: string; metrics: Metrics };
  /** True when the early-fit weights did clearly worse later than simply splitting equally, or broke the limit when equal weights did not. */
  clearlyWorse: boolean;
  summary: string;
}

export interface Suggestion { ids: string[]; weights: Weights; metrics: Metrics; withinLimit: boolean; fallLimit: number | null; notes: string[]; outOfSample: OutOfSample | null }

/** The plain-language verdict for an out-of-sample check; exported for tests. */
export function oosVerdict(test: Metrics, equal: Metrics, fallLimit: number | null): { clearlyWorse: boolean; reason: string } {
  const broke = (m: Metrics) => fallLimit != null && m.maxDrawdown != null && m.maxDrawdown < -fallLimit;
  const sharpeGap = (equal.sharpe ?? 0) - (test.sharpe ?? 0);
  if (broke(test) && !broke(equal)) return { clearlyWorse: true, reason: "broke your fall limit in the later years while an equal split did not" };
  if (sharpeGap > 0.15) return { clearlyWorse: true, reason: `earned clearly less per unit of risk later than an equal split (Sharpe ${(test.sharpe ?? 0).toFixed(2)} against ${(equal.sharpe ?? 0).toFixed(2)})` };
  const pair = `(Sharpe ${(test.sharpe ?? 0).toFixed(2)} against ${(equal.sharpe ?? 0).toFixed(2)})`;
  return sharpeGap > 0.005
    ? { clearlyWorse: false, reason: `did a little worse in the later years than an equal split, within the margin of noise ${pair}` }
    : { clearlyWorse: false, reason: `did as well as or better than an equal split in the later years ${pair}` };
}

/** Compositions of `total` units over `n` parts, each at least `min` and at most `cap`. */
function grid(n: number, total: number, min: number, cap: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (i: number, left: number) => {
    if (i === n - 1) { if (left >= min && left <= cap) out.push([...cur, left]); return; }
    for (let v = min; v <= Math.min(cap, left - min * (n - 1 - i)); v++) { cur.push(v); rec(i + 1, left - v); cur.pop(); }
  };
  rec(0, total);
  return out;
}

/**
 * Proposes a plan from the candidates: the best-evidenced core, then a diversifier and a tactical
 * chosen for low overlap with what is already in the plan (never redundant with a chosen sleeve), then the highest-growth weights (5% steps,
 * each sleeve at least 10% and at most 70%) whose worst fall stays within the limit. If no weights
 * fit, the shallowest fall is used and `withinLimit` is false.
 */
export function suggestPlan(cands: Candidate[], fallLimit: number | null, rf = 0, blend: BlendOptions = {}): Suggestion | null {
  const pool = cands.filter((c) => !c.experimental && c.verdict !== "inconsistent" && c.verdict !== "insufficient" && c.sleeve.returns.length >= 252);
  const notes: string[] = [];
  const byRole = (r: Role) => pool.filter((c) => c.role === r);
  const core = [...byRole("core")].sort((a, b) => (b.metrics.sharpe ?? 0) - (a.metrics.sharpe ?? 0))[0];
  if (!core) return null;
  const chosen: Candidate[] = [core];
  const pick = (role: Role) => {
    const rest = byRole(role).filter((c) => !chosen.includes(c) && !redundantWith(c, chosen));
    if (!rest.length) return;
    const planSleeves = chosen.map((c) => c.sleeve);
    const w = Object.fromEntries(chosen.map((c) => [c.id, 1 / chosen.length]));
    const best = rest.map((c) => ({ c, f: fitCandidate(c, { sleeves: planSleeves, weights: w, roles: chosen.map((x) => x.role) }, rf, blend) }))
      .sort((x, y) => y.f.score - x.f.score)[0];
    if (best) chosen.push(best.c);
  };
  pick("diversifier"); pick("tactical");
  if (chosen.length < 2) { notes.push("Only one strategy qualified, so the plan is a single sleeve."); }

  const aligned = alignSleeves(chosen.map((c) => c.sleeve));
  const n = aligned.length;
  const ids = aligned.map((s) => s.id);
  if (n === 1) {
    const m = evaluateWeights(aligned, { [ids[0]]: 1 }, rf, 0, undefined, blend).metrics;
    return { ids, weights: { [ids[0]]: 1 }, metrics: m, withinLimit: fallLimit == null || (m.maxDrawdown ?? 0) >= -fallLimit, fallLimit, notes, outOfSample: null };
  }
  // the weight search over [from, to) of the aligned returns; `to` undefined means to the end
  const search = (from: number, to?: number) => {
    let best: { w: number[]; m: Metrics } | null = null, shallow: { w: number[]; m: Metrics } | null = null;
    for (const c of grid(n, 20, 2, 14)) {
      const w = Object.fromEntries(ids.map((id, i) => [id, c[i] / 20]));
      const m = evaluateWeights(aligned, w, rf, from, to, blend).metrics;
      const dd = m.maxDrawdown ?? -1;
      if (!shallow || dd > (shallow.m.maxDrawdown ?? -1) + 1e-9) shallow = { w: c, m };
      if ((fallLimit == null || dd >= -fallLimit) && (m.cagr ?? -1) > (best?.m.cagr ?? -Infinity)) best = { w: c, m };
    }
    return { pick: best ?? shallow!, within: !!best };
  };
  const toWeights = (c: number[]) => Object.fromEntries(ids.map((id, i) => [id, c[i] / 20]));
  const full = search(0);
  if (!full.within) notes.push(`No mix of these sleeves kept the worst fall within ${pct(fallLimit ?? 0)}; this is the shallowest one found.`);

  // re-make the proposal on the first 60% of history and judge it on the rest, which it never saw
  let outOfSample: OutOfSample | null = null;
  const len = aligned[0].returns.length, cut = Math.floor(len * 0.6);
  if (cut >= 252 && len - cut >= 252) {
    const fitWeights = toWeights(search(0, cut).pick.w);
    const test = evaluateWeights(aligned, fitWeights, rf, cut, undefined, blend).metrics;
    const equal = evaluateWeights(aligned, Object.fromEntries(ids.map((id) => [id, 1 / n])), rf, cut, undefined, blend).metrics;
    const singles = ids.map((id) => ({ id, metrics: evaluateWeights(aligned, { [id]: 1 }, rf, cut, undefined, blend).metrics }));
    const bestSingle = [...singles].sort((a, b) => (b.metrics.sharpe ?? -9) - (a.metrics.sharpe ?? -9))[0];
    const split = aligned[0].dates[cut];
    const v = oosVerdict(test, equal, fallLimit);
    outOfSample = {
      split, fitWeights, test, equal, bestSingle, clearlyWorse: v.clearlyWorse,
      summary: `Picked again using only the years before ${split}, the weights ${v.reason}.`,
    };
    if (v.clearlyWorse) notes.push("The out-of-sample check is weak: treat these weights with caution, and an equal split as a fair alternative.");
  }
  return { ids, weights: toWeights(full.pick.w), metrics: full.pick.m, withinLimit: full.within, fallLimit, notes, outOfSample };
}

/** Rescales the other weights so the total stays 100% when one weight is set. */
export function setWeight(w: Weights, id: string, value: number): Weights {
  const v = Math.min(1, Math.max(0, value));
  const others = Object.keys(w).filter((k) => k !== id);
  const rest = others.reduce((s, k) => s + w[k], 0);
  const out: Weights = { [id]: v };
  for (const k of others) out[k] = rest > 1e-9 ? (w[k] / rest) * (1 - v) : others.length ? (1 - v) / others.length : 0;
  return out;
}
