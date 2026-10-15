/**
 * Personas: people whose trades are published in free, public SEC EDGAR filings, read through the
 * local OpenBB API with no key.
 *  - Fund managers file Form 13F: quarter-end holdings of their firm. Trades are inferred by
 *    comparing the latest two quarters (new, added, trimmed, sold out).
 *  - Corporate insiders file Form 4 within two business days of trading their company's stock,
 *    with exact shares and prices.
 * Nothing here is generated: a persona whose filings return nothing shows nothing.
 */

export type PersonaSource =
  | { kind: "fund"; cik: string; firm: string }
  | { kind: "insider"; symbol: string; company: string };

export interface Persona {
  id: string;
  name: string;
  /** Short context, e.g. "Berkshire Hathaway · 13F". */
  role: string;
  source: PersonaSource;
  /** Insiders: Form 4 lists names as "Zuckerberg Mark"; a filing matches on the last name plus any of these first names. */
  lastName?: string;
  firstNames?: string[];
  note?: string;
  custom?: boolean;
}

const fund = (id: string, name: string, firm: string, cik: string, note?: string): Persona =>
  ({ id, name, role: `${firm} · 13F`, source: { kind: "fund", cik, firm }, note });
const insider = (id: string, name: string, company: string, symbol: string, lastName: string, firstNames: string[], note?: string): Persona =>
  ({ id, name, role: `${company} (${symbol}) · Form 4`, source: { kind: "insider", symbol, company }, lastName, firstNames, note });

export const FUND_NOTE = "13F shows the firm's US long holdings at each quarter end, filed up to 45 days later. Changes between quarters are inferred, not individual trades, and exclude shorts, cash and most non-US assets.";

export const PRESET_PERSONAS: Persona[] = [
  fund("buffett", "Warren Buffett", "Berkshire Hathaway", "0001067983", "Berkshire's holdings are also managed by its other investment managers."),
  fund("ackman", "Bill Ackman", "Pershing Square", "0001336528"),
  fund("wood", "Cathie Wood", "ARK Investment Management", "0001697748", "ARK's 13F combines all of its ETFs and accounts."),
  fund("druckenmiller", "Stanley Druckenmiller", "Duquesne Family Office", "0001536411"),
  fund("tepper", "David Tepper", "Appaloosa", "0001656456"),
  fund("li_lu", "Li Lu", "Himalaya Capital", "0001709323"),
  fund("burry", "Michael Burry", "Scion Asset Management", "0001649339", "Check the period date: Scion's most recent 13F may be old."),
  insider("huang", "Jensen Huang", "NVIDIA", "NVDA", "huang", ["jen", "jensen"]),
  insider("zuckerberg", "Mark Zuckerberg", "Meta Platforms", "META", "zuckerberg", ["mark"], "Many sales are pre-scheduled under a Rule 10b5-1 plan, often through his foundation's entities."),
  insider("musk", "Elon Musk", "Tesla", "TSLA", "musk", ["elon"]),
  insider("bezos", "Jeff Bezos", "Amazon", "AMZN", "bezos", ["jeffrey", "jeff"]),
];

export interface PersonaTrade {
  /** Insiders: transaction date. Funds: the quarter end the change was observed at. */
  date: string | null;
  /** Insiders: filing date. Funds: null (the endpoint does not return it). */
  filed: string | null;
  symbol: string | null;
  asset: string;
  side: "buy" | "sell" | "other";
  /** e.g. "Open-market sale", "New position", "Trimmed". */
  action: string;
  shares: number | null;
  price: number | null;
  value: number | null;
  detail: string;
  url: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const day = (v: unknown): string | null => { const s = str(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const words = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------------------------
// Form 4

/** Short labels for Form 4 transaction codes as OpenBB words them. */
function insiderAction(type: string, acquired: boolean): { action: string; side: PersonaTrade["side"] } {
  const t = type.toLowerCase();
  if (/open market|private (purchase|sale)/.test(t)) return acquired ? { action: "Open-market purchase", side: "buy" } : { action: "Open-market sale", side: "sell" };
  if (/grant|award/.test(t)) return { action: "Grant or award", side: "other" };
  if (/tax|withh/.test(t)) return { action: "Tax withholding", side: "other" };
  if (/exercise|conversion/.test(t)) return { action: "Option exercise", side: "other" };
  if (/gift/.test(t)) return { action: "Gift", side: "other" };
  return { action: type || (acquired ? "Acquisition" : "Disposition"), side: "other" };
}

export function normalizeInsider(raw: Record<string, unknown>): PersonaTrade & { owner: string } {
  const acquired = /^a/i.test(str(raw.acquisition_or_disposition));
  const { action, side } = insiderAction(str(raw.transaction_type), acquired);
  const shares = num(raw.securities_transacted), price = num(raw.transaction_price);
  const symbol = str(raw.symbol).toUpperCase() || null;
  const owned = num(raw.securities_owned);
  return {
    owner: str(raw.owner_name),
    date: day(raw.transaction_date), filed: day(raw.filing_date),
    symbol, asset: `${str(raw.company_name) || symbol || "Unknown issuer"} · ${str(raw.security_type) || "security"}`,
    side, action,
    shares, price: price && price > 0 ? price : null,
    value: shares != null && price && price > 0 ? shares * price : null,
    detail: [str(raw.owner_title), str(raw.ownership_type) === "Indirect" ? "indirect holding" : "", owned != null ? `${Math.round(owned).toLocaleString("en-US")} held after` : ""].filter(Boolean).join(" · "),
    url: str(raw.filing_url) || null,
  };
}

export function matchesInsider(owner: string, p: Persona): boolean {
  const w = words(owner);
  return !!p.lastName && w.includes(p.lastName) && (p.firstNames ?? []).some((f) => w.includes(f));
}

// ---------------------------------------------------------------------------------------------
// 13F

interface Holding { issuer: string; cusip: string; shares: number; value: number; weight: number }

function holdingsByPeriod(rows: Record<string, unknown>[]): Map<string, Map<string, Holding>> {
  const out = new Map<string, Map<string, Holding>>();
  for (const r of rows) {
    const period = day(r.period_ending), cusip = str(r.cusip);
    if (!period || !cusip) continue;
    // a firm can report one security on several rows (managers, discretion); options get their own key
    const key = [cusip, str(r.security_type), str(r.option_type ?? r.put_call)].join("|");
    const m = out.get(period) ?? new Map<string, Holding>();
    // share classes of one issuer (Alphabet A and C) are separate holdings; name the class so they read apart
    const cls = /\bCL(?:ASS)?\s+([A-Z])\b/i.exec(str(r.asset_class))?.[1]?.toUpperCase();
    const opt = str(r.option_type ?? r.put_call);
    const h = m.get(key) ?? { issuer: str(r.issuer) + (cls ? ` Class ${cls}` : "") + (opt ? ` (${opt})` : ""), cusip, shares: 0, value: 0, weight: 0 };
    h.shares += num(r.principal_amount) ?? 0;
    h.value += num(r.value) ?? 0;
    h.weight += num(r.weight) ?? 0;
    m.set(key, h);
    out.set(period, m);
  }
  return out;
}

const pctTxt = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Position changes between the two most recent quarters in the rows. */
export function fundChanges(rows: Record<string, unknown>[], cik: string): { latest: string | null; prior: string | null; trades: PersonaTrade[]; holdings: number } {
  const byPeriod = holdingsByPeriod(rows);
  const periods = [...byPeriod.keys()].sort();
  const latest = periods[periods.length - 1] ?? null, prior = periods[periods.length - 2] ?? null;
  if (!latest) return { latest: null, prior: null, trades: [], holdings: 0 };
  const now = byPeriod.get(latest)!, before = prior ? byPeriod.get(prior)! : new Map<string, Holding>();
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=13F-HR&dateb=&owner=include&count=40`;
  const trades: PersonaTrade[] = [];
  if (prior) {
    for (const [k, h] of now) {
      const b = before.get(k);
      const delta = h.shares - (b?.shares ?? 0);
      if (b && Math.abs(delta) < 1) continue;
      const action = !b ? "New position" : delta > 0 ? "Added" : "Trimmed";
      trades.push({
        date: latest, filed: null, symbol: null, asset: h.issuer, side: delta > 0 ? "buy" : "sell", action,
        shares: delta, price: null, value: h.value,
        detail: `${b ? `${delta > 0 ? "+" : ""}${pctTxt(delta / b.shares)} shares · ` : ""}${pctTxt(h.weight)} of portfolio`, url,
      });
    }
    for (const [k, b] of before) if (!now.has(k)) {
      trades.push({ date: latest, filed: null, symbol: null, asset: b.issuer, side: "sell", action: "Sold out", shares: -b.shares, price: null, value: 0, detail: `was ${pctTxt(b.weight)} of portfolio`, url });
    }
  }
  // biggest moves first within the quarter
  trades.sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0));
  return { latest, prior, trades, holdings: now.size };
}

// ---------------------------------------------------------------------------------------------

/** A persona the user adds: a fund by its SEC CIK, or an insider by ticker and full name. */
export function customFund(name: string, cik: string): Persona | null {
  const digits = cik.replace(/\D/g, "");
  if (!name.trim() || digits.length < 4 || digits.length > 10) return null;
  const padded = digits.padStart(10, "0");
  return { ...fund(`custom_fund_${padded}`, name.trim(), name.trim(), padded), role: `CIK ${padded} · 13F`, custom: true };
}

export function customInsider(name: string, symbol: string): Persona | null {
  const w = words(name), sym = symbol.trim().toUpperCase();
  if (w.length < 2 || !/^[A-Z][A-Z.]{0,5}$/.test(sym)) return null;
  return { ...insider(`custom_insider_${sym.toLowerCase()}_${w.join("_")}`, name.trim(), sym, sym, w[w.length - 1], [w[0]]), custom: true };
}

export interface PersonaSummary {
  trades: number;
  buys: number;
  sells: number;
  topAssets: { asset: string; count: number }[];
  latest: string | null;
}

export function summarize(trades: PersonaTrade[]): PersonaSummary {
  const counts = new Map<string, number>();
  for (const t of trades) { const k = t.symbol ?? t.asset; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const dates = trades.map((t) => t.date).filter((x): x is string => !!x).sort();
  return {
    trades: trades.length,
    buys: trades.filter((t) => t.side === "buy").length,
    sells: trades.filter((t) => t.side === "sell").length,
    topAssets: [...counts.entries()].map(([asset, count]) => ({ asset, count })).sort((a, b) => b.count - a.count || (a.asset < b.asset ? -1 : 1)).slice(0, 3),
    latest: dates[dates.length - 1] ?? null,
  };
}

export const byRecency = (a: PersonaTrade, b: PersonaTrade) =>
  (b.date ?? "").localeCompare(a.date ?? "") || (b.filed ?? "").localeCompare(a.filed ?? "");

/** People whose trades have no free public API; named so the Copilot can say why. */
export const UNAVAILABLE_PEOPLE: Record<string, string> = {
  pelosi: "Nancy Pelosi", trump: "Donald Trump", tuberville: "Tommy Tuberville", khanna: "Ro Khanna", gottheimer: "Josh Gottheimer", greene: "Marjorie Taylor Greene", crenshaw: "Dan Crenshaw",
};
export const POLITICIAN_NOTE = "Politicians' trades are not available: congressional disclosures have no free public API (the free Stock Watcher datasets are offline and other feeds need a paid key), and the President's reports are PDFs filed with the Office of Government Ethics.";
