/**
 * US House members' Periodic Transaction Reports (PTRs) from the Clerk of the House: free, official,
 * keyless. The Clerk publishes a yearly index of every financial disclosure filing (XML inside a ZIP)
 * and each PTR as a PDF. Electronically filed PTRs carry a text layer laid out as a table; paper
 * filings are scanned images and are listed, not parsed.
 *
 * Disclosure limits that every screen states: amounts are ranges, not values; a trade may be filed
 * up to 45 days after it happened; trades by a spouse or dependent child are included and labelled.
 */
import type { PersonaTrade } from "./personas";

export const CLERK_BASE = "https://disclosures-clerk.house.gov";
export const ptrPdfUrl = (year: number, docId: string) => `${CLERK_BASE}/public_disc/ptr-pdfs/${year}/${docId}.pdf`;
export const indexZipPath = (year: number) => `/public_disc/financial-pdfs/${year}FD.zip`;

export interface HouseFiling {
  docId: string;
  year: number;
  /** ISO date the report was filed: the first day the public could see it. */
  filed: string;
  first: string;
  last: string;
  suffix: string;
  /** e.g. "CA11". */
  stateDst: string;
  /** "P" is a Periodic Transaction Report; other codes are annual reports, amendments and so on. */
  filingType: string;
}

const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block);
  return m ? decodeXml(m[1].trim()) : "";
};
const decodeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** US-style M/D/YYYY to ISO; null when it is not a date. */
export function usDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Every filing in a yearly `<year>FD.xml` index. */
export function parseFdIndex(xml: string): HouseFiling[] {
  const out: HouseFiling[] = [];
  for (const m of xml.matchAll(/<Member>([\s\S]*?)<\/Member>/g)) {
    const b = m[1];
    const filed = usDate(tag(b, "FilingDate"));
    const docId = tag(b, "DocID"), year = Number(tag(b, "Year"));
    if (!filed || !docId || !Number.isFinite(year)) continue;
    out.push({ docId, year, filed, first: tag(b, "First"), last: tag(b, "Last"), suffix: tag(b, "Suffix"), stateDst: tag(b, "StateDst"), filingType: tag(b, "FilingType") });
  }
  return out;
}

/** Electronically filed PTRs (document ids starting with 2) carry text; others are scanned paper. */
export const isElectronic = (docId: string) => /^2\d{7}$/.test(docId);

export interface HouseMember { key: string; first: string; last: string; stateDst: string; ptrs: number }

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
export const memberKey = (last: string, first: string, stateDst: string) => `${norm(last)}|${norm(first).slice(0, 4)}|${stateDst.toUpperCase()}`;

/** Members with at least one PTR, for search; one entry per name and district. */
export function houseMembers(filings: HouseFiling[]): HouseMember[] {
  const m = new Map<string, HouseMember>();
  for (const f of filings) {
    if (f.filingType !== "P") continue;
    const key = memberKey(f.last, f.first, f.stateDst);
    const cur = m.get(key) ?? { key, first: f.first, last: f.last, stateDst: f.stateDst, ptrs: 0 };
    cur.ptrs++;
    m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
}

/** Search by last name, full name or district ("pelosi", "nancy pelosi", "CA11"). */
export function searchMembers(members: HouseMember[], q: string, limit = 12): HouseMember[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const dst = /^[a-z]{2}\d{1,2}$/.test(t) ? t.toUpperCase() : null;
  const words = t.split(/\s+/).map(norm).filter(Boolean);
  return members.filter((x) => (dst ? x.stateDst === dst : words.every((w) => norm(`${x.first} ${x.last}`).includes(w)))).slice(0, limit);
}

/** A member's PTRs, newest first. */
export function memberPtrs(filings: HouseFiling[], key: string): HouseFiling[] {
  return filings.filter((f) => f.filingType === "P" && memberKey(f.last, f.first, f.stateDst) === key)
    .sort((a, b) => b.filed.localeCompare(a.filed) || b.docId.localeCompare(a.docId));
}

// ---------------------------------------------------------------------------------------------
// PTR text layer

/** One positioned run of text from a PDF page (PDF coordinates: y grows upwards). */
export interface TextItem { str: string; x: number; y: number }

export interface PtrRow {
  owner: string;
  asset: string;
  ticker: string | null;
  /** Asset type code in brackets, e.g. ST (stock), OP (option), GS (government security). */
  assetType: string | null;
  /** P, S, S (partial) or E. */
  type: string;
  date: string | null;
  notified: string | null;
  amount: string;
  band: { low: number; high: number | null } | null;
  description: string;
}

type Col = "id" | "owner" | "asset" | "type" | "date" | "notified" | "amount" | "gains";
interface Header { y: number; cols: { col: Col; x: number }[] }

/** Locate the table header on a page from its column titles. */
function findHeader(items: TextItem[]): Header | null {
  const at = (s: string) => items.find((i) => i.str.trim() === s);
  const owner = at("Owner"), asset = at("Asset"), tx = at("Transaction"), amount = at("Amount");
  if (!owner || !asset || !tx || !amount) return null;
  const y = owner.y;
  const date = items.find((i) => i.str.trim() === "Date" && Math.abs(i.y - y) < 2);
  const notified = at("Notification");
  const gains = at("Cap.");
  const id = items.find((i) => i.str.trim() === "ID" && Math.abs(i.y - y) < 2);
  const cols: Header["cols"] = [
    ...(id ? [{ col: "id" as const, x: id.x }] : []),
    { col: "owner" as const, x: owner.x }, { col: "asset" as const, x: asset.x }, { col: "type" as const, x: tx.x },
    ...(date ? [{ col: "date" as const, x: date.x }] : []),
    ...(notified ? [{ col: "notified" as const, x: notified.x }] : []),
    { col: "amount" as const, x: amount.x },
    ...(gains ? [{ col: "gains" as const, x: gains.x }] : []),
  ].sort((a, b) => a.x - b.x);
  return { y, cols };
}

const colOf = (h: Header, x: number): Col | null => {
  let c: Col | null = null;
  for (const k of h.cols) if (x >= k.x - 4) c = k.col;
  return c;
};

const NUL = /\u0000/;
/** Sub-headings like "DESCRIPTION:" are drawn in a font with no text mapping, so they arrive garbled. */
const label = (s: string): { kind: "description" | "other"; rest: string } | null => {
  if (!NUL.test(s) || !s.includes(":")) return null;
  return { kind: s.trim().startsWith("D") ? "description" : "other", rest: s.slice(s.indexOf(":") + 1).trim() };
};

const money = (s: string) => Number(s.replace(/[$,\s]/g, ""));
/** "$1,001 - $15,000" → 1001..15000; "Over $50,000,000" → 50,000,001 and no upper bound. */
export function parseBand(s: string): PtrRow["band"] {
  const t = s.replace(/\s+/g, " ").trim();
  const over = /^over \$([\d,]+)/i.exec(t);
  if (over) return { low: money(over[1]) + 1, high: null };
  const m = /\$([\d,]+)\s*-\s*\$([\d,]+)/.exec(t);
  if (m) return { low: money(m[1]), high: money(m[2]) };
  return null;
}

const OWNER: Record<string, string> = { SP: "Spouse", JT: "Joint", DC: "Dependent child" };
export const ownerLabel = (code: string) => OWNER[code.trim().toUpperCase()] ?? (code.trim() ? code.trim() : "Self");

/**
 * Rebuild the transaction table from the text layer of every page. A row starts on the line that
 * holds a transaction date; the lines under it add to the asset name, the amount range and the
 * description until the next row. Rows continue across page breaks; text above each page's header
 * and everything after the table (footnote, certification) is ignored.
 */
export function parsePtr(pages: TextItem[][]): PtrRow[] {
  const rows: PtrRow[] = [];
  let header: Header | null = null;
  let cur: (PtrRow & { mode: "asset" | "description" | "other" }) | null = null;
  let done = false;
  const finish = () => {
    if (!cur) return;
    const { mode: _m, ...r } = cur;
    const asset = r.asset.replace(/\s+/g, " ").trim();
    const tk = /\(([A-Z][A-Z0-9.\-]{0,9})\)\s*(?:\[([A-Z]{2})\])?\s*$/.exec(asset) ?? /\(([A-Z][A-Z0-9.\-]{0,9})\)/.exec(asset);
    const at = /\[([A-Z]{2})\]\s*$/.exec(asset);
    rows.push({
      ...r,
      asset: asset.replace(/\s*\[[A-Z]{2}\]\s*$/, ""),
      ticker: tk ? tk[1] : null,
      assetType: at ? at[1] : null,
      amount: r.amount.replace(/\s+/g, " ").trim(),
      band: parseBand(r.amount),
      description: r.description.replace(/\s+/g, " ").trim(),
    });
    cur = null;
  };
  for (const page of pages) {
    if (done) break;
    header = findHeader(page) ?? header;
    if (!header) continue;
    const hy = findHeader(page)?.y ?? Infinity;
    // header titles take three lines; anything at or above them is page furniture
    const body = page.filter((i) => i.str.trim() && i.y < hy - 25).sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: TextItem[][] = [];
    for (const it of body) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last[0].y - it.y) < 2) last.push(it); else lines.push([it]);
    }
    for (const line of lines) {
      const cells: Partial<Record<Col, string>> = {};
      for (const it of line) { const c = colOf(header, it.x); if (c) cells[c] = cells[c] ? `${cells[c]} ${it.str}` : it.str; }
      const left = Math.min(...line.map((i) => i.x));
      const firstCol = header.cols.find((c) => c.col === "owner")!;
      // the table ends where text starts left of the owner column (footnote, certification)
      if (left < firstCol.x - 8 && !cells.date) { finish(); done = true; break; }
      const date = cells.date ? usDate(cells.date) : null;
      if (date) {
        finish();
        cur = { owner: ownerLabel(cells.owner ?? ""), asset: cells.asset ?? "", ticker: null, assetType: null, type: (cells.type ?? "").trim(), date, notified: cells.notified ? usDate(cells.notified) : null, amount: cells.amount ?? "", band: null, description: "", mode: "asset" };
        continue;
      }
      if (!cur) continue;
      if (cells.amount) cur.amount += ` ${cells.amount}`;
      const a = cells.asset;
      if (!a) continue;
      const l = label(a);
      if (l) { cur.mode = l.kind; if (l.kind === "description") cur.description += ` ${l.rest}`; continue; }
      if (cur.mode === "asset") cur.asset += ` ${a}`;
      else if (cur.mode === "description") cur.description += ` ${a}`;
    }
  }
  finish();
  return rows;
}

const TYPE: Record<string, { action: string; side: PersonaTrade["side"] }> = {
  P: { action: "Purchase", side: "buy" },
  S: { action: "Sale", side: "sell" },
  "S (PARTIAL)": { action: "Partial sale", side: "sell" },
  E: { action: "Exchange", side: "other" },
};
const ASSET_TYPE: Record<string, string> = { ST: "stock", OP: "options", GS: "government security", AB: "asset-backed", CS: "corporate bond", EF: "ETF", MF: "mutual fund", OT: "other" };

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
export const bandText = (b: PtrRow["band"], raw: string) => (b ? (b.high == null ? `over ${usd(b.low - 1)}` : `${usd(b.low)}–${usd(b.high)}`) : raw || "amount not stated");

/** PTR rows as persona trades: the amount stays a range in the detail; value, shares and price stay empty. */
export function ptrTrades(rows: PtrRow[], filing: HouseFiling): PersonaTrade[] {
  return rows.map((r) => {
    const t = TYPE[r.type.toUpperCase()] ?? { action: r.type || "Transaction", side: "other" as const };
    return {
      date: r.date, filed: filing.filed, symbol: r.ticker, asset: r.asset,
      side: t.side, action: `${t.action}${r.assetType === "OP" ? " (options)" : ""}`,
      shares: null, price: null, value: null,
      detail: [bandText(r.band, r.amount), r.owner, r.assetType ? ASSET_TYPE[r.assetType] ?? r.assetType : "", r.description].filter(Boolean).join(" · "),
      url: ptrPdfUrl(filing.year, filing.docId),
    };
  });
}

export const HOUSE_NOTE = "House members report trades over $1,000 on Periodic Transaction Reports within 45 days. Amounts are ranges, not values; trades by a spouse or dependent child are included and labelled. Scanned paper filings are linked but not read.";
