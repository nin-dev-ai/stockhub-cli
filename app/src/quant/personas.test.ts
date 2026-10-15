import { describe, it, expect } from "vitest";
import { byRecency, customPersona, matchesPersona, normalizeTrade, PRESET_PERSONAS, summarize } from "./personas";

const P = Object.fromEntries(PRESET_PERSONAS.map((p) => [p.id, p]));
const row = (o: Record<string, unknown>) => normalizeTrade({
  chamber: "house", symbol: "NVDA", representative: "Nancy Pelosi", transaction_date: "2026-06-01", date: "2026-06-20",
  type: "Purchase", amount: "$1,000,001 - $5,000,000", owner: "Spouse", asset_description: "NVIDIA Corporation", url: "https://example.org/ptr.pdf", ...o,
});

describe("normalizeTrade", () => {
  it("maps a provider row, keeping the disclosed range and computing the disclosure lag", () => {
    expect(row({})).toEqual({
      filer: "Nancy Pelosi", chamber: "house", symbol: "NVDA", asset: "NVIDIA Corporation", side: "buy",
      amount: "$1,000,001 - $5,000,000", owner: "Spouse", tradeDate: "2026-06-01", disclosureDate: "2026-06-20", lagDays: 19, url: "https://example.org/ptr.pdf",
    });
  });
  it("tolerates other field names and missing values", () => {
    const t = normalizeTrade({ first_name: "Rohit", last_name: "Khanna", transactionDate: "2026-01-05", disclosureDate: "2026-02-01", transaction_type: "Sale (Partial)", ticker: "--" });
    expect(t).toMatchObject({ filer: "Rohit Khanna", side: "sell", symbol: null, asset: "Undisclosed asset", amount: "Not stated", owner: "Not stated", lagDays: 27, chamber: null, url: null });
  });
});

describe("matching", () => {
  it("matches filed name variants on last name plus a known first name", () => {
    expect(matchesPersona(row({ representative: "Hon. Nancy Pelosi" }), P.pelosi)).toBe(true);
    expect(matchesPersona(row({ representative: "Rohit Khanna" }), P.khanna)).toBe(true);
    expect(matchesPersona(row({ representative: "Paul Pelosi" }), P.pelosi)).toBe(false);
    expect(matchesPersona(row({ chamber: "senate" }), P.pelosi)).toBe(false);
  });
  it("builds a custom persona from a full name and refuses a single word", () => {
    expect(customPersona("Dan Crenshaw", "house")).toMatchObject({ id: "custom_dan_crenshaw", lastName: "crenshaw", firstNames: ["dan"], chamber: "house", custom: true });
    expect(customPersona("Crenshaw", "house")).toBeNull();
  });
  it("shows no trades for a persona without a feed", () => {
    expect(P.trump.chamber).toBeNull();
    expect(P.trump.note).toMatch(/Office of Government Ethics/);
  });
});

describe("summary", () => {
  it("counts sides, ranks tickers and takes the median lag", () => {
    const ts = [row({}), row({ symbol: "AAPL", type: "Sale", date: "2026-07-30" }), row({ date: "2026-06-11" })];
    expect(summarize(ts)).toEqual({ trades: 3, buys: 2, sells: 1, topSymbols: [{ symbol: "NVDA", count: 2 }, { symbol: "AAPL", count: 1 }], medianLagDays: 19, latestDisclosure: "2026-07-30" });
    expect([...ts].sort(byRecency).map((t) => t.disclosureDate)).toEqual(["2026-07-30", "2026-06-20", "2026-06-11"]);
  });
});
