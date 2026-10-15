import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { bandText, houseMembers, isElectronic, memberPtrs, parseBand, parseFdIndex, parsePtr, ptrTrades, searchMembers, usDate } from "./congress";
import { pdfTextItems } from "./pdfText";

const XML = `<?xml version="1.0" encoding="utf-8"?>
<FinancialDisclosure>
  <Member><Prefix>Hon.</Prefix><Last>Pelosi</Last><First>Nancy</First><Suffix /><FilingType>P</FilingType><StateDst>CA11</StateDst><Year>2026</Year><FilingDate>1/23/2026</FilingDate><DocID>20033725</DocID></Member>
  <Member><Prefix>Hon.</Prefix><Last>Pelosi</Last><First>Nancy</First><Suffix /><FilingType>P</FilingType><StateDst>CA11</StateDst><Year>2026</Year><FilingDate>8/21/2026</FilingDate><DocID>20035143</DocID></Member>
  <Member><Prefix>Hon.</Prefix><Last>Pelosi</Last><First>Nancy</First><Suffix /><FilingType>O</FilingType><StateDst>CA11</StateDst><Year>2026</Year><FilingDate>5/14/2026</FilingDate><DocID>10075707</DocID></Member>
  <Member><Prefix /><Last>Yakym</Last><First>Rudy C.</First><Suffix>III</Suffix><FilingType>P</FilingType><StateDst>IN02</StateDst><Year>2026</Year><FilingDate>7/13/2026</FilingDate><DocID>20034984</DocID></Member>
  <Member><Prefix /><Last>O&apos;Brien</Last><First>Pat</First><Suffix /><FilingType>P</FilingType><StateDst>TX07</StateDst><Year>2026</Year><FilingDate>2/2/2026</FilingDate><DocID>8221</DocID></Member>
  <Member><Prefix /><Last>Broken</Last><First>Row</First><FilingType>P</FilingType><Year>2026</Year><FilingDate>soon</FilingDate><DocID>1</DocID></Member>
</FinancialDisclosure>`;

describe("House Clerk index", () => {
  const filings = parseFdIndex(XML);
  it("parses filings, converts dates and skips broken rows", () => {
    expect(filings).toHaveLength(5);
    expect(filings[0]).toEqual({ docId: "20033725", year: 2026, filed: "2026-01-23", first: "Nancy", last: "Pelosi", suffix: "", stateDst: "CA11", filingType: "P" });
    expect(filings[4].last).toBe("O'Brien");
    expect(usDate("12/30/2025")).toBe("2025-12-30");
    expect(usDate("2025-12-30")).toBeNull();
  });
  it("lists members with PTRs and finds them by name or district", () => {
    const members = houseMembers(filings);
    expect(members.map((m) => [m.last, m.ptrs])).toEqual([["O'Brien", 1], ["Pelosi", 2], ["Yakym", 1]]);
    expect(searchMembers(members, "nancy pelosi").map((m) => m.last)).toEqual(["Pelosi"]);
    expect(searchMembers(members, "in02").map((m) => m.last)).toEqual(["Yakym"]);
    expect(searchMembers(members, "obrien").map((m) => m.last)).toEqual(["O'Brien"]);
    const pelosi = members.find((m) => m.last === "Pelosi")!;
    expect(memberPtrs(filings, pelosi.key).map((f) => f.docId)).toEqual(["20035143", "20033725"]);
  });
  it("tells electronic filings from scanned paper ones", () => {
    expect(isElectronic("20033725")).toBe(true);
    expect(isElectronic("8221")).toBe(false);
    expect(isElectronic("10075707")).toBe(false);
  });
});

describe("PTR amounts", () => {
  it("parses ranges and open-ended bands", () => {
    expect(parseBand("$1,000,001 - $5,000,000")).toEqual({ low: 1000001, high: 5000000 });
    expect(parseBand("Over $50,000,000")).toEqual({ low: 50000001, high: null });
    expect(parseBand("$15.00")).toBeNull();
    expect(bandText({ low: 1001, high: 15000 }, "")).toBe("$1,001–$15,000");
    expect(bandText({ low: 50000001, high: null }, "")).toBe("over $50,000,000");
  });
});

describe("PTR text layer (golden fixture: Nancy Pelosi, filed 23 January 2026)", async () => {
  const pages = await pdfTextItems(new Uint8Array(readFileSync(new URL("./fixtures/ptr-20033725.pdf", import.meta.url))), pdfjs as never);
  const rows = parsePtr(pages);
  it("reads every transaction, including one split across a page break", () => {
    expect(pages).toHaveLength(3);
    expect(rows).toHaveLength(18);
    const tem = rows.find((r) => r.ticker === "TEM")!;
    expect(tem.asset).toBe("Tempus AI, Inc. - Class A Common Stock (TEM)");
    expect(tem.band).toEqual({ low: 50001, high: 100000 });
    expect(tem.description).toMatch(/^Exercised 50 call options/);
  });
  it("reads owner, ticker, asset type, transaction type, dates and amount", () => {
    expect(rows[0]).toEqual({
      owner: "Spouse", asset: "AllianceBernstein Holding L.P. Units (AB)", ticker: "AB", assetType: "AB", type: "P",
      date: "2026-01-16", notified: "2026-01-16", amount: "$1,000,001 - $5,000,000", band: { low: 1000001, high: 5000000 }, description: "Purchased 25,000 shares.",
    });
    const aapl = rows.filter((r) => r.ticker === "AAPL");
    expect(aapl.map((r) => [r.type, r.assetType])).toEqual([["S (partial)", "ST"], ["P", "OP"], ["S (partial)", "ST"]]);
    expect(rows.find((r) => r.type === "E")?.ticker).toBe("VSNT");
    expect(rows.every((r) => r.owner === "Spouse" && r.date && r.notified)).toBe(true);
  });
  it("turns rows into persona trades that keep the amount as a range", () => {
    const filing = parseFdIndex(XML)[0];
    const trades = ptrTrades(rows, filing);
    const goog = trades.find((t) => t.symbol === "GOOGL" && /options/.test(t.action))!;
    expect(goog).toMatchObject({ side: "buy", action: "Purchase (options)", filed: "2026-01-23", date: "2025-12-30", value: null, shares: null, price: null });
    expect(goog.detail).toMatch(/^\$250,001–\$500,000 · Spouse · options · Purchased 20 call options/);
    expect(goog.url).toBe("https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033725.pdf");
    expect(trades.filter((t) => t.side === "sell").length).toBe(7);
  });
  it("finds nothing in a page without a table", () => {
    expect(parsePtr([[{ str: "scanned", x: 10, y: 10 }]])).toEqual([]);
    expect(parsePtr([])).toEqual([]);
  });
});
