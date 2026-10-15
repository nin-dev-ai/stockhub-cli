import { describe, it, expect } from "vitest";
import { parseCommand, FUNCTIONS, FN_BY_CODE, sectionOf } from "./functions";

describe("parseCommand", () => {
  it("returns null for empty input", () => {
    expect(parseCommand("", null)).toBeNull();
    expect(parseCommand("   ", null)).toBeNull();
  });

  it("routes a bare ticker to INTEL", () => {
    expect(parseCommand("AAPL", null)).toEqual({ symbol: "AAPL", code: "INTEL" });
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(parseCommand("  aapl  ", null)).toEqual({ symbol: "AAPL", code: "INTEL" });
    expect(parseCommand("aapl gp", null)).toEqual({ symbol: "AAPL", code: "GP" });
  });

  it("opens a market-wide function with no symbol", () => {
    expect(parseCommand("WEI", null)).toEqual({ code: "WEI" });
    expect(parseCommand("CC", null)).toEqual({ code: "CC" });
  });

  it("parses SYMBOL CODE", () => {
    expect(parseCommand("TSLA KEY", null)).toEqual({ symbol: "TSLA", code: "KEY" });
  });

  it("also accepts CODE SYMBOL for symbol-requiring functions", () => {
    expect(parseCommand("GP MSFT", null)).toEqual({ symbol: "MSFT", code: "GP" });
  });

  describe("symbol-requiring functions entered alone", () => {
    it("adopts the active symbol when one is set", () => {
      expect(parseCommand("GP", "NVDA")).toEqual({ symbol: "NVDA", code: "GP" });
    });
    it("returns null when no active symbol is available", () => {
      expect(parseCommand("GP", null)).toBeNull();
    });
  });

  it("ignores a trailing symbol on a market-wide code", () => {
    expect(parseCommand("WEI AAPL", null)).toEqual({ code: "WEI" });
  });

  it("returns null when neither token is a known function", () => {
    expect(parseCommand("FOO BAR", null)).toBeNull();
  });
});

describe("function registry", () => {
  it("exposes a lookup for every registered code", () => {
    for (const fn of FUNCTIONS) {
      expect(FN_BY_CODE[fn.code]).toBe(fn);
    }
  });

  it("has unique function codes", () => {
    const codes = FUNCTIONS.map((f) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every parseable code resolves back to a registered function", () => {
    for (const fn of FUNCTIONS) {
      const parsed = parseCommand(fn.needsSymbol ? `AAPL ${fn.code}` : fn.code, null);
      expect(parsed?.code).toBe(fn.code);
    }
  });
});

describe("primary sections", () => {
  it("maps each Phase 2 screen to its own section and everything else to Explore", () => {
    expect(sectionOf("STRAT")).toBe("strategies");
    expect(sectionOf("LAB")).toBe("lab");
    expect(sectionOf("PORT")).toBe("portfolio");
    expect(sectionOf("CC")).toBe("explore");
    expect(sectionOf("GP")).toBe("explore");
  });
});
