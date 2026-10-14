import { describe, it, expect } from "vitest";
import {
  sigMA, sig52w, sigPE, sigFwdPE, sigEvEbitda, sigMargin, sigGrowth,
  sigAnalystUpside, sigAnalystRec, sigDebtEquity, sigDividend, tally,
  type Signal,
} from "./signals";

describe("sigMA", () => {
  it("returns na when inputs are missing", () => {
    expect(sigMA(undefined, 100).level).toBe("na");
    expect(sigMA(100, undefined).level).toBe("na");
  });
  it("is bullish >=2% above the average", () => {
    expect(sigMA(102, 100).level).toBe("bull");
  });
  it("is bearish <=2% below the average", () => {
    expect(sigMA(98, 100).level).toBe("bear");
  });
  it("is neutral within the +/-2% band", () => {
    expect(sigMA(101, 100).level).toBe("neutral");
    expect(sigMA(99, 100).level).toBe("neutral");
  });
  it("names the moving average in its detail", () => {
    const s = sigMA(110, 100, "200d MA");
    expect(s.label).toContain("200d MA");
    expect(s.detail).toBe("+10.0%");
  });
});

describe("sig52w", () => {
  it("returns na when any bound is missing", () => {
    expect(sig52w(50, undefined, 10).level).toBe("na");
  });
  it("flags at-high within 3% of the high", () => {
    const s = sig52w(98, 100, 10);
    expect(s.level).toBe("neutral");
    expect(s.label).toBe("At 52w high");
  });
  it("calls the upper range bullish", () => {
    expect(sig52w(90, 100, 10).level).toBe("bull");
  });
  it("calls the lower range bearish", () => {
    expect(sig52w(40, 100, 10).level).toBe("bear");
  });
  it("reports position within the range", () => {
    expect(sig52w(55, 100, 10).detail).toBe("50% of range");
  });
});

describe("sigPE", () => {
  it("treats a negative P/E as unprofitable", () => {
    expect(sigPE(-5).level).toBe("bear");
    expect(sigPE(-5).label).toBe("Unprofitable (P/E)");
  });
  it("buckets cheap / fair / rich / very rich", () => {
    expect(sigPE(10).label).toBe("Cheap P/E");
    expect(sigPE(18).label).toBe("Fair P/E");
    expect(sigPE(30).label).toBe("Rich P/E");
    expect(sigPE(50).label).toBe("Very rich P/E");
  });
});

describe("sigFwdPE", () => {
  it("is bullish when forward earnings are rising sharply vs trailing", () => {
    const s = sigFwdPE(20, 30); // -33% => earnings rising
    expect(s.level).toBe("bull");
    expect(s.label).toBe("Fwd P/E improving");
  });
  it("is bearish when forward earnings are falling vs trailing", () => {
    const s = sigFwdPE(30, 20); // +50% => earnings falling
    expect(s.level).toBe("bear");
    expect(s.label).toBe("Fwd P/E rising");
  });
  it("falls back to absolute buckets without a trailing anchor", () => {
    expect(sigFwdPE(12).label).toBe("Low Fwd P/E");
    expect(sigFwdPE(20).label).toBe("Fair Fwd P/E");
    expect(sigFwdPE(30).label).toBe("Rich Fwd P/E");
  });
  it("flags negative forward earnings", () => {
    expect(sigFwdPE(-1).level).toBe("bear");
  });
});

describe("sigEvEbitda", () => {
  it("flags negative EBITDA", () => {
    expect(sigEvEbitda(-3).label).toBe("EBITDA negative");
  });
  it("buckets cheap / fair / rich", () => {
    expect(sigEvEbitda(8).level).toBe("bull");
    expect(sigEvEbitda(14).level).toBe("neutral");
    expect(sigEvEbitda(25).level).toBe("bear");
  });
});

describe("sigMargin", () => {
  it("uses per-kind thresholds (operating default)", () => {
    expect(sigMargin(0.2, "op").level).toBe("bull");
    expect(sigMargin(0.1, "op").level).toBe("neutral");
    expect(sigMargin(0.03, "op").level).toBe("bear");
  });
  it("treats a negative margin as bearish", () => {
    const s = sigMargin(-0.05, "net");
    expect(s.level).toBe("bear");
    expect(s.label).toBe("Net margin negative");
  });
  it("formats the percentage detail", () => {
    expect(sigMargin(0.123, "gross").detail).toBe("12.3%");
  });
});

describe("sigGrowth", () => {
  it("accelerating at or above 15%", () => {
    expect(sigGrowth(0.2).label).toBe("Revenue accelerating");
  });
  it("growing between 5% and 15%", () => {
    expect(sigGrowth(0.08).label).toBe("Revenue growing");
  });
  it("flat, declining, shrinking below", () => {
    expect(sigGrowth(0.02).level).toBe("neutral");
    expect(sigGrowth(-0.05).label).toBe("Revenue declining");
    expect(sigGrowth(-0.2).label).toBe("Revenue shrinking");
  });
  it("respects the label argument", () => {
    expect(sigGrowth(0.2, "Earnings").label).toBe("Earnings accelerating");
  });
});

describe("sigAnalystUpside", () => {
  it("is bullish with >=15% upside to target", () => {
    expect(sigAnalystUpside(100, 120).level).toBe("bull");
  });
  it("is neutral with modest upside", () => {
    expect(sigAnalystUpside(100, 105).level).toBe("neutral");
  });
  it("is bearish when the target is below price", () => {
    expect(sigAnalystUpside(100, 90).level).toBe("bear");
  });
});

describe("sigAnalystRec", () => {
  it("reports no coverage without a recommendation", () => {
    expect(sigAnalystRec(undefined).level).toBe("na");
  });
  it("reads the mean score when present", () => {
    expect(sigAnalystRec("hold", 1.5).level).toBe("bull"); // strong buy by score
    expect(sigAnalystRec("hold", 3.0).level).toBe("neutral");
    expect(sigAnalystRec("sell", 4.5).level).toBe("bear");
  });
  it("reads the recommendation text", () => {
    expect(sigAnalystRec("STRONG_BUY").label).toBe("Strong buy consensus");
  });
});

describe("sigDebtEquity", () => {
  it("buckets leverage", () => {
    expect(sigDebtEquity(0.3).label).toBe("Low leverage");
    expect(sigDebtEquity(1.0).label).toBe("Moderate leverage");
    expect(sigDebtEquity(2.0).label).toBe("High leverage");
    expect(sigDebtEquity(5.0).label).toBe("Very high leverage");
  });
});

describe("sigDividend", () => {
  it("reports no dividend for a zero or missing yield", () => {
    expect(sigDividend(0).label).toBe("No dividend");
    expect(sigDividend(undefined).label).toBe("No dividend");
  });
  it("judges payout health", () => {
    expect(sigDividend(0.02, 0.4).level).toBe("bull"); // healthy
    expect(sigDividend(0.02, 0.7).level).toBe("neutral"); // high
    expect(sigDividend(0.02, 0.95).level).toBe("bear"); // stretched
  });
  it("reports yield only when payout is unknown", () => {
    const s = sigDividend(0.0325);
    expect(s.level).toBe("neutral");
    expect(s.label).toBe("3.25% yield");
  });
});

describe("tally", () => {
  const mk = (level: Signal["level"]): Signal => ({ level, label: level });
  it("counts each level and nets bull minus bear", () => {
    const t = tally([mk("bull"), mk("bull"), mk("bear"), mk("neutral"), mk("na")]);
    expect(t.bull).toBe(2);
    expect(t.bear).toBe(1);
    expect(t.neutral).toBe(1);
    expect(t.na).toBe(1);
    expect(t.net).toBe(1);
  });
  it("is Sparse with fewer than 3 informative signals", () => {
    expect(tally([mk("bull"), mk("na"), mk("na")]).verdict).toBe("Sparse");
  });
  it("is Bullish when the net clears the threshold", () => {
    const t = tally([mk("bull"), mk("bull"), mk("bull"), mk("neutral")]);
    expect(t.verdict).toBe("Bullish");
  });
  it("is Bearish when the net is sufficiently negative", () => {
    const t = tally([mk("bear"), mk("bear"), mk("bear"), mk("neutral")]);
    expect(t.verdict).toBe("Bearish");
  });
  it("is Mixed when signals offset", () => {
    const t = tally([mk("bull"), mk("bull"), mk("bear"), mk("bear"), mk("neutral")]);
    expect(t.verdict).toBe("Mixed");
  });
});
