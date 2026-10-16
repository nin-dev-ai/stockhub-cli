import {
  freshness, is13F, latest13F, parseFiling, parseSubmissions, rawDocPath, recentLive,
  type Freshness, type SecFiling,
} from "@/quant/edgar";
import type { PersonaTrade } from "@/quant/personas";

/** True when the dev server was started with STOCKHUB_SEC_CONTACT, which the SEC's User-Agent rule requires. */
export const SEC_CONFIGURED = import.meta.env.VITE_SEC_CONFIGURED === "true";

const CACHE_KEY = "stockhub-sec-events-v1";
const MAX_CACHED = 400;

// SEC fair access allows 10 requests a second; stay well under it across every persona on screen
let active = 0, last = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= 3) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    const wait = Math.max(0, last + 150 - Date.now());
    last = Date.now() + wait;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return await fn();
  } finally { active--; queue.shift()?.(); }
}

/** One retry after a pause when the SEC throttles (429) or hiccups (5xx): its fair-access limit is per second, so a short wait clears it. */
async function get(url: string, fetcher: typeof fetch): Promise<Response> {
  let res = await slot(() => fetcher(url));
  if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500)); res = await slot(() => fetcher(url)); }
  return res;
}

const readCache = (): Record<string, PersonaTrade[]> => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}"); } catch { return {}; } };
const writeCache = (c: Record<string, PersonaTrade[]>) => {
  const keys = Object.keys(c);
  const kept = keys.length > MAX_CACHED ? Object.fromEntries(keys.slice(keys.length - MAX_CACHED).map((k) => [k, c[k]])) : c;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(kept)); } catch { /* quota: run uncached */ }
};

/** A filing never changes once accepted (an amendment is a new filing), so parsed rows are cached by accession. */
export async function fetchFilingRows(f: SecFiling, fetcher: typeof fetch = fetch): Promise<PersonaTrade[]> {
  const cache = readCache();
  if (cache[f.accession]) return cache[f.accession];
  const res = await get(`/sec/www${rawDocPath(f)}`, fetcher);
  if (!res.ok) throw new Error(`SEC returned ${res.status} for ${f.form} ${f.accession}.`);
  const rows = parseFiling(await res.text(), f);
  writeCache({ ...readCache(), [f.accession]: rows });
  return rows;
}

export async function fetchSubmissions(cik: string, fetcher: typeof fetch = fetch): Promise<SecFiling[]> {
  const res = await get(`/sec/data/submissions/CIK${cik.replace(/^0+/, "").padStart(10, "0")}.json`, fetcher);
  if (!res.ok) throw new Error(res.status === 403 ? "SEC refused the request: check STOCKHUB_SEC_CONTACT." : `SEC returned ${res.status} for CIK ${cik}.`);
  return parseSubmissions(await res.json(), cik);
}

export interface LiveFeed {
  events: PersonaTrade[];
  checkedAt: string;
  fresh: Freshness;
  /** Newest 13F filing among the CIKs: the quarter-end view's own freshness. */
  last13F: { filed: string } | null;
  /** Filings listed in the window and how many could not be read. */
  listed: number;
  failed: number;
}

/** Recent insider and stake filings for a persona's CIKs, newest first, with the time they were checked. */
export async function fetchLiveFeed(ciks: string[], now = new Date(), fetcher: typeof fetch = fetch): Promise<LiveFeed> {
  const lists = await Promise.all(ciks.map((c) => fetchSubmissions(c, fetcher)));
  const all = lists.flat();
  const wanted = recentLive(all, now.toISOString());
  let failed = 0;
  const rows = await Promise.all(wanted.map((f) => fetchFilingRows(f, fetcher).catch(() => { failed++; return [] as PersonaTrade[]; })));
  const events = rows.flat();
  const l13 = latest13F(all.filter((f) => is13F(f.form)));
  return { events, checkedAt: now.toISOString(), fresh: freshness(events, now.toISOString()), last13F: l13 ? { filed: l13.filed } : null, listed: wanted.length, failed };
}
