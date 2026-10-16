import { correlation } from "./metrics";
import { INSTRUMENT_BY_TICKER, type Bucket } from "./instruments";
import type { SimResult } from "./backtest";

export interface OverlapInput { id: string; name: string; run: SimResult }

export interface PairOverlap { a: string; b: string; sharedExposure: number; returnCorrelation: number | null; level: "high" | "moderate" | "low" }
export interface OverlapReport {
  exposure: Record<string, Partial<Record<Bucket | "cash", number>>>;   // strategy id -> average share by asset bucket
  pairs: PairOverlap[];
  combined: Partial<Record<Bucket | "cash", number>>;                    // equal-weight basket by bucket
  topBucket: { bucket: string; share: number } | null;
  concentrated: boolean;
  warnings: string[];
  note: string;
}

export const OVERLAP_NOTE =
  "Exposure uses each ETF's broad asset class from a static table, not live fund holdings. Shared exposure is the sum over asset classes of the smaller of two strategies' average weights.";

/** Average exposure by asset bucket for one run, mapping each ETF to its buckets. */
export function bucketExposure(run: SimResult): Partial<Record<Bucket | "cash", number>> {
  const out: Partial<Record<Bucket | "cash", number>> = {};
  for (const [ticker, w] of Object.entries(run.avgExposure)) {
    if (ticker === "CASH") { out.cash = (out.cash ?? 0) + w; continue; }
    const inst = INSTRUMENT_BY_TICKER[ticker];
    if (!inst) continue;
    for (const [b, share] of Object.entries(inst.exposure)) out[b as Bucket] = (out[b as Bucket] ?? 0) + w * (share ?? 0);
  }
  return out;
}

export const sharedOf = (a: Partial<Record<string, number>>, b: Partial<Record<string, number>>) => {
  let s = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) s += Math.min(a[k] ?? 0, b[k] ?? 0);
  return s;
};

export function analyzeOverlap(items: OverlapInput[], weights?: Record<string, number>): OverlapReport {
  const exposure = Object.fromEntries(items.map((i) => [i.id, bucketExposure(i.run)]));
  const pairs: PairOverlap[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const shared = sharedOf(exposure[items[i].id], exposure[items[j].id]);
    const c = correlation(items[i].run.returns, items[j].run.returns);
    const corr = Number.isFinite(c) ? c : null;
    const level = shared >= 0.6 || (corr != null && corr >= 0.9) ? "high" : shared >= 0.3 || (corr != null && corr >= 0.7) ? "moderate" : "low";
    pairs.push({ a: items[i].id, b: items[j].id, sharedExposure: shared, returnCorrelation: corr, level });
  }

  const combined: Partial<Record<string, number>> = {};
  for (const it of items) {
    const w = weights?.[it.id] ?? 1 / items.length;
    for (const [k, v] of Object.entries(exposure[it.id])) combined[k] = (combined[k] ?? 0) + w * (v ?? 0);
  }
  const top = Object.entries(combined).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))[0];
  const topBucket = top ? { bucket: top[0], share: top[1] ?? 0 } : null;
  const concentrated = !!topBucket && topBucket.share >= 0.6 && items.length > 1;

  const name = (id: string) => items.find((i) => i.id === id)?.name ?? id;
  const warnings: string[] = [];
  for (const p of pairs) if (p.level === "high") {
    warnings.push(`${name(p.a)} and ${name(p.b)} share ${(p.sharedExposure * 100).toFixed(0)}% of their underlying exposure${p.returnCorrelation != null ? ` and their returns correlate at ${p.returnCorrelation.toFixed(2)}` : ""}. Holding both is not meaningful diversification.`);
  }
  if (concentrated && topBucket) {
    warnings.push(`${(topBucket.share * 100).toFixed(0)}% of the combined basket sits in one asset class (${topBucket.bucket.replace(/_/g, " ")}); a fall in that market would hit most of the basket at once.`);
  }
  return { exposure, pairs, combined, topBucket, concentrated, warnings, note: OVERLAP_NOTE };
}
