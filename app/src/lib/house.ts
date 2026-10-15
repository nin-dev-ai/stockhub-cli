import { strFromU8, unzipSync } from "fflate";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  indexZipPath, isElectronic, memberPtrs, parseFdIndex, parsePtr, ptrPdfUrl, ptrTrades,
  type HouseFiling, type PtrRow,
} from "@/quant/congress";
import { pdfTextItems } from "@/quant/pdfText";
import type { PersonaTrade } from "@/quant/personas";

/**
 * House Clerk data through the `/clerk` Vite proxy (the Clerk sends no CORS headers). The yearly
 * index is cached for 12 hours; a parsed PTR never changes (amendments get a new document id), so it
 * is cached by id without expiry.
 */
const INDEX_KEY = "stockhub-house-index-v1";
const PTR_KEY = "stockhub-house-ptr-v1";
const INDEX_TTL = 12 * 3600_000;
/** Newest reports read per member; older ones are listed by count only. */
export const MAX_PTRS = 24;

const read = <T,>(k: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? fallback; } catch { return fallback; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota: run uncached */ } };

/** Periodic Transaction Reports in one year's index; a year with no index yet gives none. */
export async function fetchHouseIndex(year: number): Promise<HouseFiling[]> {
  const cache = read<Record<string, { at: number; filings: HouseFiling[] }>>(INDEX_KEY, {});
  const hit = cache[year];
  if (hit && Date.now() - hit.at < INDEX_TTL) return hit.filings;
  const res = await fetch(`/clerk${indexZipPath(year)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`The House Clerk returned ${res.status} for the ${year} index.`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()), { filter: (f) => f.name.toLowerCase().endsWith(".xml") });
  const xml = Object.values(files)[0];
  if (!xml) throw new Error(`The ${year} index archive has no XML file.`);
  const filings = parseFdIndex(strFromU8(xml)).filter((f) => f.filingType === "P");
  write(INDEX_KEY, { ...read(INDEX_KEY, {}), [year]: { at: Date.now(), filings } });
  return filings;
}

/** This year's and last year's reports: the window the Personas screen shows. */
export async function fetchRecentHouseFilings(now = new Date()): Promise<HouseFiling[]> {
  const y = now.getFullYear();
  const [a, b] = await Promise.all([fetchHouseIndex(y), fetchHouseIndex(y - 1)]);
  return [...a, ...b];
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
const loadPdfjs = () => (pdfjsPromise ??= import("pdfjs-dist").then((m) => { m.GlobalWorkerOptions.workerSrc = workerUrl; return m; }));

export async function fetchPtrRows(f: HouseFiling): Promise<PtrRow[]> {
  const cache = read<Record<string, PtrRow[]>>(PTR_KEY, {});
  if (cache[f.docId]) return cache[f.docId];
  const res = await fetch(`/clerk/public_disc/ptr-pdfs/${f.year}/${f.docId}.pdf`);
  if (!res.ok) throw new Error(`The House Clerk returned ${res.status} for report ${f.docId}.`);
  const pages = await pdfTextItems(new Uint8Array(await res.arrayBuffer()), await loadPdfjs());
  const rows = parsePtr(pages);
  write(PTR_KEY, { ...read(PTR_KEY, {}), [f.docId]: rows });
  return rows;
}

export interface HouseMemberData {
  trades: PersonaTrade[];
  /** Reports found in the window, read or not. */
  reports: number;
  /** Paper filings (scanned images) and reports that could not be read, linked for the user. */
  unread: { docId: string; filed: string; url: string; reason: "scanned" | "failed" | "older" }[];
  latestFiled: string | null;
}

/** A member's trades from their newest reports; scanned or failing reports are listed, never guessed. */
export async function fetchHouseMember(key: string): Promise<HouseMemberData> {
  const ptrs = memberPtrs(await fetchRecentHouseFilings(), key);
  const out: HouseMemberData = { trades: [], reports: ptrs.length, unread: [], latestFiled: ptrs[0]?.filed ?? null };
  const queue = ptrs.slice(0, MAX_PTRS);
  for (const f of ptrs.slice(MAX_PTRS)) out.unread.push({ docId: f.docId, filed: f.filed, url: ptrPdfUrl(f.year, f.docId), reason: "older" });
  // a few at a time keeps the Clerk's server and the PDF worker from being flooded
  for (let i = 0; i < queue.length; i += 3) {
    await Promise.all(queue.slice(i, i + 3).map(async (f) => {
      if (!isElectronic(f.docId)) { out.unread.push({ docId: f.docId, filed: f.filed, url: ptrPdfUrl(f.year, f.docId), reason: "scanned" }); return; }
      try { out.trades.push(...ptrTrades(await fetchPtrRows(f), f)); }
      catch { out.unread.push({ docId: f.docId, filed: f.filed, url: ptrPdfUrl(f.year, f.docId), reason: "failed" }); }
    }));
  }
  out.unread.sort((a, b) => b.filed.localeCompare(a.filed));
  return out;
}
