/**
 * Live SEC filings for personas (docs/PRD_phase4.md). The EDGAR submissions API lists every filing a
 * person or firm is named in with its acceptance time to the second; Form 3/4/5 (insider and 10%
 * owner trades) and Schedule 13D/G (stakes above 5%) are parsed from their XML. Both are fresher than
 * the quarterly 13F: Form 4 within two business days, 13D/G within days.
 *
 * Pure parsing only; lib/edgar.ts does the fetching through the /sec proxy.
 */
import type { PersonaTrade } from "./personas";

export interface SecFiling {
  accession: string;
  form: string;
  /** Filing date, ISO. */
  filed: string;
  /** Acceptance time, ISO with seconds, UTC. */
  accepted: string;
  /** Primary document as listed, usually under an xsl folder (the HTML view). */
  doc: string;
  /** The CIK whose list this filing came from. */
  cik: string;
}

export const WINDOW_DAYS = 120;
export const MAX_FILINGS = 30;

/** Insider forms and large-holder schedules; 13F is tracked separately for the quarter-end view. */
export const isInsiderForm = (f: string) => /^[345](\/A)?$/.test(f);
export const isStakeForm = (f: string) => /^(SC|SCHEDULE) 13[DG](\/A)?$/.test(f);
export const is13F = (f: string) => /^13F-HR(\/A)?$/.test(f);

/** `data.sec.gov/submissions/CIK##########.json` → filings (most recent first as listed). */
export function parseSubmissions(raw: unknown, cik: string): SecFiling[] {
  const r = (raw as { filings?: { recent?: Record<string, string[]> } })?.filings?.recent;
  if (!r?.accessionNumber) return [];
  return r.accessionNumber.map((accession, i) => ({
    accession, form: r.form[i], filed: r.filingDate[i], accepted: normalizeAccepted(r.acceptanceDateTime?.[i], r.filingDate[i]),
    doc: r.primaryDocument?.[i] ?? "", cik: cik.replace(/^0+/, ""),
  }));
}

const normalizeAccepted = (a: string | undefined, filed: string) => (a ? a.replace(/\.\d+Z?$/, "").replace(/Z$/, "") + "Z" : `${filed}T00:00:00Z`);

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

/** Filings of the live kinds inside the window, de-duplicated across CIKs (one Form 4 names several owners), newest first, capped. */
export function recentLive(filings: SecFiling[], now: string, windowDays = WINDOW_DAYS, cap = MAX_FILINGS): SecFiling[] {
  const seen = new Set<string>();
  return filings
    .filter((f) => (isInsiderForm(f.form) || isStakeForm(f.form)) && daysBetween(f.accepted, now) <= windowDays)
    .sort((a, b) => b.accepted.localeCompare(a.accepted))
    .filter((f) => !seen.has(f.accession) && !!seen.add(f.accession))
    .slice(0, cap);
}

/** The newest 13F filing, for the "quarter-end portfolio filed on" line. */
export const latest13F = (filings: SecFiling[]) => filings.filter((f) => is13F(f.form)).sort((a, b) => b.filed.localeCompare(a.filed))[0] ?? null;

const accNo = (a: string) => a.replace(/-/g, "");
/** Human-viewable filing document (the SEC's HTML rendering). */
export const filingUrl = (f: SecFiling) => `https://www.sec.gov/Archives/edgar/data/${f.cik}/${accNo(f.accession)}/${f.doc}`;
/** Raw XML path for parsing: the listed document without its xsl rendering folder. */
export const rawDocPath = (f: SecFiling) => `/Archives/edgar/data/${f.cik}/${accNo(f.accession)}/${f.doc.replace(/^xsl[^/]*\//, "")}`;

// ---------------------------------------------------------------------------------------------
// XML helpers (regex, so they run the same in the browser and under test)

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const one = (xml: string, tag: string) => { const m = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(xml); return m ? decode(m[1]) : ""; };
const val = (xml: string, tag: string) => { const m = new RegExp(`<${tag}>[\\s\\S]*?<value>\\s*([^<]*?)\\s*</value>`).exec(xml); return m ? decode(m[1]) : ""; };
const blocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
const all = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, "g"))].map((m) => decode(m[1]));
const num = (s: string) => { const n = Number(s.replace(/,/g, "")); return s.trim() !== "" && Number.isFinite(n) ? n : null; };
const usDate = (s: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim()); return m ? `${m[3]}-${m[1]}-${m[2]}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };

// ---------------------------------------------------------------------------------------------
// Form 3 / 4 / 5

const CODE: Record<string, { action: string; side: PersonaTrade["side"] }> = {
  P: { action: "Open-market purchase", side: "buy" }, S: { action: "Open-market sale", side: "sell" },
  A: { action: "Grant or award", side: "other" }, M: { action: "Option exercise", side: "other" }, X: { action: "Option exercise", side: "other" },
  F: { action: "Tax withholding", side: "other" }, G: { action: "Gift", side: "other" }, C: { action: "Conversion", side: "other" },
  D: { action: "Sale back to the issuer", side: "other" }, J: { action: "Other disposition or acquisition", side: "other" },
  K: { action: "Equity swap", side: "other" }, W: { action: "Will or inheritance", side: "other" }, I: { action: "Discretionary transaction", side: "other" },
  L: { action: "Small acquisition", side: "other" }, U: { action: "Tender of shares", side: "other" }, Z: { action: "Trust deposit or withdrawal", side: "other" },
};

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Transactions in a Form 4 (or 5), with lines of one kind on one day summed; a Form 3 is an initial holdings statement and gives a single "holdings" row. */
export function parseForm4(xml: string, f: SecFiling): PersonaTrade[] {
  const issuer = decode(one(xml, "issuerName")), symbol = one(xml, "issuerTradingSymbol").toUpperCase() || null;
  const owners = all(xml, "rptOwnerName");
  const role = [
    /<isDirector>(1|true)<\/isDirector>/.test(xml) ? "director" : "", one(xml, "officerTitle") || (/<isOfficer>(1|true)<\/isOfficer>/.test(xml) ? "officer" : ""),
    /<isTenPercentOwner>(1|true)<\/isTenPercentOwner>/.test(xml) ? "10% owner" : "",
  ].filter(Boolean).join(", ");
  const plan = /<aff10b5One>(1|true)<\/aff10b5One>/.test(xml) ? "10b5-1 plan" : "";
  const url = filingUrl(f);
  const base = { filed: f.filed, accepted: f.accepted, form: f.form, symbol, url };

  if (f.form.startsWith("3")) {
    return [{ ...base, date: usDate(one(xml, "periodOfReport")) ?? f.filed, asset: `${issuer} · initial holdings`, side: "other", action: "Initial holdings (Form 3)", shares: null, price: null, value: null, detail: [owners.join(", "), role].filter(Boolean).join(" · ") }];
  }

  type Line = { date: string; code: string; title: string; derivative: boolean; acquired: boolean; shares: number; value: number; after: number | null; indirect: boolean };
  const lines: Line[] = [];
  for (const [tag, derivative] of [["nonDerivativeTransaction", false], ["derivativeTransaction", true]] as const) {
    for (const b of blocks(xml, tag)) {
      const code = one(b, "transactionCode");
      const shares = num(val(b, derivative ? "transactionShares" : "transactionShares")) ?? num(val(b, "underlyingSecurityShares")) ?? 0;
      const price = num(val(b, "transactionPricePerShare")) ?? 0;
      lines.push({
        date: val(b, "transactionDate"), code, title: val(b, "securityTitle"), derivative,
        acquired: val(b, "transactionAcquiredDisposedCode") === "A", shares, value: shares * price, after: num(val(b, "sharesOwnedFollowingTransaction")),
        indirect: val(b, "directOrIndirectOwnership") === "I",
      });
    }
  }
  const groups = new Map<string, Line[]>();
  for (const l of lines) { const k = [l.date, l.code, l.title, l.derivative, l.indirect].join("|"); groups.set(k, [...(groups.get(k) ?? []), l]); }
  return [...groups.values()].map((g) => {
    const first = g[0], shares = g.reduce((s, l) => s + l.shares, 0), value = g.reduce((s, l) => s + l.value, 0);
    const c = CODE[first.code] ?? { action: first.code ? `Code ${first.code}` : "Transaction", side: "other" as const };
    const side = first.derivative ? "other" : c.side;
    const sign = first.acquired ? 1 : -1;
    return {
      ...base, date: first.date || f.filed, asset: `${issuer} · ${first.title || "security"}${first.derivative ? " (derivative)" : ""}`,
      side, action: first.derivative && c.side !== "other" ? `${c.action} (derivative)` : c.action,
      shares: sign * shares, price: shares > 0 && value > 0 ? value / shares : null, value: value > 0 ? value : null,
      detail: [owners.length > 1 ? owners.join(" and ") : "", role, first.indirect ? "indirect holding" : "", first.after != null ? `${Math.round(first.after).toLocaleString("en-US")} held after` : "", plan, g.length > 1 ? `${g.length} lines` : ""].filter(Boolean).join(" · "),
    } satisfies PersonaTrade;
  });
}

// ---------------------------------------------------------------------------------------------
// Schedule 13D / 13G

/**
 * A 13D or 13G (or amendment) is a statement of a stake above 5%. One row: the issuer, the largest
 * beneficial holding named in the filing (subsidiaries repeat their parent's number), its percent of
 * the class and the event date. It is not a trade, so it carries `category: "stake"` and no side.
 */
export function parseStake(xml: string, f: SecFiling): PersonaTrade[] {
  const issuer = decode(one(xml, "issuerName")) || "Unknown issuer";
  const cls = one(xml, "securitiesClassTitle");
  const shares = [...all(xml, "reportingPersonBeneficiallyOwnedAggregateNumberOfShares"), ...all(xml, "aggregateAmountOwned")].map((s) => num(s)).filter((n): n is number => n != null);
  const pcts = [...all(xml, "classPercent"), ...all(xml, "percentOfClass")].map((s) => num(s)).filter((n): n is number => n != null);
  const event = usDate(one(xml, "eventDateRequiresFilingThisStatement") || one(xml, "dateOfEvent"));
  const amend = one(xml, "amendmentNo");
  const kind = /13D/.test(f.form) ? "13D" : "13G";
  const names = [...new Set(all(xml, "reportingPersonName"))];
  const top = shares.length ? Math.max(...shares) : null, pct = pcts.length ? Math.max(...pcts) : null;
  return [{
    date: event ?? f.filed, filed: f.filed, accepted: f.accepted, form: f.form, category: "stake", symbol: null,
    asset: `${issuer}${cls ? ` · ${cls}` : ""}`, side: "other", action: `Stake report (${kind}${/\/A$/.test(f.form) ? ` amendment${amend ? ` ${amend}` : ""}` : ""})`,
    shares: top, price: null, value: null,
    detail: [pct != null ? `${pct}% of the class` : "", top != null ? `${Math.round(top).toLocaleString("en-US")} shares` : "", names.length ? `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}` : ""].filter(Boolean).join(" · "),
    url: filingUrl(f),
  }];
}

export const parseFiling = (xml: string, f: SecFiling): PersonaTrade[] => (isStakeForm(f.form) ? parseStake(xml, f) : parseForm4(xml, f));

// ---------------------------------------------------------------------------------------------
// Freshness

export interface Freshness {
  checkedAt: string;
  newestAccepted: string | null;
  newestForm: string | null;
  /** Whole hours, days or minutes since the newest filing, as text. */
  age: string | null;
}

export function ageText(from: string, now: string): string {
  const m = Math.max(0, Math.round((Date.parse(now) - Date.parse(from)) / 60000));
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

export function freshness(events: PersonaTrade[], now: string): Freshness {
  const newest = events.filter((e) => e.accepted).sort((a, b) => b.accepted!.localeCompare(a.accepted!))[0];
  return { checkedAt: now, newestAccepted: newest?.accepted ?? null, newestForm: newest?.form ?? null, age: newest?.accepted ? ageText(newest.accepted, now) : null };
}
