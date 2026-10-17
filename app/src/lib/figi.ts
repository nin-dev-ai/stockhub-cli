import { FIGI_CACHE_VERSION, figiBatches, figiBody, parseFigi } from "@/quant/figi";

const KEY = `stockhub-figi-v${FIGI_CACHE_VERSION}`;
const read = (): Record<string, string | null> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const write = (c: Record<string, string | null>) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* quota: run uncached */ } };

/** CUSIP → ticker, cached for good (a CUSIP does not change ticker often, and a stale one only drops a holding). */
export async function mapCusips(cusips: string[], fetcher: typeof fetch = fetch): Promise<Record<string, string | null>> {
  const cache = read();
  const todo = figiBatches(cusips.filter((c) => !(c.toUpperCase() in cache)));
  for (const batch of todo) {
    const res = await fetcher("/figi/v3/mapping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(figiBody(batch)), signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) throw new Error("OpenFIGI's free limit was reached (25 requests a minute); try again in a minute.");
    if (!res.ok) throw new Error(`OpenFIGI returned ${res.status}.`);
    Object.assign(cache, parseFigi(await res.json(), batch));
    write(cache);
  }
  return Object.fromEntries(cusips.map((c) => [c, cache[c.toUpperCase()] ?? null]));
}
