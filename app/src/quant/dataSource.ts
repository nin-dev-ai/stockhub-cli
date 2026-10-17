import { fetchAdjustedHistory } from "@/lib/api";
import { buildDataset, cleanSeries, type Dataset, type RawBar, type RawSeries } from "./data";

const TTL_MS = 12 * 3600_000;
const KEY = "stockhub-prices-v1";
export const DEFAULT_START = "2003-01-01";

interface CacheEntry { fetchedAt: number; start: string; bars: RawBar[] }
const memo = new Map<string, Promise<RawBar[]>>();

function readCache(): Record<string, CacheEntry> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}
function writeCache(c: Record<string, CacheEntry>) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* quota: run uncached */ }
}

async function loadTicker(ticker: string, start: string): Promise<RawBar[]> {
  const cache = readCache();
  const hit = cache[ticker];
  if (hit && hit.bars.length > 0 && hit.start <= start && Date.now() - hit.fetchedAt < TTL_MS) return hit.bars;
  let rows = await fetchAdjustedHistory(ticker, start);
  // the provider sometimes answers a burst of requests with an empty result; retry once, never cache it
  if (rows.length === 0) rows = await fetchAdjustedHistory(ticker, start);
  if (rows.length === 0) throw new Error(`${ticker}: the provider returned no prices.`);
  const bars = rows.map((r) => ({ date: r.date, close: r.close }));
  writeCache({ ...readCache(), [ticker]: { fetchedAt: Date.now(), start, bars } });
  return bars;
}

export async function loadDataset(tickers: string[], start = DEFAULT_START): Promise<Dataset> {
  const uniq = [...new Set(tickers.map((t) => t.toUpperCase()))].sort();
  const raw: RawSeries = {};
  await Promise.all(uniq.map(async (t) => {
    const k = `${t}|${start}`;
    if (!memo.has(k)) {
      const p = loadTicker(t, start);
      p.catch(() => memo.delete(k));
      memo.set(k, p);
    }
    // a failed ticker becomes an empty series: it is flagged, and only strategies that need it fail
    raw[t] = await memo.get(k)!.catch(() => []);
  }));
  return buildDataset(raw, { provider: "yfinance via OpenBB", fetchedAt: new Date().toISOString() });
}

/** One ticker's adjusted closes from `start`, cleaned, without aligning to other tickers (shared cache with datasets). */
export async function loadBars(ticker: string, start: string): Promise<RawBar[]> {
  const t = ticker.toUpperCase(), k = `${t}|${start}`;
  if (!memo.has(k)) {
    const p = loadTicker(t, start);
    p.catch(() => memo.delete(k));
    memo.set(k, p);
  }
  return cleanSeries(await memo.get(k)!).bars;
}

/**
 * A dataset for a window that starts on `start`: tickers whose history begins after it (later listings)
 * are left out and returned, instead of shortening everyone's common window. `keep` are never dropped.
 */
export async function loadDatasetFrom(tickers: string[], start: string, keep: string[] = [], slack = 7): Promise<{ dataset: Dataset; late: string[] }> {
  const uniq = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const from = new Date(Date.parse(start) - 40 * 864e5).toISOString().slice(0, 10);
  const limit = new Date(Date.parse(start) + slack * 864e5).toISOString().slice(0, 10);
  const firsts: Record<string, string | null> = {};
  const fetchFirst = async (t: string) => { const b = await loadBars(t, from).catch(() => []); firsts[t] = b[0]?.date ?? null; };
  for (let i = 0; i < uniq.length; i += 4) await Promise.all(uniq.slice(i, i + 4).map(fetchFirst));
  // a failed download is not a late listing: try those once more after a pause, one at a time
  const failed = uniq.filter((t) => firsts[t] == null);
  if (failed.length) { await new Promise((r) => setTimeout(r, 1500)); for (const t of failed) await fetchFirst(t); }
  const late = uniq.filter((t) => !keep.includes(t) && (firsts[t] == null || firsts[t]! > limit));
  return { dataset: await loadDataset(uniq.filter((t) => !late.includes(t)), from), late };
}

export function clearPriceCache() {
  memo.clear();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
