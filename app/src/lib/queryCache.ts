/**
 * A small browser cache for slow, public query results (persona filings): a screen shows the last
 * result at once, labelled with its age, while React Query refreshes it in the background.
 * Entries live in localStorage, newest MAX_ENTRIES kept; any storage error just skips the cache.
 */
const PREFIX = "stockhub-qcache:";
const INDEX = "stockhub-qcache-index";
export const MAX_ENTRIES = 40;

const keyOf = (k: readonly unknown[]) => PREFIX + JSON.stringify(k);
// parsed entries, so a screen that re-renders often does not re-read localStorage
const memo = new Map<string, { data: unknown; at: number } | undefined>();

export function readCached<T>(k: readonly unknown[]): { data: T; at: number } | undefined {
  const key = keyOf(k);
  if (memo.has(key)) return memo.get(key) as { data: T; at: number } | undefined;
  let hit: { data: T; at: number } | undefined;
  try { const raw = localStorage.getItem(key); hit = raw ? JSON.parse(raw) : undefined; } catch { hit = undefined; }
  memo.set(key, hit);
  return hit;
}

export function writeCached<T>(k: readonly unknown[], data: T, at = Date.now()): void {
  try {
    const key = keyOf(k);
    memo.set(key, { data, at });
    localStorage.setItem(key, JSON.stringify({ data, at }));
    const index = (JSON.parse(localStorage.getItem(INDEX) ?? "[]") as string[]).filter((x) => x !== key);
    index.push(key);
    for (const old of index.splice(0, Math.max(0, index.length - MAX_ENTRIES))) { localStorage.removeItem(old); memo.delete(old); }
    localStorage.setItem(INDEX, JSON.stringify(index));
  } catch { /* quota or private mode: run uncached */ }
}

/** Query options that start from the cached result (with its real age) and save each fresh one. */
export function cachedQuery<T>(queryKey: readonly unknown[], fetch: () => Promise<T>) {
  const hit = readCached<T>(queryKey);
  return {
    queryKey,
    queryFn: async () => { const d = await fetch(); writeCached(queryKey, d); return d; },
    ...(hit ? { initialData: hit.data, initialDataUpdatedAt: hit.at } : {}),
  };
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ageOf(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
