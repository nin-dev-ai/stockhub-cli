import { describe, it, expect } from "vitest";
import { byRecency, customFund, customInsider, fundChanges, matchesInsider, normalizeInsider, PRESET_PERSONAS, summarize } from "./personas";

const P = Object.fromEntries(PRESET_PERSONAS.map((p) => [p.id, p]));
const form4 = (o: Record<string, unknown>) => normalizeInsider({
  symbol: "NVDA", company_name: "NVIDIA CORP", filing_date: "2026-09-12", transaction_date: "2026-09-10", owner_name: "HUANG JEN HSUN",
  owner_title: "President and CEO", ownership_type: "Indirect", transaction_type: "Open market or private sale", acquisition_or_disposition: "Disposition",
  security_type: "Common Stock", securities_owned: 70000000, securities_transacted: 50000, transaction_price: 180.5, filing_url: "https://www.sec.gov/x.xml", ...o,
});
const h = (period: string, cusip: string, issuer: string, shares: number, value: number, weight: number) =>
  ({ period_ending: period, cusip, issuer, security_type: "SH", principal_amount: shares, value, weight });

describe("Form 4", () => {
  it("normalizes an open-market sale with exact shares, price and value", () => {
    const t = form4({});
    expect(t).toMatchObject({ owner: "HUANG JEN HSUN", date: "2026-09-10", filed: "2026-09-12", symbol: "NVDA", side: "sell", action: "Open-market sale", shares: 50000, price: 180.5, value: 9025000, url: "https://www.sec.gov/x.xml" });
    expect(t.detail).toBe("President and CEO · indirect holding · 70,000,000 held after");
  });
  it("labels grants and tax withholding as other, with no price", () => {
    expect(form4({ transaction_type: "Grant, award or other acquisition pursuant to Rule 16b-3(d)", acquisition_or_disposition: "Acquisition", transaction_price: 0 }))
      .toMatchObject({ side: "other", action: "Grant or award", price: null, value: null });
    expect(form4({ transaction_type: "Payment of exercise price or tax liability by delivering or withholding securities" }).action).toBe("Tax withholding");
    expect(form4({ acquisition_or_disposition: "Acquisition" })).toMatchObject({ side: "buy", action: "Open-market purchase" });
  });
  it("matches the filer on last name plus a known first name", () => {
    expect(matchesInsider("HUANG JEN HSUN", P.huang)).toBe(true);
    expect(matchesInsider("Zuckerberg Mark", P.zuckerberg)).toBe(true);
    expect(matchesInsider("Huang Lisa", P.huang)).toBe(false);
  });
});

describe("13F changes", () => {
  const rows = [
    h("2026-03-31", "A", "APPLE INC", 100, 20000, 0.5), h("2026-03-31", "B", "BANK CORP", 50, 5000, 0.2), h("2026-03-31", "C", "COKE CO", 10, 700, 0.1),
    h("2026-06-30", "A", "APPLE INC", 80, 18000, 0.4), h("2026-06-30", "A", "APPLE INC", 0, 0, 0), h("2026-06-30", "C", "COKE CO", 10, 750, 0.1),
    h("2026-06-30", "D", "DATA INC", 30, 9000, 0.3),
  ];
  it("infers new, trimmed and sold-out positions between the latest two quarters and skips unchanged ones", () => {
    const f = fundChanges(rows, "0001067983");
    expect(f.latest).toBe("2026-06-30");
    expect(f.prior).toBe("2026-03-31");
    expect(f.holdings).toBe(3);
    expect(f.trades.map((t) => [t.asset, t.action, t.shares, t.side])).toEqual([
      ["APPLE INC", "Trimmed", -20, "sell"], ["DATA INC", "New position", 30, "buy"], ["BANK CORP", "Sold out", -50, "sell"],
    ]);
    expect(f.trades[0].detail).toBe("-20.0% shares · 40.0% of portfolio");
    expect(f.trades[0].url).toMatch(/CIK=0001067983&type=13F-HR/);
  });
  it("names the share class so two classes of one issuer read apart", () => {
    const cls = [
      { ...h("2026-03-31", "GA", "ALPHABET INC", 10, 100, 0.1), asset_class: "CAP STK CL A" }, { ...h("2026-03-31", "GC", "ALPHABET INC", 10, 100, 0.1), asset_class: "CAP STK CL C" },
      { ...h("2026-06-30", "GA", "ALPHABET INC", 20, 200, 0.1), asset_class: "CAP STK CL A" }, { ...h("2026-06-30", "GC", "ALPHABET INC", 5, 50, 0.1), asset_class: "CAP STK CL C" },
    ];
    expect(fundChanges(cls, "1").trades.map((t) => t.asset).sort()).toEqual(["ALPHABET INC Class A", "ALPHABET INC Class C"]);
  });
  it("shows no changes with only one quarter", () => {
    expect(fundChanges(rows.filter((r) => r.period_ending === "2026-06-30"), "1").trades).toEqual([]);
  });
});

describe("custom personas and summary", () => {
  it("adds a fund by CIK and an insider by ticker and name, rejecting bad input", () => {
    expect(customFund("Seth Klarman", "1061768")).toMatchObject({ id: "custom_fund_0001061768", source: { kind: "fund", cik: "0001061768" }, custom: true });
    expect(customFund("", "1061768")).toBeNull();
    expect(customInsider("Tim Cook", "aapl")).toMatchObject({ source: { kind: "insider", symbol: "AAPL" }, lastName: "cook", firstNames: ["tim"] });
    expect(customInsider("Cook", "AAPL")).toBeNull();
  });
  it("counts sides, ranks assets and sorts newest first", () => {
    const ts = [form4({}), form4({ transaction_date: "2026-09-20", acquisition_or_disposition: "Acquisition" }), form4({ symbol: "AAPL", transaction_date: "2026-08-01" })];
    expect(summarize(ts)).toMatchObject({ trades: 3, buys: 1, sells: 2, topAssets: [{ asset: "NVDA", count: 2 }, { asset: "AAPL", count: 1 }], latest: "2026-09-20" });
    expect([...ts].sort(byRecency).map((t) => t.date)).toEqual(["2026-09-20", "2026-09-10", "2026-08-01"]);
  });
});
