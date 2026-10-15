/**
 * Personas: public figures whose disclosed securities trades can be followed. Trades come from
 * official disclosure filings (STOCK Act periodic transaction reports) as published by the data
 * provider. Nothing here is generated: a persona with no feed shows no trades.
 */

export type Chamber = "house" | "senate";

export interface Persona {
  id: string;
  name: string;
  /** Short filing context, e.g. "House · D-CA". */
  role: string;
  /** Where the persona's filings are published; null when no connected feed carries them. */
  chamber: Chamber | null;
  /** Filings spell names differently ("Rohit Khanna", "Hon. Nancy Pelosi"); a trade matches on the last name plus any of these first names. */
  lastName: string;
  firstNames: string[];
  note?: string;
  /** Added by the user rather than preset. */
  custom?: boolean;
}

export const PRESET_PERSONAS: Persona[] = [
  { id: "pelosi", name: "Nancy Pelosi", role: "House · D-CA", chamber: "house", lastName: "pelosi", firstNames: ["nancy"],
    note: "Many disclosed trades are made by a spouse; the Owner column shows whose account traded." },
  { id: "khanna", name: "Ro Khanna", role: "House · D-CA", chamber: "house", lastName: "khanna", firstNames: ["ro", "rohit"] },
  { id: "gottheimer", name: "Josh Gottheimer", role: "House · D-NJ", chamber: "house", lastName: "gottheimer", firstNames: ["josh", "joshua"] },
  { id: "greene", name: "Marjorie Taylor Greene", role: "House · R-GA", chamber: "house", lastName: "greene", firstNames: ["marjorie"] },
  { id: "tuberville", name: "Tommy Tuberville", role: "Senate · R-AL", chamber: "senate", lastName: "tuberville", firstNames: ["tommy", "thomas"] },
  { id: "trump", name: "Donald Trump", role: "Executive branch", chamber: null, lastName: "trump", firstNames: ["donald"],
    note: "The President's transaction reports are filed with the Office of Government Ethics as PDF documents, not in the congressional disclosure feed, so no trades can be shown yet." },
];

export interface PersonaTrade {
  /** Name exactly as filed. */
  filer: string;
  chamber: Chamber | null;
  symbol: string | null;
  asset: string;
  side: "buy" | "sell" | "exchange" | "other";
  /** Disclosed value band, e.g. "$1,001 - $15,000"; filings give ranges, not exact amounts. */
  amount: string;
  owner: string;
  tradeDate: string | null;
  disclosureDate: string | null;
  /** Days between the trade and its public disclosure. */
  lagDays: number | null;
  url: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const day = (v: unknown): string | null => {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (str(o[k])) return o[k];
  return undefined;
};

function sideOf(t: string): PersonaTrade["side"] {
  const s = t.toLowerCase();
  if (/purchase|buy/.test(s)) return "buy";
  if (/sale|sell/.test(s)) return "sell";
  if (/exchange/.test(s)) return "exchange";
  return "other";
}

/** Map a provider row to a trade; field names differ between providers and versions. */
export function normalizeTrade(raw: Record<string, unknown>): PersonaTrade {
  const first = str(pick(raw, "first_name", "firstName")), last = str(pick(raw, "last_name", "lastName"));
  const filer = str(pick(raw, "representative", "office", "senator", "name")) || `${first} ${last}`.trim();
  const tradeDate = day(pick(raw, "transaction_date", "transactionDate"));
  const disclosureDate = day(pick(raw, "disclosure_date", "disclosureDate", "date"));
  const ch = str(raw.chamber).toLowerCase();
  const rawSym = str(pick(raw, "symbol", "ticker")).toUpperCase();
  const sym = rawSym && rawSym !== "--" && rawSym !== "N/A" ? rawSym : null;
  return {
    filer,
    chamber: ch === "house" || ch === "senate" ? ch : null,
    symbol: sym,
    asset: str(pick(raw, "asset_description", "assetDescription", "asset_name")) || sym || "Undisclosed asset",
    side: sideOf(str(pick(raw, "transaction_type", "type"))),
    amount: str(raw.amount) || "Not stated",
    owner: str(raw.owner) || "Not stated",
    tradeDate, disclosureDate,
    lagDays: tradeDate && disclosureDate ? Math.round((Date.parse(disclosureDate) - Date.parse(tradeDate)) / 864e5) : null,
    url: str(pick(raw, "url", "link", "ptr_link")) || null,
  };
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);

export function matchesPersona(t: PersonaTrade, p: Persona): boolean {
  if (p.chamber && t.chamber && t.chamber !== p.chamber) return false;
  const w = words(t.filer);
  return w.includes(p.lastName) && p.firstNames.some((f) => w.includes(f));
}

/** A persona the user adds by name: "Dan Crenshaw" → last name crenshaw, first name dan. */
export function customPersona(name: string, chamber: Chamber): Persona | null {
  const w = words(name);
  if (w.length < 2) return null;
  return {
    id: `custom_${w.join("_")}`, name: name.trim(), role: chamber === "house" ? "House" : "Senate", chamber,
    lastName: w[w.length - 1], firstNames: [w[0]], custom: true,
  };
}

export interface PersonaSummary {
  trades: number;
  buys: number;
  sells: number;
  /** Most frequently traded tickers in the loaded window, with counts. */
  topSymbols: { symbol: string; count: number }[];
  medianLagDays: number | null;
  latestDisclosure: string | null;
}

export function summarize(trades: PersonaTrade[]): PersonaSummary {
  const counts = new Map<string, number>();
  for (const t of trades) if (t.symbol) counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1);
  const lags = trades.map((t) => t.lagDays).filter((x): x is number => x != null && x >= 0).sort((a, b) => a - b);
  const dates = trades.map((t) => t.disclosureDate).filter((x): x is string => !!x).sort();
  return {
    trades: trades.length,
    buys: trades.filter((t) => t.side === "buy").length,
    sells: trades.filter((t) => t.side === "sell").length,
    topSymbols: [...counts.entries()].map(([symbol, count]) => ({ symbol, count })).sort((a, b) => b.count - a.count || (a.symbol < b.symbol ? -1 : 1)).slice(0, 5),
    medianLagDays: lags.length ? lags[Math.floor((lags.length - 1) / 2)] : null,
    latestDisclosure: dates[dates.length - 1] ?? null,
  };
}

/** Newest disclosure first, then newest trade. */
export const byRecency = (a: PersonaTrade, b: PersonaTrade) =>
  (b.disclosureDate ?? "").localeCompare(a.disclosureDate ?? "") || (b.tradeDate ?? "").localeCompare(a.tradeDate ?? "");
