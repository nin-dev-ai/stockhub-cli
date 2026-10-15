import { hashId } from "./hash";
import type { Panel, QualityFlag } from "./types";

export interface RawBar { date: string; close: number }
export type RawSeries = Record<string, RawBar[]>;

export interface DatasetVersion {
  id: string;
  provider: string;
  adjustedPriceBasis: string;
  tickers: string[];
  start: string;
  end: string;
  rows: number;
  fetchedAt: string;
  qualityFlags: QualityFlag[];
}
export interface Dataset { panel: Panel; version: DatasetVersion }

export const BASIS = "splits_and_dividends (total-return adjusted closes)";
const STALE_DAYS = 7;
const GAP_DAYS = 10;
const JUMP = 0.4;
const MIN_ROWS = 252;

const dayDiff = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

/** Drop non-finite or non-positive closes, de-duplicate dates, sort ascending. */
export function cleanSeries(bars: RawBar[]): { bars: RawBar[]; dropped: number } {
  const byDate = new Map<string, number>();
  let dropped = 0;
  for (const b of bars) {
    const d = typeof b.date === "string" ? b.date.slice(0, 10) : "";
    if (!d || !Number.isFinite(b.close) || b.close <= 0) { dropped++; continue; }
    byDate.set(d, b.close);
  }
  const out = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, close]) => ({ date, close }));
  return { bars: out, dropped };
}

export function seriesFlags(ticker: string, bars: RawBar[], dropped: number, now: string): QualityFlag[] {
  const f: QualityFlag[] = [];
  if (bars.length === 0) return [{ code: "empty", severity: "error", message: `${ticker}: no usable price history.` }];
  if (dropped > 0) f.push({ code: "dropped_rows", severity: "warn", message: `${ticker}: ${dropped} row(s) with missing or non-positive prices were dropped.` });
  if (bars.length < MIN_ROWS) f.push({ code: "short_history", severity: "warn", message: `${ticker}: only ${bars.length} trading days of history.` });
  let maxGap = 0, gapAt = "";
  let jumps = 0;
  for (let i = 1; i < bars.length; i++) {
    const g = dayDiff(bars[i - 1].date, bars[i].date);
    if (g > maxGap) { maxGap = g; gapAt = bars[i].date; }
    if (Math.abs(bars[i].close / bars[i - 1].close - 1) > JUMP) jumps++;
  }
  if (maxGap > GAP_DAYS) f.push({ code: "gap", severity: "warn", message: `${ticker}: a ${maxGap.toFixed(0)}-day gap in the data ends on ${gapAt}.` });
  if (jumps > 0) f.push({ code: "price_jump", severity: "warn", message: `${ticker}: ${jumps} daily move(s) above ${JUMP * 100}% — check for unadjusted corporate actions.` });
  const stale = dayDiff(bars[bars.length - 1].date, now);
  if (stale > STALE_DAYS) f.push({ code: "stale", severity: "warn", message: `${ticker}: latest price is ${bars[bars.length - 1].date}, ${stale.toFixed(0)} days old.` });
  return f;
}

/**
 * Build an aligned panel on the intersection of trading dates and a versioned descriptor.
 * The version id hashes the data itself, so a silent provider revision changes the id.
 */
export function buildDataset(raw: RawSeries, meta: { provider: string; fetchedAt: string }): Dataset {
  const tickers = Object.keys(raw).sort();
  const flags: QualityFlag[] = [];
  const cleaned: Record<string, RawBar[]> = {};
  const nowDay = meta.fetchedAt.slice(0, 10);

  for (const t of tickers) {
    const { bars, dropped } = cleanSeries(raw[t]);
    cleaned[t] = bars;
    flags.push(...seriesFlags(t, bars, dropped, nowDay));
  }

  const usable = tickers.filter((t) => cleaned[t].length > 0);
  let dates: string[] = [];
  if (usable.length > 0) {
    const sets = usable.map((t) => new Set(cleaned[t].map((b) => b.date)));
    dates = cleaned[usable[0]].map((b) => b.date).filter((d) => sets.every((s) => s.has(d)));
    const longest = Math.max(...usable.map((t) => cleaned[t].length));
    if (usable.length > 1 && dates.length < longest * 0.9) {
      const limiting = usable.reduce((a, b) => (cleaned[a].length <= cleaned[b].length ? a : b));
      flags.push({ code: "history_trimmed", severity: "info", message: `Common history starts ${dates[0] ?? "n/a"}, limited by ${limiting}.` });
    }
  }

  const closes: Record<string, number[]> = {};
  for (const t of usable) {
    const m = new Map(cleaned[t].map((b) => [b.date, b.close]));
    closes[t] = dates.map((d) => m.get(d)!);
  }
  if (dates.length === 0) flags.push({ code: "no_overlap", severity: "error", message: "The selected instruments share no common trading dates." });

  const panel: Panel = { dates, closes };
  const version: DatasetVersion = {
    id: hashId({ basis: BASIS, provider: meta.provider, dates, closes }),
    provider: meta.provider,
    adjustedPriceBasis: BASIS,
    tickers: usable,
    start: dates[0] ?? "",
    end: dates[dates.length - 1] ?? "",
    rows: dates.length,
    fetchedAt: meta.fetchedAt,
    qualityFlags: flags,
  };
  return { panel, version };
}

export const hasErrors = (flags: QualityFlag[]) => flags.some((f) => f.severity === "error");

/** Slice a panel to [start, end] inclusive without mutating it. */
export function slicePanel(p: Panel, start?: string, end?: string): Panel {
  const lo = start ? p.dates.findIndex((d) => d >= start) : 0;
  let hi = p.dates.length;
  if (end) { const i = p.dates.findIndex((d) => d > end); if (i >= 0) hi = i; }
  if (lo < 0) return { dates: [], closes: Object.fromEntries(Object.keys(p.closes).map((k) => [k, []])) };
  return {
    dates: p.dates.slice(lo, hi),
    closes: Object.fromEntries(Object.entries(p.closes).map(([k, v]) => [k, v.slice(lo, hi)])),
  };
}

/** Panel restricted to a subset of tickers (dates unchanged). */
export const subPanel = (p: Panel, tickers: string[]): Panel => ({
  dates: p.dates,
  closes: Object.fromEntries(tickers.map((t) => [t, p.closes[t]])),
});
