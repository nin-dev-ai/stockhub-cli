import { fetchAdjustedHistory } from "@/lib/api";
import { buildDataset, type Dataset, type RawBar, type RawSeries } from "./data";

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
  if (hit && hit.start <= start && Date.now() - hit.fetchedAt < TTL_MS) return hit.bars;
  const rows = await fetchAdjustedHistory(ticker, start);
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
    raw[t] = await memo.get(k)!;
  }));
  return buildDataset(raw, { provider: "yfinance via OpenBB", fetchedAt: new Date().toISOString() });
}

export function clearPriceCache() {
  memo.clear();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
